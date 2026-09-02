# ShelfDeck v3 / Kairox Historical Status

Last updated: 2026-09-01

- Kairox Beta is achieved and the Kairox release line is closed.
- Current product architecture, implementation state, plan, production identity, and acceptance scope are authoritative only under `docs/helix/`.
- `docs/v3/` remains historical implementation and release evidence; it cannot override the Helix SSOT.
- Current NAS production details: `docs/helix/CURRENT_STATUS.md`.
- Current deploy workflow: `docs/v2/PRODUCTION_DEPLOYMENT.md`.
- Current version identity: `docs/v3/VERSIONING.md`.
- No Kairox compatibility migration, dual read, roadmap restart, or new v3.x milestone is authorized.

Latest production identity record: Docker image `markmahoro/shelfdeck:helix-beta-20260902-efe1b91d6e`, source commit `efe1b91d6e`, tar SHA-256 `1663b23492cc770fc1992d3a30f8fe105d1c1042f3fc1c1f1daaf85fb9b1ef0f`. Service full test: 441 total, 423 pass, 18 skip, 0 fail; Event Runtime/Host focused 68/68. The Helix architecture aggregate remains blocked only by the 18 pre-existing dynamic-template scanner findings recorded in `docs/helix/CURRENT_STATUS.md`; fixture, semantic, manifest, and contract gates passed.
