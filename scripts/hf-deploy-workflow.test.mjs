import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

test("the guard checks out and proves the exact event source", () => {
  assert.ok(
    WORKFLOW.includes(
      "env:\n  SOURCE_REVISION: ${{ github.event.pull_request.head.sha || github.event.merge_group.head_sha || github.sha }}",
    ),
  );
  assert.match(WORKFLOW, /ref: \$\{\{ env\.SOURCE_REVISION \}\}/);
  assert.match(WORKFLOW, /test "\$\(git rev-parse HEAD\)" = "\$SOURCE_REVISION"/);
});

test("every action is pinned to a full commit SHA", () => {
  const uses = [...WORKFLOW.matchAll(/^\s*uses:\s*(\S+)/gm)].map((match) => match[1]);
  assert.ok(uses.length > 0);
  for (const value of uses) {
    assert.match(value, /^[^@\s]+@[0-9a-f]{40}$/, `unpinned action: ${value}`);
  }
});

// The inline Python boundary check, exactly as the job runs it.
function boundaryScript() {
  const match = WORKFLOW.match(/\n {10}python - <<'PY'\n([\s\S]*?)\n {10}PY\n/);
  assert.ok(match, "missing inline boundary script");
  return match[1].replace(/^ {10}/gm, "");
}

const GUARDED = [
  ".github/workflows/hf-deploy.yml",
  "space/Dockerfile",
  "source_bound_server.py",
  "server/middleware/nexus-runtime.ts",
  "src/lib/nexus/source-identity.ts",
  "README.md",
  "AGENTS.md",
];

function runBoundary(path, edit) {
  const dir = mkdtempSync(join(tmpdir(), "nexus-boundary-"));
  try {
    for (const file of GUARDED) cpSync(join(ROOT, file), join(dir, file), { recursive: true });
    if (path) writeFileSync(join(dir, path), edit(readFileSync(join(dir, path), "utf8")));
    return spawnSync("python3", ["-I", "-"], { cwd: dir, input: boundaryScript(), encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the boundary check passes on this tree", () => {
  const result = runBoundary();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /authority boundary: PASS/);
});

test("a control missing from its own file fails the boundary check", () => {
  // The workflow spells every control in its own source, so searching it would
  // find each one there; each must be found in the file that carries it.
  for (const [path, pattern] of [
    ["space/Dockerfile", /^COPY [^\n]*SOURCE_GITHUB_SHA[^\n]*$/m],
    ["space/Dockerfile", /^CMD [^\n]*$/m],
    ["src/lib/nexus/source-identity.ts", /publish-nexus-space\.yml/],
    ["src/lib/nexus/source-identity.ts", /runtime: "[A-Z_]+"/],
    ["src/lib/nexus/source-identity.ts", /source_revision: sourceRevision/],
    ["server/middleware/nexus-runtime.ts", /path === "\/api\/build-info"/],
  ]) {
    const result = runBoundary(path, (text) => {
      assert.match(text, pattern, `${path} no longer has ${pattern}`);
      return text.replace(pattern, "");
    });
    assert.notEqual(result.status, 0, `${path} without ${pattern} still passed`);
    assert.match(result.stderr, /missing Nexus publication\/source controls/, result.stderr);
  }
});
