/**
 * NEX-02: a voice release must only clean up the note it released.
 *
 * `releaseSlot()` frees the slot immediately and schedules a cleanup timer.
 * `noteOn()` takes the first free slot, so the very next note usually reuses
 * the slot that was just released. Before the generation fence, that pending
 * timer stopped and disconnected whatever the slot held when it fired, i.e.
 * the newer note.
 *
 * Fake clock + fake Web Audio graph only (see engine-test-harness.ts). This is
 * control-flow evidence, not a real browser/audio observation.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  loadEngineHarness,
  type Engine,
  type FakeAudioContext,
  type FakeNode,
  type Harness,
} from "./engine-test-harness.ts";
import { midiToHz } from "./math.ts";

let h: Harness;
before(async () => {
  h = await loadEngineHarness();
});

/** Default release is 0.28 s, so its cleanup timer fires 360 ms later. */
const AFTER_RELEASE_MS = 600;

interface Rig {
  engine: Engine;
  ctx: FakeAudioContext;
  /** Oscillators created for `midi` since the rig was built. */
  oscs(midi: number): FakeNode[];
  sounding(midi: number): boolean;
  silenced(midi: number): boolean;
  /** Nodes created since the rig was built (per-note nodes only). */
  noteNodes(): FakeNode[];
}

async function rig(): Promise<Rig> {
  const { engine, ctx } = await h.poweredEngine();
  h.clock.advance(1000); // drain power-on save timers
  const mark = ctx.created.length;
  const oscs = (midi: number) =>
    ctx.created
      .slice(mark)
      .filter(
        (n) =>
          n.kind === "Oscillator" && (n.frequency as { value: number }).value === midiToHz(midi),
      );
  return {
    engine,
    ctx,
    oscs,
    sounding: (midi) => oscs(midi).length > 0 && oscs(midi).every((o) => o.sounding),
    silenced: (midi) =>
      oscs(midi).length > 0 && oscs(midi).every((o) => !o.sounding && o.outputs.size === 0),
    noteNodes: () => ctx.created.slice(mark),
  };
}

