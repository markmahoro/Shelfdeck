# ShelfDeck Clean Helix Current Status

Status: Movie Procurement与Movie Libra封口保持有效；Movie Arca已完成Handoff B Acceptance、On-deck、Shelf Entry、Deck Fact、Beta Aftercare、Off-deck及Shelf Deregistration完整闭环。当前精确状态为`MOVIE COLLECTION LIFECYCLE READY THROUGH SHELF DEREGISTRATION`；本地Movie生命周期已经最终封口，生产部署尚未开始。

Last updated: 2026-08-22

## 0. Current operational status — clean Movie Canary Admin Web UAT in progress

用户已明确授权在修复后重建干净 Movie Canary 真实 Admin Web E2E/UAT。固定路径仍为只读
`F:\test_film`与重置后的`F:\canary`。不触碰`G:\canary_film`、`Z:\Film`或NAS生产部署。
当前代码含 UAT-044：四星体积转码只为将 copy 的音轨留预算；P2 aggregate 为
`8ef344678720478f59fef4a20d61edb6d157ba22cca9cc4caa1f44e8edb25e59`。冻结 Run 不可重放，BDMV 养蜂人需干净 Canary 确认。

| 项目 | 当前状态 |
| --- | --- |
| 基线 | `F:\test_film` 22/455/42 / 143,829,090,011 bytes |
| Canary | 已清空后从基线 `robocopy /E` 重建；路径/大小/mtime 零差异；未使用`/MIR` `/MOVE` `/PURGE` |
| 隔离库 | `C:\Users\markm\AppData\Local\Temp\ShelfDeck-Movie-Canary-UAT-20260822-042527-2da763653` |
| Copy-forward | Douban/TMDB/MoviePilot 3 个 active Integration；1547 条 Douban Record；0 旧 Field/Shelf/Run/Entry |
| 服务 | PID 37740；`127.0.0.1:18080`；`helix-clean-v3`；`normalSupplyAllowed=true` |
| Admin Web | 8 个正式页面首次打开与直接刷新均成功；Field/Shelf 均为 Movie Canary → `F:\canary` |
| Routing | Direct → Movie Canary Policy revision 1 已从页面发布 |
| Observation | 已从页面触发；Observation revision 2；ISO 已 Handoff A Accepted |
| Formation | 23 Candidate / 23 Subject。作业方法已纠正：不再空等 23 部 completed |

2026-08-22 用户确认：成功标准旧稿把 `养蜂人` 顶层目录写成一部 Movie 是错误的。现成 MKV 与嵌套 BDMV 是两部独立电影，必须都形成 Subject 并都能 On-deck；内容去重属于 Arca Duplicate/Off-deck，不是 Formation 或 Placement 的拦截理由。基线仍是 22 个顶层单元，形成口径 23/23。五星无合格 4K 源的产品不可达是合法冻结，不能当作监测 DONE，也不能把监测做成挂机。本轮可关闭的上架账是：合同允许上架的都已 On-deck，其余只允许是该合法冻结，产品阻塞必须清零。详见台账 §1.2。

当前隔离库尚未按纠正后的方法收口。独立 OPEN 项仍见台账 UAT-035/037/038。

## 0. UAT repair status — UAT-005 / UAT-018 implemented, fresh Canary qualification pending

Formation不再把Product Package published当成“已完成整理”，也不再从历史Production成功推导永久`in_progress`。
新的四桶Classification为`pending | in_progress | attention_required | completed`：完成必须同时重建Arca On-deck Commit、
Shelf Entry、对应active Deck Fact及非空Related Disposition completion；技术失败、blocked、suspended、frozen和合法身份确认
进入“需要处理”；整理中只表示当前仍有可推进责任。Arca Commit后会精确唤醒对应Subject Projection，30秒有界Sweep仍作为
丢失wake的恢复路径。

Admin Web顶部增加“需要处理”，列表增加“当前状态”列；Discard Receipt通过独立有界历史查询显示“已结束 · 用户放弃”，
不进入当前四桶，也不复制Subject行。专项Formation、Arca completion、Admin Web和clean schema migration回归22/22通过，
包含真实Routing链路的最终相关回归19/19通过；完整Architecture Gate（166个test file）、P3 Persistence Gate及
Admin Web production build均通过。当前P2 aggregate为`68db5920cff98cc4dbc0751f0faa82162089b152971b590cf6db331d46dce78b`；
P3 DDL digest为`2347c196743124bbb2e768c7b829012049310484b7cd4e49a00182c9d45f09d5`，table contract aggregate为
`9aa8c8710b1bdc99e4d16a88c4e354526b1a7846fb4d85d528ccaa75192e6f7f`。

本批次没有启动服务、没有读取或修改任何Canary目录。UAT-005/UAT-018代码修复完成但继续保持OPEN，等待明确授权后的
真实Admin Web与新Canary验证。

## 0. UAT repair status — UAT-020 implementation complete, fresh Canary qualification pending

Placement revision现冻结目录及五类Movie成员命名模板；Admin Web允许用户在创建Shelf时配置全部规则并在保存前预览。
Arca Final Inventory Decision不再只保存opaque member ref，而是逐项冻结来源Material、role、最终文件名、endpoint与location。
隔离`老笠 (2016)`同型回归已证明hash、`(0)`、`transcode-*`、artifact internal ID不会进入目录、视频、NFO、字幕或Artwork名称。
当前机器合同仍为113 Capability、99 Result family、117 Domain Input、184 table、44 Canonical Transaction、118 route；
P2 aggregate更新为`118a009d1d5e6d9597d0111b5546c2141e5ecde9859d7eb98c5ec07439e320ae`。专项文件效果回归通过；
完整Architecture Gate为166个test file、1094 pass、7个显式skip、0 fail，Admin Web production build通过。

第二独立修复包已覆盖`carried_forward + replace_or_move`及`replaced_and_settled + remove_after_place`，Final验证先于旧Input
Settlement；同路径生成no-op Evidence，不同路径只删除精确受管文件。On-deck Commit逐项重建Disposition completion并要求非空
`related_disposition_completion_digest`；未知目录成员在任何删除前转为失败，旧目录只在精确为空且不是Shelf Target根目录时删除。
Aftercare现把初始Custody Binding纳入Known Bindings与Conformance，只有旧Identity可验证且唯一对应当前Final字节时才允许随
Placement Case结算；其余状态为`attention_required`。Handoff B Binding现持久化完整Physical Identity tuple，Aftercare不再用
当前Shelf mount scope猜测旧Identity。隔离回归覆盖不同路径、空目录、未知成员及旧Binding身份漂移。P3 persistence gate通过，
DDL digest为`c5d9640055e8a7805791bf4a54539fc2b4325403c8ba797b7368245dc5a75d9b`。

本批次没有访问或修改旧Canary现场，也没有启动服务。UAT-020代码修复完成但整体仍保持OPEN，等待用户明确授权后由新Canary和
真实Admin Web验证唯一物理现实。

## 0. UAT repair status — UAT-019 implemented, fresh Canary qualification pending

Arca Acceptance现在为每个已admit Offer持久化Recovery Case，并在同一消费事务写入Foundation Inbox；Delivery可保持
`delivered`，但业务Accepted/Rejected前不得Ack。Assessment Executor终态技术失败会交还Arca，形成用户可见
`attention_required`，不再伪造Rejection或“已完成整理”。配置或执行合同revision变化只触发一次自动恢复代际，之后由用户
通过Formation重试入口显式恢复；旧Work/Event/Attempt保持不可变。确定性同类故障按第三次阈值聚合Incident并打开Circuit。

专项9/9、相关Foundation/产品回归56项和完整Architecture Gate均通过；完整门禁为166个test file、1089 pass、7个显式
skip、0 fail，依赖/语义finding均为空。当前机器合同为113 Capability、99 Result family、117 Domain Input、184 table、
44 Canonical Transaction、118 route，P2 aggregate为
`c4f08ec964a1c81c4284ee08d9a10d41c5b03ea40611d813a348e29366a2758d`。当前失败Canary事实未改写，真实恢复与页面结论留待第二轮UAT。

## 0. UAT repair status — UAT-017 implemented, fresh Canary qualification pending

MoviePilot Search Candidate现在冻结当前`MediaRequirement`并公开有来源的typed媒体声明；明确合规候选优先，只有不存在
合规项时才使用标为“发布信息不完整、下载后验证”的未知候选，明确不合规候选不会触发下载。真实Probe不合格会在
当前Query内选择下一候选，尝试上限由Admin Web配置为1–5、默认3；修改设置会建立新Integration revision但不重录凭据。
专项协议、选择、多候选真实字节E2E和Formation可见性回归91/91通过；完整Architecture Gate为165个test file、
1087 pass、7个显式skip、0 fail，Admin Web production build通过。当前合同为113 Capability、99 Result family、
117 Domain Input、182 table、44 Canonical Transaction，aggregate为
`f44d610d01b9302e091adbbdfa35084e6648d61735c6ea8e73015fc35bffd522`；真实MoviePilot和Canary结论仍待第二轮UAT。

## 0. UAT repair status — UAT-004 bounded I/O qualified

实际文件读取预算回归证明MKV、ISO、BDMV主M2TS及转码输出均只读取中段262,144 bytes形成Workspace媒体Identity，
与逻辑文件大小无关。Libra Workspace Reference的primary media verification现在强制Handle算法为
`middle-256k-sha256`且digest等于Physical Material fingerprint；完整SHA-256只保留给小型Artifact。
专项合同、Workspace与Admin Web build通过；第二轮Canary继续以页面时延和真实输出验证用户侧结果。

## 0. UAT repair status — UAT-002 restart-safe qualification implemented

现有Intake批量Admission、每轮32项上限、16项Handoff Acceptance预留容量和无全局串行门闩均保留。
修复了服务重启后内存deferred清单丢失的问题：Coordinator现在有界分页扫描持久Offer，并从准确游标继续，
不依赖lost wake。400 Candidate下游积压/重启回归为400/400重新Admission，单轮不超过32、扫描不超过100；
保留容量和Foundation原子Admission回归同时通过。真实页面吞吐留待新Canary观察。

## 0. UAT repair status — UAT-001/UAT-003 implemented, targeted Canary pending

豆瓣Adapter现在为缺年份Collection记录执行最多16次精确详情观察，冻结详情Evidence digest、年份及最多12个别名；Normalizer为
标题与别名生成去重后的`title_year` Anchor，仍保持16项Record Anchor硬上限。Provider Acquisition终态后按新Anchor精确扫描
active Subject Projection并只重建相交Resolution。专项Provider、Perception Store和Alias回归通过；`养蜂人`、`看不见的朋友`、
`香火`的真实匹配仍须第二轮Canary确认。

## 0. UAT repair status — UAT-016 implemented, fresh Canary qualification pending

TMDB Adapter已移除固定`en-US`：连接测试与后续Search、精确ID、Metadata读取使用同一用户配置语言，默认`zh-CN`。
Identity Evidence有界取得Original Title、Alternative Titles与Translations并携带来源；NFO精确TMDB ID不再仅因本地化标题不同
而冲突。旧连接无需重录Credential即可按默认值读取，新连接页面可配置并展示语言。专项测试与Admin Web build已通过并单独提交；
尚未启动第二轮真实Canary，因此本条不宣称UAT通过。

## 0. Current operational status — Formation projection cutover recovered

本轮现场切换已经完成，当前本机服务保持运行。媒体整理工作区现在读取后端持久化Projection，前端不再逐请求扫描Subject、Rating、
Routing、Spec、Run、Work、Event和Package全账本。

| 项目 | 当前状态 |
| --- | --- |
| 数据库 | `helix-clean-v3`；182 tables；`integrity_check=ok` |
| 现场数据 | 659 Subjects；659 `libra_formation_projections` rows；旧Plans 2863；旧Catalog无非终态Attempt/Event |
| API | `GET /v1/health` = 200；`normalSupplyAllowed=true`；Formation active首屏25条 |
| Projection | `ready`；active与completed分区独立分页；现场检查completed 2条 |
| Admin Web | `GET /admin` = 200；生产构建通过 |
| 服务 | 已恢复`127.0.0.1:18080`；现有队列继续推进 |
| 回滚点 | `shelfdeck.pre-retirement-20260821.db`，SHA-256 `A734FE822896D88F597F66825853EA984E6919D8E58E23099CAC6D022A27F154` |

退役采用可审计的Owner replan：旧执行历史没有删除，旧活动Work的Attempt/Event转为合同升级失败/取消状态，后续由Owner按新Catalog
重新规划。克隆验证通过后才对现场执行迁移；没有clean start、没有清空现场数据库、没有重扫`Z:\Film`、没有重复豆瓣/TMDB/MoviePilot
同步，也没有删除或回退Workspace/Remux输出。

验证结果：启动恢复12/12、事件运行时24/24、Runtime Host12/12；Node全量276项为259 pass、17 skip、0 fail；Admin Web build通过。
现场服务恢复期间记录到1条既有`CLEAN_ARCA_TARGET_COLLISION`，未使服务进入faulted，也未改写该业务事实；后续按UAT台账单独复盘。

## 0. Completed implementation — Arca Shelf Deregistration

- 现有Admin Shelf注销route已改为正式异步Intent：精确确认和revision fence成立后立即把Shelf置为`deregistering`并返回`202`；
  后台由薄Coordinator推进责任排空、Manifest Freeze、每100项一页的Verification Work和唯一Terminal Commit Work。
- Release Manifest不再内联4096/50000项Material数组。`arca_deregistration_releases`持久保存全部Manifest revision成员；10,003项
  非空Shelf实测形成101页，Plan/Result保持紧凑，整座Shelf无Material总数上限。Related/Artifact reference-only成员不触发虚假Control release。
- Terminal Capability只申请`sqlite_write + control_commit`，Page Verification只申请`control_plane`；全链Volume Permit为0。最终事务原子释放
  精确Control、终结Shelf Entry和Deck Fact、更新Shelf与Receipt/Outbox。Target Folder与所有文件保持原样。
- 已Accepted On-deck、已授权Off-deck和Aftercare安全边界已接通；未授权Reservation自动释放。Aftercare必须先由独立Workspace reclaim Work
  完成settlement，Case才可invalidated。Control release通过分页durable Signal触发Procurement精确Material-local Eligibility reconcile。
- Startup Recovery实测在Manifest/Work执行中关闭进程后，使用同一clean数据库恢复且不重复Page Result、terminal Event、Receipt或Control release。
  `deregistering|deregistered` Shelf在Routing、Acceptance、Standard/Placement和Collection当前Projection中均不再被视为active。
- Admin Web“收藏架”已接入强确认、责任数量、phase/Page进度及只读历史；“我的收藏”增加当前/历史筛选。没有新增页面或Admin route。
- 聚焦回归24/24；完整服务回归245 pass、17个显式环境skip、0 fail；完整Architecture Gate为162个test file、1056 pass、7 skip、
  0 fail；Admin Web production build通过。机器合同为112/98/180/43/115，UI Surface 17；P2 aggregate为
  `21942ef67403a4658f101966e6ea232ee9872e3add684e7842e7e1ef59dc308a`，SSOT source-map aggregate为
  `3fde8cbfa5779c48ec15d1441b7cf2ea21779151c3da02d2f4d345ed6cc4f927`，manifest aggregate为
  `64e0eefa999513a01804776951b11137c64913c9f1cb5ba1a20020f0fcdd6846`，DDL digest为
  `78075366b3409916b8f8c6fcd3c0786daa5e45bab82f59ba83d91a2663689119`。
- 保留E2E资产：`C:\Users\markm\AppData\Local\Temp\helix-shelf-deregistration-aC8Nd7`；重启恢复数据库：
  `C:\Users\markm\AppData\Local\Temp\helix-shelf-deregistration-8hH1Vk\data\shelfdeck.db`。普通Primary/NFO/Poster/字幕与
  BDMV/CERTIFICATE共9项代表文件的注销前后Reality digest均为
  `31ddfb4ec9ceb37f7cba6e55267f55ddd262bf59bbba7ac7c44b949af7a2651d`。未访问`Z:\Film`，未使用Docker/NAS。

## 0. Completed implementation — Arca Off-deck

- Off-deck正式Store、Context Reader、pure Policy Resolver、Automation Coordinator、Process Coordinator、Planner、九项既有Capability
  executor、Input Projection、Resource Demand、Startup Recovery及Admin Application已经装入唯一Composition Root。产品路径不存在
  同步删除捷径；Coordinator静态禁止导入filesystem、Capability实现、Dispatcher、Event Runtime、Governor或跨Owner Repository。
- 默认`OffdeckPolicySet@1`为disabled。Entry条件与Duplicate Detection分别支持每日/每周有界Automation、用户即时触发、持久cursor及
  Fact signal；任何unknown不生成Candidate。Review Candidate是`entry|duplicate_group` closed union，Duplicate Group不替用户决定保留项。
- Review创建与逐Entry Reservation原子成立。Reservation同时fence Aftercare、相交On-deck/Handoff B与未来Shelf Deregistration；已有Care
  Work先在Foundation精确Process scope停止，排空前Review保持preparing。Authorization前取消会释放Reservation且零文件副作用。
- High-volume由服务端按5项阈值重算，必须有独立Selection Receipt和Escalation Receipt。Batch Authorization只形成Envelope；每个Entry
  使用独立Authorization和Case。Case状态固定为`executing|blocked|awaiting_reauthorization|completed`，Authorization固定为
  `active|stale|consumed`；Scope变化恢复同一个Case而不是新建Case。
- Scope Verification会在任何删除前拒绝共享Primary。Material Destruction按一个Physical Material一个Event执行：Primary精确删除；Related
  先释放目标Entry引用，有其他active引用则保留，最后引用才删除；授权Identity已不存在形成exact absence Evidence；替代Identity稳定拒绝。
  terminal commit只有在全部成员具备合法Evidence后才原子把Entry置为offdecked、终结Deck Fact并释放精确Control。历史事实不删除，本轮
  不删除空目录。
- Admin Web已用真实OffdeckPage替换Stub，提供建议/重复组、统一Review、High-volume二次确认、逐Entry进度、Policy及即时评估；Collection
  详情增加直接退出，Aftercare详情增加加入审阅。普通页面不暴露Event重试、Capability选择或队列控制。
