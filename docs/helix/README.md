# ShelfDeck / Helix Documentation Index

Status: clean architecture accepted through `PBF-08`; P0–P6 complete; P7 in progress under standing P2–P13 Local Implementation authorization; E2E, build, production and `media-desktop` changes paused.

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
| `CURRENT_PLAN.md` | 唯一Master Plan；只维护Phase路线、依赖、Exit Gate、当前Phase指针和授权边界 |
| `CURRENT_STATUS.md` | 当前Phase、Gate、Evidence、风险和安全状态；不保存详细执行计划 |
| `ENGINEERING_PLAYBOOK.md` | 非Canonical长期工程规范；Work Package、Ready/Done、门禁、验证、Review、复用和停线规则 |
| `implementation/CURRENT_PHASE.md` | 唯一活动P7详细执行包；Procurement |
| `FUTURE_PRODUCT_CAPABILITIES.md` | 非Canonical Post-Beta能力保留；不属于活动计划或实现授权 |
| `implementation/evidence/IMPLEMENTATION_GAP_AUDIT_4a16f0a9.md` | 已关闭的`4a16f0a9`实现差距矩阵、处置与风险Evidence |
| `implementation/evidence/P1_PHASE_EXIT_AUDIT_9a4d9b1f.md` | P1 Exit Audit、隔离验证结果、manifest digest和已知限制 |
| `implementation/evidence/P2_PHASE_EXIT_AUDIT_A7357810.md` | P2 Exit Audit、112/96/156/18 baseline、tracked-artifact复现性和安全边界 |
| `implementation/evidence/P3_PHASE_EXIT_AUDIT_5F433D93.md` | P3 Exit Audit、clean SQLite/Persistence、18 transaction crash matrix和安全边界 |
| `CAPABILITY_CONSERVATION.md` | 已完成的Level 7能力守恒Evidence；62项历史能力逐项映射，不覆盖SSOT |
| `KAIROX_CAPABILITY_CATALOG.md` | 62项历史Capability目录快照；不定义clean Owner或调用方向 |
| `acceptance/FLOWPLAN_BUSINESS_PARITY.md` | 旧Kairox FlowPlan复刻验收Evidence；不定义clean业务流程 |
| `acceptance/MOVIE_OPTIMIZE_POLICY_CALIBRATION.md` | Movie空间策略的历史校准证据；Level 5已将其结论收录为推荐Rule Template初始值 |

## Reading order

~~~text
TOP_DOWN_ARCHITECTURE_CONFIRMATION.md
CURRENT_STATUS.md
CURRENT_PLAN.md
ENGINEERING_PLAYBOOK.md（实施治理、代码变更或Phase验收时）
implementation/CURRENT_PHASE.md（当前Phase计划、实施或验收时）
LEVEL7_BUSINESS_DECISIONS.md（仅追溯已关闭的Level 7业务决策审计；非Canonical）
ARCHITECTURE_REVIEW.md（仅追溯Architecture Review；非Canonical）
~~~

只有在处理能力守恒或现有实现审计时，才继续读取Capability文档或历史归档。

## Historical archives

- `archive/pre-top-down-2026-07-14/`：Top-down SSOT之前的Helix架构、服务合同与Triage专题文档。
- `implementation/archive/P1_CLEAN_SKELETON_AND_ARCHITECTURE_GUARDS.md`：已完成并冻结的P1执行包。
- 组件专题归档：更早的架构、实施计划、切片和验收证据；不进入活动阅读顺序。

归档文档保持原样以便追溯。它们不再是活动合同、活动计划或当前状态来源。

## Engineering document package

Helix实施文档采用“一份Master Plan + 一份Current Phase执行包”的结构：

- `CURRENT_PLAN.md`保持精简，不吸收Work Package细节；
- `implementation/CURRENT_PHASE.md`是唯一稳定Phase路径；Phase间可以是Gate Hold，获授权后才成为唯一活动详细计划；
- 当前Phase通过Exit Gate后，执行包冻结到`implementation/archive/`，再为下一Phase重建稳定的Current Phase路径；
- 审计、机械核对和验收结果进入`implementation/evidence/`，不能反向修改SSOT；
- 禁止为并行组件、临时修复或单个Work Package创建第二份活动计划文档。

`ENGINEERING_PLAYBOOK.md`是长期过程规则，不是第二份计划。`CURRENT_STATUS.md`只报告事实，不承担未来承诺。

## Conflict rule

1. `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`高于所有其他Helix、v3、v2和实现说明。
2. `CURRENT_STATUS.md`只报告当前事实，`CURRENT_PLAN.md`只规定Master顺序，`implementation/CURRENT_PHASE.md`
   只细化当前Phase；三者不得改写SSOT。
3. Capability目录、历史实现和测试只提供Evidence，不能反向证明旧业务边界仍然有效。
4. `ENGINEERING_PLAYBOOK.md`只规定实施过程；过程便利不能覆盖Owner、Handoff、Authorization或Object continuity。
5. 当前不得依据计划、Evidence或归档文档恢复编码、E2E、构建或生产部署；必须遵守明确Gate。
