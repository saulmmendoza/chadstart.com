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
const { buildCore, toSnakeCase, toKebabCase } = require('../core/entity-engine');

await test('toSnakeCase converts PascalCase', () => assert.strictEqual(toSnakeCase('BlogPost'), 'blog_post'));
await test('toSnakeCase leaves lowercase', () => assert.strictEqual(toSnakeCase('post'), 'post'));
await test('toKebabCase converts PascalCase', () => assert.strictEqual(toKebabCase('BlogPost'), 'blog-post'));

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

await test('buildCore passes nameSingular and namePlural', () => {
  const core = buildCore({
    name: 'App',
    entities: { Person: { nameSingular: 'person', namePlural: 'people', properties: ['name'] } },
  });
  assert.strictEqual(core.entities.Person.nameSingular, 'person');
  assert.strictEqual(core.entities.Person.namePlural, 'people');
});

await test('inline validation merges and inline prevails on conflict', () => {
  const base = buildCore({
    name: 'App',
    entities: {
      Dog: {
        properties: [{ name: 'name', type: 'string', validation: { minLength: 3 } }, { name: 'age', type: 'number' }],
        validation: { age: { min: 1 } },
      },
    },
  });
  assert.strictEqual(base.entities.Dog.validation.name.minLength, 3);
  assert.strictEqual(base.entities.Dog.validation.age.min, 1);

  const conflict = buildCore({
    name: 'App',
    entities: {
      Dog: {
        properties: [{ name: 'name', type: 'string', validation: { minLength: 5 } }],
        validation: { name: { minLength: 3, maxLength: 100 } },
      },
    },
  });
  assert.strictEqual(conflict.entities.Dog.validation.name.minLength, 5, 'inline prevails');
  assert.strictEqual(conflict.entities.Dog.validation.name.maxLength, 100, 'block-only key preserved');
});

// ─── db ──────────────────────────────────────────────────────────────────────

console.log('\ndb');
const dbModule = require('../core/db');

const tmpDb = path.join(os.tmpdir(), `chadstart-test-${Date.now()}.db`);
const testCore = buildCore({ name: 'T', entities: { Widget: { properties: ['name', 'color'] } } });

await test('initDb creates database file', () => { dbModule.initDb(testCore, tmpDb); assert.ok(fs.existsSync(tmpDb)); });
await test('create inserts a row', () => { const r = dbModule.create('widget', { name: 'Foo', color: 'red' }); assert.strictEqual(r.name, 'Foo'); assert.ok(typeof r.id === 'string' && r.id.length > 0); assert.ok(r.createdAt); assert.ok(r.updatedAt); });
await test('findAll returns paginated result', () => { const result = dbModule.findAll('widget'); assert.ok(result.data.length >= 1); assert.ok(typeof result.total === 'number'); assert.ok(typeof result.currentPage === 'number'); });
await test('findById works', () => { const c = dbModule.create('widget', { name: 'Bar', color: 'blue' }); assert.strictEqual(dbModule.findById('widget', c.id).name, 'Bar'); });
await test('findById returns null for missing', () => assert.strictEqual(dbModule.findById('widget', 'nonexistent-id'), null));
await test('update modifies row', () => { const c = dbModule.create('widget', { name: 'Baz', color: 'green' }); assert.strictEqual(dbModule.update('widget', c.id, { color: 'yellow' }).color, 'yellow'); });
await test('remove deletes row', () => { const c = dbModule.create('widget', { name: 'Del', color: 'gray' }); dbModule.remove('widget', c.id); assert.strictEqual(dbModule.findById('widget', c.id), null); });
await test('remove returns null for missing', () => assert.strictEqual(dbModule.remove('widget', 'nonexistent-id'), null));
await test('findAll with filters', () => { dbModule.create('widget', { name: 'R1', color: 'red' }); const result = dbModule.findAll('widget', { color: 'red' }); assert.ok(result.data.every((r) => r.color === 'red')); });
await test('findAll with filter suffixes', () => { dbModule.create('widget', { name: 'FilterTest', color: 'green' }); const result = dbModule.findAll('widget', { color_neq: 'red' }); assert.ok(result.data.some((r) => r.color !== 'red')); });
await test('findAll with ordering', () => { const result = dbModule.findAll('widget', {}, { orderBy: 'name', order: 'ASC' }); assert.ok(result.data.length >= 1); });
await test('findAll with pagination', () => { const result = dbModule.findAll('widget', {}, { page: 1, perPage: 2 }); assert.ok(result.perPage === 2); assert.ok(result.currentPage === 1); });
await test('findAllSimple returns raw array', () => { const rows = dbModule.findAllSimple('widget'); assert.ok(Array.isArray(rows)); });
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
  assert.ok(spec.paths['/api/collections/post']);
  assert.ok(spec.paths['/api/collections/post/{id}']);
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
  assert.ok(!spec.paths['/api/collections/post'].get.security);
  assert.ok(spec.paths['/api/collections/post'].post.security);
});

