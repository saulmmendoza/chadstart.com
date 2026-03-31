'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { buildCore } = require('../core/entity-engine');
const dbModule = require('../core/db');
const { getBackupDir, createBackup, restoreBackup, listBackups } = require('../core/backup');
const { validateSchema } = require('../core/schema-validator');

// ── Backup module ──────────────────────────────────────────────────────────

describe('backup module', () => {
  let tmpDb;
  let tmpBackupDir;
  const core = buildCore({
    name: 'BackupTest',
    entities: { Widget: { properties: ['name'] } },
    backup: {},
  });

  before(async () => {
    tmpDb = path.join(os.tmpdir(), `chadstart-backup-test-${Date.now()}.db`);
    tmpBackupDir = path.join(os.tmpdir(), `chadstart-backups-${Date.now()}`);
    await dbModule.initDb(core, tmpDb);
  });

  after(() => {
    try { fs.unlinkSync(tmpDb); } catch { /* noop */ }
    // Clean up backup dir
    try {
      if (fs.existsSync(tmpBackupDir)) {
        for (const f of fs.readdirSync(tmpBackupDir)) {
          fs.unlinkSync(path.join(tmpBackupDir, f));
        }
        fs.rmdirSync(tmpBackupDir);
      }
    } catch { /* noop */ }
  });

  it('getBackupDir creates directory', () => {
    const dir = getBackupDir({ dir: tmpBackupDir });
    assert.ok(fs.existsSync(dir));
    assert.strictEqual(dir, tmpBackupDir);
  });

  it('getBackupDir uses default when no config', () => {
    const dir = getBackupDir(null);
    assert.ok(typeof dir === 'string');
    assert.ok(dir.includes('backups'));
    // Clean up the auto-created default dir
    try { fs.rmdirSync(path.resolve('backups')); } catch { /* may not exist or not empty */ }
  });

  it('createBackup creates a backup file (SQLite)', async () => {
    // Insert some data first
    await dbModule.create('widget', { name: 'Backup Test Item' });

    const result = await createBackup({ dir: tmpBackupDir });
    assert.ok(result.file);
    assert.ok(result.file.startsWith('backup-'));
    assert.ok(result.file.endsWith('.db'));
    assert.ok(result.size > 0);
    assert.strictEqual(result.engine, 'sqlite');
    assert.ok(fs.existsSync(result.path));
  });

  it('listBackups returns the backup we just created', () => {
    const backups = listBackups({ dir: tmpBackupDir });
    assert.ok(backups.length >= 1);
    assert.ok(backups[0].file.startsWith('backup-'));
    assert.ok(backups[0].size > 0);
    assert.ok(backups[0].createdAt);
  });

  it('listBackups sorts newest first', async () => {
    // Create a second backup
    await createBackup({ dir: tmpBackupDir });
    const backups = listBackups({ dir: tmpBackupDir });
    assert.ok(backups.length >= 2);
    // Newest first
    assert.ok(backups[0].createdAt >= backups[1].createdAt);
  });

  it('listBackups returns empty for non-existent dir', () => {
    const nonExistDir = path.join(os.tmpdir(), `nonexistent-${Date.now()}`);
    const backups = listBackups({ dir: nonExistDir });
    // getBackupDir creates the dir, so it returns empty array
    assert.ok(Array.isArray(backups));
    assert.strictEqual(backups.length, 0);
    // Clean up
    try { fs.rmdirSync(nonExistDir); } catch { /* noop */ }
  });

  it('restoreBackup fails for non-existent file', async () => {
    const result = await restoreBackup('nonexistent.db', { dir: tmpBackupDir });
    assert.strictEqual(result.success, false);
    assert.ok(result.message.includes('not found'));
  });

  it('restoreBackup prevents path traversal', async () => {
    const result = await restoreBackup('../../etc/passwd', { dir: tmpBackupDir });
    assert.strictEqual(result.success, false);
    // basename('../../etc/passwd') = 'passwd', which won't exist in backup dir
    assert.ok(result.message.includes('not found'));
  });
});

// ── Schema validation ───────────────────────────────────────────────────

describe('schema: backup', () => {
  it('accepts config without backup section', () => {
    assert.strictEqual(validateSchema({ name: 'App' }), true);
  });

  it('accepts backup with dir', () => {
    assert.strictEqual(validateSchema({ name: 'App', backup: { dir: 'my-backups' } }), true);
  });

  it('accepts empty backup object', () => {
    assert.strictEqual(validateSchema({ name: 'App', backup: {} }), true);
  });

  it('rejects unknown backup key', () => {
    assert.throws(() => validateSchema({
      name: 'App',
      backup: { schedule: '0 3 * * *' },
    }));
  });
});

// ── buildCore: backup passthrough ───────────────────────────────────────

describe('buildCore: backup passthrough', () => {
  it('exposes backup config when provided', () => {
    const core = buildCore({ name: 'App', backup: { dir: 'my-backups' } });
    assert.ok(core.backup);
    assert.strictEqual(core.backup.dir, 'my-backups');
  });

  it('sets backup to null when not provided', () => {
    const core = buildCore({ name: 'App' });
    assert.strictEqual(core.backup, null);
  });
});
