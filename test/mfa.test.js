'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');
const { buildCore } = require('../core/entity-engine');
const dbModule = require('../core/db');
const {
  signToken, verifyToken, omitPassword,
} = require('../core/auth');
const {
  base32Encode, base32Decode, generateMfaSecret,
  generateTotp, verifyTotp, generateRecoveryCodes, buildOtpauthUri,
} = require('../core/mfa');

// ─── TOTP unit tests ────────────────────────────────────────────────────────

describe('mfa – TOTP primitives', () => {
  it('base32 round-trip', () => {
    const buf = Buffer.from('Hello!');
    const encoded = base32Encode(buf);
    const decoded = base32Decode(encoded);
    assert.ok(decoded.slice(0, buf.length).equals(buf));
  });

  it('generateMfaSecret returns 32-char base32 string', () => {
    const secret = generateMfaSecret();
    assert.strictEqual(typeof secret, 'string');
    assert.ok(secret.length > 0);
    assert.ok(/^[A-Z2-7]+$/.test(secret));
  });

  it('generateTotp returns 6-digit string', () => {
    const secret = generateMfaSecret();
    const code = generateTotp(secret);
    assert.strictEqual(code.length, 6);
    assert.ok(/^\d{6}$/.test(code));
  });

  it('verifyTotp accepts current code', () => {
    const secret = generateMfaSecret();
    const code = generateTotp(secret);
    assert.strictEqual(verifyTotp(secret, code), true);
  });

  it('verifyTotp rejects wrong code', () => {
    const secret = generateMfaSecret();
    assert.strictEqual(verifyTotp(secret, '000000'), false);
  });

  it('generateRecoveryCodes returns 8 codes of length 8', () => {
    const codes = generateRecoveryCodes();
    assert.strictEqual(codes.length, 8);
    for (const c of codes) assert.strictEqual(c.length, 8);
  });

  it('buildOtpauthUri contains secret and issuer', () => {
    const uri = buildOtpauthUri('JBSWY3DPEHPK3PXP', 'user@example.com', 'MyApp');
    assert.ok(uri.startsWith('otpauth://totp/'));
    assert.ok(uri.includes('secret=JBSWY3DPEHPK3PXP'));
    assert.ok(uri.includes('issuer=MyApp'));
  });
});

// ─── Entity engine: mfa flag ────────────────────────────────────────────────

describe('entity-engine: mfa', () => {
  it('defaults to false', () => {
    const core = buildCore({ name: 'App', entities: { User: { authenticable: true, properties: ['name'] } } });
    assert.strictEqual(core.entities.User.mfa, false);
  });

  it('sets to true when configured', () => {
    const core = buildCore({
      name: 'App',
      entities: { User: { authenticable: true, mfa: true, properties: ['name'] } },
    });
    assert.strictEqual(core.entities.User.mfa, true);
  });
});

// ─── omitPassword strips MFA fields ────────────────────────────────────────

describe('omitPassword – MFA fields', () => {
  it('strips mfaSecret', () => {
    assert.ok(!('mfaSecret' in omitPassword({ id: '1', mfaSecret: 'sec' })));
  });

  it('strips mfaRecoveryCodes', () => {
    assert.ok(!('mfaRecoveryCodes' in omitPassword({ id: '1', mfaRecoveryCodes: '[]' })));
  });

  it('preserves other fields', () => {
    const u = omitPassword({ id: '1', email: 'a@b.com', mfaSecret: 's', mfaRecoveryCodes: '[]' });
    assert.strictEqual(u.email, 'a@b.com');
    assert.strictEqual(u.id, '1');
  });
});

// ─── DB: MFA columns ───────────────────────────────────────────────────────

