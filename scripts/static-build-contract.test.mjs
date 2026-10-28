#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const viteConfig = readFileSync("vite.config.ts", "utf8");

test("static build target is wired", () => {
  const script = pkg.scripts["build:static"];
  assert.equal(typeof script, "string");
  assert.match(script, /NEXUS_BUILD_TARGET=static/);
  assert.match(script, /verify-built-asset-closure\.mjs/);
  assert.doesNotMatch(script, /db:migrate/);
  assert.match(viteConfig, /process\.env\.NEXUS_BUILD_TARGET === "static"/);
});
