# P14 Movie Production → Handoff B Offer Checkpoint

状态：**FROZEN — 等待 Architecture / P14 独立复验**

## 基线与范围

- Architecture 修正基线：`af880315`（PBF-18）
- 实现纳入基线：`8cce8e80`
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
- original Movie、Related NFO 与 unrelated NFO 的 bytes/mtime 均保持不变。
- 禁止路径反例保持通过：无 Foundation Result fallback、无外域
  latest/current scan、无 legacy runtime、Worker、Desktop、Ollama 或 Python。

## 机器证据

- Implementation Contract aggregate：
  `ba5caf674228edc91943be654e2847e56d956a32ece678e02e7f6c04e80c75ed`
- Table contract aggregate：
  `61899d6da165269259329cfcb9dd03d8af9aba5509517459aa02a8b27647aa14`
- Clean DDL digest：
  `7728be6278a78632d321d1f23820a40937a10e7a5823f3d38d91ddd833429f97`
- Workspace port fixture：3/3 PASS
- focused contract/store/coordinator fixtures：35/35 PASS
- Product Journey public HTTP fixture：14/14 PASS
- propagation/guard correction fixtures：22/22 PASS
- deterministic DDL fixtures：8/8 PASS
- `npm run test:helix-architecture`：PASS（exit 0，848 tests）
- `prohibitedActionsRun`：`[]`

## 剩余风险与下一步

下一步仅在本检查点通过独立复验后开始：Arca 通过正式 Handoff B 接受
Offer，执行 Shelf Acceptance / Off-load / On-deck Commit，并验证最终
Shelf Entry、Deck Fact 与 disposable Target 文件结果。本检查点不声明
Movie 端到端旅程或 Beta 完成。
