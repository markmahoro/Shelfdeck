# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ShelfDeck** is a Windows desktop Emby client with three main components:
- **media-desktop**: Electron + Vite/React desktop client
- **media-service**: Node.js/Fastify HTTP service for media management
- **media-tray-supervisor**: Windows tray supervisor ("ShelfDeck 小助手") that monitors service health and manages lifecycle

The desktop client requires the media service to be running. The tray supervisor writes connection configuration that the desktop client reads (single source of truth pattern).

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

### Tray Supervisor (media-tray-supervisor/)
```bash
cd media-tray-supervisor
npm install
npm start          # Start tray supervisor
npm run smoke      # Smoke test for spawn + health check
```

Optional: Set `TRAY_MEDIA_SERVICE_ROOT` to absolute path of media-service directory (defaults to `../media-service`).

### OpenAPI Validation
```bash
npx --yes @redocly/cli lint docs/archive/api/openapi.yaml --config docs/archive/api/redocly.yaml
```

## Architecture

### Connection Model
- **Tray supervisor** has exclusive write access to connection configuration file
- **Desktop client** reads connection configuration (read-only, same source)
- Both monitor the same `effectiveBaseUrl` for health (yellow/green/red states)
- Health check: `GET /v1/health` (no authentication required)
- Desktop enforces strict gate: if service unavailable, shows guidance to use tray supervisor

### IPC → REST Migration
The desktop client has migrated from Electron IPC to HTTP REST calls to media-service. The `preload.js` still exposes `window.embyApi` and `window.doubanApi`, but implementations now use `fetch()` to call media-service endpoints. Only `emby:launchPlayer` remains as true IPC (spawning external player is desktop-specific).

### Task Center
Task center manages three action types: `delete`, `transcode`, `upgrade`. Each has:
- FIFO logical queue per action type
- Concurrency slots (`deleteConcurrency`, `transcodeConcurrency`, `upgradeConcurrency`)
- State machine (Flow) specific to the action type
- Scheduling layer that controls whether tasks can proceed

For `transcode` tasks, there's an additional resource pool layer that manages encoding device sub-slots (CPU/GPU).

### Configuration Paths
- Media-service holds the single source of truth for path mappings and transcode settings
- Desktop settings UI edits and saves via REST API (`GET/PATCH /v1/config`)
- Desktop does not maintain separate path mapping state
- Optional "local playback additional mapping" only when desktop and service run on different machines

## Documentation Structure

All active documentation lives under `docs/v2/`. Historical (v1) documentation is archived in `docs/archive/`.

```
docs/
├── v2/                    # Active documentation (SSOT)
│   ├── DOC_GOVERNANCE.md  # Documentation governance and index
│   ├── ARCH_OVERVIEW.md   # System architecture overview
│   └── design/
│       ├── SERVICE.md     # Service design overview
│       ├── SERVICE/       # Service sub-modules (API, CONFIG, TASK_CENTER, etc.)
│       ├── DESKTOP.md     # Desktop client design
│       ├── DESKTOP/       # Desktop sub-modules
│       ├── TRAY.md        # Tray supervisor design
│       ├── TRAY/          # Tray sub-modules
│       ├── SHARED.md      # Shared design (data model, error handling, etc.)
│       └── SHARED/
└── archive/               # Historical v1 documentation (read-only reference)
    ├── api/               # Old API docs and OpenAPI spec
    ├── design/            # Old design docs
    ├── dev/               # Old dev guides
    └── ...
```

**Documentation index**: `docs/v2/DOC_GOVERNANCE.md` is the single entry point for all active documentation.

### Key Documents
- `docs/v2/DOC_GOVERNANCE.md` - Documentation governance and index (SSOT)
- `docs/v2/ARCH_OVERVIEW.md` - System architecture overview
- `docs/v2/design/SERVICE.md` - Service design overview
- `docs/v2/design/SERVICE/API.md` - REST API contract
- `docs/v2/design/SERVICE/CONFIG.md` - Configuration fields and path mapping
- `docs/v2/design/SERVICE/TASK_CENTER.md` - Task center behavior (SSOT for task scheduling)
- `docs/v2/design/DESKTOP.md` - Desktop client design
- `docs/v2/design/TRAY.md` - Tray supervisor design
- `docs/v2/design/SHARED/DATA_MODEL.md` - Shared data model
- `docs/archive/dev/DEV_SETUP.md` - Local development setup (v1, still applicable)

