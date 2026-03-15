---
id: functions
title: Functions
description: Add custom functions to your ChadStart app — with multiple runtimes, triggers, and formats.
---

# Functions

## Introduction

Functions let you run custom logic on the server. Each function can be triggered by one or more events: an HTTP request, a scheduled cron job, or an emitted application event.

## Syntax

```yaml title="chadstart.yaml"
functions:
  hello:
    runtime: js         # js (default) | bash | python | go | c++ | ruby | php
    function: hello.js  # file path relative to /functions (or CHADSTART_FUNCTIONS_FOLDER)
    triggers:
      - type: http
        method: GET
        path: /hello
      - type: cron
        schedule: "@daily"
      - type: event
        name: user.created
```

## Triggers

### HTTP trigger

Registers an HTTP route. The function receives an `event` object and a `ctx` context.

```yaml
triggers:
  - type: http
    method: GET   # GET | POST | PUT | PATCH | DELETE
    path: /hello
```

### Cron trigger

Runs the function on a schedule. Supports standard cron expressions and predefined aliases.

```yaml
triggers:
  - type: cron
    schedule: "*/10 * * * *"  # every 10 minutes
  - type: cron
    schedule: "@daily"        # once a day at midnight
```

**Predefined aliases:**

| Alias       | Equivalent      | Description              |
| ----------- | --------------- | ------------------------ |
| `@yearly`   | `0 0 1 1 *`     | Once a year, Jan 1st     |
| `@annually` | `0 0 1 1 *`     | Same as @yearly          |
| `@monthly`  | `0 0 1 * *`     | First day of each month  |
| `@weekly`   | `0 0 * * 0`     | Every Sunday at midnight |
| `@daily`    | `0 0 * * *`     | Every day at midnight    |
| `@midnight` | `0 0 * * *`     | Same as @daily           |
| `@hourly`   | `0 * * * *`     | Every hour               |

### Event trigger

Runs the function when a named event is emitted via the shared `eventBus`.

```yaml
triggers:
  - type: event
    name: user.created
```

Emit from middleware or other functions:

```js
const { eventBus } = require('./core/functions-engine');
eventBus.emit('user.created', { id: user.id });
```

## Function formats (JS runtime)

### Universal (recommended)

```js title="functions/hello.js"
module.exports = async function(event, ctx) {
  if (ctx.trigger === 'http')  return { message: 'Hello from HTTP!' };
  if (ctx.trigger === 'cron')  console.log('Running scheduled task');
  if (ctx.trigger === 'event') console.log('Event payload:', event);
};
```

The `event` object for HTTP triggers contains `{ req, body, query, params, headers }`.
The `ctx` object always has `{ trigger, name }` plus trigger-specific fields (`method`, `path`, `schedule`, `event`).

### AWS Lambda format

```js title="functions/hello.js"
exports.handler = async (event, context) => {
  return { statusCode: 200, body: JSON.stringify({ message: 'Hello!' }) };
};
```

### Cloudflare Workers format

```js title="functions/hello.js"
export default {
  async fetch(request) {
    return new Response(JSON.stringify({ message: 'Hello!' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
```

## Runtimes

| Runtime  | Execution          | Notes                            |
| -------- | ------------------ | -------------------------------- |
| `js`     | In-process         | Default. Supports all formats.   |
| `python` | Persistent worker  | Reads `event` from stdin as JSON |
| `ruby`   | Persistent worker  | Reads `event` from stdin as JSON |
| `php`    | Persistent worker  | Reads `event` from stdin as JSON |
| `bash`   | Per-invocation     | Reads `event` from stdin as JSON |
| `go`     | Per-invocation     | `go run` per invocation          |
| `c++`    | Per-invocation     | Compiled with `g++`              |

Python/Ruby/PHP runtimes spawn one persistent worker process per runtime (not per request) for better performance.

## Configuration

| Option       | Default | Description                                          |
| ------------ | ------- | ---------------------------------------------------- |
| `function`*  | —       | File name relative to the functions folder           |
| `runtime`    | `js`    | Runtime to use                                       |
| `description`| —       | Optional description (shown in OpenAPI docs)         |
| `triggers`*  | —       | Array of trigger definitions                         |

!!! tip
    Set `CHADSTART_FUNCTIONS_FOLDER` in your `.env` to use a different folder than `/functions`.
