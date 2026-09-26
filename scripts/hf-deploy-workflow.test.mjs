import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Normalize line endings: a Windows checkout with core.autocrlf=true has CRLF,
// and the line-anchored patterns below must mean the same thing everywhere.
const WORKFLOW = readFileSync(join(ROOT, ".github/workflows/hf-deploy.yml"), "utf8").replace(
  /\r\n/g,
  "\n",
);

function eventBlock(name) {
  const match = WORKFLOW.match(
    new RegExp(String.raw`\n  ${name}:\n([\s\S]*?)(?=\n  [A-Za-z_][A-Za-z0-9_-]*:|\npermissions:)`),
  );
  assert.ok(match, `missing ${name} event block`);
  return match[1];
}

function pathList(block) {
  const match = block.match(/^ {4}paths:\n((?: {6}- .+\n?)+)/m);
  assert.ok(match, "missing paths list");
  return match[1]
    .split("\n")
    .map((line) => line.replace(/^ {6}- /, "").trim())
    .filter(Boolean);
}

// Since 617fb49 ("delegate Nexus publication and bind live source") provider
// writes for SZLHOLDINGS/nexus belong to szl-holdings/.github
// publish-nexus-space.yml. This workflow is a no-secret ownership guard, so it
// must never regain a publisher and only needs to run when its inputs change.

test("the guard never publishes: provider writes stay with the central publisher", () => {
  assert.match(WORKFLOW, /publish-nexus-space\.yml/);
  for (const fragment of [
    "secrets.HF_",
    "reusable-hf-deploy.yml",
    "upload_file(",
    "create_repo(",
    "restart_space(",
  ]) {
    // The guard's own forbidden-list spells these split ('secrets.' + 'HF_').
    assert.ok(!WORKFLOW.includes(fragment), `local provider writer reintroduced: ${fragment}`);
  }
  assert.match(WORKFLOW, /^permissions:\n {2}contents: read$/m);
  assert.doesNotMatch(WORKFLOW, /:\s*write\b/);
});

test("main pushes and pull requests validate the same guarded inputs", () => {
  const push = eventBlock("push");
  const pullRequest = eventBlock("pull_request");
  assert.match(push, /^ {4}branches: \[main\]$/m);
  assert.match(pullRequest, /^ {4}branches: \[main\]$/m);
  const pushPaths = pathList(push);
  assert.deepEqual(pathList(pullRequest), pushPaths);
  for (const input of [
    ".github/workflows/hf-deploy.yml",
    "README.md",
    "AGENTS.md",
    "space/Dockerfile",
    "source_bound_server.py",
  ]) {
    assert.ok(pushPaths.includes(input), `guard input not watched: ${input}`);
  }
});

test("every action is pinned to a full commit SHA", () => {
  const uses = [...WORKFLOW.matchAll(/^\s*uses:\s*(\S+)/gm)].map((match) => match[1]);
  assert.ok(uses.length > 0);
  for (const value of uses) {
    assert.match(value, /^[^@\s]+@[0-9a-f]{40}$/, `unpinned action: ${value}`);
  }
});
