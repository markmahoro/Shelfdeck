# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ShelfDeck** (媒体库管家) is a media library management platform with two logical components:
- **service** (胖服务): Node.js/Fastify HTTP service — task execution engine, media library management, Emby/Douban integration, built-in React admin web
- **desktop** (瘦客户端): Electron + Vite/React desktop client — intent submission, media library browsing, task card UI

These map to two physical processes:
- `media-service` — Fastify HTTP service (port 18080), embedded Windows tray module (`src/tray.js`)
- `media-desktop` — Electron main + renderer

> The tray is no longer a separate process. It's a lightweight module inside media-service (using `systray2`). On startup, service spawns a tray icon with health indicator and right-click menu ("打开管理页面" / "退出"). Exiting the tray stops the service. The old `media-tray-supervisor` (Electron-based) is deprecated.

**Product positioning** (ARCH_OVERVIEW §8): 媒体库管家 = 资产盘点 + 推荐消费 + 空间管理 + 发现缺口. The core competitive advantage is user-private data (ratings, watch records, personal tags) — content metadata (Emby/TMDB) is infrastructure, not differentiation.

## Development Commands

### Media Service (media-service/)
```bash
cd media-service
npm install
npm start          # Start service (default port 18080)
npm run dev        # Start with --watch
npm test           # Run API tests
```

### Desktop Client (media-desktop/)
```bash
cd media-desktop
npm install
npm run dev        # Start Vite + Electron in development
npm run build      # Build renderer
npm start          # Start in production mode
npm run dist:win   # Build Windows portable executable
```

**Important**: Desktop requires media-service running. Set `MEDIA_SERVICE_URL` or `CONTROL_PLANE_URL` (synonyms) to point to the service (default: `http://127.0.0.1:18080`). For Vite renderer, use `VITE_MEDIA_SERVICE_URL` or `VITE_CONTROL_PLANE_URL`.

### Tray Module (embedded in media-service)

The tray is part of `media-service` — no separate process. When the service starts, a system tray icon appears with:
- Health indicator (green/yellow/red tray icon)
- Right-click menu: "打开管理页面" (opens admin web in browser), "退出" (stops service + removes tray icon)

Health is polled every 3s via `GET /v1/health`. Icon assets are in `media-service/assets/tray/`.

The old `media-tray-supervisor/` directory (Electron-based) is deprecated and no longer used.

### OpenAPI Validation
```bash
npx --yes @redocly/cli lint docs/archive/api/openapi.yaml --config docs/archive/api/redocly.yaml
```

## Architecture

### Component Boundaries (ARCH_OVERVIEW §1)

All cross-component communication is **HTTP REST**. No IPC (except `emby:launchPlayer` for spawning external player).

| Component | Role | Data ownership |
|---|---|---|
| **service** | Task execution engine, media library, Emby/Douban integration, admin web | Task queue (SSOT), config (SSOT), media library table (SSOT), Emby connection |
| **desktop** | Intent submission, task card UI, media library browsing | service address (electron-store), read-only access to all service data |
| **tray** | Embedded in service process — system tray icon, health indicator, quit handler | None (part of service process) |

### Process Model (ARCH_OVERVIEW §2)

```
User clicks desktop shortcut
    └── desktop process starts (independent)
            └── connects to service via HTTP (or shows guidance if unavailable)

User clicks service shortcut (or starts service)
    └── service process starts → tray icon appears in system tray
            └── exit via tray menu → service process terminates
```

- **desktop independent**: does not require service to launch; shows guidance when disconnected
- **service self-contained**: tray is part of the service process; exiting the tray stops the service

### Data Flow (ARCH_OVERVIEW §3)

**Intent submission (desktop → service)**:
```
desktop → POST /v1/tasks { itemId, actionType } → service
    → TaskStore.createTask() → TaskScheduler picks up → Flow Executor runs
```

**Progress polling (service → desktop)**:
```
desktop polls GET /v1/tasks (400ms interval) → TaskStore returns task list (status, progress, phase)
```

**State ownership**: All task state, config, media library data owned by service. Desktop reads only.

### TaskScheduler + Flow Executors (SERVICE.md §2, TASK_SCHEDULER.md)

