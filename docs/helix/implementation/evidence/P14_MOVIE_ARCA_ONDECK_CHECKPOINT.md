# P14 Movie Arca Handoff B / On-deck Checkpoint

## 范围与基线

- Architecture SSOT governance baseline：`1619735c`
- 已接受的 Product Package / open Handoff B Offer 源检查点：`7531c6ba`
- 上一施工证据提交：`ec4f76e7`
- P14 上一阶段独立复验证据：`06155670`
- 本检查点只覆盖 Movie：
  `Product Offer → Arca Handoff B Accepted → Inventory staging → On-deck Commit`
- 冻结在 Libra 消费 Arca Accepted/Off-load Completion 与 Workspace cleanup 前。

## 完成链路

1. Libra ProductDeliveryPort 按 Offer、Package ID/revision/digest 历史重建完整
   `OnDeckProductPackage@1`，并返回 acceptance fence。
2. Arca owner-local application 读取明确 Shelf/Standard/Placement revision，
   形成并持久化 typed Acceptance Checks 与 Inventory Feasibility。
3. `helix.transaction.handoff-b-accepted` 原子提交 Acceptance Decision、
   Custody、Arca Material Bindings、`CustodyAndTransferReceipt@1`、完整 Material
   Control transfer、Result/marker、Accepted Outbox。
4. service-owned Inventory adapter 只把 immutable Product members 写入
   disposable Shelf Target；每个效果由 `fx_effect_journal` 的
   `material_commit` intent/result 围栏保护，不删除或改写源与 Workspace。
5. Arca owner-local On-deck application 持久化 Final Inventory Decision，
   完成 Staged Manifest/Verification 与 Fulfillment Verification。
6. `helix.transaction.on-deck-commit` 原子建立 Shelf Entry、Canonical Identity、
   Inventory Representation/Materials/Product Facts/Person Relations、Deck Fact、
   On-deck Receipt、Off-load Completion、最终 Shelf Entry Material Control 与
   Result/marker/Outbox。随后仅执行同 Owner Run terminal CAS。

## Implementation Contract 闭合

- Handoff B replay 先按稳定 `acceptanceAttemptId` 精确读取既有 Decision、
  Custody、Receipt，再决定是否执行首次 Libra→Arca Control transfer；不得用
  后续已变化的 current Control 反推历史接受结果。
- On-deck replay 先按明确 `onDeckRunId` 读取既有 Receipt/Completion/Entry，
  校验 Custody、Final Decision digest、Package ID 和 Shelf，再决定是否执行
  首次最终 Control replacement。
- `CustodyAndTransferReceipt@1` 机器 schema 补齐 SSOT 已明确的
  `receiptDigest`；Result family 数量不变。
- Fulfillment digest 与 closed typed `FulfillmentVerification@1` 分离传递并在
  Store 入口重算校验，不向 typed value 注入额外字段。
- Arca public package identity `index.js` 保持冻结；Acceptance 使用独立 public
  子入口，Composition Root 只装配，不持 Store 或执行业务选择。

## Owner / Store / Transaction 审计

- Libra：只提供正式 ProductDeliveryPort；本阶段无 Libra Store 写入。
- Arca：Acceptance、Custody、Binding、On-deck Run、Inventory、Shelf Entry、
  Identity、Deck Fact 及业务 Result 全部由 Arca owner-local Store/transaction
  提交。
- Execution Foundation：仅持有 Material Control、Result/marker、Inbox/Outbox
  与 Effect Journal；无业务结果选择。
- Composition Root：仅装配 Facade、public port、Store 与 adapter。
- 无跨 Owner 写入、无 Libra Store reread、无 latest/current scan、无
  Foundation Result fallback、无兼容或旧 Runtime 路径。

## 机器基线

- Counts：112 Capability / 97 Result family / 177 table /
  43 canonical transaction / 114 route / 18 UI surface
- Contract aggregate：
  `5278431eb1082667a1f1f61fcc5bb20408fdae969c2768ada8dad1f83be2ca5e`
- Manifest aggregate：
  `544be148e027f7c6e3df29a20a444c5a252cb8b2410d1ba2d10489b6c1da982b`
- Result types：
  `2126af41c9e68be91248a73aef095bb5588d0434f2e72c900cc23c3c2183ed3c`
- SSOT digest：
  `ab9481445eacc3762621c28e5df1adb406521bbd180dd47549c0c33420c0d583`
- `prohibitedActionsRun=[]`

## 测试与反例

- Typed/result/Owner 定向：
  `37/37 PASS`
- Handoff B + clean public HTTP 定向：
  `21/21 PASS`
- 完整 `npm run test:helix-architecture`：
  `857/857 PASS`
- 正例验证：
  - Product Offer 唯一消费并 fully acked；
  - 一份 Acceptance/Custody/Receipt；
  - 一份 committed On-deck Run、Shelf Entry、Deck Fact、Commit Receipt 与
    Off-load Completion；
  - 三份最终 Shelf Entry Control 与三份物理 Inventory material；
  - 完整 Receipt/Decision/Manifest/Verification/Result 均通过生成 schema。
- 反例与恢复：
  - Handoff B Accepted 后 fault；
  - 首个 Inventory physical effect 后 fault；
  - On-deck Commit 后、Run finalize 前 fault；
  - 每次重启恢复同一 digest/revision/Receipt/Effect/Result，重复调用不产生
    第二份事实、Control 或文件。
- 文件证据：
  - 最终 primary 目标 bytes 等于 immutable Product source；
  - 原 Movie/NFO 与无关 NFO bytes/mtime 全部不变；
  - 本阶段无源文件删除、移动、重命名或 Workspace cleanup。

## 剩余风险

- `arca.product.accepted@1` 与 `arca.offload.completed@1` 尚未由 Libra 正式
  consumer 收口；Libra Run/Workspace 仍保持可恢复状态。
- P14 使用的 typed TMDB response 只证明 construction path，不构成真实
  Provider acceptance。
- 当前只证明 Movie；Series/JAV/Western Adult 与横向 Feature Matrix 尚未开始。
- `F02.17` 仍为 `NOT_RUN`。
