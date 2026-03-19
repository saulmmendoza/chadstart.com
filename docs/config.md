---
id: config
title: ChadStart Configuration
description: Configure ChadStart Database (PostgreSQL, MySQL or SQLite), Port, OpenAPI and environments with a simple config.
---

# Configuration

## Introduction

ChadStart embraces the **convention over configuration** concept: it assumes several logical situations by default without showing you the setting to keep things as simple as possible.

Nevertheless there is still the possibility to adapt your ChadStart app to your needs, especially through the `.env` file. Here is the list of available environment variables:

## General variables

General environment variables.

| Variable      | Default                             | Description                                                                                                                                                 |
| ------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NODE_ENV      | `development`                       | The app environment. For production and staging instances, it should be set to `production`, mostly to turn off live reload on file change.                 |
| PORT          | `3000`                              | The port of your app. You can either adapt your server settings to listen to `3000` or change here to your server's default.                |
| BASE_URL      | `http://localhost:$PORT`            | The base url of your backend. Change it when deploying if you use [file or image upload](./upload.md)                                                       |
| OPEN_API_DOCS | `true` unless `NODE_ENV=production` | Determines whether the OpenAPI doc is shown (formerly Swagger) for your REST API at `/api`. Make sure to set to `true` if you want to display on production |

## Paths

Environment variables related to paths.

| Variable                 | Default         | Description                                                                                                                 |
| ------------------------ | --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| PUBLIC_FOLDER            | `/public`       | The public folder to show [static files](https://expressjs.com/en/starter/static-files.html)                                |
| CHADSTART_FUNCTIONS_FOLDER | `/functions`    | The folder to put your functions for [custom endpoints](./functions.md)                                          |
| CHADSTART_FILE_PATH       | `/chadstart.yaml` | The relative or absolute path of your ChadStart YAML file                                                                    |
| TOKEN_SECRET_KEY         | `-`             | The secret key behind the JWT authentication. Required on production, you can [generate one here](https://jwtsecrets.com/). |

## Database

By default ChadStart runs with [SQLite](https://www.sqlite.org/) to enable instant launch with the `npx chadstart` command.

We recommend switching to [PostgreSQL](https://www.postgresql.org/) or [MySQL](https://www.mysql.com/) or its alternative [MariaDB](https://mariadb.org/) on production for more robustness and to choose from a large number of managed database providers.

| Variable      | Default                | Description                                                               | Applies To         |
| ------------- | ---------------------- | ------------------------------------------------------------------------- | ------------------ |
| DB_ENGINE     | `sqlite`               | Choose `postgres` switching to PostgreSQL or `mysql` for MySQL or MariaDB | All                |
| DB_PATH       | `/data/chadstart.db`   | Path of the database. Your server should have access to this path locally | SQLite             |
| DB_HOST       | `localhost`            | Database host                                                             | PostgreSQL / MySQL |
| DB_PORT       | `5432`                 | Database port                                                             | PostgreSQL / MySQL |
| DB_USERNAME   | `postgres`             | Database username                                                         | PostgreSQL / MySQL |
| DB_PASSWORD   | `postgres`             | Database password                                                         | PostgreSQL / MySQL |
| DB_DATABASE   | `manifest`             | Database name                                                             | PostgreSQL / MySQL |
| DB_SSL        | `false`                | Require SSL for DB connection. Set to true if using remote DB.            | PostgreSQL / MySQL |

### Example configurations

Here are examples of `.env` files for different database connections:

=== "SQLite"
    ```env

     DB_ENGINE=sqlite

     DB_PATH=/data/chadstart.db

     ```

=== "PostgreSQL"
    ```env

     DB_ENGINE=postgres

     DB_HOST=my-host.com
     DB_USERNAME=owner
     DB_PASSWORD=xxxxx
     DB_DATABASE=my_app
     DB_SSL=true # Required for remote managed DBs, remove if local

     ```

=== "MySQL / MariaDB"
    ```env

    DB_ENGINE=mysql

    DB_USERNAME=xxxxx
    DB_PASSWORD=xxxxx
    DB_HOST=my-host.com
    DB_PORT=3306
    DB_DATABASE=my_app
    DB_SSL=true # Required for remote managed DBs, remove if local

    ```

## Error Reporting

ChadStart integrates with [Sentry](https://sentry.io) for automatic exception tracking in production.

To enable, set **only** the `SENTRY_DSN` environment variable — the DSN is a secret and must never be placed in the YAML file.

```env
SENTRY_DSN=https://xxxxx@oXXXXX.ingest.sentry.io/XXXXXXX
```

Non-sensitive settings can be placed in `chadstart.yaml`:

```yaml
sentry:
  environment: production   # optional — defaults to NODE_ENV
  tracesSampleRate: 0.2     # optional — fraction 0.0–1.0, defaults to 1.0
  debug: false              # optional — enable Sentry SDK debug logging
```

:::tip Self-hosted alternative: Bugsink
[Bugsink](https://www.bugsink.com) is a lightweight, privacy-first, self-hosted alternative to Sentry that is **fully compatible with the Sentry SDK**. To use it, simply set `SENTRY_DSN` to your Bugsink ingest URL — no other code changes are needed.
:::

## Integrating ChadStart

**ChadStart has been designed to be easily integrated**, providing a simple yet complete backend to any tool. See how it runs on [Stackblitz](https://chadstart.new) for example.

The backend fits in an [NPM Package](https://www.npmjs.com/package/chadstart) that you can add to your dependencies simply by running `npm install chadstart`. By default, ChadStart uses [SQLite](https://www.sqlite.org/), the n°1 file-based database. This means it's portable and doesn't require any kind of server to run.

If you plan to run ChadStart on a **mounted drive** like most cloud editors do, add the `--mountedDrive` argument to the run command to prevent [watcher errors](https://github.com/remy/nodemon?tab=readme-ov-file#application-isnt-restarting):

```
npm run start -- --mountedDrive
```
