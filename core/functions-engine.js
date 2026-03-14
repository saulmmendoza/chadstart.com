'use strict';

/**
 * ChadStart Functions Engine
 *
 * Supports multiple runtimes (js, bash, python, go, c++, ruby, php),
 * multiple trigger types (http, event, cron), multiple JS formats
 * (universal, aws lambda, vercel, netlify, cloudflare workers, google cloud,
 * azure functions), and persistent worker processes for scripted runtimes.
 */

const path    = require('path');
const fs      = require('fs');
const { EventEmitter } = require('events');
const { execaNode, execa } = require('execa');
const cron    = require('node-cron');
const logger  = require('../utils/logger');

// ── Predefined cron schedule aliases ──────────────────────────────────────────
const PREDEFINED = {
  '@yearly':   '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly':  '0 0 1 * *',
  '@weekly':   '0 0 * * 0',
  '@daily':    '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly':   '0 * * * *',
};

function resolveSchedule(s) {
  return PREDEFINED[s] || s;
}

// ── Shared event bus ───────────────────────────────────────────────────────────
const eventBus = new EventEmitter();
eventBus.setMaxListeners(100);

// ── Worker process pool (one process per runtime) ─────────────────────────────
const _workers = new Map();

function getWorkerScript(runtime) {
  const dir = path.join(__dirname, 'workers');
  const map = {
    python: path.join(dir, 'python_worker.py'),
    ruby:   path.join(dir, 'ruby_worker.rb'),
    php:    path.join(dir, 'php_worker.php'),
  };
  return map[runtime] || null;
}

function getRuntimeCmd(runtime) {
  const cmds = { python: 'python3', ruby: 'ruby', php: 'php' };
  return cmds[runtime] || runtime;
}

/**
 * Get (or spawn) a persistent worker process for the given runtime.
 * Returns null for runtimes that don't use persistent workers.
 */
function getWorker(runtime) {
  if (_workers.has(runtime)) return _workers.get(runtime);

  const script = getWorkerScript(runtime);
  if (!script) return null;

  const proc = execa(getRuntimeCmd(runtime), [script], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    buffer: false,
    reject: false,
  });

  let buf = '';
  const pending = new Map();
  let idCounter  = 0;

  proc.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error));
          else p.resolve(msg.result);
        }
      } catch { /* ignore parse errors */ }
    }
  });

  proc.stderr.on('data', (d) => logger.warn(`[${runtime} worker] ${d.toString().trim()}`));

  proc.on('close', () => {
    _workers.delete(runtime);
    // reject any pending
    for (const p of pending.values()) p.reject(new Error(`${runtime} worker exited`));
    pending.clear();
    logger.warn(`[functions] ${runtime} worker exited — will restart on next invocation`);
  });

  const worker = {
    invoke(entry, event, ctx) {
      return new Promise((resolve, reject) => {
        const id = ++idCounter;
        pending.set(id, { resolve, reject });
        proc.stdin.write(JSON.stringify({ id, entry, event, ctx }) + '\n');
      });
    },
    proc,
  };

  _workers.set(runtime, worker);
  return worker;
}

// ── JS function format adapters ───────────────────────────────────────────────

/**
 * Load a JS module with cache-busting for hot reload.
 * Returns a normalised object with `default` and/or `handler` properties.
 */
function loadJsModule(entry) {
  delete require.cache[require.resolve(entry)];
  const raw = require(entry);
  // Normalise: if raw is a plain function, treat it as the default export
  const mod = (raw && typeof raw === 'object') ? raw : { default: raw };
  if (!mod.default && typeof raw === 'function') mod.default = raw;
  return mod;
}

/**
 * Run a JS function in legacy (Express middleware) mode.
 * The function receives (req, res, sdk) – same as the old registerCustomEndpoints.
 */
async function runJsFunctionLegacy(entry, req, res, sdk) {
  const mod = loadJsModule(entry);
  const fn = mod.default || mod;
  if (typeof fn !== 'function') throw new Error(`No callable export in ${entry}`);
  await fn(req, res, sdk);
}

/**
 * Run a JS function in multi-format mode (Universal, Lambda, Cloudflare Workers, Vercel).
 * Auto-detects the format from the module's exports.
 */
