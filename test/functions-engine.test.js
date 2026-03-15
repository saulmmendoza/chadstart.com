'use strict';

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const http   = require('http');
const express = require('express');

const { resolveSchedule, setupFunctions, cleanup, eventBus } = require('../core/functions-engine');

// ── resolveSchedule ────────────────────────────────────────────────────────────

describe('functions-engine – resolveSchedule', () => {
  it('maps @yearly  → 0 0 1 1 *', () => assert.strictEqual(resolveSchedule('@yearly'),  '0 0 1 1 *'));
  it('maps @annually → 0 0 1 1 *', () => assert.strictEqual(resolveSchedule('@annually'),'0 0 1 1 *'));
  it('maps @monthly → 0 0 1 * *',  () => assert.strictEqual(resolveSchedule('@monthly'), '0 0 1 * *'));
  it('maps @weekly  → 0 0 * * 0',  () => assert.strictEqual(resolveSchedule('@weekly'),  '0 0 * * 0'));
  it('maps @daily   → 0 0 * * *',  () => assert.strictEqual(resolveSchedule('@daily'),   '0 0 * * *'));
  it('maps @midnight → 0 0 * * *', () => assert.strictEqual(resolveSchedule('@midnight'),'0 0 * * *'));
  it('maps @hourly  → 0 * * * *',  () => assert.strictEqual(resolveSchedule('@hourly'),  '0 * * * *'));
  it('passes through standard cron expressions unchanged', () => {
    assert.strictEqual(resolveSchedule('*/10 * * * *'), '*/10 * * * *');
  });
});

// ── HTTP trigger ───────────────────────────────────────────────────────────────

describe('functions-engine – HTTP trigger', () => {
  let server, port, fnDir;

  before(async () => {
    cleanup();
    fnDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-fn-'));
    fs.writeFileSync(path.join(fnDir, 'greet.js'), `module.exports = async function(event, ctx) { return { msg: 'hi', trigger: ctx.trigger }; };`);

    process.env.CHADSTART_FUNCTIONS_FOLDER = fnDir;

    const app = express();
    app.use(express.json());
    setupFunctions(app, {
      greet: {
        runtime: 'js',
        function: 'greet.js',
        triggers: [{ type: 'http', method: 'GET', path: '/greet' }],
      },
    });

    server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });

  after(async () => {
    cleanup();
    await new Promise((r) => server.close(r));
    delete process.env.CHADSTART_FUNCTIONS_FOLDER;
    fs.rmSync(fnDir, { recursive: true, force: true });
  });

  it('GET /greet returns function result', async () => {
    const res  = await fetch(`http://127.0.0.1:${port}/greet`);
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.msg, 'hi');
    assert.strictEqual(body.trigger, 'http');
  });
});

// ── Event trigger ──────────────────────────────────────────────────────────────

describe('functions-engine – event trigger', () => {
  let fnDir;

  before(() => {
    cleanup();
    fnDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-fn-'));
    fs.writeFileSync(path.join(fnDir, 'onMyEvent.js'), `
      module.exports = async function(event, ctx) { global.__csTestPayload = event; };
    `);
    process.env.CHADSTART_FUNCTIONS_FOLDER = fnDir;

    setupFunctions(null, {
      myEventFn: {
        runtime: 'js',
        function: 'onMyEvent.js',
        triggers: [{ type: 'event', name: 'test-event' }],
      },
    });
  });

  after(() => {
    cleanup();
    delete process.env.CHADSTART_FUNCTIONS_FOLDER;
    delete global.__csTestPayload;
    fs.rmSync(fnDir, { recursive: true, force: true });
  });

  it('emitting an event invokes the registered function', async () => {
    global.__csTestPayload = null;
    eventBus.emit('test-event', { value: 42 });
    await new Promise((r) => setTimeout(r, 100));
    assert.deepStrictEqual(global.__csTestPayload, { value: 42 });
  });
});

// ── HTTP trigger with policies ─────────────────────────────────────────────────

