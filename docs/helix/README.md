# ShelfDeck / Helix Documentation Index

Status: first-implementation retake active；Observation事实表与增量Eligibility改造已完成；Execution Foundation与Procurement已通过本地全链验证并标记`CLOSED FOR DOMAIN ONBOARDING`。Docker/NAS和生产均未开始。

第一次实施的P0–P13资产继续保留，但此前由大型Coordinator同步闭环得到的Movie Canary只证明低层Capability、Owner事实和
Handoff A Ready数据形态可工作，不构成`Work Scheduler → Event Runtime → Resource Governor`已经参与的Foundation E2E证据。
当前唯一活动实施计划见`CURRENT_PLAN.md`。最终`Z:\Film`全库Canary使用本机Node.js临时clean数据库完成，主动重启后从durable事实恢复；本线程负责实现及异常诊断。最新Canary还验证了Related关联不会吸收BDMV内部文件或同stem视频载荷；证据记录在`CURRENT_STATUS.md`。

Physical Material不再计算全文件Hash。当前唯一合同读取文件正中间最多262,144 bytes并执行前后stat fence；NAS负责bit rot和底层
完整性。Artifact、Canonical JSON与事务Evidence digest仍使用SHA-256，这些digest不得作为Physical Material Identity。

Observation是Procurement后续流程的物理事实起点：每个已观察文件永久写入`proc_field_observation_entries`，
`proc_field_observations`只保存Page/Observation头和compact receipt。Page最多256个文件、64 MiB物理读取；
Eligibility保留在`proc_field_materials`，但只对有界Material-local Change Set重算，完全不变的每日Observation不写Eligibility列。

Observation完成后，Layout只作为Observation entries上的冻结技术Projection供Procurement Triage复用；不再有独立Layout Capability/Event/Result，
Triage不重复解析Page JSON，也不重复扫描NAS目录。Media Probe仍是独立Event，仅对Run Selection执行。

Candidate Assembly现在通过运行时可重建的`TriageEvidenceIndex`按`unitId`直接定位Structure Result，并按`runId + unitId`
共享不可变Candidate Context；Identity、Manifest、Publication不再重复读取完整Run、完整Structure Result或整Field Material。

BDMV采用SSOT定义的拓扑边界：它不是pre-triage的Movie类别，而是Run Creator识别的不可拆分container group。
同一最近`BDMV`祖先目录下的全部terminal Observation成员必须进入同一Run；完整group可与其他group稳定装箱，
超过256项时整体不建Run。Structure消费完整group并将单标题解析为一个Triage Unit，不能把内部M2TS拆成多个Candidate；
多标题、歧义或结构不完整保持`not_ready`。所需Playlist/Clip/结构依赖必须在Run Admission前完成Observation、Eligibility
和Control，不能由Triage在Admission后静默扩张。

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
