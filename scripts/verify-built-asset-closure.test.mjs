import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { referencedAssets, verifyBuiltAssetClosure } from "./verify-built-asset-closure.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "nexus-asset-closure-"));
  mkdirSync(join(root, "server"), { recursive: true });
  mkdirSync(join(root, "public", "assets"), { recursive: true });
  return root;
}

test("collects unique static asset references from built server files", () => {
  const root = fixture();
  try {
    writeFileSync(
      join(root, "server", "index.mjs"),
      'const a="/assets/app-123.css"; const b="assets/app-456.js";',
    );
    writeFileSync(join(root, "server", "manifest.json"), '{"href":"/assets/app-123.css"}');
    assert.deepEqual(referencedAssets(join(root, "server")), [
      "assets/app-123.css",
      "assets/app-456.js",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("accepts a complete generated asset closure", () => {
  const root = fixture();
  try {
    writeFileSync(join(root, "server", "index.mjs"), 'const href="/assets/styles-good.css";');
    writeFileSync(join(root, "public", "assets", "styles-good.css"), "body{}\n");
    const report = verifyBuiltAssetClosure(root);
    assert.deepEqual(report.referenced_assets, ["assets/styles-good.css"]);
    assert.deepEqual(report.missing_assets, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed when an SSR asset hash is absent from public output", () => {
  const root = fixture();
  try {
    writeFileSync(join(root, "server", "index.mjs"), 'const href="/assets/styles-missing.css";');
    assert.throws(() => verifyBuiltAssetClosure(root), /styles-missing\.css/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when no static asset binding is present", () => {
  const root = fixture();
  try {
    writeFileSync(join(root, "server", "index.mjs"), "export default {};\n");
    assert.throws(() => verifyBuiltAssetClosure(root), /did not reference any static assets/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