describe('functions-engine – HTTP trigger policies', () => {
  let server, port, fnDir;
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || process.env.TOKEN_SECRET_KEY || 'chadstart-dev-secret-change-in-production';

  before(async () => {
    cleanup();
    fnDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-fn-'));
    fs.writeFileSync(path.join(fnDir, 'ok.js'), `module.exports = async function() { return { ok: true }; };`);

    process.env.CHADSTART_FUNCTIONS_FOLDER = fnDir;

    const app = express();
    app.use(express.json());
    setupFunctions(app, {
      publicFn:     { function: 'ok.js', triggers: [{ type: 'http', method: 'GET', path: '/pub',       policies: [{ access: 'public'     }] }] },
      defaultFn:    { function: 'ok.js', triggers: [{ type: 'http', method: 'GET', path: '/default'                                         }] },
      adminFn:      { function: 'ok.js', triggers: [{ type: 'http', method: 'GET', path: '/admin',     policies: [{ access: 'admin'      }] }] },
      forbiddenFn:  { function: 'ok.js', triggers: [{ type: 'http', method: 'GET', path: '/forbidden', policies: [{ access: 'forbidden'  }] }] },
      restrictedFn: { function: 'ok.js', triggers: [{ type: 'http', method: 'GET', path: '/restricted', policies: [{ access: 'restricted', allow: 'Customer' }] }] },
    });

    server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });

  after(async () => {
    cleanup();
    await new Promise((r) => server.close(r));
    delete process.env.CHADSTART_FUNCTIONS_FOLDER;
    fs.rmSync(fnDir, { recursive: true, force: true });
  });

  function makeToken(entity) {
    return jwt.sign({ id: 'test-id', entity }, JWT_SECRET, { expiresIn: '1h' });
  }

  it('public policy: allows unauthenticated requests', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/pub`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
  });

  it('no policy (default): allows unauthenticated requests', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/default`);
    assert.strictEqual(res.status, 200);
  });

  it('admin policy: rejects unauthenticated request with 401', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/admin`);
    assert.strictEqual(res.status, 401);
  });

  it('admin policy: allows any valid JWT', async () => {
    const token = makeToken('Admin');
    const res = await fetch(`http://127.0.0.1:${port}/admin`, { headers: { Authorization: `Bearer ${token}` } });
    assert.strictEqual(res.status, 200);
  });

  it('forbidden policy: always returns 403', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/forbidden`);
    assert.strictEqual(res.status, 403);
  });

  it('restricted policy: rejects unauthenticated request with 401', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/restricted`);
    assert.strictEqual(res.status, 401);
  });

  it('restricted policy: rejects token from wrong entity with 403', async () => {
    const token = makeToken('Admin');
    const res = await fetch(`http://127.0.0.1:${port}/restricted`, { headers: { Authorization: `Bearer ${token}` } });
    assert.strictEqual(res.status, 403);
  });

  it('restricted policy: allows token from correct entity', async () => {
    const token = makeToken('Customer');
    const res = await fetch(`http://127.0.0.1:${port}/restricted`, { headers: { Authorization: `Bearer ${token}` } });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
  });
});


describe('functions-engine – JS format auto-detection', () => {
  let server, port, fnDir;

  before(async () => {
    cleanup();
    fnDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-fn-'));
    fs.writeFileSync(path.join(fnDir, 'universal.js'), `
      module.exports = async function(event, ctx) {
        if (ctx.trigger === 'http') return { format: 'universal' };
      };
    `);
    fs.writeFileSync(path.join(fnDir, 'lambda.js'), `
      exports.handler = async (event, context) => ({ statusCode: 200, body: JSON.stringify({ format: 'lambda' }) });
    `);

    process.env.CHADSTART_FUNCTIONS_FOLDER = fnDir;
    const app = express();
    app.use(express.json());
    setupFunctions(app, {
      universal: { function: 'universal.js', triggers: [{ type: 'http', method: 'GET', path: '/universal' }] },
      lambda:    { function: 'lambda.js',    triggers: [{ type: 'http', method: 'GET', path: '/lambda'    }] },
    });
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });

  after(async () => {
    cleanup();
    await new Promise((r) => server.close(r));
    delete process.env.CHADSTART_FUNCTIONS_FOLDER;
    fs.rmSync(fnDir, { recursive: true, force: true });
  });

  it('universal format function responds correctly', async () => {
    const body = await fetch(`http://127.0.0.1:${port}/universal`).then((r) => r.json());
    assert.strictEqual(body.format, 'universal');
  });

  it('AWS Lambda format function is auto-detected and responds correctly', async () => {
    const body = await fetch(`http://127.0.0.1:${port}/lambda`).then((r) => r.json());
    assert.strictEqual(body.format, 'lambda');
  });
});

