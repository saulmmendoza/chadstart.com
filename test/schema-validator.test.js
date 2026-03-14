'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

describe('schema-validator', () => {
  const { validateSchema } = require('../core/schema-validator');

  it('accepts valid minimal config', () => assert.strictEqual(validateSchema({ name: 'Test' }), true));
  it('rejects missing name', () => assert.throws(() => validateSchema({}), /name/i));
  it('rejects non-string name', () => assert.throws(() => validateSchema({ name: 42 }), /name/i));
  it('accepts entities map', () => assert.strictEqual(validateSchema({ name: 'App', entities: { Post: { properties: ['title'] } } }), true));
  it('rejects entities as array', () => assert.throws(() => validateSchema({ name: 'App', entities: [] }), /entities/i));
  it('rejects unknown property type', () => {
    assert.throws(() => validateSchema({ name: 'App', entities: { Post: { properties: [{ name: 'x', type: 'banana' }] } } }));
  });
  it('accepts authenticable entity', () => assert.strictEqual(validateSchema({ name: 'App', entities: { Admin: { authenticable: true, properties: ['name'] } } }), true));
  it('rejects authenticable as non-boolean', () => assert.throws(() => validateSchema({ name: 'App', entities: { Admin: { authenticable: 'yes' } } })));
  it('accepts policies', () => assert.strictEqual(validateSchema({ name: 'App', entities: { Post: { properties: ['title'], policies: { read: [{ access: 'public' }], create: [{ access: 'restricted', allow: 'Admin' }] } } } }), true));
  it('rejects unknown policy rule', () => assert.throws(() => validateSchema({ name: 'App', entities: { Post: { policies: { unknown: [{ access: 'public' }] } } } })));
  it('accepts validation rules', () => assert.strictEqual(validateSchema({ name: 'App', entities: { Post: { properties: ['title'], validation: { title: { required: true } } } } }), true));
  it('accepts hooks', () => assert.strictEqual(validateSchema({ name: 'App', entities: { Post: { hooks: { beforeCreate: [{ url: 'https://example.com' }] } } } }), true));
  it('accepts middlewares', () => assert.strictEqual(validateSchema({ name: 'App', entities: { Post: { middlewares: { afterCreate: [{ function: 'sendEmail' }] } } } }), true));
  it('accepts belongsToMany', () => assert.strictEqual(validateSchema({ name: 'App', entities: { Player: { properties: ['name'], belongsToMany: ['Skill'] }, Skill: { properties: ['name'] } } }), true));
  it('accepts single entity', () => assert.strictEqual(validateSchema({ name: 'App', entities: { Home: { single: true, properties: ['title'] } } }), true));
  it('accepts functions', () => assert.strictEqual(validateSchema({ name: 'App', functions: { hello: { path: '/hello', method: 'GET', function: 'hello.js' } } }), true));
  it('rejects function missing function field', () => assert.throws(() => validateSchema({ name: 'App', functions: { bad: { path: '/bad', method: 'GET' } } })));
  it('rejects deprecated endpoints key', () => assert.throws(() => validateSchema({ name: 'App', endpoints: { hello: { path: '/hello', method: 'GET', function: 'hello.js' } } })));
  it('accepts groups', () => assert.strictEqual(validateSchema({ name: 'App', groups: { T: { properties: [{ name: 'author', type: 'string' }] } } }), true));
  it('rejects invalid file bucket', () => assert.throws(() => validateSchema({ name: 'App', files: { uploads: {} } }), /path/i));
  it('rejects invalid plugin', () => assert.throws(() => validateSchema({ name: 'App', plugins: [{ name: 'bad' }] })));
  it('accepts emoji access', () => assert.strictEqual(validateSchema({ name: 'App', entities: { Post: { policies: { read: [{ access: '🌐' }] } } } }), true));
  it('rejects unknown top-level key', () => assert.throws(() => validateSchema({ name: 'App', userCollections: { Admin: {} } })));
  it('accepts sentry config with environment and tracesSampleRate', () => assert.strictEqual(validateSchema({ name: 'App', sentry: { environment: 'production', tracesSampleRate: 0.5 } }), true));
  it('accepts sentry config with debug flag', () => assert.strictEqual(validateSchema({ name: 'App', sentry: { debug: true } }), true));
  it('rejects sentry tracesSampleRate greater than 1', () => assert.throws(() => validateSchema({ name: 'App', sentry: { tracesSampleRate: 2 } })));
  it('rejects sentry tracesSampleRate less than 0', () => assert.throws(() => validateSchema({ name: 'App', sentry: { tracesSampleRate: -0.1 } })));
  it('rejects sentry config with unknown key (dsn not allowed in yaml)', () => assert.throws(() => validateSchema({ name: 'App', sentry: { dsn: 'https://x@sentry.io/1' } })));
});

describe('json-schema', () => {
  const { validateSchema } = require('../core/schema-validator');
  const { loadYaml } = require('../core/yaml-loader');

  it('chadstart.schema.json is valid JSON', () => {
    const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'chadstart.schema.json'), 'utf8'));
    assert.strictEqual(schema.$schema, 'http://json-schema.org/draft-07/schema#');
    assert.ok(schema.properties.entities);
    assert.ok(schema.$defs.entity);
    assert.ok(schema.$defs.policies);
  });

  it('schema file can validate the example config', () => {
    const config = loadYaml(path.resolve(__dirname, '..', 'chadstart.yaml'));
    assert.strictEqual(validateSchema(config), true);
  });
});
