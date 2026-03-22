'use strict';

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const JSON5 = require('json5');
const logger = require('../utils/logger');

// ─── Supported config file names (checked in priority order) ─────────────────

const CONFIG_FILENAMES = [
  'chadstart.yaml',
  'chadstart.yml',
  'chadstart.json',
  'chadstart.json5',
  'chadstart.jsonnet',
  'chadstart.config.js',
  'chadstart.config.cjs',
];

// ─── Format detection ────────────────────────────────────────────────────────

/**
 * Map a file extension to a config format identifier.
 *
 * @param {string} filePath
 * @returns {'yaml'|'json'|'json5'|'jsonnet'|'js'}
 */
function detectFormat(filePath) {
  const base = path.basename(filePath);
  if (base.endsWith('.config.js') || base.endsWith('.config.cjs')) return 'js';
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.yaml':
    case '.yml':
      return 'yaml';
    case '.json':
      return 'json';
    case '.json5':
      return 'json5';
    case '.jsonnet':
      return 'jsonnet';
    case '.js':
    case '.cjs':
      return 'js';
    default:
      return 'yaml'; // default fallback
  }
}

/**
 * Returns true when the format supports writing back through saveConfig.
 */
function isWritableFormat(format) {
  return format === 'yaml' || format === 'json' || format === 'json5';
}

// ─── Auto-discovery ──────────────────────────────────────────────────────────

/**
 * Discover the first matching config file inside `dir`.
 * Returns the absolute path, or null when nothing is found.
 *
 * @param {string} [dir=process.cwd()]
 * @returns {string|null}
 */
function discoverConfigFile(dir) {
  const base = dir || process.cwd();
  for (const name of CONFIG_FILENAMES) {
    const candidate = path.resolve(base, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

function parseYaml(raw) {
  return YAML.parse(raw);
}

function parseJson(raw) {
  return JSON.parse(raw);
}

function parseJson5(raw) {
  return JSON5.parse(raw);
}

function parseJsonnet(filePath) {
  const { execFileSync } = require('child_process');
  try {
    const stdout = execFileSync('jsonnet', [filePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    }).toString();
    return JSON.parse(stdout);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(
        'Jsonnet config detected but the "jsonnet" CLI is not installed. ' +
          'Install it (https://jsonnet.org) or convert your config to YAML/JSON.',
      );
    }
    throw new Error(`Failed to evaluate Jsonnet config: ${err.stderr || err.message}`);
  }
}

function parseJsConfig(filePath) {
  // Clear require cache so edits are picked up on hot-reload
  try { delete require.cache[require.resolve(filePath)]; } catch { /* first load */ }
  const mod = require(filePath);
  const config = mod && mod.__esModule ? mod.default : mod;
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`JS config must export a plain object: ${filePath}`);
  }
  return config;
}

// ─── Load ────────────────────────────────────────────────────────────────────

/**
 * Load and parse a config file in any supported format.
 *
 * @param {string} filePath  Absolute or relative path to the config file.
 * @returns {object}         Parsed config object.
 */
function loadConfig(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}`);
  }

  const format = detectFormat(resolved);
  let config;

  switch (format) {
    case 'yaml': {
      const raw = fs.readFileSync(resolved, 'utf8');
      config = parseYaml(raw);
      break;
    }
    case 'json': {
      const raw = fs.readFileSync(resolved, 'utf8');
      config = parseJson(raw);
      break;
    }
    case 'json5': {
      const raw = fs.readFileSync(resolved, 'utf8');
      config = parseJson5(raw);
      break;
    }
    case 'jsonnet':
      config = parseJsonnet(resolved);
      break;
    case 'js':
      config = parseJsConfig(resolved);
      break;
    default: {
      const raw = fs.readFileSync(resolved, 'utf8');
      config = parseYaml(raw);
    }
  }

  logger.debug('Loaded config (%s) from %s', format, resolved);
  return config;
}

// ─── Save ────────────────────────────────────────────────────────────────────

/**
 * Save a config object back to disk in the file's native format.
 *
 * For YAML files, comments in unchanged top-level sections are preserved using
 * the yaml Document API.  JSON and JSON5 files are pretty-printed.
 * Jsonnet and JS configs cannot be written back (they may contain logic).
 *
 * @param {string} filePath  Path to the config file.
 * @param {object} config    Plain-JS config object (already validated).
 */
function saveConfig(filePath, config) {
  const resolved = path.resolve(filePath);
  const format = detectFormat(resolved);

  if (!isWritableFormat(format)) {
    throw new Error(
      `Cannot save config: ${format} format is read-only. ` +
        'Convert to YAML, JSON, or JSON5 to enable saving from the admin UI.',
    );
  }

  switch (format) {
    case 'yaml':
      saveYamlFile(resolved, config);
      break;
    case 'json':
      fs.writeFileSync(resolved, JSON.stringify(config, null, 2) + '\n', 'utf8');
      break;
    case 'json5':
      fs.writeFileSync(resolved, JSON5.stringify(config, null, 2) + '\n', 'utf8');
      break;
    default:
      break;
  }

  logger.debug('Saved config (%s) to %s', format, resolved);
}

/**
 * YAML-specific save that preserves comments via the Document API.
 * Extracted from the original yaml-loader.js.
 */
function saveYamlFile(resolved, config) {
  let doc;
  if (fs.existsSync(resolved)) {
    const raw = fs.readFileSync(resolved, 'utf8');
    doc = YAML.parseDocument(raw);

    const existing = doc.toJS() || {};
    const existingKeys = Object.keys(existing);
    const newKeys = Object.keys(config);

    for (const key of newKeys) {
      doc.set(key, config[key]);
    }
    for (const key of existingKeys) {
      if (!newKeys.includes(key)) {
        doc.delete(key);
      }
    }
  } else {
    doc = new YAML.Document(config);
  }

  fs.writeFileSync(resolved, doc.toString(), 'utf8');
}

// ─── Parse raw content by format (used by migrations git-show) ───────────────

/**
 * Parse raw file content using the parser matching the given format.
 *
 * @param {string} raw     Raw file content (UTF-8 string).
 * @param {'yaml'|'json'|'json5'} format
 * @returns {object}
 */
function parseRaw(raw, format) {
  switch (format) {
    case 'json':  return parseJson(raw);
    case 'json5': return parseJson5(raw);
    case 'yaml':
    default:      return parseYaml(raw);
  }
}

module.exports = {
  CONFIG_FILENAMES,
  detectFormat,
  isWritableFormat,
  discoverConfigFile,
  loadConfig,
  saveConfig,
  parseRaw,
};
