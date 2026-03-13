'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const express = require('express');
const { buildCore } = require('../core/entity-engine');
const dbModule = require('../core/db');
const { registerApiRoutes } = require('../core/api-generator');
const { signToken } = require('../core/auth');

describe('runMiddlewares – SDK injection', () => {
  let testServer, port, handlersDir, tmp;
  const mwCore = buildCore({
    name: 'MwTest',
    entities: {
      Item: {
        properties: ['name'],
        middlewares: { beforeCreate: [{ handler: 'testMwHandler' }] },
      },
    },
  });

  before(async () => {
    tmp = path.join(os.tmpdir(), `chadstart-mw-${Date.now()}.db`);
    dbModule.initDb(mwCore, tmp);

    handlersDir = path.join(os.tmpdir(), `chadstart-handlers-${Date.now()}`);
    fs.mkdirSync(handlersDir, { recursive: true });
    const handlerPath = path.join(handlersDir, 'testMwHandler.js');
    fs.writeFileSync(handlerPath, `
      module.exports = async (req, res, chadstart) => {
        req.app._lastSdkArg = chadstart;
      };
    `);

    process.env.CHADSTART_HANDLERS_FOLDER = handlersDir;
    delete require.cache[require.resolve(handlerPath)];

    const testApp = express();
    testApp.use(express.json());
    registerApiRoutes(testApp, mwCore, () => {});
    testApp.get('/_inspect', (req, res) => res.json({ hasSdk: req.app._lastSdkArg != null }));

    testServer = http.createServer(testApp);
    await new Promise((resolve) => testServer.listen(0, resolve));
    port = testServer.address().port;
  });

  after(async () => {
    await new Promise((resolve) => testServer.close(resolve));
    delete process.env.CHADSTART_HANDLERS_FOLDER;
    fs.rmSync(handlersDir, { recursive: true, force: true });
    fs.unlinkSync(tmp);
  });

  it('middleware handler receives (req, res, chadstart) – sdk is passed', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/collections/item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken({ id: 'a1', entity: 'Admin' })}` },
      body: JSON.stringify({ name: 'Widget' }),
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.name, 'Widget');

    const inspect = await fetch(`http://127.0.0.1:${port}/_inspect`).then((r) => r.json());
    assert.strictEqual(inspect.hasSdk, true, 'chadstart SDK should be passed to middleware handlers');
  });

  it('CHADSTART_HANDLERS_FOLDER env var is used by middleware runner', () => {
    assert.strictEqual(process.env.CHADSTART_HANDLERS_FOLDER, handlersDir);
  });

  it('CHADSTART_HANDLERS_FOLDER takes precedence over MANIFEST_HANDLERS_FOLDER', () => {
    const oldManifest = process.env.MANIFEST_HANDLERS_FOLDER;
    process.env.MANIFEST_HANDLERS_FOLDER = '/some/wrong/path';
    process.env.CHADSTART_HANDLERS_FOLDER = handlersDir;
    const resolved = process.env.CHADSTART_HANDLERS_FOLDER || process.env.MANIFEST_HANDLERS_FOLDER || 'handlers';
    assert.strictEqual(resolved, handlersDir);
    process.env.MANIFEST_HANDLERS_FOLDER = oldManifest;
  });
});
