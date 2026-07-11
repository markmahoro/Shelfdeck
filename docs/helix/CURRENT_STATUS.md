# ShelfDeck Architecture Current Status

Status: Beta not achieved; production disabled; architecture redesign in Design.

Last updated: 2026-07-12

## Current conclusion

原Helix Beta实现不能作为发布候选。问题不是单个Bug，而是顶层业务模型缺少Deck ownership、
On-deck、Deck Health、Aftercare及清晰的People/User Perception边界。

当前代码仍主要实现`Libra Membership → Nexora onboarding → Kairox maintenance →
maintenanceComplete`，而目标已经变为`Libra Pre-deck delivery → Deck acceptance/deckId →
Deck Health/Aftercare → Off-deck destruction`。旧测试不能证明新业务架构成立。

## Safety state

- 生产ShelfDeck容器保持停止。
- 四库真实来源E2E已终止，不得续跑。
- 不构建或部署新的生产镜像。
- 已授权破坏性样本也不得在Design阶段使用。
- `media-desktop`继续排除，并保留用户现有未提交修改。

## Potentially reusable assets

- Kairox immutable FlowPlan、durable Event Runtime和原子Capability。
- Resource Governor与Event性能诊断。
- Nexora observation、Triage与SourceBinding基础。
- Season Subject / Episode Asset执行结构。
- Admin Web现有页面与Person UI骨架。

这些资产必须重新审计Owner；“可复用”不表示合同已经接受。尤其Library Policy、Membership、
Offboarding、Person Catalog和长期maintenance语义需要clean redesign。

## Documentation state

- `ARCHITECTURE.md`是当前最高优先级业务合同。
- `SERVICE_CONTRACTS.md`只记录确认的handoff方向，精确Schema仍未决。
- `CURRENT_PLAN.md`已切换为Design-only。
- 下层文档若含旧术语，只能在顶层合同约束下读取；后续设计完成后再clean cut。

## Open risk

最大风险是继续在旧Schema上实施，造成Membership/deckId、Policy、Post-deck和Person事实
双Owner。当前通过暂停代码、E2E和生产部署控制该风险。
