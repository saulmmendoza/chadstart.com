'use strict';

const assert = require('assert');
const { getTelemetryConfig, parseOtlpHeaders, shutdownTelemetry } = require('../core/telemetry');
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

describe('parseOtlpHeaders', () => {
  it('parses a single key=value pair', () => {
    const h = parseOtlpHeaders('authorization=Bearer token123');
    assert.strictEqual(h.authorization, 'Bearer token123');
  });

  it('parses multiple comma-separated pairs', () => {
    const h = parseOtlpHeaders('x-api-key=secret,x-tenant=acme');
    assert.strictEqual(h['x-api-key'], 'secret');
    assert.strictEqual(h['x-tenant'], 'acme');
  });

  it('trims whitespace around keys and values', () => {
    const h = parseOtlpHeaders(' x-key = myvalue ');
    assert.strictEqual(h['x-key'], 'myvalue');
  });

  it('handles a value that contains = signs', () => {
    const h = parseOtlpHeaders('authorization=Basic dXNlcjpwYXNz==');
    assert.strictEqual(h.authorization, 'Basic dXNlcjpwYXNz==');
  });

  it('skips pairs without = separator', () => {
    const h = parseOtlpHeaders('noequals,k=v');
    assert.strictEqual(Object.keys(h).length, 1);
    assert.strictEqual(h.k, 'v');
  });

  it('returns an empty object for an empty string', () => {
    const h = parseOtlpHeaders('');
    assert.deepStrictEqual(h, {});
  });
});

describe('getTelemetryConfig – disabled', () => {
  it('returns null when no env var and no yaml config', () => {
    withEnv({ OTEL_ENABLED: undefined }, () => {
      assert.strictEqual(getTelemetryConfig(null), null);
    });
  });

  it('returns null when settings object has no telemetry key', () => {
    withEnv({ OTEL_ENABLED: undefined }, () => {
      assert.strictEqual(getTelemetryConfig({ rateLimits: [] }), null);
    });
  });

  it('returns null when telemetry.enabled is explicitly false', () => {
    withEnv({ OTEL_ENABLED: undefined }, () => {
      assert.strictEqual(getTelemetryConfig({ telemetry: { enabled: false } }), null);
    });
  });

  it('returns null when OTEL_ENABLED is set to a non-true value', () => {
    withEnv({ OTEL_ENABLED: 'false' }, () => {
      assert.strictEqual(getTelemetryConfig(null), null);
    });
  });
});

