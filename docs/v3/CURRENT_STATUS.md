# ShelfDeck v3 / Kairox Historical Status

Last updated: 2026-09-03

- Kairox Beta is achieved and the Kairox release line is closed.
- Current product architecture, implementation state, plan, production identity, and acceptance scope are authoritative only under `docs/helix/`.
- `docs/v3/` remains historical implementation and release evidence; it cannot override the Helix SSOT.
- Current NAS production details: `docs/helix/CURRENT_STATUS.md`.
- Current deploy workflow: `docs/v2/PRODUCTION_DEPLOYMENT.md`.
- Current version identity: `docs/v3/VERSIONING.md`.
- No Kairox compatibility migration, dual read, roadmap restart, or new v3.x milestone is authorized.

Latest production identity record: Docker image `markmahoro/shelfdeck:helix-beta-20260903-e1b0b7993d`, source commit `e1b0b7993d`, image ID `sha256:3cb5fc956700c9e03c5551dd22d2d35ee029d9219602b7f9864b9d1329600e0a`, tar SHA-256 `8bdb89929897a8c1109d1c906c25c25698592aba741cf1521bf01bd03041fc53`. PROD-061 focused tests passed 49/49 and deployment verification passed 21/21; Service full test was 443 total, 424 pass, 18 skip, with one unrelated FFmpeg watchdog timing test that passed 1/1 in isolation. Production readiness, health, Admin Web, mounts, and exact running-image checks passed; no Formation Reset was executed for this deployment.
