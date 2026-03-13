/**
 * SDK unit tests — runs without a live server.
 * Uses Node.js built-in assert and a mock fetch implementation.
 */

'use strict';

const assert = require('node:assert/strict');

// ── Inject a mock global fetch before loading the CJS build ──────────────────
const calls = [];

function mockFetch(url, options) {
  calls.push({ url, options });
  const lastMock = mockFetch._queue.shift();
  if (!lastMock) throw new Error(`Unexpected fetch call to ${url}`);
  return Promise.resolve({
    ok: lastMock.ok !== false,
    status: lastMock.status || 200,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(lastMock.body),
    text: () => Promise.resolve(JSON.stringify(lastMock.body)),
  });
}
mockFetch._queue = [];

global.fetch = mockFetch;

const Chadstart = require('../dist/index.cjs');
const { ChadstartError, CollectionQuery, SingleQuery, AuthQuery } = require('../dist/index.cjs');

function enqueue(body, ok = true, status = 200) {
  mockFetch._queue.push({ body, ok, status });
}

async function run() {
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    calls.length = 0;
    mockFetch._queue.length = 0;
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
      failed++;
    }
  }

  console.log('\nChadstart SDK tests\n');

  // ── Constructor ──────────────────────────────────────────────────────────────
  await test('default baseUrl is http://localhost:3000', () => {
    const c = new Chadstart();
    assert.equal(c._baseUrl, 'http://localhost:3000');
  });

  await test('custom baseUrl strips trailing slash', () => {
    const c = new Chadstart('http://example.com/');
    assert.equal(c._baseUrl, 'http://example.com');
  });

  // ── from() returns CollectionQuery ────────────────────────────────────────────
  await test('from() returns a CollectionQuery', () => {
    const c = new Chadstart();
    assert.ok(c.from('posts') instanceof CollectionQuery);
  });

  await test('single() returns a SingleQuery', () => {
    const c = new Chadstart();
    assert.ok(c.single('homepage') instanceof SingleQuery);
  });

  await test('auth() returns an AuthQuery', () => {
    const c = new Chadstart();
    assert.ok(c.auth('customers') instanceof AuthQuery);
  });

  // ── Token management ──────────────────────────────────────────────────────────
  await test('setToken / clearToken', () => {
    const c = new Chadstart();
    c.setToken('abc123');
    assert.equal(c._token, 'abc123');
    c.clearToken();
    assert.equal(c._token, null);
  });

  // ── Collections — find() ──────────────────────────────────────────────────────
  await test('find() calls GET /api/collections/:slug', async () => {
    const c = new Chadstart('http://test');
    const fakeResult = { data: [{ id: '1', title: 'Hello' }], total: 1, currentPage: 1, lastPage: 1, from: 1, to: 1, perPage: 10 };
    enqueue(fakeResult);
    const result = await c.from('posts').find();
    assert.deepEqual(result, fakeResult);
    assert.equal(calls[0].url, 'http://test/api/collections/posts');
    assert.equal(calls[0].options.method, 'GET');
  });

  await test('find() appends page and perPage params', async () => {
    const c = new Chadstart('http://test');
    enqueue({ data: [] });
    await c.from('posts').find({ page: 2, perPage: 20 });
    assert.ok(calls[0].url.includes('page=2'));
    assert.ok(calls[0].url.includes('perPage=20'));
  });

  await test('where() with = builds _eq filter', async () => {
    const c = new Chadstart('http://test');
    enqueue({ data: [] });
    await c.from('posts').where('published = true').find();
    assert.ok(calls[0].url.includes('published_eq=true'), calls[0].url);
  });

  await test('where() with != builds _neq filter', async () => {
    const c = new Chadstart('http://test');
    enqueue({ data: [] });
    await c.from('posts').where('status != draft').find();
    assert.ok(calls[0].url.includes('status_neq=draft'), calls[0].url);
  });

  await test('where() with >= builds _gte filter', async () => {
    const c = new Chadstart('http://test');
    enqueue({ data: [] });
    await c.from('products').where('price >= 10').find();
    assert.ok(calls[0].url.includes('price_gte=10'), calls[0].url);
  });

  await test('where() with <= builds _lte filter', async () => {
    const c = new Chadstart('http://test');
    enqueue({ data: [] });
    await c.from('products').where('price <= 100').find();
    assert.ok(calls[0].url.includes('price_lte=100'), calls[0].url);
  });

  await test('where() with > builds _gt filter', async () => {
    const c = new Chadstart('http://test');
    enqueue({ data: [] });
    await c.from('products').where('stock > 0').find();
    assert.ok(calls[0].url.includes('stock_gt=0'), calls[0].url);
  });

  await test('where() with < builds _lt filter', async () => {
    const c = new Chadstart('http://test');
    enqueue({ data: [] });
    await c.from('products').where('stock < 5').find();
    assert.ok(calls[0].url.includes('stock_lt=5'), calls[0].url);
  });

  await test('where() with like builds _like filter', async () => {
    const c = new Chadstart('http://test');
    enqueue({ data: [] });
    await c.from('posts').where('title like %hello%').find();
    assert.ok(calls[0].url.includes('title_like='), calls[0].url);
  });

  await test('andWhere() chains multiple filters', async () => {
    const c = new Chadstart('http://test');
    enqueue({ data: [] });
    await c.from('posts').where('published = true').andWhere('status != draft').find();
    assert.ok(calls[0].url.includes('published_eq=true'));
    assert.ok(calls[0].url.includes('status_neq=draft'));
  });

  await test('orderBy() adds orderBy and order params', async () => {
    const c = new Chadstart('http://test');
    enqueue({ data: [] });
    await c.from('posts').orderBy('createdAt', { desc: true }).find();
    assert.ok(calls[0].url.includes('orderBy=createdAt'));
    assert.ok(calls[0].url.includes('order=DESC'));
  });

  await test('orderBy() defaults to ASC', async () => {
    const c = new Chadstart('http://test');
    enqueue({ data: [] });
    await c.from('posts').orderBy('title').find();
    assert.ok(calls[0].url.includes('order=ASC'));
  });

  await test('with() adds relations param', async () => {
    const c = new Chadstart('http://test');
    enqueue({ data: [] });
    await c.from('posts').with(['author', 'tags']).find();
    assert.ok(calls[0].url.includes('relations=author%2Ctags') || calls[0].url.includes('relations=author,tags'), calls[0].url);
  });

  // ── findOneById() ─────────────────────────────────────────────────────────────
  await test('findOneById() calls GET /api/collections/:slug/:id', async () => {
    const c = new Chadstart('http://test');
    enqueue({ id: '1', title: 'Hello' });
    await c.from('posts').findOneById('1');
    assert.equal(calls[0].url, 'http://test/api/collections/posts/1');
    assert.equal(calls[0].options.method, 'GET');
  });

  await test('findOneById() with relations appends relations param', async () => {
    const c = new Chadstart('http://test');
    enqueue({ id: '1' });
    await c.from('posts').with(['author']).findOneById('1');
    assert.ok(calls[0].url.includes('relations=author'), calls[0].url);
  });

  // ── create() ─────────────────────────────────────────────────────────────────
  await test('create() calls POST /api/collections/:slug with body', async () => {
    const c = new Chadstart('http://test');
    enqueue({ id: '1', title: 'Hello' });
    await c.from('posts').create({ title: 'Hello' });
    assert.equal(calls[0].url, 'http://test/api/collections/posts');
    assert.equal(calls[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].options.body), { title: 'Hello' });
  });

  // ── update() ─────────────────────────────────────────────────────────────────
  await test('update() calls PUT /api/collections/:slug/:id', async () => {
    const c = new Chadstart('http://test');
    enqueue({ id: '1', title: 'World' });
    await c.from('posts').update('1', { title: 'World' });
    assert.equal(calls[0].url, 'http://test/api/collections/posts/1');
    assert.equal(calls[0].options.method, 'PUT');
  });

  // ── patch() ──────────────────────────────────────────────────────────────────
  await test('patch() calls PATCH /api/collections/:slug/:id', async () => {
    const c = new Chadstart('http://test');
    enqueue({ id: '1', title: 'World' });
    await c.from('posts').patch('1', { title: 'World' });
    assert.equal(calls[0].url, 'http://test/api/collections/posts/1');
    assert.equal(calls[0].options.method, 'PATCH');
  });

  // ── delete() ─────────────────────────────────────────────────────────────────
  await test('delete() calls DELETE /api/collections/:slug/:id', async () => {
    const c = new Chadstart('http://test');
    enqueue({ id: '1' });
    await c.from('posts').delete('1');
    assert.equal(calls[0].url, 'http://test/api/collections/posts/1');
    assert.equal(calls[0].options.method, 'DELETE');
  });

  // ── Singles ───────────────────────────────────────────────────────────────────
  await test('single().get() calls GET /api/singles/:slug', async () => {
    const c = new Chadstart('http://test');
    enqueue({ title: 'Welcome' });
    await c.single('homepage').get();
    assert.equal(calls[0].url, 'http://test/api/singles/homepage');
    assert.equal(calls[0].options.method, 'GET');
  });

  await test('single().update() calls PUT /api/singles/:slug', async () => {
    const c = new Chadstart('http://test');
    enqueue({ title: 'New title' });
    await c.single('homepage').update({ title: 'New title' });
    assert.equal(calls[0].options.method, 'PUT');
    assert.ok(calls[0].url.includes('/api/singles/homepage'));
  });

  await test('single().patch() calls PATCH /api/singles/:slug', async () => {
    const c = new Chadstart('http://test');
    enqueue({ title: 'New title' });
    await c.single('homepage').patch({ title: 'New title' });
    assert.equal(calls[0].options.method, 'PATCH');
  });

  // ── Auth ─────────────────────────────────────────────────────────────────────
  await test('auth().signup() calls POST /api/auth/:slug/signup', async () => {
    const c = new Chadstart('http://test');
    enqueue({ token: 'tok123', user: { id: '1', email: 'a@b.com' } });
    const result = await c.auth('customers').signup({ email: 'a@b.com', password: 'pass' });
    assert.equal(calls[0].url, 'http://test/api/auth/customers/signup');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(result.token, 'tok123');
    // Token should be stored automatically
    assert.equal(c._token, 'tok123');
  });

  await test('auth().login() calls POST /api/auth/:slug/login', async () => {
    const c = new Chadstart('http://test');
    enqueue({ token: 'tok456', user: { id: '2', email: 'x@y.com' } });
    const result = await c.auth('customers').login({ email: 'x@y.com', password: 'pass' });
    assert.equal(calls[0].url, 'http://test/api/auth/customers/login');
    assert.equal(result.token, 'tok456');
    assert.equal(c._token, 'tok456');
  });

  await test('auth().me() calls GET /api/auth/:slug/me', async () => {
    const c = new Chadstart('http://test');
    c.setToken('tok789');
    enqueue({ id: '1', email: 'a@b.com' });
    await c.auth('customers').me();
    assert.equal(calls[0].url, 'http://test/api/auth/customers/me');
    assert.equal(calls[0].options.method, 'GET');
    assert.ok(calls[0].options.headers['Authorization'] === 'Bearer tok789');
  });

  await test('auth().logout() clears the token', () => {
    const c = new Chadstart('http://test');
    c.setToken('tok');
    c.auth('customers').logout();
    assert.equal(c._token, null);
  });

  // ── Authorization header ──────────────────────────────────────────────────────
  await test('requests include Authorization header when token is set', async () => {
    const c = new Chadstart('http://test');
    c.setToken('mytoken');
    enqueue({ data: [] });
    await c.from('posts').find();
    assert.equal(calls[0].options.headers['Authorization'], 'Bearer mytoken');
  });

  await test('requests omit Authorization header when no token', async () => {
    const c = new Chadstart('http://test');
    enqueue({ data: [] });
    await c.from('posts').find();
    assert.equal(calls[0].options.headers['Authorization'], undefined);
  });

  // ── Error handling ────────────────────────────────────────────────────────────
  await test('throws ChadstartError on non-2xx response', async () => {
    const c = new Chadstart('http://test');
    enqueue({ error: 'Not found' }, false, 404);
    try {
      await c.from('posts').findOneById('missing');
      assert.fail('Expected error');
    } catch (err) {
      assert.ok(err instanceof ChadstartError);
      assert.equal(err.status, 404);
      assert.equal(err.message, 'Not found');
    }
  });

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => { console.error(err); process.exit(1); });
