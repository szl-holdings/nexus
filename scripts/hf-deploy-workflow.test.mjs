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

// Since 617fb49 ("delegate Nexus publication and bind live source") provider
// writes for SZLHOLDINGS/nexus belong to szl-holdings/.github
// publish-nexus-space.yml. This workflow is a no-secret ownership guard, so it
// must never regain a publisher. The Docker closure includes source directories,
// so every main/PR/merge-group source change must validate the same boundary.

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

test("main pushes and pull requests validate every source change", () => {
  const push = eventBlock("push");
  const pullRequest = eventBlock("pull_request");
  assert.match(push, /^ {4}branches: \[main\]$/m);
  assert.match(pullRequest, /^ {4}branches: \[main\]$/m);
  assert.doesNotMatch(push, /^ {4}paths:/m);
  assert.doesNotMatch(pullRequest, /^ {4}paths:/m);
  assert.match(WORKFLOW, /^ {2}merge_group: \{\}$/m);
});

test("every action is pinned to a full commit SHA", () => {
  const uses = [...WORKFLOW.matchAll(/^\s*uses:\s*(\S+)/gm)].map((match) => match[1]);
  assert.ok(uses.length > 0);
  for (const value of uses) {
    assert.match(value, /^[^@\s]+@[0-9a-f]{40}$/, `unpinned action: ${value}`);
  }
});
