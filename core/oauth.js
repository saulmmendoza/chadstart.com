'use strict';

/**
 * OAuth / Social Login via the "grant" library.
 *
 * When the YAML config contains an `oauth` section, this module:
 *   1. Mounts the Grant middleware at /connect (handles the redirect dance).
 *   2. Registers a callback route at /api/auth/oauth/callback that
 *      finds-or-creates the user and returns a JWT.
 *
 * Secrets (client IDs, client secrets) must be supplied via environment
 * variables — never place them in the YAML file.
 */

const crypto = require('crypto');
const Grant = require('grant').express();
const rateLimit = require('express-rate-limit');
const { signToken } = require('./auth');
const db = require('./db');
const logger = require('../utils/logger');

const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many OAuth requests, please try again later.' },
});

// ─── Provider profile normalisation ─────────────────────────────────────────

/**
 * Normalise the profile returned by Grant into { email, name, providerId }.
 * Different providers return profile data in different shapes.
 *
 * @param {string} provider  Lowercase provider key (e.g. "google").
 * @param {object} profile   Raw profile object from the OAuth provider.
 * @returns {{ email: string|null, name: string|null, providerId: string|null }}
 */
function normalizeProfile(provider, profile) {
  if (!profile) return { email: null, name: null, providerId: null };

  const email =
    profile.email ||
    profile.mail ||
    (profile.emails && profile.emails[0] && (profile.emails[0].value || profile.emails[0])) ||
    null;
  const name =
    profile.name ||
    profile.displayName ||
    profile.login ||
    profile.username ||
    (profile.first_name ? `${profile.first_name} ${profile.last_name || ''}`.trim() : null) ||
    null;
  const providerId =
    String(profile.sub || profile.id || profile.user_id || profile.account_id || '');

  return { email: email || null, name: name || null, providerId: providerId || null };
}

// ─── Grant config builder ───────────────────────────────────────────────────

/**
 * Build the Grant configuration object from the parsed YAML `oauth` section.
 *
 * Environment variable overrides (per-provider):
 *   OAUTH_<PROVIDER>_KEY      – client/app ID
 *   OAUTH_<PROVIDER>_SECRET   – client/app secret
 *
 * @param {object} oauthConfig  The `oauth` block from the YAML config.
 * @param {string} baseUrl      The application base URL (e.g. http://localhost:3000).
 * @returns {object}            Configuration object accepted by Grant.
 */
function buildGrantConfig(oauthConfig, baseUrl) {
  const defaults = oauthConfig.defaults || {};
  const origin = baseUrl.replace(/\/$/, '');

  const grantConfig = {
    defaults: {
      origin,
      transport: 'querystring',
      prefix: '/connect',
      ...defaults,
    },
  };

  const providers = oauthConfig.providers || {};
  for (const [name, cfg] of Object.entries(providers)) {
    const envPrefix = `OAUTH_${name.toUpperCase()}_`;
    const key = process.env[`${envPrefix}KEY`] || cfg.key || '';
    const secret = process.env[`${envPrefix}SECRET`] || cfg.secret || '';

    grantConfig[name] = {
      ...cfg,
      key,
      secret,
      // callback is where Grant redirects after the OAuth dance;
      // we point it at our own API endpoint which issues a JWT.
      callback: cfg.callback || `/api/auth/oauth/callback`,
    };
  }

  return grantConfig;
}

// ─── Route registration ─────────────────────────────────────────────────────

/**
 * Mount the Grant middleware and register the OAuth callback route.
 *
 * @param {import('express').Application} app
 * @param {object} core     Parsed core configuration.
 * @param {Function} emit   EventBus emit function.
 */
