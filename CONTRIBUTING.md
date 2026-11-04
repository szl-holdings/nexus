# Contributing

**Control before action. Evidence after.** Three doctrine rules govern every
contribution to this repository:

1. **Control before action.** State the invariant first — a failing test, a
   policy check, or a written assertion — then change behavior. No silent
   refactors of governed surfaces.
2. **Evidence after.** Every change updates its receipts: CI output, test
   runs, screenshots, audit artifacts. If something was not measured, say
   UNKNOWN — UNKNOWN is never claimed as PASS.
3. **Canonical surfaces only.** Product lives at a-11-oy.com, proof lives at
   a11oy.net. The legacy lookalike domain is forbidden and must never appear
   in code, docs, config, or fixtures; the `forbidden-domain` CI gate is
   release-blocking.

## Branch model

- Branch from the default branch as `szl/<change>` —
  e.g. `szl/fix-receipt-ordering`, `szl/alignment-v14`.
- One concern per branch; keep diffs reviewable.
- Never push to the default branch — every change lands via pull request.

## Commits

- [Conventional Commits](https://www.conventionalcommits.org):
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:` …
- Sign off every commit (`git commit -s`): the `Signed-off-by:` trailer
  certifies you have the right to submit the change (DCO style).

## Pull requests

- Fill in the PR template checklist — every box is a control or a receipt.
- CI must be green, including the forbidden-domain gate.
- If the change alters a governed surface, attach the receipt that proves it.
