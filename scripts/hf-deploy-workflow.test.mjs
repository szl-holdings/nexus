import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = readFileSync(join(ROOT, ".github/workflows/hf-deploy.yml"), "utf8");

function eventBlock(name) {
  const match = WORKFLOW.match(
    new RegExp(String.raw`\n  ${name}:\n([\s\S]*?)(?=\n  [A-Za-z_][A-Za-z0-9_-]*:|\npermissions:)`),
  );
  assert.ok(match, `missing ${name} event block`);
  return match[1];
}

test("every main update schedules exact-tip publication", () => {
  const push = eventBlock("push");
  assert.match(push, /^    branches: \[main\]$/m);
  assert.doesNotMatch(push, /^    paths(?:-ignore)?:/m);
  assert.match(WORKFLOW, /^      require-default-branch-tip: true$/m);
});

test("pull request validation remains narrowly path-scoped", () => {
  const pullRequest = eventBlock("pull_request");
  assert.match(pullRequest, /^    branches: \[main\]$/m);
  assert.match(pullRequest, /^    paths:$/m);
});
