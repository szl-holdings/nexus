import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  DEST_PORTS,
  PORT_META,
  SOURCE_PORTS,
  type PortId,
} from "@/lib/nexus/types";
import { engine, useEngine } from "@/lib/nexus/use-engine";
import { ModuleFrame } from "./ModuleFrame";

const COLORS = ["#7cff6b", "#ffb000", "#6ec8ff", "#e07ad3", "#f07167", "#c8d0be"];

export function Patchbay() {
  const snap = useEngine();
  const rootRef = useRef<HTMLDivElement>(null);
  const jackRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [drag, setDrag] = useState<{ from: PortId; x: number; y: number } | null>(null);
  const [pts, setPts] = useState<Record<string, { x: number; y: number }>>({});
  const [size, setSize] = useState({ w: 100, h: 100 });

  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const br = root.getBoundingClientRect();
    setSize({ w: br.width, h: br.height });
    const next: Record<string, { x: number; y: number }> = {};
    for (const id of [...SOURCE_PORTS, ...DEST_PORTS]) {
      const el = jackRefs.current[id];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      next[id] = { x: r.left + r.width / 2 - br.left, y: r.top + r.height / 2 - br.top };
    }
    setPts(next);
  }, []);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (rootRef.current) ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, [measure, snap.patches.length]);

  const cables = useMemo(() => {
    return snap.patches
      .map((p, i) => {
        const a = pts[p.from];
        const b = pts[p.to];
        if (!a || !b) return null;
        const sag = Math.max(18, Math.abs(b.x - a.x) * 0.28 + 12);
        const d = `M ${a.x} ${a.y} C ${a.x} ${a.y + sag}, ${b.x} ${b.y + sag}, ${b.x} ${b.y}`;
        return { p, d, color: COLORS[i % COLORS.length]! };
      })
      .filter(Boolean) as { p: (typeof snap.patches)[number]; d: string; color: string }[];
  }, [pts, snap.patches]);

  function onJack(id: PortId, kind: "src" | "dst") {
    if (!drag) {
      if (kind === "src") {
        const root = rootRef.current;
        const el = jackRefs.current[id];
        if (!root || !el) return;
        const br = root.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        setDrag({ from: id, x: r.left + r.width / 2 - br.left, y: r.top + r.height / 2 - br.top });
      }
      return;
    }
    if (kind === "dst") {
      engine.addPatch(drag.from, id);
      setDrag(null);
      return;
    }
    setDrag({ from: id, x: drag.x, y: drag.y });
  }

  return (
    <ModuleFrame title="Patchbay" serial="PB-24">
      <div
        ref={rootRef}
        className="relative min-h-48 sm:h-full"
        onPointerMove={(e) => {
          if (!drag || !rootRef.current) return;
          const br = rootRef.current.getBoundingClientRect();
          setDrag({ ...drag, x: e.clientX - br.left, y: e.clientY - br.top });
        }}
        onPointerUp={() => setDrag(null)}
      >
        <div className="flex flex-col gap-6 px-2 pt-2">
          <JackRow ids={SOURCE_PORTS} kind="src" jackRefs={jackRefs} onJack={onJack} hot={drag?.from} />
          <JackRow ids={DEST_PORTS} kind="dst" jackRefs={jackRefs} onJack={onJack} hot={undefined} />
        </div>
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${size.w} ${size.h}`}>
          {cables.map(({ p, d, color }) => (
            <path
              key={p.id}
              d={d}
              className="nx-cable pointer-events-auto"
              stroke={color}
              strokeDasharray="10 8"
              onClick={() => engine.removePatch(p.id)}
            />
          ))}
          {drag && pts[drag.from] ? (
            <path
              d={`M ${pts[drag.from]!.x} ${pts[drag.from]!.y} C ${pts[drag.from]!.x} ${pts[drag.from]!.y + 40}, ${drag.x} ${drag.y + 40}, ${drag.x} ${drag.y}`}
              fill="none"
              stroke="#ffb000"
              strokeWidth="2"
              strokeDasharray="6 6"
            />
          ) : null}
        </svg>
        <p className="nx-label mt-3 text-center">drag source → dest · click cable to pull</p>
      </div>
    </ModuleFrame>
  );
}

function JackRow({
  ids,
  kind,
  jackRefs,
  onJack,
  hot,
}: {
  ids: PortId[];
  kind: "src" | "dst";
  jackRefs: MutableRefObject<Record<string, HTMLButtonElement | null>>;
  onJack: (id: PortId, kind: "src" | "dst") => void;
  hot?: PortId;
}) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          ref={(el) => {
            jackRefs.current[id] = el;
          }}
          className="flex flex-col items-center gap-1"
          onClick={() => onJack(id, kind)}
        >
          <span className={`nx-jack ${hot === id ? "nx-jack-hot" : ""}`} />
          <span className="nx-label">{PORT_META[id].label}</span>
        </button>
      ))}
    </div>
  );
}
