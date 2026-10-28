# Nexus/Immune seam: acoustic importer (PROPOSAL, FIXTURE_ONLY)

Status: **PROPOSAL, not ratified.** Merged 2026-10-28 as an unratified proposal; reconcile with ACOUSTIC_IMPORT_CONTRACT.md before any admission decision.

`ACOUSTIC_IMPORT_CONTRACT.md` was not found in any ref of `szl-holdings/nexus`
or `szl-holdings/immune` (searched 2026-10-28 UTC). This importer is therefore
built against the owner constraints in the 2026-10-28 recovery handoff, not
against the original contract. Reconcile it with that contract before any
admission decision.

What it does:

- accepts arithmetic `synthetic` source material only; anything else is refused;
- refuses physical units, because calibration is MISSING;
- rejects malformed, non-finite, out-of-range and future-dated input, and
  schema, revision or pinned-source mismatches;
- checks the custody digest chain;
- records rights `UNKNOWN` or `RESTRICTED` (or no stated basis) but never admits it;
- marks every admitted record `FIXTURE_ONLY` with `physicalAnalysisEligible: false`.

It is stdlib only, reads no clock, network or file, and is not imported by the
Space image (the Dockerfiles use explicit `COPY` sources).

Evidence boundary: the tests use generated sine tables only. A pass is
`FIXTURE_ONLY` evidence about admission logic. It is not a recording, a
calibration, apparatus proof or a scientific claim.

Run the tests:

```bash
python -m pytest -q experiments/nexus-immune-seam/tests
```
