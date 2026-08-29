import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LOCKED_EIGHT,
  KERNEL_COMMIT,
  CONJECTURE_1,
  ORG_AXIS_NAMES,
  ORG_AXIS_WEIGHTS,
  appendReceipt,
  evaluateAnatomy,
  evaluateLambda,
  loopTax,
  recomputeRowHash,
  runInvariants,
  sha256Hex,
  tickLoop,
  yuyayAxes,
  type LedgerRow,
} from "./kernel.ts";

describe("evaluateLambda", () => {
  it("zero axis fail-closes", () => {
    const r = evaluateLambda([0.5, 0, 0.8]);
    assert.equal(r.blocked, true);
    assert.equal(r.value, 0);
  });
  it("geometric mean of live axes", () => {
    const r = evaluateLambda([1, 1, 1]);
    assert.equal(r.blocked, false);
    assert.ok(Math.abs(r.value - 1) < 1e-9);
  });
  it("yuyay axes never feed a hard zero from analog voltages", () => {
    const axes = yuyayAxes({
      x: -1,
      y: -1,
      z: 0,
      fg: 0,
      drive: 0,
      chaos: 0,
      rate: 0,
      gain: 0,
      mix: 0,
      prob: 0,
      liveFrac: 0,
      frontier: false,
      muted: true,
    });
    const r = evaluateLambda(axes);
    assert.equal(r.blocked, false);
    assert.ok(r.value > 0);
  });
  it("canonical 13-axis weights sum to 1 and match a11oy", () => {
    assert.equal(ORG_AXIS_NAMES.length, 13);
    assert.equal(ORG_AXIS_WEIGHTS.length, 13);
    const sw = ORG_AXIS_WEIGHTS.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sw - 1) < 1e-9);
    assert.equal(ORG_AXIS_WEIGHTS[0], 0.12);
    assert.equal(ORG_AXIS_WEIGHTS[3], 0.11);
    assert.equal(ORG_AXIS_WEIGHTS[7], 0.05);
  });
  it("13 equal axes recover that value (homogeneous of degree 1)", () => {
    const r = evaluateLambda(Array.from({ length: 13 }, () => 0.9));
    assert.equal(r.blocked, false);
    assert.ok(Math.abs(r.value - 0.9) < 1e-9);
    assert.match(r.reason, /Conjecture 1 OPEN/);
    assert.equal(CONJECTURE_1, "OPEN");
  });
  it("soundness drop hurts Λ more than fairness drop (weights are live)", () => {
    const base = Array.from({ length: 13 }, () => 1);
    const soundness = base.slice();
    soundness[0] = 0.5;
    const fairness = base.slice();
    fairness[7] = 0.5;
    const s = evaluateLambda(soundness);
    const f = evaluateLambda(fairness);
    const unweighted = Math.exp(Math.log(0.5) / 13);
    assert.equal(s.blocked, false);
    assert.equal(f.blocked, false);
    assert.ok(s.value < f.value);
    assert.ok(Math.abs(s.value - Math.pow(0.5, 0.12)) < 1e-9);
    assert.ok(Math.abs(f.value - Math.pow(0.5, 0.05)) < 1e-9);
    assert.ok(Math.abs(s.value - unweighted) > 1e-3);
  });
  it("mismatched weights fail-closed", () => {
    const r = evaluateLambda([0.5, 0.5], [1]);
    assert.equal(r.blocked, true);
    assert.equal(r.value, 0);
  });
});

describe("loop tax", () => {
  it("full remain at step 0", () => {
    const t = loopTax(0);
    assert.equal(t.remain, 1);
    assert.equal(t.energy, "UNAVAILABLE");
    assert.equal(t.energy_j, null);
  });
  it("exhausts at max steps", () => {
    const t = loopTax(8, 8);
    assert.equal(t.remain, 0);
    assert.equal(t.exit, "budgetExhausted");
  });
  it("tickLoop exits budgetExhausted at max", () => {
    const t = tickLoop(7, 1, 8);
    assert.equal(t.exit, "budgetExhausted");
    assert.equal(t.stepsRun, 8);
  });
  it("tickLoop can converge", () => {
    const t = tickLoop(2, 0.001, 8, 0.012);
    assert.equal(t.exit, "converged");
  });
});

