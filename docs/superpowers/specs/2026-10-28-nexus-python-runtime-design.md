<!-- SPDX-License-Identifier: Apache-2.0 -->
# NEXUS Space runtime: Node SSR → static build + stdlib Python server

Date: 2026-10-28 · Status: design approved by owner in chat ("do what you recommend" on all sections);
protected gate edits and every push/deploy still require a ticked owner action at the time they happen.

## Intent

Owner direction: "Python backends, keep browser UIs." The canonical Space `SZLHOLDINGS/nexus` currently
runs Node in production (`space/Dockerfile` runtime stage: `node .output/server/index.mjs`, a Nitro
`node-server` build of the TanStack Start app). Node does two jobs there: serving the browser
workstation, and answering three read-only endpoints. This pilot removes Node from the runtime image,
keeps the React/Web Audio workstation byte-for-byte as the browser app, and proves the port pattern
(identical behaviour, parity tests, CI gate update, central publication) on a small, unprotected-runtime
surface before larger ports.

Success = the Space serves the same workstation and the same endpoint JSON from a Python-only runtime
image; the central publisher's smoke (`/`, `/healthz`, `/api/build-info`) and source readback pass; no
check is loosened.

## Current behaviour to preserve (source of truth at main 5c5802e)

| Path | Implemented in | Behaviour |
|---|---|---|
| `/api/build-info` (GET) | `server/middleware/nexus-runtime.ts` → `buildInfo()` in `src/lib/nexus/source-identity.ts` | JSON object, 12 keys in fixed order; `source_revision` = trimmed, lower-cased contents of `SOURCE_GITHUB_SHA` if it is 40 hex and not all zeros, else `"UNAVAILABLE"`; file read failure → `"UNAVAILABLE"` |
| `/health`, `/healthz` (GET) | same → `runtimeHealth()` | JSON object, 16 keys in fixed order; `ready` = `source_bound`; `status` `ok`/`degraded`; HTTP 200 either way |
| `/api/probes` (GET) | `src/routes/api/probes.ts` → `probeEstate(2800)` in `src/lib/nexus/telemetry.ts` | JSON array of 3 probes `{id,label,status,detail,at}` fetched in parallel with a 2.8 s abort per probe; non-2xx → `UNAVAILABLE`/`HTTP n`; abort → `UNAVAILABLE`/`timeout`; other error → `UNAVAILABLE`/`cors or unreachable`; for `nexus-space` LIVE only if `role=="hologram-not-instrument"` and `energy=="UNAVAILABLE"`; for others `detail` from `status`/`evidenceState`/`sdk`; **if a 2xx body is not JSON, status stays LIVE with detail `HTTP n` (existing quirk, preserved unchanged — changing LIVE semantics is owner-only)** |
| everything else (GET) | Nitro SSR of the TanStack app | serves the workstation |

JSON helper headers on the two middleware routes: `content-type: application/json; charset=utf-8`,
`cache-control: no-store`, `x-content-type-options: nosniff`. Non-GET requests on those paths fall through.

## Design

### Build stage (Node, build-time only)
`space/Dockerfile` keeps a `node:26-bookworm-slim@sha256:…` builder that runs `npm ci` and builds the
browser app as a static SPA (TanStack Start SPA mode; output: `index.html` shell + hashed assets).
Using JS to build a browser UI is within the owner's rule. The existing `verify-built-asset-closure.mjs`
check runs against the static output. `db:migrate` is not part of the Space build (no database in the
runtime; the auth/db scaffold is unreachable from production routes and stays out of this pilot).

### Runtime stage (Python only)
`FROM python:3.12-slim@sha256:…` (pinned digest), non-root user, port 7860, no pip installs.
Copies: the static output, `space/app_server.py`, `space/nexus_runtime.py`, `SOURCE_GITHUB_SHA` (exactly
one `COPY … SOURCE_GITHUB_SHA /app/SOURCE_GITHUB_SHA` line, as the central publisher requires), `LICENSE`.
`HEALTHCHECK` uses `python -c` against `/healthz` and requires `ready == true` (same rule as today).
`CMD ["python", "-I", "-B", "/app/app_server.py"]`.

