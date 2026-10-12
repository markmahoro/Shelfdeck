# UAT-292：Series 健康检查的旧 Care Basis 规划收敛

2026-10-12 独立复验关闭：修复已加载本地18081；在当前源码83844df86上重新运行最初复现问题的真实文件系统Host时序（两集逐集thumb/NFO入藏、后台旧空季目录清理完成、更新Placement、完整迁移），1项通过、0失败、0skip，业务用时92.42秒。旧Basis仍按正式失败合同收敛，新Basis迁移及关联文件验证完成。原问题本身来自这一Host现场，不是棋士遗留文件处置；不据此关闭UAT-291。日志：本地ignored `.codex/series-release-20261012/uat291292-current-migration.log`。本次未操作NAS生产。

复现：带逐集 thumb 的两集完整 Host 上架后，等待后台旧季目录清理，再发布新的 Placement 并触发检查；此前尚未规划的健康检查使用旧 Care Basis，Planner 抛出普通异常，Execution Host 将其保留为 Work-local fault，缺少正式终态。

修复：Arca Planner 仍严格拒绝旧 Basis，但返回既有 contract_unplannable WorkflowPlan，diagnosticClassification=ARCA_AFTERCARE_BASIS_STALE、零 Event，保留原 executionBasisDigest。Foundation 沿原 Work Lifecycle 记录失败；新 Basis 的检查继续由 Arca 创建。未绕过 Basis/Fence，未新增跨 Owner 决策或历史 Run 兼容。

验证：28 项逐集 Aftercare及53项生命周期/Case/合同测试通过；额外校验 stale Plan 可通过正式 WorkflowPlan 验证、无可执行节点、原摘要保留。原竞态时序完整 Host（HELIX_SERIES_RELATED=1、HELIX_SERIES_CLEANUP_BEFORE_MIGRATE=1）91.53秒通过，包含完整迁移、关联图持久化及源空季目录保护。

尚未加载现场，不以隔离回归关闭现场验收。原错误日志保存在本地测试目录 uat291-migration-final.log，新证据 uat292-tests.log、uat292-migration-host.log；无生产动作。
