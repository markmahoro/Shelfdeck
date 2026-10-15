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

## 既有历史证明接入升级资格（同日后续）

重新逐条核对SSOT UAT-261（15558起）后，确认其已明确规定“单一只读派生路径，不新增持久Resolution Receipt”，由Arca解释immutable Package/Custody/Final Inventory/后继Result，Foundation复核原/后继身份、输入/Fence/intent及完整链；允许证明“已发生且当前无剩余物理责任”，每次startup重验，禁止修改原Event/Attempt/Effect。因此上述20条在完整证明通过时是已履约历史，并非等待再次删除；JAV copy合同只禁止“未收口Effect”，没有要求把这种历史Journal改为raw committed。先前所述衔接疑问已按现有SSOT解决，无需新增Owner权威或兼容合同。

离线Operator新增`jav-release-effect-history-proof.js`，复用目标Host同一Frozen Catalog档案、完整递归技术证明和Arca history observer。在原source只读事务内，每次最多100条待证明Effect，只接纳`reconcile_required/destructive_commit/arca.ondeck.input_settlement.delete@1`且完整证明为fulfilled_by_successor的条目。未知状态/类型/Catalog、活动责任、缺失/漂移证据均保持blocker；超过上限整组拒绝。stage历史可能需要物理观察，离线入口明确拒绝，不做文件IO。Projection只允许真实已登记ref的resolve，禁止执行；SQL adapter只允许SELECT，不新增Executor或Domain协调。

inspection/copy Receipt增加逐原Journal完整行摘要、原Effect/Event、后继Result/Commit及输入摘要组成的effectHistory及整体proofDigest。copy仍逐表原样保存全部旧行；准入只扣除本snapshot内实际证明的精确Effect ID，不按ID白名单或raw状态批量豁免。目标Host仍使用原Frozen History verifier，每次startup先核Catalog证明，并且不会对failed Event/completed failed Attempt重新dispatch；Journal原样保留，不把后继Result写入旧Event。

验证：完整冻结生产副本检查成功证明20条，其余6 active Libra、4 Work/4 WorkAttempt、5 Event/1 EventAttempt、1 Acceptance Recovery及1 Outbox仍全部阻断，eligible=false。一次性完整副本上8类破坏（缺失后继Result、原intent漂移、Owner未Commit、缺失Owner Receipt、活动Work、未知Catalog、后继摘要漂移、缺失Commit Result）逐项拒绝，随后rollback恢复原20条证明；源文件及副本完整SHA256均未变。该显式环境测试10 pass/0 skip，不提交生产数据；最终proofDigest为`9ccdedea4a8de65a72a426e79a1349bc8b795e702efbacab0ff1e7aa13e4f223`。原copy/terminal-history组合86 pass；新增未知孤立Effect的copy拒绝用例后copy文件10 pass，含有界heap大Outbox及回退保护。目标Host实际完整升级运行由主聊天继续，此处证明共用代码路径，不冒充已完成目标Host运行。

Acceptance Recovery/Outbox仍不适用这项证明，上一节关于其精确范围及Ended-history保护的结论保持；没有直接Ack、补Rejected或清除该Case。

## UI负责人差异审核062c0ba7a1 / 2026-10-15

审核具体commit `062c0ba7a17e8ff5e03d478a685968e0bdc929d1`、候选image ID `sha256:5c100fb5a677fceebda31773b4c22fba7a519d2e306e7c5b10bb9894b9c16352`。**不变UI可继承1qAJmlnq接受，但新增超限失败原因的映射不完整，需补后复核该路径。** 这不否定后端有界失败收口，也不追认完整副本、媒体或发布资格。

负责人直接在本机上述不可变镜像中以无网络/只读root的临时Node进程读取资产并调用真实`projectPlans`，未启动Service。JS/CSS仍分别为`5d3bd76bdcd5ee77a914899a96e53c605850f6fd8f44152e112769edb9af34fa`、`82cb8561be6544293d0f6850171d0df02a9a97e53bf60a075ec262ede15df4e2`，与已接受1q一致。event-runtime和Formation过程投影器的实际文件SHA256分别为`be166db5f11be6bde667250347379bd5ce09cb090143565bd14464f95a98f3ae`、`b194c9767bdd7270208f1329b5c8b9d53d241683eaa4c518db617a77a7f216d9`，与062的Git blob逐项相同。

新码`P4_OBSERVATION_RESULT_STORAGE_BOUND_EXCEEDED`来自pure observation的Result/Evidence UTF-8 canonical字节超限，retryDirective=never；非pure不走此转换。独立本地四项Result/Evidence×dispatch/recovery边界测试全部通过：Event failed、Attempt completed/contract、无成功Result、Permit释放且无物理Effect调用。未重跑全部服务或Linux Host资格。

