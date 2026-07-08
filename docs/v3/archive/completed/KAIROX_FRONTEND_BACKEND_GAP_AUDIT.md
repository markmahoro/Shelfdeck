# Kairox Frontend Backend Gap Audit

本文记录 Kairox Frontend Re-architecture 的前后端合同审计。执行规则是先定义页面数据合同，再判断当前 API 是否满足；不能为了页面跑通直接读取 Mirex 字段。

状态定义：

| 状态 | 含义 |
| --- | --- |
| ready | 后端已直接提供 Kairox 数据，前端可直接接入 |
| frontend_adapter | 后端数据足够，但前端需要 Kairox projection adapter |
| backend_gap | 后端缺稳定 projection，需要先补后端 |
| semantic_gap | 后端仍以 Mirex 主语义输出，必须先修后端语义 |

## Slice 0 Baseline

| 页面 | 用户问题 | 页面数据合同 | 当前 API | 状态 | 后端动作 | 前端动作 | 验收 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 仪表盘 | ShelfDeck 是否正常运转；媒体库管理成果如何 | `KairoxDashboardProjection`：健康、成果、风险摘要 | `/v1/admin/dashboard/health`、`/v1/space-stats` | frontend_adapter | 暂不新增后端字段；由前端 adapter 隐藏诊断字段并投影成果 | Slice 1 已重构 Dashboard | Dashboard 不展示 DB/WAL/resource bucket |
| 媒体库 | 媒体当前 facts 是什么；ShelfDeck 准备如何管理 | `KairoxMediaProjection`：facts 分组、lifecycle、objective、nextAction | `/v1/library?projection=manage`、`/v1/tasks?activeOnly=1` | frontend_adapter | 暂不新增字段；由前端 adapter 从 manage projection 投影 facts 分组、active task 和 nextAction，后续可补更强 detail API | Slice 2 已重构列表和详情抽屉 | 媒体行可解释 facts + lifecycle；创建任务只传 `targetGate + gateObjective` |
| 任务中心 | 系统在做什么；哪里需要介入；失败后怎么恢复 | `KairoxTaskProjection`、`KairoxInterventionProjection` | `/v1/admin/tasks`、`/v1/tasks/:id/actions/*`、task detail events | frontend_adapter | 暂不新增后端字段；API 仍携带兼容字段，但新页面只按 targetGate/gateObjective/controlState 组织 | Slice 3 已重构任务中心 | 主筛选按 targetGate/attention/status，不按 flow |
| 处置队列 | 哪些归档媒体建议处置；用户如何决策 | `DeleteCandidate` + perception/rule/task summary | `/v1/admin/delete-candidates` | frontend_adapter | 暂不新增后端字段；confirm-delete 已经通过 TaskAdmission 创建 `targetGate=delete` 任务 | Slice 4 已重构处置队列 | 未确认不创建 destructive task；页面不显示 delete-as-optimize |
| 管理策略 | ShelfDeck 应该按什么规则管理媒体库 | `KairoxPolicyProjection`：媒体库、感知、优化目标、自动化、处置 | `/v1/admin/sublibraries`、`/v1/admin/rule-templates`、`/v1/config`、Douban/MoviePilot/Adult APIs | frontend_adapter | 暂不新增统一 policy API；处置策略已接入 `deleteGatePolicy`，其余 tab 复用现有配置 API | Slice 5 已合并配置页 | 不再有独立豆瓣/成人库/转码/洗版一级页；处置策略可读写 |
| 高级 | 资源为什么不够；系统为什么慢；如何排障 | Resource/diagnostic projection | `/v1/admin/resources`、nodes、transcode config | ready | 无 | Slice 6 已聚合高级页并清理 ResourceView 的 selected-flow 展示 | 高级信息不进入普通路径 |

## Contract Rules

- 新前端主路径不得直接依赖 `SelectedFlow`、`selectedFlow`、`preferredFlow` 或 `businessFlowDecision`。
- 创建任务主路径只能使用 `itemId + targetGate + gateObjective`。
- `flowPlan.flowKind` 只能作为实现路径细节展示，不能作为 task 主身份。
- 样片、候选选择、身份不匹配、删除确认只作为用户介入 evidence 或 confirmation，不作为默认流程入口。
- 高级诊断数据必须留在高级页面，不进入 Dashboard、媒体库或任务中心主路径。

## Slice Acceptance Checklist

每个切片完成时执行：

```bash
cd media-service && npm test
cd media-service && npm run build:web
rg -n "SelectedFlow|selectedFlow|preferredFlow|businessFlowDecision|transcode candidate|scrape candidate|upgrade candidate" media-service/web/src
```

允许残留只限 legacy adapter、类型兼容、负向测试或明确注释的迁移代码。
