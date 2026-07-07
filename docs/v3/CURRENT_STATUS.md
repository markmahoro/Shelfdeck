# ShelfDeck v3 Current Status

Last updated: 2026-07-07

## Production

- Current release goal: `Kairox Beta Candidate`
- Worktree scope: this worktree stops at `Kairox Beta`; later goals require a new worktree.
- Production URL: `http://192.168.12.230:18080`
- Latest deployed image: `markmahoro/shelfdeck:kairox-freshness-20260707-263ef161`
- Latest deployed commit: `263ef161 Implement Kairox facts freshness and E2E tooling`
- Latest deployed image SHA256: `0840d9864e9c0b4f0782a458acd10f1e5b80d51d914f34528b54e63ef573868d`
- Latest deployment time: `2026-07-07 22:02 Asia/Shanghai`
- Versioning source: `docs/v3/VERSIONING.md`
- Deployment status: deployed and health recovered to green.
- Production E2E status: paused before rerun after deployment; `Kairox Beta` is not achieved until E2E passes.

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

- Current production E2E sample: `漫长的季节`.
- Test library: `公共 国产剧库`.
- Known intended canary item from earlier work: `82397 / 漫长的季节 / Season 1`.
- The sample was shortened to about one minute per episode and Emby was refreshed by the user.
- The previous blocker was stale ShelfDeck facts after the media files changed.
- That blocker should now be addressed by the deployed facts freshness implementation.

## Release Goal Status

| Goal | Status | Notes |
| --- | --- | --- |
| `Kairox Beta` | Candidate | Code is deployed, production E2E still pending |
| `Kairox Usable` | Not started | Requires new worktree after Kairox Beta |
| `Kairox Performance` | Not started | Requires new worktree after Kairox Beta |
| `Kairox GA Candidate` | Not started | Requires new worktree after Kairox Beta |
| `Kairox GA` | Not started | Requires new worktree after Kairox Beta |

## Unresolved / Not Yet Proven

- Production Frontend/API E2E has not yet been rerun after deploying facts freshness.
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
