# ShelfDeck v3 / Kairox Historical Status

Last updated: 2026-09-03

- Kairox Beta is achieved and the Kairox release line is closed.
- Current product architecture, implementation state, plan, production identity, and acceptance scope are authoritative only under `docs/helix/`.
- `docs/v3/` remains historical implementation and release evidence; it cannot override the Helix SSOT.
- Current NAS production details: `docs/helix/CURRENT_STATUS.md`.
- Current deploy workflow: `docs/v2/PRODUCTION_DEPLOYMENT.md`.
- Current version identity: `docs/v3/VERSIONING.md`.
- No Kairox compatibility migration, dual read, roadmap restart, or new v3.x milestone is authorized.

Latest production identity record: Docker image `markmahoro/shelfdeck:helix-beta-20260903-03ba1191d1`, source commit `03ba1191d1`, tar SHA-256 `4005b6cf9b6546523054ae60c8665e903f16ccd4f31fdf281e2578490f2172fc`. Service full test: 443 total, 425 pass, 18 skip, 0 fail; PROD-060 focused 7/7. Production readiness, health, Admin Web, mounts, and exact running-image checks passed; no Formation Reset was executed for this deployment.
