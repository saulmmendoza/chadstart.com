'use strict';

/**
 * Engine-agnostic HTTP-level integration tests.
 *
 * Runs against a live database specified by DB_ENGINE (postgres | mysql).
 * Execute via:  npm run test:integration
 *
 * Required env vars when DB_ENGINE != sqlite:
 *   DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE
 */

const assert = require('assert');
const http   = require('http');
const path   = require('path');
const os     = require('os');
const fs     = require('fs');

const { buildApp } = require('../../server/express-server');

const YAML_PATH  = path.resolve(__dirname, '../../chadstart.yaml');
const DB_ENGINE  = (process.env.DB_ENGINE || 'sqlite').toLowerCase();

// ── HTTP helper ──────────────────────────────────────────────────────────────

function req(options) {
  return new Promise((resolve, reject) => {
    const { method = 'GET', path: p, body, headers = {}, port } = options;
    const data = body ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: 'localhost',
      port,
      path: p,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
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

// ── Test suite ───────────────────────────────────────────────────────────────

describe(`DB integration – ${DB_ENGINE}`, function () {
  this.timeout(30000);

  let server, port, adminToken, adminId;
  let _sqliteTmpPath; // used only in SQLite mode

  before(async function () {
    // In SQLite mode (local dev smoke-test), write to a temp file
    if (DB_ENGINE === 'sqlite') {
      _sqliteTmpPath = path.join(os.tmpdir(), `integ-test-${Date.now()}.db`);
      process.env.DB_PATH = _sqliteTmpPath;
    }

    const { app } = await buildApp(YAML_PATH, null);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;

    // Unique e-mail per run so re-runs on the same DB don't collide
    const email = `integ-admin-${Date.now()}@test.com`;
    const su = await req({
      port, method: 'POST', path: '/api/auth/admin/signup',
      body: { email, password: 'secret123', name: 'Integration Admin' },
    });
    assert.strictEqual(su.status, 201, `Admin signup failed: ${JSON.stringify(su.body)}`);
    adminToken = su.body.token;
    adminId    = su.body.user.id;
  });

  after(function (done) {
    const cleanup = () => {
      if (_sqliteTmpPath) {
        try { fs.unlinkSync(_sqliteTmpPath); } catch { /* ignore */ }
      }
      done();
    };
    if (server) server.close(cleanup);
    else cleanup();
  });

  // ── Health ─────────────────────────────────────────────────────────────────

  describe('GET /health', () => {
    it('returns ok', async () => {
      const r = await req({ port, path: '/health' });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.status, 'ok');
    });
  });

  // ── Auth ───────────────────────────────────────────────────────────────────

  describe('Auth – Admin collection', () => {
    it('signup returns 201 with token and user', async () => {
      const email = `integ-signup-${Date.now()}@test.com`;
      const r = await req({
        port, method: 'POST', path: '/api/auth/admin/signup',
        body: { email, password: 'pass123', name: 'Signup User' },
      });
      assert.strictEqual(r.status, 201);
      assert.ok(r.body.token, 'should return a token');
      assert.ok(r.body.user.id, 'should return a user id');
      assert.strictEqual(r.body.user.email, email);
      assert.ok(!r.body.user.password, 'password must not be exposed');
    });

    it('signup returns 409 for duplicate email', async () => {
      const email = `integ-dup-${Date.now()}@test.com`;
      await req({ port, method: 'POST', path: '/api/auth/admin/signup', body: { email, password: 'x' } });
      const r = await req({ port, method: 'POST', path: '/api/auth/admin/signup', body: { email, password: 'y' } });
      assert.strictEqual(r.status, 409);
    });

    it('login returns 200 with token for valid credentials', async () => {
      const email = `integ-login-${Date.now()}@test.com`;
      await req({ port, method: 'POST', path: '/api/auth/admin/signup', body: { email, password: 'myPass' } });
      const r = await req({ port, method: 'POST', path: '/api/auth/admin/login', body: { email, password: 'myPass' } });
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.token);
    });

    it('login returns 401 for wrong password', async () => {
      const email = `integ-badpw-${Date.now()}@test.com`;
      await req({ port, method: 'POST', path: '/api/auth/admin/signup', body: { email, password: 'correct' } });
      const r = await req({ port, method: 'POST', path: '/api/auth/admin/login', body: { email, password: 'wrong' } });
      assert.strictEqual(r.status, 401);
    });

    it('GET /me returns current user', async () => {
      const r = await req({
        port, path: '/api/auth/admin/me',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.id, adminId);
    });

    it('GET /me returns 401 without token', async () => {
      const r = await req({ port, path: '/api/auth/admin/me' });
      assert.strictEqual(r.status, 401);
    });
  });

  // ── CRUD – Post collection ─────────────────────────────────────────────────

  describe('CRUD – Post collection', () => {
    let postId;

    it('POST creates a record (admin-restricted)', async () => {
      const r = await req({
        port, method: 'POST', path: '/api/collections/post',
        body: { title: 'Integration Test Post', content: 'Some content', published: true },
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(r.status, 201, JSON.stringify(r.body));
      assert.ok(r.body.id);
      assert.strictEqual(r.body.title, 'Integration Test Post');
      assert.ok(r.body.createdAt);
      assert.ok(r.body.updatedAt);
      postId = r.body.id;
    });

    it('POST returns 401 without token', async () => {
      const r = await req({
        port, method: 'POST', path: '/api/collections/post',
        body: { title: 'No Auth Post', content: 'x' },
      });
      assert.strictEqual(r.status, 401);
    });

    it('GET list returns paginated data (public)', async () => {
      const r = await req({ port, path: '/api/collections/post' });
      assert.strictEqual(r.status, 200);
      assert.ok(Array.isArray(r.body.data));
      assert.ok(typeof r.body.total === 'number');
      assert.ok(typeof r.body.currentPage === 'number');
      assert.ok(r.body.total >= 1, 'should have at least the post we created');
    });

    it('GET list respects pagination params', async () => {
      const r = await req({ port, path: '/api/collections/post?page=1&perPage=1' });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.perPage, 1);
      assert.ok(r.body.data.length <= 1);
    });

    it('GET by id returns the record (public)', async () => {
      const r = await req({ port, path: `/api/collections/post/${postId}` });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.id, postId);
      assert.strictEqual(r.body.title, 'Integration Test Post');
    });

    it('GET by id returns 404 for unknown id', async () => {
      const r = await req({ port, path: '/api/collections/post/nonexistent-id' });
      assert.strictEqual(r.status, 404);
    });

    it('PATCH updates a field (admin-restricted)', async () => {
      const r = await req({
        port, method: 'PATCH', path: `/api/collections/post/${postId}`,
        body: { title: 'Updated Title' },
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.title, 'Updated Title');
      assert.strictEqual(r.body.content, 'Some content', 'other fields should not change');
    });

    it('PATCH returns 401 without token', async () => {
      const r = await req({
        port, method: 'PATCH', path: `/api/collections/post/${postId}`,
        body: { title: 'Unauthorized' },
      });
      assert.strictEqual(r.status, 401);
    });

    it('DELETE removes the record (admin-restricted)', async () => {
      const r = await req({
        port, method: 'DELETE', path: `/api/collections/post/${postId}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.id, postId);
    });

    it('GET by id returns 404 after deletion', async () => {
      const r = await req({ port, path: `/api/collections/post/${postId}` });
      assert.strictEqual(r.status, 404);
    });
  });

  // ── Relations – Comment belongsTo Post ────────────────────────────────────

  describe('Relations – Comment belongsTo Post', () => {
    let parentPostId, commentId;

    before(async () => {
      // Create a parent post
      const r = await req({
        port, method: 'POST', path: '/api/collections/post',
        body: { title: 'Parent Post', content: 'For comments', published: true },
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      parentPostId = r.body.id;
    });

    it('POST comment with post FK', async () => {
      const r = await req({
        port, method: 'POST', path: '/api/collections/comment',
        body: { text: 'Great post!', post_id: parentPostId },
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(r.status, 201, JSON.stringify(r.body));
      assert.ok(r.body.id);
      assert.strictEqual(r.body.post_id, parentPostId);
      commentId = r.body.id;
    });

    it('GET comment with ?relations=Post resolves parent', async () => {
      const r = await req({ port, path: `/api/collections/comment/${commentId}?relations=Post` });
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.Post, 'Post relation should be loaded');
      assert.strictEqual(r.body.Post.id, parentPostId);
    });

    it('GET post list with ?relations=comment resolves children', async () => {
      const r = await req({ port, path: `/api/collections/post/${parentPostId}?relations=comment` });
      assert.strictEqual(r.status, 200);
      assert.ok(Array.isArray(r.body.comment), 'comment relation should be an array');
      assert.ok(r.body.comment.length >= 1);
    });
  });

  // ── API Keys ───────────────────────────────────────────────────────────────

  describe('API Keys', () => {
    let apiKey, apiKeyId;

    it('creates an API key', async () => {
      const r = await req({
        port, method: 'POST', path: '/api/auth/admin/api-keys',
        body: { name: 'IntegKey', permissions: ['read'], entities: [] },
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(r.status, 201);
      assert.ok(r.body.key.startsWith('cs_'));
      assert.strictEqual(r.body.record.name, 'IntegKey');
      assert.ok(!r.body.record.keyHash, 'keyHash must not be exposed');
      apiKey   = r.body.key;
      apiKeyId = r.body.record.id;
    });

    it('API key authenticates a public route', async () => {
      const r = await req({
        port, path: '/api/collections/post',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      assert.strictEqual(r.status, 200);
    });

    it('API key is rejected for a write operation when permission is read-only', async () => {
      const r = await req({
        port, method: 'POST', path: '/api/collections/post',
        body: { title: 'Should fail', content: 'x' },
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      // read-only key: create is not allowed
      assert.strictEqual(r.status, 403);
    });

    it('lists own API keys', async () => {
      const r = await req({
        port, path: '/api/auth/admin/api-keys',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(r.status, 200);
      assert.ok(Array.isArray(r.body));
      assert.ok(r.body.some((k) => k.id === apiKeyId));
      assert.ok(r.body.every((k) => !k.keyHash), 'keyHash must never be exposed');
    });

    it('deletes the API key', async () => {
      const r = await req({
        port, method: 'DELETE', path: `/api/auth/admin/api-keys/${apiKeyId}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.success);
    });

    it('deleted API key is rejected on restricted route', async () => {
      // Use /api/auth/admin/me which requires valid auth
      const r = await req({
        port, path: '/api/auth/admin/me',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      assert.strictEqual(r.status, 401);
    });
  });

  // ── Admin schema ───────────────────────────────────────────────────────────

  describe('GET /admin/schema', () => {
    it('returns entities and userCollections', async () => {
      const r = await req({ port, path: '/admin/schema' });
      assert.strictEqual(r.status, 200);
      assert.ok(Array.isArray(r.body.entities));
      assert.ok(Array.isArray(r.body.userCollections));
      assert.ok(r.body.userCollections.every((e) => e.authenticable));
    });
  });
});
