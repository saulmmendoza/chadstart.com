'use strict';

/**
 * core/auth.js
 *
 * JWT-based authentication for authenticable entities.
 *
 * In the docs-baas format, user collections are entities with
 * `authenticable: true`. This module registers auth routes for
 * each authenticable entity.
 *
 * Endpoints (registered per authenticable entity slug):
 *   POST /api/auth/:slug/signup   – create account, return token
 *   POST /api/auth/:slug/login    – verify credentials, return token
 *   GET  /api/auth/:slug/me       – return current user (requires token)
 *
 * Middleware:
 *   requireAuth(entityName?)  – protect any route
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || process.env.TOKEN_SECRET_KEY || (() => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET environment variable must be set in production. ' +
        'Set it to a long random string (e.g. `openssl rand -hex 64`).'
    );
  }
  return 'chadstart-dev-secret-change-in-production';
})();
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';
const BCRYPT_ROUNDS = 10;

// ─── Token helpers ─────────────────────────────────────────────────────────

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// ─── Route registration ────────────────────────────────────────────────────

/**
 * Register auth routes for all authenticable entities defined in core.
 */
function registerAuthRoutes(app, core) {
  const authenticableEntities = core.authenticableEntities || {};

  for (const entity of Object.values(authenticableEntities)) {
    const slug = entity.slug || toSlug(entity.name);
    const tableName = entity.tableName;

    // POST /api/auth/:slug/signup
    app.post(`/api/auth/${slug}/signup`, async (req, res) => {
      try {
        const { email, password, ...rest } = req.body || {};
        if (!email || !password) {
          return res.status(400).json({ error: 'email and password are required' });
        }

        // Check duplicate email
        const existing = db.findAll(tableName, { email });
        if (existing.length > 0) {
          return res.status(409).json({ error: 'Email already registered' });
        }

        const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

        // Only allow extra fields declared in the entity's properties
        const safeRest = sanitizeUserBody(rest, entity);
        const user = db.create(tableName, {
          email,
          password: hashedPassword,
          ...safeRest,
        });

        const token = signToken({ id: user.id, collection: entity.name, entity: entity.name });
        res.status(201).json({ token, user: omitPassword(user) });
      } catch (err) {
        logger.error('signup error', err.message);
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/auth/:slug/login
    app.post(`/api/auth/${slug}/login`, async (req, res) => {
      try {
        const { email, password } = req.body || {};
        if (!email || !password) {
          return res.status(400).json({ error: 'email and password are required' });
        }

        const rows = db.findAll(tableName, { email });
        const user = rows[0] || null;
        if (!user) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = signToken({ id: user.id, collection: entity.name, entity: entity.name });
        res.json({ token, user: omitPassword(user) });
      } catch (err) {
        logger.error('login error', err.message);
        res.status(500).json({ error: err.message });
      }
    });

    // GET /api/auth/:slug/me
    app.get(`/api/auth/${slug}/me`, requireAuth(entity.name), (req, res) => {
      const user = db.findById(tableName, req.user.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(omitPassword(user));
    });

    logger.info(`  Registered auth routes for "${entity.name}" at /api/auth/${slug}/`);
  }
}

// ─── Middleware ─────────────────────────────────────────────────────────────

/**
 * Express middleware that verifies a Bearer JWT.
 * If entityName is provided, also checks that the token belongs to that entity.
 * Sets req.user = { id, collection, entity } on success.
 */
function requireAuth(entityName) {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization header required (Bearer <token>)' });
    }
    const token = header.slice(7);
    try {
      const payload = verifyToken(token);
      if (entityName && payload.collection !== entityName && payload.entity !== entityName) {
        return res.status(403).json({ error: 'Token does not belong to this collection' });
      }
      req.user = payload;
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

/**
 * Middleware that optionally authenticates. Sets req.user if valid token present.
 * Does NOT reject the request if no token is provided.
 */
function optionalAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      req.user = verifyToken(header.slice(7));
    } catch {
      // ignore invalid tokens
    }
  }
  next();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function omitPassword(user) {
  const { password: _pw, ...rest } = user;
  return rest;
}

function sanitizeUserBody(body, entity) {
  const allowed = new Set(entity.properties.map((p) => p.name));
  const result = {};
  for (const key of Object.keys(body)) {
    if (allowed.has(key)) result[key] = body[key];
  }
  return result;
}

function toSlug(name) {
  return name
    .replace(/([A-Z])/g, (m, p, offset) => (offset > 0 ? '-' : '') + p.toLowerCase())
    .replace(/^-/, '')
    .replace(/[^a-z0-9-]/g, '-');
}

module.exports = {
  registerAuthRoutes,
  requireAuth,
  optionalAuth,
  signToken,
  verifyToken,
  omitPassword,
};
