'use strict';

/**
 * Backward-compatible re-exports.
 *
 * All new code should import from `./config-loader` directly.
 * These wrappers keep existing callers (tests, plugins) working unchanged.
 */
const { loadConfig, saveConfig } = require('./config-loader');

function loadYaml(filePath) {
  return loadConfig(filePath);
}

function saveYaml(filePath, config) {
  return saveConfig(filePath, config);
}

module.exports = { loadYaml, saveYaml };
