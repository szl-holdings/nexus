import { useEffect, useRef, type RefObject } from "react";
import { engine, useEngine } from "@/lib/nexus/use-engine";
import { Knob } from "./Knob";
import { ModuleFrame } from "./ModuleFrame";

function Reel({ spinning, size = 72 }: { spinning: boolean; size?: number }) {
  return (
    <div
      className="nx-reel relative rounded-full"
      style={{
        width: size,
        height: size,
        background:
          "radial-gradient(circle at 50% 50%, #2a1a14 0 14px, #8b4a32 16px, #6b3a28 38%, #2a1a14 62%, #3a241c 78%, #1a100c 100%)",
        boxShadow: "inset 0 0 0 3px #1a100c, 0 4px 10px rgba(0,0,0,0.5)",
        animation: spinning ? "nxReel 2.4s linear infinite" : "none",
      }}
    >
      {Array.from({ length: 6 }, (_, i) => (
        <span
          key={i}
          className="absolute left-1/2 top-1/2 h-[38%] w-0.5 origin-top bg-oxide/80"
          style={{ transform: `translate(-50%,0) rotate(${i * 60}deg)` }}
        />
      ))}
      <span className="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-aluminum" />
    </div>
  );
}

export function TapeDeck() {
  const snap = useEngine();
  const t = snap.tape;
  const inRef = useRef<HTMLDivElement>(null);
  const outRef = useRef<HTMLDivElement>(null);
  const data = useRef(new Uint8Array(new ArrayBuffer(512)));

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const aIn = engine.getVuIn();
      const aOut = engine.getVuOut();
      const set = (el: HTMLDivElement | null, node: AnalyserNode | undefined) => {
        if (!el || !node) return;
        node.getByteTimeDomainData(data.current);
        let sum = 0;
        for (let i = 0; i < data.current.length; i++) {
          const v = ((data.current[i] ?? 128) - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.current.length);
        el.style.transform = `scaleY(${Math.min(1, rms * 4.2)})`;
      };
      set(inRef.current, aIn);
      set(outRef.current, aOut);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <ModuleFrame title="Tape Deck" serial="ECHO-3">
      <style>{`@keyframes nxReel { to { transform: rotate(360deg); } }`}</style>
      <div className="flex h-full flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <Reel spinning={t.motor} size={64} />
          <svg viewBox="0 0 120 64" className="h-12 flex-1 sm:h-16">
            <path
              d="M8 20 C 40 8, 80 8, 112 20"
              fill="none"
              stroke="#8b4a32"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <circle cx="28" cy="36" r="7" fill="#3a414c" stroke="#1a1f24" />
            <circle cx="92" cy="36" r="7" fill="#3a414c" stroke="#1a1f24" />
            <rect x="54" y="28" width="12" height="18" rx="2" fill="#2a3138" />
            <text x="60" y="58" textAnchor="middle" fill="#6e7868" fontSize="7" fontFamily="IBM Plex Mono">
              3-HEAD
            </text>
          </svg>
          <Reel spinning={t.motor} size={64} />
        </div>
        <div className="flex items-end gap-3">
          <Vu label="IN" barRef={inRef} />
          <Vu label="OUT" barRef={outRef} />
          <div className="flex flex-1 flex-wrap justify-end gap-1.5">
            <button
              type="button"
              className={`nx-btn min-h-11 px-3 py-2 ${t.motor ? "nx-btn-on" : ""}`}
              onClick={() => engine.setTape({ motor: !t.motor })}
            >
              Play
            </button>
            <button
              type="button"
              className="nx-btn min-h-11 px-3 py-2"
              onClick={() => engine.setTape({ motor: false, rec: false })}
            >
              Stop
            </button>
            <button
              type="button"
              className={`nx-btn nx-btn-rec min-h-11 px-3 py-2 ${t.rec ? "nx-btn-rec-on" : ""}`}
              onClick={() => engine.setTape({ rec: !t.rec, motor: true })}
            >
              Rec
            </button>
            <button
              type="button"
              className={`nx-btn min-h-11 px-3 py-2 ${snap.bouncing ? "nx-btn-on" : ""}`}
              onClick={() => engine.bounce(8)}
              disabled={snap.bouncing}
            >
              {snap.bouncing ? "Dump…" : "Bounce"}
            </button>
          </div>
        </div>
        <div className="nx-knobs">
          <Knob label="Time" value={t.time} min={0.05} max={1.4} onChange={(v) => engine.setTape({ time: v })} format={(v) => `${v.toFixed(2)}s`} />
          <Knob label="Feedback" value={t.feedback} min={0} max={0.92} onChange={(v) => engine.setTape({ feedback: v })} format={(v) => v.toFixed(2)} />
          <Knob label="Wow" value={t.wow} min={0} max={1} onChange={(v) => engine.setTape({ wow: v })} format={(v) => v.toFixed(2)} />
          <Knob label="Flutter" value={t.flutter} min={0} max={1} onChange={(v) => engine.setTape({ flutter: v })} format={(v) => v.toFixed(2)} />
          <Knob label="Mix" value={t.mix} min={0} max={1} onChange={(v) => engine.setTape({ mix: v })} format={(v) => v.toFixed(2)} />
          <Knob label="Drive" value={t.saturate} min={0} max={1} onChange={(v) => engine.setTape({ saturate: v })} format={(v) => v.toFixed(2)} />
        </div>
      </div>
    </ModuleFrame>
  );
}

function Vu({ label, barRef }: { label: string; barRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-16 w-2.5 overflow-hidden rounded-sm bg-bg">
        <div className="nx-vu absolute inset-0 origin-bottom" ref={barRef} style={{ transform: "scaleY(0.05)" }} />
      </div>
      <span className="nx-label">{label}</span>
    </div>
  );
}
