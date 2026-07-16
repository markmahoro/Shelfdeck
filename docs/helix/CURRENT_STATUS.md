# ShelfDeck Architecture Current Status

Status: Beta not achieved; production disabled; Levels 0–10 accepted; final full-document architecture audit closed; implementation gate remains closed.

Last updated: 2026-07-16

## Current conclusion

旧Helix Beta不能作为发布候选。`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`是当前唯一架构SSOT：

- Level 0–9：`ACCEPTED`；Level 3/5/6/7/8/9已标记不改变既有业务边界的`JOURNEY-AMENDED`；
- Level 9：`9.0–9.11` Public Interface and Product Surface已经由用户确认；Journey Reverse Audit确认的8项
  前序合同传播/物理闭合缺口已全部bounded回写并通过post-amendment audit；
- Level 10：`ACCEPTED`；结构化正文、前序reservation覆盖和运行维度反向审计已经完成并由用户确认；
- Implementation Gate：关闭。

Architecture Review已经完成Clean Audit、隔离盲审、Decision提炼、两轮bounded change set回写和post-change
封闭审计。Level 3–6与Level 9已经在2026-07-16由用户确认；Level 9 Journey Review已关闭为
`CLOSED / APPLIED_AND_AUDITED`历史Evidence。

Level 7已经覆盖Supporting Work、Domain Planner、immutable Workflow Plan、durable Event Runtime、atomic
Capability、Material Safety、Control Plane、Resource Governor、恢复和诊断，并通过Acceptance Closure
Audit。历史62项Capability Conservation Audit结果为21项重签clean合同、24项合并、12项拆分、5项删除旧
执行语义，`62/62 accounted for`。当前没有待用户决定的Level 7业务问题。

Level 8已经确认并完成Journey/final-audit bounded amendment：`src/helix/`模块化单体根、五Domain public/internal包、唯一Composition Root、
Execution Foundation物理组件、一个`data/shelfdeck.db`内的严格表域隔离、Facade/Handoff/Query/Signal合同、
Responsibility/Control原子事务、Outbox/Inbox/Effect Journal、clean Capability nominal catalog、静态依赖门禁
及现有实现clean-cut处置矩阵。工程闭合进一步固化了112项Capability ref/96个Result family、156张关系表的
关键列与约束、62项历史registration和named helper的function-level conservation，以及Handoff、Deliverable
promotion、Discard/Cleanup、On-deck、Aftercare、Off-deck和Deregistration crash-window fixture。
Post-amendment closure audit为`PASS / NO BLOCKING GAP / NO OPEN BUSINESS DECISION`。

Level 9已经确认九条经典用户旅程、九个一级页面、普通产品表面/Advanced Diagnostics边界、Activity Ledger、
Material Field去向方案、Rule Template与Shelf Standard编辑、全自动Readiness、两档Resource Profile、Provider/
Workspace/Security设置、Intent与高量级销毁确认、113个唯一Admin HTTP method+path及1个public health route、普通Projection及视觉/
Accessibility合同。Frozen discard、Placement→Aftercare、Routing/Template aggregate、Activity progress、Care
Basis、Platform/standing Authorization、People Candidate及Off-deck Review八项缺口已关闭；没有新的用户业务
Decision，Implementation Gate继续关闭。

Level 10已经形成完整Operational Contract：Runtime/Readiness、clean initialization、State Snapshot与Full
Operational Backup、effect-specific recovery、Owner automation cadence、Retry/Timeout、两个Resource Profile的
容量映射、队列/Breaker、Retention/Workspace/Artifact/WAL、正常与受限Profile SLO、Health/Runbook、Secret、
Docker/NAS/QSV Canary、故障矩阵和Beta Release Gate。内部审计结果为
`PASS / RESERVATIONS CLOSED`；Level 10已经由用户Accepted。随后Level 0–10最终全文审计通过三轮隔离盲审和
主审反证，合并得到29项Candidate：27项确定性修正/fixture已bounded回写，Identity Correction疑点被证明为
已确认Beta限制，唯一业务分叉`FA-04`已经由用户确认采用Exact Season Continuity Claim方案并完成Level
3/4/5/6/8传播。最终结果为`PASS / ALL FINDINGS CLOSED / NO OPEN BUSINESS DECISION`。

