'use strict';

const assert = require('assert');

describe('error-reporter', () => {
  const reporter = require('../core/error-reporter');

  afterEach(() => {
    // Reset module state and env between tests
    reporter._reset();
    delete process.env.SENTRY_DSN;
  });

  it('does nothing when SENTRY_DSN is not set', () => {
    reporter.initErrorReporter({});
    assert.strictEqual(reporter.getSentry(), null);
  });

  it('getRequestHandler returns null when not initialised', () => {
    assert.strictEqual(reporter.getRequestHandler(), null);
  });

  it('getErrorHandler returns null when not initialised', () => {
    assert.strictEqual(reporter.getErrorHandler(), null);
  });

  it('attachErrorHandler is a no-op when not initialised', () => {
    let called = false;
    reporter.attachErrorHandler({ use: () => { called = true; } });
    assert.strictEqual(called, false, 'app.use should not have been called');
  });

  it('getSentry returns null when not initialised', () => {
    assert.strictEqual(reporter.getSentry(), null);
  });

  it('initialises Sentry when SENTRY_DSN is set', () => {
    process.env.SENTRY_DSN = 'https://test@sentry.io/1';

    const calls = [];
    // Stub @sentry/node by temporarily overriding require cache
    const sentryStub = {
      init: (opts) => calls.push(opts),
      setupExpressErrorHandler: () => {},
    };
    const Module = require('module');
    const origLoad = Module._load;
    Module._load = function (request, parent, isMain) {
      if (request === '@sentry/node') return sentryStub;
      return origLoad.call(this, request, parent, isMain);
    };

    try {
      reporter.initErrorReporter({ sentry: { environment: 'test', tracesSampleRate: 0.5 } });
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].dsn, 'https://test@sentry.io/1');
      assert.strictEqual(calls[0].environment, 'test');
      assert.strictEqual(calls[0].tracesSampleRate, 0.5);
      assert.strictEqual(reporter.getSentry(), sentryStub);
    } finally {
      Module._load = origLoad;
      reporter._reset();
    }
  });

  it('uses NODE_ENV as environment when sentry.environment is not set', () => {
    process.env.SENTRY_DSN = 'https://test@sentry.io/2';
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'staging';

    const calls = [];
    const sentryStub = {
      init: (opts) => calls.push(opts),
      setupExpressErrorHandler: () => {},
    };
    const Module = require('module');
    const origLoad = Module._load;
    Module._load = function (request, parent, isMain) {
      if (request === '@sentry/node') return sentryStub;
      return origLoad.call(this, request, parent, isMain);
    };

    try {
      reporter.initErrorReporter({});
      assert.strictEqual(calls[0].environment, 'staging');
    } finally {
      Module._load = origLoad;
      process.env.NODE_ENV = prevNodeEnv;
      reporter._reset();
    }
  });

  it('defaults tracesSampleRate to 1.0 when not configured', () => {
    process.env.SENTRY_DSN = 'https://test@sentry.io/3';

    const calls = [];
    const sentryStub = {
      init: (opts) => calls.push(opts),
      setupExpressErrorHandler: () => {},
    };
    const Module = require('module');
    const origLoad = Module._load;
    Module._load = function (request, parent, isMain) {
      if (request === '@sentry/node') return sentryStub;
      return origLoad.call(this, request, parent, isMain);
    };

    try {
      reporter.initErrorReporter({});
      assert.strictEqual(calls[0].tracesSampleRate, 1.0);
    } finally {
      Module._load = origLoad;
      reporter._reset();
    }
  });

  it('attachErrorHandler calls setupExpressErrorHandler on the app', () => {
    process.env.SENTRY_DSN = 'https://test@sentry.io/4';
    let attached = false;
    const sentryStub = {
      init: () => {},
      setupExpressErrorHandler: () => { attached = true; },
    };
    const Module = require('module');
    const origLoad = Module._load;
    Module._load = function (request, parent, isMain) {
      if (request === '@sentry/node') return sentryStub;
      return origLoad.call(this, request, parent, isMain);
    };

    try {
      reporter.initErrorReporter({});
      reporter.attachErrorHandler({});
      assert.ok(attached, 'setupExpressErrorHandler should have been called');
    } finally {
      Module._load = origLoad;
      reporter._reset();
    }
  });
});
