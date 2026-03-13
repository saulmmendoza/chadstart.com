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
const { initDb, findAll, findAllSimple } = require('../core/db');
const { registerApiRoutes } = require('../core/api-generator');
const { registerAuthRoutes, verifyToken, omitPassword } = require('../core/auth');
const { initRealtime, emit } = require('../core/realtime');
const { generateOpenApiSpec } = require('../core/openapi');
const { registerFileRoutes } = require('../core/file-storage');
const { loadPlugins } = require('../core/plugin-loader');
const logger = require('../utils/logger');

function limiter(windowMs, max) {
  return rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests, please try again later.' } });
}
const authLimiter  = limiter(15 * 60 * 1000, 30);
const apiLimiter   = limiter(60 * 1000, 200);
const adminRateLimiter = limiter(60 * 1000, 100);

async function createServer(yamlPath) {
  const config = loadYaml(yamlPath);
  validateSchema(config);
  const core = buildCore(config);
  logger.info(`Starting "${core.name}"...`);

  const dbPath = core.database
    ? path.resolve(path.dirname(yamlPath), core.database)
    : undefined;
  initDb(core, dbPath);

  const app = express();
  app.use(express.json());

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

  app.use('/api/auth', authLimiter);
  registerAuthRoutes(app, core);

  app.use('/api', apiLimiter);
  registerApiRoutes(app, core, emit);

  await registerCustomEndpoints(app, core);

  const openApiSpec = generateOpenApiSpec(core);
  app.get('/openapi.json', (_req, res) => res.json(openApiSpec));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

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
    try {
      let rows = findAllSimple(item.tableName);
      if (type === 'collection') rows = rows.map(omitPassword);
      res.send(renderAdminTable(rows, name));
    } catch (err) {
      res.status(500).send(`<p class="text-red-400 p-4">Error: ${escAdminHtml(err.message)}</p>`);
    }
  });
  logger.info('  Admin UI available at /admin');

  await loadPlugins(app, core);
  app.get('/health', (_req, res) => res.json({ status: 'ok', name: core.name }));

  const server = http.createServer(app);
  initRealtime(server);
  return { app, server, core };
}

async function registerCustomEndpoints(app, core) {
  const jwt = require('jsonwebtoken');
  const { requireAuth, optionalAuth } = require('../core/auth');
  const db = require('../core/db');

  // Create a simple backend "SDK" object for handlers (mimics the JS SDK interface)
  const manifestSdk = createBackendSdk(core);

  for (const [name, ep] of Object.entries(core.endpoints || {})) {
    const epPath = `/endpoints${ep.path}`;
    const method = ep.method.toLowerCase();
    const handlerFile = path.resolve(process.env.MANIFEST_HANDLERS_FOLDER || 'handlers', `${ep.handler}.js`);

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

/**
 * Create a simple backend SDK for custom endpoint handlers.
 * Provides a `from(slug)` interface that maps to CRUD operations.
 */
function createBackendSdk(core) {
  const db = require('../core/db');

  return {
    from(slug) {
      // Find entity by slug
      const entity = Object.values(core.entities).find(
        (e) => e.slug === slug || e.slug + 's' === slug || slug === e.tableName
      );
      if (!entity) throw new Error(`Entity not found for slug: ${slug}`);
      const table = entity.tableName;

      return {
        find(opts) { return db.findAll(table, {}, opts || {}); },
        findOneById(id) { return db.findById(table, id); },
        create(data) { return db.create(table, data); },
        update(id, data) { return db.update(table, id, data); },
        patch(id, data) { return db.update(table, id, data); },
        delete(id) { return db.remove(table, id); },
      };
    },
    single(slug) {
      const entity = Object.values(core.entities).find(
        (e) => (e.slug === slug || e.tableName === slug) && e.single
      );
      if (!entity) throw new Error(`Single entity not found for slug: ${slug}`);
      const table = entity.tableName;

      return {
        get() {
          const rows = db.findAllSimple(table);
          return rows[0] || null;
        },
        update(data) {
          const rows = db.findAllSimple(table);
          if (!rows[0]) return null;
          return db.update(table, rows[0].id, data);
        },
        patch(data) {
          const rows = db.findAllSimple(table);
          if (!rows[0]) return null;
          return db.update(table, rows[0].id, data);
        },
      };
    },
  };
}

async function startServer(yamlPath) {
  const { server, core } = await createServer(yamlPath);
  server.listen(core.port, () => {
    logger.info(`\n🚀 ${core.name} is running at http://localhost:${core.port}`);
    logger.info(`   API docs:  http://localhost:${core.port}/docs`);
    logger.info(`   Admin UI:  http://localhost:${core.port}/admin`);
    logger.info(`   Health:    http://localhost:${core.port}/health\n`);
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
