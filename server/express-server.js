'use strict';

const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const rateLimit = require('express-rate-limit');

const { loadYaml, saveYaml } = require('../core/yaml-loader');
const { validateSchema } = require('../core/schema-validator');
const { buildCore } = require('../core/entity-engine');
const { initDb, findAll, findAllSimple, create: dbCreate } = require('../core/db');
const { registerApiRoutes, createBackendSdk } = require('../core/api-generator');
const { registerAuthRoutes, registerApiKeyRoutes, initApiKeys, verifyToken, omitPassword,
        createApiKey, listAllApiKeys, deleteApiKey } = require('../core/auth');
const { initRealtime, emit } = require('../core/realtime');
const { generateOpenApiSpec } = require('../core/openapi');
const { registerFileRoutes } = require('../core/file-storage');
const { registerUploadRoutes } = require('../core/upload');
const { loadPlugins } = require('../core/plugin-loader');
const { initErrorReporter, getRequestHandler, attachErrorHandler } = require('../core/error-reporter');
const { getTelemetryConfig, initTelemetry } = require('../core/telemetry');
const { setupFunctions, cleanup: cleanupFunctions } = require('../core/functions-engine');
const logger = require('../utils/logger');

function limiter(windowMs, max) {
  return rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests, please try again later.' } });
}

/** Locale cache: maps lang code → parsed JSON object (or null on failure). */
const _localeCache = {};

/**
 * Load and cache a locale file from `locales/<lang>/admin.json`.
 * Falls back to English if the requested language is unavailable.
 * Returns null only when even the English fallback is missing.
 *
 * @param {string} lang  BCP 47 primary language subtag (e.g. "en", "es").
 * @returns {object|null}
 */
function loadLocale(lang) {
  if (!/^[a-z]{2,3}$/.test(lang)) lang = 'en';
  if (_localeCache[lang] !== undefined) return _localeCache[lang];
  const filePath = path.join(__dirname, '..', 'locales', lang, 'admin.json');
  if (fs.existsSync(filePath)) {
    try {
      _localeCache[lang] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return _localeCache[lang];
    } catch { /* fall through */ }
  }
  _localeCache[lang] = null;
  if (lang !== 'en') return loadLocale('en');
  return null;
}

/**
 * Extract the primary language subtag from an Accept-Language header value.
 *
 * @param {string} header  Value of the Accept-Language HTTP header.
 * @returns {string}       Lowercase primary subtag, e.g. "en" or "es".
 */
function parseLang(header) {
  if (!header) return 'en';
  return (header.split(/[,;]/)[0].trim().split('-')[0] || 'en').toLowerCase();
}
const authLimiter  = limiter(15 * 60 * 1000, 30);
const adminRateLimiter = limiter(60 * 1000, 100);

/**
 * Build the API rate limiters from settings.rateLimits (if configured)
 * or fall back to the default single limiter.
 */
function buildApiLimiters(core) {
  const configured = core.settings && core.settings.rateLimits;
  if (configured && configured.length > 0) {
    return configured.map((rl) => limiter(rl.ttl, rl.limit));
  }
  return [limiter(60 * 1000, 200)];
}

/**
 * Build an Express application for the given YAML config.
 *
 * @param {string}        yamlPath  Path to the chadstart.yaml file.
 * @param {Function|null} reloadFn  When provided, the PUT /admin/config route will
 *                                  trigger this callback after saving so the running
 *                                  server picks up the new config without a restart.
 * @returns {{ app: import('express').Application, core: object }}
 */
