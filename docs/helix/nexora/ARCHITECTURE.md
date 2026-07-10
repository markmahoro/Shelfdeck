# Nexora Architecture

Status: accepted Nexora capability contract under Helix Beta.

Last updated: 2026-07-10

## 1. Definition

```text
Nexora = Source Truth + Onboarding/Offboarding Capability
```

Nexora is an in-process Service called only by Libra. It does not contain Kairox, does not call Kairox and does not own ShelfDeck's global LibraryMembership.

## 2. Owned Facts

Nexora owns:

```text
SourceBinding(mediaItemId, sourceId, valid | invalid)
SourceObservation(sourceId, result, reason, evidence, observedAt)
SourceProjection(mediaItemId, sourceRevision, readiness, bindings, accessDescriptor)
```

`sourceId` is adapter-scoped stable identity:

```text
<sourceAdapterId>:<identityKind>:<stableKeyHash>
```

The stable payload excludes mtime, size, title, codec, bitrate, scrape output and observation timestamps. Absolute paths are locators/evidence and must be scoped by a configured root identity when used in identity.

## 3. SourceBinding

SourceBinding state is only `valid | invalid`. Reasons explain state and do not extend the state machine.

Minimum invalid reasons:

```text
source_missing
source_inaccessible
identity_mismatch
path_changed
source_destroyed
adapter_error
unknown
```

Minimum valid reasons:

```text
observed_present
accepted_source
recovered
rebound
```

`bindingId` is the row identity. `(mediaItemId, sourceId)` is unique. Observation evidence is append-only; the binding holds the latest validity and evidence pointer.

## 4. Service Actions

### ensureOnboarding

- Observe the supplied SourceReference through its adapter.
- Establish or update the stable SourceBinding.
- Return a revisioned source projection.
- Never open or close LibraryMembership.

### diagnoseSource

- Re-observe an incident's source/binding.
- Return recovered, rebound, confirmed missing or blocked evidence.
- Never create a maintenance task or choose a Kairox flow.

### ensureOffboarding

Supported cleanup modes:

- `retain_source`: no source mutation.
- `detach_source`: invalidate current binding without deleting the asset.
- `delete_source`: require explicit destructive authorization, delete through the source adapter, write evidence and invalidate the binding.

Nexora reports completion to Libra. Libra alone closes LibraryMembership.

## 5. Projection And Revision

SourceProjection minimally contains:

```text
itemId
sourceRevision
readiness: ready | missing | blocked | detached | destroyed | unresolved
activeBindings
sourceAccessDescriptor?
latestObservation
```

Revision increases whenever eligibility-relevant source truth changes. Batch projection is required for library lists.

## 6. Physical Boundary

Nexora owns its Store API and source adapters. Other modules must not write `nexora_source_bindings` or `nexora_source_observations` directly. The former experimental `nexora_memberships` table is migration input only and has no runtime ownership role.

## 7. Legacy Quarantine

The following cannot define Nexora or Helix runtime behavior:

- `targetGate=ingest` as onboarding.
- `targetGate=delete` as offboarding.
- `source_missing` as a Kairox lifecycle failure.
- deletion as an implicit Membership close.
- `media_items` as the sole owner of source truth and global management state.

Legacy data may be used for backfill, historical read, rollback support and negative tests only.
