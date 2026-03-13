'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { loadYaml, saveYaml } = require('../core/yaml-loader');

describe('yaml-loader', () => {
  it('loads chadstart.yaml', () => {
    const config = loadYaml(path.resolve(__dirname, '..', 'chadstart.yaml'));
    assert.strictEqual(config.name, 'Blog');
    assert.ok(config.entities.Admin.authenticable);
    assert.ok(config.entities.Post);
  });

  it('throws on missing file', () => assert.throws(() => loadYaml('/nonexistent'), /not found/i));

  describe('saveYaml', () => {
    let tmpFile;

    beforeEach(() => {
      tmpFile = path.join(os.tmpdir(), `chadstart-test-${Date.now()}.yaml`);
    });

    afterEach(() => {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    });

    it('creates a new YAML file when the file does not exist', () => {
      const config = { name: 'TestApp', port: 4000 };
      saveYaml(tmpFile, config);
      assert.ok(fs.existsSync(tmpFile));
      const saved = loadYaml(tmpFile);
      assert.strictEqual(saved.name, 'TestApp');
      assert.strictEqual(saved.port, 4000);
    });

    it('updates an existing YAML file and preserves values', () => {
      const original = { name: 'Original', port: 3000, entities: { User: { authenticable: true, properties: ['name'] } } };
      saveYaml(tmpFile, original);

      const updated = { name: 'Updated', port: 5000, entities: { User: { authenticable: true, properties: ['name', 'email'] } } };
      saveYaml(tmpFile, updated);

      const saved = loadYaml(tmpFile);
      assert.strictEqual(saved.name, 'Updated');
      assert.strictEqual(saved.port, 5000);
      assert.ok(saved.entities.User);
    });

    it('removes keys no longer present in the new config', () => {
      saveYaml(tmpFile, { name: 'App', port: 3000, database: 'data/db.sqlite' });
      saveYaml(tmpFile, { name: 'App', port: 3000 });
      const saved = loadYaml(tmpFile);
      assert.strictEqual(saved.database, undefined);
    });

    it('round-trips complex entity config correctly', () => {
      const config = {
        name: 'Blog',
        port: 3000,
        entities: {
          Post: {
            properties: ['title', { name: 'content', type: 'text' }],
            policies: { read: [{ access: 'public' }], create: [{ access: 'restricted', allow: 'Admin' }] },
          },
        },
      };
      saveYaml(tmpFile, config);
      const saved = loadYaml(tmpFile);
      assert.strictEqual(saved.name, 'Blog');
      assert.ok(saved.entities.Post);
      assert.strictEqual(saved.entities.Post.policies.read[0].access, 'public');
      assert.strictEqual(saved.entities.Post.policies.create[0].allow, 'Admin');
    });

    it('preserves YAML comments in unchanged top-level sections', () => {
      const originalYaml = '# Application name\nname: Blog\n\n# Server port\nport: 3000\n';
      fs.writeFileSync(tmpFile, originalYaml, 'utf8');

      saveYaml(tmpFile, { name: 'Blog', port: 4000 });

      const raw = fs.readFileSync(tmpFile, 'utf8');
      assert.ok(raw.includes('# Application name'), 'Comment on name should be preserved');
      assert.ok(raw.includes('# Server port'), 'Comment on port should be preserved');

      // Verify the value was actually updated
      const saved = loadYaml(tmpFile);
      assert.strictEqual(saved.port, 4000);
    });
  });
});
