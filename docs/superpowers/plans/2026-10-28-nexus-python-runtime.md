<!-- SPDX-License-Identifier: Apache-2.0 -->
# NEXUS Space Python Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the NEXUS Space from a Python-only runtime image: a static build of the existing browser workstation plus a stdlib Python server that reproduces `/api/build-info`, `/healthz`, `/health` and `/api/probes` exactly.

**Architecture:** `space/Dockerfile` builds the browser app with Node in a builder stage only; the runtime stage is `python:3.12-slim` running `space/app_server.py` (stdlib `ThreadingHTTPServer`), which serves the static files with SPA fallback and delegates the API paths to pure functions in `space/nexus_runtime.py`. TS↔Python parity is enforced by a Node test that runs both implementations on the same inputs.

**Tech Stack:** Python 3.12 stdlib (`http.server`, `urllib.request`, `concurrent.futures`, `json`), pytest 9.1.1 for Python unit tests, Node 22/24 `node:test` with `--experimental-strip-types` for parity, Vite 8 + `@tanstack/react-start` ^1.169.4 for the static build, Playwright (preinstalled) for the browser check.

**Spec:** `docs/superpowers/specs/2026-10-28-nexus-python-runtime-design.md`

## Global Constraints

- Runtime image has no Node and no pip installs: `FROM python:3.12-slim@sha256:<pinned digest>`; non-root user; port 7860.
- Exactly one `COPY … SOURCE_GITHUB_SHA /app/SOURCE_GITHUB_SHA` line in `space/Dockerfile` (central publisher requirement).
- New runtime label: `PYTHON_STDLIB_STATIC_WEB_AUDIO` (replaces `NITRO_NODE_WEB_AUDIO` everywhere). Schema strings unchanged: `szl.nexus-source-binding/v2`, `szl.nexus-runtime-health/v1`.
- JSON bodies byte-identical to the TS `JSON.stringify` output: compact separators, insertion order, `ensure_ascii=False`.
- API JSON headers: `content-type: application/json; charset=utf-8`, `cache-control: no-store`, `x-content-type-options: nosniff`.
- Probe semantics copied exactly from `src/lib/nexus/telemetry.ts`, including: a 2xx body that is not JSON stays `LIVE` with detail `HTTP <status>` (owner-protected; do not change).
- No CI gate is removed or loosened; gates that pinned the Node runtime now pin the Python runtime with the same specificity.
- New Python files carry `# SPDX-License-Identifier: Apache-2.0`; stdlib only in `space/`.

## Review Focus

- **HEAD requests** (health checkers and CDNs send them): respond like GET without a body, not 405 — test in Task 4.
- **Query strings on API paths** (`/healthz?probe=1`): matched on path only, like the TS `url.pathname` — test in Task 4.
- **Trailing slash** (`/api/build-info/`): not an API match in TS (falls through to the app), so Python serves `index.html` — test in Task 4.
- **Slow probes must not block health:** `/healthz` answers while `/api/probes` waits on a 2.8 s timeout — test in Task 4.
- **`SOURCE_GITHUB_SHA` with trailing newline / CRLF / upper-case:** normalized exactly like TS (`trim().toLowerCase()`) — test in Task 2 parity cases.

---

### Task 1: Static build of the browser workstation

**Files:**
- Modify: `vite.config.ts` (the `tanstackStart()` / `nitro()` plugin block, ~lines 160–180)
- Modify: `package.json` (add script `build:static`)
- Create: `scripts/static-build-contract.test.mjs`

**Interfaces:**
- Produces: `npm run build:static` → writes a static site to `.output/public/` containing `index.html` and hashed files under `assets/`. Env switch `NEXUS_BUILD_TARGET=static`. Later tasks rely on the path `.output/public`.

