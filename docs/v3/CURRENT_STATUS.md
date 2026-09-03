# ShelfDeck v3 / Kairox Historical Status

Last updated: 2026-09-03

- Kairox Beta is achieved and the Kairox release line is closed.
- Current product architecture, implementation state, plan, production identity, and acceptance scope are authoritative only under `docs/helix/`.
- `docs/v3/` remains historical implementation and release evidence; it cannot override the Helix SSOT.
- Current NAS production details: `docs/helix/CURRENT_STATUS.md`.
- Current deploy workflow: `docs/v2/PRODUCTION_DEPLOYMENT.md`.
- Current version identity: `docs/v3/VERSIONING.md`.
- No Kairox compatibility migration, dual read, roadmap restart, or new v3.x milestone is authorized.

Latest production identity record: Docker image `markmahoro/shelfdeck:helix-beta-20260903-245cb92336`, source commit `245cb92336`, image ID `sha256:abf23b4340021df5396d85e1c225d7470ecbe4d91a37d9a75804e7605c2ad652`, tar SHA-256 `514bf2b83a8bcf58963200fe394eaa62b37e217426a9f3f57a2558ed89229a9b`. PROD-062 Aftercare focused tests passed 120/120, P4 Foundation full passed 234/234, and Admin Web passed 42/42 with production build. Production readiness, health, Admin Web, mounts, exact running-image checks, and the complete Gladiator 2 On-deck Commit passed; no Formation Reset was executed for this deployment.
