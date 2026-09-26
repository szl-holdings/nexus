import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// CRLF-normalized so the line-anchored checks hold on a Windows checkout.
const CI = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8").replace(/\r\n/g, "\n");
const PACKAGE = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

// The SHAs szl-holdings/.github already runs, so the org has one pin per action.
const APPROVED_PINS = {
  "actions/checkout": "3d3c42e5aac5ba805825da76410c181273ba90b1", // v7.0.1
  "actions/setup-node": "820762786026740c76f36085b0efc47a31fe5020", // v7.0.0
  "actions/setup-python": "5fda3b95a4ea91299a34e894583c3862153e4b97", // v7.0.0
  "step-security/harden-runner": "e14015d583714f6e62063499dc959a02595150a1", // v2.21.1
};

function onBlock() {
  const match = CI.match(/^on:\n([\s\S]*?)^(?=\S)/m);
  assert.ok(match, "missing on: block");
  return match[1];
}

function jobSteps(job) {
  const match = CI.match(
    new RegExp(String.raw`^  ${job}:\n([\s\S]*?)(?=^  [A-Za-z_][\w-]*:\n|(?![\s\S]))`, "m"),
  );
  assert.ok(match, `missing job ${job}`);
  return match[1];
}

test("CI runs on every pull request and every push to main, with no path filter", () => {
  const on = onBlock();
  assert.match(on, /^ {2}push:\n {4}branches: \[main\]$/m);
  assert.match(on, /^ {2}pull_request:$/m);
  assert.doesNotMatch(on, /paths(?:-ignore)?:/);
  assert.doesNotMatch(on, /branches-ignore:/);
});

test("CI is read-only", () => {
  assert.match(CI, /^permissions:\n {2}contents: read\n/m);
  assert.doesNotMatch(CI, /:\s*write\b/);
  assert.doesNotMatch(CI, /secrets\./);
  assert.doesNotMatch(CI, /persist-credentials: true/);
});

test("every action is pinned to the SHA the org already uses", () => {
  const uses = [...CI.matchAll(/^\s*uses:\s*(\S+)/gm)].map((match) => match[1]);
  assert.ok(uses.length >= 6);
  for (const value of uses) {
    const [action, ref] = value.split("@");
    assert.ok(action in APPROVED_PINS, `unapproved action: ${value}`);
    assert.equal(ref, APPROVED_PINS[action], `wrong pin for ${action}`);
  }
});

test("each job hardens the runner before anything else runs", () => {
  for (const job of ["node", "python"]) {
    const steps = jobSteps(job);
    const firstUses = steps.match(/^\s*uses:\s*(\S+)/m);
    assert.ok(firstUses, `${job}: no steps`);
    assert.match(firstUses[1], /^step-security\/harden-runner@/, `${job}: first step`);
  }
});

test("the node job runs the full npm gate", () => {
  const steps = jobSteps("node");
  const order = ["npm ci", "npm run typecheck", "npm run lint", "npm test", "npm run build"];
  let last = -1;
  for (const command of order) {
    const at = steps.indexOf(`run: ${command}\n`);
    assert.notEqual(at, -1, `node job does not run: ${command}`);
    assert.ok(at > last, `${command} is out of order`);
    last = at;
  }
  for (const script of ["typecheck", "lint", "test", "build"]) {
    assert.ok(PACKAGE.scripts[script], `package.json has no "${script}" script`);
  }
});

test("the node job runs on both Node LTS lines the repository uses", () => {
  const steps = jobSteps("node");
  assert.match(steps, /^ {8}node: \["22", "24"\]$/m);
  assert.match(steps, /node-version: \$\{\{ matrix\.node \}\}/);
  assert.match(steps, /fail-fast: false/);
});

test("npm test runs the cross-platform runner, not a shell glob", () => {
  assert.equal(PACKAGE.scripts.test, "node --experimental-strip-types scripts/run-tests.mjs");
  assert.doesNotMatch(PACKAGE.scripts.test, /[*']/);
});

test("the python job compiles, self-tests and runs pytest when tests exist", () => {
  const steps = jobSteps("python");
  assert.match(steps, /git ls-files -z -- '\*\.py' \| xargs -0 -r python -m py_compile/);
  assert.match(steps, /run: python server\.py --selftest\n/);
  assert.match(steps, /run: python source_bound_server\.py --selftest\n/);
  assert.match(steps, /python -m pytest -q/);
});
