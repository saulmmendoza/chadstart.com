'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { buildCore } = require('../core/entity-engine');
const dbModule = require('../core/db');
const { createBackendSdk } = require('../core/api-generator');

describe('createBackendSdk', () => {
  let tmp, sdk;
  const sdkCore = buildCore({
    name: 'SdkTest',
    entities: {
      Book: { properties: ['title', 'author'] },
      Config: { single: true, properties: ['value'] },
    },
  });

  before(async () => {
    tmp = path.join(os.tmpdir(), `chadstart-sdk-${Date.now()}.db`);
    await dbModule.initDb(sdkCore, tmp);
    await dbModule.create('config', { value: 'initial' });
    sdk = createBackendSdk(sdkCore);
  });

  after(() => { fs.unlinkSync(tmp); });

  it('from() returns CRUD interface', () => {
    const iface = sdk.from('book');
    assert.strictEqual(typeof iface.find, 'function');
    assert.strictEqual(typeof iface.findOneById, 'function');
    assert.strictEqual(typeof iface.create, 'function');
    assert.strictEqual(typeof iface.update, 'function');
    assert.strictEqual(typeof iface.patch, 'function');
    assert.strictEqual(typeof iface.delete, 'function');
  });

  it('from().create and findOneById work', async () => {
    const book = await sdk.from('book').create({ title: 'Dune', author: 'Herbert' });
    assert.strictEqual(book.title, 'Dune');
    const found = await sdk.from('book').findOneById(book.id);
    assert.strictEqual(found.author, 'Herbert');
  });

  it('from().find returns paginated result', async () => {
    const result = await sdk.from('book').find();
    assert.ok(Array.isArray(result.data));
    assert.ok(typeof result.total === 'number');
  });

  it('from().patch updates a field', async () => {
    const book = await sdk.from('book').create({ title: 'Old Title', author: 'Author' });
    const updated = await sdk.from('book').patch(book.id, { title: 'New Title' });
    assert.strictEqual(updated.title, 'New Title');
    assert.strictEqual(updated.author, 'Author');
  });

  it('from().delete removes a record', async () => {
    const book = await sdk.from('book').create({ title: 'To Delete', author: 'X' });
    await sdk.from('book').delete(book.id);
    assert.strictEqual(await sdk.from('book').findOneById(book.id), null);
  });

  it('from() throws for unknown slug', () => {
    assert.throws(() => sdk.from('nonexistent'), /Entity not found/);
  });

  it('single() returns get/update/patch interface', () => {
    const iface = sdk.single('config');
    assert.strictEqual(typeof iface.get, 'function');
    assert.strictEqual(typeof iface.update, 'function');
    assert.strictEqual(typeof iface.patch, 'function');
  });

  it('single().get retrieves the record', async () => {
    const record = await sdk.single('config').get();
    assert.strictEqual(record.value, 'initial');
  });

  it('single().patch updates a field', async () => {
    const updated = await sdk.single('config').patch({ value: 'changed' });
    assert.strictEqual(updated.value, 'changed');
  });

  it('single() throws for unknown slug', () => {
    assert.throws(() => sdk.single('nonexistent'), /Single entity not found/);
  });
});
