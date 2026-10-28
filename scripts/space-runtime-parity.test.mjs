#!/usr/bin/env node
// TS ↔ Python parity for the Python-served Space runtime (space/nexus_runtime.py).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { buildInfo, runtimeHealth } from "../src/lib/nexus/source-identity.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const REVISIONS = [
  "",
  SHA,
  " " + SHA.toUpperCase() + " \r\n",
  "0".repeat(40),
  "abc",
  SHA + "0",
  "g".repeat(40),
  // JavaScript trim() strips a byte-order mark; Python str.strip() does not.
  "﻿" + SHA,
  // Python str.strip() strips U+001C; JavaScript trim() does not.
  "\u001c" + SHA,
];

function python(...args) {
  return execFileSync("python3", ["space/nexus_runtime.py", ...args], { encoding: "utf8" });
}

test("build-info JSON is byte-identical in TS and Python", () => {
  for (const rev of REVISIONS) {
    assert.equal(python("build-info", rev), JSON.stringify(buildInfo(rev)), JSON.stringify(rev));
  }
});

test("health JSON is byte-identical in TS and Python", () => {
  for (const rev of REVISIONS) {
    assert.equal(python("health", rev), JSON.stringify(runtimeHealth(rev)), JSON.stringify(rev));
  }
});

test("probe results match TS probeEstate() for every response class", async () => {
  const { createServer } = await import("node:http");
  const { ENDPOINTS, probeEstate } = await import("../src/lib/nexus/telemetry.ts");
  const routes = {
    "/ok": [200, '{"status":"ok"}'],
    "/evidence": [200, '{"evidenceState":"X"}'],
    "/sdk": [200, '{"sdk":"docker"}'],
    "/text": [200, "not json"],
    "/null": [200, "null"],
    "/array": [200, "[1,2]"],
    "/nan": [200, "NaN"],
    "/missing": [404, "nope"],
    "/broken": [500, "{}"],
    "/role-live": [200, '{"role":"hologram-not-instrument","energy":"UNAVAILABLE"}'],
    "/role-empty": [200, "{}"],
  };
  const server = createServer((req, res) => {
    if (req.url === "/slow") {
      setTimeout(() => res.end('{"status":"late"}'), 600);
      return;
    }
    const [status, body] = routes[req.url];
    res.writeHead(status, { "content-length": Buffer.byteLength(body) });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const cases = [...Object.keys(routes), "/slow"].map((path) => ({
    id: path.startsWith("/role") || path === "/array" ? "nexus-space" : `e${path.slice(1)}`,
    label: path,
    url: base + path,
  }));
  const original = ENDPOINTS.splice(0, ENDPOINTS.length, ...cases);
  try {
    const mask = (text) => text.replace(/"at":\d+/g, '"at":0');
    const ts = JSON.stringify(await probeEstate(200));
    const { execFile } = await import("node:child_process");
    const py = await new Promise((resolve, reject) =>
      execFile("python3", ["space/nexus_runtime.py", "probes", JSON.stringify(cases), "0.2"], (err, out) =>
        err ? reject(err) : resolve(out),
      ),
    );
    assert.equal(mask(py), mask(ts));
  } finally {
    ENDPOINTS.splice(0, ENDPOINTS.length, ...original);
    server.close();
  }
});
