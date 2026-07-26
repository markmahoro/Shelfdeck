# P14 Product Journey Implementation

Status: **ACTIVE — Movie Handoff A checkpoint frozen for independent P14 review.**

## Frozen resume baseline

- Branch: `codex/helix-p9`
- Last accepted implementation baseline: `be239499 feat(helix): admit movie procurement runs from observation`
- Architecture SSOT remains unchanged.
- Retry implementation contract and focused recovery tests are complete, but
  `F02.17` remains `NOT_RUN`: the current Product journey has not yet naturally
  produced a formal `sealed failed|partial_failure` Procurement Run. Do not add
  Run admission/seal management routes or use internal Store evidence to claim
  that user Feature.

## Frozen Movie checkpoint

The user changed construction order to T-shaped, journey-first. The frozen
Movie checkpoint advances the same formal public path from terminal Field
Observation through Procurement triage and Handoff A:

`Field/Observation → Eligibility → SelectedFieldMaterialSet →
Material Control acquire → Procurement Run Admission → Evidence
Assessment/Triage → immutable Candidate Package/Offer → Handoff A → Libra
Accepted Intake/Subject + Control transfer`.

The implementation is frozen for independent review. A real public-HTTP run
on the disposable `film-complete/movie-slice.mkv` sample publishes one
immutable Candidate Package and Offer, completes Handoff A, records Libra
Accepted Intake and one Subject, and transfers the exact Material Control to
that Libra Subject. Both durable Delivery rows and both Inbox receipts reach
their terminal acknowledged state. Exact replay across Clean Service restart
returns the original typed result without a second Candidate, Offer, Subject,
or Control mutation. A disposable transaction-fault fixture leaves the
Candidate/Offer open with Control still in Procurement; restart then resumes
the same Offer and completes the single Handoff A. Source bytes and mtime stay
unchanged in all cases.

The source-boundary guard, focused P7/P8/P14 tests, and the full architecture
gate have passed. The frozen machine inventory remains 112 Capabilities, 97
Result families, 177 tables, 43 canonical transactions, 114 routes, and 18 UI
surfaces; no Architecture SSOT change is included.

Checkpoint files:

- `media-service/src/helix/domains/procurement/application/procurement-automation-service.js`
- `media-service/src/helix/domains/procurement/application/admin-facade.js`
- `media-service/src/helix/domains/procurement/application/movie-run-coordinator.js`
- `media-service/src/helix/domains/libra/application/intake-acceptance-coordinator.js`
- `media-service/src/clean-media-probe.js`
- `media-service/test/helix-architecture/p14-clean-service-entrypoint.test.js`
- `docs/helix/implementation/evidence/P14_BETA_IMPL_03_PRODUCT_SURFACE_CONSTRUCTION_MATRIX.md`

## Exact next step

Await P14 independent review of this checkpoint before continuing the Movie
journey. Do not enter Libra Routing or Acceptance Spec yet, and do not restore
horizontal Overview/Platform work. After the full Movie journey is independently
accepted, the required serial contrast order is Series → JAV → Western Adult;
only then may the Feature Matrix resume.

## Hard boundaries

- Preserve P14 disposable sample roots; never touch NAS or source samples.
- Service-only: no `media-worker`, `media-desktop`, Ollama, Python/FastAPI or
  historical face-service runtime.
- No SSOT edits, compatibility/dual path, hidden Store reads,
  latest/current scans, legacy fallback or cross-Owner writes.
- Do not claim Libra Routing, Acceptance Spec, Arca, final Target, Series
  contrast, or Beta completion from the current checkpoint.
- Do not continue this Movie stage until the independent P14 review returns.