- [ ] **Step 1: Write the failing test** `scripts/static-build-contract.test.mjs`: test `"static build target is wired"` asserts `package.json` has `scripts["build:static"]` containing `NEXUS_BUILD_TARGET=static` and `verify-built-asset-closure.mjs`, and `vite.config.ts` contains `process.env.NEXUS_BUILD_TARGET === "static"`.
- [ ] **Step 2: Run** `node --test scripts/static-build-contract.test.mjs` → FAIL.
- [ ] **Step 3: Implement.** When `NEXUS_BUILD_TARGET === "static"`, call `tanstackStart({ spa: { enabled: true } })` and use Nitro preset `static` (output `.output/public`); otherwise leave the current plugin configuration byte-for-byte unchanged. `build:static` = `NEXUS_BUILD_TARGET=static node scripts/with-app-env.mjs vite build && node scripts/verify-built-asset-closure.mjs` (no `db:migrate`). If SPA mode fails to build or render, try the Nitro `static` preset with the root route prerendered; if neither works, STOP and report (spec risk 1).
- [ ] **Step 4: Run** `node --test scripts/static-build-contract.test.mjs` → PASS; run `npm run build:static` → exit 0 and `.output/public/index.html` exists; serve it with `python3 -m http.server -d .output/public 8099` and run `node scripts/space-browser-smoke.mjs http://127.0.0.1:8099/` from Task 6 once that exists — for now open it with Playwright inline: page loads, no `console.error`, body contains the workstation root element (`[data-testid="nexus-workstation"]` or the root rendered by `src/routes/index.tsx`; record the selector you used in the commit message).
- [ ] **Step 5: Run** `npm run build` (Node path) → still exit 0 (unchanged default build).
- [ ] **Step 6: Commit** `build(space): add a static SPA build target for the workstation`.

### Task 2: Runtime label and Python build-info/health port

**Files:**
- Create: `space/nexus_runtime.py`, `space/tests/conftest.py`, `space/tests/test_nexus_runtime.py`, `scripts/space-runtime-parity.test.mjs`
- Modify: `src/lib/nexus/source-identity.ts` (runtime value), `src/lib/nexus/source-identity.test.ts` (lines ~39, ~58), `src/components/nexus/NativeShell.tsx:219`, `.github/workflows/ci.yml:208`, `.github/workflows/hf-deploy.yml` (required fragment `'NITRO_NODE_WEB_AUDIO'`), `scripts/nexus-space-contract.test.mjs:71`

**Interfaces:**
- Produces in `space/nexus_runtime.py`:
  - `UNAVAILABLE = "UNAVAILABLE"`, `RUNTIME = "PYTHON_STDLIB_STATIC_WEB_AUDIO"`
  - `normalize_source_revision(raw: object) -> str`
  - `read_source_revision(path: str | os.PathLike) -> str` (file read error → `"UNAVAILABLE"`)
  - `build_info(raw_revision: object) -> dict` (12 keys, TS order)
  - `runtime_health(raw_revision: object) -> dict` (16 keys, TS order)
  - `dumps(payload: object) -> bytes` (`json.dumps(..., separators=(",", ":"), ensure_ascii=False).encode()`)
  - CLI: `python3 space/nexus_runtime.py build-info <rev-string>` / `health <rev-string>` prints `dumps(...)` to stdout.

- [ ] **Step 1: Write failing tests.** `space/tests/test_nexus_runtime.py`: `test_valid_revision_is_bound` (40-hex → `source_bound` True, `status` "ok", `ready` True), `test_placeholders_are_unavailable` for `""`, `None`, `"0"*40`, `"abc"`, 41-hex → `"UNAVAILABLE"`, `test_revision_is_trimmed_and_lowercased` for `" ABCDEF…(40) \r\n"`, `test_key_order` (exact key lists from spec), `test_runtime_label` == `"PYTHON_STDLIB_STATIC_WEB_AUDIO"`, `test_missing_file_reads_unavailable`. `scripts/space-runtime-parity.test.mjs`: for each revision input above (as strings), `JSON.stringify(buildInfo(x))` and `JSON.stringify(runtimeHealth(x))` from `src/lib/nexus/source-identity.ts` equal the stdout of `python3 space/nexus_runtime.py build-info x` / `health x` byte-for-byte.
- [ ] **Step 2: Run** `python3 -m pytest -q space/tests` and `node --experimental-strip-types --test scripts/space-runtime-parity.test.mjs` → FAIL.
- [ ] **Step 3: Implement** `space/nexus_runtime.py` per Interfaces; change the TS `runtime` value to `PYTHON_STDLIB_STATIC_WEB_AUDIO` and update every listed reader to the new string (no other edits to those checks).
- [ ] **Step 4: Run** both commands → PASS; `npm test` → only expected changes pass; `grep -rn NITRO_NODE_WEB_AUDIO .` → no hits outside git history.
- [ ] **Step 5: Commit** `feat(space): port build-info and health to Python and relabel the runtime`.

### Task 3: Probe port with exact semantics

**Files:**
- Modify: `space/nexus_runtime.py`, `space/tests/test_nexus_runtime.py`, `scripts/space-runtime-parity.test.mjs`

