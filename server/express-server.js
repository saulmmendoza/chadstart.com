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
const { initDb } = require('../core/db');
const { registerApiRoutes } = require('../core/api-generator');
const { registerAuthRoutes } = require('../core/auth');
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
const adminLimiter = limiter(60 * 1000, 100);

async function createServer(yamlPath) {
  const config = loadYaml(yamlPath);
  validateSchema(config);
  const core = buildCore(config);
  logger.info(`Starting "${core.name}"...`);

  initDb(core);

  const app = express();
  app.use(express.json());

  // Public static files
  if (core.public && core.public.folder) {
    const publicDir = path.resolve(core.public.folder);
    const cwd = process.cwd();
    if (!publicDir.startsWith(cwd + path.sep) && publicDir !== cwd) {
      throw new Error(`public.folder "${core.public.folder}" resolves outside the working directory.`);
    }
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

  // Admin UI
  const adminHtml = path.join(__dirname, '..', 'admin', 'index.html');
  app.get('/admin', adminLimiter, (_req, res) => {
    if (fs.existsSync(adminHtml)) res.sendFile(adminHtml);
    else res.status(404).send('Admin UI not found');
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
