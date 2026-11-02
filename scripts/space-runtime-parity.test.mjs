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
    "/body-at-limit": [200, JSON.stringify({ status: "ok", pad: "x".repeat(65536 - 24) })],
    "/body-over-limit": [200, JSON.stringify({ status: "ok", pad: "x".repeat(65537 - 24) })],
  };
  const hatun = {
    jsonrpc: "2.0", id: "nexus-probe", result: {
      protocolVersion: "2024-11-05", serverInfo: { name: "szl-a11oy-mcp", version: "1.1.0" },
      capabilities: { tools: { listChanged: false } },
    },
  };
  const hatunCases = {
    "/hatun-live": [JSON.stringify(hatun), true],
    "/hatun-error": [JSON.stringify({ ...hatun, error: { code: -32600 } }), false],
    "/hatun-unrelated": ['{"status":"ok"}', false],
    "/hatun-text": ["not json", false],
    "/hatun-null": ["null", false],
    "/hatun-array": ["[]", false],
  };
  for (const path of [
    ["jsonrpc"], ["id"], ["result"], ["result", "protocolVersion"],
    ["result", "serverInfo"], ["result", "serverInfo", "name"], ["result", "serverInfo", "version"],
    ["result", "capabilities"], ["result", "capabilities", "tools"], ["result", "capabilities", "tools", "listChanged"],
  ]) {
    for (const kind of ["missing", "wrong"]) {
      const body = structuredClone(hatun);
      let cursor = body;
      for (const key of path.slice(0, -1)) cursor = cursor[key];
      if (kind === "missing") delete cursor[path.at(-1)];
      else cursor[path.at(-1)] = "wrong";
      hatunCases[`/hatun-${kind}-${path.join("-")}`] = [JSON.stringify(body), false];
    }
  }
  for (const [path, [body]] of Object.entries(hatunCases)) routes[path] = [200, body];
  const hatunRequests = [];
  const hatunRedirects = [301, 302, 303, 307, 308].map((code) => `/hatun-redirect-${code}`);
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
  const server = createServer(async (req, res) => {
    if (req.url.startsWith("/hatun-")) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      hatunRequests.push({ method: req.method, type: req.headers["content-type"], body: JSON.parse(Buffer.concat(chunks).toString()) });
    }
    if (hatunRedirects.includes(req.url)) {
      res.writeHead(Number(req.url.split("-").at(-1)), { location: "/hatun-live", "content-length": 0 }).end();
      return;
    }
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
    if (req.url === "/trickle-body") {
      res.writeHead(200);
      res.write('{"status":"');
      const interval = setInterval(() => res.write("x"), 100);
      res.on("close", () => clearInterval(interval));
      return;
    }
    if (req.url === "/chunked-over-limit") {
      res.writeHead(200);
      res.write(" ".repeat(65536));
      res.end("{}");
      return;
    }
    if (req.url === "/truncated-body") {
      const body = JSON.stringify(runtime);
      res.writeHead(200, { "content-length": Buffer.byteLength(body) + 10, connection: "close" });
      res.end(body);
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
  const cases = [...Object.keys(routes), ...hatunRedirects, "/slow", "/slow-body", "/trickle", "/trickle-body", "/chunked-over-limit", "/truncated-body", "/hop/12", "/hop/21"].map((path) => ({
    id: path.startsWith("/hatun-") ? "hatun" : path.startsWith("/anatomy-") ? "anatomy" : path.startsWith("/role") || path.startsWith("/nexus-") || path === "/array" || path === "/truncated-body" ? "nexus-space" : `e${path.slice(1)}`,
    label: path,
    url: base + path,
  }));
  const original = ENDPOINTS.splice(0, ENDPOINTS.length, ...cases);
  try {
    const { execFile } = await import("node:child_process");
    const delayed = new Set(["/slow", "/slow-body", "/trickle", "/trickle-body"]);
    const tsRows = [];
    const pyRows = [];
    // Ordinary contract checks need headroom on loaded CI workers. Keep short
    // deadline assertions isolated so they test the server delay, not contention.
    for (const [group, timeoutMs] of [
      [cases.filter((entry) => !delayed.has(entry.label)), 4000],
      [cases.filter((entry) => delayed.has(entry.label)), 400],
    ]) {
      ENDPOINTS.splice(0, ENDPOINTS.length, ...group);
      tsRows.push(...await probeEstate(timeoutMs));
      const out = await new Promise((resolve, reject) =>
        execFile("python3", ["space/nexus_runtime.py", "probes", JSON.stringify(group), String(timeoutMs / 1000)], (err, out) =>
          err ? reject(err) : resolve(out),
        ),
      );
      pyRows.push(...JSON.parse(out));
    }
    for (let index = 0; index < tsRows.length; index++) {
      assert.deepEqual({ ...pyRows[index], at: 0 }, { ...tsRows[index], at: 0 }, tsRows[index].label);
    }
    for (const rows of [tsRows, pyRows]) {
      assert.equal(rows.find((row) => row.label === "/hop/12")?.status, "LIVE");
      assert.equal(rows.find((row) => row.label === "/hop/21")?.detail, "cors or unreachable");
      for (const path of ["/slow-body", "/trickle-body", "/trickle"]) {
        const row = rows.find((entry) => entry.label === path);
        assert.equal(row.status, "UNAVAILABLE", path);
        assert.equal(row.detail, "timeout", path);
      }
      for (const path of ["/body-over-limit", "/chunked-over-limit"]) {
        const row = rows.find((entry) => entry.label === path);
        assert.equal(row.status, "UNAVAILABLE", path);
        assert.equal(row.detail, "response too large", path);
      }
      assert.equal(rows.find((entry) => entry.label === "/body-at-limit").status, "LIVE");
      assert.equal(rows.find((entry) => entry.label === "/truncated-body").status, "UNAVAILABLE");
      assert.equal(rows.find((entry) => entry.label === "/truncated-body").detail, "cors or unreachable");
    }
    for (const rows of [tsRows, pyRows]) {
      for (const path of hatunRedirects) {
        const row = rows.find((entry) => entry.label === path);
        assert.equal(row.status, "UNAVAILABLE", path);
        assert.equal(row.detail, "cors or unreachable", path);
      }
    }
    assert.equal(hatunRequests.length, (Object.keys(hatunCases).length + hatunRedirects.length) * 2);
    for (const request of hatunRequests) {
      assert.equal(request.method, "POST");
      assert.equal(request.type, "application/json");
      assert.deepEqual(request.body, {
        jsonrpc: "2.0", id: "nexus-probe", method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "nexus-probe", version: "1" } },
      });
    }
    for (const [path, [, live]] of Object.entries(hatunCases)) {
      for (const rows of [tsRows, pyRows]) {
        const row = rows.find((entry) => entry.label === path);
        assert.equal(row.status, live ? "LIVE" : "UNAVAILABLE", path);
        assert.equal(row.detail, live ? "A11oy MCP transport; signing unverified" : "A11oy MCP handshake unavailable", path);
      }
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
    assert.equal(endpoints.find((row) => row.id === "hatun").url, "https://szlholdings-a11oy.hf.space/mcp/");
    assert.equal(endpoints.find((row) => row.id === "anatomy").url, "https://betterwithage-anatomy.hf.space/healthz");
  }
});
