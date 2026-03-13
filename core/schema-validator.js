'use strict';

/**
 * Validate the parsed YAML config structure.
 * Throws descriptive errors for invalid configs.
 *
 * Supports the docs-baas entity format where user collections are
 * declared as entities with `authenticable: true`.
 */
function validateSchema(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('Config must be a YAML object');
  }

  if (!config.name || typeof config.name !== 'string') {
    throw new Error('Config must have a "name" string field');
  }

  if (config.entities !== undefined) {
    if (typeof config.entities !== 'object' || Array.isArray(config.entities)) {
      throw new Error('"entities" must be an object (map of entity names to definitions)');
    }

    for (const [entityName, entityDef] of Object.entries(config.entities)) {
      if (!entityDef || typeof entityDef !== 'object') {
        throw new Error(`Entity "${entityName}" must be an object`);
      }

      if (entityDef.properties !== undefined) {
        if (!Array.isArray(entityDef.properties)) {
          throw new Error(`Entity "${entityName}".properties must be an array`);
        }
        for (const prop of entityDef.properties) {
          if (typeof prop !== 'string' && (typeof prop !== 'object' || !prop.name)) {
            throw new Error(
              `Entity "${entityName}" property must be a string or object with a "name" field`
            );
          }
        }
      }

      if (entityDef.belongsTo !== undefined) {
        if (!Array.isArray(entityDef.belongsTo)) {
          throw new Error(`Entity "${entityName}".belongsTo must be an array`);
        }
      }

      if (entityDef.belongsToMany !== undefined) {
        if (!Array.isArray(entityDef.belongsToMany)) {
          throw new Error(`Entity "${entityName}".belongsToMany must be an array`);
        }
      }

      // authenticable: boolean
      if (entityDef.authenticable !== undefined && typeof entityDef.authenticable !== 'boolean') {
        throw new Error(`Entity "${entityName}".authenticable must be a boolean`);
      }

      // single: boolean
      if (entityDef.single !== undefined && typeof entityDef.single !== 'boolean') {
        throw new Error(`Entity "${entityName}".single must be a boolean`);
      }

      // policies: object with create/read/update/delete/signup rules
      if (entityDef.policies !== undefined) {
        if (typeof entityDef.policies !== 'object' || Array.isArray(entityDef.policies)) {
          throw new Error(`Entity "${entityName}".policies must be an object`);
        }
        const validRules = ['create', 'read', 'update', 'delete', 'signup'];
        for (const [rule, policyList] of Object.entries(entityDef.policies)) {
          if (!validRules.includes(rule)) {
            throw new Error(
              `Entity "${entityName}".policies has unknown rule "${rule}". Valid rules: ${validRules.join(', ')}`
            );
          }
          if (!Array.isArray(policyList)) {
            throw new Error(`Entity "${entityName}".policies.${rule} must be an array of policy objects`);
          }
          for (const policy of policyList) {
            if (!policy || typeof policy !== 'object') {
              throw new Error(`Each policy in "${entityName}".policies.${rule} must be an object`);
            }
            if (!policy.access) {
              throw new Error(`Each policy in "${entityName}".policies.${rule} must have an "access" field`);
            }
          }
        }
      }

      // validation: object
      if (entityDef.validation !== undefined) {
        if (typeof entityDef.validation !== 'object' || Array.isArray(entityDef.validation)) {
          throw new Error(`Entity "${entityName}".validation must be an object`);
        }
      }

      // hooks: object with lifecycle event arrays
      if (entityDef.hooks !== undefined) {
        if (typeof entityDef.hooks !== 'object' || Array.isArray(entityDef.hooks)) {
          throw new Error(`Entity "${entityName}".hooks must be an object`);
        }
        const validHooks = ['beforeCreate', 'afterCreate', 'beforeUpdate', 'afterUpdate', 'beforeDelete', 'afterDelete'];
        for (const [hook, hookList] of Object.entries(entityDef.hooks)) {
          if (!validHooks.includes(hook)) {
            throw new Error(
              `Entity "${entityName}".hooks has unknown event "${hook}". Valid events: ${validHooks.join(', ')}`
            );
          }
          if (!Array.isArray(hookList)) {
            throw new Error(`Entity "${entityName}".hooks.${hook} must be an array`);
          }
        }
      }

      // middlewares: object with lifecycle event arrays
      if (entityDef.middlewares !== undefined) {
        if (typeof entityDef.middlewares !== 'object' || Array.isArray(entityDef.middlewares)) {
          throw new Error(`Entity "${entityName}".middlewares must be an object`);
        }
        const validEvents = ['beforeCreate', 'afterCreate', 'beforeUpdate', 'afterUpdate', 'beforeDelete', 'afterDelete'];
        for (const [event, mwList] of Object.entries(entityDef.middlewares)) {
          if (!validEvents.includes(event)) {
            throw new Error(
              `Entity "${entityName}".middlewares has unknown event "${event}". Valid events: ${validEvents.join(', ')}`
            );
          }
          if (!Array.isArray(mwList)) {
            throw new Error(`Entity "${entityName}".middlewares.${event} must be an array`);
          }
        }
      }

      // Backward compat: permissions (old format)
      if (entityDef.permissions !== undefined) {
        if (typeof entityDef.permissions !== 'object' || Array.isArray(entityDef.permissions)) {
          throw new Error(`Entity "${entityName}".permissions must be an object`);
        }
      }
    }
  }

  // endpoints: object
  if (config.endpoints !== undefined) {
    if (typeof config.endpoints !== 'object' || Array.isArray(config.endpoints)) {
      throw new Error('"endpoints" must be an object (map of endpoint names to definitions)');
    }
    for (const [epName, epDef] of Object.entries(config.endpoints)) {
      if (!epDef || typeof epDef !== 'object') {
        throw new Error(`Endpoint "${epName}" must be an object`);
      }
      if (!epDef.path || typeof epDef.path !== 'string') {
        throw new Error(`Endpoint "${epName}" must have a "path" string`);
      }
      if (!epDef.method || typeof epDef.method !== 'string') {
        throw new Error(`Endpoint "${epName}" must have a "method" string`);
      }
      if (!epDef.handler || typeof epDef.handler !== 'string') {
        throw new Error(`Endpoint "${epName}" must have a "handler" string`);
      }
    }
  }

  if (config.plugins !== undefined) {
    if (!Array.isArray(config.plugins)) {
      throw new Error('"plugins" must be an array');
    }
    for (const plugin of config.plugins) {
      if (!plugin || typeof plugin !== 'object') {
        throw new Error('Each plugin entry must be an object');
      }
      if (!plugin.repo && !plugin.path) {
        throw new Error('Each plugin must have a "repo" or "path" field');
      }
    }
  }

  if (config.files !== undefined) {
    if (typeof config.files !== 'object' || Array.isArray(config.files)) {
      throw new Error('"files" must be an object (map of bucket names to definitions)');
    }
    for (const [bucketName, bucketDef] of Object.entries(config.files)) {
      if (!bucketDef || typeof bucketDef !== 'object') {
        throw new Error(`File bucket "${bucketName}" must be an object`);
      }
      if (!bucketDef.path || typeof bucketDef.path !== 'string') {
        throw new Error(`File bucket "${bucketName}" must have a "path" string`);
      }
    }
  }

  if (config.public !== undefined) {
    if (typeof config.public !== 'object' || Array.isArray(config.public)) {
      throw new Error('"public" must be an object');
    }
    if (!config.public.folder || typeof config.public.folder !== 'string') {
      throw new Error('"public.folder" must be a string');
    }
  }

  // Backward compatibility: userCollections (old format)
  if (config.userCollections !== undefined) {
    if (typeof config.userCollections !== 'object' || Array.isArray(config.userCollections)) {
      throw new Error('"userCollections" must be an object (map of collection names to definitions)');
    }

    for (const [name, def] of Object.entries(config.userCollections)) {
      if (!def || typeof def !== 'object') {
        throw new Error(`User collection "${name}" must be an object`);
      }

      if (def.properties !== undefined) {
        if (!Array.isArray(def.properties)) {
          throw new Error(`User collection "${name}".properties must be an array`);
        }
        for (const prop of def.properties) {
          if (typeof prop !== 'string' && (typeof prop !== 'object' || !prop.name)) {
            throw new Error(
              `User collection "${name}" property must be a string or object with a "name" field`
            );
          }
        }
      }
    }
  }

  // groups: object
  if (config.groups !== undefined) {
    if (typeof config.groups !== 'object' || Array.isArray(config.groups)) {
      throw new Error('"groups" must be an object (map of group names to definitions)');
    }
    for (const [groupName, groupDef] of Object.entries(config.groups)) {
      if (!groupDef || typeof groupDef !== 'object') {
        throw new Error(`Group "${groupName}" must be an object`);
      }
      if (groupDef.properties !== undefined && !Array.isArray(groupDef.properties)) {
        throw new Error(`Group "${groupName}".properties must be an array`);
      }
    }
  }

  return true;
}

module.exports = { validateSchema };
