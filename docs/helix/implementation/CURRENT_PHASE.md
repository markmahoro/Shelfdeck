# 当前活动包：逐项关闭UAT

更新：2026-09-08 22:21。唯一顺序见[Master Plan](../CURRENT_PLAN.md)，逐项剩余工作、依赖和关闭条件见[UAT总表](../UAT_ITERATION_REGISTER.md)。

## 当前批次

1. UAT-212：利用真实在飞转码对照列表/详情。美国队长动作、5%及ETA一致；素媛等待资源。两处说明矛盾已本地修正，25后端过程测试、61 Web测试及构建通过，待本地浏览器与统一发布验收。继续维护实际动作/等待/失败/完成及两页真实操作性能；不因局部修正关闭整个212。
2. B2：128子进程Effect恢复通过，补完整Host自动收口→213冻结目标/恢复→210记录节流及Case全链→217正式身份重算；218真实输入质量保护对比。211、214、215已关闭，证据留存。
3. B4：146扫描/分拣阶段说明已浏览器验收关闭；243策略按需读取、刷新保留草稿本地64 Web/构建及浏览器HTTP数量验证通过，待生产验收；其余历史全站按Master Plan顺序逐行审查、验证；缺设备/代理证据按对应UAT明确记录，不能用一个总待办无限搁置。
4. B1的251继续已确认三终局传播；瑕疵修复触发与健康展示具体合同未确认。受其影响部分先设计，独立工作继续。
5. B5候选d24f13b3db构建/上传校验/dry-run及Linux12个GET通过；刷新精确在飞及存量清单、新一致备份后统一发布。当前生产696b122da4，《素媛》《美国队长》在飞，勿中断。250旧Candidate Control冲突继续只读因果核实；216样片/另一完整版本未处置。

## 验收与授权

- 每行对照原问题、最新合同、当前实现、正负路径、适用真实浏览器/媒体、部署身份及未测风险。部署和测试通过不自动关闭。
- 213旧Case缺失创建目标不得用当前policy倒填；历史失败与当前健康分开；Aftercare保留自身阶段。
- 用户已授权实施、本地测试后标准发布及NAS本项目必要清理。253清理完成，22:10可用65.71 GiB；保护媒体、在飞任务、生产备份及回滚，不扩大为Reset/清库授权。
- 标准build/upload/checksum/dry-run/apply与回滚材料齐备；发布前刷新任务状态。Emby归因审查与5分钟自动化保持停止。
- 原Aftercare调查Evidence的未提交修改保持原样，不夹带提交。

## 证据入口

- [完整基线](evidence/UAT_FULL_REGISTER_RECONCILIATION_20260908.md)、[212进展一致性](evidence/UAT-212_CURRENT_PROGRESS_PARITY_20260908.md)、[212分页](evidence/UAT-212_PAGINATION_CONTINUATION_20260908.md)。
- [215上架收尾](evidence/UAT-215_ONDECK_SOURCE_CLEANUP_20260908.md)、[250存量](evidence/UAT-250_FORMATION_STOCK_GOVERNANCE_20260908.md)、[253空间清理](evidence/UAT-253_NAS_RELEASE_TAR_CLEANUP_20260908.md)。
- [此前进度快照](archive/20260908_2221_ITERATION_PROGRESS/CURRENT_PHASE.md)仅为历史；各行详细证据通过总表追溯。
