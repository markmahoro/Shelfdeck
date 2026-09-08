# UAT-215 Arca上架旧目录收尾

更新：2026-09-08。状态：本地实现与定向验收，未部署、未关闭。UAT-216存量物理治理单独验收。

## 发现与合同

原回收Effect具备精确manifest、跨盘中断恢复、30天保留及不覆盖恢复；原发现循环只处理空目录，非空与发现失败不落持久记录，扫完全部Entry后等待一天。新上架未建立单独可恢复的收尾责任，不能把已有手动回收能力视为完整流程。

- On-deck Commit同事务插入`arca_source_cleanup_checks`，不靠提交后Signal才能恢复。Arca按持久到期索引每次检查一个Run，最多32个正式Off-load Context旧Binding父目录。Product Workspace handle排除，Libra Workspace回收责任不变。
- 空目录可通过原精确manifest/Effect归档；观察与归档间新增文件必须转待确认或拒绝旧确认。非空目录后台仅查是否为空，不递归哈希，不取得清理权限。
- 持久结果区分不存在、已归档、等待归档、待确认、当前材料使用而保留、用户恢复而保留、具体检查失败。5分钟失败/待归档节流、24小时待确认复查；不会因回收结果改变健康、历史Case或上架成功。
- 用户恢复后不自动归档回去。已归档条目的执行错误、跨盘恢复和过期清理沿用原持久Effect。收藏/整理不新增回收入口；系统设置独立Tab展示收尾状态、精确目录与预览。
- 旧Entry不补写自动收尾责任。本轮schema升级只新增空表，不清理、重置或重新采购历史数据；旧目录仍按UAT-216精确清单授权。

## 实现及证据

1. SSOT 8.5.14与On-deck Commit派生合同同步，当前113 Capability / 99 Result / 188 tables / 45 Canonical Transactions。P2 aggregate：`db50053a2f8d296e4d49ea2fef493d8700c9a550be8c10b3405cf0e03b548794`。
2. 定向21项PASS：精确归档/恢复/跨盘中断/过期新增文件保护；新收尾重启、非空不哈希、不自动确认竞态、并发tick排斥、错误节流、当前材料保护、历史Entry无自动归档；精确生产schema升级保留既有Entry及active Run、空表无回填并可重放。日志`.codex/uat215-targeted.log`。
3. 222文件架构Fixture与dependency/semantic/manifest/P2四门禁PASS，`.codex/uat215-architecture-final.json`；之后异步检查busy保持修正有独立并发负路径PASS。
4. Web58项PASS，构建PASS。Edge本地真实操作：系统设置→回收站→持久待确认/错误/保护说明→检查影片→展开精确清单→看见poster.jpg及明确范围确认按钮。合成API禁止所有POST，未调用生产清理；不以此替代真实新上架场景。
5. 原one-movie媒体E2E在未提供隔离媒体时SKIP，不能写为PASS。已生成独立2秒1080p H.264/AAC与海报，专门的新上架→原子责任→30秒后台检查→公开API展示→重启无重复责任真实链路PASS（38.2s），没有Aftercare Case。日志`.codex/uat215-cleanup-e2e.log`。完整service串行509 PASS/18 SKIP/0 FAIL（新增媒体场景前527 tests），`.codex/uat215-service-serial.log`。

## 关闭条件与剩余风险

- 验证新上架自动插入一条收尾责任、On-deck重放不重复，实际后台检查/归档/异常在Settings一致展示；真实原目录受保护、完整其他版本/sample保留。
- 完成真实媒体链路和完整service回归，标准Docker候选需包含本提交；在飞任务安全窗口内统一部署并验证。
- 非空存量清单确认仍未执行；不因本流程修复关闭UAT-216。生产原镜像仍运行，未Reset、未改灯色、未删额外NFO。

## 媒体回归进一步发现

旧长链路首次因按文件名把保留sidecar当成正式poster而失败；现场两文件都在初始Inventory，并非Aftercare新增孤儿文件。测试已改为逐路径验证Inventory后按正式role选取修复范围。等待后台检查又使UAT-214的确定人物关联正常提交Inventory revision 2（未创建Case），暴露旧长链路硬编码revision 1/2/3/4的时序假设；完整Aftercare长链路需按每次操作前的实际revision验证，不宣称这条旧长链路通过。保留两次失败现场以继续UAT-210/214验收，不修改生产或删除多余样本来绕过断言。
