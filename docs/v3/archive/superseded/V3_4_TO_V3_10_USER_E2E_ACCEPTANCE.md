# v3.4-v3.10 用户视角 E2E 验收

本文记录 v3.4 到 v3.10 的用户视角端到端验收。单元测试、API 测试、build 通过只作为工程证据，不直接等价于用户 E2E 通过。

## 验收边界

覆盖版本：

- v3.4 Kairox Rebaseline
- v3.5 User Perception Foundation
- v3.6 Lifecycle Objective Projection
- v3.7 Optimize Objective Template MVP
- v3.8 Flow Planner Gap Analysis
- v3.9 Transcode Flow Reliability And Recovery
- v3.10 Upgrade Canary

不覆盖：

- v3.11 Scheduler Pressure Policy
- v3.12 Delete Gate Review
- v3.13 User-Usable UI GA

## 验收目标

用户应能从 Dashboard、媒体库、任务中心、归档前目标设置页理解并完成 Kairox 主链路：

```text
媒体条目
-> metadata ready
-> user perception ready
-> objective ready
-> flow planner 解释 no-op / transcode / blocked / upgrade canary
-> task center 展示任务、确认点、失败恢复
-> optimize gate passed
-> archive candidate
```

## 判定规则

- 页面不可打开、全页 loading、控制台关键错误：失败。
- API 正确但页面不能让普通用户理解状态：失败。
- 只能通过内部 payload、DB/WAL、diagnostic log 理解状态：失败。
- 状态解释绕过 Kairox task/objective/flow/gate 语义：失败。
- delete 作为 optimize objective 或 optimize operation 出现在新用户目标路径：失败。
- 通过临时兼容字段或 action-like 文案伪装目标：失败。

## 测试环境

| 项 | 值 |
| --- | --- |
| 数据目录 | 待记录 |
| 服务地址 | 待记录 |
| 构建 | 待记录 |
| 浏览器 | Codex in-app browser |
| 测试数据 | 隔离本地数据，禁止使用 NAS production |

## 场景矩阵

| ID | 用户场景 | 页面入口 | 期望用户可见结果 | API/状态证据 | 结果 |
| --- | --- | --- | --- | --- | --- |
| E2E-01 | Dashboard 可打开并回答服务/媒体库/任务状态 | `/` | 首屏不是全页 loading；能看到媒体库、任务、健康摘要 | `/v1/admin/dashboard/health` 秒级 | 待测 |
| E2E-02 | 归档前目标设置页不是 action 模板 | `/rules` | 标题为“归档前目标”；规则显示目标层级、目标码率、目标编码；不把删除/转码/洗版当成目标 | `/v1/admin/rule-templates` 返回 `targetMediaFacts` | 待测 |
| E2E-03 | 媒体库展示 metadata/perception/objective/lifecycle | `/media` | 用户能看到 rating/watched、目标、生命周期、下一步 | `/v1/library?projection=manage` | 待测 |
| E2E-04 | metadata ready 但 perception 缺失 | `/media` | 显示等待用户感知，而不是元数据缺失 | item `optimizeObjectiveStatus=pending_perception` | 待测 |
| E2E-05 | 已满足 objective 的媒体 no-op | `/media`/`/tasks` | 显示 optimize passed / 可归档；不创建 optimize task | flow selection `no_op` 或 optimize gate passed | 待测 |
| E2E-06 | 需要 transcode 的媒体可解释 | `/media`/`/tasks` | 显示目标差距、创建 transcode task、任务中心能看 target gate / operation | task `targetGate=optimize`、`flowPlan.operationKind=transcode` | 待测 |
| E2E-07 | transcode 失败恢复可解释 | `/tasks` | 用户能看到失败阶段、resume point、recovery class、下一步 | `task.failed.failureSummary` | 待测 |
| E2E-08 | upgrade canary 未配置 MoviePilot 可解释 | `/media`/`/tasks`/`/moviepilot` | 显示需要更好源但 MoviePilot 未配置，不盲跑 | blocked reason `moviepilot_not_configured` | 待测 |
| E2E-09 | upgrade canary 创建与确认点可见 | `/tasks` | candidate selection / identity mismatch / before replace 确认点能在任务中心出现 | task `awaiting_user_confirm` + approval gate | 待测 |
| E2E-10 | 页面性能基线 | `/` `/media` `/tasks` `/rules` | 本地测试数据秒级打开；后台任务存在时页面仍可用 | 页面 load/API timing | 待测 |

## 缺陷记录

| ID | 场景 | 问题 | Kairox 判断 | 修复 | 状态 |
| --- | --- | --- | --- | --- | --- |

## 最终结论

待测。
