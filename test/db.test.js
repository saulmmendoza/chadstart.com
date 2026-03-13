'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { buildCore } = require('../core/entity-engine');
const dbModule = require('../core/db');

describe('db', () => {
  let tmpDb;
  const testCore = buildCore({ name: 'T', entities: { Widget: { properties: ['name', 'color'] } } });

  before(() => {
    tmpDb = path.join(os.tmpdir(), `chadstart-test-${Date.now()}.db`);
    dbModule.initDb(testCore, tmpDb);
  });

  after(() => { fs.unlinkSync(tmpDb); });

  it('initDb creates database file', () => { assert.ok(fs.existsSync(tmpDb)); });
  it('create inserts a row', () => { const r = dbModule.create('widget', { name: 'Foo', color: 'red' }); assert.strictEqual(r.name, 'Foo'); assert.ok(typeof r.id === 'string' && r.id.length > 0); assert.ok(r.createdAt); assert.ok(r.updatedAt); });
  it('findAll returns paginated result', () => { const result = dbModule.findAll('widget'); assert.ok(result.data.length >= 1); assert.ok(typeof result.total === 'number'); assert.ok(typeof result.currentPage === 'number'); });
  it('findById works', () => { const c = dbModule.create('widget', { name: 'Bar', color: 'blue' }); assert.strictEqual(dbModule.findById('widget', c.id).name, 'Bar'); });
  it('findById returns null for missing', () => assert.strictEqual(dbModule.findById('widget', 'nonexistent-id'), null));
  it('update modifies row', () => { const c = dbModule.create('widget', { name: 'Baz', color: 'green' }); assert.strictEqual(dbModule.update('widget', c.id, { color: 'yellow' }).color, 'yellow'); });
  it('remove deletes row', () => { const c = dbModule.create('widget', { name: 'Del', color: 'gray' }); dbModule.remove('widget', c.id); assert.strictEqual(dbModule.findById('widget', c.id), null); });
  it('remove returns null for missing', () => assert.strictEqual(dbModule.remove('widget', 'nonexistent-id'), null));
  it('findAll with filters', () => { dbModule.create('widget', { name: 'R1', color: 'red' }); const result = dbModule.findAll('widget', { color: 'red' }); assert.ok(result.data.every((r) => r.color === 'red')); });
  it('findAll with filter suffixes', () => { dbModule.create('widget', { name: 'FilterTest', color: 'green' }); const result = dbModule.findAll('widget', { color_neq: 'red' }); assert.ok(result.data.some((r) => r.color !== 'red')); });
  it('findAll with ordering', () => { const result = dbModule.findAll('widget', {}, { orderBy: 'name', order: 'ASC' }); assert.ok(result.data.length >= 1); });
  it('findAll with pagination', () => { const result = dbModule.findAll('widget', {}, { page: 1, perPage: 2 }); assert.ok(result.perPage === 2); assert.ok(result.currentPage === 1); });
  it('findAllSimple returns raw array', () => { const rows = dbModule.findAllSimple('widget'); assert.ok(Array.isArray(rows)); });
});

describe('db – authenticable entities', () => {
  let tmp;

  before(() => {
    tmp = path.join(os.tmpdir(), `chadstart-auth-${Date.now()}.db`);
    const core = buildCore({ name: 'T', entities: { Admin: { authenticable: true, properties: ['name'] } } });
    dbModule.initDb(core, tmp);
  });

  after(() => { fs.unlinkSync(tmp); });

  it('authenticable entity has email + password columns', () => {
    const cols = dbModule.getDb().pragma('table_info("admin")').map((r) => r.name);
    assert.ok(cols.includes('email') && cols.includes('password') && cols.includes('name'));
  });
});

describe('db – belongsToMany junction tables', () => {
  let tmp;

  before(() => {
    tmp = path.join(os.tmpdir(), `chadstart-btm-${Date.now()}.db`);
    const core = buildCore({ name: 'T', entities: { Player: { properties: ['n'], belongsToMany: ['Skill'] }, Skill: { properties: ['n'] } } });
    dbModule.initDb(core, tmp);
  });

  after(() => { fs.unlinkSync(tmp); });

  it('creates junction table', () => {
    const tables = dbModule.getDb().prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
    assert.ok(tables.some((t) => t.includes('player') && t.includes('skill')));
  });
});

