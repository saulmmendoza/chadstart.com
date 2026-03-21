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

  before(async () => {
    tmpDb = path.join(os.tmpdir(), `chadstart-test-${Date.now()}.db`);
    await dbModule.initDb(testCore, tmpDb);
  });

  after(() => { fs.unlinkSync(tmpDb); });

  it('initDb creates database file', () => { assert.ok(fs.existsSync(tmpDb)); });
  it('create inserts a row', async () => { const r = await dbModule.create('widget', { name: 'Foo', color: 'red' }); assert.strictEqual(r.name, 'Foo'); assert.ok(typeof r.id === 'string' && r.id.length > 0); assert.ok(r.createdAt); assert.ok(r.updatedAt); });
  it('findAll returns paginated result', async () => { const result = await dbModule.findAll('widget'); assert.ok(result.data.length >= 1); assert.ok(typeof result.total === 'number'); assert.ok(typeof result.currentPage === 'number'); });
  it('findById works', async () => { const c = await dbModule.create('widget', { name: 'Bar', color: 'blue' }); assert.strictEqual((await dbModule.findById('widget', c.id)).name, 'Bar'); });
  it('findById returns null for missing', async () => assert.strictEqual(await dbModule.findById('widget', 'nonexistent-id'), null));
  it('update modifies row', async () => { const c = await dbModule.create('widget', { name: 'Baz', color: 'green' }); assert.strictEqual((await dbModule.update('widget', c.id, { color: 'yellow' })).color, 'yellow'); });
  it('remove deletes row', async () => { const c = await dbModule.create('widget', { name: 'Del', color: 'gray' }); await dbModule.remove('widget', c.id); assert.strictEqual(await dbModule.findById('widget', c.id), null); });
  it('remove returns null for missing', async () => assert.strictEqual(await dbModule.remove('widget', 'nonexistent-id'), null));
  it('findAll with filters', async () => { await dbModule.create('widget', { name: 'R1', color: 'red' }); const result = await dbModule.findAll('widget', { color: 'red' }); assert.ok(result.data.every((r) => r.color === 'red')); });
  it('findAll with filter suffixes', async () => { await dbModule.create('widget', { name: 'FilterTest', color: 'green' }); const result = await dbModule.findAll('widget', { color_neq: 'red' }); assert.ok(result.data.some((r) => r.color !== 'red')); });
  it('findAll with ordering', async () => { const result = await dbModule.findAll('widget', {}, { orderBy: 'name', order: 'ASC' }); assert.ok(result.data.length >= 1); });
  it('findAll with pagination', async () => { const result = await dbModule.findAll('widget', {}, { page: 1, perPage: 2 }); assert.ok(result.perPage === 2); assert.ok(result.currentPage === 1); });
  it('findAllSimple returns raw array', async () => { const rows = await dbModule.findAllSimple('widget'); assert.ok(Array.isArray(rows)); });
});

describe('db – authenticable entities', () => {
  let tmp;

  before(async () => {
    tmp = path.join(os.tmpdir(), `chadstart-auth-${Date.now()}.db`);
    const core = buildCore({ name: 'T', entities: { Admin: { authenticable: true, properties: ['name'] } } });
    await dbModule.initDb(core, tmp);
  });

  after(() => { fs.unlinkSync(tmp); });

  it('authenticable entity has email + password columns', () => {
    const cols = dbModule.getDb().pragma('table_info("admin")').map((r) => r.name);
    assert.ok(cols.includes('email') && cols.includes('password') && cols.includes('name'));
  });
});

describe('db – belongsToMany junction tables', () => {
  let tmp;

  before(async () => {
    tmp = path.join(os.tmpdir(), `chadstart-btm-${Date.now()}.db`);
    const core = buildCore({ name: 'T', entities: { Player: { properties: ['n'], belongsToMany: ['Skill'] }, Skill: { properties: ['n'] } } });
    await dbModule.initDb(core, tmp);
  });

  after(() => { fs.unlinkSync(tmp); });

  it('creates junction table', () => {
    const tables = dbModule.getDb().prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
    assert.ok(tables.some((t) => t.includes('player') && t.includes('skill')));
  });
});

