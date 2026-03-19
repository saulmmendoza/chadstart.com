'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { toSnakeCase } = require('./entity-engine');
const { requireAuth, optionalAuth, omitPassword, JWT_SECRET, resolveAuthHeader } = require('./auth');
const logger = require('../utils/logger');

/**
 * Create a backend SDK for use in middleware and custom endpoint functions.
 * Provides a `from(slug)` interface for CRUD and a `single(slug)` interface
 * for single-record entities — the same API as the front-end JS SDK.
 */
function createBackendSdk(core) {
  return {
    from(slug) {
      const entity = Object.values(core.entities).find(
        (e) => e.slug === slug || e.slug + 's' === slug || slug === e.tableName
      );
      if (!entity) throw new Error(`Entity not found for slug: ${slug}`);
      const table = entity.tableName;
      return {
        find(opts) { return db.findAll(table, {}, opts || {}); },
        findOneById(id) { return db.findById(table, id); },
        create(data) { return db.create(table, data); },
        update(id, data) { return db.update(table, id, data); },
        patch(id, data) { return db.update(table, id, data); },
        delete(id) { return db.remove(table, id); },
      };
    },
    single(slug) {
      const entity = Object.values(core.entities).find(
        (e) => (e.slug === slug || e.tableName === slug) && e.single
      );
      if (!entity) throw new Error(`Single entity not found for slug: ${slug}`);
      const table = entity.tableName;
      return {
        get() {
          const rows = db.findAllSimple(table);
          return rows[0] || null;
        },
        update(data) {
          const rows = db.findAllSimple(table);
          if (!rows[0]) return null;
          return db.update(table, rows[0].id, data);
        },
        patch(data) {
          const rows = db.findAllSimple(table);
          if (!rows[0]) return null;
          return db.update(table, rows[0].id, data);
        },
      };
    },
  };
}

/**
 * Register CRUD REST routes for all entities.
 *
 * Collections: /api/collections/:slug
 * Singles:     /api/singles/:slug
 */
