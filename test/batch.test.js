'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const { buildCore } = require('../core/entity-engine');
const dbModule = require('../core/db');
const { registerApiRoutes } = require('../core/api-generator');
const { JWT_SECRET } = require('../core/auth');

function makeToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

function req(options) {
  return new Promise((resolve, reject) => {
    const { method = 'GET', path: p, body, headers = {}, port } = options;
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: 'localhost', port, path: p, method,
      headers: { 'Content-Type': 'application/json', ...headers,
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    };
    const r = http.request(opts, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(buf); } catch { json = buf; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

describe('batch operations', () => {
  let tmp, server, port;
  const token = makeToken({ id: 'admin-1', entity: 'Admin', role: 'admin' });
  const events = [];

  const core = buildCore({
    name: 'BatchTest',
    entities: {
      Admin: { authenticable: true, properties: ['name'] },
      Task: {
        properties: [
          { name: 'title', type: 'string' },
          { name: 'done', type: 'boolean', default: false },
        ],
        validation: {
          title: { required: true },
        },
        policies: {
          create: [{ access: 'restricted', allow: 'Admin' }],
          read:   [{ access: 'restricted', allow: 'Admin' }],
          update: [{ access: 'restricted', allow: 'Admin' }],
          delete: [{ access: 'restricted', allow: 'Admin' }],
        },
      },
    },
  });

  before(async () => {
    tmp = path.join(os.tmpdir(), `chadstart-batch-${Date.now()}.db`);
    await dbModule.initDb(core, tmp);

    const app = express();
    app.use(express.json());
    registerApiRoutes(app, core, (name, data) => events.push({ name, data }));

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;
  });

  after((done) => {
    server.close(() => { fs.unlinkSync(tmp); done(); });
  });

  beforeEach(() => { events.length = 0; });

  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  // ── POST batch create ──────────────────────────────────────────────────

  describe('POST /api/collections/task/batch', () => {
    it('creates multiple records', async () => {
      const { status, body } = await req({
        port, method: 'POST', path: '/api/collections/task/batch',
        body: [{ title: 'Task A' }, { title: 'Task B' }, { title: 'Task C' }],
        headers: authHeaders(),
      });

      assert.strictEqual(status, 201);
      assert.strictEqual(body.created.length, 3);
      assert.strictEqual(body.errors.length, 0);
      assert.strictEqual(body.created[0].title, 'Task A');
      assert.strictEqual(body.created[1].title, 'Task B');
      assert.strictEqual(events.length, 3);
      assert.ok(events.every((e) => e.name === 'Task.created'));
    });

    it('applies defaults', async () => {
      const { status, body } = await req({
        port, method: 'POST', path: '/api/collections/task/batch',
        body: [{ title: 'Default Test' }],
        headers: authHeaders(),
      });

      assert.strictEqual(status, 201);
      assert.strictEqual(body.created[0].done, 0);
    });

    it('handles explicit boolean values', async () => {
      const { status, body } = await req({
        port, method: 'POST', path: '/api/collections/task/batch',
        body: [{ title: 'Done Task', done: true }],
        headers: authHeaders(),
      });

      assert.strictEqual(status, 201);
      assert.strictEqual(body.created[0].done, 1);
    });

    it('returns validation errors per item', async () => {
      const { status, body } = await req({
        port, method: 'POST', path: '/api/collections/task/batch',
        body: [{ title: 'Good' }, {}],
        headers: authHeaders(),
      });

      assert.strictEqual(status, 207);
      assert.strictEqual(body.created.length, 1);
      assert.strictEqual(body.errors.length, 1);
      assert.strictEqual(body.errors[0].index, 1);
    });

    it('rejects non-array body', async () => {
      const { status, body } = await req({
        port, method: 'POST', path: '/api/collections/task/batch',
        body: { title: 'oops' },
        headers: authHeaders(),
      });
      assert.strictEqual(status, 400);
      assert.ok(body.error.includes('array'));
    });

    it('rejects empty array', async () => {
      const { status, body } = await req({
        port, method: 'POST', path: '/api/collections/task/batch',
        body: [],
        headers: authHeaders(),
      });
      assert.strictEqual(status, 400);
      assert.ok(body.error.includes('empty'));
    });

    it('rejects when all items fail validation', async () => {
      const { status, body } = await req({
        port, method: 'POST', path: '/api/collections/task/batch',
        body: [{}, {}],
        headers: authHeaders(),
      });

      assert.strictEqual(status, 400);
      assert.strictEqual(body.created.length, 0);
      assert.strictEqual(body.errors.length, 2);
    });

    it('returns 401 without auth token', async () => {
      const { status } = await req({
        port, method: 'POST', path: '/api/collections/task/batch',
        body: [{ title: 'X' }],
      });
      assert.strictEqual(status, 401);
    });
  });

  // ── PATCH batch update ─────────────────────────────────────────────────

  describe('PATCH /api/collections/task/batch', () => {
    let ids;

    before(async () => {
      const { body } = await req({
        port, method: 'POST', path: '/api/collections/task/batch',
        body: [{ title: 'Up1' }, { title: 'Up2' }, { title: 'Up3' }],
        headers: authHeaders(),
      });
      ids = body.created.map((r) => r.id);
    });

    it('updates multiple records', async () => {
      events.length = 0;
      const { status, body } = await req({
        port, method: 'PATCH', path: '/api/collections/task/batch',
        body: [{ id: ids[0], title: 'Up1-mod' }, { id: ids[1], done: 1 }],
        headers: authHeaders(),
      });

      assert.strictEqual(status, 200);
      assert.strictEqual(body.updated.length, 2);
      assert.strictEqual(body.errors.length, 0);
      assert.strictEqual(body.updated[0].title, 'Up1-mod');
      assert.strictEqual(body.updated[1].done, 1);
      assert.strictEqual(events.length, 2);
      assert.ok(events.every((e) => e.name === 'Task.updated'));
    });

    it('reports errors for missing records', async () => {
      const { status, body } = await req({
        port, method: 'PATCH', path: '/api/collections/task/batch',
        body: [{ id: ids[0], title: 'OK' }, { id: 'nonexistent', title: 'Nope' }],
        headers: authHeaders(),
      });

      assert.strictEqual(status, 207);
      assert.strictEqual(body.updated.length, 1);
      assert.strictEqual(body.errors.length, 1);
      assert.strictEqual(body.errors[0].error, 'Not found');
    });

    it('reports error for missing id', async () => {
      const { status, body } = await req({
        port, method: 'PATCH', path: '/api/collections/task/batch',
        body: [{ title: 'NoId' }],
        headers: authHeaders(),
      });

      assert.strictEqual(status, 400);
      assert.strictEqual(body.errors[0].error, 'Missing id');
    });

    it('rejects non-array body', async () => {
      const { status } = await req({
        port, method: 'PATCH', path: '/api/collections/task/batch',
        body: { id: ids[0] },
        headers: authHeaders(),
      });
      assert.strictEqual(status, 400);
    });

    it('rejects empty array', async () => {
      const { status } = await req({
        port, method: 'PATCH', path: '/api/collections/task/batch',
        body: [],
        headers: authHeaders(),
      });
      assert.strictEqual(status, 400);
    });
  });

  // ── DELETE batch delete ────────────────────────────────────────────────

  describe('DELETE /api/collections/task/batch', () => {
    let ids;

    before(async () => {
      const { body } = await req({
        port, method: 'POST', path: '/api/collections/task/batch',
        body: [{ title: 'Del1' }, { title: 'Del2' }, { title: 'Del3' }],
        headers: authHeaders(),
      });
      ids = body.created.map((r) => r.id);
    });

    it('deletes multiple records', async () => {
      events.length = 0;
      const { status, body } = await req({
        port, method: 'DELETE', path: '/api/collections/task/batch',
        body: { ids: [ids[0], ids[1]] },
        headers: authHeaders(),
      });

      assert.strictEqual(status, 200);
      assert.strictEqual(body.deleted.length, 2);
      assert.strictEqual(body.errors.length, 0);
      assert.strictEqual(events.length, 2);
      assert.ok(events.every((e) => e.name === 'Task.deleted'));

      // Verify they are actually gone
      const { body: remaining } = await req({
        port, method: 'GET', path: '/api/collections/task',
        headers: authHeaders(),
      });
      const remainingIds = remaining.data.map((r) => r.id);
      assert.ok(!remainingIds.includes(ids[0]));
      assert.ok(!remainingIds.includes(ids[1]));
    });

    it('reports errors for missing records', async () => {
      const { status, body } = await req({
        port, method: 'DELETE', path: '/api/collections/task/batch',
        body: { ids: [ids[2], 'no-such-id'] },
        headers: authHeaders(),
      });

      assert.strictEqual(status, 207);
      assert.strictEqual(body.deleted.length, 1);
      assert.strictEqual(body.errors.length, 1);
      assert.strictEqual(body.errors[0].error, 'Not found');
    });

    it('rejects missing ids field', async () => {
      const { status } = await req({
        port, method: 'DELETE', path: '/api/collections/task/batch',
        body: { notIds: [] },
        headers: authHeaders(),
      });
      assert.strictEqual(status, 400);
    });

    it('rejects empty ids array', async () => {
      const { status } = await req({
        port, method: 'DELETE', path: '/api/collections/task/batch',
        body: { ids: [] },
        headers: authHeaders(),
      });
      assert.strictEqual(status, 400);
    });
  });

  // ── Batch size limit ───────────────────────────────────────────────────

  describe('batch size limit', () => {
    it('rejects batch exceeding default limit (100)', async () => {
      const items = Array.from({ length: 101 }, (_, i) => ({ title: `Item ${i}` }));
      const { status, body } = await req({
        port, method: 'POST', path: '/api/collections/task/batch',
        body: items,
        headers: authHeaders(),
      });
      assert.strictEqual(status, 400);
      assert.ok(body.error.includes('limit'));
    });
  });
});

describe('batch operations – custom batchLimit', () => {
  let tmp, server, port;
  const token = makeToken({ id: 'admin-1', entity: 'Admin', role: 'admin' });

  const core = buildCore({
    name: 'BatchLimitTest',
    entities: {
      Admin: { authenticable: true, properties: ['name'] },
      Item: {
        properties: [{ name: 'name', type: 'string' }],
        policies: {
          create: [{ access: 'restricted', allow: 'Admin' }],
          read:   [{ access: 'restricted', allow: 'Admin' }],
          update: [{ access: 'restricted', allow: 'Admin' }],
          delete: [{ access: 'restricted', allow: 'Admin' }],
        },
      },
    },
  });
  // Set batchLimit directly on the entity (buildCore strips unknown keys)
  core.entities.Item.batchLimit = 3;

  before(async () => {
    tmp = path.join(os.tmpdir(), `chadstart-batchlimit-${Date.now()}.db`);
    await dbModule.initDb(core, tmp);

    const app = express();
    app.use(express.json());
    registerApiRoutes(app, core, () => {});

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;
  });

  after((done) => {
    server.close(() => { fs.unlinkSync(tmp); done(); });
  });

  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  it('allows batch within custom limit', async () => {
    const { status } = await req({
      port, method: 'POST', path: '/api/collections/item/batch',
      body: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
      headers: authHeaders(),
    });
    assert.strictEqual(status, 201);
  });

  it('rejects batch exceeding custom limit', async () => {
    const { status, body } = await req({
      port, method: 'POST', path: '/api/collections/item/batch',
      body: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }],
      headers: authHeaders(),
    });
    assert.strictEqual(status, 400);
    assert.ok(body.error.includes('3'));
  });

  it('rejects PATCH batch exceeding custom limit', async () => {
    const { status } = await req({
      port, method: 'PATCH', path: '/api/collections/item/batch',
      body: [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }],
      headers: authHeaders(),
    });
    assert.strictEqual(status, 400);
  });

  it('rejects DELETE batch exceeding custom limit', async () => {
    const { status } = await req({
      port, method: 'DELETE', path: '/api/collections/item/batch',
      body: { ids: ['1', '2', '3', '4'] },
      headers: authHeaders(),
    });
    assert.strictEqual(status, 400);
  });
});

describe('batch operations – public access', () => {
  let tmp, server, port;

  const core = buildCore({
    name: 'BatchPublicTest',
    entities: {
      Note: {
        properties: [{ name: 'text', type: 'string' }],
        policies: {
          create: [{ access: 'public' }],
          read:   [{ access: 'public' }],
          update: [{ access: 'public' }],
          delete: [{ access: 'public' }],
        },
      },
    },
  });

  before(async () => {
    tmp = path.join(os.tmpdir(), `chadstart-batchpub-${Date.now()}.db`);
    await dbModule.initDb(core, tmp);

    const app = express();
    app.use(express.json());
    registerApiRoutes(app, core, () => {});

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;
  });

  after((done) => {
    server.close(() => { fs.unlinkSync(tmp); done(); });
  });

  it('allows batch create without auth for public entity', async () => {
    const { status, body } = await req({
      port, method: 'POST', path: '/api/collections/note/batch',
      body: [{ text: 'Hello' }, { text: 'World' }],
    });
    assert.strictEqual(status, 201);
    assert.strictEqual(body.created.length, 2);
  });

  it('allows batch update without auth for public entity', async () => {
    const { body: created } = await req({
      port, method: 'POST', path: '/api/collections/note/batch',
      body: [{ text: 'A' }],
    });
    const id = created.created[0].id;
    const { status, body } = await req({
      port, method: 'PATCH', path: '/api/collections/note/batch',
      body: [{ id, text: 'A-updated' }],
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.updated[0].text, 'A-updated');
  });

  it('allows batch delete without auth for public entity', async () => {
    const { body: created } = await req({
      port, method: 'POST', path: '/api/collections/note/batch',
      body: [{ text: 'D1' }, { text: 'D2' }],
    });
    const ids = created.created.map((r) => r.id);
    const { status, body } = await req({
      port, method: 'DELETE', path: '/api/collections/note/batch',
      body: { ids },
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.deleted.length, 2);
  });
});
