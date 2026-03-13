'use strict';

/**
 * Validate the parsed YAML config structure.
 * Throws descriptive errors for invalid configs.
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

  return true;
}

module.exports = { validateSchema };
