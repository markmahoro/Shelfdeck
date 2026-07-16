# ADR 0003: Nexora Fact Model Uses Staged Hybrid Persistence

Status: accepted; Thread 1 implementation started.

Date: 2026-07-08
Last updated: 2026-07-09

## Context

Nexora needs explicit Source Management facts:

```text
Membership(mediaItemId, active | closed)
SourceBinding(mediaItemId, sourceId, valid | invalid)
```

Current runtime stores source, lifecycle, delete, and hot media fields together in `media_items`. That table is useful for Kairox projections, but it cannot remain the semantic owner for Membership and SourceBinding because it mixes:

- management responsibility.
- source identity and path reality.
- Kairox lifecycle gates.
- delete and cleanup state.

At the same time, Kairox still reads hot projections from `media_items`. Fact Model work must not rewrite Kairox metadata / optimize / archive internals or break existing rows.

## Decision

Use staged hybrid persistence:

1. New Nexora fact tables are the semantic owner for Membership and SourceBinding.
2. `media_items` remains a compatibility projection and Kairox hot-read cache during the transition.
3. Compatibility projection may seed or mirror Nexora facts, but it must not define the new business state.
4. Kairox eligibility is derived from Nexora facts and exposed through an adapter/projection boundary before Kairox automatic task creation.

The minimum physical model is:

```text
nexora_memberships
  mediaItemId
  status: active | closed
  openedAt
  closedAt?
  closeReason?
  updatedAt

nexora_source_bindings
  bindingId
  mediaItemId
  sourceId
  validity: valid | invalid
  reason?
  evidenceRef?
  observedAt
  updatedAt

nexora_source_observations
  observationId
  sourceId
  mediaItemId?
  result: present | missing | inaccessible | identity_mismatch | error
  reason
  evidenceJson
observedAt
```

`bindingId` is the primary key for the relationship row. `sourceId` is the stable identity of the source and remains reusable across observations. The pair `mediaItemId + sourceId` is unique so repeated observation of the same source updates the same binding row instead of creating duplicate facts.

`nexora_source_observations` is the append-style evidence trail. `nexora_source_bindings` stores only the latest validity, reason, and evidence pointer/snapshot needed for fast eligibility and explanation.

## Source Identity

`sourceId` is a stable adapter-scoped identity, not a display path.

Format:

```text
<sourceAdapterId>:<identityKind>:<stableKeyHash>
```

Rules:

- The input to the hash is a normalized JSON identity payload with sorted keys.
- Path strings are normalized by adapter rules before hashing.
- Volatile evidence such as mtime, size, title, codec, bitrate, scrape output, and observation timestamps must not be part of `sourceId`.
- If the stable external identity changes, that is a new `sourceId`; the old binding becomes invalid and a new binding may become valid.

Initial identity payloads:

| Adapter | identityKind | Stable payload |
| --- | --- | --- |
| Emby item | `emby_item` | Emby server identity, library/section identity when available, `embyItemId` |
| Adult folder file | `adult_file` | configured source root identity, normalized relative path, optional file asset key when already stable |
| Local path / asset | `local_asset` | configured root identity, normalized relative path or durable asset key |

Absolute local paths may appear in observation evidence, but they are not sufficient as cross-environment identity unless scoped by a configured root identity.

## Validity Reason And Evidence

SourceBinding state remains only:

```text
valid
invalid
```

Reasons explain the state; they do not create additional states.

Minimum invalid reasons:

| Reason | Meaning |
| --- | --- |
| `source_missing` | The adapter can identify the source but no longer observes it at the expected identity/locator. |
| `source_inaccessible` | The source may exist but cannot be read because of permission, mount, network, or adapter access failure. |
| `identity_mismatch` | The locator resolves to an object that does not match the expected stable identity. |
| `path_changed` | The old locator is no longer valid and a different locator may represent a new binding candidate. |
| `source_destroyed` | Destructive cleanup evidence says the source was intentionally removed. |
| `adapter_error` | Observation failed because the adapter failed; this should be debounced before changing validity when possible. |
| `unknown` | Compatibility or migration input lacks a precise reason. |

Minimum valid reasons:

| Reason | Meaning |
| --- | --- |
| `observed_present` | Current observation confirms the expected source identity is present and usable. |
| `accepted_source` | User or policy accepted a source into active Membership. |
| `recovered` | A previously invalid binding has become valid again. |
| `rebound` | A new source binding replaces or supersedes an older invalid binding. |

Minimum evidence payload:

```text
observedAt
observer
sourceAdapterId
locator
identityPayloadHash
adapterResult
message?
```

Evidence may include path, Emby item id, server id, root id, file stat, adapter response, and task/signal ids when relevant. Evidence is explanatory input for Nexora policy; resource or task evidence cannot directly modify Membership or SourceBinding without Nexora observation/policy.

## Membership Retention

The Fact Model design keeps closed Membership history. It does not define purge behavior.

Closed Membership means ShelfDeck no longer actively manages the media item. It does not require immediate source cleanup, Kairox delete gate completion, or row deletion. A later retention/purge design may compact closed history, but that is outside this design.

## Kairox Bridge

The minimum bridge is an eligibility adapter/projection consumed before Kairox automatic task creation:

```text
Kairox eligible
  = Membership active
  + at least one valid SourceBinding
```

First-stage bridge impact:

- Automatic Kairox task creation must not create metadata / optimize / archive / delete tasks for ineligible media.
- Explicit manual Kairox tasks may remain possible as user intent, but still must pass duplicate, media freeze, destructive safety, and existing TaskAdmission checks.
- Kairox may emit source-related signals, but Nexora remains the only owner of Membership and SourceBinding updates.

## Consequences

- The Fact Model has a clear semantic owner without requiring an immediate Kairox rewrite.
- `media_items` overload is quarantined as projection/compatibility, not expanded.
- Source missing and source recovery become SourceBinding validity transitions, not Kairox lifecycle identity.
- Existing Kairox task / flow / event internals remain intact.
- Future migration can shrink `media_items` source fields after adapter/projection evidence proves the new facts are authoritative.
