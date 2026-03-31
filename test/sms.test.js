'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

describe('Phone/SMS Authentication (G10)', () => {
  describe('entity-engine: phoneAuth flag', () => {
    const { buildCore } = require('../core/entity-engine');

    it('defaults phoneAuth to false', () => {
      const core = buildCore({ name: 'T', entities: { User: { authenticable: true } } });
      assert.strictEqual(core.entities.User.phoneAuth, false);
    });

    it('sets phoneAuth to true when specified', () => {
      const core = buildCore({ name: 'T', entities: { User: { authenticable: true, phoneAuth: true } } });
      assert.strictEqual(core.entities.User.phoneAuth, true);
    });

    it('passes sms config to core', () => {
      const core = buildCore({ name: 'T', sms: { provider: 'twilio' } });
      assert.deepStrictEqual(core.sms, { provider: 'twilio' });
    });

    it('sms defaults to null', () => {
      const core = buildCore({ name: 'T' });
      assert.strictEqual(core.sms, null);
    });
  });

  describe('sms module', () => {
    const sms = require('../core/sms');

    it('getSmsStatus returns not configured when not initialized', () => {
      sms.initSms(null);
      assert.deepStrictEqual(sms.getSmsStatus(), { configured: false });
    });

    it('getSmsStatus returns configured after init', () => {
      sms.initSms({ provider: 'twilio' });
      assert.deepStrictEqual(sms.getSmsStatus(), { configured: true, provider: 'twilio' });
    });

    it('sendSms throws when not configured', async () => {
      sms.initSms(null);
      await assert.rejects(() => sms.sendSms('+1234567890', 'test'), { message: 'SMS service not configured' });
    });
  });

  describe('omitPassword strips phone fields', () => {
    const { omitPassword } = require('../core/auth');

    it('strips phoneVerificationCode and phoneVerificationExpiry', () => {
      const user = {
        id: '1', email: 'a@b.com', password: 'x',
        phoneNumber: '+1234567890',
        phoneVerificationCode: '123456',
        phoneVerificationExpiry: '2099-01-01T00:00:00Z',
      };
      const safe = omitPassword(user);
      assert.strictEqual(safe.password, undefined);
      assert.strictEqual(safe.phoneVerificationCode, undefined);
      assert.strictEqual(safe.phoneVerificationExpiry, undefined);
      assert.strictEqual(safe.phoneNumber, '+1234567890');
    });
  });

  describe('DB: phoneAuth columns', () => {
    const db = require('../core/db');
    const { buildCore } = require('../core/entity-engine');
    const tmpDb = path.join('/tmp', `chadstart-phone-${Date.now()}.db`);

    after(async () => {
      await db.closeDb();
      try { fs.unlinkSync(tmpDb); } catch { /* ignore */ }
    });

    it('creates phoneNumber, phoneVerificationCode, phoneVerificationExpiry columns', async () => {
      const core = buildCore({
        name: 'PhoneTest',
        database: tmpDb,
        entities: { PhoneUser: { authenticable: true, phoneAuth: true } },
      });
      await db.initDb(core);
      await db.syncSchema(core);

      const user = await db.create('phone_user', {
        email: 'phone@test.com',
        password: 'hashed',
        phoneNumber: '+1234567890',
        phoneVerificationCode: '123456',
        phoneVerificationExpiry: '2099-01-01T00:00:00Z',
      });
      assert.strictEqual(user.phoneNumber, '+1234567890');
      assert.strictEqual(user.phoneVerificationCode, '123456');
      assert.strictEqual(user.phoneVerificationExpiry, '2099-01-01T00:00:00Z');
    });
  });

  describe('Integration: phone auth flow', () => {
    const http = require('http');
    const express = require('express');
    const db = require('../core/db');
    const { buildCore } = require('../core/entity-engine');
    const { registerAuthRoutes } = require('../core/auth');
    const tmpDb = path.join('/tmp', `chadstart-phone-flow-${Date.now()}.db`);
    let app, core;

    before(async () => {
      core = buildCore({
        name: 'PhoneFlowTest',
        database: tmpDb,
        entities: { PhoneUser: { authenticable: true, phoneAuth: true } },
      });
      await db.initDb(core);
      await db.syncSchema(core);
      app = express();
      app.use(express.json());
      registerAuthRoutes(app, core, () => {});
    });

    after(async () => {
      await db.closeDb();
      try { fs.unlinkSync(tmpDb); } catch { /* ignore */ }
    });

    function makeReq(method, url, body) {
      return new Promise((resolve) => {
        const server = http.createServer(app);
        server.listen(0, () => {
          const port = server.address().port;
          const options = {
            hostname: '127.0.0.1', port, path: url, method: method.toUpperCase(),
            headers: { 'Content-Type': 'application/json' },
          };
          const r = http.request(options, (res) => {
            let data = '';
            res.on('data', (d) => { data += d; });
            res.on('end', () => {
              server.close();
              let parsed;
              try { parsed = JSON.parse(data); } catch { parsed = data; }
              resolve({ status: res.statusCode, body: parsed });
            });
          });
          if (body) r.write(JSON.stringify(body));
          r.end();
        });
      });
    }

    it('send-code creates user and stores code', async () => {
      const res = await makeReq('POST', '/api/auth/phone-user/phone/send-code', { phone: '+15551234567' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.message, 'Verification code sent');

      const users = await db.findAllSimple('phone_user', { phoneNumber: '+15551234567' });
      assert.strictEqual(users.length, 1);
      assert.strictEqual(typeof users[0].phoneVerificationCode, 'string');
      assert.strictEqual(users[0].phoneVerificationCode.length, 6);
    });

    it('send-code returns 400 without phone', async () => {
      const res = await makeReq('POST', '/api/auth/phone-user/phone/send-code', {});
      assert.strictEqual(res.status, 400);
    });

    it('verify succeeds with correct code', async () => {
      await makeReq('POST', '/api/auth/phone-user/phone/send-code', { phone: '+15559876543' });
      const users = await db.findAllSimple('phone_user', { phoneNumber: '+15559876543' });
      const code = users[0].phoneVerificationCode;

      const res = await makeReq('POST', '/api/auth/phone-user/phone/verify', { phone: '+15559876543', code });
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.token);
      assert.ok(res.body.user);
      assert.strictEqual(res.body.user.phoneVerificationCode, undefined);
    });

    it('verify fails with wrong code', async () => {
      await makeReq('POST', '/api/auth/phone-user/phone/send-code', { phone: '+15550000000' });
      const res = await makeReq('POST', '/api/auth/phone-user/phone/verify', { phone: '+15550000000', code: '000000' });
      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('Invalid'));
    });

    it('verify fails with expired code', async () => {
      await makeReq('POST', '/api/auth/phone-user/phone/send-code', { phone: '+15551111111' });
      const users = await db.findAllSimple('phone_user', { phoneNumber: '+15551111111' });
      const code = users[0].phoneVerificationCode;

      await db.update('phone_user', users[0].id, {
        phoneVerificationExpiry: new Date(Date.now() - 1000).toISOString(),
      });

      const res = await makeReq('POST', '/api/auth/phone-user/phone/verify', { phone: '+15551111111', code });
      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('expired'));
    });

    it('verify returns 400 without phone or code', async () => {
      const res = await makeReq('POST', '/api/auth/phone-user/phone/verify', { phone: '+15551234567' });
      assert.strictEqual(res.status, 400);
    });
  });
});
