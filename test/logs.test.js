'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { buildCore } = require('../core/entity-engine');
const dbModule = require('../core/db');
const { initLogs, insertLog, queryLogs, cleanupOldLogs, requestLoggerMiddleware } = require('../core/logs');
const { validateSchema } = require('../core/schema-validator');

// ── Logs module ──────────────────────────────────────────────────────────

describe('logs module', () => {
  let tmpDb;
  const core = buildCore({ name: 'LogTest', entities: { Widget: { properties: ['name'] } } });

  before(async () => {
    tmpDb = path.join(os.tmpdir(), `chadstart-logs-${Date.now()}.db`);
    await dbModule.initDb(core, tmpDb);
    await initLogs();
  });

  after(() => { try { fs.unlinkSync(tmpDb); } catch { /* noop */ } });

  it('initLogs creates _cs_logs table', () => {
    const tables = dbModule.getDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_cs_logs'").all();
    assert.ok(tables.length > 0, '_cs_logs table should exist');
  });

  it('insertLog inserts a record', async () => {
    await insertLog({
      method: 'GET',
      path: '/api/collections/widgets',
      statusCode: 200,
      duration: 42,
      ip: '127.0.0.1',
    });
    const result = await queryLogs();
    assert.ok(result.data.length >= 1);
    assert.strictEqual(result.data[0].method, 'GET');
    assert.strictEqual(result.data[0].statusCode, 200);
  });

  it('insertLog with user info', async () => {
    await insertLog({
      method: 'POST',
      path: '/api/auth/admin/login',
      statusCode: 200,
      duration: 100,
      ip: '192.168.1.1',
      userId: 'user-123',
      userEntity: 'Admin',
    });
    const result = await queryLogs({ method: 'POST' });
    const log = result.data.find((l) => l.userId === 'user-123');
    assert.ok(log);
    assert.strictEqual(log.userEntity, 'Admin');
  });

  it('queryLogs returns paginated results', async () => {
    // Insert several logs
    for (let i = 0; i < 5; i++) {
      await insertLog({ method: 'GET', path: `/api/test/${i}`, statusCode: 200, duration: 10 });
    }
    const result = await queryLogs({}, { page: 1, perPage: 3 });
    assert.ok(result.data.length <= 3);
    assert.strictEqual(result.perPage, 3);
    assert.strictEqual(result.currentPage, 1);
    assert.ok(result.total >= 5);
  });

  it('queryLogs filters by method', async () => {
    await insertLog({ method: 'DELETE', path: '/api/delete-test', statusCode: 204, duration: 5 });
    const result = await queryLogs({ method: 'DELETE' });
    assert.ok(result.data.length >= 1);
    assert.ok(result.data.every((l) => l.method === 'DELETE'));
  });

  it('queryLogs filters by statusCode', async () => {
    await insertLog({ method: 'GET', path: '/api/not-found', statusCode: 404, duration: 1 });
    const result = await queryLogs({ statusCode: 404 });
    assert.ok(result.data.length >= 1);
    assert.ok(result.data.every((l) => l.statusCode === 404));
  });

  it('queryLogs filters by path', async () => {
    await insertLog({ method: 'GET', path: '/api/collections/unique-path', statusCode: 200, duration: 1 });
    const result = await queryLogs({ path: 'unique-path' });
    assert.ok(result.data.length >= 1);
    assert.ok(result.data.every((l) => l.path.includes('unique-path')));
  });

  it('queryLogs filters by date range', async () => {
    const now = new Date();
    const from = new Date(now - 60 * 1000).toISOString(); // 1 min ago
    const to = new Date(now.getTime() + 60 * 1000).toISOString(); // 1 min ahead
    const result = await queryLogs({ from, to });
    assert.ok(result.data.length >= 1);
  });

  it('queryLogs respects order parameter', async () => {
    const resultAsc = await queryLogs({}, { order: 'ASC' });
    const resultDesc = await queryLogs({}, { order: 'DESC' });
    if (resultAsc.data.length > 1 && resultDesc.data.length > 1) {
      // ASC: oldest first, DESC: newest first
      assert.ok(resultAsc.data[0].createdAt <= resultAsc.data[resultAsc.data.length - 1].createdAt);
      assert.ok(resultDesc.data[0].createdAt >= resultDesc.data[resultDesc.data.length - 1].createdAt);
    }
  });

  it('cleanupOldLogs removes old entries', async () => {
    // Insert a log with a manually backdated createdAt
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ago
    await dbModule.queryRun(
      `INSERT INTO "_cs_logs" ("id","method","path","statusCode","duration","ip","createdAt") VALUES (?,?,?,?,?,?,?)`,
      ['old-log-id', 'GET', '/api/old', 200, 1, '127.0.0.1', oldDate]
    );

    // Verify it exists
    const before = await dbModule.queryOne(
      `SELECT * FROM "_cs_logs" WHERE "id" = ?`, ['old-log-id']
    );
    assert.ok(before);

    // Cleanup logs older than 30 days
    await cleanupOldLogs(30);

    // Verify it's been deleted
    const after = await dbModule.queryOne(
      `SELECT * FROM "_cs_logs" WHERE "id" = ?`, ['old-log-id']
    );
    assert.ok(!after);
  });

  it('cleanupOldLogs keeps recent entries', async () => {
    const beforeCount = (await queryLogs()).total;
    await cleanupOldLogs(30);
    const afterCount = (await queryLogs()).total;
    // Recent entries should not be deleted
    assert.ok(afterCount >= 1);
  });

  it('cleanupOldLogs with 0 days does nothing', async () => {
    const beforeCount = (await queryLogs()).total;
    const deleted = await cleanupOldLogs(0);
    assert.strictEqual(deleted, 0);
    const afterCount = (await queryLogs()).total;
    assert.strictEqual(beforeCount, afterCount);
  });
});

