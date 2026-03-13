'use strict';

const express = require('express');
const db = require('./db');
const { toSnakeCase } = require('./entity-engine');
const { requireAuth, optionalAuth, omitPassword } = require('./auth');
const logger = require('../utils/logger');

/**
 * Register CRUD REST routes for all entities defined in core.
 * Emits realtime events via the provided emit function.
 * Enforces entity policies using JWT middleware.
 *
 * Authenticable entities have their CRUD responses sanitized to
 * omit password fields.
 */
function registerApiRoutes(app, core, emit) {
  const router = express.Router();

  for (const entity of Object.values(core.entities)) {
    const basePath = `/${entity.slug || toKebabCase(entity.name)}s`;
    const table = entity.tableName;
    const isAuth = entity.authenticable === true;

    // Build middleware for each CRUD operation from policies
    const createMiddleware = buildPolicyMiddleware('create', entity, core);
    const readMiddleware = buildPolicyMiddleware('read', entity, core);
    const updateMiddleware = buildPolicyMiddleware('update', entity, core);
    const deleteMiddleware = buildPolicyMiddleware('delete', entity, core);

    // Response helper: omit password for authenticable entities
    const sanitizeResponse = isAuth ? omitPassword : (row) => row;

    // Skip create/delete for single entities
    if (!entity.single) {
      // GET /api/<entities>  — list with optional filter query params
      router.get(basePath, readMiddleware, (req, res) => {
        try {
          const filters = buildFilters(req.query);
          const rows = db.findAll(table, filters).map(sanitizeResponse);
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
          res.json(sanitizeResponse(row));
        } catch (err) {
          logger.error('GET by id error', err.message);
          res.status(500).json({ error: err.message });
        }
      });

      // POST /api/<entities>
      router.post(basePath, createMiddleware, (req, res) => {
        try {
          const validated = validateBody(req.body, entity);
          if (validated.errors) {
            return res.status(400).json(validated.errors);
          }
          const row = db.create(table, sanitizeBody(req.body, entity));
          fireWebhooks(entity, 'afterCreate', row);
          emit(`${entity.name}.created`, sanitizeResponse(row));
          res.status(201).json(sanitizeResponse(row));
        } catch (err) {
          logger.error('POST error', err.message);
          res.status(400).json({ error: err.message });
        }
      });

      // PATCH /api/<entities>/:id
      router.patch(`${basePath}/:id`, updateMiddleware, (req, res) => {
        try {
          const existing = db.findById(table, req.params.id);
          if (!existing) return res.status(404).json({ error: 'Not found' });
          const validated = validateBody(req.body, entity);
          if (validated.errors) {
            return res.status(400).json(validated.errors);
          }
          const row = db.update(table, req.params.id, sanitizeBody(req.body, entity));
          fireWebhooks(entity, 'afterUpdate', row);
          emit(`${entity.name}.updated`, sanitizeResponse(row));
          res.json(sanitizeResponse(row));
        } catch (err) {
          logger.error('PATCH error', err.message);
          res.status(400).json({ error: err.message });
        }
      });

      // DELETE /api/<entities>/:id
      router.delete(`${basePath}/:id`, deleteMiddleware, (req, res) => {
        try {
          const row = db.remove(table, req.params.id);
          if (!row) return res.status(404).json({ error: 'Not found' });
          fireWebhooks(entity, 'afterDelete', row);
          emit(`${entity.name}.deleted`, sanitizeResponse(row));
          res.status(200).json(sanitizeResponse(row));
        } catch (err) {
          logger.error('DELETE error', err.message);
          res.status(500).json({ error: err.message });
        }
      });
    } else {
      // Single entity: only read and update
      router.get(basePath, readMiddleware, (req, res) => {
        try {
          const rows = db.findAll(table);
          const row = rows[0] || null;
          if (!row) return res.status(404).json({ error: 'Not found' });
          res.json(sanitizeResponse(row));
        } catch (err) {
          logger.error('GET single error', err.message);
          res.status(500).json({ error: err.message });
        }
      });

      router.patch(basePath, updateMiddleware, (req, res) => {
        try {
          const rows = db.findAll(table);
          const existing = rows[0] || null;
          if (!existing) return res.status(404).json({ error: 'Not found' });
          const validated = validateBody(req.body, entity);
          if (validated.errors) {
            return res.status(400).json(validated.errors);
          }
          const row = db.update(table, existing.id, sanitizeBody(req.body, entity));
          emit(`${entity.name}.updated`, sanitizeResponse(row));
          res.json(sanitizeResponse(row));
        } catch (err) {
          logger.error('PATCH single error', err.message);
          res.status(400).json({ error: err.message });
        }
      });
    }

    logger.info(`  Registered API routes for ${entity.name} at /api${basePath}`);
  }

  app.use('/api', router);
}

