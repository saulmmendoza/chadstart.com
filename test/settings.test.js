'use strict';

const assert = require('assert');
const { buildCore } = require('../core/entity-engine');
const { validateSchema } = require('../core/schema-validator');
const { buildApiLimiters } = require('../server/express-server');

describe('settings.rateLimits', () => {
  it('schema accepts settings with rateLimits', () => {
    assert.strictEqual(validateSchema({
      name: 'App',
      settings: {
        rateLimits: [
          { name: 'short',  limit: 2,  ttl: 1000 },
          { name: 'medium', limit: 50, ttl: 60000 },
        ],
      },
    }), true);
  });

  it('schema accepts top-level rateLimits', () => {
    assert.strictEqual(validateSchema({
      name: 'App',
      rateLimits: [
        { name: 'short',  limit: 2,  ttl: 1000 },
        { name: 'medium', limit: 50, ttl: 60000 },
      ],
    }), true);
  });

  it('schema rejects rateLimit missing required name', () => {
    assert.throws(() => validateSchema({ name: 'App', settings: { rateLimits: [{ limit: 2, ttl: 1000 }] } }));
  });

  it('schema rejects rateLimit missing required limit', () => {
    assert.throws(() => validateSchema({ name: 'App', settings: { rateLimits: [{ name: 'short', ttl: 1000 }] } }));
  });

  it('schema rejects rateLimit missing required ttl', () => {
    assert.throws(() => validateSchema({ name: 'App', settings: { rateLimits: [{ name: 'short', limit: 2 }] } }));
  });

  it('schema rejects unknown settings key', () => {
    assert.throws(() => validateSchema({ name: 'App', settings: { unknownKey: true } }));
  });

  it('buildCore exposes settings with rateLimits', () => {
    const core = buildCore({
      name: 'App',
      settings: {
        rateLimits: [
          { name: 'short',  limit: 2,  ttl: 1000 },
          { name: 'medium', limit: 50, ttl: 60000 },
        ],
      },
    });
    assert.ok(core.settings);
    assert.strictEqual(core.settings.rateLimits.length, 2);
    assert.strictEqual(core.settings.rateLimits[0].name,  'short');
    assert.strictEqual(core.settings.rateLimits[0].limit, 2);
    assert.strictEqual(core.settings.rateLimits[0].ttl,   1000);
    assert.strictEqual(core.settings.rateLimits[1].name,  'medium');
  });

  it('buildCore exposes top-level rateLimits', () => {
    const core = buildCore({
      name: 'App',
      rateLimits: [
        { name: 'short',  limit: 2,  ttl: 1000 },
      ],
    });
    assert.ok(core.rateLimits);
    assert.strictEqual(core.rateLimits.length, 1);
    assert.strictEqual(core.rateLimits[0].name, 'short');
  });

  it('top-level rateLimits takes precedence over settings.rateLimits', () => {
    const core = buildCore({
      name: 'App',
      rateLimits: [{ name: 'top', limit: 5, ttl: 1000 }],
      settings: { rateLimits: [{ name: 'settings', limit: 10, ttl: 2000 }] },
    });
    assert.strictEqual(core.rateLimits[0].name, 'top');
  });

  it('buildCore sets settings to null when not provided', () => {
    const core = buildCore({ name: 'App' });
    assert.strictEqual(core.settings, null);
  });
});

describe('env vars', () => {
  it('PORT env var sets server port', () => {
    const saved = process.env.PORT;
    process.env.PORT = '4242';
    delete process.env.CHADSTART_PORT;
    const core = buildCore({ name: 'App' });
    if (saved === undefined) delete process.env.PORT; else process.env.PORT = saved;
    assert.strictEqual(core.port, 4242);
  });

  it('CHADSTART_PORT takes precedence over PORT', () => {
    const savedC = process.env.CHADSTART_PORT;
    const savedP = process.env.PORT;
    process.env.CHADSTART_PORT = '5555';
    process.env.PORT = '6666';
    const core = buildCore({ name: 'App' });
    if (savedC === undefined) delete process.env.CHADSTART_PORT; else process.env.CHADSTART_PORT = savedC;
    if (savedP === undefined) delete process.env.PORT; else process.env.PORT = savedP;
    assert.strictEqual(core.port, 5555);
  });
});

describe('buildApiLimiters', () => {
  it('returns 1 default limiter when no settings', () => {
    const core = buildCore({ name: 'App' });
    const limiters = buildApiLimiters(core);
    assert.strictEqual(limiters.length, 1);
    assert.strictEqual(typeof limiters[0], 'function');
  });

  it('returns one limiter per configured rateLimit entry (settings)', () => {
    const core = buildCore({
      name: 'App',
      settings: {
        rateLimits: [
          { name: 'short',  limit: 2,  ttl: 1000 },
          { name: 'medium', limit: 50, ttl: 60000 },
        ],
      },
    });
    const limiters = buildApiLimiters(core);
    assert.strictEqual(limiters.length, 2);
    assert.ok(limiters.every((l) => typeof l === 'function'));
  });

  it('returns one limiter per configured top-level rateLimit entry', () => {
    const core = buildCore({
      name: 'App',
      rateLimits: [
        { name: 'short',  limit: 2,  ttl: 1000 },
        { name: 'medium', limit: 50, ttl: 60000 },
      ],
    });
    const limiters = buildApiLimiters(core);
    assert.strictEqual(limiters.length, 2);
    assert.ok(limiters.every((l) => typeof l === 'function'));
  });

  it('falls back to default when rateLimits is empty array', () => {
    const core = buildCore({ name: 'App', settings: { rateLimits: [] } });
    const limiters = buildApiLimiters(core);
    assert.strictEqual(limiters.length, 1);
  });
});
