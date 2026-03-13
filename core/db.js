'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

let db = null;

/**
 * Initialize SQLite database and create tables for all entities.
 */
function initDb(core, dbPath) {
  const resolved = dbPath ? path.resolve(dbPath) : path.resolve('chadstart.db');
  db = new Database(resolved);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  logger.info(`Database initialized at ${resolved}`);
  syncSchema(core);
  return db;
}

/**
 * Create or migrate tables to match the current entity definitions.
 * Uses a simple additive migration: adds missing columns, never drops.
 */
function syncSchema(core) {
  for (const entity of Object.values(core.entities)) {
    const cols = buildColumnDefs(entity, core.entities);
    const existing = getExistingColumns(entity.tableName);

    if (existing === null) {
      // Table does not exist - create it
      const colDefs = ['id INTEGER PRIMARY KEY AUTOINCREMENT', ...cols.map((c) => c.def)];
      const sql = `CREATE TABLE "${entity.tableName}" (${colDefs.join(', ')})`;
      db.exec(sql);
      logger.debug(`Created table: ${entity.tableName}`);
    } else {
      // Table exists - add any missing columns
      for (const col of cols) {
        if (!existing.has(col.name)) {
          db.exec(`ALTER TABLE "${entity.tableName}" ADD COLUMN ${col.def}`);
          logger.debug(`Added column ${col.name} to ${entity.tableName}`);
        }
      }
    }
  }
}

function getExistingColumns(tableName) {
  try {
    const rows = db.pragma(`table_info("${tableName}")`);
    if (!rows || rows.length === 0) return null;
    return new Set(rows.map((r) => r.name));
  } catch {
    return null;
  }
}

function buildColumnDefs(entity, allEntities) {
  const cols = [];

  for (const prop of entity.properties) {
    const sqlType = propTypeToSql(prop.type);
    cols.push({ name: prop.name, def: `"${prop.name}" ${sqlType}` });
  }

  for (const rel of entity.belongsTo) {
    const relName = typeof rel === 'string' ? rel : rel;
    const refEntity = allEntities[relName];
    if (refEntity) {
      const fkCol = `${refEntity.tableName}_id`;
      cols.push({
        name: fkCol,
        def: `"${fkCol}" INTEGER REFERENCES "${refEntity.tableName}"(id)`,
      });
    }
  }

  return cols;
}

function propTypeToSql(type) {
  const map = {
    text: 'TEXT',
    string: 'TEXT',
    integer: 'INTEGER',
    int: 'INTEGER',
    number: 'REAL',
    float: 'REAL',
    real: 'REAL',
    boolean: 'INTEGER',
    bool: 'INTEGER',
    date: 'TEXT',
    json: 'TEXT',
  };
  return map[type] || 'TEXT';
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

// ─── CRUD helpers ────────────────────────────────────────────────────────────

function findAll(tableName, filters = {}) {
  const db = getDb();
  const keys = Object.keys(filters);
  if (keys.length === 0) {
    return db.prepare(`SELECT * FROM "${tableName}"`).all();
  }
  // Validate column names against the actual table schema to prevent SQL injection
  const validCols = new Set(
    db.pragma(`table_info("${tableName}")`).map((r) => r.name)
  );
  const safeFilters = {};
  for (const k of keys) {
    if (validCols.has(k)) safeFilters[k] = filters[k];
  }
  if (Object.keys(safeFilters).length === 0) {
    return db.prepare(`SELECT * FROM "${tableName}"`).all();
  }
  const where = Object.keys(safeFilters).map((k) => `"${k}" = ?`).join(' AND ');
  return db
    .prepare(`SELECT * FROM "${tableName}" WHERE ${where}`)
    .all(...Object.values(safeFilters));
}

function findById(tableName, id) {
  const db = getDb();
  return db.prepare(`SELECT * FROM "${tableName}" WHERE id = ?`).get(id) || null;
}

function create(tableName, data) {
  const db = getDb();
  const keys = Object.keys(data);
  if (keys.length === 0) {
    const result = db.prepare(`INSERT INTO "${tableName}" DEFAULT VALUES`).run();
    return findById(tableName, result.lastInsertRowid);
  }
  const cols = keys.map((k) => `"${k}"`).join(', ');
  const placeholders = keys.map(() => '?').join(', ');
  const result = db
    .prepare(`INSERT INTO "${tableName}" (${cols}) VALUES (${placeholders})`)
    .run(...Object.values(data));
  return findById(tableName, result.lastInsertRowid);
}

function update(tableName, id, data) {
  const db = getDb();
  const keys = Object.keys(data);
  if (keys.length === 0) return findById(tableName, id);
  const set = keys.map((k) => `"${k}" = ?`).join(', ');
  db.prepare(`UPDATE "${tableName}" SET ${set} WHERE id = ?`).run(...Object.values(data), id);
  return findById(tableName, id);
}

function remove(tableName, id) {
  const db = getDb();
  const existing = findById(tableName, id);
  if (!existing) return null;
  db.prepare(`DELETE FROM "${tableName}" WHERE id = ?`).run(id);
  return existing;
}

module.exports = { initDb, syncSchema, getDb, findAll, findById, create, update, remove };
