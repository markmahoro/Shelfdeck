# ShelfDeck v3 Current Status

Last updated: 2026-08-28

## Production

- Current release goal: `Helix Beta` NAS packaging authorized; apply not started
- Authoritative Helix status: `docs/helix/CURRENT_STATUS.md`
- Deployment candidate: local clean `main@bdafe186974e3fe4467f8b4c483f96bf578f9dce`
- Kairox status: `Kairox Beta achieved`; Kairox release line is closed
- Production URL: `http://192.168.12.230:18080`
- Latest deployed image: `markmahoro/shelfdeck:helix-beta-20260828-a3e07a1e1`
- Latest deployed commit: `a3e07a1e1`
- Latest deployed image SHA256: `a97718db4207355e5a9dab72956c36057603881da41810aa8bd14aff3fe37e01`
- Latest deployment time: `2026-08-28` Helix-beta clean-init cutover
- Live-data archive: `/vol1/1000/docker/shelfdeck-backups/pre-helix-beta-clean-20260828-135443/live-data.tgz`
- Versioning source: `docs/v3/VERSIONING.md`
- Deployment status: Container running. Health `ok` / `helix-clean-v3`. Mounts include media, upgrade, transcode, adult, and `/dev/dri`.
- Production E2E status: controlled non-destructive canary passed on `公共_国产剧`; it is retained as Service-boundary evidence but does not prove the rebaselined full-auto Beta chain.
- Refresh cutover blocker status: deployed and production-validated for post-optimize ingest -> metadata refresh on the canary.
- Automation model closure status: deployed; public run-scan APIs return `410 KAIROX_RUN_SCAN_REMOVED`.

## Current Architecture State

- The current architecture is Helix, a modular monolith with Libra coordinating Nexora and Kairox Services. `docs/helix/ARCHITECTURE.md` is authoritative.
- Libra owns LibraryMembership, phase, quarantine and admission generation; Nexora owns source truth; Kairox owns maintenance gates, Task/Flow/Event and `maintenanceState`.
- `phase=maintenance` is a long-lived Libra management phase. Kairox independently derives `maintenanceState=maintaining|complete`; task completion never moves the Libra phase.
- `media-desktop` Helix completeness is intentionally deferred and is not part of the current Service Beta scope.
- Helix Beta acceptance now requires a newly created full-auto library to advance through Libra/Nexora onboarding and Kairox basedata/metadata/optimize/required refresh to `maintenanceComplete` under shared resource backpressure. The prior achieved statement is withdrawn.
- Kairox is closed as a transitional architecture phase after `Kairox Beta`.
- `Kairox Usable`, `Kairox Performance`, `Kairox GA Candidate`, and `Kairox GA` are cancelled and must not be used as future roadmap or implementation scope.
- Nexora now operates as Helix's Source Management capability; it is not the top-level LibraryMembership owner.
- Kairox backend runtime cutover is functionally implemented enough for production E2E:
  - task identity is `object + targetGate + gateObjective`.
  - Flow Planner owns flow selection.
  - Resource Runtime owns flow execution routing.
  - TaskAdmission / Task Creator are the automatic task creation path.
  - delete is an independent `targetGate=delete`, not an optimize operation.
- Facts freshness has been implemented and deployed:
  - canonical facts freshness is stored in `media_fact_freshness`.
  - stale media / metadata facts can drive lifecycle back to metadata refresh.
  - optimize task creation is blocked when canonical facts are stale.
- Post-optimize canonical refresh has been implemented and deployed:
  - transcode / upgrade completion records staged facts and evidence.
  - transcode / upgrade no longer directly publish source/media/metadata canonical facts.
  - pending canonical refresh drives Lifecycle back to ingest or metadata before optimize gate is re-evaluated.
- SourceReference -> ingest gate boundary has been implemented and deployed:
  - source adapters publish source references, not canonical source facts.
  - Emby ingest observes the source at task execution time and no longer requires `sourceSnapshot` in task payload.
  - adult folder ingest only publishes source facts; metadata/probe/NFO/adultId work belongs to metadata flow.
- Optimize bitrate profile has been implemented and deployed:
  - optimize objective uses `targetBitrateProfileByBucket` with `minMbps / targetMbps / maxMbps`.
  - Flow Planner, Lifecycle, transcode verify, and upgrade verify share the same profile semantics.
  - old rule templates are rebuilt to the new default profile schema instead of kept as a runtime compatibility layer.
