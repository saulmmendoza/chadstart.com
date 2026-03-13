# ChadStart

> YAML-first Backend as a Service — define your entire backend in a single YAML file.

Inspired by [Manifest](https://backend.manifest.build/), ChadStart auto-generates a fully functional backend — database schema, REST API, realtime subscriptions, OpenAPI docs, file storage, and a plugin system — from one `chadstart.yaml` file.

## Quick Start

```bash
npm install chadstart
# or clone this repo and npm install
```

Create a `chadstart.yaml`:

```yaml
name: Blog

entities:
  Post:
    properties:
      - title
      - content
      - published
  Comment:
    properties:
      - text
    belongsTo:
      - Post

files:
  uploads:
    path: ./uploads
    public: true

public:
  folder: ./public
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
| Swagger UI | `/docs` |
| OpenAPI JSON | `/openapi.json` |
| Realtime WebSocket | `ws://localhost:3000/realtime` |
| File uploads | `POST /files/uploads` |
| Health check | `/health` |

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

// Subscribe to an entity channel
ws.send(JSON.stringify({ type: 'subscribe', channel: 'Post' }));

// Receive events
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
# Upload
curl -F "file=@photo.jpg" http://localhost:3000/files/uploads

# Download
GET /files/uploads/photo.jpg
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

## YAML Schema Reference

```yaml
name: string          # Required — project name
port: 3000            # Optional — default 3000

entities:
  EntityName:
    properties:
      - fieldName                             # string shorthand (type: text)
      - name: fieldName                       # object form
        type: text|integer|number|boolean|date|json
    belongsTo:
      - OtherEntity                           # adds otherEntity_id FK column
    permissions:
      read: public                            # future use
      write: public

files:
  bucketName:
    path: ./uploads                           # directory on disk
    public: true                              # serve GET statically

public:
  folder: ./public                            # served as static files at /

plugins:
  - repo: https://github.com/org/plugin      # cloned automatically
  - path: ./local-plugin                      # local directory
```

## Project Structure

```
chadstart/
  core/
    yaml-loader.js       # Read & parse chadstart.yaml
    schema-validator.js  # Validate YAML structure
    entity-engine.js     # Build internal model from config
    db.js                # SQLite CRUD layer
    api-generator.js     # Generate Express REST routes
    realtime.js          # WebSocket realtime subscriptions
    openapi.js           # OpenAPI 3.0 spec generator
    file-storage.js      # File upload/download routes
    plugin-loader.js     # Dynamic plugin loading
  server/
    express-server.js    # Bootstrap everything together
  cli/
    cli.js               # npx chadstart dev|start|build
  utils/
    logger.js            # Simple leveled logger
  test/
    test.js              # Built-in tests
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
- **Minimal dependencies** — express, ws, yaml, better-sqlite3, swagger-ui-express
- **Readable code** — easy to hack and extend
- **No magic** — every generated route is straightforward Express code
- **Self-hosted** — runs anywhere Node.js runs

## License

ISC
