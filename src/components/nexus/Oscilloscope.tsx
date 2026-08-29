import { useEffect, useRef } from "react";
import type { ScopeMode } from "@/lib/nexus/types";
import { engine, useEngine } from "@/lib/nexus/use-engine";
import { ModuleFrame } from "./ModuleFrame";

const MODES: { id: ScopeMode; label: string }[] = [
  { id: "yt", label: "Y-T" },
  { id: "xy", label: "X-Y" },
  { id: "fft", label: "FFT" },
  { id: "holo", label: "Holo" },
];

const ORGAN_DRAW: { id: "brain" | "heart" | "circulatory" | "nervous" | "skeleton"; q: string }[] = [
  { id: "brain", q: "YACHAY" },
  { id: "heart", q: "YUYAY" },
  { id: "circulatory", q: "YAWAR" },
  { id: "nervous", q: "OTel" },
  { id: "skeleton", q: "KHIPU" },
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
      const persist = mode === "xy" || mode === "holo";

      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = persist ? "rgba(0,0,0,0.08)" : "rgba(0,0,0,0.12)";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(6,10,8,0.18)";
      ctx.fillRect(0, 0, w, h);

      if (mode !== "holo") {
        ctx.strokeStyle = "rgba(124,255,107,0.12)";
        ctx.lineWidth = 1;
        const divs = 8;
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
      }

      if (mode === "yt") drawYt(ctx, w, h, time);
      else if (mode === "xy") {
        if (engine.getSnapshot().frontier) drawAnalogXy(ctx, w, h);
        else drawXy(ctx, w, h, left, right);
      } else if (mode === "holo") drawHolo(ctx, w, h);
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
    snap.scopeMode === "holo"
      ? "HOLO"
      : snap.scopeMode === "xy"
        ? snap.frontier
          ? `LORENZ · X×Y · ${(snap.analog.mode ?? "op").toUpperCase()}`
          : "LISSAJOUS · L×R"
        : snap.scopeMode === "fft"
          ? "SPECTRUM · 0–8 kHz"
          : "0.5 V/DIV · TRIG ↑";

  return (
    <ModuleFrame title="Oscilloscope" serial={snap.scopeMode === "holo" ? "HOLO-3" : "CRT-2A"}>
      <div className="relative flex h-full min-h-40 flex-col gap-2">
        <div className="flex flex-wrap gap-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`nx-btn min-h-11 px-3 ${snap.scopeMode === m.id ? "nx-btn-on" : ""}`}
              onClick={() => engine.setScopeMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="relative min-h-40 w-full flex-1 overflow-hidden rounded-sm bg-[#07100c]">
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
          <HoloCaption live={snap.scopeMode === "holo"} fallback={caption} />
        </div>
      </div>
    </ModuleFrame>
  );
}

type Bytes = Uint8Array<ArrayBuffer>;

function HoloCaption({ live, fallback }: { live: boolean; fallback: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!live) {
      if (ref.current) ref.current.textContent = fallback;
      return;
    }
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const k = engine.getKernel();
      if (ref.current) {
        ref.current.textContent = `HOLO · Λw ${k.lambda.toFixed(3)} · Λs ${k.lambdaSym.toFixed(3)} · Λe ${k.lambdaEgy.toFixed(3)} · max ${k.maxAgg.toFixed(3)}${k.disagree ? " · DISAGREE" : ""} · C1 OPEN`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, fallback]);
  return (
    <div ref={ref} className="pointer-events-none absolute left-2 top-2 font-mono text-micro tracking-widest text-phosphor-dim">
      {fallback}
    </div>
  );
}

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