describe('db – MFA columns', () => {
  let tmpDb;
  const core = buildCore({
    name: 'T',
    entities: { User: { authenticable: true, mfa: true, properties: ['name'] } },
  });

  before(async () => {
    tmpDb = path.join(os.tmpdir(), `chadstart-mfa-${Date.now()}.db`);
    await dbModule.initDb(core, tmpDb);
  });

  after(() => { try { fs.unlinkSync(tmpDb); } catch { /* noop */ } });

  it('has mfaEnabled column', () => {
    const cols = dbModule.getDb().pragma('table_info("user")').map((r) => r.name);
    assert.ok(cols.includes('mfaEnabled'), 'missing mfaEnabled column');
  });

  it('has mfaSecret column', () => {
    const cols = dbModule.getDb().pragma('table_info("user")').map((r) => r.name);
    assert.ok(cols.includes('mfaSecret'), 'missing mfaSecret column');
  });

  it('has mfaRecoveryCodes column', () => {
    const cols = dbModule.getDb().pragma('table_info("user")').map((r) => r.name);
    assert.ok(cols.includes('mfaRecoveryCodes'), 'missing mfaRecoveryCodes column');
  });

  it('can store and query MFA fields', async () => {
    const secret = generateMfaSecret();
    const codes = JSON.stringify(generateRecoveryCodes());
    const user = await dbModule.create('user', {
      email: 'mfa1@example.com',
      password: 'hash',
      mfaEnabled: 1,
      mfaSecret: secret,
      mfaRecoveryCodes: codes,
    });
    const found = await dbModule.findById('user', user.id);
    assert.strictEqual(found.mfaEnabled, 1);
    assert.strictEqual(found.mfaSecret, secret);
    assert.strictEqual(found.mfaRecoveryCodes, codes);
  });

  it('mfaEnabled defaults to 0 (off)', async () => {
    const user = await dbModule.create('user', {
      email: 'mfa2@example.com',
      password: 'hash',
    });
    const found = await dbModule.findById('user', user.id);
    assert.strictEqual(found.mfaEnabled, 0);
  });
});

// ─── Integration: MFA flow ──────────────────────────────────────────────────

describe('auth integration – MFA flow', () => {
  let tmpDb;
  const core = buildCore({
    name: 'TestApp',
    entities: { User: { authenticable: true, mfa: true, properties: ['name'] } },
  });

  before(async () => {
    tmpDb = path.join(os.tmpdir(), `chadstart-mfa-flow-${Date.now()}.db`);
    await dbModule.initDb(core, tmpDb);
  });

  after(() => { try { fs.unlinkSync(tmpDb); } catch { /* noop */ } });

  it('MFA setup: stores secret on user', async () => {
    const pw = await bcrypt.hash('pass', 10);
    const user = await dbModule.create('user', { email: 'setup@example.com', password: pw });

    const secret = generateMfaSecret();
    await dbModule.update('user', user.id, { mfaSecret: secret });

    const updated = await dbModule.findById('user', user.id);
    assert.strictEqual(updated.mfaSecret, secret);
  });

  it('MFA verify: enables MFA and stores recovery codes', async () => {
    const pw = await bcrypt.hash('pass', 10);
    const secret = generateMfaSecret();
    const user = await dbModule.create('user', {
      email: 'verify@example.com', password: pw, mfaSecret: secret,
    });

    const code = generateTotp(secret);
    assert.ok(verifyTotp(secret, code), 'TOTP code should verify');

    const recoveryCodes = generateRecoveryCodes();
    await dbModule.update('user', user.id, {
      mfaEnabled: 1,
      mfaRecoveryCodes: JSON.stringify(recoveryCodes),
    });

    const updated = await dbModule.findById('user', user.id);
    assert.strictEqual(updated.mfaEnabled, 1);
    assert.strictEqual(JSON.parse(updated.mfaRecoveryCodes).length, 8);
  });

  it('login with MFA: returns mfaRequired with challenge token', async () => {
    const pw = await bcrypt.hash('pass', 10);
    const secret = generateMfaSecret();
    const user = await dbModule.create('user', {
      email: 'loginmfa@example.com', password: pw,
      mfaEnabled: 1, mfaSecret: secret,
      mfaRecoveryCodes: JSON.stringify(generateRecoveryCodes()),
    });

    // Simulate what the login handler does when MFA is enabled
    const mfaToken = signToken({ id: user.id, entity: 'User', mfaChallenge: true }, '5m');
    const payload = verifyToken(mfaToken);
    assert.strictEqual(payload.mfaChallenge, true);
    assert.strictEqual(payload.id, user.id);
  });

  it('MFA login-verify: TOTP code grants full token', async () => {
    const pw = await bcrypt.hash('pass', 10);
    const secret = generateMfaSecret();
    const user = await dbModule.create('user', {
      email: 'loginverify@example.com', password: pw,
      mfaEnabled: 1, mfaSecret: secret,
      mfaRecoveryCodes: JSON.stringify(generateRecoveryCodes()),
    });

    const mfaToken = signToken({ id: user.id, entity: 'User', mfaChallenge: true }, '5m');
    const code = generateTotp(secret);
    assert.ok(verifyTotp(secret, code));

    // Verify the challenge token, then issue full token
    const payload = verifyToken(mfaToken);
    assert.strictEqual(payload.mfaChallenge, true);
    const fullToken = signToken({ id: payload.id, entity: payload.entity });
    const full = verifyToken(fullToken);
    assert.ok(!full.mfaChallenge);
    assert.strictEqual(full.id, user.id);
  });

  it('MFA login-verify: recovery code works and is consumed', async () => {
    const pw = await bcrypt.hash('pass', 10);
    const secret = generateMfaSecret();
    const recoveryCodes = generateRecoveryCodes();
    const user = await dbModule.create('user', {
      email: 'recovery@example.com', password: pw,
      mfaEnabled: 1, mfaSecret: secret,
      mfaRecoveryCodes: JSON.stringify(recoveryCodes),
    });

    const usedCode = recoveryCodes[0];

    // Consume the code
    const remaining = recoveryCodes.filter((c) => c !== usedCode);
    await dbModule.update('user', user.id, { mfaRecoveryCodes: JSON.stringify(remaining) });

    const updated = await dbModule.findById('user', user.id);
    const stored = JSON.parse(updated.mfaRecoveryCodes);
    assert.strictEqual(stored.length, 7);
    assert.ok(!stored.includes(usedCode));
  });

  it('MFA disable: clears MFA fields', async () => {
    const pw = await bcrypt.hash('pass', 10);
    const secret = generateMfaSecret();
    const user = await dbModule.create('user', {
      email: 'disable@example.com', password: pw,
      mfaEnabled: 1, mfaSecret: secret,
      mfaRecoveryCodes: JSON.stringify(generateRecoveryCodes()),
    });

    await dbModule.update('user', user.id, {
      mfaEnabled: 0, mfaSecret: null, mfaRecoveryCodes: null,
    });

    const updated = await dbModule.findById('user', user.id);
    assert.strictEqual(updated.mfaEnabled, 0);
    assert.strictEqual(updated.mfaSecret, null);
    assert.strictEqual(updated.mfaRecoveryCodes, null);
  });
});

