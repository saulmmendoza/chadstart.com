# Configuration

ChadStart is configured entirely through a single `chadstart.yaml` file.

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

## Environment Variables

```bash
JWT_SECRET=<long-random-string>   # Required in production (NODE_ENV=production)
JWT_EXPIRES=7d                    # Optional — default 7d
```

> ⚠️ `JWT_SECRET` defaults to a well-known dev value. Always set it in production.

## Property Types

| Type | Description |
|------|-------------|
| `text` | Plain text string (default) |
| `integer` | Whole number |
| `number` | Floating point number |
| `boolean` | True/false |
| `date` | ISO 8601 date string |
| `json` | Arbitrary JSON blob |

## Full Example

```yaml
name: Blog
port: 3000

userCollections:
  Admin:
    properties:
      - name
    admin: true
  Customer:
    properties:
      - name
      - phone
    admin: false

entities:
  Post:
    properties:
      - title
      - content
      - name: published
        type: boolean
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

public:
  folder: ./public
```
