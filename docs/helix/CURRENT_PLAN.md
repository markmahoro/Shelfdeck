# ShelfDeck Clean Helix Master Plan

Status: Movie Procurement保持`CLOSED FOR MOVIE`；Movie Libra保持`MOVIE LIBRA CLOSED AT HANDOFF B READY`；Movie Arca已经接通Handoff B Acceptance、On-deck、Shelf Entry、Deck Fact、Beta Aftercare、完整Off-deck及非破坏性Shelf Deregistration。当前状态为`MOVIE COLLECTION LIFECYCLE READY THROUGH SHELF DEREGISTRATION`；Movie从发现、生产、收藏、养护、退出到整架行政终结的本地产品链已经闭合，Docker/NAS与生产部署仍是独立后续工作。

Last updated: 2026-08-21

## 0. Qualified repair — UAT-002 Intake throughput

Intake继续使用每个Candidate独立的concurrency scope、256个open Work硬上限、16个Handoff Acceptance预留槽，
并在一次reconcile中最多新Admission 32项。补充的重启资格检查发现deferred process只存在内存Set；现已改为同时从
持久Procurement Offer分页重建，内存wake只作加速。400 Candidate积压在新Coordinator实例中以13个有界批次全部重新Admission，
不增加全局串行门闩。真实22部Canary吞吐仍由第二轮Admin Web UAT确认。

## 0. Active repair — UAT-001/UAT-003 Douban detail anchors

豆瓣Collection行缺失年份或别名时，同一有界Acquisition Page最多读取16个精确Subject详情页；响应必须绑定相同Origin和
Douban Subject ID。详情年份、别名和payload digest进入新的immutable source revision，旧Record不改写。Record Commit后只唤醒
title/year Anchor精确相交的Subject Resolution，周期reconciler只承担丢Signal恢复。既有技术尾缀、括号年份和多语言Alias规则保持
严格匹配，不提高模糊阈值。专项回归通过后单独提交，三个定向Canary留待新UAT验证。

## 0. Active repair — UAT-016 TMDB locale and alias evidence

用户授权的Movie Canary修复已经开始。TMDB连接现在把首选语言作为用户可见、revisioned设置，默认`zh-CN`；Search、
精确ID Observation与Metadata读取共用该设置。精确ID和有界候选同时保留Original Title、Alternative Titles与Translations
别名Evidence，Libra继续使用严格关联而不放宽为模糊匹配。现有无该字段的连接按明确默认值读取，新保存revision显式持久化。
本修复完成专项回归和Admin Web build后单独提交；真实Provider与Canary浏览器资格留给第二轮UAT。

## 0. Current amendment — Formation durable projection local cutover

2026-08-21，本轮“媒体整理工作区”已从请求内临时拼账切换为后端维护的
`libra_formation_projections`技术Projection。它是一张可重建的展示Projection，不是业务授权依据；每个Subject一行，
active默认25条分页，completed独立分页，Projection Host负责精确唤醒、启动重建、30秒fallback和100项有界游标。

本轮按“先克隆、后现场”的顺序完成安全退役和恢复：

- 现场数据库已由`helix-clean-v2`迁移至`helix-clean-v3`，表数量182；迁移只退役旧Catalog下的62个活动Work、106个活动Event，
  保留全部不可变执行历史，并把Owner后续replan留在原Work scope内；没有清空数据库或删除业务事实。
- 已在独立数据库克隆上验证迁移、启动恢复、541个既有Subject生成Projection、active分页25条、页面读取和队列幂等，
  随后才迁移现场数据库。现场切换前备份为
  `C:\Users\markm\AppData\Local\Temp\ShelfDeck-Local-Rerun-20260820\formation-projection-cutover-20260821-015122\shelfdeck.pre-retirement-20260821.db`，
  SHA-256为`A734FE822896D88F597F66825853EA984E6919D8E58E23099CAC6D022A27F154`。
- 现场迁移后`integrity_check=ok`；当前数据库有659个Subject和659行Projection，旧Catalog无非终态Attempt/Event，旧Plans仍保留2863条。
- 本机服务已恢复监听`127.0.0.1:18080`；健康接口返回`normalSupplyAllowed=true`，Formation active接口返回25条，
  completed可独立分页，Projection状态为`ready`，Admin Web返回200。
- 现场服务恢复期间继续处理原有队列，未主动新建媒体任务；启动阶段收口的是原队列中既有的Workspace transcode中间产物。
  没有重新Observation `Z:\Film`，没有清空当前队列，也没有主动重新同步豆瓣、TMDB或MoviePilot；Docker、NAS和生产数据均未触碰。

最终证据：启动恢复/事件运行时/Runtime Host聚焦回归分别为12/12、24/24、12/12；Node全量回归276项为259 pass、17 skip、0 fail；
Admin Web production build通过。现场日志另有1条既有Arca `CLEAN_ARCA_TARGET_COLLISION`业务错误，服务未降级；该问题不属于Projection切换，
已登记到UAT台账，未在现场数据库上直接修事实。

## 0. Completed target — Arca Shelf Deregistration and Movie lifecycle closure

Shelf Deregistration已经删除“仅空Shelf、同步改状态”的捷径。用户通过现有Admin route提交带Shelf revision fence、精确Shelf名称、
保留文件与释放Control确认的Intent后，Shelf立即进入`deregistering`并退出Routing/Handoff B Acceptance目标；HTTP返回`202`，后续固定经过
`Responsibility Drain → Manifest Freeze → Paged Verification → Atomic Commit`。Coordinator只处理责任收敛、Work签发和terminal Result，
Capability统一经过immutable Plan、Event Runtime、Resource Governor、Attempt与Result Binding。

非空Shelf可以注销。Release Manifest只保存header/digest；成员按Shelf Entry、Inventory revision、member ordinal稳定排序并持久化，
每100项形成一个Verification Work，整座Shelf没有Material总数上限。`controlled_material`冻结精确Physical Material Identity与Control fence；
Related/Artifact只作为`reference_evidence`，不会伪造Control release。所有Page通过后，唯一terminal commit在同一事务中再次校验Manifest，
释放精确Arca Material Control、终结active Shelf Entry与Deck Fact、更新Finished Goods Region、写Receipt/Result/Outbox并把Shelf置为
`deregistered`。任何CAS漂移都会整笔回滚并形成新Manifest revision，绝不部分释放。

竞争责任已经接线：未授权Off-deck Reservation会释放；已授权Off-deck与已Accepted On-deck在不可逆边界后继续安全收口；Aftercare先通过
专用`care_deregistration_settlement` Work回收其Workspace，再使旧Case invalidated。terminal Control release按每页最多100个Material Key
发送durable Neutral Signal给Procurement，Signal丢失仍由既有cursor fallback发现；只对精确Material-local Eligibility做增量重算。

Admin Web“收藏架”提供强确认Dialog、责任数量、phase/Page进度和只读历史状态；`deregistering|deregistered` Shelf不再允许Standard、
Placement或Target变更。“我的收藏”支持当前/历史筛选，因Shelf注销终结的Entry只进入历史。注销全过程不申请任何Volume Permit，不读取、
移动、改名或删除Shelf Target内文件，也不删除Target Folder。

