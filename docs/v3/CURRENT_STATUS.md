# ShelfDeck v3 Current Status

Last updated: 2026-07-08

## Production

- Current release goal: `Kairox Beta Candidate`
- Worktree scope: this worktree stops at `Kairox Beta`; later goals require a new worktree.
- Production URL: `http://192.168.12.230:18080`
- Latest deployed image: `markmahoro/shelfdeck:kairox-e2e-fix-20260708-327549be`
- Latest deployed commit: `327549be Separate gate achievement from task attempts`
- Latest deployed image SHA256: `3d615cf6c22aa30fb9b6218750877d3ed378902c1a0d465174be9ed2742cac46`
- Latest deployment time: `2026-07-08 00:48 Asia/Shanghai`
- Versioning source: `docs/v3/VERSIONING.md`
- Deployment status: deployed and health recovered to green.
- Production E2E status: restarted after deploying gate/attempt/retry boundary fix; `Kairox Beta` is not achieved until E2E passes.
- Refresh cutover blocker status: deployed and production-validated for ingest -> metadata refresh on the new canary.

## Current Architecture State

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
- Gate achievement / task attempt / event retry boundary has been implemented and deployed:
  - flow attempt failure no longer closes optimize gate.
  - automatic task attempt budget is handled by TaskCreationPolicy attemptKey.
  - task retryCount remains event/recovery state, not Lifecycle gate state.

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
- The sample was shortened to about 10 seconds per episode and Emby was refreshed by the user.
- Production validation after deploy:
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
| `Kairox Beta` | Candidate | Code is deployed, production E2E still pending |
| `Kairox Usable` | Not started | Requires new worktree after Kairox Beta |
| `Kairox Performance` | Not started | Requires new worktree after Kairox Beta |
| `Kairox GA Candidate` | Not started | Requires new worktree after Kairox Beta |
| `Kairox GA` | Not started | Requires new worktree after Kairox Beta |

## Unresolved / Not Yet Proven

- Production Frontend/API E2E needs a fresh run on item `81945`.
- Refresh cutover is implemented and deployed:
  - manual `/v1/library/actions/ingest` and `/refresh` request Kairox SmartTask scan.
  - sublibrary add / startup / timer no longer run direct Emby ingest.
  - public cache write API returns `LEGACY_CACHE_WRITE_DISABLED`.
  - Emby inventory observations become `targetGate=ingest` candidates.
  - Emby source commit writes source facts and marks media/metadata stale.
- Post-optimize canonical refresh is implemented and deployed:
  - transcode / upgrade write staged facts and fact refresh request.
  - Lifecycle projects `pending_canonical_refresh` back to ingest / metadata.
  - E2E Stage 7 now validates refresh tasks before archive.
- Kairox business chain still needs production proof:
  - frontend page visibility.
  - media projection correctness.
  - facts freshness / stale detection.
  - perception update.
  - lifecycle objective revision.
  - targetGate task creation.
  - flow planning.
  - flow execution.
  - optimize / archive / delete review gate progression.
- Scheduler pressure optimization is not the current priority.
- Full UI GA is not the current priority until E2E proves the chain.
- This worktree must not start `Kairox Usable`, `Kairox Performance`, or `Kairox GA` implementation.

## Worktree Notes

- `acceptance/KAIROX_FRONTEND_API_E2E.md` is an E2E report artifact and may remain uncommitted until a completed run is available.
