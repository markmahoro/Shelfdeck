# P14 Series Arca Handoff B / On-deck PBF-20 Checkpoint

状态：**FROZEN FOR ACTIVE REVIEW**

## Baseline and scope

- 前置已接受检查点：Series Production / open Handoff B `a05366aa`；
  P14 tested `a4defa8d`，evidence `56062bc8`。
- Architecture修正原样纳入：PBF-20 `f7de52de`、source→staged identity修正
  `d3773374`；实现分支对应提交为`d686b628`、`6178437b`。
- 本检查点只覆盖同一Series Product Offer到Arca Handoff B Accepted、Inventory
  staging及On-deck Commit；冻结在Libra消费Accepted/Off-load消息之前。
- 未开始Series final cleanup、JAV、Western Adult或横向Feature Matrix。

## Construction contract

- `ArcaMaterialEpisodeClaims@1`是closed machine value：0..32个UTF-8有序且唯一
  claim，逐项使用Production nominal claim formula，集合使用nominal set digest，
  canonical JSON不超过16 KiB。
- `arca_material_bindings`与`arca_inventory_materials`不再保存scalar
  `episode_key`；同一physical member各保存一条row及完整claim set。
- `StagedInventoryManifest`成员同时保存`sourceMaterialKey`与target
  `materialKey`；按source、target排序且两者分别唯一。Episode continuity由
  source key对照Product/Final Inventory member，Inventory row只保存target key。
- Primary 1保持E001/E002，Primary 2保持E003；NFO/Poster保持empty set。没有复制
  Material row、压平Episode或给Artifact添加Episode relation。
- Handoff B Binding evidence、Inventory Representation及Deck Fact history均覆盖
  完整claim set。历史读取按exact revision重算Inventory → Representation →
  Deck Fact，任何row/fact digest漂移均fail closed。

## Owner / transaction boundary

- ProductDelivery只经正式ProductDeliveryPort历史重建；Arca不读Libra Store。
- Handoff B Accepted继续使用既有PBF-19原子事务，Owner仍为Arca；Attempt CAS、
  Final Inventory Decision、initial On-deck Run、Custody、Binding、Control、
  Receipt/Result/marker/Outbox边界不变。
- On-deck Commit仍是唯一建立Shelf Entry、Inventory、Deck Fact与Own的边界。
- 没有新Domain、Owner、Store、Handoff、Capability、Result family、table或
  canonical transaction；Composition Root只接线。

## Positive, negative and recovery evidence

- Series真实public HTTP完整到Arca On-deck：一条E001/E002 Binding/Inventory row、
  一条E003 row、两条empty Artifact row；final target四个physical member存在。
- Movie empty-set regression：PASS。
- missing/duplicate/unsorted/tampered claim set、非Primary非空claim：
  fail closed。
- Binding与Inventory历史行分别覆盖closed root extra、closed item extra及
  257-code-point `episodeKey`篡改；读取按exact machine shape拒绝，不能经
  normalization洗白。
- source/target identity、Staged manifest及Product/Decision relation mismatch：
  fail closed。
- Handoff B Accepted事务中断：Attempt保持active，Accepted责任row全部为零。
- Inventory physical-effect中断：journal保持intended，Shelf Entry为零；重启恢复。
- On-deck Commit后中断：重启只返回一份Entry、四条Inventory row与一份Receipt。
- Deck Fact digest篡改：exact historical read以`P14_ONDECK_DECK_HISTORY`
  fail closed。
- 原Series MKV/NFO/artwork bytes与mtime不变；Arca写入仅限disposable target。

## Machine baseline

- Capability / Result / Table / Transaction：`112 / 97 / 177 / 43`。
- Route / UI surface：`114 / 18`。
- Contract aggregate：
  `30089e947738bab7933af3b606cd22336746321e05ae4d4d44a4bd5534e2d4e5`。
- Manifest aggregate：
  `351063009c3d50fe07c3fb70503bb4ff71e30b1ebef40beb3700c2e22a414b18`。
- `npm run test:helix-architecture`：
  `130 files / 880 tests PASS`。
- Dependency findings、semantic findings、contract findings与
  `prohibitedActionsRun`均为空。

## Remaining

- 当前冻结，等待Architecture/P14独立复验。
- 通过后只推进同一Series的Libra Accepted/Off-load消费、Run complete与
  Workspace cleanup；不得提前进入JAV、Western Adult或横向工作。
- typed TMDB fixture仍只属于construction evidence，不是Real Provider acceptance。
- `F02.17`仍为`NOT_RUN`。