**Interfaces:**
- Consumes: `dumps` from Task 2.
- Produces: `ENDPOINTS: list[dict[str, str]]` (same 3 entries, same order as TS), `probe_estate(timeout_s: float = 2.8, endpoints: list[dict[str, str]] | None = None, now_ms: Callable[[], int] = …) -> list[dict]` returning `{id,label,status,detail,at}` per endpoint in input order, fetched concurrently (`ThreadPoolExecutor`, one worker per endpoint, `urllib.request.urlopen(url, timeout=timeout_s)`); CLI `python3 space/nexus_runtime.py probes '<endpoints-json>'`.

- [ ] **Step 1: Write failing tests.** pytest cases against a local `http.server` fixture: 200 `{"status":"ok"}` → LIVE/"ok"; 200 `{"evidenceState":"X"}` → LIVE/"X"; 200 `{"sdk":"docker"}` → LIVE/"docker"; 200 non-JSON → **LIVE/"HTTP 200"**; 404 → UNAVAILABLE/"HTTP 404"; 500 → UNAVAILABLE/"HTTP 500"; handler sleeping 0.5 s with `timeout_s=0.2` → UNAVAILABLE/"timeout"; closed port → UNAVAILABLE/"cors or unreachable"; `nexus-space` id with `{"role":"hologram-not-instrument","energy":"UNAVAILABLE"}` → LIVE/"hologram-not-instrument", with `{}` → UNAVAILABLE/"instrument not bound · hologram only". Parity test: start one Node mock server serving all those cases, set TS `ENDPOINTS[i].url` to mock URLs, compare `JSON.stringify(await probeEstate(t))` with the Python CLI output after replacing every `"at":<n>` with `"at":0`.
- [ ] **Step 2: Run** both suites → FAIL.
- [ ] **Step 3: Implement** `probe_estate`. Map exceptions: `socket.timeout`/`TimeoutError` (including when wrapped in `URLError.reason`) → `"timeout"`; any other exception → `"cors or unreachable"`; `HTTPError` → `"HTTP <code>"`.
- [ ] **Step 4: Run** both suites → PASS.
- [ ] **Step 5: Commit** `feat(space): port the estate probes to Python with identical semantics`.

### Task 4: Python application server

**Files:**
- Create: `space/app_server.py`, `space/tests/test_app_server.py`

**Interfaces:**
- Consumes: `read_source_revision`, `build_info`, `runtime_health`, `probe_estate`, `dumps` (Tasks 2–3).
- Produces: `make_server(host: str, port: int, static_dir: Path, source_file: Path) -> ThreadingHTTPServer`; `main()` reads `HOST` (default `0.0.0.0`), `PORT` (default `7860`), `NEXUS_STATIC_DIR` (default `/app/static`), `SOURCE_GITHUB_SHA_FILE` (default `/app/SOURCE_GITHUB_SHA`).

- [ ] **Step 1: Write failing tests** (server on port 0 in a thread, temp static dir with `index.html` and `assets/app-abc123.js`): `/api/build-info` and `/healthz` and `/health` bodies equal `dumps(build_info(...))` / `dumps(runtime_health(...))` with the three API headers; `/healthz?x=1` same as `/healthz`; `/api/build-info/` → `index.html`; `/` and `/some/client/route` → `index.html` with `cache-control: no-cache`; `/assets/app-abc123.js` → JS MIME and `cache-control: public, max-age=31536000, immutable`; `/assets/missing.js` → 404; `/../etc/passwd` and `/%2e%2e/etc/passwd` → 404 and never outside `static_dir`; `POST /healthz` → 405; `HEAD /healthz` → 200, same headers, empty body; every response has `x-content-type-options: nosniff`; `/api/probes` with a monkeypatched slow `probe_estate` (sleep 1 s) does not delay a concurrent `/healthz` beyond 0.3 s.
- [ ] **Step 2: Run** `python3 -m pytest -q space/tests/test_app_server.py` → FAIL.
- [ ] **Step 3: Implement** `space/app_server.py` per Interfaces (`mimetypes` for types; resolve paths with `Path.resolve()` and require `is_relative_to(static_dir)`). Before finalizing headers, try `curl -sSI https://szlholdings-nexus.hf.space/` and `…/healthz`: if reachable, add any security header the Nitro runtime sends today (e.g. `content-security-policy`, `referrer-policy`, `x-frame-options`) with the same value, plus a test; if unreachable from this environment, record "live header comparison NOT RUN".
- [ ] **Step 4: Run** `python3 -m pytest -q space/tests` → PASS.
- [ ] **Step 5: Commit** `feat(space): serve the static workstation and runtime API from Python`.

