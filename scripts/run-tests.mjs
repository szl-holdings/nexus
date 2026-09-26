#!/usr/bin/env node
/**
 * `npm test`: discover every test file and run it with `node:test`.
 *
 * The previous `npm test` handed node a single-quoted glob
 * (`node --test 'scripts/**\/*.test.mjs'`). POSIX shells strip the quotes and
 * node expands the glob. cmd.exe keeps the quotes, so on Windows node looked
 * for a file literally named `'scripts/**\/*.test.mjs'`, ran 0 tests and
 * exited 0. The NEXUS domain tests under `src/lib/nexus/` were not wired in at
 * all. This runner walks the tree with `node:fs` instead of relying on a shell
 * glob, so every platform runs the same files.
 *
 * It fails the run (exit 1) when:
 *   - any test, suite or test file fails;
 *   - no test file is found, or a discovered file runs zero tests;
 *   - a guarded directory runs fewer passing tests than its floor
 *     (`TEST_FLOORS`). A suite that silently shrinks is not "green".
 *
 * Skipped tests are listed with their reason at the end of the run, so a
 * quarantine is always visible in the output (see `scaffold-quarantine.mjs`).
 *
 * TypeScript tests run through node's built-in type stripping. The npm script
 * passes `--experimental-strip-types` to this process and node:test forwards
 * the process's own flags to every test child process.
 *
 * Usage: node --experimental-strip-types scripts/run-tests.mjs [--root <dir>]
 */
import { readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { finished } from "node:stream/promises";
import { run } from "node:test";
import { spec } from "node:test/reporters";
import { fileURLToPath } from "node:url";

/** Directories (relative to the root) searched recursively for test files. */
export const TEST_ROOTS = ["scripts", "src"];

/** File name suffixes that mark a test file. */
export const TEST_SUFFIXES = [".test.mjs", ".test.js", ".test.ts", ".test.mts"];

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".output", ".nitro", ".vercel"]);

/**
 * Minimum number of passing (not skipped) tests per directory prefix.
 * `src/lib/nexus/` holds the NEXUS domain tests (engine, kernel, telemetry):
 * 72 at the time they were wired into `npm test`. Raise the floor when tests
 * are added. Lowering it means tests were deleted, and that belongs in review.
 */
export const TEST_FLOORS = [{ prefix: "src/lib/nexus/", min: 72, label: "NEXUS domain tests" }];

/** The repository root (this file lives in `<root>/scripts/`). */
export function projectRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

/** `path` relative to `root`, always with forward slashes. */
export function toPosixRelative(root, path) {
  return relative(root, path).split(sep).join("/");
}

/**
 * Every test file under `TEST_ROOTS`, as sorted root-relative POSIX paths.
 * Missing roots are skipped; build output and dependencies are never entered.
 */
export function discoverTestFiles(root) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (err?.code === "ENOENT" || err?.code === "ENOTDIR") return;
      throw err;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path);
      } else if (entry.isFile() && TEST_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
        found.push(toPosixRelative(root, path));
      }
    }
  };
  for (const testRoot of TEST_ROOTS) walk(join(root, testRoot));
  return found.sort();
}

/** Passing (not skipped) tests summed over every file under `prefix`. */
export function passingUnder(perFile, prefix) {
  let passed = 0;
  for (const [file, counts] of perFile) {
    if (file.startsWith(prefix)) passed += counts.passed;
  }
  return passed;
}

/**
 * Problems with a finished run, given per-file counts
 * (`Map<relativePath, { tests, passed, skipped, failed }>`).
 * An empty list means the run proved what it claims to.
 */
export function runProblems(files, perFile, floors = TEST_FLOORS) {
  const problems = [];
  if (files.length === 0) {
    problems.push(`no test files found under ${TEST_ROOTS.join(", ")}`);
  }
  for (const file of files) {
    const counts = perFile.get(file);
    if (!counts) {
      problems.push(`${file}: produced no test results`);
    } else if (counts.tests === 0) {
      problems.push(`${file}: ran 0 tests`);
    }
  }
  for (const floor of floors) {
    const passed = passingUnder(perFile, floor.prefix);
    if (passed < floor.min) {
      problems.push(`${floor.label} (${floor.prefix}): ${passed} passing, floor is ${floor.min}`);
    }
  }
  return problems;
}

function parseArgs(argv) {
  const args = { root: projectRoot() };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root" && argv[i + 1]) {
      args.root = resolve(argv[++i]);
    } else {
      return { error: `unknown argument: ${argv[i]}` };
    }
  }
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(`[run-tests] ${args.error}`);
    console.error("usage: node --experimental-strip-types scripts/run-tests.mjs [--root <dir>]");
    process.exit(2);
  }
  const root = realpathSync(args.root);
  // node:test child processes inherit the working directory.
  process.chdir(root);
  const files = discoverTestFiles(root);
  const perFile = new Map();
  const skipped = [];
  let failed = false;

  if (files.length > 0) {
    const stream = run({ files, concurrency: true });
    stream.on("test:fail", () => {
      failed = true;
    });
    stream.on("test:pass", (data) => {
      if (data.skip !== undefined && data.skip !== false) {
        const reason = typeof data.skip === "string" ? data.skip : "(no reason given)";
        const file = data.file ? toPosixRelative(root, data.file) : "?";
        skipped.push(`${file} > ${data.name}: ${reason}`);
      }
    });
    stream.on("test:summary", (data) => {
      if (!data.file) return;
      const { tests, passed, skipped: skippedCount, failed: failedCount } = data.counts;
      perFile.set(toPosixRelative(root, data.file), {
        tests,
        passed,
        skipped: skippedCount,
        failed: failedCount,
      });
    });
    const reporter = stream.compose(spec);
    reporter.pipe(process.stdout, { end: false });
    await finished(reporter);
  }

  const lines = ["", `[run-tests] ${files.length} test files`];
  for (const floor of TEST_FLOORS) {
    const passed = passingUnder(perFile, floor.prefix);
    lines.push(
      `[run-tests] ${floor.label} (${floor.prefix}): ${passed} passing (floor ${floor.min})`,
    );
  }
  if (skipped.length > 0) {
    lines.push(`[run-tests] ${skipped.length} skipped tests (not run, listed so none is silent):`);
    for (const entry of skipped) lines.push(`  - ${entry}`);
  }
  const problems = runProblems(files, perFile);
  for (const problem of problems) lines.push(`[run-tests] FAIL: ${problem}`);
  if (failed) lines.push("[run-tests] FAIL: at least one test failed (see above)");
  console.log(lines.join("\n"));
  process.exitCode = failed || problems.length > 0 ? 1 : 0;
}

function isMainModule(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(moduleUrl);
  } catch {
    return false;
  }
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error("[run-tests] runner error:", err?.stack || err);
    process.exit(1);
  });
}
