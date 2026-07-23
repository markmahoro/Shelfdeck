# P14 Product Journey Implementation

Status: **PAUSED by user on 2026-07-23**.

## Frozen resume baseline

- Branch: `codex/helix-p9`
- Last completed implementation commit: `e1db1a46 feat(helix): retry failed procurement preparation`
- Architecture SSOT remains unchanged.
- Retry implementation contract and focused recovery tests are complete, but
  `F02.17` remains `NOT_RUN`: the current Product journey has not yet naturally
  produced a formal `sealed failed|partial_failure` Procurement Run. Do not add
  Run admission/seal management routes or use internal Store evidence to claim
  that user Feature.

## Paused WIP

The user changed construction order to T-shaped, journey-first. Uncommitted
Movie automation WIP currently advances the formal public path from terminal
Field Observation to an active Procurement Run:

`Field/Observation → Eligibility → SelectedFieldMaterialSet →
Material Control acquire → Procurement Run Admission`.

This WIP has local focused evidence for exact replay, crash/restart recovery and
the disposable `film-complete/movie-slice.mkv` sample, but it is **not a frozen
or accepted checkpoint**. A source-boundary guard was added after the last
completed test run and has not yet been rerun.

Uncommitted WIP files to preserve exactly:

- `media-service/src/helix/domains/procurement/application/procurement-automation-service.js`
- `media-service/src/helix/domains/procurement/application/admin-facade.js`
- `media-service/test/helix-architecture/p14-clean-service-entrypoint.test.js`
- `docs/helix/implementation/evidence/P14_BETA_IMPL_03_PRODUCT_SURFACE_CONSTRUCTION_MATRIX.md`

## Exact next step on resume

1. Review the preserved diff; do not reset, stash, clean or reconstruct it.
2. Run the focused P14 entrypoint test after the newly added source guard, then
   the allowed Procurement/full architecture regressions.
3. Correct ordinary implementation failures without changing Architecture
   SSOT or Owner/Handoff boundaries.
4. Only after all evidence passes, freeze and submit the
   Observation-to-Procurement-Run checkpoint.
5. Continue the Movie journey at the next blocker:
   Evidence Assessment/Triage → Candidate Package publication → Handoff A.

## Hard boundaries

- Preserve P14 disposable sample roots; never touch NAS or source samples.
- Service-only: no `media-worker`, `media-desktop`, Ollama, Python/FastAPI or
  historical face-service runtime.
- No SSOT edits, compatibility/dual path, hidden Store reads,
  latest/current scans, legacy fallback or cross-Owner writes.
- Do not claim Candidate, Libra, Arca, final Target, Series contrast, or Beta
  completion from the current WIP.
- Remain paused until an explicit resume instruction.
