'use strict';

/**
 * ChadStart Functions Engine
 *
 * Supports multiple runtimes (js, bash, python, go, c++, ruby, php),
 * multiple trigger types (http, event, cron), and multiple JS formats
 * (universal, aws lambda, cloudflare workers).
 * Scripted runtimes (python, ruby, php) use persistent worker processes.
 */

const path    = require('path');
const fs      = require('fs');
const { EventEmitter } = require('events');
const { execa } = require('execa');
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

const SUPPORTED_RUNTIMES = new Set(['js', 'bash', 'python', 'go', 'c++', 'ruby', 'php']);

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
  const mod = (raw && typeof raw === 'object') ? raw : { default: raw };
  if (!mod.default && typeof raw === 'function') mod.default = raw;
  return mod;
}

/**
 * Run a JS function — auto-detects format: Universal, AWS Lambda, Cloudflare Workers.
 * Called as fn(event, ctx) for Universal; module.handler(event, {}) for Lambda;
 * module.default.fetch(request) for Cloudflare Workers.
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
  if (typeof mod.handler === 'function') {
    const result = await mod.handler(event, {});
    if (result && result.body) { try { return JSON.parse(result.body); } catch { return result.body; } }
    return result;
  }

  // 3. Universal: default export called as fn(event, ctx)
  if (typeof defaultExport === 'function') {
    return defaultExport(event, ctx);
  }

  throw new Error(`No recognised export in ${entry}`);
}

// ── External runtime invocation ───────────────────────────────────────────────

async function runExternal(runtime, entry, event, ctx) {
  const worker = getWorker(runtime);
  if (worker) return worker.invoke(entry, event, ctx);

  const input = JSON.stringify({ event, ctx });
  const ts = Date.now();
  const safeEntry = entry.replace(/'/g, "'\\''"); // single-quote escape for shell
  const cmds = {
    bash: ['bash', [entry]],
    go:   ['go', ['run', entry]],
    'c++': ['sh', ['-c', `g++ -o /tmp/cs_fn_${ts} '${safeEntry}' && /tmp/cs_fn_${ts}`]],
  };

  if (!cmds[runtime]) throw new Error(`No command mapping for runtime: "${runtime}"`);
  const [cmd, args] = cmds[runtime];
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
  if (!SUPPORTED_RUNTIMES.has(runtime)) throw new Error(`Unsupported runtime: "${runtime}"`);
  const entry = resolveFnEntry(fn.function);
  if (!entry) {
    logger.warn(`Function file not found: ${fn.function}`);
    return { error: `Function not found: ${fn.function}` };
  }
  if (runtime === 'js') return runJsFunction(entry, event, ctx);
  return runExternal(runtime, entry, event, ctx);
}

// ── Trigger registration ──────────────────────────────────────────────────────

const _cronTasks = [];

/** Register all function triggers on the Express app. */
function setupFunctions(app, functions) {
  if (!functions || !Object.keys(functions).length) return;
  for (const [name, fn] of Object.entries(functions)) {
    for (const trigger of (fn.triggers || [])) {
      registerTrigger(app, name, fn, trigger);
    }
  }
}

/** Stop all active cron tasks and worker processes (call before hot reload). */
function cleanup() {
  for (const task of _cronTasks) { try { task.stop(); } catch { /* */ } }
  _cronTasks.length = 0;
  for (const [, w] of _workers) { try { w.proc.kill(); } catch { /* */ } }
  _workers.clear();
}

function registerTrigger(app, name, fn, trigger) {
  switch (trigger.type) {
    case 'http':  registerHttp(app, name, fn, trigger);  break;
    case 'cron':  registerCron(name, fn, trigger);        break;
    case 'event': registerEvent(name, fn, trigger);       break;
    default: logger.warn(`[functions] Unknown trigger type "${trigger.type}" for "${name}"`);
  }
}

function registerHttp(app, name, fn, trigger) {
  const method = (trigger.method || 'GET').toLowerCase();
  const epPath = trigger.path;
  const middlewares = buildPolicyMiddlewares(trigger.policies);

  app[method](epPath, ...middlewares, async (req, res) => {
    const entry = resolveFnEntry(fn.function);
    if (!entry) {
      logger.warn(`[functions] File not found for "${name}": ${fn.function}`);
      return res.status(404).json({ error: `Function not found: ${fn.function}` });
    }
    try {
      const event  = { req, body: req.body, query: req.query, params: req.params, headers: req.headers };
      const ctx    = { trigger: 'http', method: req.method, path: epPath, name };
      const result = await runFunction(fn, event, ctx);
      if (!res.headersSent) {
        if (result && typeof result === 'object') return res.json(result);
        res.send(result ?? '');
      }
    } catch (e) {
      logger.error(`[functions] ${name} http error: ${e.message}`);
      if (!res.headersSent) res.status(500).json({ error: e.message });
    }
  });

  logger.info(`  Registered function: ${trigger.method || 'GET'} ${epPath} (${name})`);
}

// ── Policy middleware for HTTP triggers ───────────────────────────────────────

/**
 * Build Express middleware array from a policies definition.
 * With no policies (or `access: public`) the route is open to everyone.
 * Supports: public | restricted | admin | forbidden
 */
function buildPolicyMiddlewares(policies) {
  const { optionalAuth, requireAuth, JWT_SECRET } = require('./auth');
  const jwt = require('jsonwebtoken');
  if (!policies || !policies.length) return [optionalAuth];
  const p = policies[0];
  switch (p.access) {
    case 'public':
    case '🌐':
      return [optionalAuth];
    case 'restricted':
    case '🔒': {
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
    case 'admin':
    case '👨🏻‍💻':
      return [requireAuth()];
    case 'forbidden':
    case '🚫':
      return [(_r, res) => res.status(403).json({ error: 'Access forbidden' })];
    default:
      return [optionalAuth];
  }
}

function registerCron(name, fn, trigger) {
  const schedule = resolveSchedule(trigger.schedule);
  if (!cron.validate(schedule)) {
    logger.warn(`[functions] Invalid cron schedule "${trigger.schedule}" for "${name}"`);
    return;
  }
  const task = cron.schedule(schedule, async () => {
    try {
      await runFunction(fn, {}, { trigger: 'cron', schedule: trigger.schedule, name });
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
      await runFunction(fn, payload || {}, { trigger: 'event', event: eventName, name });
    } catch (e) {
      logger.error(`[functions] ${name} event error: ${e.message}`);
    }
  });
  logger.info(`  Registered event: "${eventName}" → ${name}`);
}

module.exports = { setupFunctions, cleanup, eventBus, resolveSchedule };

