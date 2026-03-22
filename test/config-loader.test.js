'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  CONFIG_FILENAMES,
  detectFormat,
  isWritableFormat,
  discoverConfigFile,
  loadConfig,
  saveConfig,
  parseRaw,
} = require('../core/config-loader');

function tmpPath(ext) {
  return path.join(os.tmpdir(), `chadstart-cl-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
}

describe('config-loader', () => {
  // ── detectFormat ─────────────────────────────────────────────────────────
  describe('detectFormat', () => {
    it('detects .yaml as yaml', () => assert.strictEqual(detectFormat('app.yaml'), 'yaml'));
    it('detects .yml as yaml', () => assert.strictEqual(detectFormat('app.yml'), 'yaml'));
    it('detects .json as json', () => assert.strictEqual(detectFormat('app.json'), 'json'));
    it('detects .json5 as json5', () => assert.strictEqual(detectFormat('app.json5'), 'json5'));
    it('detects .jsonnet as jsonnet', () => assert.strictEqual(detectFormat('app.jsonnet'), 'jsonnet'));
    it('detects .config.js as js', () => assert.strictEqual(detectFormat('chadstart.config.js'), 'js'));
    it('detects .config.cjs as js', () => assert.strictEqual(detectFormat('chadstart.config.cjs'), 'js'));
    it('defaults to yaml for unknown extensions', () => assert.strictEqual(detectFormat('app.txt'), 'yaml'));
  });

  // ── isWritableFormat ─────────────────────────────────────────────────────
  describe('isWritableFormat', () => {
    it('yaml is writable', () => assert.ok(isWritableFormat('yaml')));
    it('json is writable', () => assert.ok(isWritableFormat('json')));
    it('json5 is writable', () => assert.ok(isWritableFormat('json5')));
    it('jsonnet is not writable', () => assert.ok(!isWritableFormat('jsonnet')));
    it('js is not writable', () => assert.ok(!isWritableFormat('js')));
  });

  // ── discoverConfigFile ───────────────────────────────────────────────────
  describe('discoverConfigFile', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-disc-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns null when no config file exists', () => {
      assert.strictEqual(discoverConfigFile(tmpDir), null);
    });

    it('discovers chadstart.yaml', () => {
      fs.writeFileSync(path.join(tmpDir, 'chadstart.yaml'), 'name: Test\n');
      assert.strictEqual(discoverConfigFile(tmpDir), path.join(tmpDir, 'chadstart.yaml'));
    });

    it('discovers chadstart.json', () => {
      fs.writeFileSync(path.join(tmpDir, 'chadstart.json'), '{"name":"Test"}');
      assert.strictEqual(discoverConfigFile(tmpDir), path.join(tmpDir, 'chadstart.json'));
    });

    it('discovers chadstart.json5', () => {
      fs.writeFileSync(path.join(tmpDir, 'chadstart.json5'), '{name:"Test"}');
      assert.strictEqual(discoverConfigFile(tmpDir), path.join(tmpDir, 'chadstart.json5'));
    });

    it('prefers yaml over json when both exist', () => {
      fs.writeFileSync(path.join(tmpDir, 'chadstart.yaml'), 'name: YAML\n');
      fs.writeFileSync(path.join(tmpDir, 'chadstart.json'), '{"name":"JSON"}');
      const found = discoverConfigFile(tmpDir);
      assert.strictEqual(path.basename(found), 'chadstart.yaml');
    });

    it('falls back to json when yaml is absent', () => {
      fs.writeFileSync(path.join(tmpDir, 'chadstart.json'), '{"name":"JSON"}');
      const found = discoverConfigFile(tmpDir);
      assert.strictEqual(path.basename(found), 'chadstart.json');
    });
  });

  // ── loadConfig ───────────────────────────────────────────────────────────
  describe('loadConfig', () => {
    it('loads the existing chadstart.yaml', () => {
      const config = loadConfig(path.resolve(__dirname, '..', 'chadstart.yaml'));
      assert.strictEqual(typeof config.name, 'string');
      assert.ok(config.entities);
    });

    it('throws on missing file', () => {
      assert.throws(() => loadConfig('/nonexistent.yaml'), /not found/i);
    });

    it('loads a JSON config file', () => {
      const tmp = tmpPath('.json');
      fs.writeFileSync(tmp, JSON.stringify({ name: 'JSONApp', port: 4000 }), 'utf8');
      try {
        const config = loadConfig(tmp);
        assert.strictEqual(config.name, 'JSONApp');
        assert.strictEqual(config.port, 4000);
      } finally {
        fs.unlinkSync(tmp);
      }
    });

    it('loads a JSON5 config file', () => {
      const tmp = tmpPath('.json5');
      fs.writeFileSync(tmp, '{\n  // App name\n  name: "JSON5App",\n  port: 5000,\n}\n', 'utf8');
      try {
        const config = loadConfig(tmp);
        assert.strictEqual(config.name, 'JSON5App');
        assert.strictEqual(config.port, 5000);
      } finally {
        fs.unlinkSync(tmp);
      }
    });

    it('loads a .config.js config file', () => {
      const tmp = path.join(os.tmpdir(), `chadstart-cl-${Date.now()}.config.js`);
      fs.writeFileSync(tmp, 'module.exports = { name: "JSConfig", port: 6000 };\n', 'utf8');
      try {
        const config = loadConfig(tmp);
        assert.strictEqual(config.name, 'JSConfig');
        assert.strictEqual(config.port, 6000);
      } finally {
        fs.unlinkSync(tmp);
        try { delete require.cache[require.resolve(tmp)]; } catch { /* */ }
      }
    });

    it('loads a YAML (.yml) config file', () => {
      const tmp = tmpPath('.yml');
      fs.writeFileSync(tmp, 'name: YMLApp\nport: 7000\n', 'utf8');
      try {
        const config = loadConfig(tmp);
        assert.strictEqual(config.name, 'YMLApp');
        assert.strictEqual(config.port, 7000);
      } finally {
        fs.unlinkSync(tmp);
      }
    });
  });

  // ── saveConfig ───────────────────────────────────────────────────────────
  describe('saveConfig', () => {
    it('saves and round-trips a YAML file', () => {
      const tmp = tmpPath('.yaml');
      try {
        saveConfig(tmp, { name: 'SaveYAML', port: 3000 });
        const config = loadConfig(tmp);
        assert.strictEqual(config.name, 'SaveYAML');
        assert.strictEqual(config.port, 3000);
      } finally {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      }
    });

    it('saves and round-trips a JSON file', () => {
      const tmp = tmpPath('.json');
      try {
        saveConfig(tmp, { name: 'SaveJSON', port: 4000 });
        const raw = fs.readFileSync(tmp, 'utf8');
        assert.ok(raw.includes('"name"'), 'JSON file should contain double-quoted keys');
        const config = loadConfig(tmp);
        assert.strictEqual(config.name, 'SaveJSON');
        assert.strictEqual(config.port, 4000);
      } finally {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      }
    });

    it('saves and round-trips a JSON5 file', () => {
      const tmp = tmpPath('.json5');
      try {
        saveConfig(tmp, { name: 'SaveJSON5', port: 5000 });
        const config = loadConfig(tmp);
        assert.strictEqual(config.name, 'SaveJSON5');
        assert.strictEqual(config.port, 5000);
      } finally {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      }
    });

    it('throws for read-only formats (js)', () => {
      const tmp = path.join(os.tmpdir(), `chadstart-cl-${Date.now()}.config.js`);
      assert.throws(
        () => saveConfig(tmp, { name: 'Nope' }),
        /read-only/i,
      );
    });

    it('throws for read-only formats (jsonnet)', () => {
      const tmp = tmpPath('.jsonnet');
      assert.throws(
        () => saveConfig(tmp, { name: 'Nope' }),
        /read-only/i,
      );
    });

    it('preserves YAML comments in unchanged sections', () => {
      const tmp = tmpPath('.yaml');
      try {
        fs.writeFileSync(tmp, '# App name\nname: Blog\n\n# Port\nport: 3000\n', 'utf8');
        saveConfig(tmp, { name: 'Blog', port: 4000 });
        const raw = fs.readFileSync(tmp, 'utf8');
        assert.ok(raw.includes('# App name'), 'Comment on name should be preserved');
        assert.ok(raw.includes('# Port'), 'Comment on port should be preserved');
        const config = loadConfig(tmp);
        assert.strictEqual(config.port, 4000);
      } finally {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      }
    });
  });

  // ── parseRaw ─────────────────────────────────────────────────────────────
  describe('parseRaw', () => {
    it('parses raw YAML', () => {
      const obj = parseRaw('name: Test\nport: 3000\n', 'yaml');
      assert.strictEqual(obj.name, 'Test');
    });

    it('parses raw JSON', () => {
      const obj = parseRaw('{"name":"Test","port":3000}', 'json');
      assert.strictEqual(obj.name, 'Test');
    });

    it('parses raw JSON5', () => {
      const obj = parseRaw('{name:"Test",port:3000}', 'json5');
      assert.strictEqual(obj.name, 'Test');
    });

    it('defaults to YAML for unknown format', () => {
      const obj = parseRaw('name: Fallback\n', 'unknown');
      assert.strictEqual(obj.name, 'Fallback');
    });
  });

  // ── CONFIG_FILENAMES ─────────────────────────────────────────────────────
  describe('CONFIG_FILENAMES', () => {
    it('includes yaml, yml, json, json5, jsonnet, and js formats', () => {
      assert.ok(CONFIG_FILENAMES.includes('chadstart.yaml'));
      assert.ok(CONFIG_FILENAMES.includes('chadstart.yml'));
      assert.ok(CONFIG_FILENAMES.includes('chadstart.json'));
      assert.ok(CONFIG_FILENAMES.includes('chadstart.json5'));
      assert.ok(CONFIG_FILENAMES.includes('chadstart.jsonnet'));
      assert.ok(CONFIG_FILENAMES.includes('chadstart.config.js'));
      assert.ok(CONFIG_FILENAMES.includes('chadstart.config.cjs'));
    });
  });
});