describe("receipt chain", () => {
  it("SHA-256 of abc is the published digest", () => {
    assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("appended receipts HOLDS on continuity", () => {
    let rows: LedgerRow[] = [];
    rows = appendReceipt(rows, { x: 0.1, y: 0.2, z: 0.3, fg: 0.4, step: 0 });
    rows = appendReceipt(rows, { x: 0.2, y: 0.1, z: 0.4, fg: 0.5, step: 1 });
    const inv = runInvariants(rows);
    const chain = inv.invariants.find((i) => i.id === "receipt-chain-continuity");
    assert.equal(chain?.status, "HOLDS");
    assert.equal(inv.violated, 0);
    const ed = inv.invariants.find((i) => i.id === "receipt-ed25519-verify");
    assert.equal(ed?.status, "UNAVAILABLE");
    const fly = inv.invariants.find((i) => i.id === "flywheel-lineage");
    assert.equal(fly?.status, "UNAVAILABLE");
  });
  it("tampered hash VIOLATED", () => {
    let rows: LedgerRow[] = [];
    rows = appendReceipt(rows, { x: 0.1, y: 0.2, z: 0.3, fg: 0.4, step: 0 });
    rows = appendReceipt(rows, { x: 0.2, y: 0.1, z: 0.4, fg: 0.5, step: 1 });
    const bad = rows.slice();
    bad[1] = { ...bad[1]!, rowHash: "deadbeef" };
    const inv = runInvariants(bad);
    const chain = inv.invariants.find((i) => i.id === "receipt-chain-continuity");
    assert.equal(chain?.status, "VIOLATED");
  });
  it("failed row with a joule VIOLATED", () => {
    let rows: LedgerRow[] = [];
    rows = appendReceipt(rows, { x: 0, y: 0, z: 0, fg: 0, step: 0 }, false);
    const fake = rows.map((r) => ({ ...r, energy_j: 1.2, rowHash: recomputeRowHash(r.prevHash, { ...r, energy_j: 1.2 }) }));
    const inv = runInvariants(fake);
    const shape = inv.invariants.find((i) => i.id === "ledger-failure-shape");
    assert.equal(shape?.status, "VIOLATED");
  });
});

describe("anatomy", () => {
  it("five organs live when honest", () => {
    const lambda = evaluateLambda([0.8, 0.7, 0.9, 0.6, 0.5]);
    const a = evaluateAnatomy({
      lambda,
      rows: [],
      chainOk: true,
      chainHead: "genesis",
      leak: 0,
      fabricateJoule: false,
      hatunLive: false,
    });
    assert.equal(a.liveCount, 5);
    assert.equal(a.blocked, false);
    assert.equal(a.organs.length, 5);
    assert.equal(LOCKED_EIGHT.join(" "), "F1 F4 F7 F11 F12 F18 F19 F22");
    assert.equal(KERNEL_COMMIT, "c7c0ba17");
    assert.equal(CONJECTURE_1, "OPEN");
  });
  it("zero-axis heart DOWN fail-closes", () => {
    const lambda = evaluateLambda([0]);
    const a = evaluateAnatomy({
      lambda,
      rows: [],
      chainOk: true,
      chainHead: "genesis",
      leak: 0,
      fabricateJoule: false,
      hatunLive: false,
    });
    assert.equal(a.blocked, true);
    assert.equal(a.organs.find((o) => o.id === "heart")?.status, "DOWN");
  });
  it("fabricated joule downs nervous", () => {
    const lambda = evaluateLambda([0.5, 0.5]);
    const a = evaluateAnatomy({
      lambda,
      rows: [],
      chainOk: true,
      chainHead: "genesis",
      leak: 0,
      fabricateJoule: true,
      hatunLive: true,
    });
    assert.equal(a.organs.find((o) => o.id === "nervous")?.status, "DOWN");
    assert.equal(a.blocked, true);
  });
});
