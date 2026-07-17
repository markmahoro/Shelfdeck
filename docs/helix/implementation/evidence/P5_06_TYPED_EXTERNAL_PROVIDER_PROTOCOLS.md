# P5-06 Typed External Provider Protocol Evidence

Status: **PASS / COMPLETE**

Audit date: 2026-07-17

## 1. SSOT traceability

| SSOT contract | Implementation evidence |
| --- | --- |
| §2.2 / §8.0.2 Provider is information/service boundary only | adapter has no Domain Repository、Business Store、Material discovery or Deck ownership |
| §8.1.1 Emby/TMDB/Douban/MoviePilot/adult providers are Integration adapters | five exact provider types map to unique versioned protocol atoms |
| §7.4.3 / §8.5.9 large payloads use handles | provider results allow bounded typed refs、`ArtifactHandle` or `ExternalJobReceipt`; inline Buffer/base64 is rejected |
| §8.6 Capability Catalog Effect Class is exact | all eight IntegrationHandle capabilities are reverse-traced and split across pure observation、workspace write and external request ports |
| §8.6.18 Integration Handle freezes operation/revision/expiry/Fence | request must match provider type、integration/config revision、allowed operation、expiry and fence digest exactly |
| §10.3 external request recovery uses identity/receipt | external request output accepts only matching integration、operation、idempotency key、request digest and config revision receipt |

## 2. Protocol result

- 8/8 Capability contracts that consume `IntegrationHandle` are represented in one closed operation catalog；tests derive the expected
  set directly from checked-in Capability manifests and reject Effect Class drift；
- each allowed Provider×Capability pair has one unique `protocolAtomId@1`；transport receives no caller-selected URL、HTTP method、
  headers or generic request authority；
- P5-01's mixed `ExternalProviderPort(external_request)` was removed and replaced by three exact ports:
  `ExternalProviderObservationPort(pure_observation)`、`ExternalProviderArtifactPort(workspace_write)` and
  `ExternalProviderRequestPort(external_request)`；there is no compatibility alias；
- every invocation requires an exact `IntegrationHandle` and one-shot Secret Lease whose integration scope、secret ref、purpose and
  expiry match the operation；
- request input is one of six closed typed descriptor shapes, capped at 32 KiB；page sizes and timeouts have operation-specific maxima；
- adapter recomputes normalized request SHA-256 and actual typed result bytes/SHA-256 instead of trusting transport declarations；
- response values are deep-frozen；large/binary outputs must be `ArtifactHandle` and deferred effects must be exact
  `ExternalJobReceipt`；
- Provider errors are converted to stable redacted errors. Secret bytes are held only for the bounded async invocation and wiped on
  success or failure。

## 3. Legacy reuse disposition

旧`embyService.js`、`moviepilotService.js`、`doubanService.js`、`metadataProviderAdapter.js`未导入clean root：它们把直接
network/fs/config access、旧Task/SourceBinding、业务metadata拼装、fallback和明文错误混在同一模块，不能整体或协议层复制。
本Work Package只保留“Provider protocol behind adapter”这一能力意图；URL规范化等微小通用逻辑不值得携带旧依赖，重新以
bounded typed atom表达。没有建立旧Adapter wrapper或fallback。

## 4. Machine evidence

```text
node --test p5-provider-protocol.test.js
→ 7/7 PASS

node --test p5-provider-protocol + p5-secret-lease + p5-public-ports
→ 18/18 PASS

npm run test:helix-architecture
→ fixture files: 57
→ packageCount: 47
→ dependency findings: []
→ semantic findings: []
→ P2 aggregate unchanged: bcde76e0d380ead9fbe9c76c6c21293325d2de3dd97144c1357438c3d3cc8530
→ prohibitedActionsRun: []

npm run test:helix-persistence
→ 156 tables / 72 indexes / 19 partial unique
→ 18 canonical transactions / 132 crash points
→ prohibitedActionsRun: []

npm run test:helix-runtime
→ 7 Effect Classes / 31 cross-process crash scenarios
→ prohibitedActionsRun: []
```

Negative fixtures cover wrong Effect Class port、unsupported provider、wrong operation、expired handle、wrong Secret Lease purpose、
request digest drift、timeout excess、open/generic input、response size/digest drift、receipt mismatch、transport secret leakage and
direct network/filesystem/legacy adapter imports。

## 5. Boundary and safety proof

- no Provider transport implementation、DNS、socket、HTTP request or real credential was used；all transport is deterministic fake；
- no Provider output writes a Domain Fact、creates Work/Process or owns Metadata/Identity/Perception；
- no central metadata cache/Store、raw payload table or unbounded JSON was introduced；
- no Composition Root/startup/API/UI wiring、E2E、Docker、Canary、production or real media effect occurred；
- SSOT and `media-desktop` were not modified。

## 6. Decision

P5-06 satisfies Done. P5-07 may implement bounded filesystem/probe/hash/FFmpeg atoms and use the workspace-write Provider port only
through P4 Effect Journal and controlled Workspace/Artifact handles；it may not add a raw URL/request escape hatch。
