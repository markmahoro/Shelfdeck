# P14 Western Arca Handoff B / On-deck Checkpoint

状态：**FROZEN — 待 Architecture active review / P14 独立复验**

## Baseline 与停止点

- P14 已接受的 Western Production / open Handoff B source：
  `713aa834`；P14 evidence：
  `eb7448e1`（tested local `e5a0d7c6`）。
- 当前实现闭合由本文件所属checkpoint commit冻结。
- 输入是唯一open `libra.product-offer.available@1`及其正式
  `ProductDeliveryPort` historical reconstruction。
- 停止点是Arca `On-deck Commit`完成并建立一个active Shelf Entry与Deck Fact。
- Libra尚未消费`arca.product.accepted@1`或`arca.offload.completed@1`；
  Libra Run保持active，Delivery Receipt、Workspace Cleanup Scope均为0。

## 完整纵切

同一Western Package沿既有Movie/Series/JAV PBF-19 receiving path完成：

`open Product Offer
→ ProductDelivery historical reconstruction
→ Handoff B Assessment / Accepted atomic commit
→ Final Inventory Decision / initial On-deck Run
→ Custody / Binding / Material Control transfer
→ Inventory staging physical effects
→ fulfillment verification
→ On-deck Commit
→ active Shelf Entry / Inventory Representation / Deck Fact / Own`

Clean Composition只把Western的阶段门禁从Arca Facade之前移动到On-deck
Commit之后；Arca application、Store、canonical transaction与Inventory adapter
均复用既有正式路径，没有Western专用Store、业务判断或跨Owner读取。

## Product、Control 与历史连续性

- ProductDelivery完整保留一个`primary_payload`、一个`metadata_sidecar`和一个
  `poster`，即当前Package实际3个成员。
- 三个Product member的Episode Claim集合均为空；Handoff B Binding与Inventory
  Material继续保存同一closed empty claim set。
- Handoff B Accepted事务原子形成terminal Attempt、Acceptance Decision、
  Final Inventory Decision、initial On-deck Run、Custody、Bindings、Control、
  Receipt、Result/marker及Accepted Outbox。
- On-deck Commit以后，正式历史读取从exact Package、Custody、Binding、
  Inventory rows、Representation与Deck Fact重算同一结果；重放不读取Libra
  Store以外的非正式状态，也不扫描latest/current。
- Product Offer只由Arca intended consumer消费并ack；两个Arca输出消息均保持
  durable、未被Libra消费。

## Crash / restart / replay

- Handoff B Accepted事务在Accepted responsibility写入点故障时完全rollback：
  Attempt仍为active，Decision、Custody、Run、Final Decision、Binding与Receipt
  全部不存在。
- 首个Inventory物理效果后故障：Accepted责任集合完整存在，一个Effect保持
  intended，Shelf Entry/Deck Fact仍不存在；重启从同一effect reality恢复。
- On-deck Commit成功、HTTP响应前故障：重启历史重建同一Shelf Entry、
  Inventory、Deck Fact与Receipt，不产生第二Effect或第二业务事实。
- 最终3个`material_commit` Effect均为committed；重放前后Target三文件的
  SHA-256、size、mtime完全一致。

## Safety 与边界

- 原Western Primary、NFO、poster及unrelated sidecar的SHA-256、size、mtime
  前后完全一致。
- 物理写入仅发生在P14 disposable Arca Shelf Target；没有执行Libra cleanup，
  没有删除或改写Workspace与源材料。
- Arca只通过正式ProductDeliveryPort、Arca Owner-local Store和Foundation
  participants工作；无Libra Store补读、Provider cache、Foundation Result
  fallback、compatibility、Worker、Desktop、Ollama或NAS路径。

## 验证与机器基线

- Western纵切及Movie/Series/JAV/P10 receiving回归：`31/31 PASS`。
- 完整`npm run test:helix-architecture`：`133 files / 899 tests PASS`。
- Dependency、semantic、machine contract findings均为0；
  `unresolvedTypeRefs=0`，`prohibitedActionsRun=[]`。
- 核心库存：112 Capability / 97 Result family / 178 Table /
  43 Canonical Transaction。
- Manifest aggregate：
  `345a974464886d213ca36ba21678bd7ad88ece5b2a081f34f4ddbc94accdc3d9`。
- Contract aggregate：
  `c5a62e222ce4063f7ad05073f343e525d417f625cc937ee5f1284a2cf2090995`。

## Residual

- 当前deterministic Western Provider/analysis与合规HEVC/Matroska/MKV输入仅为
  construction evidence，不是real Provider/face acceptance。
- 现有实际Western H.264/MP4且大于1 GiB的样本对冻结Spec继续正确fail closed；
  本checkpoint未为它新增转码或放宽Requirement。
- Western responsibility closure、Feature/UI横向、`F02.17`与真实Provider验收
  均未开始；当前不得消费Libra Accepted/Off-load消息。