- Transcode rate-control retry has been implemented and deployed:
  - QSV VBR output below objective range should retry inside the same task.
  - retry ladder is QSV VBR -> CPU two-pass ABR -> QSV CBR -> CPU strict fallback.
  - Lifecycle gate semantics remain canonical facts + objective only.
- Gate achievement / task attempt / event retry boundary has been implemented and deployed:
  - flow attempt failure no longer closes optimize gate.
  - automatic task attempt budget is handled by TaskCreationPolicy attemptKey.
  - task retryCount remains event/recovery state, not Lifecycle gate state.
- Automation model closure has been implemented and deployed:
  - information changes only write facts / freshness / policy / evidence.
  - periodic SmartTaskEngine scan is the only background automatic task creation mechanism.
  - user-facing run-scan / refresh-library APIs are removed.
  - manual task creation is bound to a concrete item and `targetGate`.
  - SmartTaskEngine consumes LifecycleSnapshot instead of reduced media rows.
- Media Freeze has been implemented and deployed:
  - goal: after optimize done, freeze the media before any immediate ingest/metadata/archive/delete task can be created.
  - owner: TaskAdmission / TaskCreationPolicy.
  - storage target: `media_items` hot columns, not `payload_json` only.
  - default Beta policy: optimize done -> 24h freeze; other target gates -> 0h.

## Frontend State

- Kairox frontend navigation and page groups are implemented at Beta level:
  - Dashboard
  - Media
  - Task Center
  - Delete Review
  - Policies
  - Advanced
- Frontend/API connection has been reworked toward Kairox projections.
- Full Frontend GA user experience is not complete:
  - wording and interaction polish remain.
  - some pages still need deeper user-journey refinement after E2E proves the backend chain.

## Current E2E Context

- Current production E2E sample: `爱很美味`.
- Test library: `公共 国产剧库`.
- Current canary item: `81945 / 爱很美味 / Season 1`.
- Latest completed run:
  - all stages `stage0` through `stage15` passed.
  - the sample was re-cut to about 10 seconds per episode and re-encoded to high bitrate before the run.
  - Emby was manually refreshed before ingest/scrape refresh validation.
  - Stage 10 first validated that Media Freeze rejected immediate post-optimize refresh with `media_frozen`.
  - after explicit user authorization, the canary freeze was cleared for testing, Emby was refreshed, and Stage 10 continued through ingest -> metadata -> optimize gate passed.
  - Stage 13 confirmed delete through `delete.beforeExecute`; canary delete task completed and wrote delete gate facts while preserving archive history.
- The canary item has been destructively used by the completed E2E run. A future destructive E2E needs a new or restored canary sample.
- Previous production validation before SourceReference deployment:
  - manual library ingest scan returned `mode=kairox_scan`.
  - scan created `targetGate=ingest` task `b5840cad0adbad9d` for item `81945`.
  - ingest completed and marked `sourceFacts=fresh`, `mediaFacts/metadataFacts=stale`.
  - manual `targetGate=metadata` task `6f02d08dd1452d1c` completed through `flowPlan.flowKind=scrape`.
  - final canonical facts: `duration=200`, `size=20493967`, `bitrate=819759`, `source/media/metadata freshness=fresh`.
  - final lifecycle projection: `lifecycleStage=metadata_ready`, `lifecycleNextTask=optimize`.
- The earlier `漫长的季节` Stage 0-6 evidence remains useful but is not the current accepted E2E run.
- The next full E2E run should restart on item `81945`.

## Release Goal Status

| Goal | Status | Notes |
| --- | --- | --- |
| `Kairox Beta` | Achieved | Production Frontend/API business E2E Stage 0-15 passed on item `81945` |
| `Kairox Usable` | Cancelled | Superseded by Nexora architecture reset |
| `Kairox Performance` | Cancelled | Superseded by Nexora architecture reset |
| `Kairox GA Candidate` | Cancelled | Superseded by Nexora architecture reset |
| `Kairox GA` | Cancelled | Superseded by Nexora architecture reset |
| `Helix Beta` | In progress | Current goal is the full-auto Service chain defined in `docs/helix/CURRENT_PLAN.md` |

