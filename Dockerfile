# Stage 1: Build frontend and production node_modules
ARG NODE_IMAGE=node:24-bookworm-slim
# Optional short commit hash recorded in backups,
# e.g. --build-arg COMMIT_SHA=$(git rev-parse --short HEAD).
ARG COMMIT_SHA=
FROM ${NODE_IMAGE} AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Optional plugin loader settings baked into the frontend at build time
# (see docs/plugins.md; the plugin platform is currently locked off).
ARG VITE_FRONTDOOR_PLUGIN_MANIFESTS=
ARG VITE_FRONTDOOR_PLUGIN_MODULES=
ARG VITE_FRONTDOOR_ENABLE_SAMPLE_PLUGIN=
ENV VITE_FRONTDOOR_PLUGIN_MANIFESTS=${VITE_FRONTDOOR_PLUGIN_MANIFESTS} \
    VITE_FRONTDOOR_PLUGIN_MODULES=${VITE_FRONTDOOR_PLUGIN_MODULES} \
    VITE_FRONTDOOR_ENABLE_SAMPLE_PLUGIN=${VITE_FRONTDOOR_ENABLE_SAMPLE_PLUGIN}
RUN npm run build \
    && npm prune --omit=dev \
    && npm cache clean --force

# Stage 2: Production
FROM ${NODE_IMAGE}
ARG COMMIT_SHA

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
# package.json provides the app version recorded in backups.
COPY --chown=frontdoor:frontdoor package.json ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && chown frontdoor:frontdoor /data

# Keep every writable path on the /data volume so it survives image upgrades.
ENV NODE_ENV=production \
    DATABASE_PATH=/data/frontdoor.db \
    AVATAR_CACHE_DIR=/data/avatar-cache \
    APP_ICON_CACHE_DIR=/data/app-icon-cache \
    BRANDING_ASSET_DIR=/data/branding \
    PLUGIN_ASSET_DIR=/data/plugins \
    COMMIT_SHA=${COMMIT_SHA}
EXPOSE 3001

LABEL org.opencontainers.image.title="Frontdoor" \
      org.opencontainers.image.source="https://github.com/BuildBandits/frontdoor-oss" \
      org.opencontainers.image.licenses="MIT"

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://localhost:3001/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
