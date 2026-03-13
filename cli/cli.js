#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const command = args[0];
const DEFAULT_YAML = 'chadstart.yaml';

function printUsage() {
  console.log(`
ChadStart - YAML-first Backend as a Service

Usage:
  npx chadstart dev     Start server with hot-reload on YAML changes
  npx chadstart start   Start server (production mode)
  npx chadstart build   Validate YAML config and print schema summary

Options:
  --config <file>   Path to YAML config (default: chadstart.yaml)
  --port <number>   Override port from config

Examples:
  npx chadstart dev
  npx chadstart dev --config my-backend.yaml
  npx chadstart start --port 8080
`);
}

function getOption(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}

const yamlPath = path.resolve(getOption('--config') || DEFAULT_YAML);
const portOverride = getOption('--port');

if (!command || command === 'help' || command === '--help' || command === '-h') {
  printUsage();
  process.exit(0);
}

if (command === 'dev') {
  runDev();
} else if (command === 'start') {
  runStart();
} else if (command === 'build') {
  runBuild();
} else {
  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function runStart() {
  if (!fs.existsSync(yamlPath)) {
    console.error(`Config not found: ${yamlPath}`);
    process.exit(1);
  }

  applyPortOverride();
  const { startServer } = require('../server/express-server');
  await startServer(yamlPath);
}

async function runDev() {
  if (!fs.existsSync(yamlPath)) {
    console.error(`Config not found: ${yamlPath}`);
    process.exit(1);
  }

  applyPortOverride();

  let currentServer = null;

  async function boot() {
    try {
      if (currentServer) {
        await closeServer(currentServer);
      }
      // Re-require fresh server module on each reload
      clearRequireCache();
      const { startServer } = require('../server/express-server');
      const result = await startServer(yamlPath);
      currentServer = result.server;
    } catch (err) {
      console.error('[dev] Failed to start server:', err.message);
    }
  }

  await boot();

  try {
    const chokidar = require('chokidar');
    const watcher = chokidar.watch(yamlPath, { ignoreInitial: true });
    watcher.on('change', async () => {
      console.log(`\n[dev] ${path.basename(yamlPath)} changed — restarting...\n`);
      await boot();
    });
    console.log(`[dev] Watching ${yamlPath} for changes...\n`);
  } catch {
    console.warn('[dev] chokidar not available — hot reload disabled');
  }
}

function runBuild() {
  if (!fs.existsSync(yamlPath)) {
    console.error(`Config not found: ${yamlPath}`);
    process.exit(1);
  }

  try {
    const { loadYaml } = require('../core/yaml-loader');
    const { validateSchema } = require('../core/schema-validator');
    const { buildCore } = require('../core/entity-engine');

    const config = loadYaml(yamlPath);
    validateSchema(config);
    const core = buildCore(config);

    console.log(`\n✅ Config is valid\n`);
    console.log(`Project: ${core.name}`);
    console.log(`Port:     ${core.port}`);

    if (Object.keys(core.userCollections).length > 0) {
      console.log(`\nUser Collections:`);
      for (const uc of Object.values(core.userCollections)) {
        const props = uc.properties.map((p) => `${p.name}:${p.type}`).join(', ') || '(none)';
        const adminFlag = uc.admin ? ' [admin]' : '';
        console.log(`  ${uc.name}${adminFlag}  [email, password, ${props}]`);
      }
    }

    console.log(`\nEntities:`);

    for (const entity of Object.values(core.entities)) {
      const props = entity.properties.map((p) => `${p.name}:${p.type}`).join(', ');
      const rels = entity.belongsTo.length ? ` | belongsTo: ${entity.belongsTo.join(', ')}` : '';
      console.log(`  ${entity.name}  [${props}]${rels}`);
    }

    if (Object.keys(core.files).length > 0) {
      console.log(`\nFile buckets:`);
      for (const [name, def] of Object.entries(core.files)) {
        console.log(`  ${name} -> ${def.path} (public: ${def.public !== false})`);
      }
    }

    if (core.plugins.length > 0) {
      console.log(`\nPlugins:`);
      for (const p of core.plugins) {
        console.log(`  ${p.repo || p.path}`);
      }
    }

    console.log('');
  } catch (err) {
    console.error(`\n❌ ${err.message}\n`);
    process.exit(1);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function applyPortOverride() {
  if (portOverride) {
    process.env.CHADSTART_PORT = portOverride;
  }
}

function clearRequireCache() {
  const dir = path.resolve(__dirname, '..');
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(dir) && !key.includes('node_modules')) {
      delete require.cache[key];
    }
  }
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(resolve);
  });
}
