/**
 * Chadstart JavaScript SDK
 *
 * Works with vanilla JS and TypeScript projects (browser + Node.js 18+).
 *
 * Usage:
 *   import Chadstart from '@chadstart/sdk'
 *   const client = new Chadstart('http://localhost:3000')
 *
 *   // Collections
 *   const posts = await client.from('posts').find()
 *   const post  = await client.from('posts').findOneById(id)
 *   const post  = await client.from('posts').create({ title: 'Hello' })
 *   const post  = await client.from('posts').update(id, { title: 'Hi' })
 *   const post  = await client.from('posts').patch(id, { title: 'Hi' })
 *   const post  = await client.from('posts').delete(id)
 *
 *   // Singles
 *   const page = await client.single('homepage').get()
 *   const page = await client.single('homepage').update({ title: 'New' })
 *   const page = await client.single('homepage').patch({ title: 'New' })
 *
 *   // Auth
 *   const { token, user } = await client.auth('customers').signup({ email, password })
 *   const { token, user } = await client.auth('customers').login({ email, password })
 *   const user            = await client.auth('customers').me()
 */

class CollectionQuery {
  constructor(slug, client) {
    this._slug = slug;
    this._client = client;
    this._filters = [];
    this._relations = [];
    this._orderByField = null;
    this._orderDir = null;
  }

  /**
   * Add a filter condition.
   * Supports operators: =, !=, >, >=, <, <=, like, in
   *
   * @param {string} condition - e.g. 'published = true', 'age >= 18', 'name like %jo%'
   */
  where(condition) {
    this._filters.push(condition);
    return this;
  }

  /** Alias for chaining additional filters. */
  andWhere(condition) {
    return this.where(condition);
  }

  /**
   * Load relations.
   * @param {string[]} relations - e.g. ['author', 'tags', 'author.profile']
   */
  with(relations) {
    this._relations = Array.isArray(relations) ? relations : [relations];
    return this;
  }

  /**
   * Order results.
   * @param {string} field - property name
   * @param {{ desc?: boolean }} [options]
   */
  orderBy(field, options) {
    this._orderByField = field;
    this._orderDir = options && options.desc ? 'DESC' : 'ASC';
    return this;
  }

  /**
   * Fetch paginated list.
   * @param {{ page?: number, perPage?: number }} [params]
   * @returns {Promise<{ data: object[], currentPage: number, lastPage: number, from: number, to: number, total: number, perPage: number }>}
   */
  async find(params) {
    const query = this._buildQuery(params);
    return this._client._request('GET', `/api/collections/${this._slug}${query}`);
  }

  /**
   * Fetch a single item by ID.
   * @param {string} id
   */
  async findOneById(id) {
    const parts = [];
    if (this._relations.length) parts.push(`relations=${this._relations.join(',')}`);
    const query = parts.length ? `?${parts.join('&')}` : '';
    return this._client._request('GET', `/api/collections/${this._slug}/${id}${query}`);
  }

  /**
   * Create a new item.
   * @param {object} data
   */
  async create(data) {
    return this._client._request('POST', `/api/collections/${this._slug}`, data);
  }

  /**
   * Fully replace an item (PUT).
   * @param {string} id
   * @param {object} data
   */
  async update(id, data) {
    return this._client._request('PUT', `/api/collections/${this._slug}/${id}`, data);
  }

  /**
   * Partially update an item (PATCH).
   * @param {string} id
   * @param {object} data
   */
  async patch(id, data) {
    return this._client._request('PATCH', `/api/collections/${this._slug}/${id}`, data);
  }

  /**
   * Delete an item.
   * @param {string} id
   */
  async delete(id) {
    return this._client._request('DELETE', `/api/collections/${this._slug}/${id}`);
  }

  /** @private Build query string from current builder state + pagination params. */
  _buildQuery(params) {
    const parts = [];

    for (const condition of this._filters) {
      const param = parseFilter(condition);
      if (param) parts.push(param);
    }

    if (this._relations.length) {
      parts.push(`relations=${this._relations.join(',')}`);
    }

    if (this._orderByField) {
      parts.push(`orderBy=${encodeURIComponent(this._orderByField)}`);
      if (this._orderDir) parts.push(`order=${this._orderDir}`);
    }

    if (params) {
      if (params.page != null) parts.push(`page=${params.page}`);
      if (params.perPage != null) parts.push(`perPage=${params.perPage}`);
    }

    return parts.length ? `?${parts.join('&')}` : '';
  }
}

class SingleQuery {
  constructor(slug, client) {
    this._slug = slug;
    this._client = client;
  }

  /** Fetch the single entity. */
  async get() {
    return this._client._request('GET', `/api/singles/${this._slug}`);
  }

  /**
   * Fully replace the single entity (PUT).
   * @param {object} data
   */
  async update(data) {
    return this._client._request('PUT', `/api/singles/${this._slug}`, data);
  }

