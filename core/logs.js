'use strict';

/**
 * Request logging module for ChadStart.
 *
 * Stores API request logs in the `_cs_logs` system table and provides
 * a paginated, filterable query API for the admin dashboard.
 *
 * Configuration via YAML `logs` section:
 *   logs:
 *     retention: 30          # Days to keep logs (default: 30, 0 = forever)
 *     exclude:               # Paths to exclude from logging
 *       - /health
 *       - /admin/vendor
 */

const db = require('./db');
const { q } = db;
const logger = require('../utils/logger');

const _DB_ENGINE = db.DB_ENGINE;
const _ID_T   = _DB_ENGINE === 'mysql' ? 'VARCHAR(36)' : 'TEXT';
const _NAME_T = _DB_ENGINE === 'mysql' ? 'VARCHAR(255)' : 'TEXT';

/** Default log retention in days. 0 = keep forever. */
const DEFAULT_RETENTION_DAYS = 30;

/**
 * Initialize the _cs_logs system table.
 * Must be called after initDb().
 */
async function initLogs() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ${q('_cs_logs')} (
      ${q('id')}         ${_ID_T} PRIMARY KEY,
      ${q('method')}     ${_NAME_T},
      ${q('path')}       TEXT,
      ${q('statusCode')} INTEGER,
      ${q('duration')}   INTEGER,
      ${q('ip')}         ${_NAME_T},
      ${q('userId')}     ${_NAME_T},
      ${q('userEntity')} ${_NAME_T},
      ${q('createdAt')}  TEXT NOT NULL
    )
  `);
}

/**
 * Insert a log entry.
 */
async function insertLog({ method, path, statusCode, duration, ip, userId, userEntity }) {
  const id = require('crypto').randomUUID();
  const now = new Date().toISOString();
  await db.queryRun(
    `INSERT INTO ${q('_cs_logs')} (${q('id')},${q('method')},${q('path')},${q('statusCode')},${q('duration')},${q('ip')},${q('userId')},${q('userEntity')},${q('createdAt')})
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, method, path, statusCode, duration, ip || null, userId || null, userEntity || null, now]
  );
}

/**
 * Express middleware that logs each request to the _cs_logs table.
 *
 * @param {object} opts
 * @param {string[]} opts.exclude  Path prefixes to skip logging (e.g. ['/health']).
 */
function requestLoggerMiddleware(opts = {}) {
  const exclude = opts.exclude || [];
  return (req, res, next) => {
    // Skip excluded paths
    for (const prefix of exclude) {
      if (req.path.startsWith(prefix)) return next();
    }

    const start = Date.now();

    // Hook into response finish event
    const originalEnd = res.end;
    res.end = function (...args) {
      res.end = originalEnd;
      res.end(...args);

      const duration = Date.now() - start;
      const userId = (req.user && req.user.id) || null;
      const userEntity = (req.user && req.user.entity) || null;

      // Insert asynchronously (best-effort, don't block response)
      insertLog({
        method: req.method,
        path: req.originalUrl || req.path,
        statusCode: res.statusCode,
        duration,
        ip: req.ip || req.connection?.remoteAddress || null,
        userId,
        userEntity,
      }).catch((e) => logger.warn('Log insert failed:', e.message));
    };

    next();
  };
}

/**
 * Query logs with pagination and filters.
 *
 * @param {object} filters  Optional filters: { method, statusCode, path, from, to }
 * @param {object} opts     { page, perPage, order }
 * @returns {{ data: object[], total: number, currentPage: number, lastPage: number, perPage: number }}
 */
async function queryLogs(filters = {}, opts = {}) {
  const page = Math.max(1, parseInt(opts.page || 1, 10));
  const perPage = Math.min(100, Math.max(1, parseInt(opts.perPage || 50, 10)));
  const order = (opts.order || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const where = [];
  const params = [];

  if (filters.method) {
    where.push(`${q('method')} = ?`);
    params.push(filters.method.toUpperCase());
  }
  if (filters.statusCode) {
    where.push(`${q('statusCode')} = ?`);
    params.push(parseInt(filters.statusCode, 10));
  }
  if (filters.path) {
    where.push(`${q('path')} LIKE ?`);
    params.push(`%${filters.path}%`);
  }
  if (filters.from) {
    where.push(`${q('createdAt')} >= ?`);
    params.push(filters.from);
  }
  if (filters.to) {
    where.push(`${q('createdAt')} <= ?`);
    params.push(filters.to);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRow = await db.queryOne(
    `SELECT COUNT(*) AS cnt FROM ${q('_cs_logs')} ${whereClause}`,
    params
  );
  const total = countRow ? countRow.cnt : 0;
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  const offset = (page - 1) * perPage;

  const data = await db.queryAll(
    `SELECT * FROM ${q('_cs_logs')} ${whereClause} ORDER BY ${q('createdAt')} ${order} LIMIT ? OFFSET ?`,
    [...params, perPage, offset]
  );

  return { data, total, currentPage: page, lastPage, perPage };
}

/**
 * Delete logs older than the specified number of days.
 *
 * @param {number} days  Log retention in days. 0 or negative = keep all.
 * @returns {number}     Number of rows deleted.
 */
async function cleanupOldLogs(days) {
  if (!days || days <= 0) return 0;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = await db.queryRun(
    `DELETE FROM ${q('_cs_logs')} WHERE ${q('createdAt')} < ?`,
    [cutoff]
  );
  return result?.changes || 0;
}

module.exports = {
  initLogs,
  insertLog,
  requestLoggerMiddleware,
  queryLogs,
  cleanupOldLogs,
};
