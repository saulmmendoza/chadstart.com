'use strict';

const assert = require('assert');
const { buildGrantConfig, normalizeProfile } = require('../core/oauth');
const { buildCore } = require('../core/entity-engine');

describe('OAuth – normalizeProfile', () => {
  it('extracts email/name/providerId from standard profile', () => {
    const result = normalizeProfile('google', {
      email: 'user@example.com',
      name: 'John Doe',
      sub: '123456',
    });
    assert.strictEqual(result.email, 'user@example.com');
    assert.strictEqual(result.name, 'John Doe');
    assert.strictEqual(result.providerId, '123456');
  });

  it('extracts email from emails array', () => {
    const result = normalizeProfile('github', {
      emails: [{ value: 'gh@example.com' }],
      login: 'octocat',
      id: 42,
    });
    assert.strictEqual(result.email, 'gh@example.com');
    assert.strictEqual(result.name, 'octocat');
    assert.strictEqual(result.providerId, '42');
  });

  it('handles displayName fallback', () => {
    const result = normalizeProfile('discord', {
      email: 'dc@example.com',
      displayName: 'DiscordUser',
      id: '999',
    });
    assert.strictEqual(result.name, 'DiscordUser');
  });

  it('handles first_name + last_name fallback', () => {
    const result = normalizeProfile('facebook', {
      email: 'fb@example.com',
      first_name: 'Jane',
      last_name: 'Smith',
      id: '555',
    });
    assert.strictEqual(result.name, 'Jane Smith');
  });

  it('handles missing profile', () => {
    const result = normalizeProfile('google', null);
    assert.strictEqual(result.email, null);
    assert.strictEqual(result.name, null);
    assert.strictEqual(result.providerId, null);
  });

  it('handles empty profile', () => {
    const result = normalizeProfile('google', {});
    assert.strictEqual(result.email, null);
    assert.strictEqual(result.name, null);
    assert.strictEqual(result.providerId, null);
  });

  it('handles mail field (used by some providers)', () => {
    const result = normalizeProfile('microsoft', {
      mail: 'ms@example.com',
      name: 'MS User',
      user_id: 'abc123',
    });
    assert.strictEqual(result.email, 'ms@example.com');
    assert.strictEqual(result.providerId, 'abc123');
  });

  it('uses username as name fallback', () => {
    const result = normalizeProfile('gitlab', {
      email: 'gl@example.com',
      username: 'gluser',
      id: 789,
    });
    assert.strictEqual(result.name, 'gluser');
  });

  it('uses account_id as providerId fallback', () => {
    const result = normalizeProfile('dropbox', {
      email: 'db@example.com',
      account_id: 'dbid:AAA',
    });
    assert.strictEqual(result.providerId, 'dbid:AAA');
  });

  it('handles emails array with plain strings', () => {
    const result = normalizeProfile('other', {
      emails: ['plain@example.com'],
      id: '10',
    });
    assert.strictEqual(result.email, 'plain@example.com');
  });
});

