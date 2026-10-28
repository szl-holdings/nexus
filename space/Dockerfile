# Full NEXUS Web Audio workstation — source-bound canonical Space closure.
# The central SZL publisher derives the exact payload from these explicit COPY
# sources, injects SOURCE_GITHUB_SHA, publishes to SZLHOLDINGS/nexus, restarts,
# and attests immutable provider bytes plus the read-only source endpoints.
#
# Node runs only in the builder stage to prerender the browser workstation.
# The runtime stage is Python 3.12 stdlib: space/app_server.py serves the static
# files and the read-only runtime API.

FROM node:26-bookworm-slim@sha256:662933cf47f013bc8e4beb31a6116448427a82057ba7c42c97e4c5ba766504c2 AS builder
WORKDIR /src
ENV npm_config_cache=/tmp/npm-cache

COPY package.json package-lock.json ./
RUN npm ci

COPY .grok/app-env.json ./.grok/app-env.json
COPY src ./src
COPY scripts ./scripts
COPY public ./public
COPY server ./server
COPY migrations ./migrations
COPY vite.config.ts tsconfig.json ./
RUN npm run build:static

FROM python:3.12-slim@sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159 AS runtime
WORKDIR /app
ENV HOST=0.0.0.0 \
    PORT=7860 \
    NEXUS_STATIC_DIR=/app/static \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN useradd --system --no-create-home --shell /usr/sbin/nologin nexus

COPY --from=builder --chown=nexus:nexus /src/.output/public /app/static
COPY --chown=nexus:nexus space/app_server.py space/nexus_runtime.py /app/
COPY --chown=nexus:nexus SOURCE_GITHUB_SHA /app/SOURCE_GITHUB_SHA
COPY --chown=nexus:nexus LICENSE /app/LICENSE

USER nexus
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD python -I -c "import json,sys,urllib.request as u; r=u.build_opener(u.ProxyHandler({})).open('http://127.0.0.1:7860/healthz',timeout=4); sys.exit(0 if r.status==200 and json.load(r).get('ready') is True else 1)"
CMD ["python", "-I", "-B", "/app/app_server.py"]
