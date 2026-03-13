/**
 * TypeScript declarations for @chadstart/sdk
 */

/** Paginated list response returned by collection find(). */
export interface PaginatedResult<T = Record<string, unknown>> {
  data: T[];
  currentPage: number;
  lastPage: number;
  from: number;
  to: number;
  total: number;
  perPage: number;
}

/** Options for find() pagination. */
export interface FindOptions {
  page?: number;
  perPage?: number;
}

/** Options for orderBy(). */
export interface OrderByOptions {
  desc?: boolean;
}

/** Auth signup/login response. */
export interface AuthResponse<U = Record<string, unknown>> {
  token: string;
  user: U;
}

/**
 * Error thrown when the Chadstart API returns a non-2xx status.
 */
export declare class ChadstartError extends Error {
  name: 'ChadstartError';
  /** HTTP status code */
  status: number;
  /** Raw response body */
  data: unknown;
  constructor(message: string, status: number, data: unknown);
}

/**
 * Fluent query builder for collection CRUD operations.
 */
export declare class CollectionQuery<T = Record<string, unknown>> {
  /**
   * Add a filter condition.
   * Supports operators: =, !=, >, >=, <, <=, like, in
   *
   * @example
   * client.from('posts').where('published = true').find()
   * client.from('cats').where('age >= 2').andWhere('breed = siamese').find()
   */
  where(condition: string): this;

  /** Alias for chaining additional filters. */
  andWhere(condition: string): this;

  /**
   * Eagerly load relations.
   * @example
   * client.from('posts').with(['author', 'tags']).find()
   */
  with(relations: string[]): this;

  /**
   * Order results by a field.
   * @example
   * client.from('posts').orderBy('createdAt', { desc: true }).find()
   */
  orderBy(field: string, options?: OrderByOptions): this;

  /**
   * Fetch a paginated list of items.
   */
  find(params?: FindOptions): Promise<PaginatedResult<T>>;

  /**
   * Fetch a single item by its ID.
   */
  findOneById(id: string): Promise<T>;

  /**
   * Create a new item.
   */
  create(data: Partial<T> | Record<string, unknown>): Promise<T>;

  /**
   * Fully replace an item (PUT). Missing properties are set to null.
   */
  update(id: string, data: Partial<T> | Record<string, unknown>): Promise<T>;

  /**
   * Partially update an item (PATCH). Only provided properties are changed.
   */
  patch(id: string, data: Partial<T> | Record<string, unknown>): Promise<T>;

  /**
   * Permanently delete an item.
   */
  delete(id: string): Promise<T>;
}

/**
 * Fluent query builder for single entity operations.
 */
export declare class SingleQuery<T = Record<string, unknown>> {
  /**
   * Fetch the single entity.
   */
  get(): Promise<T>;

  /**
   * Fully replace the single entity (PUT).
   */
  update(data: Partial<T> | Record<string, unknown>): Promise<T>;

  /**
   * Partially update the single entity (PATCH).
   */
  patch(data: Partial<T> | Record<string, unknown>): Promise<T>;
}

/**
 * Fluent query builder for authentication operations.
 */
export declare class AuthQuery<U = Record<string, unknown>> {
  /**
   * Register a new user. Automatically stores the returned token.
   */
  signup(data: { email: string; password: string; [key: string]: unknown }): Promise<AuthResponse<U>>;

  /**
   * Log in an existing user. Automatically stores the returned token.
   */
  login(data: { email: string; password: string }): Promise<AuthResponse<U>>;

  /**
   * Get the currently authenticated user.
   * Requires a token to be set via setToken() or a previous signup/login.
   */
  me(): Promise<U>;

  /**
   * Clear the stored token (log out).
   */
  logout(): void;
}

/**
 * Chadstart SDK client.
 *
 * @example
 * import Chadstart from '@chadstart/sdk'
 *
 * const client = new Chadstart('http://localhost:3000')
 *
 * // Collections
 * const { data } = await client.from('posts').find()
 * const post     = await client.from('posts').findOneById(id)
 * const post     = await client.from('posts').create({ title: 'Hello' })
 * const post     = await client.from('posts').update(id, { title: 'World' })
 * const post     = await client.from('posts').patch(id, { title: 'World' })
 * const deleted  = await client.from('posts').delete(id)
 *
 * // Filtering, ordering & relations
 * const posts = await client
 *   .from('posts')
 *   .where('published = true')
 *   .orderBy('createdAt', { desc: true })
 *   .with(['author'])
 *   .find({ page: 1, perPage: 20 })
 *
 * // Singles
 * const page = await client.single('homepage').get()
 * const page = await client.single('homepage').patch({ title: 'Welcome!' })
 *
 * // Auth
 * const { token, user } = await client.auth('customers').login({ email, password })
 * client.setToken(token)
 * const me = await client.auth('customers').me()
 */
export declare class Chadstart {
  constructor(baseUrl?: string);

  /**
   * Start a collection CRUD query builder.
   * @param slug - Collection slug, e.g. 'posts'
   */
  from<T = Record<string, unknown>>(slug: string): CollectionQuery<T>;

  /**
   * Start a single entity query builder.
   * @param slug - Single entity slug, e.g. 'homepage'
   */
  single<T = Record<string, unknown>>(slug: string): SingleQuery<T>;

  /**
   * Start an authentication query builder.
   * @param slug - Authenticable entity slug, e.g. 'customers'
   */
  auth<U = Record<string, unknown>>(slug: string): AuthQuery<U>;

  /**
   * Set the Bearer token used for authenticated requests.
   * Called automatically after a successful signup() or login().
   */
  setToken(token: string): void;

  /** Clear the stored token. */
  clearToken(): void;
}

export default Chadstart;
