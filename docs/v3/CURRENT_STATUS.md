# ShelfDeck v3 / Kairox Historical Status

Last updated: 2026-09-01

- Kairox Beta is achieved and the Kairox release line is closed.
- Current product architecture, implementation state, plan, production identity, and acceptance scope are authoritative only under `docs/helix/`.
- `docs/v3/` remains historical implementation and release evidence; it cannot override the Helix SSOT.
- Current NAS production details: `docs/helix/CURRENT_STATUS.md`.
- Current deploy workflow: `docs/v2/PRODUCTION_DEPLOYMENT.md`.
- Current version identity: `docs/v3/VERSIONING.md`.
- No Kairox compatibility migration, dual read, roadmap restart, or new v3.x milestone is authorized.

Latest production identity record: Docker image `markmahoro/shelfdeck:helix-beta-20260902-0d94f414ac`, source commit `0d94f414ac`, tar SHA-256 `8e8224458f2f2de322befcd6f1cff9507650c9ed33d2aaa9dac842811a842d4b`. Service full test: 441 total, 423 pass, 18 skip, 0 fail; Startup Recovery/Runtime Host/Formation Reset focused 72/72. The Helix architecture aggregate remains blocked only by the 18 pre-existing dynamic-template scanner findings recorded in `docs/helix/CURRENT_STATUS.md`; fixture, semantic, manifest, and contract gates passed.