async function runJsFunction(entry, event, ctx) {
  const mod = loadJsModule(entry);

  // Resolve the primary callable; handle module.exports = { default: fn } (CJS wrapped default)
  let defaultExport = mod.default;
  if (defaultExport && typeof defaultExport !== 'function' && typeof defaultExport.default === 'function') {
    defaultExport = defaultExport.default;
  }

  // 1. Cloudflare / edge style: { default: { fetch(request) } }
  if (defaultExport && typeof defaultExport.fetch === 'function') {
    const req = event.request || new Request(`http://localhost${ctx.path || '/'}`);
    const result = await defaultExport.fetch(req);
    return result.json ? await result.json() : await result.text();
  }

  // 2. AWS Lambda style: exports.handler (named export, not default)
  const lambdaHandler = mod.handler;
  if (typeof lambdaHandler === 'function') {
    const result = await lambdaHandler(event, {});
    if (result && result.body) { try { return JSON.parse(result.body); } catch { return result.body; } }
    return result;
  }

  // 3. Universal / Vercel / Netlify: default export function
  //    Called as fn(event, ctx) – the ctx always has trigger, name, etc.
  //    For Vercel-style: the function can also access ctx.res (Express res) to send directly.
  if (typeof defaultExport === 'function') {
    return defaultExport(event, ctx);
  }

  throw new Error(`No recognised export in ${entry}`);
}

// ── External runtime invocation ───────────────────────────────────────────────

async function runExternal(runtime, entry, event, ctx) {
  // Try persistent worker for scripted runtimes
  const worker = getWorker(runtime);
  if (worker) return worker.invoke(entry, event, ctx);

  // Per-invocation for other runtimes
  const input = JSON.stringify({ event, ctx });
  const cmds = {
    bash: ['bash', [entry]],
    go:   ['go', ['run', entry]],
    'c++': ['sh', ['-c', `g++ -o /tmp/cs_fn "${entry}" && /tmp/cs_fn`]],
  };

  const [cmd, args] = cmds[runtime] || [runtime, [entry]];
  try {
    const { stdout } = await execa(cmd, args, { input, reject: false });
    return JSON.parse(stdout);
  } catch (e) {
    throw new Error(`${runtime} runtime error: ${e.message}`);
  }
}

// ── Unified function runner ────────────────────────────────────────────────────

function resolveFnEntry(fnFile) {
  const entry = path.resolve(process.env.CHADSTART_FUNCTIONS_FOLDER || 'functions', fnFile);
  return fs.existsSync(entry) ? entry : null;
}

async function runFunction(fn, event, ctx) {
  const runtime = fn.runtime || 'js';
  const entry   = resolveFnEntry(fn.function);
  if (!entry) {
    logger.warn(`Function file not found: ${fn.function}`);
    return { error: `Function not found: ${fn.function}` };
  }
  if (runtime === 'js') return runJsFunction(entry, event, ctx);
  return runExternal(runtime, entry, event, ctx);
}

// ── Trigger registration ──────────────────────────────────────────────────────

const _cronTasks = [];

/**
 * Register all function triggers on the Express app.
 * `sdk` is the backend SDK injected into legacy-format functions as the 3rd argument.
 */
function setupFunctions(app, functions, sdk) {
  if (!functions || !Object.keys(functions).length) return;

  for (const [name, fn] of Object.entries(functions)) {
    const triggers = normaliseTriggers(fn);
    for (const trigger of triggers) {
      registerTrigger(app, name, fn, trigger, sdk);
    }
  }
}

/**
 * Stop all active cron tasks and worker processes.
 * Called on hot reload to release resources before setting up new config.
 */
function cleanup() {
  for (const task of _cronTasks) { try { task.stop(); } catch { /* */ } }
  _cronTasks.length = 0;

  for (const [, w] of _workers) { try { w.proc.kill(); } catch { /* */ } }
  _workers.clear();
}

function normaliseTriggers(fn) {
  // New format: fn.triggers array
  if (fn.triggers && fn.triggers.length) return fn.triggers;
  // Legacy format: fn.path + fn.method → single http trigger
  if (fn.path && fn.method) {
    return [{ type: 'http', method: fn.method, path: fn.path }];
  }
  return [];
}

function registerTrigger(app, name, fn, trigger, sdk) {
  switch (trigger.type || 'http') {
    case 'http':
      registerHttp(app, name, fn, trigger, sdk);
      break;
    case 'cron':
      registerCron(name, fn, trigger);
      break;
    case 'event':
      registerEvent(name, fn, trigger);
      break;
    default:
      logger.warn(`[functions] Unknown trigger type "${trigger.type}" for "${name}"`);
  }
}

