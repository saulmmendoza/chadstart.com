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

/**
 * Save an updated config object back to a YAML file.
 * Uses yaml's Document API so that comments in unchanged top-level sections
 * are preserved as much as possible.
 *
 * @param {string} filePath  Path to the YAML file.
 * @param {object} config    Plain-JS config object (already validated).
 */
function saveYaml(filePath, config) {
  const resolved = path.resolve(filePath);

  let doc;
  if (fs.existsSync(resolved)) {
    // Parse into a live Document to keep comments / blank lines on unchanged nodes
    const raw = fs.readFileSync(resolved, 'utf8');
    doc = YAML.parseDocument(raw);

    const existing = doc.toJS() || {};
    const existingKeys = Object.keys(existing);
    const newKeys = Object.keys(config);

    // Update or add every key from the incoming config
    for (const key of newKeys) {
      doc.set(key, config[key]);
    }

    // Remove top-level keys that are no longer present
    for (const key of existingKeys) {
      if (!newKeys.includes(key)) {
        doc.delete(key);
      }
    }
  } else {
    // Create a fresh Document when the file does not yet exist
    doc = new YAML.Document(config);
  }

  fs.writeFileSync(resolved, doc.toString(), 'utf8');
  logger.debug('Saved YAML to', resolved);
}

module.exports = { loadYaml, saveYaml };
