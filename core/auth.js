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

// Quote an identifier for the current database engine (mirrors db.js helper)
const _DB_ENGINE = (process.env.DB_ENGINE || 'sqlite').toLowerCase();
function _q(name) { return _DB_ENGINE === 'mysql' ? `\`${name}\`` : `"${name}"`; }

// Column types for the API keys table (must be indexable in all engines)
const _ID_T   = _DB_ENGINE === 'mysql' ? 'VARCHAR(36)'   : 'TEXT';
const _HASH_T = _DB_ENGINE === 'mysql' ? 'VARCHAR(64)'   : 'TEXT';
const _NAME_T = _DB_ENGINE === 'mysql' ? 'VARCHAR(255)'  : 'TEXT';
// JSON array columns — MySQL forbids DEFAULT on TEXT, so use bounded VARCHAR
const _JSON_T = _DB_ENGINE === 'mysql' ? 'VARCHAR(2000)' : 'TEXT';

function signToken(payload, expiresIn) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: expiresIn !== undefined ? expiresIn : JWT_EXPIRES });
}
function verifyToken(token) { return jwt.verify(token, JWT_SECRET); }

// ─── API Keys ─────────────────────────────────────────────────────────────────

/**
 * Initialize the _cs_api_keys system table.
 * Must be called after initDb().
 */
