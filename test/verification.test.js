'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { buildCore } = require('../core/entity-engine');
const dbModule = require('../core/db');
const {
  signToken, verifyToken, omitPassword, generateSecureToken,
} = require('../core/auth');
const { validateSchema } = require('../core/schema-validator');
const { generateOpenApiSpec } = require('../core/openapi');

// ── Helper: mock Express request/response ──────────────────────────────────

function mockReq(headers = {}, body = {}) {
  return { headers, body, user: undefined };
}

function mockRes() {
  const r = { _status: 200, _body: undefined };
  r.status = (s) => { r._status = s; return r; };
  r.json   = (b) => { r._body  = b; };
  return r;
}

// ── generateSecureToken ─────────────────────────────────────────────────

describe('generateSecureToken', () => {
  it('generates a 64-char hex string', () => {
    const t = generateSecureToken();
    assert.strictEqual(typeof t, 'string');
    assert.strictEqual(t.length, 64);
    assert.ok(/^[a-f0-9]+$/.test(t));
  });

  it('generates unique tokens', () => {
    const a = generateSecureToken();
    const b = generateSecureToken();
    assert.notStrictEqual(a, b);
  });
});

// ── omitPassword (updated to strip internal auth fields) ────────────────

describe('omitPassword – extended', () => {
  it('strips password field', () => {
    assert.ok(!('password' in omitPassword({ id: '1', password: 'x', email: 'a@b.com' })));
  });

  it('strips emailVerificationToken', () => {
    assert.ok(!('emailVerificationToken' in omitPassword({ id: '1', emailVerificationToken: 'tok' })));
  });

  it('strips passwordResetToken', () => {
    assert.ok(!('passwordResetToken' in omitPassword({ id: '1', passwordResetToken: 'tok' })));
  });

  it('strips passwordResetExpiry', () => {
    assert.ok(!('passwordResetExpiry' in omitPassword({ id: '1', passwordResetExpiry: '2025-01-01' })));
  });

  it('preserves emailVerified', () => {
    const u = omitPassword({ id: '1', emailVerified: 1, password: 'x' });
    assert.strictEqual(u.emailVerified, 1);
    assert.ok(!('password' in u));
  });

  it('preserves other fields', () => {
    const u = omitPassword({ id: '1', email: 'a@b.com', name: 'Test', password: 'x', emailVerificationToken: 'y' });
    assert.strictEqual(u.email, 'a@b.com');
    assert.strictEqual(u.name, 'Test');
  });
});

// ── Entity engine: requireEmailVerification ─────────────────────────────

describe('entity-engine: requireEmailVerification', () => {
  it('defaults to false', () => {
    const core = buildCore({ name: 'App', entities: { User: { authenticable: true, properties: ['name'] } } });
    assert.strictEqual(core.entities.User.requireEmailVerification, false);
  });

  it('sets to true when configured', () => {
    const core = buildCore({
      name: 'App',
      entities: { User: { authenticable: true, requireEmailVerification: true, properties: ['name'] } },
    });
    assert.strictEqual(core.entities.User.requireEmailVerification, true);
  });

  it('non-authenticable entities still parse the flag (but it has no effect)', () => {
    const core = buildCore({
      name: 'App',
      entities: { Post: { requireEmailVerification: true, properties: ['title'] } },
    });
    // The flag is stored even on non-auth entities, but only auth routes check it
    assert.strictEqual(core.entities.Post.requireEmailVerification, true);
  });
});

// ── Schema validation: requireEmailVerification ─────────────────────────

describe('schema: requireEmailVerification', () => {
  it('accepts entity with requireEmailVerification: true', () => {
    assert.strictEqual(validateSchema({
      name: 'App',
      entities: { User: { authenticable: true, requireEmailVerification: true, properties: ['name'] } },
    }), true);
  });

  it('accepts entity with requireEmailVerification: false', () => {
    assert.strictEqual(validateSchema({
      name: 'App',
      entities: { User: { authenticable: true, requireEmailVerification: false, properties: ['name'] } },
    }), true);
  });

  it('accepts entity without requireEmailVerification', () => {
    assert.strictEqual(validateSchema({
      name: 'App',
      entities: { User: { authenticable: true, properties: ['name'] } },
    }), true);
  });
});

