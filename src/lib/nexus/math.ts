export function midiToHz(m: number) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function euclid(hits: number, steps: number, rot: number): boolean[] {
  const n = Math.max(1, Math.min(32, Math.floor(steps)));
  const k = Math.max(0, Math.min(n, Math.floor(hits)));
  const pattern: boolean[] = Array.from({ length: n }, () => false);
  if (k === 0) return pattern;
  let bucket = 0;
  for (let i = 0; i < n; i++) {
    bucket += k;
    if (bucket >= n) {
      bucket -= n;
      pattern[i] = true;
    }
  }
  const r = ((rot % n) + n) % n;
  return pattern.slice(n - r).concat(pattern.slice(0, n - r));
}

export interface LorenzState {
  x: number;
  y: number;
  z: number;
}

export function seedLorenz(nudge = 0): LorenzState {
  return {
    x: 0.12 + nudge * 0.31,
    y: -0.08 + nudge * 0.17,
    z: 22 + (nudge % 1) * 6,
  };
}

/** Coefficient pots: σ fixed, ρ from chaos 0–1, β classic 8/3. */
export function analogCoefficients(chaos: number) {
  const c = Math.min(1, Math.max(0, chaos));
  return {
    sigma: 10,
    rho: 18 + c * 22,
    beta: 8 / 3,
  };
}

/** One integration tick of the Lorenz analog computer. `chaos` 0–1 maps ρ. */
export function lorenzStep(s: LorenzState, dt: number, chaos: number): LorenzState {
  const { sigma, rho, beta } = analogCoefficients(chaos);
  let { x, y, z } = s;
  const n = 4;
  const h = Math.max(0.0004, Math.min(0.08, dt)) / n;
  for (let i = 0; i < n; i++) {
    const dx = sigma * (y - x);
    const dy = x * (rho - z) - y;
    const dz = x * y - beta * z;
    x += dx * h;
    y += dy * h;
    z += dz * h;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return seedLorenz();
  return { x, y, z };
}

export function scaleLorenz(s: LorenzState) {
  return {
    x: Math.max(-1, Math.min(1, s.x / 24)),
    y: Math.max(-1, Math.min(1, s.y / 24)),
    z: Math.max(0, Math.min(1, s.z / 48)),
  };
}

export function analogCell(x: number, y: number, cols: number, rows: number) {
  const col = Math.round((x * 0.5 + 0.5) * (cols - 1));
  const row = Math.round((y * 0.5 + 0.5) * (rows - 1));
  return {
    col: Math.max(0, Math.min(cols - 1, col)),
    row: Math.max(0, Math.min(rows - 1, row)),
  };
}

export function funcGenStep(
  value: number,
  rising: boolean,
  dt: number,
  rise: number,
  fall: number,
): { value: number; rising: boolean } {
  const r = Math.max(0.02, rise);
  const f = Math.max(0.02, fall);
  let v = value;
  let up = rising;
  if (up) {
    v += dt / r;
    if (v >= 1) {
      v = 1;
      up = false;
    }
  } else {
    v -= dt / f;
    if (v <= 0) {
      v = 0;
      up = true;
    }
  }
  return { value: v, rising: up };
}
