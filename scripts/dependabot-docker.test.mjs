import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// CRLF-normalized so the line-anchored checks hold on a Windows checkout.
const DEPENDABOT = readFileSync(join(ROOT, ".github/dependabot.yml"), "utf8").replace(
  /\r\n/g,
  "\n",
);
const SKIP_DIRS = new Set(["node_modules", ".git", ".output", ".nitro", ".vercel", "dist"]);

// The weekly Dependabot docker job failed whenever a base image was pinned on
// public.ecr.aws: ECR Public answers anonymous tag listing with HTTP 429
// (runs 37308157730, 38405849915, 39250165139, 41450607403 on main), so a
// stale base digest was never refreshed. Images pinned on Docker Hub or
// mirror.gcr.io are refreshed by the same job without credentials.

/** Every Dockerfile in the source tree, as root-relative POSIX paths. */
function dockerfiles() {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name));
      } else if (entry.isFile() && entry.name === "Dockerfile") {
        found.push(relative(ROOT, join(dir, entry.name)).split(sep).join("/"));
      }
    }
  };
  walk(ROOT);
  return found.sort();
}

/** The `- package-ecosystem: "<name>"` entry of dependabot.yml. */
function updateEntry(ecosystem) {
  const entries = DEPENDABOT.split(/\n(?= {2}- package-ecosystem: )/);
  const entry = entries.find((text) => text.includes(`- package-ecosystem: "${ecosystem}"`));
  assert.ok(entry, `dependabot.yml has no ${ecosystem} entry`);
  return entry;
}

/** Directories an entry covers, from `directory:` or a `directories:` list. */
function coveredDirectories(entry) {
  const single = entry.match(/^ {4}directory: "([^"]+)"$/m);
  if (single) return [single[1]];
  const list = entry.match(/^ {4}directories:\n((?: {6}- "[^"]+"\n?)+)/m);
  assert.ok(list, "docker entry names no directory");
  return [...list[1].matchAll(/- "([^"]+)"/g)].map((match) => match[1]);
}

function baseImages(path) {
  const text = readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
  return [...text.matchAll(/^FROM\s+(?:--platform=\S+\s+)?(\S+)/gm)].map((match) => match[1]);
}

test("the walk finds both documented Dockerfiles, so the checks below are not vacuous", () => {
  const found = dockerfiles();
  for (const path of ["Dockerfile", "space/Dockerfile"]) {
    assert.ok(found.includes(path), `${path} not found`);
  }
});

test("Dependabot's docker updates cover every Dockerfile, the Space image included", () => {
  const covered = coveredDirectories(updateEntry("docker"));
  for (const path of dockerfiles()) {
    const dir = path.includes("/") ? `/${path.slice(0, path.lastIndexOf("/"))}` : "/";
    assert.ok(covered.includes(dir), `${path} is outside Dependabot's docker directories`);
  }
});

test("every base image is digest-pinned on a registry Dependabot can read", () => {
  for (const path of dockerfiles()) {
    const images = baseImages(path);
    assert.ok(images.length > 0, `${path}: no FROM`);
    for (const image of images) {
      assert.match(image, /@sha256:[0-9a-f]{64}$/, `${path}: ${image} is not digest-pinned`);
      assert.doesNotMatch(
        image,
        /^public\.ecr\.aws\//,
        `${path}: ${image} — ECR Public rate-limits Dependabot's anonymous tag listing (HTTP 429)`,
      );
    }
  }
});

test("Dependabot keeps the node:26 / python:3.12 lines the Space contract asserts", () => {
  const docker = updateEntry("docker");
  const ignored = (name) => {
    const entry = docker.match(
      new RegExp(String.raw`- dependency-name: "${name}"\n {8}update-types: \[([^\]]*)\]`),
    );
    assert.ok(entry, `no update-types ignore for ${name}`);
    return entry[1];
  };
  for (const name of ["node", "library/node"]) {
    assert.match(ignored(name), /"version-update:semver-major"/);
    assert.doesNotMatch(ignored(name), /semver-patch/);
  }
  assert.match(ignored("python"), /"version-update:semver-major"/);
  assert.match(ignored("python"), /"version-update:semver-minor"/);
  assert.doesNotMatch(ignored("python"), /semver-patch/);
  // The lines being held are the ones space/Dockerfile and its contract pin.
  const space = baseImages("space/Dockerfile");
  assert.ok(space.some((image) => image.startsWith("node:26-")));
  assert.ok(space.some((image) => image.startsWith("python:3.12-")));
});
