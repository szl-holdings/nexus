# NEXUS repository agent contract

This file governs automated work in `szl-holdings/nexus`. It replaces the generic App Builder sandbox instructions that were originally copied into this repository.

## Authority and scope

- GitHub `szl-holdings/nexus` is the source owner for NEXUS code, documentation, Docker projection inputs, and source-binding logic.
- Public product/runtime authority: IMMUNE Channel A at `/nexus.html`.
- `SZLHOLDINGS/nexus` is a provider projection target owned by the central SZL publication workflow. It is not the public product Space and may be private or unavailable to unauthenticated Hub readers.
- `a11oy.net` is proof/evaluation authority only after separately admitted evidence exists. Do not infer proof-site publication from source changes.

## Change discipline

1. Read the current default-branch revision and complete relevant files before editing.
2. Search for overlapping open pull requests before writing. Use one writer per overlapping path.
3. Work on an isolated branch or the already appropriate pull request. Never force-push protected/shared branches.
4. Make the smallest durable repair and add or extend regression coverage when a defect can recur.
5. Preserve failed histories and existing evidence. Do not rewrite receipts, measurements, hashes, or historical failures to make a gate green.
6. Re-read the exact candidate head, base, checks, review threads, and applicable release controls before admission.

## Publication and runtime boundaries

- Do not publish directly to Hugging Face from this repository or add local provider credentials/secrets.
- Provider writes for `SZLHOLDINGS/nexus` are centrally owned by `szl-holdings/.github/.github/workflows/publish-nexus-space.yml`.
- Preserve `space/Dockerfile`, `SOURCE_GITHUB_SHA`, `source_bound_server.py`, and the central exact-source/readback contract unless a reviewed change explicitly replaces that mechanism.
- Source CI, provider publication, live runtime readback, browser acceptance, and proof/evaluation publication are distinct gates. Do not collapse them into one status.
- A source change is not evidence that IMMUNE, Hugging Face, `a-11-oy.com`, or `a11oy.net` has updated.

## Evidence and claims

- Keep Energy `UNAVAILABLE` unless measured evidence is admitted.
- Keep Λ / Conjecture 1 limitations explicit; do not promote an open conjecture into a proved result.
- Keep `CHECKED` distinct from `Lean PROVEN` and from runtime qualification.
- Separate simulations, fixtures, and local self-tests from measured production evidence.
- Do not claim hardware, model, deployment, or product-runtime state that this repository does not establish.
- Preserve citations and third-party attribution. Do not copy external code or text without compatible rights and attribution.

## Security and dependencies

- Never add credentials, tokens, private device data, or secrets to source, tests, logs, issues, or artifacts.
- Do not weaken security scanners, source-binding checks, hash/integrity checks, or fail-closed behavior to make CI pass.
- Dependency changes must use the actual package-manager graph and lockfiles. Do not invent integrity hashes or dependency edges.
- Major dependency/runtime migrations require separate qualification rather than opportunistic bundling with unrelated work.

## Local development

Use the repository's checked-in commands and manifests. Do not assume a platform-specific sandbox, hosted preview contract, Vercel deployment, a preinstalled dependency set, AI-provider credentials, or access to external user data. Do not start paid services or make quota-consuming AI calls merely because credentials happen to be present in an execution environment.

Typical source development remains:

```bash
npm install
npm run dev
```

Run only the tests/builds needed for the change plus the repository's normal hosted checks. Do not describe a local process as a deployed runtime.

## Solo-maintainer provenance

Stephen Lutar is the first-party solo maintainer. Do not fabricate DCO, signatures, or independent approval. For Stephen's own first-party changes, absent DCO or an impossible second-human review is not by itself a blocker unless a live external-contributor agreement, license, or immutable platform rule genuinely requires it. This does not waive substantive CI, security, source-integrity, merge-queue, publication, or runtime safeguards.
