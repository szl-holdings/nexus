import { useEffect, useRef } from "react";
import type { ScopeMode } from "@/lib/nexus/types";
import { engine, useEngine } from "@/lib/nexus/use-engine";
import { ModuleFrame } from "./ModuleFrame";

const MODES: { id: ScopeMode; label: string }[] = [
  { id: "yt", label: "Y-T" },
  { id: "xy", label: "X-Y" },
  { id: "fft", label: "FFT" },
];

export function Oscilloscope() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snap = useEngine();
  const modeRef = useRef<ScopeMode>(snap.scopeMode);
  modeRef.current = snap.scopeMode;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const time: Bytes = new Uint8Array(new ArrayBuffer(2048));
    const freq: Bytes = new Uint8Array(new ArrayBuffer(1024));
    const left: Bytes = new Uint8Array(new ArrayBuffer(2048));
    const right: Bytes = new Uint8Array(new ArrayBuffer(2048));

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const scale = Math.min(2.5, (window.devicePixelRatio || 1) * 1.25);
      canvas.width = Math.max(1, Math.floor(rect.width * scale));
      canvas.height = Math.max(1, Math.floor(rect.height * scale));
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      (canvas as HTMLCanvasElement & { _nxScale?: number })._nxScale = scale;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const scale = (canvas as HTMLCanvasElement & { _nxScale?: number })._nxScale || 1;
      const w = canvas.width / scale;
      const h = canvas.height / scale;
      if (w < 8 || h < 8) return;
      const mode = modeRef.current;

      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = mode === "xy" ? "rgba(0,0,0,0.08)" : "rgba(0,0,0,0.12)";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(6,10,8,0.18)";
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = "rgba(124,255,107,0.12)";
      ctx.lineWidth = 1;
      const divs = mode === "xy" ? 8 : 8;
      for (let i = 0; i <= divs; i++) {
        const y = (h / divs) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      for (let i = 0; i <= 10; i++) {
        const x = (w / 10) * i;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      if (mode === "yt") drawYt(ctx, w, h, time);
      else if (mode === "xy") drawXy(ctx, w, h, left, right);
      else drawFft(ctx, w, h, freq);

      ctx.globalAlpha = 0.07;
      for (let y = 0; y < h; y += 3) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, y, w, 1);
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const caption =
    snap.scopeMode === "xy" ? "LISSAJOUS · L×R" : snap.scopeMode === "fft" ? "SPECTRUM · 0–8 kHz" : "0.5 V/DIV · TRIG ↑";

  return (
    <ModuleFrame title="Oscilloscope" serial="CRT-2A">
      <div className="relative flex h-full min-h-40 flex-col gap-2">
        <div className="flex gap-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`nx-btn min-h-9 px-3 ${snap.scopeMode === m.id ? "nx-btn-on" : ""}`}
              onClick={() => engine.setScopeMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="relative min-h-40 w-full flex-1 overflow-hidden rounded-sm" style={{ background: "#07100c" }}>
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
          <div className="pointer-events-none absolute left-2 top-2 font-mono text-micro tracking-widest text-phosphor-dim">
            {caption}
          </div>
        </div>
      </div>
    </ModuleFrame>
  );
}

type Bytes = Uint8Array<ArrayBuffer>;

function drawYt(ctx: CanvasRenderingContext2D, w: number, h: number, time: Bytes) {
  const analyser = engine.getAnalyser();
  if (!analyser) return;
  const n = analyser.fftSize;
  analyser.getByteTimeDomainData(time);
  const buf = time;
  let trigger = 0;
  const mid = 128;
  const hyst = 4;
  for (let i = 1; i < n * 0.6; i++) {
    const a = buf[i - 1] ?? 128;
    const b = buf[i] ?? 128;
    if (a < mid - hyst && b >= mid) {
      trigger = i;
      break;
    }
  }
  const vis = Math.floor(n * 0.45);
  ctx.save();
  ctx.shadowColor = "#7cff6b";
  ctx.shadowBlur = 8;
  ctx.strokeStyle = "#7cff6b";
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i < vis; i++) {
    const i0 = trigger + i;
    const s = ((buf[i0] ?? 128) - 128) / 128;
    const x = (i / (vis - 1)) * w;
    const y = h / 2 - s * (h * 0.42);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawXy(ctx: CanvasRenderingContext2D, w: number, h: number, left: Bytes, right: Bytes) {
  const aL = engine.getAnalyserL();
  const aR = engine.getAnalyserR();
  if (!aL || !aR) return;
  const n = Math.min(aL.fftSize, aR.fftSize);
  aL.getByteTimeDomainData(left);
  aR.getByteTimeDomainData(right);
  const bufL = left;
  const bufR = right;
  ctx.save();
  ctx.shadowColor = "#ffb000";
  ctx.shadowBlur = 6;
  ctx.strokeStyle = "#7cff6b";
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  const vis = Math.floor(n * 0.5);
  for (let i = 0; i < vis; i++) {
    const x = (((bufL[i] ?? 128) - 128) / 128) * (w * 0.42) + w / 2;
    const y = h / 2 - (((bufR[i] ?? 128) - 128) / 128) * (h * 0.42);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawFft(ctx: CanvasRenderingContext2D, w: number, h: number, freq: Bytes) {
  const analyser = engine.getAnalyser();
  if (!analyser) return;
  const n = analyser.frequencyBinCount;
  analyser.getByteFrequencyData(freq);
  const buf = freq;
  ctx.save();
  ctx.shadowColor = "#7cff6b";
  ctx.shadowBlur = 6;
  ctx.beginPath();
  const bins = Math.min(n, 256);
  for (let i = 1; i < bins; i++) {
    const mag = (buf[i] ?? 0) / 255;
    const x = (Math.log(i) / Math.log(bins)) * w;
    const y = h - mag * h * 0.88 - 4;
    if (i === 1) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "#7cff6b";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = "rgba(124,255,107,0.12)";
  ctx.fill();
  ctx.restore();
}
