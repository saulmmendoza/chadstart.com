# Permissions

ChadStart supports per-entity read/write permissions.

## Permission Values

| Value | Meaning |
|-------|---------|
| `public` | No authentication required |
| `restricted` | Any authenticated user (any collection) |
| `user:CollectionName` | Authenticated member of that specific collection |

## Usage

```yaml
entities:
  Post:
    properties:
      - title
      - content
    permissions:
      read: public           # anyone can read
      write: user:Admin      # only authenticated Admins can write

  Comment:
    properties:
      - text
    permissions:
      read: public
      write: restricted      # any authenticated user can write
```

## Emoji Shortcuts

Permissions also support emoji shortcuts:

| Emoji | Permission |
|-------|-----------|
| 🌐 | `public` |
| 🔒 | `restricted` |
| 👨🏻‍💻 | `admin` |
| 🚫 | `forbidden` |

## Default Permissions

If no permissions are specified, all operations default to `restricted` (require authentication).

## Admin Users

Admin users (user collections with `admin: true`) can always access the Admin UI at `/admin`. Entity-level permissions still apply to their API requests.
