'use strict';

/**
 * Convert the raw YAML config into normalized internal models.
 *
 * Supports the docs-baas format where authenticable entities
 * (user collections) are declared inline with `authenticable: true`.
 * Also supports the legacy `userCollections` top-level key for
 * backward compatibility.
 */

// ─── Access policy helpers ──────────────────────────────────────────────────

const EMOJI_ACCESS_MAP = {
  '🌐': 'public',
  '🔒': 'restricted',
  '👨🏻‍💻': 'admin',
  '🚫': 'forbidden',
};

/**
 * Normalize a policies object to a standard internal format.
 * Supports the new policies format, the old permissions format, and emoji shortcuts.
 */
function normalizePolicies(entityDef) {
  // New format: policies object
  if (entityDef.policies) {
    const normalized = {};
    for (const [rule, policyList] of Object.entries(entityDef.policies)) {
      normalized[rule] = policyList.map((p) => ({
        access: EMOJI_ACCESS_MAP[p.access] || p.access,
        allow: p.allow || null,
        condition: p.condition || null,
      }));
    }
    return normalized;
  }

  // Old format: permissions object (backward compat)
  if (entityDef.permissions) {
    const policies = {};
    const perms = entityDef.permissions;

    if (perms.read) {
      policies.read = [permissionToPolicy(perms.read)];
    }
    if (perms.write) {
      const writePolicy = permissionToPolicy(perms.write);
      policies.create = [writePolicy];
      policies.update = [writePolicy];
      policies.delete = [writePolicy];
    }
    return policies;
  }

  // Default: admin access for all rules
  return {};
}

/**
 * Convert an old-format permission string to a policy object.
 */
function permissionToPolicy(permission) {
  if (permission === 'public') {
    return { access: 'public', allow: null, condition: null };
  }
  if (permission === 'restricted') {
    return { access: 'restricted', allow: null, condition: null };
  }
  if (typeof permission === 'string' && permission.startsWith('user:')) {
    return { access: 'restricted', allow: permission.slice(5), condition: null };
  }
  return { access: 'admin', allow: null, condition: null };
}

// ─── Entity building ────────────────────────────────────────────────────────

function buildEntities(config) {
  const entities = {};

  for (const [entityName, entityDef] of Object.entries(config.entities || {})) {
    const isAuthenticable = entityDef.authenticable === true;
    const isSingle = entityDef.single === true;

    const properties = (entityDef.properties || []).map((prop) => {
      if (typeof prop === 'string') {
        return { name: prop, type: 'string' };
      }
      return { name: prop.name, type: prop.type || 'string', ...prop };
    });

    const belongsTo = (entityDef.belongsTo || []).map((rel) => {
      if (typeof rel === 'string') return { name: rel, entity: rel };
      return { name: rel.name || rel.entity, entity: rel.entity || rel.name, ...rel };
    });

    const belongsToMany = (entityDef.belongsToMany || []).map((rel) => {
      if (typeof rel === 'string') return { name: rel, entity: rel };
      return { name: rel.name || rel.entity, entity: rel.entity || rel.name, ...rel };
    });

    const policies = normalizePolicies(entityDef);

    // Determine slug
    const slug = entityDef.slug || toKebabCase(entityName);

    entities[entityName] = {
      name: entityName,
      tableName: toSnakeCase(entityName),
      slug,
      properties,
      belongsTo,
      belongsToMany,
      authenticable: isAuthenticable,
      single: isSingle,
      policies,
      validation: entityDef.validation || {},
      hooks: entityDef.hooks || {},
      middlewares: entityDef.middlewares || {},
      mainProp: entityDef.mainProp || null,
      seedCount: entityDef.seedCount || 50,
      // Backward compat: keep permissions for code that reads it
      permissions: entityDef.permissions || null,
    };
  }

  return entities;
}

/**
 * Build user-collection models from legacy YAML config.
 * Each user collection automatically has: email (unique), password, plus any extra properties.
 *
 * When `userCollections` is present, they are converted to authenticable entities internally.
 */
function buildUserCollections(config) {
  const userCollections = {};

  for (const [name, def] of Object.entries(config.userCollections || {})) {
    const properties = (def.properties || []).map((prop) => {
      if (typeof prop === 'string') return { name: prop, type: 'string' };
      return { name: prop.name, type: prop.type || 'string', ...prop };
    });

    userCollections[name] = {
      name,
      tableName: toSnakeCase(name),
      slug: toKebabCase(name),
      properties,
      admin: def.admin !== false,
    };
  }

  return userCollections;
}

/**
 * Get all authenticable entities from the entities map.
 */
function getAuthenticableEntities(entities) {
  const result = {};
  for (const [name, entity] of Object.entries(entities)) {
    if (entity.authenticable) {
      result[name] = entity;
    }
  }
  return result;
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
 *
 * Merges legacy userCollections into entities as authenticable entities
 * if they exist, so all downstream code can work with a unified model.
 */
function buildCore(config) {
  const entities = buildEntities(config);
  const legacyUserCollections = buildUserCollections(config);

  // Merge legacy userCollections into entities as authenticable entities
  for (const [name, uc] of Object.entries(legacyUserCollections)) {
    if (!entities[name]) {
      entities[name] = {
        name,
        tableName: uc.tableName,
        slug: uc.slug,
        properties: uc.properties,
        belongsTo: [],
        belongsToMany: [],
        authenticable: true,
        single: false,
        policies: {},
        validation: {},
        hooks: {},
        middlewares: {},
        mainProp: null,
        seedCount: 50,
        permissions: null,
      };
    }
  }

  // Derive authenticable entities for easy access
  const authenticableEntities = getAuthenticableEntities(entities);

  return {
    name: config.name,
    entities,
    authenticableEntities,
    // Keep userCollections for backward compatibility in admin UI and tests
    userCollections: legacyUserCollections,
    plugins: config.plugins || [],
    endpoints: config.endpoints || {},
    groups: config.groups || {},
    files: config.files || {},
    public: config.public || null,
    port: parseInt(process.env.CHADSTART_PORT || config.port || 3000, 10),
  };
}

module.exports = {
  buildCore,
  buildEntities,
  buildUserCollections,
  getAuthenticableEntities,
  toSnakeCase,
  toKebabCase,
};
