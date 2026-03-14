'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');
const { buildCore } = require('../core/entity-engine');
const dbModule = require('../core/db');
const { seedAll, ADMIN_EMAIL, ADMIN_PASSWORD } = require('../core/seeder');

describe('seeder', () => {
  let seedDbPath;
  let firstSeedResult;
  const seedCore = buildCore({
    name: 'SeedTest',
    entities: {
      Author: {
        authenticable: true,
        properties: ['name'],
        seedCount: 3,
      },
      Article: {
        properties: [
          { name: 'title', type: 'string' },
          { name: 'body', type: 'text' },
          { name: 'views', type: 'integer' },
          { name: 'published', type: 'boolean' },
        ],
        belongsTo: ['Author'],
        seedCount: 5,
      },
    },
  });

  before(async () => {
    seedDbPath = path.join(os.tmpdir(), `chadstart-seed-${Date.now()}.db`);
    dbModule.initDb(seedCore, seedDbPath);
    firstSeedResult = await seedAll(seedCore);
  });

  after(() => { fs.unlinkSync(seedDbPath); });

  it('seedAll returns correct counts', () => {
    assert.strictEqual(firstSeedResult.summary.Author, 3);
    assert.strictEqual(firstSeedResult.summary.Article, 5);
  });

  it('seedAll inserts rows into the database', () => {
    const authors = dbModule.findAll('author', {}, { perPage: 100 });
    assert.ok(authors.total >= 3);
    const articles = dbModule.findAll('article', {}, { perPage: 100 });
    assert.ok(articles.total >= 5);
  });

  it('seedAll creates authenticable records with email field', () => {
    const authors = dbModule.findAll('author', {}, { perPage: 100 });
    for (const a of authors.data) {
      assert.ok(typeof a.email === 'string' && a.email.includes('@'));
      assert.ok(typeof a.password === 'string' && a.password.length > 0);
    }
  });

  it('seedAll links belongsTo FK to a seeded parent', () => {
    const articles = dbModule.findAll('article', {}, { perPage: 100 });
    for (const art of articles.data) {
      assert.ok(art.author_id !== null && art.author_id !== undefined);
    }
  });

  it('seedAll respects default seedCount of 50', async () => {
    const defaultCore = buildCore({
      name: 'DefaultSeed',
      entities: { Tag: { properties: ['label'] } },
    });
    const defaultDbPath = path.join(os.tmpdir(), `chadstart-seed-default-${Date.now()}.db`);
    dbModule.initDb(defaultCore, defaultDbPath);
    const result = await seedAll(defaultCore);
    assert.strictEqual(result.summary.Tag, 50);
    fs.unlinkSync(defaultDbPath);
    // Restore the original seedCore DB for subsequent tests in this describe block
    dbModule.initDb(seedCore, seedDbPath);
  });

  it('seedAll creates admin@chadstart.com in authenticable entities', () => {
    assert.ok(firstSeedResult.adminEntities.includes('Author'));
    assert.strictEqual(firstSeedResult.adminEmail, ADMIN_EMAIL);
    assert.strictEqual(firstSeedResult.adminPassword, ADMIN_PASSWORD);
  });

  it('seedAll creates admin user with correct email in the database', () => {
    dbModule.initDb(seedCore, seedDbPath);
    const admins = dbModule.findAllSimple('author', { email: ADMIN_EMAIL });
    assert.strictEqual(admins.length, 1);
    assert.strictEqual(admins[0].email, ADMIN_EMAIL);
  });

  it('seedAll creates admin user in a fresh database', async () => {
    const freshCore = buildCore({
      name: 'FreshAdminTest',
      entities: {
        User: {
          authenticable: true,
          properties: ['name'],
          seedCount: 2,
        },
      },
    });
    const freshDbPath = path.join(os.tmpdir(), `chadstart-seed-admin-${Date.now()}.db`);
    dbModule.initDb(freshCore, freshDbPath);
    const result = await seedAll(freshCore);
    assert.ok(result.adminEntities.includes('User'));
    const admins = dbModule.findAllSimple('user', { email: ADMIN_EMAIL });
    assert.strictEqual(admins.length, 1);
    assert.strictEqual(admins[0].email, ADMIN_EMAIL);
    fs.unlinkSync(freshDbPath);
  });

  it('seedAll does not create duplicate admin user when one already exists', async () => {
    const dupCore = buildCore({
      name: 'DupAdminTest',
      entities: {
        Member: {
          authenticable: true,
          properties: ['name'],
          seedCount: 2,
        },
      },
    });
    const dupDbPath = path.join(os.tmpdir(), `chadstart-seed-dup-${Date.now()}.db`);
    dbModule.initDb(dupCore, dupDbPath);
    // Manually create the admin user before seeding
    dbModule.create('member', {
      email: ADMIN_EMAIL,
      password: bcrypt.hashSync(ADMIN_PASSWORD, 10),
      name: 'pre-existing admin',
    });
    // seedAll should not create a duplicate
    const result = await seedAll(dupCore);
    assert.strictEqual(result.adminEntities.length, 0);
    const admins = dbModule.findAllSimple('member', { email: ADMIN_EMAIL });
    assert.strictEqual(admins.length, 1);
    fs.unlinkSync(dupDbPath);
  });
});

