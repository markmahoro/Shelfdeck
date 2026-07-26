# P14 Movie PBF-19 Handoff B / On-deck Checkpoint

## 范围与基线

- Architecture governance baseline：`1619735c`
- PBF-19 Architecture commit：`ff1b833a`
- 实现分支原样纳入 commit：`942fc692`
- 已接受 Product Package / open Handoff B Offer：`7531c6ba`
- 本检查点只修正并验证：
  `Product Offer → Handoff B Accepted responsibility set → On-deck Commit`
- 冻结在 Libra Accepted/Off-load Completion consumer 与 Workspace cleanup 前。

## PBF-19 施工闭合

1. Assessment 持久化 typed Checks 后，Acceptance Attempt 保持 `active`。
2. Coordinator 在 Accepted commit 前稳定派生 Acceptance Decision、
   Final Inventory Decision 与 On-deck Run identity。
3. `helix.transaction.handoff-b-accepted` 在一个 receiving-Owner UoW 内：
   - 精确 CAS Attempt `active → accepted`；
   - 重验 Shelf active、Standard revision、Placement revision；
   - 写 Acceptance Decision、initial `ready` On-deck Run、immutable Final
     Inventory Decision；
   - 写 Custody、Bindings并转移完整 Package Material Control；
   - 写 Receipt、Result、marker、Accepted Outbox。
4. 后续 `onDeck.verifyAcceptedResponsibility` 只按显式 ID/digest 读取验证，
   不再补建 Run/Decision。
5. Rejected contract 同样要求 Attempt `active → rejected` CAS，且禁止写
   On-deck Run/Final Decision。
6. `arca_ondeck_runs` 的首次建立仍只属于 Handoff B Accepted；其显式
   `ready → offloading → committed|blocked` 生命周期由 materializer 保留为
   mutable lifecycle contract，避免把“首次建立限制”误物化为全行 append-only。

## Owner / Store / Transaction

- Libra：只通过正式 ProductDeliveryPort 提供历史 Package/Offer；无 Store
  reread或写入。
- Arca：Attempt、Decision、Final Inventory Decision、On-deck Run、Custody、
  Binding、Inventory、Shelf Entry 与 Deck Fact 均由 owner-local repository/UoW。
- Material Control Authority：只在 canonical transaction participant 中执行
  fenced transfer/replacement。
- Execution Foundation：只持 Result、marker、Outbox 与 Effect Journal。
- Composition Root：只装配 public ports、Stores 与 adapters，不执行业务选择。
- 无跨 Owner 写、latest/current scan、Foundation Result fallback、兼容或旧
  Runtime 路径。

## Crash / Restart / Replay 反例

Accepted transaction 内部逐点注入 fault：

1. Attempt accepted CAS 后；
2. On-deck Run / Final Inventory Decision insert 后；
3. Material Control transfer 后；
4. Handoff B Receipt insert 后；
5. Accepted Outbox insert 后。

每个 fault 均验证整个 UoW rollback：

- Attempt 保持 `active` 且 `finished_at_ms=NULL`；
- Acceptance Decision、Custody、Receipt、On-deck Run、Final Inventory
  Decision、Accepted marker/outbox 均为零；
- Arca custody Control 为零。

成功 commit 后验证上述责任集全有。跨重启相同输入重放复用相同
Attempt/Decision/Run/Decision digest/Custody/Control/Receipt/Outbox，不产生第二份
事实。既有 physical effect、On-deck Commit 与 replay 反例继续证明一份目标文件、
Shelf Entry、Deck Fact 和 Off-load Completion。

## 机器合同基线

- Counts：112 Capability / 97 Result family / 177 table /
  43 canonical transaction / 114 route / 18 UI surface
- SSOT component digest：
  `010e2a8da2b414a2cfb84a14e05c6b64d19c51e26e2f63f48c015c62851704fd`
- Contract aggregate：
  `45ba7a467e7411c7671587cb5b265b1cedf9a53974d76b7a7209d7d80923574e`
- Table component：
  `3911c91ce10153fc09ea539b462504c614e0b480878e2b58ed0af93809593d49`
- Transaction component：
  `2dcbf435a08424c5859becf43a86557baa59e552d6def4e5e0f7e5c861317809`
- Manifest aggregate：
  `35d209a3c5141d397b824796995508a453035df2420b032e34fc83b0a4cfe829`
- DDL digest：
  `7728be6278a78632d321d1f23820a40937a10e7a5823f3d38d91ddd833429f97`
- `prohibitedActionsRun=[]`

## 测试

- Table builder/validator + deterministic DDL + Clean Host：
  `46/46 PASS`
- Canonical transaction crash/revision/Control gates：PASS
- 完整 `npm run test:helix-architecture`：
  `858/858 PASS`
- Dependency boundary：175 files / 364 dependencies，零 finding
- Semantic guard：1703 files，零 finding

## 冻结与剩余风险

- 原 Movie/NFO bytes/mtime 保持不变；无 Libra cleanup 或源材料副作用。
- `arca.product.accepted@1` 与 `arca.offload.completed@1` 尚未由 Libra 正式消费。
- typed TMDB construction response 不构成真实 Provider acceptance。
- Series/JAV/Western Adult、横向 Feature Matrix 以及 `F02.17` 尚未验收。
