# P5-03 Mount Scope and Workspace Root Registries Evidence

Status: **PASS / COMPLETE**

Audit date: 2026-07-17

## 1. SSOT traceability

| SSOT contract | Implementation evidence |
| --- | --- |
| §8.3.8 Platform owns Mount Scope and Workspace Root technical facts | all writes use one `platform-settings` Repository and P3 UoW |
| §8.5.13 Mount Scope has current-headed immutable revisions | atomic bootstrap writes head → revision → current pointer；later revisions use exact CAS |
| §8.5.13 active mount fingerprint is unique | in-transaction current-set validation rejects another active scope with the same fingerprint |
| §8.5.7/§9.6.8 roots have owner scope、containment and capability evidence | three exact root kinds map to Libra、Arca or Platform；save requires full synthetic capability probe |
| §9.6.8 Workspace roots must not overlap each other、Fields or Shelf targets | canonical overlap checks consume bounded formal reserved-root projections |
| §8.6.18 typed resolver outputs freeze revision | Mount Scope and Workspace Root resolvers require exact scope/revision and return frozen typed projections |

## 2. Registry and path result

- Mount Scope first revision is committed atomically despite the bidirectional head/revision FK：the temporary null head exists only
  inside one SQLite transaction；no reader can observe it；
- subsequent Mount Scope publish requires exact `current+1` and CAS-updates the head；all prior revisions remain immutable；
- proposal fields must exactly match probe-resolved boundary、endpoint、filesystem、stable fingerprint and evidence digests；
- Workspace Root supports exactly `production-workspace → libra`、`aftercare-workspace → arca` and
  `internal-artifact → platform-settings`；
- root save requires create/write/atomic-rename/read/delete capability evidence、available-byte bound and exact resolved path；
- lexical `..`、relative paths、realpath drift、nested roots、Field overlap and Shelf target overlap fail closed；
- POSIX and Windows path behavior is supplied by an explicit path adapter；implementation performs no filesystem access。

## 3. Machine evidence

```text
node --test p5-location-registry.test.js
→ 7/7 PASS

npm run test:helix-architecture
→ fixture files: 54
→ packageCount: 47
→ dependency files/dependencies: 43/56
→ dependency findings: []
→ semantic files: 1422
→ semantic findings: []
→ P2 aggregate unchanged: bcde76e0d380ead9fbe9c76c6c21293325d2de3dd97144c1357438c3d3cc8530
→ prohibitedActionsRun: []

npm run test:helix-persistence
→ 156 tables / 72 indexes / 19 partial unique
→ 18 canonical transactions / 132 crash points
→ DDL digest unchanged: 29a8e6b6c857ab551b25197231ef6e37feb1e5ea4ee469f31d50ba181a4db7b5
→ prohibitedActionsRun: []
```

Negative fixtures cover skipped/stale revisions、duplicate fingerprint、probe drift、traversal、relative path、symlink-style
resolution escape、missing atomic rename、root nesting、reserved Field/Shelf overlap and wrong resolver scope/revision。

## 4. Boundary and safety proof

- Platform stores only technical endpoint/path/capability facts；it does not own Field、Shelf、Binding or Material Control；
- reserved roots arrive through a bounded typed query；there is no Domain Repository import or cross-domain write；
- no global path Store、fallback directory、environment path or source-directory write exists；
- no real filesystem probe、directory creation、media access、network、FFmpeg or Worker invocation occurred；
- no Composition Root/startup/API/UI wiring was added；
- no E2E、Docker、Canary、production or real media effect was run；
- SSOT and `media-desktop` were not modified。

## 5. Decision

P5-03 satisfies Done. P5-04 may consume these exact Mount Scope revisions as technical identity evidence, but must keep Physical
Material Identity、Domain-local Binding and Material Control separate。
