# NEXUS MK-III — Hugging Face Space (port 7860)
# Prebuilt Nitro node-server bundle. The HF factory BUILD_ERRORs on `npm ci`
# (3s cache-miss dump). GitHub Actions builds space-dist/; this image only
# copies it. Explicit COPY: the org deployer forbids bare `COPY .`.
FROM public.ecr.aws/docker/library/node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5

WORKDIR /app
COPY space-dist ./space-dist
WORKDIR /app/space-dist

ENV HOST=0.0.0.0
ENV PORT=7860
ENV NODE_ENV=production

EXPOSE 7860

CMD ["node", "server/index.mjs"]
