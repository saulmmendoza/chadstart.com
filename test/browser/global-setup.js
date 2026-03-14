'use strict';

/**
 * Playwright global setup: starts a chadstart server on a random port,
 * signs up a test admin user, and writes the server URL + credentials
 * to environment so tests can use them.
 */

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const http = require('http');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-browser-test-'));
const DB_PATH = path.join(TMP_DIR, 'test.db');
const STATE_FILE = path.join(TMP_DIR, 'server-state.json');

async function httpPost(port, urlPath, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost', port, path: urlPath, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(buf); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

module.exports = async function globalSetup() {
  process.env.DB_PATH = DB_PATH;

  const { buildApp } = require('../../server/express-server');
  const YAML_PATH = path.resolve(__dirname, '../../chadstart.yaml');

  const { app } = await buildApp(YAML_PATH, null);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  // Sign up a test admin user
  const result = await httpPost(port, '/api/auth/admin/signup', {
    email: 'admin@test.com',
    password: 'testpass123',
    name: 'Test Admin',
  });
  if (!result.token) {
    throw new Error('Failed to create test admin user: ' + JSON.stringify(result));
  }

  // Persist state for teardown and tests
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    port,
    dbPath: DB_PATH,
    tmpDir: TMP_DIR,
    email: 'admin@test.com',
    password: 'testpass123',
    collectionName: 'Admin',
  }));

  process.env.TEST_BASE_URL  = `http://localhost:${port}`;
  process.env.TEST_STATE_FILE = STATE_FILE;

  // Attach server to global so teardown can close it
  global.__TEST_SERVER__ = server;
};
