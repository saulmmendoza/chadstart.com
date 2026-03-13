'use strict';

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const path = require('path');

const schema = require(path.join(__dirname, '..', 'chadstart.schema.json'));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validate = ajv.compile(schema);

/**
 * Validate a parsed YAML config against the ChadStart JSON Schema.
 * Throws a descriptive error on failure, returns true on success.
 */
function validateSchema(config) {
  const valid = validate(config);
  if (!valid) {
    const messages = validate.errors.map((e) => {
      const loc = e.instancePath || '/';
      return `${loc}: ${e.message}`;
    });
    throw new Error(`Config validation failed:\n  ${messages.join('\n  ')}`);
  }
  return true;
}

module.exports = { validateSchema };