function drawAnalogXy(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const trail = engine.getAnalogTrail();
  const a = engine.getAnalog();
  if (trail.len < 2) return;
  const cx = w / 2;
  const cy = h / 2;
  const sx = w * 0.42;
  const sy = h * 0.42;
  const stride = trail.stride;
  ctx.save();
  ctx.shadowColor = "#7cff6b";
  ctx.shadowBlur = 8;
  ctx.strokeStyle = "#7cff6b";
  ctx.lineWidth = 1.35;
  ctx.lineJoin = "round";
  ctx.beginPath();
  const cap = trail.cap;
  const start = (trail.write - trail.len + cap) % cap;
  for (let i = 0; i < trail.len; i++) {
    const idx = (start + i) % cap;
    const x = cx + (trail.data[idx * stride] ?? 0) * sx;
    const y = cy - (trail.data[idx * stride + 1] ?? 0) * sy;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.shadowColor = "#ffb000";
  ctx.shadowBlur = 14;
  ctx.fillStyle = "#ffb000";
  ctx.beginPath();
  ctx.arc(cx + a.x * sx, cy - a.y * sy, 3.2, 0, Math.PI * 2);
  ctx.fill();
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

function drawHolo(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const trail = engine.getAnalogTrail();
  const a = engine.getAnalog();
  const k = engine.getKernel();
  const reduce =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const t = reduce ? 0.9 : (typeof performance !== "undefined" ? performance.now() : 0) * 0.00028;
  const yaw = t;
  const pitch = 0.42;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const project = (x: number, y: number, z: number) => {
    const rx = x * cy - z * sy;
    const rz = x * sy + z * cy;
    const ry = y * cp - rz * sp;
    const rz2 = y * sp + rz * cp;
    const persp = 2.15 / (2.15 + rz2 + 1.35);
    return {
      x: w / 2 + rx * persp * w * 0.26,
      y: h / 2 - ry * persp * h * 0.26,
      s: persp,
      d: rz2,
    };
  };

  ctx.save();
  ctx.strokeStyle = "rgba(124,255,107,0.1)";
  ctx.lineWidth = 1;
  for (let r = 0.18; r <= 0.72; r += 0.18) {
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const ang = (i / 48) * Math.PI * 2;
      const p = project(Math.cos(ang) * r, 0, Math.sin(ang) * r);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  const stride = trail.stride;
  const cap = trail.cap;
  const start = (trail.write - trail.len + cap) % cap;
  if (trail.len > 2) {
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i < trail.len; i++) {
      const idx = (start + i) % cap;
      const x = trail.data[idx * stride] ?? 0;
      const y = trail.data[idx * stride + 1] ?? 0;
      const z = (trail.data[idx * stride + 2] ?? 0) * 2 - 1;
      const p = project(x, y, z);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.shadowColor = "#7cff6b";
    ctx.shadowBlur = 10;
    ctx.strokeStyle = "rgba(124,255,107,0.92)";
    ctx.lineWidth = 1.35;
    ctx.stroke();
  }

  const beam = project(a.x, a.y, a.z * 2 - 1);
  ctx.shadowColor = "#ffb000";
  ctx.shadowBlur = 16;
  ctx.fillStyle = "#ffb000";
  ctx.beginPath();
  ctx.arc(beam.x, beam.y, 3.4 * beam.s, 0, Math.PI * 2);
  ctx.fill();

  const R = 0.58;
  const nodes = ORGAN_DRAW.map((o, i) => {
    const ang = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    const p = project(Math.cos(ang) * R, Math.sin(ang) * 0.12, Math.sin(ang) * R);
    const organ = k.organs.find((g) => g.id === o.id);
    return { ...o, p, live: organ?.status !== "DOWN", metric: organ?.metric ?? 0 };
  });

  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,176,0,0.28)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  nodes.forEach((n, i) => {
    if (i === 0) ctx.moveTo(n.p.x, n.p.y);
    else ctx.lineTo(n.p.x, n.p.y);
  });
  ctx.closePath();
  ctx.stroke();

  const heart = project(0, 0, 0);
  const base = Math.min(w, h) * 0.28;
  const rings: { v: number; color: string; dash: number[]; width: number }[] = [
    { v: k.maxAgg, color: "rgba(255,176,0,0.28)", dash: [3, 3], width: 1 },
    { v: k.lambdaEgy, color: "rgba(255,176,0,0.45)", dash: [], width: 1 },
    { v: k.lambdaSym, color: "rgba(124,255,107,0.28)", dash: [], width: 1 },
    { v: k.lambda, color: k.blocked ? "rgba(196,74,56,0.45)" : "rgba(124,255,107,0.55)", dash: [], width: 1.2 },
  ];
  for (const r of rings) {
    ctx.beginPath();
    ctx.setLineDash(r.dash);
    ctx.strokeStyle = r.color;
    ctx.lineWidth = r.width;
    ctx.arc(heart.x, heart.y, base * (0.78 + r.v * 0.14), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = k.blocked ? "rgba(196,74,56,0.7)" : "rgba(255,176,0,0.75)";
  ctx.font = "8px 'IBM Plex Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillText("WILLAY", heart.x, heart.y + 14);
  ctx.fillStyle = k.blocked ? "#c44a38" : k.disagree ? "#ffb000" : "#7cff6b";
  ctx.font = "9px 'IBM Plex Mono', monospace";
  ctx.fillText(k.disagree ? "DISAGREE" : `Λ ${k.lambda.toFixed(3)}`, heart.x, heart.y + 3);

  for (const n of nodes) {
    const rad = 5.5 * n.p.s * (n.live ? 1 : 0.7);
    ctx.shadowColor = n.live ? "#7cff6b" : "#c44a38";
    ctx.shadowBlur = n.live ? 12 : 4;
    ctx.fillStyle = n.live ? "#7cff6b" : "#c44a38";
    ctx.beginPath();
    ctx.arc(n.p.x, n.p.y, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = n.live ? "#7cff6b" : "#c44a38";
    ctx.font = "8px 'IBM Plex Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(n.q, n.p.x, n.p.y - 10);
  }

  ctx.restore();
}