// ─── Policy middleware builder ──────────────────────────────────────────────

/**
 * Build Express middleware from the entity's policies for a given CRUD rule.
 *
 * Policy access types:
 *   'public'     – no auth required
 *   'restricted' – any authenticated user (or specific entities via allow)
 *   'admin'      – only admin users (first authenticable entity or legacy admin)
 *   'forbidden'  – no access at all
 */
function buildPolicyMiddleware(rule, entity, core) {
  const policies = entity.policies || {};
  const policyList = policies[rule];

  // No policy for this rule: default to admin access
  if (!policyList || policyList.length === 0) {
    // Also check backward-compatible permissions
    if (entity.permissions) {
      return buildLegacyPermissionMiddleware(rule, entity, core);
    }
    // Default: admin only
    return [requireAuth()];
  }

  // Use the first policy (primary)
  const policy = policyList[0];

  switch (policy.access) {
    case 'public':
      return [optionalAuth, (_req, _res, next) => next()];

    case 'restricted': {
      if (policy.allow) {
        const allowed = Array.isArray(policy.allow) ? policy.allow : [policy.allow];
        return [
          (req, res, next) => {
            const header = req.headers.authorization;
            if (!header || !header.startsWith('Bearer ')) {
              return res.status(401).json({ error: 'Authorization required' });
            }
            try {
              const jwt = require('jsonwebtoken');
              const payload = jwt.verify(
                header.slice(7),
                process.env.JWT_SECRET || process.env.TOKEN_SECRET_KEY || 'chadstart-dev-secret-change-in-production'
              );
              req.user = payload;
              const userEntity = payload.collection || payload.entity;
              if (!allowed.includes(userEntity)) {
                return res.status(403).json({ error: 'Access denied' });
              }
              next();
            } catch {
              return res.status(401).json({ error: 'Invalid or expired token' });
            }
          },
        ];
      }
      return [requireAuth()];
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
 * Backward-compatible permission middleware (old format).
 */
function buildLegacyPermissionMiddleware(rule, entity, _core) {
  const perms = entity.permissions;
  let permission;

  if (rule === 'read') {
    permission = perms.read;
  } else {
    permission = perms.write;
  }

  if (!permission || permission === 'public') {
    return [(_req, _res, next) => next()];
  }
  if (permission === 'restricted') {
    return [requireAuth()];
  }
  if (typeof permission === 'string' && permission.startsWith('user:')) {
    const collectionName = permission.slice(5);
    return [requireAuth(collectionName)];
  }
  return [(_req, _res, next) => next()];
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate request body against entity validation rules.
 * Returns { errors: null } on success, or { errors: [...] } on failure.
 */
function validateBody(body, entity) {
  const validation = entity.validation || {};
  const errors = [];

  for (const [propName, rules] of Object.entries(validation)) {
    const value = body ? body[propName] : undefined;

    // isOptional: skip validation if value is null/undefined
    if (rules.isOptional && (value === undefined || value === null)) {
      continue;
    }

    const constraints = {};

    if (rules.required || rules.isNotEmpty) {
      if (value === undefined || value === null || value === '') {
        constraints.required = `The value must not be empty`;
      }
    }

    if (rules.minLength !== undefined && typeof value === 'string') {
      if (value.length < rules.minLength) {
        constraints.minLength = `The value must be at least ${rules.minLength} characters`;
      }
    }

    if (rules.maxLength !== undefined && typeof value === 'string') {
      if (value.length > rules.maxLength) {
        constraints.maxLength = `The value must be at most ${rules.maxLength} characters`;
      }
    }

    if (rules.min !== undefined && typeof value === 'number') {
      if (value < rules.min) {
        constraints.min = `The value must be at least ${rules.min}`;
      }
    }

    if (rules.max !== undefined && typeof value === 'number') {
      if (value > rules.max) {
        constraints.max = `The value must be at most ${rules.max}`;
      }
    }

    if (rules.contains !== undefined && typeof value === 'string') {
      if (!value.includes(rules.contains)) {
        constraints.contains = `The value must contain ${rules.contains}`;
      }
    }

    if (rules.notContains !== undefined && typeof value === 'string') {
      if (value.includes(rules.notContains)) {
        constraints.notContains = `The value must not contain ${rules.notContains}`;
      }
    }

    if (rules.isEmail && typeof value === 'string') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        constraints.isEmail = `The value must be a valid email`;
      }
    }

    if (rules.matches !== undefined && typeof value === 'string') {
      if (!new RegExp(rules.matches).test(value)) {
        constraints.matches = `The value must match pattern ${rules.matches}`;
      }
    }

    if (rules.isIn !== undefined) {
      if (!Array.isArray(rules.isIn) || !rules.isIn.includes(value)) {
        constraints.isIn = `The value must be one of: ${(rules.isIn || []).join(', ')}`;
      }
    }

    if (rules.isNotIn !== undefined) {
      if (Array.isArray(rules.isNotIn) && rules.isNotIn.includes(value)) {
        constraints.isNotIn = `The value must not be one of: ${rules.isNotIn.join(', ')}`;
      }
    }

    if (rules.equals !== undefined) {
      if (value !== rules.equals) {
        constraints.equals = `The value must equal ${rules.equals}`;
      }
    }

    if (rules.notEquals !== undefined) {
      if (value === rules.notEquals) {
        constraints.notEquals = `The value must not equal ${rules.notEquals}`;
      }
    }

    if (Object.keys(constraints).length > 0) {
      errors.push({ property: propName, constraints });
    }
  }

  // Also validate inline property validation rules
  for (const prop of entity.properties || []) {
    if (prop.validation) {
      const value = body ? body[prop.name] : undefined;

      // Skip if already covered by entity-level validation
      if (validation[prop.name]) continue;

      if (prop.validation.isOptional && (value === undefined || value === null)) {
        continue;
      }

      const constraints = {};

      if (prop.validation.required || prop.validation.isNotEmpty) {
        if (value === undefined || value === null || value === '') {
          constraints.required = `The value must not be empty`;
        }
      }

      if (prop.validation.minLength !== undefined && typeof value === 'string') {
        if (value.length < prop.validation.minLength) {
          constraints.minLength = `The value must be at least ${prop.validation.minLength} characters`;
        }
      }

      if (prop.validation.maxLength !== undefined && typeof value === 'string') {
        if (value.length > prop.validation.maxLength) {
          constraints.maxLength = `The value must be at most ${prop.validation.maxLength} characters`;
        }
      }

      if (Object.keys(constraints).length > 0) {
        errors.push({ property: prop.name, constraints });
      }
    }
  }

  return errors.length > 0 ? { errors } : { errors: null };
}

// ─── Webhooks ───────────────────────────────────────────────────────────────

/**
 * Fire webhooks for entity lifecycle events.
 * Sends HTTP requests to configured URLs (fire-and-forget).
 */
function fireWebhooks(entity, event, record) {
  const hooks = entity.hooks || {};
  const hookList = hooks[event];
  if (!hookList || hookList.length === 0) return;

  for (const hook of hookList) {
    if (!hook.url) continue;

    const method = (hook.method || 'POST').toUpperCase();
    const headers = { 'Content-Type': 'application/json', ...(hook.headers || {}) };

    // Interpolate env variables in headers
    for (const [key, val] of Object.entries(headers)) {
      if (typeof val === 'string') {
        headers[key] = val.replace(/\$\{([^}]+)\}/g, (_, envVar) => process.env[envVar] || '');
      }
    }

    const body = JSON.stringify({
      event,
      createdAt: new Date().toISOString(),
      entity: entity.slug || entity.name,
      record,
    });

    // Fire-and-forget: do not await
    fetch(hook.url, { method, headers, body: method !== 'GET' ? body : undefined }).catch(() => {
      // Manifest does not enforce HTTP request success or failure
    });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Strip body keys to only those defined in the entity schema + foreign key fields.
 */
function sanitizeBody(body, entity) {
  if (!body || typeof body !== 'object') return {};
  const allowed = new Set(entity.properties.map((p) => p.name));
  for (const rel of entity.belongsTo || []) {
    const relName = typeof rel === 'string' ? rel : (rel.entity || rel.name);
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

module.exports = { registerApiRoutes, validateBody };
