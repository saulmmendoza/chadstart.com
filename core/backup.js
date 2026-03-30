'use strict';

/**
 * Backup & Restore module for ChadStart.
 *
 * Supports SQLite (file copy), PostgreSQL (pg_dump), and MySQL (mysqldump).
 *
 * Configuration via YAML `backup` section:
 *   backup:
 *     dir: backups           # Directory for backup files (default: backups)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const db = require('./db');
const logger = require('../utils/logger');

const DB_ENGINE = db.DB_ENGINE;

/**
 * Get the backup directory. Creates it if it doesn't exist.
 *
 * @param {object|null} backupCfg  Value of `core.backup` (may be null).
 * @returns {string}               Absolute path to backup directory.
 */
function getBackupDir(backupCfg) {
  const dir = (backupCfg && backupCfg.dir) || process.env.BACKUP_DIR || 'backups';
  const resolved = path.resolve(dir);
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

/**
 * Generate a backup filename with timestamp.
 *
 * @param {string} ext  File extension (e.g. 'db', 'sql').
 * @returns {string}
 */
function generateBackupName(ext) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const id = crypto.randomBytes(4).toString('hex');
  return `backup-${ts}-${id}.${ext}`;
}

/**
 * Create a backup of the database.
 *
 * @param {object|null} backupCfg  Value of `core.backup` (may be null).
 * @returns {{ file: string, path: string, size: number, engine: string }}
 */
async function createBackup(backupCfg) {
  const dir = getBackupDir(backupCfg);

  if (DB_ENGINE === 'sqlite') {
    const sqliteDb = db.getDb();
    const name = generateBackupName('db');
    const dest = path.join(dir, name);
    await sqliteDb.backup(dest);
    const stats = fs.statSync(dest);
    logger.info(`Backup created: ${dest} (${stats.size} bytes)`);
    return { file: name, path: dest, size: stats.size, engine: 'sqlite' };
  }

  if (DB_ENGINE === 'postgres') {
    const name = generateBackupName('sql');
    const dest = path.join(dir, name);
    const args = [
      '-h', process.env.DB_HOST || 'localhost',
      '-p', process.env.DB_PORT || '5432',
      '-U', process.env.DB_USERNAME || 'postgres',
      '-d', process.env.DB_DATABASE || 'manifest',
      '-f', dest,
    ];
    execFileSync('pg_dump', args, {
      env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || 'postgres' },
      timeout: 120000,
    });
    const stats = fs.statSync(dest);
    logger.info(`Backup created: ${dest} (${stats.size} bytes)`);
    return { file: name, path: dest, size: stats.size, engine: 'postgres' };
  }

  if (DB_ENGINE === 'mysql') {
    const name = generateBackupName('sql');
    const dest = path.join(dir, name);
    const args = [
      '-h', process.env.DB_HOST || 'localhost',
      '-P', process.env.DB_PORT || '3306',
      '-u', process.env.DB_USERNAME || 'root',
      `--result-file=${dest}`,
      process.env.DB_DATABASE || 'manifest',
    ];
    const env = { ...process.env };
    if (process.env.DB_PASSWORD) env.MYSQL_PWD = process.env.DB_PASSWORD;
    execFileSync('mysqldump', args, { env, timeout: 120000 });
    const stats = fs.statSync(dest);
    logger.info(`Backup created: ${dest} (${stats.size} bytes)`);
    return { file: name, path: dest, size: stats.size, engine: 'mysql' };
  }

  throw new Error(`Unsupported database engine for backup: ${DB_ENGINE}`);
}

/**
 * Restore a database from a backup file.
 *
 * @param {string} backupFile  Filename of the backup (relative to backup dir).
 * @param {object|null} backupCfg  Value of `core.backup` (may be null).
 * @returns {{ success: boolean, message: string }}
 */
async function restoreBackup(backupFile, backupCfg) {
  const dir = getBackupDir(backupCfg);
  const src = path.join(dir, path.basename(backupFile)); // basename to prevent path traversal

  if (!fs.existsSync(src)) {
    return { success: false, message: `Backup file not found: ${backupFile}` };
  }

  if (DB_ENGINE === 'sqlite') {
    const sqliteDb = db.getDb();
    const dbPath = sqliteDb.name;
    // Close, copy, re-open would require server restart — use SQLite's deserialization
    // For simplicity, copy the backup over the current DB file
    sqliteDb.close();
    fs.copyFileSync(src, dbPath);
    logger.info(`Restored backup: ${src} → ${dbPath}`);
    return { success: true, message: `Database restored from ${backupFile}. Server restart may be required.` };
  }

  if (DB_ENGINE === 'postgres') {
    const args = [
      '-h', process.env.DB_HOST || 'localhost',
      '-p', process.env.DB_PORT || '5432',
      '-U', process.env.DB_USERNAME || 'postgres',
      '-d', process.env.DB_DATABASE || 'manifest',
      '-f', src,
    ];
    execFileSync('psql', args, {
      env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || 'postgres' },
      timeout: 120000,
    });
    logger.info(`Restored backup: ${src}`);
    return { success: true, message: `Database restored from ${backupFile}` };
  }

  if (DB_ENGINE === 'mysql') {
    const content = fs.readFileSync(src, 'utf-8');
    const args = [
      '-h', process.env.DB_HOST || 'localhost',
      '-P', process.env.DB_PORT || '3306',
      '-u', process.env.DB_USERNAME || 'root',
      process.env.DB_DATABASE || 'manifest',
    ];
    const env = { ...process.env };
    if (process.env.DB_PASSWORD) env.MYSQL_PWD = process.env.DB_PASSWORD;
    execFileSync('mysql', args, { env, input: content, timeout: 120000 });
    logger.info(`Restored backup: ${src}`);
    return { success: true, message: `Database restored from ${backupFile}` };
  }

  return { success: false, message: `Unsupported database engine: ${DB_ENGINE}` };
}

/**
 * List available backups.
 *
 * @param {object|null} backupCfg  Value of `core.backup` (may be null).
 * @returns {Array<{ file: string, size: number, createdAt: string }>}
 */
function listBackups(backupCfg) {
  const dir = getBackupDir(backupCfg);
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter((f) => f.startsWith('backup-'))
    .map((f) => {
      const stats = fs.statSync(path.join(dir, f));
      return { file: f, size: stats.size, createdAt: stats.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest first
}

module.exports = {
  getBackupDir,
  createBackup,
  restoreBackup,
  listBackups,
};
