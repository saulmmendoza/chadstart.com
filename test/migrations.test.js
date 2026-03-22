'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { buildCore } = require('../core/entity-engine');
const migrations = require('../core/migrations');

// ─── diffCores ────────────────────────────────────────────────────────────────

describe('migrations – diffCores', () => {
  it('detects a brand-new entity', () => {
    const oldCore = buildCore({ name: 'T', entities: {} });
    const newCore = buildCore({
      name: 'T',
      entities: { Post: { properties: ['title', 'body'] } },
    });
    // Remove Admin from both since it's auto-injected
    const diff = migrations.diffCores(oldCore, newCore);
    const postEntity = diff.newEntities.find((e) => e.name === 'Post');
    assert.ok(postEntity, 'Post should be a new entity');
    assert.strictEqual(postEntity.tableName, 'post');
  });

  it('detects new columns on an existing entity', () => {
    const oldCore = buildCore({
      name: 'T',
      entities: { Post: { properties: ['title'] } },
    });
    const newCore = buildCore({
      name: 'T',
      entities: { Post: { properties: ['title', 'body', 'rating'] } },
    });
    const diff = migrations.diffCores(oldCore, newCore);
    assert.strictEqual(diff.newEntities.filter((e) => e.name === 'Post').length, 0);
    const colNames = diff.newColumns
      .filter((c) => c.entity.name === 'Post')
      .map((c) => c.prop.name);
    assert.ok(colNames.includes('body'));
    assert.ok(colNames.includes('rating'));
    assert.ok(!colNames.includes('title'));
  });

  it('detects new belongsTo relation', () => {
    const oldCore = buildCore({
      name: 'T',
      entities: { Comment: { properties: ['body'] }, Post: { properties: ['title'] } },
    });
    const newCore = buildCore({
      name: 'T',
      entities: {
        Comment: { properties: ['body'], belongsTo: ['Post'] },
        Post: { properties: ['title'] },
      },
    });
    const diff = migrations.diffCores(oldCore, newCore);
    const fkCol = diff.newColumns.find(
      (c) => c.entity.name === 'Comment' && c.prop.name === 'post_id'
    );
    assert.ok(fkCol, 'should add post_id foreign key column');
  });

  it('detects new belongsToMany junction table', () => {
    const oldCore = buildCore({
      name: 'T',
      entities: { Player: { properties: ['name'] }, Skill: { properties: ['label'] } },
    });
    const newCore = buildCore({
      name: 'T',
      entities: {
        Player: { properties: ['name'], belongsToMany: ['Skill'] },
        Skill: { properties: ['label'] },
      },
    });
    const diff = migrations.diffCores(oldCore, newCore);
    assert.strictEqual(diff.newJunctionTables.length, 1);
    assert.strictEqual(diff.newJunctionTables[0].tableName, 'player_skill');
  });

  it('returns empty diff when nothing changed', () => {
    const core = buildCore({
      name: 'T',
      entities: { Post: { properties: ['title'] } },
    });
    const diff = migrations.diffCores(core, core);
    assert.strictEqual(diff.newEntities.length, 0);
    assert.strictEqual(diff.newColumns.length, 0);
    assert.strictEqual(diff.newJunctionTables.length, 0);
  });

  it('handles null oldCore (first migration)', () => {
    const newCore = buildCore({
      name: 'T',
      entities: { Post: { properties: ['title'] } },
    });
    const diff = migrations.diffCores(null, newCore);
    assert.ok(diff.newEntities.length > 0);
    assert.ok(diff.newEntities.some((e) => e.name === 'Post'));
  });

  it('detects authenticable flag change', () => {
    const oldCore = buildCore({
      name: 'T',
      admin: { enable_entity: false },
      entities: { User: { properties: ['name'] } },
    });
    const newCore = buildCore({
      name: 'T',
      admin: { enable_entity: false },
      entities: { User: { authenticable: true, properties: ['name'] } },
    });
    const diff = migrations.diffCores(oldCore, newCore);
    const emailCol = diff.newColumns.find(
      (c) => c.entity.name === 'User' && c.prop.name === 'email'
    );
    const passwordCol = diff.newColumns.find(
      (c) => c.entity.name === 'User' && c.prop.name === 'password'
    );
    assert.ok(emailCol, 'should add email column');
    assert.ok(passwordCol, 'should add password column');
  });
});

