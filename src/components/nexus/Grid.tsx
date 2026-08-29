import { useEffect, useRef, type PointerEvent } from "react";
import { COLS, ROWS } from "@/lib/nexus/types";
import { engine, useEngine } from "@/lib/nexus/use-engine";
import { ModuleFrame } from "./ModuleFrame";

const PHOSPHOR = "#7cff6b";

export function Grid() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heat = useRef<number[][]>(Array.from({ length: COLS }, () => Array.from({ length: ROWS }, () => 0)));
  const hover = useRef<{ c: number; r: number } | null>(null);
  const snap = useEngine();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = performance.now();
    let scale = 2;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      scale = Math.min(2.5, (window.devicePixelRatio || 1) * 1.25);
      canvas.width = Math.max(1, Math.floor(rect.width * scale));
      canvas.height = Math.max(1, Math.floor(rect.height * scale));
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = canvas.width / scale;
      const h = canvas.height / scale;
      if (w < 8 || h < 8) return;

      ctx.fillStyle = "#07090b";
      ctx.fillRect(0, 0, w, h);

      const pad = 12;
      const gw = (w - pad * 2) / COLS;
      const gh = (h - pad * 2) / ROWS;
      const play = engine.getPlayhead();
      const grid = engine.getSnapshot().grid;
      const playing = engine.getSnapshot().seq.playing;

      for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < ROWS; r++) {
          const on = Boolean(grid[c]?.[r]);
          const row = heat.current[c];
          if (!row) continue;
          const target = on ? 1 : 0;
          row[r] = (row[r] ?? 0) + (target - (row[r] ?? 0)) * Math.min(1, dt * 16);
          if (playing && c === play && on) row[r] = 1;
          const hv = hover.current?.c === c && hover.current?.r === r ? 0.4 : 0;
          const i = Math.min(1, (row[r] ?? 0) + hv);
          const x = pad + (c + 0.5) * gw;
          const y = pad + (ROWS - 1 - r + 0.5) * gh;
          const rad = Math.min(gw, gh) * 0.32;

          ctx.beginPath();
          ctx.fillStyle = "#10140f";
          ctx.arc(x, y, rad, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(124,255,107,0.18)";
          ctx.lineWidth = 1;
          ctx.stroke();

          if (i < 0.04) continue;
          ctx.save();
          ctx.shadowColor = PHOSPHOR;
          ctx.shadowBlur = 8 + i * 16;
          ctx.globalAlpha = 0.35 + i * 0.65;
          ctx.fillStyle = PHOSPHOR;
          ctx.beginPath();
          ctx.arc(x, y, rad * (0.55 + i * 0.2), 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.globalAlpha = i;
          ctx.fillStyle = "rgba(220,255,210,0.85)";
          ctx.beginPath();
          ctx.arc(x - rad * 0.12, y - rad * 0.14, rad * 0.22, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

          if (playing) {
            const x = pad + (play + 0.5) * gw;
            ctx.strokeStyle = "rgba(255,176,0,0.55)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, pad);
            ctx.lineTo(x, h - pad);
            ctx.stroke();
          }

          const analog = engine.getSnapshot().frontier;
          if (analog) {
            const a = engine.getAnalog();
            const x = pad + (a.col + 0.5) * gw;
            const y = pad + (ROWS - 1 - a.row + 0.5) * gh;
            const rad = Math.min(gw, gh) * 0.42;
            ctx.save();
            ctx.shadowColor = "#ffb000";
            ctx.shadowBlur = 16;
            ctx.strokeStyle = "#ffb000";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x, y, rad, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = "rgba(255,176,0,0.28)";
            ctx.fill();
            ctx.restore();
          }

      ctx.globalAlpha = 0.1;
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

  function cellAt(e: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const pad = 12;
    const gw = (rect.width - pad * 2) / COLS;
    const gh = (rect.height - pad * 2) / ROWS;
    const c = Math.floor((e.clientX - rect.left - pad) / gw);
    const rFromTop = Math.floor((e.clientY - rect.top - pad) / gh);
    const r = ROWS - 1 - rFromTop;
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
    return { c, r };
  }

  return (
    <ModuleFrame title="The Grid" serial="XY-16">
      <div className="flex h-full min-h-0 flex-col">
        <div className="relative min-h-40 w-full flex-1">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full rounded-sm bg-bg"
            style={{ touchAction: "none" }}
            onPointerDown={(e) => {
              const cell = cellAt(e);
              if (!cell) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              engine.toggleCell(cell.c, cell.r);
              if (engine.getSnapshot().powered) engine.triggerCell(cell.c, cell.r);
            }}
            onPointerMove={(e) => {
              const cell = cellAt(e);
              hover.current = cell;
              if (cell && engine.getSnapshot().powered) {
                engine.setGridXY(cell.c / (COLS - 1), cell.r / (ROWS - 1));
              }
              if ((e.buttons & 1) && cell) {
                const g = engine.getSnapshot().grid;
                if (!g[cell.c]?.[cell.r]) engine.toggleCell(cell.c, cell.r);
              }
            }}
            onPointerLeave={() => {
              hover.current = null;
            }}
          />
        </div>
        <p className="nx-label mt-2 text-center">
          {snap.seq.playing ? "scan" : "idle"} · {snap.seq.scale}
          {snap.frontier ? " · analog pen" : " · drag to write"}
        </p>
      </div>
    </ModuleFrame>
  );
}
