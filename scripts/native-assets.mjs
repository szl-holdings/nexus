/** Exact native projections. Local files only; no fetch, publication or signing. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = "4309f6fce89179331b0b3ed8c99494e76c5be256";
const ORBIT = "fd62fe5856ed8e5f660eaae5a9c52957cd71b0a7";
export const ASSETS = [
  {
    name: "szl-tokens.css",
    revision: BUNDLE,
    source: "kanchay/szl-tokens.css",
    sha256: "81f7c9baeef0b435e6e3f9d0c4e0d70e40fa17df5d1f30697f623cd3ef5f8eab",
  },
  {
    name: "SOURCE.json",
    revision: BUNDLE,
    source: "kanchay/SOURCE.json",
    sha256: "967a77235227f1d75852fb61873e46336e67403cbc0e7e12b141e31c83fbd93d",
  },
  {
    name: "szl-icon-32.svg",
    revision: ORBIT,
    source: "kit/logos/orbit-v2/suite/szl-icon-32.svg",
    sha256: "6e2b7d72a3af3d9602b79de41df0194ede6496a9661f057108ec224c0efc92e6",
  },
  {
    name: "szl-icon-16.svg",
    revision: ORBIT,
    source: "kit/logos/orbit-v2/suite/szl-icon-16.svg",
    sha256: "6e2dc7c9794dc452fbccb44ffadbd168c2584361904e8bcaeba542427d9e1a3a",
  },
];
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const projection = {
  schema: "szl.native-frontend-projection/v1",
  kind: "UNSIGNED_SOURCE_PROJECTION",
  canonical_repository: "https://github.com/szl-holdings/szl-brand",
  token_source_revision: "27d12e77fc0f9f1a0e5fae8b34adf2380d51d070",
  consumer: "szl-holdings/nexus",
  assets: ASSETS,
  upstream_manifest:
    "SOURCE.json is unchanged and describes the complete upstream bundle. Only the four explicitly listed files are installed here.",
  attribution:
    "Brand artwork © 2026 SZL Holdings / Stephen Lutar, CC BY 4.0; code Apache-2.0. ORCID 0009-0001-0110-4173.",
  geometry:
    "Native icon32 at 40px with 10px clear space; native icon16 for favicon. No redraw, tint, distortion, rotation or filter.",
  limits:
    "This local projection metadata does not attest runtime availability, publication, source signatures or cryptographic product receipts.",
};
export const projectionBytes = () => Buffer.from(JSON.stringify(projection, null, 2) + "\n");

export function readRegular(path) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const meta = fstatSync(fd);
    assert.ok(meta.isFile(), `not a regular asset: ${path}`);
    assert.ok(meta.size <= 128 * 1024, `oversize asset: ${path}`);
    const bytes = Buffer.alloc(128 * 1024 + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    assert.ok(length <= 128 * 1024, `oversize asset read: ${path}`);
    return bytes.subarray(0, length);
  } finally {
    closeSync(fd);
  }
}

export function verifyAssets(publicRoot = join(ROOT, "public")) {
  const directory = join(resolve(publicRoot), "assets", "szl");
  assert.ok(lstatSync(directory).isDirectory(), "native asset directory must not be a symlink");
  assert.deepEqual(
    readdirSync(directory).sort(),
    [...ASSETS.map((row) => row.name), "PROJECTION.json"].sort(),
  );
  const files = ASSETS.map((row) => {
    const bytes = readRegular(join(directory, row.name));
    assert.equal(sha256(bytes), row.sha256, `native bytes changed: ${row.name}`);
    return { path: `/assets/szl/${row.name}`, bytes: bytes.length, sha256: row.sha256 };
  });
  const installedProjection = readRegular(join(directory, "PROJECTION.json"));
  assert.deepEqual(installedProjection, projectionBytes(), "projection metadata changed");
  files.push({
    path: "/assets/szl/PROJECTION.json",
    bytes: installedProjection.length,
    sha256: sha256(installedProjection),
  });
  return { kind: "UNSIGNED_LOCAL_ASSET_CHECK", files, uninspected: [] };
}

function project(checkout) {
  const loaded = ASSETS.map((row) => {
    const result = spawnSync(
      "git",
      ["-C", resolve(checkout), "show", `${row.revision}:${row.source}`],
      { maxBuffer: 128 * 1024 },
    );
    assert.equal(result.status, 0, `canonical blob unavailable: ${row.source}`);
    assert.equal(sha256(result.stdout), row.sha256, `canonical hash mismatch: ${row.source}`);
    return { row, bytes: result.stdout };
  });
  const destination = join(ROOT, "public/assets/szl");
  let directory = ROOT;
  for (const part of ["public", "assets", "szl"]) {
    directory = join(directory, part);
    mkdirSync(directory, { recursive: true });
    assert.ok(lstatSync(directory).isDirectory(), "projection directory must not be a symlink");
  }
  const write = (name, bytes) => {
    const fd = openSync(
      join(destination, name),
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW || 0),
      0o644,
    );
    try {
      assert.ok(fstatSync(fd).isFile());
      writeFileSync(fd, bytes);
    } finally {
      closeSync(fd);
    }
  };
  for (const { row, bytes } of loaded) write(row.name, bytes);
  write("PROJECTION.json", projectionBytes());
  return verifyAssets();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, argument] = process.argv.slice(2);
  assert.ok(
    !mode || mode === "--built" || mode === "--project",
    "use --built PUBLIC_ROOT or --project CANONICAL_CHECKOUT",
  );
  if (mode) assert.ok(argument, "argument required");
  const report = mode === "--project" ? project(argument) : verifyAssets(argument);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}