- `p16-offdeck-closure.test.js` 12/12通过，覆盖Policy、五种High-volume、1024 Scope、Duplicate分页、Effect重放/崩溃、共享Related、
  共享Primary、替代Identity及Endpoint outage。P14 fresh-Temp产品E2E 2/2通过：单Entry完整退出；10 Entry批次先验证取消Review零副作用，
  再验证不可绕过的High-volume确认、10份独立Authorization/Case、实际文件删除、Scope外sentinel不变、全部Entry offdecked、Control归零、
  `failedWorks=0`、`failedEvents=0`及无残留非终态Work/Event。原P14主库保持只读；未访问`Z:\Film`，未使用Docker/NAS。
- 完整服务回归为245 pass、17个显式环境skip、0 fail；完整Helix Architecture Gate为161个test file、1051 pass、7个显式skip、
  0 fail；Admin Web production build通过。机器合同保持112 Capability、98 Result family、
  180 table、43 Canonical Transaction、115 Admin route加public health；P2 aggregate为
  `6576f3ac124d988661fce2107e63fe5c8250f9da43a4868e39a1b1799f2581fe`，SSOT source-map aggregate为
  `7bfa7f6b97c28152043e5cc0589a4de8e6855b9bc98b77fc8aee0a0f55c50839`，manifest aggregate为
  `621ae0acfbdf23b7f9dcc4a6bfe47ab6c6fcfcef1549057815f860c9974b5a67`，DDL digest为
  `8145f4481c1fb53f74230acdc268a8a7b5df5baf0cb270b1ae3b3936212eae59`。

## 0. Completed implementation — Arca Aftercare

- 每个Shelf Entry现在是独立Aftercare Process scope。正式产品链由Health Assessment、Repair Preparation、Repair Commit与Case
  Closure Supporting Work组成；14项现有Arca Aftercare Capability全部通过immutable Plan、Event Runtime、Permit、Attempt和
  typed Result执行。Coordinator静态门禁确认不导入Capability、Dispatcher、Event Runtime、Governor、Procurement/Libra
  Repository或未知目录扫描器。
- 健康Projection完全由最新三维Assessment、Finding、Case和当前Care Basis重建，状态固定为`never_assessed|healthy|observing|
  repairing|attention_required`。旧Basis的Assessment/Case仍在历史中，但不再影响当前灯色。Custody失败时另外两项只形成
  `not_assessable`；Endpoint outage按共享incident聚合并保持observe，不创建成批Case。
- 周期运行采用Custody 24小时、Presentation/Conformance 7天及最多2小时确定性jitter；fallback sweep使用持久cursor、100项/页、
  5秒/轮。Custody读取严格限于已知Inventory成员和每文件256 KiB有界指纹，不扫描Shelf目录。
- 自动修复覆盖NFO重新渲染、Poster按稳定Provider Identity重取、现有Primary的remux/transcode及Placement迁移。Case只有在文件效果、
  Product/Artifact验证、Placement switch、Material Control、Inventory新revision、旧输入settlement、Workspace reclaim和新Basis三维
  复验全部收口后才resolved。Case Closure已固定为先回收Workspace、后提交resolved Result，避免terminal Case反向阻断回收。
- P14隔离E2E把同一Shelf Entry从Inventory revision 1推进到4，分别闭合NFO、Poster和Placement三类Case；迁移后旧Target为空、
  新Target的Primary与sidecar完整，重启没有重复Assessment、Case、文件效果或Inventory revision。Primary缺失与NFO缺失并存时只形成
  attention_required，证明不会先做昂贵局部修复。产品场景15/15通过，未访问`Z:\Film`，未使用Docker/NAS。
- “我的收藏”海报墙已增加带文字标签的五色健康检验章和六类筛选；详情展示三维结论、Basis freshness、Finding、Case进度、
  Inventory修复历史及“立即检查健康”。`GET /collection`携带compact Health Summary，详情继续使用原有Care API；`/care`一级入口已删除。
- 完整Architecture Gate为160个test file、1039 pass、7 skip、0 fail；完整服务回归245 pass、16个显式环境skip、0 fail；Admin Web
  production build通过。机器合同保持112/98/180/43/115，UI Surface为8 pages + 9 journeys = 17；P2 aggregate为
  `38f7ec09909ec35a75907d3ba7dadc8fa2e9bf715c2775076906039b39d9704d`，manifest aggregate为
  `06bf1058b224ebca269d21279cdc575d64013b0479bb7fc955832422752b3374`，DDL digest为
  `9354662132460c7e8df18f513802ae2ba82c9a8a612467e3515957dde8128506`。

## 0. Completed implementation — Arca Acceptance, On-deck and Collection

- 产品链已接通`Handoff B Outbox → Acceptance Attempt → Acceptance Work/Plan/Event → On-deck Work/Plan/Event →
  On-deck Commit`。Acceptance的Identity、Structure、Metadata、Mandatory Media、Space和Inventory Feasibility均为独立
  Capability调用；On-deck的Target Slot、Stage、Verify、Switch、Input Settlement、Fulfillment与Commit同样经过Execution
  Foundation。Coordinator没有文件适配器、Dispatcher、Event Runtime或Resource Governor执行捷径。
- fresh-clean正向E2E形成1份accepted Handoff B Receipt、1份Custody、1个completed On-deck Run、1个Shelf Entry、
  1版Inventory与1版Deck Fact。最终Inventory含7个物理材料角色：1个`primary_payload`、2个
  `metadata_sidecar`、2个`poster`、1个`fanart`和1个`subtitle`；Shelf Target存在对应媒体与sidecar。Libra Run
  terminal，Off-load Completion已形成；完成后重启没有重复Work、Event、文件效果、Entry、Deck Fact或Outbox消费。
- 空间不足fresh-clean E2E通过注入的正式`statfs` Evidence形成Handoff B Rejected。该路径只有Arca rejection
  Decision/Receipt和Libra rejected Delivery Receipt；Arca Custody、Control、On-deck Run、Shelf Entry、Deck Fact均为0，
  Shelf Target保持空，Libra继续拥有返工责任。重启后仍只有一份rejection closure。
- “我的收藏”已由Stub替换为Arca Shelf Entry海报墙。点击卡片展示标题、年份、类型、简介、演职人员、Shelf、
  Inventory/Deck revision与评分控件；Poster通过authenticated、side-effect-free的Inventory fenced route读取。空状态、
  海报卡片、详情Dialog、评分和Escape关闭的聚焦测试2/2通过，Admin Web全部组件测试5/5及production build通过。
- Arca正向与空间不足拒绝产品E2E合计2/2通过；User Perception回归3/3通过，并确认On-deck后的新评分只追加
  Perception与Acceptance Spec历史，不倒流或重开已完成的Libra Run。完整`media-service npm test`为245 pass、
  16个显式环境skip、0 fail。Helix Architecture gate通过，P2 aggregate为
  `1342dae74a59a1fb8f89f7e1ef98f30e1961fb6615f69138ff65ff8a9ef24a1f`，manifest aggregate为
  `7a849ba1876e4baf6a4435a09cd17555a376eb80db3b2fa7a98b6f49e01bc3a9`。
- 本轮只使用P14隔离Material Field、系统Temp数据库/Workspace/Shelf Target；没有访问`Z:\Film`，没有Docker、NAS、
  Post-deck效果或生产部署。当前机器合同为112 Capability、98 Result family、180 table、43 Canonical Transaction、
  115 Admin route加1条public health（总计116 route）。

## Local media safety boundary

- 2026-08-14用户正式接受Movie Libra封口。封口入口为Handoff A Accepted，出口为自包含On-deck Product Package及open Handoff B Offer；Intake、Routing、User Perception、Acceptance Spec、Libra Run、Workspace Production、Product Conformance和Promotion均在范围内。Handoff B Accepted、Arca Acceptance/On-deck、Shelf Entry、Deck Fact及Off-load回收不在本次封口范围。后续Domain不得通过实现补丁反向改变已封口的Libra状态机、Planner/Coordinator边界、External Landing或Package/Promotion合同。

- 2026-08-13 DV Design Return已完成并验证。`LibraMediaPlanningPolicy@1` revision 2正式区分Device全局ready与Source × Pipeline × Intent兼容性；转码拆为Assessment Work与Selection Work，只有terminal `strategy_rejected` Evidence才允许从普通设备推进到独立CPU链，Permit等待和技术错误均不会触发fallback。真实Profile 8样本“揭秘日”在`local-nvidia-nvenc-0`上Assessment 24/24并完成唯一GPU Effect，61.313秒输出769,290,583 bytes；证据位于`C:\Users\markm\AppData\Local\Temp\helix-real-dv-dv_p8_gpu-doEYuM\report.json`。真实Profile 7样本“变形金刚3：月黑之时”在GPU保持ready但缺少PQ→SDR pipeline的受控Projection下先以`required_pipeline_profile_unavailable`拒绝且GPU Effect为0，再由独立CPU two-pass与strict-ABR Intent完成，666.739秒输出911,737,949 bytes；证据位于`C:\Users\markm\AppData\Local\Temp\helix-real-dv-dv_p7_cpu_fallback-l2EoBA\report.json`。两条输出均为HEVC、SDR BT.709 limited、`yuv420p`、无DOVI，5%/50%/95%可解码，人工contact sheet未见紫绿或明显色偏；源端Reality前后一致，重启后Work/Plan/Event/Attempt/Result、Package及Offer均未重复。
- D10使用产品Composition Root验证Profile 5/无兼容Base Layer：GPU和CPU即使ready也都以`dolby_vision_base_layer_unsupported`产生source-level拒绝，零Transcode Effect；External Acquisition无可用结果后Run Frozen，0 Package/0 Offer。当前P14场景文件13/13 PASS、451.569秒；全服务`npm test`为245 pass、14个显式环境skip、0 fail；完整Helix Architecture gate为158个test file PASS。合同保持112/98/180/43/115，P2 aggregate为`295d60191eb3f457339b9f834f50a60174e400888dc0ccecf53c18a105275bbc`，SSOT source-map aggregate为`b2076f239f2fee8cd70dcd192b3ac38f2438b3f0ba85de7e30e1c6536b4ec76b`。
- 2026-08-13用户明确授权从`Z:\Film`只读取并复制少量真实电影到新的系统Temp Material Field，专项验证GPU、CPU路径及真实TMDB补齐；`Z:\Film`本身未注册为Field、Shelf或Workspace。三项fresh-clean产品E2E均形成published Package与open未消费Handoff B Offer，`failedWorks=0`、`failedEvents=0`、Arca Entry为0，源端bounded Reality前后一致，三个SQLite库`integrity_check=ok`。GPU场景`Official Secrets (2019)`由`local-nvidia-nvenc-0`真实执行HEVC NVENC，347.625秒输出999,823,335 bytes，169个`nvidia-smi`样本峰值为GPU 15%、Encoder 49%、显存2,457 MiB、功耗82.58 W；证据位于`C:\Users\markm\AppData\Local\Temp\helix-real-libra-gpu-eOfrX7\report.json`。`Public Enemies (2009)`只是在受控“普通设备不可用”Projection下验证CPU生产路径：Planner生成`software_cpu/two_pass_abr` Plan，222.916秒输出1,040,290,852 bytes；它不构成“GPU全局ready但源级不兼容”的fallback证据，R09的正式证据以后续真实Profile 7 DV E2E为准。该历史证据位于`C:\Users\markm\AppData\Local\Temp\helix-real-libra-cpu_fallback-T2zwnG\report.json`。Metadata场景只复制11,842,813,386-byte的`The Shawshank Redemption (1994)`视频，不复制NFO/poster；Libra真实搜索并唯一绑定TMDB `278`，在Workspace生成578-byte NFO和781,176-byte JPEG poster，27.008秒direct发布Offer，证据位于`C:\Users\markm\AppData\Local\Temp\helix-real-libra-metadata-vayeoP\report.json`。
- 该专项发现并修复设备发现缺陷：旧64×64 HEVC探测帧低于NVENC最小尺寸，导致健康RTX 4080 SUPER被错误登记为unavailable；探测现使用有界256×256帧，实际`hevc_nvenc`与`libx265`通过，QSV/VAAPI按本机Reality保持unavailable。此前330秒预算内18/20 Package的复跑只是一份被中止的历史性能观察；当前代码已通过完整P14 13/13复跑，不再把该观察列为未决正确性缺口。
- 2026-08-13原35场景基线命令`HELIX_LIBRA_HANDOFF_B_E2E_ROOT=<P14 material-fields> node --test test/helix-libra-handoff-b-scenario-e2e.test.js`曾复跑为`12/12 PASS`、`416.220 s`；加入D10后的当前结果已由上方13/13证据取代。它逐项覆盖业务场景，而不是把test case数误称为业务场景数。主路径形成10个必测Subject（SDT-M01、M02、M03A、M03B、M05、M06、M07、G08、G09、L06）的active Run与open未消费Handoff B Offer；`failedWorks=0`、`failedEvents=0`、`consumedOffers=0`、`arcaEntries=0`。L06走direct 4K+DTS-HD MA，M05走External Acquisition后import合格样本。
- 主路径、Package审计与生命周期证据已补齐D02、D08、S01–S08：D02保留NFO title并只由Provider补plot；D08按Plan冻结rank及verification ID选择；S02同语义revision保留原Run并追加Freshness Evidence；S04–S05恢复同Run；S04–S06变化后永久supersede并建立replacement；S08在Offer前加急并由replacement继承；S07无MoviePilot时保持production且0 Package/0 Offer。
- R01–R08已通过产品Composition Root：R01空间不足零Workspace/零文件后可恢复；R02与R04在真实媒体Effect边界杀进程后复用同一Target/Effect/bytes；R05 Fact事务全有或全无；R06 Package、Control、Result、Outbox原子恢复；R03/R07不重复外部请求且lost wake可由durable reconcile恢复；R08二十个Subject并行且慢Run不阻止兄弟Offer。
- 本轮修复三项被真实测试发现的精确接线缺口：External Job Observation绑定正式24小时deferred policy，短Stability Observation绑定5分钟/16次/最小5秒policy；Libra Run terminal Evidence按Foundation实际的1-based Event Attempt ordinal验证；TMDB官方`/images`可选`iso_3166_1`字段纳入closed transport schema。测试Adapter同步使用正式`yearHint`与规范化title，避免fixture伪造`provider_no_match`。该轮旧门禁数字已经由上方DV Design Return后的245 pass、14 skip、158-file Architecture gate及新aggregate取代。
- 2026-08-13完成MoviePilot External Landing Design Return与产品接线。正式`MoviePilotLandingBinding@1`冻结Integration/config revision、Provider请求根、整理根、ShelfDeck只读可见根、endpoint/mount fence与digest；Landing不得与Workspace、Artifact Root、Material Field或Shelf Target相同、嵌套或交叉。MoviePilot Observe现按官方整理历史的`download_hash → dest`定位最终输出，旧下载历史`path`不再参与解析；整理尚未出现时保持`waiting_for_external`，明确整理失败才形成Provider terminal failure。Stability与Workspace Import复用同一Binding revision；Import以流式普通拷贝形成独立Physical Material，核验源前后stat/digest、目标digest及inode，保留Landing原件且禁止硬链接。Admin Web已用现有Integration路由接通Endpoint、API Key、请求根、整理根和本地Landing根配置。
- MoviePilot Landing聚焦合同/协议/管线/确定性E2E共53项通过；Admin Web production build通过；默认服务测试245 pass、14个显式环境skip、0 fail；完整Architecture gate为159个test file PASS、1031 pass、7 skip、0 fail，包依赖与语义扫描均无Finding。P2合同门禁保持112 Capability、98 Result family、180 table、43 Canonical Transaction、115 route；真实L07超时与Permit合同修订后的aggregate为`f75a5a714d2bb06af61cb31986832ed07ff9106e51ef12f3988fca87a4bf8327`，SSOT source-map aggregate为`9d7e809b178976d1b742819f87622a44f9757c0ec173b32e494be4e3fbd65ac3`。加入本改造后的P14 Handoff B场景文件13/13 PASS、约450秒：20 Subject并行、external import、planned restart/lost wake、Package内容审计、S04–S08及R01–R06均继续通过，Foundation状态机未变化。
- 2026-08-14真实L07已闭合。最终测试复用MoviePilot中已完成的`The Wild Robot (2024)`精确任务，脚本硬阻止`/api/v1/download/add`，`moviePilotDownloadAddCount=0`，没有重新下载。Transfer History按`download_hash → dest`解析21,756,642,178-byte的HEVC 4K + TrueHD成品，planned restart后依次完成Stability、Verify与Workspace Import；Request、Acquisition Observation、Stability及Import成功事实各1份，无重复Package或Offer。
- 最终证据根为`C:\Users\markm\AppData\Local\Temp\helix-real-libra-handoff-b-HmA51h`，SQLite库为其`data\shelfdeck.db`。总耗时607.681秒，其中Search 12.057秒、Request/既有任务采用14.085秒、Acquisition Observation 268.735秒、Stability 289.589秒、Import 341.676秒。Landing和Workspace副本大小及SHA-256完全一致（`fd725e36bc8f5fb5503cddba241d146353aba5a8b06e2b50c7f0c35dbe347468`），inode不同；Landing原件保留，源、Shelf Reality不变。最终`failedWorks=0`、`failedEvents=0`、published Package=1、open未消费Offer=1、Arca Entry=0、`integrity_check=ok`。
- 真实大文件还暴露并修复了External Landing观察超时：Acquire Observation和Stability此前沿用30秒P5 timeout，但SSOT要求外部Package完整SHA-256，21.76 GB文件实际约需4分钟。现已将这两类Event改为同时申请Integration与Landing `volume_read` Permit，并使用30分钟有界硬超时；完整checksum不再因短timeout形成重试或重叠读取。该SHA-256是External package完整性Evidence，不改变Physical Material Identity的256 KiB有界指纹合同。

2026-08-13矩阵证据（`test/helix-libra-handoff-b-scenario-e2e.test.js`，P14真实字节）：

- L01–L11主路径已在同一Composition Root核对：M01 no-rating直接带入；M03A/G02 Transcode；M03B/M02/L06不得重复加工；M05 External Import；M06/M07/G08/G09 Remux。L06 Primary仍是`domain_binding`，没有Remux/Transcode/Import。
- Package内容：single Structure、Identity/Metadata/Media-Cast、NFO+poster `included_product`、Off-load Context、Related disposition、Delivery Attestation。M01 Related含subtitle/fanart/nfo/poster。无NFO的L06把actor保留在Media-Cast。
- D03/D04/D07：M08、G01、G06均有open Offer。
- S01/S03：M01从no-rating改为1星后旧Run `superseded`、新Run另出Offer并走Transcode；L06保持原active Run。
- S07：未配置MoviePilot时5星M05保持`production`，0 Package/0 Offer，不伪造通过。
- R03/R07/R08：重启lost wake与20 Subject并行已通过。
- 38场景的确定性产品路径、故障注入、真实DV与真实MoviePilot L07证据均已齐；Handoff B Offer保持未消费，下一业务节点为Arca Acceptance。

