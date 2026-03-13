'use strict';

/**
 * Convert the raw YAML config into normalized internal models.
 *
 * Authenticable entities (user collections) are entities with
 * `authenticable: true` — no separate userCollections section.
 */

const EMOJI_ACCESS = { '🌐': 'public', '🔒': 'restricted', '👨🏻‍💻': 'admin', '🚫': 'forbidden' };

function normalizePolicies(raw) {
  if (!raw) return {};
  const out = {};
  for (const [rule, list] of Object.entries(raw)) {
    out[rule] = list.map((p) => ({
      access: EMOJI_ACCESS[p.access] || p.access,
      allow: p.allow || null,
      condition: p.condition || null,
    }));
  }
  return out;
}

function normalizeRelation(rel) {
  if (typeof rel === 'string') return { name: rel, entity: rel };
  return { name: rel.name || rel.entity, entity: rel.entity || rel.name, ...rel };
}

function normalizeProperty(prop) {
  if (typeof prop === 'string') return { name: prop, type: 'string' };
  return {
    name: prop.name,
    type: prop.type || 'string',
    hidden: prop.hidden === true,
    default: prop.default !== undefined ? prop.default : undefined,
    options: prop.options || undefined,
    helpText: prop.helpText || undefined,
    validation: prop.validation || undefined,
  };
}

function buildEntities(config) {
  const entities = {};

  for (const [name, def] of Object.entries(config.entities || {})) {
    const properties = (def.properties || []).map(normalizeProperty);

    // Merge inline property validation into entity-level validation.
    // Inline declarations prevail over block-level on conflict.
    const validation = { ...(def.validation || {}) };
    for (const p of properties) {
      if (p.validation) {
        validation[p.name] = { ...(validation[p.name] || {}), ...p.validation };
      }
    }

    entities[name] = {
      name,
      tableName: toSnakeCase(name),
      slug: def.slug || toKebabCase(name),
      authenticable: def.authenticable === true,
      single: def.single === true,
      mainProp: def.mainProp || null,
      nameSingular: def.nameSingular || null,
      namePlural: def.namePlural || null,
      seedCount: def.seedCount || 50,
      properties,
      belongsTo: (def.belongsTo || []).map(normalizeRelation),
      belongsToMany: (def.belongsToMany || []).map(normalizeRelation),
      policies: normalizePolicies(def.policies),
      validation,
      hooks: def.hooks || {},
      middlewares: def.middlewares || {},
    };
  }

  return entities;
}

function getAuthenticableEntities(entities) {
  return Object.fromEntries(
    Object.entries(entities).filter(([, e]) => e.authenticable)
  );
}

function toSnakeCase(str) {
  return str.replace(/([A-Z])/g, (m, p, o) => (o > 0 ? '_' : '') + p.toLowerCase()).replace(/^_/, '');
}

function toKebabCase(str) {
  return str.replace(/([A-Z])/g, (m, p, o) => (o > 0 ? '-' : '') + p.toLowerCase()).replace(/^-/, '');
}

function buildCore(config) {
  const entities = buildEntities(config);
  return {
    name: config.name,
    database: config.database || null,
    entities,
    authenticableEntities: getAuthenticableEntities(entities),
    endpoints: config.endpoints || {},
    groups: config.groups || {},
    plugins: config.plugins || [],
    files: config.files || {},
    public: config.public || null,
    port: parseInt(process.env.CHADSTART_PORT || process.env.PORT || config.port || 3000, 10),
    settings: config.settings || null,
  };
}

module.exports = { buildCore, buildEntities, getAuthenticableEntities, toSnakeCase, toKebabCase };
