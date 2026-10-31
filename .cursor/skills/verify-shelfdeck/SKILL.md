---
name: verify-shelfdeck
description: "Drive ShelfDeck Admin Web and service HTTP on isolated Linux/Node or Linux/Docker. Use for /verify-shelfdeck, proving Helix Admin behavior, health/session checks, or any task that must exercise the real product path instead of unit proxies."
---

# verify-shelfdeck

Project-local verification skill for ShelfDeck. Agents read this cold mid-task.

Helix SSOT (`docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`) and production gates stay higher authority. This skill does **not** authorize production NAS deploy, Formation Reset on production, or any mutation of `192.168.12.230:18080`. Refuse those actions unless the human already authorized them outside this skill.

**Surface.** Admin Web (primary) + service HTTP. Linux / local Node and Linux Docker only. Windows desktop and Windows service are out of scope.

**Secrets.** Never copy values from `tests/TEST_ENV_CHECKLIST.md` into the skill, commits, chat, or evidence. That file may exist for operators. Verification uses a disposable key from `helix-clean-init` only. Keep the key in the private run dir. Redact it from artifacts.

## Launch

Prefer an isolated local Node run. Docker is optional when an image is already built.

1. Choose a run id and roots:

```bash
RUN_ID="vs-$(date -u +%Y%m%dT%H%M%SZ)-$$"
export VERIFY_SHELFDECK_RUN_DIR="${VERIFY_SHELFDECK_RUN_DIR:-/tmp/verify-shelfdeck-$RUN_ID}"
export VERIFY_SHELFDECK_EVIDENCE_DIR="${VERIFY_SHELFDECK_EVIDENCE_DIR:-$(git rev-parse --show-toplevel)/.cursor/skills/verify-shelfdeck/artifacts/health-admin-session/$RUN_ID}"
```

2. Install and build Admin Web once per machine (skip if already current):

```bash
cd media-service && npm install
cd media-service && npm run build:web
```

3. Launch via the helper (creates data dir, clean-init, binds `127.0.0.1` on an ephemeral port, writes run metadata):

```bash
bash .cursor/skills/verify-shelfdeck/bin/verify-shelfdeck launch
```

Ready means all of:

- Process PID in `$VERIFY_SHELFDECK_RUN_DIR/run.json` is alive and owns the recorded port on `127.0.0.1`.
- `GET /v1/health` returns HTTP 200 with `status` of `ok` (or legacy green/yellow/red) and a non-empty `generation` (current clean-init reports a `helix-clean-*` generation string).
- `helix-clean-init --readiness` reports `state: ready` for the run data dir.
- `GET /admin` returns 200 and HTML containing `id="root"` when Admin Web proof is in scope.

Do not treat a bare TCP accept as ready while clean-init or migrations are still running.

**Docker alternate** (only with a prebuilt image; this skill does not authorize NAS deploy):

```bash
# Same pattern as media-service/scripts/p14-beta-impl-02-docker-retest.js
# helix-clean-init inside the image → docker run -p 127.0.0.1:<port>:18080 → wait for /v1/health
```

Record the container name in `run.json` and stop/rm that name on cleanup. Never attach to a shared or production container.

## Doctor

Run first whenever anything looks off:

```bash
bash .cursor/skills/verify-shelfdeck/bin/verify-shelfdeck doctor
```

Doctor is read-only. It fails closed unless:

- `run.json` exists and was written by this skill for the current `VERIFY_SHELFDECK_RUN_DIR`.
- The recorded PID (or Docker container) is still the owner of `127.0.0.1:<port>`.
- Health JSON matches Launch ready criteria.
- `baseUrl` host is `127.0.0.1` (refuse `192.168.12.230` and any non-loopback target).

If doctor fails, stop driving. Clean up the run you started, then relaunch. Never double-drive a shared instance or an instance you did not launch.

## Drive

Map lives in `features/`. Read `features/README.md`, then the feature file. Prefer stable handles:

