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

// --- schema-validator: authenticable entities ---------------------------------

console.log('\nschema-validator – authenticable entities');

await test('accepts entity with authenticable: true', () => {
  assert.strictEqual(
    validateSchema({
      name: 'App',
      entities: { Admin: { authenticable: true, properties: ['name'] } },
    }),
    true
  );
});

await test('rejects authenticable as non-boolean', () => {
  assert.throws(
    () => validateSchema({ name: 'App', entities: { Admin: { authenticable: 'yes' } } }),
    /authenticable/
  );
});

await test('accepts entity with policies', () => {
  assert.strictEqual(
    validateSchema({
      name: 'App',
      entities: {
        Post: {
          properties: ['title'],
          policies: {
            read: [{ access: 'public' }],
            create: [{ access: 'restricted', allow: 'Admin' }],
          },
        },
      },
    }),
    true
  );
});

await test('rejects policies with unknown rule', () => {
  assert.throws(
    () => validateSchema({
      name: 'App',
      entities: { Post: { policies: { unknown: [{ access: 'public' }] } } },
    }),
    /unknown.*rule|unknown/i
  );
});

await test('accepts entity with validation', () => {
  assert.strictEqual(
    validateSchema({
      name: 'App',
      entities: {
        Post: {
          properties: ['title'],
          validation: { title: { required: true } },
        },
      },
    }),
    true
  );
});

await test('accepts entity with hooks', () => {
  assert.strictEqual(
    validateSchema({
      name: 'App',
      entities: {
        Post: {
          properties: ['title'],
          hooks: { beforeCreate: [{ url: 'https://example.com' }] },
        },
      },
    }),
    true
  );
});

await test('accepts entity with middlewares', () => {
  assert.strictEqual(
    validateSchema({
      name: 'App',
      entities: {
        Post: {
          properties: ['title'],
          middlewares: { afterCreate: [{ handler: 'sendEmail' }] },
        },
      },
    }),
    true
  );
});

await test('accepts entity with belongsToMany', () => {
  assert.strictEqual(
    validateSchema({
      name: 'App',
      entities: {
        Player: { properties: ['name'], belongsToMany: ['Skill'] },
        Skill: { properties: ['name'] },
      },
    }),
    true
  );
});

await test('accepts entity with single: true', () => {
  assert.strictEqual(
    validateSchema({
      name: 'App',
      entities: {
        HomePage: { single: true, properties: [{ name: 'title', type: 'string' }] },
      },
    }),
    true
  );
});

await test('accepts endpoints config', () => {
  assert.strictEqual(
    validateSchema({
      name: 'App',
      endpoints: {
        helloWorld: { path: '/hello', method: 'GET', handler: 'helloWorld' },
      },
    }),
    true
  );
});

await test('rejects endpoint missing handler', () => {
  assert.throws(
    () => validateSchema({
      name: 'App',
      endpoints: { bad: { path: '/bad', method: 'GET' } },
    }),
    /handler/
  );
});

await test('accepts groups config', () => {
  assert.strictEqual(
    validateSchema({
      name: 'App',
      groups: {
        Testimonial: { properties: [{ name: 'author', type: 'text' }] },
      },
    }),
    true
  );
});

// --- entity-engine -----------------------------------------------------------

console.log('\nentity-engine');
const { buildCore, toSnakeCase, getAuthenticableEntities } = require('../core/entity-engine');

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

// --- entity-engine: authenticable entities -----------------------------------

console.log('\nentity-engine – authenticable entities');

await test('buildCore handles authenticable entities', () => {
  const core = buildCore({
    name: 'App',
    entities: {
      Admin: { authenticable: true, properties: ['name'] },
      Customer: { authenticable: true, properties: ['name', 'phone'] },
      Post: { properties: ['title'] },
    },
  });
  assert.ok(core.entities.Admin);
  assert.ok(core.entities.Admin.authenticable);
  assert.ok(core.authenticableEntities.Admin);
  assert.ok(core.authenticableEntities.Customer);
  assert.ok(!core.authenticableEntities.Post);
});

await test('buildCore handles policies', () => {
  const core = buildCore({
    name: 'App',
    entities: {
      Post: {
        properties: ['title'],
        policies: {
          read: [{ access: 'public' }],
          create: [{ access: 'restricted', allow: 'Admin' }],
        },
      },
    },
  });
  assert.ok(core.entities.Post.policies.read);
  assert.strictEqual(core.entities.Post.policies.read[0].access, 'public');
  assert.strictEqual(core.entities.Post.policies.create[0].access, 'restricted');
  assert.strictEqual(core.entities.Post.policies.create[0].allow, 'Admin');
});

