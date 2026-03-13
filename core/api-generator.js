'use strict';

const express = require('express');
const db = require('./db');
const { toSnakeCase } = require('./entity-engine');
const { requireAuth, optionalAuth, omitPassword } = require('./auth');
const logger = require('../utils/logger');

/**
 * Register CRUD REST routes for all entities.
 * Authenticable entities have password omitted from responses.
 */
function registerApiRoutes(app, core, emit) {
  const router = express.Router();

  for (const entity of Object.values(core.entities)) {
    const base = `/${entity.slug}s`;
    const table = entity.tableName;
    const clean = entity.authenticable ? omitPassword : (r) => r;

    const mw = {
      create: policyMiddleware('create', entity),
      read:   policyMiddleware('read', entity),
      update: policyMiddleware('update', entity),
      delete: policyMiddleware('delete', entity),
    };

    if (entity.single) {
      router.get(base, mw.read, (_req, res) => {
        try {
          const row = db.findAll(table)[0];
          if (!row) return res.status(404).json({ error: 'Not found' });
          res.json(clean(row));
        } catch (e) { res.status(500).json({ error: e.message }); }
      });
      router.patch(base, mw.update, (req, res) => {
        try {
          const row = db.findAll(table)[0];
          if (!row) return res.status(404).json({ error: 'Not found' });
          const v = validateBody(req.body, entity);
          if (v.errors) return res.status(400).json(v.errors);
          const updated = db.update(table, row.id, sanitizeBody(req.body, entity));
          emit(`${entity.name}.updated`, clean(updated));
          res.json(clean(updated));
        } catch (e) { res.status(400).json({ error: e.message }); }
      });
    } else {
      router.get(base, mw.read, (req, res) => {
        try { res.json(db.findAll(table, buildFilters(req.query)).map(clean)); }
        catch (e) { res.status(500).json({ error: e.message }); }
      });

      router.get(`${base}/:id`, mw.read, (req, res) => {
        try {
          const row = db.findById(table, req.params.id);
          if (!row) return res.status(404).json({ error: 'Not found' });
          res.json(clean(row));
        } catch (e) { res.status(500).json({ error: e.message }); }
      });

      router.post(base, mw.create, (req, res) => {
        try {
          const v = validateBody(req.body, entity);
          if (v.errors) return res.status(400).json(v.errors);
          const row = db.create(table, sanitizeBody(req.body, entity));
          fireWebhooks(entity, 'afterCreate', row);
          emit(`${entity.name}.created`, clean(row));
          res.status(201).json(clean(row));
        } catch (e) { res.status(400).json({ error: e.message }); }
      });

      router.patch(`${base}/:id`, mw.update, (req, res) => {
        try {
          if (!db.findById(table, req.params.id)) return res.status(404).json({ error: 'Not found' });
          const v = validateBody(req.body, entity);
          if (v.errors) return res.status(400).json(v.errors);
          const row = db.update(table, req.params.id, sanitizeBody(req.body, entity));
          fireWebhooks(entity, 'afterUpdate', row);
          emit(`${entity.name}.updated`, clean(row));
          res.json(clean(row));
        } catch (e) { res.status(400).json({ error: e.message }); }
      });

      router.delete(`${base}/:id`, mw.delete, (req, res) => {
        try {
          const row = db.remove(table, req.params.id);
          if (!row) return res.status(404).json({ error: 'Not found' });
          fireWebhooks(entity, 'afterDelete', row);
          emit(`${entity.name}.deleted`, clean(row));
          res.json(clean(row));
        } catch (e) { res.status(500).json({ error: e.message }); }
      });
    }

    logger.info(`  Registered API routes for ${entity.name} at /api${base}`);
  }

  app.use('/api', router);
}

// ─── Policy middleware ──────────────────────────────────────────────────────

function policyMiddleware(rule, entity) {
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
          req.user = require('jsonwebtoken').verify(
            header.slice(7),
            process.env.JWT_SECRET || process.env.TOKEN_SECRET_KEY || 'chadstart-dev-secret-change-in-production'
          );
          if (!allowed.includes(req.user.collection || req.user.entity)) return res.status(403).json({ error: 'Access denied' });
          next();
        } catch { return res.status(401).json({ error: 'Invalid or expired token' }); }
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

// ─── Validation ─────────────────────────────────────────────────────────────

const VALIDATORS = {
  required:    (v)          => v !== undefined && v !== null && v !== '',
  isNotEmpty:  (v)          => v !== undefined && v !== null && v !== '',
  minLength:   (v, n)       => typeof v === 'string' && v.length >= n,
  maxLength:   (v, n)       => typeof v === 'string' && v.length <= n,
  min:         (v, n)       => typeof v === 'number' && v >= n,
  max:         (v, n)       => typeof v === 'number' && v <= n,
  contains:    (v, s)       => typeof v === 'string' && v.includes(s),
  notContains: (v, s)       => typeof v === 'string' && !v.includes(s),
  isEmail:     (v)          => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  matches:     (v, p)       => typeof v === 'string' && new RegExp(p).test(v),
  isIn:        (v, arr)     => Array.isArray(arr) && arr.includes(v),
  isNotIn:     (v, arr)     => Array.isArray(arr) && !arr.includes(v),
  equals:      (v, e)       => v === e,
  notEquals:   (v, e)       => v !== e,
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
    fetch(hook.url, { method, headers, body: method !== 'GET' ? body : undefined }).catch(() => {});
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sanitizeBody(body, entity) {
  if (!body || typeof body !== 'object') return {};
  const allowed = new Set(entity.properties.map((p) => p.name));
  for (const rel of entity.belongsTo || []) {
    const name = typeof rel === 'string' ? rel : (rel.entity || rel.name);
    allowed.add(`${toSnakeCase(name)}_id`);
  }
  return Object.fromEntries(Object.entries(body).filter(([k]) => allowed.has(k)));
}

function buildFilters(query) {
  const skip = new Set(['_page', '_limit', '_sort', '_order']);
  return Object.fromEntries(Object.entries(query).filter(([k]) => !skip.has(k)));
}

module.exports = { registerApiRoutes, validateBody };
