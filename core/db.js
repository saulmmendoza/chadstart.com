'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DB_ENGINE = (process.env.DB_ENGINE || 'sqlite').toLowerCase();

let _sqliteDb = null;
let _pgPool = null;
let _mysqlPool = null;
let _core = null;

// ─── SQL type maps ────────────────────────────────────────────────────────────

const SQL_TYPE_SQLITE = {
  text: 'TEXT', string: 'TEXT', richText: 'TEXT',
  integer: 'INTEGER', int: 'INTEGER',
  number: 'REAL', float: 'REAL', real: 'REAL', money: 'REAL',
  boolean: 'INTEGER', bool: 'INTEGER',
  date: 'TEXT', timestamp: 'TEXT', email: 'TEXT', link: 'TEXT',
  password: 'TEXT', choice: 'TEXT', location: 'TEXT',
  file: 'TEXT', image: 'TEXT', group: 'TEXT', json: 'TEXT',
};

const SQL_TYPE_PG = {
  text: 'TEXT', string: 'TEXT', richText: 'TEXT',
  integer: 'INTEGER', int: 'INTEGER',
  number: 'NUMERIC', float: 'NUMERIC', real: 'NUMERIC', money: 'NUMERIC',
  boolean: 'BOOLEAN', bool: 'BOOLEAN',
  date: 'TEXT', timestamp: 'TEXT', email: 'TEXT', link: 'TEXT',
  password: 'TEXT', choice: 'TEXT', location: 'TEXT',
  file: 'TEXT', image: 'TEXT', group: 'TEXT', json: 'TEXT',
};

const SQL_TYPE_MYSQL = {
  text: 'TEXT', string: 'TEXT', richText: 'TEXT',
  integer: 'INT', int: 'INT',
  number: 'DECIMAL(15,4)', float: 'DECIMAL(15,4)', real: 'DECIMAL(15,4)', money: 'DECIMAL(15,4)',
  boolean: 'TINYINT(1)', bool: 'TINYINT(1)',
  date: 'TEXT', timestamp: 'TEXT', email: 'TEXT', link: 'TEXT',
  password: 'TEXT', choice: 'TEXT', location: 'TEXT',
  file: 'TEXT', image: 'TEXT', group: 'TEXT', json: 'TEXT',
};

function sqlType(type) {
  if (DB_ENGINE === 'postgres') return SQL_TYPE_PG[type] || 'TEXT';
  if (DB_ENGINE === 'mysql') return SQL_TYPE_MYSQL[type] || 'TEXT';
  return SQL_TYPE_SQLITE[type] || 'TEXT';
}

// ID column type — MySQL needs VARCHAR(36) because TEXT can't be primary key
function idColType() {
  return DB_ENGINE === 'mysql' ? 'VARCHAR(36)' : 'TEXT';
}

// Auth string column type — MySQL requires bounded VARCHAR for UNIQUE-indexed columns
function authStrType() {
  return DB_ENGINE === 'mysql' ? 'VARCHAR(191)' : 'TEXT';
}

function generateUUID() {
  return crypto.randomUUID();
}

// Quote an identifier for the current database engine
function q(name) {
  if (DB_ENGINE === 'mysql') return `\`${name}\``;
  return `"${name}"`;
}

