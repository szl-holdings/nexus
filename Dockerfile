# NEXUS MK-III — Hugging Face Space (port 7860)
# Explicit COPY sources: the org deployer forbids bare `COPY .`.
FROM mirror.gcr.io/library/node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src ./src
COPY scripts ./scripts
COPY public ./public
COPY server ./server
COPY migrations ./migrations
COPY vite.config.ts tsconfig.json LICENSE ./

ENV HOST=0.0.0.0
ENV PORT=7860
ENV NODE_ENV=development

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:7860/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# CLI flags override vite.config.ts so the Space binds 0.0.0.0:7860.
CMD ["node", "scripts/with-app-env.mjs", "vite", "dev", "--host", "0.0.0.0", "--port", "7860"]
