# ShelfDeck v3 / Kairox Historical Status

Last updated: 2026-09-01

- Kairox Beta is achieved and the Kairox release line is closed.
- Current product architecture, implementation state, plan, production identity, and acceptance scope are authoritative only under `docs/helix/`.
- `docs/v3/` remains historical implementation and release evidence; it cannot override the Helix SSOT.
- Current NAS production details: `docs/helix/CURRENT_STATUS.md`.
- Current deploy workflow: `docs/v2/PRODUCTION_DEPLOYMENT.md`.
- Current version identity: `docs/v3/VERSIONING.md`.
- No Kairox compatibility migration, dual read, roadmap restart, or new v3.x milestone is authorized.

Latest production identity record: Docker image `markmahoro/shelfdeck:helix-beta-20260902-713bbc0827`, source commit `713bbc0827`, tar SHA-256 `7d96360e775b9ce057de8cc504b1a9746f4e4e09ff40aaa5599e92f8a7bbb2d4`. Service full test: 441 total, 423 pass, 18 skip, 0 fail; Admin Web 42/42 and production build passed. The Helix architecture aggregate remains blocked only by the 18 pre-existing dynamic-template scanner findings recorded in `docs/helix/CURRENT_STATUS.md`; fixture, semantic, manifest, and contract gates passed.
