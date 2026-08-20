# ShelfDeck / Helix Documentation Index

Status: Movie Procurement与Movie Libra封口保持有效；Movie Arca已完成Handoff B Acceptance、On-deck、Shelf Entry、Deck Fact、Beta Aftercare、Off-deck与Shelf Deregistration闭环。“我的收藏”承载海报墙、收藏健康、直接退出及历史Entry。当前状态为`MOVIE COLLECTION LIFECYCLE READY THROUGH SHELF DEREGISTRATION`；Docker/NAS与生产部署均未开始。

2026-08-21本地现场切换已完成：媒体整理工作区改由后端持久化`libra_formation_projections`提供展示，现场数据库已迁移到
`helix-clean-v3`并恢复服务。当前现场数据库为182 tables、659 Subjects/659 Projection rows，Formation active首屏25条，
健康接口和Admin Web均可访问；切换前回滚备份及残余UAT问题见`CURRENT_STATUS.md`与`USER_ACCEPTANCE_TEST_ISSUE_LOG.md`。
本轮没有清空现场数据、重扫`Z:\Film`、重同步外部Provider或触碰Docker/NAS/生产数据。

Shelf Deregistration现为非破坏性的正式异步链：Admin Intent立即让Shelf退出Routing与Acceptance目标，后台经Responsibility Drain、
持久化Manifest、每100项分页Verification及唯一Atomic Commit终结Shelf Entry/Deck Fact并释放精确Material Control。非空Shelf与超过
10,000项Manifest均已验证；文件、Related、Artifact和Target Folder完全不变，全链不申请Volume Permit。已Accepted On-deck、已授权
Off-deck及Aftercare Workspace settlement在安全边界收口；Control release通过durable exact-key Signal触发Procurement增量Eligibility。
完整Architecture Gate、服务回归和Admin Web build均通过，Movie本地生命周期至Shelf行政终结已经封口。

Off-deck现在把推荐退出、Duplicate审阅、Aftercare加入审阅和用户直接退出收敛到同一安全链：Review先原子取得逐Entry
Reservation，冻结immutable Destruction Scope，再经过Selection及必要的High-volume二次确认形成Batch Envelope和逐Entry
Authorization/Case。实际Primary删除、Related引用释放、last-reference删除及Destruction Verification全部经过
Work/Plan/Event Runtime/Resource Governor；共享Primary在删除前拒绝，共享Related保留到最后引用，授权Identity已不存在时只形成
精确absence Evidence。全部成员收口后才原子终结Deck Fact、释放Control并把Entry置为offdecked，历史事实完整保留。

Admin Web的Off-deck页面提供建议、Duplicate Group、审阅授权、High-volume第二屏、进度与Policy；Collection详情可直接退出，
Aftercare详情可加入审阅。默认Policy关闭，任何unknown Fact都不会产生退出建议；无用户授权不会发生物理销毁。机器合同继续为
112 Capability、98 Result family、180 table、43 Canonical Transaction、115 Admin route加public health，UI Surface仍为17。

Aftercare不新增一级页面。每个Shelf Entry通过正式Work/Plan/Event链形成Custody、Presentation和Conformance三维Evidence；当前健康、
Finding、Case与修复历史投影到“我的收藏”的检验章、筛选和详情。每日Custody只核验已知Inventory成员，每周深检Presentation与
Conformance；自动修复仅使用Arca已拥有且位置明确的材料，可闭合NFO、Poster、现有Primary媒体加工和Placement迁移。需要重新搜索、
下载或采购媒体时保持`attention_required`，不回流Procurement/Libra。修复只有在新Inventory revision、旧输入settlement、Workspace
reclaim及三维fresh复验全部完成后才resolved。正式UI inventory现为8 pages + 9 journeys = 17。

后续本地真实媒体测试的可重复构建主库由用户于2026-08-11固定为
`C:\Users\markm\AppData\Local\Temp\ShelfDeck-P14-20260723\material-fields`。destructive Formation只允许作用于该库或
由它生成的独立系统Temp副本；Libra、Arca及后续Movie E2E不得把`Z:\Film`作为运行时输入。用户只对明确的测试取材步骤追加
只读授权；不得在`Z:\Film`写入、移动、重命名或删除。

该根目录现由`media-service/scripts/build-helix-movie-test-library.js`维护22个Movie纵向场景：12个既有
Procurement/Libra输入形态，加10个Formation高风险E2E场景。受管manifest位于`.shelfdeck-test-library\manifest.json`，
同时记录Candidate/Related/Input Form、Related替代与清退、精确授权、故障恢复、Target冲突、跨卷、Reality变化、同根二次
Observation、ISO/DVD和Scope上限预期。Target collision与Reality mutation使用control seed并只允许在manifest指定阶段物化。
构建器只替换ownership marker声明的`SDT-*`路径，旧P14目录不会被清理。

第一次实施的P0–P13资产继续保留，但此前由大型Coordinator同步闭环得到的Movie Canary只证明低层Capability、Owner事实和
Handoff A Ready数据形态可工作，不构成`Work Scheduler → Event Runtime → Resource Governor`已经参与的Foundation E2E证据。
当前唯一活动实施计划见`CURRENT_PLAN.md`。最新`Z:\Film`全库Canary以本机Node.js、全新临时clean数据库和只读源完成，再次验证了`standalone_file|ordinary_directory|bdmv_container`三类Scope、1024物理成员Run上限、`苹果.mkv`独立Candidate、943个Handoff A Ready Offer及源Reality不变。Candidate尾段由281.737秒降至173.523秒，证明整Run重复投影与Coordinator扫描修正有效；Observation与普通Media Probe的本轮耗时变化由用户接受为环境波动。随后全量数据库约束及代表样本复核未发现正确性问题，Movie Procurement因此在Handoff A Ready边界正式封口。完整证据和保留资产记录在`CURRENT_STATUS.md`。

