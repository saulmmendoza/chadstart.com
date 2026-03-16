'use strict';

/**
 * OpenTelemetry integration for ChadStart.
 *
 * Non-secret values (service name, endpoint URL) can be configured via
 * the YAML settings block or environment variables.
 *
 * Secret values (OTLP auth headers / API keys) MUST be provided via
 * environment variables only — never put secrets in the YAML config file.
 *
 * Environment variables (all override YAML):
 *   OTEL_ENABLED=true                         enable tracing
 *   OTEL_SERVICE_NAME=my-service              service name reported to the collector
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://...    OTLP collector base URL
 *   OTEL_EXPORTER_OTLP_HEADERS=k1=v1,k2=v2   auth headers (secrets – env var only)
 */

const logger = require('../utils/logger');

/** @type {import('@opentelemetry/sdk-node').NodeSDK | null} */
let _sdk = null;

/**
 * Parse OTLP headers from the env-var format: "key1=value1,key2=value2".
 *
 * @param {string} raw
 * @returns {Record<string, string>}
 */
function parseOtlpHeaders(raw) {
  const headers = {};
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      headers[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
  }
  return headers;
}

/**
 * Derive telemetry configuration from YAML telemetry config + environment variables.
 * Returns null when telemetry is disabled.
 *
 * @param {object|null} telemetry  Value of `core.telemetry` (may be null)
 * @returns {{ enabled: true, serviceName: string, endpoint: string, headers: Record<string,string> } | null}
 */
function getTelemetryConfig(telemetry) {
  const tel = telemetry || {};

  const enabled =
    process.env.OTEL_ENABLED === 'true' ||
    tel.enabled === true;

  if (!enabled) return null;

  return {
    enabled: true,
    serviceName: process.env.OTEL_SERVICE_NAME || tel.serviceName || 'chadstart-app',
    endpoint:    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || tel.endpoint || 'http://localhost:4318',
    // Headers carry secrets (API keys, bearer tokens) — only accepted from env var.
    headers: process.env.OTEL_EXPORTER_OTLP_HEADERS
      ? parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS)
      : {},
  };
}

/**
 * Initialize the OpenTelemetry Node SDK with OTLP HTTP export.
 * This is a singleton — subsequent calls are no-ops (safe to call on hot reload).
 *
 * @param {{ enabled: true, serviceName: string, endpoint: string, headers: object } | null} telConfig
 */
async function initTelemetry(telConfig) {
  if (!telConfig || !telConfig.enabled) return;
  if (_sdk) return; // Already initialized — no-op on hot reload

  try {
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
    const { resourceFromAttributes } = require('@opentelemetry/resources');
    const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');

    const exporter = new OTLPTraceExporter({
      url: `${telConfig.endpoint}/v1/traces`,
      headers: telConfig.headers,
    });

    _sdk = new NodeSDK({
      resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: telConfig.serviceName }),
      traceExporter: exporter,
      instrumentations: [getNodeAutoInstrumentations()],
    });

    _sdk.start();
    logger.info(`  OpenTelemetry tracing enabled (service: ${telConfig.serviceName}, endpoint: ${telConfig.endpoint})`);
  } catch (err) {
    logger.error('Failed to initialize OpenTelemetry:', err.message);
  }
}

/**
 * Gracefully flush pending spans and shut down the SDK.
 * Resets the singleton so a fresh `initTelemetry` call can re-initialize.
 */
async function shutdownTelemetry() {
  if (_sdk) {
    try {
      await _sdk.shutdown();
    } catch (err) {
      logger.error('Failed to shut down OpenTelemetry:', err.message);
    } finally {
      _sdk = null;
    }
  }
}

module.exports = { getTelemetryConfig, initTelemetry, shutdownTelemetry, parseOtlpHeaders };