describe('getTelemetryConfig – enabled via env var', () => {
  it('returns config when OTEL_ENABLED=true', () => {
    withEnv({ OTEL_ENABLED: 'true', OTEL_SERVICE_NAME: undefined, OTEL_EXPORTER_OTLP_ENDPOINT: undefined, OTEL_EXPORTER_OTLP_HEADERS: undefined }, () => {
      const cfg = getTelemetryConfig(null);
      assert.ok(cfg);
      assert.strictEqual(cfg.enabled, true);
    });
  });

  it('uses default serviceName when none provided', () => {
    withEnv({ OTEL_ENABLED: 'true', OTEL_SERVICE_NAME: undefined, OTEL_EXPORTER_OTLP_ENDPOINT: undefined, OTEL_EXPORTER_OTLP_HEADERS: undefined }, () => {
      const cfg = getTelemetryConfig(null);
      assert.strictEqual(cfg.serviceName, 'chadstart-app');
    });
  });

  it('uses default endpoint when none provided', () => {
    withEnv({ OTEL_ENABLED: 'true', OTEL_SERVICE_NAME: undefined, OTEL_EXPORTER_OTLP_ENDPOINT: undefined, OTEL_EXPORTER_OTLP_HEADERS: undefined }, () => {
      const cfg = getTelemetryConfig(null);
      assert.strictEqual(cfg.endpoint, 'http://localhost:4318');
    });
  });

  it('reads serviceName from OTEL_SERVICE_NAME env var', () => {
    withEnv({ OTEL_ENABLED: 'true', OTEL_SERVICE_NAME: 'env-service', OTEL_EXPORTER_OTLP_ENDPOINT: undefined, OTEL_EXPORTER_OTLP_HEADERS: undefined }, () => {
      const cfg = getTelemetryConfig(null);
      assert.strictEqual(cfg.serviceName, 'env-service');
    });
  });

  it('reads endpoint from OTEL_EXPORTER_OTLP_ENDPOINT env var', () => {
    withEnv({ OTEL_ENABLED: 'true', OTEL_SERVICE_NAME: undefined, OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel-collector:4318', OTEL_EXPORTER_OTLP_HEADERS: undefined }, () => {
      const cfg = getTelemetryConfig(null);
      assert.strictEqual(cfg.endpoint, 'http://otel-collector:4318');
    });
  });

  it('reads headers from OTEL_EXPORTER_OTLP_HEADERS env var', () => {
    withEnv({ OTEL_ENABLED: 'true', OTEL_SERVICE_NAME: undefined, OTEL_EXPORTER_OTLP_ENDPOINT: undefined, OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer mysecret' }, () => {
      const cfg = getTelemetryConfig(null);
      assert.deepStrictEqual(cfg.headers, { authorization: 'Bearer mysecret' });
    });
  });

  it('returns empty headers when OTEL_EXPORTER_OTLP_HEADERS is not set', () => {
    withEnv({ OTEL_ENABLED: 'true', OTEL_SERVICE_NAME: undefined, OTEL_EXPORTER_OTLP_ENDPOINT: undefined, OTEL_EXPORTER_OTLP_HEADERS: undefined }, () => {
      const cfg = getTelemetryConfig(null);
      assert.deepStrictEqual(cfg.headers, {});
    });
  });
});

describe('getTelemetryConfig – enabled via yaml', () => {
  it('returns config when settings.telemetry.enabled is true', () => {
    withEnv({ OTEL_ENABLED: undefined, OTEL_SERVICE_NAME: undefined, OTEL_EXPORTER_OTLP_ENDPOINT: undefined, OTEL_EXPORTER_OTLP_HEADERS: undefined }, () => {
      const cfg = getTelemetryConfig({ telemetry: { enabled: true } });
      assert.ok(cfg);
      assert.strictEqual(cfg.enabled, true);
    });
  });

  it('reads serviceName from yaml', () => {
    withEnv({ OTEL_ENABLED: undefined, OTEL_SERVICE_NAME: undefined, OTEL_EXPORTER_OTLP_ENDPOINT: undefined, OTEL_EXPORTER_OTLP_HEADERS: undefined }, () => {
      const cfg = getTelemetryConfig({ telemetry: { enabled: true, serviceName: 'yaml-service' } });
      assert.strictEqual(cfg.serviceName, 'yaml-service');
    });
  });

  it('reads endpoint from yaml', () => {
    withEnv({ OTEL_ENABLED: undefined, OTEL_SERVICE_NAME: undefined, OTEL_EXPORTER_OTLP_ENDPOINT: undefined, OTEL_EXPORTER_OTLP_HEADERS: undefined }, () => {
      const cfg = getTelemetryConfig({ telemetry: { enabled: true, endpoint: 'http://my-collector:4318' } });
      assert.strictEqual(cfg.endpoint, 'http://my-collector:4318');
    });
  });

  it('env var serviceName overrides yaml', () => {
    withEnv({ OTEL_ENABLED: undefined, OTEL_SERVICE_NAME: 'env-wins', OTEL_EXPORTER_OTLP_ENDPOINT: undefined, OTEL_EXPORTER_OTLP_HEADERS: undefined }, () => {
      const cfg = getTelemetryConfig({ telemetry: { enabled: true, serviceName: 'yaml-service' } });
      assert.strictEqual(cfg.serviceName, 'env-wins');
    });
  });

  it('env var endpoint overrides yaml', () => {
    withEnv({ OTEL_ENABLED: undefined, OTEL_SERVICE_NAME: undefined, OTEL_EXPORTER_OTLP_ENDPOINT: 'http://env-collector:4318', OTEL_EXPORTER_OTLP_HEADERS: undefined }, () => {
      const cfg = getTelemetryConfig({ telemetry: { enabled: true, endpoint: 'http://yaml-collector:4318' } });
      assert.strictEqual(cfg.endpoint, 'http://env-collector:4318');
    });
  });

  it('yaml has no headers field (secrets must come from env)', () => {
    withEnv({ OTEL_ENABLED: undefined, OTEL_SERVICE_NAME: undefined, OTEL_EXPORTER_OTLP_ENDPOINT: undefined, OTEL_EXPORTER_OTLP_HEADERS: undefined }, () => {
      const cfg = getTelemetryConfig({ telemetry: { enabled: true } });
      // Headers are always empty when OTEL_EXPORTER_OTLP_HEADERS env var is absent
      assert.deepStrictEqual(cfg.headers, {});
    });
  });

  it('OTEL_ENABLED=true overrides yaml enabled: false', () => {
    withEnv({ OTEL_ENABLED: 'true', OTEL_SERVICE_NAME: undefined, OTEL_EXPORTER_OTLP_ENDPOINT: undefined, OTEL_EXPORTER_OTLP_HEADERS: undefined }, () => {
      const cfg = getTelemetryConfig({ telemetry: { enabled: false } });
      assert.ok(cfg);
      assert.strictEqual(cfg.enabled, true);
    });
  });
});