Handoff A之后的第一个Libra节点已经正式接通：Outbox Dispatcher触发薄Intake Coordinator签发Supporting Work，Planner与Event Runtime
执行Candidate、Material、Binding及continuity验证并原子接受。隔离Movie测试库形成19个accepted Intake和19个Subject；Admin Web
“上架进度”按一行一个Subject展示，当前全部为`awaiting_destination`。ISO/DVD依赖typed topology而非扩展名猜测；历史大型Libra
Coordinator不在产品路径中。本轮没有建立Libra Run/Workspace、没有消费Shelf生产资源，也没有产生Handoff B或Arca媒体事实。

Intake之后的Routing节点也已通过正式Foundation链接通。Field Policy支持direct与closed-AST sorting；Fact Observation只按Policy需要
读取Candidate NFO，仍缺Fact时才通过确定性TMDB Integration取得最小Decision Fact。高优先级unknown不会落入catch-all，unresolved
Subject可从Admin Web一次性手选Shelf且不改长期Policy。“上架进度”保持一行一个Subject。本地fresh-clean E2E中19个direct及4个
sorting Subject自动resolved，1个Provider not_found先保持unresolved、再手动resolved；Acceptance Spec、Libra Run、Workspace与Arca
Shelf Entry均为0。随后真实外部E2E又通过Admin产品入口保存TMDB连接，并让无NFO的`The Shawshank Redemption`经真实TMDB
ID `278`/年份1994自动命中经典Shelf；真实`Fight Club`的两个同名候选则正确保持ambiguous，系统没有选择第一项。重启未产生重复
Provider Fact或Decision，媒体Reality不变。

Routing之后的User Perception与Acceptance Spec节点也已闭合。真实Douban同步通过正式Integration和Foundation链覆盖104页、形成1546条
immutable Record；评分日志在“系统设置”中作为只读Tab分页展示，上架进度Subject和我的收藏Shelf Entry使用共享1–5星控件，Candidate
始终不可见。两部匿名隔离媒体的不同真实星级分别形成不同Requirements digest；No-rating和本地1–5星矩阵由自动化补齐。改分追加
Correction及新Spec revision，不覆盖旧事实；重启和相同idempotency key重放不重复Record、Resolution或Spec。当前机器合同为
112 Capability、98 Result family、180 table、43 Canonical Transaction、115 Admin route加public health共116 route。Libra Run、
Acceptance Spec之后的Libra Run至Handoff B Offer链已经接通。隔离P14真实字节、20 Subject并行、评分/Spec replacement、加急继承、暂停恢复、
空间不足以及R02/R04–R06崩溃窗口均通过正式Composition Root；加入D10后的P14完整回归为13/13 PASS、451.569秒，默认服务测试为
245 pass、14个显式环境skip、0 fail，合同计数保持112/98/180/43/115。D09/R09进一步以真实Profile 8/7 DV字节证明：GPU完整pipeline合法时仅走NVENC；GPU保持ready但当前source pipeline被Evidence拒绝时，零GPU媒体Effect并建立独立CPU Work/Plan/Event/Intent，最终形成SDR BT.709 limited、yuv420p、无DOVI且三点可解码的HEVC输出。成功场景形成自包含Package和open未消费Offer，
等待/frozen场景不伪造Offer，Arca事实保持0。MoviePilot External Landing现通过正式Integration Binding配置；Observe只按整理历史
`download_hash → dest`解析最终文件，Stability和Workspace Import复用同一endpoint/mount fence。Import把只读Landing源流式拷贝为
独立Workspace Physical Material，不硬链接、不删除Landing原件。真实L07复用MoviePilot中已完成的`The Wild Robot (2024)`精确任务，测试硬阻止download add，最终`moviePilotDownloadAddCount=0`。21.76 GB的HEVC 4K + TrueHD成品完成Transfer History、planned restart、完整checksum、Stability、Verify、Import、Package与open Offer；Landing与Workspace digest一致而inode不同，Offer未消费、Arca事实为0。External Landing完整checksum采用Integration + `volume_read` Permit及30分钟有界超时，不再被旧30秒timeout打断。

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
最多1024个物理成员，超过上限时整体不建Run。Structure消费完整group并将单标题解析为一个Triage Unit，不能把内部M2TS拆成多个Candidate；
多标题、歧义或结构不完整保持`not_ready`。所需Playlist/Clip/结构依赖必须在Run Admission前完成Observation、Eligibility
和Control，不能由Triage在Admission后静默扩张。每个BDMV容器由`procurement.triage.bdmv.assess@1`一次性完成有限拓扑和选定主标题metadata probe；Structure只消费`BdmvAssessmentEvidence@1`和`UnitScopeReference`，Candidate Context按Scope digest重建成员。

混乱Movie Field的pre-triage边界同样由SSOT固定：Field根普通文件各自形成`standalone_file` Scope；第一层普通目录形成
`ordinary_directory` Scope；BDMV及同级`CERTIFICATE`形成`bdmv_container` Scope。Run与任一Scope都以1024个selected
Physical Material为唯一上限，Related不计数。Structure按冻结Scope决定标题与Related association mode，不重新猜测当前目录，
Candidate Assembly只查询当前Scope；Execution Foundation的16 in-flight Event和Permit语义没有因此改变。

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
| `acceptance/LIBRA_HANDOFF_B_READY_SCENARIOS.md` | Libra Run至Handoff B Ready的38场景唯一验收矩阵 |
| `acceptance/LIBRA_HANDOFF_B_TEST_AGENT_HANDOFF.md` | 面向独立测试Agent的项目背景、安全边界、执行顺序与证据交接 |

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