TaskScheduler and Flow Executors are **peer modules** with bidirectional API contracts:

```
TaskScheduler (taskScheduler.js)
    ├── Scheduling: itemId lock check → actionType slot check → executionMode check
    ├── Routing: dispatches by actionType to the corresponding Flow Executor
    │
    ├──→ DeleteFlowExecutor (deleteFlowExecutor.js)
    ├──→ TranscodeFlowExecutor (transcodeFlowExecutor.js)
    └──→ UpgradeFlowExecutor (upgradeFlowExecutor.js)
```

**Scheduler ↔ Flow API contract**:

| Direction | API | Purpose |
|---|---|---|
| Scheduler → Flow | `flow.drive(resumePoint)` | Start or resume execution |
| Scheduler → Flow | `flow.pause()` / `flow.cancel()` | User pause / cancel |
| Flow → Scheduler | `scheduler.pauseForConfirm(taskId, resumePoint)` | Flow needs user confirmation |
| Flow → Scheduler | `scheduler.reportStatus(taskId, status, progress?)` | Status change notification |
| confirm API → Flow | `flow.confirmReceived()` | User confirmed, resume from resumePoint |

**Status / phase separation**:
- `status` (scheduler-managed): `pending_manual` | `queued` | `executing` | `paused` | `awaiting_user_confirm` | `interrupted` | `done` | `failed_hard`
- `phase` (Flow-managed): Each Flow defines its own phases (e.g., `transcode_precheck`, `transcode_encoding`, `transcode_replace`)
- Scheduler only reads/writes `status`; Flow Executor only reads/writes `phase`; TaskStore persists both

**Scheduling check (three-tier)**: itemId lock → actionType slot (concurrency) → executionMode (auto/manual)

**Concurrency protection** (TASK_SCHEDULER §5):
- `runningTasks` Set: prevents re-entry within same polling round
- `recoverInterruptedTasks()`: on startup, demotes interrupted tasks
- `itemId` lock: only one flow per itemId across all actionTypes

**Scheduling interval**: 5s polling

### Media Library (MEDIA_LIBRARY.md)

MediaLibraryService maintains a unified persistence table (`data/library.json`) containing all media data, Douban ratings, and user ratings.

```
mediaLibraryService.js (coordinator)
    ├── EmbyAdapter (embyService.js) — pulls media data per subLibrary on independent timers
    ├── DoubanAdapter (doubanService.js) — syncs Douban ratings (title keyword matching via doubanMatchService.js)
    ├── mediaPolicyService.js (pure function) — computes action/reason from rating + policy
    └── upsertItems() / updateUserRating() / getLibrary() — CRUD on library.json
```

**SubLibrary model**: Each subLibrary has its own Emby server, section, refresh timer (1h), Douban sync toggle + timer (6h), and independent `mediaPolicy`.

**Strategy calculation**:
```
effectiveRating = doubanRating ?? userRating ?? null
recommendedAction(item, subLibrary.mediaPolicy) → { action: delete|transcode|upgrade|keep, reason }
```

**Principle**: write first, then recalculate strategy only for affected items (not full table).

**Douban matching**: Title keyword matching via `doubanMatchService.js` — NFKC normalization, `/` split, longest-key-first lookup. No pre-associated `doubanId`.

### Admin Web (ADMIN_WEB.md)

Service includes a built-in React management page served from `dist/admin/`:

| Page route | Function | API domain |
|---|---|---|
| `/media-libraries` | SubLibrary CRUD + add wizard | `/v1/admin/sublibraries/*` |
| `/transcode` | Transcode settings + device pool | `/v1/admin/transcode/*` |
| `/tasks` | Task monitoring (list + detail + logs) | `/v1/admin/tasks/*` |
| `/emby` | Emby connection config (deprecated) | `/v1/admin/emby/*` |

Admin API (`/v1/admin/*`) is separated from desktop API (`/v1/*`) but both share the same internal service modules.

### Health Check (HEALTH_CHECK.md)

Four check items aggregated to green/yellow/red:

| Check | Meaning | Green criteria |
|---|---|---|
| `service` | Process alive | Always green if responding |
| `config` | Configuration integrity | All required fields present |
| `emby` | Emby server connectivity | `GET /System/Info` responds <2s |
| `scheduler` | TaskScheduler running | Polling loop active |