describe('schema: settings.telemetry', () => {
  it('schema accepts telemetry with enabled only', () => {
    assert.strictEqual(validateSchema({ name: 'App', settings: { telemetry: { enabled: true } } }), true);
  });

  it('schema accepts telemetry with all non-secret fields', () => {
    assert.strictEqual(validateSchema({
      name: 'App',
      settings: {
        telemetry: {
          enabled: true,
          serviceName: 'my-service',
          endpoint: 'http://localhost:4318',
        },
      },
    }), true);
  });

  it('schema accepts disabled telemetry', () => {
    assert.strictEqual(validateSchema({ name: 'App', settings: { telemetry: { enabled: false } } }), true);
  });

  it('schema accepts empty telemetry object', () => {
    assert.strictEqual(validateSchema({ name: 'App', settings: { telemetry: {} } }), true);
  });

  it('schema rejects unknown telemetry key', () => {
    assert.throws(() => validateSchema({ name: 'App', settings: { telemetry: { enabled: true, headers: {} } } }));
  });

  it('schema rejects telemetry with enabled as non-boolean', () => {
    assert.throws(() => validateSchema({ name: 'App', settings: { telemetry: { enabled: 'yes' } } }));
  });

  it('schema rejects telemetry alongside unknown settings key', () => {
    assert.throws(() => validateSchema({ name: 'App', settings: { telemetry: { enabled: true }, badKey: true } }));
  });
});

describe('buildCore: settings.telemetry passthrough', () => {
  it('exposes settings.telemetry when provided', () => {
    const core = buildCore({
      name: 'App',
      settings: { telemetry: { enabled: true, serviceName: 'svc', endpoint: 'http://host:4318' } },
    });
    assert.ok(core.settings);
    assert.ok(core.settings.telemetry);
    assert.strictEqual(core.settings.telemetry.enabled, true);
    assert.strictEqual(core.settings.telemetry.serviceName, 'svc');
    assert.strictEqual(core.settings.telemetry.endpoint, 'http://host:4318');
  });

  it('settings is null when not provided (telemetry not configured)', () => {
    const core = buildCore({ name: 'App' });
    assert.strictEqual(core.settings, null);
  });
});

describe('shutdownTelemetry', () => {
  it('resolves without error when SDK was never initialized', async () => {
    await assert.doesNotReject(() => shutdownTelemetry());
  });
});