// ─── SQL generation ───────────────────────────────────────────────────────────

describe('migrations – SQL generation', () => {
  it('generateCreateTableSql produces valid SQL', () => {
    const core = buildCore({
      name: 'T',
      entities: { Post: { properties: ['title', { name: 'rating', type: 'integer' }] } },
    });
    const sql = migrations.generateCreateTableSql(core.entities.Post, core.entities);
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS'));
    assert.ok(sql.includes('"post"'));
    assert.ok(sql.includes('"id"'));
    assert.ok(sql.includes('"title"'));
    assert.ok(sql.includes('"rating"'));
    assert.ok(sql.includes('"createdAt"'));
    assert.ok(sql.includes('"updatedAt"'));
  });

  it('generateCreateTableSql includes foreign keys for belongsTo', () => {
    const core = buildCore({
      name: 'T',
      entities: {
        Comment: { properties: ['body'], belongsTo: ['Post'] },
        Post: { properties: ['title'] },
      },
    });
    const sql = migrations.generateCreateTableSql(core.entities.Comment, core.entities);
    assert.ok(sql.includes('"post_id"'));
    assert.ok(sql.includes('REFERENCES'));
  });

  it('generateCreateTableSql includes auth columns for authenticable entity', () => {
    const core = buildCore({
      name: 'T',
      admin: { enable_entity: false },
      entities: { User: { authenticable: true, properties: ['name'] } },
    });
    const sql = migrations.generateCreateTableSql(core.entities.User, core.entities);
    assert.ok(sql.includes('"email"'));
    assert.ok(sql.includes('"password"'));
    assert.ok(sql.includes('NOT NULL'));
    assert.ok(sql.includes('UNIQUE'));
  });

  it('generateDropTableSql produces valid SQL', () => {
    const core = buildCore({ name: 'T', entities: { Post: { properties: ['title'] } } });
    const sql = migrations.generateDropTableSql(core.entities.Post);
    assert.ok(sql.includes('DROP TABLE IF EXISTS'));
    assert.ok(sql.includes('"post"'));
  });

  it('generateAddColumnSql produces valid SQL', () => {
    const core = buildCore({ name: 'T', entities: { Post: { properties: ['title'] } } });
    const sql = migrations.generateAddColumnSql(core.entities.Post, { name: 'body', type: 'text' });
    assert.ok(sql.includes('ALTER TABLE'));
    assert.ok(sql.includes('"post"'));
    assert.ok(sql.includes('"body"'));
    assert.ok(sql.includes('TEXT'));
  });

  it('generateCreateJunctionSql produces valid SQL', () => {
    const sql = migrations.generateCreateJunctionSql({
      tableName: 'player_skill',
      tableA: 'player',
      tableB: 'skill',
    });
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS'));
    assert.ok(sql.includes('"player_skill"'));
    assert.ok(sql.includes('"player_id"'));
    assert.ok(sql.includes('"skill_id"'));
    assert.ok(sql.includes('PRIMARY KEY'));
  });
});

// ─── Migration scripts generation ─────────────────────────────────────────────

describe('migrations – generateMigrationScripts', () => {
  it('generates do and undo scripts from diff', () => {
    const oldCore = buildCore({ name: 'T', entities: {} });
    const newCore = buildCore({
      name: 'T',
      entities: { Post: { properties: ['title'] } },
    });
    const diff = migrations.diffCores(oldCore, newCore);
    const scripts = migrations.generateMigrationScripts(diff, newCore.entities);

    assert.ok(scripts.do.includes('CREATE TABLE IF NOT EXISTS'));
    assert.ok(scripts.undo.includes('DROP TABLE IF EXISTS'));
  });

  it('returns empty strings for empty diff', () => {
    const diff = { newEntities: [], newColumns: [], newJunctionTables: [] };
    const scripts = migrations.generateMigrationScripts(diff, {});
    assert.strictEqual(scripts.do, '');
    assert.strictEqual(scripts.undo, '');
  });
});

// ─── File operations ──────────────────────────────────────────────────────────