async function buildApp(yamlPath, reloadFn) {
  const config = loadYaml(yamlPath);
  validateSchema(config);
  const core = buildCore(config);
  logger.info(`Loading "${core.name}"...`);

  // Initialize OpenTelemetry (singleton — no-op on hot reload)
  const telConfig = getTelemetryConfig(core.settings);
  await initTelemetry(telConfig);

  const dbPath = core.database
    ? path.resolve(path.dirname(yamlPath), core.database)
    : undefined;
  initDb(core, dbPath);
  initApiKeys();

  initErrorReporter(core);

  initErrorReporter(core);

  const app = express();
  app.use(express.json());

  // Sentry request handler must be the first middleware (captures req info)
  const sentryRequestHandler = getRequestHandler();
  if (sentryRequestHandler) app.use(sentryRequestHandler);

  // Public static files
  if (core.public && core.public.folder) {
    const publicDir = path.resolve(core.public.folder);
    const cwd = process.cwd();
    if (!publicDir.startsWith(cwd + path.sep) && publicDir !== cwd) {
      throw new Error(`public.folder "${core.public.folder}" resolves outside the working directory.`);
    }
    logger.info(`Serving public files from: ${publicDir}`);
    fs.mkdirSync(publicDir, { recursive: true });
    app.use(express.static(publicDir));
  }

  registerFileRoutes(app, core);
  registerUploadRoutes(app, core);

  app.use('/api/auth', authLimiter);
  registerAuthRoutes(app, core, emit);
  registerApiKeyRoutes(app, core);

  const apiLimiters = buildApiLimiters(core);
  app.use('/api', ...apiLimiters);
  registerApiRoutes(app, core, emit);

  // Stop any previous cron tasks / worker processes before registering new ones
  cleanupFunctions();
  const manifestSdk = createBackendSdk(core);
  setupFunctions(app, core.functions, manifestSdk);

  const openApiSpec = generateOpenApiSpec(core);
  const showApiDocs = process.env.OPEN_API_DOCS !== undefined
    ? process.env.OPEN_API_DOCS === 'true'
    : process.env.NODE_ENV !== 'production';
  if (showApiDocs) {
    app.get('/openapi.json', (_req, res) => res.json(openApiSpec));
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
  }

  // Admin UI — serve the SPA, vendor assets, and API endpoints
  const adminHtml = path.join(__dirname, '..', 'admin', 'index.html');
  const nodeModulesDir = path.join(__dirname, '..', 'node_modules');
  // Vendor assets served from node_modules (HTMX, Animate.css, Tailwind browser, cronstrue)
  app.get('/admin/vendor/htmx.min.js', adminRateLimiter, (_req, res) => {
    res.sendFile(path.join(nodeModulesDir, 'htmx.org', 'dist', 'htmx.min.js'));
  });
  app.get('/admin/vendor/animate.min.css', adminRateLimiter, (_req, res) => {
    res.sendFile(path.join(nodeModulesDir, 'animate.css', 'animate.min.css'));
  });
  app.get('/admin/vendor/tailwind.js', adminRateLimiter, (_req, res) => {
    res.sendFile(path.join(nodeModulesDir, '@tailwindcss', 'browser', 'dist', 'index.global.js'));
  });
  app.get('/admin/vendor/cronstrue.min.js', adminRateLimiter, (_req, res) => {
    res.sendFile(path.join(nodeModulesDir, 'cronstrue', 'dist', 'cronstrue.min.js'));
  });
  app.get('/admin', adminRateLimiter, (_req, res) => {
    if (fs.existsSync(adminHtml)) {
      res.sendFile(adminHtml);
    } else {
      res.status(404).send('Admin UI not found');
    }
  });
  // Serve locale translation files for the Admin UI i18n
  app.get('/admin/i18n/:lang', adminRateLimiter, (req, res) => {
    // Normalize the route param (simple language code, e.g. "en") to a safe subtag
    const lang = parseLang(req.params.lang);
    const locale = loadLocale(lang);
    if (locale) return res.json(locale);
    res.status(404).json({ error: 'Locale not found' });
  });
  app.get('/admin/schema', (_req, res) => {
    const allEntities = Object.values(core.entities).map((e) => ({
      name: e.name, tableName: e.tableName, slug: e.slug,
      properties: e.properties, belongsTo: e.belongsTo, belongsToMany: e.belongsToMany,
      authenticable: e.authenticable, single: e.single, policies: e.policies,
    }));
    res.json({
      name: core.name,
      entities: allEntities,
      userCollections: allEntities.filter((e) => e.authenticable),
    });
  });

  // ── Admin config endpoints ────────────────────────────────────────────
  // GET /admin/config — return the current YAML config as JSON (auth required)
  app.get('/admin/config', adminRateLimiter, (req, res) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try { verifyToken(header.slice(7)); } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
    try {
      res.json(loadYaml(yamlPath));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // PUT /admin/config — receive JSON config, validate, save as YAML, then hot-reload
  app.put('/admin/config', adminRateLimiter, (req, res) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try { verifyToken(header.slice(7)); } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
    const newConfig = req.body;
    if (!newConfig || typeof newConfig !== 'object' || Array.isArray(newConfig)) {
      return res.status(400).json({ error: 'Invalid config: expected a JSON object' });
    }
    try {
      validateSchema(newConfig);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    try {
      saveYaml(yamlPath, newConfig);
      if (reloadFn) {
        // Schedule hot reload after the response has been fully flushed
        res.on('finish', () => {
          reloadFn().catch((e) => logger.error('Hot reload failed after config save:', e.message));
        });
        res.json({ success: true, reloading: true, message: 'Config saved. Reloading server…' });
      } else {
        res.json({ success: true, message: 'Config saved. Restart the server to apply changes.' });
      }
    } catch (e) {
      logger.error('Failed to save config:', e.message);
      res.status(500).json({ error: 'Failed to save config' });
    }
  });

  // ── Admin AI assistant endpoints ──────────────────────────────────────
  // GET /admin/ai/status — tell the UI whether AI chat is available
  app.get('/admin/ai/status', adminRateLimiter, (_req, res) => {
    res.json({ configured: isAiConfigured() || process.env.NODE_ENV !== 'production' });
  });

  // POST /admin/ai/chat — proxy messages to the configured AI provider (auth required)
  app.post('/admin/ai/chat', adminRateLimiter, async (req, res) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try { verifyToken(header.slice(7)); } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const { messages } = req.body || {};
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array required' });
    }

    const provider = getAiProvider();
    if (!provider) {
      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({ error: 'AI assistant is not configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, or OPENROUTER_API_KEY.' });
      }
      // Dev/test mode without API key — return a helpful placeholder
      return res.json({ message: 'AI assistant is not configured. Add an API key via environment variables: OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY (Gemini), or OPENROUTER_API_KEY.' });
    }

    try {
      const message = await callAiProvider(provider, messages);
      res.json({ message });
    } catch (e) {
      logger.error('AI chat error:', e.message);
      res.status(502).json({ error: e.message });
    }
  });

  // HTMX table partial – returns an HTML fragment used by the Admin UI
  app.get('/admin/partials/table', adminRateLimiter, (req, res) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).send('<p class="text-red-400 p-4">Unauthorized</p>');
    }
    try { verifyToken(header.slice(7)); } catch {
      return res.status(401).send('<p class="text-red-400 p-4">Invalid token</p>');
    }
    const { type, name } = req.query;
    if (!type || !name) return res.status(400).send('<p class="text-red-400 p-4">Missing type or name</p>');
    const item = type === 'entity'
      ? Object.values(core.entities).find((e) => e.name === name)
      : Object.values(core.authenticableEntities).find((uc) => uc.name === name);
    if (!item) return res.status(404).send('<p class="text-red-400 p-4">Not found</p>');
    const lang = parseLang(req.headers['accept-language']);
    const locale = loadLocale(lang);
    try {
      let rows = findAllSimple(item.tableName);
      if (type === 'collection') rows = rows.map(omitPassword);
      res.send(renderAdminTable(rows, name, type === 'collection', item.name, locale));
    } catch (err) {
      res.status(500).send(`<p class="text-red-400 p-4">Error: ${escAdminHtml(err.message)}</p>`);
    }
  });
  // ── Admin stats endpoint ────────────────────────────────────────────
  app.get('/admin/stats', adminRateLimiter, (req, res) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    try { verifyToken(header.slice(7)); } catch { return res.status(401).json({ error: 'Invalid token' }); }
    try {
      const now = new Date();
      const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
      const oneMonthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
      const allEntities = Object.values(core.entities);
      const entityStats = [];
      const allRecords = [];
      for (const entity of allEntities) {
        try {
          const rows = findAllSimple(entity.tableName);
          const total = rows.length;
          const lastWeek = rows.filter((r) => r.createdAt && new Date(r.createdAt) >= oneWeekAgo).length;
          const lastMonth = rows.filter((r) => r.createdAt && new Date(r.createdAt) >= oneMonthAgo).length;
          entityStats.push({ name: entity.name, tableName: entity.tableName, total, lastWeek, lastMonth });
          const sorted = rows
            .filter((r) => r.createdAt)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 5);
          for (const r of sorted) {
            allRecords.push({
              entityName: entity.name,
              id: r.id,
              action: 'created',
              createdAt: r.createdAt,
              label: r.name || r.title || r.email || `${entity.name} #${r.id ? String(r.id).slice(0, 8) : '?'}`,
            });
          }
        } catch { /* skip table errors */ }
      }
      const recentActivity = allRecords
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 20);
      res.json({ entities: entityStats, recentActivity });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin seed endpoint ─────────────────────────────────────────────
  app.post('/admin/seed', adminRateLimiter, (req, res) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    try { verifyToken(header.slice(7)); } catch { return res.status(401).json({ error: 'Invalid token' }); }
    const { entities: toSeed = [] } = req.body || {};
    const results = [];
    for (const { name, tableName, count = 10 } of toSeed) {
      const entityDef = Object.values(core.entities).find((e) => e.name === name);
      if (!entityDef || !tableName) continue;
      let created = 0;
      for (let i = 1; i <= Math.min(count, 500); i++) {
        const record = {};
        for (const prop of (entityDef.properties || [])) {
          const pName = typeof prop === 'string' ? prop : prop.name;
          const pType = typeof prop === 'string' ? 'string' : (prop.type || 'string');
          if (!pName || pName === 'password') continue;
          switch (pType) {
            case 'email': record[pName] = `user${Date.now()}_${i}@example.com`; break;
            case 'integer': case 'number': case 'float': case 'money':
              record[pName] = Math.floor(Math.random() * 1000); break;
            case 'boolean': record[pName] = Math.random() > 0.5 ? 1 : 0; break;
            case 'date': case 'timestamp': record[pName] = new Date().toISOString(); break;
            default: record[pName] = `Sample ${pName} ${i}`;
          }
        }
        try { const row = dbCreate(tableName, record); emit(`${name}.created`, row); created++; } catch (e) { logger.warn(`Seed: failed to create record for ${name}:`, e.message); }
      }
      results.push({ name, created });
    }
    res.json({ success: true, results });
  });

  // ── Admin data endpoint (unified, auth-bypassing) ───────────────────
  app.get('/admin/data', adminRateLimiter, (req, res) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    try { verifyToken(header.slice(7)); } catch { return res.status(401).json({ error: 'Invalid token' }); }
    const { type, name, page = 1, perPage = 20, orderBy = 'createdAt', order = 'DESC', search, ...filters } = req.query;
    if (!type || !name) return res.status(400).json({ error: 'Missing type or name' });
    const item = type === 'collection'
      ? (Object.values(core.authenticableEntities || {}).find((e) => e.name === name) || Object.values(core.entities).find((e) => e.name === name))
      : Object.values(core.entities).find((e) => e.name === name);
    if (!item) return res.status(404).json({ error: 'Not found' });
    try {
      const query = { ...filters };
      if (search) {
        const textCols = (item.properties || []).filter((p) => {
          const t = typeof p === 'string' ? 'string' : (p.type || 'string');
          return ['string', 'text', 'richText', 'email'].includes(t);
        });
        if (textCols.length) {
          const colName = typeof textCols[0] === 'string' ? textCols[0] : textCols[0].name;
          query[`${colName}_like`] = `%${search}%`;
        }
      }
      const result = findAll(item.tableName, query, { page, perPage, orderBy, order });
      if (type === 'collection') result.data = result.data.map(omitPassword);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  logger.info('  Admin UI available at /admin');

  // ── Admin API key management ─────────────────────────────────────────────
  function requireAdminToken(req, res) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) { res.status(401).json({ error: 'Unauthorized' }); return false; }
    try { verifyToken(header.slice(7)); return true; } catch { res.status(401).json({ error: 'Invalid token' }); return false; }
  }

  // GET /admin/api-keys — list all API keys
  app.get('/admin/api-keys', adminRateLimiter, (req, res) => {
    if (!requireAdminToken(req, res)) return;
    try { res.json(listAllApiKeys()); } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /admin/api-keys — create an API key for any user
  app.post('/admin/api-keys', adminRateLimiter, (req, res) => {
    if (!requireAdminToken(req, res)) return;
    const { userId, userEntity, name, permissions, entities: keyEntities, expiresAt } = req.body || {};
    if (!userId || !userEntity) return res.status(400).json({ error: 'userId and userEntity are required' });
    try {
      const result = createApiKey(userId, userEntity, {
        name: name || 'API Key',
        permissions: Array.isArray(permissions) ? permissions : [],
        entities: Array.isArray(keyEntities) ? keyEntities : [],
        expiresAt: expiresAt || null,
      });
      res.status(201).json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /admin/api-keys/:id — delete any API key
  app.delete('/admin/api-keys/:id', adminRateLimiter, (req, res) => {
    if (!requireAdminToken(req, res)) return;
    try { deleteApiKey(req.params.id); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /admin/impersonate — generate a short-lived token as a user (for admin preview)
  app.post('/admin/impersonate', adminRateLimiter, (req, res) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    let adminPayload;
    try { adminPayload = verifyToken(header.slice(7)); } catch { return res.status(401).json({ error: 'Invalid token' }); }
    const { userId, userEntity } = req.body || {};
    if (!userId || !userEntity) return res.status(400).json({ error: 'userId and userEntity are required' });
    const entity = Object.values(core.authenticableEntities || {}).find((e) => e.name === userEntity);
    if (!entity) return res.status(404).json({ error: 'User collection not found' });
    const { findById } = require('../core/db');
    const user = findById(entity.tableName, userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { signToken } = require('../core/auth');
    const token = signToken(
      { id: userId, entity: userEntity, impersonated: true, impersonatedBy: adminPayload.id },
      '1h'
    );
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
    res.json({ token, expiresAt, userId, userEntity, user: omitPassword(user) });
  });

  await loadPlugins(app, core);

  app.get('/health', (_req, res) => res.json({ status: 'ok', name: core.name }));

  // Sentry error handler must be after all routes/middleware but before any
  // other error handlers so it can capture unhandled errors.
  attachErrorHandler(app);

  return { app, core };
}

async function createServer(yamlPath) {
  const { app, core } = await buildApp(yamlPath, null);
  const server = http.createServer(app);
  initRealtime(server);
  return { app, server, core };
}

async function startServer(yamlPath) {
  // ── Dispatcher pattern ───────────────────────────────────────────────
  // The HTTP server and WebSocket server are created once and never replaced.
  // Hot reload works by rebuilding the Express app and swapping the handler
  // reference that the dispatcher forwards every request to.
  let currentApp = null;
  const dispatcher = (req, res) => currentApp(req, res);

  const server = http.createServer(dispatcher);
  initRealtime(server);

  async function reload() {
    logger.info('Reloading config…');
    const result = await buildApp(yamlPath, reload);
    currentApp = result.app;
    logger.info(`Config loaded: "${result.core.name}"`);
    return result;
  }

  const { core } = await reload();

  server.listen(core.port, () => {
    logger.info(`\n🚀 ${core.name} is running at http://localhost:${core.port}`);
    logger.info(`   API docs:  http://localhost:${core.port}/docs`);
    logger.info(`   Admin UI:  http://localhost:${core.port}/admin`);
    logger.info(`   Health:    http://localhost:${core.port}/health\n`);
  });
  return { server, core };
}

module.exports = { createServer, startServer, buildApiLimiters, buildApp, getAiProvider, isAiConfigured };

// ─── Admin UI helpers ─────────────────────────────────────────────────────────

function escAdminHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Render an HTML table fragment for the Admin UI HTMX partial.
 * Uses Tailwind utility classes that the Play CDN will process client-side.
 *
 * @param {Array}       rows              Record rows from the database.
 * @param {string}      name              Entity/collection display name.
 * @param {boolean}     isUserCollection  True when the table is for an authenticable entity.
 * @param {string}      entityName        Entity name used for impersonation (when isUserCollection).
 * @param {object|null} locale            Parsed locale JSON (locales/{lang}/admin.json), or null.
 */
function renderAdminTable(rows, name, isUserCollection, entityName, locale) {
  const esc = escAdminHtml;
  const tbl = (locale && locale.table) || {};
  const tr = (key, fallback) => tbl[key] || fallback;
  if (!rows.length) {
    return `<div class="flex flex-col items-center justify-center py-20 text-center">
      <div class="text-4xl mb-3" aria-hidden="true">&#128237;</div>
      <p class="text-sm" style="color:#888;">${esc(tr('no_records', 'No records yet. Click + New record to create one.'))}</p>
    </div>`;
  }
  const cols = Object.keys(rows[0]);
  const ths = cols.map((c) =>
    `<th class="px-4 py-2.5 text-left text-xs font-medium whitespace-nowrap" style="color:#888;">${esc(c)}</th>`
  ).join('') + `<th class="px-4 py-2.5 text-left text-xs font-medium" style="color:#888;">${esc(tr('actions', 'Actions'))}</th>`;

  const trs = rows.map((row) => {
    const tds = cols.map((c) =>
      `<td class="px-4 py-2.5 max-w-xs truncate text-sm" style="color:#e1e1e1;" title="${esc(String(row[c] ?? ''))}">${esc(String(row[c] ?? ''))}</td>`
    ).join('');
    const safeJson = JSON.stringify(row)
      .replace(/&/g, '\\u0026').replace(/'/g, '\\u0027').replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
    const safeId = esc(String(row.id ?? ''));
    const safeEntity = esc(String(entityName || ''));
    const impersonateBtn = isUserCollection
      ? `<button class="text-xs border rounded px-2 py-1 hover:opacity-80" style="border-color:rgba(187,134,252,0.4);color:#bb86fc;background:transparent;transition:opacity 150ms ease;"
          onclick="impersonateUser('${safeId}','${safeEntity}')">Impersonate</button>`
      : '';
    const actions = `<td class="px-4 py-2.5"><div class="flex gap-2">
      <button class="text-xs border rounded px-2 py-1 hover:opacity-80" style="border-color:#2a2a2a;color:#e1e1e1;background:transparent;transition:opacity 150ms ease;"
        onclick='openEditModal(${safeJson})'>${esc(tr('edit', 'Edit'))}</button>
      <button class="text-xs border rounded px-2 py-1 hover:opacity-80" style="border-color:rgba(239,68,68,0.4);color:#f87171;background:transparent;transition:opacity 150ms ease;"
        onclick="deleteRecord('${safeId}')">${esc(tr('delete', 'Delete'))}</button>
      ${impersonateBtn}
    </div></td>`;
    return `<tr class="border-b" style="border-color:#2a2a2a;">${tds}${actions}</tr>`;
  }).join('');

  return `<div class="overflow-x-auto border rounded" style="border-color:#2a2a2a;">
    <table class="w-full text-sm" style="color:#e1e1e1;">
      <thead style="background:#1e1e1e;"><tr class="border-b" style="border-color:#2a2a2a;">${ths}</tr></thead>
      <tbody>${trs}</tbody>
    </table>
  </div>`;
}

// ─── AI provider helpers ──────────────────────────────────────────────────────

/**
 * Returns the first configured AI provider, or null if none is set.
 * Priority: openai → anthropic → google → openrouter
 */
function getAiProvider() {
  if (process.env.OPENAI_API_KEY)    return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) return 'google';
  if (process.env.OPENROUTER_API_KEY) return 'openrouter';
  return null;
}

function isAiConfigured() {
  return getAiProvider() !== null;
}

/**
 * Minimal HTTPS POST helper (avoids adding dependencies for AI provider calls).
 */
function httpsPost(url, extraHeaders, body) {
  return new Promise((resolve, reject) => {
    const urlObj  = new URL(url);
    const data    = JSON.stringify(body);
    const options = {
      hostname: urlObj.hostname,
      port:     urlObj.port || 443,
      path:     urlObj.pathname + urlObj.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...extraHeaders,
      },
    };
    const req = https.request(options, (r) => {
      let raw = '';
      r.on('data', (c) => { raw += c; });
      r.on('end', () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(raw) }); }
        // Non-JSON responses (e.g. HTML error pages) are returned as raw strings
        catch { resolve({ status: r.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const AI_SYSTEM_PROMPT =
  'You are a helpful AI assistant embedded in the ChadStart Admin UI. ' +
  'ChadStart is a YAML-first Backend as a Service that lets developers define ' +
  'their entire backend (entities, auth, API routes, file storage) in a single ' +
  'YAML file. Help admin users manage their data, understand the API, configure ' +
  'entities and endpoints, and troubleshoot issues. Be concise and practical.';

/**
 * Send a messages array to the configured AI provider and return the reply text.
 * @param {'openai'|'anthropic'|'google'|'openrouter'} provider
 * @param {{ role: string, content: string }[]} messages
 * @returns {Promise<string>}
 */
/**
 * Extract a human-readable error message from an AI provider API response body.
 * @param {{ error?: { message?: string } } | string} body
 * @param {number} status
 * @returns {string}
 */
function getApiErrorMessage(body, status) {
  return (body && typeof body === 'object' && body.error && body.error.message) || `AI API error (${status})`;
}

async function callAiProvider(provider, messages) {
  if (provider === 'openai' || provider === 'openrouter') {
    const apiKey = provider === 'openai'
      ? process.env.OPENAI_API_KEY
      : process.env.OPENROUTER_API_KEY;
    const baseUrl = provider === 'openai'
      ? 'https://api.openai.com'
      : 'https://openrouter.ai';
    const model = provider === 'openai' ? 'gpt-4o-mini' : 'openai/gpt-4o-mini';

    const result = await httpsPost(
      `${baseUrl}/v1/chat/completions`,
      { Authorization: `Bearer ${apiKey}` },
      { model, messages: [{ role: 'system', content: AI_SYSTEM_PROMPT }, ...messages], max_tokens: 1024 }
    );
    if (result.status !== 200) {
      throw new Error(getApiErrorMessage(result.body, result.status));
    }
    return result.body.choices[0].message.content;
  }

  if (provider === 'anthropic') {
    const result = await httpsPost(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      { model: 'claude-3-haiku-20240307', system: AI_SYSTEM_PROMPT, messages, max_tokens: 1024 }
    );
    if (result.status !== 200) {
      throw new Error(getApiErrorMessage(result.body, result.status));
    }
    return result.body.content[0].text;
  }

  if (provider === 'google') {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    // Convert OpenAI-style messages to Google Gemini format
    const googleContents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const result = await httpsPost(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {},
      {
        system_instruction: { parts: [{ text: AI_SYSTEM_PROMPT }] },
        contents: googleContents,
        generationConfig: { maxOutputTokens: 1024 },
      }
    );
    if (result.status !== 200) {
      throw new Error(getApiErrorMessage(result.body, result.status));
    }
    return result.body.candidates[0].content.parts[0].text;
  }

  throw new Error('Unsupported AI provider: ' + provider);
}
