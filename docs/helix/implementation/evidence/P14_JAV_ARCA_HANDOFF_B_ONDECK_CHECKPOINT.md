# P14 JAV Arca Handoff B / On-deck Checkpoint

状态：**FROZEN — 待 Architecture active review / P14 独立复验**

## Baseline 与范围

- Accepted source baseline：`cbb241f7`。
- P14 JAV Production / open Handoff B evidence：
  `f30993fc7d1575adc5d7f336db9242e5575788d7`
  （local tested `a42d4715`）。
- 本checkpoint只覆盖：
  `one open libra.product-offer.available@1
  → Arca Handoff B Accepted
  → Inventory staging/material effect
  → Arca On-deck Commit`。
- 明确未执行：Libra消费`arca.product.accepted@1`、
  Libra消费/查询`arca.offload.completed@1`、Run completion、
  Workspace cleanup、Western Adult、横向Feature Matrix。
- deterministic typed JAV Provider fixture只用于施工验证，不声明real
  Provider acceptance。

## Vertical continuity

- Clean Service不再在JAV open Offer处短路；它复用Movie/Series已接受的
  `ProductDeliveryPort → ArcaAcceptanceFacade → MovieOnDeckCoordinator`
  正式链路。Composition Root只接线，不持Store或作Handoff业务判断。
- Arca只通过`ProductDeliveryPort` historical/acceptance-fence读取完整Package；
  不读取Libra Store、Provider cache、latest/current结果。
- 历史Package保持：
  - `single/jav`；
  - 1个`primary_payload`；
  - 1个`metadata_sidecar`、1个`poster`、1个`fanart`；
  - 4个Product members的Episode claims全部为空；
  - exact Resolved Identity、Product Metadata、empty Media Cast、
    Artifact Manifest、Production Attestation、Package/Control continuity。
- Handoff B责任绑定包含4个Product bindings和1个正式Off-load context
  binding；两类binding的Episode claims均为空。Final Inventory只建立4个
  Product members，不把Off-load context重复建成Inventory。

## Owner / transaction / physical result

- PBF-19 Handoff B Accepted canonical transaction原样复用并原子建立：
  terminal Attempt、Acceptance Decision、Final Inventory Decision、
  initial On-deck Run、Custody、5个Bindings、Control transfer、
  Handoff Receipt、Result/marker、Accepted Outbox。
- 首个Accepted事务内部fault后只保留既有active Attempt；Decision、Run、
  Custody、Binding、Receipt、Control与Outbox均回滚。
- Inventory materialization对4个Product members分别使用既有
  `material_commit` effect journal，最终恰好4个committed effects和4个
  物理Target文件。
- On-deck Commit建立且仅建立：
  - 1个active Shelf Entry；
  - 1个active Deck Fact；
  - 1个Inventory revision / 4个Inventory members；
  - 1个On-deck Commit Receipt与1个Off-load Completion Fact；
  - 4个由Arca Shelf Entry持有的current Material Controls。
- fault-after-On-deck-commit-before-response后重启，从Arca Owner history
  重建同一Package、Decision、Inventory、Deck Fact和typed Result；不重复
  effect、Entry、Fact、Receipt或message。

## Message freeze 与源文件安全

- open Offer只由Arca intended consumer消费/ack一次。
- `arca.product.accepted@1`与`arca.offload.completed@1`各有且仅有一个
  durable Outbox message；均没有Libra Inbox receipt，未被消费/ack。
- Libra Run仍为`active`，`libra_delivery_receipts=0`，
  `libra_workspace_cleanup_scopes=0`。
- 原JAV MKV/NFO/poster及无关文件bytes、size、mtime保持不变；
  Arca只写disposable Shelf Target。

## 验证与机器基线

- JAV public HTTP / transaction rollback / inventory effect /
  commit-before-response / restart-replay：`4/4 PASS`。
- Movie/Series共享Handoff B与responsibility regression：`5/5 PASS`。
- 完整`npm run test:helix-architecture`：
  `132 files / 887 tests PASS`，findings与`prohibitedActionsRun`均为空。
- 机器库存保持：
  112 Capabilities / 97 Result families / 177 tables /
  43 canonical transactions / 114 routes / 18 UI surfaces。
- Contract aggregate：
  `c1cd53125ffc6055e57cd00b2c8a388b42405b49194ec0aa1292ff5cb350447a`。
- SSOT source-map aggregate：
  `a54b0b3934b8a5a574cf7e1d17370501564e136cdbe9c470082efe9d1f7ce209`。
- Manifest aggregate：
  `1078633da3e788979098d811d0409c1a5520e46d67aac54d33655f4288e77c37`。

## Residual / 下一步

- Architecture/P14 ACCEPTED前冻结本checkpoint，不消费Libra Accepted/
  Off-load messages，不进入Workspace cleanup。
- 下一有界段才可执行JAV责任闭合。
- Material Field `contentProfile Hint` Owner-row/API continuity仍是Western
  纵切前独立closure。
- `F09`不提前标记PASS；`F02.17`继续为`NOT_RUN`。
