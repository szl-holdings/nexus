export const SOURCE_REPOSITORY = "szl-holdings/nexus" as const;
export const HF_REPOSITORY = "SZLHOLDINGS/nexus" as const;
export const DEPLOYMENT_AUTHORITY =
  "szl-holdings/.github/.github/workflows/publish-nexus-space.yml" as const;
export const UNAVAILABLE = "UNAVAILABLE" as const;

const EXACT_GIT_REVISION = /^[0-9a-f]{40}$/;
const ZERO_REVISION = /^0{40}$/;

/** Normalize one immutable Git revision without ever accepting placeholders. */
export function normalizeSourceRevision(raw: unknown): string {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!EXACT_GIT_REVISION.test(value) || ZERO_REVISION.test(value)) return UNAVAILABLE;
  return value;
}

export function buildInfo(rawRevision: unknown) {
  const sourceRevision = normalizeSourceRevision(rawRevision);
  return {
    schema: "szl.nexus-source-binding/v2",
    source_repository: SOURCE_REPOSITORY,
    source_revision: sourceRevision,
    hf_repository: HF_REPOSITORY,
    deployment_authority: DEPLOYMENT_AUTHORITY,
    source_bound: sourceRevision !== UNAVAILABLE,
    runtime: "NITRO_NODE_WEB_AUDIO",
    frontend: "REACT_TANSTACK_WEB_AUDIO",
    audio_execution: "BROWSER_LOCAL_USER_GESTURE",
    deterministic_python_reference: "SOURCE_ONLY",
    energy: UNAVAILABLE,
    uniqueness: "Conjecture 1",
  } as const;
}

export function runtimeHealth(rawRevision: unknown) {
  const info = buildInfo(rawRevision);
  return {
    schema: "szl.nexus-runtime-health/v1",
    ok: true,
    status: info.source_bound ? "ok" : "degraded",
    ready: info.source_bound,
    service: "nexus",
    source_repository: info.source_repository,
    source_revision: info.source_revision,
    source_bound: info.source_bound,
    runtime: info.runtime,
    frontend: info.frontend,
    audio: "USER_GESTURE_REQUIRED",
    state_storage: "BROWSER_INDEXEDDB",
    accounts_required: false,
    external_effectors: false,
    energy: info.energy,
    uniqueness: info.uniqueness,
  } as const;
}
