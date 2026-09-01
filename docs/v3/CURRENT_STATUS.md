# ShelfDeck v3 / Kairox Historical Status

Last updated: 2026-09-01

- Kairox Beta is achieved and the Kairox release line is closed.
- Current product architecture, implementation state, plan, production identity, and acceptance scope are authoritative only under `docs/helix/`.
- `docs/v3/` remains historical implementation and release evidence; it cannot override the Helix SSOT.
- Current NAS production details: `docs/helix/CURRENT_STATUS.md`.
- Current deploy workflow: `docs/v2/PRODUCTION_DEPLOYMENT.md`.
- Current version identity: `docs/v3/VERSIONING.md`.
- No Kairox compatibility migration, dual read, roadmap restart, or new v3.x milestone is authorized.

Latest production identity record: Docker image `markmahoro/shelfdeck:helix-beta-20260901-510abb2e40`, source commit `510abb2e40`, tar SHA-256 `006607519d401cfd1e04d0ac97016ef232c670ded28298ce0cc09a1932cfd6f5`. Service full test: 432 total, 414 pass, 18 skip, 0 fail; Admin Web production build passed. The Helix architecture aggregate remains blocked only by the 18 pre-existing dynamic-template scanner findings recorded in `docs/helix/CURRENT_STATUS.md`; fixture, semantic, manifest, and contract gates passed.
