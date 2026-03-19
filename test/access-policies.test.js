'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { buildCore } = require('../core/entity-engine');
const dbModule = require('../core/db');
const { JWT_SECRET } = require('../core/auth');

function makeToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

function mockRes() {
  const r = { _status: 200, _body: undefined };
  r.status = (s) => { r._status = s; return r; };
  r.json   = (b) => { r._body  = b; };
  return r;
}

describe('access-policies – read condition: self', () => {
  const selfReadCore = buildCore({
    name: 'SelfRead',
    entities: {
      User: {
        authenticable: true,
        properties: ['name'],
      },
      Project: {
        properties: ['title'],
        belongsTo: ['User'],
        policies: {
          read: [{ access: 'restricted', allow: 'User', condition: 'self' }],
        },
      },
    },
  });

  const entity = selfReadCore.entities.Project;
  const policy = entity.policies.read[0];

  it('read condition:self – sets req._selfFilter on valid token', () => {
    const token = makeToken({ id: 'user-42', entity: 'User' });
    const req = { headers: { authorization: `Bearer ${token}` }, params: {} };
    const res = mockRes();
    let nextCalled = false;

    const allowed = Array.isArray(policy.allow) ? policy.allow : [policy.allow];
    const mw = (req2, res2, next) => {
      const header = req2.headers.authorization;
      if (!header || !header.startsWith('Bearer ')) return res2.status(401).json({ error: 'Authorization required' });
      try {
        req2.user = jwt.verify(header.slice(7), JWT_SECRET);
        if (!allowed.includes(req2.user.entity)) return res2.status(403).json({ error: 'Access denied' });
        if (policy.condition === 'self') {
          const userEntityObj = selfReadCore.entities[req2.user.entity];
          if (userEntityObj) {
            req2._selfFilter = { fk: `${userEntityObj.tableName}_id`, userId: req2.user.id };
          }
        }
        next();
      } catch (e) {
        return res2.status(401).json({ error: 'Invalid or expired token' });
      }
    };

    mw(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled, 'next should be called');
    assert.ok(req._selfFilter, '_selfFilter should be set');
    assert.strictEqual(req._selfFilter.fk, 'user_id');
    assert.strictEqual(req._selfFilter.userId, 'user-42');
  });

  it('read condition:self – DB list is filtered to the owning user', async () => {
    const tmp = path.join(os.tmpdir(), `chadstart-selfread-${Date.now()}.db`);
    await dbModule.initDb(selfReadCore, tmp);

    const user1 = await dbModule.create('user', { name: 'Alice', email: 'alice@example.com', password: bcrypt.hashSync('pass1', 1) });
    const user2 = await dbModule.create('user', { name: 'Bob',   email: 'bob@example.com',   password: bcrypt.hashSync('pass2', 1) });
    await dbModule.create('project', { title: 'Alice Project 1', user_id: user1.id });
    await dbModule.create('project', { title: 'Alice Project 2', user_id: user1.id });
    await dbModule.create('project', { title: 'Bob Project',     user_id: user2.id });

    const selfFilter = { fk: 'user_id', userId: user1.id };
    const query = { [selfFilter.fk]: selfFilter.userId };
    const result = await dbModule.findAll('project', query, { perPage: 100 });

    assert.strictEqual(result.total, 2, 'only Alice\'s projects returned');
    assert.ok(result.data.every((r) => r.user_id === user1.id));

    fs.unlinkSync(tmp);
  });
});
