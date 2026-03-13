'use strict';

/**
 * Seeder — generates dummy data for all entities defined in the YAML config.
 * Each entity can set `seedCount` (default: 50) to control how many records
 * are created per run.
 */

const bcrypt = require('bcryptjs');
const { create, findAllSimple } = require('./db');

const ADMIN_EMAIL = 'admin@chadstart.com';
const ADMIN_PASSWORD = 'admin';

// ─── Dummy value generators ──────────────────────────────────────────────────

const WORDS = [
  'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel',
  'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa',
  'quebec', 'romeo', 'sierra', 'tango', 'uniform', 'victor', 'whiskey',
  'xray', 'yankee', 'zulu',
];

let _counter = 0;

function nextId() {
  return ++_counter;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomWord() {
  return WORDS[randomInt(0, WORDS.length - 1)];
}

function randomWords(count) {
  return Array.from({ length: count }, randomWord).join(' ');
}

function fakeValueForProp(prop, idx, groups = {}) {
  const { name, type, options } = prop;
  const n = idx + 1;

  if (options && Array.isArray(options) && options.length > 0) {
    return options[randomInt(0, options.length - 1)];
  }

  switch (type) {
    case 'string':
      return `${name} ${n} ${randomWord()}`;
    case 'text':
    case 'richText':
      return `${randomWords(4)} ${n}. ${randomWords(5)}.`;
    case 'integer':
    case 'int':
      return randomInt(1, 1000);
    case 'number':
    case 'float':
    case 'real':
    case 'money':
      return Math.round(randomInt(1, 10000) * 0.01 * 100) / 100;
    case 'boolean':
    case 'bool':
      return randomInt(0, 1);
    case 'date':
      return new Date(Date.now() - randomInt(0, 365) * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
    case 'timestamp':
      return new Date(Date.now() - randomInt(0, 365) * 24 * 60 * 60 * 1000).toISOString();
    case 'email':
      return `${randomWord()}${n}@example.com`;
    case 'link':
      return `https://example.com/${randomWord()}/${n}`;
    case 'password':
      return `password${n}`;
    case 'choice':
      return randomWord();
    case 'location': {
      const lat = (randomInt(-9000, 9000) / 100).toFixed(2);
      const lng = (randomInt(-18000, 18000) / 100).toFixed(2);
      return `${lat},${lng}`;
    }
    case 'file':
    case 'image':
      return `/uploads/placeholder-${n}.png`;
    case 'json':
      return JSON.stringify({ id: n, value: randomWord() });
    case 'group': {
      const groupName = options && options.group;
      const groupDef = groups && groupName ? groups[groupName] : null;
      if (groupDef && groupDef.properties) {
        const multiple = !options || options.multiple !== false;
        const count = multiple ? 2 : 1;
        const items = Array.from({ length: count }, (_, j) =>
          groupDef.properties.reduce((item, gp) => {
            item[gp.name] = fakeValueForProp(gp, j, groups);
            return item;
          }, {})
        );
        return JSON.stringify(multiple ? items : items[0]);
      }
      return JSON.stringify([]);
    }
    default:
      return `${name} ${n} ${randomWord()}`;
  }
}

// ─── Topological sort ────────────────────────────────────────────────────────

/**
 * Sort entities so that parents always come before their dependents.
 * This ensures belongsTo FK references can be resolved.
 */
function sortByDependency(entities) {
  const names = Object.keys(entities);
  const visited = new Set();
  const sorted = [];

  function visit(name) {
    if (visited.has(name)) return;
    visited.add(name);
    const entity = entities[name];
    for (const rel of entity.belongsTo || []) {
      const parent = typeof rel === 'string' ? rel : (rel.entity || rel.name);
      if (entities[parent]) visit(parent);
    }
    sorted.push(name);
  }

  for (const name of names) visit(name);
  return sorted;
}

// ─── Main seed function ──────────────────────────────────────────────────────

/**
 * Seed all entities in `core`.
 * Returns a summary map: { EntityName: count }.
 */
async function seedAll(core) {
  _counter = 0;
  const sortedNames = sortByDependency(core.entities);
  const summary = {};

  // Track seeded ids per entity for FK resolution
  const seededIds = {};

  for (const entityName of sortedNames) {
    const entity = core.entities[entityName];

    // Singles are singleton records — only seed once if table is empty.
    // We still respect seedCount=1 implicitly.
    const count = entity.single ? 1 : (entity.seedCount || 50);

    const ids = [];

    for (let i = 0; i < count; i++) {
      const record = {};

      // Authenticable entities need email + (hashed) password
      if (entity.authenticable) {
        const n = nextId();
        record.email = `${entityName.toLowerCase()}${n}@example.com`;
        record.password = bcrypt.hashSync(`password${n}`, 10);
      }

      // Regular properties
      for (const prop of entity.properties) {
        if (prop.type === 'password') {
          record[prop.name] = bcrypt.hashSync(fakeValueForProp(prop, i, core.groups), 10);
        } else {
          record[prop.name] = fakeValueForProp(prop, i, core.groups);
        }
      }

      // BelongsTo FK: pick a random seeded parent id
      for (const rel of entity.belongsTo || []) {
        const parentName = typeof rel === 'string' ? rel : (rel.entity || rel.name);
        const parentEntity = core.entities[parentName];
        if (parentEntity && seededIds[parentName] && seededIds[parentName].length > 0) {
          const fk = `${parentEntity.tableName}_id`;
          const parentIds = seededIds[parentName];
          record[fk] = parentIds[randomInt(0, parentIds.length - 1)];
        }
      }

      const created = create(entity.tableName, record);
      ids.push(created.id);
    }

    seededIds[entityName] = ids;
    summary[entityName] = ids.length;
  }

  // Create the admin@chadstart.com user in every authenticable entity
  const adminUsers = [];
  for (const entity of Object.values(core.authenticableEntities || {})) {
    const existing = findAllSimple(entity.tableName, { email: ADMIN_EMAIL });
    if (existing.length === 0) {
      const extraProps = entity.properties.reduce((acc, prop) => {
        if (prop.type !== 'password') {
          acc[prop.name] = fakeValueForProp(prop, 0, core.groups);
        }
        return acc;
      }, {});
      create(entity.tableName, {
        email: ADMIN_EMAIL,
        password: bcrypt.hashSync(ADMIN_PASSWORD, 10),
        ...extraProps,
      });
      adminUsers.push(entity.name);
    }
  }

  return { summary, adminEmail: ADMIN_EMAIL, adminPassword: ADMIN_PASSWORD, adminEntities: adminUsers };
}

module.exports = { seedAll, ADMIN_EMAIL, ADMIN_PASSWORD };
