# CLI

ChadStart includes a CLI for common development and production tasks.

## Commands

```
npx chadstart create [path]                     # Create a new ChadStart project
npx chadstart dev [--config path] [--port N]    # Hot-reload dev server
npx chadstart start [--config path] [--port N]  # Production server
npx chadstart build [--config path]             # Validate & summarize config
npx chadstart seed [--config path]              # Seed the database with dummy data
npx chadstart migrate [--migrations-dir dir]    # Run pending database migrations
npx chadstart migrate:generate [--description]  # Generate migration from YAML diff
npx chadstart migrate:status                    # Show current migration status
```

## `create`

Create a new ChadStart project

```bash
npx chadstart create
npx chadstart create new-folder-name
```

## `dev`

Starts the server with hot-reload on config file changes:

```bash
npx chadstart dev
npx chadstart dev --config ./my-config.yaml
npx chadstart dev --port 4000
```

## `start`

Starts the server in production mode (no hot-reload):

```bash
npx chadstart start
npx chadstart start --config ./my-config.yaml --port 8080
```

## `build`

Validates the config file and prints a summary without starting the server:

```bash
npx chadstart build
npx chadstart build --config ./my-config.yaml
```

## `seed`

Seeds the database with dummy data for all entities:

```bash
npx chadstart seed
npx chadstart seed --config ./my-config.yaml
```

## `migrate`

Runs all pending [database migrations](./migrations.md):

```bash
npx chadstart migrate
npx chadstart migrate --migrations-dir ./db/migrations
```

## `migrate:generate`

Auto-generates a migration by diffing the current YAML config against the last committed version in git. See [Database Migrations](./migrations.md) for details.

```bash
npx chadstart migrate:generate
npx chadstart migrate:generate --description add-posts-table
```

## `migrate:status`

Shows the current migration version, applied count, and pending migrations:

```bash
npx chadstart migrate:status
```

## Options

| Option | Description |
|--------|-------------|
| `--config <path>` | Path to config file (default: `./chadstart.yaml`) |
| `--port <number>` | Override port from config (default: `3000`) |
| `--migrations-dir <dir>` | Path to migrations directory (default: `./migrations`) |
| `--description <text>` | Description label for generated migration files |