function registerApiRoutes(app, core, emit) {
  const router = express.Router();
  const sdk = createBackendSdk(core);

  for (const entity of Object.values(core.entities)) {
    const slug = entity.slug;
    const table = entity.tableName;
    const clean = entity.authenticable ? omitPassword : (r) => r;
    const hide = (row) => hideHiddenProps(deserializeGroupProps(clean(row), entity), entity);

    if (entity.single) {
      const base = `/singles/${slug}`;

      const mw = {
        read:   policyMiddleware('read', entity, core),
        update: policyMiddleware('update', entity, core),
      };

      // GET single
      router.get(base, mw.read, (_req, res) => {
        try {
          const rows = db.findAllSimple(table);
          const row = rows[0];
          if (!row) return res.status(404).json({ error: 'Not found' });
          res.json(hide(row));
        } catch (e) { res.status(500).json({ error: e.message }); }
      });

      // PUT single (full replace)
      router.put(base, mw.update, async (req, res) => {
        try {
          const rows = db.findAllSimple(table);
          const row = rows[0];
          if (!row) return res.status(404).json({ error: 'Not found' });
          if (!await runMiddlewares('beforeUpdate', entity, req, res, sdk)) return;
          const v = validateBody(req.body, entity, core.groups);
          if (v.errors) return res.status(400).json(v.errors);
          fireWebhooks(entity, 'beforeUpdate', req.body);
          const sanitized = sanitizeBody(req.body, entity, true);
          const updated = db.update(table, row.id, sanitized);
          fireWebhooks(entity, 'afterUpdate', updated);
          await runMiddlewares('afterUpdate', entity, req, res, sdk);
          emit(`${entity.name}.updated`, hide(updated));
          res.json(hide(updated));
        } catch (e) { res.status(400).json({ error: e.message }); }
      });

      // PATCH single (partial)
      router.patch(base, mw.update, async (req, res) => {
        try {
          const rows = db.findAllSimple(table);
          const row = rows[0];
          if (!row) return res.status(404).json({ error: 'Not found' });
          if (!await runMiddlewares('beforeUpdate', entity, req, res, sdk)) return;
          const v = validateBody(req.body, entity, core.groups, { partial: true });
          if (v.errors) return res.status(400).json(v.errors);
          fireWebhooks(entity, 'beforeUpdate', req.body);
          const updated = db.update(table, row.id, sanitizeBody(req.body, entity));
          fireWebhooks(entity, 'afterUpdate', updated);
          await runMiddlewares('afterUpdate', entity, req, res, sdk);
          emit(`${entity.name}.updated`, hide(updated));
          res.json(hide(updated));
        } catch (e) { res.status(400).json({ error: e.message }); }
      });

      logger.info(`  Registered single routes at /api/singles/${slug}`);
    } else {
      const base = `/collections/${slug}`;

      const mw = {
        create: policyMiddleware('create', entity, core),
        read:   policyMiddleware('read', entity, core),
        update: policyMiddleware('update', entity, core),
        delete: policyMiddleware('delete', entity, core),
      };

      // GET list (paginated)
      router.get(base, mw.read, (req, res) => {
        try {
          // Ownership filter: condition: self forces a FK filter on the current user
          const query = req._selfFilter
            ? { ...req.query, [req._selfFilter.fk]: req._selfFilter.userId }
            : req.query;
          const result = db.findAll(table, query, {
            page: req.query.page,
            perPage: req.query.perPage,
            orderBy: req.query.orderBy,
            order: req.query.order,
          });
          const relations = req.query.relations;
          result.data = result.data.map((row) => {
            if (relations) db.loadRelations(row, entity, relations);
            return hide(row);
          });
          res.json(result);
        } catch (e) { res.status(500).json({ error: e.message }); }
      });

      // GET single by id
      router.get(`${base}/:id`, mw.read, (req, res) => {
        try {
          const row = db.findById(table, req.params.id);
          if (!row) return res.status(404).json({ error: 'Not found' });
          // Ownership check for read with condition: self
          if (req._selfFilter && row[req._selfFilter.fk] !== req._selfFilter.userId) {
            return res.status(403).json({ error: 'Access denied' });
          }
          if (req.query.relations) db.loadRelations(row, entity, req.query.relations);
          res.json(hide(row));
        } catch (e) { res.status(500).json({ error: e.message }); }
      });

      // POST create
      router.post(base, mw.create, async (req, res) => {
        try {
          if (!await runMiddlewares('beforeCreate', entity, req, res, sdk)) return;
          const body = applyDefaults(req.body, entity);
          const v = validateBody(body, entity, core.groups);
          if (v.errors) return res.status(400).json(v.errors);
          fireWebhooks(entity, 'beforeCreate', body);
          const row = db.create(table, sanitizeBody(body, entity));
          db.saveBelongsToMany(entity, row.id, req.body);
          fireWebhooks(entity, 'afterCreate', row);
          await runMiddlewares('afterCreate', entity, req, res, sdk);
          emit(`${entity.name}.created`, hide(row));
          res.status(201).json(hide(row));
        } catch (e) { res.status(400).json({ error: e.message }); }
      });

      // PUT full replace
      router.put(`${base}/:id`, mw.update, async (req, res) => {
        try {
          if (!db.findById(table, req.params.id)) return res.status(404).json({ error: 'Not found' });
          if (!await runMiddlewares('beforeUpdate', entity, req, res, sdk)) return;
          const v = validateBody(req.body, entity, core.groups);
          if (v.errors) return res.status(400).json(v.errors);
          fireWebhooks(entity, 'beforeUpdate', req.body);
          const sanitized = sanitizeBody(req.body, entity, true);
          const row = db.update(table, req.params.id, sanitized);
          db.saveBelongsToMany(entity, row.id, req.body);
          fireWebhooks(entity, 'afterUpdate', row);
          await runMiddlewares('afterUpdate', entity, req, res, sdk);
          emit(`${entity.name}.updated`, hide(row));
          res.json(hide(row));
        } catch (e) { res.status(400).json({ error: e.message }); }
      });

      // PATCH partial update
      router.patch(`${base}/:id`, mw.update, async (req, res) => {
        try {
          if (!db.findById(table, req.params.id)) return res.status(404).json({ error: 'Not found' });
          if (!await runMiddlewares('beforeUpdate', entity, req, res, sdk)) return;
          const v = validateBody(req.body, entity, core.groups, { partial: true });
          if (v.errors) return res.status(400).json(v.errors);
          fireWebhooks(entity, 'beforeUpdate', req.body);
          const row = db.update(table, req.params.id, sanitizeBody(req.body, entity));
          db.saveBelongsToMany(entity, row.id, req.body);
          fireWebhooks(entity, 'afterUpdate', row);
          await runMiddlewares('afterUpdate', entity, req, res, sdk);
          emit(`${entity.name}.updated`, hide(row));
          res.json(hide(row));
        } catch (e) { res.status(400).json({ error: e.message }); }
      });

      // DELETE
      router.delete(`${base}/:id`, mw.delete, async (req, res) => {
        try {
          const existing = db.findById(table, req.params.id);
          if (!existing) return res.status(404).json({ error: 'Not found' });
          if (!await runMiddlewares('beforeDelete', entity, req, res, sdk)) return;
          fireWebhooks(entity, 'beforeDelete', existing);
          const row = db.remove(table, req.params.id);
          fireWebhooks(entity, 'afterDelete', row);
          await runMiddlewares('afterDelete', entity, req, res, sdk);
          emit(`${entity.name}.deleted`, hide(row));
          res.json(hide(row));
        } catch (e) { res.status(500).json({ error: e.message }); }
      });

      logger.info(`  Registered collection routes at /api/collections/${slug}`);
    }
  }

  app.use('/api', router);
}

