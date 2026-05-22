# Stage 1: Build frontend
FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ gosu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Remove build tools after native module compilation
RUN apt-get purge -y python3 make g++ && apt-get autoremove -y

COPY server/ ./server/
COPY shared/ ./shared/
COPY --from=builder /app/dist ./dist/
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN groupadd --system --gid 1001 frontdoor \
    && useradd --system --uid 1001 --gid frontdoor --home-dir /app --shell /sbin/nologin frontdoor \
    && mkdir -p /data \
    && chown -R frontdoor:frontdoor /app /data

ENV NODE_ENV=production
EXPOSE 3001

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
