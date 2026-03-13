'use strict';

const crypto = require('crypto');
const fs = require('fs');
const Database = require('better-sqlite3');
const path = require('path');
const logger = require('../utils/logger');

let db = null;
// Cached entity metadata for relation queries. Set by initDb.
let _core = null;

const SQL_TYPE = {
  text: 'TEXT', string: 'TEXT', richText: 'TEXT',
  integer: 'INTEGER', int: 'INTEGER',
  number: 'REAL', float: 'REAL', real: 'REAL', money: 'REAL',
  boolean: 'INTEGER', bool: 'INTEGER',
  date: 'TEXT', timestamp: 'TEXT', email: 'TEXT', link: 'TEXT',
  password: 'TEXT', choice: 'TEXT', location: 'TEXT',
  file: 'TEXT', image: 'TEXT', group: 'TEXT', json: 'TEXT',
};

function generateUUID() {
  return crypto.randomUUID();
}

function initDb(core, dbPath) {
  const resolved = dbPath ? path.resolve(dbPath) : path.resolve(process.env.DB_PATH || 'chadstart.db');
  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
  } catch (err) {
    throw new Error(`Failed to create database directory "${path.dirname(resolved)}": ${err.message}`);
  }
  try {
    db = new Database(resolved);
  } catch (err) {
    throw new Error(
      `Failed to open database at "${resolved}": ${err.message}\n` +
      `  Make sure the directory exists and is writable, and that no other process has an exclusive lock on the file.`
    );
  }
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  _core = core;
  logger.info(`Database initialized at ${resolved}`);
  syncSchema(core);
  return db;
}

