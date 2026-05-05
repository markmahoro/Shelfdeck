# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ShelfDeck** (媒体库管家) — media library management with 3 deployment targets:

| Target            | Dir              | Runtime                | Key differences                                    |
| ----------------- | ---------------- | ---------------------- | -------------------------------------------------- |
| service (Windows) | `media-service/` | Node.js, systray2 tray | ffmpeg-static, Win paths, optionalDep:systray2     |
| service (Docker)  | `media-service/` | Container, no tray     | linuxserver/ffmpeg, Linux paths, `--omit=optional` |
| desktop (Windows) | `media-desktop/` | Electron portable exe  | bundled ffmpeg, HTTP client only                   |

> Architecture details: `docs/v2/ARCH_OVERVIEW.md`. Subsystem design docs: `docs/v2/design/`.

## Development Commands

```bash
# Service
cd media-service && npm install && npm start     # port 18080
cd media-service && npm test                     # Fastify inject tests

# Desktop
cd media-desktop && npm install && npm run dev   # Vite + Electron
cd media-desktop && npm run dist:win             # Build portable exe

# Docker
docker build -t shelfdeck media-service/
docker compose -f media-service/docker-compose.yml up -d

# E2E tests
bash tests/runner.sh all tests/env/docker-fn.env
```

`MEDIA_SERVICE_URL` / `CONTROL_PLANE_URL` point desktop to service (default `http://127.0.0.1:18080`). Vite uses `VITE_` prefix variants.

## Debug / 排查 — 启动时必须知道

**排查任何问题前，第一步永远是读这两个文件，里面有完整的凭据和访问方式：**

| 文件 | 内容 |
|------|------|
| `tests/TEST_ENV_CHECKLIST.md` | NAS SSH 凭据、Emby API Key、MoviePilot token、测试库/影片清单 |
| `docs/v2/DEBUG_WORKFLOW.md` | 排查工具箱（4层API）、决策树、`tools/ssh-exec.js` 用法 |

**测试环境速览（无需再问用户）：**

| 资源 | 地址 | 凭据/工具 |
|------|------|----------|
| SSH 飞牛NAS | `192.168.12.230:22` | `node tools/ssh-exec.js <cmd>` |
| Emby | `http://192.168.12.45:8096` | API Key `34c460bc24b94ac99d6a19ca9ebc0925` |
| MoviePilot | `http://192.168.12.230:3000` | Token `OKFEfZeEt7sfZhc5AExW0A` |
| ShelfDeck Docker | `http://192.168.12.230:18080` | — |
| ShelfDeck 本地 | `http://127.0.0.1:18080` | — |

> 注意：`tests/TEST_ENV_CHECKLIST.md` 含凭据，已在 `.gitignore` 中，不会提交。

## Code Structure

### media-service/src/

```
server.js              # Entry point, tray require + shutdown
app.js                 # Fastify routes (desktop /v1/*, admin /v1/admin/*)
taskScheduler.js       # 5s polling, itemId lock, dispatch to Flow Executors
taskStore.js           # Task persistence (data/tasks.json)
configStore.js         # Config persistence (data/config.json)
mediaLibraryService.js # SubLibrary management, refresh coordinators
mediaPolicyService.js  # Pure function: recommendedAction(item, policy) → { action, reason }
doubanMatchService.js  # Title keyword matching (NFKC, split, longest-key-first)

# Flow Executors (peers of TaskScheduler)
deleteFlowExecutor.js
transcodeFlowExecutor.js
upgradeFlowExecutor.js

# External adapters
services/embyService.js        # Emby REST API client
services/doubanService.js      # Douban API client
services/transcodeService.js   # FFmpeg execution layer
services/moviepilotService.js  # MoviePilot REST API client

# Windows-only
tray.js   # systray2, health polling, right-click menu
```

### media-desktop/

```
electron/main.js                  # Main process, IPC handlers
electron/preload.js               # window.embyApi / window.doubanApi
electron/shelfdeckConnection.js   # Connection management (electron-store)
src/App.tsx                       # Main React component
src/cpBase.ts                     # Service URL resolution
```

### Runtime data files (in .gitignore)

- `data/tasks.json`, `data/config.json`, `data/library.json`

## Platform Guards Reference

```js
// Docker default paths (Linux)
configStore.js: transcodeTempRoot: process.platform === 'linux' ? '/transcode' : ''
configStore.js: upgradeStagingLocalPath: process.platform === 'linux' ? '/upgrade' : ''

// Tray graceful absence on Docker
server.js: try { startTray = require('./tray').startTray; } catch (_) { /* normal on Linux */ }

// Tray browser open (Windows-only)
tray.js: process.platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`

