import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// CRLF-normalized so the line-anchored checks hold on a Windows checkout.
const WORKFLOW = readFileSync(join(ROOT, ".github/workflows/forbidden-domain.yml"), "utf8").replace(
  /\r\n/g,
  "\n",
);
// Spelled in pieces so this file never carries the domain it tests for.
const FORBIDDEN = "a11oy" + ".com";

/** The inline scanner, exactly as the job runs it. */
function scanScript() {
  const match = WORKFLOW.match(/\n {10}python3 -I - <<'PY'\n([\s\S]*?)\n {10}PY\n/);
  assert.ok(match, "missing inline scanner");
  return match[1].replace(/^ {10}/gm, "");
}

function scan(cwd) {
  return spawnSync("python3", ["-I", "-"], { cwd, input: scanScript(), encoding: "utf8" });
}

/** Run the scanner in a fresh git repository whose index holds `files`. */
function scanFixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "nexus-forbidden-domain-"));
  try {
    const git = (...args) => {
      const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    };
    git("init", "-q");
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
      git("add", "--", path);
    }
    return scan(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the gate is read-only, pinned and hardened like the other workflows", () => {
  assert.match(WORKFLOW, /^permissions:\n {2}contents: read\n/m);
  // The header comment quotes the template's `|| true`; only executable lines count.
  const code = WORKFLOW.split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  assert.doesNotMatch(code, /:\s*write\b|secrets\.|continue-on-error|\|\| true|set \+e/);
  const uses = [...WORKFLOW.matchAll(/^\s*(?:- )?uses:\s*(\S+)/gm)].map((match) => match[1]);
  assert.deepEqual(uses, [
    "step-security/harden-runner@46b06cea07f9e64621fdf066ba77ac6915163d43",
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  ]);
  assert.match(WORKFLOW, /persist-credentials: false/);
  for (const trigger of ["push", "pull_request", "merge_group"]) {
    assert.match(WORKFLOW, new RegExp(String.raw`^ {2}${trigger}:`, "m"));
  }
});

test("this repository passes the scan", () => {
  const result = scan(ROOT);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^OK: scanned \d+ tracked text files/m);
});

test("a forbidden reference fails the gate and is reported with its location", () => {
  const result = scanFixture({
    "README.md": "# demo\n",
    "docs/links.md": `intro\nsee https://${FORBIDDEN}/docs\n`,
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /::error::Forbidden domain references found/);
  assert.ok(result.stdout.includes(`docs/links.md:2:see https://${FORBIDDEN}/docs`), result.stdout);
});

test("guard contexts, hyphenated hosts and the canonical surfaces pass", () => {
  const result = scanFixture({
    "notes.md": [
      `The legacy ${FORBIDDEN} is forbidden.`,
      `assertNotIn("${FORBIDDEN}", page)`,
      `https://szl-${FORBIDDEN}/x`,
      "https://a-11-oy.com and https://a11oy.net",
    ].join("\n"),
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^OK: scanned 1 tracked text files/m);
});

test("binary files are skipped, as ripgrep skips them", () => {
  const result = scanFixture({
    "README.md": "# demo\n",
    "blob.bin": `\0\0https://${FORBIDDEN}\0`,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^OK: scanned 1 tracked text files/m);
});

test("a scan that cannot run fails closed instead of reporting OK", () => {
  const empty = scanFixture({});
  assert.notEqual(empty.status, 0);
  assert.match(empty.stderr, /listed no files; nothing was scanned/);
  assert.doesNotMatch(empty.stdout, /^OK:/m);

  const onlyBinary = scanFixture({ "blob.bin": "\0" });
  assert.notEqual(onlyBinary.status, 0);
  assert.match(onlyBinary.stderr, /no tracked text files; nothing was scanned/);

  const notARepository = mkdtempSync(join(tmpdir(), "nexus-forbidden-domain-"));
  try {
    const result = scan(notARepository);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /^OK:/m);
  } finally {
    rmSync(notARepository, { recursive: true, force: true });
  }
});
