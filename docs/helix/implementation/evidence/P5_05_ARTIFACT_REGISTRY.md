# P5-05 Artifact Registry and Controlled Payload Handle Evidence

Status: **PASS / COMPLETE**

Audit date: 2026-07-17

## 1. SSOT traceability

| SSOT contract | Implementation evidence |
| --- | --- |
| §7.4.3 / §8.5.9 large payloads use controlled Artifact or Workspace handles | Registry persists typed metadata only；no payload/base64/raw path enters Work/Event hot records |
| §8.5.10 `fx_artifact_registry` Owner is Execution Foundation | Repository is `execution-foundation` and `ArtifactQueryPort` is published by `foundation.public`, not Platform |
| §8.5.10 active references fence GC | reference create/release and Artifact `reference_revision` advance in one scoped P3 transaction；any active reference blocks GC eligibility |
| §8.6.18 exact `ArtifactHandle` fields | output freezes owner scope、storage ref、SHA-256、size、media type、typed provenance and reference revision |
| §8.5.9 SHA-256 and bounded typed payload rules | full lowercase SHA-256、exact size/media type and storage reality are revalidated on register/read/GC intent |
| §10.5.3–§10.5.4 reference retention precedes age | Registry accepts only an injected exact GC authority after zero active references；it does not implement age-only deletion |

## 2. Registry result

- `fx_artifact_registry` and `fx_artifact_references` are accessed only through one explicit Execution Foundation Repository；
- create resolves an `internal-artifact` controlled root at the exact config revision and rejects traversal、root escape or stale root；
- stored `provenance_ref` is canonical typed JSON and returns the exact `ArtifactHandle.provenanceRef` object；
- read requires exact owner scope or an active consumer scope whose `referenceKind` equals the requested purpose；a reference never
  changes Artifact Owner、Domain Fact ownership or Material Control；
- reference create/release uses monotonic CAS；stale revision、duplicate active reference and inexact release all fail closed；
- same owner scope + digest + kind + storage ref replays the existing handle；same content at another storage ref is rejected so the
  Registry cannot silently create an untracked orphan；
- GC eligibility requires zero active references、exact Artifact/digest authority、an injected authority verifier and current
  checksum/containment reality；only the exact in-memory issued intent can pass the final assertion；
- P5-05 performs no physical delete. Durable destructive Effect intent、filesystem action and recovery remain P5-07/P4 Effect Journal
  responsibility。

P5-01 originally classified `ArtifactQueryPort` under `platform.public`. P5-05 audit proved from SSOT table ownership and Platform
aggregate boundaries that this was an implementation Owner error. The port is now `foundation.artifact.query@1` under
`foundation.public` / `execution-foundation`. This correction changed no SSOT text or generated SSOT contract digest。

## 3. Machine evidence

```text
node --test p5-artifact-registry.test.js
→ 9/9 PASS

npm run test:helix-architecture
→ fixture files: 56
→ packageCount: 47
→ dependency findings: []
→ semantic findings: []
→ P2 aggregate unchanged: bcde76e0d380ead9fbe9c76c6c21293325d2de3dd97144c1357438c3d3cc8530
→ prohibitedActionsRun: []

npm run test:helix-persistence
→ persistence modules: 9 explicit modules including artifact-repository.js
→ 156 tables / 72 indexes / 19 partial unique
→ 18 canonical transactions / 132 crash points
→ DDL digest unchanged: 29a8e6b6c857ab551b25197231ef6e37feb1e5ea4ee469f31d50ba181a4db7b5
→ prohibitedActionsRun: []

npm run test:helix-runtime
→ 7 Effect Classes / 31 cross-process crash scenarios
→ prohibitedActionsRun: []
```

Negative fixtures cover traversal、stale root、malformed provenance、release after containment drift、missing bytes、checksum/size/
media drift、wrong scope/purpose、stale CAS、duplicate active reference、active-reference GC、wrong/fabricated authority、forged intent、
orphan GC and duplicate storage location。

## 4. Boundary and safety proof

- Artifact is an Execution Foundation technical fact, not a Platform setting or sixth Business Domain；
- Foundation stores no Domain payload and imports no Domain Repository；
- Artifact reference grants only exact bounded read purpose；it grants no Business ownership、Domain write or Material Control；
- all storage/root/probe/authority functions are injected typed boundaries；implementation imports no filesystem、network or process API；
- no real file was created、read、moved or deleted；no Provider、FFmpeg or Worker was invoked；
- no Composition Root/startup/API/UI、E2E、Docker、Canary、production or `media-desktop` action occurred；
- SSOT was not modified。

## 5. Decision

P5-05 satisfies Done. P5-06 may use `ArtifactHandle` for bounded Provider payload results, but Provider adapters remain information/
service boundaries and cannot own Artifact facts、Domain metadata facts or a central metadata Store。
