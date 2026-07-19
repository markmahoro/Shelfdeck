# ShelfDeck / Helix Documentation Index

Status: clean architecture accepted through `PBF-13`（含`PBF-09-R1`、`PBF-10-R1`、`PBF-10-R2`、`PBF-10-R3`、`PBF-11-R1`、`PBF-11-R2`、`PBF-11-R2-R1`、`PBF-11-R2-R2`、`PBF-11-R3`、`PBF-12-R1`）；P0–P8 complete；P9 active；E2E、Docker/Canary、production、real-media side effects和`media-desktop` changes paused.

工程Program固定为P0–P13；P13交付冻结的E2E-ready package后，本实施线程完成。真实来源完整E2E与部署不再纳入本Program，
分别由后续独立任务在单独授权下执行。

## Architecture authority

`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`是ShelfDeck / Helix唯一架构SSOT。它从产品本体、价值系统、
业务域和领域模型逐层向实现推导；后续Level必须引用前序Level的Canonical Dictionary，不能重新定义
已经固化的术语。

旧的处理链、Membership、全局SourceBinding和线性`onboarding → maintenance → offboarding`
合同已经失效。旧合同只保留为历史证据，不能指导新实现。

## Active documents

| Document | Purpose |
| --- | --- |
| `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md` | 唯一架构SSOT；Level 0–10与最终全文审计均已关闭 |
| `LEVEL7_BUSINESS_DECISIONS.md` | 已关闭的Level 7非Canonical业务决策Evidence；没有Open Decision |
| `ARCHITECTURE_REVIEW.md` | 已关闭的非Canonical Review台账；Section 14记录最终全文审计、`FA-04`与Closure Evidence |
| `FUTURE_PRODUCT_CAPABILITIES.md` | 非Canonical Post-Beta能力保留；不属于活动计划或实现授权 |
| `CURRENT_PLAN.md` | 唯一活动计划与Design门禁 |
| `CURRENT_STATUS.md` | 当前架构确认进度、实现差距与安全状态 |
| `CAPABILITY_CONSERVATION.md` | 已完成的Level 7能力守恒Evidence；62项历史能力逐项映射，不覆盖SSOT |
| `KAIROX_CAPABILITY_CATALOG.md` | 62项历史Capability目录快照；不定义clean Owner或调用方向 |
| `acceptance/FLOWPLAN_BUSINESS_PARITY.md` | 旧Kairox FlowPlan复刻验收Evidence；不定义clean业务流程 |
| `acceptance/MOVIE_OPTIMIZE_POLICY_CALIBRATION.md` | Movie空间策略的历史校准证据；Level 5已将其结论收录为推荐Rule Template初始值 |

## Reading order

~~~text
TOP_DOWN_ARCHITECTURE_CONFIRMATION.md
CURRENT_STATUS.md
CURRENT_PLAN.md
LEVEL7_BUSINESS_DECISIONS.md（仅追溯已关闭的Level 7业务决策审计；非Canonical）
ARCHITECTURE_REVIEW.md（仅追溯Architecture Review；非Canonical）
~~~

只有在处理能力守恒或现有实现审计时，才继续读取Capability文档或历史归档。

## Historical archives

- `archive/pre-top-down-2026-07-14/`：Top-down SSOT之前的Helix架构、服务合同与Triage专题文档。
- 组件专题归档：更早的架构、实施计划、切片和验收证据；不进入活动阅读顺序。

归档文档保持原样以便追溯。它们不再是活动合同、活动计划或当前状态来源。

## Conflict rule

1. `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`高于所有其他Helix、v3、v2和实现说明。
2. `CURRENT_STATUS.md`只报告当前状态，`CURRENT_PLAN.md`只规定当前工作顺序；二者不得改写SSOT。
3. Capability目录、历史实现和测试只提供Evidence，不能反向证明旧业务边界仍然有效。
4. 当前不得依据归档文档恢复编码、E2E或生产部署。
