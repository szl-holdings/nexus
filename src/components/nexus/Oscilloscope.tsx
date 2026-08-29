import { useEffect, useRef } from "react";
import { engine } from "@/lib/nexus/use-engine";
import { ModuleFrame } from "./ModuleFrame";

export function Oscilloscope() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const time = new Uint8Array(2048);

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

      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(6,10,8,0.18)";
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = "rgba(124,255,107,0.12)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 8; i++) {
        const y = (h / 8) * i;
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
      ctx.strokeStyle = "rgba(124,255,107,0.22)";
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      const analyser = engine.getAnalyser();
      if (analyser) {
        const n = analyser.fftSize;
        if (time.length !== n) {
          /* keep */
        }
        const buf = time.subarray(0, n);
        analyser.getByteTimeDomainData(buf);
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
          const i1 = Math.min(n - 1, i0 + 1);
          const t = 0;
          const s0 = ((buf[i0] ?? 128) - 128) / 128;
          const s1 = ((buf[i1] ?? 128) - 128) / 128;
          const mu = 0.5 - 0.5 * Math.cos(t * Math.PI);
          const s = s0 * (1 - mu) + s1 * mu;
          const x = (i / (vis - 1)) * w;
          const y = h / 2 - s * (h * 0.42);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(210,255,200,0.45)";
        ctx.lineWidth = 0.6;
        ctx.stroke();
        ctx.restore();
      }

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

  return (
    <ModuleFrame title="Oscilloscope" serial="CRT-2A">
      <div className="relative flex h-full min-h-40 flex-col">
        <div className="relative min-h-40 w-full flex-1 overflow-hidden rounded-sm" style={{ background: "#07100c" }}>
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
          <div className="pointer-events-none absolute left-2 top-2 font-mono text-micro tracking-widest text-phosphor-dim">
            0.5 V/DIV · TRIG ↑
          </div>
        </div>
      </div>
    </ModuleFrame>
  );
}
