# ADR 0001: Helix Splits Nexora And Kairox

Status: historical and superseded at the top-level by `docs/helix/ARCHITECTURE.md`.

Date: 2026-07-08

## Context

Earlier Nexora drafts treated Nexora as a top-level architecture containing Kairox. Further design review found that this makes Nexora too broad and risks turning Kairox internals into Nexora responsibilities.

Kairox already has a clear business line: in-library media operation through metadata / optimize / archive.

The missing architecture line is source-side reality: whether ShelfDeck manages a media item and whether that item currently has a reliable source.

## Decision

Use Helix as the top-level architecture name:

```text
Historical definition: Helix Architecture = Nexora + Kairox
```

Nexora is Source Management:

```text
Membership(mediaItemId, active | closed)
SourceBinding(mediaItemId, sourceId, valid | invalid)
```

Kairox remains In-Library Operation:

```text
metadata / optimize / archive / task / flow / event
```

## Consequences

- Nexora no longer contains Kairox.
- This ADR's Nexora Membership ownership was superseded: Libra now owns LibraryMembership and Offboarding coordination; Nexora provides source binding and cleanup capability.
- Resource Management is not a top-level Helix business domain.
- Kairox eligibility is derived from Nexora facts.
- Kairox cannot create/close Membership or change SourceBinding validity.
- Nexora cannot rewrite Kairox metadata / optimize / archive lifecycle.
