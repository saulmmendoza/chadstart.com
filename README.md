# ChadStart

> YAML-first Backend as a Service — define your entire backend in a single YAML file.

Inspired by [Manifest](https://backend.manifest.build/), ChadStart auto-generates a fully functional backend — database schema, REST API, realtime subscriptions, OpenAPI docs, file storage, plugin system, **JWT authentication**, and an **Admin UI** — from one `chadstart.yaml` file.

## Quick Start

```bash
npm install
```

## Docker

**Run with `docker run`:**

```bash
# Create your chadstart.yaml first (see Configuration section below), then:
docker run -p 3000:3000 \
  -e JWT_SECRET=your-secret \
  -v ./chadstart.yaml:/app/chadstart.yaml:ro \
  -v ./chadstart.db:/app/chadstart.db \
  ghcr.io/saulmmendoza/chadstart.com:latest
```

**Run with `docker compose`:**

```bash
# 1. Create a .env file with your secrets:
echo "JWT_SECRET=$(openssl rand -hex 32)" > .env

# 2. Have a chadstart.yaml ready (see Configuration section below), then:
docker compose up
```

See [`docker-compose.yml`](docker-compose.yml) for the full example.

Create a `chadstart.yaml`:

```yaml
name: Blog

userCollections:
  Admin:
    properties:
      - name
  Customer:
    properties:
      - name
      - phone

entities:
  Post:
    properties:
      - title
      - content
      - published
    permissions:
      read: public
      write: user:Admin
  Comment:
    properties:
      - text
    belongsTo:
      - Post
    permissions:
      read: public
      write: restricted

files:
  uploads:
    path: ./uploads
    public: true
```

Start the server:

```bash
npx chadstart dev     # development with hot-reload
npx chadstart start   # production
npx chadstart build   # validate config and print summary
```

## What Gets Generated

From the YAML above, ChadStart automatically provides:

| Feature | URL |
|---------|-----|
| REST API | `/api/posts`, `/api/comments`, ... |
| Auth (signup/login/me) | `/auth/admin/signup`, `/auth/admin/login`, ... |
| Admin UI | `/admin` |
| Swagger UI | `/docs` |
| OpenAPI JSON | `/openapi.json` |
| Realtime WebSocket | `ws://localhost:3000/realtime` |
| File uploads | `POST /files/uploads` |
| Health check | `/health` |

## Authentication & User Collections

User collections are special entity types with built-in `email` + `password` fields. Each one generates its own auth endpoints.

```yaml
userCollections:
  Admin:
    properties:
      - name          # extra fields beyond email + password
  Customer:
    properties:
      - name
      - phone
```

### Auth Endpoints

```
POST /auth/admin/signup     { email, password, name } → { token, user }
POST /auth/admin/login      { email, password }       → { token, user }
GET  /auth/admin/me         Authorization: Bearer <token> → user

POST /auth/customer/signup  { email, password, ... }  → { token, user }
POST /auth/customer/login   ...
GET  /auth/customer/me      ...
```

Passwords are hashed with **bcrypt**. Tokens are signed **JWT** (7-day expiry by default).

**Environment variables:**
```bash
JWT_SECRET=<long-random-string>   # Required in production (NODE_ENV=production)
JWT_EXPIRES=7d                    # Optional — default 7d
```

> ⚠️ `JWT_SECRET` defaults to a well-known dev value. Always set it in production.

## Entity Permissions

Restrict who can read or write each entity:

```yaml
entities:
  Post:
    permissions:
      read: public           # anyone
      write: user:Admin      # only authenticated Admins
  Comment:
    permissions:
      read: public
      write: restricted      # any authenticated user (any collection)
```

Permission values:
| Value | Meaning |
|-------|---------|
| `public` | No auth required |
| `restricted` | Any authenticated user |
| `user:CollectionName` | Authenticated member of that specific collection |

## Admin UI

A built-in dark-mode SPA at `/admin`:

- **Sidebar** with all entities and user collections
- **Data table** with CRUD (create, edit, delete) for every record
- **Login screen** — any user collection with `admin: true` (default) can sign in

> Multiple user collections can access the Admin UI. Set `admin: false` on a collection to exclude it.

## REST API

Standard CRUD for every entity:

```
GET    /api/posts           → list all (supports query filters)
GET    /api/posts/:id       → get one
POST   /api/posts           → create
PATCH  /api/posts/:id       → update
DELETE /api/posts/:id       → delete
```

Filter by any property:

```
GET /api/posts?published=true
```

## Realtime

Connect via WebSocket at `ws://localhost:3000/realtime`:

```js
const ws = new WebSocket('ws://localhost:3000/realtime');
ws.send(JSON.stringify({ type: 'subscribe', channel: 'Post' }));
ws.onmessage = (e) => {
  const { event, data } = JSON.parse(e.data);
  // event: 'Post.created' | 'Post.updated' | 'Post.deleted'
};
```

Subscribe to `*` to receive all events.

## File Storage

```yaml
files:
  uploads:
    path: ./uploads
    public: true
```

```bash
curl -F "file=@photo.jpg" http://localhost:3000/files/uploads   # upload
GET /files/uploads/photo.jpg                                    # download
```

## Plugin System

```yaml
plugins:
  - repo: https://github.com/org/chadstart-plugin-auth
  - path: ./my-local-plugin
```

Plugin interface:

```js
module.exports = {
  name: 'my-plugin',
  register(app, core) {
    app.get('/custom', (req, res) => res.json({ hello: 'world' }));
  }
};
```

> ⚠️ Remote plugins execute arbitrary code. Only load plugins from trusted sources.

## YAML Schema Reference

```yaml
name: string          # Required — project name
port: 3000            # Optional — default 3000

userCollections:
  CollectionName:
    properties:
      - fieldName     # string shorthand (type: text)
      - name: fieldName
        type: text|integer|number|boolean|date|json
    admin: true       # allow access to Admin UI (default: true)

entities:
  EntityName:
    properties:
      - fieldName
      - name: fieldName
        type: text|integer|number|boolean|date|json
    belongsTo:
      - OtherEntity
    permissions:
      read: public|restricted|user:CollectionName
      write: public|restricted|user:CollectionName

files:
  bucketName:
    path: ./uploads
    public: true

public:
  folder: ./public

plugins:
  - repo: https://github.com/org/plugin
  - path: ./local-plugin
```

## Rate Limiting

Auth endpoints: 30 req / 15 min per IP  
API endpoints: 200 req / min per IP  
Admin UI: 100 req / min per IP

## Project Structure

```
chadstart/
  core/
    yaml-loader.js       # Read & parse chadstart.yaml
    schema-validator.js  # Validate YAML structure
    entity-engine.js     # Build internal model from config
    db.js                # SQLite CRUD layer
    auth.js              # JWT auth + user collection endpoints
    api-generator.js     # Generate Express REST routes with permission enforcement
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
    test.js              # Built-in tests (39)
  chadstart.yaml         # Example config
```

## CLI

```
npx chadstart dev [--config path] [--port N]    # Hot-reload dev server
npx chadstart start [--config path] [--port N]  # Production server
npx chadstart build [--config path]             # Validate & summarize config
```

## Design Principles

- **YAML-first** — one file defines everything
- **Minimal dependencies** — express, ws, yaml, better-sqlite3, bcryptjs, jsonwebtoken, swagger-ui-express, express-rate-limit
- **Readable code** — easy to hack and extend
- **No magic** — every generated route is straightforward Express code
- **Self-hosted** — runs anywhere Node.js runs

## License

ISC