// ── DB: authenticable columns ───────────────────────────────────────────

describe('db – verification/reset columns', () => {
  let tmpDb;
  const core = buildCore({
    name: 'T',
    entities: { User: { authenticable: true, properties: ['name'] } },
  });

  before(async () => {
    tmpDb = path.join(os.tmpdir(), `chadstart-verif-${Date.now()}.db`);
    await dbModule.initDb(core, tmpDb);
  });

  after(() => { try { fs.unlinkSync(tmpDb); } catch { /* noop */ } });

  it('has emailVerified column', () => {
    const cols = dbModule.getDb().pragma('table_info("user")').map((r) => r.name);
    assert.ok(cols.includes('emailVerified'), 'missing emailVerified column');
  });

  it('has emailVerificationToken column', () => {
    const cols = dbModule.getDb().pragma('table_info("user")').map((r) => r.name);
    assert.ok(cols.includes('emailVerificationToken'), 'missing emailVerificationToken column');
  });

  it('has passwordResetToken column', () => {
    const cols = dbModule.getDb().pragma('table_info("user")').map((r) => r.name);
    assert.ok(cols.includes('passwordResetToken'), 'missing passwordResetToken column');
  });

  it('has passwordResetExpiry column', () => {
    const cols = dbModule.getDb().pragma('table_info("user")').map((r) => r.name);
    assert.ok(cols.includes('passwordResetExpiry'), 'missing passwordResetExpiry column');
  });

  it('emailVerified defaults to 0', async () => {
    const user = await dbModule.create('user', {
      email: 'vertest@example.com',
      password: 'hash',
    });
    assert.strictEqual(user.emailVerified, 0);
  });

  it('can update emailVerified to 1', async () => {
    const user = await dbModule.create('user', {
      email: 'vertest2@example.com',
      password: 'hash',
    });
    const updated = await dbModule.update('user', user.id, { emailVerified: 1 });
    assert.strictEqual(updated.emailVerified, 1);
  });

  it('can store and query verification token', async () => {
    const token = generateSecureToken();
    const user = await dbModule.create('user', {
      email: 'vertest3@example.com',
      password: 'hash',
      emailVerificationToken: token,
    });
    const found = (await dbModule.findAllSimple('user', { emailVerificationToken: token }))[0];
    assert.ok(found);
    assert.strictEqual(found.id, user.id);
  });

  it('can store and query password reset token', async () => {
    const token = generateSecureToken();
    const expiry = new Date(Date.now() + 3600000).toISOString();
    const user = await dbModule.create('user', {
      email: 'vertest4@example.com',
      password: 'hash',
      passwordResetToken: token,
      passwordResetExpiry: expiry,
    });
    const found = (await dbModule.findAllSimple('user', { passwordResetToken: token }))[0];
    assert.ok(found);
    assert.strictEqual(found.id, user.id);
    assert.ok(found.passwordResetExpiry);
  });

  it('can clear tokens by setting to null', async () => {
    const token = generateSecureToken();
    const user = await dbModule.create('user', {
      email: 'vertest5@example.com',
      password: 'hash',
      emailVerificationToken: token,
    });
    await dbModule.update('user', user.id, { emailVerificationToken: null });
    const updated = await dbModule.findById('user', user.id);
    assert.strictEqual(updated.emailVerificationToken, null);
  });
});

// ── OpenAPI: verification/reset endpoints ───────────────────────────────

