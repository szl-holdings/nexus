import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  APP_ENV_REL_PATH,
  findLocalBinScript,
  mergeAppEnv,
  packageBinScript,
  parseAppEnv,
  projectRoot,
  readAppEnv,
  resolveSpawnCommand,
} from "./with-app-env.mjs";

const execFileAsync = promisify(execFile);
const WRAPPER = join(projectRoot(), "scripts/with-app-env.mjs");
const PRINT_FLAG = "process.stdout.write(String(process.env.VITE_AUTH_ENABLED));";

function makeWorkspace(appEnvJson) {
  const root = mkdtempSync(join(tmpdir(), "app-env-"));
  if (appEnvJson !== undefined) {
    mkdirSync(join(root, ".grok"), { recursive: true });
    writeFileSync(join(root, APP_ENV_REL_PATH), appEnvJson);
  }
  return root;
}

test("keeps VITE_-prefixed string entries", () => {
  assert.deepEqual(parseAppEnv('{"VITE_AUTH_ENABLED":"false"}'), {
    VITE_AUTH_ENABLED: "false",
  });
});

test("drops non-VITE keys, non-string values and malformed documents", () => {
  assert.deepEqual(parseAppEnv('{"DATABASE_URL":"postgres://x","VITE_N":1,"VITE_OK":"y"}'), {
    VITE_OK: "y",
  });
  assert.deepEqual(parseAppEnv("not json"), {});
  assert.deepEqual(parseAppEnv('["VITE_AUTH_ENABLED"]'), {});
  assert.deepEqual(parseAppEnv("null"), {});
});

test("a missing app-env.json is a clean no-op", () => {
  assert.deepEqual(readAppEnv(makeWorkspace()), {});
});

test("reads the app env from a workspace", () => {
  const root = makeWorkspace('{"VITE_AUTH_ENABLED":"false"}');
  assert.deepEqual(readAppEnv(root), { VITE_AUTH_ENABLED: "false" });
});

test("an explicit process-env override wins over the file", () => {
  const merged = mergeAppEnv(
    { VITE_AUTH_ENABLED: "false" },
    { VITE_AUTH_ENABLED: "true", PATH: "/usr/bin" },
  );
  assert.equal(merged.VITE_AUTH_ENABLED, "true");
  assert.equal(merged.PATH, "/usr/bin");
});

test("the template ships auth off", () => {
  assert.deepEqual(readAppEnv(projectRoot()), { VITE_AUTH_ENABLED: "false" });
});

test("vite loadEnv resolves the wrapped value", () => {
  // What `import.meta.env.VITE_AUTH_ENABLED` becomes: loadEnv prefix-matches
  // process.env, so the wrapper's merge has to land before Vite starts.
  // Do not `import { loadEnv } from "vite"` here — Vite 8 loads rolldown
  // native bindings that SIGSEGV the test worker under qemu-user.
  const root = makeWorkspace('{"VITE_AUTH_ENABLED":"false"}');
  const merged = mergeAppEnv(readAppEnv(root), { PATH: "/usr/bin" });
  assert.equal(merged.VITE_AUTH_ENABLED, "false");
});

test("the wrapped command runs with the app env applied", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    WRAPPER,
    process.execPath,
    "-e",
    PRINT_FLAG,
  ]);
  assert.equal(stdout, "false");
});

test("the wrapped command sees an explicit override, not the file value", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [WRAPPER, process.execPath, "-e", PRINT_FLAG],
    { env: { ...process.env, VITE_AUTH_ENABLED: "true" } },
  );
  assert.equal(stdout, "true");
});

test("the wrapper propagates the command's exit code", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [WRAPPER, process.execPath, "-e", "process.exit(3)"]),
    (err) => err.code === 3,
  );
});

test("a signal-killed command is never reported as success", async () => {
  // The wrapper's own SIGTERM handler must not swallow the re-raised signal:
  // a cancelled build reporting exit 0 is a silently passing gate.
  await assert.rejects(
    execFileAsync(process.execPath, [
      WRAPPER,
      process.execPath,
      "-e",
      "process.kill(process.pid, 'SIGTERM');setTimeout(() => {}, 1000);",
    ]),
    (err) => err.signal === "SIGTERM" || err.code !== 0,
  );
});

