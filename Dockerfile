# Stage 1: Install production dependencies (requires build tools for native modules)
FROM node:lts-alpine AS deps
WORKDIR /app
RUN apk add --no-cache make g++
COPY package*.json ./
RUN npm ci --omit=dev

# Stage 2: Production image
FROM node:lts-alpine AS runner
WORKDIR /app
# Runtime dependencies
RUN apk add --no-cache bash python3 go ruby g++ \
  && addgroup -S nodejs && adduser -S nodejs -G nodejs \
  && mkdir -p /app/{uploads,public,functions} && chown -R nodejs:nodejs /app
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs . .

USER nodejs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "cli/cli.js", "start"]
