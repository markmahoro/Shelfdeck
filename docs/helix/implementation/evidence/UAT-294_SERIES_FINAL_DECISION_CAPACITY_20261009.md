# UAT-294：77集 FinalInventoryDecision 超过存储上限

以《白鹿原》77集规模新增独立完整Host回归。第一次222.16秒因原47集220秒等待上限结束，当时媒体选择正常running，非业务失败。为77集单独设置500秒旅程/600秒测试上限，保留原47集时限和全部验收断言；第二次271.77秒复现真实失败：CHECK constraint failed: length(CAST("decision_json" AS BLOB)) <= 65536。

代码写入点：Arca Handoff B acceptance store 的 insert_final_inventory_decision，SSOT arca_final_inventory_decisions 明确将完整FinalInventoryDecision限制64 KiB；它逐项覆盖Package成员与关联映射，独立于此前获批的Acceptance、Stage及Final/Fulfillment完整证据容量。已请求确认仅将Arca完整决策值扩至8 MiB，成员1024、摘要与完整映射保持，Foundation64 KiB不变。待用户确认，未修改合同/DDL。

复现命令：HELIX_SERIES_LARGE_SCOPE=1，node --test --test-name-pattern="77 Episodes through metadata and Direct On-deck Commit$" media-service/test/helix-architecture/series-routing-run.test.js。外部日志uat286-77-host-final.log；精确Owner/字节数诊断正在补齐。新增77集用例为显式开启的容量回归，当前已知失败，不算PASS；其他已通过47集证据保持其原范围。
