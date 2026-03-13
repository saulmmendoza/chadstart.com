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
  for (const [name, ep] of Object.entries(core.endpoints || {})) {
    const epPath = `/endpoints${ep.path}`;
    const method = ep.method.toLowerCase();
    const handlerFile = path.resolve(process.env.MANIFEST_HANDLERS_FOLDER || 'handlers', `${ep.handler}.js`);

    if (fs.existsSync(handlerFile)) {
      const handler = require(handlerFile);
      app[method](epPath, handler);
      logger.info(`  Registered endpoint: ${ep.method} ${epPath}`);
    } else {
      logger.warn(`  Handler not found for "${name}": ${handlerFile}`);
    }
  }
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
