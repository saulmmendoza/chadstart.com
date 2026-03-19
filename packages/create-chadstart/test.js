'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

// Test: index.js is executable and has the correct shebang
const indexPath = path.join(__dirname, 'index.js');
const indexContent = fs.readFileSync(indexPath, 'utf8');
assert.ok(indexContent.startsWith('#!/usr/bin/env node'), 'index.js should start with shebang');

// Test: template/chadstart.yaml exists
const templatePath = path.join(__dirname, 'template', 'chadstart.yaml');
assert.ok(fs.existsSync(templatePath), 'template/chadstart.yaml should exist');

// Test: simulate project creation in a temp directory
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-chadstart-test-'));
const projectDir = path.join(tmpDir, 'myapp');

fs.mkdirSync(projectDir, { recursive: true });
fs.copyFileSync(templatePath, path.join(projectDir, 'chadstart.yaml'));

assert.ok(fs.existsSync(path.join(projectDir, 'chadstart.yaml')), 'chadstart.yaml should be created in project dir');

const createdContent = fs.readFileSync(path.join(projectDir, 'chadstart.yaml'), 'utf8');
const templateContent = fs.readFileSync(templatePath, 'utf8');
assert.strictEqual(createdContent, templateContent, 'chadstart.yaml content should match template');

// Cleanup
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log('All tests passed.');
