import { useCallback, useId, useRef, type PointerEvent } from "react";

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  unit?: string;
  format?: (v: number) => string;
  size?: number;
}

export function Knob({
  label,
  value,
  min,
  max,
  step = 0,
  onChange,
  unit = "",
  format,
  size = 56,
}: KnobProps) {
  const rawId = useId();
  const id = rawId.replace(/:/g, "");
  const start = useRef({ y: 0, v: 0 });
  const t = (value - min) / (max - min);
  const angle = -135 + t * 270;

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      start.current = { y: e.clientY, v: value };
    },
    [value],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
      const fine = e.shiftKey ? 0.15 : 1;
      const dy = (start.current.y - e.clientY) * fine;
      const range = max - min;
      let next = start.current.v + (dy / 110) * range;
      next = Math.min(max, Math.max(min, next));
      if (step > 0) next = Math.round(next / step) * step;
      onChange(next);
    },
    [max, min, onChange, step],
  );

  const readout = format ? format(value) : `${value.toFixed(value >= 100 ? 0 : 2)}${unit}`;

  return (
    <div className="flex w-[4.5rem] flex-col items-center gap-1">
      <div
        role="slider"
        aria-labelledby={id}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(value.toFixed(3))}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onDoubleClick={() => onChange((min + max) / 2)}
        onKeyDown={(e) => {
          const delta = (max - min) * (e.shiftKey ? 0.01 : 0.05);
          if (e.key === "ArrowUp" || e.key === "ArrowRight") {
            e.preventDefault();
            onChange(Math.min(max, value + delta));
          }
          if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
            e.preventDefault();
            onChange(Math.max(min, value - delta));
          }
        }}
        className="relative touch-none select-none"
        style={{ width: size, height: size }}
      >
        <svg viewBox="0 0 80 80" className="h-full w-full">
          <circle cx="40" cy="40" r="34" fill="#1a1f24" stroke="#3a414c" strokeWidth="2" />
          <circle cx="40" cy="40" r="28" fill={`url(#${id}face)`} stroke="#2a3138" strokeWidth="1" />
          {Array.from({ length: 11 }, (_, i) => {
            const a = ((-135 + i * 27) * Math.PI) / 180;
            const x1 = 40 + Math.cos(a) * 31;
            const y1 = 40 + Math.sin(a) * 31;
            const x2 = 40 + Math.cos(a) * 34.5;
            const y2 = 40 + Math.sin(a) * 34.5;
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={i === 0 || i === 10 ? "#7cff6b" : "#5c6570"}
                strokeWidth="1.2"
              />
            );
          })}
          <g transform={`rotate(${angle} 40 40)`}>
            <line x1="40" y1="40" x2="40" y2="16" stroke="#ffb000" strokeWidth="2.4" strokeLinecap="round" />
            <circle cx="40" cy="40" r="5" fill="#0a0c0e" stroke="#5c6570" />
          </g>
          <defs>
            <radialGradient id={`${id}face`} cx="35%" cy="30%">
              <stop offset="0%" stopColor="#6a7380" />
              <stop offset="55%" stopColor="#3a414c" />
              <stop offset="100%" stopColor="#1c222a" />
            </radialGradient>
          </defs>
        </svg>
      </div>
      <span className="font-mono text-micro tabular-nums text-amber">{readout}</span>
      <label id={id} className="nx-label text-center">
        {label}
      </label>
    </div>
  );
}