验证结果：Shelf/Aftercare/Off-deck/Deregistration聚焦回归24/24；超过10,000成员的非空Shelf形成10,003项Manifest、101个Page并完成注销；
进程中断后同一数据库恢复为唯一Process、Receipt、Control release与terminal Event。完整Architecture Gate为162个test file、1056 pass、
7个显式环境skip、0 fail；完整服务回归245 pass、17 skip、0 fail；Admin Web production build通过。机器合同保持112 Capability、
98 Result family、180 table、43 Canonical Transaction、115 Admin route加public health，UI Surface保持17。P2 aggregate为
`21942ef67403a4658f101966e6ea232ee9872e3add684e7842e7e1ef59dc308a`，SSOT source-map aggregate为
`3fde8cbfa5779c48ec15d1441b7cf2ea21779151c3da02d2f4d345ed6cc4f927`，manifest aggregate为
`64e0eefa999513a01804776951b11137c64913c9f1cb5ba1a20020f0fcdd6846`，DDL digest为
`78075366b3409916b8f8c6fcd3c0786daa5e45bab82f59ba83d91a2663689119`。

保留证据位于`C:\Users\markm\AppData\Local\Temp\helix-shelf-deregistration-aC8Nd7`，其中包含SQLite数据库与
`shelf-deregistration-report.json`；重启恢复证据数据库位于
`C:\Users\markm\AppData\Local\Temp\helix-shelf-deregistration-8hH1Vk\data\shelfdeck.db`。隔离Target内普通Primary、NFO、Poster、
字幕及BDMV/CERTIFICATE代表文件共9项，注销前后Reality digest均为
`31ddfb4ec9ceb37f7cba6e55267f55ddd262bf59bbba7ac7c44b949af7a2651d`。测试仅使用系统Temp及隔离Target，
未访问`Z:\Film`、Docker、NAS或生产数据。

## 0. Completed target — Arca Off-deck and Movie lifecycle closure

Off-deck现在以Arca-owned Policy、Candidate/Duplicate Evidence、Review、逐Entry Reservation、immutable Destruction Scope、
Selection/High-volume Receipt、Authorization、Case及Deletion Evidence形成完整链。推荐退出、Duplicate审阅、Aftercare
`attention_required`加入审阅和用户直接退出复用同一安全路径；用户直接退出不会伪造Review Candidate。默认Policy为disabled，
任何Condition Fact为unknown时不产生Candidate。

Authorization前可以取消Review并释放Reservation；Authorization后不可撤销。服务端以Entry、Primary、总空间、Shelf覆盖率和
全Deck覆盖率五项阈值重算High-volume，必须有独立第二次升级确认，客户端无法声明`highVolume=false`绕过。Batch只是一份授权
Envelope，每个Entry仍拥有独立Authorization与Case；单项stale不会回滚其他已经成立的退出Intent。

每个Case固定经过`Scope Verification Work → Material Destruction Work → Terminal Commit Work`。每个Primary删除、Related引用释放、
Related最后引用删除和最终核验均为独立Event，并通过Event Runtime、Resource Governor、Authorization Handle、Effect Journal及
`volume_mutation` Permit执行。共享Primary在任何删除前即被Scope Verification拒绝；共享Related先释放本Entry引用，最后引用消失后
才删除。授权Identity已经不存在时只形成精确absence Evidence，绝不触碰同路径替代Identity。全部成员合法收口后，terminal事务才
原子终结Deck Fact、把Shelf Entry置为`offdecked`并释放精确Material Control；历史Entry、Inventory、Authorization、Case和Evidence保留。

Aftercare与Off-deck之间的异步安全边界已闭合：Reservation原子阻止新Case；已有Care Work先通过精确Process cancellation排空，Review在
安全停点前保持`preparing`，不得提前授权。执行中的Off-deck Case若遇到Endpoint outage进入blocked；Scope变化进入同一Case的
`awaiting_reauthorization`，不会创建第二个Case。Coordinator不直接访问filesystem、Capability实现、Dispatcher、Event Runtime或
Resource Governor。

Admin Web的Off-deck页面已接通退出建议、Duplicate Group、审阅授权、High-volume第二屏、逐Entry退出进度和Policy编辑；“我的收藏”
详情可直接发起退出，“收藏健康”详情可加入审阅。没有新增一级页面或Admin route，UI Surface继续为8 pages + 9 journeys = 17。

自动化覆盖Policy tri-state、五项High-volume阈值、1024成员Scope、Duplicate分页、删除重放、删除后崩溃恢复、共享Related、共享Primary、
替代Identity、Endpoint outage和Coordinator静态边界。产品Composition Root在P14只读源的全新Temp副本上验证了普通单Entry及10 Entry
High-volume破坏性链：取消Review零副作用，正式批次形成10份独立Authorization/Case并全部offdecked；Scope外sentinel与原P14主库不变，
`failedWorks=0`、`failedEvents=0`且无非终态Work/Event。机器合同保持112/98/180/43/115；Execution Foundation、Procurement、
Libra与Aftercare状态机均未修改。最终Helix Architecture Gate为161个test file、1051 pass、7个显式skip、0 fail。

## 0. Completed target — Arca Aftercare Ready

Aftercare现以每个Shelf Entry作为Owner Process scope，经`Health Assessment Work → immutable Plan → Custody / Presentation /
Conformance Event → Assessment Commit → Care Disposition`推进。Coordinator只签发Work、读取terminal Result、创建Case或收口Case；
Planner不执行Capability，所有Capability均经过Event Runtime、Resource Governor、Attempt及Result Binding。三项Assessment共享同一
Care Basis；Basis过期后旧结论只保留为历史，不得继续给当前Shelf Entry着色。

周期合同已经封闭：Custody每24小时到期，Presentation与Conformance每7天到期；每个Shelf Entry加入最多2小时确定性jitter；
启动恢复和丢失signal通过`fx_reconcile_cursors`按100项/页、5秒/轮有界发现。每日Custody只核验当前Inventory成员的存在、可读性、
stat fence及最多256 KiB有界指纹，不遍历Shelf目录。Endpoint级故障以共享`incidentKey`聚合为`observe/not_assessable`，不会批量创建
损坏Case。

Beta自动修复已闭环NFO再生、Poster有界重取、现有Primary的remux/transcode与Placement迁移。效果完成后必须建立新verified
Inventory revision、精确settlement旧输入、回收Aftercare Workspace并重新执行三维Assessment，最后才能把Case标记为resolved。
Primary缺失、Identity改变、不可解码，或需要重新搜索/下载媒体时固定为`attention_required`，不调用Procurement、Libra或
MoviePilot。每个Shelf Entry由数据库partial unique约束保证最多一个非terminal Case；Basis变化会使旧Case invalidated。

“我的收藏”已承载全部健康产品表面：海报卡提供灰/绿/黄/蓝/红且带可访问文本的检验章，支持全部、健康、观察中、修复中、
需要处理、尚未检查筛选；详情展示Custody、Presentation、Conformance、Basis freshness、Finding、active Case进度及Inventory
revision修复历史，并提供只签发评估Work的“立即检查健康”。独立`/care`一级页面已经移除；正式UI inventory为8 pages + 9
journeys = 17 surfaces。

产品E2E覆盖健康Entry、NFO修复、Poster修复、Placement安全迁移、Inventory revision 1→4、三次Case闭环、Workspace先回收后
Case closure、重启无重复，以及Primary缺失同时NFO缺失时禁止昂贵局部修复。P14隔离产品场景15/15通过；完整服务回归245 pass、
16个显式环境skip、0 fail；完整Architecture Gate为160个test file、1039 pass、7 skip、0 fail；Admin Web production build通过。
机器合同保持112 Capability、98 Result family、180 table、43 Canonical Transaction、115 Admin route加public health；P2 aggregate为
`38f7ec09909ec35a75907d3ba7dadc8fa2e9bf715c2775076906039b39d9704d`。本节点未访问`Z:\Film`，未使用Docker/NAS。

## 0. Completed target — Movie Arca at Shelf Entry and Deck Fact