// ─── Policy middleware ──────────────────────────────────────────────────────

function policyMiddleware(rule, entity, core) {
  const list = (entity.policies || {})[rule];
  if (!list || !list.length) return [requireAuth(), _apiKeyPermGuard(rule, entity)]; // default: admin

  const p = list[0];
  let middlewares;
  switch (p.access) {
    case 'public':
      middlewares = [optionalAuth, (_req, _res, next) => next()];
      break;
    case 'restricted': {
      if (!p.allow) {
        middlewares = [requireAuth()];
        break;
      }
      const allowed = Array.isArray(p.allow) ? p.allow : [p.allow];
      middlewares = [(req, res, next) => {
        const { user, apiKeyPermissions, error } = resolveAuthHeader(req.headers.authorization);
        if (!user) return res.status(401).json({ error: 'Authorization required' });
        if (error === 'invalid_token') return res.status(401).json({ error: 'Invalid or expired token' });
        if (!allowed.includes(user.entity)) return res.status(403).json({ error: 'Access denied' });
        req.user = user;
        if (apiKeyPermissions) req._apiKeyPermissions = apiKeyPermissions;
        try {
          // Ownership-based access: condition: self
          if (p.condition === 'self') {
            enforceSelfCondition(rule, entity, req, core);
          }
          next();
        } catch (e) {
          if (e.status) return res.status(e.status).json({ error: e.message });
          return res.status(401).json({ error: 'Invalid or expired token' });
        }
      }];
      break;
    }
    case 'admin':
      middlewares = [requireAuth()];
      break;
    case 'forbidden':
      middlewares = [(_req, res) => res.status(403).json({ error: 'Access forbidden' })];
      break;
    default:
      middlewares = [(_req, _res, next) => next()];
  }

  // Append API key entity/operation permission guard (no-op when not using an API key)
  middlewares.push(_apiKeyPermGuard(rule, entity));
  return middlewares;
}

/**
 * Middleware that enforces API key entity and operation restrictions.
 * Only active when req._apiKeyPermissions is set (i.e. request uses an API key).
 */
