# AGENTS.md

This file is the primary project memory for Codex when working in this repository.

## Project Overview

**ShelfDeck** (媒体库管家) manages an Emby movie library by combining watch state, user ratings, Douban ratings, and media technical metadata, then creating tasks to keep, delete, transcode, or upgrade media.

Current architecture modules:

| Module | Directory | Runtime | Notes |
| --- | --- | --- | --- |
| service Docker | `media-service/` | Container | Main service on Linux/Docker, no tray, system FFmpeg |
| service Windows | `media-service/` | Node.js + Fastify + systray2 | Main service on Windows, embedded tray, bundled FFmpeg |
| desktop | `media-desktop/` | Electron + React | Thin client over HTTP REST |
| transcode node | `media-worker/` | Node.js + Fastify + FFmpeg | Passive compute worker called by service for remote transcode jobs |

Canonical architecture: `docs/v2/ARCH_OVERVIEW.md`.

## Repository Shape

Keep the repo focused on current runtime code and essential workflows:

| Path | Purpose |
| --- | --- |
| `media-service/` | Service, admin web, task engine, integrations |
| `media-desktop/` | Electron desktop client |
| `media-worker/` | Transcode worker node |
| `tests/` | Shell E2E flow runner and environment files |
| `.github/workflows/` | CI and release automation |
| `docs/v2/ARCH_OVERVIEW.md` | Architecture entry point |
| `docs/v2/DEVELOPMENT_WORKFLOW.md` | Development commands and platform rules |
| `docs/v2/PRODUCTION_DEPLOYMENT.md` | Canonical NAS production deployment workflow |
| `docs/v2/TEST_ARCHITECTURE.md` | Test commands and flow catalog |
| `docs/v2/DEBUG_WORKFLOW.md` | Debug entry points and diagnostics |
| `tests/TEST_ENV_CHECKLIST.md` | Local private test credentials, ignored by git |

Do not add generated `media-service/dist/`, root debug dumps, runtime JSON, or old PRD/restructure scripts back to the repo.

## Development Commands

```bash
# Service
cd media-service && npm install
cd media-service && npm start        # port 18080
cd media-service && npm test         # Fastify inject tests
cd media-service && npm run build:web

# Desktop
cd media-desktop && npm install
cd media-desktop && npm test
cd media-desktop && npm run dist:win

# Docker
docker build -t shelfdeck media-service/
docker compose -f media-service/docker-compose.example.yml up -d

# Production NAS deploy
bash scripts/build-image.sh <tag>
node scripts/deploy-nas.js /vol1/1000/docker/shelfdeck/shelfdeck-<tag>.tar --sha256 <local-sha256>
node scripts/deploy-nas.js /vol1/1000/docker/shelfdeck/shelfdeck-<tag>.tar --sha256 <local-sha256> --apply

# Transcode worker node
cd media-worker && npm install && npm start

# E2E flows
bash tests/runner.sh all tests/env/docker-fn.env
```

Do not run `npm run dev` as a long-running blocking command from Codex. Tell the user to run it manually when an interactive dev server is needed.

`MEDIA_SERVICE_URL` / `CONTROL_PLANE_URL` point desktop to service. Default is `http://127.0.0.1:18080`. Vite variants use the `VITE_` prefix.

## Debug First

Before debugging any runtime issue, read these two files first:

| File | Contents |
| --- | --- |
| `tests/TEST_ENV_CHECKLIST.md` | NAS SSH credentials, Emby API key, MoviePilot token, test library and movie list |
| `docs/v2/DEBUG_WORKFLOW.md` | Diagnostic layers, decision trees, `tools/ssh-exec.js` usage |

Known test endpoints:

| Resource | Address | Credential/tool |
| --- | --- | --- |
| SSH NAS | `192.168.12.230:22` | `node tools/ssh-exec.js <cmd>` |
| Emby | `http://192.168.12.45:8096` | API key in `tests/TEST_ENV_CHECKLIST.md` |
| MoviePilot | `http://192.168.12.230:3000` | Token in `tests/TEST_ENV_CHECKLIST.md` |
| ShelfDeck Docker | `http://192.168.12.230:18080` | none |
| ShelfDeck local | `http://127.0.0.1:18080` | none |

Production safety:

