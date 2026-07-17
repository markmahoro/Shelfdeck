# P5-08 Resource、Device and Passive Worker Evidence

Status: **PASS / COMPLETE**

Audit date: 2026-07-17

## 1. SSOT traceability

| SSOT contract | Implementation evidence |
| --- | --- |
| §7.7.3 / §8.3.5 `ResourceGovernor` is the only Permit capacity Owner | P5 Registry exposes projection/query/handle operations only；it has no acquire、queue、Permit or semaphore API |
| §8.3.8 Platform owns Resource Profile、Compute Device and Worker aggregates | immutable revisions/current heads persist through one `platform-settings` Repository over the exact nine Platform tables |
| §8.5.13 only `default|full` system Profiles and current Operating Policy | profile key is closed；schedule is bounded/digest-verified；policy can reference only a published Profile |
| §8.5.13 Device/Worker capability and health are validated | probe verifier gates publication；`unavailable` Device and `offline` Worker are durable explicit states |
| §8.6.18 WorkerHandle freezes current Worker authority | handle freezes worker/revision/protocol/secret/capability/operation/expiry/fence and is issued only from active healthy current revision |
| §8.6.3 Worker asset registration/upload and §8.6.6 analysis request | three unique closed protocol atoms return exact `WorkerAssetReceipt`、`WorkerUploadReceipt` or `ExternalJobReceipt` |

## 2. Registry and protocol result

- P3 Owner Repository atomically bootstraps and advances Resource Profile、Operating Policy、Compute Device probe and Worker heads；
  immutable revision rows and Worker device rows are never overwritten；
- system profile projection feeds the already accepted P4 `ResourceProfileMapper`. Integration/volume facts arrive through an injected
  typed infrastructure projection；P5 does not read a global Config；
- `available|unavailable` and `healthy|offline` are explicit. Unknown、disabled、unavailable or offline resource keys resolve to zero
  capacity, while capacity acquisition remains exclusively in P4 `ResourceGovernor`；
- WorkerHandle TTL is capped at 60 seconds and requires exact current revision plus an advertised operation；
- three Worker operations are all `external_request`, with operation-specific timeout/input/output bounds and a unique atom ID；
- every request binds Worker revision、capability digest、typed input and idempotency key into a recomputed SHA-256；
- Secret Lease must match Worker owner scope、secret ref、operation purpose and Handle expiry；secret bytes are wiped after async settlement；
- upload and analysis require a same-Worker upstream receipt chain. Result identity/digest/size/revision mismatches fail closed；
- transport receives no caller URL、HTTP method、raw FFmpeg args、Store/Facade、polling loop or Work ownership。

## 3. Legacy reuse disposition

旧`resourceGovernor.js`未复用：它拥有第二套capacity map、waiter queue、Permit与wildcard fallback，会直接违反唯一Governor。
当前`media-worker/src/server.js`也未导入clean root：虽然部署角色是被动节点，但协议仍接受raw FFmpeg args，自行选择binary/
device，维护内存Job Map并混合上传、执行、观察和错误状态。P5-08只保留“远程节点被动完成typed compute”这一能力意图，
重新表达为三个closed atoms；不存在旧Worker wrapper、dual protocol或fallback。

## 4. Machine evidence

```text
node --test p5-resource-worker-registry.test.js + p5-worker-protocol.test.js
→ 13/13 PASS

node --test above + p5-public-ports.test.js
→ 17/17 PASS

npm run test:helix-architecture
→ fixture files: 60
→ packageCount: 47
→ dependency files/dependencies: 52/62；findings: []
→ semantic files: 1434；findings: []
→ P2 aggregate unchanged: bcde76e0d380ead9fbe9c76c6c21293325d2de3dd97144c1357438c3d3cc8530
→ SSOT component digest unchanged: fa27242e59bc670ff351877680d6e41d4905e91a26e2c87a4ef911ae22726aea
→ prohibitedActionsRun: []

npm run test:helix-persistence
→ 156 tables / 72 indexes / 19 partial unique
→ DDL digest: 29a8e6b6c857ab551b25197231ef6e37feb1e5ea4ee469f31d50ba181a4db7b5
→ 18 canonical transactions / 132 crash points
→ prohibitedActionsRun: []

npm run test:helix-runtime
→ 7 Effect Classes / 31 cross-process crash scenarios
→ prohibitedActionsRun: []
```

Negative fixtures cover skipped/stale revisions、duplicate Device key、unverified probe、unknown Profile、unavailable/offline zero
capacity、stale/unadvertised WorkerHandle、wrong Capability/Effect/operation/Secret scope、request digest drift、cross-Worker receipt、
open/raw input、mismatched result、transport error leakage and direct Store polling/process/queue imports。

## 5. Boundary and safety proof

- probes、Worker transport and secret bytes were synthetic; persistence used owned temporary SQLite only；
- no real Worker、network、credential、FFmpeg、media、E2E、Docker、production or `media-desktop` action occurred；
- Platform owns only technical aggregate facts；Worker owns no Work、Process、Domain Fact、Business Decision or capacity Permit；
- SSOT and `media-desktop` were not modified。

## 6. Decision

P5-08 satisfies Done. P5-09 may issue invocation-scoped Material Access Handles from current Binding、Control and containment facts；
it must not infer write authority from Device/Worker availability or let a WorkerHandle carry Material authority。