function _apiKeyPermGuard(operation, entity) {
  return (req, res, next) => {
    if (!req._apiKeyPermissions) return next();
    const { operations, entities: keyEntities } = req._apiKeyPermissions;
    if (operations && operations.length > 0 && !operations.includes(operation)) {
      return res.status(403).json({ error: 'API key does not have permission for this operation' });
    }
    if (keyEntities && keyEntities.length > 0 && !keyEntities.includes(entity.slug)) {
      return res.status(403).json({ error: 'API key does not have access to this entity' });
    }
    next();
  };
}

/**
 * Enforce `condition: self` for ownership-based access.
 * Depending on the rule:
 * - create: ensure the FK for the user's entity points to the logged-in user
 * - read: will be handled in the query (filter)
 * - update: ensure the record belongs to the user, disallow ownership change
 * - delete: ensure the record belongs to the user
 */
function enforceSelfCondition(rule, entity, req, core) {
  const userId = req.user.id;
  const userEntity = req.user.entity;

  // Find the FK column for this user's entity
  const userEntityObj = core.entities[userEntity];
  if (!userEntityObj) return;
  const fk = `${userEntityObj.tableName}_id`;

  if (rule === 'create') {
    // Ensure the body's FK points to logged-in user
    if (req.body && req.body[fk] && req.body[fk] !== userId) {
      const err = new Error('Cannot create records for another user');
      err.status = 403;
      throw err;
    }
    if (req.body) req.body[fk] = userId;
  } else if (rule === 'read') {
    // Force a FK filter so only the user's own records are returned
    req._selfFilter = { fk, userId };
  } else if (rule === 'update' || rule === 'delete') {
    // Verify the record belongs to the user
    if (req.params && req.params.id) {
      const row = db.findById(entity.tableName, req.params.id);
      if (row && row[fk] !== userId) {
        const err = new Error('Access denied: record does not belong to you');
        err.status = 403;
        throw err;
      }
      // For update, disallow changing ownership
      if (rule === 'update' && req.body && req.body[fk] && req.body[fk] !== userId) {
        const err = new Error('Cannot transfer ownership');
        err.status = 403;
        throw err;
      }
    }
  }
}

// ─── Middleware execution ───────────────────────────────────────────────────

/**
 * Run entity middlewares for a lifecycle event.
 * Returns false if a middleware sent a response (halting the pipeline).
 * The ChadStart backend SDK is passed to functions as the third argument.
 */
async function runMiddlewares(event, entity, req, res, sdk) {
  const mws = (entity.middlewares || {})[event];
  if (!mws || !mws.length) return true;

  for (const mw of mws) {
    if (!mw.function) continue;
    const fnName = mw.function.endsWith('.js') ? mw.function : `${mw.function}.js`;
    const fnFile = path.resolve(
      process.env.CHADSTART_FUNCTIONS_FOLDER || 'functions',
      fnName
    );
    if (!fs.existsSync(fnFile)) {
      logger.warn(`Middleware function not found: ${fnFile}`);
      continue;
    }
    try {
      const fn = require(fnFile);
      await fn(req, res, sdk);
      if (res.headersSent) return false;
    } catch (e) {
      logger.error(`Middleware ${event}/${mw.function} error: ${e.message}`);
    }
  }
  return true;
}

// ─── Validation ─────────────────────────────────────────────────────────────

