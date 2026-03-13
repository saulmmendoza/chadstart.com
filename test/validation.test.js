'use strict';

const assert = require('assert');
const { validateBody, applyDefaults, hideHiddenProps } = require('../core/api-generator');

describe('validation', () => {
  it('validates required', () => {
    assert.ok(validateBody({}, { properties: [{ name: 't', type: 'string' }], validation: { t: { required: true } } }).errors);
  });
  it('validates minLength', () => {
    assert.ok(validateBody({ n: 'ab' }, { properties: [{ name: 'n', type: 'string' }], validation: { n: { minLength: 3 } } }).errors);
  });
  it('passes valid data', () => {
    assert.strictEqual(validateBody({ n: 'Alice' }, { properties: [{ name: 'n', type: 'string' }], validation: { n: { minLength: 3 } } }).errors, null);
  });
  it('validates min/max', () => {
    assert.ok(validateBody({ age: 50 }, { properties: [{ name: 'age', type: 'number' }], validation: { age: { max: 30 } } }).errors);
  });
  it('isOptional skips undefined', () => {
    assert.strictEqual(validateBody({}, { properties: [{ name: 'e', type: 'email' }], validation: { e: { isOptional: true, contains: '@co.com' } } }).errors, null);
  });
  it('validates contains', () => {
    assert.ok(validateBody({ e: 'john@gmail.com' }, { properties: [{ name: 'e', type: 'email' }], validation: { e: { contains: '@co.com' } } }).errors);
  });

  const validators = [
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
  ];

  for (const [label, ruleObj, bad, good] of validators) {
    it(`validates ${label}`, () => {
      const ent = { properties: [{ name: 'n', type: 'string' }], validation: { n: ruleObj } };
      assert.ok(validateBody(bad, ent).errors, `${label}: invalid input should fail`);
      assert.strictEqual(validateBody(good, ent).errors, null, `${label}: valid input should pass`);
    });
  }
});

describe('validation – additional validators', () => {
  it('validates isEmail', () => {
    const ent = { properties: [{ name: 'e', type: 'email' }], validation: { e: { isEmail: true } } };
    assert.ok(validateBody({ e: 'not-an-email' }, ent).errors, 'invalid email should fail');
    assert.strictEqual(validateBody({ e: 'user@example.com' }, ent).errors, null);
  });

  it('validates isMimeType', () => {
    const ent = { properties: [{ name: 'm', type: 'string' }], validation: { m: { isMimeType: true } } };
    assert.ok(validateBody({ m: 'not a mime type' }, ent).errors, 'invalid mime type should fail');
    assert.strictEqual(validateBody({ m: 'image/png' }, ent).errors, null);
  });

  it('validates maxLength', () => {
    const ent = { properties: [{ name: 'n', type: 'string' }], validation: { n: { maxLength: 5 } } };
    assert.ok(validateBody({ n: 'toolongstring' }, ent).errors, 'too long should fail');
    assert.strictEqual(validateBody({ n: 'ok' }, ent).errors, null);
  });

  it('validates isNotEmpty', () => {
    const ent = { properties: [{ name: 'n', type: 'string' }], validation: { n: { isNotEmpty: true } } };
    assert.ok(validateBody({ n: '' }, ent).errors, 'empty string should fail');
    assert.strictEqual(validateBody({ n: 'hello' }, ent).errors, null);
  });
});

describe('hidden properties & defaults', () => {
  it('hideHiddenProps removes hidden fields', () => {
    const entity = { properties: [{ name: 'title', type: 'string', hidden: false }, { name: 'secret', type: 'string', hidden: true }] };
    const result = hideHiddenProps({ id: '1', title: 'Hi', secret: 'shhh' }, entity);
    assert.strictEqual(result.title, 'Hi');
    assert.ok(!('secret' in result));
  });

  it('applyDefaults fills missing with defaults', () => {
    const entity = { properties: [{ name: 'status', type: 'string', default: 'draft' }, { name: 'title', type: 'string' }] };
    const result = applyDefaults({ title: 'Hello' }, entity);
    assert.strictEqual(result.status, 'draft');
    assert.strictEqual(result.title, 'Hello');
  });

  it('applyDefaults does not override existing values', () => {
    const entity = { properties: [{ name: 'status', type: 'string', default: 'draft' }] };
    const result = applyDefaults({ status: 'published' }, entity);
    assert.strictEqual(result.status, 'published');
  });
});
