# P5-01 Platform and Integration Public Nominal Ports Evidence

Status: **PASS / COMPLETE**

Audit date: 2026-07-17

## 1. SSOT traceability

| SSOT contract | Implementation evidence |
| --- | --- |
| §8.3.8 Platform owns typed technical aggregates and publishes short-lived handles | 9 `platform.public` query/resolve nominal ports；no Platform Store exposure |
| §8.5.10 Artifact Registry is an Execution Foundation technical fact | `ArtifactQueryPort` is published by `foundation.public`, not Platform |
| §8.5.6 external effects use Effect Journal semantics | every Integration operation declares one P4 Effect Class、idempotency and Fence source |
| §8.6.16 immutable typed API metadata | 17 unique `@1` port contracts with stable input/output schema refs |
| §8.6.17 dependencies are constructor-injected, not persisted Context | factories bind one exact method and expose no Runtime/Repository/Store |
| §8.6.18 typed handles, no bare path or mutable object | resolver boundaries return only contract-specific typed refs/handles |
| §8.7 dependency direction | callers can import `platform.public` or `integrations`; Platform internal layers remain inaccessible |

Platform公开9个技术查询/解析端口：Integration、Integration Handle、Secret Lease Handle、Mount Scope、Workspace
Root、Resource Profile、Compute Device、Worker Handle和Admin Credential revision。Foundation公开Artifact Query；Integrations公开7个
效果类型端口：Filesystem Observation、Content Hash、Media Probe、Workspace File Effect、Media Transform、External
Provider和passive Worker Compute。它们不创建或写入任何Business Object或Domain Fact。

## 2. Exact nominal contract

每个port contract固定：`portId@1`、export name、package/Owner、唯一method、input/output schema ref、Effect Class、
idempotency requirement/scope、Fence requirement/source及input/output byte bound。非pure operation全部要求幂等键；
所有17个端口都要求明确Fence来源。大结果只能由后续Artifact/Handle合同承载，端口本身没有无界返回值。

公开factory只接受合同声明的唯一method。缺少method或额外加入Repository、SQLite、Domain write、HTTP、generic
request或process authority都会稳定返回shape mismatch；绑定结果被冻结。

## 3. Machine evidence

```text
node --test p5-public-ports + clean-skeleton + package-boundary-guard
→ 19/19 PASS

npm run test:helix-architecture
→ fixture files: 52
→ packageCount: 47
→ dependency files/dependencies: 36/52
→ dependency findings: []
→ semantic files: 1415
→ semantic findings: []
→ P2 aggregate unchanged: bcde76e0d380ead9fbe9c76c6c21293325d2de3dd97144c1357438c3d3cc8530
→ prohibitedActionsRun: []
```

## 4. Negative and safety proof

- public entry source不导入Platform persistence、SQLite、HTTP、child process或旧Adapter；
- Adapter端口不拥有Domain Repository、Material Control、Business Decision或跨域Store；
- External Provider只是typed operation boundary，不是Physical Material或collection Owner；
- Worker只暴露单次typed compute operation，不拥有Work、Runtime或Store；
- 未连接Composition Root、startup、HTTP/API/Admin Web或任何真实Adapter；
- 未运行E2E、Docker、Canary、production、真实来源或真实媒体副作用；
- 未修改SSOT或`media-desktop`。

## 5. Decision

P5-01满足Done。公开边界已经可供P5-02及后续包实现，但当前仍只有nominal contract和shape guard，没有真实
credential、filesystem、network、FFmpeg或Worker行为。下一步进入P5-02 Secret Reference与least-authority resolver。
