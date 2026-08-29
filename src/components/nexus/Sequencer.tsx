import { useEffect, useRef, useState } from "react";
import { COLS } from "@/lib/nexus/types";
import { engine, useEngine } from "@/lib/nexus/use-engine";
import { Knob } from "./Knob";
import { ModuleFrame } from "./ModuleFrame";

export function Sequencer() {
  const snap = useEngine();
  const { seq, steps } = snap;
  const [play, setPlay] = useState(-1);

  useEffect(() => {
    let raf = 0;
    let last = -1;
    const tick = () => {
      const n = engine.getSnapshot().seq.playing ? engine.getPlayhead() : -1;
      if (n !== last) {
        last = n;
        setPlay(n);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <ModuleFrame title="Sequencer" serial="CLK-16">
      <div className="flex h-full flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`nx-btn min-h-11 px-3 py-2 ${seq.playing ? "nx-btn-on" : ""}`}
            onClick={() => engine.togglePlay()}
          >
            {seq.playing ? "Stop" : "Run"}
          </button>
          <button type="button" className="nx-btn min-h-11 px-3 py-2" onClick={() => engine.applyEuclid()}>
            Euclid
          </button>
          <button
            type="button"
            className={`nx-btn min-h-11 px-3 py-2 ${seq.arp ? "nx-btn-on" : ""}`}
            onClick={() => engine.setSeq({ arp: !seq.arp })}
          >
            Arp
          </button>
          <select
            className="nx-btn min-h-11 bg-panel px-2 py-2 text-fg"
            value={seq.scale}
            onChange={(e) => engine.setSeq({ scale: e.target.value as typeof seq.scale })}
          >
            <option value="penta">Penta</option>
            <option value="minor">Minor</option>
            <option value="chromatic">Chrom</option>
          </select>
          <span className={`nx-led ml-auto ${seq.playing ? "nx-led-on" : ""}`} />
        </div>
        <LoopReadout />
        <div className="grid grid-cols-8 gap-0.5 sm:gap-1">
          {steps.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => engine.setStep(i, { gate: !s.gate })}
              onContextMenu={(e) => {
                e.preventDefault();
                engine.setStep(i, { accent: !s.accent, note: (s.note + 1) % 8 });
              }}
              className={`relative min-h-10 rounded-sm border font-mono text-micro tabular-nums sm:min-h-11 ${
                s.gate
                  ? s.accent
                    ? "border-amber bg-amber text-bg"
                    : "border-phosphor bg-phosphor text-bg"
                  : "border-hairline bg-panel-hi text-muted"
              } ${i === play ? "ring-1 ring-amber" : ""}`}
            >
              {String(i + 1).padStart(2, "0")}
              {s.slide ? <span className="absolute right-0.5 top-0.5 h-1 w-2 bg-amber" /> : null}
            </button>
          ))}
        </div>
        <div className="nx-knobs">
          <Knob label="BPM" value={seq.bpm} min={48} max={200} step={1} onChange={(v) => engine.setSeq({ bpm: v })} format={(v) => `${Math.round(v)}`} />
          <Knob label="Swing" value={seq.swing} min={0} max={0.45} onChange={(v) => engine.setSeq({ swing: v })} format={(v) => v.toFixed(2)} />
          <Knob label="Hits" value={seq.euclidHits} min={1} max={16} step={1} onChange={(v) => engine.setSeq({ euclidHits: v })} format={(v) => `${Math.round(v)}`} />
          <Knob label="Steps" value={seq.euclidSteps} min={4} max={16} step={1} onChange={(v) => engine.setSeq({ euclidSteps: v })} format={(v) => `${Math.round(v)}`} />
          <Knob label="Rotate" value={seq.euclidRot} min={0} max={15} step={1} onChange={(v) => engine.setSeq({ euclidRot: v })} format={(v) => `${Math.round(v)}`} />
          <Knob label="Prob" value={seq.probability} min={0.1} max={1} onChange={(v) => engine.setSeq({ probability: v })} format={(v) => v.toFixed(2)} />
        </div>
        <p className="nx-label text-center">{COLS}-step · right-click accent/row · space to run · ouroboros 8</p>
      </div>
    </ModuleFrame>
  );
}

function LoopReadout() {
  const remainRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const k = engine.getKernel();
      if (remainRef.current) {
        remainRef.current.textContent = `Ouroboros ${k.loopSteps}/${k.maxSteps} · ${k.exit} · tax ${k.loopRemain.toFixed(2)}`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <p ref={remainRef} className="nx-label tabular-nums" />;
}