function syncSchema(core) {
  for (const entity of Object.values(core.entities)) {
    const cols = buildColumnDefs(entity, core.entities);
    const existing = getExistingColumns(entity.tableName);

    if (!existing) {
      const defs = ['"id" TEXT PRIMARY KEY', '"createdAt" TEXT', '"updatedAt" TEXT', ...cols.map((c) => c.def)];
      db.exec(`CREATE TABLE "${entity.tableName}" (${defs.join(', ')})`);
    } else {
      // Add createdAt/updatedAt if missing (migration)
      if (!existing.has('createdAt')) {
        db.exec(`ALTER TABLE "${entity.tableName}" ADD COLUMN "createdAt" TEXT`);
      }
      if (!existing.has('updatedAt')) {
        db.exec(`ALTER TABLE "${entity.tableName}" ADD COLUMN "updatedAt" TEXT`);
      }
      for (const col of cols) {
        if (!existing.has(col.name)) {
          db.exec(`ALTER TABLE "${entity.tableName}" ADD COLUMN ${stripConstraints(col.def)}`);
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
      if (!getExistingColumns(jt)) {
        db.exec(
          `CREATE TABLE "${jt}" ("${a}_id" TEXT REFERENCES "${a}"(id), "${b}_id" TEXT REFERENCES "${b}"(id), PRIMARY KEY ("${a}_id", "${b}_id"))`
        );
      }
    }
  }
}

function getExistingColumns(table) {
  try {
    const rows = db.pragma(`table_info("${table}")`);
    return rows && rows.length ? new Set(rows.map((r) => r.name)) : null;
  } catch { return null; }
}

function stripConstraints(def) {
  return def.replace(/\bNOT\s+NULL\b/gi, '').replace(/\bUNIQUE\b/gi, '')
    .replace(/\bREFERENCES\s+"[^"]+"\([^)]+\)/gi, '').replace(/\s{2,}/g, ' ').trim();
}

function buildColumnDefs(entity, allEntities) {
  const cols = [];

  if (entity.authenticable) {
    cols.push({ name: 'email', def: '"email" TEXT NOT NULL UNIQUE' });
    cols.push({ name: 'password', def: '"password" TEXT NOT NULL' });
  }

  for (const p of entity.properties) {
    cols.push({ name: p.name, def: `"${p.name}" ${SQL_TYPE[p.type] || 'TEXT'}` });
  }

  for (const rel of entity.belongsTo || []) {
    const relName = typeof rel === 'string' ? rel : (rel.entity || rel.name);
    const ref = allEntities[relName];
    if (ref) {
      const fk = `${ref.tableName}_id`;
      cols.push({ name: fk, def: `"${fk}" TEXT REFERENCES "${ref.tableName}"(id)` });
    }
  }

  return cols;
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

// ─── Filter parsing ──────────────────────────────────────────────────────────

const FILTER_SUFFIXES = {
  _eq:   (col, val) => ({ sql: `"${col}" = ?`, val }),
  _neq:  (col, val) => ({ sql: `"${col}" != ?`, val }),
  _gt:   (col, val) => ({ sql: `"${col}" > ?`, val }),
  _gte:  (col, val) => ({ sql: `"${col}" >= ?`, val }),
  _lt:   (col, val) => ({ sql: `"${col}" < ?`, val }),
  _lte:  (col, val) => ({ sql: `"${col}" <= ?`, val }),
  _like: (col, val) => ({ sql: `"${col}" LIKE ?`, val }),
  _in:   (col, val) => {
    const items = String(val).split(',');
    return { sql: `"${col}" IN (${items.map(() => '?').join(',')})`, val: items };
  },
};

/**
 * Parse query string params into filter clauses.
 * Supports: prop=val (exact match), prop_eq=val, prop_gt=val, etc.
 */
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

    // Exact match (no suffix)
    if (!matched && validColumns.has(key)) {
      clauses.push(`"${key}" = ?`);
      values.push(val);
    }
  }

  return { clauses, values };
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

/**
 * Query rows with filter suffixes, ordering, and pagination.
 * opts: { page, perPage, orderBy, order, relations }
 */
function findAll(table, query = {}, opts = {}) {
  const d = getDb();
  const validCols = new Set(d.pragma(`table_info("${table}")`).map((r) => r.name));
  const { clauses, values } = parseFilters(query, validCols);

  let sql = `SELECT * FROM "${table}"`;
  if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`;

  // Ordering — only allow column names that exist and match safe pattern
  const SAFE_COL = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  const orderBy = opts.orderBy || 'createdAt';
  const orderDir = (opts.order || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  if (validCols.has(orderBy) && SAFE_COL.test(orderBy)) {
    sql += ` ORDER BY "${orderBy}" ${orderDir}`;
  }

  // Count total before pagination
  const countSql = sql.replace(/^SELECT \*/, 'SELECT COUNT(*) as total');
  const total = d.prepare(countSql).get(...values).total;

  // Pagination
  const page = Math.max(1, parseInt(opts.page, 10) || 1);
  const perPage = Math.min(1000, Math.max(1, parseInt(opts.perPage, 10) || 10));
  const offset = (page - 1) * perPage;
  sql += ` LIMIT ? OFFSET ?`;

  const data = d.prepare(sql).all(...values, perPage, offset);
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

/**
 * Simple findAll without pagination for internal use (e.g., auth lookups).
 */
function findAllSimple(table, filters = {}) {
  const d = getDb();
  const keys = Object.keys(filters);
  if (!keys.length) return d.prepare(`SELECT * FROM "${table}"`).all();
  const valid = new Set(d.pragma(`table_info("${table}")`).map((r) => r.name));
  const safe = Object.fromEntries(keys.filter((k) => valid.has(k)).map((k) => [k, filters[k]]));
  if (!Object.keys(safe).length) return d.prepare(`SELECT * FROM "${table}"`).all();
  const where = Object.keys(safe).map((k) => `"${k}" = ?`).join(' AND ');
  return d.prepare(`SELECT * FROM "${table}" WHERE ${where}`).all(...Object.values(safe));
}

function findById(table, id) {
  return getDb().prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id) || null;
}

function create(table, data) {
  const d = getDb();
  const now = new Date().toISOString();
  const id = generateUUID();
  const full = { id, createdAt: now, updatedAt: now, ...data };
  const keys = Object.keys(full);
  const cols = keys.map((k) => `"${k}"`).join(', ');
  const ph = keys.map(() => '?').join(', ');
  d.prepare(`INSERT INTO "${table}" (${cols}) VALUES (${ph})`).run(...Object.values(full));
  return findById(table, id);
}

function update(table, id, data) {
  const now = new Date().toISOString();
  const full = { ...data, updatedAt: now };
  const keys = Object.keys(full);
  if (!keys.length) return findById(table, id);
  const set = keys.map((k) => `"${k}" = ?`).join(', ');
  getDb().prepare(`UPDATE "${table}" SET ${set} WHERE id = ?`).run(...Object.values(full), id);
  return findById(table, id);
}

function remove(table, id) {
  const existing = findById(table, id);
  if (!existing) return null;
  getDb().prepare(`DELETE FROM "${table}" WHERE id = ?`).run(id);
  return existing;
}

// ─── Relation helpers ────────────────────────────────────────────────────────

/**
 * Load relations for a single row. Mutates the row in-place.
 * relationNames: comma-separated string or array.
 */
function loadRelations(row, entity, relationNames) {
  if (!row || !entity || !relationNames || !_core) return row;
  const names = Array.isArray(relationNames) ? relationNames : relationNames.split(',').map((s) => s.trim());

  for (const relName of names) {
    // belongsTo: look up the FK column
    const btRel = (entity.belongsTo || []).find((r) => {
      const rName = typeof r === 'string' ? r : (r.name || r.entity);
      return rName.toLowerCase() === relName.toLowerCase();
    });
    if (btRel) {
      const relEntityName = typeof btRel === 'string' ? btRel : (btRel.entity || btRel.name);
      const relEntity = _core.entities[relEntityName];
      if (relEntity) {
        const fk = `${relEntity.tableName}_id`;
        if (row[fk]) {
          row[relName] = findById(relEntity.tableName, row[fk]);
        } else {
          row[relName] = null;
        }
      }
      continue;
    }

    // belongsToMany: look up junction table
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
        const related = getDb()
          .prepare(`SELECT t.* FROM "${relEntity.tableName}" t JOIN "${jt}" j ON j."${otherCol}" = t.id WHERE j."${myCol}" = ?`)
          .all(row.id);
        row[relName] = related;
      }
      continue;
    }

    // hasMany (reverse belongsTo): another entity belongsTo this entity
    for (const otherEntity of Object.values(_core.entities)) {
      const reverseRel = (otherEntity.belongsTo || []).find((r) => {
        const rEntity = typeof r === 'string' ? r : (r.entity || r.name);
        return rEntity === entity.name;
      });
      if (reverseRel && otherEntity.slug.toLowerCase() === relName.toLowerCase()) {
        const fk = `${entity.tableName}_id`;
        row[relName] = getDb()
          .prepare(`SELECT * FROM "${otherEntity.tableName}" WHERE "${fk}" = ?`)
          .all(row.id);
        break;
      }
    }
  }

  return row;
}

/**
 * Store belongsToMany relations for a record.
 * body may contain keys like `skillIds: [id1, id2]`.
 */
function saveBelongsToMany(entity, recordId, body) {
  if (!_core) return;
  for (const rel of entity.belongsToMany || []) {
    const relEntityName = typeof rel === 'string' ? rel : (rel.entity || rel.name);
    const relEntity = _core.entities[relEntityName];
    if (!relEntity) continue;

    // Convention: entityIds (camelCase plural)
    const idsKey = `${relEntityName.charAt(0).toLowerCase() + relEntityName.slice(1)}Ids`;
    const ids = body[idsKey];
    if (!Array.isArray(ids)) continue;

    const [a, b] = [entity.tableName, relEntity.tableName].sort();
    const jt = `${a}_${b}`;
    const myCol = `${entity.tableName}_id`;
    const otherCol = `${relEntity.tableName}_id`;

    // Clear existing
    getDb().prepare(`DELETE FROM "${jt}" WHERE "${myCol}" = ?`).run(recordId);

    // Insert new
    const ins = getDb().prepare(`INSERT OR IGNORE INTO "${jt}" ("${myCol}", "${otherCol}") VALUES (?, ?)`);
    for (const otherId of ids) ins.run(recordId, otherId);
  }
}

module.exports = {
  initDb, syncSchema, getDb, generateUUID,
  findAll, findAllSimple, findById, create, update, remove,
  loadRelations, saveBelongsToMany,
};