async function initApiKeys() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ${_q('_cs_api_keys')} (
      ${_q('id')}          ${_ID_T} PRIMARY KEY,
      ${_q('name')}        ${_NAME_T} NOT NULL,
      ${_q('keyHash')}     ${_HASH_T} NOT NULL UNIQUE,
      ${_q('userId')}      ${_ID_T} NOT NULL,
      ${_q('userEntity')}  ${_NAME_T} NOT NULL,
      ${_q('permissions')} ${_JSON_T} NOT NULL DEFAULT '[]',
      ${_q('entities')}    ${_JSON_T} NOT NULL DEFAULT '[]',
      ${_q('expiresAt')}   TEXT,
      ${_q('createdAt')}   TEXT NOT NULL,
      ${_q('updatedAt')}   TEXT NOT NULL,
      ${_q('lastUsedAt')}  TEXT
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
async function createApiKey(userId, userEntity, opts = {}) {
  const { name = 'API Key', permissions = [], entities = [], expiresAt = null } = opts;
  const key = API_KEY_PREFIX + crypto.randomBytes(32).toString('hex');
  const keyHash = _hashApiKey(key);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await db.queryRun(
    `INSERT INTO ${_q('_cs_api_keys')} (${_q('id')},${_q('name')},${_q('keyHash')},${_q('userId')},${_q('userEntity')},${_q('permissions')},${_q('entities')},${_q('expiresAt')},${_q('createdAt')},${_q('updatedAt')})
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, name, keyHash, userId, userEntity, JSON.stringify(permissions), JSON.stringify(entities), expiresAt || null, now, now]
  );

  const record = await db.queryOne(
    `SELECT * FROM ${_q('_cs_api_keys')} WHERE ${_q('id')} = ?`, [id]
  );
  return { key, record: _safeApiKeyRecord(record) };
}

/**
 * Verify an API key string. Returns the DB record (without keyHash) or null.
 */
async function verifyApiKeyStr(key) {
  if (!key || !key.startsWith(API_KEY_PREFIX)) return null;
  const hash = _hashApiKey(key);
  const record = await db.queryOne(
    `SELECT * FROM ${_q('_cs_api_keys')} WHERE ${_q('keyHash')} = ?`, [hash]
  );
  if (!record) return null;
  if (record.expiresAt && new Date(record.expiresAt) < new Date()) return null;
  // Update lastUsedAt asynchronously (best effort)
  try {
    await db.queryRun(
      `UPDATE ${_q('_cs_api_keys')} SET ${_q('lastUsedAt')} = ? WHERE ${_q('id')} = ?`,
      [new Date().toISOString(), record.id]
    );
  } catch { /* ignore */ }
  return _safeApiKeyRecord(record);
}

/** List API keys for a specific user (without key hashes). */
async function listApiKeys(userId, userEntity) {
  const rows = await db.queryAll(
    `SELECT * FROM ${_q('_cs_api_keys')} WHERE ${_q('userId')} = ? AND ${_q('userEntity')} = ? ORDER BY ${_q('createdAt')} DESC`,
    [userId, userEntity]
  );
  return rows.map(_safeApiKeyRecord);
}

/** List all API keys — admin view (without key hashes). */
async function listAllApiKeys() {
  const rows = await db.queryAll(
    `SELECT * FROM ${_q('_cs_api_keys')} ORDER BY ${_q('createdAt')} DESC`, []
  );
  return rows.map(_safeApiKeyRecord);
}

/** Delete an API key by ID. */
async function deleteApiKey(id) {
  await db.queryRun(`DELETE FROM ${_q('_cs_api_keys')} WHERE ${_q('id')} = ?`, [id]);
}

/** Strip the keyHash before returning to clients. */
function _safeApiKeyRecord(record) {
  if (!record) return null;
  const { keyHash: _, ...safe } = record;
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
 * Supports both JWT Bearer and API key strings (cs_ prefix).
 * Returns { user, apiKeyPermissions, error }.
 */
async function resolveAuthHeader(header) {
  if (!header || !header.startsWith('Bearer ')) {
    return { user: null, apiKeyPermissions: null, error: 'no_header' };
  }
  const token = header.slice(7);

  // API key
  if (token.startsWith(API_KEY_PREFIX)) {
    const record = await verifyApiKeyStr(token);
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
 */
function registerApiKeyRoutes(app, core) {
  for (const entity of Object.values(core.authenticableEntities || {})) {
    const slug = entity.slug;

    // List caller's API keys
    app.get(`/api/auth/${slug}/api-keys`, requireAuth(entity.name), async (req, res) => {
      try {
        const keys = await listApiKeys(req.user.id, entity.name);
        res.json(keys);
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Create a new API key
    app.post(`/api/auth/${slug}/api-keys`, requireAuth(entity.name), async (req, res) => {
      try {
        const { name, permissions, entities: keyEntities, expiresAt } = req.body || {};
        const { key, record } = await createApiKey(req.user.id, entity.name, {
          name: name || 'API Key',
          permissions: Array.isArray(permissions) ? permissions : [],
          entities: Array.isArray(keyEntities) ? keyEntities : [],
          expiresAt: expiresAt || null,
        });
        res.status(201).json({ key, record });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Delete one of the caller's API keys
    app.delete(`/api/auth/${slug}/api-keys/:id`, requireAuth(entity.name), async (req, res) => {
      try {
        const record = await db.queryOne(
          `SELECT * FROM ${_q('_cs_api_keys')} WHERE ${_q('id')} = ?`, [req.params.id]
        );
        if (!record) return res.status(404).json({ error: 'API key not found' });
        if (record.userId !== req.user.id || record.userEntity !== entity.name) {
          return res.status(403).json({ error: 'Access denied' });
        }
        await deleteApiKey(req.params.id);
        res.json({ success: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
  }
}

function registerAuthRoutes(app, core, emit) {
  const _emit = typeof emit === 'function' ? emit : () => {};
  for (const entity of Object.values(core.authenticableEntities || {})) {
    const slug = entity.slug;
    const table = entity.tableName;
    const allowed = new Set(entity.properties.map((p) => p.name));
    const sanitize = (body) => Object.fromEntries(Object.entries(body).filter(([k]) => allowed.has(k)));

    const signupPolicies = (entity.policies || {}).signup;
    const signupForbidden = signupPolicies && signupPolicies.length > 0 && signupPolicies[0].access === 'forbidden';

    app.post(`/api/auth/${slug}/signup`, async (req, res) => {
      try {
        if (signupForbidden) return res.status(403).json({ error: 'Signup is forbidden for this entity' });
        const { email, password, ...rest } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
        if ((await db.findAllSimple(table, { email })).length) return res.status(409).json({ error: 'Email already registered' });
        const user = await db.create(table, { email, password: await bcrypt.hash(password, BCRYPT_ROUNDS), ...sanitize(rest) });
        _emit(`${entity.name}.created`, omitPassword(user));
        res.status(201).json({ token: signToken({ id: user.id, entity: entity.name }), user: omitPassword(user) });
      } catch (e) { logger.error('signup error', e.message); res.status(500).json({ error: e.message }); }
    });

    app.post(`/api/auth/${slug}/login`, async (req, res) => {
      try {
        const { email, password } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
        const user = (await db.findAllSimple(table, { email }))[0];
        if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Invalid credentials' });
        res.json({ token: signToken({ id: user.id, entity: entity.name }), user: omitPassword(user) });
      } catch (e) { logger.error('login error', e.message); res.status(500).json({ error: e.message }); }
    });

    app.get(`/api/auth/${slug}/me`, requireAuth(entity.name), async (req, res) => {
      const user = await db.findById(table, req.user.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(omitPassword(user));
    });

    logger.info(`  Registered auth routes at /api/auth/${slug}/`);
  }
}

function requireAuth(entityName) {
  return async (req, res, next) => {
    const { user, apiKeyPermissions, error } = await resolveAuthHeader(req.headers.authorization);
    if (!user) return res.status(401).json({ error: 'Authorization header required (Bearer <token>)' });
    if (error === 'invalid_token') return res.status(401).json({ error: 'Invalid or expired token' });
    if (entityName && user.entity !== entityName) return res.status(403).json({ error: 'Token does not belong to this collection' });
    req.user = user;
    if (apiKeyPermissions) req._apiKeyPermissions = apiKeyPermissions;
    next();
  };
}

async function optionalAuth(req, _res, next) {
  const { user, apiKeyPermissions } = await resolveAuthHeader(req.headers.authorization);
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