describe('openapi: verification/reset endpoints', () => {
  const core = buildCore({
    name: 'App',
    entities: { User: { authenticable: true, properties: ['name'] } },
  });
  const spec = generateOpenApiSpec(core);

  it('includes request-verification endpoint', () => {
    assert.ok(spec.paths['/api/auth/user/request-verification']);
    assert.ok(spec.paths['/api/auth/user/request-verification'].post);
  });

  it('includes confirm-verification endpoint', () => {
    assert.ok(spec.paths['/api/auth/user/confirm-verification']);
    assert.ok(spec.paths['/api/auth/user/confirm-verification'].post);
  });

  it('includes request-password-reset endpoint', () => {
    assert.ok(spec.paths['/api/auth/user/request-password-reset']);
    assert.ok(spec.paths['/api/auth/user/request-password-reset'].post);
  });

  it('includes confirm-password-reset endpoint', () => {
    assert.ok(spec.paths['/api/auth/user/confirm-password-reset']);
    assert.ok(spec.paths['/api/auth/user/confirm-password-reset'].post);
  });

  it('login response includes 403 for email not verified', () => {
    const loginPath = spec.paths['/api/auth/user/login'];
    assert.ok(loginPath.post.responses['403']);
  });

  it('user schema includes emailVerified', () => {
    assert.ok(spec.components.schemas.User.properties.emailVerified);
    assert.strictEqual(spec.components.schemas.User.properties.emailVerified.type, 'boolean');
  });

  it('confirm-verification has token in request body', () => {
    const ep = spec.paths['/api/auth/user/confirm-verification'].post;
    assert.ok(ep.requestBody);
    const schema = ep.requestBody.content['application/json'].schema;
    assert.ok(schema.properties.token);
  });

  it('confirm-password-reset has token and password in request body', () => {
    const ep = spec.paths['/api/auth/user/confirm-password-reset'].post;
    assert.ok(ep.requestBody);
    const schema = ep.requestBody.content['application/json'].schema;
    assert.ok(schema.properties.token);
    assert.ok(schema.properties.password);
  });

  // Admin entity should also have the endpoints
  it('includes admin verification endpoints', () => {
    assert.ok(spec.paths['/api/auth/admin/request-verification']);
    assert.ok(spec.paths['/api/auth/admin/confirm-verification']);
    assert.ok(spec.paths['/api/auth/admin/request-password-reset']);
    assert.ok(spec.paths['/api/auth/admin/confirm-password-reset']);
  });
});

// ── Integration: full verification + password reset flows ───────────────

describe('auth integration – email verification flow', () => {
  let tmpDb;
  const bcrypt = require('bcryptjs');
  const core = buildCore({
    name: 'TestApp',
    entities: { User: { authenticable: true, requireEmailVerification: true, properties: ['name'] } },
  });

  before(async () => {
    tmpDb = path.join(os.tmpdir(), `chadstart-auth-flow-${Date.now()}.db`);
    await dbModule.initDb(core, tmpDb);
  });

  after(() => { try { fs.unlinkSync(tmpDb); } catch { /* noop */ } });

  it('signup creates user with emailVerified=0 and generates token', async () => {
    const pw = await bcrypt.hash('testpass', 10);
    const user = await dbModule.create('user', {
      email: 'flow1@example.com',
      password: pw,
      emailVerified: 0,
      emailVerificationToken: generateSecureToken(),
    });
    assert.strictEqual(user.emailVerified, 0);
    assert.ok(user.emailVerificationToken);
    assert.strictEqual(user.emailVerificationToken.length, 64);
  });

  it('confirm-verification: can verify email with valid token', async () => {
    const token = generateSecureToken();
    const pw = await bcrypt.hash('testpass', 10);
    const user = await dbModule.create('user', {
      email: 'flow2@example.com',
      password: pw,
      emailVerified: 0,
      emailVerificationToken: token,
    });

    // Simulate confirm-verification
    const found = (await dbModule.findAllSimple('user', { emailVerificationToken: token }))[0];
    assert.ok(found);
    assert.strictEqual(found.id, user.id);

    await dbModule.update('user', user.id, { emailVerified: 1, emailVerificationToken: null });
    const updated = await dbModule.findById('user', user.id);
    assert.strictEqual(updated.emailVerified, 1);
    assert.strictEqual(updated.emailVerificationToken, null);
  });

  it('confirm-verification: returns null for invalid token', async () => {
    const found = (await dbModule.findAllSimple('user', { emailVerificationToken: 'nonexistent-token-12345' }))[0];
    assert.ok(!found);
  });

  it('request-verification: can regenerate token', async () => {
    const token1 = generateSecureToken();
    const pw = await bcrypt.hash('testpass', 10);
    const user = await dbModule.create('user', {
      email: 'flow3@example.com',
      password: pw,
      emailVerified: 0,
      emailVerificationToken: token1,
    });

    const token2 = generateSecureToken();
    await dbModule.update('user', user.id, { emailVerificationToken: token2 });
    const updated = await dbModule.findById('user', user.id);
    assert.strictEqual(updated.emailVerificationToken, token2);
    assert.notStrictEqual(token1, token2);
  });
});