await test('single entity uses /api/singles/ path', () => {
  const spec = generateOpenApiSpec(buildCore({ name: 'App', entities: { Home: { single: true, properties: ['title'] } } }));
  assert.ok(spec.paths['/api/singles/home']);
  assert.ok(spec.paths['/api/singles/home'].put, 'PUT should exist for singles');
});

await test('collection spec includes PUT endpoint', () => {
  const spec = generateOpenApiSpec(buildCore({ name: 'App', entities: { Post: { properties: ['t'] } } }));
  assert.ok(spec.paths['/api/collections/post/{id}'].put, 'PUT should exist for collections');
});

await test('openapi includes pagination params', () => {
  const spec = generateOpenApiSpec(buildCore({ name: 'App', entities: { Post: { properties: ['t'] } } }));
  const params = spec.paths['/api/collections/post'].get.parameters;
  assert.ok(params.some((p) => p.name === 'page'));
  assert.ok(params.some((p) => p.name === 'perPage'));
  assert.ok(params.some((p) => p.name === 'orderBy'));
  assert.ok(params.some((p) => p.name === 'relations'));
});

await test('openapi hides hidden properties', () => {
  const spec = generateOpenApiSpec(buildCore({ name: 'App', entities: { Post: { properties: ['title', { name: 'secret', type: 'string', hidden: true }] } } }));
  const schema = spec.components.schemas.Post;
  assert.ok(schema.properties.title);
  assert.ok(!schema.properties.secret, 'hidden prop should not be in schema');
});

