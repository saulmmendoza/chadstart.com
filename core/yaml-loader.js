'use strict';

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const logger = require('../utils/logger');

/**
 * Load and parse the chadstart.yaml file.
 * Returns the raw parsed object.
 */
function loadYaml(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`YAML config not found: ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, 'utf8');
  const parsed = YAML.parse(raw);
  logger.debug('Loaded YAML from', resolved);
  return parsed;
}

module.exports = { loadYaml };