Arca现以`Handoff B Outbox → Acceptance Attempt → Supporting Work → immutable Plan → Event Runtime → Capability`
独立验证Package、Shelf Standard/Placement、Identity、Structure、Metadata、Mandatory Media、空间与Inventory可行性。
Accepted commit原子消费Offer、取得Product Control并建立On-deck Custody、Final Inventory Decision和On-deck Run；
Rejected commit只形成immutable rejection Decision/Receipt并回告Libra，不建立Arca Control、Shelf Entry或Deck Fact。

On-deck固定链通过独立Event完成Target Slot、Stage、Staged Verify、Final Verify、Placement Switch、精确Input
Settlement、Fulfillment Verify与On-deck Commit。只有最后的On-deck Commit原子建立Canonical Content Identity、
Inventory Representation、Shelf Entry、Deck Fact、Off-load Completion和typed Result/Outbox。Coordinator只签发Work、
读取terminal Result和请求Arca-owned transaction，不执行文件Capability或Foundation Runtime。

Admin Web“我的收藏”已成为active Shelf Entry的海报墙：卡片只来自Arca Collection Projection，点击后展示Metadata、
Media-Cast、Inventory/Deck revision及Shelf Entry评分入口。海报读取是带Inventory revision/digest/containment fence的
authenticated GET；缺海报只显示fallback，不触发Provider、Aftercare或文件写入。

fresh-clean正向与空间不足拒绝E2E都已通过，并分别在完成后重启验证无重复Acceptance、On-deck、文件效果、
Shelf Entry、Deck Fact或Outbox消费。当前机器合同为112 Capability、98 Result family、180 table、43 Canonical
Transaction、115 Admin route加1条public health（总计116 route）。该历史节点当时不实现Aftercare、Off-deck或Shelf Deregistration；
三者现已由前文独立闭环，只有NAS部署仍在当前范围之外。完整服务回归为245 pass、16个显式环境skip、0 fail，
Helix Architecture gate与Admin Web production build均通过。

## 0. Closed target — Movie Libra at Handoff B Ready

2026-08-14，用户在审阅38场景、真实DV、源级GPU→CPU fallback及真实MoviePilot L07终态证据后接受Movie Libra封口。封口范围从Handoff A Accepted后的Intake开始，覆盖Routing、User Perception、Acceptance Spec、Libra Run、Workspace Production、Product Conformance、Package Publication，终止于自包含On-deck Product Package及open Handoff B Offer。封口不包括Handoff B Accepted、Arca Acceptance、On-deck、Shelf Entry、Deck Fact或Workspace Off-load回收。

后续Arca接入只能消费正式Handoff B合同；若要求改变Libra Owner、Run/Work/Event执行边界、Production Planner、Package、External Landing或Promotion语义，必须返回Design，不得以Arca实现补丁反向修改已封口的Movie Libra。

Libra Run、Workspace、Product Fact、媒体生产、Promotion和open Handoff B Offer均已通过隔离P14真实字节及故障注入验证。原35个逻辑场景继续由
`test/helix-libra-handoff-b-scenario-e2e.test.js`的产品级test case覆盖；MoviePilot External Landing接线后该文件复跑为13/13 PASS、约450秒。D09与R09另由真实DV字节产品Composition Root E2E覆盖。当前默认服务测试245 pass、14个显式环境skip、0 fail；Architecture gate为159个test file PASS。合同计数保持112/98/180/43/115，当前P2 aggregate为
`f75a5a714d2bb06af61cb31986832ed07ff9106e51ef12f3988fca87a4bf8327`，SSOT source-map aggregate为`9d7e809b178976d1b742819f87622a44f9757c0ec173b32e494be4e3fbd65ac3`。Execution Foundation状态机没有修改。

DV专项已封口：真实Profile 8样本经实际Device Probe选择`local-nvidia-nvenc-0`，Assessment 24/24通过后只产生一份GPU Transcode Effect；真实Profile 7样本在受控Platform Adapter中保持GPU `ready`但缺少当前source pipeline，GPU Assessment以`required_pipeline_profile_unavailable`收口且GPU Transcode Effect为0，随后由新的CPU Work/Plan/Event/Intent执行two-pass及显式strict-ABR重规划。两条最终输出均为HEVC、SDR BT.709 limited、`yuv420p`、无DOVI，5%/50%/95%均可解码；重启不重复Assessment或媒体Effect。Profile 5/无兼容Base Layer的D10会耗尽本地策略并在外部无结果时Frozen，0 Package/0 Offer。

MoviePilot External Landing产品合同已经接通：MoviePilot的请求/整理目录与Libra Workspace保持独立；最终输出只允许按整理历史的
`download_hash → dest`解析，不读取下载历史旧`path`。`dest`经当前`MoviePilotLandingBinding@1`转换为Endpoint-relative location，
随后由Stability、Identity/Package Verify和Workspace Import复用同一Binding revision。Import以流式普通拷贝形成独立Workspace
Physical Material，前后核验stat、digest与containment，不硬链接、不删除Landing原件。Admin Web通过现有Integration路由配置和测试
Endpoint、API Key、请求根、整理根与ShelfDeck只读可见根；产品路径不再接受进程启动参数中的旧下载映射。

真实L07最终复用MoviePilot中已经完成的`The Wild Robot (2024)`精确任务和`download_hash`，测试脚本硬性禁止调用`/api/v1/download/add`，因此没有重新下载或创建第二个任务。产品链只通过Transfer History定位最终整理`dest`，随后完成planned restart、Resolve、Stability、Identity/Package Verify、Workspace Import、真实Probe、Package及open Offer。

最终fresh-clean证据位于`C:\Users\markm\AppData\Local\Temp\helix-real-libra-handoff-b-HmA51h`：总耗时607.681秒；Search 12.057秒、Request/既有任务采用14.085秒、Acquisition Observation 268.735秒、Stability 289.589秒、Workspace Import 341.676秒。`moviePilotDownloadAddCount=0`；Request、Acquisition Observation、Stability与Import的成功事实均各1份，planned restart后无重复外部请求、Import、Package或Offer。Landing原件与Workspace副本均为21,756,642,178 bytes、SHA-256 `fd725e36bc8f5fb5503cddba241d146353aba5a8b06e2b50c7f0c35dbe347468`，inode不同，证明是独立物理副本而非硬链接。真实输出为HEVC 4K + TrueHD，低于50 GiB Acceptance上限；`failedWorks=0`、`failedEvents=0`、Offer未消费、Arca Entry为0，数据库`integrity_check=ok`，Landing、Material Field与Shelf Reality不变。

该轮同时闭合了大文件External Landing观察的执行合同：External package完整SHA-256属于外部包完整性Evidence，不是Physical Material Identity的有界指纹；Acquire Observation和Stability必须同时取得Integration及Landing `volume_read` Permit，并使用有界长超时。原30秒timeout会在约4分钟checksum尚未完成时制造重试和重叠读取，现已修为30分钟硬上限并通过真实21.76 GB文件验证。

## Local media test boundary

用户于2026-08-11固定后续真实媒体测试范围：

- 可重复构建的主测试库：`C:\Users\markm\AppData\Local\Temp\ShelfDeck-P14-20260723\material-fields`；
- destructive Formation场景仍只允许在该主测试库或由它生成的独立系统Temp副本中执行；Material Field与Shelf Target必须明确配置到本轮隔离副本；
- 后续Libra、Arca及Movie E2E只能在隔离临时目录内实施，不得将`Z:\Film`配置为Material Field、Shelf、Workspace或Canary输入；用户随后分别授权测试库seed和真实Perception E2E从`Z:\Film`只读取材。本轮真实Perception E2E只复制两部有界普通媒体到新的Temp Field，复制前后逐项验证源size/mtime/ctime不变；仍禁止任何源端写入、移动、重命名或删除；
- 该目录已由`build-helix-movie-test-library.js`重新seed为可重复构建的Movie纵向验收库；正式manifest、受管路径、Reality digest和重建命令保存在`.shelfdeck-test-library`，历史非受管目录保持原样；
- 任何文件移动、替换、Settlement、On-deck或销毁验证都只能作用于上述已登记测试Scope；越出Scope立即停线。

