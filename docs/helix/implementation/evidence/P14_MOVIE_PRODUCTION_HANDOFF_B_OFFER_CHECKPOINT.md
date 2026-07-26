# P14 Movie Production → Handoff B Offer Checkpoint

状态：**FROZEN — PBF-18-R1 修正后等待 Architecture / P14 独立复验**

## 基线与范围

- Architecture 修正基线：`af880315`（PBF-18）
- 实现纳入基线：`8cce8e80`
- Architecture 修正基线：上游 `e35b93bd`（PBF-18-R1），原样纳入
  `1cba7b57`
- Implementation Closure：`7531c6ba`
- 本检查点只覆盖同一 disposable Movie 从 active Libra Run 到 immutable
  `OnDeckProductPackage` 与一个 open Handoff B Offer。
- 检查点冻结在 Arca 接受 Handoff B 之前；未执行 Shelf Acceptance、Off-load、
  On-deck Commit 或 Target Folder 文件效果。

## 已闭合链路

正式 Clean Service 入口通过 Owner-local application/public port 完成：

`Libra Run → Workspace admission → direct-original media verification →
Related NFO metadata observation → Product Identity / Metadata / Media Cast
Facts → generated Workspace Artifact effects → Artifact verification →
role-aware Product Staging → six-group Product Conformance → Deliverable
Promotion → immutable Product Package → open Handoff B Offer`

PBF-18 的唯一顺序已物化：先确定 Package revision 与稳定
`onDeckPackageId`，再提交真实 `on_deck_package` Control post-state；实际
Control revision/digest 随后进入 Product Material、Attestation、Package 和
Offer。不存在 pending/placeholder Control 或提交后覆盖 member。

PBF-18-R1 的 commit-time digest 也已闭合：

- `packageDigest` 覆盖完整 nominal `OnDeckProductPackage`，仅排除
  `ManifestEnvelope.manifestDigest`、commit-only `publishedAtMs` 与
  `packageDigest` 本身；`manifestDigest=packageDigest`。
- Product Delivery Reader 从所有 Package 关系重建同一完整值并重算摘要，
  不再信任持久化的 `row.package_digest`。
- Product Package Commit Receipt 使用
  `libra.product-package-commit-receipt-id@1` 的 Package ID + revision
  公式，`scopeDigest=promotionDecisionDigest`。
- Production Attestation ID 使用 Run、Package、Conformance Evidence
  identity/digest 的正式公式。
- `OnDeckProductPackage@1` 已重物化为完整 typed Product Delivery value，
  不再用 generic snapshot 缩减 Fact、Manifest、Provenance 或 Attestation。

## Owner、Store 与事务

- Libra 独占 Run、Workspace、Product Facts、Staging、Conformance、Package、
  Product Delivery snapshot 与 Offer。
- Procurement/Arca 仅通过已接受的 Handoff 与 public projection 输入出现；
  本阶段没有跨 Owner Store 读写。
- Composition Root 只装配 port/coordinator，不持有 Store 或执行产品选择。
- `helix.transaction.domain-fact-commit` 支持三种 closed Product Fact；
  `helix.transaction.libra-deliverable-promotion` 原子提交 Package head、
  Product Control、Package relations、Receipt/marker、Offer 与 Outbox。
- 架构库存保持 112 Capabilities / 97 Result families / 177 tables /
  43 canonical transactions；Product Surface 保持 114 routes / 18 UI surfaces。

## 恢复与反例

- Workspace effect journal 先记录 intended effect，再执行 temp/rename 与
  Handle/Artifact commit；重启可恢复相同 effect，drift 时 fail closed。
- fault after Workspace physical effect：重启后只产生一个物理输出。
- fault after Product Fact/Artifact commit：重启复用相同 Fact/Artifact，
  不产生重复事实。
- fault after Package/Control/Offer commit but before response：重启按稳定
  Package ID 精确重放同一 Product Delivery snapshot 与 Offer。
- 篡改 Shelf、Run Material ref、Provenance、Attestation、Product Fact
  relation 或 Product member committed Control 均被读取端摘要重算拒绝；
  只改变 commit-only `publishedAtMs` 不改变内容摘要。
- original Movie、Related NFO 与 unrelated NFO 的 bytes/mtime 均保持不变。
- 禁止路径反例保持通过：无 Foundation Result fallback、无外域
  latest/current scan、无 legacy runtime、Worker、Desktop、Ollama 或 Python。

## 机器证据

- Architecture source-map digest：
  `ab9481445eacc3762621c28e5df1adb406521bbd180dd47549c0c33420c0d583`
- Implementation Contract aggregate：
  `7bf1991a14e5f1bbc0b2c4ffb97c12b7b3fa6c0423c4b2ee9cf2e0115b59e724`
- Result Type digest：
  `8d5bc9e0f4fd3aa4f25c9cff2cb4fe7b86a569b28a3b3f4c61a9040e3f644ea5`
- Table Contract digest：
  `47e8953ef8994741a5699626af09c54bb53a50fe8cacba3d28b7b44a41dc6ed1`
- focused digest/reconstruction/crash/replay/tamper/schema fixtures：54/54 PASS
- Product Journey public HTTP fixture：14/14 PASS（包含于 focused 54）
- `npm run test:helix-architecture`：PASS（exit 0，857/857）
- `prohibitedActionsRun`：`[]`

## 剩余风险与下一步

下一步仅在本检查点通过独立复验后开始：Arca 通过正式 Handoff B 接受
Offer，执行 Shelf Acceptance / Off-load / On-deck Commit，并验证最终
Shelf Entry、Deck Fact 与 disposable Target 文件结果。本检查点不声明
Movie 端到端旅程或 Beta 完成。