describe("voice release fencing (NEX-02)", () => {
  it("a released note is still stopped and disconnected by its own cleanup", async () => {
    const r = await rig();
    r.engine.noteOn(60);
    h.clock.advance(50);
    assert.ok(r.sounding(60));
    r.engine.noteOff(60);
    h.clock.advance(AFTER_RELEASE_MS);
    assert.ok(r.silenced(60), "released note must be cleaned up");
    for (const o of r.oscs(60)) assert.ok(o.stopCalls >= 1, "oscillator was stopped");
    assert.equal(r.engine.getSnapshot().activeNotes, 0);
  });

  it("reuse: a stale release cannot stop a newer note in the same slot", async () => {
    const r = await rig();
    r.engine.noteOn(60);
    h.clock.advance(50);
    r.engine.noteOff(60); // cleanup timer pending for this slot
    h.clock.advance(50);
    r.engine.noteOn(62); // first free slot: the one 60 just released
    h.clock.advance(AFTER_RELEASE_MS);
    assert.ok(r.sounding(62), "newer note was stopped by the older note's release");
    assert.ok(r.silenced(60));
    assert.equal(r.engine.getSnapshot().activeNotes, 1);
  });

  it("stealing: a stale release cannot stop a note that stole the slot", async () => {
    const r = await rig();
    r.engine.noteOn(60);
    h.clock.advance(10);
    r.engine.noteOff(60); // stale timer for slot 0
    h.clock.advance(10);
    r.engine.noteOn(61); // reuses slot 0, now the oldest busy voice
    for (let m = 62; m <= 68; m++) {
      h.clock.advance(10);
      r.engine.noteOn(m); // slots 1..7: every voice busy
    }
    h.clock.advance(10);
    r.engine.noteOn(70); // steals the oldest voice (61, slot 0)
    h.clock.advance(AFTER_RELEASE_MS);
    assert.ok(r.silenced(61), "stolen note is cut");
    assert.ok(r.sounding(70), "stealing note was stopped by a stale release");
    for (let m = 62; m <= 68; m++) assert.ok(r.sounding(m), `note ${m} kept sounding`);
    assert.equal(r.engine.getSnapshot().activeNotes, 8);
  });

  it("panic silences every sounding note but spares notes started after it", async () => {
    const r = await rig();
    r.engine.noteOn(60);
    h.clock.advance(10);
    r.engine.noteOn(64);
    h.clock.advance(10);
    r.engine.panic(); // hard release + cleanup timer on every slot
    h.clock.advance(10);
    r.engine.noteOn(67); // reuses slot 0
    h.clock.advance(AFTER_RELEASE_MS);
    assert.ok(r.silenced(60), "panic silenced 60");
    assert.ok(r.silenced(64), "panic silenced 64");
    assert.ok(r.sounding(67), "note after panic was stopped by panic's cleanup");
    assert.deepEqual(r.engine.getSnapshot().heldKeys, [67]);
    assert.equal(r.engine.getSnapshot().activeNotes, 1);
  });

  it("transport stop (all notes off) does not cut a note played right after it", async () => {
    const r = await rig();
    r.engine.noteOn(60);
    h.clock.advance(20);
    r.engine.stop();
    h.clock.advance(5);
    r.engine.noteOn(65);
    h.clock.advance(AFTER_RELEASE_MS);
    assert.ok(r.silenced(60));
    assert.ok(r.sounding(65));
  });

  it("retention: after churn only held notes sound; every other oscillator is released", async () => {
    const r = await rig();
    const played = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const m = 36 + ((i * 7) % 24);
      played.add(m);
      r.engine.noteOn(m);
      h.clock.advance(20);
      r.engine.noteOff(m);
      h.clock.advance(20);
      if (i % 10 === 9) r.engine.panic();
    }
    const held = [72, 76, 79];
    for (const m of held) {
      r.engine.noteOn(m);
      h.clock.advance(5);
    }
    h.clock.advance(2000);
    for (const m of held) assert.ok(r.sounding(m), `held note ${m} was cut`);
    for (const m of played) assert.ok(r.silenced(m), `released note ${m} was retained`);
    const live = r.noteNodes().filter((n) => n.kind === "Oscillator" && n.sounding);
    assert.equal(live.length, held.length * 2, "only the held notes' oscillators remain");
    assert.equal(h.clock.pending, 0, "no release timer outlives its window");
    assert.equal(r.engine.getSnapshot().activeNotes, held.length);
  });
});

describe("per-note node retention (NEX-02)", () => {
  const voices = [
    ["oscillator voice with unison and FM", { unison: 3, fmIndex: 0.4 }],
    ["pluck voice", { waveform: "pluck" }],
  ] as const;

  for (const [label, voice] of voices) {
    it(`${label}: every node built for a note is disconnected by its cleanup`, async () => {
      const r = await rig();
      r.engine.setVoice(voice);
      const start = r.ctx.created.length;
      r.engine.noteOn(60);
      const perNote = r.ctx.created.slice(start);
      assert.ok(perNote.length > 0, "the note built per-note nodes");
      h.clock.advance(50);
      r.engine.noteOff(60);
      h.clock.advance(AFTER_RELEASE_MS);
      const retained = perNote.filter((n) => n.outputs.size > 0).map((n) => n.kind);
      assert.deepEqual(retained, [], "per-note nodes still wired into the voice");
    });

    it(`${label}: reusing a slot releases the previous note's nodes, not the new ones`, async () => {
      const r = await rig();
      r.engine.setVoice(voice);
      const a = r.ctx.created.length;
      r.engine.noteOn(60);
      const b = r.ctx.created.length;
      h.clock.advance(20);
      r.engine.noteOff(60);
      h.clock.advance(20);
      r.engine.noteOn(62); // same slot
      const c = r.ctx.created.length;
      h.clock.advance(AFTER_RELEASE_MS);
      const oldNodes = r.ctx.created.slice(a, b);
      const newNodes = r.ctx.created.slice(b, c);
      assert.deepEqual(
        oldNodes.filter((n) => n.outputs.size > 0).map((n) => n.kind),
        [],
        "previous note's nodes retained after reuse",
      );
      assert.ok(newNodes.length > 0);
      assert.ok(
        newNodes.every((n) => n.outputs.size > 0),
        "held note's nodes were disconnected",
      );
    });
  }
});
