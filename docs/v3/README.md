# ShelfDeck v3 Agent Context

本文档目录包含 v3/v3.1 的架构契约、语义参考、运行上下文和历史记录。不同文件地位不同，不能互相覆盖。

从 v3.1 起，`KAIROX_ARCHITECTURE.md` 是本目录中的命名架构契约入口。其他文件继续作为业务语义、运行上下文、讨论结论和切片事实来源。

## 文档优先级

| 地位 | 文档 | 使用规则 |
| --- | --- | --- |
| Contract | `KAIROX_ARCHITECTURE.md` | 最高优先级；核心链路改动以它为准 |
| Engineering guardrail | `KAIROX_ENGINEERING_PLAYBOOK.md` | Kairox 工程施工规范；核心链路动手前必须读，防止把 Mirex 换皮成 Kairox |
| Implementation map | `docs/v2/ARCH_OVERVIEW.md` | 当前代码已经落地的系统事实；不是架构契约 |
| Semantic reference | `BUSINESS_MODEL_NOTES.md`、`USER_INTERVENTION_AND_FULL_AUTO.md`、`DATA_MODEL_NOTES.md` | Kairox 下的细节参考；冲突时以 Kairox 为准 |
| Operational reference | `OPERATION_CONTEXT.md`、`docs/v2/PRODUCTION_DEPLOYMENT.md`、`docs/v2/DEBUG_WORKFLOW.md` | 生产、部署、调试和安全入口 |
| Historical log | `V3_1_PROGRESS.md`、`V3_1_DISCUSSION_NOTES.md` | 历史讨论和切片证据；不能覆盖 Kairox |
| Historical/deprecated | `V3_0_1_BUSINESS_FLOW_DECISIONS.md` | Kairox 前的历史判定；只能用于理解旧上下文 |

如果历史文档和 Kairox 冲突：

1. 实现以 Kairox 为准。
2. 当前落地实现事实可参考 `docs/v2/ARCH_OVERVIEW.md`，但它不能覆盖 Kairox。
3. 只有为了考古、回滚或迁移旧行为时，才读取历史文档中的旧判断。
4. 若历史记录继续造成实现歧义，应在该文档顶部补状态说明，而不是把旧判断复制进新设计。

## 当前命名

- v2：当前生产环境正在运行的 ShelfDeck 版本。
- v3：准备优先重构升级 service 与 service Admin Web 的新版本；desktop 与 worker 重构方案待定。

## 文档入口

| 文件 | 用途 |
| --- | --- |
| `KAIROX_ARCHITECTURE.md` | Kairox 架构契约；v3.1 之后核心链路改动前必须先读 |
| `KAIROX_ENGINEERING_PLAYBOOK.md` | Kairox 工程施工规范；固定术语、分层禁区、开工检查、审计命令和完成判定 |
| `OPERATION_CONTEXT.md` | v3 agent 需要知道的生产环境、NAS、部署、测试和安全边界 |
| `BUSINESS_MODEL_NOTES.md` | v3 重构前已经确认过的业务概念共识，不规定技术实现 |
| `DATA_MODEL_NOTES.md` | SQL 持久化层、内存运行层、projection 的原则性数据模型共识 |
| `V3_0_1_BUSINESS_FLOW_DECISIONS.md` | 当前 worktree v3.0.1 业务流程细节判定表、入口收口和剩余问题 |
| `V3_1_PROGRESS.md` | v3.1 用户视角可用版的切片进度、事实来源和剩余标准 |
| `V3_1_DISCUSSION_NOTES.md` | v3.1 推进中已讨论确认、后续切片必须先读的产品语义和排查结论 |
| `V3_3_GA_RECOVERY_PLAN.md` | v3.3 GA 恢复计划、生产验收事实和恢复期 guardrails |
| `V3_4_REBASELINE_PLAN.md` | Kairox 引入 User Perception 后的 v3.4+ active rebaseline 计划 |
| `V3_4_PLUS_ROADMAP.md` | v3.3 GA 之后 v3.4+ 的版本拆分、目标和验收标准 |
| `KAIROX_PERFORMANCE_PLAN.md` | Kairox Beta 后的调度供给、性能 smoke 和生产压测验收计划 |
| `V2_BEHAVIOR_PRESERVATION.md` | v3 重构前必须盘点和保护的 v2 生产行为细节 |
| `DISCOVERY_CHECKLIST.md` | v3 agent 开工前需要排摸的代码、数据、测试和部署清单 |
| `GOAL_PROMPT.md` | 可用于开启 v3 长程任务的提示词 |

## 重要原则

- Kairox 架构是 ShelfDeck v3.1 演进阶段的命名架构契约；修改 scheduler、task admission、automation、flow executor、resource runtime、生产部署或模块边界前，必须先读 `KAIROX_ARCHITECTURE.md` 和 `KAIROX_ENGINEERING_PLAYBOOK.md`。
- Mirex 是 Kairox 之前的旧兼容模型；允许识别、兼容和迁移，不允许作为新功能设计来源。
- v3 agent 必须先排摸代码库，再提出架构和实施方案。
- 除 Kairox 明确规定的架构方向外，本目录不预设 v3 的具体组件拆法、数据模型或迁移实现。
- `BUSINESS_MODEL_NOTES.md` 只约束业务语义，不约束技术形态。
- `DATA_MODEL_NOTES.md` 只约束数据分层原则，不约束最终 schema。
- `V2_BEHAVIOR_PRESERVATION.md` 用于防止重构时遗漏 v2 生产细节。
- 当前生产部署和回滚信息以 `docs/v2/PRODUCTION_DEPLOYMENT.md`、`docs/v2/PRODUCTION_BASELINE.md` 为准。
