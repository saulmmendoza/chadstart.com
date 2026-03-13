'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { buildCore } = require('../core/entity-engine');
const dbModule = require('../core/db');
const { validateBody, deserializeGroupProps } = require('../core/api-generator');

describe('groups – serialization / deserialization', () => {
  const groupEntity = {
    properties: [
      { name: 'testimonials', type: 'group', options: { group: 'Testimonial' } },
      { name: 'callToAction', type: 'group', options: { group: 'CallToAction', multiple: false } },
      { name: 'title', type: 'string' },
    ],
    belongsTo: [],
  };

  it('deserializeGroupProps: parses JSON string to array for multiple group', () => {
    const items = [{ author: 'Alice', rating: 5 }, { author: 'Bob', rating: 4 }];
    const row = { id: '1', testimonials: JSON.stringify(items), title: 'hi' };
    const result = deserializeGroupProps(row, groupEntity);
    assert.deepStrictEqual(result.testimonials, items);
    assert.strictEqual(result.title, 'hi');
  });

  it('deserializeGroupProps: parses JSON string to object for single group', () => {
    const cta = { title: 'Buy now', buttonText: 'Go' };
    const row = { id: '1', callToAction: JSON.stringify(cta) };
    const result = deserializeGroupProps(row, groupEntity);
    assert.deepStrictEqual(result.callToAction, cta);
  });

  it('deserializeGroupProps: leaves non-string group values unchanged', () => {
    const items = [{ author: 'Alice' }];
    const row = { id: '1', testimonials: items };
    const result = deserializeGroupProps(row, groupEntity);
    assert.deepStrictEqual(result.testimonials, items);
  });

  it('deserializeGroupProps: handles invalid JSON gracefully (leaves as string)', () => {
    const row = { id: '1', testimonials: 'not-json' };
    const result = deserializeGroupProps(row, groupEntity);
    assert.strictEqual(result.testimonials, 'not-json');
  });

  it('deserializeGroupProps: is a no-op when no group properties exist', () => {
    const simpleEntity = { properties: [{ name: 'title', type: 'string' }] };
    const row = { id: '1', title: 'hello' };
    const result = deserializeGroupProps(row, simpleEntity);
    assert.deepStrictEqual(result, row);
  });

  it('deserializeGroupProps: returns row unchanged when row is null', () => {
    assert.strictEqual(deserializeGroupProps(null, groupEntity), null);
  });
});

describe('groups – validateBody with group validation', () => {
  const groups = {
    Testimonial: {
      properties: [
        { name: 'author', type: 'text' },
        { name: 'rating', type: 'number' },
      ],
      validation: { rating: { isNotEmpty: true } },
    },
    CallToAction: {
      properties: [
        { name: 'title', type: 'string' },
        { name: 'description', type: 'text' },
      ],
      validation: {
        title: { isNotEmpty: true },
        description: { isNotEmpty: true },
      },
    },
  };

  const entityWithGroup = {
    properties: [
      { name: 'name', type: 'string' },
      { name: 'testimonials', type: 'group', options: { group: 'Testimonial' } },
    ],
    validation: {},
  };

  it('validateBody: passes when group items satisfy validation', () => {
    const body = { name: 'Service A', testimonials: [{ author: 'Alice', rating: 5 }, { author: 'Bob', rating: 4 }] };
    assert.strictEqual(validateBody(body, entityWithGroup, groups).errors, null);
  });

  it('validateBody: fails when a group item violates validation', () => {
    const body = { name: 'Service A', testimonials: [{ author: 'Alice', rating: 5 }, { author: 'Bob', rating: '' }] };
    const result = validateBody(body, entityWithGroup, groups);
    assert.ok(result.errors, 'should have errors');
    assert.ok(result.errors.some((e) => e.property.startsWith('testimonials[1]')));
  });

  it('validateBody: skips group validation when group value is absent', () => {
    const body = { name: 'Service A' };
    assert.strictEqual(validateBody(body, entityWithGroup, groups).errors, null);
  });

  it('validateBody: skips group validation when no groups map provided', () => {
    const body = { name: 'Service A', testimonials: [{ author: 'Alice', rating: '' }] };
    assert.strictEqual(validateBody(body, entityWithGroup).errors, null);
  });

  it('validateBody: single (non-multiple) group validates the object directly', () => {
    const ctaEntity = {
      properties: [
        { name: 'callToAction', type: 'group', options: { group: 'CallToAction', multiple: false } },
      ],
      validation: {},
    };
    const badBody = { callToAction: { title: '', description: 'desc' } };
    const result = validateBody(badBody, ctaEntity, groups);
    assert.ok(result.errors, 'should have errors for empty title');
    assert.ok(result.errors.some((e) => e.property === 'callToAction.title'),
      `expected callToAction.title, got: ${JSON.stringify(result.errors.map((e) => e.property))}`);

    const goodBody = { callToAction: { title: 'Act now', description: 'Do it' } };
    assert.strictEqual(validateBody(goodBody, ctaEntity, groups).errors, null);
  });
});