// FFmpeg path override (Docker uses system ffmpeg)
Dockerfile: ENV FFMPEG_PATH=/usr/local/bin/ffmpeg FFPROBE_PATH=/usr/local/bin/ffprobe
transcodeService.js: const ffmpegPath = String(process.env.FFMPEG_PATH || '').trim();

// Docker excludes Windows-only optional deps
Dockerfile: RUN npm ci --omit=dev --omit=optional  # systray2 excluded
```

Rules for new guards:

- Use `process.platform === 'linux'` (not `!== 'win32'`) for Docker-specific behavior
- Windows tray code in try/catch require or behind `process.platform === 'win32'`
- Paths use `path.join()` with configurable roots, never hardcode

## REST API Conventions

- JSON in/out; GET has no side effects; PATCH is idempotent partial update
- Error: `{ error: { code: "ERROR_CODE", message: "..." } }`
- Status codes: 200/201 ok, 400 validation, 401 auth, 404 not found, 409 conflict, 500 internal, 502 upstream
- `X-Api-Key` header auth (except `GET /v1/health` which is public)
- Two domains: `/v1/*` (desktop) and `/v1/admin/*` (admin web)

> Full API contract SSOT: `docs/v2/design/SERVICE/API.md` + `docs/v2/design/SERVICE/ADMIN_WEB/API.md`

## Key Constraints

- **Node.js** >=20
- **No long-running commands**: Never `npm run dev` in Bash — blocks execution. Recommend user runs manually.
- **No workarounds**: 遇到问题禁止绕过/兜底/降级。排查到精准根因并修复。
- **3-Target Development**: Every feature verified on service-Win + service-Docker + desktop-Win before merge. See `docs/v2/DEVELOPMENT_WORKFLOW.md`.
- **Test honesty**: Do NOT claim "tests pass" covers correctness. See `docs/v2/TEST_ARCHITECTURE.md`.
- **Runtime data**: `media-service/data/*.json` in .gitignore (except examples).

## Workflow Reference

| When you need to...            | Follow                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Implement a new feature        | `docs/v2/DEVELOPMENT_WORKFLOW.md` — 3-Target Impact Checklist → patterns → test → merge              |
| Debug an issue                 | **先读** `tests/TEST_ENV_CHECKLIST.md`（凭据）→ `docs/v2/DEBUG_WORKFLOW.md` → 工具箱 → 决策树 → 根因 → 修复 |
| Cut a release                  | `docs/v2/RELEASE_WORKFLOW.md` — `node scripts/release.js vX.Y.Z` → CI builds → 3 manual wrap-up      |
| Write tests                    | `docs/v2/TEST_ARCHITECTURE.md` — 3 tiers, 21 cases, `tests/runner.sh all`                            |
| Change API                     | Update `docs/v2/design/SERVICE/API.md` first, then implement in `app.js`, then update desktop client |
| Change config                  | Update `docs/v2/design/SERVICE/CONFIG.md` first, then implement in `configStore.js`                  |
| Change scheduler/flow behavior | Update the SSOT Flow doc first, then implement in the executor                                       |

## Documentation Index

`docs/v2/DOC_GOVERNANCE.md` is the single entry point. Key SSOT documents:

| Domain              | SSOT Document                              |
| ------------------- | ------------------------------------------ |
| Architecture        | `docs/v2/ARCH_OVERVIEW.md`                 |
| REST API            | `docs/v2/design/SERVICE/API.md`            |
| Admin API           | `docs/v2/design/SERVICE/ADMIN_WEB/API.md`  |
| Task scheduling     | `docs/v2/design/SERVICE/TASK_SCHEDULER.md` |
| Config fields       | `docs/v2/design/SERVICE/CONFIG.md`         |
| Media library       | `docs/v2/design/SERVICE/MEDIA_LIBRARY.md`  |
| Health check        | `docs/v2/design/SERVICE/HEALTH_CHECK.md`   |
| Development process | `docs/v2/DEVELOPMENT_WORKFLOW.md`          |
| Debug process       | `docs/v2/DEBUG_WORKFLOW.md`                |
| Release process     | `docs/v2/RELEASE_WORKFLOW.md`              |
| Test architecture   | `docs/v2/TEST_ARCHITECTURE.md`             |

**SSOT conflict resolution**: Design docs > code. If API conflicts with design: update design docs first, then code.

## Language Conventions

- Code, comments, commits: English
- Docs: Chinese with English technical terms (REST, API, Flow, SSOT, etc.)
