---
id: migrations
title: Database Migrations
description: Track and apply database schema changes with version-controlled SQL migration files. Auto-generate from YAML diffs or write custom SQL.
---

# Database Migrations

## Introduction

By default, ChadStart **automatically syncs** your database schema every time the server starts — creating new tables and adding new columns as needed. This is great for rapid prototyping.

For **production environments** or teams that need more control, ChadStart provides a full migration system powered by [Postgrator](https://github.com/rickbergfalk/postgrator). Migrations let you:

- **Track schema changes** with numbered, version-controlled SQL files
- **Auto-generate** migration SQL by diffing your YAML config against the last committed version in git
- **Write custom SQL** for advanced operations (indexes, views, data transforms)
- **Roll back** changes with undo scripts

Migrations work with all supported databases: **SQLite**, **PostgreSQL**, and **MySQL**.

## Quick start

### 1. Make changes to your YAML

Edit your `chadstart.yaml` to add a new entity or property:

```yaml title="chadstart.yaml"
entities:
  Post:
    properties:
      - title
      - body
      - { name: rating, type: integer }
```

### 2. Generate a migration

```bash
npx chadstart migrate:generate --description add-posts
```

This compares your current YAML against the last committed version in git and generates numbered SQL files:

```
migrations/
  001.do.add-posts.sql       # applies the change
  001.undo.add-posts.sql     # reverts the change
```

### 3. Review the generated SQL

```sql title="migrations/001.do.add-posts.sql"
CREATE TABLE IF NOT EXISTS "post" ("id" TEXT PRIMARY KEY, "createdAt" TEXT, "updatedAt" TEXT, "title" TEXT, "body" TEXT, "rating" INTEGER);
```

### 4. Apply the migration

```bash
npx chadstart migrate
```

### 5. Check the status

```bash
npx chadstart migrate:status
```

## CLI commands

### `migrate`

Run all pending migrations:

```bash
npx chadstart migrate
npx chadstart migrate --config ./my-config.yaml
npx chadstart migrate --migrations-dir ./db/migrations
```

### `migrate:generate`

Auto-generate a migration from the diff between your current YAML file and the last committed version in git:

```bash
npx chadstart migrate:generate
npx chadstart migrate:generate --description add-posts-table
npx chadstart migrate:generate --migrations-dir ./db/migrations
```

If no schema changes are detected, no files are created.

### `migrate:status`

Show the current migration version, how many have been applied, and how many are pending:

```bash
npx chadstart migrate:status
```

Example output:

```
📊 Migration Status

  Current version: 3
  Applied:         3
  Pending:         1

  Pending migrations:
    - 4.do.add-comments
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--config <path>` | `./chadstart.yaml` | Path to config file |
| `--migrations-dir <dir>` | `./migrations` | Path to migrations directory |
| `--description <text>` | _(none)_ | Description label for generated migration files |

## How it works

### Git-based diffing

When you run `migrate:generate`, ChadStart uses git to retrieve the **last committed version** of your YAML file (`git show HEAD:<file>`) and compares it with the current version on disk. The diff detects:

- **New entities** → generates `CREATE TABLE` statements
- **New properties** → generates `ALTER TABLE ADD COLUMN` statements
- **New belongsTo relations** → generates foreign key columns
- **New belongsToMany relations** → generates junction tables
- **Authenticable flag changes** → generates `email` and `password` columns

!!! note
    Your project must be a git repository and the YAML file must have been committed at least once for diffing to work. If there is no git history, all entities will be treated as new.

### File naming convention

Migration files follow the [Postgrator naming convention](https://github.com/rickbergfalk/postgrator):

```
[version].[action].[optional-description].sql
```

- **Version**: A zero-padded number (e.g., `001`, `002`, `003`)
- **Action**: Either `do` (apply) or `undo` (revert)
- **Description**: An optional label to help identify the migration

Examples:

```
001.do.initial-schema.sql
001.undo.initial-schema.sql
002.do.add-comments-table.sql
002.undo.add-comments-table.sql
003.do.sql
003.undo.sql
```

### Version tracking

ChadStart uses the `_cs_migrations` table to track which migrations have been applied. Postgrator automatically determines whether to go "up" or "down" and validates checksums to ensure migration files haven't been modified after being applied.

## Writing custom SQL migrations

For operations that go beyond schema changes — such as creating indexes, views, or data migrations — you can write SQL files manually and place them in the migrations directory.

### Example: Adding an index

```sql title="migrations/002.do.add-post-title-index.sql"
CREATE INDEX idx_post_title ON "post" ("title");
```

```sql title="migrations/002.undo.add-post-title-index.sql"
DROP INDEX idx_post_title;
```

### Example: Adding a view

```sql title="migrations/003.do.recent-posts-view.sql"
CREATE VIEW recent_posts AS
  SELECT * FROM "post"
  ORDER BY "createdAt" DESC
  LIMIT 100;
```

```sql title="migrations/003.undo.recent-posts-view.sql"
DROP VIEW IF EXISTS recent_posts;
```

### Example: Data migration

```sql title="migrations/004.do.backfill-ratings.sql"
UPDATE "post" SET "rating" = 0 WHERE "rating" IS NULL;
```

```sql title="migrations/004.undo.backfill-ratings.sql"
-- No undo needed for this data migration
```

### Mixing auto-generated and custom migrations

Auto-generated and hand-written migration files coexist in the same directory. The version numbering system ensures they run in the correct order:

```
migrations/
  001.do.initial-schema.sql          # auto-generated
  001.undo.initial-schema.sql
  002.do.custom-index.sql            # hand-written
  002.undo.custom-index.sql
  003.do.add-comments.sql            # auto-generated
  003.undo.add-comments.sql
```

!!! tip
    When auto-generating migrations, ChadStart detects existing files and picks the next available version number automatically.

## Database engine considerations

Migration SQL is generated for the database engine specified by the `DB_ENGINE` environment variable (default: `sqlite`). Key differences:

| Feature | SQLite | PostgreSQL | MySQL |
|---------|--------|------------|-------|
| ID column | `TEXT` | `TEXT` | `VARCHAR(36)` |
| Integer type | `INTEGER` | `INTEGER` | `INT` |
| Boolean type | `INTEGER` | `BOOLEAN` | `TINYINT(1)` |
| Number type | `REAL` | `NUMERIC` | `DECIMAL(15,4)` |
| Identifier quoting | `"name"` | `"name"` | `` `name` `` |
| DROP COLUMN support | Limited | Yes | Yes |

!!! warning
    SQLite has limited `ALTER TABLE` support. Column drops are commented out in undo scripts. For SQLite, complex undo operations may require recreating the table.

## Workflow recommendations

### Development

During development, the automatic schema sync (`npx chadstart dev`) is usually sufficient. Use migrations when you want to track changes explicitly or need custom SQL.

### Staging / Production

1. Generate migrations locally as you make YAML changes
2. Review the generated SQL before committing
3. Commit migration files alongside YAML changes
4. Run `npx chadstart migrate` as part of your deployment process

### CI/CD

Add the migration step to your deployment pipeline:

```bash
# Install dependencies
npm install

# Run pending migrations
npx chadstart migrate --config ./chadstart.yaml

# Start the server
npx chadstart start
```
