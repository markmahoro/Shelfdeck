# AGENTS.md

This is the lean project memory for Codex in this repository. Keep it small. Put durable architecture details in docs, not here.

## Project

ShelfDeck (媒体库管家) establishes and operates a personal media collection from user-configured physical Material Fields. Emby is an optional External Provider, not ShelfDeck's storage or collection owner. The clean Helix model is defined only by the architecture SSOT below; current code still reflects historical processing models.

Main modules:

| Path | Purpose |
| --- | --- |
| `media-service/` | Service, Admin Web, task engine, integrations, Docker/Windows runtime |
| `media-desktop/` | Electron thin client over service HTTP APIs |
| `media-worker/` | Passive FFmpeg/AI compute worker called by service |
| `tests/` | Shell E2E runner and env files |
| `docs/` | Architecture, workflow, deployment, debug, and v3 context |

Do not add generated `media-service/dist/`, root debug dumps, runtime JSON, exported production data, or old restructure scripts back to the repo.

## Required Reading and Architecture

- For current work read docs/helix/README.md, CURRENT_PLAN.md, CURRENT_STATUS.md and implementation/CURRENT_PHASE.md. Read the relevant SSOT sections and direct dependencies, not the entire architecture for every edit.
- docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md is the sole architecture SSOT. docs/helix/ENGINEERING_PLAYBOOK.md governs engineering. Historical v3/Kairox/v2 documents cannot override current contracts.
- Helix-beta is Movie-only journeys A–I; BETA_FEATURE_ACCEPTANCE_BASELINE.md defines acceptance. Series/JAV/Western Adult remain future SSOT scope, not current Beta claims.
- Procurement owns Material Fields and immutable Candidate Packages; Libra owns Subject, routing, Acceptance Spec, Run and production Workspace; Arca owns Shelf, On-deck, Inventory and collection facts. Handoff A/B are one-way; only Arca On-deck Commit establishes collection ownership. Emby is an optional provider.
- Libra writes its Workspace, not formal sources. Arca owns formal placement and source settlement. Physical identity, local bindings and Material Control are separate; no global business media ID or cross-domain Store.
- The service remains a modular monolith with public in-process domain boundaries. Kairox has no independent top-level domain/runtime authority. Consult SSOT for detailed lifecycle contracts rather than duplicating them here.
- UAT-NNN is historical: docs/helix/UAT_ITERATION_REGISTER.md keeps existing numbers, statuses and evidence, but do not allocate new UAT numbers and do not call new issues "UAT". Plan development and track new defects/acceptance issues as named work items in CURRENT_PLAN and the single CURRENT_PHASE. Preserve all existing UAT records; an open UAT stays open until its own acceptance conditions are met. Close issues against their own evidence and acceptance conditions; code or deployment alone is not closure. Link development commits and evidence to their Phase work items; existing UAT fixes may still reference their registered UAT.
- For runtime debugging read tests/TEST_ENV_CHECKLIST.md and docs/v2/DEBUG_WORKFLOW.md. The checklist contains private credentials; never copy them into docs, commits or replies.
- For deployment read docs/v2/PRODUCTION_DEPLOYMENT.md; for platform commands/validation use docs/v2/DEVELOPMENT_WORKFLOW.md and TEST_ARCHITECTURE.md. Read docs/v3/VERSIONING.md only for version/release identity questions.
- Current counts, deployment and task status belong in machine manifests/CURRENT_STATUS, not permanent AGENTS rules. User authorization persists; see Playbook §3 for contract and production boundaries.

## Production Safety

- Deployment coordination follows docs/helix/ENGINEERING_PLAYBOOK.md §3.5; the centralized deployment-owner role was cancelled by the user. Version-specific UI verification follows §12.3, including its UI-only development exception.
- NAS ShelfDeck Docker at `192.168.12.230:18080` is production.
- Do not delete, park, reset, migrate, or directly edit production data unless the user explicitly asks for that production action.
- A direct user request to deploy, release, publish, or upgrade NAS production authorizes the standard deploy flow, including `deploy-nas.js --apply` after dry run and checksum validation pass.
- Production deploy must use `scripts/build-image.js` (with `scripts/build-image.sh` only as its compatibility wrapper), `scripts/upload-nas-image.js`, and `scripts/deploy-nas.js`; SSH config must go through `tools/nas-ssh-config.js`.
- Use local `127.0.0.1:18080`, temporary data dirs, or disposable workers for destructive testing and environment resets.
- Local `media-service/data/*.json` / local runtime data is test-only and may be cleared for local resets.

## Commands

```bash
# Service
cd media-service && npm install
cd media-service && npm start
cd media-service && npm test
cd media-service && npm run build:web

# Desktop
cd media-desktop && npm install
cd media-desktop && npm test
cd media-desktop && npm run dist:win

# Worker
cd media-worker && npm install && npm start

# E2E
bash tests/runner.sh all tests/env/docker-fn.env
```

Do not block the turn with a foreground development server. When needed, use a managed background session, record its port/session, and stop task-owned servers after verification.

## Platform And API Rules

