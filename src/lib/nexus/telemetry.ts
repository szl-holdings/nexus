/** Hatun + anatomy probes. Honest LIVE / UNAVAILABLE. Never fabricate green. */

export type ProbeStatus = "LIVE" | "UNAVAILABLE";

export interface Probe {
  id: string;
  label: string;
  status: ProbeStatus;
  detail: string;
  at: number;
}

const ENDPOINTS: { id: string; label: string; url: string }[] = [
  { id: "hatun", label: "Hatun MCP", url: "https://szlholdings-hatun-mcp.hf.space/healthz" },
  { id: "anatomy", label: "Anatomy", url: "https://szlholdings-anatomy.hf.space/version" },
  { id: "nexus-space", label: "NEXUS Space", url: "https://huggingface.co/api/spaces/SZLHOLDINGS/nexus" },
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

export async function probeEstate(timeoutMs = 2800): Promise<Probe[]> {
  return Promise.all(ENDPOINTS.map((e) => probeOne(e, timeoutMs)));
}

async function probeOne(e: { id: string; label: string; url: string }, timeoutMs: number): Promise<Probe> {
  const at = Date.now();
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(e.url, { signal: ctrl.signal, mode: "cors" });
    window.clearTimeout(t);
    if (!res.ok) {
      return { id: e.id, label: e.label, status: "UNAVAILABLE", detail: `HTTP ${res.status}`, at };
    }
    let detail = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as Record<string, unknown>;
      if (typeof j.status === "string") detail = j.status;
      else if (typeof j.evidenceState === "string") detail = j.evidenceState;
      else if (typeof j.sdk === "string") detail = String(j.sdk);
    } catch {
      detail = `HTTP ${res.status}`;
    }
    return { id: e.id, label: e.label, status: "LIVE", detail, at };
  } catch (err) {
    window.clearTimeout(t);
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