describe('OAuth – buildGrantConfig', () => {
  const baseUrl = 'http://localhost:3000';

  afterEach(() => {
    // Clean up env vars set during tests
    delete process.env.OAUTH_GOOGLE_KEY;
    delete process.env.OAUTH_GOOGLE_SECRET;
    delete process.env.OAUTH_GITHUB_KEY;
    delete process.env.OAUTH_GITHUB_SECRET;
  });

  it('builds config with defaults', () => {
    const oauthConfig = {
      providers: {
        google: {
          scope: ['openid', 'email'],
        },
      },
    };
    const config = buildGrantConfig(oauthConfig, baseUrl);

    assert.strictEqual(config.defaults.origin, 'http://localhost:3000');
    assert.strictEqual(config.defaults.transport, 'querystring');
    assert.ok(config.google);
    assert.deepStrictEqual(config.google.scope, ['openid', 'email']);
    assert.strictEqual(config.google.callback, '/api/auth/oauth/callback');
  });

  it('uses env vars for key/secret', () => {
    process.env.OAUTH_GOOGLE_KEY = 'env-key';
    process.env.OAUTH_GOOGLE_SECRET = 'env-secret';

    const oauthConfig = {
      providers: {
        google: {
          scope: ['openid'],
          key: 'yaml-key',      // Should be overridden by env
          secret: 'yaml-secret',
        },
      },
    };
    const config = buildGrantConfig(oauthConfig, baseUrl);

    assert.strictEqual(config.google.key, 'env-key');
    assert.strictEqual(config.google.secret, 'env-secret');
  });

  it('falls back to YAML key/secret when env not set', () => {
    const oauthConfig = {
      providers: {
        github: {
          key: 'yaml-key',
          secret: 'yaml-secret',
          scope: ['user:email'],
        },
      },
    };
    const config = buildGrantConfig(oauthConfig, baseUrl);

    assert.strictEqual(config.github.key, 'yaml-key');
    assert.strictEqual(config.github.secret, 'yaml-secret');
  });

  it('supports multiple providers', () => {
    const oauthConfig = {
      providers: {
        google: { scope: ['email'] },
        github: { scope: ['user:email'] },
        discord: { scope: ['identify'] },
      },
    };
    const config = buildGrantConfig(oauthConfig, baseUrl);

    assert.ok(config.google);
    assert.ok(config.github);
    assert.ok(config.discord);
  });

  it('preserves custom callback', () => {
    const oauthConfig = {
      providers: {
        google: {
          callback: '/my-custom-callback',
          scope: ['email'],
        },
      },
    };
    const config = buildGrantConfig(oauthConfig, baseUrl);

    assert.strictEqual(config.google.callback, '/my-custom-callback');
  });

  it('strips trailing slash from origin', () => {
    const config = buildGrantConfig({ providers: { google: {} } }, 'http://localhost:3000/');
    assert.strictEqual(config.defaults.origin, 'http://localhost:3000');
  });

  it('merges custom defaults', () => {
    const oauthConfig = {
      defaults: { transport: 'session' },
      providers: { google: {} },
    };
    const config = buildGrantConfig(oauthConfig, baseUrl);
    assert.strictEqual(config.defaults.transport, 'session');
  });

  it('handles custom_params', () => {
    const oauthConfig = {
      providers: {
        google: {
          scope: ['openid'],
          custom_params: { access_type: 'offline' },
        },
      },
    };
    const config = buildGrantConfig(oauthConfig, baseUrl);
    assert.deepStrictEqual(config.google.custom_params, { access_type: 'offline' });
  });
});

describe('OAuth – buildCore integration', () => {
  it('buildCore includes oauth config when present', () => {
    const core = buildCore({
      name: 'TestApp',
      entities: { User: { authenticable: true, properties: ['name'] } },
      oauth: {
        entity: 'User',
        providers: { google: { scope: ['email'] } },
      },
    });

    assert.ok(core.oauth);
    assert.strictEqual(core.oauth.entity, 'User');
    assert.ok(core.oauth.providers.google);
  });

  it('buildCore sets oauth to null when not configured', () => {
    const core = buildCore({
      name: 'TestApp',
      entities: { User: { authenticable: true, properties: ['name'] } },
    });

    assert.strictEqual(core.oauth, null);
  });

  it('buildCore preserves successRedirect and errorRedirect', () => {
    const core = buildCore({
      name: 'TestApp',
      entities: { User: { authenticable: true, properties: ['name'] } },
      oauth: {
        entity: 'User',
        successRedirect: '/dashboard',
        errorRedirect: '/login?error=true',
        providers: { github: { scope: ['user:email'] } },
      },
    });

    assert.strictEqual(core.oauth.successRedirect, '/dashboard');
    assert.strictEqual(core.oauth.errorRedirect, '/login?error=true');
  });
});
