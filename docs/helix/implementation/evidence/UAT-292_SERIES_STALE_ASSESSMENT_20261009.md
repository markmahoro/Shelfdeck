# UAT-292：Series 健康检查的旧 Care Basis 规划收敛

复现：带逐集 thumb 的两集完整 Host 上架后，等待后台旧季目录清理，再发布新的 Placement 并触发检查；此前尚未规划的健康检查使用旧 Care Basis，Planner 抛出普通异常，Execution Host 将其保留为 Work-local fault，缺少正式终态。

修复：Arca Planner 仍严格拒绝旧 Basis，但返回既有 contract_unplannable WorkflowPlan，diagnosticClassification=ARCA_AFTERCARE_BASIS_STALE、零 Event，保留原 executionBasisDigest。Foundation 沿原 Work Lifecycle 记录失败；新 Basis 的检查继续由 Arca 创建。未绕过 Basis/Fence，未新增跨 Owner 决策或历史 Run 兼容。

验证：28 项逐集 Aftercare及53项生命周期/Case/合同测试通过；额外校验 stale Plan 可通过正式 WorkflowPlan 验证、无可执行节点、原摘要保留。原竞态时序完整 Host（HELIX_SERIES_RELATED=1、HELIX_SERIES_CLEANUP_BEFORE_MIGRATE=1）91.53秒通过，包含完整迁移、关联图持久化及源空季目录保护。

尚未加载现场，不以隔离回归关闭现场验收。原错误日志保存在本地测试目录 uat291-migration-final.log，新证据 uat292-tests.log、uat292-migration-host.log；无生产动作。
