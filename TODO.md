# ChadStart TODO — Feature Review, BaaS Comparison & Roadmap

> **Purpose**: This document serves as a comprehensive task list for improving ChadStart across multiple AI sessions. Each section is self-contained with enough context for an AI agent to pick up and execute independently.

---

## Project Decisions

> These decisions were made by the project owner and should guide all implementation work.

| Decision | Answer | Impact |
|----------|--------|--------|
| **Target audience** | Solo developers and small teams | Prioritize simplicity and PocketBase-level DX over enterprise features |
| **SMTP/Email priority** | Yes, build first | Phase 1 confirmed: SMTP → Email verification → Password reset |
| **Admin UI approach** | Continue single-file SPA | Keep `admin/index.html` as HTMX + Alpine.js; do NOT migrate to React/Vue/Svelte |
| **Managed cloud hosting** | Future possibility | Keep multi-tenancy in mind but don't prioritize; P3-4 stays low priority |
| **Implementation order** | Agrees with recommended phases | Follow Phase 1→5 as documented |
| **Additional SDK languages** | Not a priority | Deprioritize P2-5; JS SDK is sufficient for now |

---

## Table of Contents

1. [Feature Comparison Matrix](#1-feature-comparison-matrix)
2. [Gap Analysis](#2-gap-analysis--missing-features)
3. [Priority Tasks](#3-priority-tasks)
   - [P0 — Critical / Core Parity](#p0--critical--core-parity)
   - [P1 — High Value Features](#p1--high-value-features)
   - [P2 — Developer Experience](#p2--developer-experience)
   - [P3 — Nice to Have](#p3--nice-to-have)
4. [Documentation Tasks](#4-documentation-tasks)
5. [Testing Tasks](#5-testing-tasks)
6. [AI Session Guide](#6-ai-session-guide)

---

## 1. Feature Comparison Matrix

### Legend
- ✅ Fully supported
- 🟡 Partially supported / limited
- ❌ Not supported
- 🔧 Planned / in progress

| Feature | ChadStart | PocketBase | Supabase | Appwrite | Firebase |
|---|---|---|---|---|---|
| **DATA & SCHEMA** | | | | | |
| Declarative schema (YAML/JSON) | ✅ YAML-first | ✅ Admin UI + API | ✅ SQL migrations | ✅ Admin UI | ❌ schemaless |
| Auto REST API generation | ✅ | ✅ | ✅ (PostgREST) | ✅ | ❌ (SDK only) |
| Collections (multi-record) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Singles (single-record) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Relations (belongsTo) | ✅ | ✅ | ✅ (FK) | ✅ | ❌ |
| Relations (belongsToMany) | ✅ | ✅ | ✅ (junction) | ✅ | ❌ |
| Nested/embedded objects (groups) | ✅ | ✅ (JSON) | ✅ (JSONB) | ❌ | ✅ |
| Schema validation | ✅ (JSON Schema) | ✅ | ✅ (pg constraints) | ✅ | 🟡 (rules) |
| Computed/virtual fields | ❌ | ❌ | ✅ (pg views) | ❌ | ❌ |
| Full-text search | ❌ | ❌ | ✅ (pg tsvector) | ✅ | ✅ (Algolia) |
| Database views | ❌ | ❌ | ✅ | ❌ | ❌ |
| **DATABASES** | | | | | |
| SQLite | ✅ | ✅ (embedded) | ❌ | ❌ | ❌ |
| PostgreSQL | ✅ | ❌ | ✅ (primary) | ❌ (MariaDB) | ❌ |
| MySQL | ✅ | ❌ | ❌ | ✅ (MariaDB) | ❌ |
| Single binary / embedded DB | 🟡 (Node + SQLite) | ✅ (Go binary) | ❌ (Docker stack) | ❌ (Docker) | ❌ (cloud) |
| **AUTHENTICATION** | | | | | |
| Email + password | ✅ | ✅ | ✅ | ✅ | ✅ |
| OAuth / social login | ✅ (200+ via Grant) | ✅ (~12 built-in) | ✅ (~20+) | ✅ (~30+) | ✅ (~15) |
| API keys | ✅ | ❌ | ✅ (service keys) | ✅ | ✅ |
| JWT tokens | ✅ | ✅ | ✅ | ✅ | ✅ (custom) |
| Magic link / passwordless | ❌ | ❌ | ✅ | ✅ | ✅ |
| Phone / SMS auth | ❌ | ❌ | ✅ | ✅ | ✅ |
| Multi-factor auth (MFA/2FA) | ❌ | ✅ (OTP) | ✅ | ✅ | ✅ |
| Anonymous auth | ❌ | ❌ | ✅ | ✅ | ✅ |
| Email verification | ❌ | ✅ | ✅ | ✅ | ✅ |
| Password reset flow | ❌ | ✅ | ✅ | ✅ | ✅ |
| Custom auth providers | 🟡 (via Grant) | ✅ | ✅ | ✅ | ✅ |
| Session management | 🟡 (JWT only) | ✅ | ✅ | ✅ | ✅ |
| **ACCESS CONTROL** | | | | | |
| Role-based (public/restricted/admin) | ✅ | ✅ (API rules) | ✅ (RLS) | ✅ (roles) | ✅ (rules) |
| Row-level security | 🟡 (self condition) | ✅ (filter rules) | ✅ (Postgres RLS) | ✅ | ✅ (rules) |
| Per-operation policies | ✅ (CRUD) | ✅ | ✅ | ✅ | ✅ |
| Custom policy expressions | ❌ | ✅ (JS-like) | ✅ (SQL) | 🟡 | ✅ |
| Field-level permissions | ❌ | ❌ | 🟡 | ❌ | ✅ |
| **REALTIME** | | | | | |
| WebSocket subscriptions | ✅ | ✅ (SSE) | ✅ (Postgres changes) | ✅ | ✅ |
| Entity CRUD events | ✅ | ✅ | ✅ | ✅ | ✅ |
| Channel filtering | 🟡 (entity-level) | ✅ (record-level) | ✅ (table/row) | ✅ (channels) | ✅ (path) |
| Presence / online status | ❌ | ❌ | ✅ (Presence) | ❌ | ✅ |
| **FILE STORAGE** | | | | | |
| Local file storage | ✅ | ✅ | ❌ | ✅ | ❌ |
| S3-compatible storage | ✅ | ✅ | ✅ (primary) | ❌ | ✅ (GCS) |
| Image auto-resize | ✅ (Sharp) | ✅ (thumbs) | ✅ (transforms) | ✅ | ✅ (Extensions) |
| File size limits | 🟡 | ✅ | ✅ | ✅ | ✅ |
| MIME type validation | 🟡 | ✅ | ✅ | ✅ | ✅ |
| CDN integration | ❌ | ❌ | ✅ | ❌ | ✅ |
| **FUNCTIONS / SERVERLESS** | | | | | |
| Custom HTTP endpoints | ✅ | 🟡 (Go hooks) | ✅ (Edge Functions) | ✅ | ✅ |
| Multiple runtimes (JS/Python/Go/etc) | ✅ (7 runtimes) | ❌ (Go only) | 🟡 (Deno/TS) | ✅ (14 runtimes) | ✅ (Node/Python) |
| Cron / scheduled jobs | ✅ | ✅ (Go hooks) | ✅ (pg_cron) | ✅ | ✅ |
| Event-driven triggers | ✅ | ✅ (hooks) | ✅ (webhooks) | ✅ | ✅ |
| Lifecycle hooks (before/after CRUD) | ✅ | ✅ (Go hooks) | ✅ (triggers) | ✅ | ❌ |
| Webhook notifications | ✅ | ❌ | ✅ | ✅ | ❌ |
| **ADMIN UI** | | | | | |
| Built-in admin dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |
| CRUD data management | ✅ | ✅ | ✅ (Table Editor) | ✅ | ✅ |
| Schema editor in UI | ❌ (YAML only) | ✅ | ✅ | ✅ | ❌ |
| User management UI | 🟡 | ✅ | ✅ | ✅ | ✅ |
| Logs / monitoring in UI | ❌ | ✅ | ✅ | ✅ | ✅ |
| Custom admin actions | ❌ | ❌ | ❌ | ❌ | ❌ |
| **API & DX** | | | | | |
| OpenAPI / Swagger docs | ✅ (auto-gen) | ❌ | ✅ | ✅ | ❌ |
| TypeScript type generation | ✅ (types.ts) | ✅ | ✅ | ✅ | ✅ |
| Official SDK (JavaScript) | ✅ | ✅ (JS/Dart) | ✅ (JS/Python/etc) | ✅ (many) | ✅ (many) |
| GraphQL API | ❌ | ❌ | ✅ (pg_graphql) | ✅ | ❌ |
| Filtering / pagination | ✅ | ✅ | ✅ | ✅ | ✅ |
| Sorting | ✅ | ✅ | ✅ | ✅ | ✅ |
| Batch operations | ❌ | ❌ | ✅ | ❌ | ✅ |
| **MIGRATIONS** | | | | | |
| Auto schema sync (dev) | ✅ | ✅ | ❌ | ✅ | ✅ |
| Git-based migration generation | ✅ | ❌ | ❌ | ❌ | ❌ |
| SQL migration files | ✅ (Postgrator) | ❌ | ✅ (Flyway-like) | ❌ | ❌ |
| Rollback support | ✅ (undo files) | ✅ (auto backup) | ✅ | ❌ | ❌ |
| **OBSERVABILITY** | | | | | |
| OpenTelemetry support | ✅ | ❌ | ❌ | ❌ | ❌ |
| Sentry error reporting | ✅ | ❌ | ❌ | ❌ | ❌ |
| Request logging | 🟡 | ✅ | ✅ | ✅ | ✅ |
| Metrics / dashboards | ❌ | ❌ | ✅ | ✅ | ✅ |
| **DEPLOYMENT** | | | | | |
| Docker support | ✅ | ✅ | ✅ | ✅ | ❌ (cloud) |
| Self-hosted | ✅ | ✅ | ✅ | ✅ | ❌ |
| Cloud-hosted (managed) | ❌ | ✅ (PocketHost) | ✅ | ✅ (Cloud) | ✅ |
| Single binary deployment | ❌ (Node.js) | ✅ (Go) | ❌ | ❌ | ❌ |
| Edge deployment | ❌ | ❌ | ✅ | ❌ | ✅ |
| **EXTRAS** | | | | | |
| Email sending (SMTP/transactional) | ❌ | ✅ | ❌ (3rd party) | ✅ | ❌ |
| Push notifications | ❌ | ❌ | ❌ | ✅ | ✅ |
| Geolocation queries | ❌ | ❌ | ✅ (PostGIS) | ❌ | ✅ |
| Plugin system | ✅ | ❌ | ✅ (Extensions) | ❌ | ✅ |
| Rate limiting | ✅ | ❌ | ❌ | ✅ | ❌ |
| Data seeding | ✅ | ❌ | ❌ | ❌ | ❌ |
| Hot-reload development | ✅ | ❌ | ❌ | ❌ | ✅ (emulator) |
| Config formats (YAML/JSON/JS) | ✅ (5 formats) | ❌ | ❌ | ❌ | ❌ |

---

## 2. Gap Analysis — Missing Features

### 🔴 Critical Gaps (vs PocketBase)

These are features PocketBase has that ChadStart lacks, which users would notice immediately:

| # | Gap | PocketBase Behavior | Impact |
|---|-----|---------------------|--------|
| G1 | **Email verification flow** | Built-in verify email on signup | High — production apps need this |
| G2 | **Password reset flow** | Built-in forgot/reset password | High — essential for any user-facing app |
| G3 | **Admin logs viewer** | View API request logs in admin | Medium — debugging is harder |
| G4 | **Schema editor in Admin UI** | Create/edit collections in UI | Medium — currently YAML-only |
| G5 | **Record-level realtime filters** | Subscribe to specific records | Medium — currently entity-level only |
| G6 | **MFA / OTP support** | TOTP-based 2FA | Medium — security requirement |
| G7 | **Backup & restore** | One-click backup/restore | Medium — data safety |
| G8 | **File validation (size/MIME)** | Configurable per field | Low-Medium — basic validation exists |

### 🟡 Valuable Gaps (vs Supabase / Appwrite)

Features from the broader BaaS ecosystem worth considering:

| # | Gap | Available In | Impact |
|---|-----|-------------|--------|
| G9 | **Magic link / passwordless auth** | Supabase, Appwrite, Firebase | Medium |
| G10 | **Phone/SMS authentication** | Supabase, Appwrite, Firebase | Medium |
| G11 | **Anonymous auth** | Supabase, Appwrite, Firebase | Low |
| G12 | **GraphQL API** | Supabase, Appwrite | Medium |
| G13 | **Full-text search** | Supabase (pg), Appwrite, Firebase | High |
| G14 | **Batch/bulk operations** | Supabase, Firebase | Medium |
| G15 | **Field-level permissions** | Firebase | Low |
| G16 | **Custom policy expressions** | PocketBase, Supabase | Medium |
| G17 | **Email sending (SMTP)** | PocketBase, Appwrite | High |
| G18 | **Push notifications** | Appwrite, Firebase | Low |
| G19 | **CDN / edge caching** | Supabase, Firebase | Low |
| G20 | **Managed cloud hosting** | All competitors | High (business) |
| G21 | **Presence / online status** | Supabase, Firebase | Low |

### 🟢 ChadStart Unique Advantages

Features where ChadStart **leads** the market:

| # | Advantage | Details |
|---|-----------|---------|
| A1 | **YAML-first declarative config** | Single file defines entire backend — unmatched DX |
| A2 | **Singles (single-record entities)** | No other BaaS has this natively |
| A3 | **7 function runtimes** | JS, Python, Go, C++, Ruby, PHP, Bash — most in any BaaS |
| A4 | **Git-based migration generation** | Auto-diff YAML → SQL — unique workflow |
| A5 | **5 config formats** | YAML, JSON, JSON5, Jsonnet, JS — unmatched flexibility |
| A6 | **OpenTelemetry native** | Production-grade observability built-in |
| A7 | **200+ OAuth providers** | Via Grant — largest provider list |
| A8 | **Data seeding** | Built-in dummy data generation |
| A9 | **Hot-reload dev server** | Instant feedback loop |
| A10 | **Plugin system** | Extensible via npm/GitHub plugins |
| A11 | **3 database engines** | SQLite + PostgreSQL + MySQL from same config |
| A12 | **Property groups** | Reusable nested field sets — unique feature |
| A13 | **Sentry integration** | Built-in error reporting |

---

## 3. Priority Tasks

### P0 — Critical / Core Parity

These tasks bring ChadStart to feature parity with PocketBase for production use.

---

#### TASK P0-1: Email Verification Flow ✅
- **Gap**: G1
- **Status**: ✅ **Complete**
- **Context**: PocketBase and all major BaaS solutions include email verification on signup. Currently ChadStart has no way to verify user emails.
- **Requirements**:
  - [x] Add `emailVerified` (boolean) and `emailVerificationToken` (string) columns to authenticable entities
  - [x] Generate verification token on signup
  - [x] Add `POST /api/auth/:slug/request-verification` endpoint
  - [x] Add `POST /api/auth/:slug/confirm-verification` endpoint (accepts token)
  - [x] SMTP configuration already done in P0-5
  - [x] Send verification email with configurable template
  - [x] Add `requireEmailVerification: true` option on authenticable entities
  - [ ] Update Admin UI to show verification status (deferred — API-only for now)
  - [x] Update OpenAPI spec
  - [x] Add tests (40 tests in test/verification.test.js)
- **Files modified**: `core/auth.js`, `core/db.js`, `core/entity-engine.js`, `core/openapi.js`, `chadstart.schema.json`, `test/verification.test.js`

---

#### TASK P0-2: Password Reset Flow ✅
- **Gap**: G2
- **Status**: ✅ **Complete**
- **Context**: Essential for any user-facing application. PocketBase has built-in forgot/reset password.
- **Requirements**:
  - [x] Add `passwordResetToken` and `passwordResetExpiry` columns
  - [x] Add `POST /api/auth/:slug/request-password-reset` endpoint
  - [x] Add `POST /api/auth/:slug/confirm-password-reset` endpoint
  - [x] Generate secure time-limited token (1h expiry)
  - [x] Send password reset email with configurable template
  - [x] Anti-enumeration: always return 200 on password reset request
  - [x] Update OpenAPI spec
  - [x] Add tests (in test/verification.test.js)
- **Files modified**: `core/auth.js`, `core/db.js`, `core/openapi.js`, `test/verification.test.js`

---

#### TASK P0-3: Admin Logs Viewer ✅
- **Gap**: G3
- **Status**: ✅ **Complete**
- **Context**: PocketBase shows API request logs in the admin UI. Currently ChadStart has no request logging UI.
- **Requirements**:
  - [x] Add request logging middleware (method, path, status, duration, IP, user)
  - [x] Store logs in `_cs_logs` table (with auto-cleanup for old entries)
  - [x] Add `GET /admin/logs` API endpoint (paginated, filterable)
  - [ ] Add Logs page in Admin UI with table view (deferred — API-only for now)
  - [x] Add filters: by status code, method, path, date range
  - [x] Add log retention configuration in YAML
  - [x] Add tests (24 tests in test/logs.test.js)
- **Files modified**: New `core/logs.js`, `server/express-server.js`, `core/entity-engine.js`, `chadstart.schema.json`, `test/logs.test.js`

---

#### TASK P0-4: Backup & Restore ✅
- **Gap**: G7
- **Status**: ✅ **Complete**
- **Context**: PocketBase has one-click backup/restore. Critical for data safety.
- **Requirements**:
  - [x] Add `POST /admin/backup` endpoint (creates database dump)
  - [x] Add `POST /admin/restore` endpoint (restores from dump)
  - [x] Add `GET /admin/backups` endpoint (list available backups)
  - [x] Support SQLite (file copy), PostgreSQL (`pg_dump`), MySQL (`mysqldump`)
  - [x] Add backup directory configuration
  - [ ] Add auto-backup on migration (deferred)
  - [ ] Add scheduled backup option (cron) (deferred)
  - [ ] Add Admin UI backup management page (deferred — API-only for now)
  - [x] Add CLI commands: `npx chadstart backup`, `npx chadstart restore`
  - [x] Add tests (14 tests in test/backup.test.js)
- **Files modified**: New `core/backup.js`, `server/express-server.js`, `cli/cli.js`, `core/entity-engine.js`, `chadstart.schema.json`, `test/backup.test.js`

---

#### TASK P0-5: Email Sending (SMTP) ✅
- **Gap**: G17
- **Status**: ✅ **Complete**
- **Context**: Required by P0-1 and P0-2. PocketBase has built-in SMTP. Needed for verification, password reset, and user notifications.
- **Requirements**:
  - [x] Add `email` section to YAML schema (host, port, username, from, secure, templates)
  - [x] Implement email service in `core/email.js` using nodemailer
  - [x] Support environment variables for credentials (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`)
  - [x] Add configurable email templates (verification, password reset)
  - [x] Add `POST /admin/test-email` endpoint to test SMTP config
  - [x] Add `GET /admin/email/status` endpoint to check SMTP status
  - [x] Add template variable interpolation (`{{name}}`, `{{link}}`, `{{appName}}`)
  - [x] Update schema validation
  - [x] Add tests (36 tests covering config, templates, schema, buildCore)
- **Files modified**: New `core/email.js`, `chadstart.schema.json`, `server/express-server.js`, `core/entity-engine.js`, `chadstart.example.yaml`, `test/email.test.js`
- **Dependency added**: `nodemailer@^8.0.4`

---

### P1 — High Value Features

These significantly improve ChadStart's value proposition.

---

#### TASK P1-1: Full-Text Search
- **Gap**: G13
- **Context**: Supabase uses PostgreSQL tsvector, Appwrite has built-in search. Currently ChadStart only supports `_like` filter suffix.
- **Requirements**:
  - [ ] Add `searchable: true` option on string/text properties
  - [ ] SQLite: Use FTS5 virtual tables
  - [ ] PostgreSQL: Use `tsvector` + `GIN` indexes
  - [ ] MySQL: Use `FULLTEXT` indexes
  - [ ] Add `?search=query` query parameter to collection list endpoints
  - [ ] Add search ranking/relevance ordering
  - [ ] Update OpenAPI spec
  - [ ] Add tests for all 3 DB engines
- **Files to modify**: `core/entity-engine.js`, `core/db.js`, `server/express-server.js`, `chadstart.schema.json`
- **Estimated effort**: Large (2-3 sessions)

---

#### TASK P1-2: MFA / Two-Factor Authentication
- **Gap**: G6
- **Context**: PocketBase supports TOTP-based OTP. Increasingly required for security compliance.
- **Requirements**:
  - [ ] Add `mfa` option on authenticable entities
  - [ ] Implement TOTP generation and verification (RFC 6238)
  - [ ] Add `POST /api/auth/:slug/mfa/setup` — returns QR code / secret
  - [ ] Add `POST /api/auth/:slug/mfa/verify` — verify TOTP code
  - [ ] Add `POST /api/auth/:slug/mfa/disable` — disable MFA
  - [ ] Modify login flow to require TOTP when enabled
  - [ ] Add recovery codes generation
  - [ ] Update Admin UI to show MFA status
  - [ ] Add tests
- **Files to modify**: `core/auth.js`, `server/express-server.js`, `chadstart.schema.json`
- **Estimated effort**: Large (2-3 sessions)
- **New dependency**: `otpauth` or `speakeasy`

---

#### TASK P1-3: Record-Level Realtime Subscriptions
- **Gap**: G5
- **Context**: PocketBase allows subscribing to specific record changes. Currently ChadStart only supports entity-level subscriptions.
- **Requirements**:
  - [ ] Support subscription to specific record: `{ "type": "subscribe", "channel": "Post/abc123" }`
  - [ ] Support filter-based subscriptions: `{ "type": "subscribe", "channel": "Post", "filter": { "status": "published" } }`
  - [ ] Apply access policies to realtime events (don't send events for records user can't read)
  - [ ] Add subscription acknowledgment messages
  - [ ] Update realtime documentation
  - [ ] Add tests
- **Files to modify**: `core/realtime.js`, docs
- **Estimated effort**: Medium (1-2 sessions)

---

#### TASK P1-4: Batch / Bulk Operations
- **Gap**: G14
- **Context**: Supabase and Firebase support batch inserts/updates/deletes. Useful for data import and bulk actions.
- **Requirements**:
  - [ ] Add `POST /api/collections/:slug/batch` endpoint (create multiple records)
  - [ ] Add `PATCH /api/collections/:slug/batch` endpoint (update multiple records)
  - [ ] Add `DELETE /api/collections/:slug/batch` endpoint (delete by IDs)
  - [ ] Wrap batch ops in database transactions
  - [ ] Respect access policies on batch operations
  - [ ] Add batch size limit configuration
  - [ ] Fire realtime events for each record in batch
  - [ ] Update OpenAPI spec and SDK
  - [ ] Add tests
- **Files to modify**: `server/express-server.js`, `core/entity-engine.js`, `chadstart.schema.json`
- **Estimated effort**: Medium (1-2 sessions)

---

#### TASK P1-5: Custom Policy Expressions
- **Gap**: G16
- **Context**: PocketBase allows JS-like expressions in access rules (e.g., `@request.auth.role = "editor"`). Supabase uses SQL policies.
- **Requirements**:
  - [ ] Design expression syntax (e.g., `condition: "@auth.role == 'editor'"`)
  - [ ] Implement expression parser/evaluator
  - [ ] Support common operators: `==`, `!=`, `>`, `<`, `>=`, `<=`, `&&`, `||`
  - [ ] Support variables: `@auth` (current user), `@record` (current record), `@request` (request data)
  - [ ] Apply expressions in middleware chain
  - [ ] Add documentation and examples
  - [ ] Add tests
- **Files to modify**: `core/auth.js`, `server/express-server.js`, `chadstart.schema.json`
- **Estimated effort**: Large (2-3 sessions)

---

#### TASK P1-6: Magic Link / Passwordless Auth
- **Gap**: G9
- **Context**: Supabase, Appwrite, and Firebase support magic link login. Growing user preference.
- **Requirements**:
  - [ ] Add `magicLink: true` option on authenticable entities
  - [ ] Add `POST /api/auth/:slug/magic-link` endpoint (sends email with login link)
  - [ ] Add `GET /api/auth/:slug/magic-link/confirm` endpoint (verifies token, returns JWT)
  - [ ] Generate secure time-limited token (15min default)
  - [ ] Rate-limit magic link requests
  - [ ] Update SDK with `magicLink(entity, email)` method
  - [ ] Add tests
- **Files to modify**: `core/auth.js`, `server/express-server.js`, `chadstart.schema.json`
- **Estimated effort**: Medium (1-2 sessions)
- **Dependencies**: TASK P0-5 (SMTP/Email sending)

---

#### TASK P1-7: Schema Editor in Admin UI
- **Gap**: G4
- **Context**: PocketBase and Supabase allow creating/editing collections directly in the Admin UI. Currently ChadStart requires YAML editing.
- **⚠️ Constraint**: Must remain in the single-file SPA approach (`admin/index.html` with HTMX + Alpine.js). Do NOT introduce React/Vue/Svelte.
- **Requirements**:
  - [ ] Add entity creation form in Admin UI
  - [ ] Add property editor (add/remove/reorder fields)
  - [ ] Add relation configuration UI
  - [ ] Add validation rule editor
  - [ ] Add policy configuration UI
  - [ ] Generate YAML from UI changes and save to config file
  - [ ] Show YAML preview before saving
  - [ ] Support read-only mode for non-YAML configs (Jsonnet, JS)
  - [ ] Add confirmation dialogs for destructive changes
  - [ ] Add tests
- **Files to modify**: `admin/index.html`, `server/express-server.js`, `core/config-loader.js`
- **Estimated effort**: Very Large (3-4 sessions)

---

### P2 — Developer Experience

These improve the developer workflow and adoption.

---

#### TASK P2-1: CHANGELOG.md
- **Context**: No changelog exists. Important for tracking version history.
- **Requirements**:
  - [ ] Create CHANGELOG.md following [Keep a Changelog](https://keepachangelog.com/) format
  - [ ] Document all changes from v1.0.0 to current (v1.0.5)
  - [ ] Add sections: Added, Changed, Deprecated, Removed, Fixed, Security
  - [ ] Reference commit history for accuracy

---

#### TASK P2-2: CONTRIBUTING.md
- **Context**: No contribution guidelines exist.
- **Requirements**:
  - [ ] Create CONTRIBUTING.md
  - [ ] Document: setup instructions, coding style, PR process, testing requirements
  - [ ] Add code of conduct reference
  - [ ] Document architecture overview for contributors

---

#### TASK P2-3: Improved Error Messages
- **Context**: Make error messages more actionable with suggested fixes.
- **Requirements**:
  - [ ] Audit all error paths in `core/` and `server/`
  - [ ] Add error codes (e.g., `CS_AUTH_001`, `CS_DB_001`)
  - [ ] Add suggestion text (e.g., "Did you mean..." for typos in YAML)
  - [ ] Add link to relevant docs in error messages
  - [ ] Add tests for error messages

---

#### TASK P2-4: CLI Improvements
- **Context**: CLI could be more helpful and interactive.
- **Requirements**:
  - [ ] Add `npx chadstart init` — interactive project scaffolding
  - [ ] Add `npx chadstart validate` — validate YAML without starting server
  - [ ] Add `npx chadstart info` — show project info (entities, endpoints, etc.)
  - [ ] Add `npx chadstart generate:entity <name>` — add entity to YAML
  - [ ] Add `npx chadstart generate:function <name>` — scaffold function file
  - [ ] Colorized output with progress indicators
  - [ ] Add `--verbose` and `--quiet` flags
- **Files to modify**: `cli/cli.js`
- **Estimated effort**: Medium (1-2 sessions)

---

#### TASK P2-5: Additional SDK Languages _(deprioritized)_
- **Status**: ⏸️ **Not a priority** — Owner confirmed JS SDK is sufficient for current target audience (solo devs / small teams).
- **Context**: Currently only JavaScript SDK exists. PocketBase has JS+Dart, Supabase has JS+Python+Swift+Kotlin+C#+Flutter.
- **Requirements** (if revisited later):
  - [ ] Python SDK (`pip install chadstart`)
  - [ ] Dart/Flutter SDK (`pub add chadstart`)
  - [ ] Go SDK
  - [ ] Auto-generate SDKs from OpenAPI spec (consider openapi-generator)
- **Estimated effort**: Large per SDK (1-2 sessions each)

---

#### TASK P2-6: Troubleshooting & FAQ Documentation
- **Context**: No troubleshooting guide exists in docs/.
- **Requirements**:
  - [ ] Create `docs/troubleshooting.md`
  - [ ] Document common errors and solutions
  - [ ] Add FAQ section
  - [ ] Add database-specific troubleshooting (SQLite, PostgreSQL, MySQL)
  - [ ] Add deployment troubleshooting
  - [ ] Update mkdocs.yml navigation

---

#### TASK P2-7: Architecture Documentation
- **Context**: No architecture overview for contributors/power-users.
- **Requirements**:
  - [ ] Create `docs/architecture.md`
  - [ ] Document core module responsibilities
  - [ ] Add data flow diagrams (request → middleware → handler → DB → response)
  - [ ] Document plugin architecture
  - [ ] Document realtime event flow
  - [ ] Document function runtime execution model

---

### P3 — Nice to Have

Lower priority features that would differentiate ChadStart further.

---

#### TASK P3-1: GraphQL API
- **Gap**: G12
- **Context**: Supabase uses pg_graphql, Appwrite has built-in GraphQL. Could auto-generate from entity schema.
- **Requirements**:
  - [ ] Auto-generate GraphQL schema from YAML entities
  - [ ] Implement queries (list, get by ID, filtered)
  - [ ] Implement mutations (create, update, delete)
  - [ ] Implement subscriptions (realtime via WebSocket)
  - [ ] Add GraphQL playground UI at `/graphql`
  - [ ] Respect access policies
  - [ ] Add tests
- **Estimated effort**: Very Large (4-5 sessions)

---

#### TASK P3-2: Phone/SMS Authentication
- **Gap**: G10
- **Context**: Supabase, Appwrite, and Firebase support phone auth. Requires SMS provider integration.
- **Requirements**:
  - [ ] Add `phone` property type
  - [ ] Integrate with Twilio or similar SMS provider
  - [ ] Add `POST /api/auth/:slug/phone/send-code` endpoint
  - [ ] Add `POST /api/auth/:slug/phone/verify` endpoint
  - [ ] Add SMS configuration in YAML
- **Estimated effort**: Medium (1-2 sessions)
- **New dependency**: SMS provider SDK

---

#### TASK P3-3: Computed / Virtual Fields
- **Gap**: G9 (partial)
- **Context**: Supabase supports this via PostgreSQL views.
- **Requirements**:
  - [ ] Add `computed: true` option on properties
  - [ ] Support expression-based computation (`expression: "firstName || ' ' || lastName"`)
  - [ ] Compute on read (not stored)
  - [ ] Support in API responses
  - [ ] Add tests
- **Estimated effort**: Medium (1-2 sessions)

---

#### TASK P3-4: Managed Cloud Hosting
- **Gap**: G20
- **Context**: PocketBase has PocketHost, Supabase/Appwrite/Firebase all have managed cloud. This is a business-level feature.
- **Requirements**:
  - [ ] Design multi-tenant architecture
  - [ ] Build deployment automation
  - [ ] Add billing/usage tracking
  - [ ] Add project management dashboard
  - [ ] Add custom domain support
  - [ ] Add SSL provisioning
- **Estimated effort**: Epic (many sessions, separate project)

---

#### TASK P3-5: Database Views / Computed Collections
- **Context**: Allow read-only collections backed by SQL views or aggregations.
- **Requirements**:
  - [ ] Add `view` entity type
  - [ ] Define SQL query in YAML
  - [ ] Auto-generate read-only API endpoints
  - [ ] Support in Admin UI (read-only mode)
- **Estimated effort**: Medium (1-2 sessions)

---

#### TASK P3-6: Import/Export Data
- **Context**: Ability to import/export data in CSV, JSON formats.
- **Requirements**:
  - [ ] Add `POST /api/collections/:slug/import` (CSV/JSON upload)
  - [ ] Add `GET /api/collections/:slug/export` (CSV/JSON download)
  - [ ] Add import/export buttons in Admin UI
  - [ ] Handle validation errors during import
  - [ ] Support large files with streaming
- **Estimated effort**: Medium (1-2 sessions)

---

#### TASK P3-7: Audit Log / Activity Trail
- **Context**: Track all data changes with who/what/when for compliance.
- **Requirements**:
  - [ ] Add `audit: true` option on entities
  - [ ] Create `_cs_audit_log` table (entity, record_id, action, user_id, old_data, new_data, timestamp)
  - [ ] Add `GET /admin/audit-log` endpoint
  - [ ] Add audit log viewer in Admin UI
  - [ ] Add retention policy configuration
- **Estimated effort**: Medium (1-2 sessions)

---

#### TASK P3-8: Webhooks Management UI
- **Context**: Currently webhooks are configured in YAML only. Admin UI management would improve DX.
- **Requirements**:
  - [ ] Add webhook management page in Admin UI
  - [ ] Show webhook delivery history (success/fail)
  - [ ] Allow retry failed deliveries
  - [ ] Show request/response details
- **Estimated effort**: Medium (1-2 sessions)

---

## 4. Documentation Tasks

| # | Task | Priority | File |
|---|------|----------|------|
| D1 | Create CHANGELOG.md | P2 | `CHANGELOG.md` |
| D2 | Create CONTRIBUTING.md | P2 | `CONTRIBUTING.md` |
| D3 | Create troubleshooting guide | P2 | `docs/troubleshooting.md` |
| D4 | Create architecture overview | P2 | `docs/architecture.md` |
| D5 | Add comparison page (vs PocketBase, etc.) | P2 | `docs/comparison.md` |
| D6 | Improve API reference docs | P2 | `docs/api-reference.md` |
| D7 | Add migration/upgrade guide | P2 | `docs/upgrading.md` |
| D8 | Add performance tuning guide | P3 | `docs/performance.md` |
| D9 | Add security hardening guide | P2 | `docs/security.md` (expand existing) |
| D10 | Add example projects/templates | P2 | `examples/` directory |

---

## 5. Testing Tasks

| # | Task | Priority | Notes |
|---|------|----------|-------|
| T1 | Add PostgreSQL CI test matrix | P1 | Currently tests only run on SQLite |
| T2 | Add MySQL CI test matrix | P1 | Need Docker MySQL in CI |
| T3 | Add E2E tests for Admin UI | P2 | Playwright tests for admin workflows |
| T4 | Add OAuth integration tests | P2 | Mock OAuth provider |
| T5 | Add load/performance tests | P3 | k6 or artillery |
| T6 | Add security tests (OWASP) | P1 | SQL injection, XSS, CSRF |
| T7 | Increase code coverage to >80% | P2 | Current coverage unknown |

---

## 6. AI Session Guide

### How to Use This Document

Each task is designed to be self-contained. An AI agent can:

1. **Pick a task** by ID (e.g., "Implement TASK P0-5")
2. **Read the requirements** — all context needed is in the task description
3. **Find the files** — file paths are listed for each task
4. **Implement** — follow the requirements checklist
5. **Test** — run `npm test` to verify
6. **Mark complete** — check off items in this TODO.md

### Session Templates

#### Starting a new feature session:
```
Implement TASK [ID] from TODO.md. Follow the requirements checklist.
The repository is at /home/runner/work/chadstart.com/chadstart.com.
Run existing tests with `npm test` to verify no regressions.
```

#### Starting a documentation session:
```
Complete documentation task [D#] from TODO.md.
The docs/ directory uses MkDocs with Material theme.
Update mkdocs.yml navigation if adding new pages.
```

#### Starting a testing session:
```
Complete testing task [T#] from TODO.md.
Existing tests are in test/*.test.js using Mocha.
Run with: npm test
```

### Recommended Implementation Order

```
Phase 1 (Foundation):
  P0-5 → P0-1 → P0-2    (Email → Verification → Password Reset)

Phase 2 (Core Parity):
  P0-3 → P0-4            (Logs → Backup)
  P1-3 → P1-4            (Realtime filters → Batch ops)

Phase 3 (Differentiation):
  P1-1 → P1-5            (Full-text search → Custom policies)
  P1-2 → P1-6            (MFA → Magic links)

Phase 4 (DX & Polish):
  P2-1 → P2-7            (All DX tasks)
  P1-7                    (Schema editor in Admin UI)

Phase 5 (Advanced):
  P3-1 → P3-8            (GraphQL, Phone auth, etc.)
```

### Key File Reference

| File/Directory | Purpose |
|---|---|
| `core/entity-engine.js` | Schema parsing, entity building, relations |
| `core/auth.js` | Authentication, authorization, API keys |
| `core/db.js` | Database abstraction (SQLite/PG/MySQL) |
| `core/realtime.js` | WebSocket subscriptions |
| `core/functions-engine.js` | Custom functions & triggers |
| `core/config-loader.js` | YAML/JSON/Jsonnet config loading |
| `core/oauth.js` | OAuth/social login |
| `core/migrations.js` | Database migration engine |
| `core/openapi.js` | OpenAPI spec generation |
| `core/telemetry.js` | OpenTelemetry + Sentry |
| `server/express-server.js` | Express app builder, route registration |
| `admin/index.html` | Admin UI (single-file SPA) |
| `cli/cli.js` | CLI commands |
| `chadstart.schema.json` | YAML config validation schema |
| `chadstart.example.yaml` | Full config reference |
| `test/*.test.js` | Test suite (Mocha) |

---

*Last updated: 2026-03-30 (decisions incorporated)*
*ChadStart version: 1.0.5*
