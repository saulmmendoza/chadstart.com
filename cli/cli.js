#!/usr/bin/env node
'use strict';

const readline = require('readline');
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
  npx chadstart seed    Seed the database with dummy data

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

const yamlPath = path.resolve(getOption('--config') || process.env.CHADSTART_FILE_PATH || DEFAULT_YAML);
const portOverride = getOption('--port');

if (!command || command === 'help' || command === '--help' || command === '-h') {
  printUsage();
  process.exit(0);
}

if (command === 'create') {
  runCreate();
} else if (command === 'dev') {
  runDev();
} else if (command === 'start') {
  runStart();
} else if (command === 'build') {
  runBuild();
} else if (command === 'seed') {
  runSeed();
} else {
  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}

// ─── Commands ────────────────────────────────────────────────────────────────


async function runCreate() {
  let folderName = process.argv[3];
  if (!folderName) {
    folderName = await askFolderName();
  }

  if (!folderName) {
    console.error('Error: folder name is required.');
    process.exit(1);
  }

  const targetDir = path.resolve(process.cwd(), folderName);

  if (fs.existsSync(targetDir)) {
    console.error(`Error: directory "${folderName}" already exists.`);
    process.exit(1);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const templateFile = path.join(__dirname, '../demo', 'chadstart.yaml');
  const destFile = path.join(targetDir, 'chadstart.yaml');
  fs.copyFileSync(templateFile, destFile);

  console.log(`\nCreated project in ${targetDir}`);
  console.log('\nNext steps:');
  console.log(`  cd ${folderName}`);
  console.log('  npx chadstart dev\n');

  async function askFolderName() {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question('Enter the project folder name: ', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }
}

async function runSeed() {
  if (!fs.existsSync(yamlPath)) {
    console.error(`Config not found: ${yamlPath}`);
    process.exit(1);
  }

  try {
    const { loadYaml } = require('../core/yaml-loader');
    const { validateSchema } = require('../core/schema-validator');
    const { buildCore } = require('../core/entity-engine');
    const { initDb } = require('../core/db');
    const { seedAll } = require('../core/seeder');

    const config = loadYaml(yamlPath);
    validateSchema(config);
    const core = buildCore(config);
    initDb(core);

    console.log('\n🌱 Seeding database...\n');
    const result = await seedAll(core);

    for (const [name, count] of Object.entries(result.summary)) {
      console.log(`  ✅ ${name}: ${count} record${count !== 1 ? 's' : ''} created`);
    }

    if (result.adminEntities.length > 0) {
      console.log('\n🔑 Admin user created:');
      console.log(`   Email:    ${result.adminEmail}`);
      console.log(`   Password: ${result.adminPassword}`);
      console.log(`   Entities: ${result.adminEntities.join(', ')}`);
    }

    console.log('\nDone!\n');
  } catch (err) {
    console.error(`\n❌ ${err.message}\n`);
    process.exit(1);
  }
}

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
    // Watch YAML config
    const watcher = chokidar.watch(yamlPath, { ignoreInitial: true });
    watcher.on('change', async () => {
      console.log(`\n[dev] ${path.basename(yamlPath)} changed — restarting...\n`);
      await boot();
    });
    console.log(`[dev] Watching ${yamlPath} for changes...\n`);

    // Watch the functions folder for hot reload of function files
    const functionsDir = path.resolve(process.env.CHADSTART_FUNCTIONS_FOLDER || 'functions');
    if (fs.existsSync(functionsDir)) {
      const fnWatcher = chokidar.watch(functionsDir, { ignoreInitial: true, ignorePermissionErrors: true });
      fnWatcher.on('change', (filePath) => {
        console.log(`\n[dev] Function file changed: ${path.relative(process.cwd(), filePath)}`);
        // Only validate and cache-bust JS files; other runtimes (python, bash, etc.) are loaded fresh each invocation
        if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
          try { delete require.cache[require.resolve(filePath)]; } catch { /* */ }
          try { require(filePath); console.log(`[dev] ✔ ${path.basename(filePath)} reloaded`); }
          catch (e) { console.error(`[dev] ✖ ${path.basename(filePath)} has errors — restarting server:`, e.message); boot(); }
        } else {
          console.log(`[dev] ✔ ${path.basename(filePath)} updated`);
        }
      });
      console.log(`[dev] Watching ${functionsDir} for function file changes...\n`);
    }
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
    console.log(`Port:    ${core.port}`);

    if (Object.keys(core.authenticableEntities).length > 0) {
      console.log(`\nUser Collections:`);
      for (const uc of Object.values(core.authenticableEntities)) {
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
