#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const dockerfile = readFileSync("space/Dockerfile", "utf8");
const middleware = readFileSync("server/middleware/nexus-runtime.ts", "utf8");
const appServer = readFileSync("space/app_server.py", "utf8");
const ownership = readFileSync(".github/workflows/hf-deploy.yml", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const rootRoute = readFileSync("src/routes/__root.tsx", "utf8");
const viteConfig = readFileSync("vite.config.ts", "utf8");
const workstation = readFileSync("src/components/nexus/Workstation.tsx", "utf8");
const patchbay = readFileSync("src/components/nexus/Patchbay.tsx", "utf8");
const voice = readFileSync("src/components/nexus/Voice.tsx", "utf8");
const readme = readFileSync("README.md", "utf8");
const ci = readFileSync(".github/workflows/ci.yml", "utf8");

test("Space serves the prerendered Web Audio workstation from a Python-only runtime", () => {
  assert.match(packageJson.scripts.build, /verify-built-asset-closure\.mjs/);
  assert.match(packageJson.scripts["build:static"], /verify-built-asset-closure\.mjs/);
  assert.equal(
    existsSync("index.html"),
    false,
    "legacy Python HTML must not shadow the TanStack renderer",
  );
  assert.match(dockerfile, /^FROM node:26-bookworm-slim@sha256:[0-9a-f]{64} AS builder$/m);
  assert.match(viteConfig, /preset: process\.env\.NITRO_PRESET \|\| "node-server"/);
  assert.match(dockerfile, /^RUN npm run build:static$/m);
  assert.match(dockerfile, /^FROM python:3\.12-slim@sha256:[0-9a-f]{64} AS runtime$/m);
  assert.match(
    dockerfile,
    /^COPY --from=builder --chown=nexus:nexus \/src\/\.output\/public \/app\/static$/m,
  );
  assert.match(dockerfile, /^COPY --chown=nexus:nexus space\/app_server\.py space\/nexus_runtime\.py \/app\/$/m);
  assert.match(dockerfile, /^CMD \["python", "-I", "-B", "\/app\/app_server\.py"\]$/m);
  assert.match(dockerfile, /HEALTHCHECK [^\n]*\\\n\s+CMD python /);
  assert.doesNotMatch(dockerfile, /CMD \["node"/);
  assert.doesNotMatch(dockerfile, /\.output\/server/);
  assert.doesNotMatch(dockerfile, /RUN (pip|python -m pip)/);
  assert.doesNotMatch(dockerfile, /source_bound_server\.py/);
  const runtimeStage = dockerfile.slice(dockerfile.indexOf("AS runtime"));
  assert.doesNotMatch(runtimeStage, /\bnode\b(?!:)/, "runtime stage must not install or run Node");
  assert.match(runtimeStage, /^USER nexus$/m);
  assert.doesNotMatch(readme, /Nitro runtime/, "the Space card must name the runtime it ships");
});

test("CI container job checks the user the Space image runs as", () => {
  const user = dockerfile.match(/^USER (\S+)$/m)?.[1];
  assert.equal(user, "nexus");
  assert.match(ci, new RegExp(`\\{\\{\\.Config\\.User\\}\\}' "\\$name"\\)" = ${user}$`, "m"));
});

test("root CSS is discovered from the client route manifest", () => {
  assert.match(rootRoute, /import "\.\.\/styles\.css";/);
  assert.doesNotMatch(rootRoute, /styles\.css\?url/);
  assert.doesNotMatch(viteConfig, /ssrEmitAssets/);
});

test("keyboard navigation and mobile scene targets remain accessible", () => {
  assert.doesNotMatch(workstation, /e\.code === "Tab"/);
  assert.match(workstation, /e\.code === "KeyP"/);
  assert.match(workstation, /min-h-11 min-w-11 shrink-0/);
  assert.match(readme, /Tab remains standard keyboard navigation/);
});

test("canonical runtime ships without Grok chrome or remote font dependencies", () => {
  assert.doesNotMatch(rootRoute, /PreviewHostBridge|__grok|fonts\.googleapis|fonts\.gstatic/);
  assert.doesNotMatch(viteConfig, /grokPwaPlugin/);
  assert.match(dockerfile, /COPY \.grok\/app-env\.json \.\/\.grok\/app-env\.json/);
  assert.doesNotMatch(dockerfile, /COPY \.grok \.\/\.grok/);
  assert.equal(existsSync("server/middleware/grok-pwa.ts"), false);
  assert.equal(existsSync("public/__grok"), false);
});

test("instrument buttons preserve the 44 pixel target floor", () => {
  assert.match(patchbay, /min-h-11 min-w-11/);
  assert.match(voice, /nx-btn min-h-11 min-w-11/);
  assert.match(voice, /nx-key-black[^`]*min-w-11/);
});

test("Space retains an immutable publisher-injected source revision", () => {
  assert.equal(dockerfile.match(/^COPY[^\n]*SOURCE_GITHUB_SHA/gm)?.length, 1);
  assert.match(dockerfile, /^COPY --chown=nexus:nexus SOURCE_GITHUB_SHA \/app\/SOURCE_GITHUB_SHA$/m);
  assert.match(appServer, /if path == "\/api\/build-info":/);
  assert.match(appServer, /if path in \("\/health", "\/healthz"\):/);
  assert.match(appServer, /"cache-control": "no-store"/);
  assert.match(middleware, /path === "\/api\/build-info"/);
  assert.match(middleware, /path === "\/health" \|\| path === "\/healthz"/);
  assert.match(middleware, /cache-control": "no-store"/);
});

test("local repository workflow delegates provider writes to the central publisher", () => {
  assert.match(ownership, /publish-nexus-space\.yml/);
  assert.match(ownership, /PYTHON_STDLIB_STATIC_WEB_AUDIO/);
  assert.match(ownership, /CMD \["python", "-I", "-B", "\/app\/app_server\.py"\]/);
  assert.match(ownership, /COPY --chown=nexus:nexus SOURCE_GITHUB_SHA \/app\/SOURCE_GITHUB_SHA/);
  assert.doesNotMatch(ownership, /CMD \["node"/);
  assert.doesNotMatch(ownership, /secrets\.HF_/);
});
