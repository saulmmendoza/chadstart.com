'use strict';

const assert = require('assert');
const { signToken, verifyToken, omitPassword, requireAuth, optionalAuth } = require('../core/auth');

function mockReq(headers = {}) {
  return { headers, user: undefined };
}

function mockRes() {
  const r = { _status: 200, _body: undefined };
  r.status = (s) => { r._status = s; return r; };
  r.json   = (b) => { r._body  = b; };
  return r;
}

describe('auth', () => {
  it('signToken/verifyToken round-trip', () => {
    const t = signToken({ id: 1, entity: 'Admin' });
    const d = verifyToken(t);
    assert.strictEqual(d.id, 1);
    assert.strictEqual(d.entity, 'Admin');
  });

  it('verifyToken throws on invalid', () => assert.throws(() => verifyToken('bad'), /malformed|invalid/i));
  it('omitPassword removes password', () => assert.ok(!('password' in omitPassword({ id: 1, password: 'x', email: 'a@b.com' }))));
});

describe('auth – middleware', () => {
  it('requireAuth: 401 when no Authorization header', () => {
    const mw  = requireAuth();
    const req = mockReq();
    const res = mockRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    assert.strictEqual(res._status, 401);
    assert.ok(!nextCalled);
  });

  it('requireAuth: 401 when header lacks Bearer prefix', () => {
    const mw  = requireAuth();
    const req = mockReq({ authorization: 'Basic abc123' });
    const res = mockRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    assert.strictEqual(res._status, 401);
    assert.ok(!nextCalled);
  });

  it('requireAuth: 401 for invalid token', () => {
    const mw  = requireAuth();
    const req = mockReq({ authorization: 'Bearer not-a-valid-jwt' });
    const res = mockRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    assert.strictEqual(res._status, 401);
    assert.ok(!nextCalled);
  });

  it('requireAuth: 403 when entity does not match', () => {
    const token = signToken({ id: 'u1', entity: 'Admin' });
    const mw    = requireAuth('User');
    const req   = mockReq({ authorization: `Bearer ${token}` });
    const res   = mockRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    assert.strictEqual(res._status, 403);
    assert.ok(!nextCalled);
  });

  it('requireAuth: sets req.user and calls next for valid token (with entity filter)', () => {
    const token = signToken({ id: 'u2', entity: 'Admin' });
    const mw    = requireAuth('Admin');
    const req   = mockReq({ authorization: `Bearer ${token}` });
    const res   = mockRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
    assert.strictEqual(req.user.id, 'u2');
    assert.strictEqual(req.user.entity, 'Admin');
  });

  it('requireAuth: sets req.user and calls next without entity filter', () => {
    const token = signToken({ id: 'u3', entity: 'Member' });
    const mw    = requireAuth();
    const req   = mockReq({ authorization: `Bearer ${token}` });
    const res   = mockRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
    assert.strictEqual(req.user.entity, 'Member');
  });

  it('optionalAuth: calls next without user when no header', () => {
    const req = mockReq();
    const res = mockRes();
    let nextCalled = false;
    optionalAuth(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
    assert.ok(!req.user);
  });

  it('optionalAuth: calls next without user when token is invalid', () => {
    const req = mockReq({ authorization: 'Bearer bad-token' });
    const res = mockRes();
    let nextCalled = false;
    optionalAuth(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
    assert.ok(!req.user);
  });

  it('optionalAuth: sets req.user when token is valid', () => {
    const token = signToken({ id: 'u4', entity: 'Guest' });
    const req   = mockReq({ authorization: `Bearer ${token}` });
    const res   = mockRes();
    let nextCalled = false;
    optionalAuth(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
    assert.strictEqual(req.user.id, 'u4');
    assert.strictEqual(req.user.entity, 'Guest');
  });
});