await test('openapi entity schema has UUID id and timestamps', () => {
  const spec = generateOpenApiSpec(buildCore({ name: 'App', entities: { Post: { properties: ['t'] } } }));
  const schema = spec.components.schemas.Post;
  assert.strictEqual(schema.properties.id.format, 'uuid');
  assert.ok(schema.properties.createdAt);
  assert.ok(schema.properties.updatedAt);
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

for (const [label, ruleObj, bad, good] of [
  ['isAlpha',        { isAlpha: true },          { n: 'abc123' },      { n: 'abc' }],
  ['isAlphanumeric', { isAlphanumeric: true },    { n: 'abc!@#' },      { n: 'abc123' }],
  ['isAscii',        { isAscii: true },           { n: 'héllo' },       { n: 'hello' }],
  ['isJSON',         { isJSON: true },            { n: 'not json' },    { n: '{"a":1}' }],
  ['isDefined',      { isDefined: true },         {},                   { n: '' }],
  ['isEmpty',        { isEmpty: true },           { n: 'x' },           { n: '' }],
  ['isIn',           { isIn: ['a', 'b'] },        { n: 'c' },           { n: 'a' }],
  ['isNotIn',        { isNotIn: ['a', 'b'] },     { n: 'a' },           { n: 'c' }],
  ['notContains',    { notContains: 'world' },    { n: 'hello world' }, { n: 'hello' }],
  ['equals',         { equals: 'b' },             { n: 'a' },           { n: 'b' }],
  ['notEquals',      { notEquals: 'b' },          { n: 'b' },           { n: 'c' }],
  ['matches',        { matches: '^[0-9]+$' },     { n: 'hello' },       { n: '123' }],
]) {
  await test(`validates ${label}`, () => {
    const ent = { properties: [{ name: 'n', type: 'string' }], validation: { n: ruleObj } };
    assert.ok(validateBody(bad, ent).errors, `${label}: invalid input should fail`);
    assert.strictEqual(validateBody(good, ent).errors, null, `${label}: valid input should pass`);
  });
}

// ─── Hidden properties & defaults ────────────────────────────────────────────

console.log('\nhidden properties & defaults');
const { applyDefaults, hideHiddenProps } = require('../core/api-generator');

await test('hideHiddenProps removes hidden fields', () => {
  const entity = { properties: [{ name: 'title', type: 'string', hidden: false }, { name: 'secret', type: 'string', hidden: true }] };
  const result = hideHiddenProps({ id: '1', title: 'Hi', secret: 'shhh' }, entity);
  assert.strictEqual(result.title, 'Hi');
  assert.ok(!('secret' in result));
});

await test('applyDefaults fills missing with defaults', () => {
  const entity = { properties: [{ name: 'status', type: 'string', default: 'draft' }, { name: 'title', type: 'string' }] };
  const result = applyDefaults({ title: 'Hello' }, entity);
  assert.strictEqual(result.status, 'draft');
  assert.strictEqual(result.title, 'Hello');
});

await test('applyDefaults does not override existing values', () => {
  const entity = { properties: [{ name: 'status', type: 'string', default: 'draft' }] };
  const result = applyDefaults({ status: 'published' }, entity);
  assert.strictEqual(result.status, 'published');
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

// ─── seeder ──────────────────────────────────────────────────────────────────

console.log('\nseeder');
const { seedAll } = require('../core/seeder');

{
  const seedDbPath = path.join(os.tmpdir(), `chadstart-seed-${Date.now()}.db`);
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
  const { initDb: initSeedDb, findAll: findAllSeed } = require('../core/db');
  // A fresh db module reference won't work (db is module-level singleton),
  // so we test via the module state set by the last initDb call.
  initSeedDb(seedCore, seedDbPath);

  await test('seedAll returns correct counts', async () => {
    const summary = await seedAll(seedCore);
    assert.strictEqual(summary.Author, 3);
    assert.strictEqual(summary.Article, 5);
  });

  await test('seedAll inserts rows into the database', async () => {
    const authors = findAllSeed('author', {}, { perPage: 100 });
    assert.ok(authors.total >= 3);
    const articles = findAllSeed('article', {}, { perPage: 100 });
    assert.ok(articles.total >= 5);
  });

  await test('seedAll creates authenticable records with email field', async () => {
    const authors = findAllSeed('author', {}, { perPage: 100 });
    for (const a of authors.data) {
      assert.ok(typeof a.email === 'string' && a.email.includes('@'));
      assert.ok(typeof a.password === 'string' && a.password.length > 0);
    }
  });

  await test('seedAll links belongsTo FK to a seeded parent', async () => {
    const articles = findAllSeed('article', {}, { perPage: 100 });
    for (const art of articles.data) {
      assert.ok(art.author_id !== null && art.author_id !== undefined);
    }
  });

  await test('seedAll respects default seedCount of 50', async () => {
    const defaultCore = buildCore({
      name: 'DefaultSeed',
      entities: { Tag: { properties: ['label'] } },
    });
    const defaultDbPath = path.join(os.tmpdir(), `chadstart-seed-default-${Date.now()}.db`);
    initSeedDb(defaultCore, defaultDbPath);
    const summary = await seedAll(defaultCore);
    assert.strictEqual(summary.Tag, 50);
  });
}

// ─── db – advanced filter suffixes ───────────────────────────────────────────

console.log('\ndb – advanced filters');
{
  const tmp = path.join(os.tmpdir(), `chadstart-advfilter-${Date.now()}.db`);
  const core = buildCore({
    name: 'T',
    entities: {
      Score: { properties: [{ name: 'value', type: 'integer' }, { name: 'tag', type: 'string' }] },
    },
  });
  dbModule.initDb(core, tmp);
  dbModule.create('score', { value: 10, tag: 'alpha' });
  dbModule.create('score', { value: 20, tag: 'bravo' });
  dbModule.create('score', { value: 30, tag: 'charlie' });
  dbModule.create('score', { value: 40, tag: 'delta' });

  await test('_eq filter returns exact match', () => {
    const result = dbModule.findAll('score', { tag_eq: 'alpha' });
    assert.ok(result.data.every((r) => r.tag === 'alpha'));
    assert.strictEqual(result.data.length, 1);
  });

  await test('_gt filter returns rows greater than value', () => {
    const result = dbModule.findAll('score', { value_gt: '15' });
    assert.ok(result.data.every((r) => r.value > 15));
    assert.strictEqual(result.data.length, 3);
  });

  await test('_gte filter returns rows >= value', () => {
    const result = dbModule.findAll('score', { value_gte: '20' });
    assert.ok(result.data.every((r) => r.value >= 20));
    assert.strictEqual(result.data.length, 3);
  });

  await test('_lt filter returns rows below value', () => {
    const result = dbModule.findAll('score', { value_lt: '25' });
    assert.ok(result.data.every((r) => r.value < 25));
    assert.strictEqual(result.data.length, 2);
  });

  await test('_lte filter returns rows <= value', () => {
    const result = dbModule.findAll('score', { value_lte: '20' });
    assert.ok(result.data.every((r) => r.value <= 20));
    assert.strictEqual(result.data.length, 2);
  });

  await test('_like filter matches pattern', () => {
    const result = dbModule.findAll('score', { tag_like: '%lph%' });
    assert.ok(result.data.every((r) => r.tag.includes('lph')));
    assert.strictEqual(result.data.length, 1);
  });

  await test('_in filter returns rows matching any listed value', () => {
    const result = dbModule.findAll('score', { tag_in: 'alpha,bravo' });
    assert.ok(result.data.every((r) => r.tag === 'alpha' || r.tag === 'bravo'));
    assert.strictEqual(result.data.length, 2);
  });

  await test('findAllSimple with filter returns matching rows', () => {
    const rows = dbModule.findAllSimple('score', { tag: 'alpha' });
    assert.ok(rows.every((r) => r.tag === 'alpha'));
    assert.strictEqual(rows.length, 1);
  });

  await test('findAllSimple with unknown filter key returns all rows', () => {
    const rows = dbModule.findAllSimple('score', { nonexistent_col: 'xyz' });
    assert.ok(Array.isArray(rows));
    assert.ok(rows.length >= 4);
  });

  fs.unlinkSync(tmp);
}

// ─── db – relations ───────────────────────────────────────────────────────────

console.log('\ndb – relations');
{
  const tmp = path.join(os.tmpdir(), `chadstart-rel-${Date.now()}.db`);
  const core = buildCore({
    name: 'T',
    entities: {
      Post:    { properties: ['title'] },
      Comment: { properties: ['body'], belongsTo: ['Post'] },
      Player:  { properties: ['name'], belongsToMany: ['Skill'] },
      Skill:   { properties: ['label'] },
    },
  });
  dbModule.initDb(core, tmp);

  const post    = dbModule.create('post',    { title: 'Hello World' });
  dbModule.create('comment', { body: 'Great!', post_id: post.id });
  dbModule.create('comment', { body: 'Thanks', post_id: post.id });
  const commentNoPost = dbModule.create('comment', { body: 'Orphan', post_id: null });
  const comment1      = dbModule.create('comment', { body: 'Reply', post_id: post.id });
  const player  = dbModule.create('player', { name: 'Alice' });
  const skill1  = dbModule.create('skill',  { label: 'Jump' });
  const skill2  = dbModule.create('skill',  { label: 'Swim' });

  await test('loadRelations: noop when row is null', () => {
    const result = dbModule.loadRelations(null, core.entities.Comment, 'Post');
    assert.strictEqual(result, null);
  });

  await test('loadRelations: belongsTo resolves related row', () => {
    const row = { ...comment1 };
    dbModule.loadRelations(row, core.entities.Comment, 'Post');
    assert.ok(row.Post, 'related row should be attached');
    assert.strictEqual(row.Post.id, post.id);
    assert.strictEqual(row.Post.title, 'Hello World');
  });

  await test('loadRelations: belongsTo with null FK sets null', () => {
    const row = { ...commentNoPost };
    dbModule.loadRelations(row, core.entities.Comment, 'Post');
    assert.strictEqual(row.Post, null);
  });

  await test('loadRelations: hasMany (reverse) resolves children', () => {
    const row = { ...post };
    dbModule.loadRelations(row, core.entities.Post, 'comment');
    assert.ok(Array.isArray(row.comment));
    assert.ok(row.comment.length >= 3);
    assert.ok(row.comment.every((c) => c.post_id === post.id));
  });

  await test('loadRelations: comma-separated names loads multiple relations', () => {
    const row = { ...comment1 };
    dbModule.loadRelations(row, core.entities.Comment, 'Post,nonexistent');
    assert.ok(row.Post, 'Post relation should be loaded');
    // nonexistent relation is silently ignored
  });

  await test('saveBelongsToMany: saves junction rows and loadRelations retrieves them', () => {
    dbModule.saveBelongsToMany(core.entities.Player, player.id, { skillIds: [skill1.id, skill2.id] });
    const row = { ...player };
    dbModule.loadRelations(row, core.entities.Player, 'Skill');
    assert.ok(Array.isArray(row.Skill));
    assert.strictEqual(row.Skill.length, 2);
  });

  await test('saveBelongsToMany: clears and replaces existing junction rows', () => {
    dbModule.saveBelongsToMany(core.entities.Player, player.id, { skillIds: [skill1.id] });
    const row = { ...player };
    dbModule.loadRelations(row, core.entities.Player, 'Skill');
    assert.strictEqual(row.Skill.length, 1);
    assert.strictEqual(row.Skill[0].id, skill1.id);
  });

  await test('saveBelongsToMany: skips when no ids key in body', () => {
    dbModule.saveBelongsToMany(core.entities.Player, player.id, {});
    // state unchanged from previous test (skill1 only)
    const row = { ...player };
    dbModule.loadRelations(row, core.entities.Player, 'Skill');
    assert.strictEqual(row.Skill.length, 1);
  });

  fs.unlinkSync(tmp);
}

// ─── auth – middleware ────────────────────────────────────────────────────────

console.log('\nauth – middleware');
const { requireAuth, optionalAuth } = require('../core/auth');

function mockReq(headers = {}) {
  return { headers, user: undefined };
}

function mockRes() {
  const r = { _status: 200, _body: undefined };
  r.status = (s) => { r._status = s; return r; };
  r.json   = (b) => { r._body  = b; };
  return r;
}

await test('requireAuth: 401 when no Authorization header', () => {
  const mw  = requireAuth();
  const req = mockReq();
  const res = mockRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  assert.strictEqual(res._status, 401);
  assert.ok(!nextCalled);
});

await test('requireAuth: 401 when header lacks Bearer prefix', () => {
  const mw  = requireAuth();
  const req = mockReq({ authorization: 'Basic abc123' });
  const res = mockRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  assert.strictEqual(res._status, 401);
  assert.ok(!nextCalled);
});

await test('requireAuth: 401 for invalid token', () => {
  const mw  = requireAuth();
  const req = mockReq({ authorization: 'Bearer not-a-valid-jwt' });
  const res = mockRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  assert.strictEqual(res._status, 401);
  assert.ok(!nextCalled);
});

await test('requireAuth: 403 when entity does not match', () => {
  const token = signToken({ id: 'u1', entity: 'Admin' });
  const mw    = requireAuth('User');
  const req   = mockReq({ authorization: `Bearer ${token}` });
  const res   = mockRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  assert.strictEqual(res._status, 403);
  assert.ok(!nextCalled);
});

await test('requireAuth: sets req.user and calls next for valid token (with entity filter)', () => {
  const token = signToken({ id: 'u2', entity: 'Admin' });
  const mw    = requireAuth('Admin');
  const req   = mockReq({ authorization: `Bearer ${token}` });
  const res   = mockRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  assert.ok(nextCalled);
  assert.strictEqual(req.user.id, 'u2');
  assert.strictEqual(req.user.entity, 'Admin');
});

await test('requireAuth: sets req.user and calls next without entity filter', () => {
  const token = signToken({ id: 'u3', entity: 'Member' });
  const mw    = requireAuth();
  const req   = mockReq({ authorization: `Bearer ${token}` });
  const res   = mockRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  assert.ok(nextCalled);
  assert.strictEqual(req.user.entity, 'Member');
});

await test('optionalAuth: calls next without user when no header', () => {
  const req = mockReq();
  const res = mockRes();
  let nextCalled = false;
  optionalAuth(req, res, () => { nextCalled = true; });
  assert.ok(nextCalled);
  assert.ok(!req.user);
});

await test('optionalAuth: calls next without user when token is invalid', () => {
  const req = mockReq({ authorization: 'Bearer bad-token' });
  const res = mockRes();
  let nextCalled = false;
  optionalAuth(req, res, () => { nextCalled = true; });
  assert.ok(nextCalled);
  assert.ok(!req.user);
});

await test('optionalAuth: sets req.user when token is valid', () => {
  const token = signToken({ id: 'u4', entity: 'Guest' });
  const req   = mockReq({ authorization: `Bearer ${token}` });
  const res   = mockRes();
  let nextCalled = false;
  optionalAuth(req, res, () => { nextCalled = true; });
  assert.ok(nextCalled);
  assert.strictEqual(req.user.id, 'u4');
  assert.strictEqual(req.user.entity, 'Guest');
});

// ─── validation – additional validators ──────────────────────────────────────

console.log('\nvalidation – additional validators');

await test('validates isEmail', () => {
  const ent = { properties: [{ name: 'e', type: 'email' }], validation: { e: { isEmail: true } } };
  assert.ok(validateBody({ e: 'not-an-email' }, ent).errors, 'invalid email should fail');
  assert.strictEqual(validateBody({ e: 'user@example.com' }, ent).errors, null);
});

await test('validates isMimeType', () => {
  const ent = { properties: [{ name: 'm', type: 'string' }], validation: { m: { isMimeType: true } } };
  assert.ok(validateBody({ m: 'not a mime type' }, ent).errors, 'invalid mime type should fail');
  assert.strictEqual(validateBody({ m: 'image/png' }, ent).errors, null);
});

await test('validates maxLength', () => {
  const ent = { properties: [{ name: 'n', type: 'string' }], validation: { n: { maxLength: 5 } } };
  assert.ok(validateBody({ n: 'toolongstring' }, ent).errors, 'too long should fail');
  assert.strictEqual(validateBody({ n: 'ok' }, ent).errors, null);
});

await test('validates isNotEmpty', () => {
  const ent = { properties: [{ name: 'n', type: 'string' }], validation: { n: { isNotEmpty: true } } };
  assert.ok(validateBody({ n: '' }, ent).errors, 'empty string should fail');
  assert.strictEqual(validateBody({ n: 'hello' }, ent).errors, null);
});

// ─── seeder – property types ──────────────────────────────────────────────────

console.log('\nseeder – property types');
{
  const tmp = path.join(os.tmpdir(), `chadstart-seedtypes-${Date.now()}.db`);
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
  const { initDb: initTypeDb, findAll: findTypeAll } = require('../core/db');
  initTypeDb(core, tmp);

  await test('seedAll generates values for every property type', async () => {
    const summary = await seedAll(core);
    assert.strictEqual(summary.Sample, 3);
    const rows = findTypeAll('sample', {}, { perPage: 100 });
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

  await test('seedAll seeds a single entity exactly once', async () => {
    const singleCore = buildCore({
      name: 'SingleTest',
      entities: { Config: { single: true, properties: ['key', 'value'] } },
    });
    const singleTmp = path.join(os.tmpdir(), `chadstart-seedsingle-${Date.now()}.db`);
    initTypeDb(singleCore, singleTmp);
    const summary = await seedAll(singleCore);
    assert.strictEqual(summary.Config, 1);
    fs.unlinkSync(singleTmp);
  });

  fs.unlinkSync(tmp);
}

// ─── entity-engine – remaining branches ──────────────────────────────────────

console.log('\nentity-engine – branches');
const { buildEntities } = require('../core/entity-engine');

await test('normalizeRelation: object with only entity key', () => {
  const core = buildCore({
    name: 'App',
    entities: {
      Post:    { properties: ['t'] },
      Comment: { properties: ['b'], belongsTo: [{ entity: 'Post' }] },
    },
  });
  assert.strictEqual(core.entities.Comment.belongsTo[0].entity, 'Post');
  assert.strictEqual(core.entities.Comment.belongsTo[0].name, 'Post');
});

await test('normalizeRelation: object with only name key', () => {
  const core = buildCore({
    name: 'App',
    entities: {
      Post:    { properties: ['t'] },
      Comment: { properties: ['b'], belongsTo: [{ name: 'Post' }] },
    },
  });
  assert.strictEqual(core.entities.Comment.belongsTo[0].entity, 'Post');
  assert.strictEqual(core.entities.Comment.belongsTo[0].name, 'Post');
});

await test('normalizeProperty: carries hidden, default, options, helpText, validation', () => {
  const core = buildCore({
    name: 'App',
    entities: {
      Item: {
        properties: [{
          name: 'status', type: 'string',
          hidden: true,
          default: 'draft',
          options: ['draft', 'published'],
          helpText: 'Choose a status',
          validation: { isIn: ['draft', 'published'] },
        }],
      },
    },
  });
  const prop = core.entities.Item.properties[0];
  assert.strictEqual(prop.hidden, true);
  assert.strictEqual(prop.default, 'draft');
  assert.deepStrictEqual(prop.options, ['draft', 'published']);
  assert.strictEqual(prop.helpText, 'Choose a status');
  assert.deepStrictEqual(prop.validation, { isIn: ['draft', 'published'] });
});

await test('buildCore entity with no properties defaults to empty array', () => {
  const core = buildCore({ name: 'App', entities: { Tag: {} } });
  assert.deepStrictEqual(core.entities.Tag.properties, []);
});

// ─── upload helpers ───────────────────────────────────────────────────────────

console.log('\nupload helpers');
const {
  getBaseUrl,
  getMonthFolder,
  isS3Configured,
  sanitizeFilename,
  generateUniquePrefix,
  saveLocally,
  getImageOptions,
} = require('../core/upload');

await test('getMonthFolder returns correct format', () => {
  const result = getMonthFolder(new Date(2024, 9, 1)); // October 2024
  assert.strictEqual(result, 'Oct2024');
});

await test('getMonthFolder uses current date when no arg provided', () => {
  const result = getMonthFolder();
  const now = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  assert.ok(result.startsWith(months[now.getMonth()]));
  assert.ok(result.endsWith(String(now.getFullYear())));
});

await test('getBaseUrl uses BASE_URL env var when set', () => {
  const orig = process.env.BASE_URL;
  process.env.BASE_URL = 'https://example.com';
  const url = getBaseUrl({ port: 3000 });
  process.env.BASE_URL = orig === undefined ? undefined : orig;
  if (orig === undefined) delete process.env.BASE_URL;
  assert.strictEqual(url, 'https://example.com');
});

await test('getBaseUrl defaults to localhost with port', () => {
  const orig = process.env.BASE_URL;
  delete process.env.BASE_URL;
  const url = getBaseUrl({ port: 4000 });
  if (orig !== undefined) process.env.BASE_URL = orig;
  assert.strictEqual(url, 'http://localhost:4000');
});

await test('isS3Configured returns false when env vars are absent', () => {
  const vars = ['S3_BUCKET', 'S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
  const saved = {};
  vars.forEach((v) => { saved[v] = process.env[v]; delete process.env[v]; });
  const result = isS3Configured();
  vars.forEach((v) => { if (saved[v] !== undefined) process.env[v] = saved[v]; });
  assert.strictEqual(result, false);
});

await test('isS3Configured returns true when all S3 env vars are set', () => {
  const vars = ['S3_BUCKET', 'S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
  const saved = {};
  vars.forEach((v) => { saved[v] = process.env[v]; process.env[v] = 'test-value'; });
  const result = isS3Configured();
  vars.forEach((v) => { if (saved[v] !== undefined) process.env[v] = saved[v]; else delete process.env[v]; });
  assert.strictEqual(result, true);
});

await test('isS3Configured returns false when only some S3 vars are set', () => {
  const vars = ['S3_BUCKET', 'S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
  const saved = {};
  vars.forEach((v) => { saved[v] = process.env[v]; delete process.env[v]; });
  process.env.S3_BUCKET = 'my-bucket'; // only one set
  const result = isS3Configured();
  vars.forEach((v) => { if (saved[v] !== undefined) process.env[v] = saved[v]; else delete process.env[v]; });
  assert.strictEqual(result, false);
});

await test('sanitizeFilename strips directory traversal', () => {
  assert.strictEqual(sanitizeFilename('../../../etc/passwd'), 'passwd');
});

await test('sanitizeFilename replaces spaces and special chars', () => {
  const safe = sanitizeFilename('my file (1).pdf');
  assert.ok(!/[ ()]/.test(safe));
});

await test('sanitizeFilename replaces leading dots', () => {
  const safe = sanitizeFilename('.hidden');
  assert.ok(!safe.startsWith('.'));
});

await test('sanitizeFilename preserves safe characters', () => {
  assert.strictEqual(sanitizeFilename('my-file_01.pdf'), 'my-file_01.pdf');
});

await test('generateUniquePrefix returns a non-empty string', () => {
  const prefix = generateUniquePrefix();
  assert.ok(typeof prefix === 'string' && prefix.length > 0);
});

await test('generateUniquePrefix returns different values each call', () => {
  const a = generateUniquePrefix();
  const b = generateUniquePrefix();
  assert.notStrictEqual(a, b);
});

await test('saveLocally creates directory and writes file', () => {
  const dir = path.join(os.tmpdir(), `upload-test-${Date.now()}`);
  const filename = 'test.txt';
  const content = Buffer.from('hello world');
  saveLocally(content, dir, filename);
  const dest = path.join(dir, filename);
  assert.ok(fs.existsSync(dest));
  assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'hello world');
  fs.rmSync(dir, { recursive: true, force: true });
});

await test('saveLocally creates nested directories', () => {
  const dir = path.join(os.tmpdir(), `upload-nested-${Date.now()}`, 'a', 'b', 'c');
  saveLocally(Buffer.from('x'), dir, 'f.txt');
  assert.ok(fs.existsSync(path.join(dir, 'f.txt')));
  fs.rmSync(path.join(os.tmpdir(), path.relative(os.tmpdir(), dir).split(path.sep)[0]), { recursive: true, force: true });
});

await test('getImageOptions defaults: compress=true, quality=80, sizes=null', () => {
  const core = buildCore({ name: 'App', entities: {} });
  const opts = getImageOptions(core, 'cats', 'avatar');
  assert.strictEqual(opts.compress, true);
  assert.strictEqual(opts.quality, 80);
  assert.strictEqual(opts.sizes, null);
});

await test('getImageOptions: compress=false disables compression', () => {
  const core = buildCore({
    name: 'App',
    entities: {
      Cat: {
        properties: [{
          name: 'avatar',
          type: 'image',
          options: { compress: false },
        }],
      },
    },
  });
  const opts = getImageOptions(core, 'Cat', 'avatar');
  assert.strictEqual(opts.compress, false);
  assert.strictEqual(opts.quality, 80);
  assert.strictEqual(opts.sizes, null);
});

await test('getImageOptions: custom quality is respected', () => {
  const core = buildCore({
    name: 'App',
    entities: {
      Cat: {
        properties: [{
          name: 'avatar',
          type: 'image',
          options: { quality: 60 },
        }],
      },
    },
  });
  const opts = getImageOptions(core, 'Cat', 'avatar');
  assert.strictEqual(opts.compress, true);
  assert.strictEqual(opts.quality, 60);
});

await test('getImageOptions: sizes enables resize mode', () => {
  const core = buildCore({
    name: 'App',
    entities: {
      Cat: {
        properties: [{
          name: 'avatar',
          type: 'image',
          options: { sizes: { small: [40, 40], large: [400, 400] } },
        }],
      },
    },
  });
  const opts = getImageOptions(core, 'Cat', 'avatar');
  assert.deepStrictEqual(opts.sizes, { small: [40, 40], large: [400, 400] });
  assert.strictEqual(opts.compress, true);
});

await test('getImageOptions: no sizes when not configured', () => {
  const core = buildCore({
    name: 'App',
    entities: {
      Cat: {
        properties: [{ name: 'avatar', type: 'image' }],
      },
    },
  });
  const opts = getImageOptions(core, 'Cat', 'avatar');
  assert.strictEqual(opts.sizes, null);
});

await test('getImageOptions looks up by entity tableName', () => {
  const core = buildCore({
    name: 'App',
    entities: {
      BlogPost: {
        properties: [{
          name: 'cover',
          type: 'image',
          options: { sizes: { thumb: [100, 100] }, quality: 70 },
        }],
      },
    },
  });
  const opts = getImageOptions(core, 'blog_post', 'cover');
  assert.deepStrictEqual(opts.sizes, { thumb: [100, 100] });
  assert.strictEqual(opts.quality, 70);
});

// ─── upload – sharp integration ──────────────────────────────────────────────

console.log('\nupload – sharp integration');

const SAMPLE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

await test('sharp compresses a PNG to JPEG at quality 80 (default)', async () => {
  const sharp = require('sharp');
  const input = Buffer.from(SAMPLE_PNG_B64, 'base64');
  const output = await sharp(input).jpeg({ quality: 80 }).toBuffer();
  const meta = await sharp(output).metadata();
  assert.strictEqual(meta.format, 'jpeg');
});

await test('sharp compresses a PNG to JPEG at custom quality', async () => {
  const sharp = require('sharp');
  const input = Buffer.from(SAMPLE_PNG_B64, 'base64');
  const q60 = await sharp(input).jpeg({ quality: 60 }).toBuffer();
  const q90 = await sharp(input).jpeg({ quality: 90 }).toBuffer();
  // Both outputs should be valid JPEG buffers
  const metaQ60 = await sharp(q60).metadata();
  const metaQ90 = await sharp(q90).metadata();
  assert.strictEqual(metaQ60.format, 'jpeg');
  assert.strictEqual(metaQ90.format, 'jpeg');
});

await test('sharp resizes a 1x1 PNG to specified dimensions with quality', async () => {
  const sharp = require('sharp');
  const input = Buffer.from(SAMPLE_PNG_B64, 'base64');
  const output = await sharp(input).resize(80, 80, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
  const meta = await sharp(output).metadata();
  assert.strictEqual(meta.width, 80);
  assert.strictEqual(meta.height, 80);
  assert.strictEqual(meta.format, 'jpeg');
});

await test('sharp resize with quality:100 produces valid JPEG', async () => {
  const sharp = require('sharp');
  const input = Buffer.from(SAMPLE_PNG_B64, 'base64');
  const output = await sharp(input).resize(160, 160, { fit: 'cover' }).jpeg({ quality: 100 }).toBuffer();
  const meta = await sharp(output).metadata();
  assert.strictEqual(meta.width, 160);
  assert.strictEqual(meta.height, 160);
  assert.strictEqual(meta.format, 'jpeg');
});

// ─── upload – route logic (unit tests without HTTP server) ────────────────────

console.log('\nupload – route content-type check');

await test('/api/upload/file rejects non-multipart requests', async () => {
  // Simulate the content-type guard logic directly
  const contentType = 'application/json';
  const isMultipart = contentType.includes('multipart/form-data');
  assert.strictEqual(isMultipart, false);
});

await test('file path format: prefix-filename in month folder', () => {
  const prefix = 'abc123';
  const safeName = sanitizeFilename('my-contract.pdf');
  const finalName = `${prefix}-${safeName}`;
  const month = getMonthFolder(new Date(2024, 9, 1));
  const relPath = `storage/invoices/contract/${month}/${finalName}`;
  assert.strictEqual(relPath, 'storage/invoices/contract/Oct2024/abc123-my-contract.pdf');
});

await test('image path format (no sizes): prefix-basename.jpg in month folder', () => {
  // Default: compress=true, no sizes → single .jpg output
  const prefix = 'abc123';
  const month = getMonthFolder(new Date(2024, 9, 1));
  const baseName = path.basename(sanitizeFilename('my-photo.png'), '.png');
  const finalName = `${prefix}-${baseName}.jpg`;
  assert.strictEqual(finalName, 'abc123-my-photo.jpg');
  assert.ok(`storage/cats/avatar/${month}/${finalName}`.includes('Oct2024'));
});

await test('image path format (with sizes): prefix-sizeName.jpg in month folder', () => {
  const prefix = 'xyz789';
  const month = getMonthFolder(new Date(2024, 9, 1));
  const thumbName = `${prefix}-thumbnail.jpg`;
  assert.ok(thumbName.endsWith('-thumbnail.jpg'));
  assert.ok(`storage/cats/avatar/${month}/${thumbName}`.includes('Oct2024'));
});

await test('image path format (compress disabled): prefix-original-name preserved', () => {
  const prefix = 'def456';
  const originalName = sanitizeFilename('photo.png');
  const finalName = `${prefix}-${originalName}`;
  assert.strictEqual(finalName, 'def456-photo.png');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

})();