// ── requestLoggerMiddleware ──────────────────────────────────────────────

describe('requestLoggerMiddleware', () => {
  it('returns a function', () => {
    const mw = requestLoggerMiddleware();
    assert.strictEqual(typeof mw, 'function');
  });

  it('calls next()', (done) => {
    const mw = requestLoggerMiddleware();
    const mockReq = { method: 'GET', path: '/api/test', originalUrl: '/api/test', ip: '127.0.0.1', connection: {} };
    const mockRes = {
      statusCode: 200,
      end: function (...args) {
        // original end
      },
    };
    mw(mockReq, mockRes, done);
  });

  it('skips excluded paths', (done) => {
    const mw = requestLoggerMiddleware({ exclude: ['/health'] });
    const mockReq = { method: 'GET', path: '/health', originalUrl: '/health', ip: '127.0.0.1' };
    const mockRes = { statusCode: 200 };
    mw(mockReq, mockRes, done);
  });

  it('skips excluded path prefixes', (done) => {
    const mw = requestLoggerMiddleware({ exclude: ['/admin/vendor'] });
    const mockReq = { method: 'GET', path: '/admin/vendor/htmx.min.js', originalUrl: '/admin/vendor/htmx.min.js' };
    const mockRes = { statusCode: 200 };
    mw(mockReq, mockRes, done);
  });
});

// ── Schema validation ───────────────────────────────────────────────────

describe('schema: logs', () => {
  it('accepts config without logs section', () => {
    assert.strictEqual(validateSchema({ name: 'App' }), true);
  });

  it('accepts logs with retention', () => {
    assert.strictEqual(validateSchema({ name: 'App', logs: { retention: 7 } }), true);
  });

  it('accepts logs with exclude array', () => {
    assert.strictEqual(validateSchema({
      name: 'App',
      logs: { exclude: ['/health', '/admin/vendor'] },
    }), true);
  });

  it('accepts empty logs object', () => {
    assert.strictEqual(validateSchema({ name: 'App', logs: {} }), true);
  });

  it('rejects unknown logs key', () => {
    assert.throws(() => validateSchema({
      name: 'App',
      logs: { verbose: true },
    }));
  });

  it('rejects retention as string', () => {
    assert.throws(() => validateSchema({
      name: 'App',
      logs: { retention: '30' },
    }));
  });
});

// ── buildCore: logs passthrough ─────────────────────────────────────────

describe('buildCore: logs passthrough', () => {
  it('exposes logs config when provided', () => {
    const core = buildCore({ name: 'App', logs: { retention: 7, exclude: ['/health'] } });
    assert.ok(core.logs);
    assert.strictEqual(core.logs.retention, 7);
    assert.deepStrictEqual(core.logs.exclude, ['/health']);
  });

  it('sets logs to null when not provided', () => {
    const core = buildCore({ name: 'App' });
    assert.strictEqual(core.logs, null);
  });
});
