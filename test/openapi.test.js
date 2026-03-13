'use strict';

const assert = require('assert');
const { buildCore } = require('../core/entity-engine');
const { generateOpenApiSpec } = require('../core/openapi');

describe('openapi', () => {
  it('generates valid spec', () => {
    const spec = generateOpenApiSpec(buildCore({ name: 'Blog', entities: { Post: { properties: ['title'] } } }));
    assert.strictEqual(spec.openapi, '3.0.0');
    assert.ok(spec.paths['/api/collections/post']);
    assert.ok(spec.paths['/api/collections/post/{id}']);
  });

  it('includes file bucket paths', () => {
    const spec = generateOpenApiSpec(buildCore({ name: 'App', files: { uploads: { path: '/tmp/uploads' } } }));
    assert.ok(spec.paths['/files/uploads']);
  });

  it('includes auth paths for authenticable entities', () => {
    const spec = generateOpenApiSpec(buildCore({ name: 'App', entities: { Admin: { authenticable: true, properties: ['name'] } } }));
    assert.ok(spec.paths['/api/auth/admin/signup']);
    assert.ok(spec.paths['/api/auth/admin/login']);
    assert.ok(spec.paths['/api/auth/admin/me']);
  });

  it('security on restricted entity', () => {
    const spec = generateOpenApiSpec(buildCore({ name: 'App', entities: { Post: { properties: ['t'], policies: { read: [{ access: 'public' }], create: [{ access: 'restricted' }] } } } }));
    assert.ok(!spec.paths['/api/collections/post'].get.security);
    assert.ok(spec.paths['/api/collections/post'].post.security);
  });

  it('single entity uses /api/singles/ path', () => {
    const spec = generateOpenApiSpec(buildCore({ name: 'App', entities: { Home: { single: true, properties: ['title'] } } }));
    assert.ok(spec.paths['/api/singles/home']);
    assert.ok(spec.paths['/api/singles/home'].put, 'PUT should exist for singles');
  });

  it('collection spec includes PUT endpoint', () => {
    const spec = generateOpenApiSpec(buildCore({ name: 'App', entities: { Post: { properties: ['t'] } } }));
    assert.ok(spec.paths['/api/collections/post/{id}'].put, 'PUT should exist for collections');
  });

  it('openapi includes pagination params', () => {
    const spec = generateOpenApiSpec(buildCore({ name: 'App', entities: { Post: { properties: ['t'] } } }));
    const params = spec.paths['/api/collections/post'].get.parameters;
    assert.ok(params.some((p) => p.name === 'page'));
    assert.ok(params.some((p) => p.name === 'perPage'));
    assert.ok(params.some((p) => p.name === 'orderBy'));
    assert.ok(params.some((p) => p.name === 'relations'));
  });

  it('openapi hides hidden properties', () => {
    const spec = generateOpenApiSpec(buildCore({ name: 'App', entities: { Post: { properties: ['title', { name: 'secret', type: 'string', hidden: true }] } } }));
    const schema = spec.components.schemas.Post;
    assert.ok(schema.properties.title);
    assert.ok(!schema.properties.secret, 'hidden prop should not be in schema');
  });

  it('openapi entity schema has UUID id and timestamps', () => {
    const spec = generateOpenApiSpec(buildCore({ name: 'App', entities: { Post: { properties: ['t'] } } }));
    const schema = spec.components.schemas.Post;
    assert.strictEqual(schema.properties.id.format, 'uuid');
    assert.ok(schema.properties.createdAt);
    assert.ok(schema.properties.updatedAt);
  });
});
