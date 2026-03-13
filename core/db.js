'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const logger = require('../utils/logger');

let db = null;

const SQL_TYPE = {
  text: 'TEXT', string: 'TEXT', richText: 'TEXT',
  integer: 'INTEGER', int: 'INTEGER',
  number: 'REAL', float: 'REAL', real: 'REAL', money: 'REAL',
  boolean: 'INTEGER', bool: 'INTEGER',
  date: 'TEXT', timestamp: 'TEXT', email: 'TEXT', link: 'TEXT',
  password: 'TEXT', choice: 'TEXT', location: 'TEXT',
  file: 'TEXT', image: 'TEXT', group: 'TEXT', json: 'TEXT',
};

function initDb(core, dbPath) {
  const resolved = dbPath ? path.resolve(dbPath) : path.resolve('chadstart.db');
  db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  logger.info(`Database initialized at ${resolved}`);
  syncSchema(core);
  return db;
}

function syncSchema(core) {
  for (const entity of Object.values(core.entities)) {
    const cols = buildColumnDefs(entity, core.entities);
    const existing = getExistingColumns(entity.tableName);

    if (!existing) {
      const defs = ['id INTEGER PRIMARY KEY AUTOINCREMENT', ...cols.map((c) => c.def)];
      db.exec(`CREATE TABLE "${entity.tableName}" (${defs.join(', ')})`);
    } else {
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
          `CREATE TABLE "${jt}" ("${a}_id" INTEGER REFERENCES "${a}"(id), "${b}_id" INTEGER REFERENCES "${b}"(id), PRIMARY KEY ("${a}_id", "${b}_id"))`
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
      cols.push({ name: fk, def: `"${fk}" INTEGER REFERENCES "${ref.tableName}"(id)` });
    }
  }

  return cols;
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

function findAll(table, filters = {}) {
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
  const keys = Object.keys(data);
  if (!keys.length) {
    const r = d.prepare(`INSERT INTO "${table}" DEFAULT VALUES`).run();
    return findById(table, r.lastInsertRowid);
  }
  const cols = keys.map((k) => `"${k}"`).join(', ');
  const ph = keys.map(() => '?').join(', ');
  const r = d.prepare(`INSERT INTO "${table}" (${cols}) VALUES (${ph})`).run(...Object.values(data));
  return findById(table, r.lastInsertRowid);
}

function update(table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) return findById(table, id);
  const set = keys.map((k) => `"${k}" = ?`).join(', ');
  getDb().prepare(`UPDATE "${table}" SET ${set} WHERE id = ?`).run(...Object.values(data), id);
  return findById(table, id);
}

function remove(table, id) {
  const existing = findById(table, id);
  if (!existing) return null;
  getDb().prepare(`DELETE FROM "${table}" WHERE id = ?`).run(id);
  return existing;
}

module.exports = { initDb, syncSchema, getDb, findAll, findById, create, update, remove };