## Accepted architecture baseline

~~~text
Procurement
  Material Field + Field Management + Procurement Run / Triage
  └─ Candidate Package + Primary Input Manifest
       │ Business Handoff A
       ▼
Libra
  Subject + Decision Preparation + Shelf Routing + Acceptance Spec + Libra Run
  └─ Production Workspace + On-deck Product Package
       │ Business Handoff B
       ▼
Arca
  Shelf + Shelf Acceptance + On-deck Run / Off-load
  └─ On-deck Commit → Shelf Entry + Deck Fact
  └─ Aftercare / Off-deck / Shelf Deregistration

User Perception / People Management
  └─ independent horizontal business domains

Execution Foundation
  └─ shared technical execution substrate; not a Business Domain or Fact Owner
~~~

关键Accepted边界：

- Procurement管理物理文件源和Triage；Libra负责从Candidate到确定产品；Arca拥有Shelf、验收、Off-load、库存和收藏事实。
- Physical Material Identity、Domain-local Material Binding和Material Control彼此独立，不存在全局媒体业务ID、Membership或SourceBinding。
- Libra只在Production Workspace内生成产品；Arca负责正式库存的Material side effect和On-deck Commit。
- Shelf Standard表达Shelf长期标准；Libra基于有效标准和Decision Facts计算Acceptance Spec；Arca独立验收交付物。
- User Perception与People Management是独立业务域，不被Kairox或Arca吸收。
- Kairox不是一级业务域，历史Owner、Gate、Task和Flow路由均不自动继承到clean Helix。

## Safety state

- 生产ShelfDeck容器保持停止。
- 四库真实来源E2E已终止，不得续跑。
- 不构建或部署新的生产镜像。
- 已授权破坏性样本也不得在Design阶段使用。
- `media-desktop`继续排除，并保留用户现有未提交修改。

## Documentation state

- `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`：唯一架构SSOT；Level 0–10及最终全文审计已经关闭。
- `LEVEL7_BUSINESS_DECISIONS.md`：已关闭的Level 7非Canonical业务决策Evidence；没有Open Decision。
- `ARCHITECTURE_REVIEW.md`：已关闭的非Canonical审计台账；Section 14保存最终审计、盲审、`FA-04`决定与Closure Evidence。
- `CURRENT_PLAN.md`：当前设计顺序和Implementation Gate。
- `CAPABILITY_CONSERVATION.md`：已完成的Level 7能力守恒Evidence；不覆盖SSOT。
- `KAIROX_CAPABILITY_CATALOG.md`：62项历史目录快照；不拥有clean架构权威。
- Top-down SSOT以前的Helix文档继续保存在`archive/pre-top-down-2026-07-14/`，仅供历史追溯。

## Current implementation gap

现有Runtime、Store、API、Admin Web和测试基于多轮旧Helix/Kairox合同，不能视为clean架构的部分实现。主要差距包括：

- Procurement、Libra、Arca的Business Object、Process和两次Business Handoff尚未落地；
- Material Field、Primary/Related Material、Domain-local Binding、Material Control和派生Region尚未形成统一实现；
- Physical Material Manifest、Workspace、Product Package、Arca Off-load和Inventory Representation尚未按Accepted合同实现；
- 旧全局媒体对象、Membership、SourceBinding、Admission、Gate Task和complex Flow Executor仍占据现有实现；
- 历史Capability已经完成Level 7能力守恒；Level 8 clean nominal Catalog、Schema envelope、逐表约束和逐函数
  迁移台账已完成设计，实际Schema/DDL/runtime实现仍未开始；
- Admin Web仍表达旧Library/Maintenance心智；
- Clean Schema合同已在Level 8确定但尚未实施；API、配置与Admin Web由Level 9定义，clean initialization、
  运行SLA和部署差异由Level 10定义。

## Primary risk and next action

最大风险是在Level 7–10确认前，用旧Schema和旧执行内核提前编码，重新制造跨域Owner、复杂Executor和隐式状态机。

下一步是完成现有实现差距审计和clean-cut实施计划确认，
才能讨论打开Implementation Gate；E2E和生产部署继续暂停。
