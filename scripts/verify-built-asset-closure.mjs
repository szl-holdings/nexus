import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  openSync,
  readSync,
  readdirSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const STATIC_ASSET =
  /(?:^|["'`(=:\s])\/?(assets\/[A-Za-z0-9._~!$&'()+,;=@%/-]+\.(?:css|js|map|svg|png|jpe?g|webp|gif|woff2?|ttf|ico))(?:[?#["'`)\s]|$)/g;
const TEXT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".json", ".html", ".css"]);
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const NO_FOLLOW = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;

function extension(path) {
  const name = path.toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot) : "";
}

export function walkFiles(root) {
  const output = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`symlink is not allowed in built output: ${path}`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) output.push(path);
    }
  };
  visit(root);
  return output.sort();
}

function readBoundedTextFile(path) {
  const descriptor = openSync(path, constants.O_RDONLY | NO_FOLLOW);
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) throw new Error(`built output path is not a file: ${path}`);
    const buffer = Buffer.allocUnsafe(MAX_TEXT_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > MAX_TEXT_BYTES) throw new Error(`built server file exceeds audit limit: ${path}`);
    return buffer.toString("utf8", 0, length);
  } finally {
    closeSync(descriptor);
  }
}

export function referencedAssets(serverRoot) {
  const refs = new Set();
  for (const path of walkFiles(serverRoot)) {
    if (!TEXT_EXTENSIONS.has(extension(path))) continue;
    const text = readBoundedTextFile(path);
    for (const match of text.matchAll(STATIC_ASSET)) refs.add(match[1]);
  }
  return [...refs].sort();
}

export function verifyBuiltAssetClosure(outputRoot = ".output") {
  const root = resolve(outputRoot);
  const serverRoot = join(root, "server");
  const publicRoot = join(root, "public");
  if (!existsSync(serverRoot) || !existsSync(publicRoot)) {
    throw new Error(`built output is incomplete: expected ${serverRoot} and ${publicRoot}`);
  }
  const refs = referencedAssets(serverRoot);
  if (refs.length === 0) throw new Error("built server did not reference any static assets");
  const missing = refs.filter((ref) => !existsSync(join(publicRoot, ...ref.split("/"))));
  if (missing.length) {
    throw new Error(`built server references missing public assets: ${missing.join(", ")}`);
  }
  const normalizedRoot = root.endsWith(sep) ? root : root + sep;
  return {
    schema: "szl.nexus-built-asset-closure/v1",
    output: relative(process.cwd(), normalizedRoot.slice(0, -1)) || ".",
    referenced_assets: refs,
    missing_assets: [],
  };
}

function main() {
  const report = verifyBuiltAssetClosure(process.argv[2] || ".output");
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
