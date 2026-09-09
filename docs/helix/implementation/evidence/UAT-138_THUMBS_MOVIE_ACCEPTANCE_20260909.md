# UAT-138：单 Movie Thumbs.db 完整链验收

2026-09-09，按现行 Oracle 独立关闭。执行已发布 `6bcfd7b33b`，本次仅新增真实媒体测试变体。

在隔离 Field 的单 Movie 子目录生成可播放 HEVC 影片、海报、精确 Thumbs.db 和未知 cache.db。通过正式 Field Observation、Intake、Libra Production、Handoff B、Arca 接纳与 On-deck Commit。Package/Final Verification 后、授权清理前额外生成 later.txt，用于证明后生文件不被扩入处置范围。

结果：1 Shelf Entry、1 completed Run、0 Arca failed Events，六项 Acceptance Checks 全部 passed；正式 arca_inventory_materials 恰有1个原名 Thumbs.db，最终文件与原始字节一致。cache.db 及 later.txt 留在 Source 且内容未变。使用正式持续授权与逐Scope Approval，没有直接改数据库或绕过 Owner 补库存。

Windows 实际 Host 场景 39.67秒 PASS，Related范围4项 PASS；生产同版 Linux 实际 Host 37.24秒 PASS，与3项Related范围合计4 PASS / 0 FAIL / 20名称筛选SKIP。Linux禁网，只读挂载test及媒体生成scripts，不挂载src。

既有Related负向覆盖standalone/multi-movie不关联、未知数据库和不同stem字幕不关联、单Movie及BDMV外层精确名称识别。场景通过 HELIX_UAT135_REAL_MEDIA=1 与 HELIX_UAT138_REAL_MEDIA=1 启用，筛选既有 UAT-132 real Direct 测试；这是该生成夹具的新增子目录/Related变体，不是再次宣称132关闭。测试文件 helix-libra-handoff-b-scenario-e2e.test.js 与 helix-architecture/p7-mixed-field-candidate-context.test.js。

首次运行末尾Evidence查询误用不存在表名，实际流程已成功；修正为arca_inventory_materials后完整重跑通过。Linux首次缺生成scripts挂载，补齐只读挂载后通过。日志：.codex/uat138-host-windows.log、uat138-scope-windows.log、uat138-host-linux.log。

[原记录](../../USER_ACCEPTANCE_TEST_ISSUE_LOG.md) 的旧Canary资格保持FAILED，不改写历史；旧逐文件全等要求不能恢复为删除未知/后生文件的授权。当前正式精确处置由[134](UAT-134_SCOPED_SETTLEMENT_ACCEPTANCE_20260909.md)与[172](UAT-172_AUTHORIZATION_ACCEPTANCE_20260909.md)支撑；[生产发布](UAT_RELEASE_6BCFD7B33B_20260909.md)身份不变。未触碰生产文件，也不关闭其他UAT。