function registerHttp(app, name, fn, trigger, sdk) {
  const method = (trigger.method || 'GET').toLowerCase();
  // Legacy functions are served at /endpoints/<path>; new multi-trigger at the path directly
  const isLegacy = !fn.triggers;
  const epPath = isLegacy ? `/endpoints${trigger.path}` : trigger.path;

  // Build policy middleware for legacy format (new format is always public by default)
  const middlewares = fn.policies ? buildPolicyMiddlewares(fn.policies) : [];

  app[method](epPath, ...middlewares, async (req, res) => {
    const runtime = fn.runtime || 'js';
    const entry   = resolveFnEntry(fn.function);
    if (!entry) {
      logger.warn(`[functions] File not found for "${name}": ${fn.function}`);
      return res.status(404).json({ error: `Function not found: ${fn.function}` });
    }
    try {
      if (isLegacy && runtime === 'js') {
        // Legacy format: call as Express middleware fn(req, res, sdk)
        await runJsFunctionLegacy(entry, req, res, sdk);
        if (!res.headersSent) res.json({});
      } else {
        const event = { req, body: req.body, query: req.query, params: req.params, headers: req.headers };
        const ctx   = { trigger: 'http', method: req.method, path: epPath, name };
        const result = await runFunction(fn, event, ctx);
        if (!res.headersSent) {
          if (result && typeof result === 'object') return res.json(result);
          res.send(result ?? '');
        }
      }
    } catch (e) {
      logger.error(`[functions] ${name} http error: ${e.message}`);
      if (!res.headersSent) res.status(500).json({ error: e.message });
    }
  });

  logger.info(`  Registered function: ${trigger.method || 'GET'} ${epPath} (${name})`);
}

function registerCron(name, fn, trigger) {
  const schedule = resolveSchedule(trigger.schedule);
  if (!cron.validate(schedule)) {
    logger.warn(`[functions] Invalid cron schedule "${trigger.schedule}" for "${name}"`);
    return;
  }
  const task = cron.schedule(schedule, async () => {
    try {
      const ctx = { trigger: 'cron', schedule: trigger.schedule, name };
      await runFunction(fn, {}, ctx);
    } catch (e) {
      logger.error(`[functions] ${name} cron error: ${e.message}`);
    }
  });
  _cronTasks.push(task);
  logger.info(`  Registered cron: "${trigger.schedule}" → ${name}`);
}

function registerEvent(name, fn, trigger) {
  const eventName = trigger.name || trigger.event;
  if (!eventName) { logger.warn(`[functions] Event trigger for "${name}" has no name`); return; }
  eventBus.on(eventName, async (payload) => {
    try {
      const ctx = { trigger: 'event', event: eventName, name };
      await runFunction(fn, payload || {}, ctx);
    } catch (e) {
      logger.error(`[functions] ${name} event error: ${e.message}`);
    }
  });
  logger.info(`  Registered event: "${eventName}" → ${name}`);
}

// ── Policy middleware (legacy HTTP functions) ─────────────────────────────────

function buildPolicyMiddlewares(policies) {
  const { optionalAuth, requireAuth, JWT_SECRET } = require('./auth');
  const jwt = require('jsonwebtoken');
  if (!policies || !policies.length) return [optionalAuth, (_r, _s, n) => n()];
  const p = policies[0];
  switch (p.access) {
    case 'public': return [optionalAuth, (_r, _s, n) => n()];
    case 'restricted': {
      if (!p.allow) return [requireAuth()];
      const allowed = Array.isArray(p.allow) ? p.allow : [p.allow];
      return [(req, res, next) => {
        const h = req.headers.authorization;
        if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Authorization required' });
        try {
          req.user = jwt.verify(h.slice(7), JWT_SECRET);
          if (!allowed.includes(req.user.entity)) return res.status(403).json({ error: 'Access denied' });
          next();
        } catch { res.status(401).json({ error: 'Invalid or expired token' }); }
      }];
    }
    case 'admin': return [requireAuth()];
    case 'forbidden': return [(_r, res) => res.status(403).json({ error: 'Access forbidden' })];
    default: return [(_r, _s, n) => n()];
  }
}

module.exports = { setupFunctions, cleanup, eventBus, resolveSchedule };
