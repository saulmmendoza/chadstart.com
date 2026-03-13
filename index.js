'use strict';

/**
 * ChadStart — YAML-first Backend as a Service
 *
 * Programmatic API:
 *   const { createServer, startServer } = require('chadstart');
 *   await startServer('./chadstart.yaml');
 */

module.exports = require('./server/express-server');
