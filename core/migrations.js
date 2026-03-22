'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const YAML = require('yaml');
const logger = require('../utils/logger');

const { buildCore, toSnakeCase } = require('./entity-engine');
const { DB_ENGINE, q, sqlType, idColType, authStrType } = require('./db');

// ─── Git helpers ──────────────────────────────────────────────────────────────

/**
 * Retrieve the last committed version of a file using git.
 * Returns null if the file has no committed history (brand-new / untracked).
 */
function getLastCommittedYaml(yamlPath) {
  try {
    const resolved = path.resolve(yamlPath);
    const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: path.dirname(resolved),
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString().trim();

    const relPath = path.relative(repoRoot, resolved);

    const raw = execFileSync('git', ['show', `HEAD:${relPath}`], {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();

    return YAML.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Load the current YAML file from disk and return the parsed object.
 */
function loadCurrentYaml(yamlPath) {
  const resolved = path.resolve(yamlPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`YAML config not found: ${resolved}`);
  }
  return YAML.parse(fs.readFileSync(resolved, 'utf8'));
}


// ─── Diff engine ──────────────────────────────────────────────────────────────

/**
 * Compare two core objects and return structured diff describing schema changes.
 *
 * Returns { newEntities, newColumns, newJunctionTables }.
 */
function diffCores(oldCore, newCore) {
  const newEntities = [];
  const newColumns = [];
  const newJunctionTables = [];

  const oldEntityMap = oldCore ? oldCore.entities : {};

  for (const [name, entity] of Object.entries(newCore.entities)) {
    const oldEntity = oldEntityMap[name];

    if (!oldEntity) {
      // Entirely new entity
      newEntities.push(entity);
    } else {
      // Entity already exists — look for new properties
      const oldPropNames = new Set(oldEntity.properties.map((p) => p.name));
      const oldBelongsToNames = new Set(
        (oldEntity.belongsTo || []).map((r) =>
          typeof r === 'string' ? r : (r.entity || r.name)
        )
      );

      // New properties
      for (const prop of entity.properties) {
        if (entity.authenticable && (prop.name === 'email' || prop.name === 'password')) continue;
        if (!oldPropNames.has(prop.name)) {
          newColumns.push({ entity, prop });
        }
      }

      // New belongsTo relations
      for (const rel of entity.belongsTo || []) {
        const relName = typeof rel === 'string' ? rel : (rel.entity || rel.name);
        if (!oldBelongsToNames.has(relName)) {
          const refEntity = newCore.entities[relName];
          if (refEntity) {
            newColumns.push({
              entity,
              prop: { name: `${refEntity.tableName}_id`, type: '__fk__', refTable: refEntity.tableName },
            });
          }
        }
      }

      // New authenticable flag (adds email + password columns)
      if (entity.authenticable && !oldEntity.authenticable) {
        if (!oldPropNames.has('email')) {
          newColumns.push({ entity, prop: { name: 'email', type: '__auth_email__' } });
        }
        if (!oldPropNames.has('password')) {
          newColumns.push({ entity, prop: { name: 'password', type: '__auth_password__' } });
        }
      }
    }

    // New belongsToMany junction tables
    for (const rel of entity.belongsToMany || []) {
      const relName = typeof rel === 'string' ? rel : (rel.entity || rel.name);
      const relEntity = newCore.entities[relName];
      if (!relEntity) continue;

      const [a, b] = [entity.tableName, relEntity.tableName].sort();
      const jt = `${a}_${b}`;

      // Check if old core had this junction
      const oldJt = oldCore && oldEntityMap[name] &&
        (oldEntityMap[name].belongsToMany || []).some((oldRel) => {
          const oldRelName = typeof oldRel === 'string' ? oldRel : (oldRel.entity || oldRel.name);
          return oldRelName === relName;
        });

      if (!oldJt) {
        // Avoid duplicates (A→B and B→A produce the same junction)
        if (!newJunctionTables.some((j) => j.tableName === jt)) {
          newJunctionTables.push({
            tableName: jt,
            tableA: a,
            tableB: b,
          });
        }
      }
    }
  }

  return { newEntities, newColumns, newJunctionTables };
}

// ─── SQL statement generation ─────────────────────────────────────────────────

/**
 * Generate a CREATE TABLE SQL statement for a new entity.
 */
function generateCreateTableSql(entity, allEntities) {
  const cols = [
    `${q('id')} ${idColType()} PRIMARY KEY`,
    `${q('createdAt')} TEXT`,
    `${q('updatedAt')} TEXT`,
  ];

  if (entity.authenticable) {
    cols.push(`${q('email')} ${authStrType()} NOT NULL UNIQUE`);
    cols.push(`${q('password')} ${authStrType()} NOT NULL`);
  }

  for (const p of entity.properties) {
    if (entity.authenticable && (p.name === 'email' || p.name === 'password')) continue;
    cols.push(`${q(p.name)} ${sqlType(p.type)}`);
  }

  for (const rel of entity.belongsTo || []) {
    const relName = typeof rel === 'string' ? rel : (rel.entity || rel.name);
    const ref = allEntities[relName];
    if (ref) {
      const fk = `${ref.tableName}_id`;
      cols.push(`${q(fk)} ${idColType()} REFERENCES ${q(ref.tableName)}(id)`);
    }
  }

  return `CREATE TABLE IF NOT EXISTS ${q(entity.tableName)} (${cols.join(', ')});`;
}

/**
 * Generate a DROP TABLE SQL statement for an entity.
 */
function generateDropTableSql(entity) {
  return `DROP TABLE IF EXISTS ${q(entity.tableName)};`;
}

/**
 * Generate ALTER TABLE ADD COLUMN SQL for a new column.
 */
function generateAddColumnSql(entity, prop) {
  let colDef;
  if (prop.type === '__fk__') {
    colDef = `${q(prop.name)} ${idColType()}`;
  } else if (prop.type === '__auth_email__') {
    colDef = `${q(prop.name)} ${authStrType()}`;
  } else if (prop.type === '__auth_password__') {
    colDef = `${q(prop.name)} ${authStrType()}`;
  } else {
    colDef = `${q(prop.name)} ${sqlType(prop.type)}`;
  }
  return `ALTER TABLE ${q(entity.tableName)} ADD COLUMN ${colDef};`;
}

/**
 * Generate CREATE TABLE SQL for a junction table.
 */
function generateCreateJunctionSql(junction) {
  const { tableName, tableA, tableB } = junction;
  const aCol = `${q(`${tableA}_id`)} ${idColType()} REFERENCES ${q(tableA)}(id)`;
  const bCol = `${q(`${tableB}_id`)} ${idColType()} REFERENCES ${q(tableB)}(id)`;
  return `CREATE TABLE IF NOT EXISTS ${q(tableName)} (${aCol}, ${bCol}, PRIMARY KEY (${q(`${tableA}_id`)}, ${q(`${tableB}_id`)}));`;
}

/**
 * Generate DROP TABLE SQL for a junction table.
 */
function generateDropJunctionSql(junction) {
  return `DROP TABLE IF EXISTS ${q(junction.tableName)};`;
}

// ─── Migration file generation ────────────────────────────────────────────────

/**
 * Given a diff, generate the "do" (up) and "undo" (down) SQL scripts.
 */
function generateMigrationScripts(diff, allEntities) {
  const doStatements = [];
  const undoStatements = [];

  // New entities
  for (const entity of diff.newEntities) {
    doStatements.push(generateCreateTableSql(entity, allEntities));
    undoStatements.push(generateDropTableSql(entity));
  }

  // New columns
  for (const { entity, prop } of diff.newColumns) {
    doStatements.push(generateAddColumnSql(entity, prop));
    // Most databases don't support DROP COLUMN easily (especially SQLite),
    // so undo for columns is a comment placeholder.
    undoStatements.push(`-- ALTER TABLE ${q(entity.tableName)} DROP COLUMN ${q(prop.name)};`);
  }

  // New junction tables
  for (const jt of diff.newJunctionTables) {
    doStatements.push(generateCreateJunctionSql(jt));
    undoStatements.push(generateDropJunctionSql(jt));
  }

  return {
    do: doStatements.join('\n'),
    undo: undoStatements.join('\n'),
  };
}

/**
 * Determine the next migration version number from files in a directory.
 */
function getNextVersion(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) return 1;

  const files = fs.readdirSync(migrationsDir).filter((f) => /^\d+\./.test(f));
  if (!files.length) return 1;

  const versions = files.map((f) => parseInt(f.split('.')[0], 10));
  return Math.max(...versions) + 1;
}

/**
 * Write migration SQL files to the migrations directory.
 * Returns the paths of files written.
 */
function writeMigrationFiles(migrationsDir, doSql, undoSql, description) {
  fs.mkdirSync(migrationsDir, { recursive: true });

  const version = String(getNextVersion(migrationsDir)).padStart(3, '0');
  const desc = description ? `.${description.replace(/[^a-zA-Z0-9_-]/g, '-')}` : '';

  const doFile = `${version}.do${desc}.sql`;
  const undoFile = `${version}.undo${desc}.sql`;

  const doPath = path.join(migrationsDir, doFile);
  const undoPath = path.join(migrationsDir, undoFile);

  fs.writeFileSync(doPath, doSql, 'utf8');
  fs.writeFileSync(undoPath, undoSql, 'utf8');

  return { doPath, undoPath, version: parseInt(version, 10) };
}

// ─── Postgrator integration ──────────────────────────────────────────────────

/**
 * Build an execQuery function suitable for postgrator from the db module.
 *
 * Postgrator calls execQuery for ALL queries (SELECT, CREATE, INSERT, ALTER, etc.)
 * and always expects `{ rows: [...] }` back. For non-SELECT statements on SQLite,
 * better-sqlite3's `.prepare().all()` throws, so we catch and return `{ rows: [] }`.
 */
function buildExecQueryFn(dbModule) {
  return async function execQuery(query) {
    try {
      const rows = await dbModule.queryAll(query);
      return { rows };
    } catch {
      // Non-SELECT statement (CREATE TABLE, INSERT, ALTER TABLE, DELETE, etc.)
      await dbModule.exec(query);
      return { rows: [] };
    }
  };
}

/**
 * Create a Postgrator instance configured for the current database engine.
 * Uses dynamic import because postgrator is an ES module.
 */
async function createPostgrator(migrationsDir, execQueryFn) {
  const { default: Postgrator } = await import('postgrator');

  const driver = DB_ENGINE === 'postgres' ? 'pg'
    : DB_ENGINE === 'mysql' ? 'mysql'
    : 'sqlite3';

  return new Postgrator({
    migrationPattern: path.join(migrationsDir, '*'),
    driver,
    database: process.env.DB_DATABASE || 'chadstart',
    schemaTable: '_cs_migrations',
    execQuery: execQueryFn,
    validateChecksum: true,
  });
}

/**
 * Run all pending migrations up to the latest version.
 */
async function runMigrations(migrationsDir, execQueryFn) {
  if (!fs.existsSync(migrationsDir)) {
    logger.info('No migrations directory found — nothing to run.');
    return [];
  }

  const postgrator = await createPostgrator(migrationsDir, execQueryFn);
  const applied = await postgrator.migrate();
  return applied;
}

/**
 * Get the current migration version.
 */
async function getMigrationVersion(migrationsDir, execQueryFn) {
  const postgrator = await createPostgrator(migrationsDir, execQueryFn);
  return postgrator.getDatabaseVersion();
}

/**
 * Get all migrations and their status.
 */
async function getMigrationStatus(migrationsDir, execQueryFn) {
  if (!fs.existsSync(migrationsDir)) {
    return { currentVersion: 0, pending: [], applied: [] };
  }

  const postgrator = await createPostgrator(migrationsDir, execQueryFn);
  const currentVersion = await postgrator.getDatabaseVersion();
  const allMigrations = await postgrator.getMigrations();

  const doMigrations = allMigrations.filter((m) => m.action === 'do');
  const applied = doMigrations.filter((m) => m.version <= currentVersion);
  const pending = doMigrations.filter((m) => m.version > currentVersion);

  return { currentVersion, pending, applied };
}

// ─── High-level commands ──────────────────────────────────────────────────────

/**
 * Generate a migration by diffing the current YAML against the last committed
 * version in git. Writes numbered SQL files to the migrations directory.
 *
 * @param {string} yamlPath        Path to the chadstart YAML config file.
 * @param {string} migrationsDir   Path to the migrations directory.
 * @param {string} [description]   Optional description for the migration.
 * @returns {{ doPath, undoPath, version, isEmpty } | null}
 */
function generateMigration(yamlPath, migrationsDir, description) {
  const currentConfig = loadCurrentYaml(yamlPath);
  const oldConfig = getLastCommittedYaml(yamlPath);

  const newCore = buildCore(currentConfig);
  const oldCore = oldConfig ? buildCore(oldConfig) : null;

  const diff = diffCores(oldCore, newCore);

  const hasChanges =
    diff.newEntities.length > 0 ||
    diff.newColumns.length > 0 ||
    diff.newJunctionTables.length > 0;

  if (!hasChanges) {
    return { isEmpty: true };
  }

  const scripts = generateMigrationScripts(diff, newCore.entities);
  const result = writeMigrationFiles(migrationsDir, scripts.do, scripts.undo, description);

  return { ...result, isEmpty: false };
}

module.exports = {
  // Git helpers
  getLastCommittedYaml,
  loadCurrentYaml,
  // Diff engine
  diffCores,
  // SQL generation
  generateCreateTableSql,
  generateDropTableSql,
  generateAddColumnSql,
  generateCreateJunctionSql,
  generateDropJunctionSql,
  generateMigrationScripts,
  // File operations
  getNextVersion,
  writeMigrationFiles,
  // Postgrator integration
  buildExecQueryFn,
  createPostgrator,
  runMigrations,
  getMigrationVersion,
  getMigrationStatus,
  // High-level
  generateMigration,
};
