'use strict';

/**
 * core/auth.js
 *
 * JWT-based authentication for user collections.
 *
 * Endpoints (registered per user-collection slug):
 *   POST /auth/:collectionSlug/signup   – create account, return token
 *   POST /auth/:collectionSlug/login    – verify credentials, return token
 *   GET  /auth/:collectionSlug/me       – return current user (requires token)
 *
 * Middleware:
 *   requireAuth(collectionSlug?)  – protect any route
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || (() => {
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
 * Register auth routes for all user collections defined in core.
 */
function registerAuthRoutes(app, core) {
  for (const uc of Object.values(core.userCollections)) {
    const slug = toSlug(uc.name);

    // POST /auth/:slug/signup
    app.post(`/auth/${slug}/signup`, async (req, res) => {
      try {
        const { email, password, ...rest } = req.body || {};
        if (!email || !password) {
          return res.status(400).json({ error: 'email and password are required' });
        }

        // Check duplicate email
        const existing = db.findAll(uc.tableName, { email });
        if (existing.length > 0) {
          return res.status(409).json({ error: 'Email already registered' });
        }

        const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

        // Only allow extra fields declared in the collection's properties
        const safeRest = sanitizeUserBody(rest, uc);
        const user = db.create(uc.tableName, {
          email,
          password: hashedPassword,
          ...safeRest,
        });

        const token = signToken({ id: user.id, collection: uc.name });
        res.status(201).json({ token, user: omitPassword(user) });
      } catch (err) {
        logger.error('signup error', err.message);
        res.status(500).json({ error: err.message });
      }
    });

    // POST /auth/:slug/login
    app.post(`/auth/${slug}/login`, async (req, res) => {
      try {
        const { email, password } = req.body || {};
        if (!email || !password) {
          return res.status(400).json({ error: 'email and password are required' });
        }

        const rows = db.findAll(uc.tableName, { email });
        const user = rows[0] || null;
        if (!user) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = signToken({ id: user.id, collection: uc.name });
        res.json({ token, user: omitPassword(user) });
      } catch (err) {
        logger.error('login error', err.message);
        res.status(500).json({ error: err.message });
      }
    });

    // GET /auth/:slug/me
    app.get(`/auth/${slug}/me`, requireAuth(uc.name), (req, res) => {
      const user = db.findById(uc.tableName, req.user.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(omitPassword(user));
    });

    // ── CRUD routes for the user collection (admin-only) ───────────────
    const apiBase = `/api/${toSlug(uc.name)}s`;

    // GET /api/<slug>s — list all (password omitted)
    app.get(apiBase, (req, res) => {
      try {
        const rows = db.findAll(uc.tableName).map(omitPassword);
        res.json(rows);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // GET /api/<slug>s/:id
    app.get(`${apiBase}/:id`, (req, res) => {
      try {
        const row = db.findById(uc.tableName, req.params.id);
        if (!row) return res.status(404).json({ error: 'Not found' });
        res.json(omitPassword(row));
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // PATCH /api/<slug>s/:id — update non-password fields
    app.patch(`${apiBase}/:id`, async (req, res) => {
      try {
        const existing = db.findById(uc.tableName, req.params.id);
        if (!existing) return res.status(404).json({ error: 'Not found' });
        const { password, ...rest } = req.body || {};
        const safeData = sanitizeUserBody(rest, uc);
        if (password) {
          safeData.password = await bcrypt.hash(password, BCRYPT_ROUNDS);
        }
        const updated = db.update(uc.tableName, req.params.id, safeData);
        res.json(omitPassword(updated));
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    });

    // DELETE /api/<slug>s/:id
    app.delete(`${apiBase}/:id`, (req, res) => {
      try {
        const removed = db.remove(uc.tableName, req.params.id);
        if (!removed) return res.status(404).json({ error: 'Not found' });
        res.json(omitPassword(removed));
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    logger.info(`  Registered auth routes for "${uc.name}" at /auth/${slug}/`);
  }
}

// ─── Middleware ─────────────────────────────────────────────────────────────

/**
 * Express middleware that verifies a Bearer JWT.
 * If collectionName is provided, also checks that the token belongs to that collection.
 * Sets req.user = { id, collection } on success.
 */
function requireAuth(collectionName) {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization header required (Bearer <token>)' });
    }
    const token = header.slice(7);
    try {
      const payload = verifyToken(token);
      if (collectionName && payload.collection !== collectionName) {
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

function sanitizeUserBody(body, uc) {
  const allowed = new Set(uc.properties.map((p) => p.name));
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
