# P14 Product Journey Implementation

Status: **ACTIVE — Movie Observation to Procurement active Run checkpoint frozen for independent P14 review.**

## Frozen resume baseline

- Branch: `codex/helix-p9`
- Last completed implementation commit: `e1db1a46 feat(helix): retry failed procurement preparation`
- Architecture SSOT remains unchanged.
- Retry implementation contract and focused recovery tests are complete, but
  `F02.17` remains `NOT_RUN`: the current Product journey has not yet naturally
  produced a formal `sealed failed|partial_failure` Procurement Run. Do not add
  Run admission/seal management routes or use internal Store evidence to claim
  that user Feature.

## Frozen Movie checkpoint

The user changed construction order to T-shaped, journey-first. The first
Movie checkpoint advances the formal public path from terminal Field
Observation to an active Procurement Run:

`Field/Observation → Eligibility → SelectedFieldMaterialSet →
Material Control acquire → Procurement Run Admission`.

The implementation is frozen for independent review. It has local focused
evidence for exact replay, crash/restart recovery and the disposable
`film-complete/movie-slice.mkv` sample. The source-boundary guard, focused P14
entrypoint suite (12/12), Procurement regression verifier, and full
architecture gate have all passed after the checkpoint implementation.

Checkpoint files:

- `media-service/src/helix/domains/procurement/application/procurement-automation-service.js`
- `media-service/src/helix/domains/procurement/application/admin-facade.js`
- `media-service/test/helix-architecture/p14-clean-service-entrypoint.test.js`
- `docs/helix/implementation/evidence/P14_BETA_IMPL_03_PRODUCT_SURFACE_CONSTRUCTION_MATRIX.md`

## Exact next step

Await P14 independent review of this checkpoint before continuing the Movie
journey. The next bounded construction segment is Evidence Assessment/Triage →
Candidate Package publication → Handoff A. Do not restore horizontal
Overview/Platform work. After the full Movie journey is independently accepted,
the required serial contrast order is Series → JAV → Western Adult; only then
may the Feature Matrix resume.

## Hard boundaries

- Preserve P14 disposable sample roots; never touch NAS or source samples.
- Service-only: no `media-worker`, `media-desktop`, Ollama, Python/FastAPI or
  historical face-service runtime.
- No SSOT edits, compatibility/dual path, hidden Store reads,
  latest/current scans, legacy fallback or cross-Owner writes.
- Do not claim Candidate, Libra, Arca, final Target, Series contrast, or Beta
  completion from the current WIP.
- Remain paused until an explicit resume instruction.
