# ShelfDeck Architecture Current Plan

Status: Design only; Levels 0–10 accepted; final full-document architecture audit closed; implementation, E2E and production deployment paused.

Last updated: 2026-07-16

## Objective

以`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`为唯一架构SSOT，从Level 0逐层形成clean Helix合同，再基于完整合同审计现有实现并制定一次性clean-cut实施计划。当前只允许架构设计、文档治理和只读实现盘点。

## Accepted baseline

- Level 0–9已经确认并固化为`ACCEPTED`；Level 3/5/6/7/8/9的Journey amendment不改变其用户确认业务边界。
- Procurement、Libra、Arca、User Perception和People Management是五个一级业务域。
- Collection Formation只有`Procurement → Libra`和`Libra → Arca`两次单向Business Handoff。
- Level 3–6在2026-07-16完成首轮bounded change set回写、封闭审计和用户确认；Level 9 Journey Review的第二轮
  bounded change set已应用并审计，Review台账已经关闭；Level 9已经由用户确认。
- Level 7已经通过封闭审计；Level 8只能引用Level 0–7的Canonical Terms和Owner合同，不能借历史
  Kairox/Mirex实现反向改写业务边界。
- 生产容器继续停止；四库E2E、镜像构建、部署和破坏性样本测试均未获恢复授权。

## Current design sequence

1. Level 7结构化设计、Level 0–6一致性审计、历史62项Capability Conservation Audit与Acceptance Closure
   Audit已经完成；Level 7为`ACCEPTED`。
2. Level 8 Logical and Physical Components已经完成结构化设计与封闭审计：逻辑组件、物理模块、Store/Facade、
   Composition Root、单SQLite事务/Outbox、112项clean Capability contract、156张关系表约束、function-level
   conservation ledger与clean-cut映射均已进入SSOT。
3. Level 8已由用户确认；Level 9已从九条经典旅程推导普通产品表面/Advanced Diagnostics、九页信息
   架构、Intent/Authorization、Policy/Automation/Settings、113个Admin HTTP method+path和1个public health route、Projection、Activity
   Ledger、视觉/Accessibility合同。
4. Level 9 Journey Reverse Audit确认的8项合同传播/物理闭合缺口，已经按
   `Level 3/5/6 semantic propagation → Level 7 progress → Level 8 schema/transaction/catalog → Level 9 API/projection`
   完成bounded回写并通过六类post-change audit。
5. 当前8项Finding均可由Accepted合同唯一推导，没有新的用户业务Decision；只有真正改变产品含义的新增分叉
   才进入对应Level的非Canonical Business Decision Register，纯工程映射
   由内部审计收敛。
6. Level 9已经由用户确认；Level 10 Operational Contract已完成结构化草案和内部审计。Level 0–10全部确认、
   实现差距审计完成、clean-cut实施计划经用户确认前，不恢复代码实施。
7. Level 10结构化正文、前序reservation覆盖、运行参数、negative path与Release Gate已经完成内部封闭审计；
   用户已经确认Level 10。Level 0–10最终全文审计的三轮盲审、主审反证和全部确定性bounded change已经完成。
8. `FA-04`已经由用户确认Exact continuity方案，并传播至Level 3/4/5/6/8；全文机械、Owner、Handoff、
   Journey、Recovery和negative-path复审全部通过，最终架构审计关闭。
9. 下一设计阶段只能先做现有实现差距审计和clean-cut实施计划；用户确认该计划前Implementation Gate不打开。

## Level 8 accepted contract and Level 9 entry discipline

- 采用“本层目标 → 总体结构 → 分层合同 → 跨层不变量 → 一致性审计 → Dictionary”的总分结构。
- Level 8已经固化模块化单体、Domain package、Store/Facade、事务、clean Capability Catalog、依赖门禁和
  clean-cut映射；Level 9不得用页面便利重新合并这些边界。
- Level 8已确定一个物理`data/shelfdeck.db`承载严格隔离的Domain/Foundation表族；同库只用于关闭
  Responsibility/Control原子提交窗口，不授予跨Domain Store访问。
- Clean runtime物理根为`media-service/src/helix/`；旧Libra/Nexora/Kairox/Task/Gate实现只作为function-level
  conservation输入，不能形成双轨主路径。