- 用户已指定`C:\Users\markm\AppData\Local\Temp\ShelfDeck-P14-20260723\material-fields`为可重复构建的主测试库；destructive Formation只允许作用于该库或由它生成的独立系统Temp副本，Material Field与Shelf Target必须明确指向本轮隔离副本。
- `Z:\Film`退出运行时测试Scope：不得作为Material Field、Shelf、Workspace或Canary输入。用户后续分别授权测试库构建器和真实Perception E2E只读取材；真实Perception E2E只复制两部匿名普通媒体到新的系统Temp Field，复制前后源size/mtime/ctime不变，未在源端写入、移动、重命名或删除。
- 历史记录确认该P14 Sample Library曾包含`film-complete\1917 (2019)`和`film-problem\0.5毫米 (2014)`；当前Movie媒体已被历史E2E消费，`film-complete`为空，`film-problem`仅剩`Thumbs.db`。
- Movie测试库已扩充为22个场景、1,131个受管regular files、`57,027,472` bytes，受管Reality digest为`966c8fac23f3b99f02fe63566fb93c365e883d8c8ce34ac185eb3a348a098140`。其中12个既有场景保留；G01–G10新增Related替代、精确Settlement授权、逐成员崩溃恢复、Target collision、跨卷、Related Reality变化、同根二次Observation、ISO、真实DVD和1,025项Related的complete-or-fail-closed边界。所有应可播放MKV/MP4/M2TS继续通过bundled ffprobe，G09有界真实VOB为8.108秒；唯一`not_media`仍是M09刻意损坏样本。
- 测试库manifest已升级为`shelfdeck.movie-test-library-manifest@2`；两份阶段seed受独立size/SHA-256校验，只有manifest指定阶段可以物化。构建器只拥有`ownership.json`列出的`SDT-*`路径并保留历史目录。自动化安全/场景/BDMV/ISO/phase helper测试5/5通过，build末尾完整Reality重验通过。该测试集现在具备后续Libra/Arca高危链路的输入与阶段配方，但产品Planner、Authorization、Effect Recovery或ISO/DVD执行未接线前，不得把“素材存在”宣称为E2E通过。

## 0. Completed implementation — User Perception and Acceptance Spec

User Perception产品链已经装入唯一Composition Root。真实Douban Adapter以已验证Integration revision、精确用户收藏路径和同源最终响应URL
冻结来源，覆盖全部分页；网络、登录、HTML、传输和typed schema错误保持技术失败。Provider硬超时使用referenced deadline，不允许悬挂
Promise永久占据Event。所有Record、Correction/Supersedes关系和Resolution均为Owner-owned immutable事实。

Libra只通过User Perception公开Facade读取`found(rating=1..5)|not_found` Resolution。显式`claimedYear`优先；缺失时，Libra自己的
Decision Identity Mapping只允许从标题尾部括号年份分离`title_year` Anchor，不修改Procurement Claim。Provider Acquisition完成后的
精确signal只加速；active Subject评分Resolution还由Foundation 30秒/100项持久cursor fallback有界发现，不跨Owner读取Repository。

Acceptance Spec Coordinator只签发Work、读取terminal Resolution并收口Spec。Spec Decision Basis冻结Shelf Standard、Routing Decision与
Perception Resolution；No-rating和1–5星均可形成完整Spec。直接评分和改分E2E证明同一Subject按`1 → 2 → 3`追加Spec revision，旧Spec
保持immutable；不存在同步Capability捷径，也没有引用旧`movie-formation-coordinator`。

真实本地E2E资产为`C:\Users\markm\AppData\Local\Temp\helix-routing-decision-0bAMhK\data\shelfdeck.db`：

- 真实Douban同步形成1546条Record，其中1483条含评分；104个Provider Page Work约107秒收口，Rating Log以16页读取1546个唯一Record；
- 两部隔离普通媒体通过产品Procurement、Intake和direct Routing形成两个Subject；两个不同真实星级均`found(source=douban)`，其Acceptance Requirements digest不同；
- 一次本地直接评分及一次Correction使一名匿名Subject保留3份Spec revision；最终Resolution为4份found、24份not_found，Acceptance Spec共28份；
- Perception链共有134 Work、134 immutable Plan、372 Event/Attempt/Result/Resource Timing，`failedWorks=0`、`failedEvents=0`；
- 重启后相同sync idempotency key重放保持1个Acquisition、104个Provider Work、1546个Douban Record、28个Resolution revision和28份Spec，不重复外部结果；
- Libra Run、Workspace、Product Package、Arca Handoff B Receipt和Shelf Entry全部为0。

Admin Web生产构建和评分/Acceptance聚焦回归通过。机器合同为112 Capability、98 Result family、180 table、43 Canonical Transaction、
114 Admin route加1条public health（总计115 route）；SSOT source-map digest为
`e252239d73ebafa856199898facb88b342f981b3cc2e5f682b378dfbc1b42121`，完整合同aggregate digest为
`36c18e4af1e977cfc3cf9c7f60fb76b45d98435b3bac8e8bb4fd6cd3890abc16`。完整服务测试243 pass、1个显式环境skip、0 fail；
Architecture fixture 998 pass、7 skip、0 fail，P8 Front-half和Admin Web production build通过。E2E数据库`integrity_check=ok`，
两份隔离媒体的size/mtime/ctime与durable Observation逐项一致。当前精确状态为
`LIBRA ACCEPTANCE SPEC READY / AWAITING LIBRA RUN`。

## 0. Completed implementation — Libra Routing Assessment

正式产品路径现从Intake Accepted Subject签发Routing Preparation Work。Planner只发布immutable Plan；NFO/TMDB Fact Observation及
Decision Basis Commit都由Event Runtime、Attempt、Permit和Result Binding推进。新增的`libra.routing.fact.observe@1`只获取Policy实际
声明的`release_year|region|genre|resolved_provider_identity`，NFO缺项后才允许下一份Provider Work；技术错误保持技术失败，Provider
`not_found|ambiguous`不会被伪装为匹配。薄Routing Coordinator不执行Capability，也不复用大型Formation Coordinator捷径。

Admin Web“文件来源”已支持direct/sorting Policy的typed规则编辑、组合条件、rank调整、预览、CAS发布和revision历史；“上架进度”保持一行一个Subject并展示Routing状态、
命中规则、目标Shelf、缺失/冲突Fact及Decision revision/digest。只有当前unresolved Subject显示一次性“选择收藏架”，幂等重放返回同一
Decision且不改写Field Policy。

本地Node.js、临时clean数据库、产品Composition Root E2E通过：direct Field的19个Subject全部resolved到`movie test`；sorting Field
包含5个Subject，其中4个分别通过NFO或deterministic TMDB Evidence命中经典电影测试、新片测试和普通电影测试，1个Provider
`not_found`保持unresolved且没有越级命中always，随后通过Admin产品入口手动resolved。最终24个Subject均有resolved current Decision，
历史中保留1份immutable unresolved Decision；29个Routing Work、5个Fact Observation Event、24个Decision Basis Commit Event全部成功。
Provider Adapter只被两个无NFO样本调用。Acceptance Spec、Libra Run、Workspace及Arca Shelf Entry均为0。
完成态数据库关闭并重启后，24个current Decision逐字保持、Provider调用仍为2、Work/Event/Decision计数均未增加，两个测试Field的
source Reality digest前后一致；手动Decision只在其前一份Policy Decision仍对应current Policy revision时保持终态，新Policy发布仍可重算。

2026-08-12又完成一条不注入Provider响应的真实外部Routing E2E。测试通过Admin产品入口完成TMDB“测试连接→保存连接”、Shelf、
Material Field、sorting Policy和Observation配置；隔离MKV被复制为无NFO的`The Shawshank Redemption`，正式TMDB请求唯一解析为
provider key `278`、`release_year=1994`，随后自动resolved到`real-routing-classics`。链路形成2个Routing Work、2个immutable Plan、
1个Provider Event/Attempt/Result和1份resolved Decision；关闭并重启产品Composition Root后没有重复Provider Fact或Decision。
sourceBefore/sourceAfter均为1个文件且Reality digest同为`d56b70d6a888fbb6d914c45c352efdebb8ebdf6b8d2f5c8b2e245bd1b15d3e45`；
Acceptance Spec、Libra Run、Workspace和Arca Shelf Entry仍全部为0。保留数据库位于
`C:\Users\markm\AppData\Local\Temp\helix-real-routing-e2e-9IPbqD\data\shelfdeck.db`，完整执行约3.9秒。

同一真实验证还先使用`Fight Club`检验了歧义分支：TMDB当前返回2个无法排除的同名候选，系统持久化
`provider_identity_ambiguous`并保持Routing unresolved，没有选择第一项，也没有越级命中catch-all。这证明真实Provider的
unique与ambiguous两条业务路径都遵守SSOT；它不是失败后的人工作弊修复。

机器合同为112 Capability、98 Result family、180 table、43 Canonical Transaction、114 Admin route，unresolved type ref为0；
Architecture gate、P8 Front-half、完整`npm test`（240 pass、1个显式环境skip、0 fail）及Admin Web production build通过。
当前精确边界为`LIBRA ROUTING DECISION READY / AWAITING ACCEPTANCE SPEC`；下一步只能实现Acceptance Spec，不得提前创建Run或Workspace。

## 0. Completed implementation — Libra Intake Acceptance

正式产品路径现以`Outbox Dispatcher → Libra Intake Coordinator → Supporting Work → Planner → Event Runtime → Capability`消费Handoff A
Offer。Coordinator只签发Work和读取terminal Result；Candidate/Material/Binding/continuity验证、Accepted/Rejected commit均通过既有
Execution Foundation执行。历史大型Libra Coordinator没有接入，也没有任何同步Capability执行捷径。

Admin Web“上架进度”已接入Formation Projection，并固定一行一个Subject。Intake Accepted后立即出现Subject；当前尚未配置Libra-owned
Routing Policy，因此19行均处于`awaiting_destination`，没有伪造Shelf、Acceptance Spec、Libra Run或生产进度。

真实隔离Canary使用`C:\Users\markm\AppData\Local\Temp\ShelfDeck-P14-20260723\material-fields`只读运行，临时clean资产保留于
`C:\Users\markm\AppData\Local\Temp\helix-local-intake-canary-G3TT6r`，数据库为其`data\shelfdeck.db`：

- sourceBefore/sourceAfter均为1,140个regular files，Reality digest均为`c88c2edd7af34585ea312c58248a8b5bcd6b30fdb9d51cbd174f7700e08f5b4e`；
- 5个Observation Page、1个sealed Procurement Run、19个Candidate、19个accepted Delivery/Intake及19个Subject；所有Subject均为`awaiting_destination`；
- G08 ISO正确形成`materialInputForm=iso`；G09 DVD正确形成`materialInputForm=dvd`，Manifest含1个primary VOB及4个IFO/BUP结构依赖；
- 38个Primary Binding和57个Related Binding；G10的1,025项exclusive Related按`candidate_disposition_scope_unrepresentable`业务失败收口，未产生Candidate；
- `failedEvents=0`、Foundation技术失败Work为0；主动重启后指纹读取仍为1,140次，没有重读或重复Subject/Offer/Intake；
- Libra Run、Workspace、Handoff B、Arca媒体事实均为0，未产生媒体写入、移动、重命名或删除。
- 首轮完成态数据库复启暴露Libra Accepted/Rejected writer使用了非Foundation合同的Consumer Set digest公式；已统一为冻结
  `['procurement']`数组的Canonical digest。修正后全新Canary用时约9.4秒，完成态数据库再启动成功，P8聚合门禁及P3持久化回归通过。

聚焦P7/P8门禁、Web build及完整`npm test`均通过；完整测试为239 pass、1个显式环境skip、0 fail。Procurement/Foundation压力夹具
以260个Candidate跨过256 open-Work水位，17.5秒收口、最大open Work 33；该夹具暂停Outbox投递以保持专项职责，正式服务仍默认启动
Outbox Dispatcher，自动消费行为由独立Intake E2E覆盖。机器合同保持111 Capability、97 Result family、180 table、43 Canonical
Transaction及114 Admin routes。

当前精确边界是`LIBRA INTAKE ACCEPTANCE READY / AWAITING ROUTING`。下一步只能实现Libra-owned Field→Shelf Routing Policy、Routing
Decision与Acceptance Spec；尚未授权Production Run、Workspace、Handoff B、Arca On-deck、Docker或NAS。

## 0. Completed implementation — Arca Shelf configuration

Admin Web“收藏架”已从静态Stub替换为真实`ShelvesPage`：可加载active Rule Template、默认选择只读
`system-beta-recommended`、输入唯一Target Folder、配置Movie Placement，并展示Template、Standard、Placement及Routing Projection。
Movie No-rating与1–5星Rule Set可见；其余三个Profile仍保存在同一推荐Template中但未开放业务处理。

创建Command现在先完成realpath、目录、读写和安全commit协议探测，从实际filesystem evidence派生endpoint/mount scope，再以精确active
Template revision构造权威Standard。Shelf、Standard revision 1、Placement revision 1、Routing Projection revision 1、Command Receipt
和Audit在同一事务中全有或全无；Admin Web/caller不能提交展开Standard。幂等重放先读取durable Receipt，即使Target随后暂时不可访问，
也不会重新探测或创建第二座Shelf；同key不同请求稳定冲突。

本地验收通过：Web build成功；Shelf定向HTTP/UI/Projection组为26 pass、3 intentional skip；完整服务测试234/234；机器合同保持
111 Capability、97 Result family、180 table、43 Canonical Transaction、114 routes，aggregate digest仍为
`76b8114469e10bfeb64f6a822295b03fe0c893f1091c8f41dc18cfd56b49e362`且unresolved type ref为0。临时Target sentinel在创建前后逐字一致；
关闭并重启服务后Shelf/Template/Standard/Placement/Projection逐字一致，Libra public reader可读取Movie Standard；Shelf Entry、Libra Subject、
Handoff B、On-deck及媒体文件效果均为0。

该证据只关闭Shelf配置接线，不代表Arca或Movie Milestone完成。Libra-owned Field→Shelf Routing Policy、Handoff A消费、Routing Decision和
Acceptance Spec仍是下一独立目标，当前Implementation Gate未开放。

## 0. Closure decision — Movie Procurement

用户于2026-08-11接受Movie Procurement封口。封口范围从Movie Material Field的terminal Observation开始，覆盖增量Eligibility、
三类Selection Scope、1024物理成员Run Admission、`Run → Work → Event` Triage、Candidate Assembly、Candidate Package以及独立open
Handoff A Offer，终点精确为`Handoff A Ready`。本轮不消费Offer、不建立Libra Subject/Run/Binding，也不产生Arca事实。

封口证据为最新只读全库Canary及随后数据库全量一致性审计：18,409个文件、72个Observation Page、922个Scope、8,627个selected
Material、10/10 Run Seal、943个published Candidate与943个open Offer；Run/Selection、Package/Offer、Primary/Related、Scope/Input Form、
BDMV一容器一Candidate及digest连续性违规均为0。59个BDMV Scope全部闭合；`苹果.mkv`裸文件、普通单电影目录、多电影目录、BDMV和
Related代表样本均符合合同。唯一普通`probe_not_media`文件已由独立ffprobe确认EBML header无效，不是有效MKV误判。

Candidate放大修正已由真实全库数据证明有效。第二次Canary的Observation/Media Probe耗时波动经用户确认为环境波动，不作为Movie
Procurement封口阻断项；原始绝对耗时仍保留在下方作为可追溯Evidence，不被改写成通过。后续Domain接入不得通过修改Procurement
Scope、Run、Triage、Candidate或Handoff A合同来绕过自身设计问题；若发现违反SSOT的真实缺陷，必须重新返回Design。

## 0.1 Current Mixed Field implementation evidence

- 唯一SSOT已固定`standalone_file|ordinary_directory|bdmv_container`三类Selection Scope；Run与单个不可拆分Scope统一最多1024个selected Physical Material，旧256 logical selection及BDMV 4096上限不再是active合同。
- `SelectedFieldMaterialSet`、Run/Member关系、Retry、Primary Manifest、Candidate Delivery、Accepted Intake与Control连续性均传播同一1024物理成员合同；Related Material不属于Selection或Control。
- 机器合同门禁通过：111 Capability、97 Result family、180 table、43 Canonical Transaction，aggregate digest为`76b8114469e10bfeb64f6a822295b03fe0c893f1091c8f41dc18cfd56b49e362`，unresolved type ref为0。
- 全库只读Canary正确性通过：18,409个regular files、72个Observation Page、922个Selection Scope、8,627个selected Material、10/10 Run Seal、943个Candidate/Offer；59个BDMV Scope、862个ordinary Scope及1个standalone Scope。
- `Z:\Film\苹果.mkv`形成唯一standalone Candidate：display identity=`苹果`、`materialInputForm=stream_file`、Primary member=1、Related仅`Z:/Film/苹果.nfo`、Offer状态=open。
- Canary读取`1,776,871,724` bytes、18,409次，源before/after digest均为`52072b5a14750e42f610ce264b9b80ecb6f36c406b2f8996f3086ed81388b420`；0 duplicate Selection、0 failed Work/Event、0 defer、Libra/Arca=0、Offer consumption=0、最大RSS约1.17 GiB。
- Canary性能失败：首个Offer 163.385秒、全部Run Seal 445.122秒、总耗时451.260秒，超过批准的163.1/385.9/393.2秒红线。数据库和日志保留于`C:\Users\markm\AppData\Local\Temp\helix-full-movie-canary-0af0uA`。
- 诊断将主要回退定位为Candidate Manifest/Context对整个1024成员Run的重复投影，以及Coordinator重复全量扫描。实现已改为Candidate-local member projection、Scope-local Context、O(1) Unit lookup、O(log N) Work-prefix probe，并保持Foundation状态机不变。
- 修正后的确定性证据：`npm run test:helix-procurement`通过全部20个Procurement fixture及P2–P6门禁；`npm test`为233/233；产品Composition Root 1000 Candidate压力fixture生成1000个Candidate/Offer、最大open Work 33、0失败。
- 用户授权后已使用新的Temp clean数据库完成第二次全库复验。正确性结果保持一致：18,409个文件、72页、922个Scope、8,627个selected Material、10/10 Run Seal、943个Candidate/Offer；源before/after digest一致，主动重启无重复事实，0 failed Work/Event、0 defer、Libra/Arca=0、Offer未消费。资产保留于`C:\Users\markm\AppData\Local\Temp\helix-full-movie-canary-Ovor6i`。
- Candidate放大修正确实生效：`procurement.triage.primary_manifest.build@1`累计执行时间由第一次混乱Field Canary的90.043秒降至16.335秒；从首个Offer到全部Run Seal的Candidate尾段由281.737秒降至173.523秒，改善约38.4%，且比旧性能基线的193.8秒更快约10.5%。
- 第二次端到端性能仍未通过原15%红线：首个Offer 256.578秒、全部Run Seal 430.101秒、总耗时435.806秒。对账显示本轮Observation Capability累计时间由42.320秒升至111.266秒，普通Media Probe由83.173秒升至122.758秒；这些source-dependent阶段的波动掩盖了Candidate修正收益。当前证据只能证明慢路径修复有效，不能把整轮性能标记为通过；在进一步诊断前不自动第三次读取全库。

