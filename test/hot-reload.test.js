'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { buildApp } = require('../server/express-server');
const { signToken } = require('../core/auth');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpYaml(name, obj) {
  const YAML = require('yaml');
  const file = path.join(os.tmpdir(), `cs-hr-${name}-${Date.now()}.yaml`);
  fs.writeFileSync(file, YAML.stringify(obj), 'utf8');
  return file;
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const body = await res.json();
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------

describe('hot-reload', () => {
  let yamlFile, server, port, reloadFn;

  const baseConfig = {
    name: 'HotReloadTest',
    entities: {
      Admin: { authenticable: true, properties: ['name'] },
      Post:  { properties: ['title'] },
    },
  };

  before(async () => {
    yamlFile = tmpYaml('base', baseConfig);

    let currentApp = null;
    const dispatcher = (req, res) => currentApp(req, res);
    server = http.createServer(dispatcher);

    async function reload() {
      const result = await buildApp(yamlFile, reload);
      currentApp = result.app;
      return result;
    }
    reloadFn = reload;

    await reload();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (fs.existsSync(yamlFile)) fs.unlinkSync(yamlFile);
  });

  it('server starts and /health reflects the initial config', async () => {
    const { status, body } = await jsonFetch(`http://127.0.0.1:${port}/health`);
    assert.strictEqual(status, 200);
    assert.strictEqual(body.name, 'HotReloadTest');
  });

  it('/admin/schema lists initial entities', async () => {
    const { status, body } = await jsonFetch(`http://127.0.0.1:${port}/admin/schema`);
    assert.strictEqual(status, 200);
    const names = body.entities.map((e) => e.name);
    assert.ok(names.includes('Admin'));
    assert.ok(names.includes('Post'));
  });

  it('hot reload swaps app — new entity appears after reload', async () => {
    // Write updated config with an extra entity
    const YAML = require('yaml');
    const updated = {
      ...baseConfig,
      name: 'HotReloadTest',
      entities: {
        ...baseConfig.entities,
        Comment: { properties: ['text'] },
      },
    };
    fs.writeFileSync(yamlFile, YAML.stringify(updated), 'utf8');

    // Trigger reload
    await reloadFn();

    // Schema must now include Comment
    const { status, body } = await jsonFetch(`http://127.0.0.1:${port}/admin/schema`);
    assert.strictEqual(status, 200);
    const names = body.entities.map((e) => e.name);
    assert.ok(names.includes('Comment'), 'Comment entity should appear after reload');
  });

  it('PUT /admin/config returns reloading:true when reloadFn is provided', async () => {
    const token = signToken({ id: 'test', entity: 'Admin' });
    const newConfig = { ...baseConfig, name: 'Reloaded' };

    const { status, body } = await jsonFetch(`http://127.0.0.1:${port}/admin/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(newConfig),
    });

    assert.strictEqual(status, 200);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.reloading, true);
  });

  it('server is still responsive during and after reload', async () => {
    // Reload a few times and confirm the server stays up
    for (let i = 0; i < 3; i++) {
      const YAML = require('yaml');
      const cfg = { ...baseConfig, name: `Reload-${i}` };
      fs.writeFileSync(yamlFile, YAML.stringify(cfg), 'utf8');
      await reloadFn();
    }
    const { status } = await jsonFetch(`http://127.0.0.1:${port}/health`);
    assert.strictEqual(status, 200);
  });

  it('buildApp without reloadFn — PUT /admin/config returns no reloading flag', async () => {
    const yamlFile2 = tmpYaml('noreload', baseConfig);
    try {
      const { app } = await buildApp(yamlFile2, null);
      const testServer = http.createServer(app);
      await new Promise((resolve) => testServer.listen(0, '127.0.0.1', resolve));
      const p = testServer.address().port;

      const token = signToken({ id: 'test', entity: 'Admin' });
      const { status, body } = await jsonFetch(`http://127.0.0.1:${p}/admin/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(baseConfig),
      });

      assert.strictEqual(status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.reloading, undefined, 'reloading flag should not be set when no reloadFn');

      await new Promise((resolve) => testServer.close(resolve));
    } finally {
      if (fs.existsSync(yamlFile2)) fs.unlinkSync(yamlFile2);
    }
  });
});
