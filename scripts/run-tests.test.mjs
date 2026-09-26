import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { discoverTestFiles, projectRoot, runProblems, TEST_FLOORS } from "./run-tests.mjs";

const execFileAsync = promisify(execFile);
const RUNNER = join(projectRoot(), "scripts/run-tests.mjs");

function makeTree(files) {
  const root = mkdtempSync(join(tmpdir(), "run-tests-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

// A TypeScript test file (type annotations prove type stripping reaches the
// test child processes) with `passing` passing tests and optional extras.
function nexusTests(passing, extra = "") {
  return [
    'import { test } from "node:test";',
    `const count: number = ${passing};`,
    "for (let i: number = 0; i < count; i++) test(`passing ${i}`, () => {});",
    extra,
    "",
  ].join("\n");
}

/** Run the real runner against `root` the way `npm test` runs it. */
async function runRunner(root) {
  // A test child inherits NODE_TEST_CONTEXT; the runner under test must start
  // as a top-level run, not report into this test's own runner.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--experimental-strip-types", RUNNER, "--root", root],
      { env, maxBuffer: 16 * 1024 * 1024 },
    );
    return { code: 0, output: stdout + stderr };
  } catch (err) {
    return { code: err.code, output: String(err.stdout) + String(err.stderr) };
  }
}

test("discovery walks scripts/ and src/ without a shell glob", () => {
  const root = makeTree({
    "scripts/a.test.mjs": "",
    "scripts/nested/b.test.mjs": "",
    "src/lib/nexus/c.test.ts": "",
    "src/lib/nexus/deep/d.test.ts": "",
    "src/lib/nexus/engine.ts": "",
    "src/node_modules/pkg/e.test.mjs": "",
    "src/lib/nexus/f.spec.ts": "",
    "elsewhere/g.test.mjs": "",
  });
  assert.deepEqual(discoverTestFiles(root), [
    "scripts/a.test.mjs",
    "scripts/nested/b.test.mjs",
    "src/lib/nexus/c.test.ts",
    "src/lib/nexus/deep/d.test.ts",
  ]);
});

test("discovery finds every NEXUS domain test file in this repository", () => {
  const files = discoverTestFiles(projectRoot());
  for (const file of [
    "src/lib/nexus/engine.test.ts",
    "src/lib/nexus/kernel.test.ts",
    "src/lib/nexus/telemetry.test.ts",
    "scripts/run-tests.test.mjs",
  ]) {
    assert.ok(files.includes(file), `not discovered: ${file}`);
  }
});

test("the NEXUS floor is at least the 72 tests wired in by P0", () => {
  const floor = TEST_FLOORS.find((entry) => entry.prefix === "src/lib/nexus/");
  assert.ok(floor);
  assert.ok(floor.min >= 72);
});

test("problems: no files, silent files and a shrunken suite all fail the run", () => {
  const floors = [{ prefix: "src/lib/nexus/", min: 3, label: "NEXUS" }];
  assert.deepEqual(runProblems([], new Map(), []), ["no test files found under scripts, src"]);
  const files = ["src/lib/nexus/a.test.ts", "src/lib/nexus/b.test.ts", "scripts/c.test.mjs"];
  const perFile = new Map([
    ["src/lib/nexus/a.test.ts", { tests: 2, passed: 2, skipped: 0, failed: 0 }],
    ["src/lib/nexus/b.test.ts", { tests: 0, passed: 0, skipped: 0, failed: 0 }],
  ]);
  assert.deepEqual(runProblems(files, perFile, floors), [
    "src/lib/nexus/b.test.ts: ran 0 tests",
    "scripts/c.test.mjs: produced no test results",
    "NEXUS (src/lib/nexus/): 2 passing, floor is 3",
  ]);
  perFile.set("src/lib/nexus/b.test.ts", { tests: 1, passed: 1, skipped: 0, failed: 0 });
  perFile.set("scripts/c.test.mjs", { tests: 1, passed: 1, skipped: 0, failed: 0 });
  assert.deepEqual(runProblems(files, perFile, floors), []);
});

test("npm test passes when 72 NEXUS tests pass", async () => {
  const root = makeTree({ "src/lib/nexus/fixture.test.ts": nexusTests(72) });
  const { code, output } = await runRunner(root);
  assert.equal(code, 0, output);
  assert.match(output, /NEXUS domain tests \(src\/lib\/nexus\/\): 72 passing \(floor 72\)/);
});

test("npm test fails when one NEXUS test fails", async () => {
  const root = makeTree({
    "src/lib/nexus/fixture.test.ts": nexusTests(
      72,
      'test("deliberate failure", () => { throw new Error("deliberate"); });',
    ),
  });
  const { code, output } = await runRunner(root);
  assert.equal(code, 1, output);
  assert.match(output, /at least one test failed/);
});

test("npm test fails when the NEXUS suite shrinks below its floor", async () => {
  const root = makeTree({ "src/lib/nexus/fixture.test.ts": nexusTests(71) });
  const { code, output } = await runRunner(root);
  assert.equal(code, 1, output);
  assert.match(output, /FAIL: NEXUS domain tests \(src\/lib\/nexus\/\): 71 passing, floor is 72/);
});

test("skipped tests do not count toward the floor and are listed with their reason", async () => {
  const root = makeTree({
    "src/lib/nexus/fixture.test.ts": nexusTests(
      71,
      'test("parked", { skip: "QUARANTINED for the fixture" }, () => {});',
    ),
    "scripts/other.test.mjs": 'import { test } from "node:test";\ntest("ok", () => {});\n',
  });
  const { code, output } = await runRunner(root);
  assert.equal(code, 1, output);
  assert.match(output, /1 skipped tests/);
  assert.match(output, /src\/lib\/nexus\/fixture\.test\.ts > parked: QUARANTINED for the fixture/);
  assert.match(output, /71 passing, floor is 72/);
});
