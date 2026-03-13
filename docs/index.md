# ChadStart

> YAML-first Backend as a Service — define your entire backend in a single YAML file.

Inspired by [Manifest](https://backend.manifest.build/), ChadStart auto-generates a fully functional backend from one `chadstart.yaml` file.

## Features

| Feature | URL |
|---------|-----|
| REST API | `/api/posts`, `/api/comments`, … |
| Auth (signup/login/me) | `/auth/admin/signup`, `/auth/admin/login`, … |
| Admin UI | `/admin` |
| Swagger UI | `/docs` |
| OpenAPI JSON | `/openapi.json` |
| Realtime WebSocket | `ws://localhost:3000/realtime` |
| File uploads | `POST /files/uploads` |
| Health check | `/health` |

## Quick Start

```bash
npm install
npx chadstart dev     # development with hot-reload
npx chadstart start   # production
npx chadstart build   # validate config and print summary
```

## Minimal Example

Create a `chadstart.yaml`:

```yaml
name: Blog

userCollections:
  Admin:
    properties:
      - name

entities:
  Post:
    properties:
      - title
      - content
      - published
    permissions:
      read: public
      write: user:Admin

files:
  uploads:
    path: ./uploads
    public: true
```

Then start the server:

```bash
npx chadstart dev
```

## Design Principles

- **YAML-first** — one file defines everything
- **Minimal dependencies** — express, ws, yaml, better-sqlite3, bcryptjs, jsonwebtoken, swagger-ui-express, express-rate-limit
- **Readable code** — easy to hack and extend
- **No magic** — every generated route is straightforward Express code
- **Self-hosted** — runs anywhere Node.js runs

## Project Structure

```
chadstart/
  core/
    yaml-loader.js       # Read & parse chadstart.yaml
    schema-validator.js  # Validate YAML structure
    entity-engine.js     # Build internal model from config
    db.js                # SQLite CRUD layer
    auth.js              # JWT auth + user collection endpoints
    api-generator.js     # Generate Express REST routes
    realtime.js          # WebSocket realtime subscriptions
    openapi.js           # OpenAPI 3.0 spec generator
    file-storage.js      # File upload/download routes
    plugin-loader.js     # Dynamic plugin loading
  server/
    express-server.js    # Bootstrap everything together
  admin/
    index.html           # Admin UI single-page app
  cli/
    cli.js               # npx chadstart dev|start|build
  utils/
    logger.js            # Simple leveled logger
  test/
    test.js              # Tests
  chadstart.yaml         # Example config
```
