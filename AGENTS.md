# AGENTS.md

This is the lean project memory for Codex in this repository. Keep it small. Put durable architecture details in docs, not here.

## Project

ShelfDeck (媒体库管家) manages an Emby media library through lifecycle gates, task targets, flow execution, resource events, and Admin Web / desktop clients.

Main modules:

| Path | Purpose |
| --- | --- |
| `media-service/` | Service, Admin Web, task engine, integrations, Docker/Windows runtime |
| `media-desktop/` | Electron thin client over service HTTP APIs |
| `media-worker/` | Passive FFmpeg/AI compute worker called by service |
| `tests/` | Shell E2E runner and env files |
| `docs/` | Architecture, workflow, deployment, debug, and v3 context |

Do not add generated `media-service/dist/`, root debug dumps, runtime JSON, exported production data, or old restructure scripts back to the repo.

## Required Reading

Use the smallest relevant set:

| Situation | Read first |
| --- | --- |
| Helix / Libra / Nexora architecture/process/current work | `docs/helix/README.md`, then `docs/helix/ARCHITECTURE.md`, `docs/helix/SERVICE_CONTRACTS.md`, `docs/helix/CURRENT_STATUS.md`, and `docs/helix/CURRENT_PLAN.md` |
| Current v3/Kairox legacy status or next task | `docs/v3/README.md`, then `docs/v3/CURRENT_STATUS.md` and `docs/v3/CURRENT_PLAN.md` |
| Kairox closure / release history, whether a version is done, or worktree scope | `docs/v3/RELEASE_GOALS.md`, then `docs/v3/CURRENT_STATUS.md` |
| Version naming, release tag, image tag, package version, or deployment identity | `docs/v3/VERSIONING.md`, then `docs/v3/CURRENT_STATUS.md` |
| Existing Kairox runtime architecture, scheduler, task admission, automation, flow, resource runtime, module boundary | `docs/v3/KAIROX_ARCHITECTURE.md`, then `docs/v3/KAIROX_ENGINEERING_PLAYBOOK.md`; use `docs/v2/ARCH_OVERVIEW.md` only as current implementation map |
| v3 docs conflict or historical context | `docs/v3/README.md` |
| Runtime bug/debugging | `tests/TEST_ENV_CHECKLIST.md`, then `docs/v2/DEBUG_WORKFLOW.md` |
| Production deploy/release/upgrade | `docs/v2/PRODUCTION_DEPLOYMENT.md` |
| Tests and flow coverage | `docs/v2/TEST_ARCHITECTURE.md` |
| Development commands/platform rules | `docs/v2/DEVELOPMENT_WORKFLOW.md` |

`tests/TEST_ENV_CHECKLIST.md` contains private credentials and is intentionally ignored by git. Never copy credentials into commits, docs, or final replies.

## Architecture Memory

- Kairox is a completed transitional architecture phase. `Kairox Beta` is achieved and is the only accepted Kairox release goal.
- `Kairox Usable`, `Kairox Performance`, `Kairox GA Candidate`, and `Kairox GA` are cancelled. Do not use them as future worktree scope, release goals, Docker milestone names, or implementation plans.
- The current architecture line is `Helix = Libra + Nexora + Kairox`. Libra is the Library Management / orchestration layer; Nexora is the Source Management capability; Kairox remains the In-Library Operation capability.
- Helix is permanently a modular monolith inside `media-service`. Service boundaries are in-process JavaScript Facades and Store ownership boundaries, not internal microservices.
- Libra owns LibraryMembership, Helix phase, quarantine, admission generation, and cross-domain reconciliation. Nexora owns source identity, SourceBinding, observation, and onboarding/offboarding execution. Kairox owns maintenance objectives, Task/Flow/Event, and maintenance projections.
- Only the Libra composition root may depend on both Nexora Service and Kairox Service. Nexora and Kairox must not call each other or write each other's stores.
- Helix documents live under `docs/helix/`; Nexora domain documents live under `docs/helix/nexora/`. Do not add new Nexora active plans, architecture contracts, acceptance plans, or implementation status under `docs/v3/`.
- Nexora development uses three stages: Design, Implementation, Audit. Audit includes static audit, automated tests, and E2E / production-like evidence.
- Nexora's earlier focused slices are historical evidence; current cross-domain work follows the sole Helix plan/status.
- E2E-discovered architecture contract gaps must return to Design and be confirmed before code changes; implementation defects inside an accepted contract may be fixed directly with tests.
- v3.x roadmap names, Kairox milestone names, Docker image tags, Git release tags, and package versions are different concepts. Use `docs/v3/VERSIONING.md` as the source of truth.
- `docs/v2/ARCH_OVERVIEW.md` is a current implementation map, not an architecture contract. It must not override the relevant current architecture contract once Nexora exists.
- Mirex is historical context before Kairox. Helix clean runtime has no Mirex migration, dual read, or compatibility path.
- Kairox task semantics are inherited engineering legacy, not proof that Nexora must use lifecycle-first boundaries for Membership or SourceBinding.
- Legacy `actionType`, operation-kind fields, and top-level selected-flow fields are Mirex remnants. They may only appear in historical docs or negative tests, not in clean runtime task identity.
- Task / Flow / Event boundaries are hard:
  - Task: one attempt to move one object across one target gate.
  - Flow: implementation path selected by Flow Planner and stored as `flowPlan.flowKind`.
  - Event: durable execution step inside that flow, usually tied to resource usage.