const VALIDATORS = {
  required:       (v)      => v !== undefined && v !== null && v !== '',
  isDefined:      (v)      => v !== undefined && v !== null,
  isNotEmpty:     (v)      => v !== undefined && v !== null && v !== '',
  isEmpty:        (v)      => v === undefined || v === null || v === '',
  minLength:      (v, n)   => typeof v === 'string' && v.length >= n,
  maxLength:      (v, n)   => typeof v === 'string' && v.length <= n,
  min:            (v, n)   => typeof v === 'number' && v >= n,
  max:            (v, n)   => typeof v === 'number' && v <= n,
  contains:       (v, s)   => typeof v === 'string' && v.includes(s),
  notContains:    (v, s)   => typeof v === 'string' && !v.includes(s),
  isEmail:        (v)      => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  matches:        (v, p)   => typeof v === 'string' && new RegExp(p).test(v),
  isIn:           (v, arr) => Array.isArray(arr) && arr.includes(v),
  isNotIn:        (v, arr) => Array.isArray(arr) && !arr.includes(v),
  equals:         (v, e)   => v === e,
  notEquals:      (v, e)   => v !== e,
  isAlpha:        (v)      => typeof v === 'string' && /^[a-zA-Z]+$/.test(v),
  isAlphanumeric: (v)      => typeof v === 'string' && /^[a-zA-Z0-9]+$/.test(v),
  isAscii:        (v)      => typeof v === 'string' && /^[\x00-\x7F]+$/.test(v),
  isJSON:         (v)      => { try { JSON.parse(v); return true; } catch { return false; } },
  isMimeType:     (v)      => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.+]*$/.test(v),
};

function validateBody(body, entity, groups, opts) {
  const partial = opts && opts.partial;
  const errors = [];
  for (const [prop, rules] of Object.entries(entity.validation || {})) {
    const val = body ? body[prop] : undefined;
    // In partial (PATCH) mode, skip validation for fields not sent in the body
    if (partial && val === undefined) continue;
    if (rules.isOptional && (val === undefined || val === null)) continue;
    const constraints = {};
    for (const [name, param] of Object.entries(rules)) {
      if (name === 'isOptional') continue;
      const fn = VALIDATORS[name];
      if (fn && !fn(val, param)) {
        constraints[name] = `Validation failed: ${name}`;
      }
    }
    if (Object.keys(constraints).length) errors.push({ property: prop, constraints });
  }

  // Validate group properties against group-level validation rules
  if (groups) {
    for (const p of entity.properties || []) {
      if (p.type !== 'group') continue;
      const val = body ? body[p.name] : undefined;
      if (val === undefined || val === null) continue;
      const groupName = p.options && p.options.group;
      const groupDef = groups[groupName];
      if (!groupDef || !groupDef.validation) continue;
      const multiple = !p.options || p.options.multiple !== false;
      const rawItems = multiple ? (Array.isArray(val) ? val : []) : [val];
      rawItems.forEach((item, idx) => {
        // Skip validation if item is not an object (e.g. primitives or invalid payloads)
        if (!item || typeof item !== 'object' || Array.isArray(item)) return;
        for (const [propName, rules] of Object.entries(groupDef.validation)) {
          const itemVal = item[propName];
          if (rules.isOptional && (itemVal === undefined || itemVal === null)) continue;
          const constraints = {};
          for (const [name, param] of Object.entries(rules)) {
            if (name === 'isOptional') continue;
            const fn = VALIDATORS[name];
            if (fn && !fn(itemVal, param)) {
              constraints[name] = `Validation failed: ${name}`;
            }
          }
          if (Object.keys(constraints).length) {
            // For single (non-multiple) groups use `prop.subProp`; for lists use `prop[idx].subProp`
            const errorPath = multiple
              ? `${p.name}[${idx}].${propName}`
              : `${p.name}.${propName}`;
            errors.push({ property: errorPath, constraints });
          }
        }
      });
    }
  }

  return errors.length ? { errors } : { errors: null };
}

// ─── Webhooks ───────────────────────────────────────────────────────────────

