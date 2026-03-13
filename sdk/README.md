# @chadstart/sdk

Official JavaScript/TypeScript SDK for [Chadstart](https://github.com/saulmmendoza/chadstart.com) — the YAML-first Backend as a Service.

Works in **any JS/TS project**: browsers, React, Vue, Svelte, Angular, Astro, Node.js, and more.

---

## Installation

```bash
npm install @chadstart/sdk
```

---

## Quick Start

```js
import Chadstart from '@chadstart/sdk'

// Initialize with your backend URL (defaults to http://localhost:3000)
const client = new Chadstart('https://your-chadstart-backend.com')
```

---

## Collections

### List items (paginated)

```js
// Fetch all posts (returns paginated result)
const result = await client.from('posts').find()
// { data: [...], currentPage: 1, lastPage: 1, total: 10, perPage: 10, from: 1, to: 10 }

// With pagination
const result = await client.from('posts').find({ page: 2, perPage: 20 })
```

### Filtering

```js
const posts = await client
  .from('posts')
  .where('published = true')
  .andWhere('views > 100')
  .find()
```

**Supported operators:**

| Operator | Description           | Example                          |
| -------- | --------------------- | -------------------------------- |
| `=`      | equals                | `.where('isActive = true')`      |
| `!=`     | not equals            | `.where('status != draft')`      |
| `>`      | greater than          | `.where('age > 18')`             |
| `>=`     | greater than or equal | `.where('price >= 10')`          |
| `<`      | less than             | `.where('stock < 5')`            |
| `<=`     | less than or equal    | `.where('amount <= 400')`        |
| `like`   | pattern match         | `.where('name like %jo%')`       |
| `in`     | included in           | `.where('status in new,active')` |

### Ordering

```js
const posts = await client
  .from('posts')
  .orderBy('createdAt', { desc: true })
  .find()
```

### Relations

```js
const posts = await client
  .from('posts')
  .with(['author', 'tags'])
  .find()

// Nested relations
const cities = await client
  .from('cities')
  .with(['region', 'region.country'])
  .find()
```

### Get a single item by ID

```js
const post = await client.from('posts').findOneById('2c4e6a8b-...')
```

### Create an item

```js
const newPost = await client.from('posts').create({
  title: 'Hello World',
  published: true,
})
```

### Update an item (full replace — PUT)

```js
const updated = await client.from('posts').update('2c4e6a8b-...', {
  title: 'Updated Title',
  published: false,
})
```

### Patch an item (partial update — PATCH)

```js
const patched = await client.from('posts').patch('2c4e6a8b-...', {
  published: true,
})
```

### Delete an item

```js
const deleted = await client.from('posts').delete('2c4e6a8b-...')
```

---

## Singles

Singles are entities with only one record (e.g. homepage content, site settings).

```js
// Get
const homepage = await client.single('homepage').get()

// Full replace (PUT)
const updated = await client.single('homepage').update({
  title: 'Welcome!',
  description: 'My awesome site',
})

// Partial update (PATCH)
const patched = await client.single('homepage').patch({ title: 'New Title' })
```

---

## Authentication

Chadstart supports multiple authenticable entity types.

```js
// Sign up
const { token, user } = await client.auth('customers').signup({
  email: 'alice@example.com',
  password: 'secret',
  name: 'Alice',
})
// Token is stored automatically

// Log in
const { token, user } = await client.auth('customers').login({
  email: 'alice@example.com',
  password: 'secret',
})
// Token is stored automatically

// Get current user (requires a stored token)
const me = await client.auth('customers').me()

// Log out
client.auth('customers').logout()
```

### Manual token management

```js
// Store a token manually (e.g. from localStorage)
client.setToken(localStorage.getItem('token'))

// Clear the token
client.clearToken()
```

---

## Error Handling

All methods throw a `ChadstartError` on non-2xx responses.

```js
import Chadstart, { ChadstartError } from '@chadstart/sdk'

try {
  const post = await client.from('posts').findOneById('missing-id')
} catch (err) {
  if (err instanceof ChadstartError) {
    console.log(err.status) // e.g. 404
    console.log(err.message) // e.g. "Not found"
    console.log(err.data)   // raw response body
  }
}
```

---

## TypeScript

Full TypeScript support is included out of the box.

```ts
import Chadstart from '@chadstart/sdk'

interface Post {
  id: string
  title: string
  published: boolean
}

const client = new Chadstart('https://api.example.com')

const { data } = await client.from<Post>('posts').find()
//     ^? Post[]

const post = await client.from<Post>('posts').findOneById('abc')
//    ^? Post
```

---

## CommonJS usage

```js
const Chadstart = require('@chadstart/sdk')
const client = new Chadstart('http://localhost:3000')
```

---

## API Reference

### `new Chadstart(baseUrl?)`

| Parameter | Type     | Default                    | Description              |
| --------- | -------- | -------------------------- | ------------------------ |
| `baseUrl` | `string` | `'http://localhost:3000'` | Your Chadstart server URL |

### `client.from(slug)` → `CollectionQuery`

| Method                      | Description                          |
| --------------------------- | ------------------------------------ |
| `.where(condition)`         | Add a filter                         |
| `.andWhere(condition)`      | Add an additional filter             |
| `.with(relations)`          | Load relations                       |
| `.orderBy(field, options?)` | Order results                        |
| `.find(params?)`            | Fetch paginated list                 |
| `.findOneById(id)`          | Fetch one item by ID                 |
| `.create(data)`             | Create a new item                    |
| `.update(id, data)`         | Replace an item (PUT)                |
| `.patch(id, data)`          | Partially update an item (PATCH)     |
| `.delete(id)`               | Delete an item                       |

### `client.single(slug)` → `SingleQuery`

| Method          | Description                      |
| --------------- | -------------------------------- |
| `.get()`        | Fetch the single entity          |
| `.update(data)` | Replace the single entity (PUT)  |
| `.patch(data)`  | Partially update it (PATCH)      |

### `client.auth(slug)` → `AuthQuery`

| Method          | Description                                          |
| --------------- | ---------------------------------------------------- |
| `.signup(data)` | Register a user; auto-stores the returned token      |
| `.login(data)`  | Log in a user; auto-stores the returned token        |
| `.me()`         | Get the currently authenticated user                 |
| `.logout()`     | Clear the stored token                               |

---

## License

ISC
