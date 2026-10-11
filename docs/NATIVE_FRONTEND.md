# Native Nexus front door and workstation

The production Space entry is the TanStack/React workstation in `src/`, built by the existing `space/Dockerfile` into Nitro. The older `space/index.html` is not that Docker image’s playable entry. This change improves the actual source and leaves the central publication workflow, source middleware, auth flags, dependency graph, audio engine, analog/kernel mathematics, telemetry parser, persistence, and deterministic Python reference unchanged.

## Presentation and interaction

The front door introduces the six modules, browser-local audio, an explicitly illustrative signal study, and the existing research boundaries. KANCHAY supplies paper and graphite surfaces, readable roles, and restrained foil edges; the operational canvas retains its original phosphor/amber instrument vocabulary. The exact native Orbit icon is used at 40px with 10px clear space. It is never redrawn or filtered. The favicon uses the approved native 16px cut.

The instrument controls retain their existing engine calls. Native buttons now expose their toggle state. Global shortcuts leave buttons, links, inputs, selects, disclosure controls, sliders, editable text, and the help dialog to normal keyboard navigation; Escape still stops sound while a control is focused. Help uses a modal dialog and returns focus to its invoking control. Piano keys support Space/Enter and release on key-up, blur, cancellation, or pointer-capture loss. The grid has a native row/column editor. Knobs expose formatted values and their existing step, lower, and upper bounds through the keyboard.

The patchbay’s previous parent pointer-up handler cleared the selected source before a mouse destination click. Selection now lasts until connection or explicit cancellation. Ports remain above the cable drawing for reliable targeting, and every connection has a native removal button. MIDI requests occur only after the user chooses Connect MIDI; denied or unsupported access leaves the instrument usable. Audio startup failure has an explicit retry state.

The browser observations include source/unavailable recovery, 320–2560px layouts, both themes, module controls, local synthetic Web Audio engagement, actual grid/patch/knob/key changes, help focus, no-JavaScript recovery, reduced motion, forced colors, and print. Persistent fullscreen grain, scan, and flicker layers are removed; functional signal drawing remains.

## Native source and delivery

`scripts/native-assets.mjs` pins each installed file to its accepted `szl-brand` commit and SHA-256. `public/assets/szl/SOURCE.json` is the byte-exact complete upstream bundle record. The separate `PROJECTION.json` describes only this installed subset and its attribution. Both are source metadata; neither is a cryptographic product receipt or provider-publication record.

The existing Docker build copies `public/` and the complete application source. Vite/Nitro carries the five installed public files into `.output/public`; the existing asset-closure check requires all built application references. The native qualifier additionally checks each of the five literal served paths against its source bytes, with redirects rejected and bounded request timeouts. No manifest-derived network URL is followed.

```bash
# Verify the installed subset without fetching anything.
node scripts/native-assets.mjs

# Recreate exact projections from an existing canonical brand checkout.
node scripts/native-assets.mjs --project /absolute/path/to/szl-brand

# Use the existing app build in an environment without DATABASE_URL or auth credentials.
npm run build
node scripts/native-assets.mjs --built .output/public

# The qualifier starts/stops its own loopback Nitro process.
NEXUS_QA_OUT=/absolute/path/to/observations node scripts/qualify-native-frontend.mjs
```

The browser harness uses the repository’s locked Playwright package by default. `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` can select an already installed local test runtime. Output is written outside the checkout by default. The child server inherits only a narrow environment allowlist and an explicit local source fixture. Dirty source is labelled unbound; clean source records the exact candidate revision. Neither local state creates canonical publication authority.

## Evidence boundary

Build details are fetched only when the user opens or retries the source section. The reader accepts the expected schema, source owner, runtime kind, source-bound boolean, and non-placeholder Git revision; malformed, oversized, unavailable, or mismatched declarations remain UNAVAILABLE. The link is built from a fixed GitHub owner and validated revision. The interface calls this a runtime declaration and does not independently authenticate its signature or publication.

Source CI, accepted main, central provider publication, exact live readback, functional browser acceptance, and proof-site admission remain separate. Energy remains UNAVAILABLE and Conjecture 1 remains OPEN. CHECKED does not become Lean PROVEN. The separate `Native Frontend` workflow has contents-read permission, exact source checkout, no publisher or provider credential, and unsigned QA artifacts. Existing CI and publication controls remain in force.

The browser audit covers visible HTML text and the CSS gradient color envelope. It does not certify canvas glyph legibility, assistive-technology behavior across all tools, physical audio fidelity, external MIDI devices, provider probes, auth activation, or live readiness. Audio output is muted in the automated browser; provider-probe responses and MIDI denial are explicitly local fixtures. Remote and non-GET counters cover browser-context traffic, not Nitro-process sockets. No external database credentials or migrations are supplied; the unchanged runtime can initialize an in-memory PGlite fallback. The new browser workflow uses Node 24 and remains separate from the existing Docker Node 26 build contract.
