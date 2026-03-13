'use strict';

const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

/**
 * Load and register plugins defined in core.plugins.
 *
 * Supported sources:
 *   - { path: './my-plugin' }  — local path (relative to cwd)
 *   - { repo: 'https://github.com/...' }  — clones the repo and loads index.js
 *
 * Plugin module interface:
 *   module.exports = {
 *     name: 'plugin-name',
 *     register(app, core) { ... }
 *   }
 */
async function loadPlugins(app, core) {
  for (const pluginDef of core.plugins) {
    if (pluginDef.repo) {
      logger.warn(
        `  ⚠️  Loading remote plugin from "${pluginDef.repo}". ` +
          'Remote plugins execute arbitrary code. Only load plugins from trusted sources.'
      );
    }
    try {
      const plugin = await resolvePlugin(pluginDef);
      if (typeof plugin.register === 'function') {
        await plugin.register(app, core);
        logger.info(`  Plugin "${plugin.name || 'unnamed'}" loaded`);
      } else {
        logger.warn(`  Plugin "${pluginDef.repo || pluginDef.path}" has no register() function`);
      }
    } catch (err) {
      logger.error(`  Failed to load plugin "${pluginDef.repo || pluginDef.path}": ${err.message}`);
    }
  }
}

async function resolvePlugin(pluginDef) {
  if (pluginDef.path) {
    const resolved = path.resolve(pluginDef.path);
    return require(resolved);
  }

  if (pluginDef.repo) {
    return loadRepoPlugin(pluginDef.repo);
  }

  throw new Error('Plugin must have "path" or "repo" field');
}

// Allow only HTTPS and SSH git URLs to prevent command injection
const SAFE_REPO_RE = /^(https:\/\/[a-zA-Z0-9._\-/:%@]+|git@[a-zA-Z0-9._-]+:[a-zA-Z0-9._\-/]+)(\.git)?$/;

async function loadRepoPlugin(repoUrl) {
  if (!SAFE_REPO_RE.test(repoUrl)) {
    throw new Error(`Plugin repo URL is not a valid git URL: ${repoUrl}`);
  }

  // Derive a directory name from the repo URL
  const repoName = repoUrl.replace(/\.git$/, '').split('/').pop();
  if (!repoName || repoName === '.' || repoName === '..') {
    throw new Error(`Cannot derive a safe directory name from repo URL: ${repoUrl}`);
  }
  const pluginDir = path.resolve(`.chadstart-plugins/${repoName}`);

  if (!fs.existsSync(pluginDir)) {
    logger.info(`  Cloning plugin from ${repoUrl}...`);
    const { execFileSync } = require('child_process');
    fs.mkdirSync(path.dirname(pluginDir), { recursive: true });
    // Use execFileSync with an argument array to avoid shell injection
    execFileSync('git', ['clone', '--depth', '1', repoUrl, pluginDir], { stdio: 'pipe' });

    // Install plugin dependencies if package.json exists.
    // NOTE: --ignore-scripts prevents execution of preinstall/postinstall scripts,
    // but plugins may still contain arbitrary code that runs at require() time.
    // Only load plugins from sources you trust.
    if (fs.existsSync(path.join(pluginDir, 'package.json'))) {
      execFileSync('npm', ['install', '--omit=dev', '--ignore-scripts'], {
        cwd: pluginDir,
        stdio: 'pipe',
      });
    }
  }

  return require(pluginDir);
}

module.exports = { loadPlugins };