// Convert ? placeholders to $1, $2, ... for PostgreSQL
function toPgPlaceholders(sql) {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

// ─── Low-level async query helpers ───────────────────────────────────────────

async function exec(sql) {
  if (DB_ENGINE === 'postgres') { await _pgPool.query(sql); return; }
  if (DB_ENGINE === 'mysql') { await _mysqlPool.query(sql); return; }
  _sqliteDb.exec(sql);
}

async function queryAll(sql, params = []) {
  if (DB_ENGINE === 'postgres') {
    const result = await _pgPool.query(toPgPlaceholders(sql), params);
    return result.rows;
  }
  if (DB_ENGINE === 'mysql') {
    const [rows] = await _mysqlPool.query(sql, params);
    return rows;
  }
  return _sqliteDb.prepare(sql).all(...params);
}

async function queryOne(sql, params = []) {
  const rows = await queryAll(sql, params);
  return rows[0] || null;
}

async function queryRun(sql, params = []) {
  if (DB_ENGINE === 'postgres') {
    await _pgPool.query(toPgPlaceholders(sql), params);
    return;
  }
  if (DB_ENGINE === 'mysql') {
    await _mysqlPool.query(sql, params);
    return;
  }
  _sqliteDb.prepare(sql).run(...params);
}

// Build an INSERT OR IGNORE / INSERT IGNORE / INSERT...ON CONFLICT DO NOTHING
// statement appropriate for the current engine.
function buildInsertOrIgnoreSql(table, colA, colB) {
  if (DB_ENGINE === 'postgres') {
    return `INSERT INTO ${q(table)} (${q(colA)}, ${q(colB)}) VALUES (?, ?) ON CONFLICT DO NOTHING`;
  }
  if (DB_ENGINE === 'mysql') {
    return `INSERT IGNORE INTO ${q(table)} (${q(colA)}, ${q(colB)}) VALUES (?, ?)`;
  }
  return `INSERT OR IGNORE INTO ${q(table)} (${q(colA)}, ${q(colB)}) VALUES (?, ?)`;
}

// ─── Initialization ───────────────────────────────────────────────────────────

async function initDb(core, dbPath) {
  _core = core;

  if (DB_ENGINE === 'postgres') {
    const { Pool } = require('pg');
    _pgPool = new Pool({
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT || '5432', 10),
      user:     process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_DATABASE || 'manifest',
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });
    await _pgPool.query('SELECT 1');
    logger.info('PostgreSQL database connected');
    await syncSchema(core);
    return _pgPool;
  }

  if (DB_ENGINE === 'mysql') {
    const mysql = require('mysql2/promise');
    _mysqlPool = await mysql.createPool({
      host:               process.env.DB_HOST     || 'localhost',
      port:               parseInt(process.env.DB_PORT || '3306', 10),
      user:               process.env.DB_USERNAME || 'root',
      password:           process.env.DB_PASSWORD || '',
      database:           process.env.DB_DATABASE || 'manifest',
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
      waitForConnections: true,
      connectionLimit:    10,
    });
    await _mysqlPool.query('SELECT 1');
    logger.info('MySQL database connected');
    await syncSchema(core);
    return _mysqlPool;
  }

  // SQLite (default)
  const Database = require('better-sqlite3');
  const resolved = dbPath
    ? path.resolve(dbPath)
    : path.resolve(process.env.DB_PATH || '/data/chadstart.db');
  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
  } catch (err) {
    throw new Error(`Failed to create database directory "${path.dirname(resolved)}": ${err.message}`);
  }
  try {
    _sqliteDb = new Database(resolved);
  } catch (err) {
    throw new Error(
      `Failed to open database at "${resolved}": ${err.message}\n` +
      `  Make sure the directory exists and is writable, and that no other process has an exclusive lock on the file.`
    );
  }
  _sqliteDb.pragma('journal_mode = WAL');
  _sqliteDb.pragma('foreign_keys = ON');
  logger.info(`SQLite database initialized at ${resolved}`);
  await syncSchema(core);
  return _sqliteDb;
}

/** Return the raw SQLite connection (only valid in sqlite mode). */
function getDb() {
  if (DB_ENGINE !== 'sqlite') throw new Error('getDb() is only available in SQLite mode');
  if (!_sqliteDb) throw new Error('Database not initialized. Call initDb() first.');
  return _sqliteDb;
}

// ─── Schema helpers ───────────────────────────────────────────────────────────

