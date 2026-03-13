'use strict';

/**
 * JWT-based authentication for authenticable entities.
 *
 * Endpoints per authenticable entity:
 *   POST /api/auth/:slug/signup
 *   POST /api/auth/:slug/login
 *   GET  /api/auth/:slug/me
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || process.env.TOKEN_SECRET_KEY || (() => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production (e.g. `openssl rand -hex 64`).');
  }
  return 'chadstart-dev-secret-change-in-production';
})();
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';
const BCRYPT_ROUNDS = 10;

function signToken(payload) { return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES }); }
function verifyToken(token) { return jwt.verify(token, JWT_SECRET); }

function registerAuthRoutes(app, core) {
  for (const entity of Object.values(core.authenticableEntities || {})) {
    const slug = entity.slug;
    const table = entity.tableName;
    const allowed = new Set(entity.properties.map((p) => p.name));
    const sanitize = (body) => Object.fromEntries(Object.entries(body).filter(([k]) => allowed.has(k)));

    app.post(`/api/auth/${slug}/signup`, async (req, res) => {
      try {
        const { email, password, ...rest } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
        if (db.findAll(table, { email }).length) return res.status(409).json({ error: 'Email already registered' });
        const user = db.create(table, { email, password: await bcrypt.hash(password, BCRYPT_ROUNDS), ...sanitize(rest) });
        res.status(201).json({ token: signToken({ id: user.id, entity: entity.name }), user: omitPassword(user) });
      } catch (e) { logger.error('signup error', e.message); res.status(500).json({ error: e.message }); }
    });

    app.post(`/api/auth/${slug}/login`, async (req, res) => {
      try {
        const { email, password } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
        const user = db.findAll(table, { email })[0];
        if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Invalid credentials' });
        res.json({ token: signToken({ id: user.id, entity: entity.name }), user: omitPassword(user) });
      } catch (e) { logger.error('login error', e.message); res.status(500).json({ error: e.message }); }
    });

    app.get(`/api/auth/${slug}/me`, requireAuth(entity.name), (req, res) => {
      const user = db.findById(table, req.user.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(omitPassword(user));
    });

    logger.info(`  Registered auth routes at /api/auth/${slug}/`);
  }
}

function requireAuth(entityName) {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Authorization header required (Bearer <token>)' });
    try {
      const payload = verifyToken(header.slice(7));
      if (entityName && payload.entity !== entityName && payload.collection !== entityName) return res.status(403).json({ error: 'Token does not belong to this collection' });
      req.user = payload;
      next();
    } catch { return res.status(401).json({ error: 'Invalid or expired token' }); }
  };
}

function optionalAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try { req.user = verifyToken(header.slice(7)); } catch { /* ignore */ }
  }
  next();
}

function omitPassword(user) {
  const { password: _, ...rest } = user;
  return rest;
}

module.exports = { registerAuthRoutes, requireAuth, optionalAuth, signToken, verifyToken, omitPassword };
