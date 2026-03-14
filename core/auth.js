'use strict';

/**
 * JWT-based authentication for authenticable entities.
 *
 * Endpoints per authenticable entity:
 *   POST /api/auth/:slug/signup
 *   POST /api/auth/:slug/login
 *   GET  /api/auth/:slug/me
 *   GET  /api/auth/:slug/api-keys
 *   POST /api/auth/:slug/api-keys
 *   DELETE /api/auth/:slug/api-keys/:id
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');
const logger = require('../utils/logger');

const API_KEY_PREFIX = 'cs_';

const JWT_SECRET = process.env.JWT_SECRET || process.env.TOKEN_SECRET_KEY || (() => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production (e.g. `openssl rand -hex 64`).');
  }
  return 'chadstart-dev-secret-change-in-production';
})();
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';
const BCRYPT_ROUNDS = 10;

function signToken(payload, expiresIn) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: expiresIn !== undefined ? expiresIn : JWT_EXPIRES });
}
function verifyToken(token) { return jwt.verify(token, JWT_SECRET); }

// ─── API Keys ─────────────────────────────────────────────────────────────────

/**
 * Initialize the _cs_api_keys system table.
 * Must be called after initDb().
 */
function initApiKeys() {
  db.getDb().exec(`
    CREATE TABLE IF NOT EXISTS "_cs_api_keys" (
      "id"          TEXT PRIMARY KEY,
      "name"        TEXT NOT NULL,
      "keyHash"     TEXT NOT NULL UNIQUE,
      "userId"      TEXT NOT NULL,
      "userEntity"  TEXT NOT NULL,
      "permissions" TEXT NOT NULL DEFAULT '[]',
      "entities"    TEXT NOT NULL DEFAULT '[]',
      "expiresAt"   TEXT,
      "createdAt"   TEXT NOT NULL,
      "updatedAt"   TEXT NOT NULL,
      "lastUsedAt"  TEXT
    )
  `);
}

function _hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Create a new API key for a user.
 * @param {string} userId
 * @param {string} userEntity  Entity name (e.g. 'Admin')
 * @param {object} opts        { name, permissions, entities, expiresAt }
 * @returns {{ key: string, record: object }}  key is the plaintext — returned once only.
 */
