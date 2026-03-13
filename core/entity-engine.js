'use strict';

/**
 * Convert the raw YAML config into normalized internal models.
 *
 * Normalizes entity properties to objects with at minimum { name, type }.
 * Populates relations derived from belongsTo declarations.
 */
function buildEntities(config) {
  const entities = {};

  for (const [entityName, entityDef] of Object.entries(config.entities || {})) {
    const properties = (entityDef.properties || []).map((prop) => {
      if (typeof prop === 'string') {
        return { name: prop, type: 'text' };
      }
      return { name: prop.name, type: prop.type || 'text', ...prop };
    });

    const belongsTo = (entityDef.belongsTo || []).map((rel) => {
      if (typeof rel === 'string') return rel;
      return rel;
    });

    entities[entityName] = {
      name: entityName,
      tableName: toSnakeCase(entityName),
      properties,
      belongsTo,
      permissions: entityDef.permissions || { read: 'public', write: 'public' },
    };
  }

  return entities;
}

/**
 * Build user-collection models from YAML config.
 * Each user collection automatically has: email (unique), password, plus any extra properties.
 */
function buildUserCollections(config) {
  const userCollections = {};

  for (const [name, def] of Object.entries(config.userCollections || {})) {
    const properties = (def.properties || []).map((prop) => {
      if (typeof prop === 'string') return { name: prop, type: 'text' };
      return { name: prop.name, type: prop.type || 'text', ...prop };
    });

    userCollections[name] = {
      name,
      tableName: toSnakeCase(name),
      // email and password are always injected as first two columns
      properties,
      // controls whether this collection can log in to the Admin UI
      admin: def.admin !== false, // default: true (all user-collections can access admin)
    };
  }

  return userCollections;
}

/**
 * Convert CamelCase or PascalCase name to snake_case table name.
 */
function toSnakeCase(str) {
  return str
    .replace(/([A-Z])/g, (match, p1, offset) => (offset > 0 ? '_' : '') + p1.toLowerCase())
    .replace(/^_/, '');
}

/**
 * Convert PascalCase / camelCase to kebab-case slug used in API paths.
 */
function toKebabCase(str) {
  return str
    .replace(/([A-Z])/g, (m, p, offset) => (offset > 0 ? '-' : '') + p.toLowerCase())
    .replace(/^-/, '');
}

/**
 * Build the full core model from a validated YAML config.
 */
function buildCore(config) {
  return {
    name: config.name,
    entities: buildEntities(config),
    userCollections: buildUserCollections(config),
    plugins: config.plugins || [],
    files: config.files || {},
    public: config.public || null,
    port: parseInt(process.env.CHADSTART_PORT || config.port || 3000, 10),
  };
}

module.exports = { buildCore, buildEntities, buildUserCollections, toSnakeCase, toKebabCase };
