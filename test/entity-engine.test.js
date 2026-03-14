'use strict';

const assert = require('assert');
const { buildCore, toSnakeCase, toKebabCase } = require('../core/entity-engine');

describe('entity-engine', () => {
  it('toSnakeCase converts PascalCase', () => assert.strictEqual(toSnakeCase('BlogPost'), 'blog_post'));
  it('toSnakeCase leaves lowercase', () => assert.strictEqual(toSnakeCase('post'), 'post'));
  it('toKebabCase converts PascalCase', () => assert.strictEqual(toKebabCase('BlogPost'), 'blog-post'));

  it('buildCore populates entities', () => {
    const core = buildCore({ name: 'Blog', entities: { Post: { properties: ['title', 'content'] } } });
    assert.ok(core.entities.Post);
    assert.strictEqual(core.entities.Post.tableName, 'post');
    assert.deepStrictEqual(core.entities.Post.properties.map((p) => p.name), ['title', 'content']);
  });

  it('buildCore normalizes object properties', () => {
    const core = buildCore({ name: 'App', entities: { Item: { properties: [{ name: 'price', type: 'number' }] } } });
    assert.strictEqual(core.entities.Item.properties[0].type, 'number');
  });

  it('buildCore sets default port', () => assert.ok(typeof buildCore({ name: 'App' }).port === 'number'));

  it('buildCore handles authenticable entities', () => {
    const core = buildCore({ name: 'App', entities: { Admin: { authenticable: true, properties: ['name'] }, Post: { properties: ['t'] } } });
    assert.ok(core.entities.Admin.authenticable);
    assert.ok(core.authenticableEntities.Admin);
    assert.ok(!core.authenticableEntities.Post);
  });

  it('buildCore handles policies with emoji', () => {
    const core = buildCore({ name: 'App', entities: { Post: { properties: ['t'], policies: { read: [{ access: '🌐' }], delete: [{ access: '🚫' }] } } } });
    assert.strictEqual(core.entities.Post.policies.read[0].access, 'public');
    assert.strictEqual(core.entities.Post.policies.delete[0].access, 'forbidden');
  });

  it('buildCore normalizes belongsTo', () => {
    const core = buildCore({ name: 'App', entities: { Comment: { properties: ['text'], belongsTo: ['Post'] }, Post: { properties: ['t'] } } });
    assert.strictEqual(core.entities.Comment.belongsTo[0].entity, 'Post');
  });

  it('buildCore handles belongsToMany', () => {
    const core = buildCore({ name: 'App', entities: { Player: { properties: ['n'], belongsToMany: ['Skill'] }, Skill: { properties: ['n'] } } });
    assert.strictEqual(core.entities.Player.belongsToMany[0].entity, 'Skill');
  });

  it('buildCore handles singles, validation, hooks, endpoints, groups', () => {
    const core = buildCore({
      name: 'App',
      entities: { Home: { single: true, properties: ['t'], validation: { t: { minLength: 3 } }, hooks: { beforeCreate: [{ url: 'https://x.com' }] } } },
      endpoints: { hi: { path: '/hi', method: 'GET', function: 'hi' } },
      groups: { G: { properties: [{ name: 'a', type: 'string' }] } },
    });
    assert.ok(core.entities.Home.single);
    assert.strictEqual(core.entities.Home.validation.t.minLength, 3);
    assert.strictEqual(core.entities.Home.hooks.beforeCreate[0].url, 'https://x.com');
    assert.ok(core.endpoints.hi);
    assert.ok(core.groups.G);
  });

  it('buildCore passes nameSingular and namePlural', () => {
    const core = buildCore({
      name: 'App',
      entities: { Person: { nameSingular: 'person', namePlural: 'people', properties: ['name'] } },
    });
    assert.strictEqual(core.entities.Person.nameSingular, 'person');
    assert.strictEqual(core.entities.Person.namePlural, 'people');
  });

  it('inline validation merges and inline prevails on conflict', () => {
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
});

describe('entity-engine – branches', () => {
  it('normalizeRelation: object with only entity key', () => {
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

  it('normalizeRelation: object with only name key', () => {
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

  it('normalizeProperty: carries hidden, default, options, helpText, validation', () => {
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

  it('buildCore entity with no properties defaults to empty array', () => {
    const core = buildCore({ name: 'App', entities: { Tag: {} } });
    assert.deepStrictEqual(core.entities.Tag.properties, []);
  });
});
