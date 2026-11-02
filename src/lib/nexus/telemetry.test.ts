import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { idleProbes, parseProbes, probeEstate, ENDPOINTS } from "./telemetry.ts";

describe("parseProbes", () => {
  it("rejects green that is not a probe array", () => {
    assert.equal(parseProbes({ status: "LIVE" }), null);
    assert.equal(parseProbes("LIVE"), null);
    assert.equal(parseProbes([{ id: "hatun", status: "LIVE" }]), null);
  });
  it("rejects a partial rail", () => {
    const [a] = idleProbes();
    assert.equal(parseProbes([{ ...a, status: "LIVE" }]), null);
  });
  it("accepts an honest LIVE rail", () => {
    const rows = ENDPOINTS.map((e) => ({
      id: e.id,
      label: e.label,
      status: "LIVE" as const,
      detail: "ok",
      at: 1,
    }));
    const parsed = parseProbes(rows);
    assert.ok(parsed);
    assert.equal(parsed?.every((p) => p.status === "LIVE"), true);
  });
  it("idle probes start UNAVAILABLE", () => {
    assert.equal(idleProbes().every((p) => p.status === "UNAVAILABLE"), true);
  });
});

it("Hatun uses the declared A11oy MCP product transport, not the retired standalone host", async (t) => {
  const hatun = ENDPOINTS.find((e) => e.id === "hatun")!;
  assert.equal(hatun.url, "https://szlholdings-a11oy.hf.space/mcp/");
  assert.equal(hatun.label, "Hatun product gateway");
  assert.equal(idleProbes().find((p) => p.id === "hatun")?.detail, "not probed");
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response('{"status":"ok"}'));
  const original = ENDPOINTS.splice(0, ENDPOINTS.length, hatun);
  try {
    const [probe] = await probeEstate();
    assert.equal(probe.status, "UNAVAILABLE");
    assert.equal(probe.detail, "A11oy MCP handshake unavailable");
    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(fetch.mock.calls[0].arguments[0], hatun.url);
  } finally {
    ENDPOINTS.splice(0, ENDPOINTS.length, ...original);
  }
});