**Aggregation**: green = all green; yellow = ≥1 yellow, no red; red = ≥1 red.

Two endpoints: `GET /v1/health` (public, aggregate only) and `GET /v1/admin/health` (admin, full detail).

### Configuration (CONFIG.md)

ConfigStore holds all service-side config as SSOT (`data/config.json`). Desktop reads via `GET /v1/config`, admin web writes via `PATCH /v1/config`.

Major config domains:
- **TaskScheduler**: `executionMode`, `*Concurrency`, `wallRatingAutoEnqueue`
- **Transcode**: `transcodeTempRoot`, `transcodeEncodingDevices[]`, `ffmpegPath`, CPU slot/strategy
- **Upgrade (MoviePilot)**: `moviepilot.{baseUrl,apiKey}`, `upgradeStagingLocalPath`, retry settings
- **Emby servers**: `embyServers` map (multi-server, keyed by uuid), with `baseUrl`, `apiKey`, `userId`
- **SubLibraries**: `subLibraries[]` with per-subLibrary `mediaPolicy`, `doubanEnabled`, `sectionId`
- **Douban**: `douban.{userId,cookieHeader}`
- **MediaPolicy** (global): deprecated; use subLibrary-level `mediaPolicy` instead

## Documentation Structure

All active documentation lives under `docs/v2/`. Historical (v1) documentation is archived in `docs/archive/`.

```
docs/
├── v2/                    # Active documentation (SSOT)
│   ├── DOC_GOVERNANCE.md  # Documentation governance and index
│   ├── ARCH_OVERVIEW.md   # System architecture overview
│   └── design/
│       ├── SERVICE.md     # Service design overview
│       ├── SERVICE/
│       │   ├── API.md                    # REST API contract (SSOT for HTTP paths/models/errors)
│       │   ├── CONFIG.md                 # Configuration fields and path mapping
│       │   ├── TASK_SCHEDULER.md         # Task scheduling engine (SSOT for scheduling behavior)
│       │   ├── DELETE_FLOW.md            # Delete flow executor
│       │   ├── TRANSCODE_FLOW.md         # Transcode flow executor
│       │   ├── UPGRADE_FLOW.md           # Upgrade flow executor
│       │   ├── TRANSCODE.md              # Transcode execution layer
│       │   ├── MEDIA_LIBRARY.md          # Media library management (SSOT for library behavior)
│       │   ├── MEDIA_LIBRARY/
│       │   │   ├── EMBY_ADAPTER.md       # Emby adapter design
│       │   │   └── DOUBAN_ADAPTER.md     # Douban adapter design
│       │   ├── HEALTH_CHECK.md           # Health check design
│       │   ├── ADMIN_WEB.md              # Admin web overview
│       │   └── ADMIN_WEB/
│       │       ├── API.md               # Admin API endpoints (SSOT for admin)
│       │       └── PAGES.md             # Admin page structure
│       ├── DESKTOP.md     # Desktop client design
│       ├── DESKTOP/
│       │   ├── UI.md                     # UI components and layout
│       │   ├── API_CLIENT.md             # REST API client layer
│       │   ├── CONNECTION.md             # Service connection management
│       │   └── SETTINGS.md               # Configuration persistence
│       ├── TRAY.md        # Tray module design (embedded in service)
│       ├── TRAY/
│       │   └── LIFECYCLE.md              # Tray lifecycle (embedded in service process)
│       ├── SHARED.md      # Shared design
│       └── SHARED/
│           ├── DATA_FLOW.md              # Intent submission + polling mechanism
│           ├── DATA_MODEL.md             # Core data model
│           └── ERROR_HANDLING.md         # Error codes and degradation strategy
└── archive/               # Historical v1 documentation (read-only reference)
    ├── api/               # Old API docs and OpenAPI spec
    ├── design/            # Old design docs
    ├── dev/               # Old dev guides
    └── ...
```

**Documentation index**: `docs/v2/DOC_GOVERNANCE.md` is the single entry point for all active documentation.

