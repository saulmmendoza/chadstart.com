'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const swaggerUi = require('swagger-ui-express');

const { loadYaml } = require('../core/yaml-loader');
const { validateSchema } = require('../core/schema-validator');
const { buildCore } = require('../core/entity-engine');
const { initDb } = require('../core/db');
const { registerApiRoutes } = require('../core/api-generator');
const { initRealtime, emit } = require('../core/realtime');
const { generateOpenApiSpec } = require('../core/openapi');
const { registerFileRoutes } = require('../core/file-storage');
const { loadPlugins } = require('../core/plugin-loader');
const logger = require('../utils/logger');

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

  // 7. Register REST API routes
  registerApiRoutes(app, core, emit);

  // 8. OpenAPI spec endpoint
  const openApiSpec = generateOpenApiSpec(core);
  app.get('/openapi.json', (_req, res) => res.json(openApiSpec));

  // 9. Swagger UI
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
  logger.info('  Swagger UI available at /docs');

  // 10. Load plugins
  await loadPlugins(app, core);

  // 11. Health check
  app.get('/health', (_req, res) => res.json({ status: 'ok', name: core.name }));

  // 12. Create HTTP server and attach WebSocket realtime
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
    logger.info(`   OpenAPI:   http://localhost:${port}/openapi.json`);
    logger.info(`   Realtime:  ws://localhost:${port}/realtime`);
    logger.info(`   Health:    http://localhost:${port}/health\n`);
  });
  return { server, core };
}

module.exports = { createServer, startServer };