function createApiKey(userId, userEntity, opts = {}) {
  const { name = 'API Key', permissions = [], entities = [], expiresAt = null } = opts;
  const key = API_KEY_PREFIX + crypto.randomBytes(32).toString('hex');
  const keyHash = _hashApiKey(key);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  db.getDb().prepare(
    `INSERT INTO "_cs_api_keys" ("id","name","keyHash","userId","userEntity","permissions","entities","expiresAt","createdAt","updatedAt")
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, name, keyHash, userId, userEntity,
    JSON.stringify(permissions), JSON.stringify(entities),
    expiresAt || null, now, now
  );

  const record = db.getDb().prepare('SELECT * FROM "_cs_api_keys" WHERE "id" = ?').get(id);
  const safe = _safeApiKeyRecord(record);
  return { key, record: safe };
}

/**
 * Verify an API key string. Returns the DB record (without keyHash) or null.
 */
function verifyApiKeyStr(key) {
  if (!key || !key.startsWith(API_KEY_PREFIX)) return null;
  const hash = _hashApiKey(key);
  const record = db.getDb().prepare('SELECT * FROM "_cs_api_keys" WHERE "keyHash" = ?').get(hash);
  if (!record) return null;
  if (record.expiresAt && new Date(record.expiresAt) < new Date()) return null;
  // Update lastUsedAt asynchronously (best effort)
  try {
    db.getDb().prepare('UPDATE "_cs_api_keys" SET "lastUsedAt" = ? WHERE "id" = ?').run(new Date().toISOString(), record.id);
  } catch { /* ignore */ }
  return _safeApiKeyRecord(record);
}

/** List API keys for a specific user (without key hashes). */
function listApiKeys(userId, userEntity) {
  return db.getDb()
    .prepare('SELECT * FROM "_cs_api_keys" WHERE "userId" = ? AND "userEntity" = ? ORDER BY "createdAt" DESC')
    .all(userId, userEntity)
    .map(_safeApiKeyRecord);
}

/** List all API keys — admin view (without key hashes). */
function listAllApiKeys() {
  return db.getDb()
    .prepare('SELECT * FROM "_cs_api_keys" ORDER BY "createdAt" DESC')
    .all()
    .map(_safeApiKeyRecord);
}

/** Delete an API key by ID. */
function deleteApiKey(id) {
  db.getDb().prepare('DELETE FROM "_cs_api_keys" WHERE "id" = ?').run(id);
}

/** Strip the keyHash before returning to clients. */
function _safeApiKeyRecord(record) {
  if (!record) return null;
  const { keyHash: _, ...safe } = record;
  // Parse JSON arrays
  if (typeof safe.permissions === 'string') {
    try { safe.permissions = JSON.parse(safe.permissions); } catch { safe.permissions = []; }
  }
  if (typeof safe.entities === 'string') {
    try { safe.entities = JSON.parse(safe.entities); } catch { safe.entities = []; }
  }
  return safe;
}

/**
 * Resolve an Authorization header to a user payload.
 * Supports both JWT Bearer tokens and API key strings (cs_ prefix).
 * Returns { user, apiKeyPermissions, error }.
 */
function resolveAuthHeader(header) {
  if (!header || !header.startsWith('Bearer ')) {
    return { user: null, apiKeyPermissions: null, error: 'no_header' };
  }
  const token = header.slice(7);

  // API key
  if (token.startsWith(API_KEY_PREFIX)) {
    const record = verifyApiKeyStr(token);
    if (!record) return { user: null, apiKeyPermissions: null, error: 'invalid_token' };
    return {
      user: { id: record.userId, entity: record.userEntity },
      apiKeyPermissions: { operations: record.permissions, entities: record.entities },
      error: null,
    };
  }

  // JWT
  try {
    const payload = verifyToken(token);
    return { user: payload, apiKeyPermissions: null, error: null };
  } catch {
    return { user: null, apiKeyPermissions: null, error: 'invalid_token' };
  }
}

/**
 * Register API key management routes for each authenticable entity.
 *   GET    /api/auth/:slug/api-keys       — list caller's keys
 *   POST   /api/auth/:slug/api-keys       — create a new key
 *   DELETE /api/auth/:slug/api-keys/:id   — delete a key
 */
function registerApiKeyRoutes(app, core) {
  for (const entity of Object.values(core.authenticableEntities || {})) {
    const slug = entity.slug;

    // List caller's API keys
    app.get(`/api/auth/${slug}/api-keys`, requireAuth(entity.name), (req, res) => {
      try {
        const keys = listApiKeys(req.user.id, entity.name);
        res.json(keys);
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Create a new API key
    app.post(`/api/auth/${slug}/api-keys`, requireAuth(entity.name), (req, res) => {
      try {
        const { name, permissions, entities: keyEntities, expiresAt } = req.body || {};
        const { key, record } = createApiKey(req.user.id, entity.name, {
          name: name || 'API Key',
          permissions: Array.isArray(permissions) ? permissions : [],
          entities: Array.isArray(keyEntities) ? keyEntities : [],
          expiresAt: expiresAt || null,
        });
        res.status(201).json({ key, record });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Delete one of the caller's API keys
    app.delete(`/api/auth/${slug}/api-keys/:id`, requireAuth(entity.name), (req, res) => {
      try {
        const record = db.getDb().prepare('SELECT * FROM "_cs_api_keys" WHERE "id" = ?').get(req.params.id);
        if (!record) return res.status(404).json({ error: 'API key not found' });
        if (record.userId !== req.user.id || record.userEntity !== entity.name) {
          return res.status(403).json({ error: 'Access denied' });
        }
        deleteApiKey(req.params.id);
        res.json({ success: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
  }
}

function registerAuthRoutes(app, core) {
  for (const entity of Object.values(core.authenticableEntities || {})) {
    const slug = entity.slug;
    const table = entity.tableName;
    const allowed = new Set(entity.properties.map((p) => p.name));
    const sanitize = (body) => Object.fromEntries(Object.entries(body).filter(([k]) => allowed.has(k)));

    // Check signup policy: forbidden => block, other values => allow
    const signupPolicies = (entity.policies || {}).signup;
    const signupForbidden = signupPolicies && signupPolicies.length > 0 && signupPolicies[0].access === 'forbidden';

    app.post(`/api/auth/${slug}/signup`, async (req, res) => {
      try {
        if (signupForbidden) return res.status(403).json({ error: 'Signup is forbidden for this entity' });

        const { email, password, ...rest } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
        if (db.findAllSimple(table, { email }).length) return res.status(409).json({ error: 'Email already registered' });
        const user = db.create(table, { email, password: await bcrypt.hash(password, BCRYPT_ROUNDS), ...sanitize(rest) });
        res.status(201).json({ token: signToken({ id: user.id, entity: entity.name }), user: omitPassword(user) });
      } catch (e) { logger.error('signup error', e.message); res.status(500).json({ error: e.message }); }
    });

    app.post(`/api/auth/${slug}/login`, async (req, res) => {
      try {
        const { email, password } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
        const user = db.findAllSimple(table, { email })[0];
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
    const { user, apiKeyPermissions, error } = resolveAuthHeader(req.headers.authorization);
    if (!user) return res.status(401).json({ error: 'Authorization header required (Bearer <token>)' });
    if (error === 'invalid_token') return res.status(401).json({ error: 'Invalid or expired token' });
    if (entityName && user.entity !== entityName) return res.status(403).json({ error: 'Token does not belong to this collection' });
    req.user = user;
    if (apiKeyPermissions) req._apiKeyPermissions = apiKeyPermissions;
    next();
  };
}

function optionalAuth(req, _res, next) {
  const { user, apiKeyPermissions } = resolveAuthHeader(req.headers.authorization);
  if (user) {
    req.user = user;
    if (apiKeyPermissions) req._apiKeyPermissions = apiKeyPermissions;
  }
  next();
}

function omitPassword(user) {
  const { password: _, ...rest } = user;
  return rest;
}

module.exports = {
  registerAuthRoutes, registerApiKeyRoutes, initApiKeys,
  requireAuth, optionalAuth, resolveAuthHeader,
  signToken, verifyToken, omitPassword, JWT_SECRET,
  createApiKey, listApiKeys, listAllApiKeys, deleteApiKey, verifyApiKeyStr,
};