### Components
- `space/nexus_runtime.py` — pure functions, no I/O except the probe fetches: `normalize_source_revision`,
  `build_info`, `runtime_health`, `probe_estate(timeout_s=2.8, fetch=…)` (injectable fetch for tests),
  and `dumps()` producing compact JSON identical to `JSON.stringify` for these payloads
  (`separators=(",", ":")`, `ensure_ascii=False`, insertion-ordered dicts).
- `space/app_server.py` — `ThreadingHTTPServer` on `0.0.0.0:7860`. GET only (others → 405). Routes the
  three API paths to `nexus_runtime`; serves files from the static directory with correct MIME types,
  `Cache-Control: public, max-age=31536000, immutable` for hashed `/assets/*`, `no-cache` for
  `index.html`; unknown non-asset paths → `index.html` (SPA fallback); path traversal rejected;
  `X-Content-Type-Options: nosniff` on every response.

### Label and gate changes (protected — owner tick required before push)
`runtime` in `buildInfo`/`runtimeHealth` changes from `NITRO_NODE_WEB_AUDIO` to
`PYTHON_STDLIB_STATIC_WEB_AUDIO`, in both the TS source (used by the browser and tests) and the Python
port, because leaving the old value would make `/api/build-info` misreport the runtime. Schema strings
stay `szl.nexus-source-binding/v2` and `szl.nexus-runtime-health/v1`. Every reader is inside this repo
(MEASURED by grep across the estate clones; 20 private repos not readable): `.github/workflows/ci.yml`,
`.github/workflows/hf-deploy.yml`, `scripts/nexus-space-contract.test.mjs`, `source_bound_server.py`,
`src/components/nexus/NativeShell.tsx`, `src/lib/nexus/source-identity.test.ts`. Their required strings
change from the Node runtime (`CMD ["node", ".output/server/index.mjs"]`,
`COPY --chown=node:node SOURCE_GITHUB_SHA …`, `NITRO_NODE_WEB_AUDIO`) to the Python runtime equivalents.
No check is removed or weakened; each still pins the exact runtime command, binding line and label.

### Risks
- **Static build of the TanStack Start app (UNVERIFIED).** The repo pins `@tanstack/react-start` ^1.169.4
  with `nitro` 3.0.260610-beta. The plan's first task proves a client-only build (`tanstackStart({ spa: {
  enabled: true } })`) renders the workstation; fallback is Nitro's `static` preset with the root route
  prerendered. If neither yields a working workstation, the pilot stops and reports rather than
  shipping a degraded UI.
- **Response header drift.** Nitro may add headers today that the Python server does not; the plan
  records the current live headers on `/` (if reachable from the build environment) and matches the
  security-relevant ones.

### Out of scope
Fixing the probe invalid-JSON quirk (owner decision); the auth/db scaffold (retire later, separate PR);
`server.py` hologram (unchanged); the acoustic importer follow-ups from the #74 review.

## Testing and acceptance
1. **Parity:** `tests/test_nexus_runtime_parity.py` runs the TS functions (via `node --experimental-strip-types`)
   and the Python functions on the same inputs and compares JSON bytes: revisions (valid, upper-case,
   whitespace, zeros, short, missing file); probes against a local mock HTTP server covering 200 JSON,
   200 non-JSON, 404, 500, slow (> 2.8 s), connection refused, nexus-space role/energy variants
   (`at` masked).
2. **Server:** unit tests for routing, 405, SPA fallback, MIME, cache headers, traversal rejection.
3. **Browser:** headless Chromium (preinstalled Playwright) loads the SPA from `app_server.py`: no console
   errors, workstation renders, AudioContext starts after a user gesture.
4. **Container:** `docker build -f space/Dockerfile` (if Docker is available here; otherwise stated NOT RUN)
   then smoke `/`, `/healthz`, `/api/build-info`, `/api/probes`.
5. **Repo checks:** `npm test`, typecheck, lint, Python tests, the updated contract/workflow checks.

## Rollout
Draft PR on `claude/nexus-python-runtime-20261028` → owner tick for push/PR including the protected
gate edits → CI green → owner tick for merge → central publisher (`szl-holdings/.github`
`publish-nexus-space.yml`) deploys; its smoke and source readback are the live acceptance → owner sees the
live readback. Rollback: revert the merge commit; the publisher redeploys the Node runtime.
