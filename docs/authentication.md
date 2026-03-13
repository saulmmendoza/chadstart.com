# Authentication

ChadStart has built-in JWT authentication for **user collections**.

## User Collections

Declare a user collection in `chadstart.yaml`:

```yaml
userCollections:
  Admin:
    properties:
      - name
  Customer:
    properties:
      - name
      - phone
```

Each user collection automatically gets `email` and `password` fields plus full auth endpoints.

## Auth Endpoints

For each user collection, ChadStart generates three endpoints:

```
POST /auth/admin/signup     { email, password, name }          → { token, user }
POST /auth/admin/login      { email, password }                → { token, user }
GET  /auth/admin/me         Authorization: Bearer <token>      → user

POST /auth/customer/signup  { email, password, name, phone }   → { token, user }
POST /auth/customer/login   { email, password }                → { token, user }
GET  /auth/customer/me      Authorization: Bearer <token>      → user
```

Passwords are hashed with **bcrypt**. Tokens are signed **JWT** (7-day expiry by default).

## Environment Variables

```bash
JWT_SECRET=<long-random-string>   # Required in production
JWT_EXPIRES=7d                    # Optional — default 7d
```

> ⚠️ `JWT_SECRET` defaults to a well-known dev value. Always set it in production.

## Admin UI Access

By default, every user collection can access the Admin UI. Set `admin: false` to exclude a collection:

```yaml
userCollections:
  Customer:
    properties:
      - name
    admin: false   # cannot access Admin UI
```

## Rate Limiting

Auth endpoints are rate-limited to **30 requests / 15 minutes per IP** to prevent brute-force attacks.