describe('migrations – file operations', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `chadstart-mig-test-${Date.now()}`);
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('getNextVersion returns 1 when directory does not exist', () => {
    assert.strictEqual(migrations.getNextVersion(tmpDir), 1);
  });

  it('getNextVersion returns 1 when directory is empty', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    assert.strictEqual(migrations.getNextVersion(tmpDir), 1);
  });

  it('getNextVersion increments based on existing files', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '001.do.initial.sql'), 'SELECT 1;');
    fs.writeFileSync(path.join(tmpDir, '001.undo.initial.sql'), 'SELECT 1;');
    fs.writeFileSync(path.join(tmpDir, '002.do.add-posts.sql'), 'SELECT 1;');
    assert.strictEqual(migrations.getNextVersion(tmpDir), 3);
  });

  it('writeMigrationFiles creates do and undo files', () => {
    const result = migrations.writeMigrationFiles(
      tmpDir,
      'CREATE TABLE test (id TEXT);',
      'DROP TABLE test;',
      'create-test-table'
    );

    assert.ok(fs.existsSync(result.doPath));
    assert.ok(fs.existsSync(result.undoPath));
    assert.strictEqual(result.version, 1);

    const doContent = fs.readFileSync(result.doPath, 'utf8');
    assert.ok(doContent.includes('CREATE TABLE test'));

    const undoContent = fs.readFileSync(result.undoPath, 'utf8');
    assert.ok(undoContent.includes('DROP TABLE test'));

    assert.ok(path.basename(result.doPath).includes('create-test-table'));
    assert.ok(path.basename(result.undoPath).includes('create-test-table'));
  });

  it('writeMigrationFiles auto-increments version', () => {
    const r1 = migrations.writeMigrationFiles(tmpDir, 'SQL 1', 'UNDO 1', 'first');
    const r2 = migrations.writeMigrationFiles(tmpDir, 'SQL 2', 'UNDO 2', 'second');
    assert.strictEqual(r1.version, 1);
    assert.strictEqual(r2.version, 2);
  });

  it('writeMigrationFiles works without description', () => {
    const result = migrations.writeMigrationFiles(tmpDir, 'SQL', 'UNDO');
    assert.ok(fs.existsSync(result.doPath));
    assert.ok(path.basename(result.doPath).startsWith('001.do.sql'));
  });
});

// ─── generateMigration (high-level) ──────────────────────────────────────────

describe('migrations – generateMigration', () => {
  let tmpDir, yamlDir, yamlPath;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `chadstart-mig-gen-${Date.now()}`);
    yamlDir = path.join(tmpDir, 'project');
    fs.mkdirSync(yamlDir, { recursive: true });
    yamlPath = path.join(yamlDir, 'chadstart.yaml');
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('generates migration files when YAML has entities (no git history)', () => {
    const YAML = require('yaml');
    const config = {
      name: 'TestApp',
      entities: {
        Post: { properties: ['title', 'body'] },
        Comment: { properties: ['text'], belongsTo: ['Post'] },
      },
    };
    fs.writeFileSync(yamlPath, YAML.stringify(config), 'utf8');

    const migDir = path.join(tmpDir, 'migrations');
    const result = migrations.generateMigration(yamlPath, migDir, 'initial');

    assert.strictEqual(result.isEmpty, false);
    assert.ok(fs.existsSync(result.doPath));
    assert.ok(fs.existsSync(result.undoPath));

    const doSql = fs.readFileSync(result.doPath, 'utf8');
    assert.ok(doSql.includes('"post"'));
    assert.ok(doSql.includes('"comment"'));
    assert.ok(doSql.includes('"title"'));
  });
});

// ─── User-written SQL migration files ─────────────────────────────────────────