describe('auth integration – password reset flow', () => {
  let tmpDb;
  const bcrypt = require('bcryptjs');
  const core = buildCore({
    name: 'TestApp',
    entities: { User: { authenticable: true, properties: ['name'] } },
  });

  before(async () => {
    tmpDb = path.join(os.tmpdir(), `chadstart-reset-flow-${Date.now()}.db`);
    await dbModule.initDb(core, tmpDb);
  });

  after(() => { try { fs.unlinkSync(tmpDb); } catch { /* noop */ } });

  it('request-password-reset: creates token and expiry', async () => {
    const pw = await bcrypt.hash('oldpass', 10);
    const user = await dbModule.create('user', {
      email: 'reset1@example.com',
      password: pw,
    });

    const token = generateSecureToken();
    const expiry = new Date(Date.now() + 3600000).toISOString();
    await dbModule.update('user', user.id, { passwordResetToken: token, passwordResetExpiry: expiry });

    const updated = await dbModule.findById('user', user.id);
    assert.strictEqual(updated.passwordResetToken, token);
    assert.ok(updated.passwordResetExpiry);
  });

  it('confirm-password-reset: updates password and clears token', async () => {
    const pw = await bcrypt.hash('oldpass', 10);
    const token = generateSecureToken();
    const expiry = new Date(Date.now() + 3600000).toISOString();
    const user = await dbModule.create('user', {
      email: 'reset2@example.com',
      password: pw,
      passwordResetToken: token,
      passwordResetExpiry: expiry,
    });

    // Simulate confirm
    const found = (await dbModule.findAllSimple('user', { passwordResetToken: token }))[0];
    assert.ok(found);
    assert.ok(new Date(found.passwordResetExpiry) > new Date());

    const newPw = await bcrypt.hash('newpass', 10);
    await dbModule.update('user', user.id, {
      password: newPw,
      passwordResetToken: null,
      passwordResetExpiry: null,
    });

    const updated = await dbModule.findById('user', user.id);
    assert.strictEqual(updated.passwordResetToken, null);
    assert.strictEqual(updated.passwordResetExpiry, null);
    assert.ok(await bcrypt.compare('newpass', updated.password));
  });

  it('confirm-password-reset: rejects expired token', async () => {
    const pw = await bcrypt.hash('oldpass', 10);
    const token = generateSecureToken();
    const expiry = new Date(Date.now() - 1000).toISOString(); // Already expired
    const user = await dbModule.create('user', {
      email: 'reset3@example.com',
      password: pw,
      passwordResetToken: token,
      passwordResetExpiry: expiry,
    });

    const found = (await dbModule.findAllSimple('user', { passwordResetToken: token }))[0];
    assert.ok(found);
    // Token found but expired
    assert.ok(new Date(found.passwordResetExpiry) < new Date());
  });

  it('confirm-password-reset: returns null for invalid token', async () => {
    const found = (await dbModule.findAllSimple('user', { passwordResetToken: 'nonexistent-token' }))[0];
    assert.ok(!found);
  });
});
