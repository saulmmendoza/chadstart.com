# Admin UI

ChadStart ships with a built-in dark-mode single-page Admin UI at `/admin`.

## Features

- **Sidebar** with all entities and user collections
- **Data table** with CRUD (create, edit, delete) for every record
- **Login screen** — any user collection with `admin: true` (default) can sign in

## Access

Navigate to `http://localhost:3000/admin` and log in with credentials from any user collection that has `admin: true`.

## Excluding Collections from Admin

Set `admin: false` on a collection to prevent it from logging into the Admin UI:

```yaml
userCollections:
  Customer:
    properties:
      - name
    admin: false   # cannot log in to Admin UI
```

## Rate Limiting

Admin UI is rate-limited to **100 requests / minute per IP**.
