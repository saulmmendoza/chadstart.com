# Plugin System

ChadStart supports plugins to extend the server with custom routes and logic.

## Configuration

Add plugins in `chadstart.yaml`:

```yaml
plugins:
  - repo: https://github.com/org/chadstart-plugin-auth
  - path: ./my-local-plugin
```

| Option | Description |
|--------|-------------|
| `repo` | Load plugin from a remote GitHub repository |
| `path` | Load plugin from a local directory |

> ⚠️ Remote plugins execute arbitrary code. Only load plugins from trusted sources.

## Plugin Interface

A plugin is a Node.js module that exports an object with a `name` and a `register` function:

```js
module.exports = {
  name: 'my-plugin',
  register(app, core) {
    // app — Express application instance
    // core — ChadStart core utilities
    app.get('/custom', (req, res) => res.json({ hello: 'world' }));
  }
};
```

## Local Plugin Example

Create `./my-local-plugin/index.js`:

```js
module.exports = {
  name: 'custom-routes',
  register(app, core) {
    app.get('/ping', (req, res) => res.json({ pong: true }));
    app.post('/notify', (req, res) => {
      // custom business logic
      res.json({ sent: true });
    });
  }
};
```

Then reference it in `chadstart.yaml`:

```yaml
plugins:
  - path: ./my-local-plugin
```