async function getExistingColumns(tableName) {
  if (DB_ENGINE === 'postgres') {
    const rows = await queryAll(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?`,
      [tableName]
    );
    return rows.length ? new Set(rows.map((r) => r.column_name)) : null;
  }
  if (DB_ENGINE === 'mysql') {
    const rows = await queryAll(
      `SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?`,
      [tableName]
    );
    return rows.length ? new Set(rows.map((r) => r.COLUMN_NAME || r.column_name)) : null;
  }
  // SQLite
  try {
    const rows = _sqliteDb.pragma(`table_info("${tableName}")`);
    return rows && rows.length ? new Set(rows.map((r) => r.name)) : null;
  } catch { return null; }
}

function stripConstraints(def) {
  return def
    .replace(/\bNOT\s+NULL\b/gi, '')
    .replace(/\bUNIQUE\b/gi, '')
    .replace(/\bREFERENCES\s+[`"]?[^`"\s(]+[`"]?\s*\([^)]+\)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function buildColumnDefs(entity, allEntities) {
  const cols = [];

  if (entity.authenticable) {
    cols.push({ name: 'email',    def: `${q('email')} ${authStrType()} NOT NULL UNIQUE` });
    cols.push({ name: 'password', def: `${q('password')} ${authStrType()} NOT NULL` });
    cols.push({ name: 'emailVerified',          def: `${q('emailVerified')} INTEGER DEFAULT 0` });
    cols.push({ name: 'emailVerificationToken', def: `${q('emailVerificationToken')} TEXT` });
    cols.push({ name: 'passwordResetToken',     def: `${q('passwordResetToken')} TEXT` });
    cols.push({ name: 'passwordResetExpiry',    def: `${q('passwordResetExpiry')} TEXT` });
    cols.push({ name: 'magicLinkToken',          def: `${q('magicLinkToken')} TEXT` });
    cols.push({ name: 'magicLinkExpiry',         def: `${q('magicLinkExpiry')} TEXT` });
    if (entity.mfa) {
      cols.push({ name: 'mfaEnabled', def: `${q('mfaEnabled')} INTEGER DEFAULT 0` });
      cols.push({ name: 'mfaSecret',  def: `${q('mfaSecret')} TEXT` });
      cols.push({ name: 'mfaRecoveryCodes', def: `${q('mfaRecoveryCodes')} TEXT` });
    }
  }

  for (const p of entity.properties) {
    if (entity.authenticable && (p.name === 'email' || p.name === 'password')) continue;
    cols.push({ name: p.name, def: `${q(p.name)} ${sqlType(p.type)}` });
  }

  for (const rel of entity.belongsTo || []) {
    const relName = typeof rel === 'string' ? rel : (rel.entity || rel.name);
    const ref = allEntities[relName];
    if (ref) {
      const fk = `${ref.tableName}_id`;
      cols.push({ name: fk, def: `${q(fk)} ${idColType()} REFERENCES ${q(ref.tableName)}(id)` });
    }
  }

  return cols;
}

async function syncSchema(core) {
  for (const entity of Object.values(core.entities)) {
    const cols = buildColumnDefs(entity, core.entities);
    const existing = await getExistingColumns(entity.tableName);

    if (!existing) {
      const defs = [
        `${q('id')} ${idColType()} PRIMARY KEY`,
        `${q('createdAt')} TEXT`,
        `${q('updatedAt')} TEXT`,
        ...cols.map((c) => c.def),
      ];
      await exec(`CREATE TABLE IF NOT EXISTS ${q(entity.tableName)} (${defs.join(', ')})`);
    } else {
      if (!existing.has('createdAt')) {
        await exec(`ALTER TABLE ${q(entity.tableName)} ADD COLUMN ${q('createdAt')} TEXT`);
      }
      if (!existing.has('updatedAt')) {
        await exec(`ALTER TABLE ${q(entity.tableName)} ADD COLUMN ${q('updatedAt')} TEXT`);
      }
      for (const col of cols) {
        if (!existing.has(col.name)) {
          await exec(`ALTER TABLE ${q(entity.tableName)} ADD COLUMN ${stripConstraints(col.def)}`);
        }
      }
    }
  }

  // belongsToMany junction tables
  for (const entity of Object.values(core.entities)) {
    for (const rel of entity.belongsToMany || []) {
      const relName = typeof rel === 'string' ? rel : (rel.entity || rel.name);
      const relEntity = core.entities[relName];
      if (!relEntity) continue;
      const [a, b] = [entity.tableName, relEntity.tableName].sort();
      const jt = `${a}_${b}`;
      if (!await getExistingColumns(jt)) {
        const aCol = `${q(`${a}_id`)} ${idColType()} REFERENCES ${q(a)}(id)`;
        const bCol = `${q(`${b}_id`)} ${idColType()} REFERENCES ${q(b)}(id)`;
        await exec(
          `CREATE TABLE IF NOT EXISTS ${q(jt)} (${aCol}, ${bCol}, PRIMARY KEY (${q(`${a}_id`)}, ${q(`${b}_id`)}))`
        );
      }
    }
  }
}

// ─── Filter parsing ───────────────────────────────────────────────────────────

const FILTER_SUFFIXES = {
  _eq:   (col, val) => ({ sql: `${q(col)} = ?`,    val }),
  _neq:  (col, val) => ({ sql: `${q(col)} != ?`,   val }),
  _gt:   (col, val) => ({ sql: `${q(col)} > ?`,    val }),
  _gte:  (col, val) => ({ sql: `${q(col)} >= ?`,   val }),
  _lt:   (col, val) => ({ sql: `${q(col)} < ?`,    val }),
  _lte:  (col, val) => ({ sql: `${q(col)} <= ?`,   val }),
  _like: (col, val) => ({ sql: `${q(col)} LIKE ?`, val }),
  _in:   (col, val) => {
    const items = String(val).split(',');
    return { sql: `${q(col)} IN (${items.map(() => '?').join(',')})`, val: items };
  },
};

function parseFilters(query, validColumns) {
  const clauses = [];
  const values = [];
  const reserved = new Set(['page', 'perPage', 'orderBy', 'order', 'relations']);

  for (const [key, val] of Object.entries(query)) {
    if (reserved.has(key)) continue;

    let matched = false;
    for (const [suffix, builder] of Object.entries(FILTER_SUFFIXES)) {
      if (key.endsWith(suffix)) {
        const col = key.slice(0, -suffix.length);
        if (validColumns.has(col)) {
          const result = builder(col, val);
          clauses.push(result.sql);
          if (Array.isArray(result.val)) values.push(...result.val);
          else values.push(result.val);
        }
        matched = true;
        break;
      }
    }

    if (!matched && validColumns.has(key)) {
      clauses.push(`${q(key)} = ?`);
      values.push(val);
    }
  }

  return { clauses, values };
}

// ─── Column introspection (for CRUD query safety) ─────────────────────────────

async function getValidColumns(table) {
  if (DB_ENGINE === 'postgres') {
    const rows = await queryAll(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?`,
      [table]
    );
    return new Set(rows.map((r) => r.column_name));
  }
  if (DB_ENGINE === 'mysql') {
    const rows = await queryAll(
      `SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?`,
      [table]
    );
    return new Set(rows.map((r) => r.COLUMN_NAME || r.column_name));
  }
  return new Set(_sqliteDb.pragma(`table_info("${table}")`).map((r) => r.name));
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

async function findAll(table, query = {}, opts = {}) {
  const validCols = await getValidColumns(table);
  const { clauses, values } = parseFilters(query, validCols);

  let sql = `SELECT * FROM ${q(table)}`;
  if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;

  // Count total — build before adding ORDER BY (PostgreSQL disallows ORDER BY in aggregate queries)
  const countSql = sql.replace(/^SELECT \*/, 'SELECT COUNT(*) as total');
  const countRow = await queryOne(countSql, values);

  // Ordering (added after count so the count query stays clean)
  const SAFE_COL = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  const orderBy = opts.orderBy || 'createdAt';
  const orderDir = (opts.order || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  if (validCols.has(orderBy) && SAFE_COL.test(orderBy)) {
    sql += ` ORDER BY ${q(orderBy)} ${orderDir}`;
  }
  const total = Number(countRow.total);

  // Pagination
  const page = Math.max(1, parseInt(opts.page, 10) || 1);
  const perPage = Math.min(1000, Math.max(1, parseInt(opts.perPage, 10) || 10));
  const offset = (page - 1) * perPage;
  sql += ` LIMIT ? OFFSET ?`;

  const data = await queryAll(sql, [...values, perPage, offset]);
  const lastPage = Math.max(1, Math.ceil(total / perPage));

  return {
    data,
    currentPage: page,
    lastPage,
    from: total > 0 ? offset + 1 : 0,
    to: Math.min(offset + perPage, total),
    total,
    perPage,
  };
}

async function findAllSimple(table, filters = {}) {
  const keys = Object.keys(filters);
  if (!keys.length) return queryAll(`SELECT * FROM ${q(table)}`, []);
  const validCols = await getValidColumns(table);
  const safe = Object.fromEntries(keys.filter((k) => validCols.has(k)).map((k) => [k, filters[k]]));
  if (!Object.keys(safe).length) return queryAll(`SELECT * FROM ${q(table)}`, []);
  const where = Object.keys(safe).map((k) => `${q(k)} = ?`).join(' AND ');
  return queryAll(`SELECT * FROM ${q(table)} WHERE ${where}`, Object.values(safe));
}

async function findById(table, id) {
  return queryOne(`SELECT * FROM ${q(table)} WHERE ${q('id')} = ?`, [id]);
}

async function create(table, data) {
  const now = new Date().toISOString();
  const id = generateUUID();
  const full = { id, createdAt: now, updatedAt: now, ...data };
  const keys = Object.keys(full);
  const cols = keys.map((k) => q(k)).join(', ');
  const ph = keys.map(() => '?').join(', ');
  await queryRun(`INSERT INTO ${q(table)} (${cols}) VALUES (${ph})`, Object.values(full));
  return findById(table, id);
}

async function update(table, id, data) {
  const now = new Date().toISOString();
  const full = { ...data, updatedAt: now };
  const keys = Object.keys(full);
  if (!keys.length) return findById(table, id);
  const set = keys.map((k) => `${q(k)} = ?`).join(', ');
  await queryRun(`UPDATE ${q(table)} SET ${set} WHERE ${q('id')} = ?`, [...Object.values(full), id]);
  return findById(table, id);
}

async function remove(table, id) {
  const existing = await findById(table, id);
  if (!existing) return null;
  await queryRun(`DELETE FROM ${q(table)} WHERE ${q('id')} = ?`, [id]);
  return existing;
}

// ─── Relation helpers ─────────────────────────────────────────────────────────

async function loadRelations(row, entity, relationNames) {
  if (!row || !entity || !relationNames || !_core) return row;
  const names = Array.isArray(relationNames)
    ? relationNames
    : relationNames.split(',').map((s) => s.trim());

  for (const relName of names) {
    // belongsTo
    const btRel = (entity.belongsTo || []).find((r) => {
      const rName = typeof r === 'string' ? r : (r.name || r.entity);
      return rName.toLowerCase() === relName.toLowerCase();
    });
    if (btRel) {
      const relEntityName = typeof btRel === 'string' ? btRel : (btRel.entity || btRel.name);
      const relEntity = _core.entities[relEntityName];
      if (relEntity) {
        const fk = `${relEntity.tableName}_id`;
        row[relName] = row[fk] ? await findById(relEntity.tableName, row[fk]) : null;
      }
      continue;
    }

    // belongsToMany
    const btmRel = (entity.belongsToMany || []).find((r) => {
      const rName = typeof r === 'string' ? r : (r.name || r.entity);
      return rName.toLowerCase() === relName.toLowerCase();
    });
    if (btmRel) {
      const relEntityName = typeof btmRel === 'string' ? btmRel : (btmRel.entity || btmRel.name);
      const relEntity = _core.entities[relEntityName];
      if (relEntity) {
        const [a, b] = [entity.tableName, relEntity.tableName].sort();
        const jt = `${a}_${b}`;
        const myCol = `${entity.tableName}_id`;
        const otherCol = `${relEntity.tableName}_id`;
        row[relName] = await queryAll(
          `SELECT t.* FROM ${q(relEntity.tableName)} t JOIN ${q(jt)} j ON j.${q(otherCol)} = t.id WHERE j.${q(myCol)} = ?`,
          [row.id]
        );
      }
      continue;
    }

    // hasMany (reverse belongsTo)
    for (const otherEntity of Object.values(_core.entities)) {
      const reverseRel = (otherEntity.belongsTo || []).find((r) => {
        const rEntity = typeof r === 'string' ? r : (r.entity || r.name);
        return rEntity === entity.name;
      });
      if (reverseRel && otherEntity.slug.toLowerCase() === relName.toLowerCase()) {
        const fk = `${entity.tableName}_id`;
        row[relName] = await queryAll(
          `SELECT * FROM ${q(otherEntity.tableName)} WHERE ${q(fk)} = ?`,
          [row.id]
        );
        break;
      }
    }
  }

  return row;
}

async function saveBelongsToMany(entity, recordId, body) {
  if (!_core) return;
  for (const rel of entity.belongsToMany || []) {
    const relEntityName = typeof rel === 'string' ? rel : (rel.entity || rel.name);
    const relEntity = _core.entities[relEntityName];
    if (!relEntity) continue;

    const idsKey = `${relEntityName.charAt(0).toLowerCase() + relEntityName.slice(1)}Ids`;
    const ids = body[idsKey];
    if (!Array.isArray(ids)) continue;

    const [a, b] = [entity.tableName, relEntity.tableName].sort();
    const jt = `${a}_${b}`;
    const myCol = `${entity.tableName}_id`;
    const otherCol = `${relEntity.tableName}_id`;

    // Clear existing
    await queryRun(`DELETE FROM ${q(jt)} WHERE ${q(myCol)} = ?`, [recordId]);

    // Insert new
    const insertSql = buildInsertOrIgnoreSql(jt, myCol, otherCol);
    for (const otherId of ids) {
      await queryRun(insertSql, [recordId, otherId]);
    }
  }
}

async function closeDb() {
  if (_pgPool)    { try { await _pgPool.end(); } finally { _pgPool = null; } }
  if (_mysqlPool) { try { await _mysqlPool.end(); } finally { _mysqlPool = null; } }
  if (_sqliteDb)  { try { _sqliteDb.close(); } finally { _sqliteDb = null; } }
}

module.exports = {
  DB_ENGINE, q, sqlType, idColType, authStrType, toPgPlaceholders,
  initDb, syncSchema, getDb, generateUUID, closeDb,
  exec, queryAll, queryOne, queryRun,
  findAll, findAllSimple, findById, create, update, remove,
  loadRelations, saveBelongsToMany,
};
