# UAT-294：77集 FinalInventoryDecision 超过存储上限

2026-10-12 现场补验：已完成的人世间58集Run c8e9ded983da364c62c5e43c52dd1483beb0b0c0f3c96a1680d0e790bcfd5976，最终Inventory Decision为70347字节；庆余年36集为65733字节，均超过原65536字节限制并形成唯一On-deck Commit。结合既有双平台77集及容量负向测试，关闭本项。只读证据`.codex/series-release-20261012/local-capacity-final.json`，不改历史决策。

以《白鹿原》77集规模新增独立完整Host回归。第一次222.16秒因原47集220秒等待上限结束，当时媒体选择正常running，非业务失败。为77集单独设置500秒旅程/600秒测试上限，保留原47集时限和全部验收断言；第二次271.77秒复现真实失败：CHECK constraint failed: length(CAST("decision_json" AS BLOB)) <= 65536。

代码写入点：Arca Handoff B acceptance store 的 insert_final_inventory_decision，SSOT arca_final_inventory_decisions 明确将完整FinalInventoryDecision限制64 KiB；它逐项覆盖Package成员与关联映射，独立于此前获批的Acceptance、Stage及Final/Fulfillment完整证据容量。2026-10-09用户已确认仅将Arca完整决策值扩至8 MiB，成员1024、摘要与完整映射保持，Foundation64 KiB不变。已同步SSOT、精确表合同、DDL编译/验证及Schema摘要；不新增旧Run兼容。原Schema的字节CHECK升级保持所有行、索引及外键，历史证据不变。

复现命令：HELIX_SERIES_LARGE_SCOPE=1，node --test --test-name-pattern="77 Episodes through metadata and Direct On-deck Commit$" media-service/test/helix-architecture/series-routing-run.test.js。外部日志uat286-77-host-final.log；精确Owner/字节数诊断正在补齐。新增77集用例为显式开启的容量回归，当前已知失败，不算PASS；其他已通过47集证据保持其原范围。

精确复验：264.32秒稳定命中同一写入；Owner repository=arca_handoff_b_acceptance、operation=insert_final_inventory_decision、schema=helix://contracts/domain-types/FinalInventoryDecision/v1，完整值97,662字节，超过65,536字节限制。仅打印合同/操作名、字段名及字节数，无媒体内容或凭据。日志uat294-77-diagnostic.log。

定向验证：25项合同/DDL/Schema测试通过，含8 MiB精确边界接受、超一字节拒绝、Foundation超过64 KiB仍拒绝、原记录逐字节保留和重复执行无变化。Windows/Linux 77集完整Host复验进行中。

修复后Windows首次完整复验501.58秒达到测试等待上限：97,662字节Decision成功持久化，Stage、Placement Switch、FinalProductVerification全部succeeded，正在逐项结算且无failed Event。仅77集显式容量fixture改为1100秒等待/1200秒测试上限，47集及以下原时限不变；全链路及来源保护断言保持。不将等待超时计为PASS。

Windows完整Host复验通过：640.05秒，77 Episode全部经正式流程至唯一On-deck Commit，stageBytes=152579，Final/Fulfillment完整证据分别121204/110485字节，所有Foundation Result仍有界。日志uat294-77-complete.log。Windows25项合同/DDL/Schema与40项表合同/边界/语义通过（初次表合同测试的精确允许列表未更新，补入该唯一Arca列后19项builder复验通过）；Linux22项DDL/Schema通过。Linux77集完整Host较早500秒尝试也因正常结算未完超时，已用相同1100秒fixture复验，结果待补。

Linux完整77集Host复验通过：658.09秒，唯一On-deck Commit；stageBytes=144780，Final/Fulfillment完整证据119489/108770字节，boundedFoundationResults=true。日志uat294-linux-77-complete.log。修复已加载本地18081；实际人世间/白鹿原批次因另项TMDB传输超时仍在失败证据流程（UAT-295），不能把隔离容量回归PASS替代现场全部上架验收。无UI代码或NAS部署，本次不重建桌面发行包。