## 0.2 Previous BDMV baseline evidence

- 唯一SSOT已补充Observation entries历史事实、compact Page receipt、256项/64 MiB批次边界，以及Material-local Eligibility Basis和有界Change Set语义。
- 机器合同已生成并通过P2基线：111 Capability、97 Result family、180 table、43 Canonical Transaction；新增BDMV专用Assessment合同，旧Layout/双Observation Capability与Result不再属于active catalog。
- 当前P7/BDMV/Candidate Publication聚焦回归通过；完整产品Architecture gate通过。Observation Page Commit已同时申请`volume_read`与`sqlite_write` Permit。
- 最终全量只读Canary已完成：18,407文件、72页、12/12 Run Seal、942 Candidate/Offer、3,926 succeeded Event/Attempt/Result、955 succeeded Work、无failed Work/Event、无Resource defer；source Reality前后一致，主动重启后未重复已提交Observation，Libra/Arca为0。总耗时约5分42秒，首个Offer约142秒。
- 首轮clean Observation的Eligibility实际写入18,407条（185批），后续Triage未产生额外Eligibility写入；完全相同Observation的0写入由16/16专项fixture证明（其中包含Observation边界、BDMV与Eligibility no-op）。最新Canary数据库与日志保留于`C:\\Users\\markm\\AppData\\Local\\Temp\\helix-full-movie-canary-VFP6wA`；此前中止轮次及`RN9eJJ`资产仍保留作历史对照。
- 本轮状态更新为`CLOSED FOR DOMAIN ONBOARDING`；该封口只覆盖Foundation与Procurement合同及本地验证，不代表Libra/Arca已实现或已接入。

## 0.1 Final Canary record (2026-08-10)

| Metric | Result |
| --- | --- |
| Source Reality | 18,407 regular files; before/after digest `a630ecf5b86c0da2541b5e53fae2bc6e5aa8d28fd181b7d6ce6c770042eb316d` |
| Observation | 72 pages; 18,407 entries; 1,776,608,472 logical fingerprint bytes; 18,407 read calls |
| Eligibility | 18,407 first-pass decision writes; 185 bounded batches; no Triage-induced writes |
| Procurement | 12 concurrent Runs, all sealed; 955 Work; 1,080 Plan; 3,926 Event/Attempt/Result; 4,057 ResourceTiming |
| BDMV Assessment | 59 BDMV containers; 59 resolved; 59 BDMV Units/Candidates; 0 BDMV-internal generic Probe Event |
| Handoff A Ready | 942 Candidate Package and 942 open Offer; none consumed; 122 Related references |
| Related safety | BDMV-internal and video-payload Related references 0; no STREAM title Candidate; ordinary Candidate 883 |
| Safety | failed Work/Event 0; defer 0; RSS peak ~0.78 GiB; integrity check ok; Libra/Arca facts 0 |
| Recovery | one active restart; no reread of committed Observation pages or duplicate Run/Candidate/Offer |
| Timing | first Structure 131.5 s; first Offer 141.8 s; all Runs sealed 335.6 s; total 341.9 s |

临时资产未删除：最新为`C:\\Users\\markm\\AppData\\Local\\Temp\\helix-full-movie-canary-VFP6wA`；此前`RN9eJJ`、`RD3ta3`及中止轮次同样保留。

本次重跑前修复了Related关联的两个边界：Observation Scope Projection补回同目录/BDMV外部sidecar，且Related筛选排除同stem视频载荷（包括`.m2ts`）及全部BDMV内部路径。只读数据库审计确认`forbiddenRelated=0`，没有把视频文件或BDMV结构文件误记为Related。

## 0. Retake status

以下条目保留为第一次实施、早期Checkpoint和旧Canary的追溯记录；若与本文件顶部当前证据冲突，以顶部111/97/180/43合同、18,409文件正确性结果及“Candidate修正已验证、端到端绝对性能未过线”状态为准。

- 当前分支以第一次实施关闭点及其细化后的SSOT为基线，不合入第二、第三次实施代码。
- 当前目标不是重新搭建完整骨架，而是接通已有Foundation、重写Procurement Coordinator执行方式、恢复`Run → Work → Event`三层架构，再完成有效的Handoff A Ready E2E；到此停止，不进入Libra。
- 用户已撤回“全局只能有一个Procurement Run / 每次只能创建一个Run”的早期设想。多个`active|waiting` Run可以共存；Run创建不申请计算资源，实际资源约束由Execution Foundation在Event执行前处理。
- SSOT的Procurement专属Selection上限调整为256，并固定Run Creator规则：terminal Observation按Field-relative直接父目录分组；同组不可跨Run；组和成员均按canonical UTF-8排序并顺序装箱；单组超过256返回稳定closed reason；一次reconcile创建当前全部可创建分片。
- 一个Procurement Run可发布`0..N` Candidate Package；每个Package独立形成Handoff A Offer，无需等待Run Seal；Run Seal只表示Selection全部收口，不等待Offer Accepted/Rejected。
- Admin Web“文件来源”已接入clean Admin session、Material Field查询与登记API；“上架进度”明确从Procurement之后开始。
- `observe`产品动作已切为Procurement-only：Candidate Publication之后返回`handoff_a_ready`，不调用Libra `offerCandidate`；Coordinator保留显式`advance`方法，供未来单独验证Libra以后链路。
- 隔离fixture曾证明同步Coordinator路径可建立immutable Candidate Package及open Candidate Delivery，重启重放保持同一Package，Libra/Arca事实为0，源文件字节不变；该结果仅保留为低层Capability与Owner事实诊断证据。
- 真实`Z:\Film`预检得到18,406个文件、约14.3 TB，其中2,287个视频；第一次真实观察稳定返回`FIELD_OBSERVATION_SCAN_BUDGET_EXCEEDED(maximumFiles=10000)`，提交前事实仍为Observation 0、Material 0、Candidate 0、Libra 0、Arca 0。
- 该历史结果确认第一次实施的Enumerator先全量收集、后全量SHA-256且automatic Run尝试一次纳入全部eligible Material，未实现后台分页吞吐与新的直接父目录分组、每Run `1..256`稳定分片；该Physical Identity合同现已被v2正式替代。
- 单Movie真实Canary Field `Z:\Film\银翼杀手：2022黑暗浩劫 (2017)`已完成：7项Observation、1项eligible Primary、真实SHA-256及FFprobe、resolved single/movie Triage、一个immutable Candidate Package和open Delivery；产品状态持久投影为`handoff_a_ready`，Libra/Arca事实为0。
- Canary主视频为HEVC 1080p、AC3 stereo、内嵌SubRip，时长906,976 ms；提交后SHA-256仍与Observation `d2b7d2db...1ee77`一致，媒体未改变。
- 上述两个Canary质量Finding已在Procurement边界内闭合：Candidate Assembly新增正式`shared.material.layout.observe@1`纯观察阶段，从每个Primary的有界父目录生成immutable Layout Evidence；Triage按`directory_title → filename_title → temporary_label`选择标题，并只从Evidence生成Related Reference。Related不进入Run、不取得Material Control。
- 第二个真实Canary Field `Z:\Film\香火 (2003)`已完成：4项Observation、1项eligible Primary、正式Layout/Media Probe/Triage/Publication执行链，Candidate display identity为`香火 (2003)`，Related精确包含NFO、poster、fanart共3项；Run member和受控Material均只有主视频1项，Libra Intake/Run与Arca Entry均为0。
- Admin Web现提供SSOT精确的“注销文件来源”动作及两步后果确认；它保留tombstone/审计并保证物理文件不变。Material Field查询现持久投影Candidate/Handoff A状态，避免刷新后重复观察。
- 验证只使用本机Node.js与临时数据库；不使用本地Docker，不部署NAS，不修改生产数据。
- Execution Foundation封口修订已进入唯一SSOT：Event允许有界并发，Host技术上限为16；资源只使用typed Resource Key；
  terminal Work发出精确Process reconcile，丢失signal由启动时及每30秒一次的持久cursor fallback sweep恢复；Domain只允许注册
  Planner、Capability、Resource Demand、Effect Recovery、Reconciler及Execution Projection，不得改变Foundation状态机。
- clean schema新增`fx_reconcile_cursors`，当前机器合同计数为112 Capability、97 Result family、179 table、43 canonical
  transaction、113 Admin route及1条public health；active contract aggregate digest为
  `e70fc7248ee9463c2e91cdaaba7d1a3a873d407845ffda37b7ecb04f4319feb2`。
- Foundation conformance已通过：P4 runtime gate覆盖7类Effect与31个crash-window场景；205个Active Process三页sweep、durable
  cursor重启、lost wake、最多16个in-flight、同/异Resource Key Permit、soft-cap completion、retry/defer/timeout均通过。
- Procurement产品压力fixture已通过：260个Candidate需求、2个并存Run、260个Candidate Assembly Work、260个Package、260个
  open Offer、全部Run Seal、零failed Work/Event；开放Work始终不超过256，且首份Offer在全部Run Seal之前出现。
- Canary脚本本地4文件smoke已通过：1,048,576 logical bytes精确等于`4 × 256 KiB`，2 Work/2 Plan/12 Event全部成功，
  source Reality前后一致，Offer消费及Libra/Arca事实均为0。该smoke不替代最终真实全库Canary。
- 2026-08-02最终全库Canary由Luna执行并按用户要求手动终止：Observation 1,151、Material 18,406、8个active Run、
  1,157 Plan、4,357 succeeded Event/Result，零failed Work/Event及零Resource defer；读取1,776,596,696 bytes且每文件只读一次，
  RSS约1.05 GiB。只读复核确认3个Structure Page已持久化62个resolved Unit；Candidate Work因open Event处于约506–508、
  高于256 admission high-water mark而等待下一批接纳，不是数据丢失或永久死锁。PID 37892已退出；因手动终止，尚未证明水位
  下降后的Coordinator retry/Handoff A liveness，也未执行sourceAfter，不能作为封口证据。等待状态的用户显性化暂不属于当前范围。
- 既有同步Canary绕过了产品形态的Work Scheduler、Event Runtime与Resource Governor，且使用已废止的全文件SHA-256 Physical Identity；自本轮起不再是有效Foundation E2E、Handoff A Ready或当前Identity合同的验收证据。
- Checkpoint 1已完成：SSOT、Procurement runtime validator、schema builder、生成合同及deterministic DDL已同步；当前计数为112 Capability、97 Result family、179 table、43 canonical transaction及113 Admin route（另有1条public health）。
- Checkpoint 1本地Node证据：合同/Source Map/DDL聚焦门禁111/111 PASS，P7 Procurement fixtures 58/58 PASS，dependency/semantic/manifest/contract聚合均PASS。完整历史Architecture聚合仍只有既知8个P14失败（同一8项在输出摘要重复列示），不把它们误报为本Checkpoint引入或修复。
- Checkpoint 2已完成：唯一Composition Root装配Work Scheduler、Planner Registry、Event Runtime、Resource Governor、Capability Registry/Dispatcher、Result Binding、Startup Recovery及Node进程内Runtime Host；HTTP只签发Work并`wake`。
- Checkpoint 3已完成：Observation成为可分页、可重放的后台Supporting Work；terminal Observation后按直接父目录确定性分组并创建全部可成立的并存Run；Run Admission不申请Permit。
- Checkpoint 4已完成：产品路径挂载薄`ProcurementRunCoordinator`，只读取Owner/terminal Work事实、幂等签发Evidence/Candidate Work并执行短Run Seal事务；Planner和Event Runtime独占Plan与Capability执行职责。旧同步Coordinator不再由产品Composition Root引用。
- Checkpoint 4分页证据：同一Run的65个Movie Primary形成2个Observation revision、1个Evidence Work的3个immutable Attempt、65个Candidate Assembly Work、70个Plan、333个Event/Attempt/Permit timing、65个Candidate Package及65个open Handoff A Offer；最终Run为`sealed/completed`，Libra/Arca事实为0，所有源文件字节不变，服务重启后同一Observation命令精确replay。
- 该证据同时暴露并修复两项Foundation死锁：Work Supply backlog soft cap现在只阻止新Work Attempt而不阻止既有Event排空；Resource Governor不再以第二套隐藏队首覆盖Scheduler lease，仅对已选Event执行per-Capability完整Permit bundle仲裁。
- 2026-08-02 Checkpoint 4聚焦回归：Foundation、Coordinator静态边界、合同/事务、Admin Web及65-item产品E2E共53/53 PASS；合同基线保持112 Capability、97 Result family、178 table、43 canonical transaction，aggregate digest为`a2ac8d37e73c18e24c97be4e21e338df6ebe2fd7349f35972d7e20ea8ac8c63a`。
- 2026-08-02 Checkpoint 5 Design Return：SSOT已将唯一Physical Material合同替换为`PhysicalMaterialIdentity@2`；Capability以
  `shared.material.bounded_fingerprint.compute@1`一对一替代旧content-hash，Result family以
  `BoundedContentFingerprintEvidence`一对一替代；该Design Return当时的合同计数为112/97/178/43/113，aggregate digest为
  `4e8979a6ea3fb877bdc8166fccb877f6c766f8459ecef098c0321a526f33bf14`。
- 运行时已实现精确中段最多262,144-byte读取、零长度、短读/消失/权限/symlink失败及inode/size/mtime/ctime前后stat fence；
  Procurement、Material Control、Libra Binding/Workspace、Candidate/Manifest及Arca引用均传播同一Identity v2。Artifact与系统Evidence
  digest仍可使用完整SHA-256，但不得冒充Physical Material Identity。
- Observation适配器恢复合同上限100项，并采用保守的16项物理批次避免64 KiB typed page截断后游标跳过文件；异常大批次明确失败，
  不提交跳跃游标。当前bounded fingerprint与Observation专项20/20 PASS，尚未读取真实Movie Field。
- 2026-08-02验证：`npm run build:web` PASS；`node --test test/admin-web-contract.test.js` 9/9 PASS。
- 2026-08-02 root-title/Related修复验证：通用`npm test` 232/232 PASS；P7 Procurement fixtures 57/57 PASS；新增/相关Layout、Triage与generated application contract fixtures PASS；真实`香火 (2003)` Canary到`handoff_a_ready` PASS。完整历史Architecture聚合仍有8个P14失败：7个旧Series/JAV/Western/全链HTTP fixture与当前Movie-only fail-closed产品入口冲突，1个旧H1分支scope guard拒绝retake工作区；不把它们误报为本修复PASS。

- 2026-08-09 Layout性能修订已进入实现：SSOT新增Field Observation Layout Snapshot；Triage Layout改为按唯一父目录的本地Snapshot Event，取消每个Material一次物理Layout读取；Media Probe仍为独立的选中Material Event。全量Canary需重新验证首个Candidate延迟、Layout Event数量及源读取预算。
- 2026-08-09 Triage Unit/Candidate Assembly性能修正已完成：新增运行时可重建`TriageEvidenceIndex`，按`runId + unitId`共享不可变Candidate Context；Identity、Manifest、Publication三Event不再重复读取完整Run、完整Structure Result或整Field Material。未新增业务对象、Capability、Result family、Admin route或表。
- 2026-08-09 BDMV边界结论已写入唯一SSOT：BDMV是pre-triage拓扑container group，不是Movie类别。最近`BDMV`祖先目录下的全部terminal Observation成员必须作为不可拆分组进入同一Run；多个完整group可按稳定顺序装入同一Run，单组超过256项时整体不建Run。Structure消费完整group，解析Playlist、Clip与结构依赖后形成单标题Triage Unit；内部M2TS不得各自产生Candidate，多标题/歧义/不完整保持`not_ready`。Run Admission前必须完成所需结构成员的Observation、Eligibility和Control，Triage不得事后静默扩张。本结论目前是Design合同记录，尚未宣称新增实现或多片段BDMV Remux已完成。
- 同日隔离只读MVP `media-service/scripts/helix-bdmv-mvp.js` 已在两个真实样本上验证 `PLAYLIST → STREAM/CLIPINF` 关系：单Playlist样本形成单标题证据；第二个样本包含14个Playlist、18个Stream，按去重后的物理Stream大小选出`00021.mpls`主标题，未读取任何视频payload。该MVP证明结构解析可落地，但不等于正式Structure接线，也不证明当前Libra Remux已支持多片段BDMV。
- 性能修正后的全量只读Canary使用临时clean数据库`C:\Users\markm\AppData\Local\Temp\helix-full-movie-canary-a1wcjf\data\shelfdeck.db`完成（恢复启动后继续 durable Work/Event事实）：18,407文件、8/8 Run Seal、1,751 Candidate Package、1,751 open Handoff A Offer、1,751 Candidate Assembly Work、8 Evidence Assessment Work、10,440 succeeded Event/Attempt/Result/ResourceTiming、2,960 Plan；`failedWorks=0`、`failedEvents=0`、Libra/Arca事实为0。
- Canary源Reality前后均为18,407文件，digest均为`a630ecf5b86c0da2541b5e53fae2bc6e5aa8d28fd181b7d6ce6c770042eb316d`；Physical Material累计读取为`1,776,608,472` bytes、18,407次文件读取，Observation后恢复阶段逻辑读取为0，未发生源写入/移动/删除。最大观测RSS约1.26 GB，低于2 GiB；最终`integrity_check=ok`。
- 恢复验证：原Canary进程中断后保留原数据库，恢复Runtime从durable事实继续；恢复前3/8 Run已Seal、1,403 Candidate，恢复后继续至8/8 Seal和1,751 Candidate，没有重复Unit、重复Primary Material或重复Offer。原管理凭据保留为`admin-credential-secret.resume-backup-*.json`，未删除临时资产。

## 1. Current position

