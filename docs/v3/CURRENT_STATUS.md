# ShelfDeck v3 / Kairox Historical Status

Last updated: 2026-09-03

- Kairox Beta is achieved and the Kairox release line is closed.
- Current product architecture, implementation state, plan, production identity, and acceptance scope are authoritative only under `docs/helix/`.
- `docs/v3/` remains historical implementation and release evidence; it cannot override the Helix SSOT.
- Current NAS production details: `docs/helix/CURRENT_STATUS.md`.
- Current deploy workflow: `docs/v2/PRODUCTION_DEPLOYMENT.md`.
- Current version identity: `docs/v3/VERSIONING.md`.
- No Kairox compatibility migration, dual read, roadmap restart, or new v3.x milestone is authorized.

Latest production identity record: Docker image `markmahoro/shelfdeck:helix-beta-20260903-d0bed9af57`, source commit `d0bed9af57`, tar SHA-256 `c05652ef789332a8d7065bb685191b54517d781a25df210590ccce2a51685625`. Service full test: 442 total, 424 pass, 18 skip, 0 fail; PROD-058 focused 87/87; Admin Web production build and the full Helix architecture gate passed. The authorized Formation Reset completed with integrity, foreign-key, and idempotence verification.
