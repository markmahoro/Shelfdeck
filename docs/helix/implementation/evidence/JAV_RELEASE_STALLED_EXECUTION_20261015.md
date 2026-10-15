# JAV-RELEASE-COPY：生产停滞诊断与候选Evidence修复

2026-10-15；对应唯一CURRENT_PHASE的发布准备/完整副本资格工作。诊断聊天只读生产，生产停机、备份、清场及部署由主聊天协调。本证据不分配UAT、不宣称生产已修复或可部署。

## 现场与根因

- 08:46–08:47 UTC，旧生产Runtime仍running，normalSupplyAllowed=true，inFlightEvents/Recoveries/OwnerReconciliations均0，faulted=false。4 running Work中，1个外部search Event/Attempt遗留executing，另3个Event ready未获Attempt。日志出现`SQLITE_CONSTRAINT_CHECK: length(CAST(result_json AS BLOB)) <= 65536`，Owner/resource Circuit处于recovering。
- SSOT允许完整AcquisitionCandidates最多100项、256 KiB，但旧search将完整集合写入Foundation的64 KiB Result列。结果持久化失败发生在执行器返回之后，pure Attempt没有结束，恢复探测占用未正常闭合；不存在仍在执行的转码线程。新增大集合测试可独立复现原SQL CHECK失败。
- 另2个active Series Run（前缀885efa、f3f125）没有活动Work：在冻结冷副本以query_only读取，93/77份Metadata Observation完整、nextMetadataStage均ready、均无Workspace；Primary总量分别142407013464/212580853867 bytes。既有空间合同要求1.2倍Primary加5 GiB，分别需约176.3/260.5 GB；09:12 UTC只读df确认`/transcode`可用154738307072 bytes。它们符合Workspace空间不足等待条件，与search落库缺陷不同；不放宽空间合同。
- 20个历史未决Effects均属Arca input_settlement.delete，父Work failed，失败码`RECOVERY_EXECUTION_BUDGET_EXHAUSTED`，最早/最晚更新时间1788501258464/1788773926443。另有1条`CLEAN_ARCA_PRODUCT_SOURCE_MISSING` acceptance recovery和1条pending Product Offer Outbox。它们不是本次search修复已关闭的责任，仍须Owner精确核对/显式收口；不得直接改库或靠Reset绕过保护。

## 用户确认后的实现

用户确认“Libra Evidence + 有界引用方案”。SSOT新增明确Owner合同并生成机器产物：完整、不可变AcquisitionCandidates（≤256 KiB）存入Libra `libra_acquisition_candidate_evidence`；Foundation search Result只保存≤4 KiB的AcquisitionCandidatesRecord。Record绑定Run、Execution Basis、Work/Event/Attempt、Query、Integration revision、完整集合count/digest和Evidence digest。Candidate Select核验同一Record并读取全部候选。

同Attempt首先读取既存Evidence；保存后、Foundation绑定前重启复用同一集合，不重新调用Provider。首次保存验证active Run/Basis并以Libra UoW原子保存Evidence/Record；未知引用、跨Run、摘要篡改和旧完整Result均拒绝，无双读/迁移。选定Formation Reset闭包清除此表，其余Run保留。新增表只有Domain→Foundation精确FK，没有Foundation→业务表依赖。

Foundation在正常dispatch和recovery的既有异常处理范围内校验pure_observation成功Result/Evidence的UTF-8 canonical字节数。超限以稳定contract failure结束Attempt；序列化异常也走既有失败收口。不截断结果，不改变非pure已提交Effect的completion/reconcile合同。

目标结构从203变为204表；冻结旧生产200表基线不变。精确copy新增表集合、目标DDL摘要及Kernel机器计数已更新，未放宽source eligibility或旧终态档案要求。

## 验证与限制

