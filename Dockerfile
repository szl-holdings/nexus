# Leftover vite-dev image. NOT the Hugging Face Space image.
# Space image is space/Dockerfile (prebuilt Nitro node-server, port 7860).
# Canonical publisher: szl-holdings/yarqa deploy-nexus.yml.
# Do not point reusable-hf-deploy at this file.
# Explicit COPY sources: the org deployer forbids bare `COPY .`.
# Base image: estate HF factory pin (public.ecr.aws), matching yarqa.
FROM public.ecr.aws/docker/library/node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5

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