- All automatic task creation must use unified TaskAdmission / Task Creator semantics. There must be no adult-library-only or background-only auto-enqueue path.
- Each Library has exactly `libraryAutomationMode` and `maintenanceAutomationMode`. Kairox automatic maintenance follows Lifecycle's current `basedata|metadata|optimize` next gate; there is no per-gate automatic allow-list. Manual intent cannot bypass generation, duplicate, freshness, approval, or destructive safety.

## Production Safety

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

Do not run `npm run dev` as a long-running blocking command from Codex. Tell the user to run it manually when an interactive dev server is needed.

## Platform And API Rules

- Node.js >= 20.
- Use `process.platform === 'linux'` for Docker/Linux-specific behavior.
- Keep Windows-only tray code behind `process.platform === 'win32'` or optional `try/catch require`.
- Use `path.join()` and configurable roots. Do not hardcode user-specific paths.
- Windows-only packages belong in `optionalDependencies`; Docker installs may use `--omit=optional`.
- Docker FFmpeg paths come from `FFMPEG_PATH` and `FFPROBE_PATH`.
- APIs are JSON in/out; GET has no side effects; PATCH is idempotent partial update.
- Error shape: `{ error: { code: "ERROR_CODE", message: "..." } }`.
- `GET /v1/health` is public. Other protected APIs use `X-Api-Key`.
- Desktop APIs are under `/v1/*`; Admin Web APIs are under `/v1/admin/*`.

## Change Discipline

- Read the code before changing it. Prefer existing patterns and helpers.
- No workarounds or silent fallbacks when debugging; find the precise root cause.
- When changing API, config, scheduler, task admission, flow behavior, resource behavior, or architecture contracts, update relevant tests and docs.
- v3/Kairox planning documents must not multiply. Keep the active Kairox legacy plan in `docs/v3/CURRENT_PLAN.md`, active status in `docs/v3/CURRENT_STATUS.md`, and move completed/superseded/evidence documents under `docs/v3/archive/`.
- Helix planning documents must not multiply. Keep the active Helix plan in `docs/helix/CURRENT_PLAN.md`, active status in `docs/helix/CURRENT_STATUS.md`, and move superseded Nexora-specific plans/evidence under `docs/helix/nexora/archive/` or `docs/helix/nexora/acceptance/`.
- Codex Plan Mode does not create new active plan documents. A confirmed plan updates `docs/v3/CURRENT_PLAN.md`; acceptance details update an existing file under `docs/v3/acceptance/`; do not create parallel active plan files.
- Do not invent or reuse version names during implementation. For production deployments record the Docker image tag, git commit, SHA256, and E2E status in `docs/v3/CURRENT_STATUS.md`; reserve Git release tags for accepted releases.
- Verify impact across service Windows, service Docker, and desktop Windows according to `docs/v2/DEVELOPMENT_WORKFLOW.md`.
- Passing tests are evidence, not proof; be honest about untested risk.
- Code, code comments, and commit messages are English. Docs are Chinese with English technical terms where appropriate.
