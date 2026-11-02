import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { MANIFEST, writeStaticManifest } from "./write-static-manifest.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "nexus-static-manifest-"));
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), '<script type="module" src="/assets/app.js"></script>');
  writeFileSync(join(root, "assets/app.js"), 'import "./chunk.js";');
  writeFileSync(join(root, "assets/chunk.js"), "export const result = 1;");
  return root;
}

test("manifest is deterministic and contains the entire public file set", () => {
  const root = fixture();
  try {
    const first = writeStaticManifest(root);
    const bytes = readFileSync(join(root, MANIFEST), "utf8");
    assert.deepEqual(
      first.files.map((row) => row.path),
      ["assets/app.js", "assets/chunk.js", "index.html"],
    );
    assert.deepEqual(writeStaticManifest(root), first);
    assert.equal(readFileSync(join(root, MANIFEST), "utf8"), bytes);
    assert.ok(first.files.every((row) => /^[0-9a-f]{64}$/.test(row.sha256)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Python runtime verifies Node-built manifest and detects transitive asset corruption", () => {
  const root = fixture();
  const inspect = () =>
    JSON.parse(
      execFileSync(
        "python3",
        [
          "-c",
          "import json,sys;sys.path.insert(0,'space');from static_assets import inspect_static_bundle;print(json.dumps(inspect_static_bundle(sys.argv[1])))",
          root,
        ],
        { encoding: "utf8" },
      ),
    );
  try {
    writeStaticManifest(root);
    assert.equal(inspect().ready, true);
    writeFileSync(join(root, "assets/chunk.js"), "export const result = 2;");
    assert.equal(inspect().ready, false);
    assert.equal(inspect().reason, "STATIC_FILE_DIGEST_MISMATCH");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing or empty prerendered index cannot produce a manifest", () => {
  const root = fixture();
  try {
    rmSync(join(root, "index.html"));
    assert.throws(() => writeStaticManifest(root), /index.html is missing or empty/);
    writeFileSync(join(root, "index.html"), "");
    assert.throws(() => writeStaticManifest(root), /index.html is missing or empty/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("symlinks are rejected instead of attesting out-of-tree bytes", () => {
  const root = fixture();
  try {
    symlinkSync(join(root, "index.html"), join(root, "assets/alias.js"));
    assert.throws(() => writeStaticManifest(root), /symlink is not allowed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("static build emits the manifest and Docker ships its runtime verifier", () => {
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
  assert.match(
    scripts["build:static"],
    /verify-built-asset-closure\.mjs && node scripts\/write-static-manifest\.mjs$/,
  );
  assert.doesNotMatch(scripts.build, /write-static-manifest/);
  assert.match(
    readFileSync("space/Dockerfile", "utf8"),
    /^COPY --chown=nexus:nexus space\/static_assets\.py \/app\/$/m,
  );
});