| Field | Current state |
| --- | --- |
| Architecture | `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md` Level 0–10 accepted and final audit closed |
| Open business decisions | none |
| Implementation program | clean-cut Master Plan accepted as direction |
| Completed phases | P0 — implementation gap audit；P1 — Clean Skeleton and Architecture Guards；P2 — Contract and Schema Baseline；P3 — Persistence and Atomic Foundation；P4 — Execution and Recovery Foundation；P5 — Platform and Integrations；P6 — Horizontal Domains；P7 — Procurement；P8 — Handoff A and Libra front half；P9 — Libra production and delivery；P10 — Handoff B and On-deck；P11 — Arca post-deck；P12 — Product surface；P13 — Operational cutover and E2E-ready package |
| Current phase | Formation durable Projection local cutover and service recovery |
| Current phase status | Projection已迁移到现场并重建659行；服务已恢复，active首屏25条，队列继续推进 |
| Implementation Gate | standing Local Implementation open for P2–P13；external actions excluded |
| Current allowed work | 只做现场恢复后的只读验收和UAT台账收口；Production/NAS、Z:\Film全量Observation及外部重同步仍不在范围 |
| Integration baseline | P13 implementation closure `bd75e7e4`；P12 closure `23e3b930` |
| Phase worktree | `E:\my_project\emby_third_party-helix-retake` on `codex/helix-first-implementation-retake` |
| Next action | 保留现场服务和回滚备份；将Arca目标冲突作为独立UAT问题复盘，不把它与Projection切换混合修复 |

P9-01已完成：反向实现审计证明的六段连续性缺口已由Architecture Agent在`PBF-13/PBF-13-R1`中闭合，并经实现侧
只读复审后原样纳入。Run、Material/Episode scope、Workspace、完整Package、Discard/Cleanup及Off-load Reclaimer均具备
typed DTO、Owner row恢复、revision/CAS和原子事务连续性；112/97/176/43机器合同完成重物化。Product Delivery与
Workspace Reclamation public boundary、8个Libra production application schema及越权反例已冻结；完整Architecture
gate 679/679 PASS，`findings=[]`、`prohibitedActionsRun=[]`。旧实现复用结论不变：拒绝旧Capability wrapper、
Task/Node设备池、Metadata Provider adapter、路径/时间GC和正式目标replace函数；只允许在新合同内原子化提取pure FFmpeg
command/progress、disc parser、Workspace文件不变量和设备识别测试向量。

P9-02已完成：Run Creator从Libra Subject/Decision Head/Acceptance Spec/Binding owner rows与同事务Material Control
snapshot建立immutable Run Input Manifest及Execution Basis；initial/replacement、single/Season scope exclusivity、
active scope head CAS、旧Run supersede、Priority继承、durable Result/marker replay和crash rollback均已闭合。完整Architecture
gate PASS，103 fixture files、`findings=[]`、`prohibitedActionsRun=[]`；无Outbox、跨Store补读、兼容路径或旧Runtime fallback。

P9-03已完成：Lifecycle从immutable Run Basis/Manifest、current Subject Decision/Spec/Binding及historical/current
Material Control在同一事务重建Comparable Basis；fixed bounded recovery、active-only Priority、typed terminal freeze、
published Package custody fence与Handoff B accepted consume均闭合。Run/head双CAS、完整Evidence/recovery revision、
Delivery Receipt/Inbox、typed Result/marker具备replay与crash全回滚反例。Architecture Agent的`P9-03-R1/R2`修正已
原样纳入；完整Architecture gate PASS（105 fixture files，`findings=[]`），P2 aggregate为
`1391aa06c35df31c46aeb3221ead3e4cee684d383964233a8b81e1a5718ced9c`。

P9-04已完成：Workspace Admission从active Run及typed Platform Root/Space Evidence建立pathless Registry、Workspace、
首个revision、Result/marker；完整`WorkspaceMaterialHandle@1`进入Foundation Material并以read-only fence约束。Libra
Workspace Reference以append-only revision保存Handle、Episode claims及可选Product Verification，working到
product staging promotion执行Workspace/Reference双连续性、Owner-row replay和同事务CAS；crash、伪造Handle、跨Handle
Verification及非法转换反例全部PASS。完整Architecture gate PASS（108 fixture files，`findings=[]`），P2 aggregate为
`530909a2cd450d3638286cb8966ccd6d11bfca67e591da412bd4542ddb8db1a9`；Evidence见
`implementation/evidence/P9_04_WORKSPACE_ADMISSION_AND_REFERENCE.md`。

P9-05已完成：Movie/Series/JAV Metadata只从显式durable Observation链按固定顺序补缺；Western Analysis把Result内部领域
digest与Foundation完整typed Result storage digest分开验证，并冻结Analysis→Normalize→Commit及Match→Cast连续性。
Product Metadata Commit显式提交nullable `mediaCastFactRef`，非NULL只精确读取同Run immutable Media Cast Fact；Artifact
Requirement、Handle、Verification Result、Manifest、Product Fact及Source refs均可从Owner/Foundation rows重建。完整Architecture
gate PASS（111 fixture files，`findings=[]`），P2 aggregate为
`fd28a03618c383e694933867719478fbf24f263571cfbe0b7880b55fb9696633`；Evidence见
`implementation/evidence/P9_05_PRODUCT_FACTS_METADATA_CAST_ARTIFACTS.md`。

P9-06已完成：Media Requirement只从同一immutable Acceptance Spec完整派生；Primary stream、direct/workspace Handle
provenance、Artifact Requirement continuity、显式rank Output Selection及六组pure Product Conformance均已闭合。
Effect Journal restart/replay只返回同一Workspace output。Architecture Agent主动复审接受`4267410f`；聚焦15/15与接受点
完整Architecture 768/768 PASS。Evidence见
`implementation/evidence/P9_06_MEDIA_PRODUCTION_OUTPUT_CONFORMANCE.md`。P9-07的PBF-16 exact机器合同与P5 operation已在
`6ace8501`重物化，计数保持112/97/177/43，当前等待架构主动复审后进入Runtime实现。

Architecture Agent提交`a570be44`的`PBF-13`已通过实现侧只读复审：六段生产连续性均可从正式输入、Owner rows、
revision/digest/CAS及事务边界唯一实现；计数为112 Capability、97 Catalog Result family、176 tables和43 Canonical
Transactions。未新增Domain、Owner、Store、Handoff、Capability、跨域写入或用户业务决策；实现线程未修改SSOT正文。

本Program终点已由用户确认为P13：P13完成operational clean-cut并冻结最终E2E-ready package后，本线程即完成，不再设置后续实施Phase。
真实来源完整E2E与部署将分别由后续独立任务承担；部署任务只消费通过独立E2E验收的精确Artifact。该调整只涉及工程计划和交接
责任，不修改架构SSOT，也不扩大当前Local Implementation授权。

P8已完成并归档：Handoff A Accepted/Rejected、FA-04 Subject continuity、Subject/Binding/Control/Receipt原子连续性、
Receipt publication、Decision Basis、Routing Decision与Acceptance Spec H0→H4 head CAS均由Owner rows完整历史恢复。
最终合同固定为112 Capability、97 Result family、169表、38 canonical transaction；七项Libra front-half Capability、
12个P8 fixture files、Architecture/Persistence及P4–P7回归PASS。Exit Audit返回`findings=[]`、
`prohibitedActionsRun=[]`，未进入Workspace production、Handoff B、Arca、API/UI/startup或外部副作用。P8详细包见
`implementation/archive/P8_HANDOFF_A_AND_LIBRA_FRONT_HALF.md`，Exit Evidence见
`implementation/evidence/P8_11_EXIT_AUDIT.md`。P9尚未打开。

Architecture Agent提交`be3ecb89`已闭合`PBF-11`。实现侧逐项复审确认：Candidate Delivery正式携带完整
Manifest及逐Material Location Evidence；Subject/Binding Episode关系均可N:M持久化；global continuity head与唯一
extension target intake revision形成双CAS；Resolved Identity exact Claim先关系化后匹配；新Subject identity pointer为
nullable；Accepted payload冻结Offer/Basis/Resolution/Binding/Control全部连续性。Handoff A事务精确写入10张Libra表和
5张Foundation表，总表数由163调整为168；未新增Domain、Owner、Store、Handoff或Capability。该提交已原样纳入，
本线程未编辑SSOT正文。

Architecture Agent提交`5d5e37c9`的`PBF-11-R1`已通过实现侧只读复审：既有
`proc_candidate_related_references`逐列保存完整Physical Identity、association Evidence与reference digest，正式支持
Candidate/Run/Offer关闭后的历史Package/Snapshot重建；Candidate Publication 8+3事务与168-table inventory保持不变，
没有新增Owner、Store、Handoff、Capability或Fallback。

Architecture Agent提交`f99428ce`的`PBF-11-R2-R2`已通过实现侧只读复审：Candidate Delivery只允许一次
`open → accepted|rejected` CAS，Run Material Reservation只允许closed transition；Accepted/Rejected Procurement consume
均以Delivery、全部Candidate members、同一Receipt Evidence及Inbox result全有或全无并可从terminal Owner rows重建。
总量保持112 Capability、97 Catalog Result family、169表；未新增Domain、Owner、Store、Handoff或兼容路径。

Architecture Agent提交`19ed12fa`已闭合`PBF-07-R1`：Page正式收敛为≤65,536 UTF-8 JCS bytes，完整Page作为
Commit Event immutable typed Evidence保存，并通过Observation→Marker→Result Binding形成禁止GC的历史恢复链；
精确Transaction Contract同时决定Outbox cardinality，Field Observation固定零Outbox。实现线程精确纳入该提交后恢复P7-03。

Architecture Agent提交`f838b63d`的`PBF-11-R3`已通过实现侧只读复审：Handoff A Accepted Control revision set
具有唯一成员、排序和JCS digest公式，并绑定expected/committed projection、from/to scope、Payload及Commit Handle；
current Control后续变化时仍可从historical revision重建同一Receipt。112 Capability、97 Result family、169表和
15表事务边界保持不变，未新增Owner、Store、Handoff或兼容路径。

Architecture Agent提交`761a954f`的`PBF-12`已通过实现侧只读复审并原样纳入：Routing、Decision Basis与
Acceptance Spec现在具有正式typed DTO、唯一ID/digest公式、revision/head CAS、完整Owner rows历史重建及三项
canonical transaction；Subject Field/profile provenance和Arca只读Projection freshness连续性已闭合。保持112项
Capability、97个Catalog Result family和169张表，Canonical Transaction由35项增至38项；没有新增Domain、Owner、
Store、Handoff、Capability、跨Store补读或P8提前创建Run/Workspace。

Architecture Agent提交`72df5a9d`的`PBF-12-R1`已通过实现侧只读复审并原样纳入：每份Decision Basis把完整pre-CAS
`SubjectDecisionHeadSnapshot@1`作为唯一typed relation保存，Basis row/result冻结expected revision与snapshot digest；
首次revision 0、后续Head CAS、semantic replay和重启恢复均可只由Libra Owner rows唯一重建。112 Capability、97 Result
family、169表和38项Canonical Transaction保持不变，未新增Owner、Store、Handoff或跨域补读。

P8-06已完成：accepted Decision、Subject create/extension、continuity/Episode关系、N:M Material Binding、全部Primary
Control transfer、SubjectAndTransferReceipt、Result/Marker及Accepted Outbox在canonical 15表事务中全有或全无。
Handle Owner固定为接收/提交Owner Libra，来源Procurement scope仅由Payload冻结；Control set digest由expected/committed
historical Projection唯一重算。replay、stale head及Outbox crash反例和完整96-file Architecture gate PASS；Evidence见
`implementation/evidence/P8_06_HANDOFF_A_ACCEPTED.md`。下一工作包P8-07。

P8-07已完成：Libra Accepted/Rejected typed Outbox与Procurement Delivery/Reservation/Inbox收口对称闭合；Procurement
不读Libra Store，Accepted不二次转移Control，Rejected不改写Control，terminal replay与Inbox crash反例PASS。Evidence见
`implementation/evidence/P8_07_RECEIPT_PUBLICATION.md`。P8-08实现前审计发现Routing/Acceptance Spec缺正式DTO、唯一digest、
head CAS和canonical transaction连续性，且`AcceptanceSpec@1`把canonical contentProfile `series`误写为`season`；精确Design
Return已发送Architecture Agent，本线程未修改SSOT，受影响路径暂停。

P7-03现已完成：PBF-07-R1重物化提交`3c6e6d6a`冻结64 KiB Page/Result、Observation→Marker FK及25项事务；
实现提交`15f27b7b`提供pure bounded Observer、Procurement-owned Observation/Material revision Store与canonical Transaction
Registry。完整Page作为immutable typed Evidence持久化并可由marker replay恢复；Field head/access/work/page/cursor CAS、Material
binding revision、reality变化后的Eligibility reset、signed int64无损和零Outbox均有机器反例。完整Architecture tests
`526/526 PASS`，未运行E2E、Docker、部署、真实Field/媒体副作用，未修改`media-desktop`，本线程未编辑SSOT。

P7-04实现前审计已返回Design：Eligibility mandatory formula需要可执行Extraction Policy、current duplicate-extraction
suppression、Selection conflict和versioned Material Control Projection；当前Policy只是任意`policy_json`，没有Beta rule schema/
precedence，Procurement没有suppression事实，Control read也没有带revision/freshness的正式Projection，Material current row无法阻止
旧reconcile覆盖新Projection。实现线程未默认allow/无suppression，未旁读旧Store，未修改SSOT。完整缺口见
`implementation/evidence/P7_04_ELIGIBILITY_RECONCILE_DESIGN_RETURN.md`。

Architecture Agent提交`2ff2f60d`已闭合`PBF-08`：固定Beta `ExtractionPolicy@1`及唯一reason precedence，
删除错误的Procurement duplicate-suppression前提，补齐versioned `MaterialControlProjectionSnapshot`、
`ExtractionEligibilityDecision/Batch/ReconcileSummary`、stale-safe CAS、terminal missing、批事务与restart收敛合同。
该修正不新增Domain、Handoff、Capability或关系表；P7-04实现阻塞解除。本实现线程只原样纳入SSOT delta，未自行修改SSOT。

Architecture Agent提交`b6505e93`与`6f137a71`已闭合`PBF-09/PBF-09-R1`：Procurement Run Admission/Seal/Retry、
relationized Execution Basis、Field-scope Control、Candidate Delivery Reservation、Run Seal逐成员Evidence及三项digest、
Retry五项digest/closed stale reason/replay snapshot，以及Procurement-owned immutable Triage Rule Registry均已有精确合同。
实现侧复审确认没有新增Domain、Handoff或Capability；关系表调整为162张，96个Catalog Result family不变，阻塞解除。

P7-04现已完成：`4c4a2c8a`把PBF-08精确传播为112/96/161/26机器合同，`9419e8f5`实现closed Policy验证、
pure Eligibility evaluator和versioned Material Control Query，`5a36fdbc`实现同一SQLite Unit of Work内的Foundation
Control批量重读与Procurement Reconcile。Batch按Field和最多100个排序Identity有界；事务重读Field/Access/terminal
Observation/Policy/Material Binding/Selection/Control，逐项拒绝stale basis，以Eligibility revision CAS原子更新current row；
相同Batch重放为no-op，且不写Event Result、marker或Outbox。聚焦反例、完整Architecture `533/533`和P3 Persistence
聚合门禁均PASS；未运行禁止的外部动作，本线程未编辑SSOT或`media-desktop`。证据见
`implementation/evidence/P7_04_ELIGIBILITY_RECONCILE.md`。

P7-05实现前审计已返回Design。当前`SelectedFieldMaterialSet`只携带最多4096个material key，既允许空集合，又缺少
role、Binding/Eligibility/Reality Evidence、Triage revision和expected Control revision；该上限还与1024项
`ResponsibilityControlCommitHandle`/`ProcurementControlReceipt`及当前Control原子边界冲突。`proc_procurement_runs`
只保存opaque `run_basis_digest`，`proc_run_materials`只保存key/role/binding revision，无法持久化和重建§6.1.4、
§6.3.2要求的可审计Execution Basis。SSOT也没有闭合Run admission/seal的正式原子事务，以及Retry Intent创建后的
open→consumed/stale CAS、新Run唯一建立、typed Result/Outbox与重放连续性。直接实现将迫使本线程私自缩小合法输入、
发明Basis字段或旁读current row冒充冻结事实，因此已停止P7-05代码。详见
`implementation/evidence/P7_05_RUN_ADMISSION_DESIGN_RETURN.md`；本线程未修改SSOT。

P7-05现已完成：`5fdbcb8f`实现ordinary Run Admission，`90afe83f`实现Run Seal，`dcf2fb87`实现Retry Intent Create，
`3b2f4db5`实现Retry consume的stale/created原子分支。完整`1..1024` Basis/Selection、Field-scope Control acquire/assert、
Seal terminal Evidence、Retry五项digest、13项closed stale precedence、业务幂等重放、唯一新Run及共享outer result/marker均有
隔离SQLite反例。Retry Access/Observation/Policy、create/consume marker及Intent↔Run连续性已物化为显式FK；全量Architecture
564 tests、112/96/162/30合同门禁PASS，aggregate为`a53d55146ff40db11d82e188757e383f81960e7fdddaceed01ab094020641c32`。
未运行禁止的外部动作，本线程未编辑SSOT或`media-desktop`。Evidence见
`implementation/evidence/P7_05_RUN_ADMISSION_AND_RETRY.md`。

P7-06实现前审计已返回Design：Primary Manifest正式输入仍由最多4096个key的浅`SelectedMaterials`、无成员映射的
`Roles`及opaque `Structure.memberClaims`组成，无法唯一形成SSOT要求的1..1024个Material→Role→Episode Claim/
Binding成员；Structure/Playability缺少closed deterministic rule和typed Evidence来源，Identity Claim与Candidate Readiness
之间缺少mediaType连续性。实现线程未按数组位置猜测、未旁读Store、未把路径/标题升格为Identity，并已将精确问题包发送给
Architecture Agent。详见`implementation/evidence/P7_06_TRIAGE_PIPELINE_DESIGN_RETURN.md`。

Architecture Agent提交`48d6cac5`已闭合`PBF-10`：四个Triage Capability现在具有exact named typed input/output；
完整Run Selection以`1..1024`成员、显式Material→Role→Episode Claim/Binding/Control映射贯穿Probe、Structure Unit、
Manifest Draft和Candidate Publication；Shared Media Probe/Layout只负责现实读取，Triage Executor保持pure；Playability、
Structure和Identity/Profile均有closed rule、reason、digest及持久化连续性。Primary Manifest ordinal固定从0开始。
实现侧只读复审确认没有新增Domain、Owner、Handoff、Store、跨域写入或Capability；仅新增一张Procurement-owned
Candidate Member↔Episode Claim关系表，SSOT总表数为163。本实现线程仅原样纳入架构SSOT delta，未自行修改SSOT。

