'use strict';

const assert = require('assert');
const { getEmailConfig, initEmail, interpolate, getEmailStatus, sendEmail, verifyConnection } = require('../core/email');
const { validateSchema } = require('../core/schema-validator');
const { buildCore } = require('../core/entity-engine');

// Helper: set/restore env vars around a test
function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

// ── getEmailConfig ──────────────────────────────────────────────────────

describe('getEmailConfig – disabled', () => {
  it('returns null when no yaml and no env vars', () => {
    withEnv({ SMTP_HOST: undefined, SMTP_PORT: undefined, SMTP_USER: undefined, SMTP_PASS: undefined, SMTP_FROM: undefined }, () => {
      assert.strictEqual(getEmailConfig(null), null);
    });
  });

  it('returns null when yaml is empty object', () => {
    withEnv({ SMTP_HOST: undefined }, () => {
      assert.strictEqual(getEmailConfig({}), null);
    });
  });

  it('returns null when yaml has no host', () => {
    withEnv({ SMTP_HOST: undefined }, () => {
      assert.strictEqual(getEmailConfig({ port: 587, from: 'test@test.com' }), null);
    });
  });
});

describe('getEmailConfig – enabled via yaml', () => {
  it('returns config when host is provided in yaml', () => {
    withEnv({ SMTP_HOST: undefined, SMTP_PORT: undefined, SMTP_USER: undefined, SMTP_PASS: undefined, SMTP_FROM: undefined }, () => {
      const cfg = getEmailConfig({ host: 'smtp.example.com' });
      assert.ok(cfg);
      assert.strictEqual(cfg.host, 'smtp.example.com');
      assert.strictEqual(cfg.port, 587);
      assert.strictEqual(cfg.user, '');
      assert.strictEqual(cfg.pass, '');
      assert.strictEqual(cfg.from, '');
      assert.strictEqual(cfg.secure, false);
    });
  });

  it('reads all yaml fields', () => {
    withEnv({ SMTP_HOST: undefined, SMTP_PORT: undefined, SMTP_USER: undefined, SMTP_PASS: undefined, SMTP_FROM: undefined }, () => {
      const cfg = getEmailConfig({
        host: 'smtp.example.com',
        port: 465,
        username: 'user@example.com',
        from: 'App <noreply@example.com>',
        secure: true,
      });
      assert.strictEqual(cfg.host, 'smtp.example.com');
      assert.strictEqual(cfg.port, 465);
      assert.strictEqual(cfg.user, 'user@example.com');
      assert.strictEqual(cfg.from, 'App <noreply@example.com>');
      assert.strictEqual(cfg.secure, true);
    });
  });

  it('auto-detects secure=true for port 465', () => {
    withEnv({ SMTP_HOST: undefined, SMTP_PORT: undefined, SMTP_USER: undefined, SMTP_PASS: undefined, SMTP_FROM: undefined }, () => {
      const cfg = getEmailConfig({ host: 'smtp.example.com', port: 465 });
      assert.strictEqual(cfg.secure, true);
    });
  });

  it('auto-detects secure=false for port 587', () => {
    withEnv({ SMTP_HOST: undefined, SMTP_PORT: undefined, SMTP_USER: undefined, SMTP_PASS: undefined, SMTP_FROM: undefined }, () => {
      const cfg = getEmailConfig({ host: 'smtp.example.com', port: 587 });
      assert.strictEqual(cfg.secure, false);
    });
  });

  it('explicit secure overrides port-based auto-detection', () => {
    withEnv({ SMTP_HOST: undefined, SMTP_PORT: undefined, SMTP_USER: undefined, SMTP_PASS: undefined, SMTP_FROM: undefined }, () => {
      const cfg = getEmailConfig({ host: 'smtp.example.com', port: 465, secure: false });
      assert.strictEqual(cfg.secure, false);
    });
  });
});

