# Stage 1: Build frontend and production node_modules
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build \
    && npm prune --omit=dev \
    && npm cache clean --force

# Stage 2: Production
FROM ${NODE_IMAGE}

RUN apt-get update && apt-get install -y --no-install-recommends \
    gosu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN groupadd --system --gid 1001 frontdoor \
    && useradd --system --uid 1001 --gid frontdoor --home-dir /app --shell /sbin/nologin frontdoor \
    && mkdir -p /data

COPY --from=builder --chown=frontdoor:frontdoor /app/node_modules ./node_modules
COPY --from=builder --chown=frontdoor:frontdoor /app/dist ./dist/
COPY --chown=frontdoor:frontdoor server/ ./server/
COPY --chown=frontdoor:frontdoor shared/ ./shared/
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && chown frontdoor:frontdoor /data

ENV NODE_ENV=production
EXPOSE 3001

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