describe('db – advanced filters', () => {
  let tmp;

  before(async () => {
    tmp = path.join(os.tmpdir(), `chadstart-advfilter-${Date.now()}.db`);
    const core = buildCore({
      name: 'T',
      entities: { Score: { properties: [{ name: 'value', type: 'integer' }, { name: 'tag', type: 'string' }] } },
    });
    await dbModule.initDb(core, tmp);
    await dbModule.create('score', { value: 10, tag: 'alpha' });
    await dbModule.create('score', { value: 20, tag: 'bravo' });
    await dbModule.create('score', { value: 30, tag: 'charlie' });
    await dbModule.create('score', { value: 40, tag: 'delta' });
  });

  after(() => { fs.unlinkSync(tmp); });

  it('_eq filter returns exact match', async () => {
    const result = await dbModule.findAll('score', { tag_eq: 'alpha' });
    assert.ok(result.data.every((r) => r.tag === 'alpha'));
    assert.strictEqual(result.data.length, 1);
  });

  it('_gt filter returns rows greater than value', async () => {
    const result = await dbModule.findAll('score', { value_gt: '15' });
    assert.ok(result.data.every((r) => r.value > 15));
    assert.strictEqual(result.data.length, 3);
  });

  it('_gte filter returns rows >= value', async () => {
    const result = await dbModule.findAll('score', { value_gte: '20' });
    assert.ok(result.data.every((r) => r.value >= 20));
    assert.strictEqual(result.data.length, 3);
  });

  it('_lt filter returns rows below value', async () => {
    const result = await dbModule.findAll('score', { value_lt: '25' });
    assert.ok(result.data.every((r) => r.value < 25));
    assert.strictEqual(result.data.length, 2);
  });

  it('_lte filter returns rows <= value', async () => {
    const result = await dbModule.findAll('score', { value_lte: '20' });
    assert.ok(result.data.every((r) => r.value <= 20));
    assert.strictEqual(result.data.length, 2);
  });

  it('_like filter matches pattern', async () => {
    const result = await dbModule.findAll('score', { tag_like: '%lph%' });
    assert.ok(result.data.every((r) => r.tag.includes('lph')));
    assert.strictEqual(result.data.length, 1);
  });

  it('_in filter returns rows matching any listed value', async () => {
    const result = await dbModule.findAll('score', { tag_in: 'alpha,bravo' });
    assert.ok(result.data.every((r) => r.tag === 'alpha' || r.tag === 'bravo'));
    assert.strictEqual(result.data.length, 2);
  });

  it('findAllSimple with filter returns matching rows', async () => {
    const rows = await dbModule.findAllSimple('score', { tag: 'alpha' });
    assert.ok(rows.every((r) => r.tag === 'alpha'));
    assert.strictEqual(rows.length, 1);
  });

  it('findAllSimple with unknown filter key returns all rows', async () => {
    const rows = await dbModule.findAllSimple('score', { nonexistent_col: 'xyz' });
    assert.ok(Array.isArray(rows));
    assert.ok(rows.length >= 4);
  });
});

describe('db – relations', () => {
  let tmp, post, commentNoPost, comment1, player, skill1, skill2;
  let core;

  before(async () => {
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
    await dbModule.initDb(core, tmp);

    post         = await dbModule.create('post',    { title: 'Hello World' });
    await dbModule.create('comment', { body: 'Great!', post_id: post.id });
    await dbModule.create('comment', { body: 'Thanks', post_id: post.id });
    commentNoPost = await dbModule.create('comment', { body: 'Orphan', post_id: null });
    comment1      = await dbModule.create('comment', { body: 'Reply', post_id: post.id });
    player  = await dbModule.create('player', { name: 'Alice' });
    skill1  = await dbModule.create('skill',  { label: 'Jump' });
    skill2  = await dbModule.create('skill',  { label: 'Swim' });
  });

  after(() => { fs.unlinkSync(tmp); });

  it('loadRelations: noop when row is null', async () => {
    const result = await dbModule.loadRelations(null, core.entities.Comment, 'Post');
    assert.strictEqual(result, null);
  });

  it('loadRelations: belongsTo resolves related row', async () => {
    const row = { ...comment1 };
    await dbModule.loadRelations(row, core.entities.Comment, 'Post');
    assert.ok(row.Post, 'related row should be attached');
    assert.strictEqual(row.Post.id, post.id);
    assert.strictEqual(row.Post.title, 'Hello World');
  });

  it('loadRelations: belongsTo with null FK sets null', async () => {
    const row = { ...commentNoPost };
    await dbModule.loadRelations(row, core.entities.Comment, 'Post');
    assert.strictEqual(row.Post, null);
  });

  it('loadRelations: hasMany (reverse) resolves children', async () => {
    const row = { ...post };
    await dbModule.loadRelations(row, core.entities.Post, 'comment');
    assert.ok(Array.isArray(row.comment));
    assert.ok(row.comment.length >= 3);
    assert.ok(row.comment.every((c) => c.post_id === post.id));
  });

  it('loadRelations: comma-separated names loads multiple relations', async () => {
    const row = { ...comment1 };
    await dbModule.loadRelations(row, core.entities.Comment, 'Post,nonexistent');
    assert.ok(row.Post, 'Post relation should be loaded');
  });

  it('saveBelongsToMany: saves junction rows and loadRelations retrieves them', async () => {
    await dbModule.saveBelongsToMany(core.entities.Player, player.id, { skillIds: [skill1.id, skill2.id] });
    const row = { ...player };
    await dbModule.loadRelations(row, core.entities.Player, 'Skill');
    assert.ok(Array.isArray(row.Skill));
    assert.strictEqual(row.Skill.length, 2);
  });

  it('saveBelongsToMany: clears and replaces existing junction rows', async () => {
    await dbModule.saveBelongsToMany(core.entities.Player, player.id, { skillIds: [skill1.id] });
    const row = { ...player };
    await dbModule.loadRelations(row, core.entities.Player, 'Skill');
    assert.strictEqual(row.Skill.length, 1);
    assert.strictEqual(row.Skill[0].id, skill1.id);
  });

  it('saveBelongsToMany: skips when no ids key in body', async () => {
    await dbModule.saveBelongsToMany(core.entities.Player, player.id, {});
    const row = { ...player };
    await dbModule.loadRelations(row, core.entities.Player, 'Skill');
    assert.strictEqual(row.Skill.length, 1);
  });
});
