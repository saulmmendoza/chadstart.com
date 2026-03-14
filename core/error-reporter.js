'use strict';

/**
 * Error Reporting integration for ChadStart.
 *
 * Supports Sentry (https://sentry.io) for automatic exception tracking.
 * To enable, set the SENTRY_DSN environment variable — it is treated as a
 * secret and must NOT be placed in the YAML config file.
 *
 * Non-sensitive settings (environment label, sample rates) can be provided
 * via the `sentry` section of your chadstart.yaml or via environment variables.
 *
 * 💡 Self-hosted alternative: Bugsink (https://www.bugsink.com) is a
 *    lightweight, privacy-first alternative to Sentry that is fully
 *    compatible with the Sentry SDK.  Simply point SENTRY_DSN at your
 *    Bugsink instance — no other code changes required.
 *
 * Example chadstart.yaml:
 *   sentry:
 *     environment: production    # optional (defaults to NODE_ENV)
 *     tracesSampleRate: 0.2      # optional (default: 1.0)
 *     debug: false               # optional (default: false)
 *
 * Example .env:
 *   SENTRY_DSN=https://xxxxx@oXXXXX.ingest.sentry.io/XXXXXXX
 */

const logger = require('../utils/logger');

let _sentry = null;
let _initialized = false;

/**
 * Initialise the Sentry SDK if SENTRY_DSN is set.
 *
 * @param {object} core  The parsed chadstart config (core object).
 */
function initErrorReporter(core) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  /* istanbul ignore next */
  try {
    _sentry = require('@sentry/node');
  } catch {
    logger.warn('[error-reporter] SENTRY_DSN is set but @sentry/node is not installed. Run: npm install @sentry/node');
    return;
  }

  const sentryConfig = (core && core.sentry) || {};

  _sentry.init({
    dsn,
    environment: sentryConfig.environment || process.env.NODE_ENV || 'development',
    tracesSampleRate: sentryConfig.tracesSampleRate !== undefined
      ? sentryConfig.tracesSampleRate
      : 1.0,
    debug: sentryConfig.debug === true,
  });

  _initialized = true;
  logger.info('[error-reporter] Error reporting enabled via Sentry');
}

/**
 * Returns the Sentry Express request handler middleware, or null when Sentry
 * is not configured.  Must be added as the *first* middleware in the chain.
 *
 * @returns {import('express').RequestHandler|null}
 */
function getRequestHandler() {
  if (!_initialized || !_sentry) return null;
  return _sentry.expressIntegration
    ? null                            // v8+: request capture is automatic
    : _sentry.Handlers.requestHandler();
}

/**
 * Returns the Sentry Express error handler middleware, or null when Sentry
 * is not configured.  Must be added *after* all routes and before any other
 * error-handling middleware.
 *
 * For Sentry v8+, use `attachErrorHandler(app)` instead — this function
 * returns null for v8 since error handling is registered via
 * `setupExpressErrorHandler`.
 *
 * @returns {import('express').ErrorRequestHandler|null}
 */
function getErrorHandler() {
  if (!_initialized || !_sentry) return null;
  // v8+ registers error handling differently via setupExpressErrorHandler;
  // use attachErrorHandler(app) for v8.
  if (typeof _sentry.setupExpressErrorHandler === 'function') return null;
  /* istanbul ignore next */
  return _sentry.Handlers.errorHandler();
}

/**
 * Attach Sentry error-handler middleware to an Express app (v8 compatible).
 * Call this after registering all routes.
 *
 * @param {import('express').Application} app
 */
function attachErrorHandler(app) {
  if (!_initialized || !_sentry) return;
  if (typeof _sentry.setupExpressErrorHandler === 'function') {
    _sentry.setupExpressErrorHandler(app);
  } else {
    /* istanbul ignore next */
    app.use(_sentry.Handlers.errorHandler());
  }
}

/** Expose the initialised Sentry instance (useful for manual captures). */
function getSentry() {
  return _initialized ? _sentry : null;
}

/** Reset state (used in tests). */
function _reset() {
  _sentry = null;
  _initialized = false;
}

module.exports = {
  initErrorReporter,
  getRequestHandler,
  getErrorHandler,
  attachErrorHandler,
  getSentry,
  _reset,
};
