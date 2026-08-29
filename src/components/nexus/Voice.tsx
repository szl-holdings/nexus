import { engine, useEngine } from "@/lib/nexus/use-engine";
import type { AnalogMode, Waveform } from "@/lib/nexus/types";
import { analogCoefficients } from "@/lib/nexus/math";
import { Knob } from "./Knob";
import { ModuleFrame } from "./ModuleFrame";

const KEYS: { midi: number; white: boolean; label: string }[] = [
  { midi: 48, white: true, label: "Z" },
  { midi: 49, white: false, label: "S" },
  { midi: 50, white: true, label: "X" },
  { midi: 51, white: false, label: "D" },
  { midi: 52, white: true, label: "C" },
  { midi: 53, white: true, label: "V" },
  { midi: 54, white: false, label: "G" },
  { midi: 55, white: true, label: "B" },
  { midi: 56, white: false, label: "H" },
  { midi: 57, white: true, label: "N" },
  { midi: 58, white: false, label: "J" },
  { midi: 59, white: true, label: "M" },
  { midi: 60, white: true, label: "," },
];

const WAVES: Waveform[] = ["sine", "triangle", "sawtooth", "square", "pluck"];
const MODES: { id: AnalogMode; label: string }[] = [
  { id: "ic", label: "IC" },
  { id: "op", label: "OP" },
  { id: "halt", label: "Halt" },
  { id: "rep", label: "Rep" },
];

