'use strict';

/**
 * JWT-based authentication for authenticable entities.
 *
 * Endpoints per authenticable entity:
 *   POST /api/auth/:slug/signup
 *   POST /api/auth/:slug/login
 *   GET  /api/auth/:slug/me
 *   POST /api/auth/:slug/request-verification
 *   POST /api/auth/:slug/confirm-verification
 *   POST /api/auth/:slug/request-password-reset
 *   POST /api/auth/:slug/confirm-password-reset
 *   GET  /api/auth/:slug/api-keys
 *   POST /api/auth/:slug/api-keys
 *   DELETE /api/auth/:slug/api-keys/:id
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { q: _q, DB_ENGINE: _DB_ENGINE } = db;
const logger = require('../utils/logger');
const { generateMfaSecret, verifyTotp, generateRecoveryCodes, buildOtpauthUri } = require('./mfa');

const API_KEY_PREFIX = 'cs_';

const JWT_SECRET = process.env.JWT_SECRET || process.env.TOKEN_SECRET_KEY || (() => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production (e.g. `openssl rand -hex 64`).');
  }
  return 'chadstart-dev-secret-change-in-production';
})();
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';
const BCRYPT_ROUNDS = 10;

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

/** Generate a cryptographically secure random hex token. */
function generateSecureToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ─── Default email templates ─────────────────────────────────────────────────

const DEFAULT_VERIFICATION_TEMPLATE = {
  subject: 'Verify your email for {{appName}}',
  text: 'Hi {{name}},\n\nPlease verify your email address by using the following token:\n\n{{token}}\n\nOr click this link: {{link}}\n\nThanks,\n{{appName}}',
  html: '<h2>Verify your email</h2><p>Hi {{name}},</p><p>Please verify your email address by clicking the link below:</p><p><a href="{{link}}">Verify Email</a></p><p>Or use this token: <code>{{token}}</code></p><p>Thanks,<br>{{appName}}</p>',
};

const DEFAULT_PASSWORD_RESET_TEMPLATE = {
  subject: 'Reset your password for {{appName}}',
  text: 'Hi {{name}},\n\nYou requested a password reset. Use the following token:\n\n{{token}}\n\nOr click this link: {{link}}\n\nThis link expires in 1 hour.\n\nIf you did not request this, please ignore this email.\n\nThanks,\n{{appName}}',
  html: '<h2>Reset your password</h2><p>Hi {{name}},</p><p>You requested a password reset. Click the link below:</p><p><a href="{{link}}">Reset Password</a></p><p>Or use this token: <code>{{token}}</code></p><p>This link expires in 1 hour.</p><p>If you did not request this, please ignore this email.</p><p>Thanks,<br>{{appName}}</p>',
};