### Task 5: Python-only Space image and gates

**Files:**
- Modify: `space/Dockerfile`, `scripts/nexus-space-contract.test.mjs` (lines ~24–30, 63, 72), `.github/workflows/hf-deploy.yml` (required fragments for COPY and CMD), `.github/workflows/ci.yml` (container smoke ~lines 160–210)

**Interfaces:**
- Consumes: `npm run build:static` → `.output/public` (Task 1); `space/app_server.py` (Task 4).
- Produces: runtime stage `CMD ["python", "-I", "-B", "/app/app_server.py"]`; binding line `COPY --chown=nexus:nexus SOURCE_GITHUB_SHA /app/SOURCE_GITHUB_SHA`.

- [ ] **Step 1: Update the contract test first** so it requires the new runtime: builder stage still `FROM node:26-bookworm-slim@sha256:[0-9a-f]{64} AS builder`; runtime `FROM python:3.12-slim@sha256:[0-9a-f]{64}`; `CMD ["python", "-I", "-B", "/app/app_server.py"]` present and `CMD ["node"` absent (inverse of today's guard); binding line exactly once; no `RUN pip`; `HEALTHCHECK` uses `python`. Update the `hf-deploy.yml` required fragments and the ci.yml container smoke to the new CMD/binding/runtime label.
- [ ] **Step 2: Run** `node --test scripts/nexus-space-contract.test.mjs` → FAIL (Dockerfile not changed yet).
- [ ] **Step 3: Rewrite `space/Dockerfile`:** builder unchanged except `RUN npm run build:static`; runtime stage from `python:3.12-slim` pinned by digest (resolve with `docker buildx imagetools inspect python:3.12-slim` or the registry API; record digest), `useradd --system nexus`, copy `.output/public` → `/app/static`, `space/app_server.py`, `space/nexus_runtime.py`, the single `SOURCE_GITHUB_SHA` binding, `LICENSE`; `ENV HOST=0.0.0.0 PORT=7860 NEXUS_STATIC_DIR=/app/static PYTHONDONTWRITEBYTECODE=1`; `HEALTHCHECK … CMD python -c` fetching `/healthz` and exiting 0 only if `ready` is true; `USER nexus`; `EXPOSE 7860`.
- [ ] **Step 4: Run** `node --test scripts/nexus-space-contract.test.mjs` → PASS; run the hf-deploy inline Python check locally (copy the `python - <<'PY'` block from the workflow) → `PASS`; `docker build -f space/Dockerfile -t nexus-py .` and smoke `/`, `/healthz` (`ready` false without a real SHA is expected; with `echo <40-hex> > SOURCE_GITHUB_SHA` before build, `ready` true), `/api/build-info`, `/api/probes` → exit 0. If the Docker daemon is unavailable here, record "container build NOT RUN locally; CI ci.yml container job is the check".
- [ ] **Step 5: Commit** `build(space): run the Space on a Python-only runtime image`.

### Task 6: Browser acceptance and full verification

**Files:**
- Create: `scripts/space-browser-smoke.mjs` (executable script, not part of `npm test`)

**Interfaces:**
- Consumes: `.output/public` and `space/app_server.py`.
- Produces: `node scripts/space-browser-smoke.mjs <base-url>` exits 0 when the page loads with no `console.error`/`pageerror`, the workstation root selector from Task 1 is visible, and after a click on the power/start control an `AudioContext` reports `state === "running"` (Chromium flag `--autoplay-policy=no-user-gesture-required` not used; the click is the gesture).

- [ ] **Step 1: Write the script**, then **run** it against `python3 space/app_server.py` (with `NEXUS_STATIC_DIR=.output/public SOURCE_GITHUB_SHA_FILE=<tmp file>`) → exit 0.
- [ ] **Step 2: Full verification:** `npm test`, `npm run typecheck`, `npm run lint`, `python3 -m pytest -q` at repo root, `python3 server.py --selftest`, `python3 source_bound_server.py --selftest` → all pass (record counts; compare with main: no previously passing test fails).
- [ ] **Step 3: Commit** `test(space): add a browser smoke check for the Python-served workstation`.
- [ ] **Step 4: Stop.** Prepare the draft-PR body (What / Receipts / Checklist, listing the protected gate edits explicitly) and hand back for the owner's ticked approval to push. Do not push.