describe('migrations – user-written SQL files', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `chadstart-usersql-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('user can place SQL files in migrations dir and getNextVersion accounts for them', () => {
    // Simulate user-written SQL migration files
    fs.writeFileSync(
      path.join(tmpDir, '001.do.custom-index.sql'),
      'CREATE INDEX idx_post_title ON post (title);'
    );
    fs.writeFileSync(
      path.join(tmpDir, '001.undo.custom-index.sql'),
      'DROP INDEX idx_post_title;'
    );

    // Next auto-generated migration should be version 2
    assert.strictEqual(migrations.getNextVersion(tmpDir), 2);

    // User writes another SQL file at version 2
    fs.writeFileSync(
      path.join(tmpDir, '002.do.add-view.sql'),
      'CREATE VIEW recent_posts AS SELECT * FROM post ORDER BY createdAt DESC LIMIT 10;'
    );
    fs.writeFileSync(
      path.join(tmpDir, '002.undo.add-view.sql'),
      'DROP VIEW recent_posts;'
    );

    // Next should be 3
    assert.strictEqual(migrations.getNextVersion(tmpDir), 3);
  });

  it('auto-generated and user-written files can coexist', () => {
    // User writes a custom migration first
    fs.writeFileSync(
      path.join(tmpDir, '001.do.custom-seed.sql'),
      "INSERT INTO settings (key, val) VALUES ('version', '1.0');"
    );
    fs.writeFileSync(
      path.join(tmpDir, '001.undo.custom-seed.sql'),
      "DELETE FROM settings WHERE key = 'version';"
    );

    // Then auto-generate
    const result = migrations.writeMigrationFiles(
      tmpDir,
      'CREATE TABLE foo (id TEXT);',
      'DROP TABLE foo;',
      'auto-generated'
    );

    assert.strictEqual(result.version, 2);
    assert.ok(fs.existsSync(result.doPath));

    // Verify all files exist
    const files = fs.readdirSync(tmpDir).sort();
    assert.strictEqual(files.length, 4); // 001.do, 001.undo, 002.do, 002.undo
  });
});

// ─── Postgrator integration ──────────────────────────────────────────────────

describe('migrations – postgrator integration', () => {
  let tmpDir, dbModule, tmpDb, execQueryFn;

  before(async () => {
    tmpDir = path.join(os.tmpdir(), `chadstart-postgrator-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    tmpDb = path.join(tmpDir, 'test.db');

    // Initialize a simple database
    dbModule = require('../core/db');
    const core = buildCore({ name: 'T', entities: {} });
    await dbModule.initDb(core, tmpDb);
    execQueryFn = migrations.buildExecQueryFn(dbModule);
  });

  after(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('runMigrations returns empty when no directory exists', async () => {
    const nonExistent = path.join(tmpDir, 'no-such-dir');
    const applied = await migrations.runMigrations(nonExistent, execQueryFn);
    assert.deepStrictEqual(applied, []);
  });

  it('runMigrations applies SQL files and returns applied migrations', async () => {
    const migDir = path.join(tmpDir, 'mig1');
    fs.mkdirSync(migDir, { recursive: true });

    // Write a migration that creates a table
    fs.writeFileSync(
      path.join(migDir, '001.do.create-items.sql'),
      'CREATE TABLE IF NOT EXISTS "items" ("id" TEXT PRIMARY KEY, "name" TEXT);'
    );
    fs.writeFileSync(
      path.join(migDir, '001.undo.create-items.sql'),
      'DROP TABLE IF EXISTS "items";'
    );

    const applied = await migrations.runMigrations(migDir, execQueryFn);
    assert.ok(applied.length >= 1);

    // Verify the table was created
    const tables = dbModule.getDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='items'").all();
    assert.strictEqual(tables.length, 1);
  });

  it('runMigrations is idempotent (no-op on re-run)', async () => {
    const migDir = path.join(tmpDir, 'mig1');
    const applied = await migrations.runMigrations(migDir, execQueryFn);
    assert.strictEqual(applied.length, 0);
  });

  it('getMigrationStatus reports correct status', async () => {
    const migDir = path.join(tmpDir, 'mig1');
    const status = await migrations.getMigrationStatus(migDir, execQueryFn);
    assert.strictEqual(status.currentVersion, 1);
    assert.strictEqual(status.applied.length, 1);
    assert.strictEqual(status.pending.length, 0);
  });

  it('getMigrationStatus shows pending after adding a new migration', async () => {
    const migDir = path.join(tmpDir, 'mig1');

    // Add a second migration
    fs.writeFileSync(
      path.join(migDir, '002.do.add-color.sql'),
      'ALTER TABLE "items" ADD COLUMN "color" TEXT;'
    );
    fs.writeFileSync(
      path.join(migDir, '002.undo.add-color.sql'),
      '-- Cannot drop column in SQLite'
    );

    const status = await migrations.getMigrationStatus(migDir, execQueryFn);
    assert.strictEqual(status.currentVersion, 1);
    assert.strictEqual(status.pending.length, 1);
  });

  it('getMigrationStatus returns defaults when dir does not exist', async () => {
    const status = await migrations.getMigrationStatus(
      path.join(tmpDir, 'nonexistent'),
      execQueryFn
    );
    assert.strictEqual(status.currentVersion, 0);
    assert.strictEqual(status.pending.length, 0);
    assert.strictEqual(status.applied.length, 0);
  });
});