const DEFAULT_MAGIC_LINK_TEMPLATE = {
  subject: 'Sign in to {{appName}}',
  text: 'Hi,\n\nClick this link to sign in:\n\n{{link}}\n\nThis link expires in 15 minutes.\n\nThanks,\n{{appName}}',
  html: '<h2>Sign in</h2><p>Click the link below to sign in:</p><p><a href="{{link}}">Sign In</a></p><p>This link expires in 15 minutes.</p><p>Thanks,<br>{{appName}}</p>',
};

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

  // Lazily load email module to avoid circular dependency at module load time
  let _emailMod;
  function _getEmail() {
    if (!_emailMod) _emailMod = require('./email');
    return _emailMod;
  }

  /** Try to send an email — logs and swallows errors so auth flow still succeeds when SMTP is down. */
  async function _trySend(opts) {
    try {
      await _getEmail().sendEmail(opts);
    } catch (e) {
      logger.warn(`Email send failed (${opts.to}): ${e.message}`);
    }
  }

  /** Merge user-defined template with built-in default. */
  function _tpl(kind) {
    const defaultMap = {
      verification: DEFAULT_VERIFICATION_TEMPLATE,
      passwordReset: DEFAULT_PASSWORD_RESET_TEMPLATE,
      magicLink: DEFAULT_MAGIC_LINK_TEMPLATE,
    };
    const defaults = defaultMap[kind] || DEFAULT_VERIFICATION_TEMPLATE;
    const custom = ((core.email || {}).templates || {})[kind] || {};
    return {
      subject: custom.subject || defaults.subject,
      text: custom.text || defaults.text,
      html: custom.html || defaults.html,
    };
  }

  for (const entity of Object.values(core.authenticableEntities || {})) {
    const slug = entity.slug;
    const table = entity.tableName;
    const allowed = new Set(entity.properties.map((p) => p.name));
    const sanitize = (body) => Object.fromEntries(Object.entries(body).filter(([k]) => allowed.has(k)));

    const signupPolicies = (entity.policies || {}).signup;
    const signupForbidden = signupPolicies && signupPolicies.length > 0 && signupPolicies[0].access === 'forbidden';

    // ── Signup ────────────────────────────────────────────────────────────
    app.post(`/api/auth/${slug}/signup`, async (req, res) => {
      try {
        if (signupForbidden) return res.status(403).json({ error: 'Signup is forbidden for this entity' });
        const { email, password, ...rest } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
        if ((await db.findAllSimple(table, { email })).length) return res.status(409).json({ error: 'Email already registered' });

        // Generate email verification token
        const verificationToken = generateSecureToken();
        const user = await db.create(table, {
          email,
          password: await bcrypt.hash(password, BCRYPT_ROUNDS),
          emailVerified: 0,
          emailVerificationToken: verificationToken,
          ...sanitize(rest),
        });
        _emit(`${entity.name}.created`, omitPassword(user));

        // Send verification email (best-effort — does not block signup)
        const tpl = _tpl('verification');
        const vars = { appName: core.name, name: email, token: verificationToken, link: `${_appUrl()}/verify?token=${verificationToken}` };
        _trySend({ to: email, subject: tpl.subject, text: tpl.text, html: tpl.html, vars });

        res.status(201).json({ token: signToken({ id: user.id, entity: entity.name }), user: omitPassword(user) });
      } catch (e) { logger.error('signup error', e.message); res.status(500).json({ error: e.message }); }
    });

    // ── Login ─────────────────────────────────────────────────────────────
    app.post(`/api/auth/${slug}/login`, async (req, res) => {
      try {
        const { email, password } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
        const user = (await db.findAllSimple(table, { email }))[0];
        if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Invalid credentials' });

        // Block login if email verification is required but not done
        if (entity.requireEmailVerification && !user.emailVerified) {
          return res.status(403).json({ error: 'Email not verified. Please verify your email before logging in.' });
        }

        // MFA challenge: return partial token when MFA is enabled
        if (entity.mfa && user.mfaEnabled) {
          const mfaToken = signToken({ id: user.id, entity: entity.name, mfaChallenge: true }, '5m');
          return res.json({ mfaRequired: true, mfaToken });
        }

        res.json({ token: signToken({ id: user.id, entity: entity.name }), user: omitPassword(user) });
      } catch (e) { logger.error('login error', e.message); res.status(500).json({ error: e.message }); }
    });

    // ── Me ─────────────────────────────────────────────────────────────────
    app.get(`/api/auth/${slug}/me`, requireAuth(entity.name), async (req, res) => {
      const user = await db.findById(table, req.user.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(omitPassword(user));
    });

    // ── Request Verification ──────────────────────────────────────────────
    app.post(`/api/auth/${slug}/request-verification`, requireAuth(entity.name), async (req, res) => {
      try {
        const user = await db.findById(table, req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.emailVerified) return res.json({ message: 'Email already verified' });

        const token = generateSecureToken();
        await db.update(table, user.id, { emailVerificationToken: token });

        const tpl = _tpl('verification');
        const vars = { appName: core.name, name: user.email, token, link: `${_appUrl()}/verify?token=${token}` };
        await _trySend({ to: user.email, subject: tpl.subject, text: tpl.text, html: tpl.html, vars });

        res.json({ message: 'Verification email sent' });
      } catch (e) { logger.error('request-verification error', e.message); res.status(500).json({ error: e.message }); }
    });

    // ── Confirm Verification ──────────────────────────────────────────────
    app.post(`/api/auth/${slug}/confirm-verification`, async (req, res) => {
      try {
        const { token } = req.body || {};
        if (!token) return res.status(400).json({ error: 'token is required' });

        const user = (await db.findAllSimple(table, { emailVerificationToken: token }))[0];
        if (!user) return res.status(400).json({ error: 'Invalid or expired verification token' });

        await db.update(table, user.id, { emailVerified: 1, emailVerificationToken: null });
        res.json({ message: 'Email verified successfully' });
      } catch (e) { logger.error('confirm-verification error', e.message); res.status(500).json({ error: e.message }); }
    });

    // ── Request Password Reset ────────────────────────────────────────────
    app.post(`/api/auth/${slug}/request-password-reset`, async (req, res) => {
      try {
        const { email } = req.body || {};
        if (!email) return res.status(400).json({ error: 'email is required' });

        // Always return 200 to avoid leaking whether email exists
        const user = (await db.findAllSimple(table, { email }))[0];
        if (user) {
          const token = generateSecureToken();
          const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
          await db.update(table, user.id, { passwordResetToken: token, passwordResetExpiry: expiry });

          const tpl = _tpl('passwordReset');
          const vars = { appName: core.name, name: user.email, token, link: `${_appUrl()}/reset-password?token=${token}` };
          _trySend({ to: user.email, subject: tpl.subject, text: tpl.text, html: tpl.html, vars });
        }

        res.json({ message: 'If an account with that email exists, a password reset email has been sent.' });
      } catch (e) { logger.error('request-password-reset error', e.message); res.status(500).json({ error: e.message }); }
    });

    // ── Confirm Password Reset ────────────────────────────────────────────
    app.post(`/api/auth/${slug}/confirm-password-reset`, async (req, res) => {
      try {
        const { token, password } = req.body || {};
        if (!token || !password) return res.status(400).json({ error: 'token and password are required' });

        const user = (await db.findAllSimple(table, { passwordResetToken: token }))[0];
        if (!user) return res.status(400).json({ error: 'Invalid or expired reset token' });

        // Check expiry
        if (!user.passwordResetExpiry || new Date(user.passwordResetExpiry) < new Date()) {
          return res.status(400).json({ error: 'Reset token has expired' });
        }

        await db.update(table, user.id, {
          password: await bcrypt.hash(password, BCRYPT_ROUNDS),
          passwordResetToken: null,
          passwordResetExpiry: null,
        });
        res.json({ message: 'Password reset successfully' });
      } catch (e) { logger.error('confirm-password-reset error', e.message); res.status(500).json({ error: e.message }); }
    });

    // ── Magic Link ──────────────────────────────────────────────────────
    if (entity.magicLink) {
      // POST /api/auth/:slug/magic-link — request a magic link
      app.post(`/api/auth/${slug}/magic-link`, async (req, res) => {
        try {
          const { email } = req.body || {};
          if (!email) return res.status(400).json({ error: 'email is required' });

          // Always return 200 to avoid leaking whether email exists
          let user = (await db.findAllSimple(table, { email }))[0];
          if (!user) {
            // Auto-create account (passwordless signup)
            const placeholder = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), BCRYPT_ROUNDS);
            user = await db.create(table, {
              email,
              password: placeholder,
              emailVerified: 1,
            });
            _emit(`${entity.name}.created`, omitPassword(user));
          }

          const token = generateSecureToken();
          const expiry = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes
          await db.update(table, user.id, { magicLinkToken: token, magicLinkExpiry: expiry });

          const tpl = _tpl('magicLink');
          const vars = { appName: core.name, name: user.email, token, link: `${_appUrl()}/magic-login?token=${token}` };
          _trySend({ to: email, subject: tpl.subject, text: tpl.text, html: tpl.html, vars });

          res.json({ message: 'If an account with that email exists, a magic link has been sent.' });
        } catch (e) { logger.error('magic-link error', e.message); res.status(500).json({ error: e.message }); }
      });

      // POST /api/auth/:slug/magic-link/confirm — confirm magic link token
      app.post(`/api/auth/${slug}/magic-link/confirm`, async (req, res) => {
        try {
          const { token } = req.body || {};
          if (!token) return res.status(400).json({ error: 'token is required' });

          const user = (await db.findAllSimple(table, { magicLinkToken: token }))[0];
          if (!user) return res.status(400).json({ error: 'Invalid or expired magic link token' });

          if (!user.magicLinkExpiry || new Date(user.magicLinkExpiry) < new Date()) {
            return res.status(400).json({ error: 'Magic link token has expired' });
          }

          // Clear the token and mark email as verified
          await db.update(table, user.id, { magicLinkToken: null, magicLinkExpiry: null, emailVerified: 1 });

          const freshUser = await db.findById(table, user.id);
          res.json({ token: signToken({ id: user.id, entity: entity.name }), user: omitPassword(freshUser) });
        } catch (e) { logger.error('magic-link-confirm error', e.message); res.status(500).json({ error: e.message }); }
      });
    }

    // ── MFA / Two-Factor Authentication ─────────────────────────────────
    if (entity.mfa) {
      // Setup: generate secret + otpauth URI
      app.post(`/api/auth/${slug}/mfa/setup`, requireAuth(entity.name), async (req, res) => {
        try {
          const user = await db.findById(table, req.user.id);
          if (!user) return res.status(404).json({ error: 'User not found' });
          if (user.mfaEnabled) return res.status(400).json({ error: 'MFA is already enabled' });

          const secret = generateMfaSecret();
          await db.update(table, user.id, { mfaSecret: secret });

          const uri = buildOtpauthUri(secret, user.email, core.name || 'ChadStart');
          res.json({ secret, uri });
        } catch (e) { logger.error('mfa setup error', e.message); res.status(500).json({ error: e.message }); }
      });

      // Verify: confirm TOTP code and enable MFA
      app.post(`/api/auth/${slug}/mfa/verify`, requireAuth(entity.name), async (req, res) => {
        try {
          const { code } = req.body || {};
          if (!code) return res.status(400).json({ error: 'code is required' });

          const user = await db.findById(table, req.user.id);
          if (!user) return res.status(404).json({ error: 'User not found' });
          if (user.mfaEnabled) return res.status(400).json({ error: 'MFA is already enabled' });
          if (!user.mfaSecret) return res.status(400).json({ error: 'MFA setup not initiated. Call /mfa/setup first.' });

          if (!verifyTotp(user.mfaSecret, code)) {
            return res.status(400).json({ error: 'Invalid TOTP code' });
          }

          const recoveryCodes = generateRecoveryCodes();
          await db.update(table, user.id, {
            mfaEnabled: 1,
            mfaRecoveryCodes: JSON.stringify(recoveryCodes),
          });

          res.json({ message: 'MFA enabled successfully', recoveryCodes });
        } catch (e) { logger.error('mfa verify error', e.message); res.status(500).json({ error: e.message }); }
      });

      // Disable: requires current TOTP code
      app.post(`/api/auth/${slug}/mfa/disable`, requireAuth(entity.name), async (req, res) => {
        try {
          const { code } = req.body || {};
          if (!code) return res.status(400).json({ error: 'code is required' });

          const user = await db.findById(table, req.user.id);
          if (!user) return res.status(404).json({ error: 'User not found' });
          if (!user.mfaEnabled) return res.status(400).json({ error: 'MFA is not enabled' });

          if (!verifyTotp(user.mfaSecret, code)) {
            return res.status(400).json({ error: 'Invalid TOTP code' });
          }

          await db.update(table, user.id, {
            mfaEnabled: 0,
            mfaSecret: null,
            mfaRecoveryCodes: null,
          });

          res.json({ message: 'MFA disabled successfully' });
        } catch (e) { logger.error('mfa disable error', e.message); res.status(500).json({ error: e.message }); }
      });

      // Login-verify: complete MFA login with TOTP or recovery code
      app.post(`/api/auth/${slug}/mfa/login-verify`, async (req, res) => {
        try {
          const { mfaToken, code } = req.body || {};
          if (!mfaToken || !code) return res.status(400).json({ error: 'mfaToken and code are required' });

          let payload;
          try { payload = verifyToken(mfaToken); } catch { return res.status(401).json({ error: 'Invalid or expired MFA token' }); }
          if (!payload.mfaChallenge) return res.status(400).json({ error: 'Invalid MFA token' });

          const user = await db.findById(table, payload.id);
          if (!user) return res.status(404).json({ error: 'User not found' });

          // Try TOTP first
          if (verifyTotp(user.mfaSecret, code)) {
            return res.json({ token: signToken({ id: user.id, entity: entity.name }), user: omitPassword(user) });
          }

          // Try recovery code
          let recoveryCodes = [];
          try { recoveryCodes = JSON.parse(user.mfaRecoveryCodes || '[]'); } catch { /* ignore */ }
          const codeIdx = recoveryCodes.indexOf(code);
          if (codeIdx !== -1) {
            recoveryCodes.splice(codeIdx, 1);
            await db.update(table, user.id, { mfaRecoveryCodes: JSON.stringify(recoveryCodes) });
            return res.json({ token: signToken({ id: user.id, entity: entity.name }), user: omitPassword(user) });
          }

          return res.status(401).json({ error: 'Invalid TOTP code or recovery code' });
        } catch (e) { logger.error('mfa login-verify error', e.message); res.status(500).json({ error: e.message }); }
      });
    }

    // ── Phone / SMS Authentication ──────────────────────────────────────
    if (entity.phoneAuth) {
      // POST /api/auth/:slug/phone/send-code
      app.post(`/api/auth/${slug}/phone/send-code`, async (req, res) => {
        try {
          const { phone } = req.body || {};
          if (!phone) return res.status(400).json({ error: 'phone is required' });

          // Generate 6-digit code
          const code = crypto.randomInt(100000, 999999).toString();
          const expiry = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

          // Find or create user by phone
          let user = (await db.findAllSimple(table, { phoneNumber: phone }))[0];
          if (!user) {
            const placeholder = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), BCRYPT_ROUNDS);
            user = await db.create(table, {
              phoneNumber: phone,
              password: placeholder,
              email: `phone_${phone.replace(/[^0-9]/g, '')}@placeholder.local`,
            });
            _emit(`${entity.name}.created`, omitPassword(user));
          }

          await db.update(table, user.id, { phoneVerificationCode: code, phoneVerificationExpiry: expiry });

          // Send SMS (best-effort — does not block auth flow)
          try {
            const sms = require('./sms');
            await sms.sendSms(phone, `Your verification code is: ${code}`);
          } catch (e) {
            logger.warn(`SMS send failed (${phone}): ${e.message}`);
          }

          // Always return 200 (anti-enumeration)
          res.json({ message: 'Verification code sent' });
        } catch (e) { logger.error('phone send-code error', e.message); res.status(500).json({ error: e.message }); }
      });

      // POST /api/auth/:slug/phone/verify
      app.post(`/api/auth/${slug}/phone/verify`, async (req, res) => {
        try {
          const { phone, code } = req.body || {};
          if (!phone || !code) return res.status(400).json({ error: 'phone and code are required' });

          const user = (await db.findAllSimple(table, { phoneNumber: phone }))[0];
          if (!user || user.phoneVerificationCode !== code) {
            return res.status(400).json({ error: 'Invalid verification code' });
          }
          if (!user.phoneVerificationExpiry || new Date(user.phoneVerificationExpiry) < new Date()) {
            return res.status(400).json({ error: 'Verification code has expired' });
          }

          await db.update(table, user.id, { phoneVerificationCode: null, phoneVerificationExpiry: null });
          const freshUser = await db.findById(table, user.id);
          res.json({ token: signToken({ id: freshUser.id, entity: entity.name }), user: omitPassword(freshUser) });
        } catch (e) { logger.error('phone verify error', e.message); res.status(500).json({ error: e.message }); }
      });
    }

    logger.info(`  Registered auth routes at /api/auth/${slug}/`);
  }
}

function requireAuth(entityName) {
  return async (req, res, next) => {
    const { user, apiKeyPermissions, error } = await resolveAuthHeader(req.headers.authorization);
    if (!user) return res.status(401).json({ error: 'Authorization header required (Bearer <token>)' });
    if (error === 'invalid_token') return res.status(401).json({ error: 'Invalid or expired token' });
    if (user.mfaChallenge) return res.status(401).json({ error: 'MFA verification required' });
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
  const { password: _, emailVerificationToken: _2, passwordResetToken: _3, passwordResetExpiry: _4, magicLinkToken: _5, magicLinkExpiry: _6, mfaSecret: _7, mfaRecoveryCodes: _8, phoneVerificationCode: _9, phoneVerificationExpiry: _10, ...rest } = user;
  return rest;
}

/** Derive the app's base URL for email links. */
function _appUrl() {
  return process.env.APP_URL || process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
}

module.exports = {
  registerAuthRoutes, registerApiKeyRoutes, initApiKeys,
  requireAuth, optionalAuth, resolveAuthHeader,
  signToken, verifyToken, omitPassword, JWT_SECRET, generateSecureToken,
  createApiKey, listApiKeys, listAllApiKeys, deleteApiKey, verifyApiKeyStr,
};