function fireWebhooks(entity, event, record) {
  for (const hook of (entity.hooks || {})[event] || []) {
    if (!hook.url) continue;
    const method = (hook.method || 'POST').toUpperCase();
    const headers = { 'Content-Type': 'application/json', ...(hook.headers || {}) };
    for (const [k, v] of Object.entries(headers)) {
      if (typeof v === 'string') headers[k] = v.replace(/\$\{([^}]+)\}/g, (_, e) => process.env[e] || '');
    }
    const body = JSON.stringify({ event, createdAt: new Date().toISOString(), entity: entity.slug, record });
    fetch(hook.url, { method, headers, body: method !== 'GET' ? body : undefined }).catch((err) => {
      logger.error(`Webhook ${event} to ${hook.url} failed: ${err.message}`);
    });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Filter out hidden properties from API responses.
 */
function hideHiddenProps(row, entity) {
  if (!row || !entity.properties) return row;
  const hiddenNames = new Set(entity.properties.filter((p) => p.hidden).map((p) => p.name));
  if (!hiddenNames.size) return row;
  return Object.fromEntries(Object.entries(row).filter(([k]) => !hiddenNames.has(k)));
}

/**
 * Apply default property values for missing fields.
 */
function applyDefaults(body, entity) {
  const result = { ...(body || {}) };
  for (const p of entity.properties) {
    if (p.default !== undefined && (result[p.name] === undefined || result[p.name] === null)) {
      // Coerce boolean defaults to SQLite integers (1/0)
      if (p.type === 'boolean' || p.type === 'bool') {
        result[p.name] = p.default ? 1 : 0;
      } else {
        result[p.name] = p.default;
      }
    }
  }
  return result;
}

/**
 * Sanitize request body to only include valid property names and FK columns.
 * fullReplace: if true, set missing properties to null (for PUT).
 */
function sanitizeBody(body, entity, fullReplace) {
  if (!body || typeof body !== 'object') return {};
  const allowed = new Set(entity.properties.map((p) => p.name));
  for (const rel of entity.belongsTo || []) {
    const name = typeof rel === 'string' ? rel : (rel.entity || rel.name);
    allowed.add(`${toSnakeCase(name)}_id`);
    // Also allow camelCase form (e.g., "teamId" -> "team_id")
    allowed.add(`${name.charAt(0).toLowerCase() + name.slice(1)}Id`);
  }

  const result = {};
  if (fullReplace) {
    // PUT: set all allowed props — missing ones become null
    for (const key of allowed) {
      result[key] = body[key] !== undefined ? body[key] : null;
    }
  } else {
    // PATCH: only include props present in body
    for (const [k, v] of Object.entries(body)) {
      if (allowed.has(k)) result[k] = v;
    }
  }

  // Convert camelCase FK keys to snake_case (e.g., teamId -> team_id)
  for (const rel of entity.belongsTo || []) {
    const name = typeof rel === 'string' ? rel : (rel.entity || rel.name);
    const camelKey = `${name.charAt(0).toLowerCase() + name.slice(1)}Id`;
    const snakeKey = `${toSnakeCase(name)}_id`;
    if (result[camelKey] !== undefined) {
      result[snakeKey] = result[camelKey];
      delete result[camelKey];
    }
  }

  // Serialize group properties to JSON strings for SQLite TEXT storage
  // Coerce boolean properties to SQLite integers (1/0)
  for (const p of entity.properties) {
    if (p.type === 'group' && result[p.name] !== undefined && result[p.name] !== null) {
      if (typeof result[p.name] !== 'string') {
        result[p.name] = JSON.stringify(result[p.name]);
      }
    }
    if ((p.type === 'boolean' || p.type === 'bool') && result[p.name] !== undefined && result[p.name] !== null) {
      result[p.name] = result[p.name] ? 1 : 0;
    }
  }

  return result;
}

/**
 * Parse group-type properties from JSON strings back to JS objects/arrays.
 * Called before returning rows to the client.
 */
function deserializeGroupProps(row, entity) {
  if (!row || !entity.properties) return row;
  const hasGroups = entity.properties.some((p) => p.type === 'group');
  if (!hasGroups) return row;
  const result = { ...row };
  for (const p of entity.properties) {
    if (p.type === 'group' && result[p.name] && typeof result[p.name] === 'string') {
      try { result[p.name] = JSON.parse(result[p.name]); } catch { /* leave as string if invalid JSON */ }
    }
  }
  return result;
}

module.exports = { registerApiRoutes, validateBody, applyDefaults, hideHiddenProps, deserializeGroupProps, createBackendSdk };
