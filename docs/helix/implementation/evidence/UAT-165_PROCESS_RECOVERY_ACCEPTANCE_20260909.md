# UAT-165：被取代失败Attempt的启动恢复

2026-09-09按现行关闭条件验收关闭。运行时修复已包含于生产`04ffa8b116`；此次只增加验收，不更改运行时、不新增兼容路径或生产数据修正。更广的125/127/250恢复及169长片时限仍按自身条件开放。

历史PROD-022在仍活的Event上留下旧failed Attempt的workspace_write/reconcile_required Effect，启动仅核验最新Attempt时把旧残留判为无恢复Event，导致拒启。现行StartupRecovery对确定已放弃的非材料提交Effect使用正式EffectJournal记为failed；不能把旧文字“所有未提交Effect均可放弃”覆盖后来已生效的material_commit/destructive_commit保护。

## 新增实际进程与持久化验证

`p4-uat165-process-recovery.test.js`通过独立Node进程打开真实SQLite Kernel、正式EffectJournal与StartupRecovery。Event/Attempt关系为隔离Foundation夹具；Effect的intend、requireReconcile及abandon均调用实际Journal。第一次进程exit(95)不正常关闭Kernel，恢复过程在真实abandon持久提交之后exit(96)，后续新进程读取同一数据库；进一步重启逐字段核对结果不变。

1. superseded：旧failed Attempt的workspace Effect正确failed，两个进程退出后启动ready、允许正常供给；原Attempt失败事实不改为成功。
2. unknown-old：旧Attempt仅deferred而未证明放弃，仍faulted、禁止正常供给，reconcile_required Evidence保留。
3. live-unresolved：当前Attempt仍有未决Effect且Reconciler不可用，仍recovering、禁止正常供给；只清已证明放弃的旧Effect，当前Evidence不丢。
4. uncertain-material：旧失败Attempt的material_commit仍reconcile_required，启动按现行合同ready但不擦除材料Evidence；终局失败不证明物理副作用没有发生。

四场景Windows全部通过；生产同版Linux镜像（仅挂载test、不覆盖src）全部通过。StartupRecovery、EffectJournal与EventRuntime三个现有测试文件Windows/Linux各82 PASS，覆盖超时、未决副作用、恢复预算和幂等Fence。测试未运行长片FFmpeg，也不把Foundation夹具冒充完整业务Host生产链；本项验收对象是精确启动恢复边界，长媒体条件由169承担。

生产标准无损升级、readiness findings为空、running/0重启、82收藏及六路接口前后同口径一致见[发布证据](UAT_RELEASE_04FFA8B116_20260909.md)。已知P4_EVENT_RECOVERY_INPUT_DRIFT保持125/250开放。无Desktop/Web源码变化，此次不重新发布同一运行时。

日志：`.codex/uat165-process-{windows,linux}.log`、`.codex/uat165-boundaries-{windows,linux}.log`。UAT-165独立关闭后，累计56项本轮功能关闭、43项开放。