export function Voice() {
  const snap = useEngine();
  const v = snap.voice;
  const a = snap.analog;
  const whites = KEYS.filter((k) => k.white);
  const blacks = KEYS.filter((k) => !k.white);
  const coef = analogCoefficients(a.chaos);

  return (
    <ModuleFrame title="Voice" serial={snap.frontier ? "ANLG-1" : "VCO-A"}>
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex flex-wrap gap-1">
          {WAVES.map((w) => (
            <button
              key={w}
              type="button"
              className={`nx-btn min-h-11 px-2 py-1.5 ${v.waveform === w ? "nx-btn-on" : ""}`}
              onClick={() => engine.setVoice({ waveform: w })}
            >
              {w.slice(0, 3)}
            </button>
          ))}
        </div>
        <div className="nx-knobs">
          <Knob label="Morph" value={v.morph} min={0} max={1} onChange={(n) => engine.setVoice({ morph: n })} format={(n) => n.toFixed(2)} />
          <Knob label="Cutoff" value={v.cutoff} min={80} max={8000} onChange={(n) => engine.setVoice({ cutoff: n })} format={(n) => `${Math.round(n)}`} />
          <Knob label="Res" value={v.resonance} min={0.2} max={18} onChange={(n) => engine.setVoice({ resonance: n })} format={(n) => n.toFixed(1)} />
          <Knob label="FM" value={v.fmIndex} min={0} max={24} onChange={(n) => engine.setVoice({ fmIndex: n })} format={(n) => n.toFixed(2)} />
          <Knob label="Atk" value={v.attack} min={0.002} max={1.2} onChange={(n) => engine.setVoice({ attack: n })} format={(n) => n.toFixed(2)} />
          <Knob label="Dec" value={v.decay} min={0.02} max={1.4} onChange={(n) => engine.setVoice({ decay: n })} format={(n) => n.toFixed(2)} />
          <Knob label="Sus" value={v.sustain} min={0} max={1} onChange={(n) => engine.setVoice({ sustain: n })} format={(n) => n.toFixed(2)} />
          <Knob label="Rel" value={v.release} min={0.02} max={2.2} onChange={(n) => engine.setVoice({ release: n })} format={(n) => n.toFixed(2)} />
          <Knob label="Uni" value={v.unison} min={1} max={5} step={2} onChange={(n) => engine.setVoice({ unison: n })} format={(n) => `${Math.round(n)}`} />
          <Knob label="Det" value={v.detune} min={0} max={40} onChange={(n) => engine.setVoice({ detune: n })} format={(n) => n.toFixed(0)} />
        </div>
        <p className="nx-label">
          Analog computer · {(a.mode ?? "op").toUpperCase()} · σ {coef.sigma} · ρ {coef.rho.toFixed(1)} · β {coef.beta.toFixed(2)}
        </p>
        <div className="flex flex-wrap gap-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`nx-btn min-h-11 px-2 py-1.5 ${a.mode === m.id ? "nx-btn-on" : ""}`}
              onClick={() => engine.setAnalog({ mode: m.id })}
            >
              {m.label}
            </button>
          ))}
          <button
            type="button"
            className={`nx-btn min-h-11 px-2 py-1.5 ${a.cycle ? "nx-btn-on" : ""}`}
            onClick={() => engine.setAnalog({ cycle: !a.cycle })}
          >
            Cycle
          </button>
        </div>
        <div className="nx-knobs">
          <Knob label="Fold" value={v.fold} min={0} max={1} onChange={(n) => engine.setVoice({ fold: n })} format={(n) => n.toFixed(2)} />
          <Knob label="LFO" value={v.lfoRate} min={0.05} max={12} onChange={(n) => engine.setVoice({ lfoRate: n })} format={(n) => `${n.toFixed(2)}Hz`} />
          <Knob label="Depth" value={v.lfoDepth} min={0} max={1} onChange={(n) => engine.setVoice({ lfoDepth: n })} format={(n) => n.toFixed(2)} />
          <Knob label="S&H" value={v.shAmt} min={0} max={1} onChange={(n) => engine.setVoice({ shAmt: n })} format={(n) => n.toFixed(2)} />
          <Knob label="Ring" value={v.ring} min={0} max={1} onChange={(n) => engine.setVoice({ ring: n })} format={(n) => n.toFixed(2)} />
          <Knob label="Rate" value={a.rate} min={0.08} max={1.6} onChange={(n) => engine.setAnalog({ rate: n })} format={(n) => n.toFixed(2)} />
          <Knob label="Chaos" value={a.chaos} min={0} max={1} onChange={(n) => engine.setAnalog({ chaos: n })} format={(n) => n.toFixed(2)} />
          <Knob label="Drive" value={a.drive} min={0} max={1} onChange={(n) => engine.setAnalog({ drive: n })} format={(n) => n.toFixed(2)} />
        </div>
        <div className="relative mt-auto h-20 min-h-20">
          <div className="absolute inset-0 flex">
            {whites.map((k) => (
              <button
                key={k.midi}
                type="button"
                className={`nx-key relative min-h-11 flex-1 ${snap.heldKeys.includes(k.midi) ? "nx-key-on" : ""}`}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  engine.noteOn(k.midi);
                }}
                onPointerUp={() => engine.noteOff(k.midi)}
                onPointerCancel={() => engine.noteOff(k.midi)}
              >
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 font-mono text-micro">{k.label}</span>
              </button>
            ))}
          </div>
          <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[58%]">
            {whites.map((k, i) => {
              const next = whites[i + 1];
              const black = blacks.find((b) => next && b.midi > k.midi && b.midi < next.midi);
              return (
                <div key={k.midi} className="relative flex-1">
                  {black ? (
                    <button
                      type="button"
                      className={`nx-key nx-key-black pointer-events-auto absolute left-full z-10 h-full w-[70%] -translate-x-1/2 ${
                        snap.heldKeys.includes(black.midi) ? "nx-key-on" : ""
                      }`}
                      onPointerDown={(e) => {
                        e.currentTarget.setPointerCapture(e.pointerId);
                        engine.noteOn(black.midi);
                      }}
                      onPointerUp={() => engine.noteOff(black.midi)}
                      onPointerCancel={() => engine.noteOff(black.midi)}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </ModuleFrame>
  );
}
