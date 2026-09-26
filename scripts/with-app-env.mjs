#!/usr/bin/env node
/**
 * Run a command with `.grok/app-env.json` merged into its environment.
 *
 * `dev`, `build` and `preview` all route through this wrapper, so the dev
 * server, the built bundle and the preview server can never disagree about
 * `VITE_AUTH_ENABLED` — a divergence that only shows up as a built-output
 * mismatch long after the fact. Anything that starts Vite directly bypasses it.
 *
 * Only `VITE_`-prefixed keys are honored: the file is a build flag carrier, not
 * a secret store, and only `VITE_` vars reach the browser anyway. A real
 * `process.env` entry always wins, so an explicit override still works.
 *
 * That precedence also means the file governs this workspace only. A deployed
 * build runs with the provider's project env, where the deployer sets
 * `VITE_AUTH_ENABLED` itself (today unconditionally `"true"`), so the deployed
 * flag is the platform's, not this file's.
 *
 * Vite picks the values up because `loadEnv` prefix-matches entries already in
 * `process.env`, which is why the merge has to happen before Vite starts.
 */
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_ENV_REL_PATH = ".grok/app-env.json";

const VITE_PREFIX = "VITE_";

/**
 * Parse an app-env document, keeping only `VITE_`-prefixed string entries.
 * Anything unparseable is an empty environment — a workspace without the file
 * must behave exactly like today (auth on, no overrides).
 */
export function parseAppEnv(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const env = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.startsWith(VITE_PREFIX)) continue;
    if (typeof value !== "string") continue;
    env[key] = value;
  }
  return env;
}

/** The app env recorded under `root`, or `{}` when the file is absent. */
export function readAppEnv(root) {
  try {
    return parseAppEnv(readFileSync(join(root, APP_ENV_REL_PATH), "utf8"));
  } catch {
    return {};
  }
}

/** File values under the process environment: an explicit override wins. */
export function mergeAppEnv(appEnv, processEnv) {
  return { ...appEnv, ...processEnv };
}

/**
 * Translate a child's `exit` `(code, signal)` into this process's exit status.
 *
 * Do not re-raise the signal with `process.kill(process.pid, signal)`: under
 * qemu-user (amd64 image builds on an arm host) a self-directed signal is
 * routinely delivered as SIGSEGV to the wrong process, which takes down the
 * test worker and fails the image build. `128 + signo` is what a shell reports
 * for a signal-killed command, so a cancelled `vite build` is still a failure.
 */
export function exitStatusFromChild(code, signal) {
  if (signal) {
    const signo = osConstants.signals[signal];
    return 128 + (typeof signo === "number" ? signo : 1);
  }
  return code ?? 1;
}

const NODE_SCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

/**
 * The JavaScript entry of the `name` bin declared by the package installed at
 * `packageDir`, or `null` when it declares none or the file is not a node
 * script (a native binary cannot be run through `node`).
 */
export function packageBinScript(packageDir, name) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  } catch {
    return null;
  }
  const bin =
    typeof manifest?.bin === "string"
      ? manifest.name?.split("/").pop() === name
        ? manifest.bin
        : null
      : manifest?.bin?.[name];
  if (typeof bin !== "string" || !bin) return null;
  const script = join(packageDir, bin);
  try {
    if (!statSync(script).isFile()) return null;
    if (NODE_SCRIPT_EXTENSIONS.has(extname(script))) return script;
    const firstLine = readFileSync(script, "utf8").split("\n", 1)[0];
    return /^#!.*\bnode\b/.test(firstLine) ? script : null;
  } catch {
    return null;
  }
}

/** Names in `dir`, or `[]` when it cannot be read. */
function listDir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Every top-level package directory in `modules`, scoped ones included. */
function installedPackageDirs(modules) {
  const dirs = [];
  for (const name of listDir(modules)) {
    if (name.startsWith(".")) continue;
    if (name.startsWith("@")) {
      for (const sub of listDir(join(modules, name))) dirs.push(join(modules, name, sub));
    } else {
      dirs.push(join(modules, name));
    }
  }
  return dirs;
}

/**
 * The node script behind a locally installed bin: the package named like the
 * bin first (`vite` -> `node_modules/vite`), then every other package.
 */
export function findLocalBinScript(root, name) {
  const modules = join(root, "node_modules");
  const direct = join(modules, name);
  const script = packageBinScript(direct, name);
  if (script) return script;
  for (const dir of installedPackageDirs(modules)) {
    if (dir === direct) continue;
    const found = packageBinScript(dir, name);
    if (found) return found;
  }
  return null;
}

/**
 * What to hand to `spawn` for `command args`.
 *
 * On Windows, npm installs local bins as `node_modules/.bin/<name>.cmd`
 * shims. `spawn` without a shell does not apply PATHEXT, so `spawn("vite")`
 * fails with ENOENT, and node refuses to spawn a `.cmd` file without a shell
 * (CVE-2024-27980). Instead of a shell (which would re-parse every argument)
 * a bare command that names a local package bin runs its node script directly
 * with this node binary. Anything else, and every command on other platforms,
 * is spawned exactly as given.
 */
export function resolveSpawnCommand(
  command,
  args,
  { platform = process.platform, root = projectRoot(), execPath = process.execPath } = {},
) {
  if (platform !== "win32" || /[\\/]/.test(command) || extname(command) !== "") {
    return { command, args };
  }
  const script = findLocalBinScript(root, command);
  return script ? { command: execPath, args: [script, ...args] } : { command, args };
}

/** The workspace root (this file lives in `<root>/scripts/`). */
export function projectRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

/**
 * Whether `moduleUrl` is the script node was asked to run.
 *
 * Both sides are resolved through symlinks: node realpaths `import.meta.url`
 * but leaves `process.argv[1]` as typed, so comparing them raw makes a CLI
 * launched through a symlinked path (`/tmp` on macOS) a silent no-op.
 */
export function isMainModule(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(moduleUrl);
  } catch {
    return false;
  }
}

function main(argv) {
  const [command, ...args] = argv;
  if (!command) {
    console.error("usage: node scripts/with-app-env.mjs <command> [args…]");
    process.exit(2);
  }
  const env = mergeAppEnv(readAppEnv(projectRoot()), process.env);
  const resolved = resolveSpawnCommand(command, args);
  const child = spawn(resolved.command, resolved.args, { stdio: "inherit", env });
  // The dev server is long-running and is stopped by signalling this wrapper.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("error", (err) => {
    console.error(`[with-app-env] failed to run ${command}:`, err?.message || err);
    process.exit(127);
  });
  child.on("exit", (code, signal) => {
    process.exit(exitStatusFromChild(code, signal));
  });
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2));
}