| Kind | Handle |
| --- | --- |
| Health | `GET {baseUrl}/v1/health` |
| Session exchange | `POST {baseUrl}/v1/admin/session` with header `x-api-key: <disposable adminApiKey>` → HTTP 204 and `Set-Cookie: shelfdeck_admin_session=...` |
| Authed probe | `GET {baseUrl}/v1/admin/settings/security` with the session cookie → HTTP 200 and `credentialConfigured: true` |
| Admin Web login | Heading `进入管理台`, label `管理凭据`, button `进入管理台` |
| Runner smoke | `bash tests/runner.sh health-check tests/env/ci.env` with `SERVICE_URL={baseUrl}` |
| US Adult recognition gate | `bash .cursor/skills/verify-shelfdeck/bin/verify-shelfdeck drive us-adult-recognition` → `cd media-service && bash scripts/us-adult-full-e2e.sh` |

HTTP session exchange is the primary programmable path for Admin HTTP features (matches `p14-beta-impl-02-docker-retest.js`). Browser login is the user-visible twin when Playwright/CDP is available.

Prove one mapped feature per run unless the task asks for more. Examples:

```bash
bash .cursor/skills/verify-shelfdeck/bin/verify-shelfdeck drive health-admin-session
bash .cursor/skills/verify-shelfdeck/bin/verify-shelfdeck drive us-adult-recognition
```

**US Adult recognition journey.** Map: `features/us-adult-recognition.md`. Drive always invokes the true gate `media-service/scripts/us-adult-full-e2e.sh` (or `npm run test:us-adult-full-e2e`). Do not invent a stub-green path. Observe-isolation alone is not acceptance. Claiming L2 green for SelectedImage AJV ingress and Host buffalo session lifecycle requires PR #53 (or equivalent) on the tip under test.

## Evidence

Write under `$VERIFY_SHELFDECK_EVIDENCE_DIR` (default under `.cursor/skills/verify-shelfdeck/artifacts/...`). Capture:

- The action (curl argv or browser steps) and the resulting state.
- Health JSON (no secrets).
- Session exchange status + whether `shelfdeck_admin_session` cookie was set (cookie value redacted).
- Authed security JSON with secrets masked.
- Feature id and entry point in `proof.json`.
- Optional Admin Web screenshot/ARIA when browser-driven.

Proof standards:

- Exercise the real user/admin path. Do not plant session state via internal setters or test-only endpoints.
- Side effects must match what the user would observe (cookie + authed GET, not only health).
- Mocks only where a production boundary already isolates an external provider.
- Never commit `private-runtime.json`, API keys, or `SHELFDECK_SECRET_ROOT`.

## Cleanup

```bash
bash .cursor/skills/verify-shelfdeck/bin/verify-shelfdeck cleanup
```

Cleanup rules:

- Kill only the PID or Docker container recorded in this run's `run.json`. Never kill by process name.
- Remove `$VERIFY_SHELFDECK_RUN_DIR` (data + private runtime).
- **Keep** `$VERIFY_SHELFDECK_EVIDENCE_DIR`. Evidence must survive cleanup.
- After every failed iteration, still run cleanup so ports and data dirs are not stranded.

## Helpers

All helpers are under `.cursor/skills/verify-shelfdeck/bin/`:

```bash
bash .cursor/skills/verify-shelfdeck/bin/verify-shelfdeck launch
bash .cursor/skills/verify-shelfdeck/bin/verify-shelfdeck doctor
bash .cursor/skills/verify-shelfdeck/bin/verify-shelfdeck drive health-admin-session
bash .cursor/skills/verify-shelfdeck/bin/verify-shelfdeck drive us-adult-recognition
bash .cursor/skills/verify-shelfdeck/bin/verify-shelfdeck cleanup
bash .cursor/skills/verify-shelfdeck/bin/verify-shelfdeck prove health-admin-session
```

`prove` (health-admin-session) runs launch → doctor → drive → cleanup and asserts evidence still exists afterward. `drive us-adult-recognition` runs the true full E2E script and writes evidence without requiring launch.

## Feature map

See [features/README.md](features/README.md). Mapped: `health-admin-session`, `us-adult-recognition`.

## Maintenance

Keep the map honest with `/maintain-verification-skill` as Admin routes and journeys change.