- Canonical production deployment is `docs/v2/PRODUCTION_DEPLOYMENT.md` plus `scripts/build-image.sh` and `scripts/deploy-nas.js`.
- A direct user request to deploy, release, publish, or upgrade NAS production authorizes the full standard deploy flow, including `deploy-nas.js --apply` after dry run and checksum validation pass.
- The fixed deployment flow exists to avoid wasting time trying alternate deployment methods. This is a development production environment, so `deploy-nas.js` may recreate the container even when `ffmpeg` jobs are running; it should print those jobs for awareness but not block on them.
- The NAS ShelfDeck Docker at `192.168.12.230:18080` is production. Do not delete/park tasks, change production data, or switch deployment methods unless the user explicitly asks for that production action.
- Use local `127.0.0.1:18080`, temporary data directories, or disposable worker containers for destructive testing and environment resets.
- Local ShelfDeck runtime data under `media-service/data/*.json` is test-only and has no preservation value. For local environment resets, it is OK to clear/recreate local task JSON and other local runtime JSON as needed.

Task admission contract:

- All automatic task creation must use the unified `TaskAdmission` model. This includes SmartTask recommendations, ingest-followed scrape, and any future background source. There must not be a separate adult-library-only auto-enqueue path; adult folder scan/watch must not create tasks.
- `smartTaskEnabledActions` is the global allow-list for automatic task types. If a task type is not enabled there, background automation must not create that action type.
- Manual user actions may bypass the automatic allow-list as explicit intent, but should still keep safety checks such as duplicate active-task prevention.

`tests/TEST_ENV_CHECKLIST.md` contains credentials and is intentionally ignored by git.

## Code Structure

### `media-service/src/`

```text
server.js              # Entry point, tray require, shutdown
app.js                 # Fastify routes: /v1/* and /v1/admin/*
taskScheduler.js       # 5s polling, itemId lock, dispatch to flow executors
taskStore.js           # Task persistence: data/tasks.json
configStore.js         # Config persistence: data/config.json
mediaLibraryService.js # Library and subLibrary management
mediaPolicyService.js  # Pure policy function
doubanMatchService.js  # Title keyword matching
deleteFlowExecutor.js
transcodeFlowExecutor.js
upgradeFlowExecutor.js
services/embyService.js
services/doubanService.js
services/transcodeService.js
services/moviepilotService.js
tray.js                # Windows tray; optional on Linux/Docker
```

### `media-desktop/`

```text
electron/main.js
electron/preload.js
electron/shelfdeckConnection.js
src/App.tsx
src/connection/*
src/api/*
```

Runtime data is ignored: `media-service/data/*.json`.

### `media-worker/`

```text
src/server.js      # Worker HTTP API: jobs, source upload, status, output download
src/config.js      # Runtime config defaults and env overrides
src/admin.html     # Minimal worker config page
```

Worker runtime config is ignored: `media-worker/config.json`.

## Platform Rules

- Use `process.platform === 'linux'` for Docker/Linux-specific behavior.
- Keep Windows-only tray code behind `process.platform === 'win32'` or optional `try/catch require`.
- Use `path.join()` plus configurable roots for paths. Do not hardcode user-specific paths.
- Windows-only packages belong in `optionalDependencies` so Docker can install with `--omit=optional`.
- Docker FFmpeg paths come from `FFMPEG_PATH` and `FFPROBE_PATH`.

## API Conventions

- JSON in and out.
- GET must have no side effects.
- PATCH should be idempotent partial update.
- Error shape: `{ error: { code: "ERROR_CODE", message: "..." } }`.
- Status codes: 200/201 ok, 400 validation, 401 auth, 404 not found, 409 conflict, 500 internal, 502 upstream.
- `GET /v1/health` is public. Other protected APIs use `X-Api-Key`.
- Desktop APIs are under `/v1/*`; admin web APIs are under `/v1/admin/*`.

When changing API, config, scheduler, or flow behavior, update the relevant tests and `docs/v2/ARCH_OVERVIEW.md` if the architectural contract changes.

## Constraints

- Node.js >= 20.
- No workarounds or silent fallbacks when debugging. Find the precise root cause and fix it.
- Verify impact across service Windows, service Docker, and desktop Windows according to `docs/v2/DEVELOPMENT_WORKFLOW.md`.
- Be honest about tests: passing tests are evidence, not proof. See `docs/v2/TEST_ARCHITECTURE.md`.
- Code, comments, and commits are English. Docs are Chinese with English technical terms where appropriate.
