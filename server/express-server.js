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

  // 7. Register auth routes for authenticable entities (with rate limiting)
  app.use('/api/auth', authRateLimiter);
  registerAuthRoutes(app, core);

  // 8. Register REST API routes (with rate limiting)
  app.use('/api', apiRateLimiter);
  registerApiRoutes(app, core, emit);

  // 9. Register custom endpoints
  await registerCustomEndpoints(app, core);

  // 10. OpenAPI spec endpoint
  const openApiSpec = generateOpenApiSpec(core);
  app.get('/openapi.json', (_req, res) => res.json(openApiSpec));

  // 11. Swagger UI
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
  logger.info('  Swagger UI available at /docs');

  // 12. Admin UI — serve the SPA and an API endpoint for the schema
  const adminHtml = path.join(__dirname, '..', 'admin', 'index.html');
  app.get('/admin', adminRateLimiter, (_req, res) => {
    if (fs.existsSync(adminHtml)) {
      res.sendFile(adminHtml);
    } else {
      res.status(404).send('Admin UI not found');
    }
  });
  // Provide schema info to admin UI
  app.get('/admin/schema', (_req, res) => {
    const authenticableEntities = Object.values(core.authenticableEntities || {}).map((e) => ({
      name: e.name,
      tableName: e.tableName,
      slug: e.slug,
      properties: e.properties,
      authenticable: true,
    }));

    const regularEntities = Object.values(core.entities)
      .filter((e) => !e.authenticable)
      .map((e) => ({
        name: e.name,
        tableName: e.tableName,
        slug: e.slug,
        properties: e.properties,
        belongsTo: e.belongsTo,
        belongsToMany: e.belongsToMany,
        policies: e.policies,
        single: e.single || false,
      }));

    res.json({
      name: core.name,
      entities: regularEntities,
      authenticableEntities,
      // Backward compat
      userCollections: authenticableEntities.map((e) => ({
        name: e.name,
        tableName: e.tableName,
        properties: e.properties,
        admin: true,
      })),
    });
  });
  logger.info('  Admin UI available at /admin');

  // 13. Load plugins
  await loadPlugins(app, core);

  // 14. Health check
  app.get('/health', (_req, res) => res.json({ status: 'ok', name: core.name }));

  // 15. Create HTTP server and attach WebSocket realtime
  const server = http.createServer(app);
  initRealtime(server);

  return { app, server, core };
}

/**
 * Register custom endpoints defined in the YAML config.
 */
async function registerCustomEndpoints(app, core) {
  const endpoints = core.endpoints || {};

  for (const [epName, epDef] of Object.entries(endpoints)) {
    const epPath = `/endpoints${epDef.path}`;
    const method = (epDef.method || 'GET').toLowerCase();
    const handlerName = epDef.handler;

    // Try to load the handler file
    const handlersDir = process.env.MANIFEST_HANDLERS_FOLDER || path.resolve('handlers');
    const handlerFile = path.resolve(handlersDir, `${handlerName}.js`);

    if (fs.existsSync(handlerFile)) {
      const handler = require(handlerFile);
      app[method](epPath, (req, res) => {
        handler(req, res, {
          from: (slug) => require('../core/db'),
        });
      });
      logger.info(`  Registered custom endpoint: ${epDef.method} ${epPath}`);
    } else {
      logger.warn(`  Handler file not found for endpoint "${epName}": ${handlerFile}`);
    }
  }
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