describe('groups – seeder generates group values', () => {
  let tmp;
  const groupSeedCore = buildCore({
    name: 'GroupSeedTest',
    entities: {
      Service: {
        properties: [
          { name: 'name', type: 'string' },
          { name: 'testimonials', type: 'group', options: { group: 'Testimonial' } },
          { name: 'callToAction', type: 'group', options: { group: 'CallToAction', multiple: false } },
        ],
        seedCount: 3,
      },
    },
    groups: {
      Testimonial: {
        properties: [
          { name: 'author', type: 'text' },
          { name: 'content', type: 'text' },
          { name: 'rating', type: 'number' },
        ],
      },
      CallToAction: {
        properties: [
          { name: 'title', type: 'string' },
          { name: 'buttonText', type: 'string' },
        ],
      },
    },
  });

  before(() => {
    tmp = path.join(os.tmpdir(), `chadstart-group-seed-${Date.now()}.db`);
    dbModule.initDb(groupSeedCore, tmp);
  });

  after(() => { fs.unlinkSync(tmp); });

  it('seeder: group property stores valid JSON array for multiple group', async () => {
    const { seedAll } = require('../core/seeder');
    const summary = await seedAll(groupSeedCore);
    assert.strictEqual(summary.Service, 3);

    const rows = dbModule.findAll('service', {}, { perPage: 100 });
    assert.strictEqual(rows.total, 3);

    for (const row of rows.data) {
      assert.ok(typeof row.testimonials === 'string', 'testimonials should be stored as string');
      const items = JSON.parse(row.testimonials);
      assert.ok(Array.isArray(items), 'testimonials should parse to array');
      assert.ok(items.length >= 1, 'testimonials should have at least one item');
      assert.ok('author' in items[0], 'each item should have author');
      assert.ok('rating' in items[0], 'each item should have rating');

      assert.ok(typeof row.callToAction === 'string', 'callToAction should be stored as string');
      const cta = JSON.parse(row.callToAction);
      assert.ok(cta && typeof cta === 'object' && !Array.isArray(cta), 'callToAction should parse to object');
      assert.ok('title' in cta, 'callToAction should have title');
    }
  });

  it('seeder: group with no matching group definition stores empty JSON array', async () => {
    const { seedAll } = require('../core/seeder');
    const coreNoGroupDef = buildCore({
      name: 'NoGroupDef',
      entities: {
        Item: {
          properties: [{ name: 'stuff', type: 'group', options: { group: 'Missing' } }],
          seedCount: 1,
        },
      },
      groups: {},
    });
    const tmpNoGroup = path.join(os.tmpdir(), `chadstart-nogrp-${Date.now()}.db`);
    dbModule.initDb(coreNoGroupDef, tmpNoGroup);
    const summary = await seedAll(coreNoGroupDef);
    assert.strictEqual(summary.Item, 1);
    const rows = dbModule.findAll('item', {}, { perPage: 10 });
    assert.ok(typeof rows.data[0].stuff === 'string');
    assert.deepStrictEqual(JSON.parse(rows.data[0].stuff), []);
    fs.unlinkSync(tmpNoGroup);
  });
});
