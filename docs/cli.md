# CLI

ChadStart includes a CLI for common development and production tasks.

## Commands

```
npx chadstart dev [--config path] [--port N]    # Hot-reload dev server
npx chadstart start [--config path] [--port N]  # Production server
npx chadstart build [--config path]             # Validate & summarize config
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

## Options

| Option | Description |
|--------|-------------|
| `--config <path>` | Path to config file (default: `./chadstart.yaml`) |
| `--port <number>` | Override port from config (default: `3000`) |