await test('buildCore normalizes belongsTo to objects', () => {
  const core = buildCore({
    name: 'App',
    entities: {
      Comment: { properties: ['text'], belongsTo: ['Post'] },
      Post: { properties: ['title'] },
    },
  });
  assert.strictEqual(core.entities.Comment.belongsTo[0].entity, 'Post');
  assert.strictEqual(core.entities.Comment.belongsTo[0].name, 'Post');
});

await test('buildCore handles belongsToMany', () => {
  const core = buildCore({
    name: 'App',
    entities: {
      Player: { properties: ['name'], belongsToMany: ['Skill'] },
      Skill: { properties: ['name'] },
    },
  });
  assert.ok(core.entities.Player.belongsToMany.length === 1);
  assert.strictEqual(core.entities.Player.belongsToMany[0].entity, 'Skill');
});

await test('buildCore backward compat: merges legacy userCollections into entities', () => {
  const core = buildCore({
    name: 'App',
    userCollections: { Admin: { properties: ['name'] } },
  });
  assert.ok(core.entities.Admin);
  assert.ok(core.entities.Admin.authenticable);
  assert.ok(core.authenticableEntities.Admin);
});

await test('buildCore includes endpoints and groups', () => {
  const core = buildCore({
    name: 'App',
    endpoints: { hello: { path: '/hello', method: 'GET', handler: 'hello' } },
    groups: { Testimonial: { properties: [{ name: 'author', type: 'text' }] } },
  });
  assert.ok(core.endpoints.hello);
  assert.ok(core.groups.Testimonial);
});

await test('buildCore handles single entities', () => {
  const core = buildCore({
    name: 'App',
    entities: {
      HomePage: { single: true, properties: [{ name: 'title', type: 'string' }] },
    },
  });
  assert.ok(core.entities.HomePage.single);
});

await test('buildCore handles validation on entities', () => {
  const core = buildCore({
    name: 'App',
    entities: {
      Dog: {
        properties: ['name', { name: 'age', type: 'number' }],
        validation: { name: { minLength: 3 } },
      },
    },
  });
  assert.ok(core.entities.Dog.validation.name);
  assert.strictEqual(core.entities.Dog.validation.name.minLength, 3);
});

await test('buildCore handles hooks on entities', () => {
  const core = buildCore({
    name: 'App',
    entities: {
      Cat: {
        properties: ['name'],
        hooks: { beforeCreate: [{ url: 'https://example.com' }] },
      },
    },
  });
  assert.ok(core.entities.Cat.hooks.beforeCreate);
  assert.strictEqual(core.entities.Cat.hooks.beforeCreate[0].url, 'https://example.com');
});

