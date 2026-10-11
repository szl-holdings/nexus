import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ROOT, verifyAssets } from "./native-assets.mjs";

test("native source, full upstream manifest and installed projection retain exact bytes", () => {
  assert.equal(verifyAssets().files.length, 5);
});

test("tampering, an extra file, or a symlink cannot pass native asset qualification", () => {
  const temp = mkdtempSync(join(tmpdir(), "nexus-native-"));
  try {
    const root = join(temp, "public");
    const folder = join(root, "assets", "szl");
    const reset = () => {
      rmSync(root, { recursive: true, force: true });
      cpSync(join(ROOT, "public/assets/szl"), folder, { recursive: true });
    };
    reset();
    writeFileSync(join(folder, "szl-icon-32.svg"), "changed");
    assert.throws(() => verifyAssets(root), /native bytes changed/);
    reset();
    writeFileSync(join(folder, "unused.svg"), "extra");
    assert.throws(() => verifyAssets(root));
    if (process.platform !== "win32") {
      reset();
      rmSync(join(folder, "SOURCE.json"));
      symlinkSync(join(ROOT, "public/assets/szl/SOURCE.json"), join(folder, "SOURCE.json"));
      assert.throws(() => verifyAssets(root));
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
