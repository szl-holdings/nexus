/** Hatun + anatomy probes. Honest LIVE / UNAVAILABLE. Never fabricate green. */

export type ProbeStatus = "LIVE" | "UNAVAILABLE";

export interface Probe {
  id: string;
  label: string;
  status: ProbeStatus;
  detail: string;
  at: number;
}

export const ENDPOINTS: { id: string; label: string; url: string }[] = [
  { id: "hatun", label: "Hatun MCP", url: "https://szlholdings-hatun-mcp.hf.space/healthz" },
  { id: "anatomy", label: "Anatomy", url: "https://szlholdings-anatomy.hf.space/version" },
  { id: "nexus-space", label: "NEXUS hologram", url: "https://szlholdings-nexus.hf.space/api/build-info" },
];

export function idleProbes(): Probe[] {
  return ENDPOINTS.map((e) => ({
    id: e.id,
    label: e.label,
    status: "UNAVAILABLE" as const,
    detail: "not probed",
    at: 0,
  }));
}

export function parseProbes(data: unknown): Probe[] | null {
  if (!Array.isArray(data)) return null;
  const out: Probe[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") return null;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.label !== "string") return null;
    if (r.status !== "LIVE" && r.status !== "UNAVAILABLE") return null;
    if (typeof r.detail !== "string") return null;
    out.push({
      id: r.id,
      label: r.label,
      status: r.status,
      detail: r.detail,
      at: typeof r.at === "number" ? r.at : 0,
    });
  }
  if (out.length !== ENDPOINTS.length) return null;
  if (!ENDPOINTS.every((e) => out.some((p) => p.id === e.id))) return null;
  return out;
}

export async function probeEstate(timeoutMs = 2800): Promise<Probe[]> {
  return Promise.all(ENDPOINTS.map((e) => probeOne(e, timeoutMs)));
}

async function probeOne(e: { id: string; label: string; url: string }, timeoutMs: number): Promise<Probe> {
  const at = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(e.url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) {
      return { id: e.id, label: e.label, status: "UNAVAILABLE", detail: `HTTP ${res.status}`, at };
    }
    let detail = `HTTP ${res.status}`;
    let live = true;
    try {
      const j = (await res.json()) as Record<string, unknown>;
      if (e.id === "nexus-space") {
        const role = typeof j.role === "string" ? j.role : "";
        const energy = typeof j.energy === "string" ? j.energy : "";
        live = role === "hologram-not-instrument" && energy === "UNAVAILABLE";
        detail = live ? "hologram-not-instrument" : "instrument not bound · hologram only";
      } else if (typeof j.status === "string") detail = j.status;
      else if (typeof j.evidenceState === "string") detail = j.evidenceState;
      else if (typeof j.sdk === "string") detail = String(j.sdk);
    } catch {
      detail = `HTTP ${res.status}`;
    }
    return { id: e.id, label: e.label, status: live ? "LIVE" : "UNAVAILABLE", detail, at };
  } catch (err) {
    clearTimeout(t);
    const reason = err instanceof Error ? err.name : "error";
    return {
      id: e.id,
      label: e.label,
      status: "UNAVAILABLE",
      detail: reason === "AbortError" ? "timeout" : "cors or unreachable",
      at,
    };
  }
}
