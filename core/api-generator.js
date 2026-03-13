'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { toSnakeCase } = require('./entity-engine');
const { requireAuth, optionalAuth, omitPassword, JWT_SECRET } = require('./auth');
const logger = require('../utils/logger');

/**
 * Register CRUD REST routes for all entities.
 *
 * Collections: /api/collections/:slug
 * Singles:     /api/singles/:slug
 */
function registerApiRoutes(app, core, emit) {
  const router = express.Router();

  for (const entity of Object.values(core.entities)) {
    const slug = entity.slug;
    const table = entity.tableName;
    const clean = entity.authenticable ? omitPassword : (r) => r;
    const hide = (row) => hideHiddenProps(clean(row), entity);

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
          if (!await runMiddlewares('beforeUpdate', entity, req, res)) return;
          const v = validateBody(req.body, entity);
          if (v.errors) return res.status(400).json(v.errors);
          fireWebhooks(entity, 'beforeUpdate', req.body);
          const sanitized = sanitizeBody(req.body, entity, true);
          const updated = db.update(table, row.id, sanitized);
          fireWebhooks(entity, 'afterUpdate', updated);
          await runMiddlewares('afterUpdate', entity, req, res);
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
          if (!await runMiddlewares('beforeUpdate', entity, req, res)) return;
          const v = validateBody(req.body, entity);
          if (v.errors) return res.status(400).json(v.errors);
          fireWebhooks(entity, 'beforeUpdate', req.body);
          const updated = db.update(table, row.id, sanitizeBody(req.body, entity));
          fireWebhooks(entity, 'afterUpdate', updated);
          await runMiddlewares('afterUpdate', entity, req, res);
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
          const result = db.findAll(table, req.query, {
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
          if (req.query.relations) db.loadRelations(row, entity, req.query.relations);
          res.json(hide(row));
        } catch (e) { res.status(500).json({ error: e.message }); }
      });

      // POST create
      router.post(base, mw.create, async (req, res) => {
        try {
          if (!await runMiddlewares('beforeCreate', entity, req, res)) return;
          const body = applyDefaults(req.body, entity);
          const v = validateBody(body, entity);
          if (v.errors) return res.status(400).json(v.errors);
          fireWebhooks(entity, 'beforeCreate', body);
          const row = db.create(table, sanitizeBody(body, entity));
          db.saveBelongsToMany(entity, row.id, req.body);
          fireWebhooks(entity, 'afterCreate', row);
          await runMiddlewares('afterCreate', entity, req, res);
          emit(`${entity.name}.created`, hide(row));
          res.status(201).json(hide(row));
        } catch (e) { res.status(400).json({ error: e.message }); }
      });

      // PUT full replace
      router.put(`${base}/:id`, mw.update, async (req, res) => {
        try {
          if (!db.findById(table, req.params.id)) return res.status(404).json({ error: 'Not found' });
          if (!await runMiddlewares('beforeUpdate', entity, req, res)) return;
          const v = validateBody(req.body, entity);
          if (v.errors) return res.status(400).json(v.errors);
          fireWebhooks(entity, 'beforeUpdate', req.body);
          const sanitized = sanitizeBody(req.body, entity, true);
          const row = db.update(table, req.params.id, sanitized);
          db.saveBelongsToMany(entity, row.id, req.body);
          fireWebhooks(entity, 'afterUpdate', row);
          await runMiddlewares('afterUpdate', entity, req, res);
          emit(`${entity.name}.updated`, hide(row));
          res.json(hide(row));
        } catch (e) { res.status(400).json({ error: e.message }); }
      });

      // PATCH partial update
      router.patch(`${base}/:id`, mw.update, async (req, res) => {
        try {
          if (!db.findById(table, req.params.id)) return res.status(404).json({ error: 'Not found' });
          if (!await runMiddlewares('beforeUpdate', entity, req, res)) return;
          const v = validateBody(req.body, entity);
          if (v.errors) return res.status(400).json(v.errors);
          fireWebhooks(entity, 'beforeUpdate', req.body);
          const row = db.update(table, req.params.id, sanitizeBody(req.body, entity));
          db.saveBelongsToMany(entity, row.id, req.body);
          fireWebhooks(entity, 'afterUpdate', row);
          await runMiddlewares('afterUpdate', entity, req, res);
          emit(`${entity.name}.updated`, hide(row));
          res.json(hide(row));
        } catch (e) { res.status(400).json({ error: e.message }); }
      });

      // DELETE
      router.delete(`${base}/:id`, mw.delete, async (req, res) => {
        try {
          const existing = db.findById(table, req.params.id);
          if (!existing) return res.status(404).json({ error: 'Not found' });
          if (!await runMiddlewares('beforeDelete', entity, req, res)) return;
          fireWebhooks(entity, 'beforeDelete', existing);
          const row = db.remove(table, req.params.id);
          fireWebhooks(entity, 'afterDelete', row);
          await runMiddlewares('afterDelete', entity, req, res);
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
  if (!list || !list.length) return [requireAuth()]; // default: admin

  const p = list[0];
  switch (p.access) {
    case 'public':
      return [optionalAuth, (_req, _res, next) => next()];
    case 'restricted': {
      if (!p.allow) return [requireAuth()];
      const allowed = Array.isArray(p.allow) ? p.allow : [p.allow];
      return [(req, res, next) => {
        const header = req.headers.authorization;
        if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Authorization required' });
        try {
          req.user = jwt.verify(
            header.slice(7),
            JWT_SECRET
          );
          if (!allowed.includes(req.user.entity)) return res.status(403).json({ error: 'Access denied' });

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
    }
    case 'admin':
      return [requireAuth()];
    case 'forbidden':
      return [(_req, res) => res.status(403).json({ error: 'Access forbidden' })];
    default:
      return [(_req, _res, next) => next()];
  }
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
  // For read, we would need to add a filter — handled in route handler if needed
}

// ─── Middleware execution ───────────────────────────────────────────────────

/**
 * Run entity middlewares for a lifecycle event.
 * Returns false if a middleware sent a response (halting the pipeline).
 */
async function runMiddlewares(event, entity, req, res) {
  const mws = (entity.middlewares || {})[event];
  if (!mws || !mws.length) return true;

  for (const mw of mws) {
    if (!mw.handler) continue;
    const handlerFile = path.resolve(
      process.env.MANIFEST_HANDLERS_FOLDER || 'handlers',
      `${mw.handler}.js`
    );
    if (!fs.existsSync(handlerFile)) {
      logger.warn(`Middleware handler not found: ${handlerFile}`);
      continue;
    }
    try {
      const handler = require(handlerFile);
      await handler(req, res);
      if (res.headersSent) return false;
    } catch (e) {
      logger.error(`Middleware ${event}/${mw.handler} error: ${e.message}`);
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

function validateBody(body, entity) {
  const errors = [];
  for (const [prop, rules] of Object.entries(entity.validation || {})) {
    const val = body ? body[prop] : undefined;
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
      result[p.name] = p.default;
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

  return result;
}

module.exports = { registerApiRoutes, validateBody, applyDefaults, hideHiddenProps };