- Level 9只允许调用Application Facade与Read-model Projection，不接触Domain Store、Planner、Capability、
  Workflow Event或Material Control内部接口。
- Level 9先从Level 1价值结果与Level 2 Canonical Owner推导用户旅程，再设计页面、API和设置；现有Admin Web
  只能作为实施差距Evidence，不能成为产品合同来源。
- Level 8仍是Accepted基线，Level 9 Journey Reverse Audit证明的物理合同缺口已经按确认语义bounded补全；
  未改写Level 0–7 Owner/Handoff/Authorization。

## Level 10 accepted scope

Level 10是Operational Contract，不重新设计Business Domain、Process、Component、Schema、API或页面。Accepted正文把
Level 0–9已经确认的合同转成可测量的运行标准、故障后果和发布门禁，并采用与Level 3–9一致的总分结构：

1. Scope、继承关系与禁止越界；
2. Runtime启动、Readiness、降级、故障和只读/拒绝写入状态；
3. clean initialization、旧数据备份、配置导出/恢复和clean-cut安全步骤；
4. restart/crash-window恢复、Reconciler、Effect/Outbox/Control收敛与断点续传；
5. Resource Profile、容量、队列、背压、重试、超时和Circuit Breaker的精确运行参数；
6. Workspace、Artifact、历史Fact、Audit、WAL、Projection和临时数据的保留与GC；
7. HTTP、SQL、Event loop、内存、DB/WAL、Provider、Worker和全流程吞吐的SLA/SLO与测试Profile；
8. Operational Health、指标、日志、告警、Advanced Diagnostics和故障Runbook；
9. Secret、Admin credential、备份、不可逆操作和恢复过程的运行安全；
10. Windows开发、Linux Docker、NAS、GPU/QSV/NVENC与Remote Worker的部署差异和Canary边界；
11. 单元/合同/故障注入/真实来源/受限Profile/soak/发布验收矩阵与Beta Release Gate；
12. Level 0–9运行维度反向审计、Canonical Dictionary与确认状态。

Level 10不是逐文件实施计划。内部审计没有发现需要用户选择的新增业务分叉；容量数字、重试预算、GC周期、
SLA阈值和测试装置已经作为Operational Baseline提出，后续只能以真实环境Evidence校准且不得放宽Invariant。

## Business decision handling

`LEVEL7_BUSINESS_DECISIONS.md`是已关闭的Level 7非Canonical业务决策Evidence，不属于Architecture Review，
也不能覆盖SSOT。

只有以下问题可以提交用户：

- 改变用户真实业务旅程或可见业务结果；
- 改变不可逆操作的授权语义；
- 改变Business Domain、Owner、Business Handoff或业务对象连续性；
- 存在两个都合法但产品含义不同的方案。

Level 7没有未关闭业务决策，`LEVEL7_BUSINESS_DECISIONS.md`已经关闭。Level 9反向审计没有发现需要用户
选择的业务分叉；8项Finding均已由Codex按Accepted合同收敛。不能重新打开前序Level来承载页面布局、API命名
或纯Schema选择争议。

## Prohibitions

- 不按旧Membership、Admission、maintenanceComplete或全局SourceBinding模型继续实现。
- 不把Candidate Package、Subject和Shelf Entry写成同一对象的状态迁移。
- 不让Procurement、Libra和Arca共享业务对象主键或Material Binding Store。
- 不让Related Material、目录或Material Field范围隐式扩大Material Control Scope。
- 不把Physical Material Manifest实现成全局可变对象、共享Binding Store或新的媒体业务主键。
- 不让同一Physical Material进入两份并行可接收Candidate。
- 不让Kairox、Mirex、旧Flow Executor或旧Task状态机反向决定clean Helix边界。
- 不把`flowKind`恢复为Executor路由键，不建立全局业务Planner或全局Priority Engine。
- 不恢复四库E2E、生产容器、镜像构建或部署。
- 不修改`media-desktop`。

## Implementation gate

Level 0–10全部确认、现有实现差距和能力守恒审计完成、用户确认clean-cut实施计划之前，不得恢复代码实施。测试通过只能作为实现Evidence，不能替代架构确认。