describe('getEmailConfig – enabled via env vars', () => {
  it('returns config when SMTP_HOST env var is set', () => {
    withEnv({ SMTP_HOST: 'env-smtp.example.com', SMTP_PORT: undefined, SMTP_USER: undefined, SMTP_PASS: undefined, SMTP_FROM: undefined }, () => {
      const cfg = getEmailConfig(null);
      assert.ok(cfg);
      assert.strictEqual(cfg.host, 'env-smtp.example.com');
    });
  });

  it('env vars override yaml values', () => {
    withEnv({
      SMTP_HOST: 'env-host.com',
      SMTP_PORT: '465',
      SMTP_USER: 'env-user',
      SMTP_PASS: 'env-pass',
      SMTP_FROM: 'Env <env@test.com>',
    }, () => {
      const cfg = getEmailConfig({
        host: 'yaml-host.com',
        port: 587,
        username: 'yaml-user',
        from: 'Yaml <yaml@test.com>',
      });
      assert.strictEqual(cfg.host, 'env-host.com');
      assert.strictEqual(cfg.port, 465);
      assert.strictEqual(cfg.user, 'env-user');
      assert.strictEqual(cfg.pass, 'env-pass');
      assert.strictEqual(cfg.from, 'Env <env@test.com>');
    });
  });

  it('SMTP_PASS is only accepted from env var (not yaml)', () => {
    withEnv({ SMTP_HOST: undefined, SMTP_PORT: undefined, SMTP_USER: undefined, SMTP_PASS: 'secret123', SMTP_FROM: undefined }, () => {
      const cfg = getEmailConfig({ host: 'smtp.example.com' });
      assert.strictEqual(cfg.pass, 'secret123');
    });
  });
});

// ── interpolate ─────────────────────────────────────────────────────────

describe('interpolate', () => {
  it('replaces single variable', () => {
    assert.strictEqual(interpolate('Hello {{name}}!', { name: 'World' }), 'Hello World!');
  });

  it('replaces multiple variables', () => {
    const result = interpolate('{{appName}} - {{name}} ({{link}})', {
      appName: 'My App',
      name: 'Alice',
      link: 'https://example.com/verify',
    });
    assert.strictEqual(result, 'My App - Alice (https://example.com/verify)');
  });

  it('replaces missing variables with empty string', () => {
    assert.strictEqual(interpolate('Hello {{name}} at {{link}}', { name: 'Bob' }), 'Hello Bob at ');
  });

  it('handles empty template', () => {
    assert.strictEqual(interpolate('', { name: 'test' }), '');
  });

  it('handles null/undefined template', () => {
    assert.strictEqual(interpolate(null, { name: 'test' }), '');
    assert.strictEqual(interpolate(undefined, { name: 'test' }), '');
  });

  it('handles template with no placeholders', () => {
    assert.strictEqual(interpolate('No variables here', { name: 'test' }), 'No variables here');
  });

  it('handles repeated variables', () => {
    assert.strictEqual(interpolate('{{x}} and {{x}}', { x: 'val' }), 'val and val');
  });

  it('only matches word characters in variable names', () => {
    assert.strictEqual(interpolate('{{a-b}}', { 'a-b': 'nope' }), '{{a-b}}');
  });
});

// ── initEmail / getEmailStatus ──────────────────────────────────────────

describe('initEmail', () => {
  afterEach(() => {
    // Reset email state
    withEnv({ SMTP_HOST: undefined, SMTP_PORT: undefined, SMTP_USER: undefined, SMTP_PASS: undefined, SMTP_FROM: undefined }, () => {
      initEmail(null);
    });
  });

  it('returns null when not configured', () => {
    withEnv({ SMTP_HOST: undefined }, () => {
      const result = initEmail(null);
      assert.strictEqual(result, null);
    });
  });

  it('returns config metadata when configured', () => {
    withEnv({ SMTP_HOST: undefined, SMTP_PORT: undefined, SMTP_USER: undefined, SMTP_PASS: undefined, SMTP_FROM: undefined }, () => {
      const result = initEmail({ host: 'smtp.example.com', port: 587, from: 'App <noreply@example.com>' });
      assert.ok(result);
      assert.strictEqual(result.host, 'smtp.example.com');
      assert.strictEqual(result.port, 587);
      assert.strictEqual(result.from, 'App <noreply@example.com>');
    });
  });

  it('getEmailStatus returns configured: false when not initialized', () => {
    withEnv({ SMTP_HOST: undefined }, () => {
      initEmail(null);
      const status = getEmailStatus();
      assert.strictEqual(status.configured, false);
    });
  });

  it('getEmailStatus returns metadata when initialized', () => {
    withEnv({ SMTP_HOST: undefined, SMTP_PORT: undefined, SMTP_USER: undefined, SMTP_PASS: undefined, SMTP_FROM: undefined }, () => {
      initEmail({ host: 'smtp.example.com', port: 587, from: 'App <noreply@example.com>' });
      const status = getEmailStatus();
      assert.strictEqual(status.configured, true);
      assert.strictEqual(status.host, 'smtp.example.com');
      assert.strictEqual(status.port, 587);
      assert.strictEqual(status.from, 'App <noreply@example.com>');
    });
  });
});

