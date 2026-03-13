/**
 * Build script: converts sdk/src/index.js (ESM) into:
 *   dist/index.js   (ESM, unchanged)
 *   dist/index.cjs  (CommonJS, wrapped)
 *
 * No external dependencies required — uses only Node.js built-ins.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const src = readFileSync(join(root, 'src', 'index.js'), 'utf8');

// ── ESM build (verbatim copy) ─────────────────────────────────────────────────
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'index.js'), src, 'utf8');

// ── CJS build ─────────────────────────────────────────────────────────────────
// Strip ESM export statements and wrap in a CJS module.
let cjs = src;

// Remove `export default Chadstart;`
cjs = cjs.replace(/^export default \w+;\n?/m, '');

// Remove named export line: `export { Chadstart, ... };`
cjs = cjs.replace(/^export \{[^}]+\};\n?/m, '');

// Remove `export ` keyword from class/function declarations
cjs = cjs.replace(/^export (class|function|const|let|var) /gm, '$1 ');

// Append CommonJS exports at the end
cjs += `
// CommonJS exports
Object.defineProperty(exports, '__esModule', { value: true });
exports.default = Chadstart;
exports.Chadstart = Chadstart;
exports.ChadstartError = ChadstartError;
exports.CollectionQuery = CollectionQuery;
exports.SingleQuery = SingleQuery;
exports.AuthQuery = AuthQuery;
module.exports = exports.default;
module.exports.default = exports.default;
module.exports.Chadstart = Chadstart;
module.exports.ChadstartError = ChadstartError;
module.exports.CollectionQuery = CollectionQuery;
module.exports.SingleQuery = SingleQuery;
module.exports.AuthQuery = AuthQuery;
`;

// Replace the ESM import/export template with a CJS-safe header
writeFileSync(join(root, 'dist', 'index.cjs'), `'use strict';\n\n${cjs}`, 'utf8');

console.log('✓ dist/index.js  (ESM)');
console.log('✓ dist/index.cjs (CJS)');
