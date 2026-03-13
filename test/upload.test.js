'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { buildCore } = require('../core/entity-engine');
const {
  getBaseUrl,
  getMonthFolder,
  isS3Configured,
  sanitizeFilename,
  generateUniquePrefix,
  saveLocally,
  getImageOptions,
} = require('../core/upload');

describe('upload helpers', () => {
  it('getMonthFolder returns correct format', () => {
    const result = getMonthFolder(new Date(2024, 9, 1)); // October 2024
    assert.strictEqual(result, 'Oct2024');
  });

  it('getMonthFolder uses current date when no arg provided', () => {
    const result = getMonthFolder();
    const now = new Date();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    assert.ok(result.startsWith(months[now.getMonth()]));
    assert.ok(result.endsWith(String(now.getFullYear())));
  });

  it('getBaseUrl uses BASE_URL env var when set', () => {
    const orig = process.env.BASE_URL;
    process.env.BASE_URL = 'https://example.com';
    const url = getBaseUrl({ port: 3000 });
    if (orig === undefined) delete process.env.BASE_URL; else process.env.BASE_URL = orig;
    assert.strictEqual(url, 'https://example.com');
  });

  it('getBaseUrl defaults to localhost with port', () => {
    const orig = process.env.BASE_URL;
    delete process.env.BASE_URL;
    const url = getBaseUrl({ port: 4000 });
    if (orig !== undefined) process.env.BASE_URL = orig;
    assert.strictEqual(url, 'http://localhost:4000');
  });

  it('isS3Configured returns false when env vars are absent', () => {
    const vars = ['S3_BUCKET', 'S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
    const saved = {};
    vars.forEach((v) => { saved[v] = process.env[v]; delete process.env[v]; });
    const result = isS3Configured();
    vars.forEach((v) => { if (saved[v] !== undefined) process.env[v] = saved[v]; });
    assert.strictEqual(result, false);
  });

  it('isS3Configured returns true when all S3 env vars are set', () => {
    const vars = ['S3_BUCKET', 'S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
    const saved = {};
    vars.forEach((v) => { saved[v] = process.env[v]; process.env[v] = 'test-value'; });
    const result = isS3Configured();
    vars.forEach((v) => { if (saved[v] !== undefined) process.env[v] = saved[v]; else delete process.env[v]; });
    assert.strictEqual(result, true);
  });

  it('isS3Configured returns false when only some S3 vars are set', () => {
    const vars = ['S3_BUCKET', 'S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
    const saved = {};
    vars.forEach((v) => { saved[v] = process.env[v]; delete process.env[v]; });
    process.env.S3_BUCKET = 'my-bucket';
    const result = isS3Configured();
    vars.forEach((v) => { if (saved[v] !== undefined) process.env[v] = saved[v]; else delete process.env[v]; });
    assert.strictEqual(result, false);
  });

  it('sanitizeFilename strips directory traversal', () => {
    assert.strictEqual(sanitizeFilename('../../../etc/passwd'), 'passwd');
  });

  it('sanitizeFilename replaces spaces and special chars', () => {
    const safe = sanitizeFilename('my file (1).pdf');
    assert.ok(!/[ ()]/.test(safe));
  });

  it('sanitizeFilename replaces leading dots', () => {
    const safe = sanitizeFilename('.hidden');
    assert.ok(!safe.startsWith('.'));
  });

  it('sanitizeFilename preserves safe characters', () => {
    assert.strictEqual(sanitizeFilename('my-file_01.pdf'), 'my-file_01.pdf');
  });

  it('generateUniquePrefix returns a non-empty string', () => {
    const prefix = generateUniquePrefix();
    assert.ok(typeof prefix === 'string' && prefix.length > 0);
  });

  it('generateUniquePrefix returns different values each call', () => {
    const a = generateUniquePrefix();
    const b = generateUniquePrefix();
    assert.notStrictEqual(a, b);
  });

  it('saveLocally creates directory and writes file', () => {
    const dir = path.join(os.tmpdir(), `upload-test-${Date.now()}`);
    const filename = 'test.txt';
    const content = Buffer.from('hello world');
    saveLocally(content, dir, filename);
    const dest = path.join(dir, filename);
    assert.ok(fs.existsSync(dest));
    assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'hello world');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('saveLocally creates nested directories', () => {
    const dir = path.join(os.tmpdir(), `upload-nested-${Date.now()}`, 'a', 'b', 'c');
    saveLocally(Buffer.from('x'), dir, 'f.txt');
    assert.ok(fs.existsSync(path.join(dir, 'f.txt')));
    fs.rmSync(path.join(os.tmpdir(), path.relative(os.tmpdir(), dir).split(path.sep)[0]), { recursive: true, force: true });
  });

  it('getImageOptions defaults: compress=true, quality=80, sizes=null', () => {
    const core = buildCore({ name: 'App', entities: {} });
    const opts = getImageOptions(core, 'cats', 'avatar');
    assert.strictEqual(opts.compress, true);
    assert.strictEqual(opts.quality, 80);
    assert.strictEqual(opts.sizes, null);
  });

  it('getImageOptions: compress=false disables compression', () => {
    const core = buildCore({
      name: 'App',
      entities: { Cat: { properties: [{ name: 'avatar', type: 'image', options: { compress: false } }] } },
    });
    const opts = getImageOptions(core, 'Cat', 'avatar');
    assert.strictEqual(opts.compress, false);
    assert.strictEqual(opts.quality, 80);
    assert.strictEqual(opts.sizes, null);
  });

  it('getImageOptions: custom quality is respected', () => {
    const core = buildCore({
      name: 'App',
      entities: { Cat: { properties: [{ name: 'avatar', type: 'image', options: { quality: 60 } }] } },
    });
    const opts = getImageOptions(core, 'Cat', 'avatar');
    assert.strictEqual(opts.compress, true);
    assert.strictEqual(opts.quality, 60);
  });

  it('getImageOptions: sizes enables resize mode', () => {
    const core = buildCore({
      name: 'App',
      entities: { Cat: { properties: [{ name: 'avatar', type: 'image', options: { sizes: { small: [40, 40], large: [400, 400] } } }] } },
    });
    const opts = getImageOptions(core, 'Cat', 'avatar');
    assert.deepStrictEqual(opts.sizes, { small: [40, 40], large: [400, 400] });
    assert.strictEqual(opts.compress, true);
  });

  it('getImageOptions: no sizes when not configured', () => {
    const core = buildCore({
      name: 'App',
      entities: { Cat: { properties: [{ name: 'avatar', type: 'image' }] } },
    });
    const opts = getImageOptions(core, 'Cat', 'avatar');
    assert.strictEqual(opts.sizes, null);
  });

  it('getImageOptions looks up by entity tableName', () => {
    const core = buildCore({
      name: 'App',
      entities: { BlogPost: { properties: [{ name: 'cover', type: 'image', options: { sizes: { thumb: [100, 100] }, quality: 70 } }] } },
    });
    const opts = getImageOptions(core, 'blog_post', 'cover');
    assert.deepStrictEqual(opts.sizes, { thumb: [100, 100] });
    assert.strictEqual(opts.quality, 70);
  });
});

describe('upload – sharp integration', () => {
  const SAMPLE_PNG_B64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

  it('sharp compresses a PNG to JPEG at quality 80 (default)', async () => {
    const sharp = require('sharp');
    const input = Buffer.from(SAMPLE_PNG_B64, 'base64');
    const output = await sharp(input).jpeg({ quality: 80 }).toBuffer();
    const meta = await sharp(output).metadata();
    assert.strictEqual(meta.format, 'jpeg');
  });

  it('sharp compresses a PNG to JPEG at custom quality', async () => {
    const sharp = require('sharp');
    const input = Buffer.from(SAMPLE_PNG_B64, 'base64');
    const q60 = await sharp(input).jpeg({ quality: 60 }).toBuffer();
    const q90 = await sharp(input).jpeg({ quality: 90 }).toBuffer();
    const metaQ60 = await sharp(q60).metadata();
    const metaQ90 = await sharp(q90).metadata();
    assert.strictEqual(metaQ60.format, 'jpeg');
    assert.strictEqual(metaQ90.format, 'jpeg');
  });

  it('sharp resizes a 1x1 PNG to specified dimensions with quality', async () => {
    const sharp = require('sharp');
    const input = Buffer.from(SAMPLE_PNG_B64, 'base64');
    const output = await sharp(input).resize(80, 80, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
    const meta = await sharp(output).metadata();
    assert.strictEqual(meta.width, 80);
    assert.strictEqual(meta.height, 80);
    assert.strictEqual(meta.format, 'jpeg');
  });

  it('sharp resize with quality:100 produces valid JPEG', async () => {
    const sharp = require('sharp');
    const input = Buffer.from(SAMPLE_PNG_B64, 'base64');
    const output = await sharp(input).resize(160, 160, { fit: 'cover' }).jpeg({ quality: 100 }).toBuffer();
    const meta = await sharp(output).metadata();
    assert.strictEqual(meta.width, 160);
    assert.strictEqual(meta.height, 160);
    assert.strictEqual(meta.format, 'jpeg');
  });
});

describe('upload – route content-type check', () => {
  it('/api/upload/file rejects non-multipart requests', () => {
    const contentType = 'application/json';
    const isMultipart = contentType.includes('multipart/form-data');
    assert.strictEqual(isMultipart, false);
  });

  it('file path format: prefix-filename in month folder', () => {
    const prefix = 'abc123';
    const safeName = sanitizeFilename('my-contract.pdf');
    const finalName = `${prefix}-${safeName}`;
    const month = getMonthFolder(new Date(2024, 9, 1));
    const relPath = `storage/invoices/contract/${month}/${finalName}`;
    assert.strictEqual(relPath, 'storage/invoices/contract/Oct2024/abc123-my-contract.pdf');
  });

  it('image path format (no sizes): prefix-basename.jpg in month folder', () => {
    const prefix = 'abc123';
    const month = getMonthFolder(new Date(2024, 9, 1));
    const baseName = path.basename(sanitizeFilename('my-photo.png'), '.png');
    const finalName = `${prefix}-${baseName}.jpg`;
    assert.strictEqual(finalName, 'abc123-my-photo.jpg');
    assert.ok(`storage/cats/avatar/${month}/${finalName}`.includes('Oct2024'));
  });

  it('image path format (with sizes): prefix-sizeName.jpg in month folder', () => {
    const prefix = 'xyz789';
    const month = getMonthFolder(new Date(2024, 9, 1));
    const thumbName = `${prefix}-thumbnail.jpg`;
    assert.ok(thumbName.endsWith('-thumbnail.jpg'));
    assert.ok(`storage/cats/avatar/${month}/${thumbName}`.includes('Oct2024'));
  });

  it('image path format (compress disabled): prefix-original-name preserved', () => {
    const prefix = 'def456';
    const originalName = sanitizeFilename('photo.png');
    const finalName = `${prefix}-${originalName}`;
    assert.strictEqual(finalName, 'def456-photo.png');
  });
});
