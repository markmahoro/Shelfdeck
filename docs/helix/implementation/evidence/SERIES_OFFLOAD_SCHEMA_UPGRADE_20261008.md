# Offload历史表升级验证

日期：2026-10-08；基线 `4a94beae7688818c3a44a4e2b7994e6e5ecdae95`，当前Phase多目标交接工作项。

沿既有事务schema升级入口识别精确旧schema摘要 `efa5340869a40216e3b2750293cbcb65fa3c7bc1c6950eb01eaf012b9f496a90`，冻结原/目标Offload DDL，仅重建该表增加nullable多目标列与互斥CHECK。保留全部旧列及其规范摘要、显式索引/触发器和外键；历史Package/Run/Arca/Custody/Shelf记录不作翻译。当前schema重放无修改。此实现替代上一批次的临时旧表拒绝门禁。

未完成Run或缺少同Package ID、同摘要且已Commit的Custody/OnDeck Run拒绝升级，要求显式授权的Formation Reset；不自动清理、不填补旧NULL映射。源catalog或表DDL漂移拒绝，目标CHECK或foreign_key_check失败沿原事务回滚，不写新marker。

使用Git `585023fe0` 中完整旧DDL的gzip fixture，解压后校验SHA256。合成已完成Movie记录在升级后原列、Package摘要及其他历史row保持，当前SQLite Kernel可正常打开；重复升级无变化。active Run、未Commit Package、错Custody摘要、active Custody、NULL目标和catalog漂移均拒绝且原表/marker不变。复制后主动抛异常验证DDL/row/marker完整回滚及一次正常重试；这不是进程强杀/断电验证。

28项升级与既有Series artifact scope/defect admission回归通过（10.9秒），P2合同、包边界454文件/1433依赖、语义2073文件和diff检查通过。初次实现误引用OnDeck Run不存在的Package列，已改为正式Custody关联；新增负向测试曾使用非法Custody枚举，已改用正式active值后复验。日志位于 `E:/my_project/helix-git-consolidation-20261008/series-offload-upgrade-v4.log` 与 `series-offload-upgrade-contracts.log`。

上述为精确历史DDL及合成关系数据验证，不是生产副本升级/回退或完整历史Movie Host验收。未读取或修改NAS。Assembler完整映射、Arca全部目标验证/一次结算、Coordinator/真实外部Host、生产副本升级与Linux/UI等发布条件继续，Series尚不可声明可部署。
