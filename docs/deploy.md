---
id: deploy
title: Deploy to Production
description: Deploy your ChadStart backend to production in no time. Server, Databases and Storage options. Deploy on popular cloud providers and use Docker image.
---

# Deploy ChadStart

## Introduction

ChadStart is made to be **self-hosted**: backends can be deployed with ease wherever you want using different methods.

We recommend using [Docker](#docker) to simplify deployments but you also can install ChadStart manually on a VM or on a bare-metal server.

## System requirements

The minimum system requirements to run a small ChadStart backend are **1vCPU** and **512 MB RAM**. It usually corresponds to one of the cheapest options on cloud providers.

The server needs at least [Node.js v18 or more](https://nodejs.org/fr) and a process manager like [pm2](https://github.com/Unitech/pm2/).

### Database

ChadStart works by default in local with SQLite but we recommend to [switch to PostgreSQL](./config.md#database) for production deployments.

All popular hosting providers have their managed PostgreSQL solutions and there are many DB-as-a-Service providers like [Neon](https://neon.tech/) that offer generous free-tier to get started. Here is a list of popular services:

| Provider            | Service Name                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| **Amazon**          | [Amazon Aurora PostgreSQL](https://aws.amazon.com/rds/aurora/features/)                               |
| **Google Cloud**    | [Cloud SQL for PostgreSQL](https://cloud.google.com/sql/docs/postgres)                                |
| **Microsoft Azure** | [Azure Database for PostgreSQL](https://azure.microsoft.com/en-us/products/postgresql/)               |
| **Neon**            | [Neon Database](https://neon.tech/)                                                                   |
| **Crunchy Data**    | [Crunchy Bridge](https://www.crunchydata.com/products/crunchy-bridge)                                 |
| **Aiven**           | [Aiven for PostgreSQL](https://aiven.io/postgresql)                                                   |
| **DigitalOcean**    | [DigitalOcean Managed PostgreSQL](https://www.digitalocean.com/products/managed-databases-postgresql) |
| **Heroku**          | [Heroku Postgres](https://heroku.com/postgres)                                                        |
| **StackGres**       | [StackGres](https://stackgres.io/)                                                                    |
| **Render.com**      | [Render PostgreSQL Database](https://render.com/docs/postgresql-creating-connecting)                  |

:::tip

While you could technically create a [Docker volume](https://docs.docker.com/engine/storage/volumes/) to ensure data persistence for your SQLite database, we found it easier to use any managed PostgreSQL service **even if you never used PostgreSQL**.

:::

### Storage

ChadStart supports local storage and S3 storage.

With **local storage**, files are saved on disk but will be lost when the container restarts if you are using [Docker](https://www.docker.com/).

With **S3 storage**, files are stored externally, ensuring they are persistent and accessible.

Follow the [S3 Storage documentation](./s3-storage) to set it up.

### Environment variables

You need to create a `.env` file at app root level with at least the following variables:

```env title=".env"
TOKEN_SECRET_KEY=%ReplaceByYourKey%
NODE_ENV=production
BASE_URL=https://my-backend.com
```

See more [environment variables](./config.md#general-variables) you may need.

### Start script for production

The `npm run start` script should only be used for **development** as it watches file changes.

Go back to your codebase and open the `package.json` file and add a new **start:prod** script on the scripts list with the value `node node_modules/chadstart/dist/main.js` as following:

```json title="package.json"
"scripts": {
    "start:prod": "node node_modules/chadstart/dist/main.js"
    [...]
}
```

After that you will be able to run ChadStart for production with `npm run start:prod` without watching file changes.

## Docker

[Docker](https://www.docker.com/) is a popular choice among developers. It uses containerization to ensure that the app will work well in any environment.

```dockerfile title="Dockerfile"
# Use the official Node.js image as a base
FROM node:22-slim

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies
RUN npm install && npm cache clean --force && rm -rf /root/.npm && rm -rf /tmp/*

# Copy the rest of your application code
COPY . .

# Set the NODE_ENV environment variable
ENV NODE_ENV=production

# Expose the port the app runs on (adjust as needed)
EXPOSE 3000

# Start the application
CMD ["npm", "run", "start:prod"]
```

## Guides for popular app platform services

Here are some quick guides to launch your app in a few minutes:

<div class="card-container">
  <a href="https://chadstart.com/integrations/digital-ocean" class="card">
    <p>Deploy ChadStart on DigitalOcean App Platform</p>
    <span>➡️</span>
  </a>
    
  <a href="https://chadstart.com/integrations/render" class="card">
    <p>Deploy ChadStart on Render.com</p>
    <span>➡️</span>
  </a>
  
  <a href="https://chadstart.com/integrations/heroku" class="card">
    <p>Deploy ChadStart on Heroku</p>
    <span>➡️</span>
  </a>
</div>