describe('seeder – property types', () => {
  let tmp;
  const core = buildCore({
    name: 'TypeTest',
    entities: {
      Sample: {
        properties: [
          { name: 'myText',      type: 'text' },
          { name: 'myRichText',  type: 'richText' },
          { name: 'myInt',       type: 'integer' },
          { name: 'myFloat',     type: 'float' },
          { name: 'myReal',      type: 'real' },
          { name: 'myMoney',     type: 'money' },
          { name: 'myBool',      type: 'boolean' },
          { name: 'myDate',      type: 'date' },
          { name: 'myTimestamp', type: 'timestamp' },
          { name: 'myEmail',     type: 'email' },
          { name: 'myLink',      type: 'link' },
          { name: 'myPass',      type: 'password' },
          { name: 'myChoice',    type: 'choice' },
          { name: 'myLocation',  type: 'location' },
          { name: 'myFile',      type: 'file' },
          { name: 'myImage',     type: 'image' },
          { name: 'myJson',      type: 'json' },
          { name: 'myUnknown',   type: 'custom_unknown' },
          { name: 'myOption',    type: 'string', options: ['a', 'b', 'c'] },
        ],
        seedCount: 3,
      },
    },
  });

  before(() => {
    tmp = path.join(os.tmpdir(), `chadstart-seedtypes-${Date.now()}.db`);
    dbModule.initDb(core, tmp);
  });

  after(() => { fs.unlinkSync(tmp); });

  it('seedAll generates values for every property type', async () => {
    const result = await seedAll(core);
    assert.strictEqual(result.summary.Sample, 3);
    const rows = dbModule.findAll('sample', {}, { perPage: 100 });
    assert.strictEqual(rows.total, 3);
    const r = rows.data[0];
    assert.ok(typeof r.myText === 'string' && r.myText.length > 0);
    assert.ok(typeof r.myRichText === 'string');
    assert.ok(typeof r.myInt === 'number');
    assert.ok(typeof r.myFloat === 'number');
    assert.ok(typeof r.myReal === 'number');
    assert.ok(typeof r.myMoney === 'number');
    assert.ok(r.myBool === 0 || r.myBool === 1);
    assert.ok(typeof r.myDate === 'string' && r.myDate.length === 10);
    assert.ok(typeof r.myTimestamp === 'string');
    assert.ok(r.myEmail.includes('@'));
    assert.ok(r.myLink.startsWith('https://'));
    assert.ok(typeof r.myPass === 'string' && r.myPass.length > 0);
    assert.ok(typeof r.myChoice === 'string');
    assert.ok(r.myLocation.includes(','));
    assert.ok(r.myFile.startsWith('/uploads/'));
    assert.ok(r.myImage.startsWith('/uploads/'));
    assert.doesNotThrow(() => JSON.parse(r.myJson));
    assert.ok(typeof r.myUnknown === 'string');
    assert.ok(['a', 'b', 'c'].includes(r.myOption));
  });

  it('seedAll seeds a single entity exactly once', async () => {
    const singleCore = buildCore({
      name: 'SingleTest',
      entities: { Config: { single: true, properties: ['key', 'value'] } },
    });
    const singleTmp = path.join(os.tmpdir(), `chadstart-seedsingle-${Date.now()}.db`);
    dbModule.initDb(singleCore, singleTmp);
    const result = await seedAll(singleCore);
    assert.strictEqual(result.summary.Config, 1);
    fs.unlinkSync(singleTmp);
  });
});

describe('seeder – authenticable entities with explicit email/password properties', () => {
  let tmp;
  const core = buildCore({
    name: 'AuthPropTest',
    entities: {
      Customer: {
        authenticable: true,
        // email and password explicitly listed — seeder should handle these correctly
        properties: [
          { name: 'email', type: 'email' },
          { name: 'password', type: 'password' },
          { name: 'name', type: 'string' },
        ],
        seedCount: 3,
      },
    },
  });

  before(() => {
    tmp = path.join(os.tmpdir(), `chadstart-authprop-${Date.now()}.db`);
    dbModule.initDb(core, tmp);
  });

  after(() => { fs.unlinkSync(tmp); });

  it('initDb does not fail with duplicate email/password columns', () => {
    // The DB was already initialised in before() — if we get here, no duplicate column error
    const cols = dbModule.getDb().pragma('table_info("customer")').map((r) => r.name);
    assert.ok(cols.includes('email'));
    assert.ok(cols.includes('password'));
    assert.ok(cols.includes('name'));
    // email should appear exactly once
    assert.strictEqual(cols.filter((c) => c === 'email').length, 1);
    assert.strictEqual(cols.filter((c) => c === 'password').length, 1);
  });

  it('seedAll succeeds and creates records with valid email addresses', async () => {
    const result = await seedAll(core);
    assert.strictEqual(result.summary.Customer, 3);
    const rows = dbModule.findAll('customer', {}, { perPage: 100 });
    assert.ok(rows.total >= 3);
    for (const r of rows.data) {
      assert.ok(typeof r.email === 'string' && r.email.includes('@'), `email should contain @, got: ${r.email}`);
      assert.ok(typeof r.password === 'string' && r.password.length > 0);
    }
  });

  it('seedAll creates admin user with correct email when entity has explicit email property', async () => {
    const admins = dbModule.findAllSimple('customer', { email: ADMIN_EMAIL });
    assert.strictEqual(admins.length, 1);
    assert.strictEqual(admins[0].email, ADMIN_EMAIL);
  });
});