- Node.js >= 20.
- Use `process.platform === 'linux'` for Docker/Linux-specific behavior.
- Keep Windows-only tray code behind `process.platform === 'win32'` or optional `try/catch require`.
- Use `path.join()` and configurable roots. Do not hardcode user-specific paths.
- Windows-only packages belong in `optionalDependencies`; Docker installs may use `--omit=optional`.
- Docker FFmpeg paths come from `FFMPEG_PATH` and `FFPROBE_PATH`.
- APIs are JSON in/out; GET has no side effects; PATCH is idempotent partial update.
- Error shape: `{ error: { code: "ERROR_CODE", message: "...", details?: {...}, correlationId: "..." } }`; never expose Secret values.
- `GET /v1/health` is public. Non-browser API clients use `X-Api-Key`; clean Admin Web exchanges it for a same-origin HttpOnly SameSite session and never stores the plaintext key in browser storage.
- Desktop APIs are under `/v1/*`; Admin Web APIs are under `/v1/admin/*`.

## Change Discipline

- For UI-only development, the implementing task may complete exact-version UI verification and record evidence without duplicate UI-owner review. Development in other layers that also changes UI, including backend-generated display text, still requires the user-appointed UI owner's review of the exact version. Follow docs/helix/ENGINEERING_PLAYBOOK.md §11.1/§12.3 and BETA_FEATURE_ACCEPTANCE_BASELINE.md §7.1; classify by the actual change, not the task label.
- For Admin Web / UI / UX changes or UAT, including backend-generated display text, read `docs/helix/ENGINEERING_PLAYBOOK.md` §11.1, then `docs/helix/BETA_FEATURE_ACCEPTANCE_BASELINE.md` §7.1.
- UI must guide through structure, concise state, visible actions, and outcome feedback. Do not patch interaction gaps with explanatory prose. Every user-visible change, including post-UAT fixes, must meet `docs/helix/ENGINEERING_PLAYBOOK.md` §11.1; preserve accessible labels, actionable errors, and required consequence confirmations.
- Read the code before changing it. Prefer existing patterns and helpers.
- During the current Helix iteration stage, unfinished Libra/Formation entries have no compatibility entitlement. Unless the user explicitly identifies an exact entry that must survive an iteration, do not add migration, dual-read/write, fallback, resume, repair, or other compatibility code for existing entries; clear them with the authorized Formation Reset tooling instead. Reset may retire stale runtime data, but it must never conceal a defect that still reproduces for newly created entries. The 2026-10-23 user-confirmed Reset scope is the current workbench (`in_progress|attention_required` + pending intake, all profiles/shelves), including accepted-but-uncommitted on-deck; it preserves committed collection, completed/ended history, Aftercare/Off-deck and source files, and is an admin fallback, not a user cancel.
- A user challenge is a review trigger, not evidence that the current conclusion is wrong. Re-check the active SSOT and historical record, distinguish an already-decided duplicate from a genuine open contract gap, and then state the evidence-backed result. Do not concede, downgrade, close, or reopen an architecture issue merely to agree with the challenge; if a real gap remains, keep it open and discuss it explicitly.
- A bug fix, test fix, performance fix, or recovery fix must never move a decision or fact into a component that does not own it. If the fix appears to require crossing a documented architecture boundary, stop implementation, return to the owning design contract, and obtain explicit user confirmation before changing that boundary. Passing tests or faster delivery never authorize boundary drift.
- Find the root cause. Do not use silent fallbacks, weakened invariants or data resets to hide a reproducible defect; explicit recovery required by the owning contract remains valid.
- When changing API, config, scheduler, task admission, flow behavior, resource behavior, or architecture contracts, update relevant tests and docs.
- v3/Kairox planning documents must not multiply. Keep the active Kairox legacy plan in `docs/v3/CURRENT_PLAN.md`, active status in `docs/v3/CURRENT_STATUS.md`, and move completed/superseded/evidence documents under `docs/v3/archive/`.
- Helix planning documents must not multiply. Keep the concise Master Plan in `docs/helix/CURRENT_PLAN.md`, facts in `docs/helix/CURRENT_STATUS.md`, and exactly one subordinate active Phase packet in `docs/helix/implementation/CURRENT_PHASE.md`. Do not create parallel active component or Work Package plans. After Phase Exit, move the frozen packet to `docs/helix/implementation/archive/`; store audits and acceptance evidence in `docs/helix/implementation/evidence/`.
- Plan Mode follows the active project: update docs/helix/CURRENT_PLAN.md for Helix; v3 planning paths apply only to explicitly requested legacy work.
- Do not invent or reuse version names during implementation. For production deployments record the Docker image tag, git commit, SHA256, and E2E status in `docs/v3/CURRENT_STATUS.md`; reserve Git release tags for accepted releases.
- Verify affected platforms according to docs/v2/DEVELOPMENT_WORKFLOW.md. Pure docs/UI text edits do not automatically require service Docker and desktop builds; record relevant coverage and omissions.
- Passing tests are evidence, not proof; be honest about untested risk.
- Code, code comments, and commit messages are English. Docs are Chinese with English technical terms where appropriate.
