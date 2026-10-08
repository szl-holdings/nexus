# Full NEXUS Web Audio workstation — source-bound canonical Space closure.
# The central SZL publisher derives the exact payload from these explicit COPY
# sources, injects SOURCE_GITHUB_SHA, publishes to SZLHOLDINGS/nexus, restarts,
# and attests immutable provider bytes plus the read-only source endpoints.

FROM node:26-bookworm-slim@sha256:662933cf47f013bc8e4beb31a6116448427a82057ba7c42c97e4c5ba766504c2 AS builder
WORKDIR /src
ENV npm_config_cache=/tmp/npm-cache \
    NITRO_PRESET=node-server

COPY package.json package-lock.json ./
RUN npm ci

COPY .grok/app-env.json ./.grok/app-env.json
COPY src ./src
COPY scripts ./scripts
COPY public ./public
COPY server ./server
COPY migrations ./migrations
COPY vite.config.ts tsconfig.json ./
RUN npm run build

FROM node:26-bookworm-slim@sha256:662933cf47f013bc8e4beb31a6116448427a82057ba7c42c97e4c5ba766504c2 AS runtime
WORKDIR /app
ENV HOST=0.0.0.0 \
    PORT=7860 \
    NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps

COPY --from=builder --chown=node:node /src/.output /app/.output
COPY --chown=node:node SOURCE_GITHUB_SHA /app/SOURCE_GITHUB_SHA
COPY --chown=node:node LICENSE /app/LICENSE

USER node
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:7860/healthz').then(async r=>{const j=await r.json();process.exit(r.ok&&j.ready===true?0:1)}).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]