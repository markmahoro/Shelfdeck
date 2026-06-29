# ShelfDeck v3 Agent Context

本文档目录不是 v3 架构设计书，不规定 v3 的具体技术实现。

它只用于给后续执行 v3 全库重写的 agent 提供必要上下文，避免它不知道当前生产基线、NAS 部署方式、测试环境和项目边界。

## 当前命名

- v2：当前生产环境正在运行的 ShelfDeck 版本。
- v3：准备全库重写升级的新版本。

## 文档入口

| 文件 | 用途 |
| --- | --- |
| `OPERATION_CONTEXT.md` | v3 agent 需要知道的生产环境、NAS、部署、测试和安全边界 |
| `DISCOVERY_CHECKLIST.md` | v3 agent 开工前需要排摸的代码、数据、测试和部署清单 |
| `GOAL_PROMPT.md` | 可用于开启 v3 长程任务的提示词 |

## 重要原则

- v3 agent 必须先排摸代码库，再提出架构和实施方案。
- 本目录不预设 v3 的具体组件拆法、数据模型或迁移实现。
- 当前生产部署和回滚信息以 `docs/v2/PRODUCTION_DEPLOYMENT.md`、`docs/v2/PRODUCTION_BASELINE.md` 为准。
