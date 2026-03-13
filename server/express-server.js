'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const rateLimit = require('express-rate-limit');

const { loadYaml } = require('../core/yaml-loader');
const { validateSchema } = require('../core/schema-validator');
const { buildCore } = require('../core/entity-engine');
const { initDb, findAll } = require('../core/db');
const { registerApiRoutes } = require('../core/api-generator');
const { registerAuthRoutes, verifyToken, omitPassword } = require('../core/auth');
const { initRealtime, emit } = require('../core/realtime');
const { generateOpenApiSpec } = require('../core/openapi');
const { registerFileRoutes } = require('../core/file-storage');
const { loadPlugins } = require('../core/plugin-loader');
const logger = require('../utils/logger');

// Rate limiters
// Strict limit for auth endpoints (login/signup) — prevents brute-force attacks
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// General API rate limiter — applied to all /api/* routes
const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Admin route limiter — modest limit for the file-based admin SPA endpoint
const adminRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

/**
 * Bootstrap a ChadStart server from a YAML config file.
 * Returns { app, server, core }.
 */
async function createServer(yamlPath) {
  // 1. Load & validate YAML
  const config = loadYaml(yamlPath);
  validateSchema(config);

  // 2. Build internal core model
  const core = buildCore(config);
  logger.info(`Starting "${core.name}"...`);

  // 3. Init database
  initDb(core);

  // 4. Create Express app
  const app = express();
  app.use(express.json());

  // 5. Serve public static files (before API to allow overrides)
  if (core.public && core.public.folder) {
    const publicDir = path.resolve(core.public.folder);
    const cwd = process.cwd();
    if (!publicDir.startsWith(cwd + path.sep) && publicDir !== cwd) {
      throw new Error(
        `public.folder "${core.public.folder}" resolves outside the working directory. ` +
          'Use a relative path under the project root.'
      );
    }
    fs.mkdirSync(publicDir, { recursive: true });
    app.use(express.static(publicDir));
    logger.info(`  Serving public files from ${publicDir}`);
  }

  // 6. Register file storage routes
  registerFileRoutes(app, core);

  // 7. Register auth routes for user collections (with rate limiting)
  app.use('/auth', authRateLimiter);
  registerAuthRoutes(app, core);

  // 8. Register REST API routes (with rate limiting)
  app.use('/api', apiRateLimiter);
  registerApiRoutes(app, core, emit);

  // 9. OpenAPI spec endpoint
  const openApiSpec = generateOpenApiSpec(core);
  app.get('/openapi.json', (_req, res) => res.json(openApiSpec));

  // 10. Swagger UI
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
  logger.info('  Swagger UI available at /docs');

  // 11. Admin UI — serve the SPA, vendor assets, and API endpoints
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
  // Provide schema info to admin UI
  app.get('/admin/schema', (_req, res) => {
    res.json({
      name: core.name,
      entities: Object.values(core.entities).map((e) => ({
        name: e.name,
        tableName: e.tableName,
        properties: e.properties,
        belongsTo: e.belongsTo,
        permissions: e.permissions,
      })),
      userCollections: Object.values(core.userCollections).map((uc) => ({
        name: uc.name,
        tableName: uc.tableName,
        properties: uc.properties,
        admin: uc.admin,
      })),
    });
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
      : Object.values(core.userCollections).find((uc) => uc.name === name);
    if (!item) return res.status(404).send('<p class="text-red-400 p-4">Not found</p>');
    try {
      let rows = findAll(item.tableName);
      if (type === 'collection') rows = rows.map(omitPassword);
      res.send(renderAdminTable(rows, name));
    } catch (err) {
      res.status(500).send(`<p class="text-red-400 p-4">Error: ${escAdminHtml(err.message)}</p>`);
    }
  });
  logger.info('  Admin UI available at /admin');

  // 12. Load plugins
  await loadPlugins(app, core);

  // 13. Health check
  app.get('/health', (_req, res) => res.json({ status: 'ok', name: core.name }));

  // 14. Create HTTP server and attach WebSocket realtime
  const server = http.createServer(app);
  initRealtime(server);

  return { app, server, core };
}

/**
 * Start listening on the configured port.
 */
async function startServer(yamlPath) {
  const { server, core } = await createServer(yamlPath);
  const port = core.port;
  server.listen(port, () => {
    logger.info(`\n🚀 ${core.name} is running at http://localhost:${port}`);
    logger.info(`   API docs:  http://localhost:${port}/docs`);
    logger.info(`   Admin UI:  http://localhost:${port}/admin`);
    logger.info(`   OpenAPI:   http://localhost:${port}/openapi.json`);
    logger.info(`   Realtime:  ws://localhost:${port}/realtime`);
    logger.info(`   Health:    http://localhost:${port}/health\n`);
  });
  return { server, core };
}

module.exports = { createServer, startServer };

// ─── Admin UI helpers ─────────────────────────────────────────────────────────

function escAdminHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Render an HTML table fragment for the Admin UI HTMX partial.
 * Uses Tailwind utility classes that the Play CDN will process client-side.
 */
function renderAdminTable(rows, name) {
  const esc = escAdminHtml;
  if (!rows.length) {
    return `<div class="flex flex-col items-center justify-center py-20 text-center">
      <div class="text-5xl mb-4">&#128237;</div>
      <p class="text-sm text-ink-muted">No records yet. Click <span class="text-slate-300">+ New record</span> to create one.</p>
    </div>`;
  }
  const cols = Object.keys(rows[0]);
  const ths = cols.map((c) =>
    `<th class="px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider whitespace-nowrap">${esc(c)}</th>`
  ).join('') + '<th class="px-4 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Actions</th>';

  const trs = rows.map((row) => {
    const tds = cols.map((c) =>
      `<td class="px-4 py-3 max-w-xs truncate" title="${esc(String(row[c] ?? ''))}">${esc(String(row[c] ?? ''))}</td>`
    ).join('');
    const safeJson = JSON.stringify(row)
      .replace(/&/g, '\\u0026').replace(/'/g, '\\u0027').replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
    const actions = `<td class="px-4 py-3"><div class="flex gap-2">
      <button class="text-xs border border-ink-border rounded px-2.5 py-1 text-slate-400 hover:bg-ink-700 hover:text-slate-200 transition-colors"
        onclick='openEditModal(${safeJson})'>Edit</button>
      <button class="text-xs border border-red-900/60 rounded px-2.5 py-1 text-red-400 hover:bg-red-900/20 transition-colors"
        onclick="deleteRecord(${row.id})">Delete</button>
    </div></td>`;
    return `<tr class="border-b border-ink-border/40 hover:bg-ink-800/50 transition-colors">${tds}${actions}</tr>`;
  }).join('');

  return `<div class="overflow-x-auto border border-ink-border rounded-xl">
    <table class="w-full text-sm text-slate-300">
      <thead class="bg-ink-800"><tr class="border-b border-ink-border">${ths}</tr></thead>
      <tbody>${trs}</tbody>
    </table>
  </div>`;
}