### Key Documents
- `docs/v2/DOC_GOVERNANCE.md` — Documentation governance and index (SSOT)
- `docs/v2/ARCH_OVERVIEW.md` — System architecture overview
- `docs/v2/design/SERVICE.md` — Service design overview (胖服务)
- `docs/v2/design/SERVICE/API.md` — REST API contract (SSOT for HTTP paths/models/errors)
- `docs/v2/design/SERVICE/TASK_SCHEDULER.md` — Task scheduling engine (SSOT for scheduling behavior)
- `docs/v2/design/SERVICE/CONFIG.md` — Configuration fields and path mapping
- `docs/v2/design/SERVICE/MEDIA_LIBRARY.md` — Media library management (SSOT for library behavior)
- `docs/v2/design/SERVICE/HEALTH_CHECK.md` — Health check design (Phase 4)
- `docs/v2/design/SERVICE/ADMIN_WEB.md` — Admin web overview
- `docs/v2/design/SERVICE/ADMIN_WEB/API.md` — Admin API endpoints (SSOT for admin)
- `docs/v2/design/DESKTOP.md` — Desktop client design
- `docs/v2/design/TRAY.md` — Tray module design (embedded in service)
- `docs/v2/design/SHARED/DATA_MODEL.md` — Shared data model
- `docs/v2/design/SHARED/DATA_FLOW.md` — Intent submission + polling mechanism
- `docs/v2/design/SHARED/ERROR_HANDLING.md` — Error codes and degradation strategy
- `docs/archive/dev/DEV_SETUP.md` — Local development setup (v1, still applicable)

### SSOT Conflict Resolution
When conflicts arise between documents:
1. Product scope and user stories: `docs/v2/design/` documents
2. Task scheduling executable behavior: `docs/v2/design/SERVICE/TASK_SCHEDULER.md` + Flow documents (DELETE_FLOW, TRANSCODE_FLOW, UPGRADE_FLOW)
3. HTTP paths, models, error codes: `docs/v2/design/SERVICE/API.md` + `docs/v2/design/SERVICE/ADMIN_WEB/API.md`
4. Configuration field definitions: `docs/v2/design/SERVICE/CONFIG.md`
5. If API conflicts with design documents: update documents to align first, then update code

## Code Patterns

### Environment Variables
- `MEDIA_SERVICE_URL` / `CONTROL_PLANE_URL` — synonyms for media-service base URL
- `VITE_MEDIA_SERVICE_URL` / `VITE_CONTROL_PLANE_URL` — Vite-specific variants
- `MEDIA_SERVICE_API_KEY` / `CONTROL_PLANE_API_KEY` — optional API key
- Priority: environment variables override desktop-persisted configuration

### Desktop Client Structure
- `media-desktop/electron/main.js` — Main process, registers IPC handlers (only `emby:launchPlayer`)
- `media-desktop/electron/preload.js` — Preload script, exposes `window.embyApi` and `window.doubanApi` (implementations use `fetch()` to service)
- `media-desktop/electron/shelfdeckConnection.js` — Connection management (Phase 3: electron-store based, no longer reads tray-written file)
- `media-desktop/src/App.tsx` — Main React component
- `media-desktop/src/mediaServiceHealth.ts` — Health check logic (polls `GET /v1/health`)
- `media-desktop/src/cpBase.ts` — Base URL resolution

### Media Service Structure
- `media-service/src/server.js` — Entry point
- `media-service/src/app.js` — Fastify app setup, route registration
- `media-service/src/taskScheduler.js` — TaskScheduler (scheduling + routing to Flow Executors)
- `media-service/src/deleteFlowExecutor.js` — DeleteFlowExecutor
- `media-service/src/transcodeFlowExecutor.js` — TranscodeFlowExecutor
- `media-service/src/upgradeFlowExecutor.js` — UpgradeFlowExecutor (currently stub)
- `media-service/src/taskStore.js` — Task persistence (`data/tasks.json`)
- `media-service/src/configStore.js` — Configuration persistence (`data/config.json`)
- `media-service/src/mediaLibraryService.js` — Media library coordinator (subLibrary management, timers, upsert)
- `media-service/src/mediaPolicyService.js` — Pure function: `recommendedAction(item, policy) → { action, reason }`
- `media-service/src/doubanMatchService.js` — Douban title keyword matching (NFKC, split, longest-key-first)
- `media-service/src/services/embyService.js` — EmbyAdapter: Emby REST API integration
- `media-service/src/services/doubanService.js` — DoubanAdapter: Douban API integration
- `media-service/src/services/transcodeService.js` — Transcode execution layer (FFmpeg)

