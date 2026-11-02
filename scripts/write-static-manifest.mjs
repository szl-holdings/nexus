// SPDX-License-Identifier: Apache-2.0
// Bind the complete prerendered public file set for the Python runtime.
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { walkFiles } from "./verify-built-asset-closure.mjs";

export const MANIFEST = "nexus-static-manifest.json";
export const MAX_FILES = 4096;
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

function digestFile(path) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > MAX_FILE_BYTES)
      throw new Error("static file exceeds contract");
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let size = 0;
    for (;;) {
      const count = readSync(fd, buffer, 0, buffer.length, null);
      if (!count) break;
      size += count;
      if (size > MAX_FILE_BYTES) throw new Error("static file exceeds contract");
      hash.update(buffer.subarray(0, count));
    }
    const after = fstatSync(fd);
    if (size !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new Error("static file changed during manifest generation");
    return { size, sha256: hash.digest("hex") };
  } finally {
    closeSync(fd);
  }
}

export function writeStaticManifest(publicRoot = ".output/public") {
  const root = resolve(publicRoot);
  const paths = walkFiles(root).filter((path) => relative(root, path) !== MANIFEST);
  if (paths.length > MAX_FILES) throw new Error("static file count exceeds contract");
  let total = 0;
  const files = paths.map((path) => {
    const name = relative(root, path).split(sep).join("/");
    if (
      name.includes("\\") ||
      name.includes("\0") ||
      name.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error("noncanonical static path");
    const item = { path: name, ...digestFile(path) };
    total += item.size;
    if (total > MAX_TOTAL_BYTES) throw new Error("static bundle exceeds contract");
    return item;
  });
  if (!files.some((file) => file.path === "index.html" && file.size > 0))
    throw new Error("prerendered index.html is missing or empty");
  if (
    !files.some(
      (file) => file.path.startsWith("assets/") && file.path.endsWith(".js") && file.size > 0,
    )
  )
    throw new Error("prerendered JavaScript assets are missing");
  const report = { schema: "szl.nexus-static-manifest/v1", files };
  writeFileSync(join(root, MANIFEST), JSON.stringify(report) + "\n", { flag: "w" });
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = writeStaticManifest(process.argv[2]);
  console.log(JSON.stringify({ schema: manifest.schema, files: manifest.files.length }));
}