## Unresolved / Not Yet Proven

- Production automation audit after Beta acceptance found a real-library automatic creation issue:
  - `source_missing` adult-library items repeatedly consume each SmartTaskEngine scan with `targetGate=ingest`.
  - `optimizeAllowedFlowKinds=[]` means automatic optimize can be created but cannot select transcode/upgrade flow until configured.
  - `archive` is not in `automaticTaskTargets`, so archive-ready items do not auto-archive.
  - These are recorded in `docs/v3/acceptance/KAIROX_PRODUCTION_AUTOMATION_AUDIT.md`.
  - They do not block `Kairox Beta`; they belong to the next onboarding/offboarding/automation governance work.
- Architecture boundary discovered during Beta closure:
  - `Kairox Beta` proves the in-library management chain, not the final ShelfDeck governance model.
  - Onboarding and Offboarding need a later architecture upgrade instead of being forced into lifecycle gates.
  - Resource Runtime remains lifecycle-first; a future global resource management platform is out of this worktree.
- Follow-up found during test-only freeze clearing:
  - Media Freeze currently appears in both `media_items` hot columns and historical payload fields for the canary.
  - Runtime behavior passed because normal finalization writes the active projection, but this duplicate storage is a data-model cleanup risk.
  - Do not fix in this worktree unless it blocks Beta acceptance; put full payload cleanup in the future Performance/data-governance work.
- Previous Stage 8 blocker status:
  - the previous `Emby source snapshot is required` blocker is fixed.
  - objective bitrate is already a three-number profile; `targetMbps` is the FFmpeg target, `minMbps/maxMbps` are gate bounds.
  - QSV VBR produced an output below the objective range and `transcode_verify` failed hard.
  - decision implemented: keep verify strict, but retry rate-control strategies inside the same task before final failure.
- Automation model closure is implemented and deployed:
  - manual `/v1/library/actions/ingest` and `/refresh` now return `410 KAIROX_RUN_SCAN_REMOVED`.
  - user-facing frontend no longer exposes scan/refresh library actions.
  - automatic creation is handled by periodic SmartTaskEngine scan only.
  - manual user intervention creates concrete item target-gate tasks.
  - approvalPolicy remains a Resource Runtime / flow execution confirmation concept, not automation authorization.
- Refresh cutover remains implemented and deployed:
  - sublibrary add / startup / timer no longer run direct Emby ingest.
  - public cache write API returns `LEGACY_CACHE_WRITE_DISABLED`.
  - Emby inventory observations become `targetGate=ingest` candidates.
  - Emby source commit writes source facts and marks media/metadata stale.
- Post-optimize canonical refresh is implemented and deployed:
  - transcode / upgrade write staged facts and fact refresh request.
  - Lifecycle projects `pending_canonical_refresh` back to ingest / metadata.
  - E2E Stage 7 now validates refresh tasks before archive.
- Kairox business chain has production proof for the canary:
  - frontend page visibility.
  - media projection correctness.
  - facts freshness / stale detection.
  - perception update.
  - lifecycle objective revision.
  - targetGate task creation.
  - flow planning.
  - flow execution.
  - optimize / archive / delete review gate progression.
- Scheduler pressure optimization is not part of this completed Beta worktree.
- Full UI GA is not part of this completed Beta worktree.
- This worktree is closed at `Kairox Beta`.
- Do not start `Kairox Usable`, `Kairox Performance`, `Kairox Governance`, `Kairox GA Candidate`, or `Kairox GA`; those names are cancelled.
- Do not start Nexora implementation until Nexora architecture design is discussed and accepted.

## Worktree Notes

- `acceptance/KAIROX_FRONTEND_API_E2E.md` is the committed evidence artifact for the completed production E2E run.
- `acceptance/.kairox_frontend_api_e2e_state.json` is local run state and must not be committed.
- Production cleanup after Beta acceptance:
  - NAS `shelfdeck` container was stopped and removed with `docker compose down`.
  - Old uploaded image tarballs and old `markmahoro/shelfdeck` Docker images were removed.
  - Production data backups were reduced to the latest `20260708051702` backup set plus current live data.
  - Local `dist-image` was reduced to the final Kairox Beta tarball and marker; local temp folders were cleared.
