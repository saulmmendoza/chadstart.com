'use strict';

const express = require('express');
const db = require('./db');
const { toSnakeCase } = require('./entity-engine');
const { requireAuth } = require('./auth');
const logger = require('../utils/logger');

/**
 * Register CRUD REST routes for all entities defined in core.
 * Emits realtime events via the provided emit function.
 * Enforces entity permissions using JWT middleware.
 */
function registerApiRoutes(app, core, emit) {
  const router = express.Router();

  for (const entity of Object.values(core.entities)) {
    const basePath = `/${toKebabCase(entity.name)}s`;
    const table = entity.tableName;

    const readMiddleware = buildPermissionMiddleware(entity.permissions.read, core);
    const writeMiddleware = buildPermissionMiddleware(entity.permissions.write, core);

    // GET /api/<entities>  — list with optional filter query params
    router.get(basePath, readMiddleware, (req, res) => {
      try {
        const filters = buildFilters(req.query);
        const rows = db.findAll(table, filters);
        res.json(rows);
      } catch (err) {
        logger.error('GET list error', err.message);
        res.status(500).json({ error: err.message });
      }
    });

    // GET /api/<entities>/:id
    router.get(`${basePath}/:id`, readMiddleware, (req, res) => {
      try {
        const row = db.findById(table, req.params.id);
        if (!row) return res.status(404).json({ error: 'Not found' });
        res.json(row);
      } catch (err) {
        logger.error('GET by id error', err.message);
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/<entities>
    router.post(basePath, writeMiddleware, (req, res) => {
      try {
        const row = db.create(table, sanitizeBody(req.body, entity));
        emit(`${entity.name}.created`, row);
        res.status(201).json(row);
      } catch (err) {
        logger.error('POST error', err.message);
        res.status(400).json({ error: err.message });
      }
    });

    // PATCH /api/<entities>/:id
    router.patch(`${basePath}/:id`, writeMiddleware, (req, res) => {
      try {
        const existing = db.findById(table, req.params.id);
        if (!existing) return res.status(404).json({ error: 'Not found' });
        const row = db.update(table, req.params.id, sanitizeBody(req.body, entity));
        emit(`${entity.name}.updated`, row);
        res.json(row);
      } catch (err) {
        logger.error('PATCH error', err.message);
        res.status(400).json({ error: err.message });
      }
    });

    // DELETE /api/<entities>/:id
    router.delete(`${basePath}/:id`, writeMiddleware, (req, res) => {
      try {
        const row = db.remove(table, req.params.id);
        if (!row) return res.status(404).json({ error: 'Not found' });
        emit(`${entity.name}.deleted`, row);
        res.status(200).json(row);
      } catch (err) {
        logger.error('DELETE error', err.message);
        res.status(500).json({ error: err.message });
      }
    });

    logger.info(`  Registered API routes for ${entity.name} at /api${basePath}`);
  }

  app.use('/api', router);
}

/**
 * Resolve a permission value into an Express middleware array.
 *
 * Permission values:
 *   'public'               – no auth required (pass-through)
 *   'restricted'           – any authenticated user (any collection)
 *   'user:CollectionName'  – authenticated member of a specific collection
 */
function buildPermissionMiddleware(permission, _core) {
  if (!permission || permission === 'public') {
    // No-op middleware
    return [(_req, _res, next) => next()];
  }
  if (permission === 'restricted') {
    return [requireAuth()];
  }
  if (typeof permission === 'string' && permission.startsWith('user:')) {
    const collectionName = permission.slice(5);
    return [requireAuth(collectionName)];
  }
  // Unknown permission value — default to public
  return [(_req, _res, next) => next()];
}

/**
 * Strip body keys to only those defined in the entity schema + foreign key fields.
 */
function sanitizeBody(body, entity) {
  if (!body || typeof body !== 'object') return {};
  const allowed = new Set(entity.properties.map((p) => p.name));
  for (const rel of entity.belongsTo) {
    const relName = typeof rel === 'string' ? rel : rel;
    allowed.add(`${toSnakeCase(relName)}_id`);
  }
  const result = {};
  for (const key of Object.keys(body)) {
    if (allowed.has(key)) result[key] = body[key];
  }
  return result;
}

/**
 * Build a filters object from query string params, ignoring pagination/meta keys.
 */
function buildFilters(query) {
  const skip = new Set(['_page', '_limit', '_sort', '_order']);
  const filters = {};
  for (const [k, v] of Object.entries(query)) {
    if (!skip.has(k)) filters[k] = v;
  }
  return filters;
}

function toKebabCase(str) {
  return str
    .replace(/([A-Z])/g, (m, p, offset) => (offset > 0 ? '-' : '') + p.toLowerCase())
    .replace(/^-/, '');
}

module.exports = { registerApiRoutes };

