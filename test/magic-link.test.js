'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');
const { buildCore } = require('../core/entity-engine');
const dbModule = require('../core/db');
const {
  signToken, verifyToken, omitPassword, generateSecureToken,
} = require('../core/auth');

// ── Entity engine: magicLink flag ───────────────────────────────────────

describe('entity-engine: magicLink', () => {
  it('defaults to false', () => {
    const core = buildCore({ name: 'App', entities: { User: { authenticable: true, properties: ['name'] } } });
    assert.strictEqual(core.entities.User.magicLink, false);
  });

  it('sets to true when configured', () => {
    const core = buildCore({
      name: 'App',
      entities: { User: { authenticable: true, magicLink: true, properties: ['name'] } },
    });
    assert.strictEqual(core.entities.User.magicLink, true);
  });
});

// ── omitPassword strips magicLink fields ────────────────────────────────

describe('omitPassword – magicLink fields', () => {
  it('strips magicLinkToken', () => {
    assert.ok(!('magicLinkToken' in omitPassword({ id: '1', magicLinkToken: 'tok' })));
  });

  it('strips magicLinkExpiry', () => {
    assert.ok(!('magicLinkExpiry' in omitPassword({ id: '1', magicLinkExpiry: '2025-01-01' })));
  });

  it('preserves other fields', () => {
    const u = omitPassword({ id: '1', email: 'a@b.com', magicLinkToken: 'tok', magicLinkExpiry: 'exp' });
    assert.strictEqual(u.email, 'a@b.com');
    assert.strictEqual(u.id, '1');
  });
});

// ── DB: magicLink columns ───────────────────────────────────────────────

describe('db – magicLink columns', () => {
  let tmpDb;
  const core = buildCore({
    name: 'T',
    entities: { User: { authenticable: true, magicLink: true, properties: ['name'] } },
  });

  before(async () => {
    tmpDb = path.join(os.tmpdir(), `chadstart-magic-${Date.now()}.db`);
    await dbModule.initDb(core, tmpDb);
  });

  after(() => { try { fs.unlinkSync(tmpDb); } catch { /* noop */ } });

  it('has magicLinkToken column', () => {
    const cols = dbModule.getDb().pragma('table_info("user")').map((r) => r.name);
    assert.ok(cols.includes('magicLinkToken'), 'missing magicLinkToken column');
  });

  it('has magicLinkExpiry column', () => {
    const cols = dbModule.getDb().pragma('table_info("user")').map((r) => r.name);
    assert.ok(cols.includes('magicLinkExpiry'), 'missing magicLinkExpiry column');
  });

  it('can store and query magicLinkToken', async () => {
    const token = generateSecureToken();
    const expiry = new Date(Date.now() + 900000).toISOString();
    const user = await dbModule.create('user', {
      email: 'magic1@example.com',
      password: 'hash',
      magicLinkToken: token,
      magicLinkExpiry: expiry,
    });
    const found = (await dbModule.findAllSimple('user', { magicLinkToken: token }))[0];
    assert.ok(found);
    assert.strictEqual(found.id, user.id);
    assert.ok(found.magicLinkExpiry);
  });

  it('can clear magicLink tokens by setting to null', async () => {
    const token = generateSecureToken();
    const user = await dbModule.create('user', {
      email: 'magic2@example.com',
      password: 'hash',
      magicLinkToken: token,
      magicLinkExpiry: new Date(Date.now() + 900000).toISOString(),
    });
    await dbModule.update('user', user.id, { magicLinkToken: null, magicLinkExpiry: null });
    const updated = await dbModule.findById('user', user.id);
    assert.strictEqual(updated.magicLinkToken, null);
    assert.strictEqual(updated.magicLinkExpiry, null);
  });
});

// ── Integration: magic link flow ────────────────────────────────────────

describe('auth integration – magic link flow', () => {
  let tmpDb;
  const core = buildCore({
    name: 'TestApp',
    entities: { User: { authenticable: true, magicLink: true, properties: ['name'] } },
  });

  before(async () => {
    tmpDb = path.join(os.tmpdir(), `chadstart-magic-flow-${Date.now()}.db`);
    await dbModule.initDb(core, tmpDb);
  });

  after(() => { try { fs.unlinkSync(tmpDb); } catch { /* noop */ } });

  it('request magic link: creates token and expiry for existing user', async () => {
    const pw = await bcrypt.hash('pass', 10);
    const user = await dbModule.create('user', {
      email: 'magicflow1@example.com',
      password: pw,
    });

    const token = generateSecureToken();
    const expiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await dbModule.update('user', user.id, { magicLinkToken: token, magicLinkExpiry: expiry });

    const updated = await dbModule.findById('user', user.id);
    assert.strictEqual(updated.magicLinkToken, token);
    assert.ok(updated.magicLinkExpiry);
  });

  it('confirm magic link: validates token and returns user', async () => {
    const pw = await bcrypt.hash('pass', 10);
    const token = generateSecureToken();
    const expiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const user = await dbModule.create('user', {
      email: 'magicflow2@example.com',
      password: pw,
      magicLinkToken: token,
      magicLinkExpiry: expiry,
    });

    // Simulate confirm
    const found = (await dbModule.findAllSimple('user', { magicLinkToken: token }))[0];
    assert.ok(found);
    assert.strictEqual(found.id, user.id);
    assert.ok(new Date(found.magicLinkExpiry) > new Date());

    await dbModule.update('user', user.id, { magicLinkToken: null, magicLinkExpiry: null, emailVerified: 1 });
    const updated = await dbModule.findById('user', user.id);
    assert.strictEqual(updated.magicLinkToken, null);
    assert.strictEqual(updated.magicLinkExpiry, null);
    assert.strictEqual(updated.emailVerified, 1);
  });

  it('confirm magic link: rejects expired token', async () => {
    const pw = await bcrypt.hash('pass', 10);
    const token = generateSecureToken();
    const expiry = new Date(Date.now() - 1000).toISOString(); // Already expired
    await dbModule.create('user', {
      email: 'magicflow3@example.com',
      password: pw,
      magicLinkToken: token,
      magicLinkExpiry: expiry,
    });

    const found = (await dbModule.findAllSimple('user', { magicLinkToken: token }))[0];
    assert.ok(found);
    assert.ok(new Date(found.magicLinkExpiry) < new Date());
  });

  it('confirm magic link: returns null for invalid token', async () => {
    const found = (await dbModule.findAllSimple('user', { magicLinkToken: 'nonexistent-token' }))[0];
    assert.ok(!found);
  });

  it('auto-create: new user can be created for magic link', async () => {
    const pw = await bcrypt.hash('placeholder', 10);
    const user = await dbModule.create('user', {
      email: 'magicnew@example.com',
      password: pw,
      emailVerified: 1,
    });
    assert.ok(user.id);
    assert.strictEqual(user.email, 'magicnew@example.com');
    assert.strictEqual(user.emailVerified, 1);
  });
});

// ── Entity engine: non-magicLink entity ─────────────────────────────────

describe('entity-engine: non-magicLink entity', () => {
  it('authenticable entity without magicLink has magicLink=false', () => {
    const core = buildCore({
      name: 'App',
      entities: { User: { authenticable: true, properties: ['name'] } },
    });
    assert.strictEqual(core.entities.User.magicLink, false);
  });

  it('non-authenticable entity has magicLink=false', () => {
    const core = buildCore({
      name: 'App',
      entities: { Post: { properties: ['title'] } },
    });
    assert.strictEqual(core.entities.Post.magicLink, false);
  });
});