呈现问题已用实际候选投影器及同字节UI在1920×1080和390×844复现。受控failed Event快照保留正式failureCode；实际过程投影返回failed节点/attention计划，但失败原因落入“系统没有保存可展示的文字原因”。现有浏览器过滤技术码后仍原样显示这句，未能向用户解释已经明确知道的超限原因。没有把它显示为executing，也没有泄漏英文内部message或P4技术码；问题是原因缺失，而非状态或重试门禁错误。这是过程呈现的限定实验，不声称正常Libra有界候选Record仍会超限或生产已新触发；列表DTO受控，不冒充完整Host。

建议复用既有失败文案映射，使用短句：**“返回的信息超出处理上限。”** 不重复已显示的失败状态，不显示实现字节数，不附“请重试”或新增恢复操作；正式failureClass/code、never策略及证据保持。单纯UI字节相同不能证明新失败类型已有可读文案；修正后仅需复验受影响失败呈现，无需重复不变26/8组。

仓库外证据`E:/my_project/helix-git-consolidation-20261008/jav-ui-review-062c0ba7a1-20261015/`：`owner-final-review.json` SHA256 `28a6e6eb0271abbfb3b1011d0e96b05920d5a80ee7761fa6a3474740fe8f310b`；真实投影`image-projection.json` SHA256 `bf971cd324dc7ab1965842c8957124188f534e61331a49f5fc5cadf65f668689`；最终宽/窄原因检查0通过/2失败日志SHA256 `0d0e1c357e6192fedfd7c716e0f7c30aff626a9126a8fb3128ff2d08febe6926`；本地四项Runtime日志SHA256 `1295e72616ca15e5ec0b8199dbc09eeed1e41ff1bd6c46140fc5e042c86526f3`。截图、trace及实际文案附件在`observation-failure-reason-check/`，已目检。首轮只排除前端另一种兜底“具体失败原因暂不可用”，漏掉真实后端兜底而通过，保留为不完整Oracle、不计资格；最终改为排除这两种未知原因兜底后，两尺寸均如实失败，未改产品。

任务浏览器/动态端口及临时哈希容器均已结束。负责人只追加Evidence，无产品源码、生产、NAS、停机、Reset或用户材料动作；候选tar校验、20条Linux业务、Windows包与最终Service/副本/回退继续沿实施方各自证据处理。

### UI负责人接受f27035945d的失败呈现修正

2026-10-15，接受具体commit `f27035945ddf75bc4326d63201750f1a6a9d6e8e` 的适用UI变更。与062比较，唯一产品修改为`error-labels.ts`新增新失败码的已知文案“返回的信息超出处理上限”；Foundation、失败Projection、never策略和全部其他UI源码保持。旧062缺口保留为历史，不追认原失败路径通过。

独立冻结并加载构建产物JS `index-CQ6ZHoan.js` SHA256 `c5bbbc11714fadb01f2be4ea3a77ab46b3211358b65f0d99e7462f6cbb869d15`、CSS `index-BYV0LKeb.css` SHA256 `82cb8561be6544293d0f6850171d0df02a9a97e53bf60a075ec262ede15df4e2`。复用062实际镜像投影器产出的相同failed Event过程数据（对应后端源码无diff），只读受控列表DTO，在1920×1080和390×844均通过：失败状态/原短中文原因可见，未知原因兜底消失；没有P4码、英文内部message直出，没有新增重试/继续命令，两尺寸dialog无横向溢出。窄屏截图已目检。其余未变化范围继续沿用原1q的26/8接受，无需整组重跑。

独立证据目录`E:/my_project/helix-git-consolidation-20261008/jav-ui-review-f27035945d-20261015/`，`observation-failure-final.log`为2通过/0失败，SHA256 `e5945f75857f2d4b7552fdf57328d72235f73f3dc925eb27018ece2ff38e10a2`；补充脚本SHA256 `e88e2aeea5666bcba5018bf301e31c785349ecaa085a9383b662ca70fa3cad3f`。任务浏览器与端口已关闭，未改产品或生产。此接受绑定commit/所测bundle；最终镜像字节绑定、原生媒体、整合及生产完整副本/回退仍由主任务记录，不将尚未完成的镜像构建称为已验收。

## 本轮修复已随037592bef4发布（2026-10-15）

用户授权的另开诊断→合并→完整副本演练→标准生产部署已完成。生产11:46:57Z正常供给、无执行基座fault，观察11条新Libra成功；旧未完成6 Subjects及获单独授权discarded记录由标准精确Reset处理，不恢复旧失败Attempt。当前204表已包含Libra完整候选Evidence Store，Foundation结果上限仍64KiB、引用4KiB；20旧Arca settlement Journal及Event/Attempt在副本保持，生产Journal摘要继续保持，只读fulfilled_by_successor证明不改历史、不第二次delete。实际生产首次大搜索尚未自然触发，Evidence表0，不以普通新执行冒充该特定live case验收；原空间等待按既有容量合同。完整日志、授权范围、资产/Owner接受、快照/伴随身份保护、实际升级和回退限制见[JAV发布证据](JAV_RELEASE_COPY_20261015.md#生产发布037592bef4完成2026-10-15)。不批量关闭旧UAT。