P7-06现已完成：PBF-10已重物化为112 Capability、96 Result Family、163表、30 canonical transaction和199个
resolved type ref，aggregate为`fe383269c415f6ca1f8c293018abf625e9db9fed6a02fb185ceace03fa02cfc5`。
四个pure Triage Capability实现Probe Batch显式成员映射、closed Playability reason、Selection完整覆盖与paged
Structure Unit、Series Episode Claim、Identity Claim的mediaType/contentProfile连续性及ordinal从0的Manifest Draft。
567项完整Architecture fixture、85文件/125依赖和1514 semantic files全部PASS，findings与prohibited actions均为空。
未运行E2E、Docker、生产或真实媒体副作用，未修改`media-desktop`。下一工作包P7-07。

P7-07实施前反向审计发现Candidate Publication机器Transaction遗漏
`proc_candidate_primary_material_episode_claims`。Architecture Agent提交`17bb9974`以`PBF-10-R1`闭合：domain
participant固定7张Procurement表，Foundation participant固定3张表，`writeTables`为精确10张并集；Episode Claim、
全部relation、Reservation、Offer、typed Result、marker与Outbox保持全有或全无。实现侧只读复审确认表总数仍为163，
没有新增Domain、Owner、Store、Handoff或Capability；P7-07阻塞解除。

继续实施审计又证明三项正式输入仍未闭合：Delivery必填`acceptance_basis_digest`没有来源或digest公式；原子Offer
缺少稳定`offerId`及正式Outbox message/schema/dedup payload；Candidate DTO与持久化表使用两组不同continuity kind且
没有映射规则。以上事实进入Libra Intake，不能由实现默认推断。P7-07已再次返回Design，详见
`implementation/evidence/P7_07_CANDIDATE_PUBLICATION_DESIGN_RETURN.md`。

Architecture Agent提交`ea702945`以`PBF-10-R2`闭合上述三项：Acceptance Basis由final Package与公开Handoff A
合同按唯一JCS/SHA-256公式派生；Offer ID、message ID、consumer、dedup和typed payload均可重放；continuity kind
全链路采用唯一canonical枚举，不设别名或转换层。Candidate Package保持8.6.19完整字段且不包含Offer字段或`subjectId`。
实现侧只读复审确认未新增Domain、Owner、Store、Handoff、Capability或关系表，P7-07恢复实施。

进一步原子事务审计证明Run `candidate_package_revision_head`必须执行CAS，但PBF-10-R1的机器写集遗漏承载该head的
`proc_procurement_runs`。Architecture Agent提交`52382fc7`以`PBF-10-R3`闭合：该Run表现同时属于CAS fence read和
Procurement domain write participant，Candidate Publication最终为8张Procurement表加3张Foundation表的11张精确
write table；Run head与Package、relations、Reservation、Offer、Result/marker、Outbox全有或全无。163张表总量及
PBF-10-R2全部合同保持不变，P7-07继续实施。

P7-07现已完成：PBF-10-R2/R3机器合同重物化保持112/96/163/30，Candidate Publication以精确11表事务原子CAS
Run revision head并发布Package、Manifest、Season/Episode/Related关系、Run Material Reservation、Delivery/Offer、typed
Result、Commit Marker与`fx_outbox`。Package-derived Acceptance Basis、stable Offer ID、typed message/dedup、canonical
continuity kind及Structure Evidence连续性均由实现和反例固定；业务重放、stale fence、legacy alias、Evidence不匹配与Outbox
崩溃全回滚测试PASS。未跨域写Libra Store，未写`fx_outbox_deliveries`，未运行任何被禁止的外部动作。下一工作包P7-08。

P7-08现已完成：Procurement的8个P2 Capability以唯一registration layer绑定Foundation Registry/Dispatcher；5个
`pure_observation`、2个`domain_fact_commit`和1个`responsibility_control_commit`保持精确Owner、Effect Class、contract
version与semantic validator。机器反例拒绝缺失/额外Capability、Owner/Effect漂移和untyped port；同步Domain/Control提交未被
伪造成Workflow，registration layer不依赖Runtime、Store或legacy。下一工作包P7-09。

P7-09现已完成：`CandidateDeliveryPort`只接受正式`ProcurementCandidateOfferAvailableMessage@1`，按Candidate ID/revision/
digest读取并返回detached、deep-frozen `CandidatePackage@1`。服务重新计算Package digest、Package-derived Acceptance Basis与
stable Offer identity，任何Package或Offer漂移均fail closed。synthetic Libra重复读取不改变Candidate事实，且边界不拥有
Procurement Store、Subject、Routing、Control transfer、Runtime或Signal Bus authority。下一工作包P7-10。

P7-10现已完成：新增`npm run test:helix-procurement`单命令隔离验收器，自动执行11个P7 fixture family、精确核对
15张Procurement表和8个Capability，并串行回归P2 contract、P3 persistence、P4 runtime、P5 platform与P6 horizontal
聚合门禁。结果全部PASS，`findings=[]`、`prohibitedActionsRun=[]`；全过程只使用synthetic fixture与临时SQLite。下一工作包P7-11。

P7-11正式clean-tree Exit Audit对`e598874463d07fc7419b5ef467cff167ae85109f`返回`ok=true`、`findings=[]`、
`prohibitedActionsRun=[]`。P6 closure后的515个文件全部分类；SSOT精确等于Architecture Agent `5c1d5079`批准blob，
SSOT aggregate为`f72ca6803fff817969d4a6765204a42bcbe46b80493dbc725c314f3687c2be6d`，P2 contract aggregate为
`96fa463bcc745feddb2f342b1babd354017fd88772b694cc6535229d8671c3fc`，Exit Evidence digest为
`96e2bcaede2b92a2754a11705b42346cca64b1dac6de2f4a8fa5870cac526278`。P7已满足归档与自动进入P8的全部条件。

P8-00已完成：从P7 closure `2cf98561d7cf785db4005e65e99b0750d84ce5ce`创建独立
`codex/helix-p8` / `E:\my_project\emby_third_party-helix-p8`。在temporary detached clean checkout上复跑P7 Exit Audit，
12个P7 fixture family、15表/8 Capability及P2–P6聚合回归全部PASS；审计`findings=[]`、
`prohibitedActionsRun=[]`，baseline receipt digest为`8dcd255897b38838f98bec55f00bf60b855b1bf173653a2b8a76681625f21f05`。
下一工作包P8-01。

P8-01已完成：当前Phase只公开SSOT明确命名的`LibraIntakeFacade.offerCandidate`，输入固定为
`ProcurementCandidateOfferAvailableMessage@1`；未为后续Admin、Product Delivery或Workspace Reclamation提前发明方法。
nominal binding拒绝缺失/额外authority，机器边界证明public package不依赖Store、Procurement internal、Runtime、HTTP或startup。
下一工作包P8-02。

P8-02实施前反向审计已返回Design：正式Candidate Delivery没有携带full Primary Input Manifest及Primary endpoint/location的
typed snapshot，Libra无法从public port形成Binding；一个Primary member允许多个Episode Claim，但`LibraBindingDraft`只有单个
`episodeKey`且`libra_material_bindings`的PK无法保存N:M Episode范围，也没有Subject Episode关系供FA-04 overlap计算；Subject没有
Intake revision/head和expected CAS，无法阻止两个并发extension基于同一旧Episode集合同时成功；Resolved Product Identity只保存
opaque provider identity set digest，无法与Candidate exact provider-season claim逐项匹配。此外new Subject的
`current_identity_revision`初值和Accepted payload中的Decision Evidence/target选择authority未闭合。实现线程未旁读Procurement Store、
未压扁Episode、未用timestamp冒充revision、未修改SSOT。详见
`implementation/evidence/P8_02_LIBRA_INTAKE_STORE_DESIGN_RETURN.md`。

P8-02现已完成：Architecture Agent提交`be3ecb89`的`PBF-11`经只读复审PASS，并以原始SSOT blob纳入实现分支。
机器合同已重物化为112 Capability、96 Result Family、168表、30 canonical transaction；Handoff A固定为10张Libra表与
5张Foundation表同事务。新增Libra scoped Store精确拥有这10张表，支持revision `0`的唯一global continuity head、
Subject/Binding N:M Episode关系、candidate/resolved_identity exact Claim provenance、nullable identity初值及完整Decision/Receipt
连续性。完整Architecture门禁89个fixture、47 package、92 files、135 dependencies、1530 semantic files全部PASS，P2 aggregate为
`c03cb78014a196e184be300de2a80657d8e01ced96f05e612858b89a8e3bf8ca`，`findings=[]`、
`prohibitedActionsRun=[]`。Evidence见`implementation/evidence/P8_02_LIBRA_INTAKE_STORE.md`；下一工作包P8-03。

P8-03实施前反向审计已返回Design：`CandidateDeliverySnapshot@1`要求返回完整`CandidatePackage@1`，而Package内每个
Related Reference都必须包含完整`PhysicalMaterialIdentity@1`。现有`proc_candidate_related_references`只保存role、endpoint、
location、checksum和evidence，没有保存identity的materialKey、mountScopeId、inode、content hash或referenceDigest；这些值不能
从checksum反推。Offer关闭后也必须支持historical read，因此不能旁读current row、Foundation Event Result、旧Store或Runtime补值。
实现线程尚未改写Delivery代码或SSOT，精确问题已发送Architecture Agent。详见
`implementation/evidence/P8_03_CANDIDATE_DELIVERY_DESIGN_RETURN.md`。

P8-03现已完成：Architecture Agent `5d5e37c9`的SSOT blob原样纳入；机器合同补齐
`RelatedMaterialReference@1`、`CandidateDeliveryQuery/ReadResult@1`和正式`readSnapshot` Port，并把Related及Episode两条
复合FK物化进DDL。Candidate Publication原子保存完整Related identity；Procurement-owned reader只读8张正式Owner表，
即使Offer/Run已终结也能重建同一Package/Manifest/Location Snapshot digest。完整Architecture 594/594 PASS，90个fixture、
47 package、93 files、136 dependencies、1534 semantic files均无finding；P2 aggregate为
`57d5e116b5cf4a1fcc9595d3e27ba92c60a7626ae72f223fef9255b0b99fb597`，`prohibitedActionsRun=[]`。
Evidence见`implementation/evidence/P8_03_CANDIDATE_DELIVERY.md`；下一工作包P8-04。

P8-04已完成：pure FA-04 resolver固定Candidate Episode scope、0/1/N exact match witness、global/target expected fence、
完整overlap Evidence及Decision digest。只有唯一active exact claim命中且Episode交集为空时返回`season_extension`；无命中、
多命中、缺claim或任一overlap全部返回`new_subject`。标题、年份、路径、目录和模糊分数不进入Authority。专项3/3及完整
Architecture 597/597 PASS，Evidence见`implementation/evidence/P8_04_SUBJECT_CONTINUITY_RESOLUTION.md`；下一工作包P8-05。

P8-05实现前审计已返回Design：`libra_intake_decisions`允许`rejected`，但其`decision_digest`被要求等于只允许
`new_subject|season_extension`的`SubjectContinuityResolutionDecision@1`；Rejected row同时强制非空`target_subject_id`和
`committed_continuity_head_revision`，与“不创建/扩充Subject、不转移Control”冲突。当前表也没有保存完整
`StructuredRejection@1`/`RejectionReceipt@1`所需reason、digest和receipt identity，且缺Libra rejection commit及Procurement
closure的正式事务/Outbox合同，无法保证crash atomicity、幂等消费或历史重建。实现线程未虚构Subject、未推进global head、
未旁读旧Store且未修改SSOT；精确缺口见`implementation/evidence/P8_05_INTAKE_REJECTION_DESIGN_RETURN.md`，已提交Architecture
Agent独立评估。

P8-05现已完成：Architecture Agent的最终CAS修正`f99428ce`经只读复审PASS并以`bc48fdfb`原样纳入。实现closed
rejection、完整Decision/Reason/Receipt持久化、Libra Result/marker/Outbox，以及Procurement Delivery/Reservation/Inbox终态收口；
同时物化Accepted consume合同和原子rollback fixture。P8 focused 8/8、Full Architecture 621/621 PASS，机器基线为
112/97/169/35，aggregate `5280bc3a5271c7f0605892c616927fe47615240f6e2e3acb55ef4c62c4d41463`；Evidence见
`implementation/evidence/P8_05_INTAKE_REJECTION.md`。下一工作包P8-06。

Architecture Agent首版修正`b2b5fb9c`在实现侧反向复审中仍未PASS：Accepted Handoff A Receipt的`scopeDigest`同时存在
`AcceptedIntakePayload.payloadDigest`与“对应Decision digest”两种互斥公式；同时扩展后的通用
`StructuredRejection@1`/`RejectionReceipt@1`被Arca拒绝Capability复用，但Arca Owner Store没有新增字段或关系可历史重建。
实现分支未纳入该提交，两个精确回归已返回Architecture Agent继续闭合。

## 2. Accepted implementation conclusion

clean Helix的业务核心、Persistence、Execution Foundation、Application Facade、API/Auth和Admin Web需要在
`media-service/src/helix/`完整架构重建。旧Libra/Nexora/Kairox/Task主路径不是可增量修补的clean骨架。

保留原则：

- Node/Fastify/SQLite/React等技术栈可以继续使用；
- Provider protocol、FFmpeg、媒体解析、DAG、queue和文件事务算法只能逐函数登记后原子化复用；
- 62个旧业务executor中0个允许整体复制；
- 旧Runtime事实不迁移、不dual-read/write/run、不成为fallback；
- 完整切换前不形成半新半旧可运行产品。

## 3. P0 evidence summary

审计baseline为`4a16f0a94ef23fcf732843e9547bd7b724d9c19d`。关键Evidence：

| Measure | Current implementation | Clean contract |
| --- | ---: | ---: |
| clean root | 不存在 | `media-service/src/helix/` |
| relational tables | 33 | 156 |
| Admin method+path | 80 | 113 |
| literal overlapping Admin route | 11 | not semantic compatibility evidence |
| clean routes structurally missing | 101 | 0 |
| historical business executors | 62 | 0 whole-copy entitlement |
| clean Capability / Result family | 0 implemented | 112 / 96 |

完整28项差距矩阵、删除/重写/保留/原子化复用台账和风险依赖链已冻结在：

`implementation/evidence/IMPLEMENTATION_GAP_AUDIT_4a16f0a9.md`

Audit result: `COMPLETE / CLEAN CORE REBUILD REQUIRED / ATOMIC REUSE ONLY / NO OPEN BUSINESS DECISION`。

## 4. Completed P1 package

P1详细Work Package已归档到`implementation/archive/P1_CLEAN_SKELETON_AND_ARCHITECTURE_GUARDS.md`：

| Work Package | Status |
| --- | --- |
| P1-00 Isolated workspace and baseline receipt | complete |
| P1-01 Clean physical package skeleton | complete；42 unique package markers |
| P1-02 Domain public/internal boundary | complete；5 frozen public entries / 12 default-deny rules |
| P1-03 Unique Composition Root shell | complete；fail-closed / zero import side effect |
| P1-04 Import/dependency guard | complete；42 packages / 6 source files / 5 dependencies / 0 findings；9 positive/negative checks |
| P1-05 Forbidden legacy semantics guard | complete；12 rule families / exact structured exemptions / 6 checks |
| P1-06 Manifest/reuse-ledger framework | complete；10 Owners / 42 packages / 62 baseline locators / stable digest |
| P1-07 Architecture verification harness | complete；single local command / 4 fixture files / JSON evidence |
| P1-08 Phase Exit Audit | complete；PASS Evidence frozen |

P1与P2已关闭；clean root仍未接入`server.js`、`app.js`或任何旧Runtime。P2只冻结合同，不构成Persistence或Runtime实现。

### Completed P2 work packages

| Work Package | Status |
| --- | --- |
| P2-00 Standing authorization and isolated baseline | complete；`c52e67fa` → `f1b5510d` |
| P2-01 SSOT extraction oracle/source map | complete；112/96/156/18；17 shards；10 negative checks |
| P2-02 Shared nominal type/envelope registry | complete；28 JSON Schema；registry digest `af6cb77b…` |
| P2-03 112 Capability contract packages | complete；112 packages / 896 files；final digest `3ffa356d…` |
| P2-04 96 Result family closure | complete；96/96 inventory；191 refs / 0 unresolved |
| P2-05 156 table contract inventory | complete after semantic repair `d96464a7`；156/156；57 closed state enums；148 inline FKs；30 JSON columns |
| P2-06 18 canonical transaction inventory | complete；10 Control commits；19 crash bindings |
| P2-07 Cross-inventory verification harness | complete；single P2 command；aggregate `ebbfda88…` |
| P2-08 Phase Exit Audit | complete；audited `a7357810`；evidence `f4ac678c…`；1331 tracked contracts |

## 5. Engineering governance state

- `CURRENT_PLAN.md`：精简Master Roadmap和授权边界；
- `ENGINEERING_PLAYBOOK.md`：Ready/Done、Work Package、门禁、测试、Review、复用、Git和停线规则；
- `implementation/CURRENT_PHASE.md`：P13完成指针；当前无活动实施Phase；
- `implementation/evidence/`：冻结审计与验收Evidence；
- `implementation/archive/`：保存已冻结的历史Phase执行包。

工程文档不能覆盖架构SSOT。任意时刻禁止出现第二份活动Phase详细计划。

## 6. Safety and worktree state

- NAS ShelfDeck Docker `192.168.12.230:18080`保持生产边界，当前不接触；
- 四库真实来源E2E保持停止；
- P0–P13本地实现已关闭；不得在本线程启动P14、E2E或Docker构建；
- 不部署、不初始化生产数据、不执行真实媒体副作用；
- 旧`helixCleanState`/preflight不属于冻结E2E-ready package；
- `media-desktop`继续排除并保留用户未提交修改；
- 用户`media-service/package.json`分析入口和未跟踪分析脚本保持不变；
- P2使用独立worktree完成；P3–P13继续按Phase隔离，不能直接使用原dirty工作区。

## 7. Open risks and blockers

