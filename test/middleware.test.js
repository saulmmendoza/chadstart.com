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
  let testServer, port, functionsDir, tmp;
  const mwCore = buildCore({
    name: 'MwTest',
    entities: {
      Item: {
        properties: ['name'],
        middlewares: { beforeCreate: [{ function: 'testMwFunction' }] },
      },
    },
  });

  before(async () => {
    tmp = path.join(os.tmpdir(), `chadstart-mw-${Date.now()}.db`);
    await dbModule.initDb(mwCore, tmp);

    functionsDir = path.join(os.tmpdir(), `chadstart-functions-${Date.now()}`);
    fs.mkdirSync(functionsDir, { recursive: true });
    const functionPath = path.join(functionsDir, 'testMwFunction.js');
    fs.writeFileSync(functionPath, `
      module.exports = async (req, res, chadstart) => {
        req.app._lastSdkArg = chadstart;
      };
    `);

    process.env.CHADSTART_FUNCTIONS_FOLDER = functionsDir;
    delete require.cache[require.resolve(functionPath)];

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
    delete process.env.CHADSTART_FUNCTIONS_FOLDER;
    fs.rmSync(functionsDir, { recursive: true, force: true });
    fs.unlinkSync(tmp);
  });

  it('middleware function receives (req, res, chadstart) – sdk is passed', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/collections/item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken({ id: 'a1', entity: 'Admin' })}` },
      body: JSON.stringify({ name: 'Widget' }),
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.name, 'Widget');

    const inspect = await fetch(`http://127.0.0.1:${port}/_inspect`).then((r) => r.json());
    assert.strictEqual(inspect.hasSdk, true, 'chadstart SDK should be passed to middleware functions');
  });

  it('CHADSTART_FUNCTIONS_FOLDER env var is used by middleware runner', () => {
    assert.strictEqual(process.env.CHADSTART_FUNCTIONS_FOLDER, functionsDir);
  });
});
