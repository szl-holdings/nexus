import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  appendReceipt,
  appendReceiptWindow,
  emptyReceiptWindow,
  evaluateAnatomy,
  evaluateLambda,
  recomputeRowHash,
  runInvariants,
  type LedgerRow,
  type ReceiptWindow,
} from "./kernel.ts";

const analog = (step: number): LedgerRow["analog"] => ({
  x: 0.1, y: 0.2, z: 0.3, fg: 0.4, step,
});

function buildWindow(count: number): ReceiptWindow {
  let window = emptyReceiptWindow();
  for (let step = 0; step < count; step++) {
    window = appendReceiptWindow(window, analog(step));
  }
  return window;
}

function chain(window: ReceiptWindow) {
  const result = runInvariants(window.rows, window.anchor).invariants.find(
    (invariant) => invariant.id === "receipt-chain-continuity",
  );
  assert.ok(result);
  return result;
}

function copyWindow(window: ReceiptWindow): ReceiptWindow {
  return {
    anchor: { ...window.anchor },
    rows: window.rows.map((row) => ({ ...row, analog: { ...row.analog } })),
  };
}

describe("bounded receipt window", () => {
  it("starts an independent session at genesis with no data", () => {
    const first = emptyReceiptWindow();
    const second = emptyReceiptWindow();
    assert.deepEqual(first, { rows: [], anchor: { id: 0, rowHash: "genesis" } });
    assert.notEqual(first.rows, second.rows);
    assert.notEqual(first.anchor, second.anchor);
    assert.equal(chain(first).status, "NO_DATA");
  });

  it("keeps all 64 original rows linked to genesis", () => {
    const window = buildWindow(64);
    assert.equal(window.rows.length, 64);
    assert.equal(window.rows[0]!.id, 1);
    assert.equal(window.rows[63]!.id, 64);
    assert.deepEqual(window.anchor, { id: 0, rowHash: "genesis" });
    assert.equal(chain(window).status, "HOLDS");
    assert.equal(chain(window).checked, 64);
    assert.equal(runInvariants(window.rows, window.anchor).violated, 0);
  });

  it("at append 65 checkpoints the evicted row without rewriting retained receipts", () => {
    const before = buildWindow(64);
    const snapshot = copyWindow(before);
    const after = appendReceiptWindow(before, analog(64));
    assert.equal(after.rows.length, 64);
    assert.deepEqual(after.anchor, { id: 1, rowHash: before.rows[0]!.rowHash });
    assert.deepEqual(after.rows.slice(0, 63), before.rows.slice(1));
    assert.equal(after.rows[0]!.prevHash, before.rows[0]!.rowHash);
    assert.equal(after.rows[63]!.id, 65);
    assert.equal(after.rows[63]!.prevHash, before.rows[63]!.rowHash);
    assert.deepEqual(before, snapshot);
    assert.equal(chain(after).status, "HOLDS");
    assert.equal(chain(after).violations, 0);
  });

  it("does not repeat ID 65 on append 66 or after multiple rotations", () => {
    for (const count of [65, 66, 67, 128, 129, 200]) {
      const window = buildWindow(count);
      assert.equal(window.rows.length, 64);
      assert.equal(window.anchor.id, count - 64);
      assert.deepEqual(window.rows.map((row) => row.id),
        Array.from({ length: 64 }, (_, index) => count - 63 + index));
      assert.equal(new Set(window.rows.map((row) => row.id)).size, 64);
      assert.equal(chain(window).status, "HOLDS");
    }
  });

  it("resumes from copied state without a hidden counter or checkpoint", () => {
    const previous = buildWindow(65);
    const resumed = copyWindow(previous);
    const next = appendReceiptWindow(resumed, analog(0));
    assert.equal(next.rows[63]!.id, 66);
    assert.equal(next.rows[63]!.prevHash, previous.rows[63]!.rowHash);
    assert.deepEqual(next.anchor, { id: 2, rowHash: previous.rows[0]!.rowHash });
    assert.equal(chain(next).status, "HOLDS");
  });

  it("a new session resets rows and checkpoint together", () => {
    const oldSession = buildWindow(200);
    const oldSnapshot = copyWindow(oldSession);
    const nextSession = appendReceiptWindow(emptyReceiptWindow(), analog(0));
    assert.equal(nextSession.rows[0]!.id, 1);
    assert.equal(nextSession.rows[0]!.prevHash, "genesis");
    assert.deepEqual(nextSession.anchor, { id: 0, rowHash: "genesis" });
    assert.equal(chain(nextSession).status, "HOLDS");
    assert.deepEqual(oldSession, oldSnapshot);
  });

  it("does not silently treat a truncated array as genesis", () => {
    const window = buildWindow(65);
    const result = runInvariants(window.rows).invariants.find(
      (invariant) => invariant.id === "receipt-chain-continuity",
    );
    assert.equal(result?.status, "VIOLATED");
  });

  it("rejects retained payload tampering at the first, middle, and last row", () => {
    for (const index of [0, 31, 63]) {
      const bad = copyWindow(buildWindow(65));
      bad.rows[index]!.analog.x = 0.9;
      assert.equal(chain(bad).status, "VIOLATED");
    }
  });

  it("rejects retained row-hash tampering at the first, middle, and last row", () => {
    for (const index of [0, 31, 63]) {
      const bad = copyWindow(buildWindow(65));
      bad.rows[index]!.rowHash = "0".repeat(64);
      assert.equal(chain(bad).status, "VIOLATED");
    }
  });

  it("rejects retained predecessor-pointer tampering including the boundary", () => {
    for (const index of [0, 31, 63]) {
      const bad = copyWindow(buildWindow(65));
      bad.rows[index]!.prevHash = "0".repeat(64);
      assert.equal(chain(bad).status, "VIOLATED");
    }
  });

  it("rejects a forged first predecessor even if every retained hash is recomputed", () => {
    const bad = copyWindow(buildWindow(65));
    let previous = "0".repeat(64);
    bad.rows = bad.rows.map((row) => {
      const forged = { ...row, prevHash: previous };
      const result = { ...forged, rowHash: recomputeRowHash(previous, forged) };
      previous = result.rowHash;
      return result;
    });
    assert.equal(chain(bad).status, "VIOLATED");
  });

  it("rejects stale, malformed, and mismatched checkpoints", () => {
    const window = buildWindow(65);
    for (const anchor of [
      { id: 0, rowHash: "genesis" },
      { id: 1, rowHash: "0".repeat(64) },
      { id: 2, rowHash: window.anchor.rowHash },
      { id: -1, rowHash: window.anchor.rowHash },
      { id: 1.5, rowHash: window.anchor.rowHash },
      { id: 1, rowHash: "genesis" },
    ]) {
      assert.equal(chain({ ...window, anchor }).status, "VIOLATED");
    }
  });

  it("rejects duplicate, gapped, fractional, and unsafe receipt IDs", () => {
    const window = buildWindow(66);
    for (const [index, id] of [
      [0, window.rows[0]!.id + 1],
      [31, window.rows[30]!.id],
      [31, window.rows[31]!.id + 1],
      [63, 1.5],
      [63, Number.MAX_SAFE_INTEGER + 1],
    ]) {
      const bad = copyWindow(window);
      bad.rows[index]!.id = id!;
      assert.equal(chain(bad).status, "VIOLATED");
    }
  });

  it("refuses to evict a failed oldest row or advance its checkpoint", () => {
    const bad = copyWindow(buildWindow(64));
    bad.rows[0]!.analog.x = 0.9;
    const before = copyWindow(bad);
    const next = appendReceiptWindow(bad, analog(64));
    assert.equal(next, bad);
    assert.deepEqual(next, before);
    assert.equal(chain(next).status, "VIOLATED");
  });

  it("refuses to append through a duplicate-ID failure", () => {
    const bad = copyWindow(buildWindow(66));
    bad.rows[63]!.id = bad.rows[62]!.id;
    const before = copyWindow(bad);
    assert.equal(appendReceiptWindow(bad, analog(66)), bad);
    assert.deepEqual(bad, before);
    assert.equal(chain(bad).status, "VIOLATED");
  });

  it("keeps failure receipts and unavailable verification labels honest", () => {
    const before = buildWindow(64);
    const after = appendReceiptWindow(before, analog(64), false);
    const row = after.rows[63]!;
    assert.equal(row.ok, false);
    assert.equal(row.energy_j, null);
    const result = runInvariants(after.rows, after.anchor);
    assert.equal(result.violated, 0);
    assert.equal(result.invariants.length, 8);
    assert.equal(result.invariants.find((entry) => entry.id === "receipt-ed25519-verify")?.status, "UNAVAILABLE");
    assert.equal(result.invariants.find((entry) => entry.id === "flywheel-lineage")?.status, "UNAVAILABLE");
    assert.equal(chain(after).status, "HOLDS");
  });

  it("keeps YAWAR live at retention rollover and fail-closed for corruption", () => {
    const window = buildWindow(65);
    const anatomy = (value: ReceiptWindow) => evaluateAnatomy({
      lambda: evaluateLambda([0.8, 0.7, 0.9]),
      rows: value.rows,
      chainOk: chain(value).status !== "VIOLATED",
      chainHead: value.rows[value.rows.length - 1]!.rowHash,
      leak: 0,
      fabricateJoule: false,
      hatunLive: false,
    });
    assert.equal(anatomy(window).blocked, false);
    assert.equal(anatomy(window).organs.find((organ) => organ.id === "circulatory")?.status, "LIVE");
    const bad = copyWindow(window);
    bad.rows[0]!.analog.x = 0.9;
    assert.equal(anatomy(bad).blocked, true);
    assert.equal(anatomy(bad).organs.find((organ) => organ.id === "circulatory")?.status, "DOWN");
  });

  it("refuses safe-integer exhaustion instead of repeating an ID", () => {
    const row = buildWindow(1).rows[0]!;
    assert.throws(
      () => appendReceipt([{ ...row, id: Number.MAX_SAFE_INTEGER }], analog(1)),
      { name: "RangeError", message: "Receipt ID must be a positive safe integer" },
    );
  });

  it("rejects an empty window that retains a non-genesis checkpoint", () => {
    const old = buildWindow(65);
    const bad = { rows: [], anchor: old.anchor };
    assert.equal(chain(bad).status, "VIOLATED");
    assert.equal(appendReceiptWindow(bad, analog(0)), bad);
  });

  it("wires engine restarts to retained state and new sessions to an atomic reset", () => {
    // Source integration contract only: no Web Audio, browser, or runtime claim.
    const source = readFileSync(new URL("./engine.ts", import.meta.url), "utf8");
    assert.match(source, /private receipts = emptyReceiptWindow\(\);/);
    assert.match(source, /this\.receipts = appendReceiptWindow\(this\.receipts, analog, ok\);/);
    assert.match(source, /runInvariants\(rows, this\.receipts\.anchor\)/);
    const resetLoop = source.slice(source.indexOf("  private resetLoop()"), source.indexOf("  private ouroborosBar()"));
    assert.match(resetLoop, /this\.loopSteps = 0/);
    assert.doesNotMatch(resetLoop, /receipts/);
    const frontier = source.slice(source.indexOf("  frontier()"), source.indexOf("  setVoice("));
    const existingSessionEnd = frontier.indexOf("    const grid = emptyGrid();");
    assert.ok(existingSessionEnd > 0);
    assert.doesNotMatch(frontier.slice(0, existingSessionEnd), /this\.receipts =/);
    assert.match(frontier.slice(existingSessionEnd), /this\.receipts = emptyReceiptWindow\(\);/);
    const playStop = source.slice(source.indexOf("  play()"), source.indexOf("  togglePlay()"));
    assert.doesNotMatch(playStop, /receipts/);
  });
});
