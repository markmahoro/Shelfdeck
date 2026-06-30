# ShelfDeck v3 Agent Context

本文档目录不是 v3 架构设计书，不规定 v3 的具体技术实现。

它只用于给后续执行 v3 service 优先重构升级的 agent 提供必要上下文，避免它不知道当前生产基线、NAS 部署方式、测试环境和项目边界。

## 当前命名

- v2：当前生产环境正在运行的 ShelfDeck 版本。
- v3：准备优先重构升级 service 与 service Admin Web 的新版本；desktop 与 worker 重构方案待定。

## 文档入口

| 文件 | 用途 |
| --- | --- |
| `OPERATION_CONTEXT.md` | v3 agent 需要知道的生产环境、NAS、部署、测试和安全边界 |
| `BUSINESS_MODEL_NOTES.md` | v3 重构前已经确认过的业务概念共识，不规定技术实现 |
| `DATA_MODEL_NOTES.md` | SQL 持久化层、内存运行层、projection 的原则性数据模型共识 |
| `V3_0_1_BUSINESS_FLOW_DECISIONS.md` | 当前 worktree v3.0.1 业务流程细节判定表、入口收口和剩余问题 |
| `V3_1_PROGRESS.md` | v3.1 用户视角可用版的切片进度、事实来源和剩余标准 |
| `V2_BEHAVIOR_PRESERVATION.md` | v3 重构前必须盘点和保护的 v2 生产行为细节 |
| `DISCOVERY_CHECKLIST.md` | v3 agent 开工前需要排摸的代码、数据、测试和部署清单 |
| `GOAL_PROMPT.md` | 可用于开启 v3 长程任务的提示词 |

## 重要原则

- v3 agent 必须先排摸代码库，再提出架构和实施方案。
- 本目录不预设 v3 的具体组件拆法、数据模型或迁移实现。
- `BUSINESS_MODEL_NOTES.md` 只约束业务语义，不约束技术形态。
- `DATA_MODEL_NOTES.md` 只约束数据分层原则，不约束最终 schema。
- `V2_BEHAVIOR_PRESERVATION.md` 用于防止重构时遗漏 v2 生产细节。
- 当前生产部署和回滚信息以 `docs/v2/PRODUCTION_DEPLOYMENT.md`、`docs/v2/PRODUCTION_BASELINE.md` 为准。
