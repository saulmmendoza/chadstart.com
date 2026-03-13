# REST API

ChadStart auto-generates a full REST API for every entity defined in your `chadstart.yaml`.

## CRUD Endpoints

Standard CRUD for every entity:

```
GET    /api/posts           → list all (paginated, supports query filters)
GET    /api/posts/:id       → get one
POST   /api/posts           → create
PATCH  /api/posts/:id       → update
DELETE /api/posts/:id       → delete
```

## Query Filters

Filter by any property using query string parameters:

```
GET /api/posts?published=true
GET /api/posts?title=Hello
```

### Filter Suffixes

| Suffix | Meaning |
|--------|---------|
| `_eq` | Equal (default) |
| `_neq` | Not equal |
| `_gt` | Greater than |
| `_gte` | Greater than or equal |
| `_lt` | Less than |
| `_lte` | Less than or equal |
| `_like` | SQL LIKE pattern |
| `_in` | In list (comma-separated) |

Example:

```
GET /api/posts?title_like=%Hello%
GET /api/posts?views_gte=100
```

## Pagination

List endpoints return paginated results:

```json
{
  "data": [...],
  "currentPage": 1,
  "lastPage": 5,
  "from": 1,
  "to": 20,
  "total": 100,
  "perPage": 20
}
```

Use `page` and `perPage` query parameters:

```
GET /api/posts?page=2&perPage=10
```

## Ordering

Use `orderBy` and `order` query parameters:

```
GET /api/posts?orderBy=createdAt&order=desc
```

## OpenAPI / Swagger

ChadStart auto-generates OpenAPI documentation:

- **Swagger UI** at `/docs`
- **OpenAPI JSON** at `/openapi.json`

## Rate Limiting

API endpoints are rate-limited to **200 requests / minute per IP**.
