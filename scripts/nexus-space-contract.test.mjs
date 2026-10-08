#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const dockerfile = readFileSync("space/Dockerfile", "utf8");
const middleware = readFileSync("server/middleware/nexus-runtime.ts", "utf8");
const ownership = readFileSync(".github/workflows/hf-deploy.yml", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

test("Space builds and serves the complete Nitro Web Audio workstation", () => {
  assert.match(packageJson.scripts.build, /verify-built-asset-closure\.mjs/);
  assert.equal(
    existsSync("index.html"),
    false,
    "legacy Python HTML must not shadow the TanStack renderer",
  );
  assert.match(dockerfile, /^FROM node:26-bookworm-slim@sha256:[0-9a-f]{64} AS builder$/m);
  assert.match(dockerfile, /NITRO_PRESET=node-server/);
  assert.match(dockerfile, /RUN npm run build/);
  assert.match(dockerfile, /COPY --from=builder --chown=node:node \/src\/\.output \/app\/\.output/);
  assert.match(dockerfile, /CMD \["node", "\.output\/server\/index\.mjs"\]/);
  assert.doesNotMatch(dockerfile, /CMD \["python"/);
  assert.doesNotMatch(dockerfile, /source_bound_server\.py/);
});

test("Space retains an immutable publisher-injected source revision", () => {
  assert.match(dockerfile, /COPY --chown=node:node SOURCE_GITHUB_SHA \/app\/SOURCE_GITHUB_SHA/);
  assert.match(middleware, /path === "\/api\/build-info"/);
  assert.match(middleware, /path === "\/health" \|\| path === "\/healthz"/);
  assert.match(middleware, /cache-control": "no-store"/);
});

test("local repository workflow delegates provider writes to the central publisher", () => {
  assert.match(ownership, /publish-nexus-space\.yml/);
  assert.match(ownership, /NITRO_NODE_WEB_AUDIO/);
  assert.match(ownership, /CMD \["node", "\.output\/server\/index\.mjs"\]/);
  assert.doesNotMatch(ownership, /secrets\.HF_/);
});