该决定是本机测试环境与安全合同，不修改Architecture SSOT中Material Field、Shelf Target或Material Control的通用语义。

当前测试库包含12个既有Movie输入场景和10个Formation高风险场景。新增G01–G10分别覆盖existing Related replacement、
精确Settlement授权、逐成员崩溃恢复、Target collision、跨卷、Handoff后Related Reality变化、同根二次Observation、ISO、DVD以及
1,025项exclusive Related的complete-or-fail-closed边界。静态输入直接位于Material Field；碰撞与Reality mutation以受digest保护的
control seed保存，只能在manifest指定阶段物化；跨卷场景明确要求第二个本地filesystem root。每个destructive/fault-injection场景
必须先重建测试库且不得并发执行。素材和配方存在只代表测试前提完备，产品路径未接线的分支仍必须标为`contract_only|not_implemented`。

### Completed Routing test-set extension

Routing节点测试集已把主生产链与Sorting专项链分开：现有`test material field → movie test`继续作为direct路径，保证现有
Subject可以全部进入后续Acceptance Spec/Libra Production；另建不与其物理范围重叠的Sorting专用Material Field及三座拥有唯一Target
Folder、绑定同一Movie Rule Template的测试Shelf。Sorting happy-path使用真实电影标题及正式Evidence，至少固定以下预期：

| Input | Required Routing Fact | Expected target |
| --- | --- | --- |
| `顽主` | `release_year=1989` | 经典电影测试 |
| `爆弹` | `release_year=2025` | 新片测试 |
| `0.5毫米` | `release_year=2014` | 普通电影测试（显式最低优先级`always`规则） |

Policy顺序固定为`release_year <= 1999 → 经典电影测试`、`release_year >= 2020 → 新片测试`、`always → 普通电影测试`。
真实标题只用于用户可读核验，不得作为Routing条件或Provider ID；Routing必须消费带revision/digest的正式Decision Fact。

Sorting专用Field还必须增加两条无NFO边界：一部无NFO但能够通过正式Identity/Provider Evidence确定年份的电影，必须仅补齐Routing所需
`release_year`后正常命中；另一部无NFO且无法可靠解析Identity/年份的电影，必须保持`Routing Readiness unresolved`，高优先级规则结果为
`unknown`时不得越级进入catch-all。两者都不得在Routing阶段生成NFO、poster、完整Product Metadata、Libra Run或文件副作用。

## 0. Completed target — User Perception and Acceptance Spec Ready

本轮从resolved Routing Decision继续接通User Perception和immutable Acceptance Spec。评分只允许以Handoff A Accepted后的Subject或
Arca Shelf Entry为目标；Candidate仍是内部对象。用户评分与真实Douban同步统一经过`Acquisition Work → Normalize/Commit Event →
Resolution Work → Resolution Commit Event`，HTTP只签发Work并返回`202`。改分追加Correction/Supersedes Record，不修改旧Record。

Admin Web当前保持八个一级页面：“上架进度”按Subject提供1–5星控件，“我的收藏”按Shelf Entry提供同一控件；“系统设置”内部增加
`连接与集成|评分日志`Tab。评分日志是可分页、可筛选的只读Projection，不提供评分、修改或同步动作，也不展示Candidate。

Acceptance Spec链路固定为`Routing resolved → Perception Resolution terminal → Spec Preparation Work → Decision Basis Commit Event →
Acceptance Spec Publication Event`。Decision Basis冻结Shelf Standard、Routing Decision和Perception Resolution revision/digest；
`not_found`形成No-rating Spec，1–5星按Movie Rule Set形成不同Requirements。新评分只追加下一份合法Spec revision，不覆盖旧Spec，
本轮不创建Libra Run或Workspace。

真实本地E2E使用当前代码生成的fresh Routing事实和临时clean数据库，通过Admin产品入口测试/保存真实Douban连接并完成全部分页：
1546条Douban Record、104个Provider Acquisition Page，约107秒完成；Admin评分日志以16页读取1546个唯一Record。两部匿名普通媒体
从`Z:\Film`只读复制到隔离Field后，完成Procurement、Intake与direct Routing；匿名Subject `d76cdad1c520`和`62800f9c2a3f`
分别命中两个不同真实星级，形成两个不同Acceptance Requirements digest。直接评分及Correction又证明同一Subject的Spec revision
`1 → 2 → 3`且三份历史均保留。重启与相同sync idempotency key重放没有增加Acquisition、Work、Record、Resolution或Spec。

最终数据库保留于`C:\Users\markm\AppData\Local\Temp\helix-routing-decision-0bAMhK\data\shelfdeck.db`。当前机器合同为
112 Capability、98 Result family、180 table、43 Canonical Transaction、114 Admin route加1条public health（总计115 route）。
`failedWorks=0`、`failedEvents=0`；Libra Run、Workspace、Product Package、Handoff B/Arca Receipt及Shelf Entry全部为0。

下一独立节点只能是Libra Run Admission；若它要求改变已冻结的Perception Resolution、Spec、Execution Foundation或Procurement合同，
必须先返回Design，不得恢复旧`movie-formation-coordinator`捷径。

Libra Run Admission至Handoff B Ready的已确认验收场景基线固定在
`docs/helix/acceptance/LIBRA_HANDOFF_B_READY_SCENARIOS.md`；后续实施和封口必须逐项回填该文档的35个逻辑场景，
不得只以一条happy path产生Offer代替产品、Freshness、Related与crash-window验收。

## 0. Completed target — Libra Routing Decision Ready

本轮在Intake Accepted Subject之后接通正式`Routing Coordinator → Supporting Work → immutable Plan → Event Runtime → Capability`
路径。新增`libra.routing.fact.observe@1`只按当前Field Policy实际引用的Fact观察精确NFO或确定性TMDB测试Integration；NFO与Provider
是两个独立Work，不在Capability内部隐藏fallback。Coordinator只签发Work、读取terminal Result、调用pure Resolver及提交Owner事实，
未导入Capability实现、Dispatcher、Event Runtime或Resource Governor；历史大型`movie-formation-coordinator`的Routing捷径未进入产品路径。

Field Routing Policy现支持direct与1..64项sorting closed AST，三态`true|false|unknown`严格阻止高优先级unknown越级命中catch-all；
一次性手动选Shelf只为当前unresolved Subject形成immutable Decision，不修改长期Policy。Admin Web“文件来源”可预览/发布Policy，
按Fact类型提供Operator和值编辑、组合条件及rank上移/下移，不向普通用户暴露AST JSON；“上架进度”仍一行一个Subject，并展示准备
事实、unresolved/resolved、Policy revision、目标Shelf与Decision digest。

本机fresh-clean产品Composition Root E2E形成24个Subject：direct Field的19个全部命中`movie test`；sorting Field的4个按NFO或
deterministic TMDB Evidence命中经典/新片/普通Shelf，1个Provider `not_found`保持unresolved且未命中always，随后通过Admin入口
一次性选择普通Shelf。共29个Routing Work、5个Fact Event和24个Decision Basis Commit Event全部成功；Acceptance Spec、Libra Run、
Workspace和Arca Shelf Entry均为0。下一独立节点是Acceptance Spec，不能在其门禁打开前进入Production。

