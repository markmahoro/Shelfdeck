# ShelfDeck v3 Document Index

本文档目录是 ShelfDeck v3 / Kairox 的当前文档入口。新线程、新模型或长任务恢复时，先读本文件，再按任务读取最小相关文档。

## Current Documents

| 层级 | 文档 | 用途 |
| --- | --- | --- |
| Current status | `CURRENT_STATUS.md` | 当前项目状态、生产部署状态、已完成和未验收事项 |
| Current plan | `CURRENT_PLAN.md` | 当前唯一执行计划；没有被这里引用的旧计划不能作为执行依据 |
| Release goals | `RELEASE_GOALS.md` | Kairox closure 状态；Nexora release goals 尚未定义 |
| Versioning | `VERSIONING.md` | 当前版本口径、镜像 tag、release tag 和 package version 管理规则 |
| Architecture legacy | `KAIROX_ARCHITECTURE.md` | Kairox 已完成阶段的架构遗产；不再定义未来完整业务架构 |
| Engineering legacy | `KAIROX_ENGINEERING_PLAYBOOK.md` | Kairox 工程施工规范；用于理解现有 runtime，不作为 Nexora contract |
| Operations | `OPERATION_CONTEXT.md` | 生产环境、部署、安全边界和运行上下文 |

## Stable References

| 文档 | 用途 |
| --- | --- |
| `BUSINESS_MODEL_NOTES.md` | 业务语义参考；冲突时以 Kairox contract 为准 |
| `DATA_MODEL_NOTES.md` | 数据分层参考；冲突时以 Kairox contract 为准 |
| `USER_INTERVENTION_AND_FULL_AUTO.md` | 用户介入与自动化策略参考 |
| `ADULT_DATA_MODEL.md` | 成人库数据模型参考 |
| `V2_BEHAVIOR_PRESERVATION.md` | v2 行为保护清单 |
| `DISCOVERY_CHECKLIST.md` | 老阶段 discovery 清单，仅作参考 |
| `PRODUCTION_SAFETY_BASELINE.md` | 生产安全基线记录 |
| `archive/superseded/KAIROX_GOVERNANCE_DISCUSSION_NOTES.superseded-by-nexora.md` | Kairox Governance 命名已废弃；内容仅作 Nexora 设计历史输入 |

## Acceptance Documents

验收计划和运行报告放在 `acceptance/`：

| 文档 | 状态 |
| --- | --- |
| `acceptance/KAIROX_FRONTEND_API_E2E_PLAN.md` | 当前生产 Frontend/API E2E 验收计划 |
| `acceptance/KAIROX_FRONTEND_API_E2E.md` | 当前 E2E 运行报告；可能是未完成草稿 |

## Archive

归档文档放在 `archive/`，不能作为当前实现依据。

| 目录 | 含义 |
| --- | --- |
| `archive/superseded/` | 已废弃或被当前计划取代的 roadmap / plan / audit |
| `archive/completed/` | 已完成的阶段计划或 gap audit |
| `archive/evidence/` | 历史验收报告、生产 audit 和运行证据 |
| `archive/handoff/` | 历史交接文档和暂停记录 |

## Conflict Rules

1. 当前执行以 `CURRENT_PLAN.md` 为准。
2. 当前事实以 `CURRENT_STATUS.md` 为准。
3. 当前已实现 Kairox runtime 的历史语义以 `KAIROX_ARCHITECTURE.md` 为准。
4. 当前已实现 Kairox runtime 的工程边界以 `KAIROX_ENGINEERING_PLAYBOOK.md` 为准。
5. Kairox closure 和未来 release goal 空白状态以 `RELEASE_GOALS.md` 为准。
6. 技术版本口径以 `VERSIONING.md` 为准。
7. `archive/` 下的文档只能用于考古、回滚、对照或理解历史，不得直接指导新实现。
8. 如果旧文档和当前文档冲突，更新当前文档或把旧文档继续归档，不要复制旧判断进入新计划。

## Documentation Rules

- 同一时间只能有一份当前计划：`CURRENT_PLAN.md`。
- Codex Plan Mode 中的 `<proposed_plan>` 是对话协作产物，不是仓库长期计划文档。
- 计划确认进入执行后，只能更新现有入口：总体计划更新 `CURRENT_PLAN.md`，状态更新 `CURRENT_STATUS.md`，验收细节更新 `acceptance/` 下已有计划。
- 不得因为 Plan Mode 生成新 active plan 文档，例如 `KAIROX_BETA_PLAN.md`、`KAIROX_E2E_PLAN_V2.md` 或其他并列当前计划。
- 阶段计划完成后移动到 `archive/completed/`。
- 被推翻、暂停或重排的计划移动到 `archive/superseded/`。
- 验收报告和生产运行证据移动到 `archive/evidence/` 或 `acceptance/`。
- Codex 生成的计划文档必须有明确状态：Current、Completed、Superseded 或 Evidence。
- 新增计划前，先确认是否应更新 `CURRENT_PLAN.md`，不要再把多个 active plan 散落在根目录。
- 新增部署或 release 前，先更新或核对 `VERSIONING.md` 和 `CURRENT_STATUS.md`，不要混用 product milestone、Docker image tag、Git release tag 和 package version。
- Kairox release line 已关闭。`Kairox Usable`、`Kairox Performance`、`Kairox GA Candidate`、`Kairox GA` 已取消，不得作为未来 worktree 或 release goal。
- 下一代架构名为 `Nexora`。Nexora contract 尚未创建前，不得把 archived Kairox Governance 讨论当作当前架构合同。