- 核心7文件141 pass：P4 dispatch/recovery的Result/Evidence超限、UTF-8精确边界、序列化异常；P9大候选集合；JAV copy/rollback；DDL、P2/table合同。
- 最终P9单文件12 pass：100候选完整集合超过64 KiB，旧SQL插入明确拒绝，Record小于4 KiB，重开SQLite后Provider总调用1次，选出providerRank=99的最强候选；跨Run请求在Provider调用前拒绝，count/digest篡改及旧完整对象拒绝。
- 平台初轮60项58 pass/2 fail，两项均为新增索引后103→104旧断言；修正后P3 Kernel/verifier与Reset共49 pass（含新增选定Run清理/其他Run逐行保持），非重叠的Windows独立包、P13和source map初轮通过。没有把初轮记为全绿。
- Series外部相关组合28 pass/1显式skip；该skip为需环境开关的真实进程退出恢复，不计PASS。
- 随后显式启用HELIX_SERIES_EXTERNAL/REAL/TRANSCODE的隔离Host完整链路1 pass（118秒）：真实外部共享文件获取一次，两集HEVC 3840×2160/AAC转码产物、完整metadata及最终唯一On-deck Commit通过。此测试未注入进程退出，不替代上述恢复skip。
- P2最终121/104/204/51，aggregate `040b1627c0fb1d077b1c9e5aae58b13b5ba7855b32b27c4bd1c0026974d6aeec`。目标DDL `6ff9269258f74ae96d99ad770d1bd1d75a2fd38677def2e0e4c1fef2e50ca5ea`。Package boundary与forbidden semantics均无finding；diff whitespace检查通过。
- 本切片未部署NAS、未清理生产数据、未修改UI、未宣称完整架构套件或Linux候选镜像最终资格；真实完整生产副本升级/回退和生产责任收口仍由主聊天完成。

本地原始日志位于忽略目录`.codex/jav-development/stalled-*`，不提交生产导出或运行数据。冻结冷副本只读，未修改原文件。

## 冻结修复后的历史责任只读核查

产品修复commit为`13e965c21`。此后仅继续读取冻结200表冷副本，不更改产品源码。

20条Journal `reconcile_required`实际归属4个Arca On-deck Run：`935956e4cec5…`（5条）、`7c5091bf9b6a…`（7条）、`f6b5b9ab9520…`（3条）、`b4b54b41b23f…`（5条）。4个Owner Run均committed，各有唯一On-deck Commit Receipt；同一Run分别存在5/7/3/5条成功settlement。以实际`createTerminalEffectHistoryObserver`、`createCatalogPlanProofReader`、Owner Product Delivery/Acceptance/On-deck readers，在同一query_only事务逐一验证旧失败Plan及成功后继，返回20份`arca.terminal-effect-history-proof@1` / `fulfilled_by_successor`、0失败。该结果比仅统计成功后继更强，但未单独重跑完整Frozen Catalog递归验证；原始证明含精确Effect、后继Result/Commit及input摘要，保存在`stalled-history-proof-readonly.json`。

处理建议：保留旧Journal和终态Work，不执行第二次删除、不重开Attempt。现有Owner历史证明是可复用的只读路径；当前JAV copy的`sourceBlockers`仍只按Journal状态计数，因而没有可直接执行的无损升级准入路径。若将既有历史证明接入copy资格，须在完整副本同一只读事务完成精确旧Catalog/Plan/后继责任证明，未知/活动/缺失任一证据继续拒绝，不得仅按这20个ID豁免。现有专用copy合同与这种历史履约准入的衔接须由主聊天明确后再实施；本任务没有修改门禁或新增retirement写入。

剩余Recovery Case与Outbox是同一件事：offer `c09a5c83…`、package `a63da6ad…`、message `ea118336…`，来源Libra Run `bec197df…`已discarded，Subject `libra-subject-aa3518a72342d3aa4c9fa4644a5eeb1c65bd3960`无其他Run。Package仍published，Arca Inbox有已消费Receipt，但没有Acceptance Attempt/Custody，Case为`attention_required/CLEAN_ARCA_PRODUCT_SOURCE_MISSING`。SSOT“Executor terminal-outcome closure amendment”明确Admission Inbox不等于Business Ack：只有Accepted/Rejected终态事实才能Ack。因此不能凭Inbox直接把Outbox改fully_acked，也不能把技术失败伪装Rejected。

精确只读`inspectPlan(subjectIds=[该Subject])`无底层Reset blocker，拟清范围为1个discarded Run、1 Workspace、1 Package、16终态Work、2 Artifact、该Recovery Case/Offer消息闭包，0 Material Control（保留1个Procurement Control），0 Custody/On-deck Run。此计划会删除已结束Run及执行历史；用户级Reset明确保护ended history，默认也不会选择仅有discarded Run的Subject。因此底层ready不代表已有授权或可直接运行，不能把它混入6个active Run清理。保留历史的Offer/Recovery退休目前没有对应现成命令；需主聊天明确选择该精确历史清场范围，或先取得新的Owner退休合同确认。已存在的显式Arca Retry会新建验收Work，不解决discarded源库责任，未建议对缺失源反复重试。

两类后续资格均不由候选Evidence修复自动解决；本审计未发起Retry/Ack/Reset、删除媒体或重写历史。