补充的真实外部资格验证已于2026-08-12完成：显式脚本`npm run test:helix-routing-real`要求调用者提供隔离Temp MKV与本机私有
TMDB credential，经Admin产品入口配置真实Integration，禁止注入fake Provider Adapter。无NFO的`The Shawshank Redemption`由真实
TMDB唯一解析为ID `278`、年份1994并自动命中经典Shelf；重启后没有重复事实。另一个真实标题`Fight Club`因2个同名候选保持
`ambiguous/unresolved`，证明系统没有选择搜索结果第一项。该外部脚本不进入默认离线测试套件，也不得把credential写入代码、日志或文档。

## 0. Completed target — Arca Shelf Configuration Ready for Libra

本轮在不进入Handoff B、On-deck或文件副作用的前提下，完成第一座可由Libra公开读取的active Shelf。首次创建Command必须探测唯一
Shelf Physical Target Folder、读取`system-beta-recommended`的精确active revision、由Arca生成effective Shelf Standard和Placement
revision 1，并原子发布Shelf Routing Target Projection；Admin Web不得提交自行展开的Standard。

Admin Web“收藏架”从静态Stub改为真实配置页：列出Shelf与Rule Template、创建Shelf、选择推荐Template、配置Target Folder和Movie
Placement，并展示Movie No-rating及1–5星Standard。系统Template仍包含四组Profile Rule Set且保持只读；M1只展示和消费Movie部分。

验收只使用本机Node.js、临时clean数据库和临时空Target Folder。必须证明Target探测失败不留半成品、创建命令幂等、重启后事实与
Projection逐字一致、Libra只能通过Arca public projection读取Shelf及Standard、Target目录内容不变。完成状态只能标记为
`ARCA SHELF CONFIGURATION READY FOR LIBRA`；Libra-owned Field→Shelf Routing Policy属于下一独立目标。

2026-08-11，本目标已通过本地Node.js、临时clean数据库和临时Target Folder完成验收。下一目标仍是Libra-owned
Field→Shelf Routing Policy及Handoff A Routing Decision/Acceptance Spec；它尚未获得Implementation Gate，不能在本轮顺带实现。

## 0. Completed target — Libra Intake Acceptance and Formation list

本轮只打开Handoff A之后的第一个Libra节点。Procurement发布的Candidate Offer由durable Outbox Dispatcher交给Libra
Intake Coordinator；Coordinator只签发Supporting Work并读取terminal Work Result。Candidate、Material、Binding及continuity验证均由
Planner展开为immutable Plan，再由Event Runtime执行正式Intake Capability。Accepted commit在一个原子事务中建立或延续Subject、写入
Libra Material Binding、接收Receipt和Control连续性，并向Procurement发布accepted结果；拒绝路径保持独立typed Decision和Receipt。

Admin Web“上架进度”已接入真实Formation Projection，固定一行一个Subject。当前节点只显示Intake已经接收、但尚未完成Shelf Routing的
Subject，因此状态为`awaiting_destination`；页面不会把Work、Event或一次Run展示成独立用户条目。历史大型Libra Coordinator没有进入该
产品路径，也没有被复用为同步执行捷径。

本地Node.js clean Canary使用唯一隔离测试根完成：1,140个regular files、5个Observation Page、1个sealed Procurement Run、19个
Candidate/Offer全部被Libra正式接收，形成19个Subject和19个accepted Intake；其中G08/G09分别以正式typed topology形成`iso`与`dvd`
输入，DVD Manifest包含1个`primary_payload`及4个`structural_dependency`。唯一G10超大Related场景在Procurement按业务合同
`candidate_disposition_scope_unrepresentable`收口，不产生Candidate，不属于Foundation技术失败。测试主动重启后未重复Observation、
Candidate、Offer、Intake或Subject；源Reality前后一致，Libra Run/Workspace、Handoff B及Arca媒体事实均为0。

本轮完成状态为`LIBRA INTAKE ACCEPTANCE READY / AWAITING ROUTING`。下一独立目标是Libra-owned Field→Shelf Routing Policy、Routing
Decision及Acceptance Spec；不得在未显式开放门禁前签发Libra Production Run或产生Workspace/文件副作用。

## 0. Closure — Movie Procurement at Handoff A Ready

2026-08-11，用户在审阅最新全库Canary、性能分段对账和Candidate抽样结果后接受Movie Procurement封口。当前活动改造已经完成，
封口内容为：Observation事实、增量Eligibility、Selection Scope、Run Admission、Foundation三层执行链、Movie Triage、BDMV Assessment、
Related重建、Candidate Assembly、Candidate Package与open Handoff A Offer。Series、JAV、Western Adult以及Handoff A之后的Libra Intake
均不属于本次完成声明。

后续若进入Movie Libra，应作为新的、可验证目标单独打开Implementation Gate；只能消费当前正式Handoff A合同，不得反向修改已经封口的
Procurement或Execution Foundation语义来迁就Libra实现。当前线程在未获得新的明确实施指令前停在该边界。

## 0.1 Completed amendment — Mixed Movie Field and unified Run bound

本轮基于`bd6a0d2c`把Movie Field的pre-triage Selection正式统一为三类持久Scope：Field根目录中的每个普通文件分别形成
`standalone_file`，非BDMV材料按Field根目录下第一级目录形成`ordinary_directory`，BDMV及同级`CERTIFICATE`形成
`bdmv_container`。Run Creator只消费terminal Observation形成的冻结Scope，按canonical UTF-8顺序装箱；Run与任一不可拆分
Scope的唯一业务上限都是1024个selected Physical Material。Related Material既不进入Selection，也不计入该上限。

Planner、Structure及Candidate Context直接消费已Admission的Scope事实，不再重新猜目录类别。标题规则固定为：standalone取文件
stem；单电影ordinary directory取目录名；多电影ordinary directory分别取对应文件stem；BDMV取容器目录名，Field根直接放置的
BDMV使用稳定临时标签。Related在Candidate Assembly中只查询冻结Observation的当前Scope并按standalone、单电影目录、多电影目录、
BDMV外部目录四种association mode重建，Structure不访问NAS且不内联大型Related数组。

正式合同为111 Capability、97 Result family、180 table及43 Canonical Transaction；Run/Scope/Retry/Manifest/Handoff的物理成员
上限统一为1024。Observation Page与Eligibility批次保持256，Probe批次保持100，Execution Runtime保持16个in-flight Event；本轮
没有修改Scheduler、Event Runtime、Resource Governor、Permit、Retry或Result Binding语义。

### Full Canary result and bounded performance return

第一次全库复验使用新的临时clean数据库和只读`Z:\Film`完成。实际源为18,409个regular files（用户新增`苹果.mkv`及其
`苹果.nfo`），不是计划假设的18,408。正确性全部通过：72个Observation Page、922个Selection Scope、8,627个selected
Physical Material、10/10 Run Seal、943个Candidate Package/943个open Handoff A Offer；`苹果.mkv`形成唯一
`standalone_file` Candidate，display identity为`苹果`、`materialInputForm=stream_file`、Primary Manifest只有自身，Related只有
`苹果.nfo`。源Reality前后一致，0 duplicate Selection、0 failed Work/Event、0 Resource defer、Libra/Arca为0且Offer未消费。

该轮性能未通过15%红线：首个Offer 163.385秒、全部Run Seal 445.122秒、总耗时451.260秒。资产保留于
`C:\Users\markm\AppData\Local\Temp\helix-full-movie-canary-0af0uA`。诊断确认主要放大来自Candidate Manifest与Context对每个
Candidate复制/读取整个1024成员Run，以及Coordinator在每次terminal Work后重复扫描旧Work/Package；不是Foundation状态机问题。