| Priority | Current risk | Control |
| --- | --- | --- |
| R0 | 旧Kairox合同以Helix命名回流 | P1 clean root和机器禁引入门禁 |
| R0 | 原子复用携带错误Owner/Store/Material权限 | function-level ledger；0 whole-executor reuse |
| R0 | 当前误导性clean-init造成数据破坏 | 封存；P13按Level 10完全重写 |
| R1 | 后续为进度创建新旧混合路径 | Master dependency invariant和Phase Exit Audit |
| active control | Standing授权仅限本地且clean root不得接旧产品主路径 | Current Phase Non-goals与Master dependency invariant |

## 8. Historical checkpoint record

P2 Exit Audit已在fresh-worktree复现性修正后PASS并归档。审计闭合提交`a735781010ee58c4119d93bb320bfe11bf1d4b7f`，合同aggregate digest为
原始aggregate为`ebbfda8885837170d48a0feb8f3aaad9a32aa35c44dc2db21704f820a6e3fc4a`，Exit evidence digest为
`f4ac678ce0b943e86b1317185866172e579ce273e2f6a6f515a16b76180f9352`；1379个P2 changed files与1331个tracked
contract files反向审计、findings=0。P3首次baseline发现并促成修正了被`release/` ignore遗漏的8-file Capability package；
现在Exit Audit会拒绝任何物理存在但Git未纳管的contract artifact。
P2未修改SSOT、未执行DDL/SQLite、未接startup、未触碰E2E/Docker/production/real media/`media-desktop`。下一检查点是
P3-00已完成：`codex/helix-clean`与隔离P3 worktree从精确闭合提交
`e3b50f946956105b18ffcf0853c8c2a57ebb4db8`开始；fresh checkout P2 gate恢复112/96/156/18 PASS、191 refs / 0 unresolved，
aggregate `ebbfda8885837170d48a0feb8f3aaad9a32aa35c44dc2db21704f820a6e3fc4a`。原dirty workspace与`media-desktop`
保持不变。P3-02预审发现原P2 table semantic baseline弱于SSOT §8.5.9；`d96464a7`已修正57个开放状态枚举、3个误判
revision-set digest、6个整数版本/优先级字段、revision起点和168个SHA-256检查。替换后的P2 aggregate为
`aab78271f712df7714233f0a79e24453e0c1a85c5d214ebf926dc6e71adba247`，fresh detached worktree全门禁及重物化零diff PASS。
P3-01最终DDL digest为`98e50feb79165844951ab5133f383eedc82848e83b0e4a2c4a58059121548b11`，156表、72 index、19/19
partial-unique保持闭合。详见`implementation/evidence/P2_TABLE_CONTRACT_SEMANTIC_REPAIR_D96464A7.md`。P3-02已在
`63e96c0e`完成：唯一Kernel、WAL/FK硬门禁、clean generation/Catalog/integrity/FK/partial-unique/guard self-check及
same-commit timestamp全部通过5组disposable SQLite正反例和fresh detached-worktree完整门禁。未接startup、未访问本地
`data/`，所有临时数据库已删除。P3-03已在`e17e109e`完成：Repository statement只能从manifest登记的同Owner表/列生成，
Unit of Work最多持有一个Business Domain并为Control/Foundation分别发放短生命周期context；7项正反例与静态guard拒绝跨域、
raw SQL、未声明authority、immutable UPDATE、异步/嵌套/context逃逸，fresh detached-worktree与DDL重物化零diff PASS。
P3-04已在`14b0e89c`完成：同事务preflight保证same-key/same-digest稳定replay且不执行Domain，different-digest
稳定拒绝；首次执行按Owner Fact→Receipt/全局Marker/append-only Audit整体提交。6组崩溃/约束反例和fresh detached-worktree
完整门禁PASS，不存在孤立Receipt。P3-05已在`fed454cb`完成：Producer事务冻结完整consumer set/Delivery，Consumer事务
原子写Domain Fact+Inbox，ack保持后续Foundation事务；6组dedup、重复投递、consume-before-ack、last/duplicate ack及startup
篡改反例在fresh detached worktree PASS，Delivery不持有Domain权限。
P3-06已在`f3ec7a81`完成：canonical Physical Material Identity重算、expected revision/from-to scope/scope digest
精确验证、单一current+append-only revision CAS，以及replace-control-set多Identity原子性均由5组fixture与startup tamper
反例证明，fresh detached-worktree完整门禁PASS；Control未创建Binding或Domain事实。P3-07已在`d7f27848`完成：exact
Owner/aggregate/fact/schema Registry强制预声明`domain_fact_commit` Effect Class和revision fence，payload digest与participant
Owner/bound Owner均fail-closed；coordinator不接受调用方Repository、SQL或generic participant，只在同一scoped UoW组合Domain、
可选Material Control、Commit Marker与同Owner Outbox。6组原子/replay/unknown schema/payload drift/wrong Owner/revision/marker
conflict/Control CAS反例、完整门禁和fresh detached-worktree均PASS，SSOT与P2合同digest未改变。P3-08已在`6bbf66ff`
完成：18项合同、56个声明写表、132个participant/COMMIT故障点、18个revision-fence反例、10个stale Control CAS反例和
11个真实Outbox路径均使用disposable SQLite验证；COMMIT前任一点失败保持完整快照不变，COMMIT后进程丢失/reopen保持整套
声明事实可见，Handoff上游prefix及其它forbidden write set不变。66/66专项测试、完整门禁和fresh detached-worktree均PASS，
没有真实文件/Provider/网络/媒体副作用。P3-09已在`bb8a797d`完成：唯一`P3_LOCAL_CROSS_PERSISTENCE`命令聚合完整
架构/合同/Owner/atomic fixture门禁，并在owned temp root重物化156表、72 index、19 partial unique exact catalog；5组专项
反例拒绝越界/非DB路径、unknown participant module、legacy table、compatibility view和外部动作入口，子进程不继承ambient
credentials。专项、聚合命令和fresh detached-worktree均PASS。P3 Exit Audit已对实现提交`5f433d930ba3111c19b1589816b96c790d60e5f3`
完成正式与fresh detached-worktree双重复审：111 changed files全部属于6类允许范围，findings=0，evidence digest
`b7269dd77b5d7d41cbd45cb80834f79254b1b1a7410834d80bc3e697c08260e1`。P3已归档，完整Evidence见
`implementation/evidence/P3_PHASE_EXIT_AUDIT_5F433D93.md`。下一检查点是P4-00精确闭合提交与隔离P4 baseline receipt。
P4-00已从精确phase closure `4a59356f3a89f1af38f594763aaaa0465e203b99`创建`codex/helix-p4`隔离
worktree；新检出的P3聚合门禁恢复112/96/156/18、156表/72 index/19 partial unique与18 transaction/132 crash points
全部PASS，`prohibitedActionsRun=[]`。原`master` dirty清单及6个既有`media-desktop`修改保持不变。下一检查点是P4-01
Foundation public ports and runtime nominal contracts。P4-01已在`4a9b5a59`完成：补齐SSOT要求的第43个
`foundation.public` package，精确暴露7个Port且拒绝Repository/SQLite/Executor/generic dispatch；Runtime nominal
state/Plan Resolution/Priority/七种Effect Class分别由P2表与112 Capability合同反向校验。Supporting Work Definition拒绝
预选Capability/Executor/flow/path和非opaque引用。8组专项、218-test完整门禁及fresh detached-worktree均PASS，P2合同
aggregate不变。P4-02已在`758b92ad`完成：112项exact Registry、Domain+Shared可见性、schema/semantic/executor
binding与typed Dispatcher全部fail closed；Context/input/parameters/Fence/Outcome/Result/Evidence逐层验证，拒绝版本替代、
权限字段和非pure无Receipt success。`foundation.capability`只精确授权Ajv两个模块。8组专项、完整门禁及fresh detached
worktree均PASS，P2 aggregate不变。P4-03已在`7efb760d`完成：WorkAdmission在同一Foundation事务读取持久化
Work/Event/Circuit权威事实并原子写Work+typed Receipt；replay/digest conflict/concurrency/hard cap/Circuit/invalid Process
和rollback均由7组反例闭合，未写业务域表。语义门禁发现的`Admission`简写通过改名为canonical `WorkAdmission`解决，
未新增豁免。完整门禁和fresh detached worktree均PASS。P4-04已在`40fd0cc9`完成：完整logical Plan/node合同纳入
deterministic graph digest，DAG/Capability/schema/Effect/resource/Fence/output/approval/retry/timeout/compensation逐项fail closed；
发布原子写Plan/Node/Edge/Event，root ready/dependent pending，同Attempt同图replay、异图冲突，零Domain写。6组专项、完整
门禁及fresh detached worktree均PASS。下一检查点是P4-05 Work Supply Controller。没有需要用户决定的业务问题。
P4-05已在`6e06a70f`完成：Supply Controller只读持久化target/Work/Attempt/Event/Circuit事实，soft/hard cap、
safety/handoff reserved lane和60秒minimum background进展均返回稳定snapshot，不删改事实、不选Capability、不判断容量。
6组专项、完整门禁及fresh detached worktree均PASS；per-resource竞争明确留给P4-07 Governor。下一检查点是P4-06
Scheduler/dependency readiness/technical lease。没有需要用户决定的业务问题。
P4-06已在`2c79072e`完成：Scheduler只读Foundation normalized Work/Event/Edge事实和Owner发布的同一Business Priority
Projection；五档不可跨越，同档按local priority+每60秒aging及FIFO stable key排序，Event严格重验ready、retryAt和
`success|terminal`依赖。technical lease仅为带fence digest的短期进程内并发锁，不持久化、不替代Permit、Reservation、
Material Control或Authorization。6组专项、38-file完整架构门禁及fresh detached worktree均PASS，semantic findings=0，
P2 aggregate保持`aab78271f712df7714233f0a79e24453e0c1a85c5d214ebf926dc6e71adba247`。下一检查点是P4-07
Resource Governor、Profile Mapper和atomic Permit bundle。没有需要用户决定的业务问题。
P4-07已在`ff72c6cd`完成：pure Profile Mapper精确实现`default|full`容量，未验证/未知设备为0、Provider与验证slot
上限不可突破、SQLite/control/mutation保持单写；唯一进程内Governor原子发放multi-key Permit bundle、每Event一个waiter、
跨档禁止aging越级，Profile降档不撤销执行中Permit，并用`finally`释放。Permit/waiter不持久化；仅queue hard-full原子写
`fx_resource_defer + Event retryAt`，退避固定5s/30s/2min/10min。12组专项、40-file完整架构门禁及fresh detached worktree
均PASS，semantic findings=0，P2 aggregate不变。下一检查点是P4-08 Event Runtime、Fence、Outcome/Result和Progress。
没有需要用户决定的业务问题。
P4-08前置审计发现immutable Plan完整合同无持久化位置；用户已明确授权返回Design。`4f3c41b9`以最小SSOT修正补齐
Plan Objective及Node approval/auth/retry/timeout/output/compensation字段和compensation FK，并新增可复现source-map
materializer。新SSOT/P2/DDL digest分别为`8b250ce4…`/`fe2f4433…`/`29a8e6b6…`；156表、72 index、19 partial unique、
112/96/156/18及18 transaction/132 crash points保持PASS。历史Evidence未改写，完整传播记录见
`implementation/evidence/P2_P4_IMMUTABLE_PLAN_PERSISTENCE_REPAIR_4F3C41B9.md`。P4-08随后在`3788d9fc`完成：ready-only
Event Runtime、双Fence、exact approval/auth、四种Outcome、immutable Result、DAG/when推进、Progress和Resource timing
全部闭合；Executor crash保留durable executing Attempt供P4-09恢复。29组专项、完整门禁及fresh detached worktree均PASS。
下一检查点是P4-09 Effect Journal和七类Effect-specific Reconciler。没有需要用户决定的业务问题。
P4-09已在`4aaa6450`完成：每个non-pure Event在Executor前先持久化Effect intent，Effect ID由Effect Class与
idempotency key确定性生成，后续合法safe retry只能复用同一intent，不能建立第二条副作用通道；已存在、terminal或
reconcile-required intent均不得返回ordinary dispatch。Effect Receipt先落`effect_observed`，再由class-specific fake
reality verifier核验，最后才在同一Foundation事务写immutable Commit Marker并把Journal置为`committed`；崩溃、证据缺失、
receipt/marker冲突保持`reconcile_required`或fail closed，不伪造外部原子事务或Result。七类Reconciler分别实现safe redo、
Workspace reuse/declared cleanup、external identity observe、Fact marker/revision/Fence、whole responsibility/control、Material
forward/declared rollback和destruction forward-only；unknown class、partial transfer和未授权rollback均阻断。26项专项测试、
45-file完整架构门禁、P3 persistence aggregate及fresh detached-worktree审计全部PASS；P2 aggregate仍为`fe2f4433…`，
DDL仍为`29a8e6b6…`，未触碰真实文件/Provider/Worker、E2E、Docker、production或`media-desktop`。下一检查点是P4-10
Retry、Timeout和declared Compensation。没有需要用户决定的业务问题。
P4-09随后以`06b80c15`补齐deferred external request的typed `ExternalJobReceipt`持久化：receipt identity在进入
reconcile前写入同一Effect Journal，idempotency drift或替换external identity均fail closed。P4-10已在`b84a8707`
完成：Execution Policy Registry对exact Capability集合冻结versioned Retry/Timeout/Compensation binding，并与Capability
snapshot合并计算Plan catalog digest；Planner不能写任意policy ref。Event failure、deferred observation及Work Attempt replan
使用三个独立预算，non-pure failure/timeout在`safe_retry`证据前只能进入effect-specific reconcile，Basis变化必须返回Domain
Owner。Timeout deadline只由Plan policy生成，调用方不能覆盖；执行句柄必须先被isolator终止隔离，Attempt才以timeout收口，
Permit仍由`finally`释放。普通DAG推进明确跳过compensation node；只有同Plan预声明target/contract、`compensate`恢复决定、
reality evidence及restricted applicability全部匹配时才可原子激活，destructive effect禁止rollback。38项专项、47-file完整
架构门禁、P3 persistence aggregate及fresh detached-worktree审计全部PASS；P2/DDL digest不变，未执行真实副作用或外部环境
动作。下一检查点是P4-11 Pressure Guard和persistent Circuit Breaker。没有需要用户决定的业务问题。
P4-11已在`1e5c6732`完成：Pressure Guard按SSOT固定阈值识别即时Correctness fault、连续hard cap、写入率发散、
waiter/background starvation、WAL连续增长和Permit不守恒，只写`fx_circuit_states`，不清队列、不改Event或Result。
Circuit open事实跨重启保留；相同证据稳定replay，不同证据不能静默覆盖；关闭必须严格经过`open → recovering → closed`
并同时提交invariant restoration与reconcile evidence。open/recovering Circuit阻止新normal/background及未开始commit effect，
只保留diagnostic、reconcile、已开始Control/Receipt收口及已跨不可逆边界的forward recovery；Event Runtime在Permit/Attempt/
effect intent前执行该门禁。26项专项、48-file完整架构门禁、P3 persistence aggregate及fresh detached-worktree审计PASS，
P2/DDL digest不变。下一检查点是P4-12 Startup recovery和Foundation readiness。没有需要用户决定的业务问题。
P4-12先以`a2ebe66f`建立只读startup recovery gate，随后审查发现原分类仍可能让待执行恢复动作错误进入ready；
`9dae2330`已将其修正为彻底fail closed。启动先校验DB integrity、Plan catalog、Capability/Policy binding，再扫描全部
nonterminal Work/Attempt/Plan/Event/Event Attempt/Effect/resource defer/Circuit事实；pure崩溃、non-pure intent前崩溃、
已提交Effect及七类exact Reconciler分别产生明确恢复动作。任何恢复动作存在时保持`recovering`，全局Circuit或未知合同/
Effect、orphan、多Effect、缺失defer/reconciler、catalog/integrity漂移均阻止normal supply；scoped Circuit保持`degraded`。
启动不批量重置Event，不恢复进程内Permit/waiter/lease，也不写业务事实。8项专项反例、49-file完整架构门禁、P3 persistence
aggregate及fresh detached-worktree审计全部PASS；P2 aggregate仍为`fe2f4433…`，18 transaction/132 crash points保持PASS，
`prohibitedActionsRun=[]`。下一检查点是P4-13 Cross-runtime crash/recovery verification harness。没有需要用户决定的业务问题。
P4-13已在`daaa0970`完成：新增唯一`P4_LOCAL_CROSS_RUNTIME_RECOVERY`本地命令，先聚合state machine、Owner/Port、
DAG/supply、backpressure/Permit、Fence/Progress及Effect Journal/Reconciler全部架构fixture，再在owned temp DB中执行
1个pure process-loss场景和6类non-pure Effect×5个边界（intent前、intent后、fake effect后、observation后、commit后），
共31个跨进程崩溃场景。每次崩溃均重新打开SQLite并重复分类，随后恢复和再次replay；最终严格保持一个Effect、一个
Commit Marker和一次fake dispatch。矩阵调用真实七类Reconciler，证明Material/Destructive intent后按`continue_forward`、
Workspace按reality复用、其它已提交事实按exact receipt/marker收敛，而非统一fallback。3项专项反例、50-file总门禁、
P3 persistence aggregate及fresh detached-worktree审计全部PASS；P2 aggregate仍为`fe2f4433…`，18 transaction/132 crash
points保持PASS，`prohibitedActionsRun=[]`。下一检查点是P4-14 P4 Phase Exit Audit和Evidence freeze。没有需要用户决定的业务问题。
P4 Exit Audit已对实现提交`fa8debb37cf118e39bb769f82336ecc0c0a1f2a3`完成正式与fresh detached
`--require-clean`双重复审：73个changed files全部属于8类允许范围，SSOT只包含已授权`4f3c41b9`修正且Git blob/
source-map aggregate精确匹配，旧Runtime、Domain/P5、API/UI、deployment和`media-desktop`越界findings=0。P4 aggregate
保持7类Effect/31个跨进程crash scenario，P3保持156表/72 index/19 partial unique和18 transaction/132 crash points；
Evidence digest为`3c3053d37ffcc2836e5e07ae9fd73186bf0ddef8395c42163e227b74328a5827`，完整Evidence见
`implementation/evidence/P4_PHASE_EXIT_AUDIT_FA8DEBB3.md`。P4已归档并自动打开P5；下一检查点是P5-00精确闭合提交与
隔离P5 baseline receipt。真实Provider/FFmpeg/Worker/媒体副作用仍未授权。没有需要用户决定的业务问题。
P5-00已完成：`codex/helix-clean`前移到精确P4 phase closure `5dd0b7094ea35cc04c7ba931fd109467462d0af6`，
并从该点创建隔离`codex/helix-p5` / `E:\my_project\emby_third_party-helix-p5`。fresh checkout的P4 Runtime总门禁
恢复51个架构fixture、7类Effect/31个跨进程crash scenario，P3回归恢复156表/72 index/19 partial unique与18 transaction/
132 crash points，全部PASS且`prohibitedActionsRun=[]`。原dirty workspace及`media-desktop`保持不变。下一检查点是
P5-01已完成并经P5-07传播修正：21个immutable nominal ports完整声明Owner、schema refs、Effect Class、idempotency、Fence和payload
bound；其中11个Integration ports分别覆盖pure observation、workspace write、external request、material commit和destructive commit，完整architecture gate PASS，证据见
`implementation/evidence/P5_01_PUBLIC_NOMINAL_PORTS.md`。下一步P5-02 Secret Reference and least-authority
credential resolver。没有需要用户决定的业务问题。
P5-02已完成：Platform Repository只保存opaque Secret Reference metadata；one-shot lease要求exact
scope/kind/revision/purpose、60秒内TTL与Fence，拒绝过期/重放/同步Promise逃逸，并在同步或受控异步settlement后清零owned bytes。证据见
`implementation/evidence/P5_02_SECRET_REFERENCE_AND_LEASE.md`。下一步P5-03 Mount Scope and Workspace Root
registries。没有需要用户决定的业务问题。
P5-03已完成：Mount Scope current-headed immutable revisions、active fingerprint uniqueness、Workspace Root exact CAS、
full capability probe、Windows/POSIX canonical path、root互斥及Field/Shelf reserved-root反例全部PASS，证据见
`implementation/evidence/P5_03_LOCATION_REGISTRIES.md`。下一步P5-04 Physical Material Identity and
binding-health primitives。没有需要用户决定的业务问题。
P5-04历史实现证据已被2026-08-02 Identity v2 Design Return取代：原唯一canonical Physical Material Identity算法与P3 Control交叉验证、full SHA-256/stat-fence复用、
rename/content/inode/mount及Binding Health反例全部PASS，证据见
`implementation/evidence/P5_04_PHYSICAL_IDENTITY_AND_BINDING_HEALTH.md`；其中full SHA-256部分不再是active合同或当前验收证据。下一步P5-05 Artifact Registry and
controlled payload handles。没有需要用户决定的业务问题。
P5-05已完成：Artifact Registry及Reference lifecycle由`execution-foundation`单独拥有，P5-01误放在Platform的
Artifact Query port已按SSOT纠正到`foundation.public`；controlled root containment、typed provenance、完整SHA-256/
size/media reality、owner或exact active-reference purpose、reference CAS及零引用GC authority/intent均fail closed。
9项专项、56-file完整架构、P3 persistence和P4 runtime聚合门禁PASS；Registry不执行物理删除，SSOT未修改。
证据见`implementation/evidence/P5_05_ARTIFACT_REGISTRY.md`。下一步P5-06 typed External Provider protocol adapters。
没有需要用户决定的业务问题。
P5-06已完成：8个使用IntegrationHandle的Capability与三类Effect Class反向闭合；Emby/TMDB/Douban/MoviePilot/
adult provider的每个允许组合使用唯一`protocolAtomId@1`，没有generic URL/request入口。Integration/Secret Fence、
operation-specific timeout/input bound、request/response SHA-256、typed ref/Artifact/External Job Receipt、deep freeze和错误脱敏
均fail closed；18项专项及完整架构/P3/P4聚合门禁PASS。旧Provider模块因混合network/fs/config/业务Owner未导入clean root。
证据见`implementation/evidence/P5_06_TYPED_EXTERNAL_PROVIDER_PROTOCOLS.md`。下一步P5-07 filesystem transaction、probe/hash
and FFmpeg atoms。没有需要用户决定的业务问题。
P5-07已完成：20个关闭的filesystem/hash/FFprobe/FFmpeg operation atoms逐项反向绑定Capability与Effect Class；正式
Inventory提交和破坏性删除使用新增的独立nominal ports，不能伪装为Workspace写。Operation Grant过期/Owner/路径containment、
禁止覆盖、closed profile、Effect intent digest、argv-only命令、bounded result与错误脱敏均fail closed。9项protocol及4项port
专项、58-file完整架构、P3 persistence和P4 runtime聚合门禁PASS；未调用已安装FFmpeg、未读取或修改真实媒体。
旧`transcodeService`因混合自建并发、环境工具选择、fallback、直接替换及旧Task语义未导入clean root。证据见
`implementation/evidence/P5_07_MEDIA_TOOL_PROTOCOLS.md`。下一步P5-08 Resource、device and passive Worker registries/protocol。
没有需要用户决定的业务问题。
P5-08已完成：Platform通过P3 Owner Repository持久化`default|full` Resource Profile、Operating Policy、Compute Device
probe及Worker immutable revisions；显式`unavailable/offline`与未知资源投影为零容量，Permit仍只由P4
`ResourceGovernor`拥有。当前active/healthy Worker revision才可签发≤60秒的`WorkerHandle`。asset register、upload和
analysis request三个closed passive Worker atoms要求exact Secret Lease、request digest和上游Receipt链，返回typed
Worker/External Job Receipt；不接受URL、argv、Store polling或Worker-owned queue。13项Registry/protocol专项、60-file
完整架构、P3 persistence及P4 runtime门禁PASS；未连接真实Worker或执行真实媒体。旧`resourceGovernor.js`和当前
`media-worker` server因自建容量/Job Map、raw FFmpeg args、binary/device选择及旧Task语义未导入clean root。证据见
`implementation/evidence/P5_08_RESOURCE_DEVICE_WORKER.md`。下一步P5-09 Material Access Handle issuer and Fence
enforcement。没有需要用户决定的业务问题。

