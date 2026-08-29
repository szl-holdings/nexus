import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { idleProbes, parseProbes, ENDPOINTS } from "./telemetry.ts";

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
