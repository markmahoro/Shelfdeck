# P14 Product Journey Implementation

Status: **ACTIVE — corrected Movie Libra Run checkpoint frozen for independent P14 review.**

## Frozen resume baseline

- Branch: `codex/helix-p9`
- Last independently accepted implementation baseline:
  `dcc2f2fd fix(helix): classify related movie nfo evidence`
- Rejected implementation checkpoint:
  `c1501957 feat(helix): admit movie libra run from formal routing`
- Corrected implementation checkpoint:
  `f0319035 fix(helix): persist movie decision identity evidence`
- Architecture SSOT remains unchanged.
- Retry implementation contract and focused recovery tests are complete, but
  `F02.17` remains `NOT_RUN`: the current Product journey has not yet naturally
  produced a formal `sealed failed|partial_failure` Procurement Run. Do not add
  Run admission/seal management routes or use internal Store evidence to claim
  that user Feature.

## Frozen Movie checkpoint

The user changed construction order to T-shaped, journey-first. The frozen
Movie checkpoint now advances the same formal public path through Libra
formation, stopping at an active Libra Run:

`Field/Observation → Eligibility → SelectedFieldMaterialSet →
Material Control acquire → Procurement Run Admission → Evidence
Assessment/Triage → immutable Candidate Package/Offer → Handoff A → Libra
Accepted Intake/Subject + Control transfer → Shelf Routing
Assessment/Decision → Decision Preparation/Basis → Acceptance Spec
publication → Libra Run Admission`.

The corrected implementation is frozen for independent review. The real public-HTTP
fixture creates and binds one active Movie Shelf, publishes the exact Field
routing policy, observes the disposable Movie plus its Related NFO, completes
Handoff A, resolves the first configured eligible Shelf, freezes Decision
Input/Basis facts, publishes one Acceptance Spec, and admits one active Libra
Run. Because the bound Beta Movie Profile declares `rating`, the Decision
Preparation path now always uses the formal User Perception public Facade. An
actual owner-authored `not_found(kind=rating)` Resolution selects the
Shelf Standard's `no_rating` branch; an empty Libra array or unavailable,
stale or integrity-failed query can no longer create Spec or Run.

Handoff A atomically conserves a Libra-owned
`DecisionIdentityEvidenceSnapshot@1` derived from the exact accepted
Candidate Package `identityClaim`. The frozen mapping
`libra.candidate-claim-title-anchor@1` applies NFKC, lowercase and whitespace
collapse to the accepted claim title and produces bounded weak title Evidence;
it never uses an opaque claim digest, current path or Provider guess. The
snapshot is bound to Intake Decision, Candidate Package revision/digest,
Candidate Delivery Snapshot digest and the exact Claim schema/id/digest, then
persisted on the existing `libra_intake_decisions` Owner row. Restart therefore
reconstructs the same Canonical Query Handle without rereading Procurement or
Foundation Result.

Perception reads its own immutable records, resolves `found(rating=1..5)` or
`not_found(kind=rating)`, and commits/reuses the versioned Resolution through
the existing owner-local commit participant. Libra records the exact
Perception Resolution and `VersionedQueryResult` in Decision Basis. A fault
after Perception commit but before Libra Basis leaves no Spec/Run; restart
reuses the same Resolution revision/result digest and creates exactly one
Basis, Spec and active Run.

Libra reads Arca only through the formal Shelf Routing Target and exact Shelf
Standard projections. Subject, policy, Decision head, Basis, Spec and Run
state remain in Libra Owner-local repositories and canonical transactions.
Exact replay across Clean Service restart returns the original active Run
without a second Routing Decision, Basis, Spec or Run. An inactive
higher-priority target yields the typed unresolved result and cannot fall
through to a lower-priority Shelf. Existing focused fixtures cover stale
Policy/Standard/Control fences, Decision/Spec/Run CAS, transaction rollback,
and restart recovery. Original Movie/NFO bytes and mtime remain unchanged.

The source-boundary guard, focused P3/P6/P8/P14 tests, and the full architecture
gate have passed. The frozen machine inventory remains 112 Capabilities, 97
Result families, 177 tables, 43 canonical transactions, 114 routes, and 18 UI
surfaces. The implementation contract aggregate is
`7ece7977c388f6a4230b236089889917618a45e977f91f2928d17bc95ee00b97`;
the generated DDL digest is
`4e16f31d07b8bc2f9678979ac1127eb8c6624477fe2ec347f1836a464b7ec13f`.
No Architecture SSOT change is included.

The ordinary `BETA-IMPL-03` Related NFO defect found by P14 is closed in the
accepted `dcc2f2fd` repair baseline. Triage now derives immutable Layout Evidence from
the exact Run basis, associates a same-directory/same-stem NFO (or the
unambiguous conventional `movie.nfo`) with its unique Movie primary, and emits
the existing canonical Related Material Reference. NFO files remain visible in
Field Observation and Run history, but are not probed as video, do not become a
second Primary Manifest member, and do not receive a Candidate Package binding
or Libra Product Material binding. Unrelated NFO evidence is ignored rather
than promoted to a Primary Candidate.

Focused evidence covers canonical association, unrelated/self-reference
negative cases, one-primary/one-related Candidate reconstruction, exact
restart replay, and unchanged source/NFO bytes and mtime. The full architecture
gate passes with the same inventory and contract digests.

Checkpoint files:

- `media-service/src/helix/domains/libra/application/movie-formation-coordinator.js`
- `media-service/src/helix/domains/arca/application/shelf-routing-target-projection.js`
- `media-service/src/helix/domains/libra/persistence/intake-acceptance-store.js`
- `media-service/src/helix/domains/libra/persistence/libra-intake-store.js`
- `media-service/src/helix/domains/procurement/application/procurement-automation-service.js`
- `media-service/src/helix/domains/procurement/application/admin-facade.js`
- `media-service/src/helix/domains/procurement/application/movie-run-coordinator.js`
- `media-service/src/helix/domains/procurement/model/triage-contracts.js`
- `media-service/src/helix/domains/libra/application/intake-acceptance-coordinator.js`
- `media-service/src/clean-media-probe.js`
- `media-service/test/helix-architecture/p14-clean-service-entrypoint.test.js`
- `media-service/test/helix-architecture/p7-triage-pipeline.test.js`
- `docs/helix/implementation/evidence/P14_BETA_IMPL_03_PRODUCT_SURFACE_CONSTRUCTION_MATRIX.md`

## Exact next step

Await P14 independent review of `f0319035`. On acceptance, the next Movie
blocker begins at formal Libra Workspace admission/production; it must not be
started from this frozen checkpoint. Do not restore horizontal
Overview/Platform work. After the full Movie journey is independently
accepted, the required serial contrast order is Series → JAV → Western Adult;
only then may the Feature Matrix resume.

## Hard boundaries

- Preserve P14 disposable sample roots; never touch NAS or source samples.
- Service-only: no `media-worker`, `media-desktop`, Ollama, Python/FastAPI or
  historical face-service runtime.
- No SSOT edits, compatibility/dual path, hidden Store reads,
  latest/current scans, legacy fallback or cross-Owner writes.
- Do not claim Workspace, production, Handoff B, Arca On-deck, final Target,
  Series contrast, or Beta completion from the current checkpoint.
- Do not continue this Movie stage until the independent P14 review returns.
