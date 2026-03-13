'use strict';

const assert = require('assert');
const path = require('path');
const { loadYaml } = require('../core/yaml-loader');

describe('yaml-loader', () => {
  it('loads chadstart.yaml', () => {
    const config = loadYaml(path.resolve(__dirname, '..', 'chadstart.yaml'));
    assert.strictEqual(config.name, 'Blog');
    assert.ok(config.entities.Admin.authenticable);
    assert.ok(config.entities.Post);
  });

  it('throws on missing file', () => assert.throws(() => loadYaml('/nonexistent'), /not found/i));
});
