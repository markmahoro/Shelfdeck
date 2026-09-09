# UAT-125/152：回收合同残留清理

2026-09-09，局部完成，125/152整体仍开放。

现行生产路径 movie-responsibility-closure-coordinator → workspace-cleanup-contracts 已在 durable Off-load Completion 后开始两轮引用审计，间隔至少一个 CYCLE_MS，没有额外 24 小时等待。

查到旧 delivery-lifecycle-contracts.admitCleanupScope 仍要求 24h，且旧 P9 测试要求维持该行为。全 src/test 引用检索确认该导出仅由旧测试调用，无生产调用者；删除这段已被正式 admission 实现取代的 helper 与旧规则测试，避免未来误接回旧要求。未为旧数据加入兼容路径。

正式 admission 测试改用刚完成的 Completion：一个周期后可准入；未找到 Completion、两次观察未隔开一个周期、新增引用、UoW 前 Control 漂移仍拒绝。Root 真实临时目录测试同时验证修改配置仅重启生效及未知文件保护。Windows 16 PASS，Linux 容器挂载当前 src/test 16 PASS；224 个架构测试文件及 dependency/semantic/manifest/contract Gate 全部通过。

日志为 .codex/uat125-contract-windows.log、uat125-contract-linux.log、uat125-contract-architecture.json。本次删除的是不可达旧 helper，不改变现行生产执行行为；无部署、无生产回收。完整 Runner/用户状态、实际完成与放弃 Workspace 回收及联合压力条件继续开放；本证据不作为整项关闭依据。