修正后，Manifest只接收当前Candidate的精确成员，Candidate Context只查询当前Unit/Scope，Triage Evidence Index按确定性ordinal
O(1)定位，Coordinator用O(log N)幂等Work存在性探测并只在Seal前执行完整集合核验。产品Composition Root的1000 Candidate压力
fixture已形成1000个Candidate/Offer、最大open Work 33、0失败；`npm run test:helix-procurement`及`npm test`均通过。

用户明确授权后，第二次全库复验已使用新的Temp clean数据库完成。正确性仍全部通过，资产保留于
`C:\Users\markm\AppData\Local\Temp\helix-full-movie-canary-Ovor6i`。Candidate修正被真实数据验证：Manifest累计耗时从
90.043秒降至16.335秒，首个Offer到全部Run Seal的尾段从281.737秒降至173.523秒，改善约38.4%。

整轮绝对性能仍未过原红线：首个Offer 256.578秒、全部Run Seal 430.101秒、总耗时435.806秒。与第一次混乱Field Canary相比，
Observation Capability累计耗时从42.320秒升至111.266秒，普通Media Probe从83.173秒升至122.758秒；上游source-dependent
阶段的本轮波动掩盖了Candidate收益。该绝对耗时继续作为原始Evidence保留；用户已将其确认为环境波动并接受正确性与Candidate阶段
性能证据，因此不再阻断Movie Procurement封口。不得通过修改Candidate或Foundation去“修复”该环境波动，也不自动第三次读取全库。

## 0.1 Current amendment — Observation facts and incremental Eligibility

本轮废止“仅改Observation存储”的上一版计划，先修改唯一Architecture SSOT，再实现并验证两个相互关联的收敛点：

- Observation明细永久写入Procurement-owned `proc_field_observation_entries`；Page JSON只保存游标、数量、边界digest、page/fact digest和commit marker。一个Page Event最多提交256个文件、物理读取最多64 MiB，每个Physical Material指纹读取最多262,144 bytes。独立Layout Capability/Event/Result废止，Layout只作为冻结Observation entries上的技术Projection。
- Eligibility仍是`proc_field_materials`上的当前Decision Projection。全局Observation head推进不再使全部Material失效；Reconcile只接收新、Reality/Binding/位置变化、missing、unknown/basis失效，以及Field/Access/Policy/Selection/Reservation/Control影响的有界Material Key Change Set。未变化Material不执行Eligibility SQL UPDATE、不递增revision。

本轮不新增Eligibility历史表、Capability、Result family、Admin route或业务对象；当前clean合同为111 Capability、97 Result family、180 table、43 Canonical Transaction。验证顺序固定为：合同/Schema → Observation幂等与批次边界 → 18,000项Eligibility写放大fixture → Procurement回归 → 本地只读`Z:\\Film`全量Canary。上述门禁已全部完成；本轮不进入Docker、NAS、Libra或Arca。

### 0.1 Current amendment — BDMV Assessment and Scope Reference

BDMV不再为每个物理成员建立通用Media Probe Event。每个BDMV容器只签发一个`procurement.triage.bdmv.assess@1`，在一次受控调用中完成有限Playlist/Clip拓扑解析、确定性主标题选择和选定主标题M2TS的bounded metadata probe；不读取完整M2TS、不计算全文件Hash、不嵌套调用Event Runtime。普通媒体仍使用`shared.material.media.probe@1`。

Structure只消费durable `BdmvAssessmentEvidence@1`并输出紧凑`UnitScopeReference`；Candidate Context按冻结Run、Observation和Assessment facts重建主载荷与对应结构依赖。BDMV容器的全部物理成员仍作为不可拆分Scope参与Run Admission（最多1024），但不塞入Plan或Structure Result；未选中的M2TS/CLIPINF不进入Candidate或Related。

### 0.2 Final evidence — 2026-08-10 local full Canary

本轮使用本机Node.js、系统Temp下的clean数据库和只读`Z:\\Film`完成最终Canary：

- sourceBefore/sourceAfter均为18,407个regular files，digest均为`a630ecf5b86c0da2541b5e53fae2bc6e5aa8d28fd181b7d6ce6c770042eb316d`；数据库`integrity_check=ok`。
- Observation为72页、18,407条entry；每文件只读取一次中段指纹，逻辑读取`1,776,608,472` bytes，未超过`18,407 × 262,144`上限；主动重启后未重读已提交页。
- 增量Eligibility首轮实际`eligibilityDecisionWrites=18,407`、`reconcileBatchCount=185`；Observation完成后的后续Triage没有增加Eligibility写入；完全相同Observation的0写入由专项fixture覆盖。
- 创建12个并存Run并全部Seal；955个Work、1,080个Plan、3,926个Event/Attempt/Result全部成功；942个Candidate Package与942个open Handoff A Offer，Related Reference共122份。
- BDMV容器共59个，全部Assessment为`resolved`；产生59个BDMV Structure Unit/Candidate，普通Candidate为883个。通用Media Probe共884个，BDMV内部成员通用Probe为0；没有STREAM标题Candidate。
- `failedWorks=0`、`failedEvents=0`、`resourceDefers=0`、RSS峰值约0.78 GiB；数据库`integrity_check=ok`。Related数据库审计未发现BDMV内部路径或视频载荷（包括`.m2ts`）被误记为Related；Offer未消费，Libra/Arca事实为0，源文件无写入/移动/删除/重命名。
- 总耗时约5分42秒；Observation terminal后首个Structure约131秒、首个Candidate/Offer约142秒、全部Run Seal约5分36秒。Scope成员路径归一化改为每个Run Basis只做一次，避免大BDMV Candidate Context的平方级重复扫描。临时资产保留于`C:\\Users\\markm\\AppData\\Local\\Temp\\helix-full-movie-canary-VFP6wA`；此前Canary资产未删除。

本证据将Execution Foundation与Procurement本地验证状态更新为`CLOSED FOR DOMAIN ONBOARDING`。后续Libra/Arca接入若要求改变Foundation状态机、Permit、Result Binding、Reconcile或backpressure语义，必须返回Design。

## 0. Active implementation checkpoints

本轮在已经恢复的`Run → Work → Event`产品路径上正式封闭Execution Foundation的设计与实现接口；不回退Mirex，不重建骨架，
不进入Libra或Arca：

1. **SSOT封闭**：明确Event有界并发、`maxInFlightEvents=16`、typed Resource Key、精确Process reconcile、30秒fallback sweep、
   Domain Execution Projection及soft/hard cap语义；新增`fx_reconcile_cursors`，当前Observation事实表改造后的clean table总数为180。
2. **产品接线修复**：Runtime Host有界启动多个Event；Resource Governor逐Event原子发放Permit bundle；Scheduler、Work Supply与
   waiter遵守同一Domain Execution Projection；删除每Event全Run扫描及整Field Triage读取。
3. **Foundation封口验证**：以产品Composition Root覆盖并发、Permit、immutable Plan、Result Binding、terminal aggregation、
   205个Process三页cursor恢复、lost wake、retry/defer/timeout及七类Effect crash window。
4. **Procurement压力回归**：以260个Candidate需求证明hard cap有界、completion持续产出、Package/Offer早于全部Run Seal，且
   Coordinator不执行Capability、不做整Field读取。
5. **最终全库Canary与封口**：本地Node.js在新的系统Temp clean数据库上运行`Z:\Film`只读Canary；主动重启后从同一
   durable数据库恢复，未重扫Observation。最终12/12 Run Seal、942 Candidate Package/942 open Handoff A Offer、
   `failedWorks=0`、`failedEvents=0`、源Reality前后一致、Libra/Arca为0，已改为`CLOSED FOR DOMAIN ONBOARDING`。