### SSOT Conflict Resolution
When conflicts arise between documents:
1. Product scope and user stories: `docs/v2/design/` documents
2. Task center executable behavior: `docs/v2/design/SERVICE/TASK_CENTER.md`
3. HTTP paths, models, error codes: `docs/v2/design/SERVICE/API.md`
4. If API conflicts with design documents: update documents to align first, then update code

## Code Patterns

### Environment Variables
- `MEDIA_SERVICE_URL` / `CONTROL_PLANE_URL` - synonyms for media-service base URL
- `VITE_MEDIA_SERVICE_URL` / `VITE_CONTROL_PLANE_URL` - Vite-specific variants
- `MEDIA_SERVICE_API_KEY` / `CONTROL_PLANE_API_KEY` - optional API key
- Priority: environment variables override tray-written persistent configuration

### Desktop Client Structure
- `media-desktop/electron/main.js` - Main process, registers IPC handlers
- `media-desktop/electron/preload.js` - Preload script, exposes APIs to renderer
- `media-desktop/electron/shelfdeckConnection.js` - Connection file reader (read-only)
- `media-desktop/src/App.tsx` - Main React component
- `media-desktop/src/mediaServiceHealth.ts` - Health check logic
- `media-desktop/src/cpBase.ts` - Base URL resolution

### Media Service Structure
- `media-service/src/server.js` - Entry point
- `media-service/src/app.js` - Fastify app setup
- `media-service/src/services/embyService.js` - Emby integration
- `media-service/src/services/doubanService.js` - Douban integration
- `media-service/src/services/transcodeService.js` - Transcode operations
- `media-service/src/store.js` - State persistence

### Tray Supervisor Structure
- `media-tray-supervisor/electron/main.js` - Main process, tray icon, health monitoring
- `media-tray-supervisor/electron/trayPanel.js` - Left-click panel window
- `media-tray-supervisor/electron/shelfdeckConnection.js` - Connection file writer (exclusive write)

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
- **Target platform**: Windows (tray supervisor is Windows-specific)
- **Desktop requires service**: Desktop client cannot function without media-service running and healthy
- **Connection file ownership**: Only tray supervisor writes connection config; desktop reads only
- **No long-running commands**: Never use `npm run dev` or watch mode commands in Bash tool - these block execution. Recommend user runs them manually.
- **Runtime data**: `media-service/data/*.json` files are runtime state, not documentation. Should be in .gitignore (except examples).

## Common Workflows

### Starting Full Stack for Development
1. Terminal A: `cd media-service && npm start`
2. Terminal B: `cd media-tray-supervisor && npm start` (optional, for connection management)
3. Terminal C: `cd media-desktop && npm run dev`

### Simulating Remote Service
Set `MEDIA_SERVICE_URL` to a network-accessible address (e.g., NAS IP). Both tray supervisor and desktop will monitor that URL for health.

### Adding New REST Endpoints
1. Update `docs/v2/design/SERVICE/API.md` with new endpoint
2. Implement in `media-service/src/app.js` or relevant service module
3. Update desktop client to call new endpoint

### Modifying Task Center Behavior
1. Check `docs/v2/design/SERVICE/TASK_CENTER.md` for current behavior (SSOT)
2. Update design document first if behavior changes
3. Implement changes in media-service task scheduling logic
4. Update `docs/v2/design/SERVICE/API.md` if REST API changes
5. Update desktop UI if needed

## Language and Localization

- User-facing Chinese text follows guidelines in `docs/archive/design/DESIGN_DESKTOP_UI_COPY.md`
- Code, comments, and commit messages use English
- Documentation uses Chinese (this is a Chinese-language project)
- Technical terms (REST, API, OpenAPI, Flow, etc.) remain in English even in Chinese docs
