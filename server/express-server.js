'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const rateLimit = require('express-rate-limit');

const { loadYaml, saveYaml } = require('../core/yaml-loader');
const { validateSchema } = require('../core/schema-validator');
const { buildCore } = require('../core/entity-engine');
const { initDb, findAll, findAllSimple } = require('../core/db');
const { registerApiRoutes, createBackendSdk } = require('../core/api-generator');
const { registerAuthRoutes, verifyToken, omitPassword } = require('../core/auth');
const { initRealtime, emit } = require('../core/realtime');
const { generateOpenApiSpec } = require('../core/openapi');
const { registerFileRoutes } = require('../core/file-storage');
const { registerUploadRoutes } = require('../core/upload');
const { loadPlugins } = require('../core/plugin-loader');
const { initErrorReporter, getRequestHandler, attachErrorHandler } = require('../core/error-reporter');
const { getTelemetryConfig, initTelemetry } = require('../core/telemetry');
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
  registerAuthRoutes(app, core);

  const apiLimiters = buildApiLimiters(core);
  app.use('/api', ...apiLimiters);
  registerApiRoutes(app, core, emit);

  await registerCustomEndpoints(app, core);

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
  // Vendor assets served from node_modules (HTMX, Animate.css, Tailwind browser)
  app.get('/admin/vendor/htmx.min.js', adminRateLimiter, (_req, res) => {
    res.sendFile(path.join(nodeModulesDir, 'htmx.org', 'dist', 'htmx.min.js'));
  });
  app.get('/admin/vendor/animate.min.css', adminRateLimiter, (_req, res) => {
    res.sendFile(path.join(nodeModulesDir, 'animate.css', 'animate.min.css'));
  });
  app.get('/admin/vendor/tailwind.js', adminRateLimiter, (_req, res) => {
    res.sendFile(path.join(nodeModulesDir, '@tailwindcss', 'browser', 'dist', 'index.global.js'));
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
    res.json({
      name: core.name,
      entities: Object.values(core.entities).map((e) => ({
        name: e.name, tableName: e.tableName, slug: e.slug,
        properties: e.properties, belongsTo: e.belongsTo, belongsToMany: e.belongsToMany,
        authenticable: e.authenticable, single: e.single, policies: e.policies,
      })),
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
      res.send(renderAdminTable(rows, name, locale));
    } catch (err) {
      res.status(500).send(`<p class="text-red-400 p-4">Error: ${escAdminHtml(err.message)}</p>`);
    }
  });
  logger.info('  Admin UI available at /admin');

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

async function registerCustomEndpoints(app, core) {
  const { requireAuth, optionalAuth } = require('../core/auth');

  // Create a simple backend "SDK" object for handlers (mimics the JS SDK interface)
  const manifestSdk = createBackendSdk(core);

  for (const [name, ep] of Object.entries(core.endpoints || {})) {
    const epPath = `/endpoints${ep.path}`;
    const method = ep.method.toLowerCase();
    const handlerFile = path.resolve(process.env.CHADSTART_HANDLERS_FOLDER || process.env.MANIFEST_HANDLERS_FOLDER || 'handlers', `${ep.handler}.js`);

    // Build middleware chain from endpoint policies (default: public)
    const middlewares = buildEndpointPolicyMiddleware(ep);

    if (fs.existsSync(handlerFile)) {
      const handler = require(handlerFile);
      app[method](epPath, ...middlewares, (req, res) => handler(req, res, manifestSdk));
      logger.info(`  Registered endpoint: ${ep.method} ${epPath}`);
    } else {
      logger.warn(`  Handler not found for "${name}": ${handlerFile}`);
    }
  }
}

function buildEndpointPolicyMiddleware(ep) {
  const { requireAuth, optionalAuth, JWT_SECRET } = require('../core/auth');
  const jwt = require('jsonwebtoken');

  const policies = ep.policies;
  if (!policies || !policies.length) {
    // Custom endpoints are public by default (per docs)
    return [optionalAuth, (_req, _res, next) => next()];
  }

  const p = policies[0];
  const access = p.access;
  switch (access) {
    case 'public':
      return [optionalAuth, (_req, _res, next) => next()];
    case 'restricted': {
      if (!p.allow) return [requireAuth()];
      const allowed = Array.isArray(p.allow) ? p.allow : [p.allow];
      return [(req, res, next) => {
        const header = req.headers.authorization;
        if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Authorization required' });
        try {
          req.user = jwt.verify(header.slice(7), JWT_SECRET);
          if (!allowed.includes(req.user.entity)) return res.status(403).json({ error: 'Access denied' });
          next();
        } catch { return res.status(401).json({ error: 'Invalid or expired token' }); }
      }];
    }
    case 'admin':
      return [requireAuth()];
    case 'forbidden':
      return [(_req, res) => res.status(403).json({ error: 'Access forbidden' })];
    default:
      return [(_req, _res, next) => next()];
  }
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

module.exports = { createServer, startServer, buildApiLimiters, buildApp };

// ─── Admin UI helpers ─────────────────────────────────────────────────────────

function escAdminHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Render an HTML table fragment for the Admin UI HTMX partial.
 * Uses Tailwind utility classes that the Play CDN will process client-side.
 *
 * @param {Array}       rows    Record rows from the database.
 * @param {string}      name    Entity/collection display name.
 * @param {object|null} locale  Parsed locale JSON (locales/{lang}/admin.json), or null.
 */
function renderAdminTable(rows, name, locale) {
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
    const actions = `<td class="px-4 py-2.5"><div class="flex gap-2">
      <button class="text-xs border rounded px-2 py-1 hover:opacity-80" style="border-color:#2a2a2a;color:#e1e1e1;background:transparent;transition:opacity 150ms ease;"
        onclick='openEditModal(${safeJson})'>${esc(tr('edit', 'Edit'))}</button>
      <button class="text-xs border rounded px-2 py-1 hover:opacity-80" style="border-color:rgba(239,68,68,0.4);color:#f87171;background:transparent;transition:opacity 150ms ease;"
        onclick="deleteRecord(${row.id})">${esc(tr('delete', 'Delete'))}</button>
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