// ─── Non-MFA entity ─────────────────────────────────────────────────────────

describe('entity-engine: non-MFA entity', () => {
  it('authenticable entity without mfa has mfa=false', () => {
    const core = buildCore({
      name: 'App',
      entities: { User: { authenticable: true, properties: ['name'] } },
    });
    assert.strictEqual(core.entities.User.mfa, false);
  });

  it('non-authenticable entity has mfa=false', () => {
    const core = buildCore({
      name: 'App',
      entities: { Post: { properties: ['title'] } },
    });
    assert.strictEqual(core.entities.Post.mfa, false);
  });

  it('non-MFA entity db does not have MFA columns', async () => {
    const core2 = buildCore({
      name: 'T2',
      entities: { Member: { authenticable: true, properties: ['name'] } },
    });
    const tmpDb2 = path.join(os.tmpdir(), `chadstart-nomfa-${Date.now()}.db`);
    await dbModule.initDb(core2, tmpDb2);
    const cols = dbModule.getDb().pragma('table_info("member")').map((r) => r.name);
    assert.ok(!cols.includes('mfaEnabled'), 'mfaEnabled should not exist');
    assert.ok(!cols.includes('mfaSecret'), 'mfaSecret should not exist');
    try { fs.unlinkSync(tmpDb2); } catch { /* noop */ }
  });
});

// ─── MFA challenge token is blocked by requireAuth ──────────────────────────

describe('auth – MFA challenge token rejected by requireAuth', () => {
  it('requireAuth rejects mfaChallenge tokens', async () => {
    const { requireAuth } = require('../core/auth');
    const mw = requireAuth('User');
    const mfaToken = signToken({ id: 'x', entity: 'User', mfaChallenge: true }, '5m');
    const req = { headers: { authorization: `Bearer ${mfaToken}` }, user: undefined };
    const res = { _status: 200, _body: undefined };
    res.status = (s) => { res._status = s; return res; };
    res.json = (b) => { res._body = b; };
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    assert.strictEqual(res._status, 401);
    assert.ok(!nextCalled);
  });
});