Checkpoint 1–5的实现与本地fixture已经完成；Layout Snapshot及Triage Unit/Candidate Context改造的Node回归和Procurement压力fixture已通过；全量真实Canary已完成。运行边界固定为本机Node.js、临时clean数据库和
只读媒体源；不使用Docker、不部署NAS、不消费Handoff A Offer、不进入Libra或Arca。

Physical Material Identity不承担NAS字节完整性证明。所有Physical Material统一使用`middle-256k-sha256`：读取正中间最多
262,144 bytes并执行前后stat fence；禁止首次登记、Control、Binding或Effect Fence触发全文件Hash。Artifact、Canonical JSON和
事务Evidence的SHA-256保持不变。当前本地数据库不迁移Identity v1，也不保留alias、fallback或dual contract。

2026-08-09 Layout性能修订：唯一SSOT已补充Field Observation Layout Snapshot合同。Observation terminal后生成可复用的
profile-neutral目录索引；Evidence Assessment按唯一直接父目录规划Layout Event，Triage Layout只读取Snapshot，不再
执行NAS `readdir`或相关文件指纹读取。Media Probe仍保持为独立Event并只对Run Selection访问源文件。

2026-08-10 BDMV拓扑边界已确认并完成实现：BDMV不是pre-triage的`movie`类别，
而是Run Creator使用的不可拆分container group。最近`BDMV`祖先目录下的全部terminal Observation成员必须进入同一Run，
完整group可以与其他group按稳定顺序装入同一Run，单个group超过256项时整体不建Run。Structure只消费完整group，
解析Playlist、Clip与结构依赖并形成单标题Triage Unit；BDMV内部成员不得各自形成Candidate，多标题/歧义/不完整保持
`not_ready`。Run Admission不得等待Structure发现依赖后再静默扩张；所需结构成员必须在Admission前完成Observation、
Eligibility和Control。当前实现新增正式`procurement.triage.bdmv.assess@1`、`BdmvAssessmentEvidence@1`及
`BdmvAssessmentInput@1`，Scope Reference为运行时可重建引用，不新增表或业务Domain。

当前产品压力证据为260个Movie Primary、2个并存Run：260份Candidate Assembly Work最终形成260个Package和260个open
Handoff A Offer，全部Run Seal，零failed Work/Event；开放Work从未突破256。全链由产品Composition Root中的Scheduler、
Event Runtime及typed Resource Governor推进；没有Coordinator直接执行Capability的路径。

此前同步Coordinator路径完成的单Movie Canary保留为低层Capability和Owner事实的诊断证据，但它绕过了产品形态的Work Scheduler、
Event Runtime与Resource Governor，因此自本计划起不再作为有效Foundation E2E或Handoff A Ready E2E验收证据。

## 1. Role and authority

本文是唯一Helix Master Plan，只维护：

- clean-cut总决策；
- P0–P13 Phase顺序、依赖和Exit Gate；
- 当前Phase指针；
- 授权边界和下一动作。

架构只由`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`定义；工程过程只由`ENGINEERING_PLAYBOOK.md`定义；当前Phase的
Work Package细节只存在于`implementation/CURRENT_PHASE.md`；当前事实只由`CURRENT_STATUS.md`报告。

本文不复制Phase执行细节，也不保存已完成审计全文。

## 2. Accepted implementation decision

采用：

> 新`media-service/src/helix/`完整重建clean业务核心和产品表面；旧实现逐函数取证复用；完整验证后一次性切换
> Composition Root；不在旧Libra/Nexora/Kairox/Task主路径上增量改造。

固定边界：

- 五个一级Business Domain为Procurement、Libra、Arca、User Perception、People Management；
- Collection Formation只有Procurement→Libra和Libra→Arca两次单向Handoff；
- 一个`data/shelfdeck.db`不等于共享Store；Repository和Fact Owner保持隔离；
- clean schema不迁移旧Runtime事实，不dual-read/write/run，不保留旧fallback；
- 62个旧业务executor中0个可整体复制；复用只限登记后的pure/protocol/FFmpeg/file-transaction原子；
- 完整clean root切换前只允许isolated fixture，不形成混合可运行产品；
- `media-desktop`不属于本轮范围。

实现差距基线和处置Evidence见
`implementation/evidence/IMPLEMENTATION_GAP_AUDIT_4a16f0a9.md`。

`PBF-10-R1`只闭合Candidate Publication的机器事务表集：7张Procurement domain表（含
`proc_candidate_primary_material_episode_claims`）与3张Foundation表构成精确10张`writeTables`；不改变Domain、Owner、
Store、Handoff或Capability；PBF-11后当前关系表总数为168张。

`PBF-10-R2`进一步固定Package-derived `CandidateIntakeAcceptanceBasis@1`、stable Offer ID、typed Offer Outbox
message/consumer/dedup合同，并把Season Continuity Claim全链路统一为
`provider_season_identity|triage_grouping_lineage`；同样不扩大任何Owner或物理边界。

`PBF-10-R3`把承载Run `candidate_package_revision_head` CAS的既有`proc_procurement_runs`补入Candidate
Publication domain write participant；最终机器事务固定为8张Procurement、3张Foundation及11张write table，
同时保留Run表为CAS fence read，不改变Owner、Store、Handoff或Capability。

`PBF-11`闭合Candidate Delivery typed snapshot、Libra-owned continuity resolution、N:M Episode/Binding关系、
global/target CAS、Resolved Identity exact Claim关系化、nullable identity初值及Handoff A完整Accepted事务。
它新增五张Libra Intake关系/头表，使总数调整为168；不新增Domain、Owner、Store、Handoff或Capability。

`PBF-11-R1`扩充既有`proc_candidate_related_references`，逐列保存完整Physical Identity、association Evidence和
reference digest，使Candidate/Run/Offer关闭后仍能由Procurement Owner rows历史重建完整Package与Delivery Snapshot；
不新增表、Owner、Store、Handoff或Capability，168-table inventory保持不变。

`PBF-11-R2`与`PBF-11-R2-R1`把Handoff A Rejected闭合为独立typed Decision、Reason/Evidence、Receipt、Outbox及
Procurement consume，并恢复Accepted Receipt的唯一scope digest；同时分离Handoff A富拒绝与Handoff B通用拒绝，
完整闭合Arca rejected持久化连续性。关系表调整为169，Catalog Result family调整为97。

`PBF-11-R2-R2`明确区分append-only row与CAS lifecycle row：`proc_candidate_deliveries`仅允许一次
`open → accepted|rejected`，`proc_run_materials`只允许合同列出的Reservation转换；Accepted/Rejected consume均从
terminal Owner rows重建并使用同一原子性、Evidence与幂等纪律。不新增Domain、Owner、Store、Handoff、Capability或表。

`PBF-11-R3`固定Handoff A Accepted Control revision set的成员、排序、JCS公式、Payload/Commit Handle绑定及
historical Control reconstruction；保持112项Capability、97个Catalog Result family、169张关系表和15表事务边界不变。

`PBF-12`闭合Libra Routing、Decision Basis与Acceptance Spec的typed input/output、唯一ID/digest、revision/head CAS、
Subject Field/profile provenance、Product Scope、Arca只读Projection freshness及三项canonical transaction。它不新增
Domain、Owner、Store、Handoff、Capability或关系表；保持112项Capability、97个Catalog Result family和169张表，
Canonical Transaction由35项增至38项。

`PBF-12-R1`把pre-CAS `SubjectDecisionHeadSnapshot@1`补入既有Decision Basis input relation，并在Basis row/result
冻结expected revision与snapshot digest；历史Input Set可只由Libra Owner rows重建。它不改变Domain、Owner、Store、
Handoff、Capability、Result family、表或Canonical Transaction计数。

