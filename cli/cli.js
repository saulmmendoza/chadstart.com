#!/usr/bin/env node
'use strict';

const readline = require('readline');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const command = args[0];
const DEFAULT_CONFIG = 'chadstart.yaml';

function printUsage() {
  console.log(`
ChadStart - Config-driven Backend as a Service

Usage:
  npx chadstart dev               Start server with hot-reload on config changes
  npx chadstart start             Start server (production mode)
  npx chadstart build             Validate config and print schema summary
  npx chadstart seed              Seed the database with dummy data
  npx chadstart migrate           Run pending database migrations
  npx chadstart migrate:generate  Generate migration from config diff (git-based)
  npx chadstart migrate:status    Show current migration status

Options:
  --config <file>         Path to config file (default: auto-discover)
                          Supported formats: yaml, json, json5, jsonnet, js
  --port <number>         Override port from config
  --migrations-dir <dir>  Path to migrations directory (default: migrations)
  --description <text>    Description for generated migration

Examples:
  npx chadstart dev
  npx chadstart dev --config my-backend.yaml
  npx chadstart dev --config chadstart.json
  npx chadstart start --port 8080
  npx chadstart migrate:generate --description add-posts-table
  npx chadstart migrate
`);
}

function getOption(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}

function resolveConfigPath() {
  const explicit = getOption('--config') || process.env.CHADSTART_FILE_PATH;
  if (explicit) return path.resolve(explicit);
  // Auto-discover: try each supported filename in priority order
  const { discoverConfigFile } = require('../core/config-loader');
  const found = discoverConfigFile(process.cwd());
  return found || path.resolve(DEFAULT_CONFIG); // fall back to default for error messages
}

const configPath = resolveConfigPath();
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
} else if (command === 'migrate') {
  runMigrate();
} else if (command === 'migrate:generate') {
  runMigrateGenerate();
} else if (command === 'migrate:status') {
  runMigrateStatus();
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
  if (!fs.existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    process.exit(1);
  }

  try {
    const { loadConfig } = require('../core/config-loader');
    const { validateSchema } = require('../core/schema-validator');
    const { buildCore } = require('../core/entity-engine');
    const { initDb } = require('../core/db');
    const { seedAll } = require('../core/seeder');

    const config = loadConfig(configPath);
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
  if (!fs.existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    process.exit(1);
  }

  applyPortOverride();
  const { startServer } = require('../server/express-server');
  await startServer(configPath);
}

async function runDev() {
  if (!fs.existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
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
      const result = await startServer(configPath);
      currentServer = result.server;
    } catch (err) {
      console.error('[dev] Failed to start server:', err.message);
    }
  }

  await boot();

  try {
    const chokidar = require('chokidar');
    // Watch YAML config
    const watcher = chokidar.watch(configPath, { ignoreInitial: true });
    watcher.on('change', async () => {
      console.log(`\n[dev] ${path.basename(configPath)} changed — restarting...\n`);
      await boot();
    });
    console.log(`[dev] Watching ${configPath} for changes...\n`);

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
  if (!fs.existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    process.exit(1);
  }

  try {
    const { loadConfig } = require('../core/config-loader');
    const { validateSchema } = require('../core/schema-validator');
    const { buildCore } = require('../core/entity-engine');

    const config = loadConfig(configPath);
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

const migrationsDir = path.resolve(getOption('--migrations-dir') || 'migrations');
const migrationDescription = getOption('--description') || null;

async function runMigrate() {
  if (!fs.existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    process.exit(1);
  }

  try {
    const { loadConfig } = require('../core/config-loader');
    const { validateSchema } = require('../core/schema-validator');
    const { buildCore } = require('../core/entity-engine');
    const { initDb, closeDb } = require('../core/db');
    const { runMigrations, buildExecQueryFn } = require('../core/migrations');
    const dbModule = require('../core/db');

    const config = loadConfig(configPath);
    validateSchema(config);
    const core = buildCore(config);
    await initDb(core);

    console.log('\n🔄 Running database migrations...\n');

    const execQueryFn = buildExecQueryFn(dbModule);

    const applied = await runMigrations(migrationsDir, execQueryFn);

    if (applied.length === 0) {
      console.log('  ✅ Database is up to date — no pending migrations.\n');
    } else {
      for (const m of applied) {
        console.log(`  ✅ Applied: ${m.version}.${m.action}${m.name ? '.' + m.name : ''}`);
      }
      console.log(`\n  ${applied.length} migration${applied.length !== 1 ? 's' : ''} applied.\n`);
    }

    await closeDb();
  } catch (err) {
    console.error(`\n❌ ${err.message}\n`);
    process.exit(1);
  }
}

async function runMigrateGenerate() {
  if (!fs.existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    process.exit(1);
  }

  try {
    const { generateMigration } = require('../core/migrations');

    console.log('\n📝 Generating migration from YAML diff...\n');

    const result = generateMigration(configPath, migrationsDir, migrationDescription);

    if (result.isEmpty) {
      console.log('  ℹ️  No schema changes detected — nothing to generate.\n');
    } else {
      console.log(`  ✅ Migration v${String(result.version).padStart(3, '0')} generated:`);
      console.log(`     DO:   ${result.doPath}`);
      console.log(`     UNDO: ${result.undoPath}`);
      console.log('\n  Run `npx chadstart migrate` to apply.\n');
    }
  } catch (err) {
    console.error(`\n❌ ${err.message}\n`);
    process.exit(1);
  }
}

async function runMigrateStatus() {
  if (!fs.existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    process.exit(1);
  }

  try {
    const { loadConfig } = require('../core/config-loader');
    const { validateSchema } = require('../core/schema-validator');
    const { buildCore } = require('../core/entity-engine');
    const { initDb, closeDb } = require('../core/db');
    const { getMigrationStatus, buildExecQueryFn } = require('../core/migrations');
    const dbModule = require('../core/db');

    const config = loadConfig(configPath);
    validateSchema(config);
    const core = buildCore(config);
    await initDb(core);

    const execQueryFn = buildExecQueryFn(dbModule);

    const status = await getMigrationStatus(migrationsDir, execQueryFn);

    console.log(`\n📊 Migration Status\n`);
    console.log(`  Current version: ${status.currentVersion}`);
    console.log(`  Applied:         ${status.applied.length}`);
    console.log(`  Pending:         ${status.pending.length}`);

    if (status.pending.length > 0) {
      console.log('\n  Pending migrations:');
      for (const m of status.pending) {
        console.log(`    - ${m.version}.${m.action}${m.name ? '.' + m.name : ''}`);
      }
    }

    console.log('');
    await closeDb();
  } catch (err) {
    console.error(`\n❌ ${err.message}\n`);
    process.exit(1);
  }
}

// ─── Other helpers ───────────────────────────────────────────────────────────

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
