# Nexora Code Reality Map

Status: updated for Helix / Nexora redesign.

Last updated: 2026-07-08

本文记录当前代码相对 Nexora Source Management 合同的现实映射。它不定义未来架构合同，也不宣称当前实现 Nexora compliant。

## 1. Review Scope

本次审查覆盖：

```text
media-service/src/libraryStore.js
media-service/src/mediaLibraryService.js
media-service/src/adultLibraryService.js
media-service/src/sourceReference.js
media-service/src/smartTaskEngine.js
media-service/src/taskCreationPolicy.js
media-service/src/taskAdmission.js
media-service/src/lifecycleProjection.js
media-service/src/lifecycleGateService.js
media-service/src/ingestFlowExecutor.js
media-service/src/deleteCandidateService.js
media-service/src/deleteFlowExecutor.js
media-service/src/resourceRuntime.js
media-service/src/taskStore.js
media-service/src/app.js
media-service/web/src/*
media-service/test/*
```

## 2. Current Reality

| Nexora concern | Current carrier | Reality |
| --- | --- | --- |
| Membership | `media_items` hot/lifecycle/delete fields | No explicit active / closed Membership fact |
| SourceBinding | `media_items` source fields + `payload_json` | No explicit `(mediaItemId, sourceId, valid/invalid)` fact |
| source observation | `sourceReference.js`, `listSourceObservationCandidates()`, `listIngestCandidates()` | Observations exist but are routed through Kairox `targetGate=ingest` |
| Kairox eligibility | `lifecycleProjection.js`, `smartTaskEngine.js`, `taskCreationPolicy.js` | Eligibility is inferred from lifecycle/source gates, not Membership + SourceBinding |
| source missing | source facts + lifecycle ingest retry | Re-enters Kairox ingest path instead of updating SourceBinding invalid |
| source cleanup/delete | `deleteCandidateService.js`, `deleteFlowExecutor.js` | Mixed with Kairox delete gate and sometimes library row removal |

## 3. Useful Kairox Inheritance

Kairox should be retained for:

- metadata / optimize / archive lifecycle.
- task / flow / event boundary.
- Flow Planner.
- TaskAdmission.
- facts freshness.
- Media Freeze.
- event evidence.
- Kairox resource runtime for heavy in-library operations.

Nexora implementation should not rewrite these.

## 4. Nexora Gaps

### 4.1 Membership

Current code has no explicit Membership. Management responsibility is inferred from a mix of row existence, lifecycle state, archive state, delete state, and delete flow side effects.

Needed:

```text
Membership(mediaItemId, active | closed)
```

Risk if unchanged:

- source missing may be confused with出库。
- delete gate may be confused with出库。
- removed adult folder row loses history that a closed Membership could preserve.

### 4.2 SourceBinding

Current code stores binding-like facts on `media_items`:

```text
source
sourceId
sourceRefId
embyItemId
path
assetKey
sourceExists
sourceMissingAt
sourceObservedAt
locator
```

Needed:

```text
SourceBinding(mediaItemId, sourceId, valid | invalid)
```

The first implementation can choose a physical table or a compatibility projection, but the semantic contract must be explicit.

### 4.3 Source Observation

Current observation is useful but routed through ingest:

- Emby candidates distinguish new source, source changed, source missing.
- Adult folder scan has file-settle and ignored-path checks.
- `sourceReference.js` normalizes source reference data.

Needed:

- observation updates SourceBinding validity through Nexora.
- Kairox ingest is no longer the source-reality owner.
- debounce/backoff remains a Nexora engineering concern, not a Kairox lifecycle state.

### 4.4 Kairox Eligibility Bridge

Current Kairox scheduler/admission evaluates lifecycle gates directly.

Needed:

```text
Kairox eligible
  = Membership active
  + at least one valid SourceBinding
```

Kairox may keep metadata / optimize / archive gates after eligibility. It must not operate automatically on closed Membership or media without valid SourceBinding.

### 4.5 Delete / Cleanup

Current delete review and delete flow contain valuable safety behavior:

- archived item delete review.
- approval policy.
- path containment for adult folder delete.
- task evidence.

Needed:

- delete review must not define出库。
- destructive cleanup must not automatically close Membership.
- close Membership and source cleanup are separate decisions.

## 5. Legacy Quarantine Inputs

Quarantine:

- `targetGate=ingest` as 入库。
- `targetGate=delete` as 出库。
- `source_discovered` / `source_missing` as Kairox lifecycle identity.
- `lifecycleStage='deleted'` as management closure.
- `media_items` as the only semantic model for Membership + SourceBinding + Kairox lifecycle.

Retain as Kairox:

- metadata / optimize / archive target gates.
- task/flow/event persistence.
- TaskAdmission and automatic task discipline.

## 6. Implementation Inputs

Nexora implementation must answer:

- Where Membership is persisted or projected.
- Where SourceBinding is persisted or projected.
- How stable `sourceId` is derived for current source adapters.
- Which scheduler/admission point applies Kairox eligibility.
- How source missing updates SourceBinding invalid without creating ingest tasks.
- How delete review maps to source cleanup evidence without defining Membership closed.