await test('buildCore handles emoji access in policies', () => {
  const core = buildCore({
    name: 'App',
    entities: {
      Post: {
        properties: ['title'],
        policies: {
          read: [{ access: '🌐' }],
          delete: [{ access: '🚫' }],
        },
      },
    },
  });
  assert.strictEqual(core.entities.Post.policies.read[0].access, 'public');
  assert.strictEqual(core.entities.Post.policies.delete[0].access, 'forbidden');
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

// --- db: authenticable entities -----------------------------------------------

console.log('\ndb – authenticable entities');
{
  const tmpDb2 = path.join(os.tmpdir(), `chadstart-auth-test-${Date.now()}.db`);
  const authCore = buildCore({
    name: 'TestApp2',
    entities: {
      Admin: { authenticable: true, properties: ['name'] },
    },
  });

  await test('authenticable entity table has email + password + custom properties', () => {
    dbModule.initDb(authCore, tmpDb2);
    const cols = dbModule.getDb().pragma('table_info("admin")').map(r => r.name);
    assert.ok(cols.includes('id'));
    assert.ok(cols.includes('email'));
    assert.ok(cols.includes('password'));
    assert.ok(cols.includes('name'));
  });

  fs.unlinkSync(tmpDb2);
}

// --- db: legacy userCollections backward compat --------------------------------

console.log('\ndb – legacy userCollections backward compat');
{
  const tmpDb3 = path.join(os.tmpdir(), `chadstart-uc-compat-test-${Date.now()}.db`);
  const ucCore = buildCore({
    name: 'TestApp3',
    entities: {},
    userCollections: {
      Admin: { properties: ['name'] },
    },
  });

  await test('legacy userCollection merged into entities with email + password', () => {
    dbModule.initDb(ucCore, tmpDb3);
    const cols = dbModule.getDb().pragma('table_info("admin")').map(r => r.name);
    assert.ok(cols.includes('id'));
    assert.ok(cols.includes('email'));
    assert.ok(cols.includes('password'));
    assert.ok(cols.includes('name'));
  });

  fs.unlinkSync(tmpDb3);
}

// --- db: belongsToMany junction table -----------------------------------------

console.log('\ndb – belongsToMany junction tables');
{
  const tmpDb4 = path.join(os.tmpdir(), `chadstart-btm-test-${Date.now()}.db`);
  const btmCore = buildCore({
    name: 'TestApp4',
    entities: {
      Player: { properties: ['name'], belongsToMany: ['Skill'] },
      Skill: { properties: ['name'] },
    },
  });

  await test('belongsToMany creates junction table', () => {
    dbModule.initDb(btmCore, tmpDb4);
    const tables = dbModule.getDb().prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%player%skill%' OR name LIKE '%skill%player%'"
    ).all();
    assert.ok(tables.length > 0, 'Junction table should exist');
  });

  fs.unlinkSync(tmpDb4);
}

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

await test('loads authenticable entities from chadstart.yaml', () => {
  const config = loadYaml(path.resolve(__dirname, '..', 'chadstart.yaml'));
  assert.ok(config.entities.Admin);
  assert.ok(config.entities.Admin.authenticable);
  assert.ok(config.entities.Customer);
  assert.ok(config.entities.Customer.authenticable);
});

await test('throws when file does not exist', () => {
  assert.throws(() => loadYaml('/nonexistent/path/chadstart.yaml'), /not found/i);
});

// --- schema-validator: userCollections (backward compat) ----------------------

console.log('\nschema-validator – userCollections (backward compat)');

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

await test('openapi spec includes auth paths for authenticable entities', () => {
  const core = buildCore({
    name: 'App',
    entities: {
      Admin: { authenticable: true, properties: ['name'] },
    },
  });
  const spec = generateOpenApiSpec(core);
  assert.ok(spec.paths['/api/auth/admin/signup']);
  assert.ok(spec.paths['/api/auth/admin/login']);
  assert.ok(spec.paths['/api/auth/admin/me']);
  assert.ok(spec.components.securitySchemes.bearerAuth);
});

await test('openapi spec has security on restricted entity (policies format)', () => {
  const core = buildCore({
    name: 'App',
    entities: {
      Post: {
        properties: ['title'],
        policies: {
          read: [{ access: 'public' }],
          create: [{ access: 'restricted', allow: 'Admin' }],
        },
      },
    },
  });
  const spec = generateOpenApiSpec(core);
  assert.ok(!spec.paths['/api/posts'].get.security);
  assert.ok(spec.paths['/api/posts'].post.security);
});

await test('openapi spec backward compat: works with legacy userCollections', () => {
  const core = buildCore({
    name: 'App',
    userCollections: { Admin: { properties: ['name'] } },
  });
  const spec = generateOpenApiSpec(core);
  assert.ok(spec.paths['/api/auth/admin/signup']);
  assert.ok(spec.paths['/api/auth/admin/login']);
});

// --- validation ----------------------------------------------------------------

console.log('\nvalidation');
const { validateBody } = require('../core/api-generator');

await test('validates required field', () => {
  const entity = {
    properties: [{ name: 'title', type: 'string' }],
    validation: { title: { required: true } },
  };
  const result = validateBody({}, entity);
  assert.ok(result.errors);
  assert.strictEqual(result.errors[0].property, 'title');
});

await test('validates minLength', () => {
  const entity = {
    properties: [{ name: 'name', type: 'string' }],
    validation: { name: { minLength: 3 } },
  };
  const result = validateBody({ name: 'ab' }, entity);
  assert.ok(result.errors);
  assert.ok(result.errors[0].constraints.minLength);
});

await test('passes valid data', () => {
  const entity = {
    properties: [{ name: 'name', type: 'string' }],
    validation: { name: { minLength: 3 } },
  };
  const result = validateBody({ name: 'Alice' }, entity);
  assert.strictEqual(result.errors, null);
});

await test('validates min/max for numbers', () => {
  const entity = {
    properties: [{ name: 'age', type: 'number' }],
    validation: { age: { min: 1, max: 30 } },
  };
  const result = validateBody({ age: 50 }, entity);
  assert.ok(result.errors);
  assert.ok(result.errors[0].constraints.max);
});

await test('validates isOptional skips validation for undefined', () => {
  const entity = {
    properties: [{ name: 'email', type: 'email' }],
    validation: { email: { isOptional: true, contains: '@company.com' } },
  };
  const result = validateBody({}, entity);
  assert.strictEqual(result.errors, null);
});

await test('validates contains', () => {
  const entity = {
    properties: [{ name: 'email', type: 'email' }],
    validation: { email: { contains: '@company.com' } },
  };
  const result = validateBody({ email: 'john@gmail.com' }, entity);
  assert.ok(result.errors);
  assert.ok(result.errors[0].constraints.contains);
});

// --- Summary -----------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

})();
