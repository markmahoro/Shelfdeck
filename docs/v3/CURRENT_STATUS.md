# ShelfDeck v3 / Kairox Historical Status

Last updated: 2026-09-03

- Kairox Beta is achieved and the Kairox release line is closed.
- Current product architecture, implementation state, plan, production identity, and acceptance scope are authoritative only under `docs/helix/`.
- `docs/v3/` remains historical implementation and release evidence; it cannot override the Helix SSOT.
- Current NAS production details: `docs/helix/CURRENT_STATUS.md`.
- Current deploy workflow: `docs/v2/PRODUCTION_DEPLOYMENT.md`.
- Current version identity: `docs/v3/VERSIONING.md`.
- No Kairox compatibility migration, dual read, roadmap restart, or new v3.x milestone is authorized.

Latest production identity record: Docker image `markmahoro/shelfdeck:helix-beta-20260903-c77cd99951`, source commit `c77cd99951`, tar SHA-256 `4cda788a8dfcdd5d3c93d4355c4365210bac4db52d03c46bc8fd16a25ad27081`. Service full test: 442 total, 424 pass, 18 skip, 0 fail; PROD-059 focused 58/58. Production readiness, health, Admin Web, mounts, and exact running-image checks passed; no Formation Reset was executed for this deployment.