describe('db – advanced filters', () => {
  let tmp;

  before(() => {
    tmp = path.join(os.tmpdir(), `chadstart-advfilter-${Date.now()}.db`);
    const core = buildCore({
      name: 'T',
      entities: { Score: { properties: [{ name: 'value', type: 'integer' }, { name: 'tag', type: 'string' }] } },
    });
    dbModule.initDb(core, tmp);
    dbModule.create('score', { value: 10, tag: 'alpha' });
    dbModule.create('score', { value: 20, tag: 'bravo' });
    dbModule.create('score', { value: 30, tag: 'charlie' });
    dbModule.create('score', { value: 40, tag: 'delta' });
  });

  after(() => { fs.unlinkSync(tmp); });

  it('_eq filter returns exact match', () => {
    const result = dbModule.findAll('score', { tag_eq: 'alpha' });
    assert.ok(result.data.every((r) => r.tag === 'alpha'));
    assert.strictEqual(result.data.length, 1);
  });

  it('_gt filter returns rows greater than value', () => {
    const result = dbModule.findAll('score', { value_gt: '15' });
    assert.ok(result.data.every((r) => r.value > 15));
    assert.strictEqual(result.data.length, 3);
  });

  it('_gte filter returns rows >= value', () => {
    const result = dbModule.findAll('score', { value_gte: '20' });
    assert.ok(result.data.every((r) => r.value >= 20));
    assert.strictEqual(result.data.length, 3);
  });

  it('_lt filter returns rows below value', () => {
    const result = dbModule.findAll('score', { value_lt: '25' });
    assert.ok(result.data.every((r) => r.value < 25));
    assert.strictEqual(result.data.length, 2);
  });

  it('_lte filter returns rows <= value', () => {
    const result = dbModule.findAll('score', { value_lte: '20' });
    assert.ok(result.data.every((r) => r.value <= 20));
    assert.strictEqual(result.data.length, 2);
  });

  it('_like filter matches pattern', () => {
    const result = dbModule.findAll('score', { tag_like: '%lph%' });
    assert.ok(result.data.every((r) => r.tag.includes('lph')));
    assert.strictEqual(result.data.length, 1);
  });

  it('_in filter returns rows matching any listed value', () => {
    const result = dbModule.findAll('score', { tag_in: 'alpha,bravo' });
    assert.ok(result.data.every((r) => r.tag === 'alpha' || r.tag === 'bravo'));
    assert.strictEqual(result.data.length, 2);
  });

  it('findAllSimple with filter returns matching rows', () => {
    const rows = dbModule.findAllSimple('score', { tag: 'alpha' });
    assert.ok(rows.every((r) => r.tag === 'alpha'));
    assert.strictEqual(rows.length, 1);
  });

  it('findAllSimple with unknown filter key returns all rows', () => {
    const rows = dbModule.findAllSimple('score', { nonexistent_col: 'xyz' });
    assert.ok(Array.isArray(rows));
    assert.ok(rows.length >= 4);
  });
});

describe('db – relations', () => {
  let tmp, post, commentNoPost, comment1, player, skill1, skill2;
  let core;

  before(() => {
    tmp = path.join(os.tmpdir(), `chadstart-rel-${Date.now()}.db`);
    core = buildCore({
      name: 'T',
      entities: {
        Post:    { properties: ['title'] },
        Comment: { properties: ['body'], belongsTo: ['Post'] },
        Player:  { properties: ['name'], belongsToMany: ['Skill'] },
        Skill:   { properties: ['label'] },
      },
    });
    dbModule.initDb(core, tmp);

    post         = dbModule.create('post',    { title: 'Hello World' });
    dbModule.create('comment', { body: 'Great!', post_id: post.id });
    dbModule.create('comment', { body: 'Thanks', post_id: post.id });
    commentNoPost = dbModule.create('comment', { body: 'Orphan', post_id: null });
    comment1      = dbModule.create('comment', { body: 'Reply', post_id: post.id });
    player  = dbModule.create('player', { name: 'Alice' });
    skill1  = dbModule.create('skill',  { label: 'Jump' });
    skill2  = dbModule.create('skill',  { label: 'Swim' });
  });

  after(() => { fs.unlinkSync(tmp); });

  it('loadRelations: noop when row is null', () => {
    const result = dbModule.loadRelations(null, core.entities.Comment, 'Post');
    assert.strictEqual(result, null);
  });

  it('loadRelations: belongsTo resolves related row', () => {
    const row = { ...comment1 };
    dbModule.loadRelations(row, core.entities.Comment, 'Post');
    assert.ok(row.Post, 'related row should be attached');
    assert.strictEqual(row.Post.id, post.id);
    assert.strictEqual(row.Post.title, 'Hello World');
  });

  it('loadRelations: belongsTo with null FK sets null', () => {
    const row = { ...commentNoPost };
    dbModule.loadRelations(row, core.entities.Comment, 'Post');
    assert.strictEqual(row.Post, null);
  });

  it('loadRelations: hasMany (reverse) resolves children', () => {
    const row = { ...post };
    dbModule.loadRelations(row, core.entities.Post, 'comment');
    assert.ok(Array.isArray(row.comment));
    assert.ok(row.comment.length >= 3);
    assert.ok(row.comment.every((c) => c.post_id === post.id));
  });

  it('loadRelations: comma-separated names loads multiple relations', () => {
    const row = { ...comment1 };
    dbModule.loadRelations(row, core.entities.Comment, 'Post,nonexistent');
    assert.ok(row.Post, 'Post relation should be loaded');
  });

  it('saveBelongsToMany: saves junction rows and loadRelations retrieves them', () => {
    dbModule.saveBelongsToMany(core.entities.Player, player.id, { skillIds: [skill1.id, skill2.id] });
    const row = { ...player };
    dbModule.loadRelations(row, core.entities.Player, 'Skill');
    assert.ok(Array.isArray(row.Skill));
    assert.strictEqual(row.Skill.length, 2);
  });

  it('saveBelongsToMany: clears and replaces existing junction rows', () => {
    dbModule.saveBelongsToMany(core.entities.Player, player.id, { skillIds: [skill1.id] });
    const row = { ...player };
    dbModule.loadRelations(row, core.entities.Player, 'Skill');
    assert.strictEqual(row.Skill.length, 1);
    assert.strictEqual(row.Skill[0].id, skill1.id);
  });

  it('saveBelongsToMany: skips when no ids key in body', () => {
    dbModule.saveBelongsToMany(core.entities.Player, player.id, {});
    const row = { ...player };
    dbModule.loadRelations(row, core.entities.Player, 'Skill');
    assert.strictEqual(row.Skill.length, 1);
  });
});
