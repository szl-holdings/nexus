import { useEffect, useRef, useState, type RefObject } from "react";
import type { ModuleId } from "@/lib/nexus/types";
import { LOCKED_EIGHT } from "@/lib/nexus/kernel";
import { engine, useEngine } from "@/lib/nexus/use-engine";
import { Grid } from "./Grid";
import { Oscilloscope } from "./Oscilloscope";
import { Patchbay } from "./Patchbay";
import { Sequencer } from "./Sequencer";
import { TapeDeck } from "./TapeDeck";
import { Voice } from "./Voice";

const KEY_NOTES: Record<string, number> = {
  KeyZ: 48,
  KeyS: 49,
  KeyX: 50,
  KeyD: 51,
  KeyC: 52,
  KeyV: 53,
  KeyG: 54,
  KeyB: 55,
  KeyH: 56,
  KeyN: 57,
  KeyJ: 58,
  KeyM: 59,
  Comma: 60,
  KeyQ: 60,
  Digit2: 61,
  KeyW: 62,
  Digit3: 63,
  KeyE: 64,
  KeyR: 65,
  Digit5: 66,
  KeyT: 67,
  Digit6: 68,
  KeyY: 69,
  Digit7: 70,
  KeyU: 71,
  KeyI: 72,
};

const MODULES: { id: ModuleId; label: string }[] = [
  { id: "grid", label: "Grid" },
  { id: "scope", label: "Scope" },
  { id: "tape", label: "Tape" },
  { id: "patch", label: "Patch" },
  { id: "seq", label: "Seq" },
  { id: "voice", label: "Voice" },
];