function registerOAuthRoutes(app, core, emit) {
  const oauthConfig = core.oauth;
  if (!oauthConfig || !oauthConfig.providers || Object.keys(oauthConfig.providers).length === 0) {
    return; // OAuth not configured — skip
  }

  const baseUrl = (
    process.env.BASE_URL ||
    `http://localhost:${core.port}`
  ).replace(/\/$/, '');

  const grantConfig = buildGrantConfig(oauthConfig, baseUrl);

  // Mount grant middleware — handles /connect/:provider and /connect/:provider/callback
  app.use(Grant(grantConfig));
  logger.info('  Mounted OAuth middleware at /connect');

  // Determine the target authenticable entity for OAuth users.
  // The `oauth.entity` field specifies which entity to use (default: first authenticable entity).
  const targetEntityName = oauthConfig.entity || null;
  const entity =
    (targetEntityName && core.authenticableEntities[targetEntityName]) ||
    Object.values(core.authenticableEntities)[0];

  if (!entity) {
    logger.warn('  OAuth: no authenticable entity found — OAuth callback will not work.');
    return;
  }

  const _emit = typeof emit === 'function' ? emit : () => {};

  /**
   * GET /api/auth/oauth/callback
   *
   * Grant redirects here with query-string parameters after the OAuth dance.
   * We extract the access_token / profile, find-or-create the user, and
   * return a JWT (or redirect if `oauth.successRedirect` is set).
   */
  app.get('/api/auth/oauth/callback', oauthLimiter, async (req, res) => {
    try {
      const { access_token, profile, provider, error } = req.query;

      if (error) {
        return _handleError(res, oauthConfig, `OAuth error: ${error}`);
      }

      if (!access_token && !profile) {
        return _handleError(res, oauthConfig, 'OAuth callback missing token and profile');
      }

      // Grant may pass the profile as a JSON string in the querystring
      let parsedProfile = {};
      if (profile) {
        try { parsedProfile = typeof profile === 'string' ? JSON.parse(profile) : profile; } catch { /* ignore */ }
      }

      const providerName = (provider || 'unknown').toLowerCase();
      const { email, name, providerId } = normalizeProfile(providerName, parsedProfile);

      if (!email && !providerId) {
        return _handleError(res, oauthConfig, 'Could not obtain email or provider ID from OAuth profile');
      }

      // Find or create the user
      const user = await _findOrCreateOAuthUser(entity, {
        email,
        name,
        provider: providerName,
        providerId,
        accessToken: access_token || null,
      });

      _emit(`${entity.name}.oauthLogin`, { provider: providerName, userId: user.id });

      const token = signToken({ id: user.id, entity: entity.name });

      // Redirect or return JSON based on config
      const successRedirect = oauthConfig.successRedirect;
      if (successRedirect) {
        const sep = successRedirect.includes('?') ? '&' : '?';
        return res.redirect(`${successRedirect}${sep}token=${encodeURIComponent(token)}`);
      }

      res.json({ token, user: _omitSensitive(user) });
    } catch (e) {
      logger.error('OAuth callback error:', e.message);
      return _handleError(res, oauthConfig, e.message);
    }
  });

  // List configured providers
  app.get('/api/auth/oauth/providers', oauthLimiter, (_req, res) => {
    const providers = Object.keys(oauthConfig.providers || {});
    res.json({ providers });
  });

  const providerNames = Object.keys(oauthConfig.providers);
  logger.info(`  OAuth providers: ${providerNames.join(', ')}`);
  logger.info(`  OAuth callback:  /api/auth/oauth/callback`);
  logger.info(`  OAuth entity:    ${entity.name}`);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Find an existing user by email or create a new one.
 */
async function _findOrCreateOAuthUser(entity, { email, name, provider, providerId, accessToken }) {
  const table = entity.tableName;

  // 1. Try to find by email
  if (email) {
    const existing = await db.findAllSimple(table, { email });
    if (existing.length > 0) return existing[0];
  }

  // 2. Create a new user with a random password (they authenticate via OAuth)
  const newUser = {
    email: email || `${provider}_${providerId}@oauth.local`,
    password: crypto.randomBytes(32).toString('hex'), // random placeholder
  };

  // Add optional fields if the entity supports them
  const propNames = new Set(entity.properties.map((p) => p.name));
  if (name && propNames.has('name')) newUser.name = name;

  const bcrypt = require('bcryptjs');
  newUser.password = await bcrypt.hash(newUser.password, 10);

  const created = await db.create(table, newUser);
  return created;
}

function _omitSensitive(user) {
  if (!user) return null;
  const { password: _, ...rest } = user;
  return rest;
}

function _handleError(res, oauthConfig, message) {
  const errorRedirect = oauthConfig.errorRedirect;
  if (errorRedirect) {
    const sep = errorRedirect.includes('?') ? '&' : '?';
    return res.redirect(`${errorRedirect}${sep}error=${encodeURIComponent(message)}`);
  }
  return res.status(400).json({ error: message });
}

module.exports = { registerOAuthRoutes, buildGrantConfig, normalizeProfile };
