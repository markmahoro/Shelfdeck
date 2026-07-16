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

## Required Reading

Use the smallest relevant set:

| Situation | Read first |
| --- | --- |
| Helix / ShelfDeck architecture, Libra, Procurement, Arca, or current work | `docs/helix/README.md`, then `docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`, `docs/helix/CURRENT_STATUS.md`, and `docs/helix/CURRENT_PLAN.md`; for Level 7 business decisions also read non-canonical `docs/helix/LEVEL7_BUSINESS_DECISIONS.md`; for Architecture Review history read non-canonical `docs/helix/ARCHITECTURE_REVIEW.md` |
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

- `docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md` is the sole ShelfDeck / Helix architecture SSOT. Archived Helix, Kairox, v3, v2, and component-specific documents are historical evidence or implementation maps and cannot override it.
- Levels 0–10 of the SSOT and the final full-document audit are accepted/closed as of 2026-07-16. The user confirmed `FA-04`: a Series Candidate extends an existing Season Subject only with an exact provider-season or persistent triage-grouping claim, exactly one active match, and zero Episode overlap; otherwise Intake accepts it as a new Subject. This does not authorize implementation.
- `docs/helix/ARCHITECTURE_REVIEW.md` is the closed non-canonical review record. Section 14 contains the final-audit evidence, `FA-04` Decision Packet, bounded propagation, and closure. Review remains evidence-first and blind-review-assisted; a suspected item is not a defect until global SSOT audit proves it.
- `docs/helix/LEVEL7_BUSINESS_DECISIONS.md` is the non-canonical Level 7 decision workspace. Only questions that change user intent, visible business outcomes, irreversible authorization, Business Domain/Owner/Handoff, or business-object continuity may be surfaced to the user. Codex owns engineering choices and must not turn implementation detail into a user decision.
- The Level 7 historical capability conservation audit is complete: all 62 catalog capabilities are accounted for in `docs/helix/CAPABILITY_CONSERVATION.md`; this is evidence, not implementation authorization or a clean physical catalog.
- The clean top-level business domains are Procurement, Libra, Arca, User Perception, and People Management. Collection Formation has only two one-way Business Handoffs: Procurement to Libra and Libra to Arca.
- Procurement owns `0..N` Material Fields. Each Field is a user-configured physical file source with its own `fieldId` and current Field Access Binding; Emby is an External Provider only. Field Management maintains observations and eligibility, while current Material Control determines the derived Procurement, Production, and Finished Goods regions. Triage prepares immutable Candidate Packages. Related Materials travel only as references and do not get independent Field observation membership or control locks.
- Libra owns Subject, Shelf Routing, Acceptance Spec, Libra Run, Production Workspace, and the On-deck Product Package. Libra only reads formal external inputs and writes changed products in its Workspace. Arca owns Shelf, Shelf Acceptance, On-deck Run/Off-load, Shelf Entry, Canonical Content Identity, and the Deck Fact. Handoff B Accepted transfers custody but does not establish Own; only Arca On-deck Commit establishes or expands Shelf Entry and Deck Fact.
- Every Shelf has exactly one Shelf Physical Target Folder. Libra independently reclaims Workspace material by periodically checking Arca's durable Off-load Completion Projection; Arca signals only wake the reclaimer and need not be reliable or keyed by Shelf Entry. Expedited maintenance priority remains local to Libra, continues across a legitimate replacement Libra Run, and ends at Handoff B Accepted; Arca Off-load does not inherit it.
- Shelf Deregistration is Arca's non-destructive whole-Shelf administrative lifecycle. It ends active Shelf Entries/Deck Facts and releases the exact current Material Control scope without deleting, moving, renaming, or otherwise modifying media files; it is not Off-deck or a third Business Handoff.
- Physical Material Identity, Domain-local Material Binding, and Material Control are separate. There is no global media business ID, Membership, SourceBinding, or cross-domain Store.
- Kairox is not a top-level domain. In accepted Level 8 it is only Libra's internal Production professional organization inside Workspace responsibility, with no independent Store, Business Object, Facade, runtime, or cross-domain authority. Historical ownership does not carry forward. The former source-oriented organization name has been removed from clean Helix and must not be reintroduced as a component or placeholder.
- Helix remains a modular monolith inside `media-service`. Business boundaries use in-process Facades, separate fact ownership, and dependency rules, not internal HTTP or independent deployments.
- Kairox is a completed transitional architecture phase. `Kairox Beta` is its only accepted historical release goal; later Kairox roadmap names remain cancelled.
- Mirex, Kairox, earlier source-separation phases, and earlier Helix schemas have no migration, dual-read, or compatibility entitlement in the clean design.
- Current work is Design-only. Do not resume implementation, E2E, Docker image construction, or production deployment until the active Helix plan's implementation gate is explicitly cleared by the user.
- E2E-discovered architecture gaps return to Design. A bug or test failure never authorizes moving a decision or fact across a confirmed boundary.
- v3.x roadmap names, Docker image tags, Git release tags, and package versions are different concepts. Use `docs/v3/VERSIONING.md` only for historical/current deployment identity, not clean Helix business architecture.

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
- A user challenge is a review trigger, not evidence that the current conclusion is wrong. Re-check the active SSOT and historical record, distinguish an already-decided duplicate from a genuine open contract gap, and then state the evidence-backed result. Do not concede, downgrade, close, or reopen an architecture issue merely to agree with the challenge; if a real gap remains, keep it open and discuss it explicitly.
- A bug fix, test fix, performance fix, or recovery fix must never move a decision or fact into a component that does not own it. If the fix appears to require crossing a documented architecture boundary, stop implementation, return to the owning design contract, and obtain explicit user confirmation before changing that boundary. Passing tests or faster delivery never authorize boundary drift.
- No workarounds or silent fallbacks when debugging; find the precise root cause.
- When changing API, config, scheduler, task admission, flow behavior, resource behavior, or architecture contracts, update relevant tests and docs.
- v3/Kairox planning documents must not multiply. Keep the active Kairox legacy plan in `docs/v3/CURRENT_PLAN.md`, active status in `docs/v3/CURRENT_STATUS.md`, and move completed/superseded/evidence documents under `docs/v3/archive/`.
- Helix planning documents must not multiply. Keep the active Helix plan in `docs/helix/CURRENT_PLAN.md`, active status in `docs/helix/CURRENT_STATUS.md`, and move superseded component-specific plans/evidence under historical archive paths.
- Codex Plan Mode does not create new active plan documents. A confirmed plan updates `docs/v3/CURRENT_PLAN.md`; acceptance details update an existing file under `docs/v3/acceptance/`; do not create parallel active plan files.
- Do not invent or reuse version names during implementation. For production deployments record the Docker image tag, git commit, SHA256, and E2E status in `docs/v3/CURRENT_STATUS.md`; reserve Git release tags for accepted releases.
- Verify impact across service Windows, service Docker, and desktop Windows according to `docs/v2/DEVELOPMENT_WORKFLOW.md`.
- Passing tests are evidence, not proof; be honest about untested risk.
- Code, code comments, and commit messages are English. Docs are Chinese with English technical terms where appropriate.