  /**
   * Partially update the single entity (PATCH).
   * @param {object} data
   */
  async patch(data) {
    return this._client._request('PATCH', `/api/singles/${this._slug}`, data);
  }
}

class AuthQuery {
  constructor(slug, client) {
    this._slug = slug;
    this._client = client;
  }

  /**
   * Register a new user.
   * @param {{ email: string, password: string, [key: string]: any }} data
   * @returns {Promise<{ token: string, user: object }>}
   */
  async signup(data) {
    const result = await this._client._request('POST', `/api/auth/${this._slug}/signup`, data);
    if (result.token) this._client.setToken(result.token);
    return result;
  }

  /**
   * Log in an existing user.
   * @param {{ email: string, password: string }} data
   * @returns {Promise<{ token: string, user: object }>}
   */
  async login(data) {
    const result = await this._client._request('POST', `/api/auth/${this._slug}/login`, data);
    if (result.token) this._client.setToken(result.token);
    return result;
  }

  /**
   * Get current authenticated user.
   * @returns {Promise<object>}
   */
  async me() {
    return this._client._request('GET', `/api/auth/${this._slug}/me`);
  }

  /** Log out by clearing the stored token. */
  logout() {
    this._client.clearToken();
  }
}

/**
 * Chadstart SDK client.
 */
class Chadstart {
  /**
   * @param {string} [baseUrl='http://localhost:3000'] - The base URL of your Chadstart backend.
   */
  constructor(baseUrl) {
    this._baseUrl = (baseUrl || 'http://localhost:3000').replace(/\/$/, '');
    this._token = null;
  }

  /**
   * Start a collection query builder.
   * @param {string} slug - Collection slug (e.g. 'posts')
   * @returns {CollectionQuery}
   */
  from(slug) {
    return new CollectionQuery(slug, this);
  }

  /**
   * Start a single entity query builder.
   * @param {string} slug - Single slug (e.g. 'homepage')
   * @returns {SingleQuery}
   */
  single(slug) {
    return new SingleQuery(slug, this);
  }

  /**
   * Start an auth query builder.
   * @param {string} slug - Authenticable entity slug (e.g. 'customers')
   * @returns {AuthQuery}
   */
  auth(slug) {
    return new AuthQuery(slug, this);
  }

  /**
   * Set the Bearer token used for authenticated requests.
   * @param {string} token
   */
  setToken(token) {
    this._token = token;
  }

  /** Clear the stored token (logout). */
  clearToken() {
    this._token = null;
  }

  /** @private Perform an HTTP request. */
  async _request(method, path, body) {
    const url = `${this._baseUrl}${path}`;
    const headers = { 'Content-Type': 'application/json' };
    if (this._token) headers['Authorization'] = `Bearer ${this._token}`;

    const options = { method, headers };
    if (body !== undefined && method !== 'GET' && method !== 'DELETE') {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    let data;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const message =
        (data && typeof data === 'object' && data.error) ||
        (typeof data === 'string' && data) ||
        `HTTP ${response.status}`;
      const error = new ChadstartError(message, response.status, data);
      throw error;
    }

    return data;
  }
}

/**
 * Error thrown when the Chadstart API returns a non-2xx status.
 */
class ChadstartError extends Error {
  /**
   * @param {string} message
   * @param {number} status - HTTP status code
   * @param {any} data - Raw response body
   */
  constructor(message, status, data) {
    super(message);
    this.name = 'ChadstartError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Parse a filter condition string into a query parameter string.
 *
 * Supported operators: =, !=, >=, <=, >, <, like, in
 *
 * Examples:
 *   'published = true'   -> 'published_eq=true'
 *   'age >= 18'          -> 'age_gte=18'
 *   'name like %jo%'     -> 'name_like=%jo%'
 *   'id in 1,2,3'        -> 'id_in=1%2C2%2C3'
 *
 * @param {string} condition
 * @returns {string|null}
 */
function parseFilter(condition) {
  const operators = [
    { op: '!=', suffix: '_neq' },
    { op: '>=', suffix: '_gte' },
    { op: '<=', suffix: '_lte' },
    { op: '>', suffix: '_gt' },
    { op: '<', suffix: '_lt' },
    { op: '=', suffix: '_eq' },
    { op: ' like ', suffix: '_like' },
    { op: ' in ', suffix: '_in' },
  ];

  for (const { op, suffix } of operators) {
    const idx = condition.indexOf(op);
    if (idx === -1) continue;
    const field = condition.slice(0, idx).trim();
    const value = condition.slice(idx + op.length).trim();
    return `${encodeURIComponent(field)}${suffix}=${encodeURIComponent(value)}`;
  }

  return null;
}

export { Chadstart, ChadstartError, CollectionQuery, SingleQuery, AuthQuery };
export default Chadstart;
