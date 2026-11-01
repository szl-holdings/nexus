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
  const runtime = buildInfo(SHA);
  const anatomy = {
    service: "anatomy-space", organ: "anatomy", status: "ok",
    transport_state: "REACHABLE", authority_state: "READ_ONLY",
    evidence_state: "SNAPSHOT", verification_state: "STRUCTURAL_ONLY",
  };
  const anatomyCases = {
    "/anatomy-live": [JSON.stringify(anatomy), true],
    "/anatomy-text": ["not json", false],
    "/anatomy-null": ["null", false],
    "/anatomy-array": ["[]", false],
    "/anatomy-unrelated": ['{"status":"ok"}', false],
  };
  for (const key of Object.keys(anatomy)) {
    const missing = { ...anatomy };
    delete missing[key];
    anatomyCases[`/anatomy-missing-${key}`] = [JSON.stringify(missing), false];
    anatomyCases[`/anatomy-wrong-${key}`] = [JSON.stringify({ ...anatomy, [key]: "wrong" }), false];
  }
  for (const [path, [body]] of Object.entries(anatomyCases)) routes[path] = [200, body];
  const nexusCases = {
    "/nexus-live": [JSON.stringify(runtime), true],
    "/nexus-text": ["not json", false],
    "/nexus-null": ["null", false],
    "/nexus-array": ["[]", false],
    "/nexus-nan": ["NaN", false],
    "/nexus-legacy": [routes["/role-live"][1], false],
  };
  for (const [key, value] of Object.entries(runtime)) {
    const missing = { ...runtime };
    delete missing[key];
    // Frontend and execution hints are not source-identity predicates.
    if (["frontend", "audio_execution", "deterministic_python_reference"].includes(key)) continue;
    nexusCases[`/nexus-missing-${key}`] = [JSON.stringify(missing), false];
    nexusCases[`/nexus-wrong-${key}`] = [JSON.stringify({ ...runtime, [key]: typeof value === "boolean" ? "true" : "wrong" }), false];
  }
  for (const revision of ["0".repeat(40), SHA.toUpperCase(), ` ${SHA}`, `${SHA}\n`, `${SHA}0`]) {
    nexusCases[`/nexus-revision-${Object.keys(nexusCases).length}`] = [JSON.stringify({ ...runtime, source_revision: revision }), false];
  }
  for (const [path, [body]] of Object.entries(nexusCases)) routes[path] = [200, body];
  const server = createServer((req, res) => {
    if (req.url === "/slow") {
      setTimeout(() => res.end('{"status":"late"}'), 900);
      return;
    }
    if (req.url === "/slow-body") {
      const body = '{"status":"late body"}';
      res.writeHead(200, { "content-length": Buffer.byteLength(body) });
      res.flushHeaders();
      setTimeout(() => res.end(body), 600);
      return;
    }
    if (req.url === "/trickle") {
      // Each gap is shorter than the timeout; the whole head arrives after it.
      const body = '{"status":"ok"}';
      const parts = ["HTTP/1.1 200 OK\r\n", "x-a: 1\r\n", "x-b: 1\r\n", "x-c: 1\r\n"];
      parts.push(`content-length: ${body.length}\r\nconnection: close\r\n\r\n${body}`);
      const tick = () => {
        if (req.socket.destroyed) return;
        req.socket.write(parts.shift());
        if (parts.length) setTimeout(tick, 150);
        else req.socket.end();
      };
      setTimeout(tick, 150);
      return;
    }
    const hop = req.url.match(/^\/hop\/(\d+)$/);
    if (hop) {
      const left = Number(hop[1]);
      if (left) res.writeHead(302, { location: `/hop/${left - 1}`, "content-length": 0 }).end();
      else res.end('{"status":"ok"}');
      return;
    }
    const [status, body] = routes[req.url];
    res.writeHead(status, { "content-length": Buffer.byteLength(body) });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const endpoint = (path) => ({
    id: path.startsWith("/anatomy-") ? "anatomy" : path.startsWith("/role") || path.startsWith("/nexus-") || path === "/array" ? "nexus-space" : `e${path.slice(1)}`,
    label: path,
    url: base + path,
  });
  const cases = Object.keys(routes).map(endpoint);
  cases.push(ENDPOINTS.find((endpoint) => endpoint.id === "hatun"));
  const timingCases = ["/slow", "/slow-body", "/trickle", "/hop/12", "/hop/21"].map(endpoint);
  const original = [...ENDPOINTS];
  try {
    const mask = (text) => text.replace(/"at":\d+/g, '"at":0');
    const { execFile } = await import("node:child_process");
    const tsRows = [], pyRows = [];
    // Contract validation must not race the 400 ms deadline fixtures when the
    // full suite competes for CPU. Keep the short deadline only for its own batch.
    for (const [batch, timeoutMs] of [[cases, 2800], [timingCases, 400]]) {
      ENDPOINTS.splice(0, ENDPOINTS.length, ...batch);
      const ts = await probeEstate(timeoutMs);
      const py = await new Promise((resolve, reject) =>
        execFile("python3", ["space/nexus_runtime.py", "probes", JSON.stringify(batch), String(timeoutMs / 1000)], (err, out) =>
          err ? reject(err) : resolve(out),
        ),
      );
      assert.equal(mask(py), mask(JSON.stringify(ts)));
      tsRows.push(...ts);
      pyRows.push(...JSON.parse(py));
    }
    for (const rows of [tsRows, pyRows]) {
      const hatun = rows.find((row) => row.id === "hatun");
      assert.equal(hatun?.status, "UNAVAILABLE");
      assert.equal(hatun?.detail, "standalone retired; MCP deployment unavailable");
      for (const path of ["/slow", "/trickle"]) {
        assert.equal(rows.find((row) => row.label === path)?.detail, "timeout", path);
      }
      assert.equal(rows.find((row) => row.label === "/slow-body")?.detail, "late body");
      assert.equal(rows.find((row) => row.label === "/hop/12")?.status, "LIVE");
      assert.equal(rows.find((row) => row.label === "/hop/21")?.detail, "cors or unreachable");
    }
    for (const [path, [, live]] of Object.entries(anatomyCases)) {
      const expected = live ? "LIVE" : "UNAVAILABLE";
      const detail = live ? "read-only transport; snapshot evidence" : "anatomy transport contract unavailable";
      for (const rows of [tsRows, pyRows]) {
        const row = rows.find((entry) => entry.label === path);
        assert.equal(row?.status, expected, path);
        assert.equal(row?.detail, detail, path);
      }
    }
    for (const [path, [, live]] of Object.entries(nexusCases)) {
      const expected = live ? "LIVE" : "UNAVAILABLE";
      assert.equal(tsRows.find((row) => row.label === path)?.status, expected, path);
      assert.equal(pyRows.find((row) => row.label === path)?.status, expected, path);
    }
  } finally {
    ENDPOINTS.splice(0, ENDPOINTS.length, ...original);
    server.close();
  }
});

test("Anatomy probes use the retained creator-profile transport contract in both runtimes", async () => {
  const { ENDPOINTS } = await import("../src/lib/nexus/telemetry.ts");
  const py = JSON.parse(execFileSync("python3", ["-c", "import sys,json; sys.path.insert(0,'space'); from nexus_runtime import ENDPOINTS; print(json.dumps(ENDPOINTS))"], { encoding: "utf8" }));
  assert.deepEqual(py, ENDPOINTS);
  for (const endpoints of [ENDPOINTS, py]) {
    assert.equal(endpoints.find((row) => row.id === "anatomy").url, "https://betterwithage-anatomy.hf.space/healthz");
  }
});