`PBF-13`闭合Libra生产后半链的Run Admission/Lifecycle、immutable Production Material与N:M Episode scope、
Workspace admission/reference、完整On-deck Product Package、Discard/Cleanup及Off-load Completion Reclaimer连续性。
新增七张Libra-owned关系表和五项Canonical Transaction；当前合同为112 Capability、97 Catalog Result family、
176 tables、43 Canonical Transactions，未新增Domain、Owner、Store、Handoff、Capability或用户业务决策。

## 3. Current phase

| Field | Current value |
| --- | --- |
| Phase | P13 — Operational cutover and E2E-ready package |
| Detailed packet | `implementation/CURRENT_PHASE.md` |
| Status | P13 complete；final Implementation Contract Baseline and E2E-ready package frozen |
| Implementation baseline | P13 implementation closure `bd75e7e4`；product surface `23e3b930` |
| Phase branch/worktree | `codex/helix-p9` / `E:\my_project\emby_third_party-helix-p9` |
| Allowed now | 本实施线程停止；不得进入P14、E2E或部署 |
| Next action | 独立P14资格验收任务消费冻结package；需用户单独授权 |

## 4. Master roadmap

| Phase | Outcome | Dependencies | Exit Gate summary |
| --- | --- | --- | --- |
| P0 Audit and disposition | `4a16f0a9`差距、旧模块处置、风险和clean-cut方向 | Level 0–10 accepted | **complete**；Evidence已冻结 |
| P1 Clean skeleton and guards | 固定`src/helix/`、public/internal边界、唯一Root shell、机器架构门禁和manifest框架 | P0；Local Implementation Gate | **complete**；Exit Audit PASS；Evidence frozen |
| P2 Contract and schema baseline | 112 Capability、96 Result、161 table合同与digest | P1 | **complete**；latest SSOT rematerialized 112/96/161/26；baseline gate PASS |
| P3 Persistence and atomic foundation | 唯一Kernel、scoped UoW、Control、Commit Marker、Outbox/Inbox、Audit | P2 | **complete**；26 canonical transactions；baseline gate PASS |
| P4 Execution and recovery foundation | Work/Plan/Event/Effect、Progress、Control Plane、Resource、Retry/Timeout/Circuit、startup recovery | P3 | **complete**；7 Effect Classes / 31 crash scenarios；Exit Audit PASS |
| P5 Platform and integrations | Secret/Mount/Workspace/Artifact/Resource/Worker及typed Provider/FFmpeg/file libraries | P3–P4 ports | **complete**；10 fixture families / 31 recovery scenarios；Exit Audit PASS |
| P6 Horizontal domains | Perception和People独立Store/Facade/Process/Projection | P3–P5 | **complete**；Exit Audit PASS；两域Owner与cross-domain边界闭合 |
| P7 Procurement | Material Field、Observation、Region、Triage、Candidate Package | P3–P5 | **complete**；Exit Audit PASS；15表/8 Capability与Candidate原子性闭合 |
| P8 Handoff A and Libra front half | Handoff A、FA-04 continuity、Subject、Decision、Routing、Acceptance Spec | P6–P7 | **complete**；原子连续性和Exit Audit PASS |
| P9 Libra production and delivery | Run、Workspace、Product、Conformance、On-deck Package、Discard/Cleanup/Reclaimer | P4–P5、P8 | **complete**；baseline frozen |
| P10 Handoff B and On-deck | Shelf/Standard/Placement、Acceptance、Custody、Off-load、Inventory、Shelf Entry、Deck | P5、P9 | **complete**；Exit Audit PASS |
| P11 Arca post-deck | Aftercare、Off-deck、Shelf Deregistration | P10 | **complete**；baseline frozen |
| P12 Product surface | Projection/Activity、Facade、113 Admin route、Session/Auth、九页Admin Web | P6–P11 | **complete**；114 route、18 surface、build/tests PASS |
| P13 Operational cutover and E2E-ready package | clean init/backup/restore/Safety、readiness；Root/API/UI一次切换；旧路径退役；冻结独立E2E任务可直接消费的版本化交付包 | P2–P12 | **complete**；local gates PASS；package frozen |

P1–P13是本线程的完整逻辑实施Phase，不是版本名或自动部署节点。P13 Exit Audit PASS且E2E-ready package冻结后，
本线程的Helix开发任务即完成。

## 5. Hard dependency invariants

~~~text
P1 package/guards
  → P2 contracts/schema
  → P3 atomic persistence
  → P4 execution/recovery
  → P5 platform/integration substrate
  → P6/P7 horizontal domains and Procurement
  → P8/P9 Handoff A and Libra
  → P10/P11 Handoff B, Arca and post-deck
  → P12 Projection/API/Admin Web
  → P13 operational cutover and E2E-ready package
~~~

禁止以以下方式缩短依赖链：

- 新Procurement接旧Membership；
- 新Libra写旧`media_items`或Kairox Store；
- 新Event Runtime驱动旧executor；
- 新Admin Web调用旧Task/Library route；
- clean database回退旧Service；
- 先做Material副作用、后补Control/Effect recovery。

## 6. Phase planning and transition

- 任意时刻只有`implementation/CURRENT_PHASE.md`一份活动详细执行包；
- 只细化当前Phase，后续Phase维持Outcome/Dependency/Exit Gate级别；
- 当前Phase全部Work Package满足Done并通过独立Exit Audit后，执行包移动到`implementation/archive/`；
- Evidence冻结并由`CURRENT_STATUS.md`链接后，才细化下一Phase；
- Phase完成不自动打开下一类环境授权；
- blocking架构缺口返回Design，不以兼容层、temporary Store或silent fallback解决。

详细Ready/Done、Review、Reuse、Git/worktree和停线规则见`ENGINEERING_PLAYBOOK.md`。

## 7. Authorization boundaries

用户已授予P2–P13第1层`Local implementation` standing authorization。每个Phase在SSOT traceability、机器反例和
Exit Audit全部PASS后可以自动归档并进入下一Phase，不需要逐Phase等待：

1. Local implementation：本地代码、单元/合同/隔离fixture；
2. Real-source E2E：明确来源和副作用范围；
3. Build/Canary：明确Artifact和环境；
4. Production：明确发布/部署/升级动作。

Standing authorization不授权下一层。E2E、Docker/Canary、NAS、生产和真实媒体副作用保持暂停，
`media-desktop`保持排除。

## 8. Post-program independent tasks

P13之后的外部验证与发布工作不属于本Helix实施Program，也不作为本线程完成条件：

1. **Independent E2E qualification task**：从P13冻结的E2E-ready package开始，按单独授权执行真实来源、真实媒体副作用、
   Windows/Linux/Docker及必要的Canary验证；发现实现缺陷时形成可复现Problem Report并返回对应开发范围修复，发现SSOT冲突时
   返回Architecture Agent；不得在验收任务加入兼容层或旧Runtime fallback。
2. **Independent deployment task**：只消费已经通过独立E2E验收的精确Artifact，按单独生产授权完成镜像身份、SHA256、dry run、
   NAS部署、health/readiness与发布观察；不得把部署修补反向变成业务架构或运行时兼容路径。

两项任务必须使用P13冻结的commit、package manifest和digest建立可追溯交接。E2E验收任务与部署任务彼此独立；部署任务不得在
缺少对应E2E PASS Evidence时开始。

## 9. Business decision handling

只有改变用户真实意图、可见业务结果、不可逆Authorization、Business Domain/Owner/Handoff或Object continuity的
问题才提交用户。包结构、代码组织、测试工具、manifest格式、SQL实现和性能优化由工程内部在SSOT边界内决定。

当前没有open business decision。工程问题由Codex自主处理；只有真实业务决策或SSOT冲突才向用户提问。
