# Nexora Architecture

> 2026-07-12 scope notice: Nexora属于Libra Pre-deck组织，只拥有Triage、Source observation
> 和SourceBinding；不拥有Deck Inventory、Deck Health、Post-deck repair或collection ownership。

Status: accepted Nexora capability contract under Helix Beta.

Last updated: 2026-07-10

## 1. Definition

```text
Nexora = Source Triage + Source Truth + Onboarding/Offboarding Capability
```

Nexora is an in-process Service called only by Libra. It does not contain Kairox, does not call Kairox and does not own ShelfDeck's global LibraryMembership.

## 2. Owned Facts

Nexora owns:

```text
TriageWork(candidate scope, state, cursor, retry/recovery)
TriageCandidate(candidateId, mediaType, identity, ready | needs_review | rejected)
SourceBinding(sourceId, valid | invalid)
AcceptedSubjectBinding(subjectId, candidateId, sourceIds[], revision)
SourceObservation(sourceId, result, reason, evidence, observedAt)
SourceAsset(assetId, subjectId, seasonKey?, episodeKey?, source identity, locator, revision)
SourceProjection(subjectId, sourceRevision, readiness, bindings, assets, accessDescriptor)
```

Nexora域内可以保存classification/topology evidence、confidence、parser/provider结果和人工修正，用于重预检和准确性改进；这些不是Libra或Kairox Service合同。Libra只消费最小结构、identity、SourceBinding和candidate status。

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

SourceBinding是Triage中的一个原子产物。Triage发生在Libra创建`subjectId`之前，因此`sourceId`是Binding identity且必须唯一；不建立冗余`bindingId`。Libra接受candidate并生成`subjectId`后，通过幂等command建立`AcceptedSubjectBinding`关联，它不改变SourceBinding identity。Observation evidence is append-only.

## 4. Service Actions

### ensureOnboarding

- Observe the supplied SourceReference through its adapter.
- Determine `mediaType=single|group`, minimum stable admission identity and Movie/Season Asset topology.
- Establish or update the stable SourceBinding.
- Return `ready|needs_review|rejected` and a revisioned source projection.
- Never open or close LibraryMembership.

Beta Triage is recall-first. A complete source-scoped identity and Subject grouping derived from Library declaration, path or naming rules may return `ready` without Provider/VLM verification; accuracy is not a Beta gate. Only a candidate for which no complete mediaType/contentProfile/Subject boundary/SourceBinding conclusion can be formed returns `needs_review`. Discontinuous Episodes such as E01/E05/E07 are valid current source reality and do not imply theoretical completeness.

`contentProfile=movie|series|jav|western_adult` is a Libra-owned Subject fact. A fixed-profile Library supplies the profile context to Triage; mixed Libraries resolve it through explicit rules, source metadata, Beta lightweight classification or user confirmation when no complete result is available. Nexora is not required to run Provider or general VLM validation for every candidate.

### retriageSource

- Re-run Triage for an existing SourceBinding after a Libra-coordinated mismatch or source change.
- Return a new candidate/result without rewriting Libra Subject identity or Kairox Admission.
- Preserve manual corrections and report conflicts instead of silently replacing them.

### diagnoseSource

- Re-observe an incident's source/binding.
- Return recovered, rebound, confirmed missing or blocked evidence.
- Never create a maintenance task or choose a Kairox flow.

### ensureOffboarding

Supported cleanup modes:

- `retain_source`: legacy Pre-deck cleanup vocabulary; not a current user-facing Off-deck mode.
- `detach_source`: legacy Pre-deck binding operation; not a current user-facing Off-deck mode.
- `delete_source`: require explicit destructive authorization, delete through the source adapter, write evidence and invalidate the binding.

Nexora reports completion to Libra. Libra alone closes LibraryMembership.

## 5. Projection And Revision

SourceProjection minimally contains:

```text
subjectId
sourceRevision
readiness: ready | missing | blocked | detached | destroyed | unresolved
activeBindings
sourceAccessDescriptor?
latestObservation
assets[]
```

Before Admission, OnboardingCandidate minimally contains:

```text
candidateId
mediaType: single | group
identity: sourceIdentity + displayName + optional series/season identity
sourceBinding/sourceRevision/assets
status: ready | needs_review | rejected
```

Revision increases whenever eligibility-relevant source truth changes. Batch projection is required for library lists.

## 6. Physical Boundary

Nexora owns its Store API and source adapters. Other modules must not write `nexora_source_bindings` or `nexora_source_observations` directly. The former experimental `nexora_memberships` table is migration input only and has no runtime ownership role.

## 7. Clean Runtime Boundary

The following cannot define Nexora or Helix runtime behavior:

- `targetGate=ingest` as onboarding.
- `targetGate=delete` as offboarding.
- `source_missing` as a Kairox lifecycle failure.
- deletion as an implicit Membership close.
- `media_items` as the sole owner of source truth and global management state.

Helix Beta does not backfill, migrate or dual-read these legacy models. Startup detects old runtime schema/config and returns `HELIX_CLEAN_INIT_REQUIRED`; the separately invoked initialization tool backs up and clears ShelfDeck-owned state without writing Emby or media directories. Historical documents and negative tests may mention the old names, but no compatibility adapter participates in runtime behavior.
