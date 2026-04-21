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
npx --yes @redocly/cli lint docs/api/openapi.yaml --config docs/api/redocly.yaml
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

All documentation follows strict naming conventions with English prefixes:
- `REQ_*` - Requirements
- `DESIGN_*` - Detailed design/behavior specs
- `ARCH_*` - Architecture
- `ADR_*` - Architecture decision records
- `API_README.md` + `openapi.yaml` - REST API contract (SSOT for HTTP shapes)
- `DEV_*` - Development guides
- `TEST_*` - Testing
- `OPS_*` - Operations
- `USER_*` - User guides
- `PRJ_*` - Project management

**Documentation index**: `docs/DOC_GOVERNANCE.md` is the single entry point for all documentation.

### Key Documents
- `docs/DOC_GOVERNANCE.md` - Documentation governance and index (SSOT)
- `docs/dev/DEV_SETUP.md` - Local development setup
- `docs/api/API_README.md` - API overview and IPC→REST mapping
- `docs/api/openapi.yaml` - REST API contract (SSOT for HTTP paths/models)
- `docs/design/DESIGN_TASK_CENTER.md` - Task center behavior (SSOT for task scheduling)
- `docs/design/DESIGN_CONFIG_AND_PATHS.md` - Configuration fields and path mapping
- `docs/design/DESIGN_DESKTOP_BACKEND_ENDPOINT.md` - Desktop connection endpoint resolution
- `docs/design/DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md` - Tray supervisor behavior
- `docs/requirements/REQ_PRODUCT_BASELINE_v1.0.0.md` - Product requirements baseline

### SSOT Conflict Resolution
When conflicts arise between documents:
1. Product scope and user stories: `REQ_*` files
2. Task center executable behavior: `DESIGN_TASK_CENTER.md`
3. HTTP paths, models, error codes: `openapi.yaml`
4. If OpenAPI conflicts with REQ/DESIGN: update documents to align first, then update code

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
1. Update `docs/api/openapi.yaml` with new endpoint
2. Run OpenAPI lint to validate
3. Implement in `media-service/src/app.js` or relevant service module
4. Update `docs/api/API_README.md` if adding new IPC→REST mapping
5. Update desktop client to call new endpoint

### Modifying Task Center Behavior
1. Check `docs/design/DESIGN_TASK_CENTER.md` for current behavior (SSOT)
2. Update DESIGN document first if behavior changes
3. Implement changes in media-service task scheduling logic
4. Update OpenAPI if REST API changes
5. Update desktop UI if needed

## Language and Localization

- User-facing Chinese text follows guidelines in `docs/design/DESIGN_DESKTOP_UI_COPY.md`
- Code, comments, and commit messages use English
- Documentation uses Chinese (this is a Chinese-language project)
- Technical terms (REST, API, OpenAPI, Flow, etc.) remain in English even in Chinese docs
