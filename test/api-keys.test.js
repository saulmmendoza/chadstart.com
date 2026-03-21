'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Isolate the DB for each test run
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-apikey-test-'));
process.env.DB_PATH = path.join(TMP_DIR, 'test.db');

const { buildApp } = require('../server/express-server');
const http = require('http');

// ── Helpers ─────────────────────────────────────────────────────────────────

function req(options) {
  return new Promise((resolve, reject) => {
    const { method = 'GET', path: p, body, headers = {} } = options;
    const data = body ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: 'localhost', port: options.port, path: p, method,
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

// ── Test suite ───────────────────────────────────────────────────────────────

describe('API Keys', function () {
  let server, port, adminToken, adminId;

  const YAML_PATH = path.resolve(__dirname, '../chadstart.yaml');

  before(async function () {
    this.timeout(10000);
    const { app } = await buildApp(YAML_PATH, null);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;

    // Sign up an admin user
    const su = await req({ port, method: 'POST', path: '/api/auth/admin/signup',
      body: { email: 'apikey@test.com', password: 'secret123', name: 'Test Admin' } });
    assert.strictEqual(su.status, 201, 'signup should succeed');
    adminToken = su.body.token;
    adminId    = su.body.user.id;
  });

  after(function (done) {
    server.close(done);
  });

  // ── Unit tests (auth module) ──────────────────────────────────────────

  describe('auth module – API key functions', function () {
    const {
      initApiKeys, createApiKey, verifyApiKeyStr, listApiKeys, deleteApiKey,
    } = require('../core/auth');

    it('createApiKey returns a key string and record', async function () {
      const { key, record } = await createApiKey('user-1', 'Admin', { name: 'TestKey', permissions: ['read'], entities: [] });
      assert.ok(key.startsWith('cs_'), 'key should start with cs_');
      assert.strictEqual(key.length, 3 + 64, 'key should be cs_ + 64 hex chars');
      assert.strictEqual(record.name, 'TestKey');
      assert.strictEqual(record.userId, 'user-1');
      assert.strictEqual(record.userEntity, 'Admin');
      assert.deepStrictEqual(record.permissions, ['read']);
      assert.ok(!record.keyHash, 'keyHash should not be in returned record');
    });

    it('verifyApiKeyStr returns record for valid key', async function () {
      const { key } = await createApiKey('user-2', 'Admin', { name: 'Verify' });
      const record = await verifyApiKeyStr(key);
      assert.ok(record, 'should return a record');
      assert.strictEqual(record.userId, 'user-2');
    });

    it('verifyApiKeyStr returns null for wrong key', async function () {
      assert.strictEqual(await verifyApiKeyStr('cs_notavalidkey'), null);
    });

    it('verifyApiKeyStr returns null for non-cs_ prefixed string', async function () {
      assert.strictEqual(await verifyApiKeyStr('eyJhbGciOiJIUzI1NiJ9.x.y'), null);
    });

    it('verifyApiKeyStr returns null for expired key', async function () {
      const pastDate = new Date(Date.now() - 1000).toISOString();
      const { key } = await createApiKey('user-3', 'Admin', { expiresAt: pastDate });
      assert.strictEqual(await verifyApiKeyStr(key), null, 'expired key should return null');
    });

    it('listApiKeys returns user keys', async function () {
      await createApiKey('user-list', 'Admin', { name: 'ListKey' });
      const keys = await listApiKeys('user-list', 'Admin');
      assert.ok(keys.length >= 1);
      assert.ok(keys.every((k) => !k.keyHash), 'keyHash should be stripped');
    });

    it('deleteApiKey removes the key', async function () {
      const { record } = await createApiKey('user-del', 'Admin', { name: 'ToDelete' });
      await deleteApiKey(record.id);
      const verifiedAfterDelete = (await listApiKeys('user-del', 'Admin')).find((k) => k.id === record.id);
      assert.ok(!verifiedAfterDelete, 'key should be deleted');
    });
  });

  // ── resolveAuthHeader ─────────────────────────────────────────────────

  describe('resolveAuthHeader', function () {
    const { resolveAuthHeader, signToken, createApiKey } = require('../core/auth');

    it('resolves JWT Bearer tokens', async function () {
      const token = signToken({ id: 'u1', entity: 'Admin' });
      const { user, error } = await resolveAuthHeader(`Bearer ${token}`);
      assert.ok(user);
      assert.strictEqual(user.id, 'u1');
      assert.strictEqual(error, null);
    });

    it('returns error for no header', async function () {
      const { user, error } = await resolveAuthHeader(undefined);
      assert.ok(!user);
      assert.strictEqual(error, 'no_header');
    });

    it('resolves API key Bearer tokens', async function () {
      const { key } = await createApiKey('u-resolve', 'Admin', { permissions: ['read'], entities: ['posts'] });
      const { user, apiKeyPermissions, error } = await resolveAuthHeader(`Bearer ${key}`);
      assert.ok(user);
      assert.strictEqual(user.id, 'u-resolve');
      assert.strictEqual(error, null);
      assert.deepStrictEqual(apiKeyPermissions.operations, ['read']);
      assert.deepStrictEqual(apiKeyPermissions.entities, ['posts']);
    });

    it('returns error for invalid token', async function () {
      const { user, error } = await resolveAuthHeader('Bearer bad-token-here');
      assert.ok(!user);
      assert.strictEqual(error, 'invalid_token');
    });
  });

  // ── HTTP API – user self-service ──────────────────────────────────────

  describe('GET /api/auth/admin/api-keys', function () {
    it('returns 401 without token', async function () {
      const r = await req({ port, path: '/api/auth/admin/api-keys' });
      assert.strictEqual(r.status, 401);
    });

    it('returns empty array initially', async function () {
      const r = await req({ port, path: '/api/auth/admin/api-keys',
        headers: { Authorization: `Bearer ${adminToken}` } });
      assert.strictEqual(r.status, 200);
      assert.ok(Array.isArray(r.body));
    });
  });

  describe('POST /api/auth/admin/api-keys', function () {
    it('returns 401 without token', async function () {
      const r = await req({ port, method: 'POST', path: '/api/auth/admin/api-keys', body: { name: 'X' } });
      assert.strictEqual(r.status, 401);
    });

    it('creates a key and returns the plaintext key once', async function () {
      const r = await req({ port, method: 'POST', path: '/api/auth/admin/api-keys',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: 'My Key', permissions: ['read'], entities: [], expiresAt: null },
      });
      assert.strictEqual(r.status, 201);
      assert.ok(r.body.key, 'should return the plaintext key');
      assert.ok(r.body.key.startsWith('cs_'), 'key should start with cs_');
      assert.ok(r.body.record, 'should return the record');
      assert.ok(!r.body.record.keyHash, 'keyHash must not be exposed');
      assert.strictEqual(r.body.record.name, 'My Key');
    });
  });

  describe('DELETE /api/auth/admin/api-keys/:id', function () {
    it('deletes own API key', async function () {
      // Create
      const create = await req({ port, method: 'POST', path: '/api/auth/admin/api-keys',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: 'ToDelete' },
      });
      assert.strictEqual(create.status, 201);
      const keyId = create.body.record.id;

      // Delete
      const del = await req({ port, method: 'DELETE', path: `/api/auth/admin/api-keys/${keyId}`,
        headers: { Authorization: `Bearer ${adminToken}` } });
      assert.strictEqual(del.status, 200);
      assert.ok(del.body.success);
    });

    it('returns 404 for non-existent key', async function () {
      const r = await req({ port, method: 'DELETE', path: '/api/auth/admin/api-keys/nonexistent-id',
        headers: { Authorization: `Bearer ${adminToken}` } });
      assert.strictEqual(r.status, 404);
    });
  });

  // ── HTTP API – using API key for authentication ───────────────────────

  describe('API key authentication on entity routes', function () {
    let apiKey;

    before(async function () {
      // Create an API key with read-only access to 'post' entity
      const r = await req({ port, method: 'POST', path: '/api/auth/admin/api-keys',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: 'ReadOnly', permissions: ['read'], entities: ['post'], expiresAt: null },
      });
      assert.strictEqual(r.status, 201);
      apiKey = r.body.key;
    });

    it('can access public routes with API key', async function () {
      // Post has public read policy
      const r = await req({ port, path: '/api/collections/post',
        headers: { Authorization: `Bearer ${apiKey}` } });
      assert.strictEqual(r.status, 200);
    });

    it('rejects API key for entities not in entity access list', async function () {
      // Create a key restricted to 'post' only
      const createR = await req({ port, method: 'POST', path: '/api/auth/admin/api-keys',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: 'PostOnly', permissions: ['read', 'create', 'update', 'delete'], entities: ['post'] },
      });
      const restrictedKey = createR.body.key;
      // Attempt to access 'comment' (not in entities list)
      const r = await req({ port, path: '/api/collections/comment',
        headers: { Authorization: `Bearer ${restrictedKey}` } });
      assert.strictEqual(r.status, 403);
    });
  });

  // ── Admin routes ──────────────────────────────────────────────────────

  describe('GET /admin/api-keys', function () {
    it('returns 401 without token', async function () {
      const r = await req({ port, path: '/admin/api-keys' });
      assert.strictEqual(r.status, 401);
    });

    it('returns array with valid token', async function () {
      const r = await req({ port, path: '/admin/api-keys',
        headers: { Authorization: `Bearer ${adminToken}` } });
      assert.strictEqual(r.status, 200);
      assert.ok(Array.isArray(r.body));
      assert.ok(r.body.every((k) => !k.keyHash), 'keyHash must never be exposed');
    });
  });

  describe('POST /admin/api-keys (admin creates for any user)', function () {
    it('creates key for a specific user', async function () {
      const r = await req({ port, method: 'POST', path: '/admin/api-keys',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { userId: adminId, userEntity: 'Admin', name: 'AdminCreated', permissions: [], entities: [] },
      });
      assert.strictEqual(r.status, 201);
      assert.ok(r.body.key.startsWith('cs_'));
      assert.strictEqual(r.body.record.userId, adminId);
    });

    it('returns 400 when userId is missing', async function () {
      const r = await req({ port, method: 'POST', path: '/admin/api-keys',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { userEntity: 'Admin', name: 'NoUser' },
      });
      assert.strictEqual(r.status, 400);
    });
  });

  describe('DELETE /admin/api-keys/:id', function () {
    it('admin can delete any API key', async function () {
      const create = await req({ port, method: 'POST', path: '/admin/api-keys',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { userId: adminId, userEntity: 'Admin', name: 'AdminDel' },
      });
      const keyId = create.body.record.id;
      const del = await req({ port, method: 'DELETE', path: `/admin/api-keys/${keyId}`,
        headers: { Authorization: `Bearer ${adminToken}` } });
      assert.strictEqual(del.status, 200);
    });
  });

  // ── POST /admin/impersonate ───────────────────────────────────────────

  describe('POST /admin/impersonate', function () {
    it('returns 401 without token', async function () {
      const r = await req({ port, method: 'POST', path: '/admin/impersonate',
        body: { userId: adminId, userEntity: 'Admin' } });
      assert.strictEqual(r.status, 401);
    });

    it('returns 400 when userId is missing', async function () {
      const r = await req({ port, method: 'POST', path: '/admin/impersonate',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { userEntity: 'Admin' } });
      assert.strictEqual(r.status, 400);
    });

    it('returns impersonation token with impersonated flag', async function () {
      const r = await req({ port, method: 'POST', path: '/admin/impersonate',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { userId: adminId, userEntity: 'Admin' } });
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.token, 'should return a token');
      assert.ok(r.body.expiresAt, 'should return an expiry');
      assert.strictEqual(r.body.userId, adminId);
      // Verify the token decodes correctly
      const { verifyToken } = require('../core/auth');
      const payload = verifyToken(r.body.token);
      assert.strictEqual(payload.id, adminId);
      assert.strictEqual(payload.entity, 'Admin');
      assert.strictEqual(payload.impersonated, true);
    });

    it('returns 404 for non-existent user', async function () {
      const r = await req({ port, method: 'POST', path: '/admin/impersonate',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { userId: 'non-existent-user', userEntity: 'Admin' } });
      assert.strictEqual(r.status, 404);
    });

    it('returns 404 for unknown user collection', async function () {
      const r = await req({ port, method: 'POST', path: '/admin/impersonate',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { userId: adminId, userEntity: 'NonExistent' } });
      assert.strictEqual(r.status, 404);
    });
  });

  // ── Admin schema returns userCollections ──────────────────────────────

  describe('GET /admin/schema', function () {
    it('returns userCollections field with authenticable entities', async function () {
      const r = await req({ port, path: '/admin/schema' });
      assert.strictEqual(r.status, 200);
      assert.ok(Array.isArray(r.body.userCollections), 'userCollections should be an array');
      assert.ok(r.body.userCollections.every((e) => e.authenticable), 'all userCollections should be authenticable');
      assert.ok(Array.isArray(r.body.entities), 'entities should be an array');
    });
  });
});
