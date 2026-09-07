# 当前实施阶段：PROD-065

2026-09-07。状态：LOCAL_REPAIR_COMPLETE；生产Gate未开启。
用户授权本任务完成 NFO 合同、完整审计和修复；寒战2网络问题不在范围。
基线 d486947c8；独立分支 codex/prod065-settlement-failure。

- 目标：关键媒体事实不变时，外部 NFO 改写不阻止新 Formation 完成上架。
- 证据：evidence/PROD-065_FORMATION_STALL_20260905.md。
- Owner：Libra 观察源与交接 Product；Arca 判定原唯一 Related 关联及 Settlement；Foundation 保留执行恢复证据。
- 合同：SSOT Final Reality amendment、MetadataObservation、ProductionProvenance、SettlementDeletionEvidence。
- 源观察：一次 bounded stable read，记录实际 Snapshot digest 和 key/value 语义 witness；不把旧 checksum 当永久写入锁。
- 持久化：使用已有 ProductionProvenance JSON，按 sourceRef 携带同Run观察；无新增表列、迁移或历史数据补写。
- Settlement：原 exclusive NFO mapping + 原语义 witness + 当前一致快照 + verified replacement；删除前再次核验快照。
- 恢复：前置错误 typed failure；continue-forward 预算耗尽有界停止；不把失败等同于副作用从未发生。
- 测试：同步/异步、同根/异根、原地/atomic改写、事实冲突、无证据、错误关联、删除后重放、源观察和重启交接。
- 最终验收：473项服务测试PASS、18条件SKIP、0 FAIL；210个架构测试文件及所有合同/依赖检查PASS；NFO改写+重启+不可变证据交接+On-deck专项PASS。
- 未执行生产写入、部署、真实媒体恢复、Reset 或 media-desktop 修改。
