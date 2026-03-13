# Docker

ChadStart is available as a Docker image at `ghcr.io/saulmmendoza/chadstart.com`.

## Run with `docker run`

```bash
docker run -p 3000:3000 \
  -e JWT_SECRET=your-secret \
  -v ./chadstart.yaml:/app/chadstart.yaml:ro \
  -v ./chadstart.db:/app/chadstart.db \
  ghcr.io/saulmmendoza/chadstart.com:latest
```

## Run with `docker compose`

1. Create a `.env` file with your secrets:

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)" > .env
```

2. Create a `docker-compose.yml` (or use the provided one):

```yaml
services:
  chadstart:
    image: ghcr.io/saulmmendoza/chadstart.com:latest
    ports:
      - "3000:3000"
    environment:
      JWT_SECRET: ${JWT_SECRET}
    volumes:
      - ./chadstart.yaml:/app/chadstart.yaml:ro
      - ./chadstart.db:/app/chadstart.db
```

3. Start the service:

```bash
docker compose up
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | dev-only default | JWT signing secret — **required in production** |
| `JWT_EXPIRES` | `7d` | Token expiry duration |
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Set to `production` in production |

## Persistent Storage

Mount a volume for the SQLite database to persist data across container restarts:

```bash
-v ./chadstart.db:/app/chadstart.db
```