// ── sendEmail (without real SMTP) ───────────────────────────────────────

describe('sendEmail – not configured', () => {
  before(() => {
    withEnv({ SMTP_HOST: undefined }, () => { initEmail(null); });
  });

  it('throws when email is not configured', async () => {
    await assert.rejects(
      () => sendEmail({ to: 'test@test.com', subject: 'Test' }),
      /Email is not configured/
    );
  });
});

describe('verifyConnection – not configured', () => {
  before(() => {
    withEnv({ SMTP_HOST: undefined }, () => { initEmail(null); });
  });

  it('returns failure when not configured', async () => {
    const result = await verifyConnection();
    assert.strictEqual(result.success, false);
    assert.ok(result.message.includes('not configured'));
  });
});

// ── Schema validation ────────────────────────────────────────────────────

describe('schema: email', () => {
  it('accepts config without email section', () => {
    assert.strictEqual(validateSchema({ name: 'App' }), true);
  });

  it('accepts email with host only', () => {
    assert.strictEqual(validateSchema({
      name: 'App',
      email: { host: 'smtp.example.com' },
    }), true);
  });

  it('accepts email with all fields', () => {
    assert.strictEqual(validateSchema({
      name: 'App',
      email: {
        host: 'smtp.example.com',
        port: 587,
        username: 'user@example.com',
        from: 'App <noreply@example.com>',
        secure: false,
      },
    }), true);
  });

  it('accepts email with templates', () => {
    assert.strictEqual(validateSchema({
      name: 'App',
      email: {
        host: 'smtp.example.com',
        templates: {
          verification: {
            subject: 'Verify {{appName}}',
            text: 'Click {{link}}',
            html: '<a href="{{link}}">Verify</a>',
          },
          passwordReset: {
            subject: 'Reset {{appName}}',
            text: 'Click {{link}}',
          },
        },
      },
    }), true);
  });

  it('accepts empty email object', () => {
    assert.strictEqual(validateSchema({ name: 'App', email: {} }), true);
  });

  it('rejects unknown email key', () => {
    assert.throws(() => validateSchema({
      name: 'App',
      email: { host: 'smtp.example.com', password: 'secret' },
    }));
  });

  it('rejects email port as string', () => {
    assert.throws(() => validateSchema({
      name: 'App',
      email: { host: 'smtp.example.com', port: '587' },
    }));
  });

  it('rejects unknown template type', () => {
    assert.throws(() => validateSchema({
      name: 'App',
      email: {
        host: 'smtp.example.com',
        templates: {
          welcome: { subject: 'Hello' },
        },
      },
    }));
  });
});

// ── buildCore: email passthrough ─────────────────────────────────────────

describe('buildCore: email passthrough', () => {
  it('exposes email config when provided', () => {
    const core = buildCore({
      name: 'App',
      email: { host: 'smtp.example.com', port: 587, from: 'App <noreply@example.com>' },
    });
    assert.ok(core.email);
    assert.strictEqual(core.email.host, 'smtp.example.com');
    assert.strictEqual(core.email.port, 587);
    assert.strictEqual(core.email.from, 'App <noreply@example.com>');
  });

  it('sets email to null when not provided', () => {
    const core = buildCore({ name: 'App' });
    assert.strictEqual(core.email, null);
  });

  it('passes templates through', () => {
    const core = buildCore({
      name: 'App',
      email: {
        host: 'smtp.example.com',
        templates: {
          verification: { subject: 'Verify', text: 'Click {{link}}' },
        },
      },
    });
    assert.ok(core.email.templates);
    assert.strictEqual(core.email.templates.verification.subject, 'Verify');
  });
});