export function Workstation() {
  const snap = useEngine();
  const [help, setHelp] = useState(false);
  const [booting, setBooting] = useState(false);

  useEffect(() => {
    void engine.hydrate();
  }, []);

  useEffect(() => {
    const down = new Set<string>();
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (snap.powered) engine.togglePlay();
        return;
      }
      if (e.code === "Escape") {
        engine.panic();
        engine.stop();
        setHelp(false);
        return;
      }
      if (e.key === "?" || (e.shiftKey && e.code === "Slash")) {
        setHelp((h) => !h);
        return;
      }
      if (e.code === "KeyF" && engine.getSnapshot().powered) {
        e.preventDefault();
        if (e.shiftKey) engine.stopFrontier();
        else engine.frontier();
        return;
      }
      if (e.code === "Tab" && engine.getSnapshot().powered) {
        e.preventDefault();
        engine.cycleScopeMode();
        return;
      }
      if (e.code === "KeyO" && engine.getSnapshot().powered && e.shiftKey) {
        engine.saveScene(engine.getSnapshot().sceneSlot);
        return;
      }
      if (e.code.startsWith("Digit") && e.altKey && engine.getSnapshot().powered) {
        const slot = Number(e.code.replace("Digit", "")) - 1;
        if (slot >= 0 && slot < 8) {
          e.preventDefault();
          if (e.shiftKey) engine.saveScene(slot);
          else engine.loadScene(slot);
        }
        return;
      }
      if (e.code === "KeyM" && e.metaKey) return;
      const digit = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6"].indexOf(e.code);
      if (digit >= 0 && !e.shiftKey && !KEY_NOTES[e.code]) {
        const mod = MODULES[digit];
        if (mod) engine.setModule(mod.id);
        return;
      }
      const midi = KEY_NOTES[e.code];
      if (midi != null && snap.powered && !down.has(e.code)) {
        down.add(e.code);
        engine.noteOn(midi + (e.shiftKey ? 12 : 0));
      }
    };
    const onUp = (e: KeyboardEvent) => {
      down.delete(e.code);
      const midi = KEY_NOTES[e.code];
      if (midi != null) {
        engine.noteOff(midi);
        engine.noteOff(midi + 12);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
    };
  }, [snap.powered]);

  useEffect(() => {
    if (!snap.powered || !navigator.requestMIDIAccess) return;
    let access: MIDIAccess | null = null;
    void navigator
      .requestMIDIAccess({ sysex: false })
      .then((midi) => {
        access = midi;
        engine.setMidi(true);
        const hook = (ev: MIDIMessageEvent) => {
          const d = ev.data;
          if (!d || d.length < 2) return;
          const st = d[0]! & 0xf0;
          const n = d[1]!;
          const vel = d[2] ?? 0;
          if (st === 0x90 && vel > 0) engine.noteOn(n, vel / 127);
          else if (st === 0x80 || (st === 0x90 && vel === 0)) engine.noteOff(n);
        };
        const bind = () => {
          midi.inputs.forEach((input) => {
            input.onmidimessage = hook;
          });
        };
        bind();
        midi.onstatechange = bind;
      })
      .catch(() => {
        engine.setMidi(false);
      });
    return () => {
      access?.inputs.forEach((input) => {
        input.onmidimessage = null;
      });
    };
  }, [snap.powered]);

  async function engage(frontier = false) {
    setBooting(true);
    await engine.powerOn();
    if (frontier) engine.frontier();
    setBooting(false);
  }

  return (
    <div className="nx-chassis relative min-h-dvh overflow-x-hidden">
      <div className="nx-grain" />
      <div className="nx-scan" />
      <div className="nx-flicker" />

      {!snap.powered ? (
        <PowerGate booting={booting} onEngage={() => void engage(false)} onFrontier={() => void engage(true)} />
      ) : (
        <div className="relative z-10 mx-auto flex min-h-dvh max-w-[1600px] flex-col gap-3 px-3 py-3 sm:px-5 sm:py-4">
          <Header help={help} onHelp={() => setHelp((h) => !h)} />
          <SignalStrip />
          <div className="hidden min-h-[46rem] flex-1 grid-cols-3 grid-rows-2 gap-3 lg:grid">
            <Grid />
            <Oscilloscope />
            <TapeDeck />
            <Patchbay />
            <Sequencer />
            <Voice />
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 lg:hidden">
            <nav className="nx-tabs -mx-3 flex gap-1 overflow-x-auto px-3 pb-1">
              {MODULES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`nx-btn min-h-11 shrink-0 px-3 ${snap.module === m.id ? "nx-btn-on" : ""}`}
                  onClick={() => engine.setModule(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </nav>
            <div className="min-h-[28rem] flex-1">
              {snap.module === "grid" && <Grid />}
              {snap.module === "scope" && <Oscilloscope />}
              {snap.module === "tape" && <TapeDeck />}
              {snap.module === "patch" && <Patchbay />}
              {snap.module === "seq" && <Sequencer />}
              {snap.module === "voice" && <Voice />}
            </div>
          </div>
          {help ? <Help onClose={() => setHelp(false)} /> : null}
        </div>
      )}
    </div>
  );
}

function Header({ help, onHelp }: { help: boolean; onHelp: () => void }) {
  const snap = useEngine();
  return (
    <header className="nx-panel flex flex-col gap-3 overflow-x-hidden px-3 py-3 sm:px-4 lg:flex-row lg:flex-wrap lg:items-center">
      <span className="nx-screw left-2 top-2" />
      <span className="nx-screw right-2 top-2" />
      <div className="flex items-center justify-between gap-3 lg:contents">
        <div>
          <p className="nx-wordmark text-xl leading-tight sm:text-2xl">Nexus</p>
          <p className="nx-label">{snap.frontier ? "Holographic analog computer · live" : "Holographic analog computer · MK-II"}</p>
        </div>
        <div className="flex items-center gap-2 lg:hidden">
          <span className={`nx-led ${snap.activeNotes > 0 ? "nx-led-on" : ""}`} title="voice" />
          <span className={`nx-led ${snap.tape.motor ? "nx-led-amber" : ""}`} title="tape" />
          <span className={`nx-led ${snap.frontier ? "nx-led-on" : snap.midi ? "nx-led-on" : ""}`} title={snap.frontier ? "frontier" : "midi"} />
          <button type="button" className={`nx-btn min-h-11 px-3 ${help ? "nx-btn-on" : ""}`} onClick={onHelp}>
            Key
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 lg:mx-auto">
        <button
          type="button"
          className={`nx-btn min-h-11 whitespace-nowrap px-4 ${snap.seq.playing ? "nx-btn-on" : ""}`}
          onClick={() => engine.togglePlay()}
        >
          {snap.seq.playing ? "Stop" : "Run"}
        </button>
        <button
          type="button"
          className={`nx-btn nx-btn-rec min-h-11 whitespace-nowrap px-4 ${snap.tape.rec ? "nx-btn-rec-on" : ""}`}
          onClick={() => engine.setTape({ rec: !snap.tape.rec, motor: true })}
        >
          Rec
        </button>
        <button
          type="button"
          className={`nx-btn min-h-11 whitespace-nowrap px-4 ${snap.frontier ? "nx-btn-on" : ""}`}
          onClick={() => engine.toggleFrontier()}
        >
          Frontier
        </button>
        <button
          type="button"
          className={`nx-btn min-h-11 whitespace-nowrap px-4 ${snap.muted ? "nx-btn-on" : ""}`}
          onClick={() => engine.setMuted(!snap.muted)}
        >
          {snap.muted ? "Muted" : "Mute"}
        </button>
      </div>
      <div className="flex flex-col gap-3 lg:ml-auto lg:flex-row lg:flex-wrap lg:items-center">
        <div className="grid grid-cols-8 gap-1 lg:flex">
          {LOCKED_EIGHT.map((fid, i) => (
            <button
              key={fid}
              type="button"
              title={snap.scenes[i] ? `Recall ${fid}` : `Empty ${fid} · shift-click to store`}
              className={`nx-btn min-h-11 min-w-0 px-0 text-micro lg:min-w-11 ${snap.sceneSlot === i ? "nx-btn-on" : ""} ${snap.scenes[i] ? "text-phosphor" : ""}`}
              onClick={(e) => {
                if (e.shiftKey) engine.saveScene(i);
                else engine.loadScene(i);
              }}
            >
              {fid}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="nx-label flex min-h-11 items-center gap-2">
            Orbit
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={snap.orbit}
              onChange={(e) => engine.setOrbit(Number(e.target.value))}
              className="w-20 accent-amber"
            />
          </label>
          <label className="nx-label flex min-h-11 items-center gap-2">
            Master
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={snap.master}
              onChange={(e) => engine.setMaster(Number(e.target.value))}
              className="w-24 accent-phosphor"
            />
          </label>
          <span className={`nx-led hidden lg:inline-block ${snap.activeNotes > 0 ? "nx-led-on" : ""}`} title="voice" />
          <span className={`nx-led hidden lg:inline-block ${snap.tape.motor ? "nx-led-amber" : ""}`} title="tape" />
          <span
            className={`nx-led hidden lg:inline-block ${snap.frontier ? "nx-led-on" : snap.midi ? "nx-led-on" : ""}`}
            title={snap.frontier ? "frontier" : "midi"}
          />
          <button type="button" className={`nx-btn hidden min-h-11 px-3 lg:inline-flex ${help ? "nx-btn-on" : ""}`} onClick={onHelp}>
            Key
          </button>
        </div>
      </div>
    </header>
  );
}

function AnalogMeters({ live }: { live: boolean }) {
  const xRef = useRef<HTMLSpanElement>(null);
  const yRef = useRef<HTMLSpanElement>(null);
  const zRef = useRef<HTMLSpanElement>(null);
  const fRef = useRef<HTMLSpanElement>(null);
  const lRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const a = engine.getAnalog();
      const k = engine.getKernel();
      const set = (el: HTMLSpanElement | null, v: number) => {
        if (!el) return;
        el.style.transform = `scaleY(${Math.max(0.04, Math.min(1, Math.abs(v)))})`;
      };
      set(xRef.current, a.x);
      set(yRef.current, a.y);
      set(zRef.current, a.z);
      set(fRef.current, a.fg);
      set(lRef.current, k.lambda);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className={`flex items-end gap-1.5 ${live ? "opacity-100" : "opacity-40"}`} title="Analog computer X Y Z FG Λ">
      <MeterBar barRef={xRef} label="X" />
      <MeterBar barRef={yRef} label="Y" />
      <MeterBar barRef={zRef} label="Z" />
      <MeterBar barRef={fRef} label="FG" amber />
      <MeterBar barRef={lRef} label="Λ" amber />
    </div>
  );
}

function MeterBar({
  barRef,
  label,
  amber,
}: {
  barRef: RefObject<HTMLSpanElement | null>;
  label: string;
  amber?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="nx-meter">
        <span ref={barRef} className={amber ? "nx-meter-amber" : undefined} />
      </div>
      <span className="nx-label">{label}</span>
    </div>
  );
}

function SignalStrip() {
  const snap = useEngine();
  const blocks = [
    { id: "vco", label: "VCO" },
    { id: "vcf", label: "VCF" },
    { id: "tape", label: "TAPE" },
    { id: "vca", label: "VCA" },
    { id: "out", label: "OUT" },
  ] as const;
  return (
    <div className="nx-panel flex flex-wrap items-center gap-2 overflow-x-hidden px-4 py-2">
      {blocks.map((b, i) => {
        const live = snap.patches.some(
          (p) =>
            p.from === b.id ||
            p.to === b.id ||
            (b.id === "vco" && p.from === "vco") ||
            (b.id === "tape" && (p.from === "tape" || p.to === "delay")),
        );
        const vcaClosed = b.id === "vca" && snap.frontier && engine.getKernel().blocked;
        return (
          <div key={b.id} className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-sm border border-hairline bg-panel-hi px-3 py-1.5">
              <span className={`nx-led ${vcaClosed ? "nx-led-rec" : live ? "nx-led-on" : ""}`} />
              <span className="nx-label">{b.label}</span>
            </div>
            {i < blocks.length - 1 ? <span className="font-mono text-micro text-phosphor-dim">→</span> : null}
          </div>
        );
      })}
      <AnalogMeters live />
      <OrganRail />
      <span className="basis-full font-mono text-micro tabular-nums text-amber sm:ml-auto sm:basis-auto">
        {Math.round(snap.seq.bpm)} BPM · {snap.voice.waveform.toUpperCase()} · {snap.scopeMode.toUpperCase()}
        {snap.frontier ? ` · FRONTIER · ${(snap.analog.mode ?? "op").toUpperCase()}` : ""}
        {snap.muted ? " · F12 MUTE" : ""}
        {snap.seq.arp ? " · ARP" : ""}
        {snap.voice.fold > 0.05 ? " · FOLD" : ""}
        {snap.voice.shAmt > 0.05 ? " · S&H" : ""}
        {snap.voice.ring > 0.05 ? " · RING" : ""}
        {snap.analog.cycle ? " · FG" : ""}
        {snap.midi ? " · MIDI" : ""}
        {snap.bouncing ? " · BOUNCE" : ""}
        {" · E UNAVAILABLE"}
      </span>
    </div>
  );
}

function OrganRail() {
  const organsRef = useRef<HTMLDivElement>(null);
  const probesRef = useRef<HTMLDivElement>(null);
  const lambdaRef = useRef<HTMLSpanElement>(null);
  const reasonRef = useRef<HTMLSpanElement>(null);
  const goLab = useRef<HTMLSpanElement>(null);
  const goLed = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const k = engine.getKernel();
      const probes = engine.getProbes();
      if (lambdaRef.current) lambdaRef.current.textContent = `Λ ${k.lambda.toFixed(3)}`;
      if (reasonRef.current) {
        reasonRef.current.textContent = k.blocked
          ? "F19 FAIL-CLOSED"
          : `${k.liveCount}/5 · C1 OPEN`;
        reasonRef.current.className = `nx-label ${k.blocked ? "text-record" : ""}`;
      }
      if (goLab.current && goLed.current) {
        const go = k.liveCount === 5 && !k.blocked;
        goLab.current.textContent = k.blocked ? "NO-GO" : go ? "GO" : "HOLD";
        goLed.current.className = `nx-led ${k.blocked ? "nx-led-rec" : go ? "nx-led-on" : "nx-led-amber"}`;
      }
      const root = organsRef.current;
      if (root) {
        const chips = root.querySelectorAll("[data-organ]");
        chips.forEach((el) => {
          const id = el.getAttribute("data-organ");
          const organ = k.organs.find((o) => o.id === id);
          const led = el.querySelector(".nx-led");
          if (led) {
            led.className = `nx-led ${organ?.status === "LIVE" ? "nx-led-on" : organ?.status === "DOWN" ? "nx-led-rec" : ""}`;
          }
        });
      }
      const pr = probesRef.current;
      if (pr) {
        const chips = pr.querySelectorAll("[data-probe]");
        chips.forEach((el) => {
          const id = el.getAttribute("data-probe");
          const p = probes.find((x) => x.id === id);
          const led = el.querySelector(".nx-led");
          if (led) led.className = `nx-led ${p?.status === "LIVE" ? "nx-led-on" : ""}`;
          if (p) el.setAttribute("title", `${p.label} ${p.status} · ${p.detail}`);
        });
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const idleK = engine.getKernel();
  const idleP = engine.getProbes();

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <div ref={organsRef} className="flex flex-wrap items-center gap-1">
        {(idleK.organs.length
          ? idleK.organs
          : [
              { id: "brain", quechua: "YACHAY" },
              { id: "heart", quechua: "YUYAY" },
              { id: "circulatory", quechua: "YAWAR" },
              { id: "nervous", quechua: "OTel" },
              { id: "skeleton", quechua: "KHIPU" },
            ]
        ).map((o) => (
          <span key={o.id} data-organ={o.id} className="nx-organ" title={o.quechua}>
            <span className="nx-led" />
            <span className="nx-label">{o.quechua}</span>
          </span>
        ))}
      </div>
      <span ref={lambdaRef} className="font-mono text-micro tabular-nums text-amber">
        Λ {idleK.lambda.toFixed(3)}
      </span>
      <span ref={reasonRef} className="nx-label">
        {idleK.liveCount}/5 · C1 OPEN
      </span>
      <span className="nx-organ" title="Green light · 5/5 organs LIVE, not fail-closed">
        <span ref={goLed} className="nx-led nx-led-amber" />
        <span ref={goLab} className="nx-label">
          HOLD
        </span>
      </span>
      <div ref={probesRef} className="flex flex-wrap items-center gap-1">
        {idleP.map((p) => (
          <span key={p.id} data-probe={p.id} className="nx-organ" title={`${p.label} ${p.status} · ${p.detail}`}>
            <span className="nx-led" />
            <span className="nx-label">{p.id === "hatun" ? "Hatun" : p.id === "anatomy" ? "Anat" : "Space"}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function PowerGate({
  booting,
  onEngage,
  onFrontier,
}: {
  booting: boolean;
  onEngage: () => void;
  onFrontier: () => void;
}) {
  return (
    <div className="relative z-10 flex min-h-dvh w-full flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="nx-wordmark text-4xl sm:text-6xl">Nexus</p>
      <p className="nx-label max-w-md text-pretty">
        Holographic analog computer · Lorenz core · Ouroboros · five organs · Hatun
        <br />
        MK-II Frontier: live analog computer — IC / OP / HALT / REP — driving voice, tape, grid, and hologram
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={onEngage} className={`nx-btn min-h-12 px-8 py-3 text-sm ${booting ? "nx-btn-on" : ""}`}>
          {booting ? "Warming heaters…" : "Press to engage"}
        </button>
        <button type="button" onClick={onFrontier} className="nx-btn nx-btn-on min-h-12 px-8 py-3 text-sm">
          Launch Frontier
        </button>
      </div>
      <span className={`nx-led ${booting ? "nx-led-amber" : ""}`} />
    </div>
  );
}

function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className="nx-help nx-panel absolute inset-x-4 top-24 z-30 mx-auto max-w-lg p-5 sm:inset-x-auto">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="nx-label">Key map</h2>
        <button type="button" className="nx-btn min-h-11 px-2 py-1" onClick={onClose}>
          Close
        </button>
      </div>
      <ul className="space-y-1.5 font-mono text-sm text-fg">
        <li>
          <kbd>F</kbd> Frontier — live Lorenz analog computer. Shift-F disengages. Press again to reseed the loop.
        </li>
        <li>IC holds initial conditions. OP integrates. HALT freezes. REP reseeds the attractor.</li>
        <li>X Y Z FG Λ meters. Attack / Release are the function generator rise and fall.</li>
        <li>
          Patch <span className="text-phosphor">ANLG</span> and <span className="text-phosphor">FUNC</span> into VCF or PAN
        </li>
        <li>
          <kbd>Tab</kbd> cycle scope Y-T / X-Y / FFT / HOLO — hologram is the attractor plus five organs
        </li>
        <li>Ouroboros taxes the VCA in Frontier. Eight bars, then the loop closes. Run starts another.</li>
        <li>F19 fail-closed: a DOWN organ mutes the VCA. Master cannot compensate. Energy stays UNAVAILABLE.</li>
        <li>Λ is advisory. Conjecture 1 remains OPEN. Hatun probes stay LIVE or honestly UNAVAILABLE.</li>
        <li>GO is 5/5 organs LIVE. HOLD until the kernel settles. NO-GO is F19 fail-closed.</li>
        <li>Scenes F1 F4 F7 F11 F12 F18 F19 F22 · shift-click stores</li>
        <li>
          <kbd>space</kbd> run / stop sequencer
        </li>
        <li>
          <kbd>Z</kbd>–<kbd>M</kbd> voice keys · shift = octave
        </li>
        <li>
          <kbd>1</kbd>–<kbd>6</kbd> modules on compact view
        </li>
        <li>
          <kbd>esc</kbd> panic / all notes off
        </li>
        <li>
          <kbd>?</kbd> this legend
        </li>
        <li>Grid: tap cells to write. Analog pen tracks Lorenz X×Y. Tape play engages echo. Patch cables reroute the chain.</li>
      </ul>
    </div>
  );
}