### Tray Module Structure
- `media-service/src/tray.js` — Tray module (systray2), health polling, context menu, embedded in service process
- `media-service/assets/tray/` — Tray icons (status-running.ico, status-unhealthy.ico, status-stopped.ico)
- `media-tray-supervisor/` — **Deprecated** (Electron-based, replaced by embedded tray module)

### REST API Conventions (API.md §1-§3)
- All endpoints return JSON; `GET` has no side effects; `PATCH` is idempotent partial update
- Error format: `{ error: { code: "ERROR_CODE", message: "..." } }`
- HTTP status codes: 200/201 success, 400 validation, 401 auth, 404 not found, 409 conflict, 500 internal, 502 upstream unreachable
- Optional `X-Api-Key` header authentication (except `GET /v1/health` which is always public)
- Two endpoint domains: `/v1/*` (desktop) and `/v1/admin/*` (admin web); both share internal modules

### Runtime Data Files
- `data/tasks.json` — Task queue (TaskStore)
- `data/config.json` — Configuration (ConfigStore)
- `data/library.json` — Media library table (MediaLibraryService); v2 target, migrating from v1 `cache.json`

## Testing

### Media Service Tests
```bash
cd media-service
npm test  # Runs test/api-inject.test.js using Fastify inject (no port needed)
```

### Smoke Tests
```bash
cd media-tray-supervisor
npm run smoke  # Test spawn + health check
```

## Important Constraints

- **Node.js version**: >=20 (see package.json engines)
- **Target platform**: Windows (tray module is Windows-specific, uses systray2)
- **Desktop requires service**: Desktop client cannot function without media-service running and healthy
- **Service + tray lifecycle**: Tray is part of service process; starting service shows tray icon, exiting tray stops service
- **No long-running commands**: Never use `npm run dev` or watch mode commands in Bash tool — these block execution. Recommend user runs them manually.
- **Runtime data**: `media-service/data/*.json` files are runtime state, not documentation. Should be in .gitignore (except examples).
- **No workarounds**: 测试或运行中遇到问题，禁止使用 workaround / 绕过 / 兜底 / 降级 的方式规避。必须排查到精准根因并修复。Workarounds mask bugs and accumulate technical debt.

## Common Workflows

### Starting Full Stack for Development
1. Terminal A: `cd media-service && npm start`
2. Terminal B: `cd media-desktop && npm run dev`

### Simulating Remote Service
Set `MEDIA_SERVICE_URL` to a network-accessible address (e.g., NAS IP). Desktop will connect to that URL.

### Adding New REST Endpoints
1. Update `docs/v2/design/SERVICE/API.md` (or `ADMIN_WEB/API.md` for admin endpoints) with the new endpoint
2. Implement in `media-service/src/app.js` or relevant service module
3. Update desktop client to call new endpoint if needed

### Modifying Task Scheduler / Flow Behavior
1. Check `docs/v2/design/SERVICE/TASK_SCHEDULER.md` for scheduling behavior (SSOT)
2. Check the relevant Flow document (`DELETE_FLOW.md`, `TRANSCODE_FLOW.md`, `UPGRADE_FLOW.md`)
3. Update design document first if behavior changes
4. Implement changes in the relevant Flow Executor or TaskScheduler
5. Update `docs/v2/design/SERVICE/API.md` if REST API changes
6. Update desktop UI if needed

### Adding a New SubLibrary
1. User navigates to admin web → 媒体库 → 添加子库
2. Wizard: register Emby server → select user → select media folder → configure Douban toggle + mediaPolicy
3. Admin API: `POST /v1/admin/sublibraries` → creates subLibrary config + starts independent refresh timer

## Language and Localization

- User-facing Chinese text follows guidelines in `docs/archive/design/DESIGN_DESKTOP_UI_COPY.md`
- Code, comments, and commit messages use English
- Documentation uses Chinese (this is a Chinese-language project)
- Technical terms (REST, API, OpenAPI, Flow, SSOT, etc.) remain in English even in Chinese docs
