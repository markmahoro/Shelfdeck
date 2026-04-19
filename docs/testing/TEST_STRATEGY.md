# TEST_STRATEGY — 测试策略（占位）

> **SSOT 路径**：`[TEST_STRATEGY.md](./TEST_STRATEGY.md)` · 文档索引 `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`

## 范围

- **控制面**：`control-plane` 内含 Fastify `inject` 级 API 测试（`npm test`）。
- **桌面**：以手工与后续 E2E 规划为主；用例与追溯待补充。

## 准出准则

发版前至少通过：控制面测试套件、关键路径手工冒烟（连接 Emby、任务中心删除/转码主链路）。

## 追溯与关联文档


| 文档                                                         | 关系      |
| ---------------------------------------------------------- | ------- |
| `[DESIGN_TASK_CENTER.md](../design/DESIGN_TASK_CENTER.md)` | 验收与主链路  |
| `[DEV_SETUP.md](../dev/DEV_SETUP.md)`                      | 运行与测试命令 |
| `[PRJ_MANAGEMENT.md](../project/PRJ_MANAGEMENT.md)`        | 发版与里程碑  |
