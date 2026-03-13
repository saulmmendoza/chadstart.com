'use strict';

/**
 * Minimal test suite for ChadStart core modules.
 * Uses Node.js built-in assert — no test framework needed.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  \u2705 ${name}`);
    passed++;
  } catch (err) {
    console.error(`  \u274c ${name}: ${err.message}`);
    failed++;
  }
}

(async () => {

// --- schema-validator --------------------------------------------------------

console.log('\nschema-validator');
const { validateSchema } = require('../core/schema-validator');

await test('accepts valid minimal config', () => {
  assert.strictEqual(validateSchema({ name: 'Test' }), true);
});

await test('rejects missing name', () => {
  assert.throws(() => validateSchema({}), /name/);
});

await test('rejects non-string name', () => {
  assert.throws(() => validateSchema({ name: 42 }), /name/);
});

await test('accepts entities map', () => {
  assert.strictEqual(
    validateSchema({ name: 'App', entities: { Post: { properties: ['title'] } } }),
    true
  );
});

await test('rejects entities as array', () => {
  assert.throws(() => validateSchema({ name: 'App', entities: [] }), /entities/);
});

await test('rejects property that is not a string or named object', () => {
  assert.throws(
    () => validateSchema({ name: 'App', entities: { Post: { properties: [42] } } }),
    /property/
  );
});

await test('accepts object property with name field', () => {
  assert.strictEqual(
    validateSchema({ name: 'App', entities: { Post: { properties: [{ name: 'title', type: 'text' }] } } }),
    true
  );
});

await test('rejects invalid file bucket (missing path)', () => {
  assert.throws(
    () => validateSchema({ name: 'App', files: { uploads: {} } }),
    /path/
  );
});

await test('rejects invalid plugin (missing repo or path)', () => {
  assert.throws(
    () => validateSchema({ name: 'App', plugins: [{ name: 'bad' }] }),
    /repo.*path|path.*repo/i
  );
});

// --- entity-engine -----------------------------------------------------------

console.log('\nentity-engine');
const { buildCore, toSnakeCase } = require('../core/entity-engine');

await test('toSnakeCase converts PascalCase', () => {
  assert.strictEqual(toSnakeCase('BlogPost'), 'blog_post');
});

await test('toSnakeCase leaves lowercase unchanged', () => {
  assert.strictEqual(toSnakeCase('post'), 'post');
});

await test('buildCore populates entities', () => {
  const config = {
    name: 'Blog',
    entities: {
      Post: { properties: ['title', 'content'] },
    },
  };
  const core = buildCore(config);
  assert.ok(core.entities.Post);
  assert.strictEqual(core.entities.Post.tableName, 'post');
  assert.deepStrictEqual(
    core.entities.Post.properties.map((p) => p.name),
    ['title', 'content']
  );
});

await test('buildCore normalizes object properties', () => {
  const config = {
    name: 'App',
    entities: {
      Item: { properties: [{ name: 'price', type: 'number' }] },
    },
  };
  const core = buildCore(config);
  assert.strictEqual(core.entities.Item.properties[0].type, 'number');
});

await test('buildCore sets default port', () => {
  const core = buildCore({ name: 'App' });
  assert.ok(typeof core.port === 'number');
});

// --- db ----------------------------------------------------------------------

console.log('\ndb');
const dbModule = require('../core/db');

const tmpDb = path.join(os.tmpdir(), `chadstart-test-${Date.now()}.db`);

const testCore = buildCore({
  name: 'TestApp',
  entities: {
    Widget: { properties: ['name', 'color'] },
  },
});

await test('initDb creates database file', () => {
  dbModule.initDb(testCore, tmpDb);
  assert.ok(fs.existsSync(tmpDb));
});

await test('create inserts a row', () => {
  const row = dbModule.create('widget', { name: 'Foo', color: 'red' });
  assert.strictEqual(row.name, 'Foo');
  assert.strictEqual(row.color, 'red');
  assert.ok(row.id > 0);
});

await test('findAll returns all rows', () => {
  const rows = dbModule.findAll('widget');
  assert.ok(rows.length >= 1);
});

await test('findById returns correct row', () => {
  const created = dbModule.create('widget', { name: 'Bar', color: 'blue' });
  const found = dbModule.findById('widget', created.id);
  assert.strictEqual(found.name, 'Bar');
});

await test('findById returns null for missing row', () => {
  const found = dbModule.findById('widget', 99999);
  assert.strictEqual(found, null);
});

await test('update modifies row', () => {
  const created = dbModule.create('widget', { name: 'Baz', color: 'green' });
  const updated = dbModule.update('widget', created.id, { color: 'yellow' });
  assert.strictEqual(updated.color, 'yellow');
  assert.strictEqual(updated.name, 'Baz');
});

await test('remove deletes row and returns it', () => {
  const created = dbModule.create('widget', { name: 'Del', color: 'gray' });
  const removed = dbModule.remove('widget', created.id);
  assert.strictEqual(removed.id, created.id);
  assert.strictEqual(dbModule.findById('widget', created.id), null);
});

await test('remove returns null for non-existent row', () => {
  assert.strictEqual(dbModule.remove('widget', 99999), null);
});

await test('findAll with filters', () => {
  dbModule.create('widget', { name: 'Red1', color: 'red' });
  dbModule.create('widget', { name: 'Blue1', color: 'blue' });
  const reds = dbModule.findAll('widget', { color: 'red' });
  assert.ok(reds.every((r) => r.color === 'red'));
});

// Cleanup test db file
fs.unlinkSync(tmpDb);

// --- openapi -----------------------------------------------------------------

console.log('\nopenapi');
const { generateOpenApiSpec } = require('../core/openapi');

await test('generates valid openapi spec structure', () => {
  const core = buildCore({
    name: 'Blog',
    entities: {
      Post: { properties: ['title', 'content'] },
    },
  });
  const spec = generateOpenApiSpec(core);
  assert.strictEqual(spec.openapi, '3.0.0');
  assert.ok(spec.paths['/api/posts']);
  assert.ok(spec.paths['/api/posts/{id}']);
  assert.ok(spec.components.schemas.Post);
});

await test('openapi spec includes file bucket paths', () => {
  const core = buildCore({
    name: 'App',
    files: { uploads: { path: '/tmp/uploads', public: true } },
  });
  const spec = generateOpenApiSpec(core);
  assert.ok(spec.paths['/files/uploads']);
  assert.ok(spec.paths['/files/uploads/{file}']);
});

// --- yaml-loader -------------------------------------------------------------

console.log('\nyaml-loader');
const { loadYaml } = require('../core/yaml-loader');

await test('loads the example chadstart.yaml', () => {
  const config = loadYaml(path.resolve(__dirname, '..', 'chadstart.yaml'));
  assert.strictEqual(config.name, 'Blog');
  assert.ok(config.entities);
  assert.ok(config.entities.Post);
});

await test('loads userCollections from chadstart.yaml', () => {
  const config = loadYaml(path.resolve(__dirname, '..', 'chadstart.yaml'));
  assert.ok(config.userCollections);
  assert.ok(config.userCollections.Admin);
  assert.ok(config.userCollections.Customer);
});

await test('throws when file does not exist', () => {
  assert.throws(() => loadYaml('/nonexistent/path/chadstart.yaml'), /not found/i);
});

// --- schema-validator: userCollections ----------------------------------------

console.log('\nschema-validator – userCollections');

await test('accepts valid userCollections', () => {
  assert.strictEqual(
    validateSchema({ name: 'App', userCollections: { Admin: { properties: ['name'] } } }),
    true
  );
});

await test('rejects userCollections as array', () => {
  assert.throws(() => validateSchema({ name: 'App', userCollections: [] }), /userCollections/);
});

await test('rejects invalid userCollection property', () => {
  assert.throws(
    () => validateSchema({ name: 'App', userCollections: { Admin: { properties: [42] } } }),
    /property/i
  );
});

// --- entity-engine: userCollections -------------------------------------------

console.log('\nentity-engine – userCollections');
const { buildUserCollections } = require('../core/entity-engine');

await test('buildUserCollections builds user collections', () => {
  const config = {
    name: 'App',
    userCollections: {
      Admin: { properties: ['name'] },
      Customer: { properties: ['name', 'phone'] },
    },
  };
  const ucs = buildUserCollections(config);
  assert.ok(ucs.Admin);
  assert.ok(ucs.Customer);
  assert.strictEqual(ucs.Admin.tableName, 'admin');
  assert.strictEqual(ucs.Admin.admin, true);
});

await test('buildCore includes userCollections', () => {
  const core = buildCore({
    name: 'App',
    userCollections: { Admin: { properties: ['name'] } },
  });
  assert.ok(core.userCollections.Admin);
});

// --- db: user collections -------------------------------------------------------

console.log('\ndb – user collections');
{
  const tmpDb2 = path.join(os.tmpdir(), `chadstart-uc-test-${Date.now()}.db`);
  const ucCore = buildCore({
    name: 'TestApp2',
    entities: {},
    userCollections: {
      Admin: { properties: ['name'] },
    },
  });

  const dbModule2 = (() => {
    // We need a fresh db module instance for each test run
    // Re-use the already-loaded module but re-init with a new path
    return require('../core/db');
  })();

  await test('user collection table is created with email + password', () => {
    dbModule2.initDb(ucCore, tmpDb2);
    const cols = dbModule2.getDb().pragma('table_info("admin")').map(r => r.name);
    assert.ok(cols.includes('id'));
    assert.ok(cols.includes('email'));
    assert.ok(cols.includes('password'));
    assert.ok(cols.includes('name'));
  });

  fs.unlinkSync(tmpDb2);
}

// --- auth module ----------------------------------------------------------------

console.log('\nauth');
const { signToken, verifyToken, omitPassword } = require('../core/auth');

await test('signToken and verifyToken round-trip', () => {
  const payload = { id: 1, collection: 'Admin' };
  const token = signToken(payload);
  const decoded = verifyToken(token);
  assert.strictEqual(decoded.id, payload.id);
  assert.strictEqual(decoded.collection, payload.collection);
});

await test('verifyToken throws on invalid token', () => {
  assert.throws(() => verifyToken('not-a-token'), /malformed|invalid/i);
});

await test('omitPassword removes password field', () => {
  const user = { id: 1, email: 'a@b.com', password: 'hashed', name: 'Alice' };
  const safe = omitPassword(user);
  assert.ok(!('password' in safe));
  assert.strictEqual(safe.email, 'a@b.com');
});

// --- openapi: auth endpoints ---------------------------------------------------

console.log('\nopenapi – auth endpoints');

await test('openapi spec includes auth paths for user collections', () => {
  const core = buildCore({
    name: 'App',
    userCollections: { Admin: { properties: ['name'] } },
  });
  const spec = generateOpenApiSpec(core);
  assert.ok(spec.paths['/auth/admin/signup']);
  assert.ok(spec.paths['/auth/admin/login']);
  assert.ok(spec.paths['/auth/admin/me']);
  assert.ok(spec.components.securitySchemes.bearerAuth);
});

await test('openapi spec has security on restricted entity', () => {
  const core = buildCore({
    name: 'App',
    entities: {
      Post: {
        properties: ['title'],
        permissions: { read: 'public', write: 'restricted' },
      },
    },
  });
  const spec = generateOpenApiSpec(core);
  assert.ok(!spec.paths['/api/posts'].get.security);
  assert.ok(spec.paths['/api/posts'].post.security);
});

// --- Summary -----------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

})();
