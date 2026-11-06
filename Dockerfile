# Leftover vite-dev image. NOT the Hugging Face Space image.
# Space image is space/Dockerfile (prerendered static build served by Python, port 7860).
# Provider publication is central (AGENTS.md): szl-holdings/.github publish-nexus-space.yml.
# Do not point reusable-hf-deploy at this file.
# Explicit COPY sources: the org deployer forbids bare `COPY .`.
# Base image: the Docker official node image through mirror.gcr.io, pinned to the
# same content-addressed index digest this file used to pull from public.ecr.aws,
# so the image bytes are unchanged. ECR Public answers Dependabot's anonymous tag
# listing with HTTP 429, which failed the weekly docker update job; Dependabot
# reads mirror.gcr.io pins without credentials (scripts/dependabot-docker.test.mjs).
FROM mirror.gcr.io/library/node:26-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68

ARG HF_CACHE_BUST=mkiii-4

WORKDIR /app

ENV npm_config_cache=/tmp/npm-cache

COPY package.json package-lock.json ./
RUN npm ci

COPY src ./src
COPY scripts ./scripts
COPY public ./public
COPY server ./server
COPY migrations ./migrations
COPY vite.config.ts ./
COPY tsconfig.json ./
COPY LICENSE ./
COPY .dockerignore ./

ENV HOST=0.0.0.0
ENV PORT=7860
ENV NODE_ENV=development

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:7860/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# CLI flags override vite.config.ts so the Space binds 0.0.0.0:7860.
CMD ["node", "scripts/with-app-env.mjs", "vite", "dev", "--host", "0.0.0.0", "--port", "7860"]