test("the CLI still runs when invoked through a symlinked path", async () => {
  // node realpaths import.meta.url but not process.argv[1], so a raw comparison
  // turns the wrapper into a no-op that exits 0 without starting anything.
  const link = join(mkdtempSync(join(tmpdir(), "app-env-link-")), "scripts");
  // "junction" is ignored off Windows; on Windows a directory junction needs no
  // admin rights or Developer Mode, unlike a symlink (EPERM).
  symlinkSync(join(projectRoot(), "scripts"), link, "junction");
  const { stdout } = await execFileAsync(process.execPath, [
    join(link, "with-app-env.mjs"),
    process.execPath,
    "-e",
    PRINT_FLAG,
  ]);
  assert.equal(stdout, "false");
});

// --- bare local bins (`vite`) on Windows ---

function writePackage(root, dir, manifest, files) {
  const packageDir = join(root, "node_modules", dir);
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, "package.json"), JSON.stringify(manifest));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(packageDir, rel)), { recursive: true });
    writeFileSync(join(packageDir, rel), text);
  }
  return packageDir;
}

function makeBinWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "app-env-bin-"));
  const direct = writePackage(
    root,
    "fake-cli",
    { name: "fake-cli", bin: "cli.js" },
    {
      "cli.js": "console.log('fake');\n",
    },
  );
  const scoped = writePackage(
    root,
    "@acme/tools",
    { name: "@acme/tools", bin: { "acme-run": "bin/run" } },
    {
      "bin/run": "#!/usr/bin/env node\nconsole.log('acme');\n",
    },
  );
  writePackage(
    root,
    "native-tool",
    { name: "native-tool", bin: { "native-tool": "bin/native-tool" } },
    {
      "bin/native-tool": "\u007fELF not a node script",
    },
  );
  return { root, directScript: join(direct, "cli.js"), scopedScript: join(scoped, "bin/run") };
}

test("win32: a bare local bin runs its node script with this node, not through PATH", () => {
  const { root, directScript } = makeBinWorkspace();
  assert.deepEqual(
    resolveSpawnCommand("fake-cli", ["dev", "--port", "8080"], {
      platform: "win32",
      root,
      execPath: "NODE",
    }),
    {
      command: "NODE",
      args: [directScript, "dev", "--port", "8080"],
    },
  );
});

test("win32: a bin whose package has another name (scoped, shebang script) is found", () => {
  const { root, scopedScript } = makeBinWorkspace();
  assert.equal(findLocalBinScript(root, "acme-run"), scopedScript);
  assert.deepEqual(
    resolveSpawnCommand("acme-run", [], { platform: "win32", root, execPath: "NODE" }),
    {
      command: "NODE",
      args: [scopedScript],
    },
  );
});

test("win32: native bins, unknown names, paths and explicit extensions spawn as given", () => {
  const { root } = makeBinWorkspace();
  assert.equal(packageBinScript(join(root, "node_modules", "native-tool"), "native-tool"), null);
  for (const command of [
    "native-tool",
    "not-installed",
    "C:\\tools\\fake-cli",
    "./fake-cli",
    "fake-cli.exe",
  ]) {
    assert.deepEqual(
      resolveSpawnCommand(command, ["x"], { platform: "win32", root, execPath: "NODE" }),
      {
        command,
        args: ["x"],
      },
    );
  }
});

test("other platforms spawn every command exactly as given", () => {
  const { root } = makeBinWorkspace();
  for (const platform of ["linux", "darwin"]) {
    assert.deepEqual(
      resolveSpawnCommand("fake-cli", ["dev"], { platform, root, execPath: "NODE" }),
      {
        command: "fake-cli",
        args: ["dev"],
      },
    );
  }
});

test("the wrapper starts an installed bin by its bare name (tsc)", async () => {
  // Regression: on Windows `spawn("vite")` failed with ENOENT because npm's bin
  // is a .cmd shim. `tsc` is a light stand-in: its package is `typescript`, so
  // this also covers a bin whose name differs from its package. Off Windows the
  // bin is found on PATH, as when npm runs a script.
  const env =
    process.platform === "win32"
      ? process.env
      : {
          ...process.env,
          PATH: `${join(projectRoot(), "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}`,
        };
  const { stdout } = await execFileAsync(process.execPath, [WRAPPER, "tsc", "--version"], { env });
  assert.match(stdout, /^Version \d+\.\d+\.\d+/);
});
