'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (err) { console.error(`  ❌ ${name}: ${err.message}`); failed++; }
}

(async () => {

// ─── schema-validator (ajv + JSON Schema) ────────────────────────────────────

console.log('\nschema-validator');
const { validateSchema } = require('../core/schema-validator');

await test('accepts valid minimal config', () => assert.strictEqual(validateSchema({ name: 'Test' }), true));
await test('rejects missing name', () => assert.throws(() => validateSchema({}), /name/i));
await test('rejects non-string name', () => assert.throws(() => validateSchema({ name: 42 }), /name/i));
await test('accepts entities map', () => assert.strictEqual(validateSchema({ name: 'App', entities: { Post: { properties: ['title'] } } }), true));
await test('rejects entities as array', () => assert.throws(() => validateSchema({ name: 'App', entities: [] }), /entities/i));
await test('rejects unknown property type', () => {
  assert.throws(() => validateSchema({ name: 'App', entities: { Post: { properties: [{ name: 'x', type: 'banana' }] } } }));
});
await test('accepts authenticable entity', () => assert.strictEqual(validateSchema({ name: 'App', entities: { Admin: { authenticable: true, properties: ['name'] } } }), true));
await test('rejects authenticable as non-boolean', () => assert.throws(() => validateSchema({ name: 'App', entities: { Admin: { authenticable: 'yes' } } })));
await test('accepts policies', () => assert.strictEqual(validateSchema({ name: 'App', entities: { Post: { properties: ['title'], policies: { read: [{ access: 'public' }], create: [{ access: 'restricted', allow: 'Admin' }] } } } }), true));
await test('rejects unknown policy rule', () => assert.throws(() => validateSchema({ name: 'App', entities: { Post: { policies: { unknown: [{ access: 'public' }] } } } })));
await test('accepts validation rules', () => assert.strictEqual(validateSchema({ name: 'App', entities: { Post: { properties: ['title'], validation: { title: { required: true } } } } }), true));
await test('accepts hooks', () => assert.strictEqual(validateSchema({ name: 'App', entities: { Post: { hooks: { beforeCreate: [{ url: 'https://example.com' }] } } } }), true));
await test('accepts middlewares', () => assert.strictEqual(validateSchema({ name: 'App', entities: { Post: { middlewares: { afterCreate: [{ handler: 'sendEmail' }] } } } }), true));
await test('accepts belongsToMany', () => assert.strictEqual(validateSchema({ name: 'App', entities: { Player: { properties: ['name'], belongsToMany: ['Skill'] }, Skill: { properties: ['name'] } } }), true));
await test('accepts single entity', () => assert.strictEqual(validateSchema({ name: 'App', entities: { Home: { single: true, properties: ['title'] } } }), true));
await test('accepts endpoints', () => assert.strictEqual(validateSchema({ name: 'App', endpoints: { hello: { path: '/hello', method: 'GET', handler: 'hello' } } }), true));
await test('rejects endpoint missing handler', () => assert.throws(() => validateSchema({ name: 'App', endpoints: { bad: { path: '/bad', method: 'GET' } } })));
await test('accepts groups', () => assert.strictEqual(validateSchema({ name: 'App', groups: { T: { properties: [{ name: 'author', type: 'string' }] } } }), true));
await test('rejects invalid file bucket', () => assert.throws(() => validateSchema({ name: 'App', files: { uploads: {} } }), /path/i));
await test('rejects invalid plugin', () => assert.throws(() => validateSchema({ name: 'App', plugins: [{ name: 'bad' }] })));
await test('accepts emoji access', () => assert.strictEqual(validateSchema({ name: 'App', entities: { Post: { policies: { read: [{ access: '🌐' }] } } } }), true));
await test('rejects unknown top-level key', () => assert.throws(() => validateSchema({ name: 'App', userCollections: { Admin: {} } })));

// ─── entity-engine ───────────────────────────────────────────────────────────

console.log('\nentity-engine');
const { buildCore, toSnakeCase } = require('../core/entity-engine');

await test('toSnakeCase converts PascalCase', () => assert.strictEqual(toSnakeCase('BlogPost'), 'blog_post'));
await test('toSnakeCase leaves lowercase', () => assert.strictEqual(toSnakeCase('post'), 'post'));

await test('buildCore populates entities', () => {
  const core = buildCore({ name: 'Blog', entities: { Post: { properties: ['title', 'content'] } } });
  assert.ok(core.entities.Post);
  assert.strictEqual(core.entities.Post.tableName, 'post');
  assert.deepStrictEqual(core.entities.Post.properties.map((p) => p.name), ['title', 'content']);
});

await test('buildCore normalizes object properties', () => {
  const core = buildCore({ name: 'App', entities: { Item: { properties: [{ name: 'price', type: 'number' }] } } });
  assert.strictEqual(core.entities.Item.properties[0].type, 'number');
});

await test('buildCore sets default port', () => assert.ok(typeof buildCore({ name: 'App' }).port === 'number'));

await test('buildCore handles authenticable entities', () => {
  const core = buildCore({ name: 'App', entities: { Admin: { authenticable: true, properties: ['name'] }, Post: { properties: ['t'] } } });
  assert.ok(core.entities.Admin.authenticable);
  assert.ok(core.authenticableEntities.Admin);
  assert.ok(!core.authenticableEntities.Post);
});

await test('buildCore handles policies with emoji', () => {
  const core = buildCore({ name: 'App', entities: { Post: { properties: ['t'], policies: { read: [{ access: '🌐' }], delete: [{ access: '🚫' }] } } } });
  assert.strictEqual(core.entities.Post.policies.read[0].access, 'public');
  assert.strictEqual(core.entities.Post.policies.delete[0].access, 'forbidden');
});

await test('buildCore normalizes belongsTo', () => {
  const core = buildCore({ name: 'App', entities: { Comment: { properties: ['text'], belongsTo: ['Post'] }, Post: { properties: ['t'] } } });
  assert.strictEqual(core.entities.Comment.belongsTo[0].entity, 'Post');
});

await test('buildCore handles belongsToMany', () => {
  const core = buildCore({ name: 'App', entities: { Player: { properties: ['n'], belongsToMany: ['Skill'] }, Skill: { properties: ['n'] } } });
  assert.strictEqual(core.entities.Player.belongsToMany[0].entity, 'Skill');
});

await test('buildCore handles singles, validation, hooks, endpoints, groups', () => {
  const core = buildCore({
    name: 'App',
    entities: { Home: { single: true, properties: ['t'], validation: { t: { minLength: 3 } }, hooks: { beforeCreate: [{ url: 'https://x.com' }] } } },
    endpoints: { hi: { path: '/hi', method: 'GET', handler: 'hi' } },
    groups: { G: { properties: [{ name: 'a', type: 'string' }] } },
  });
  assert.ok(core.entities.Home.single);
  assert.strictEqual(core.entities.Home.validation.t.minLength, 3);
  assert.strictEqual(core.entities.Home.hooks.beforeCreate[0].url, 'https://x.com');
  assert.ok(core.endpoints.hi);
  assert.ok(core.groups.G);
});

// ─── db ──────────────────────────────────────────────────────────────────────

console.log('\ndb');
const dbModule = require('../core/db');

const tmpDb = path.join(os.tmpdir(), `chadstart-test-${Date.now()}.db`);
const testCore = buildCore({ name: 'T', entities: { Widget: { properties: ['name', 'color'] } } });

await test('initDb creates database file', () => { dbModule.initDb(testCore, tmpDb); assert.ok(fs.existsSync(tmpDb)); });
await test('create inserts a row', () => { const r = dbModule.create('widget', { name: 'Foo', color: 'red' }); assert.strictEqual(r.name, 'Foo'); assert.ok(r.id > 0); });
await test('findAll returns rows', () => assert.ok(dbModule.findAll('widget').length >= 1));
await test('findById works', () => { const c = dbModule.create('widget', { name: 'Bar', color: 'blue' }); assert.strictEqual(dbModule.findById('widget', c.id).name, 'Bar'); });
await test('findById returns null for missing', () => assert.strictEqual(dbModule.findById('widget', 99999), null));
await test('update modifies row', () => { const c = dbModule.create('widget', { name: 'Baz', color: 'green' }); assert.strictEqual(dbModule.update('widget', c.id, { color: 'yellow' }).color, 'yellow'); });
await test('remove deletes row', () => { const c = dbModule.create('widget', { name: 'Del', color: 'gray' }); dbModule.remove('widget', c.id); assert.strictEqual(dbModule.findById('widget', c.id), null); });
await test('remove returns null for missing', () => assert.strictEqual(dbModule.remove('widget', 99999), null));
await test('findAll with filters', () => { dbModule.create('widget', { name: 'R1', color: 'red' }); assert.ok(dbModule.findAll('widget', { color: 'red' }).every((r) => r.color === 'red')); });
fs.unlinkSync(tmpDb);

console.log('\ndb – authenticable entities');
{
  const tmp = path.join(os.tmpdir(), `chadstart-auth-${Date.now()}.db`);
  const core = buildCore({ name: 'T', entities: { Admin: { authenticable: true, properties: ['name'] } } });
  await test('authenticable entity has email + password columns', () => {
    dbModule.initDb(core, tmp);
    const cols = dbModule.getDb().pragma('table_info("admin")').map((r) => r.name);
    assert.ok(cols.includes('email') && cols.includes('password') && cols.includes('name'));
  });
  fs.unlinkSync(tmp);
}

console.log('\ndb – belongsToMany junction tables');
{
  const tmp = path.join(os.tmpdir(), `chadstart-btm-${Date.now()}.db`);
  const core = buildCore({ name: 'T', entities: { Player: { properties: ['n'], belongsToMany: ['Skill'] }, Skill: { properties: ['n'] } } });
  await test('creates junction table', () => {
    dbModule.initDb(core, tmp);
    const tables = dbModule.getDb().prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
    assert.ok(tables.some((t) => t.includes('player') && t.includes('skill')));
  });
  fs.unlinkSync(tmp);
}

// ─── openapi ─────────────────────────────────────────────────────────────────

console.log('\nopenapi');
const { generateOpenApiSpec } = require('../core/openapi');

await test('generates valid spec', () => {
  const spec = generateOpenApiSpec(buildCore({ name: 'Blog', entities: { Post: { properties: ['title'] } } }));
  assert.strictEqual(spec.openapi, '3.0.0');
  assert.ok(spec.paths['/api/posts']);
  assert.ok(spec.paths['/api/posts/{id}']);
});

await test('includes file bucket paths', () => {
  const spec = generateOpenApiSpec(buildCore({ name: 'App', files: { uploads: { path: '/tmp/uploads' } } }));
  assert.ok(spec.paths['/files/uploads']);
});

await test('includes auth paths for authenticable entities', () => {
  const spec = generateOpenApiSpec(buildCore({ name: 'App', entities: { Admin: { authenticable: true, properties: ['name'] } } }));
  assert.ok(spec.paths['/api/auth/admin/signup']);
  assert.ok(spec.paths['/api/auth/admin/login']);
  assert.ok(spec.paths['/api/auth/admin/me']);
});

await test('security on restricted entity', () => {
  const spec = generateOpenApiSpec(buildCore({ name: 'App', entities: { Post: { properties: ['t'], policies: { read: [{ access: 'public' }], create: [{ access: 'restricted' }] } } } }));
  assert.ok(!spec.paths['/api/posts'].get.security);
  assert.ok(spec.paths['/api/posts'].post.security);
});

// ─── yaml-loader ─────────────────────────────────────────────────────────────

console.log('\nyaml-loader');
const { loadYaml } = require('../core/yaml-loader');

await test('loads chadstart.yaml', () => {
  const config = loadYaml(path.resolve(__dirname, '..', 'chadstart.yaml'));
  assert.strictEqual(config.name, 'Blog');
  assert.ok(config.entities.Admin.authenticable);
  assert.ok(config.entities.Post);
});

await test('throws on missing file', () => assert.throws(() => loadYaml('/nonexistent'), /not found/i));

// ─── auth ────────────────────────────────────────────────────────────────────

console.log('\nauth');
const { signToken, verifyToken, omitPassword } = require('../core/auth');

await test('signToken/verifyToken round-trip', () => {
  const t = signToken({ id: 1, entity: 'Admin' });
  const d = verifyToken(t);
  assert.strictEqual(d.id, 1);
  assert.strictEqual(d.entity, 'Admin');
});

await test('verifyToken throws on invalid', () => assert.throws(() => verifyToken('bad'), /malformed|invalid/i));
await test('omitPassword removes password', () => assert.ok(!('password' in omitPassword({ id: 1, password: 'x', email: 'a@b.com' }))));

// ─── validation ──────────────────────────────────────────────────────────────

console.log('\nvalidation');
const { validateBody } = require('../core/api-generator');

await test('validates required', () => {
  assert.ok(validateBody({}, { properties: [{ name: 't', type: 'string' }], validation: { t: { required: true } } }).errors);
});
await test('validates minLength', () => {
  assert.ok(validateBody({ n: 'ab' }, { properties: [{ name: 'n', type: 'string' }], validation: { n: { minLength: 3 } } }).errors);
});
await test('passes valid data', () => {
  assert.strictEqual(validateBody({ n: 'Alice' }, { properties: [{ name: 'n', type: 'string' }], validation: { n: { minLength: 3 } } }).errors, null);
});
await test('validates min/max', () => {
  assert.ok(validateBody({ age: 50 }, { properties: [{ name: 'age', type: 'number' }], validation: { age: { max: 30 } } }).errors);
});
await test('isOptional skips undefined', () => {
  assert.strictEqual(validateBody({}, { properties: [{ name: 'e', type: 'email' }], validation: { e: { isOptional: true, contains: '@co.com' } } }).errors, null);
});
await test('validates contains', () => {
  assert.ok(validateBody({ e: 'john@gmail.com' }, { properties: [{ name: 'e', type: 'email' }], validation: { e: { contains: '@co.com' } } }).errors);
});

// ─── JSON Schema file ────────────────────────────────────────────────────────

console.log('\njson-schema');

await test('chadstart.schema.json is valid JSON', () => {
  const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'chadstart.schema.json'), 'utf8'));
  assert.strictEqual(schema.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.ok(schema.properties.entities);
  assert.ok(schema.$defs.entity);
  assert.ok(schema.$defs.policies);
});

await test('schema file can validate the example config', () => {
  const config = loadYaml(path.resolve(__dirname, '..', 'chadstart.yaml'));
  assert.strictEqual(validateSchema(config), true);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

})();