P5-09已完成：Execution Foundation新增无Store的invocation-scoped Material Access Authority，只组合Owner发布的Binding、
Workspace、Control、Approval/Authorization、Target Slot和Event Fence projection，不接管Canonical Fact。Physical/
Workspace Handle冻结exact revision、permission、containment、Basis及≤60秒内部lifetime；Primary重验Control revision，Related
始终read-only且不生成Control。Operation Grant按Effect Class严格区分observation、Workspace write、Arca material commit和
destructive commit，目标路径只能从当前Workspace/Target Handle派生；P5-07 dispatch前再次重验filesystem Reality与全部
authority slice，Grant单次消费，stale/escape/replay均在effect前失败。P5专项71/71及完整architecture/P3/P4门禁PASS；仅使用
synthetic Owner/Reality adapters，未触碰真实媒体。证据见
`implementation/evidence/P5_09_MATERIAL_ACCESS_FENCE.md`。下一步P5-10 cross-platform isolated integration verification
harness。没有需要用户决定的业务问题。

P5-10已完成：新增`npm run test:helix-platform`跨平台Node-only isolated verification命令，精确运行10组P5 fixture
family并复用P4既有31场景cross-process crash verifier，不建立第二套Runtime。Workspace staged/observed、Material promoted
和External receipt四个命名边界均收敛为一次fake dispatch；缺场景、错误Decision、重复dispatch、非OS临时目录或fixture
allowlist漂移全部fail closed。统一命令、62-file architecture、P3 persistence及P4 runtime门禁PASS；未启动Service、绑定
端口、读取ambient credential、调用真实network/binary/media、Docker或`media-desktop`。证据见
`implementation/evidence/P5_10_ISOLATED_INTEGRATION_HARNESS.md`。下一步P5-11 P5 Phase Exit Audit and evidence freeze。
没有需要用户决定的业务问题。

P5-11已完成：正式clean-tree `npm run test:helix-platform-exit`审计实现`5d3bdde07bd95d5b228f46a3be16c17ea8211209`。
399个baseline后文件全部分类；本线程未修改SSOT，唯一SSOT变化精确绑定Architecture Agent提交`a933463f`，当前SSOT blob、
source-map与P2 aggregate均匹配。10个P5 fixture families、31个P4 recovery scenarios、63个architecture fixture files、
P3 156 tables/72 indexes/19 partial unique及18 transactions/132 fault points全部PASS，findings和prohibited actions均为空。
Evidence digest为`8817403970291024b145248dbf674165964cbf7c9af0d3d32abf6cdb14102d81`，详见
`implementation/evidence/P5_PHASE_EXIT_AUDIT_5D3BDDE0.md`。P5已归档并自动打开P6；下一检查点是P6-00 P5 closure与
隔离P6 baseline receipt。没有需要用户决定的业务问题。

P6-00已完成：从精确P5 phase closure `41470e47ec6bed7ba1cf81024130870eb2e57e92`创建独立
`codex/helix-p6` / `E:\my_project\emby_third_party-helix-p6`。Fresh checkout完整P5 Exit复审再次PASS，closure
evidence digest为`d17ace651cfea4b20a953ac4b0824e110c391d3559abbb97a17ccdb4b5d6c51f`；SSOT blob/source-map与P2
aggregate保持精确匹配，401个变更文件全部分类，findings和prohibited actions为空。原dirty workspace及
`media-desktop`未写入。证据见`implementation/evidence/P6_00_BASELINE_RECEIPT.md`。下一步P6-01 Horizontal-domain
public ports and package guards。没有需要用户决定的业务问题。

P6-01已完成：唯一versioned horizontal public contract catalog精确登记4个Owner-scoped Facade与12个named methods；
Perception只发布Record/Acquisition command和single-kind Resolution，People只发布Person/Candidate/Preference/Reference
command及Person Reference Projection。Exact-shape factory拒绝extra/generic/Media-Cast/Store authority，P1 skeleton改为
逐Domain精确出口allowlist而非放宽。专项8/8、64-file architecture、53 files/65 dependencies、1436 semantic files及
P5 10-family/31-scenario回归全部PASS，P2 aggregate不变，findings和prohibited actions为空。证据见
`implementation/evidence/P6_01_HORIZONTAL_DOMAIN_PUBLIC_PORTS.md`。下一步P6-02 User Perception scoped Store and
atomic Repository。没有需要用户决定的业务问题。

P6-02已按PBF-02/PBF-03重新闭合：`PerceptionRecordRepository`拥有7张Source/Acquisition/Cursor/Page Commit/Record/Anchor/
Relation表，`PerceptionResolutionRepository`拥有2张Revision/Head表。首次sync使用revision `0`逻辑sentinel但不伪造cursor
row；active Acquisition partial unique，terminal后可重开；Source/cursor/Resolution均expected revision CAS。Page receipt、
Record、Anchor、lineage、cursor和typed Result同事务，same marker replay与source identity duplicate计数收敛；stored Result tamper
fail closed。专项`11/11 PASS`，P2/P3/People/Perception组合`59/59 PASS`，证据见
`implementation/evidence/P6_02_PERCEPTION_SCOPED_STORE.md`。

P6-03已完成：Provider pure-observation port只交付bounded references，Observation Reader形成immutable
`PerceptionObservationPage`，matching revisioned normalization rule形成`PerceptionAcquisitionCommitDraft`；P3 Domain Commit
Coordinator在单一UoW提交Perception facts、cursor、typed Result、Foundation Result binding、Commit Marker和Outbox。focused
`3/3`、P3/P6组合`22/22`、Domain input `8/8`与Architecture guards `21/21 PASS`。证据见
`implementation/evidence/P6_03_PERCEPTION_ACQUISITION_PIPELINE.md`。

旧P6-05 10-table实现已由clean rewrite完全取代：`PersonRegistryRepository`精确拥有7张Person/Identity/Preference/Reference
表，`PeopleCandidateRepository`精确拥有Registration/Merge head+revision及Merge Record共5张表。Person是global Registry且
不含`content_scope`；Preference使用显式current pointer；Candidate只保存完整typed payload并逐次形成immutable revision，
Merge Candidate冻结精确Person fact与Preference revision。旧单行state API、digest-only Draft及无head Preference追加均删除，
没有compatibility path。focused `9/9`、P2/P3/table/package组合`68/68`、canonical crash/semantic组合`103/103 PASS`。
当前P2 aggregate为`65f96c638a668817085611035870c461f96a71209198b64eae62886ecc6549ac`。证据见
`implementation/evidence/P6_05_PEOPLE_SCOPED_REPOSITORIES.md`；下一工作包P6-06。

P6-06已完成：pure `PeopleCandidateResolver`只消费typed Evidence与immutable Policy catalog，产生complete Candidate Draft或
bounded `no_candidate`；Candidate Commit通过P3 Coordinator原子写head/open revision、typed Result、marker与Outbox；
Registration Acceptance以Candidate revision/payload CAS原子终结Candidate并创建global Person、Alias、Provider Identity。
同marker重放返回首次typed Result；stale revision、payload/Decision tamper及stable Provider Identity冲突均整事务rollback。
`dismiss-candidate`只追加terminal revision，不创建Person。Resolver `4/4`、lifecycle `6/6`、P2/P3/table/package/all-P6
组合`95/95 PASS`。证据见`implementation/evidence/P6_06_PERSON_REGISTRATION_LIFECYCLE.md`；下一工作包P6-07。

P6-07已完成：Merge Acceptance精确冻结Candidate、source/target Person revision/fact和nullable Preference pointer；同一P3事务内
追加Candidate accepted revision、source terminal revision、target active revision、必要Preference resolution、immutable Merge
Record、typed Result、marker和Outbox。target Person identity/canonical name保留，Alias/Provider Identity按target优先合并，Reference
Asset/Face仍归source历史、不复制。strong identity rule遇到Preference差异或显式改值即拒绝，source terminal target由数据库
`UNIQUE`硬约束。独立Preference Commit已删除合同外字段读取并验证Intent digest。focused `57/57`、targeted `26/26`、完整
Architecture与P3 Persistence门禁PASS；P2 aggregate更新为
`35695f240c93cbad14c2fc81d1df7c789db88966225fe7384dffaf44e9756f81`。证据见
`implementation/evidence/P6_07_PERSON_MERGE_AND_PREFERENCE.md`；下一工作包P6-08。

P6-08已在实现前审计中返回Design：SSOT要求维护并添加/删除Reference Image/Face，且两张People表分别需要稳定业务ID、
Artifact/Embedding handle、model/source/state；但当前`people.reference_fact.commit@1` closed input只含通用
`ArtifactHandle + DomainFactCommitHandle`，无法确定Asset/Face业务ID、Face事实或release语义，public合同也没有Face add/release
named command。实现线程没有用Handle ID冒充业务ID、没有旁读Store或写推测性默认值。待Architecture Agent闭合正式Reference
Maintenance DTO/Capability/Facade合同后继续。证据见
`implementation/evidence/P6_08_REFERENCE_MAINTENANCE_DESIGN_RETURN.md`。本线程未修改SSOT。
上述Perception Resolution与People Registration Design Return已由Architecture Agent提交`85752517`闭合，实现线程仅
cherry-pick该原始SSOT delta，未手工修改SSOT。Perception现有正式链为`CanonicalQueryHandle → Input Assembler →
PerceptionResolutionQuery/RecordSet/RuleSnapshot → pure Resolver → Draft → atomic Commit → Facade`；Resolution持久化完整typed
结果并由四列复合外键约束Head，Record以scalar fields和排序Anchor计算`record_digest`。People的`content_scope`已从合同删除，
Person明确为global Registry，不再等待业务值来源。

P6-04现已完成：旧ID-only DTO与Store旁读捷径均未保留；强Identity tier按固定rank选择，只有同一最强tier一致时返回
`found`，冲突或无匹配返回`not_found`，exact duplicate proof与普通Resolution匹配分离。P2合同门禁PASS，P3 DDL `7/7`、
canonical crash `78/78`、Perception focused/integration `20/20 PASS`。证据见
`implementation/evidence/P6_04_PERCEPTION_RESOLUTION.md`。P6整体Exit Audit尚未执行；下一工作包是P6-05最新12-table
People Store clean rewrite。

P6-08至P6-11已完成：Direct Person Registration和Reference Image单Face add/release原子闭合；5个Perception与8个People
Capability按P2 digest注册；cross-domain consumer只能保存Owner/revision/digest Basis；统一isolated harness覆盖75个架构fixture、
24项canonical transaction与25个crash fixture。最终合同为112 Capability、96 Result Family、161表、24 transaction，197个type ref
全部解析。

P6-12正式clean-tree Exit Audit对`0cc4d8bf86fcfcf0a329f15a3b4d34a23a399d09`返回`ok=true`、`findings=[]`、
`prohibitedActionsRun=[]`。515个baseline后文件全部分类；SSOT精确等于Architecture Agent `f2846fd1`原始blob，P2 aggregate为
`d94a53f8b7741aefa8bd0d245db4aafcc70100e2ac3d42d1ee7eb2685261cc70`，Exit Evidence digest为
`19377c01d465f5894ef6c3adf3b33c6c24b62bcda1a4605c202981be0ae4e114`。P6已归档，P7 Procurement详细包已打开；
外部环境与`media-desktop`授权边界不变。

P7-00至P7-01已完成：从P6 closure `5831c532`建立独立P7 worktree并fresh复跑P6 Exit PASS；Procurement唯一public
package现精确暴露Command/Query/Candidate Delivery三个port与11个named methods。Store、Subject、Shelf、generic Task和Related
Control authority反例全部拒绝。完整Architecture 76 fixtures、69 files/82 dependencies、1476 semantic files PASS；历史P6 Auditor
已固定审计P6 closure，避免后续Phase合法Evidence被误判为P6越界。下一工作包P7-02。

P7-02已完成：`MaterialFieldRepository`只绑定三张Procurement表；Material Field注册在同一UoW内闭合Policy、Field、Access
双向引用，Policy/Access使用immutable revision、canonical digest和exact CAS。重复Field、digest篡改、16 KiB上限、stale/skipped
revision及disabled后写入全部fail closed。Focused 9/9与完整P3 Persistence（77 fixtures、161表、24 transactions）PASS；
`prohibitedActionsRun=[]`。下一工作包P7-03。

P7-03在实现前返回Design：`FieldObservationPage.materialObservations[]`只有opaque Object Revision Ref，无法形成
`proc_field_materials`要求的Physical Identity、hash/stat/location/binding列；closed Capability input没有正式Snapshot resolver。
同时`ObservationCommitResult`要求aggregate revision/expected revision，但Material Field/Observation persistence没有对应head/CAS，
且一个Access revision允许多页，不能借用Access revision。实现线程未写默认值、未旁读旧Store、未修改SSOT。完整缺口见
`implementation/evidence/P7_03_FIELD_OBSERVATION_DESIGN_RETURN.md`。
