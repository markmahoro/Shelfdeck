# UAT-211 精确历史Settlement排除

基线6aff1635b。根因：Aftercare currentContext把原On-deck Custody全部旧Binding交给KnownBindings与物理观察；observeKnownOldBindings未消费已成功结算的逐材料证据，同路径后生NFO被误归回旧责任。

合同：SSOT UAT-211修订。Arca currentContext提供原Commit身份；Context Reader经公开Foundation Work Result Reader仅查询原Run/on_deck_execution，在Arca模型内验证成功SettlementDeletionEvidence、完整payload/record digest、提交前观察时间、精确materialKey及absent/settled_to_final/final_verified和最终映射。只从派生旧义务集合排除，不改持久Binding、不探测后生文件；当前Inventory始终保留，失败/缺证据旧义务继续检查。

验证：node --test test/helix-architecture/p15-uat211-settlement-history.test.js test/helix-architecture/p15-aftercare-contract.test.js test/helix-architecture/p15-inventory-record-refresh.test.js：40 PASS，0 FAIL。架构门禁正在执行，尚缺真实组合链及生产正常重评验收；不关闭。

生产只读核实：镜像helix-beta-20260908-6e37bf5679，Image ID sha256:356c034aca554dc206d7c2050b38d9ba646c6c0c1f43f66d7a57aa1f86f3d976，running；GET health status=ok、generation=helix-clean-v3、normalSupplyAllowed=true。未删除皇家赌场/第三度嫌疑人额外NFO，未改数据或重启。

后续架构门禁：215个Fixture文件通过，dependency/semantic/manifest/contracts全部ok；初轮失败为已确认SSOT正文修订后sourceDocumentDigest未传播，分类合同摘要不变，修订摘要后全门禁通过。结果位于ignored .codex/uat-architecture-result.json。生产场景仍未验收。
