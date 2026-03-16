'use strict';

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const path = require('path');

const schema = require(path.join(__dirname, '..', 'chadstart.schema.json'));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validate = ajv.compile(schema);

/**
 * Format a single AJV error into a human-readable string, enriched with
 * the relevant `params` data so the user knows exactly what went wrong.
 *
 * @param {import('ajv').ErrorObject} e
 * @returns {string}
 */
function formatError(e) {
  const loc = e.instancePath || '/';
  switch (e.keyword) {
    case 'additionalProperties':
      return `${loc}: unknown property '${e.params.additionalProperty}'`;
    case 'enum':
      return `${loc}: ${e.message} (${e.params.allowedValues.join(', ')})`;
    default:
      return `${loc}: ${e.message}`;
  }
}

/**
 * Validate a parsed YAML config against the ChadStart JSON Schema.
 * Throws a descriptive error on failure, returns true on success.
 */
function validateSchema(config) {
  const valid = validate(config);
  if (!valid) {
    // oneOf/anyOf errors are always redundant when allErrors:true already
    // surfaces the specific sub-errors, so we drop them to reduce noise.
    const errors = validate.errors.filter(
      (e) => e.keyword !== 'oneOf' && e.keyword !== 'anyOf',
    );
    const messages = errors.map(formatError);
    throw new Error(`Config validation failed:\n  ${messages.join('\n  ')}`);
  }
  return true;
}

module.exports = { validateSchema };
