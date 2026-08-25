# Helix用户侧测试待修复问题台账

状态：`MOVIE CANARY USER UAT IN PROGRESS / DIRECT FIX AND COMMIT AUTHORIZED`

建立日期：2026-08-20

## 0. 2026-08-21 Formation Projection切换与现场恢复记录

本轮已完成“媒体整理工作区”从前端临时拼账到后端持久化技术Projection的现场切换。`libra_formation_projections`每个Subject一行，
active首屏25条，completed独立分页；它只服务展示和可重建查询，不作为业务授权依据。

现场动作按克隆验证后再切换执行：`helix-clean-v2 → helix-clean-v3`迁移通过，旧Catalog的62个活动Work和106个活动Event按合同升级退役，
历史行保留，旧Catalog无非终态Attempt/Event；现场数据库`integrity_check=ok`，当前659 Subjects与659 Projection rows一致。
服务已经恢复在`127.0.0.1:18080`运行，健康接口、Formation API和Admin Web均通过；active分页25条，第二页无重复，completed可独立读取。

本轮回滚点：

`C:\Users\markm\AppData\Local\Temp\ShelfDeck-Local-Rerun-20260820\formation-projection-cutover-20260821-015122\shelfdeck.pre-retirement-20260821.db`

SHA-256：`A734FE822896D88F597F66825853EA984E6919D8E58E23099CAC6D022A27F154`

安全边界：没有clean start、没有清空数据库、没有重新Observation `Z:\Film`、没有重复豆瓣/TMDB/MoviePilot同步，未删除或回退
Workspace/Remux输出；Docker、NAS和生产数据未触碰。

验证：启动恢复12/12、事件运行时24/24、Runtime Host12/12；Node全量276项为259 pass、17 skip、0 fail；Admin Web production build通过。
现场恢复期间另记录到1条`CLEAN_ARCA_TARGET_COLLISION`，服务仍保持ready；它属于既有Arca业务问题，不作为本次Projection切换缺陷，
也没有直接在现场数据库上修改该事实。

本条记录只关闭本轮Projection切换/恢复工作，不关闭下方仍需产品复盘的豆瓣匹配、队列吞吐、Product Identity等待等历史UAT问题。

## 1. 文档定位

Helix主体开发已经完成，Movie从Procurement、Libra到Arca及Shelf Deregistration的主生命周期已经接通。当前阶段是用户使用真实配置、真实媒体库和真实Integration进行用户侧测试。

本文统一记录这一阶段发现的待修复问题，作为后续集中复盘、Design Return、修复排序和回归验收的工作基线。

本文不是Architecture SSOT，不替代`CURRENT_PLAN.md`。历史UAT问题仍保留原有处理状态；2026-08-21 Movie Canary真实用户UAT期间，用户已授权在不改变已确认架构边界的前提下直接修复、页面复测并为每项修复建立独立Git回滚点。2026-08-22 另完成一次 Admin Web 全页用户体验审视（文案、内部机制泄漏、文案与事实冲突、排版、字体、按钮、前端拼装与美学），问题见 `docs/helix/ADMIN_WEB_UX_ISSUE_LOG.md`；该台账不替代本文的 UAT 业务/执行缺陷记录，也不授权实现。同日用户确认四项后续改造并登记为 `UAT-050`–`UAT-053`（当前媒体筛选、分步整理动作与进度、收藏按架与占用空间、Field Observation 周期观察缺口）；随后确认退出收藏任务化界面、人物 Beta 两条登记路径、豆瓣周期同步，登记为 `UAT-054`–`UAT-056`；概览改为状态 + 待办 + 最近几件事、不与「我的收藏」合并，登记为 `UAT-057`；侧栏把文件来源与收藏架下移与系统设置一组，Tab 改名为文件来源配置 / 收藏架配置，登记为 `UAT-058`。2026-08-22 干净 Canary `UAT-20260822-194617-1ed64ca36` 转码复盘登记为 `UAT-059`：四星体积上限被规划器当成目标码率；同轮 Spec 复盘登记为 `UAT-060`：Product Identity 写回 Subject 触发语义相同的 Acceptance Spec 重发；同轮另登记 `UAT-061` 豆瓣 Acquisition 翻页失败不收口、`UAT-062` frozen Discard 后未按重新入库收口、`UAT-063` Aftercare 查豆瓣分与 Libra 不是同一套 Resolution。

2026-08-23 在历史70/70关闭及`UAT-071`–`UAT-073`资格完成后，用户基于保留Canary的再次使用确认下一轮改进，登记为`UAT-074`–`UAT-084`。本轮覆盖NFO“更新/重建”语义、Related Artwork复用与TMDB Artifact Handle、Integration配置可见性、豆瓣匹配、Formation单表与详情事实、失败态投影、同根第二Material Field，以及当前工作区逐片审计。用户随后授权在本地隔离环境逐项实施和关闭；2026-08-23当前提交版真实Canary、失败现场克隆、Admin Web和25行只读审计均已完成，`UAT-074`–`UAT-084`现全部关闭，不重开或改写历史行。

2026-08-23 全新clean环境再次使用真实豆瓣配置时发现独立的完整性缺口，登记为`UAT-085`：Acquisition虽按`UAT-061`在翻页失败后有界重试并收口，但真实收藏连续抓取在固定游标被Provider 403拒绝；再次同步又从头抓取，无法从最后已提交页续传，设置页也没有明确说明当前只得到部分记录。该项只登记，不重开`UAT-061`或`UAT-079`，未授权实现。

同一clean环境的真实媒体生产又暴露两个独立缺口，登记为`UAT-086`与`UAT-087`：Formation把已被后续策略正常消费的候选验证未通过误报为整个Run失败；Transcode Capability漏接Foundation Progress Reporter，且现有FFmpeg采样只形成不可量化状态，页面无法显示真实转码进度。两项均以在飞的《锡尔弗顿之围》和《养蜂人》为只读现场证人，只登记、不停止转码、不修改数据库或当前影片。

2026-08-24 对该clean环境进行API、SQLite与进程三路监测后，新增`UAT-088`–`UAT-090`：同根Field/Shelf因Platform Mount Scope未装配而重复观察上架成品；Arca以同步大文件复制阻塞Node Event Loop；Foundation软等待、严格优先级与Intake历史扫描共同造成写放大、后台饥饿和终态Offer重放。用户已授权在正式`main`本地隔离环境逐项修复，并以重新复制`test_film`的新Canary、相同配置顺序和相同三路监测关闭；不得修改只读基线或触碰NAS生产。

最终隔离复测的受控重启另发现`UAT-091`：Run replacement取消了Event/Work却遗留waiting Resource Defer，令下一次Startup Recovery
fail-closed。commit `0bc45ed98`已在Foundation同一事务收口，并以有审计、可回滚的确定性修复恢复原失败库。2026-08-24 Product Owner
明确接受本轮现有FACT/FS/PERFORMANCE/RESTART证据并授权关闭`UAT-085`–`UAT-091`；记录保留未取得新的认证页面截图，不伪造UI证据。

2026-08-24 同一保留环境再次手动同步Douban时确认`UAT-093`：续传已从cursor 435正确开始，但collection第30页的
《网诱惊魂》列表行没有year，Adapter为补year强制请求Subject详情并得到HTTP 404，令整页三次失败、Record保持435。
Product Owner进一步确认year带来的关联收益不足以承担详情请求和身份复杂度：Douban同步只信任collection页，缺year照常入库；
User Perception全面取消year关联校验，year仅作为资料保存/展示。该决定明确取代`UAT-085`中“不放宽年份”的旧保护语句，
但保留明确Provider Identity、Target Anchor优先、规范化title exact、同强度不同评分冲突为`not_found`以及禁止模糊/第一项选择。

关闭作业不再走已删除的 `helix-beta-user-e2e` workflow。当前 70 行关闭基线见 `docs/helix/acceptance/UAT_CLOSURE_BASELINE.md`：正式关闭立即汇报且不暂停；确认关闭时发现新产品缺陷则暂停并先登记新 UAT；`PASS` 必须有干净 Canary 的 Admin Web `UI`（涉及文件现实时加 `FS`），单元测试不能单独关闭一行。

记录原则：

- 区分真实产品缺陷、运行中的暂态现象、环境波动和用户体验缺口；
- 不因单次测试失败直接改变Domain Owner、Handoff或Execution Foundation边界；
- 涉及业务合同的修复必须先回到唯一SSOT；
- 不在本文记录Cookie、API Key、个人评分明细或其他Credential；
- 每项问题保留发现时间、现场证据、业务影响、初步根因、建议边界和最终处理状态。

### 1.1 问题分类体系

每项问题使用一个主分类，并可附加一个次分类：

| 分类 | 含义 | 典型问题 |
| --- | --- | --- |
| `BUSINESS_CONTRACT` | 业务事实、Identity、Decision或Handoff合同不能表达正确业务结果 | 错误匹配、错误归属、事实缺失、边界不闭合 |
| `DOMAIN_ORCHESTRATION` | Domain Coordinator、Reconcile或Process推进方式不合理 | 不必要串行、遗漏唤醒、错误阶段依赖 |
| `EXECUTION_SCHEDULING` | Work Admission、Supply、Priority或跨阶段backpressure不合理 | 高优先级Work无法Admission、下游堵塞上游 |
| `RESOURCE_CAPACITY` | Resource Governor、Permit或真实设备/Volume容量配置不合理 | CPU/GPU/SQLite/Volume并发容量错误 |
| `EXTERNAL_INTEGRATION` | 外部Provider的认证、协议、分页、限流或Evidence存在问题 | TMDB、豆瓣、MoviePilot调用异常 |
| `PROJECTION_FRESHNESS` | durable事实已变化，但Projection、Resolution或页面没有及时刷新 | lost wake、cursor滞后、旧head未替代 |
| `PERFORMANCE` | 业务结果正确，但实现存在可证明的吞吐、延迟、内存或I/O问题 | N+1查询、重复扫描、低吞吐 |
| `USER_EXPERIENCE` | 后端事实基本正确，但用户无法理解、观察或操作 | 状态不显性、错误提示不足、页面信息缺失 |
| `ENVIRONMENT` | 非产品逻辑导致的环境波动或本地运行问题 | NAS抖动、网络波动、设备暂时离线 |

分类描述的是首要根因，不以用户最先看到的页面现象分类。例如“页面上的Subject增长很慢”如果根因是Coordinator全局串行，应归入`DOMAIN_ORCHESTRATION`，而不是简单归为UI或硬件性能问题。

### 1.2 本轮 Movie Canary UAT 作业方法

2026-08-22 纠正。空等「23 部全部 completed」不是测试作业；五星无合格 4K 源的产品不可达是已确认合同终态，不能当作 DONE 条件，也不能把监测做成挂机。

闭环：

1. 看账：每个 Subject 只能落在「还在干活 / 合法冻结 / 产品阻塞」之一。
2. 还在干活：必须有可核验的执行证据（FFmpeg 进程、工作区文件在增长、On-deck 状态在推进）。页面仍显示整理中但证据消失，按阻塞处理。
3. 合法冻结：仅限五星整理要求下 MoviePilot `no_available_candidate` / `no_requirement_eligible_candidate` 的可读冻结。计入「需要处理」，不阻断本轮可关闭的形成/上架账。
4. 产品阻塞：形成失败、ISO triage_failed、Remux/Transcode 停死、Off-load 停死、身份观察 schema/Secret 失败、通用冻结句、Aftercare 合同缺口等。钉根因、写入台账、逐条修、逐条提交。涉及用户意图或业务合同时停下来问。不准 workaround。
5. 旧 Observation / 冻结 Run / 已发布 Candidate 不可变。修复若必须新 Observation，再开干净 Canary；否则在当前隔离库继续核验。

本轮可关闭的形成/上架账（不是「23 部都 On-deck」）：

- 形成 23/23（两部`养蜂人` + ISO `倩女幽魂2`）；
- 凡合同允许上架的都已 On-deck；
- 其余只允许是上面第 3 条的合法五星冻结；
- 第 4 条阻塞必须清零。Aftercare 健康等独立 OPEN 项单独收口，不能用五星冻结吞掉。

密集监测只在**新阻塞出现**或**本轮账可关闭**时叫醒，并落盘快照。不得把进度变化或合法冻结当成完成，也不得在无执行证据时继续挂着。

## 2. 问题总览

| ID | 问题 | 主分类 | 次分类 | 主要责任边界 | 影响维度 | 严重度 | 当前状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UAT-001 | 豆瓣评分与Libra Subject匹配率明显偏低 | `BUSINESS_CONTRACT` | `PROJECTION_FRESHNESS`、`EXTERNAL_INTEGRATION` | User Perception + Libra Identity输入 | 正确性、时效性 | High | 修复已提交，待新Canary定向确认 |
| UAT-002 | Handoff A Intake接收Subject吞吐异常偏低 | `DOMAIN_ORCHESTRATION` | `EXECUTION_SCHEDULING`、`PERFORMANCE` | Libra Intake + Foundation Work Supply接线 | 吞吐、活性 | High | 已修复并通过400 Candidate重启资格回归，待新Canary确认 |
| UAT-003 | Libra Run在Product Identity阶段大量等待 | `BUSINESS_CONTRACT` | `EXTERNAL_INTEGRATION`、`DOMAIN_ORCHESTRATION` | Libra Product Identity + TMDB Evidence | 正确性、活性 | Critical | 修复已提交，待新Canary真实身份确认 |
| UAT-004 | 大型Workspace媒体完整SHA-256导致无必要的全文件读取 | `BUSINESS_CONTRACT` | `PERFORMANCE`、`USER_EXPERIENCE` | Libra Workspace Material + Handoff B/Arca Inventory媒体完整性合同 | I/O、CPU、交付延迟 | High | 已修复并通过实际读取预算资格回归，待新Canary确认 |
| UAT-005 | Libra Admin Web使用内部对象语言且不能直观表达媒体整理过程 | `USER_EXPERIENCE` | `PROJECTION_FRESHNESS` | Admin Web Formation Projection + Libra公开状态翻译 | 可理解性、可观察性 | High | 代码已完成；四桶已落地，动作/进度剩余并入 UAT-051；待新 Canary 确认 |
| UAT-006 | clean库概览仍展示固定演示数字并绕过管理会话 | `USER_EXPERIENCE` | `PROJECTION_FRESHNESS` | Overview Query Projection + Admin Web | 正确性、可信度、安全会话 | Critical | 已修复并完成真实页面复测 |
| UAT-007 | clean库人物页展示固定人数且无正式Query接线 | `USER_EXPERIENCE` | `PROJECTION_FRESHNESS` | People Admin Query + Admin Web | 正确性、可信度、安全会话 | Critical | 已修复并完成真实页面首次打开复测 |
| UAT-008 | Admin Web非根路径直接刷新返回404 | `USER_EXPERIENCE` | `PROJECTION_FRESHNESS` | Clean Service static adapter + Admin Web routing | 可用性、刷新恢复 | Critical | 已修复并完成七个页面直接刷新复测 |
| UAT-009 | 媒体整理页评分提交成功但刷新后仍显示暂无评分 | `USER_EXPERIENCE` | `PROJECTION_FRESHNESS` | Perception Query Projection + Formation Projection | 正确性、持久化可见性 | Critical | 已修复并完成真实页面刷新复测 |
| UAT-010 | Routing尚未配置时Formation错误开放人工选Shelf并返回内部错误 | `USER_EXPERIENCE` | `RECOVERY_CORRECTNESS` | Formation Admin Web + Clean Service error adapter | 可理解性、命令安全 | Critical | 已修复并完成真实页面复测 |

### 2.0 2026-08-22 确认的产品/实现缺口

用户确认九项后续改造方向；本批只登记，不授权实现、不改 SSOT。完整叙述见 §47–55。2026-08-22 Canary 复盘新增 `UAT-059`–`UAT-063`，见 §56–60。同日干净 Canary `UAT-20260822-141950-0c27c8cf6` 另登记 `UAT-064`（Formation 步骤展示偏离真实执行），只登记不深挖。UAT-011 至 UAT-049 仍按后文章节，不在本表重复。

| ID | 问题 | 主分类 | 次分类 | 主要责任边界 | 影响维度 | 严重度 | 当前状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UAT-050 | 媒体整理工作区当前媒体缺少可操作筛选 | `USER_EXPERIENCE` | `PROJECTION_FRESHNESS` | Formation 公开 Query + Admin Web | 可理解性、可操作性 | High | 已实现；待新 Canary 确认 |
| UAT-051 | 整理动作是概括句，不能展示分步施工、分步进度、用户操作与加急 | `USER_EXPERIENCE` | `PROJECTION_FRESHNESS` | Formation 公开 Projection + Admin Web | 可理解性、可观察性 | High | 已实现；待新 Canary 确认 |
| UAT-052 | 我的收藏一级导航不是按架，详情缺少占用空间等技术指标 | `USER_EXPERIENCE` | `PROJECTION_FRESHNESS` | Arca Collection Query + Admin Web | 可理解性、可发现性 | High | 已实现；待新 Canary 确认 |
| UAT-053 | 活动文件来源未按 SSOT 周期观察，扫描完成后页面禁止再扫 | `DOMAIN_ORCHESTRATION` | `USER_EXPERIENCE` | Procurement Field Management Owner 自动化 + Admin Web | 正确性、活性、可理解性 | Critical | 已实现；待新 Canary 确认 |
| UAT-054 | 退出收藏主链已通，页面仍是内部安全链控制台 | `USER_EXPERIENCE` | | Off-deck Admin Web | 可理解性、可操作性 | High | 已实现；待新 Canary 确认 |
| UAT-055 | 人物名录未接通 Beta 两条登记路径，页面只读且为空 | `DOMAIN_ORCHESTRATION` | `USER_EXPERIENCE` | People Owner 自动化 + Arca On-deck 人物证据 + Admin Web | 正确性、可操作性 | Critical | 已实现；待新 Canary 确认 |
| UAT-056 | 豆瓣评分缺少 SSOT 周期同步，同步与日志刷新职责混在一起 | `DOMAIN_ORCHESTRATION` | `USER_EXPERIENCE` | Perception Acquisition Owner 自动化 + Admin Web | 时效性、可理解性 | High | 已实现；待新 Canary 确认 |
| UAT-057 | 概览只重复旁页计数，缺少系统状态、可点待办与最近完成；不得与我的收藏合并 | `USER_EXPERIENCE` | `PROJECTION_FRESHNESS` | Overview 只读聚合 + Admin Web | 可理解性、可操作性 | High | 已实现；待新 Canary 确认 |
| UAT-058 | 侧栏把文件来源与收藏架放在日常运营之前；应下移与系统设置一组并改名为配置 | `USER_EXPERIENCE` | | Admin Web 导航 | 可发现性、信息架构 | Medium | 已实现；待新 Canary 确认 |
| UAT-059 | 四星转码把 14 GiB 上限当成目标码率，把已较小的 H.264 源灌大 | `BUSINESS_CONTRACT` | `MEDIA_PRODUCTION` | Libra Production Planner `deriveTargetSizeBudget` | 正确性、空间、质量 | High | 已实现；待新 Canary 确认 |
| UAT-060 | Product Identity 写回 Subject 触发语义相同的 Acceptance Spec 重发，头切走后 Run 可能发不出 Package | `BUSINESS_CONTRACT` | `DOMAIN_ORCHESTRATION` | Libra Acceptance Spec `specInputDigest` + Coordinator | 正确性、活性 | High | 已修复并通过重建 Canary 确认 |
| UAT-061 | 豆瓣 Acquisition 翻页传输失败后不重试、不收口，设置页永久「正在同步」 | `EXTERNAL_INTEGRATION` | `RECOVERY_CORRECTNESS` | Perception Acquisition + Settings 同步态 | 活性、可理解性 | High | 已实现；待新 Canary 确认 |
| UAT-062 | frozen Run Discard 后 Control 已释放，Formation 仍空转「正在评估整理方案」，未走重新入库 | `BUSINESS_CONTRACT` | `DOMAIN_ORCHESTRATION` | Libra Run Discard 收口 + Procurement 重新入库 + Formation | 正确性、活性、可理解性 | Critical | 已修复并通过当前 Canary 确认 |
| UAT-063 | Aftercare 问豆瓣分与 Libra 不是同一套 Resolution/Identity Evidence，上架后评分变化不触发保养 | `BUSINESS_CONTRACT` | `PROJECTION_FRESHNESS` | Arca Aftercare 拉 Perception + 与 Libra 共用 Identity Evidence | 正确性、时效性 | High | 已修复并通过当前 Canary 确认 |
| UAT-064 | Formation 整理步骤展示与真实执行状态偏离：转码标 CPU、验证过早标完成 | `USER_EXPERIENCE` | `PROJECTION_FRESHNESS` | Formation 公开 Projection `organizingSteps` / `transcodeLabel` | 可理解性、可观察性 | High | 已修复并由 Product Owner 接受现有证据关闭 |
| UAT-065 | 收藏详情把父目录名中的`.1`误显示为主视频容器 | `USER_EXPERIENCE` | `PROJECTION_FRESHNESS` | Arca Collection Query + Admin Web | 正确性、可理解性 | High | 已修复并通过当前 Canary 定向确认 |
| UAT-066 | Formation 已完成整理表丢失目标收藏架名称，全部显示`—` | `USER_EXPERIENCE` | `PROJECTION_FRESHNESS` | Formation Admin Web + Arca Shelf只读展示接线 | 正确性、可理解性 | High | 已修复并通过当前 Canary 定向确认 |
| UAT-067 | 活动 Run 加急后回放既有 Supporting Work 触发 Admission 幂等冲突，Run 不再推进 | `DOMAIN_ORCHESTRATION` | `EXECUTION_SCHEDULING` | Libra Run Coordinator + Foundation Work Admission replay | 活性、优先级正确性 | Critical | 已修复并通过同一 Canary 恢复确认 |
| UAT-068 | Collection 年份投影遗漏 Provider 标准字段，Aftercare 丢失 title-year Identity Evidence | `PROJECTION_FRESHNESS` | `BUSINESS_CONTRACT` | Arca Collection Query + shared Rating Identity | 正确性、可理解性 | High | 已修复并通过当前 Canary 确认 |
| UAT-069 | 评分 Resolution 更新后 Aftercare 及时执行，但 Planner/Capability 写回旧 Care Basis | `DOMAIN_ORCHESTRATION` | `PROJECTION_FRESHNESS` | Arca Aftercare composition wiring | 正确性、时效性 | Critical | 已修复并通过当前 Canary 安全重启确认 |
| UAT-070 | 集成配置 revision 更新后，新建 Metadata Work 仍假定 revision 1，并让首轮 reconcile 阻断服务启动 | `DOMAIN_ORCHESTRATION` | `RECOVERY_CORRECTNESS`、`EXTERNAL_INTEGRATION` | Libra Metadata Planning + Foundation reconciliation | 可用性、活性、恢复正确性 | Critical | 已修复并由 Product Owner 接受现有证据关闭 |
| UAT-071 | 同一上架电影的多个人物关系共用来源 digest，只有首个人物自动登记 | `DOMAIN_ORCHESTRATION` | `PROJECTION_FRESHNESS` | Arca On-deck Person Evidence + People登记幂等 | 正确性、名录完整性 | Critical | 已修复并通过全新隔离 Canary FACT/RESTART确认 |
| UAT-072 | 已登记人物名录缺少头像，无法形成可辨识的人物联系表 | `USER_EXPERIENCE` | `EXTERNAL_INTEGRATION`、`PROJECTION_FRESHNESS` | People Admin Query + Platform TMDB adapter + Admin Web | 可辨识性、安全性、可访问性 | High | 已修复并通过桌面/390px UI E2E确认 |
| UAT-073 | NFO演员块的TMDB Person ID被丢弃，与Provider演员关系重复后产生整组待确认登记 | `DOMAIN_ORCHESTRATION` | `EXTERNAL_INTEGRATION`、`PROJECTION_FRESHNESS` | Libra NFO Metadata Observation + Media Cast形成 | 正确性、名录完整性、可理解性 | Critical | 已修复并通过真实电影/真实TMDB Canary与UI确认 |
| UAT-074 | 可用的原NFO被从空白模板重写，产品应按“未坏则更新、坏则重建、缺失则创建”处置 | `BUSINESS_CONTRACT` | `USER_EXPERIENCE` | Libra Related NFO disposition + Production Workspace | 正确性、信息保真、可理解性 | Critical | `REGRESSION PASSED / CLOSED` |
| UAT-075 | NFO更新未保留原有丰富字段，ShelfDeck输出再次入库时也缺少身份稳定性保证 | `BUSINESS_CONTRACT` | `DOMAIN_ORCHESTRATION` | Libra NFO update/render + Metadata Observation | 信息保真、幂等、身份正确性 | Critical | `REGRESSION PASSED / CLOSED` |
| UAT-076 | 已有合格海报未按Related Material直接沿用，缺失/损坏海报的外部获取边界也未清楚区分 | `BUSINESS_CONTRACT` | `EXTERNAL_INTEGRATION` | Libra Related Artwork disposition + Production Workspace | 正确性、I/O、外部依赖 | High | `REGRESSION PASSED / CLOSED` |
| UAT-077 | TMDB海报Artifact Handle缺少`artifactKind`，请求在进入Provider前即被拒绝 | `EXTERNAL_INTEGRATION` | `DOMAIN_ORCHESTRATION` | Libra Artifact Work creation + Platform Integration Runtime | 活性、正确性、诊断性 | Critical | `REGRESSION PASSED / CLOSED` |
| UAT-078 | TMDB与豆瓣实际已有配置，但设置页呈现为未正确配置 | `USER_EXPERIENCE` | `PROJECTION_FRESHNESS`、`EXTERNAL_INTEGRATION` | Integration Admin Query + Settings Admin Web | 可理解性、可信度、安全性 | High | `REGRESSION PASSED / CLOSED` |
| UAT-079 | 多部影片未取得豆瓣评分，身份形成或确认后没有稳定重算且空值原因不可见 | `BUSINESS_CONTRACT` | `PROJECTION_FRESHNESS`、`EXTERNAL_INTEGRATION` | Perception Resolution + Libra Identity input + Formation Query | 正确性、时效性、可理解性 | Critical | `REGRESSION PASSED / CLOSED` |
| UAT-080 | Formation被拆成多张宽表且媒体名称列承载过多信息，不能形成一个可扫读的媒体台账 | `USER_EXPERIENCE` | `PROJECTION_FRESHNESS` | Formation Admin Query + Admin Web | 信息架构、可扫读性、窄屏可用性 | High | `REGRESSION PASSED / CLOSED` |
| UAT-081 | Formation详情使用前端聚合概念和模糊步骤，未清楚透传已接收材料、媒体整理、验收与上架事实 | `USER_EXPERIENCE` | `BUSINESS_CONTRACT`、`PROJECTION_FRESHNESS` | Procurement/Libra/Arca公开事实 + Formation Query + Admin Web | 可理解性、事实正确性、可观察性 | Critical | `REGRESSION PASSED / CLOSED` |
| UAT-082 | Formation的100%总进度和完成标记可掩盖真实失败，使报错影片看起来只是“停在那里” | `PROJECTION_FRESHNESS` | `USER_EXPERIENCE`、`RECOVERY_CORRECTNESS` | Libra/Arca Work与Event事实 + Formation Projection | 正确性、可操作性、故障恢复 | Critical | `REGRESSION PASSED / CLOSED` |
| UAT-083 | 保留旧Field并对同一目录新增第二Material Field时，必须只形成一次有效整理且不能发生竞争控制 | `BUSINESS_CONTRACT` | `DOMAIN_ORCHESTRATION`、`USER_EXPERIENCE` | Procurement Field/Material Control + Libra Intake | 正确性、幂等、可理解性 | Critical | `REGRESSION PASSED / CLOSED` |
| UAT-084 | 当前Formation工作区缺少逐片事实审计，除已知影片外仍可能存在未解释的冻结、失败或错误投影 | `DOMAIN_ORCHESTRATION` | `PROJECTION_FRESHNESS`、`USER_EXPERIENCE` | Procurement/Libra/Arca跨域只读审计 | 完整性、诊断性、回归风险 | High | `FACT PASSED / CLOSED` |
| UAT-085 | 豆瓣完整收藏同步被Provider 403中断后不能从持久游标续传，页面仍把部分数据表现为普通未匹配 | `EXTERNAL_INTEGRATION` | `RECOVERY_CORRECTNESS`、`USER_EXPERIENCE`、`PROJECTION_FRESHNESS` | Perception Acquisition + Settings/Formation Query | 完整性、正确性、可恢复性、可理解性 | Critical | `OWNER ACCEPTED / CLOSED` |
| UAT-086 | Formation把已进入后续策略的候选验证未通过误报为整个媒体整理失败 | `PROJECTION_FRESHNESS` | `BUSINESS_CONTRACT`、`USER_EXPERIENCE` | Libra媒体生产策略链 + Formation Projection | 正确性、可操作性、可信度 | Critical | `OWNER ACCEPTED / CLOSED` |
| UAT-087 | 实际Transcode没有持久进度样本，Formation无法显示真实可量化进度 | `DOMAIN_ORCHESTRATION` | `PROJECTION_FRESHNESS`、`USER_EXPERIENCE` | Libra Transcode Capability + Foundation Progress + Formation Admin Web | 可观察性、执行可信度、恢复可见性 | High | `OWNER ACCEPTED / CLOSED` |
| UAT-088 | 同根Field与Shelf被分配不同Mount Scope，Shelf成品会再次进入Procurement并形成重复整理 | `BUSINESS_CONTRACT` | `DOMAIN_ORCHESTRATION`、`PLATFORM_INTEGRATION` | Platform Mount Scope Registry + Procurement Field + Arca Shelf Target | 正确性、幂等、活性 | Critical | `OWNER ACCEPTED / CLOSED` |
| UAT-089 | Arca上架同步复制大文件阻塞Node Event Loop，使Admin Web与Health整窗超时 | `PERFORMANCE` | `RESOURCE_CAPACITY`、`USER_EXPERIENCE` | Arca Inventory staging + Platform filesystem effect | 可用性、延迟、上架吞吐 | Critical | `PERFORMANCE/FS/RESTART PASSED / CLOSED` |
| UAT-090 | Resource软等待滚动写、后台饥饿与终态Intake重扫形成持续高CPU和SQLite写放大 | `PERFORMANCE` | `EXECUTION_SCHEDULING`、`RECOVERY_CORRECTNESS` | Foundation Governor/Scheduler + Libra Intake fallback reconcile | 可用性、吞吐、恢复正确性 | Critical | `FACT/PERFORMANCE/RESTART PASSED / CLOSED` |
| UAT-091 | Process Work取消未同步终结Resource Defer，导致下一次服务启动被一致性检查阻断 | `RECOVERY_CORRECTNESS` | `EXECUTION_SCHEDULING`、`OPERATIONAL_SAFETY` | Foundation Work Lifecycle + Resource Governor + Startup Recovery | 可恢复性、原子性、服务可用性 | Critical | `FACT/RESTART PASSED / CLOSED` |
| UAT-092 | 原NFO缺少演员时Libra误判Metadata已齐全，既不向TMDB补演员也不能把新演员写入NFO，最终在内部符合性验收冻结 | `BUSINESS_CONTRACT` | `DOMAIN_ORCHESTRATION`、`EXTERNAL_INTEGRATION` | Libra Metadata Planning + Media Cast + NFO Sidecar + Product Conformance | 正确性、活性、信息完整性 | Critical | `FACT/UI/RESTART PASSED / CLOSED` |
| UAT-093 | Douban列表缺year时强制访问Subject详情，单条404阻断整库同步；year关联校验复杂度高且收益低 | `BUSINESS_CONTRACT` | `EXTERNAL_INTEGRATION`、`RECOVERY_CORRECTNESS`、`PROJECTION_FRESHNESS` | Perception Acquisition + Resolution + Acceptance Spec | 完整性、活性、规则可理解性 | Critical | `FACT/RESTART PASSED / CLOSED` |
| UAT-094 | Aftercare把最大体积上限误作扩容目标，可能将较小源文件转成更大的成品 | `BUSINESS_CONTRACT` | `MEDIA_PRODUCTION`、`RESOURCE_CAPACITY` | Arca Aftercare Media Strategy | 正确性、容量、成品质量 | Critical | `FACT/FS/RESTART PASSED / CLOSED` |
| UAT-095 | Aftercare媒体符合性与输出完整性检查遗漏主音轨、媒体形态、默认流和流连续性 | `BUSINESS_CONTRACT` | `PRODUCT_CONFORMANCE`、`SAFETY` | Arca Aftercare Conformance + Media Verification | 正确性、完整性、安全性 | Critical | `FACT/FS/RESTART PASSED / CLOSED` |
| UAT-096 | Aftercare NFO未遵循坏则重建、没坏则更新，可能丢失原有丰富资料 | `BUSINESS_CONTRACT` | `METADATA_INTEGRITY`、`USER_DATA_PRESERVATION` | Arca Aftercare NFO | 信息保真、身份正确性、幂等 | Critical | `FACT/FS/RESTART PASSED / CLOSED` |
| UAT-097 | Aftercare Artifact未完成真实验证或使用陈旧Integration Handle即进入Inventory | `EXTERNAL_INTEGRATION` | `PRODUCT_CONFORMANCE`、`ATOMICITY` | Arca Aftercare Artifact + Platform Integration | 正确性、活性、原子性 | Critical | `FACT/FS/RESTART PASSED / CLOSED` |
| UAT-098 | Care Basis或Reservation变化时，Aftercare正式效果仍可能继续写入和关闭 | `RECOVERY_CORRECTNESS` | `AUTHORIZATION_FENCE`、`DOMAIN_ORCHESTRATION` | Arca Aftercare Effect Fence | 正确性、安全停线、恢复性 | Critical | `REGRESSION/REAL CHAIN/RESTART PASSED / CLOSED` |
| UAT-099 | Inventory已提交但Settlement未终态时，Aftercare可能过早Reassessment并关闭Case | `DOMAIN_ORCHESTRATION` | `DESTRUCTIVE_SAFETY`、`ATOMICITY` | Arca Aftercare Settlement + Case Closure | 正确性、删除安全、原子性 | Critical | `FACT/FS/RESTART PASSED / CLOSED` |
| UAT-100 | Aftercare失败、替代Work、终态原因与资源收口不完整，可能永久卡住或静默重开 | `RECOVERY_CORRECTNESS` | `AUDITABILITY`、`LIVENESS` | Arca Aftercare Case/Work/Workspace lifecycle | 可恢复性、审计性、活性 | Critical | `FACT/REGRESSION/RESTART PASSED / CLOSED` |
| UAT-101 | Aftercare长任务缺真实进度并含同步大文件I/O，可能拖慢Admin Web | `PERFORMANCE` | `PROGRESS`、`OPERATIONAL_SAFETY` | Arca Aftercare FFmpeg/Filesystem + Foundation Progress | 可观察性、延迟、取消安全 | Critical | `FACT/PERFORMANCE/RESTART PASSED / CLOSED` |
| UAT-102 | Aftercare Workspace未正式登记、默认进入OS TEMP且关闭时过早递归删除 | `PLATFORM_INTEGRATION` | `RECOVERY_CORRECTNESS`、`DATA_SAFETY` | Platform Workspace Registry + Arca Aftercare Workspace | 数据安全、恢复性、空间治理 | Critical | `FACT/FS/RESTART PASSED / CLOSED` |
| UAT-103 | 大量评分重评形成Incident/Projection同步风暴，且Domain越界控制Foundation Incident | `PERFORMANCE` | `INCIDENT_AGGREGATION`、`PROJECTION_FRESHNESS` | Foundation Incident Runtime + Arca Care Projection | 性能、边界正确性、隔离性 | Critical | `FACT/PERFORMANCE/RESTART PASSED / CLOSED` |
| UAT-104 | Outbox/Inbox可能早于Startup Recovery Gate扩大执行范围 | `STARTUP_RECOVERY` | `OPERATIONAL_SAFETY` | Clean Service startup composition | 启动安全、恢复正确性 | Critical | `FACT/RESTART PASSED / CLOSED` |
| UAT-105 | 缺少全新真实Canary证明评分刷新后的Aftercare完整闭环 | `REAL_CANARY` | `END_TO_END`、`RESTART` | Procurement → Libra → Arca Aftercare | 真实正确性、性能、恢复性 | Critical | `UI/FACT/FS/RESTART PASSED / CLOSED` |
| UAT-106 | TMDB cast-only请求成功但返回零演员后，Libra Run保持active且没有开放Work或可行动终态 | `DOMAIN_ORCHESTRATION` | `LIVENESS`、`USER_EXPERIENCE` | Libra Metadata Coordinator + Run Lifecycle + Formation | 活性、可解释性、终态正确性 | Critical | `FACT/UI/RESTART PASSED / CLOSED` |
| UAT-107 | 本地媒体不合格且MoviePilot未配置时，Libra只返回瞬时waiting并被UI误报为执行失败 | `DOMAIN_ORCHESTRATION` | `EXTERNAL_INTEGRATION`、`USER_EXPERIENCE` | Libra Media Planning + Formation + Platform Integration readiness | 活性、可行动性、状态真实性 | Critical | `FACT/UI/RESTART PASSED / CLOSED` |
| UAT-108 | Aftercare把磁盘上已漂移的NFO字节当作受控旧材料释放，导致合法更新和坏NFO重建被Foundation拒绝 | `BUSINESS_CONTRACT` | `METADATA_INTEGRITY`、`MATERIAL_CONTROL` | Arca Aftercare NFO + Material Control + Settlement | 信息保真、活性、控制边界 | Critical | `FACT/FS/RESTART PASSED / CLOSED` |
| UAT-109 | 冻结的Artifact缺失证据仍要求目标旧文件存在，真实海报或NFO缺失无法进入自动修复 | `RECOVERY_CORRECTNESS` | `AUTHORIZATION_FENCE`、`ATOMICITY` | Arca Aftercare Artifact materialization | 活性、回滚安全、幂等 | Critical | `FACT/FS/RESTART PASSED / CLOSED` |
| UAT-110 | Aftercare未注入当前Service Catalog且Inventory与Settlement Approval分两次提交，可能在已推进Inventory后永久卡住 | `DOMAIN_ORCHESTRATION` | `ATOMICITY`、`STARTUP_RECOVERY` | Arca Aftercare Inventory/Settlement + Service Catalog | 原子性、可恢复性、活性 | Critical | `FACT/FS/RESTART PASSED / CLOSED` |
| UAT-111 | 61成员On-deck逐项Settlement反复重建完整Accepted Context并同步重算全Inventory指纹，导致Admin Web持续变慢约79秒 | `PERFORMANCE` | `BOUNDED_CONTEXT`、`EVENT_LOOP_RESPONSIVENESS` | Arca On-deck Settlement | 页面响应、上架活性、逐项证据连续性 | High | `PERFORMANCE/FACT/RESTART PASSED / CLOSED` |
| UAT-112 | 同根上架时相同Physical Material被同时release与acquire，Control变化集重叠 | `MATERIAL_CONTROL` | `ATOMICITY`、`SAME_ROOT` | Arca On-deck Commit | 上架活性、控制连续性、同根正确性 | Critical | `FACT/REGRESSION/RESTART PASSED / CLOSED` |
| UAT-113 | Aftercare转码输出Handle未冻结实际生产视频Profile，色彩转换验收缺少可验证依据 | `PRODUCT_CONFORMANCE` | `MEDIA_PRODUCTION`、`AUDITABILITY` | Arca Aftercare WorkspaceMediaHandle | 成品正确性、可审计性 | Critical | `FACT/REGRESSION PASSED / CLOSED` |
| UAT-114 | Aftercare同一Work内的下游Projection忽略正式sourceResult，错误回查未定义的来源Work | `DOMAIN_ORCHESTRATION` | `PROJECTION_FRESHNESS`、`LIVENESS` | Arca Aftercare Binding Projection | 活性、接线正确性、恢复性 | Critical | `FACT/REGRESSION PASSED / CLOSED` |
| UAT-115 | Aftercare进度混入旧Work且把转码完成误作整个Case 100%，验证阶段不可见 | `USER_EXPERIENCE` | `PROGRESS`、`PROJECTION_FRESHNESS` | Arca Care Projection + Collection Admin Web | 状态真实性、可观察性 | High | `UI/REGRESSION PASSED / CLOSED` |
| UAT-116 | 同根Field/Shelf使Aftercare验证形成重复Resource Demand，Event在Attempt前被Foundation拒绝并反复ready | `RESOURCE_CAPACITY` | `SAME_ROOT`、`LIVENESS` | Composition Resource Demand mapping | 活性、CPU、资源正确性 | Critical | `FACT/REGRESSION/RESTART PASSED / CLOSED` |
| UAT-117 | Aftercare播放验证借用了Libra Workspace端口，Arca Handle在真正解码前被拒绝 | `DOMAIN_ORCHESTRATION` | `MEDIA_VERIFICATION`、`BOUNDARY_CORRECTNESS` | Arca Aftercare playback verification | 活性、边界正确性、成品验证 | Critical | `FACT/FS/RESTART PASSED / CLOSED` |
| UAT-118 | AVI转MKV后物理文件虽正确，Inventory与Material Control仍保留旧AVI Primary | `MATERIAL_CONTROL` | `INVENTORY_INTEGRITY`、`MEDIA_PRODUCTION` | Arca Aftercare Inventory replacement | 收藏健康、控制正确性、幂等 | Critical | `UI/FACT/FS/RESTART PASSED / CLOSED` |
| UAT-119 | Frozen条目只有放弃路径，演员确实无外部资料或外部寻源耗尽时不能由用户显式接受瑕疵入库 | `BUSINESS_CONTRACT` | `AUTHORIZATION_FENCE`、`DOMAIN_ORCHESTRATION`、`USER_EXPERIENCE` | Libra Defect Admission + Handoff B + Arca Aftercare + Admin Web | 用户决断、事实真实性、活性、售后边界 | Critical | `IMPLEMENTED / TARGETED LOCAL PASS / ISOLATED CANARY PENDING` |

### 2.0.1 UAT-074–UAT-084必须保护的历史修复

本轮不是只验收新增页面或新增代码。每项PASS必须同时证明对应历史修复没有回退；下表只是回归绑定，不重开或改写历史UAT的关闭状态。

| 本轮UAT | 必须一并保护的历史UAT | 回归底线 |
| --- | --- | --- |
| UAT-074、UAT-075 | UAT-014、UAT-029、UAT-037、UAT-043、UAT-071、UAT-073 | NFO更新/重建不能把演员Person ID当电影ID、丢失Person强身份、重复人物关系或重新制造007身份/Metadata永久冻结；身份冲突仍须显性保护 |
| UAT-076、UAT-077 | UAT-028、UAT-070 | 既有Related Artwork继续进入正式处置范围；新Artifact Work使用完整Handle和当前Integration revision，单scope失败不能击穿服务启动 |
| UAT-078 | UAT-061、UAT-070 | 设置页状态必须与当前Integration revision和同步终态一致；翻页失败必须收口，重连后不得显示旧revision或误报未配置 |
| UAT-079 | UAT-001、UAT-023、UAT-025、UAT-026、UAT-056、UAT-061、UAT-063、UAT-068、UAT-069 | 豆瓣匹配继续使用规范化Identity Evidence；周期同步、失败收口、直接评分清除、Aftercare共用Resolution及当前Care Basis均不得回退 |
| UAT-080 | UAT-005、UAT-018、UAT-050、UAT-051、UAT-066、UAT-067 | 四桶/筛选、目标架解析、用户操作与加急分离继续成立；加急复用正式API，既有Work replay不发生幂等冲突 |
| UAT-081、UAT-082 | UAT-005、UAT-019、UAT-037、UAT-043、UAT-051、UAT-064 | 详情和当前进展必须来自真实Plan/Work/Event/Result；外层Event成功不能覆盖业务Result失败，GPU/CPU与验证完成态不得伪造，007仍能得到明确恢复动作 |
| UAT-083 | UAT-053、UAT-060、UAT-062 | Field仍可周期观察；同语义Spec不得重复发Run，释放Control后的材料能重新入库且不会形成竞争或重复整理 |
| UAT-084 | UAT-014、UAT-018、UAT-019、UAT-037、UAT-043、UAT-062、UAT-064、UAT-067、UAT-070 | 当前每一行都必须落到可解释的正式事实和恢复路径；不得用通用“冻结/100%/停在那里”掩盖历史故障类型 |
| UAT-086 | UAT-019、UAT-051、UAT-064、UAT-082 | 真正失败仍须显性且可操作；候选不合格后已有开放策略时不得覆盖当前执行责任，GPU/CPU和步骤状态继续由正式事实推导 |
| UAT-087 | UAT-027、UAT-051、UAT-064 | Progress写入失败不得击穿服务；进度必须来自Event执行事实并保持单调，不能由前端估算或用无意义全局100%替代 |
| UAT-088 | UAT-053、UAT-083 | 同根配置继续合法且只形成一次当前Control/整理；不得以拒绝同根配置规避Platform Mount Scope统一解析 |
| UAT-089 | UAT-004、UAT-042、UAT-047 | 大文件仍须走确定性临时槽、复制后指纹校验、同卷原子rename与可恢复Effect；性能修复不得绕过Arca Commit |
| UAT-090 | UAT-002、UAT-027、UAT-037、UAT-053 | Priority Class与Owner projection不变；安全/接纳保留车道不降级；重启仍能恢复真实待办且终态Offer不重开 |
| UAT-091 | UAT-027、UAT-070、UAT-090 | 启动继续fail-closed；只修复可由终态Event确定证明的历史Resource Defer，孤儿或非终态漂移不得被静默忽略；取消必须保持单事务原子性 |
| UAT-092 | UAT-014、UAT-029、UAT-043、UAT-073、UAT-074、UAT-075 | 演员继续作为独立Media Cast事实而非普通描述字段；NFO更新保留原丰富字段和已有Person强身份，重建/创建写入演员但不得把演员Person ID当成影片ID；可修复的演员缺口不得直接形成永久冻结 |
| UAT-093 | UAT-001、UAT-023、UAT-025、UAT-061、UAT-063、UAT-079、UAT-085 | 完整收藏仍须分页、失败有界收口并从最后commit续传；明确Provider/Target身份优先，title只做规范化exact且冲突不选第一项。Product Owner明确取消year校验并取代UAT-085对应保护，不得通过详情补year或把year作为Acceptance Spec评分门禁 |

历史回归证据必须和本轮新场景使用同一代码版本。若历史底线失败，应记录为对应新UAT的回归失败；只有出现独立根因或独立修复边界时才新增UAT，不能为了保持旧PASS而忽略回退。

## 2.1 UAT-006：概览展示固定演示数字

发现于2026-08-21 Movie Canary真实用户UAT Preflight。全新clean库经只读验证为0 Field、0 Shelf、0 Subject、0 Entry，
但浏览器首次打开“概览”仍显示正式收藏2,430、本月新上架86、健康收藏2,105、需要处理7；直接刷新后结果不变，Console无报错。

精确根因有两部分：

1. `GET /v1/admin/overview`虽已进入正式Route Inventory，但`OverviewQueryFacade.get_overview`仍落到
   `CLEAN_FACADE_NOT_IMPLEMENTED`；
2. Admin Web的概览继续使用`surface-model.ts`固定演示数字，因此完全绕过Admin Session和真实Read Model。

修复保持Read-model Owner边界：新增Overview只读Projection，只聚合Procurement、Libra与Arca的正式Application Query；
HTTP adapter和前端均不读取Repository/SQLite。概览页面改为先建立本机Admin Session，再读取正式Overview API，并提供用户显式刷新。

修复验证：相关服务合同22 pass、3个既有显式skip、0 fail；Admin Web production build通过；同一clean UAT库重启服务后，
真实浏览器登录、首次读取与直接刷新均显示4项指标为0、0个活动文件来源、0个活动收藏架，与数据库现实一致且无Console error。
修复与本条Evidence由同一Git commit固化。

## 2.2 UAT-007：人物页展示固定演示数字

发现于同一clean UAT库的全页面首次打开/直接刷新验收。数据库没有People事实，但“人物”页面持续显示已注册人物416、
注册候选3、合并候选1；“注册人物”按钮也没有正式命令接线。

精确根因：People Domain已有Owner-local Store和正式Admin route inventory，但Clean Service未组合People Admin Query，
前端继续由通用`HelixPage`渲染`surface-model.ts`固定数字。

修复范围保持在People Owner与Application Composition：为People Store补充Owner-local只读列表，新增带有界分页的People Admin Query，
接通正式GET routes；Admin Web改为通过Admin Session读取真实Person与Candidate计数，并移除无效的注册按钮。写命令仍保持fail closed，
本修复不伪造尚未完成的People命令旅程。

修复验证：相关服务、People Store/Registration及Admin Web合同43 pass、3个既有显式skip、0 fail；Admin Web production build通过。
同一clean UAT库重启服务并加载新bundle后，真实浏览器显示Person、Registration Candidate、Merge Candidate均为0，空状态正确且
Console无warning/error。直接刷新另发现独立的SPA deep-link 404问题，登记为`UAT-008`，不把该缺陷混入People事实修复。

## 2.3 UAT-008：Admin Web非根路径直接刷新404

发现于People修复后的真实页面复测。侧栏客户端导航可以进入`/people`，但服务端对`GET /people`返回404；同样影响
`/material-fields`、`/shelves`、`/collection`、`/formation`、`/offdeck`和`/settings`。此前`tab.reload()`保留旧Document，
一度掩盖了服务端404和旧bundle缓存，直到直接检查页面实际asset hash及HTTP响应才确认根因。

精确根因：Clean Service Static Adapter只显式提供`/`、`/admin`与`/admin/*`，没有为Admin Web实际七个deep-link路径返回SPA入口；
`index.html`也没有`no-store`，代码修复后浏览器仍可能继续加载旧asset清单。

修复范围只在HTTP/static adapter：七个closed页面路径显式返回`index.html`并设置`Cache-Control: no-store`；未知路径继续404，
`/v1/*`路由与Admin authentication不受SPA fallback影响。

回归测试结果为12 pass、3个既有explicit skip、0 fail；测试同时确认七个页面路径返回SPA入口和`no-store`，未知页面保持404。
同一clean UAT库重启服务后，真实浏览器分别直接打开并刷新七个页面，均恢复到对应页面内容且Console无warning/error。

## 2.4 UAT-009：Formation刷新后丢失已提交评分

真实页面在`养蜂人 (2024)`上提交4星后立即显示“4 星 · 我的评分”，但刷新后再次显示“暂无评分”。只读数据库诊断确认
Direct Perception Record、Resolution revision 2及其winner均已正确持久化，缺陷不在评分写入。

精确根因：Formation Projection自行从Candidate claim拼装Perception rating target；该拼装没有复用Perception正式Target Projection的
title/year规范化结果，形成了不同的Query Input Digest，因此刷新时读回旧的`not_found` Resolution。修复后Formation仅传递Subject ID，
由Perception正式入口统一冻结Target Projection并构造Query，避免跨边界复制身份规则。

针对性回归结果为5 pass、0 fail，并新增Formation对每次Direct Rating的值、来源与revision断言。同一UAT库重启服务后，
真实浏览器显示并在再次刷新后保留“4 星 · 我的评分”，同时恢复显示16条已匹配的豆瓣评分，Console无warning/error。

关闭确认（2026-08-23）：干净 Canary `UAT-20260823-002500-519f8d7b5` 的当前媒体证人
`养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1`原先显示`4 星 · 豆瓣`。通过真实Admin Web点击4星后，
页面立即显示`4 星 · 我的评分`和`清除我的评分`；随后重新导航刷新`/formation`并按片名重新查询，仍显示相同用户评分、
来源和清除入口。未直接编辑Perception或Formation事实。状态`REGRESSION PASSED / CONFIRMED ON CURRENT CANARY`。
UI证据：`admin-web-evidence/uat-009-rating-persists-after-refresh-pass.png`。

## 2.5 UAT-010：未配置Routing时错误开放人工选Shelf

22个Subject停在`preparing`时，Formation目标列仍显示“选择”。真实页面选择唯一Shelf后返回“Clean Service请求处理失败”。
精确根因是人工选择命令只允许`unresolved` Subject且要求有效Decision Head，但页面仅凭`targetShelfId`为空就开放按钮；同时HTTP adapter
未映射Manual Routing的输入、状态与Head冲突错误，因而把可预期的业务冲突降质为500。

修复后Formation仅在`unresolved`且Decision Head完整时展示人工选择；`preparing`明确显示“等待发布文件来源的收藏架分拣策略”。
Manual Routing输入错误映射为400，Subject不存在映射为404，状态或Head冲突映射为409。Admin Web生产构建和Routing E2E均通过；
同一UAT库真实页面显示22条明确等待提示、0个无效“选择”按钮，Console无warning/error。

2026-08-23逐项封口复核沿用clean Canary `UAT-20260822-064512-fe37bffec`的未发布Routing现场证据：真实Formation中
`战栗空间 (2002)`处于`待整理`，目标收藏架列明确显示“等待发布文件来源的收藏架分拣策略”，且该行和整页均没有人工选架入口；
同次`admin-web-preflight-report.json`记录Formation首次打开与直接刷新均成功、Console error为0。该证据命中“未配置时等待且不开放
非法命令”的关闭命题，因此无需为了复现前置状态而撤销当前Canary已经发布的Routing。状态
`REGRESSION PASSED / CONFIRMED ON CLEAN CANARY`。UI证据：
`UAT-20260822-064512-fe37bffec/admin-web-evidence/formation-after-observe.png`。


## 3. UAT-001：豆瓣评分匹配率偏低

分类：

```text
主分类：BUSINESS_CONTRACT
次分类：PROJECTION_FRESHNESS / EXTERNAL_INTEGRATION
非主要分类：RESOURCE_CAPACITY / USER_EXPERIENCE
```

说明：低匹配率的主要根因是Identity Anchor和Alias合同不能表达真实同一性；同步未完成与Resolution刷新滞后会放大问题，但不是唯一根因。前端只是展示了后端事实，并非当前主要缺陷所在。

### 3.1 用户侧现象

Admin Web“上架进度”中，已经进入Libra的Subject能够显示豆瓣评分，但真正成功匹配的数量明显偏低。

评分不直接匹配Procurement Candidate。正式链路为：

```text
Candidate Package
  → Handoff A Accepted
  → Libra Subject
  → Perception Resolution
  → Rating Decision Fact
  → Acceptance Spec
```

因此匹配率应以已经进入Libra并完成Resolution的Subject为分母，不能以全部Candidate为分母。

### 3.2 现场证据

2026-08-20本地真实运行中途快照：

| 指标 | 数量 |
| --- | ---: |
| Candidate Package | 943 |
| active Libra Subject | 259 |
| 已形成current Perception Resolution | 238 |
| `found` | 21 |
| `not_found` | 217 |
| 尚未形成Resolution | 21 |
| 已导入豆瓣Record | 780 |
| 其中带评分Record | 774 |
| 豆瓣同步游标 | 780，`hasMore=true` |

当前阶段成功率为`21 / 238 ≈ 8.8%`。这是同步过程中的快照，不是最终比例；但下述合同与实现问题证明，单纯等待同步结束不足以恢复合理匹配率。

2026-08-21 Movie Canary定向复核进一步确认，当前Admin Web共有3个Subject显示“暂无评分”，但对应豆瓣评分Record均已存在：

| Canary Subject | 已存在豆瓣Record | 当前Resolution |
| --- | --- | --- |
| `养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1` | `养蜂人 / The Beekeeper`，4星，年份2024 | `not_found / no_matching_record` |
| `看不见的朋友 (2023) - 1080p H.264 CHDWEB` | `看不见的朋友 / 我的麻吉4個鬼`，5星，年份2023 | `not_found / no_matching_record` |
| `香火 (2003)` | `香火`，4星 | `not_found / no_matching_record` |

前两部是用户追加的BDMV/ISO Canary样本。挑选时确认的是ShelfDeck已抓取到用户豆瓣评分，证明源Record存在；该筛选没有证明Clean Helix当前Identity Anchor合同能够把新Subject解析到同一Record。Canary选择本身有效，但当时的验收口径缺少一次正式Perception Resolution预检。

### 3.3 初步诊断

#### A. 豆瓣同步尚未完成

当前只导入780条Record，游标仍为`hasMore=true`。历史完整同步约为1,546条、104页。尚未翻到的页面会造成一部分暂时性`not_found`。

分类：运行中的暂态现象，但会放大用户对匹配率的负面感知。

#### B. Title/Year匹配合同过严

当前Beta Resolver的主要豆瓣匹配路径为：

```text
title_year + normalized_exact
```

豆瓣常把中文名、原名和英文名组合为：

```text
中文标题 / 原文标题 / English Title
```

Libra Subject通常只携带其中一个标题。两边实际指向同一电影，但完整字符串不同，因而稳定落入`no_matching_record`。

这不是简单调大模糊阈值能够安全解决的问题。正式Identity Anchor尚未把豆瓣标题别名拆成带Provenance的独立Alias集合。

分类：真实合同与实现缺口。

#### C. 年份后带技术尾缀时形成错误Title/Year Anchor

当前Subject Target生成先处理显式`claimedYear`。一旦年份字段存在，`deriveTitleYear`会保留完整`claimedTitle`，不再从标题中移除括号年份；后续Alias清洗虽能截去部分发行或编码尾缀，却不会再次移除已经留在标题末尾的括号年份。例如：

```text
养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1
  → title_year = 养蜂人 (2024) + 2024

看不见的朋友 (2023) - 1080p H.264 CHDWEB
  → title_year = 看不见的朋友 (2023) + 2023
```

对应豆瓣Record的Alias Anchor分别为`养蜂人 + 2024`和`看不见的朋友 + 2023`，因此`normalized_exact`必然不命中。这不是BDMV或ISO结构问题，而是标题清洗与年份冻结次序错误。

此外，未提供显式年份且标题末尾仍带技术尾缀的Subject仍可能完全无法派生年份。2026-08-20现场259个Subject中有64个缺少有效年份，其中62个已经形成`not_found`。

分类：真实Identity Evidence生成缺口。

#### D. 豆瓣Record缺失年份时没有可用的跨Provider Anchor

`香火 (2003)`的Subject正确形成`香火 + 2003`查询Anchor，豆瓣Record也确有4星评分，但本次豆瓣页面采集没有为该Record解析出年份，因此没有形成`title_year` Anchor，只保存了`douban:movie:1754628` Provider Identity。当前Subject Target的`providerIdentity`为NULL，TMDB或NFO身份也没有被映射为豆瓣身份；两侧不存在共同Anchor，Resolution只能fail closed为`no_matching_record`。

这说明豆瓣采集页面无法提供年份时，不能把“评分Record存在”误呈现为“未评分”；正式修复需要有Evidence的补充年份/Alias来源或经过确认的跨Provider身份关联，不能只按同名自动命中。

分类：真实Provider Observation与Identity Anchor合同缺口。

#### E. 新Record进入后的Resolution刷新滞后

现场存在豆瓣Record中的Title/Year已经与Subject完全一致，但current Resolution仍停留在早期`not_found`的样本；同时也观察到少量Resolution从revision 1的`not_found`升级为revision 2的`found`。

这证明重新解析机制存在，但目前主要依赖周期Subject sweep，豆瓣Page Commit后不能及时、精确地唤醒真正受影响的Subject。

分类：真实运行时接线与用户时效缺口。

### 3.4 业务影响

- 已经存在的用户评分不能及时影响Acceptance Spec；
- Subject可能先形成No-rating Spec并进入后续Libra流程；
- 同一用户在豆瓣已有评分，但Admin Web显示为无评分；
- 同步完成后的匹配率仍可能显著低于真实媒体交集；
- 如果采用无Evidence的宽松模糊匹配，可能错误合并同名翻拍、系列电影或不同年份作品。

### 3.5 后续统一复盘时的修复边界

后续Design至少需要审视：

- 正式Movie Identity Anchor的来源优先级，优先使用可靠Provider Identity；
- 将豆瓣中文名、原名和英文名拆成带Provenance的独立Alias Anchor；
- Candidate/Subject标题清洗优先消费正式Identity Evidence，不依赖任意显示字符串猜测；
- 缺少Provider Identity时，建立有界、确定性的发行标签剥离和年份提取合同，并保证括号年份只出现于年份字段、不重复保留在标题Anchor；
- 豆瓣列表页缺少年份时，定义有Evidence且有界的补充观察或Provider Identity关联路径；不得用单独标题自动关联；
- 豆瓣Page Commit后按新增Anchor精确唤醒Subject Resolution，周期sweep只承担丢失Signal恢复；
- 新Rating Resolution发布后，重新检查尚未开始或仍具替代资格的Acceptance Spec和Libra Run Freshness；
- 保留`unknown/not_found/ambiguous`的fail-closed结果，禁止自动选择第一条或无Evidence的模糊命中。

### 3.6 未来验收证据

集中修复后的验收至少记录：

- 豆瓣同步终态Record数量；
- Subject及`found/not_found/ambiguous`数量；
- Provider Identity、Alias、Title/Year各类命中数量；
- Resolution从Record Commit到刷新完成的延迟；
- 匹配与未匹配的有界人工抽样；
- `养蜂人`BDMV、`看不见的朋友`ISO和`香火`三个定向Canary均解析到现有豆瓣评分Record；
- 误匹配数量；
- 新评分对Acceptance Spec及合法Run Replacement的影响；
- 重启、重复同步及丢失Signal后的幂等性。

### 3.7 当前处理决定

- 修复已实现并完成专项回归，等待第二轮Canary真实浏览器资格；
- 缺年份Collection行会执行最多16个同源、精确Subject详情观察，并把年份、别名及payload digest写入新的immutable source revision；
- 旧Record与历史Resolution不改写，新Anchor只精确唤醒title/year相交的active Subject；
- 技术尾缀、括号年份和Provider多语言别名继续使用严格规则，不扩大模糊阈值；
- `养蜂人`、`看不见的朋友`和`香火`三项只有在新Canary中均读取到既有评分后才可关闭。

## 4. UAT-002：Handoff A Intake接收Subject吞吐异常偏低

分类：

```text
主分类：DOMAIN_ORCHESTRATION
次分类：EXECUTION_SCHEDULING / PERFORMANCE
非主要分类：RESOURCE_CAPACITY / ENVIRONMENT
```

说明：这是广义资源调度问题，但不是CPU、GPU、Volume或Resource Governor Permit容量不足。首要根因是Libra Coordinator把独立Acceptance错误地全局串行化；次要根因是Acceptance Spec占据Work Admission水位，形成跨阶段反压。

### 4.1 用户侧现象

Procurement已经形成943个Candidate Package，但Admin Web“上架进度”中的Subject增长很慢。页面不是完全停止，而是长时间只增加极少量Subject。

### 4.2 现场证据

2026-08-20本地真实运行快照：

| 指标 | 数量或状态 |
| --- | ---: |
| Candidate Package | 943 |
| active Subject | 268 → 269（20.151秒） |
| Intake Evidence Work succeeded | 794 |
| Evidence完成但尚无Acceptance Work | 526 → 525 |
| 全局open Work | 245 → 256 |
| Acceptance Spec open Work | 236（196 admitted、40 running） |
| failed Work | 0 |
| failed Event | 0 |
| Intake Accept Commit | 最近60秒1次；最近300秒9次 |

最老的一批Intake Evidence已经完成约47–50分钟，但仍未形成Acceptance Work。按当前约每20–30秒接收一个Subject的速度，仅现有525个等待项就需要数小时才能收口。

### 4.3 初步诊断

#### A. Intake Coordinator人为全局串行Acceptance

`intake-process-coordinator`中的`otherAcceptanceOpen`会检查Libra Owner下是否存在其他open Acceptance Work。只要存在一份，当前Process就返回`acceptance_queued`。

这意味着不同Candidate、不同未来Subject的Handoff A Acceptance也被强制全局串行。Movie Candidate之间通常不存在共享Subject连续性竞争；真正需要的是每个精确Continuity/Control范围内的CAS，而不是整个Libra域只能同时接收一个Candidate。

`reconcilePending`每轮又只签发一份新的Acceptance Work后停止，进一步把Subject形成速度绑定到fallback/reconcile节奏。

分类：Libra Intake Coordinator调度粒度缺陷，不是Capability执行失败。

#### B. Acceptance Spec提前占满open Work水位

当前256个全局open Work槽位中，236个由`libra_acceptance_spec / acceptance_spec_basis`占用。部分Work和ready Event已持续超过半小时。

新Subject一形成便立即签发Acceptance Spec Work；这些下游Work与尚未完成的Handoff A Intake共用同一个256 admission上限。Priority Projection只影响已经Admission后的选择顺序，不能防止下游Work先占满Admission水位。因此高优先级Intake虽然在Event Scheduler中优先，新的Acceptance Work仍只能等待偶尔释放出的槽位。

分类：跨阶段backpressure和Work Admission接线缺陷。

#### C. Foundation仍在工作，但业务吞吐不合格

20秒双快照、最近一分钟和最近五分钟的Event Attempt均证明队列持续推进；没有failed Work/Event，也没有数据库损坏或Runtime fatal。因此这不是“队列死锁”或Foundation整体停摆。

但open Work达到硬水位、数百份terminal Evidence长期等待、Subject只能单条漏出的状态不符合正常批量Intake预期，应作为真实产品缺陷处理。

### 4.4 业务影响

- 用户看到Candidate已准备完成，但Subject长时间不出现；
- 后续Routing、Perception、Acceptance Spec和Libra Run无法及时开始；
- 整体流水线吞吐被Intake单点限制，而不是由真实I/O、CPU或Provider容量决定；
- 下游Acceptance Spec backlog反向阻塞上游Handoff A Acceptance；
- 大库首次接入可能需要数小时才能仅完成Subject建立。

### 4.5 后续统一复盘时的修复边界

后续Design至少需要审视：

- 将Intake Acceptance并发边界从“全Libra唯一”收敛到精确Candidate/Continuity/Control冲突范围；
- 保留Subject Continuity和Material Control的最终CAS，冲突时只重算受影响Process；
- Handoff Acceptance的Work Admission应有正式保留通道，不能被普通下游Work占满；
- Acceptance Spec必须遵守阶段backpressure，不能在大量Intake尚未收口时无限扩张open Work；
- `reconcilePending`应有界批量签发所有当前可Admission的独立Acceptance，而不是每轮只签发一份；
- Priority Projection、Work Admission和soft/hard cap必须使用同一业务优先级语义；
- 不修改Event Runtime状态机，不以扩大256上限掩盖调度粒度问题。

### 4.6 未来验收证据

- 943个独立Movie Candidate的Subject形成吞吐和总耗时；
- Intake Evidence terminal到Acceptance Work Admission的P50/P95/P99延迟；
- 并行Acceptance数量及精确Continuity冲突数量；
- open Work按阶段、Priority和supplyRole的水位；
- 下游Acceptance Spec backlog存在时Handoff Acceptance仍能持续推进；
- 重启、lost wake、重复Offer及CAS冲突不产生重复Subject或Receipt；
- `failedWorks=0`、`failedEvents=0`且所有Offer最终精确收口。

### 4.7 当前处理决定

- 已移除全Libra Acceptance串行门闩，并保留每轮32项的有界批量Admission；
- Foundation的256项open Work硬上限中固定为Handoff Acceptance预留16项，普通下游Work不能占用；
- 本轮资格回归进一步修复了deferred process仅存在内存Set的问题：重启后从持久Offer分页重建，lost wake不丢工作；
- 400个Candidate在下游积压及Coordinator重启后以13轮全部重新Admission；单轮新Admission不超过32，扫描不超过100；
- 不修改Event Runtime状态机，不扩大256硬上限；新Canary只需确认真实用户侧吞吐和无重复Subject/Receipt。

## 5. UAT-003：Libra Run在Product Identity阶段大量等待

分类：

```text
主分类：BUSINESS_CONTRACT
次分类：EXTERNAL_INTEGRATION / DOMAIN_ORCHESTRATION
非主要分类：RESOURCE_CAPACITY / EXECUTION_SCHEDULING
```

说明：Libra Run已经建立，问题不是Run Creator没有工作。大量Run的TMDB Product Identity Observation形成了合法的业务`not_found`，Coordinator随后按fail-closed规则停在`waiting_product_identity`，没有形成Product Identity事实，也没有后续可执行路径。

### 5.1 用户侧现象

Admin Web中看不到影片明显进入Libra生产流程，长时间没有Workspace、媒体生产或Handoff B进度。

### 5.2 现场证据

2026-08-20本地真实运行快照：

| 指标 | 数量 |
| --- | ---: |
| active Libra Run | 39 |
| `product_identity` Work succeeded | 28 |
| `product_identity` Work running | 12 |
| TMDB Identity Observation `provider_no_match` | 26 |
| TMDB Identity Observation唯一成功 | 1 |
| 已提交Product Identity revision | 1 |
| 已继续进入Metadata Observation | 1 |
| 已继续进入Artifact Production | 1 |

28份succeeded Work包含27份TMDB Observation Work和1份成功样本的Identity Commit Work。因此“Work succeeded”不代表Product Identity已经成立；`provider_no_match`是一次成功完成的Observation，但其业务结果是没有找到唯一匹配。

### 5.3 初步诊断

- 这不是当前Planner偏离SSOT。SSOT机器合同明确规定Movie Resolved Product Identity的Decision Evidence固定为一项`libra.routing.fact.observe@1 → RoutingFactObservation@1`，且只接受唯一`resolved_provider_identity`；
- SSOT中的“Related NFO优先、TMDB补缺”只适用于已经形成Resolved Product Identity之后的`Product Metadata`字段补齐，不适用于前置`Product Identity`解析；
- 因此当前产品顺序实际为“先用Candidate弱标题直接查TMDB形成Identity，再读取NFO补Metadata”。这使NFO中可能已经存在的`tmdbid/uniqueid`、title、year和Alias无法帮助最关键的Identity阶段；
- Product Identity当前依赖`libra.routing.fact.observe@1`向TMDB获取唯一`resolved_provider_identity`；
- Candidate/Subject标题中大量保留`1080p`、`2160p`、codec、audio及edition标签，或使用与TMDB不同的别名；
- Product Identity输入没有优先利用NFO中已有的强Provider ID，也没有复用结构化Alias Evidence；
- TMDB无法唯一匹配时形成`provider_no_match`，这是正确的fail-closed Observation结果；
- Coordinator检测不到唯一Provider Fact后返回`waiting_product_identity`，但当前没有NFO Provider Identity、Alias重试、人工消歧或其他正式恢复路径；
- 所以Run会长期保持active，却不会继续到Metadata、Artifact和Media Production。

该问题与UAT-001共享“Movie Identity Evidence不充分”的上游根因，但影响边界不同：UAT-001导致评分缺失，UAT-003会直接阻断Libra生产主链，因此单独记录。

这属于先前SSOT与实施共同遗漏的真实Design Gap：当时考虑了NFO作为Metadata来源，却没有把NFO作为Provider Identity Claim/Evidence来源纳入Product Identity链。代码当前是在忠实执行这个不完整合同，不能只以实现补丁绕过。

### 5.4 业务影响

- Acceptance Spec虽然已经发布，Libra Run仍无法形成Product Identity；
- Workspace、Metadata、Artifact、Remux/Transcode及Handoff B无法开始；
- 用户看到Run似乎没有启动，实际是39个Run中绝大多数停在第一个专业节点；
- 业务`not_found`不会表现为failed Work/Event，普通技术健康监控可能误判系统正常。

### 5.5 后续统一复盘时的修复边界

- Product Identity应优先消费Candidate NFO中的确定性TMDB ID或其他强Provider Identity；
- NFO中的Provider ID首先只能形成带Provenance的Identity Claim/Evidence，仍须通过正式TMDB Handle按精确ID验证后才能提交Resolved Product Identity，不能无条件信任Sidecar文本；
- 若NFO没有Provider ID，可使用其结构化title/year/Alias形成更强的查询Evidence，再由TMDB唯一匹配；
- 其次消费带Provenance的正式Title Alias和可靠Year，而不是原始Display Title；
- TMDB搜索只允许唯一确定匹配形成Identity，不能自动取第一条；
- 无唯一匹配时需要正式的`unresolved/ambiguous/not_found`恢复合同，包括新Evidence触发重评和必要的用户消歧入口；
- Product Identity Observation的业务`not_found`必须投影为用户可理解的Run阶段，不能只显示笼统active；
- 新Identity Evidence形成后精确唤醒受影响Run，周期sweep只承担恢复；
- 不通过隐藏fallback、模糊搜索或伪造Provider Identity让Run继续。

### 5.6 已讨论的解决方案方向

本轮用户侧测试已讨论并原则认可以下方向。它是后续Design输入，不是已经批准的SSOT或实现合同。

#### A. NFO先形成Identity Claim，不直接成为权威Identity

Candidate Package已经携带与Primary唯一关联的Related NFO Reference。Libra Product Identity阶段应先通过正式只读Handle观察该NFO，并提取：

```text
tmdbid / uniqueid
结构化title
year
original title
可用aliases
NFO association及provenance digest
```

这些内容只能形成带Provenance的Identity Claim/Evidence。NFO是外部Sidecar，可能被错误复制、残留或手工修改，因此不能只凭其中一个ID直接发布Resolved Product Identity。

#### B. 有TMDB ID时按精确ID验证，不重新搜索

若NFO提供TMDB Movie ID，Libra使用正式TMDB Integration Handle直接读取该ID对应对象，而不是再次执行title search或选择搜索结果第一项。

验证至少覆盖：

- ID存在；
- Provider对象类型为Movie；
- TMDB返回的中文名、原名或Alias之一与NFO/Candidate的结构化标题存在规范化一致关系；
- release year不存在实质冲突；
- NFO中其他Provider Identity如存在，不与该对象冲突；
- NFO与当前Primary的Related Association Evidence仍然有效。

通过后形成：

```text
NFO Provider ID Claim
  + TMDB exact-ID Observation
  + Title/Year/Alias consistency Evidence
  + Related Association Evidence
  → Resolved Product Identity
```

#### C. 标题仍参与验证，但不再承担全库猜测

TMDB没有视频字节指纹，ShelfDeck无法从媒体字节数学证明一部电影的Provider Identity。目标是建立高可信、可审计的语义证明链。

标题匹配应限定为：

- 使用结构化title和Alias集合，不使用带`1080p/2160p/codec/audio/edition`标签的原始Display Title；
- 采用规范化精确Alias命中，并结合year；
- 用于验证一个已经由Provider ID指定的对象，而不是从大量结果中模糊猜选；
- 同名翻拍、年份冲突或Alias冲突时保持`ambiguous`。

#### D. 没有TMDB ID时使用逐级Evidence

若NFO没有Provider ID：

1. 优先使用NFO的结构化title/year/Alias进行TMDB唯一匹配；
2. NFO缺失时再使用Candidate正式Identity Evidence中的结构化title/year/Alias；
3. 只有唯一确定匹配才形成Resolved Product Identity；
4. 无结果形成`not_found`，多个无法排除的结果形成`ambiguous`；
5. 网络、认证和协议错误保持技术失败或`waiting_for_external`，不得伪装成业务未匹配。

#### E. 必须先回到SSOT，不能在Planner隐藏读取NFO

当前SSOT把Movie Product Identity Source Basis固定为一项TMDB Routing Fact Observation，NFO优先只存在于后续Product Metadata阶段。因此正式修复需要重新定义：

- Product Identity Observation的Source Order；
- NFO Identity Evidence的typed Result；
- TMDB exact-ID Verification输入；
- Resolved Identity的多Source Evidence与Source Ref关系；
- Work/Plan/Event顺序、重启恢复和Result Binding；
- `not_found|ambiguous|conflicting`的Run恢复及用户消歧Projection。

不得在现有Planner中直接打开NFO、偷偷改写TMDB查询或在Capability内部隐藏fallback。Product Metadata阶段的“NFO字段优先、TMDB补缺”继续保持，它与Product Identity的Evidence链是两个不同责任。

### 5.7 未来验收证据

- NFO强Provider ID、正式Alias、Title/Year及人工消歧各路径的命中数量；
- `observed/not_found/ambiguous`数量和原因；
- Product Identity Observation终态到Identity Commit的延迟；
- 无可靠Identity时零错误Package、零Handoff B Offer；
- Identity Evidence追加后同一Run或合法replacement的恢复行为；
- 完整真实库的Product Identity形成率和有界人工抽样。

### 5.8 当前处理决定

- 当前39个Libra Run和所有Evidence保持原样，不直接改库；
- 当前运行继续，仅成功匹配的Run会向后推进；
- 暂不增加宽松TMDB匹配或隐藏fallback；
- 待用户侧测试结束后，与UAT-001的Identity修复统一Design，再分别回归评分与Libra生产链。

关闭确认（2026-08-23）：经后续已确认设计与实现，干净 Canary `UAT-20260822-141950-0c27c8cf6`
的23个Subject已收成17个completed与6个合法五星外部候选冻结，Formation为`pending=0`、`in_progress=0`。
六个当前冻结证人的「确认影片身份」均100%，并已继续完成资料、海报/NFO、外部寻源与验证；没有Run仍停在
Product Identity等待。状态`REGRESSION PASSED / CONFIRMED ON CURRENT CANARY`。UI证据：
`admin-web-evidence/uat-003-product-identity-no-mass-wait.png`。

## 6. UAT-004：大型Workspace媒体完整SHA-256导致无必要的全文件读取

分类：

```text
主分类：BUSINESS_CONTRACT
次分类：PERFORMANCE / USER_EXPERIENCE
非主要分类：RESOURCE_CAPACITY / EXECUTION_SCHEDULING
```

说明：现有合同对大型Libra Workspace媒体保留完整byte digest，但ShelfDeck已经对所有Physical Material正式接受`PhysicalMaterialIdentity@2`的中段最多256 KiB有界指纹风险模型。用户确认大型生产媒体无需采用更强的逐字节完整性证明。当前实现还在媒体写完后重新读取完整文件计算SHA-256，既超出新的业务需要，也违反现行SSOT“完整Artifact digest只允许从原写入流形成”的约束。

### 6.1 用户侧现象

Libra已经生成实际Remux文件，但对应Event长时间保持`executing`，没有Product Package和Handoff B Offer。FFmpeg进程已经退出，前端也没有显示后续摘要计算进度，看起来像生产链停住。

### 6.2 现场证据

2026-08-20本地真实运行中：

- `倩女幽魂 (1987)`的Remux输出已经写入Libra Workspace，文件大小为`14,671,542,989` bytes；
- Workspace文件最后写入时间为20:19:47，现场已无FFmpeg子进程；
- `libra.media.remux@1`仍为`executing`，其后的Output Probe、Product Verification和Output Selection均为`pending`；
- Node服务进程持续占用约一个CPU核心；
- `libra_product_packages=0`，因此尚无Handoff B Offer；
- 同时另一Run的Artifact Event在等待`volume_write`和`sqlite_write`资源，扩大了该长Event对后续链路的影响；
- 产品代码在媒体完成并原子改名后调用`digestFile(target)`，对完整Workspace媒体执行第二遍读取。

### 6.3 初步诊断

需要区分两个问题：

1. 完整媒体SHA-256是否具有必要业务价值；
2. 如果保留完整SHA-256，应如何计算。

现行SSOT允许系统生成Artifact使用完整SHA-256，但明确要求完整digest只能从原始写入流形成，不得在完成后重新扫描大型Physical Material。当前实现属于明确的实现偏差。

进一步业务复盘后，用户确认大型媒体本身也不需要完整SHA-256。ShelfDeck已经接受以下Physical Material风险边界：相同size和中段样本相同、但未采样区域发生变化时，Identity可能保持不变；底层bit rot、scrub和存储完整性由NAS/文件系统负责。Libra生成的MKV/MP4等大型媒体没有充分理由采用另一套更昂贵的逐字节Identity语义。

大型媒体的交付可信度应由以下Evidence共同证明：

```text
PhysicalMaterialIdentity@2
+ size / inode / stat fence
+ 中段最多256 KiB SHA-256
+ ffprobe结构验证
+ 首/中/尾有界解码
+ Acceptance Spec与Product Conformance
```

Package、Receipt、Canonical JSON等结构化事实的SHA-256与媒体字节Identity是不同概念，仍应保持完整JCS/SHA-256。

### 6.4 业务影响

- 每个大型Remux/Transcode产物完成后又产生一次按文件大小线性增长的完整读取；
- 未来Workspace位于NAS时会增加不必要的大容量I/O和运行风险；
- 摘要阶段占用CPU和Workspace相关Permit，阻塞其他Run的Artifact或媒体生产；
- Event没有对应进度，用户只能看到长时间`executing`；
- 大型媒体与源Physical Material采用两套风险模型，增加Handoff B、Arca Inventory和Aftercare合同复杂度。

### 6.5 已讨论并确认的解决方案方向

后续Design Return应统一以下规则：

- MKV、MP4、M2TS及其他大型媒体统一使用`PhysicalMaterialIdentity@2`：size、inode、中段最多256 KiB指纹及前后stat fence；
- Libra Workspace媒体、Handoff B Product Manifest、Arca Staged/Final Inventory及Aftercare媒体重验不得要求完整媒体SHA-256；
- Product Media Verification继续执行ffprobe、首中尾有界解码、动态范围/色彩、codec、raster、audio和`maxSizeBytes`等正式要求；
- NFO、JSON、Receipt、Canonical Transaction、typed fact及其他小型结构化内容继续使用完整SHA-256；
- Poster、字幕等小型Artifact可继续使用完整SHA-256，不把大型媒体优化扩大为删除所有Artifact完整性Evidence；
- Handoff B通过完整typed Handle、Material Identity、Verification和Provenance传递媒体，不再以完整byte digest冒充或增强Physical Material Identity；
- Workspace Effect的幂等与崩溃恢复改用固定Output Target、Effect Journal、size、bounded fingerprint、stat/containment fence和Verification Evidence；
- 不保留“大文件完整digest可选fallback”或双合同，避免不同Domain再次出现不一致语义。

这项方向需要先修订唯一SSOT及机器合同，再修改Workspace、Promotion、Arca Acceptance/On-deck、Inventory和Aftercare校验；不能只删除当前`digestFile(target)`调用，让下游继续假设完整digest存在。

### 6.6 未来验收证据

- 0字节、小文件及大于256 KiB媒体的Identity边界；
- 每个大型Workspace媒体在生成后额外读取量不超过262,144 bytes；
- Remux/Transcode输出的ffprobe、首中尾解码及Acceptance Spec验证全部通过；
- Handoff B、Arca On-deck、Inventory、Aftercare和Off-deck不再要求完整媒体byte digest；
- 重启及Effect crash window不重复生成媒体，也不把路径上替代Identity误认为原产物；
- 大型媒体Event具有有界进度并及时释放Workspace/SQLite Permit；
- 小型Artifact、Package和事务JCS/SHA-256合同不受误删；
- 对比修复前后的额外读取字节、CPU时间、首个Handoff B时间及多Run并行吞吐。

### 6.7 当前处理决定

- Workspace媒体写入完成后固定使用中段最多256 KiB指纹，不执行完整文件SHA-256；
- 新增实际稀疏大文件读取预算断言，覆盖MKV、ISO、BDMV M2TS和转码输出，逐文件恰为262,144 bytes；
- Workspace Reference的primary media验证拒绝`digestAlgorithm=sha256`，完整digest不能被下游重新要求；
- NFO、Artwork、typed facts等小型Artifact/结构化内容继续使用完整SHA-256，不扩大优化边界；
- 真实Canary仍需确认大型媒体完成时延、Handoff B和Arca输出均不再复现长时间摘要阶段。

关闭确认（2026-08-23）：干净 Canary `UAT-20260823-002500-519f8d7b5` 已完成16个可上架Movie的真实生产与
On-deck。Admin Web中9.3 GB的ISO证人`倩女幽魂2：人间道`显示为`Movie Canary`当前收藏、主视频
`9.3 GB · MKV`且收藏健康。只读正式事实覆盖16个大于256 KiB的Package Primary Payload，大小范围
625,953,034–10,021,609,024 bytes：16/16的`fingerprint_algorithm`与`digest_algorithm`均为
`middle-256k-sha256`，`sha256`为0；对应16个Arca Final Inventory Primary同样16/16使用中段指纹。
44个小型Artifact仍44/44保留完整`sha256`，证明优化没有误删小型结构化Artifact完整性。状态改为
`REGRESSION PASSED / CONFIRMED ON CURRENT CANARY`。UI证据：
`admin-web-evidence/uat-004-large-media-bounded-fingerprint-pass.png`；FACT证据：`uat-004-fact-evidence.json`。

## 7. UAT-005：Libra Admin Web媒体整理工作区信息架构

分类：

```text
主分类：USER_EXPERIENCE
次分类：PROJECTION_FRESHNESS
非主要分类：BUSINESS_CONTRACT / EXECUTION_SCHEDULING
```

说明：当前Formation页面直接暴露Subject、Routing、Decision、Spec等内部模型语言，不能回答用户最关心的“有哪些媒体等待整理、要整理成什么样、系统准备做什么、现在做到哪一步”。后端Subject、Routing Decision、Acceptance Spec、Libra Run和Handoff B合同保持不变；本问题要求Admin Web及其公开Projection将这些事实翻译成稳定的用户语言。

### 7.1 已确认的页面定位

- 页面正式命名为`媒体整理工作区`；
- 删除“每一行，都是已经接收的一份收藏主体”等内部实现说明；
- 页面不直接展示Subject、Routing Decision、Acceptance Spec、Libra Run、Handoff B、revision、digest、Work或Event等术语；
- 内部业务对象继续存在，但必须投影为用户可理解的媒体整理状态；
- 页面工作重心是尚未完成的媒体，已完成记录放在下方折叠区域。

### 7.2 顶部四项统计

顶部Dashboard固定展示四个互斥节点（本节原三项合同已由UAT-018的用户确认修正）：

| 节点 | 建议业务定义 |
| --- | --- |
| 待整理 | 已经完成Handoff A Acceptance，但没有Attention且尚无当前开放可推进的Libra/Arca责任；包括正在形成目标、评分、要求或下一Run |
| 整理中 | 当前存在开放可推进的Libra生产、Arca Acceptance或On-deck责任；Package published及Handoff B Accepted仍属于此类 |
| 需要处理 | Product Identity确认、technical failure、blocked、suspended或frozen；需要用户决定或明确恢复动作 |
| 已完成整理 | Arca On-deck Commit已同时建立Shelf Entry与Deck Fact；Package或Acceptance单独不足以完成 |

若Handoff B被拒绝并形成replacement Run，该媒体按当前事实进入`需要处理`或`整理中`，不得继续计入`已完成整理`。四个统计值必须由同一Formation Projection计算，不能由前端分别拼接可能不一致的API数量。

### 7.3 页面上下分区

页面采用工作区式上下结构，不以三个Tab隐藏彼此：

```text
媒体整理工作区

[待整理 N] [整理中 N] [需要处理 N] [已完成整理 N]

等待整理
  尚未建立可执行整理Run的媒体

正在整理
  已进入资料、媒体生产或验证链的媒体

已完成整理（N）                         [展开/收起]
  默认折叠；展开后按游标分页读取历史完成条目
```

- 页面上方持续展示仍需关注的`等待整理`和`正在整理`；
- 新完成的条目从上方工作列表移动到下方`已完成整理`区域；
- `已完成整理`默认折叠，避免大量历史条目持续占据注意力；
- 折叠状态属于浏览器本地偏好，不成为业务事实；
- 展开后必须分页或按游标加载，禁止一次渲染全部历史；
- 已完成条目仍可查看目标收藏夹、整理要求、实际整理动作和完成时间。

页面整体列表名称使用`媒体整理列表`。仅对应待处理分区时使用`待整理媒体`，避免已经完成的媒体仍被称作“待整理媒体”。

### 7.4 列表字段与语言

主列表字段固定为用户语言：

| 字段 | 用户侧语义 |
| --- | --- |
| 媒体名称 | 用户可识别的电影、Season或其他媒体名称；不显示Subject ID |
| 我的评分 | 保留既有1–5星评分入口及当前评分来源 |
| 目标收藏夹 | 显示已选中的Shelf名称；未确定时显示`等待选择`，不再展示Routing状态码 |
| 媒体数 | 当前待整理范围内Primary媒体数量；Movie通常为1，Series可对应多个Episode Primary |
| 整理要求 | 最终媒体必须达到的用户可理解目标 |
| 整理动作 | 系统为达到整理要求而选择的整体施工路径 |
| 添加时间 | Handoff A被Libra接受并形成该媒体条目的时间；替代当前“最近接收” |
| 下一步动作 | 当前立即执行、等待或需要用户处理的具体动作，以及可用的真实进度 |

主列表不再显示Related Material数量。字幕、NFO、Poster、Fanart等Related信息在媒体详情中按角色展示。

### 7.5 整理要求与整理动作

两列必须明确分工：

- `整理要求`回答“最终要变成什么样”，由Acceptance Spec翻译形成；
- `整理动作`回答“系统准备怎么做到”，由当前Gap Assessment及Production Plan翻译形成。

示例：

| 整理要求 | 整理动作 |
| --- | --- |
| HEVC、最高20 GB | GPU转码 |
| MKV、保持原画质 | 无损重新封装 |
| 补齐影片资料和海报 | 获取TMDB资料并生成NFO/Poster |
| 当前输入已经满足全部要求 | 直接采用原媒体 |

无评分Acceptance Spec不得显示`No-rating Spec`，应显示`按收藏夹默认要求整理`。尚未完成施工决策时，整理动作显示`正在评估`，不得提前猜测或显示Capability名称。

### 7.6 下一步动作与进度

`整理动作`描述整套施工方案；`下一步动作`只描述当前最接近用户的一步。下一步动作必须由durable业务阶段和Event Progress Projection形成，不能根据页面轮询时间猜测。

用户文案示例：

```text
正在通过TMDB确认影片身份
正在生成NFO和海报
正在无损重新封装媒体 · 68%
正在验证整理结果
等待选择目标收藏夹
无法唯一确认影片身份 · 查看并处理
```

进度采用“阶段进度 + 可用的真实任务进度”：

```text
接收 → 确认目标 → 形成要求 → 整理制作 → 验证结果 → 完成
```

- Remux、Transcode、下载等拥有正式进度Evidence时显示确定百分比；
- TMDB请求、Permit等待等无法量化时使用indeterminate状态，不伪造百分比；
- 等待用户操作时停止动画并展示精确动作入口；
- blocked、suspended、frozen必须翻译为具体可理解原因；
- 不显示Event数量、Attempt编号、队列槽位或内部错误堆栈。

### 7.7 后续实现与验收边界

- 优先扩展Formation公开Projection，一次返回列表所需的紧凑用户状态，避免页面N+1读取内部Store；
- 后端保持一行对应一个Subject，但API与页面不暴露Subject术语；
- 顶部统计、上方两个活动分区和下方完成列表必须使用同一状态分类函数；
- 页面刷新、服务重启及Run replacement不得造成同一媒体短暂重复出现在多个分区；
- 已完成列表展开、折叠和分页不产生业务副作用；
- 验收覆盖等待身份、等待目标、等待评分、准备Spec、直接采用、Artifact、Remux、GPU/CPU Transcode、External Acquisition、Verification、Handoff B Ready、replacement和业务阻塞；
- 对每类样本核对“整理要求”“整理动作”“下一步动作”是否与后端正式事实一致；
- 桌面、窄屏、键盘操作、无障碍名称和reduced motion均需回归。

### 7.8 当前处理决定

- 页面重构方向已经讨论并获得用户确认；
- 2026-08-22 用户进一步确认当前媒体筛选、分步整理动作/进度/操作/加急列及完成区动作清单，分别登记为 `UAT-050`、`UAT-051`；
- 2026-08-22 实现：四桶 Classification 与用户语言工作区已在 Formation 公开 Projection / Admin Web 落地；剩余「概括句整理动作」并入 `UAT-051` 以 `organizingSteps[]` 收口。本项代码已完成，不宣称用户验收或 Canary 通过。

证据：

- `media-service/src/helix/domains/libra/application/formation-query.js`
- `media-service/web/src/helix/FormationPage.tsx`
- `media-service/test/helix-formation-projection.test.js`
- `docs/helix/USER_ACCEPTANCE_TEST_ISSUE_LOG.md` §48

## 8. UAT-011：Handoff B 在同根 Shelf Target 前永久等待

问题分类：`BUSINESS_CONTRACT / EXECUTION_RECOVERY / SAME_ROOT_INVENTORY`

用户侧现象：媒体整理页已有5部电影显示“等待收藏架接收”，但“我的收藏”始终为0；刷新页面没有错误提示，`G:\canary_film`也没有形成任何Arca Inventory变化。

现场证据：

- 5份`libra.product-offer.available@1`均已交付Arca，但`arca_handoff_b_receipts=0`、`arca_shelf_entries=0`；
- 5个`arca.acceptance.inventory_feasibility.observe@1` Attempt持续处于`executing`；
- 服务日志对5个包均报告`CLEAN_ARCA_TARGET_COLLISION`；
- 每个包同时包含Workspace生成的`poster.jpg`和Candidate原有的`poster.jpg`，二者内容指纹相同但Material Key不同；原NFO和生成的`movie.nfo`也同时作为最终Product成员；
- Canary的Material Field与Shelf Target均为`G:\canary_film`，目标电影目录在Arca On-deck前已经存在。

初步诊断已经闭合为三个实现缺陷：

1. Libra Product Delivery把需要替换的Related仍标为`carried_forward`，导致旧Related和successor同时进入Product Manifest；
2. Execution Runtime把纯观察Executor异常留成不可恢复的`executing` Attempt，页面因而只显示永久等待；
3. Arca Target Slot只接受尚不存在的目标目录，未实现SSOT已确认的同根原位no-op及有界合并落位。

业务影响：任何带既有poster/NFO的普通电影都可能在Handoff B前卡死；即使修复包内重复，同根真实部署也会在Target Slot Prepare或Placement Switch再次失败，无法建立Shelf Entry。

修复边界：

- Libra按角色把已验证Artifact作为Related successor，Product Manifest只保留successor；原Related仅在Off-load Context中以`replaced_and_settled`等待精确settlement；
- Foundation仅对无外部Effect的`pure_observation` Executor异常形成普通失败Outcome；非纯Effect仍保持Effect-specific recovery；
- Arca允许既有目标目录，对已经位于精确最终位置且字节一致的成员形成no-op，对缺失成员从Target Slot合并落位；冲突字节继续fail closed；
- settlement若源位置就是已验证最终Inventory位置则形成`retained_as_final` Evidence，不删除最终文件；其他被替换输入仍精确删除。

验收证据：

- `p4-event-runtime.test.js` 26/26 PASS，包含普通dispatch及startup recovery两条纯观察异常收口路径；
- `p9-delivery-lifecycle.test.js` 10/10 PASS；
- `p9-deliverable-promotion-store.test.js` 11/11 PASS；
- `clean-arca-inventory-port.test.js` 1/1 PASS，覆盖同根既有Primary、同字节poster no-op、新NFO合并、旧NFO settlement及最终Reality读取；
- 修复提交：`888e6d8bc`、`b85135698`、`f6e8925fe`、`0dd1c7c76`；
- 真实Admin Web已把“老笠 (2016)”评分改为3星并建立replacement Run，当前显示“视频转码 / 处理视频文件 executing”；完整Handoff B、On-deck、Collection和物理Reality仍待后续小时观察点验证。

当前处理决定：问题已修复并分别提交；不修改旧的不可变Package或直接编辑UAT数据库。通过用户页面产生replacement Run验证新代码；在其到达终态前，第11、12阶段保持未通过。

关闭确认（2026-08-23）：干净 Canary `UAT-20260822-141950-0c27c8cf6` 的活动Material Field与
`Movie Canary` Shelf Target均为`F:\canary`；收藏架页面显示可接收整理结果且有17个收藏条目，收藏页17部均为
当前收藏。同根Handoff B/On-deck已真实完成，不再永久等待。状态`REGRESSION PASSED / CONFIRMED ON CURRENT CANARY`。
UI证据：`admin-web-evidence/uat-011-same-root-shelf-config.png`、`uat-011-same-root-handoff-b-complete.png`。

## 9. UAT-012：On-deck Planner 丢失 Settlement Approval 契约

问题分类：`EXECUTION_CONTRACT / ARCA_ONDECK`

用户侧现象：`老笠 (2016)`等5部电影完成Libra整理后持续显示“等待收藏架接收”，Collection仍为0；服务高频报告`P4_PLAN_CAPABILITY_CONTRACT_MISMATCH`。

现场证据：重启到已包含UAT-011修复的本地服务后，错误仍在On-deck计划形成前持续复现；`arca.ondeck.input_settlement.delete@1` Manifest要求`exact-settlement-approval`，但On-deck Planner生成所有节点时把`approvalRequirementRef`和`authorizationRequirementRef`统一写成`null`。

根因：Planner没有逐节点保存Capability Manifest冻结的审批与授权契约。带`replaced_and_settled`输入的Package必然包含Settlement节点，因而整份On-deck Plan被Foundation正确拒绝；Fallback Reconciler再次提交同一计划，形成高频错误。

修复边界：On-deck Planner仅从已解析Manifest逐字保留`approvalRequirementRef`与`authorizationRequirementRef`，不更改审批业务规则、不绕过Foundation验证，也不直接修改UAT事实或媒体文件。

验收证据：

- `p10-handoff-b-ondeck.test.js`与`p4-workflow-plan.test.js`合计16/16 PASS；新增测试明确断言Settlement节点保存Manifest Approval Contract；
- 修复提交：`4402d9e8a`；
- 重启本地服务后不再出现`P4_PLAN_CAPABILITY_CONTRACT_MISMATCH`；
- 真实Admin Web中Collection从0变为1，`老笠`建立正式Shelf Entry并显示“健康”，用户评分仍为3星；
- 本轮开始时`G:\test_film`与`G:\canary_film`仍为454个文件、143,829,081,819字节且相对路径/大小完全一致，基线未被修改；后续Inventory物理结果按下一小时观察点继续验收，不持续轮询。

当前处理决定：问题已完成修复、回归、提交和浏览器用户验收。其余4份已完成Package是否逐一进入Collection留给后续小时观察点，不以本次即时等待替代验收。

## 10. UAT-013：Resolved Identity 被错误渲染为哈希 Inventory 目录

问题分类：`USER_VISIBLE_INVENTORY / SAME_ROOT_PLACEMENT / IDENTITY_PROJECTION`

用户侧现象：Admin Web把`老笠`显示为已上架且“健康”，但真实Inventory位于`G:\canary_film\1cbf…b786 (0)`；原`老笠 (2016)`目录仅移除了主视频、NFO和poster，Related材料留在原目录，形成一个Shelf Entry横跨两个用户可见目录的错误结果。

现场证据：本轮开始时只读差异为Baseline 454个文件、Canary 456个文件；3个原路径缺失，5个文件新增到哈希目录，文件大小无同路径漂移。Package的正式Resolved Identity包含`displayIdentity.entries[{key:"title",value:"老笠 (2016)"}]`，但Inventory Port只读取不存在的顶层`title/displayTitle/canonicalTitle`，继而退回`onDeckPackageId`；同时`Number(null)`被当作合法年份0，最终渲染为`{packageId} (0)`。

业务影响：页面健康结论不能证明用户看到的物理收藏符合Placement Policy；同根Shelf会把原目录拆散，正是Canary需要阻止进入真实环境的破坏性结果。

修复边界：Inventory Port从正式Resolved Identity的Display Identity条目读取标题；从`标题 (YYYY)`有界派生年份并避免重复年份；缺少用户可读标题时fail closed，禁止再以Package ID建立哈希目录；空年份不再转换为0。未直接移动、删除或修复Canary中的既有错误文件。

验收证据：

- `clean-arca-inventory-port.test.js`与`p10-handoff-b-ondeck.test.js`合计10/10 PASS；覆盖`老笠 (2016)`与`{title} ({year})`得到精确目标目录、缺少标题fail closed，以及同根Stage/Switch/Settlement；
- 修复提交：`6d67d0ddb`；
- 本地服务已加载修复且没有新的Execution Runtime错误；
- 真实Admin Web已给`坠楼死亡的剖析 (2023)`保存4星用户评分，作为修复后新Package的浏览器验收样本；其形成正确Inventory前不宣告完整E2E通过。

当前处理决定：代码根因已修复并提交；现有错误`老笠`Shelf Entry不通过直接文件操作纠正。下一小时观察点从Admin Web确认新样本的生产与上架结果，并再次只读核对物理目录。

## 11. UAT-014：Formation 隐藏 Product Identity 冲突

问题分类：`USER_VISIBLE_PROJECTION / PRODUCT_IDENTITY / CONTRACT_LAYER`

用户侧现象：`坠楼死亡的剖析 (2023)`已经完成NFO与TMDB身份观察，但媒体整理页持续显示通用的“正在确认目标、评分、要求或身份”，没有呈现需要用户确认的媒体身份冲突，也没有候选身份入口。

现场证据：当前Run已有两份成功的`libra.product_identity.evidence.observe@1`结果：NFO观察解析到TMDB Movie `915935`，Provider exact观察返回`provider_identity_conflicting`及候选`Anatomy of a Fall (2023)`；按SSOT，中文标题与Provider别名未经Alias关联时不能自动建立Product Identity，因此等待用户选择是正确业务结果。

根因：Formation Projection用Capability Result Binding外层的`resultSchemaRef`匹配业务Result内部的`ProductIdentityEvidenceObservation` schema，比较了两个不同合同层；条件永远不成立，所有`ambiguous`、`conflicting`和`unresolved`身份观察都被页面静默隐藏。

业务影响：用户无法知道媒体为什么停止整理，也无法从页面完成正式的Product Identity Selection；多个实际处于`attention_required`的电影被错误呈现为普通等待。

修复边界：Projection只接受精确Capability Ref `libra.product_identity.evidence.observe@1`，并从`event.result.result.schemaRef`验证业务Observation合同；不放宽Alias、年份、NFO Association或Provider exact验证规则，不跨越Libra事实边界。

验收证据：

- `helix-formation-projection.test.js`与`helix-product-identity-selection.test.js`合计7/7 PASS，新增用例区分Capability Result Binding与业务Result schema；
- 修复提交：`8239ce99a`；
- 真实Admin Web刷新后，`坠楼死亡的剖析 (2023)`显示“媒体身份信息冲突”、`attention_required`及候选`Anatomy of a Fall (2023)`；其他既有冲突和未解析项也恢复为可操作的用户状态；
- 通过候选按钮已写入TMDB Movie `915935`的不可变Selection Intent，证明真实页面入口可提交用户选择；后续Product Identity exact验证及新Package仍按每小时观察点继续，不以即时等待替代E2E结论。

当前处理决定：Projection根因已修复、回归、提交并完成浏览器用户验收。未修改SSOT身份匹配规则、Canary媒体文件或旧的不可变Work；完整媒体整理与上架结果仍未宣告通过。

2026-08-23逐项封口复核确认该真实Canary证据已经覆盖完整用户闭环：Formation明确显示`媒体身份信息冲突`和候选
`Anatomy of a Fall (2023)`，候选按钮成功形成TMDB Movie `915935`的不可变Selection Intent。当前重建Canary因后续
本地化与Alias修复已能自动解析该样本，不再自然产生同一冲突；本轮不伪造身份事实，改以原真实页面/命令证据并重新执行
`helix-formation-projection.test.js`与`helix-product-identity-selection.test.js`共18项回归，18/18 PASS。状态
`REGRESSION PASSED / CONFIRMED ON CANARY`。

## 12. UAT-015：Frozen Libra Run 没有用户 Discard 入口

问题分类：`USER_RECOVERY / LIBRA_RUN_LIFECYCLE / EXPLICIT_DECISION`

用户侧现象：`坠楼死亡的剖析 (2023)`在身份确认后的Provider exact Work失败并正式进入`frozen`，但媒体整理页仍显示旧的“媒体身份信息冲突”，继续提供对Frozen Run无效的身份验证候选；用户无法理解当前终态，也无法执行SSOT要求的显式Discard。

现场证据：Run `a5bd…c4be`为`frozen`、state revision 3，最新Product Identity Work及Attempt均已`failed`；一小时后页面仍显示相同身份候选。Formation Projection先判断`productIdentityIssue`再判断Run state，前端也对任何带Identity Issue的Run无条件渲染身份确认控件，同时没有调用既有`POST /v1/admin/formation/runs/:libraRunId/actions/discard`的用户入口。

业务影响：Frozen Run不能由Reconciler自动恢复，用户又无法提交唯一合法的Discard Decision，因此原始输入控制无法释放，也不能按当前Eligibility重新采购；页面提供的身份按钮只会形成无效重放，制造“点击无反应”的体验。

修复边界：Frozen与Suspended Run state优先于旧的Product Identity Issue形成用户状态；Frozen仅显示“本次整理已冻结，需要放弃后重新采购”，隐藏无效身份及加快操作，并提供带浏览器确认的“放弃本次整理”按钮。按钮调用既有Libra-owned Discard合同及精确state revision/digest fence，不自动Discard、不自动恢复Run，也不删除原始媒体。

验收证据：

- `helix-formation-projection.test.js`及`p9-run-lifecycle-store.test.js`合计16/16 PASS，Admin Web TypeScript/Vite build PASS；
- 修复提交：`6e88c9d61`；
- 真实Admin Web刷新后，`坠楼死亡的剖析 (2023)`与`一场很（没）有必要的春晚 (2022)`均显示Frozen说明及“放弃本次整理”按钮，不再显示无效身份确认或加快入口；
- 本轮只验证用户入口，未代替用户确认Discard，未修改Canary媒体文件。

当前处理决定：用户侧恢复入口已修复、回归、提交并完成浏览器可见性验收。两项Frozen Run仍保留原状，等待用户明确决定是否Discard；完整Movie Canary UAT仍不通过。

## 13. UAT-016：TMDB 正确候选被本地语言与标题过滤误报为未找到

问题分类：`PRODUCT_IDENTITY / PROVIDER_LOCALE / TITLE_NORMALIZATION`

用户侧现象：媒体整理页大量电影显示“暂未找到匹配的媒体身份”。当前17个未完成条目中，10个Projection结果为`not_found / provider_no_match`，另有5个显示`provider_identity_conflicting`。

现场证据：经用户允许，使用当前本地UAT已配置的TMDB连接重新执行只读查询；`007：大破天幕杀机`、`金的音像店`、`养蜂人`、`放·逐`、`战栗空间`均返回正确电影，TMDB ID分别为`37724`、`1058673`、`866398`、`13807`、`4547`。相同中文查询在`en-US`下返回英文Display Title，在`zh-CN`下返回与Canary标题一致的中文Display Title。

初步诊断：当前TMDB Adapter固定使用`language=en-US`；TMDB Search可以通过中文别名检索到对象，但ShelfDeck随后只接受Provider返回的`title/originalTitle`与中文Candidate Display Title精确相等的候选，因此把正确结果过滤为`provider_no_match`。NFO已给出精确TMDB ID的样本也会因`/movie/:id`返回英文标题、缺少Translations/Alternative Titles证明而被判`provider_identity_conflicting`。BDMV等标题若在年份后仍带分辨率、Codec或Release尾缀，现有清洗也不能形成正确查询标题。

业务影响：页面把“TMDB零结果”和“TMDB有正确结果但被本地过滤”合并为同一未找到状态，迫使用户逐部手工选择身份，并可能冻结本应自动继续的Libra Run。

拟定修复边界：不放宽Product Identity严格关联规则；TMDB语言应来自用户可见配置或明确的本地化策略；精确ID验证应读取可证明Alias的Translations/Alternative Titles；查询前有界清理年份、分辨率、Codec和Release尾缀；Projection区分Provider零结果与候选被本地过滤。具体实现进入修复时再补测试与浏览器验收。

当前处理决定：修复已实现，等待第二轮Canary真实浏览器资格确认。TMDB连接新增用户可见语言设置，默认`zh-CN`；Search、
精确ID与Metadata共用该revision。Adapter有界取得Original Title、Alternative Titles与Translations，Libra严格关联会消费这些
别名而不放宽为模糊匹配。旧连接不要求重录Credential，旧不可变Observation/Run事实不被改写。专项Integration回归和Admin Web
production build通过；真实Provider重取及Canary结果留在新UAT记录中。

## 14. UAT-017：外部寻源未按 Acceptance Spec 预筛候选，下载后才发现产品不可达

问题分类：`BUSINESS_CONTRACT / EXTERNAL_ACQUISITION / ACCEPTANCE_PREFLIGHT`

用户侧现象：`一场很（没）有必要的春晚 (2022)`经MoviePilot寻源、下载、稳定性观察、身份验证、包验证和导入后，直到最终`ProductMediaVerification`才发现候选为H.264、低于4K且主音轨不满足要求；5星Acceptance Spec要求HEVC、4K和合格主音轨，因此最终没有passed候选，Libra Run以`product_unachievable / no_passed_candidate`冻结。用户质疑为何寻源阶段不能先判断种子是否明显不符合要求。

现场证据：

- 本次MoviePilot Search只返回并选择了一个候选，选择结果为`selected_by_provider_rank`；
- `AcquisitionQuery@1`只包含身份、结构、Episode Scope、查询词和`hardConstraints{requiredStructureKind,requiredEpisodeKeys}`，没有携带当前Acceptance Spec派生的`MediaRequirement`；
- `ProviderAcquisitionCandidateSnapshot`只公开Provider Rank、Availability、Identity Anchor、Structure和Episode Key，未公开候选声称的分辨率、视频编码、主音轨、大小及其Evidence；
- MoviePilot Adapter原始结果包含`torrent_info`等发布信息，但当前合同只通过opaque `providerCandidateRef`保留Provider定位，Libra无法在下载前按正式Requirement评估这些声明；
- 当前`SelectionCriteria@1`固定为`available_provider_rank_then_candidate_id`，明确只按Availability、Provider Rank和Candidate ID选择，因而不能把Acceptance Spec符合性用于候选Eligibility。

初步诊断：当前实现符合既有SSOT，但既有External Material Acquisition合同缺少“下载前广告声明预检”。产品要求已由Acceptance Spec明确给出，却没有进入Acquisition Query、Candidate Snapshot和Candidate Selection，所以系统只能在下载并探测真实字节后首次判断媒体规格。这是已确认合同层缺口，不能通过Adapter私自过滤、解析字符串后静默排序或Executor读取current Spec来绕过。

业务影响：明显不满足用户要求的种子仍会消耗下载时间、带宽和临时空间；失败发生在昂贵外部副作用之后，并可能直接冻结Run。若首个候选的发布声明不合格而后续候选合格，当前固定首选规则也不会在下载前跳过不合格候选。

拟定修复边界：

- 保留下载后对真实媒体字节的FFprobe最终验证；发布信息只是预筛Evidence，不能替代最终验证；
- 由Acceptance Spec派生的immutable `MediaRequirement`或其完整有界投影进入`AcquisitionQuery`，并由digest绑定本次寻源；
- `ProviderAcquisitionCandidateSnapshot`增加typed、bounded的广告媒体声明及Evidence，包括可获得的分辨率、Codec、音轨、大小和“未知”状态，禁止opaque自由文本直接成为业务判定；
- 在候选选择前形成Requirement Eligibility：声明明确不合格的候选不发起下载，声明缺失或不可靠时采用明确、用户可理解的保守策略；
- 若候选声明合格但下载后实物验证失败，按有界尝试策略继续下一个eligible候选；全部候选不合格或尝试耗尽后再形成可解释的业务不可达结果；
- Admin Web区分“寻源阶段无符合要求候选”“发布信息不足”“下载后实物与声明不符”，并展示下一步用户动作；
- 具体合同、Unknown策略、尝试上限和恢复语义必须先回到Design更新唯一SSOT及机器合同，再进入实现与真实浏览器UAT。

预期验收：

- 使用同等Canary样本时，明显声称H.264、低于4K或音轨不满足5星要求的候选不会触发下载；
- 存在多个候选时，只从预筛eligible集合发起下载，首个实物验证失败后能在有界范围内尝试下一候选；
- 发布信息未知时行为与页面解释符合确认后的SSOT策略，不把未知伪装为通过；
- 下载完成后仍以真实Probe Evidence完成最终验证，错误发布信息不能使不合格媒体进入Shelf；
- 通过真实Admin Web观察寻源、预筛、下载、复验、失败解释和恢复动作，脚本测试仅作为修复回归证据。

当前处理决定：修复已实现，等待第二轮Canary真实浏览器资格确认。`AcquisitionQuery`现冻结完整
`MediaRequirement + AcquisitionPolicy digest`；Candidate Snapshot公开有来源的typed声明及逐项`known/unknown`；Selector固定为
明确合规优先、无合规项才选择可见未知项、明确不合规永不下载。真实Probe不合格时在当前Query的1–5次用户配置上限内继续
下一候选，默认3；页面明确把未知候选解释为“发布信息不完整，下载后验证”。现有凭据可在Admin Web直接修改尝试上限并形成
新配置revision。专项Provider/Protocol/Selection、多候选真实字节E2E及Formation回归91/91通过；完整Architecture Gate为
1087 pass、7 skip、0 fail，Admin Web production build通过。本批次单独提交；旧Run事实和旧Canary现场不改写。

2026-08-23逐项封口复核取得部分资格证据，但尚不关单。clean Canary `UAT-20260822-021504-2ed7baad2`的持久事实中，
`金的音像店`、`黑客帝国动画版`、`一场很（没）有必要的春晚`和`地狱尖兵`共10个Provider候选全部为
`requirementAssessment=noncompliant`；4个Selection结果均为`no_requirement_eligible_candidate`，对应Run的
`libra.external_material.acquire.request@1`事件数全部为0，证明不合格候选未触发下载。当前重建Canary的6个外部冻结项则是
`no_available_candidate`，不能冒充本命题的UI样本。尝试将前述历史数据复制到隔离端口并用当前代码重放页面时，启动完整性门禁
因历史Workspace/Source不再可重建而以`P8_DECISION_BASIS_INPUT_INTEGRITY`拒绝；未绕过门禁、未改写历史数据库、未影响当前Canary。
状态保持`FACT PASSED / EXACT UI SAMPLE NOT RUN`，等待下一次自然出现明确不合格候选时补齐真实Admin Web文案证据。

2026-08-23最终关闭：干净Canary `UAT-20260823-040740-0886b2723`中，《倩女幽魂2：人间道 (1990)》按5星
Acceptance Spec经真实MoviePilot搜索只返回一个候选；其声明为H.264、低于4K且190,900,558,889 bytes，页面冻结详情显示没有符合
要求的外部候选。持久Requirement Assessment明确为`noncompliant`，理由为`video_codec_unmet`、`minimum_raster_unmet`、
`max_size_exceeded`，Selection为`no_requirement_eligible_candidate`，对应下载Work为0。状态`REGRESSION PASSED / CLOSED`。

## 15. UAT-018：Formation 顶部状态缺少“需要处理”，Discard 历史与媒体当前状态混淆

问题分类：`USER_VISIBLE_PROJECTION / RUN_LIFECYCLE / CURRENT_VS_HISTORY`

用户侧现象：媒体整理页顶部显示“待整理16、整理中1、已完成整理5”，但唯一被计入“整理中”的`一场很（没）有必要的春晚 (2022)`已经明确显示`frozen`和“放弃本次整理”按钮。用户无法从顶部统计区分系统仍在执行、等待用户处理和已经终止的整理历史。

现场证据：

- 该电影当前Libra Run为`frozen`、state revision 3；
- 对应12份Supporting Work全部为`succeeded`，28个Workflow Event全部为`succeeded`，不存在开放中的Work或Event；
- Formation `productionStarted(works)`只要发现历史上有Production阶段Work成功或Event执行过就永久返回true；Classification没有让当前`frozen/suspended`状态优先，因而旧的External Acquisition历史仍把Frozen Run标为`in_progress`；
- 行级`attention_state=frozen`和“本次整理已冻结”正确，错误只发生在Classification、顶部汇总语义及历史去向不完整。

用户确认的状态合同：顶部当前状态采用四个互斥桶，按以下优先级归类：

1. `已完成整理`：Libra整理产品已完成；
2. `需要处理`：`attention_required / blocked / suspended / frozen`，需要用户决定或明确恢复动作；
3. `整理中`：当前确有开放且可推进的Run/Work/Event；
4. `待整理`：没有Attention、尚未开始或等待系统继续形成整理动作。

`需要处理`不是“异常”标签；媒体身份确认、合法冻结和暂停都属于可解释的用户工作。四类必须对每个当前媒体恰好命中一个，不允许Frozen同时计入“整理中”。按本次现场事实，顶部预期为“待整理0、整理中0、需要处理17、已完成整理5”。

用户确认的Discard合同：

- 当前按钮语义保持为“放弃本次整理”，只终结当前Libra Run，不代表永久排除这部电影；
- 被Discard的旧Run进入历史结果，标记“已结束 · 用户放弃”，不计入顶部“整理中”“需要处理”或“已完成整理”；
- 同一电影若按当前Eligibility仍可采购，则其当前媒体状态回到“待整理”并允许形成新的Run；旧Run历史与当前媒体不得重复计数；
- Discard不删除原始媒体文件；永久“不再整理”必须是未来独立、显式的排除业务动作，不能复用Run Discard。

拟定修复边界：

- Formation Classification让终态Package及当前Run/Attention状态优先于历史`productionStarted`；`in_progress`必须由当前开放且可推进的执行事实证明；
- Formation Summary增加后端全量Projection计数`需要处理`，不得由Admin Web对当前分页临时统计；
- Admin Web顶部显示“待整理、整理中、需要处理、已完成整理”四项，并保持与列表使用同一分类函数；
- 历史结果区区分“整理完成”和“已放弃”的Run结果；顶部仍是当前媒体统计，不把历史Run作为第二份媒体计数；
- 实现前确认现有公开Projection/API及唯一SSOT是否需要扩展字段或历史Run Query，不以纯前端重分类掩盖缺失的后端事实。

预期验收：

- 当前两项Frozen Run均进入“需要处理”，顶部“整理中”为0；
- 真实存在开放Production Work时才增加“整理中”，进入Frozen/Suspended后立即移出；
- 通过Admin Web确认Discard后，旧Run出现在“已放弃”历史，原始文件保持存在；若媒体仍eligible，则当前媒体只在“待整理”出现一次；
- 页面刷新和服务重启后四项计数、列表和历史结果保持一致；
- 分页不影响顶部全量计数，脚本测试仅作为Projection修复回归，不能替代真实浏览器验收。

当前处理决定：用户已确认上述四类当前状态及Discard历史方案。问题保持OPEN；本次只记录产品合同，不点击现有Frozen Run的Discard按钮，不修改代码、运行时事实或Canary文件。后续实现并验证后单独git commit。

2026-08-21修复进展：代码修复已完成。Formation current Projection现使用四个互斥Classification；只有Arca公开
Projection能够同时证明On-deck Commit Receipt、Shelf Entry与对应active Deck Fact时才进入`completed`。Package published、
Handoff B Accepted或历史Succeeded Work均不足以形成完成/整理中。Frozen、Suspended、blocked、Product Identity确认和Executor
技术失败进入`attention_required`；当前没有开放可推进责任时回到`pending`。顶部四项统计和行级“当前状态”来自同一后端分类。

Discard Receipt由Libra-owned有界History Query投影为“已结束 · 用户放弃”，旧Run不进入当前四桶；eligible Subject只保留
一个当前待整理行。专项Projection、Arca completion、Admin Web和schema migration回归通过，包含真实Routing链路的最终
相关回归19/19、完整Architecture Gate、P3 Persistence Gate及Admin Web production build均通过。未点击旧Canary的
Discard按钮，未启动服务或修改现场。UAT-005/UAT-018继续保持OPEN，等待用户授权后的新Canary真实浏览器验证。

## 16. UAT-019：Executor终态异常缺少统一Owner收口，Arca Acceptance Offer悬空

问题分类：`EXECUTION_RECOVERY / BUSINESS_CONTRACT / USER_VISIBLE_PROJECTION`

用户侧现象：Formation显示5部电影“已完成整理”，但“我的收藏”只有`老笠 (2016)`1个Shelf Entry。其余
`光荣的愤怒`、`有话好好说`、`立春`和`香火`既没有进入Arca，也没有在页面显示为失败或需要处理；用户无法判断
这些影片是验收不合格、系统仍在运行，还是执行器已经异常终止。

现场证据：

- 4部影片的Libra Run均为`active`，Package均为`published`，但没有Handoff B Receipt、Acceptance Decision、
  On-deck Run或Shelf Entry；
- 对应`arca.acceptance_assessment` Supporting Work均已终态`failed`；Mandatory Media、Metadata、Space和Structure
  等5项检查均成功，只有`arca.acceptance.inventory_feasibility.observe@1`抛出
  `CLEAN_ARCA_TARGET_COLLISION`；
- 因执行器抛出技术异常，本次Assessment没有形成业务`passed/failed`结论，也不能据此认定影片不符合Shelf
  Acceptance Standard；
- 4份`libra.product-offer.available@1` Delivery均被记录为`delivered`，但Arca Inbox没有对应记录或Ack；当前
  Dispatcher只重取`pending/failed` Delivery，Acceptance Work终态失败后也没有Domain Owner恢复回调，因此不会自行重建验收；
- 同根Inventory逻辑已在UAT-011中修复，新Package能够成功验收并使`老笠`进入Arca，但4份旧失败Work和Event
  按不可变合同保留失败，当前实现没有从修复后的Execution Basis启动新恢复执行的桥梁。

初步诊断：Foundation已经定义统一Capability Outcome：`succeeded`、`deferred`、`failed`和`fence_rejected`，并要求
按Contract进行有界重试及Effect-specific recovery；但当前接线只收口单次Executor/Event/Work，没有保证终态技术失败
必然交还业务Owner并形成持久、用户可见、可恢复的流程状态。Arca Acceptance路径尤其缺少“Offer已送达、Assessment未形成
Accepted/Rejected决定、执行重试已耗尽”这一状态的Owner对账与恢复合同。因此这是统一Executor Failure Closure缺口，不是
把`CLEAN_ARCA_TARGET_COLLISION`改掉即可永久解决的单点异常。

必须遵守的统一语义：

1. 预期的业务否定，例如真实字节冲突、空间不足或产品不满足Acceptance Standard，必须返回
   `succeeded + typed negative result`并形成正式Arca Rejection，不能伪装成技术`failed`；
2. 临时网络、I/O或进程异常返回可重试`failed`，由Runtime依据冻结的Retry Policy创建同一Event的新Attempt；Executor
   不得自行决定次数、创建Work或改变Plan；
3. Schema、Invariant、程序缺陷等确定性技术异常不得无限重试，应形成聚合Incident/熔断及明确的Owner接管状态；
4. Execution Basis过期返回`fence_rejected`，停止旧执行并由Owner重新计算，不在旧Basis上盲目重放；
5. 非纯观察Effect必须通过Effect Journal、Idempotency Key、Receipt或Commit Marker先查询已有结果，再决定复用、补偿或重做，
   禁止因恢复而重复下载、重复写文件、重复提交Domain Fact或重复转移控制权；
6. 重试耗尽只终结本次Execution责任，不能让业务对象保持“active/delivered/已完成”假象。失败必须由所属Domain Owner
   投影为`需要处理/技术阻塞`，并明确下一步恢复动作；Handoff B Accepted前Custody仍属于Libra，Accepted后的恢复责任属于Arca。

拟定修复边界：

- 先回到Design，在唯一SSOT补齐“Executor终态技术失败 → Domain Owner durable closure”的通用合同，以及Arca Acceptance
  在Decision形成前失败时的精确状态、Ack/Delivery语义、恢复触发、重试代际和用户动作；不由Adapter或Reconciler私自发明Domain Fact；
- 为已送达但没有Inbox/Ack或终态Acceptance Decision的Offer增加幂等对账，禁止`delivered`成为不可恢复黑洞；
- 修复代码或环境后，以原immutable Package/Offer和重新验证的当前Basis创建新的恢复Attempt/Work代际；旧失败Work、Attempt和
  Evidence保持不变，不直接改库、不把旧失败改写成成功；
- Arca Acceptance最终必须形成且只能形成正式`Accepted`或`Rejected`结果。技术执行异常不得冒充Rejection，也不得推进
  Handoff B、Custody、On-deck或Shelf Entry；
- Formation和Arca管理页面必须显示失败阶段、稳定错误码、已尝试次数、当前Owner、是否会自动重试及用户下一步；在Arca尚无
  Acceptance终态时，Formation不得显示“已完成整理”；
- 相同确定性错误影响多个影片时聚合为系统Incident并有界熔断，避免每部影片各自高速失败；恢复后再按幂等合同逐项对账。

预期验收：

- 用纯观察、Workspace写入、外部请求、Domain Fact提交和责任/控制提交各一类Executor故障验证统一Outcome、Retry和
  Effect Recovery，没有重复副作用；
- 可重试异常在预算内建立新Attempt并恢复，预算耗尽或不可重试异常进入正确Owner的持久`需要处理/技术阻塞`状态；
- 真正的Acceptance业务不合格形成typed Rejection Receipt；执行器异常不产生Accepted或Rejected假结论；
- 模拟Arca Assessment在Offer送达后崩溃，页面不得显示整理完成，Offer不会永久停在`delivered`，修复Basis后可通过正式恢复
  执行到达唯一Accepted或Rejected终态；
- 当前4部受影响影片不修改旧事实，通过正式恢复路径重新Assessment，并在Admin Web逐部得到可解释终态；
- 服务重启、重复对账和页面刷新不重复创建Inbox、Acceptance Decision、On-deck Run、Shelf Entry或物理文件；
- 脚本/回归测试只证明故障合同和幂等性，最终仍须从真实Admin Web验证状态、恢复动作和Collection结果。

修复状态（2026-08-21）：`IMPLEMENTED / FRESH CANARY VERIFICATION PENDING`。

- SSOT已补齐“终态Work Outcome → Domain Owner durable closure”、Handoff B admission Inbox、业务终态Ack和技术失败恢复合同；
- 新增Arca Acceptance Recovery Case与Foundation Executor Incident持久事实；旧Work/Event/Attempt及失败Evidence不改写；
- Assessment技术失败进入Formation可见的`attention_required`，展示阶段、错误码、尝试次数、Owner、恢复代际及用户重试；
- connection/execution-contract revision变化只自动创建一次恢复代际，相同确定性故障有界聚合并熔断；
- 专项、旧schema迁移、Foundation、Admin route与完整Architecture Gate通过，未操作旧Canary数据库或媒体文件。

本条代码修复已完成；问题在第二轮真实Admin Web UAT验证旧失败类型能经新代际到达唯一Accepted/Rejected终态后关闭。

2026-08-23逐项封口在重建Canary `UAT-20260823-002500-519f8d7b5`完成。真实“我的收藏”页面显示16部当前收藏均健康，
其中包括原悬空样本`光荣的愤怒`、`有话好好说`、`立春`和`香火`。持久事实核对为：16个published Product Package中
缺少Acceptance Decision为0；Acceptance Decision 16/16为`accepted`，Handoff B Receipt 16/16为`accepted`，
`libra.product-offer.available@1` Delivery 16/16为`acked`，Acceptance Recovery Case 16/16为`resolved`且active为0，
On-deck Commit 16、active Shelf Entry 16，失败Acceptance Work为0。页面数量与Owner收口、业务终态和Arca提交事实逐层一致，
不存在`delivered` Offer黑洞。状态`REGRESSION PASSED / CONFIRMED ON REBUILT CANARY`。
UI证据：`admin-web-evidence/uat-019-no-dangling-offers-collection-pass.png`。

## 17. UAT-020：Final Inventory成员命名与carried-forward输入Settlement不完整

问题分类：`BUSINESS_CONTRACT / SAME_ROOT_INVENTORY / ARCA_ONDECK / USER_VISIBLE_HEALTH`

用户侧现象：`老笠 (2016)`在Admin Web中已经进入“我的收藏”并显示“健康”，但物理结果不符合用户预期：

1. Final Inventory目录为`G:\canary_film\1cbf…b786 (0)`，主视频和NFO分别为
   `transcode-1-8ea9457aad82514c.mkv`和`transcode-1-8ea9457aad82514c.nfo`，没有使用用户可理解的影片名称；
2. 原`G:\canary_film\老笠 (2016)`中的字幕和`fanart.jpg`没有完成移入后的源位置Settlement；
3. 原目录因而仍存在，使同一影片横跨两个用户可见目录，违反同根Shelf的唯一物理现实。

现场证据：

- 原目录现只剩字幕和`fanart.jpg`；哈希目录包含主视频、字幕、`fanart.jpg`、`poster.jpg`和NFO；
- 两个目录中的字幕大小均为69,026字节且SHA-256均为
  `d93445122905e552d11a764e70ea03524d49d61cebbdc86d23aafae8e4eb5b2f`；两个`fanart.jpg`大小均为
  119,066字节且SHA-256均为`2eaf01606ed6b7c37efd10d75d5e484cbe299a2e4343ae4cbde97b32b39c7db2`，
  证明是同字节重复现实，不是两份不同Related；
- 当前Arca Shelf Entry为`active`、Inventory revision为2；Inventory只登记哈希目录中的5个成员，原目录的两个副本不在
  当前Inventory中，因此“健康”只证明已登记成员自洽，没有发现同根未结算旧位置；
- Final Inventory Decision的`target_location`就是哈希目录。该目录错误属于UAT-013已诊断的旧Decision；目录命名代码修复
  `6d67d0ddb`只保护修复后形成的新Decision，不重写既有immutable Decision或已提交Shelf Entry；
- 当前Shelf Placement Policy revision 1只含`folderTemplate:"{title} ({year})"`和`collisionPolicy:"reject"`，没有
  用户可配置的Primary、Metadata或Subtitle文件命名规则；Inventory Port的`targetName(member)`直接采用Product源路径basename，
  所以Workspace内部`transcode-*`技术名称被永久暴露为Shelf文件名；
- `老笠`Off-load Context把字幕和fanart标为`carried_forward + replace_or_move`；Placement Stage把它们复制到目标目录，
  但On-deck Planner只为`replaced_and_settled + remove_after_place`成员建立Input Settlement Event，前两项永远没有Settlement；
- On-deck Run仍进入`committed`，对应Commit Receipt的`related_disposition_completion_digest`为`null`，证明On-deck Commit没有
  fail closed验证全部source-to-final mapping已经完成；旧目录因此自然无法清空，也没有安全的空目录收口步骤。

初步诊断：UAT-013只覆盖Resolved Identity如何生成目标目录，尚未覆盖Placement Policy对Final Inventory每类成员的完整命名结果。
同时，当前实现把`carried_forward`误解为“源位置可以继续保留”，而它只表示相同Product Material继续成为最终成员；当Final Location
改变时，原位置仍必须按`replace_or_move`完成精确Settlement。系统复制目标、保留源文件并提交Shelf Entry，违反Final Inventory
Decision、Off-load Context和唯一物理现实，且Shelf Health遗漏了这一Placement/Settlement Conformance Gap。

拟定修复边界：

- 先回到Design扩展唯一Shelf Placement Policy合同，使用户能在Admin Web配置或明确接受Movie默认成员命名；至少覆盖目录、
  Primary、Metadata Sidecar和Subtitle命名。默认结果应使用Resolved Identity的人类可读stem，例如目录`老笠 (2016)`、视频
  `老笠 (2016).mkv`、NFO `老笠 (2016).nfo`；poster/fanart采用稳定约定名，字幕按确认后的语言/forced/SDH后缀规则命名；
- Workspace的`transcode-*`、Event ID、Package ID或digest只能作为内部产物名，不得在没有显式Placement决定时泄漏为永久Shelf名称；
- On-deck Planner必须依据每个Off-load Context成员的`settlementExpectation`和冻结source-to-final mapping决定Settlement，不能只按
  `replaced_and_settled`筛选；`carried_forward + replace_or_move`在Final Location改变时也必须完成有授权、可恢复的精确迁移/源清理；
- On-deck Commit前必须证明所有要求Settlement的成员均已有Completion Evidence，并把非空
  `related_disposition_completion_digest`绑定进Commit；任一成员未完成时不得建立Shelf Entry或显示健康；
- 原目录只可在已冻结的全部受管成员完成Settlement且再次验证目录为空后删除。若存在未计划文件，必须fail closed并在页面显示
  “需要处理”，不得递归删除或扩大Destruction Scope；
- Shelf Health/Aftercare必须比较当前Inventory、Placement Decision和已知旧Binding，识别“目标副本健康但旧位置仍存在”的
  Placement/Settlement Gap，不能只检查Inventory登记路径；
- `老笠`已经Handoff B Accepted且On-deck committed，修复责任属于Arca。不得重开Libra、修改旧Decision、直接改库或手工移动文件；
  应由正式Aftercare Placement Conformance Case生成新Inventory revision，迁移/重命名成员、精确清理旧位置并复验最终现实。

预期验收：

- 从Admin Web配置并刷新Shelf Placement后，目录及各类成员命名规则可见、可保存、可预览，内部技术ID不进入最终路径；
- 新Canary Movie完成On-deck后形成单一`{title} ({year})`目录，Primary/NFO/Subtitle名称符合冻结Placement，Related齐全；
- 同根source与target不同时，`carried_forward`成员完成move或copy-verify-settle，原位置不保留同字节副本；同一路径时形成有Evidence
  的no-op，不删除Final Inventory；
- 缺少任一要求的Settlement Completion时On-deck不能Commit，页面显示具体未完成成员和恢复动作；
- 对既有`老笠`通过真实Admin Web发起Arca Aftercare修复，形成新的Inventory revision；最终只保留
  `G:\canary_film\老笠 (2016)`一个目录，文件命名符合当前Placement，哈希目录和旧重复位置均按精确Evidence收口；
- 重启和重复恢复不会重复复制、误删文件或创建第二个Shelf Entry；`G:\test_film`及Canary之外路径始终不变；
- 脚本/回归测试只验证命名解析、Settlement覆盖、Commit Gate和幂等恢复，最终结果必须由真实Admin Web与只读文件现实共同验收。

当前处理决定：问题保持OPEN。本次只读取两个明确Canary目录和本地UAT领域事实并登记缺口；没有移动、重命名或删除任何文件，
没有修改运行时数据库。目录Identity修复仍按UAT-013保留为已完成代码修复，但完整Final Inventory结果未通过；成员命名、
carried-forward Settlement、Commit Gate和既有Entry的Arca Aftercare恢复需完成Design确认后分别实现、验证并提交。

2026-08-21修复进展：成员命名子包已完成。Shelf Placement Policy现关闭定义目录、Primary、NFO、Subtitle、Poster、Fanart
模板及冲突策略，Admin Web创建时全部可配且保存前可预览；Final Inventory Decision逐成员冻结`finalName`与最终location。
隔离`老笠`同型回归确认内部hash、`(0)`、`transcode-*`和artifact ID不会进入Shelf名称。未读取或改写旧现场；Settlement、
Commit Gate、旧目录收口与Aftercare旧Binding检查由下一独立提交完成。

2026-08-21修复进展：Settlement/Aftercare子包已完成代码修复。On-deck Planner不再按`dispositionKind`漏掉
`carried_forward + replace_or_move`；每个需要Settlement的成员先验证冻结Final target和字节，再形成同路径no-op或不同路径
精确Settlement Evidence。Fulfillment逐项核对全部Off-load mapping，On-deck Commit持久化非空
`related_disposition_completion_digest`，缺少或漂移时fail closed。旧目录仅在精确为空时删除，发现未知成员会在任何删除前停止。
Aftercare读取当前Inventory、Placement Decision和原Handoff B Custody Binding，旧Binding只有身份未漂移且唯一匹配当前Final
字节时才能纳入Placement修复的Settlement，其余为`attention_required`。隔离回归未触碰旧`老笠`现场。

UAT-020代码修复已完成，但问题继续保持OPEN：按用户指示不立即重建Canary、不启动服务、不执行第二轮真实Admin Web UAT；
只有后续新Canary证明22/22均形成唯一物理现实后才关闭。

当前关闭 Canary `UAT-20260822-141950-0c27c8cf6` 复测失败（2026-08-23）：`老笠 (2016)`已形成唯一目录，
主视频`老笠 (2016).mp4`与NFO均为用户可读名，旧兄弟目录也已消失；但正式Inventory中的字幕仍为
`老笠 (2016) - 1080p x264 AAC HDH.chinese(简).srt`，把分辨率、codec、audio与release group技术标签带入
最终成员名。页面显示当前收藏且健康，说明Health也未把该命名偏差显性化。UAT-020状态改为
`CURRENT CANARY FAILED / ROOT CAUSE IN PROGRESS`，不另开重复UAT。UI证据：
`admin-web-evidence/uat-020-final-subtitle-technical-name-failed.png`。

根因与代码修复（2026-08-23）：`subtitleQualifiers()`只识别`zh-CN/chs/eng`等机器标记，把精确单语
`chinese(简)`误判为语言未证明，遂按防碰撞策略保留完整源basename。commit `62086c72d`新增有界识别：仅精确
`chinese(简)/(简体)/(繁)/(繁体)`分别映射`zh-CN/zh-TW`；`chinese(简英,...)`等多语/来源标记仍保持原名，
不削弱fail-closed。专项Inventory Port 16/16通过，现场同型新Decision会生成`老笠 (2016).zh-CN.srt`。
旧Final Inventory Decision与Shelf Entry不可变，本项仍为`FAILED`，必须从不可变`F:\test_film`重建Canary后用新Entry复测。

关闭确认（2026-08-23）：新干净 Canary `UAT-20260823-002500-519f8d7b5` 从不可变`F:\test_film`严格复制建立
同根`F:\canary`，新服务为`helix-clean-v3`。真实Admin Web中`老笠 (2016)`完成整理并进入`Movie Canary`，收藏详情显示
「当前收藏」「收藏健康 · 健康」。只读文件现实只有`F:\canary\老笠 (2016)`一个兄弟根；正式成员为
`老笠 (2016).mp4`、`老笠 (2016).nfo`、`老笠 (2016).zh-CN.srt`、`poster.jpg`、`fanart.jpg`，无partial，
技术发布标签未进入最终名。状态改为`REGRESSION PASSED / CLOSED`。UI证据：
`admin-web-evidence/uat-020-final-subtitle-normalized-pass.png`；FS证据：同一UAT隔离目录的
`uat-020-fs-evidence.json`。修复与证据未改写旧Final Inventory，也未修改`F:\test_film`。

## 18. UAT-021：TMDB别名来源泄漏到Product Identity证据，全部整理在身份取证前冻结

问题分类：`EXECUTION_CONTRACT / INTEGRATION_ADAPTER / USER_VISIBLE_PROJECTION`

用户侧现象：第二轮真实Admin Web UAT中，Movie Canary的22个已路由影片没有进入实际整理。Formation页面显示
`待整理 0 / 整理中 0 / 需要处理 22 / 已完成整理 0`；常规影片显示“本次整理已冻结，需要放弃后重新采购”，BDMV及
ISO条目同时显示身份需要处理。

现场证据：

- Field页面已通过真实Admin Web发布Direct → `Movie Canary`的分拣策略，22个Subject均已获得目标Shelf和
  Acceptance Spec；这不是未发布策略或未创建Run；
- 本地隔离UAT数据库中，`libra.product_identity.evidence.observe@1`有20个终态失败Attempt，失败码均为
  `P4_CAPABILITY_SCHEMA_REJECTED`，失败类别为`executor`；这些失败被Run恢复策略有界冻结；
- 以TMDB适配器实际会返回的`localized`、`alternative_title`别名来源复现时，
  `ProductIdentityEvidenceObservation`精确schema拒绝`verifiedIdentity.aliases[*].sourceKind`，因为该跨域结果
  只允许`candidate`、`related_nfo`或`provider`。

初步诊断：TMDB适配器保留了本地别名来源词汇，Libra的`identityCandidate`又把该词汇原样带入受限的
Product Identity结果。适配器本地provenance不属于该结果的公共契约，因而严格校验正确地拒绝了结果；但执行路径没有在
生成结果前完成词汇规范化，导致正常TMDB响应被误判为技术失败。

修复边界：只在Libra Product Identity的跨域结果边界将Provider返回的任何别名来源统一投影为`provider`；不修改
TMDB适配器原始响应，不放宽结果schema，不改变用户手工选择或NFO来源语义。

验收证据：新增回归以`localized`和`alternative_title`模拟TMDB响应，断言形成的resolved Identity仅包含
`provider`来源别名；随后执行专项测试、相关Architecture Gate和Admin Web build。脚本只证明契约修复；旧冻结Run保持
不可变，后续必须从真实Admin Web按正式Discard/Recovery路径验证新的Run能够继续形成整理。

修复状态（2026-08-21）：`IMPLEMENTED / REAL ADMIN WEB RECOVERY PENDING`。专项Product Identity测试5/5通过，
TMDB集成架构门禁11/11通过，Admin Web production build通过；此前启动的完整Libra前半段门禁已自然结束，未输出可归因于
本修复的新失败。旧冻结Run保持不可变，下一步将在独立提交后重启本地UAT服务，并从真实Admin Web执行正式恢复路径验证。
未直接改写任何既有Run、Attempt、Event或Canary媒体文件。

2026-08-23逐项封口在重建Canary `UAT-20260823-002500-519f8d7b5`完成。持久事实中43份
`libra.product_identity.evidence.observe@1`结果全部为`resolved`；其`verifiedIdentity.aliases`共446项，
`sourceKind`全部为`provider`，非法alias来源为0。真实Formation的6个“需要处理”样本均显示“确认影片身份”100%，冻结原因
明确位于后续外部寻源；另有16项已完成整理，不再出现取证前全员冻结。状态
`REGRESSION PASSED / CONFIRMED ON REBUILT CANARY`。UI证据：
`admin-web-evidence/uat-021-identity-evidence-before-external-freeze-pass.png`。

## 19. UAT-022：年份后的技术发布标签污染TMDB身份搜索词

问题分类：`IDENTITY_NORMALIZATION / PROVIDER_QUERY / USER_VISIBLE_RECOVERY`

用户侧现象：干净Movie Canary真实Admin Web UAT中，`看不见的朋友 (2023) - 1080p H.264 CHDWEB`
进入“需要处理”，页面显示“暂未找到匹配的媒体身份”，整理动作无法形成；同批普通标题可以继续进入生产。

现场证据：Product Identity Attempt形成`provider_no_match`。Libra向TMDB发送的搜索词仍包含
`(2023) - 1080p H.264 CHDWEB`；现有规范化先尝试删除字符串末尾年份，再删除技术标签，因此年份位于技术标签之前时
不会被删除。以相同标题和TMDB返回的`看不见的朋友`、年份2023建立专项回归，可稳定复现未匹配。

初步诊断：技术发布后缀识别本身存在，但处理顺序没有闭包。删除技术后缀后新暴露出的尾部年份没有再次规范化，导致
Provider查询词和精确候选比较词都保留年份标签。

修复边界：仅在Libra Product Identity边界先识别并移除含技术Token的发布后缀，再移除尾部年份；同一规范化同时用于
TMDB搜索词和精确关联比较。不引入模糊匹配，不改变年份约束，不修改TMDB适配器或跨Domain身份所有权。

验收证据：新增`看不见的朋友 (2023) - 1080p H.264 CHDWEB`专项回归，断言TMDB搜索词为
`看不见的朋友`且唯一同年候选可形成resolved Identity；Product Identity专项测试6/6、TMDB集成架构门禁11/11和
Admin Web production build均通过。

修复状态（2026-08-21）：`IMPLEMENTED / CLEAN CANARY UAT PENDING`。当前污染现场和失败数据库保持不变；完成独立提交后，
须随其他已取证问题修复一起重建Canary，再通过真实Admin Web确认该条目不再进入身份待处理。

2026-08-23逐项封口在重建Canary `UAT-20260823-002500-519f8d7b5`完成。真实Formation按片名过滤原始样本
`看不见的朋友 (2023) - 1080p H.264 CHDWEB`后，该行“确认影片身份”为100%；当前“需要处理”原因明确为后续
“没有找到可获取的外部候选”，不再是`provider_no_match`或身份待处理。状态
`REGRESSION PASSED / CONFIRMED ON REBUILT CANARY`。UI证据：
`admin-web-evidence/uat-022-release-suffix-identity-resolved-pass.png`。

## 20. UAT-023：技术后缀移除后残留年份导致豆瓣标题锚不相交

问题分类：`PERCEPTION_RESOLUTION / EXACT_ALIAS / USER_VISIBLE_RATING`

用户侧现象：真实Formation页面中，`看不见的朋友 (2023) - 1080p H.264 CHDWEB`显示“暂无评分”，虽然隔离数据库
已经copy-forward同年豆瓣记录`看不见的朋友 / 我的麻吉4個鬼`，评分为5。

现场证据：Perception规则revision 2会为Subject标题生成去技术标签的`title_year`别名，但旧实现先删除“字符串末尾年份”，
再删除技术后缀。该标题删除后缀后得到`看不见的朋友 (2023)`，不会再次去掉年份，最终锚为
`看不见的朋友 (2023)\0 2023`，与豆瓣的`看不见的朋友\0 2023`不相交，Resolution形成`no_matching_record`。

初步诊断：与UAT-022同属“年份位于技术后缀之前”的顺序缺口，但事实Owner和修复位置不同；本问题属于Perception自己的
exact alias派生，不能依赖Libra Product Identity查询修复间接改变评分事实。

修复边界：Perception先删除带技术Token的发布后缀和末尾技术Token，再删除新暴露出的尾部年份；仍保留原始标题锚，
仍要求标题别名与年份精确相同，不引入模糊匹配或跨年匹配。

验收证据：专项回归固定该真实标题，断言同时生成原始锚和`看不见的朋友\0 2023`精确锚；Perception alias专项测试3/3、
Movie Perception Continuity架构门禁6/6及Admin Web production build均通过；后续仍需干净Canary真实页面复验。

修复状态（2026-08-21）：`IMPLEMENTED / CLEAN CANARY UAT PENDING`。

2026-08-23逐项封口在重建Canary `UAT-20260823-002500-519f8d7b5`完成。真实Formation刷新后按精确样本
`看不见的朋友 (2023) - 1080p H.264 CHDWEB`过滤，该行稳定显示`5 星 · 豆瓣`，而非“暂无评分”；同页身份步骤为100%。
这证明去技术后缀后形成的`看不见的朋友 + 2023`锚已与copy-forward豆瓣记录相交。状态
`REGRESSION PASSED / CONFIRMED ON REBUILT CANARY`。UI证据：
`admin-web-evidence/uat-023-release-suffix-douban-anchor-pass.png`。

## 21. UAT-024：逐成员Settlement后Accepted Context仍要求全部旧源存在

问题分类：`ARCA_ONDECK / SETTLEMENT_RECOVERY / INPUT_PROJECTION`

用户侧现象：`有话好好说 (1997)`完成Placement后没有到达On-deck Commit；页面仍显示整理中，后台两个
`arca.ondeck.input_settlement.delete@1` Event在输入准备阶段失败，错误为`CLEAN_ARCA_PRODUCT_SOURCE_MISSING`。

现场证据：Final目录已形成按Placement命名的视频、NFO和字幕；第一个Settlement已按冻结mapping删除一个不同名旧源。
后续Settlement在读取同一Accepted On-deck Context时，`readAccepted`再次调用Inventory feasibility且固定
`replayCommitted:false`。该全包检查因前一个已合法结算的源不再存在而失败，尚未轮到当前成员的Settlement Capability。

初步诊断：首次Acceptance的源现实检查与Accepted责任内的后续回放使用了同一模式。逐成员Settlement本来就会使旧源集合
单调减少；Accepted Context若仍要求初始全集存在，会把自身已提交的前序效果误判为外部漂移，形成无法闭环的终态失败。

修复边界：首次Handoff B Acceptance继续使用`replayCommitted:false`严格检查原始Package；只有已经Accepted的On-deck
Context读取使用`replayCommitted:true`，允许在旧源已结算时以Final Inventory Decision指定的精确目标字节复验。
Final目标不存在或字节不符仍fail closed，不跳过Settlement Approval、mapping或最终现实验证。

验收证据：新增Accepted Context专项回归，断言后续读取携带`replayCommitted:true`且保持Run、Custody、Shelf和Package围栏；
专项测试1/1、Clean Arca Inventory Port测试5/5、Handoff B/On-deck架构门禁8/8及Admin Web production build通过。
后续仍需干净Canary多成员顺序Settlement真实页面复验。

修复状态（2026-08-21）：`IMPLEMENTED / CLEAN CANARY UAT PENDING`。

2026-08-23逐项封口在重建Canary `UAT-20260823-002500-519f8d7b5`完成。`有话好好说 (1997)`的On-deck Run
已为`committed`，同一Run的5个`arca.ondeck.input_settlement.delete@1` Event全部`succeeded`，Final Product Verification、
Fulfillment Verification与On-deck Commit也全部成功。真实“我的收藏”详情显示该片为当前收藏且保管/呈现/合规均健康；FS只有
唯一`F:\canary\有话好好说 (1997)`目录，包含用户可读主视频、NFO、字幕、poster和fanart，无partial或第二个同名目录。
状态`REGRESSION PASSED / CONFIRMED ON REBUILT CANARY`。UI证据：
`admin-web-evidence/uat-024-multi-member-settlement-commit-pass.png`。

## 22. UAT-025：Handoff A身份快照未在技术发布标签前冻结年份锚

问题分类：`LIBRA_DECISION_IDENTITY / PERCEPTION_CONTINUITY / USER_VISIBLE_RATING`

用户侧现象：切换到全新`F:\canary`并完成真实Admin Web Observation与Direct Routing后，Formation页面中
`看不见的朋友 (2023) - 1080p H.264 CHDWEB`和带发布标签的`养蜂人`仍显示“暂无评分”；同一页面的
`香火 (2003)`与普通`养蜂人 (2024)`已经显示豆瓣评分。

现场证据：隔离数据库只读检查显示，受影响Subject在Handoff A Accepted时冻结的
`DecisionIdentityEvidenceSnapshot`只有完整发布名的`title` Anchor，没有`title_year` Anchor；对应
`IdentityClaim.claimedYear`为空。UAT-023的Perception alias revision 2只有在调用方提供标题和年份时才能派生精确别名，
不能从缺失年份的Libra快照补造该事实。

精确根因：UAT-022修复了Product Identity阶段的TMDB搜索词，UAT-023修复了Perception自己的别名规则，但两者都没有更新
Handoff A接收时由Libra拥有的versioned Decision Identity Mapping。旧`@1`映射只识别原字符串末尾的括号年份；年份后存在
明确技术发布后缀时，快照在进入后续Resolution前已经丢失`title_year`。

修复边界：新增`libra.candidate-claim-title-anchor@2`，只移除包含明确技术Token的尾部发布段，再按既有严格规则分离新暴露的
括号年份；不引入模糊或跨年匹配，不回写Procurement Claim，也不改变Perception或Libra的事实Owner。解析器继续接受并验证
既有`@1`不可变快照，新快照固定`evidenceRevision 2`。

验收证据：新增真实标题专项回归，断言Handoff A快照形成`看不见的朋友`与
`看不见的朋友\0 2023`两个精确Anchor并可完成持久化回读；Perception/Decision Mapping专项回归10/10、相关Product Identity
与Movie Perception门禁13/13、Admin Web production build均通过。

修复状态（2026-08-22）：`IMPLEMENTED / REAL ADMIN WEB VERIFIED`。旧现场已原子保留为
`F:\canary.failed-20260822-004651-31e92bde4`，新Canary与只读基线四项严格比对为0差异，并从全新隔离事实库重新执行
Field、Shelf、Routing和Observation。Formation真实页面显示`看不见的朋友`5星、普通与发布标签版`养蜂人`4星、`香火`4星，
来源均为豆瓣；22个Candidate/Subject保持唯一，随后正常形成Production动作。完整22部Arca闭环仍由本轮UAT继续验收。

2026-08-23逐项封口复核确认该项已有两轮clean Canary真实UI证据闭环：`UAT-20260822-141950-0c27c8cf6`
的Formation同页显示普通版与发布标签版`养蜂人`均为`4 星 · 豆瓣`，`看不见的朋友`为`5 星 · 豆瓣`；当前重建Canary
`UAT-20260823-002500-519f8d7b5`刷新后再次显示原始发布标题`看不见的朋友 (2023) - 1080p H.264 CHDWEB`
为`5 星 · 豆瓣`且身份100%。当前发布标签版`养蜂人`已被UAT-009提交的直接评分按正式优先级覆盖，不用该覆盖态否定此前
未覆盖时的年份锚证据。状态`REGRESSION PASSED / CONFIRMED ON CLEAN CANARY`。

## 23. UAT-026：Admin Web无法清除直接评分并恢复豆瓣来源

问题分类：`USER_PERCEPTION_COMMAND / IMMUTABLE_RETRACTION / ADMIN_WEB`

用户侧现象：Formation真实页面可把`第八个嫌疑人 (2023)`从`3 星 · 豆瓣`改为并刷新保持
`2 星 · 我的评分`，但页面没有清除入口；再次点击当前2星仍保持直接评分，无法执行UAT要求的来源恢复。

现场证据：`RatingControl`只渲染1–5星并始终调用number评分；Admin API客户端和Perception `createRecord`也只接受1–5，
没有任何普通用户可达的retraction命令。旧SSOT仍保留“本期不提供清除评分”的Beta限制，与本轮用户明确确认的成功标准冲突。

精确根因：底层Perception Store、Record和Relation合同已经支持immutable `retraction/retracts`，但Command、Direct Observation、
Resolution RecordSet schema和Admin Web没有闭合该能力。直接删除旧Record会破坏历史，因此不能用简单DELETE或前端伪恢复修复。

修复边界：用户通过同一Owner的评分命令提交`rating:null`；只有存在current直接评分时才接受。Perception追加无rating的
`retraction` Record及指向current直接评分的`retracts`关系，Resolution随后恢复仍active的豆瓣来源或返回`not_found`。
旧Record、旧Spec和Provenance保持不可变；不改变来源优先级、Libra/Arca Owner或Business Handoff。Admin Web仅在当前来源为
`shelfdeck_direct`时显示“清除我的评分”。SSOT相应移除旧Beta禁令并冻结该精确命令语义。

验收证据：Shelf Entry专项服务E2E证明rating revision 1后清除形成revision 2、一个retraction和一个retracts，Resolution回到
`not_found`且历史两条Record均保留；Perception Store/Domain Input门禁26/26通过，Admin Web production build通过。
完整`helix-perception-acceptance-spec-e2e`中的2个相关测试通过；另一个既有On-deck/Aftercare测试在评分步骤之后因
`care-custody`输入`objectKind`的`P4_CAPABILITY_SCHEMA_REJECTED`失败，与本修复路径和改动文件无关，留待其独立UAT问题处理。

修复状态（2026-08-22）：`REAL ADMIN WEB VERIFIED`。本地服务重启后从Formation指定电影行点击“清除我的评分”，
`第八个嫌疑人`由`2 星 · 我的评分`恢复为`3 星 · 豆瓣`；再次点击页面“刷新”后来源与评分保持。

2026-08-23逐项封口在重建Canary `UAT-20260823-002500-519f8d7b5`再次完成真实命令验证。发布标签版
`养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1`原为UAT-009提交的`4 星 · 我的评分`；点击“清除我的评分”并刷新后，
页面稳定恢复为`4 星 · 豆瓣`且清除入口消失。持久事实新增一条`record_kind=retraction`、`rating=null`的直接来源Record，
并新增一条`retracts`关系精确指向原直接4星Observation；旧Observation未删除。状态
`REGRESSION PASSED / CONFIRMED ON REBUILT CANARY`。UI证据：
`admin-web-evidence/uat-026-clear-direct-rating-restores-douban-pass.png`。

## 24. UAT-027：恢复中的FFmpeg progress冲突导致整个服务退出

问题分类：`EXECUTOR_PROGRESS / PROCESS_CONTAINMENT / SERVICE_RECOVERY`

用户侧现象：为加载UAT-026修复而优雅停止并重启本地服务时，Admin Web立即连接被拒绝；服务进程以
`P4_PROGRESS_SOURCE_SEQUENCE_CONFLICT`退出，无法完成清单要求的服务重启恢复。

现场证据：恢复中的FFmpeg stdout回调直接调用Foundation Progress Reporter；相同`out_time_us`在不同progress block中可能
携带不同`speed`，但旧`sourceSequence`只包含prefix与out_time，因而同一sequence标识不同样本。Reporter正确fail closed，
但EventEmitter回调未捕获该同步异常，异常越过Capability Promise并终止整个Node进程。

精确根因：媒体Effect Port生成的source sequence没有覆盖完整可变样本，同时没有把progress持久化失败收敛为当前Executor
Promise失败。单个Event的技术失败因此错误升级为Service进程级崩溃。

修复边界：source sequence加入speed维度，使同一序列只表示同一完整样本；stdout progress回调捕获Reporter异常，原子停止
当前FFmpeg子进程并reject当前Effect Promise，由Foundation按普通Attempt失败闭环。Reporter的严格冲突、单调性、历史上限和
Owner边界保持不变；不吞掉错误、不把失败标记成功。

验收证据：新增真实FFmpeg子进程专项回归，强制progress持久化抛出冲突并断言错误只reject媒体Effect Promise、不产生
uncaught process failure；与Progress Reporter门禁合计6/6通过。后续继续执行完整Runtime Gate、Admin Web build和同一UAT
data directory真实服务重启。

修复状态（2026-08-22）：`REAL SERVICE RESTART VERIFIED`。同一隔离UAT data directory重启后，恢复批次虽暴露后续
业务失败，服务仍持续监听；真实Formation页面成功打开、刷新并完成UAT-026评分撤回，随后由测试方优雅停止以隔离后续诊断。

2026-08-23逐项封口在重建Canary `UAT-20260823-002500-519f8d7b5`再次确认。当前服务进程自00:51重启后持续存活、
`/v1/health`为`ok`且`normalSupplyAllowed=true`；其间恢复旧Run、完成UAT-067恢复以及多次真实Admin Web命令与刷新。
服务日志中`P4_PROGRESS_SOURCE_SEQUENCE_CONFLICT`、uncaught与Unhandled rejection均为0；真实Formation刷新成功并显示
1待整理/6需要处理/16已完成，Console warning/error为0。媒体Effect与Progress Reporter专项回归13/13 PASS。状态
`REGRESSION PASSED / CONFIRMED ON RESTARTED CANARY`。UI证据：
`admin-web-evidence/uat-027-service-survives-recovery-progress-pass.png`。

## 25. UAT-028：单电影目录的常见既有图像未进入Related disposition scope

问题分类：`PROCUREMENT_RELATED_MATERIAL / HANDOFF_CONTINUITY / INPUT_SETTLEMENT`

用户侧现象：12个已Accepted的On-deck Run中有10个在Input Settlement持续报
`CLEAN_ARCA_SETTLEMENT_UNKNOWN_MEMBER`，Formation长期显示“正在完成收藏架上架”，不能建立Shelf Entry。

只读现场证据：严格按冻结Off-load Context、Final Inventory Decision与当前目录成员重建Arca的unknown判定，
`全面失控：特大号邮轮危机`、`劫机`、`短暂和平`、`第八个嫌疑人`等目录均遗漏`clearlogo.png`；其他目录还
遗漏`banner.jpg`或`landscape.jpg`。这些文件在Canary基线中已经存在，却没有进入Candidate Related relation及
后续Off-load Context。

精确根因：Procurement Candidate Context虽然有界观察`.jpg/.png`，但`single_movie_directory`的通用文件名集合
只识别poster、fanart、background与backdrop。Emby常见的banner、clearlogo、landscape、logo、discart因此被错误
排除；Arca不能从目录推断授权，正确fail closed。

修复边界：只扩展单电影目录和BDMV external既有的通用图像名识别集合；多电影目录与standalone file继续要求
精确same-stem，不把共享目录中的通用图像强行归属某个Candidate。新纳入图像以现有`sidecar`角色进入完整
Related disposition obligation，保持原始文件名，不新增业务Owner、Control或删除权限。

验收证据：专项回归证明单电影目录纳入`clearlogo.png`/`banner.jpg`/`landscape.jpg`，仍排除无stem的任意字幕；
多电影目录继续排除通用`poster.jpg`。P7 Procurement fixture 92/92通过，Admin Web production build通过。

旧Candidate事实保持immutable。当前`F:\canary`已不存在；上一轮失败数据库保留在
`C:\Users\markm\AppData\Local\Temp\ShelfDeck-Movie-Canary-UAT-20260821-225906-424bbd71-final`。
本修复提交后从只读`F:\test_film`重建全新`F:\canary`和隔离UAT事实库，不续跑旧Formation/On-deck事实。

修复状态（2026-08-22）：`REGRESSION PASSED / CLEAN CANARY REBUILD AUTHORIZED`。

2026-08-23逐项封口在重建Canary `UAT-20260823-002500-519f8d7b5`完成。已上架的`养蜂人 (2024)` Final Inventory
精确登记`banner.jpg`（63,899字节）、`landscape.jpg`（275,844字节）和`clearlogo.png`（1,148,494字节），三项角色均为
`sidecar`；FS中三文件与Inventory位置、大小一致。真实“我的收藏”详情显示该片为当前收藏且健康；同批`全面失控`、`劫机`、
`短暂和平`、`第八个嫌疑人`等已完成目录也保留`clearlogo.png`，未再因这些常见图像形成unknown-member。
状态`REGRESSION PASSED / CONFIRMED ON REBUILT CANARY`。UI证据：
`admin-web-evidence/uat-028-common-images-related-disposition-pass.png`。

## 26. UAT-029：NFO 把演员 TMDB 人 ID 误判为电影身份冲突

问题分类：`IDENTITY_NORMALIZATION / NFO_PARSER / USER_VISIBLE_RECOVERY`

用户侧现象：2026-08-22 干净 Movie Canary 真实 Admin Web UAT 中，`007：大破天幕杀机`、`劫机`、`放·逐`、`老笠`、`锡尔弗顿之围` 进入“需要处理”，页面显示“本次整理已冻结，需要放弃后重新采购”。用户看不到可确认的身份候选。

现场证据：

- Formation 冻结事实的 `identity_issue_json` 为 `result=conflicting`、`reasonCode=nfo_association_conflicting`、`candidates=[]`；
- 这些片子的 Kodi/Emby NFO 电影级身份是唯一的。以 `007：大破天幕杀机` 为例，电影 ID 为 `<tmdbid>37724</tmdbid>` 且 `<uniqueid type="tmdb">37724</uniqueid>`，年份只有 2012；
- 同一份 NFO 在每个 `<actor>` 下还有演职员 `<tmdbid>`（如 Daniel Craig `8784`、Judi Dench `5309`）。全文搜集后该片一次出现 50 多个数字 ID。`劫机`、`放·逐`、`老笠`、`锡尔弗顿之围` 同一模式。

精确根因：Product Identity 的 NFO 解析对整份 XML 收集所有 `<tmdbid>` 以及 `uniqueid type="tmdb"`。演员节点里的人 ID 与电影 ID 被当成同一组电影身份。多个数字即返回 `ambiguous/source_fact_conflicting`，再映射为 `nfo_association_conflicting` 且候选为空。NFO 本身没有两个电影身份。

业务影响：有正规 NFO 的片子无法完成身份取证，Run 被冻结，用户不能确认唯一电影 ID，本轮 UAT 这些条目不能上架。

修复边界：只读取电影级身份，即 `<movie>` 的直接子节点 `<tmdbid>` / `<uniqueid type="tmdb">`；不扫描 `<actor>`、`<director>` 等演职员人 ID。多个电影级 TMDB ID 才构成冲突，并必须把这些电影 ID 作为用户可确认候选；年份仍只从电影级 `year/premiered/releasedate` 取值。不放宽模糊匹配，不改 TMDB 适配器或跨 Domain 所有权。

验收证据：专项回归覆盖 `007：大破天幕杀机` 形态（电影 `37724` + 演员 `8784`/`5309` + 系列合集 `645`），断言 `parseNfo` 为 `observed` 且唯一身份为 `37724`；`observeProductIdentity` 为 `resolved`。两个电影级 TMDB ID 仍为 `ambiguous` 并带出这两个候选。P8 Decision front-half 13/13 通过。

修复状态（2026-08-22）：`REGRESSION PASSED / CLEAN CANARY UAT PENDING`。旧冻结 Run 保持不可变；本修复随其余 OPEN 项完成后重建干净 Canary，再从真实 Admin Web 复测上述片名。

2026-08-23逐项封口在重建Canary `UAT-20260823-002500-519f8d7b5`完成。原问题片单`007：大破天幕杀机`、
`劫机`、`放·逐`、`老笠`和`锡尔弗顿之围`的NFO Observation与Provider exact Observation全部为`resolved`、reasonCode为空，
电影TMDB ID分别唯一为37724、1147710、13807、345735、951470。真实Formation中`007`“确认影片身份”100%，没有
“媒体身份信息冲突”，当前终态明确位于后续外部寻源。状态`REGRESSION PASSED / CONFIRMED ON REBUILT CANARY`。
UI证据：`admin-web-evidence/uat-029-movie-level-nfo-identity-pass.png`。

## 27. UAT-030：五星外部获取用文件夹展示名搜索，合格源缺失时页面像卡住

问题分类：`EXTERNAL_INTEGRATION / IDENTITY_NORMALIZATION / USER_VISIBLE_RECOVERY`

用户侧现象：2026-08-22 干净 Movie Canary 真实 Admin Web UAT 中，一批豆瓣 5 星片子停在「外部获取」，
进入「需要处理」，下一动作是「本次整理已冻结，需要放弃后重新采购」。表面像 MoviePilot 下载卡住。

现场证据（隔离库
`C:\Users\markm\AppData\Local\Temp\ShelfDeck-Movie-Canary-UAT-20260822-021504-2ed7baad2`）：

- 五部均为 5 星，整理要求 `HEVC · 4k · 不超过 50 GiB`，主音轨白名单为 TrueHD / Atmos / DTS-HD MA / DTS:X；
- 本地 `product_media.verify` 失败（`video_codec_unmet` / `minimum_raster_unmet` / `primary_audio_unmet`）。
  五星禁止把低于 4K 的输入放大，也禁止音频转码冒充高质量主音轨，因此正确进入 MoviePilot 外部获取；
- `libra-external-material-search_selection` 成功结束，`acquire_verification` 从未提交；
- Run 冻结为 `product_unachievable`，`recovery_attempt_ordinal=0`，该 process 无失败 Attempt。
  `P5_SECRET_LEASE_INVOCATION_FAILED` 属于另一批片子，不是这五部。

| 展示名 | 搜索 keyword | MoviePilot 结果 | 选择 / 冻结码 |
| --- | --- | --- | --- |
| 地狱尖兵 (2022) | 同左 | 1 条 available，1080p H264，noncompliant | `not_selected` / `no_requirement_eligible_candidate` |
| 黑客帝国动画版 (2003) | 同左 | 6 条 available，全部 below_4k | 同上 |
| 金的音像店 (2023) | 同左 | 2 条 available，1080p H264 | 同上 |
| 一场很（没）有必要的春晚 (2022) | 同左 | 1 条 available，1080p H264 | 同上 |
| 看不见的朋友 (2023) - 1080p H.264 CHDWEB | 同左（含技术后缀） | 0 条 | `not_selected` / `no_available_candidate` |

精确根因：

1. Product Identity 已经 resolve 到 TMDB（如 `看不见的朋友` = `993092`），但
   `buildProductIdentityCommitBundle` 仍把 Candidate 文件夹展示名写入 display identity title，
   不使用 TMDB 正式片名，也不剥离 UAT-022 已处理过的技术发布后缀；
2. `AcquisitionQuery` 的 title term 取自该 display identity；MoviePilot 适配器
   `api/v1/search/title` 优先用 title，有 `provider_key`（TMDB ID）也不拿去搜；
3. 选择合同正确丢弃明确 `noncompliant` 候选。无 `compliant`/`unknown` 时冻成产品不可达是 SSOT 规定，
   不得用本地 1080p 或普通转码交差。页面却继续显示「外部获取」，不解释冻结原因。

业务影响：五星片子看起来卡在外部获取；搜索词被文件夹名、年份和技术后缀污染，可能漏掉本可命中的源。
即便搜索修好，若 MoviePilot 确实没有 4K HEVC + 高质量主音轨，冻结仍合法，但用户必须能看懂原因。

修复边界：

- Resolve 后的 display identity title 使用 TMDB 正式片名，并剥离技术发布后缀；不把文件夹质量标签留进身份；
- MoviePilot 在已有 TMDB `provider_key` 时按该身份搜索，不以脏文件夹名为 keyword；
- Formation 对 `no_requirement_eligible_candidate` / `no_available_candidate` 给出可读冻结原因，
  不再让已冻结 Run 看起来像仍在外部获取；
- 不放宽五星 4K / HEVC / 高质量主音轨合同，不选择明确不合规种子，不改 Domain Owner。
  旧冻结 Run 保持不可变。

验收证据：NFO resolve 使用电影级 `<title>`，不再把文件夹质量后缀写入 display title。MoviePilot 在同时存在
`provider_key` 与 title 时按 TMDB ID 搜索。Formation 对 `no_requirement_eligible_candidate` /
`no_available_candidate` 给出可读冻结文案。P8、Formation Projection、P14 H1 Provider 专项回归通过。

修复状态（2026-08-22）：`REGRESSION PASSED / CLEAN CANARY UAT PENDING`。无 4K 合格源时仍允许冻成产品不可达。
旧冻结 Run 保持不可变。

## 28. UAT-031：Movie Field 默认扩展名遗漏 ISO，倩女幽魂2未进入观察

问题分类：`PROCUREMENT_EXTRACTION_POLICY / DISC_INPUT / USER_VISIBLE_RECOVERY`

用户侧现象：2026-08-22 干净 Movie Canary 真实 Admin Web UAT 中，基线顶层单元
`倩女幽魂2：人间道 (1990)` 是 ISO 原盘，却没有出现在 Formation 的 22 个 Subject 里。
成功标准要求它作为一部 Movie 被识别。

现场证据：页面登记 Field 时 Admin Web 默认 `allowedExtensions` 为
`.avi .bdmv .clpi .m2ts .m4v .mkv .mov .mp4 .mpls .ts .wmv`，不含 `.iso`。
Observation revision 2 形成 22 个 Candidate，恰好等于「22 个顶层单元 − 1 个 ISO + 1 个养蜂人 BDMV」。

精确根因：Movie Field 默认 Extraction Policy 只覆盖常见流文件和 BDMV 结构扩展名，
没有把 ISO 盘镜像作为一部 Movie 的合法输入。ISO 被判定 `policy_extension_not_allowed`，
不进入 Triage。

业务影响：ISO 原盘从发现阶段就消失，无法整理或上架。

修复边界：Admin Web 默认 Movie Field 政策纳入 `.iso`；本地 Canary 脚本与 Movie 测试库政策对齐。
仍把单个 ISO 视为一部 Movie，不展开内部文件。不改 Field Owner 或 Observation 合同。

验收证据：Admin Web `materialFieldRegistration` 默认列表含 `.iso` 的专项回归通过。旧 Field 政策不可变；
干净 Canary 重建后从页面新建 Field 才能观察到 `倩女幽魂2：人间道`。

修复状态（2026-08-22）：`REGRESSION PASSED / CONFIRMED ON CURRENT CANARY`。干净 Canary
`UAT-20260822-141950-0c27c8cf6` 的真实「我的收藏」中有两个独立且健康的「养蜂人」当前 Shelf Entry，详情占用分别为
`8.3 GB`和`5.8 GB`；`F:\canary`中对应目录精确为`养蜂人 (2024)`与
`养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1`，各有一份 MKV（`6180282340`与`8932765796`字节），
目录均非hash且无`(0)`年份。UI证据：`admin-web-evidence/uat-034-two-beekeepers-distinct-entries.png`、
`uat-034-beekeeper-first-entry-detail.png`、`uat-034-beekeeper-second-entry-detail.png`。

2026-08-23逐项封口在重建Canary `UAT-20260823-002500-519f8d7b5`完成。Movie Field的Extraction Policy revision 1
明确包含`.iso`；Procurement为`倩女幽魂2：人间道 (1990)`形成`state=published`、`material_input_form=iso`的Candidate
Package，原始Primary精确指向23,393,665,024字节的`倩女幽魂2：人间道 (1990) - 1080p AVC DTS.iso`。真实“我的收藏”
详情显示该片9.3GB、当前收藏且健康；FS只有一个最终目录和10,021,609,024字节MKV。状态
`REGRESSION PASSED / CONFIRMED ON REBUILT CANARY`。UI证据：
`admin-web-evidence/uat-031-iso-observed-and-shelved-pass.png`。

## 29. UAT-032：Aftercare 旧 Custody 绑定 objectKind 与合同不一致，健康评估无法执行

问题分类：`AFTERCARE_CONTRACT / SCHEMA_REJECTION / COLLECTION_HEALTH`

用户侧现象：2026-08-22 干净 Movie Canary 中已进入收藏的 6 部健康状态全是 `never_assessed`，
概览「健康收藏」为 0。UAT-026 专项里 Aftercare 也因 `care-custody` 输入被 schema 拒绝。

现场证据：服务日志 `arca.aftercare.custody.observe@1` 报 `P4_CAPABILITY_SCHEMA_REJECTED`：
`knownBindings.bindings[n].objectKind must be equal to constant`。合同 `KnownBindings.bindings`
只允许 `arca-material-binding`。Context reader 把当前成员写成该值，却把旧 custody 写成
`arca-known-old-binding`。

精确根因：Aftercare Known Bindings 把「仍在最终位置的成员」和「已被替换、待对照的旧 Binding」
混用了两个 objectKind；后者不是 Domain Input 合同允许的常量，Event 在 Capability 派发前失败。

业务影响：上架成功的电影无法做 Custody/健康证明，Aftercare 从第一步就停住。

修复边界：当前成员与旧 custody 行一律使用 `objectKind: arca-material-binding`。仍用 objectId
前缀区分 old-binding。不放宽 schema，不改 Aftercare Owner。

验收证据：合同测试断言 Aftercare context reader 不再写出 `arca-known-old-binding`。

修复状态（2026-08-22）：`REGRESSION PASSED / CLEAN CANARY UAT PENDING`。

## 30. UAT-033：同名字幕和 stem-fanart 被压成同一最终文件名，同根上架报 TARGET_COLLISION

问题分类：`PLACEMENT_NAMING / RELATED_DISPOSITION / SAME_ROOT_INVENTORY`

用户侧现象：2026-08-22 干净 Movie Canary 中 `战栗空间 (2002)`、`养蜂人 (2024)` MKV 停在「等待收藏架验收」。
服务对 `arca.acceptance.inventory_feasibility.observe` 报 `CLEAN_ARCA_TARGET_COLLISION`。

现场证据：

- `战栗空间` Product Manifest 有三条字幕，其中两条都是 `.ass` 且文件名只有 `chinese(简英,assrt)` /
  `chinese(简英,subtitle_best)` 的差异。Placement 字幕模板在无法证明 ISO 语言时把它们都写成
  `战栗空间 (2002).ass`。
- `养蜂人` 同时有通用 `fanart.jpg` 和 `…-fanart.jpg`。后者被当成 fanart 角色，也被写成 `fanart.jpg`。

精确根因：无语言证据时仍套用 `{stem}{ext}`；stem 限定的 fanart 被当成规范 `fanart.ext`。Collision Policy 为
`reject`，可行性观察因此失败。失败没有变成用户可读的「需要处理」，看起来像一直在等收藏架。

修复边界：没有证明 language/forced/SDH 的字幕保持原文件名。只有恰好名为 `fanart/background/backdrop.ext`
的文件使用 fanart 角色和 `fanart.ext` 模板；`片名-fanart.jpg` 作为 sidecar 保留原名。不引入 hash 或 `(0)`。
两条已证明为同一语言同一扩展名的字幕仍 fail closed。

验收证据：战栗空间型双 `.ass` 最终名保持可区分原名；`Feature-fanart.jpg` 角色为 sidecar。

修复状态（2026-08-22）：`REGRESSION PASSED / CLEAN CANARY UAT PENDING`。

2026-08-23逐项封口在重建Canary `UAT-20260823-002500-519f8d7b5`完成。`战栗空间 (2002)` Final Inventory中的
两条`.ass`分别保留`chinese(简英,assrt)`与`chinese(简英,subtitle_best)`原basename，13个Inventory位置13/13唯一；
`养蜂人 (2024)`的通用`fanart.jpg`以`fanart`登记，stem-fanart以`sidecar`及原名登记，9个Inventory位置9/9唯一。
FS对应文件均存在，当前服务日志`CLEAN_ARCA_TARGET_COLLISION`为0；真实“我的收藏”显示`战栗空间`为当前收藏且健康。
状态`REGRESSION PASSED / CONFIRMED ON REBUILT CANARY`。UI证据：
`admin-web-evidence/uat-033-distinct-subtitle-fanart-names-pass.png`。

## 31. UAT-034：同名片名+年份的两部养蜂人最终目录必须可区分

问题分类：`PLACEMENT_NAMING / EDITION_CONTINUITY / USER_VISIBLE_COLLECTION`

用户侧现象：用户确认 `养蜂人` 现成 MKV 与嵌套 BDMV 是两部电影，都必须上架。Placement 模板是
`{title} ({year)}` 且 collision 为 `reject`。身份 resolve 到同一 TMDB 片名和年份后，两部会争同一目录。

现场证据：当前展示名分别为 `养蜂人 (2024)` 与 `养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1`。
来源侧 BDMV 子目录已带版本标签。成功标准禁止 hash 或 `养蜂人 (0)`。

精确根因：Resolved display identity 只保留 title/year/TMDB ID。UAT-030 去掉文件夹质量后缀是对的，
但没有把「来源版本标签」作为独立 edition 留下来给 Placement。

修复边界：从 Candidate 原展示名中，在正式片名和年份之后切出版本标签（含 2160p/HEVC/Atmos 等），
写入 display identity 的 `edition` 条目，不进入搜索 title。Inventory 目录在有 edition 时为
`片名 (年份) - edition`。MKV 若来源目录恰好是 `片名 (年份)` 则不加 edition。不去重、不合并 Subject。

验收证据：`editionFromSourceDisplay` 对 BDMV 展示名得到 `2160p HEVC Atmos TrueHD5.1`，对纯
`养蜂人 (2024)` 为 null；两个最终目录可区分。

修复状态（2026-08-22）：`REGRESSION PASSED / CLEAN CANARY UAT PENDING`。

## 32. UAT-035：FFmpeg 非零退出被当成进程崩溃，Remux Attempt 停在 executing

问题分类：`MEDIA_EFFECT / EXECUTOR / RECOVERY`

用户侧现象：干净 Canary `UAT-20260822-042527-2da763653` 中，`倩女幽魂2：人间道` 与 BDMV `养蜂人`
页面仍是「封装整理 / 处理视频文件」，但没有 FFmpeg 进程。工作区只有一份约 82 MB 的 remux `.partial`，mtime 不再增长。

现场证据：

- stderr 两次 `LIBRA_MEDIA_FFMPEG_FAILED`，`onExecutionRuntimeError` 只打 code/message，没有 Attempt 失败码；
- 对应 `libra.media.remux@1` Event/Attempt 仍是 `executing`，`finished_at_ms` 为空；
- Event Runtime 对 journaled Effect 的 Executor 抛错会 rethrow；Host 记 `event_faulted` 后把 Attempt 留给「effect-specific recovery」，但活路径不会把该 Event 送进恢复队列，只有重启才可能扫到。

精确根因：FFmpeg 非零退出是 Capability 失败，不是不可恢复的进程崩溃。Remux/Transcode 端口把该错误抛出去，journaled 路径不 `complete()` Attempt，页面就一直显示整理中。

修复边界：Remux/Transcode 端口把 `LIBRA_MEDIA_FFMPEG_FAILED` / `LIBRA_MEDIA_FFMPEG_TIMEOUT` 收成
`kind:failed` Outcome；startup recovery 对 journaled 的失败 Outcome 同样 `complete()`，不再 `P4_EVENT_RECOVERY_NOT_CONVERGED` 空转。未捕获的真正崩溃仍保持 executing 给 Effect recovery。不把 ISO 当普通流硬打开当成成功。

验收证据：P4 Event Runtime 专项证明 journaled `LIBRA_MEDIA_FFMPEG_FAILED` Outcome 会完成 Attempt 并 `requireReconcile`；startup recovery 同样记下失败而不是 NOT_CONVERGED。既有「非纯 Executor crash 保持 executing」反例仍通过。

修复状态（2026-08-22）：`REGRESSION PASSED / SERVICE RESTART REQUIRED`。当前隔离库里已卡住的 Remux Attempt 必须随服务重启走 startup recovery 才能收口。

2026-08-23逐项封口复核完成。历史clean Canary `UAT-20260822-042527-2da763653`保留2个
`LIBRA_MEDIA_FFMPEG_FAILED` Attempt，2/2均为`failed`，对应Remux Event 2/2也为`failed`，没有遗留`executing`；
当前重建Canary `UAT-20260823-002500-519f8d7b5`中1个Remux和5个Transcode Event全部`succeeded`、媒体Event
`executing=0`，原ISO样本`倩女幽魂2：人间道`已为当前收藏且健康。P4 Event Runtime故障/恢复专项31/31 PASS，精确覆盖
journaled failed Outcome完成Attempt与startup recovery收口。状态`REGRESSION PASSED / CONFIRMED ON CANARY`。
UI证据：`admin-web-evidence/uat-035-ffmpeg-failure-closed-no-stale-executing-pass.png`。

## 33. UAT-036：ISO 已被观察但 Triage 因非可播放流失败，倩女幽魂2仍无 Candidate

问题分类：`DISC_TOPOLOGY / ISO_UDF / TRIAGE_STRUCTURE`

用户侧现象：干净 Canary 重建后 Field 政策已含 `.iso`，`倩女幽魂2：人间道` 的 ISO 出现在 Observation，
但没有 Subject。Formation 仍是 22 行（含两部养蜂人）。

现场证据：`proc_run_materials` 对该 ISO 为 `selection_state=released`、`terminal_disposition=triage_failed`。
Scope 是 `ordinary_directory`、1 个成员。媒体探针把 ISO 当普通流；ffprobe 非媒体后 Structure 按
`!playable` 丢弃。Disc topology 合同要求从 ISO9660/BDMV 内容证明 `discKind=iso`；本文件名是
`1080p AVC DTS.iso`，很可能是 UDF 蓝光映像，现有 `inspectIso` 读不到 BDMV 清单，topology 为 null。

精确根因：UAT-031 只解决了 Extraction Policy 准入。Triage 仍要求可播放流或已证明的 disc topology。
现有 `inspectIso` 只认 ISO9660 `CD001`。这份 `倩女幽魂2` 映像扇区 16 是 `BEA01`/`NSR03`/`TEA01`，
AVDP 在扇区 256，随后是 UDF 2.50 元数据分区；没有 `CD001`，topology 为 null，ffprobe 也不是可播放流，
因此被当成 `probe_not_media`。

业务影响：ISO 原盘仍不能形成一部 Movie。不得用「凡是 .iso 都当 Candidate」绕过内容证明。

修复边界：为纯 UDF 蓝光映像补齐有界 AVDP / Partition Map / Metadata Partition 目录遍历，
从 BDMV playlist 内容证明 `discKind=iso` 并选出一部主标题；Triage 仅在该 topology 完整时把
`materialInputForm=iso` 作为一部 Movie，Playability 用 topology 代替 ffprobe 流。多标题仍 fail closed。
不把 `.iso` 扩展名或 ffprobe 失败当作成功。

验收证据：合成 UDF 2.50（无 ISO9660、带 metadata partition 与 BDMV）专项回归证明 `discKind=iso`、
主 playlist `BDMV/PLAYLIST/00000.mpls`、clip `00000`；仅有 `BEA01` 而无 Volume Descriptor 的映像返回 null。
`isProvenIsoTopology` 拒绝只有 `discKind` 没有完整 digest 的残缺证据。P7 disc topology 3/3 通过；
只读复测真实 `F:\test_film` 的 23 GiB UDF ISO 同样选出主 playlist。

修复状态（2026-08-23）：`REGRESSION PASSED / CONFIRMED ON CURRENT CANARY`。干净 Canary
`UAT-20260822-141950-0c27c8cf6` 的新Observation/Run已让《倩女幽魂2：人间道》形成Subject/Candidate并完成
生产与On-deck；真实详情显示`9.3 GB · MKV`、当前收藏且健康。纯UDF ISO不再停在`triage_failed`。
UI证据：`admin-web-evidence/uat-036-iso-triage-candidate-ondeck.png`。

## 34. UAT-037：007 在身份取证的 provider_exact 观察被 schema 拒绝，冻结文案退回通用句

问题分类：`EXTERNAL_INTEGRATION / PRODUCT_IDENTITY / USER_VISIBLE_RECOVERY`

用户侧现象：2026-08-22 隔离库 `UAT-20260822-033722-8e18372b9` 中，`007：大破天幕杀机 (2012)` 进入「需要处理」，
下一动作是通用「本次整理已冻结，需要放弃后重新采购」，整理动作仍是「尚未形成整理动作」。同批五星片
（地狱尖兵、黑客帝国动画版等）已经走到外部获取并显示「没有找到可获取的外部候选」。

现场证据：

- 豆瓣 5 星，整理要求 `HEVC · 4k · 不超过 50 GiB`；`identity_issue_json` 为空；
- NFO 已作为 Related `nfo` 进入 Candidate；UAT-029 电影级 TMDB `37724` 仍在；
- `fx_workflow_events` 节点 `provider_identity_observation` 的
  `libra.product_identity.evidence.observe@1` Attempt 以 `P4_CAPABILITY_SCHEMA_REJECTED` 失败；
- Run 因此按 `product_unachievable` 冻结，从未进入 MoviePilot 选择，所以 UAT-030 的外部获取冻结文案套不上。

精确根因（2026-08-22）：

- `007：大破天幕杀机`：NFO 已解析 TMDB `37724`，`provider_exact` 观察从 TMDB 拿到详情后，把未 NFKC 的片名和已经 NFKC 的 alternative titles 一起 unique，全角 `：` 变成两条 alias，冲破 `verifiedIdentity.aliases` 的 32 上限，dispatcher 报 `P4_CAPABILITY_SCHEMA_REJECTED`。
- `锡尔弗顿之围`：TMDB 10s 超时码是 `PLATFORM_INTEGRATION_TIMEOUT`，Secret lease 包成 `P5_SECRET_LEASE_INVOCATION_FAILED`。pure_observation 只重试 `timeout`/`integration`，`executor` 一次即冻成 `product_unachievable`。

修复边界：identity candidate 先 NFKC 再 unique，并截到 32。lease 包装的 TMDB timeout/network 在 Identity/Routing observe 收成 `failureClass=timeout|integration`，按合同重试。不改冻结文案，不把身份失败伪装成五星外部获取。

验收证据：全角 `007：大破天幕杀机` 加 32 条 TMDB alias 的观察通过 `ProductIdentityEvidenceObservation` schema；lease 包装的 timeout 是 `timeout` Outcome。产品身份选择测试 8/8 通过。

修复状态（2026-08-23）：`REGRESSION PASSED / CONFIRMED ON CURRENT CANARY`。干净 Canary
`UAT-20260822-141950-0c27c8cf6` 的007新Run中，两次`libra.product_identity.evidence.observe@1`与一次
`libra.product_identity.resolve@1`均`succeeded`；页面身份、资料、海报/NFO、外部寻源、验证五步均100%，终态为明确的
「没有找到可获取的外部候选，本次整理已冻结」，不再是schema rejection或通用冻结。
UI证据：`admin-web-evidence/uat-037-007-identity-resolved-legal-freeze.png`。

## 35. UAT-038：上架成功后 Aftercare 健康仍是 conformance/presentation 降级

问题分类：`AFTERCARE_CONTRACT / COLLECTION_HEALTH`

用户侧现象：同一隔离库中 12 个 Shelf Entry 的 Custody 评估为 `healthy`（UAT-032 objectKind 已生效），
但 Conformance 全是 `degraded`（`conformance:old_binding_unreadable`，critical，29 条），
Presentation 全是 `degraded`（`presentation:nfo_corrupt`，warning，`auto_repair`，12 条）。
收藏页健康状态因此不是健康。

现场证据：`observeKnownOldBindings` 只对 `offload:` 旧 Binding 且路径不在当前 Final 成员集合中的行取样；
`unreadable` 不是 `ENOENT`（缺席会被跳过）。`validNfo` 要求 UTF-8 XML 声明、`<movie` 与文末 `</movie>`。

精确根因（2026-08-22 现场字节）：

- `conformance:old_binding_unreadable`：Off-load 旧路径（如 `放·逐 (2006) - 1080p Remux 2Audio DTS PTH.nfo/.mkv`）Settlement 后已经 ENOENT。`computeBoundedMaterialFingerprintSync` 把 ENOENT 包成 `PHYSICAL_MATERIAL_FINGERPRINT_IO_FAILED`（`details.causeCode=ENOENT`）。`observeKnownOldBindings` 只认 `error.code==='ENOENT'`，于是把合法缺席当成 unreadable。12 个 Entry × 大约 2 条 offload 源 ≈ 29 条。
- `presentation:nfo_corrupt`：12 份 On-deck 产品 NFO 都是合法 `<movie>…</movie>`（例如 `放·逐 (2006).nfo` 以 `<movie>` 开头、`</movie>` 结尾），但没有 `<?xml` 声明。`validNfo` 把声明当成必填。

修复边界：指纹包装的 ENOENT 视为 `absent`（与真正缺席一样跳过）；产品 movie NFO 允许无 XML 声明。目录/EACCES 等仍 `unreadable`；`<tvshow>` 或非 movie 文档仍 `nfo_corrupt`。不得忽略 finding。

验收证据：缺失 offload 路径经真实 fingerprint 端口观察为 `absent`；残留目录仍 `unreadable`。无声明的 `<movie>` NFO `validNfo=true`，`<tvshow>` 为 false。p15 Aftercare 合同测试 13/13 通过。

修复状态（2026-08-22）：`REGRESSION PASSED`。已上架 Entry 的 Aftercare 周期会在下次评估时不再发出这两类 Finding。

## 36. UAT-039：同根上架把源文件和兄弟电影目录当成占用/未知成员

问题分类：`SAME_ROOT_INVENTORY / SETTLEMENT_SCOPE`

用户侧现象：干净 Canary 中 `光荣的愤怒`、MKV `养蜂人`、`香火` 产品已交付，停在「正在完成收藏架上架」。
stderr 为 `CLEAN_ARCA_TARGET_OCCUPIED` 与 `CLEAN_ARCA_SETTLEMENT_UNKNOWN_MEMBER`。

现场证据：

- 同根 Field=Shelf。`光荣的愤怒` / `香火` 目录里已有 `poster.jpg`、`.nfo`，与 Workspace 产品字节不同，Stage 把最终名上的源文件当成外来占用；
- `养蜂人 (2024)` 目录同时有 MKV 电影和嵌套 BDMV 子目录（另一部 Subject）。Settlement 把该子目录当成当前电影的未知成员。

精确根因：Stage/Switch 对最终路径上「不同字节」一律 `TARGET_OCCUPIED`，没有把本包 Off-load 源位置视为将被替换的 Input。Settlement 对源目录做全量 listing，没有排除不属于本包 Control scope 的兄弟电影目录。`notes.txt` 这类真正未纳入计划的文件仍应 fail closed。

修复边界：最终名上的已有文件若是本包 `offloadContextManifest` 源位置，允许 Stage 到 slot 再 Switch 替换。Settlement 忽略源目录中、且没有任何本包 managed 路径落在其下的兄弟目录；普通未知文件仍 `UNKNOWN_MEMBER`。不放宽 collision=reject，不合并两部养蜂人。

验收证据：同根不同海报字节 Stage/Switch 后最终 `poster.jpg` 为产品字节。源目录旁有 BDMV 兄弟目录时 Settlement 成功且兄弟目录仍在；同时有 `notes.txt` 仍 fail closed。Inventory port 9/9 通过。

修复状态（2026-08-23）：`REGRESSION PASSED / CONFIRMED ON CURRENT CANARY`。干净 Canary
`UAT-20260822-141950-0c27c8cf6` 中，曾共享 Field/Shelf 根的两部养蜂人、光荣的愤怒、香火均已成为
`Movie Canary`当前收藏且健康；`F:\canary`现有22个一级电影目录、两个独立养蜂人目录，无嵌套养蜂人兄弟目录、无`.partial`。
同根 Stage/Switch 与 Settlement 已完成，没有再停在`TARGET_OCCUPIED`或`UNKNOWN_MEMBER`。UI证据：
`admin-web-evidence/uat-039-same-root-sibling-entries-ondeck.png`。

## 37. UAT-040：ISO 原盘 Remux 把映像文件当成普通流输入

问题分类：`DISC_INPUT / MEDIA_EFFECT`

用户侧现象：UAT-035 收口后，`倩女幽魂2：人间道` Remux 不再挂死，但 Run 冻成「本次整理已冻结」。Attempt 现有 `LIBRA_MEDIA_FFMPEG_FAILED`。

现场证据：`materialInputForm=iso`。`executeRemux` 对单一 primary 使用 `-i <iso路径> -c copy`。UDF 蓝光不是可 copy 的容器流；topology 已选出 playlist/clip，Remux 没有用这些成员。

精确根因：Triage 证明 ISO topology 后，Production Remux 仍把 ISO 文件当 `stream_file` 喂给 FFmpeg。内置 ffmpeg-static 没有 `bluray` demuxer，`-i file.iso` 无法打开 UDF 蓝光。

修复边界：ISO 的 Remux 必须按已证明 topology 的 selected playlist/clips 从映像 extent 抽出 payload 再 `-c copy`。不得把 `.iso` 当普通输入，不得用「跳过 Remux、直接上架 ISO」交差。`MediaProbeEvidence.discTopology.members` 仍只允许 `relativeLocation/role/clipId`；extent 留在独立 ISO listing，不写进 topology 合同。无 BDMV topology 的 ISO/UDF 卷 fail closed，不退回 `-i iso`。

验收证据：UDF fixture 抽出 `BDMV/STREAM/00000.m2ts` 后 Remux 得到 Matroska；普通 MKV 仍直接 `-i`；无 topology 的 BEA01 卷报 `LIBRA_MEDIA_ISO_TOPOLOGY_UNPROVEN`。disc-topology 与 media-effect 测试通过。

修复状态（2026-08-23）：`REGRESSION PASSED / CONFIRMED ON CURRENT CANARY`。干净 Canary
`UAT-20260822-141950-0c27c8cf6` 的新 Observation/Run 已把《倩女幽魂2：人间道》完成上架；真实详情为
`9.3 GB · MKV`、当前收藏且健康。只读源 ISO 仍位于`F:\test_film`且为`23393665024`字节；最终目录只有
`10021609024`字节MKV，无ISO、无BDMV/CERTIFICATE树，未把映像文件当普通流或最终产品交差。UI证据：
`admin-web-evidence/uat-040-iso-extracted-remux-ondeck.png`。

## 38. UAT-041：BDMV HEVC/TrueHD Remux 因 PES 缺时间戳被 Matroska 拒绝

问题分类：`DISC_INPUT / MEDIA_EFFECT`

用户侧现象：嵌套 BDMV `养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1` Remux 冻成「本次整理已冻结」。Attempt 只有 `LIBRA_MEDIA_FFMPEG_FAILED`，库里没有 stderr。

现场证据：唯一 `primary_payload` 是 `BDMV/STREAM/00002.m2ts`（192 字节 BDAV，68.7GiB，HEVC + TrueHD Atmos）。Workspace 残留 `82,232,093` 字节 partial，与当场用同一 argv 复现的失败输出完全同长。ffprobe 第二包视频 `pts=N/A dts=N/A`。失败句：`Can't write packet with unknown timestamp` / `Error muxing a packet`。ISO Remux 当时并发挂死，失败 Outcome 不写 `evidence_json`，所以库内看不到 stderr。

精确根因：BDAV 把一个 HEVC AU 拆进多条 PES，只有第一条带 PTS/DTS。`+genpts` 填不上这些 continuation 包，Matroska copy-mux fail closed。这不是「BDMV 不能 Remux」，也不是被 ISO 挂死误杀。

修复边界：Remux `-c copy` 对视频使用 `setts` 继承前一包 PTS/DTS，不发明 wall-clock 时间，不丢包，不上架原盘目录。ISO 抽出的 m2ts 走同一条 copy 路径。普通已有时间戳的流保持原 PTS。

验收证据：无 setts 的生产 argv 在约 4s 内 Conversion failed 且输出 82232093 字节；带 setts 后 12s 内写出数 GiB 且无 unknown timestamp。媒体 Effect 测试覆盖缺 PTS 的 MPEG-TS 与（若存在）现场 BDAV 前缀。

修复状态（2026-08-23）：`REGRESSION PASSED / CONFIRMED ON CURRENT CANARY`。干净 Canary
`UAT-20260822-141950-0c27c8cf6` 的新Run已把BDMV养蜂人完成上架；真实详情显示`8.3 GB · MKV`、当前收藏且健康。
只读源`BDMV/STREAM`仍有61个M2TS、合计`69941790720`字节；最终MKV为`8932765796`字节且无`.partial`，
没有再因unknown timestamp冻结。UI证据：`admin-web-evidence/uat-041-bdmv-timestamp-remux-ondeck.png`。

## 39. UAT-042：同根 Off-load Settlement 源现实漂移

问题分类：`SAME_ROOT_INVENTORY / SETTLEMENT_SCOPE`

用户侧现象：UAT-039 之后，`光荣的愤怒`、`香火` 仍停在「正在完成收藏架上架」。服务 stderr 新出现 `CLEAN_ARCA_SETTLEMENT_REALITY_DRIFT`（Settlement source drifted from the approved Material identity）。

现场证据：MKV `养蜂人` 已 completed；这两部仍 `in_progress`。同根 in-place 替换后源文件 identity/inode/size 与批准的 Off-load 源不一致。

精确根因：UAT-039 允许同根 Switch 用产品字节替换最终名上的源文件。Settlement 仍用 Off-load 源 handle 的旧 fingerprint 去核同一路径，看到的已经是产品字节，于是 `REALITY_DRIFT`。不同路径的源删除核对应仍用源 identity。

修复边界：`source === finalTarget` 时，Settlement 核对最终产品 identity（`finalPlan` size/fingerprint），不删文件，disposition `retained_as_final`。其它路径仍先核源 identity 再删。不得忽略 drift。

验收证据：同根 poster 替换后 Settlement 成功，最终 `poster.jpg` 仍是产品字节。Inventory port 9/9 通过。

修复状态（2026-08-23）：`REGRESSION PASSED / CONFIRMED ON CURRENT CANARY`。干净 Canary
`UAT-20260822-141950-0c27c8cf6` 中，《光荣的愤怒》《香火》均已成为`Movie Canary`当前收藏且健康。
两者最终目录各保留1个视频、`poster.jpg`与NFO，`PartialCount=0`；同根in-place替换后的Settlement已按最终产品现实收口，
没有再停在`CLEAN_ARCA_SETTLEMENT_REALITY_DRIFT`。UI证据：`admin-web-evidence/uat-042-same-root-settlement-complete.png`。

## 40. UAT-043：007 身份已过，TMDB metadata fetch 被 closed-shape / lease 一次打成冻结

问题分类：`EXTERNAL_INTEGRATION / PRODUCT_METADATA`

用户侧现象：干净 Canary 里 `007：大破天幕杀机` 身份观察已成功，随后冻成通用「本次整理已冻结」。监测看到 `P5_SECRET_LEASE_INVOCATION_FAILED`。

现场证据：`related_nfo` / `provider_exact` / `product_identity.resolve` 均 succeeded。失败在第二次 `libra.product_metadata.fetch@1`（provider，约 456ms，不是 10s 超时）。Skyfall 带 `credits,alternative_titles,translations`，closed-shape `allowed()` 拒绝未知字段，credits 上限 256。lease 把 adapter 抛错包成 `executor`，pure_observation 不重试。

精确根因：TMDB 详情是外部演进 JSON。根对象/演职员/译名多一个字段或 Bond 级 crew 超 256，整部电影 metadata 失败并冻 Run。NFO metadata 第一次已经成功，provider 第二次失败仍终态冻结。

修复边界：metadata 响应改为必填字段校验、忽略未知 provider 字段；credits 1024、alternative titles 256、translations 128。lease 包装的 timeout/network/HTTP 收成 `timeout|integration` 可重试。缺失 `id` 仍 fail closed。不得跳过 metadata。

验收证据：Skyfall 形态（未知根字段、300 crew、80 alt titles）`validateMetadataResponse` 通过；缺 `id` 仍拒绝。metadata lease timeout 为 `timeout` Outcome。p14 TMDB 13/13 通过。

修复状态（2026-08-22）：`REGRESSION PASSED / NEW LIBRA RUN REQUIRED`。当前冻结的 007 Run 不可变。

干净 Canary `UAT-20260821-234249-d3c617add` 定向确认（2026-08-22）：007 身份 observe / resolve 与 provider metadata fetch 均 succeeded。本地源 ProductMediaVerification 为 `minimum_raster_unmet` + `primary_audio_unmet`（HEVC、below_4k、primaryAudioClasses other、约 2.9 GiB）。五星要求 4K + 无损主音轨，外部选择 `no_available_candidate`，页面为「没有找到可获取的外部候选」。这是已确认五星合同终态，不再算 UAT-043 产品阻塞。

当前关闭 Canary `UAT-20260822-141950-0c27c8cf6` 再确认（2026-08-23）：007两次
`libra.product_metadata.fetch@1`与一次`libra.product_metadata.commit@1`均`succeeded`；页面「补齐资料」100%，
随后外部寻源完成并以「没有找到可获取的外部候选」合法冻结。状态
`REGRESSION PASSED / CONFIRMED ON CURRENT CANARY`。UI证据：`admin-web-evidence/uat-043-007-metadata-success-legal-freeze.png`。

## 41. UAT-044：4 星 14 GiB 无法规划 BDMV 多 TrueHD 轨的体积转码，落入 MoviePilot 冻结

问题分类：`MEDIA_PRODUCTION / DOMAIN_ORCHESTRATION`

用户侧现象：BDMV `养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1` Remux 已成功（UAT-041 有效），但 4 星要求 `HEVC · 不超过 14 GiB`。Transcode assessment Plan 为 `contract_unplannable`，Work Attempt `media_size_budget_infeasible`，随后走外部获取并冻成「没有找到可获取的外部候选」。

现场证据：源 `00002.m2ts` 约 68.7 GiB、约 105 分钟，至少 2 条 TrueHD + 多条 AC3 core。`deriveTargetSizeBudget` 把每条 TrueHD 按 8 Mbps、其余按 1.536 Mbps **全加**。全轨拷贝时 14 GiB 留给视频的码率会低于 100 kbps 可行线。其它 4 星片子已转码成功。MKV 养蜂人已 On-deck。

精确根因：体积预算按将写入产品的全部音轨求和，transcode 也是 `-map 0:a?` 全拷。SSOT 5.5.7 四星只强制 HEVC、`mediaForm=stream_file` 和 14 GiB，高质量主音轨白名单只属于五星。把「拷贝整盘音轨」当成四星合同，是规划器误把实现细节升级成用户决策。

修复边界：规划只为实际 copy 的音轨留预算。体积上限下先去掉 `other` 伴随 core，仍不可行再只留默认/高质量主音轨。EncodeIntent 冻结 `audio.streamIndexes`，transcode map 只 copy 这些轨。不抬 14 GiB，不做音频转码，不改五星白名单。本轮该 Libra Run 已冻结不可变。

验收证据：两 TrueHD + 四条 `other` 在 105 分钟 / 14 GiB 下全拷不可行，去掉 core 后可行且索引为 `[1,2]`；三条 TrueHD 收成默认轨 `[1]`；五星 50 GiB 仍保留 TrueHD 与 core。无 `streamIndexes` 时 map 保持 `0:a?`。

当前处理决定：按已确认四星合同修规划并提交。

干净 Canary `UAT-20260822-082725-061cd399d` 定向确认（2026-08-22）：BDMV Remux 64.0 GiB 成功后，EncodeIntent `audio.streamIndexes=[1,5]`（两条 TrueHD，丢掉 AC3 core），`targetVideoBitrateBps=2279830`。Transcode assessment 通过，成品 `养蜂人 (2024).mkv` 8.32 GiB 已 On-deck。状态 `REGRESSION PASSED / CONFIRMED ON CLEAN CANARY`。

当前关闭 Canary `UAT-20260822-141950-0c27c8cf6` 再确认（2026-08-23）：只读probe显示源主clip为
`68676919296`字节、HEVC Main10、2条TrueHD+4条AC3；最终MKV为`8932765796`字节（低于14 GiB）、
仍为HEVC Main10并保留2条TrueHD、裁掉4条AC3，时长从`6336.288278s`保持为`6336.289000s`。
真实详情显示`8.3 GB · MKV`、当前收藏且健康。UI证据：`admin-web-evidence/uat-044-bdmv-four-star-budget-ondeck.png`。

## 42. UAT-045：ISO Remux 第二次 Attempt 在失败 Effect 与进程重启后永久停在 executing

问题分类：`EXECUTION_SCHEDULING / RECOVERY_CORRECTNESS`

用户侧现象：`倩女幽魂2` 仍显示「封装整理（Remux）/ 处理视频文件」，但没有 FFmpeg、没有抽出的 `.iso-clip`、工作区只剩第一次失败留下的 293 字节 partial。同一次 Canary 里其它片子继续转码并上架。

现场证据：ISO Remux Event `libra-remux-media-event-c6e5cfc9…` Attempt 1 为 `LIBRA_MEDIA_FFMPEG_FAILED`，其 workspace_write Effect `a5df5a15…` 已 `failed`。Attempt 2 自 6:54 起 `executing`，Effect Journal 无该 Attempt 的行。服务在 6:55 重启后健康为 ready，`锡尔弗顿之围` 仍能完成上架。

精确根因：`helix.event-execution-key@1` 只绑 event/workAttempt/plan，不绑 Event Attempt ordinal。UNIQUE(effect_class, idempotency_key) 让第一次失败的 Effect 占住该键。第二次 Attempt 的 `intend()` 拿回 `failed` 行，`run()` 抛 `P4_EVENT_EFFECT_RECOVERY_REQUIRED` 并留下 executing Attempt；startup 把它标成 `safe_retry_before_intent`，`recover()` 再撞 `P4_EVENT_RECOVERY_EFFECT_DRIFT`，Host 把异常当成可延迟恢复并放行普通供给，于是这条 Remux 永远停在 executing。

修复边界：执行幂等键在 ordinal>1 时纳入 `eventAttemptOrdinal`，第一次 Attempt 的键保持不变。Host 对 `safe_retry_before_intent` 不在 `start()` 里同步重放（避免把数小时 ISO 抽取塞进启动），就绪后由 drain 再 recover。`decideFailure` 必须接受该 recoveryDecision。executing Attempt 上已 `failed` 的 Effect 分类为 `already_failed` 并完成 Attempt，不得把整机启动打成 `EFFECT_CLASS_OR_STATE_DRIFT`。不得跳过 ISO 拓扑抽取，不得把 `.iso` 直接丢给 FFmpeg。

验收证据：ordinal 1 与旧键相同，ordinal 2 不同；`safe_retry_before_intent` 在 start 之后才 recover；该 decision 对非 pure 收成 `reconcile_required`。p4 input-provider / host / policy 回归通过。

当前处理决定：按根因修复并提交。现场 Attempt 4 已在抽 ISO clip（工作区 `.iso-clip-00000.m2ts` 在增长）。状态 `REGRESSION PASSED / LIVE EXTRACT IN PROGRESS`。

当前关闭 Canary `UAT-20260822-141950-0c27c8cf6` 定向确认（2026-08-23）：《倩女幽魂2：人间道》
的Run为`completed`；`libra.media.remux@1`只有一个Event/Attempt，Work与Event均`succeeded`，Attempt为
`completed/succeeded`且有`finished_at_ms`，没有任何非终态Remux Attempt。真实详情为当前收藏且健康。状态
`REGRESSION PASSED / CONFIRMED ON CURRENT CANARY`。UI证据：`admin-web-evidence/uat-045-remux-attempt-terminal-ondeck.png`。

## 43. UAT-046：ISO Remux 抽出 m2ts 后因 pcm_bluray 无法 copy 进 Matroska 立即失败并整盘重抽

问题分类：`MEDIA_PRODUCTION / BUSINESS_CONTRACT`

用户侧现象：`倩女幽魂2` ISO 拓扑已证明，主片 `BDMV/STREAM/00005.m2ts`（约 21.6 GiB）能抽出，但 FFmpeg 写 Matroska 头就失败，留下 293 字节 partial，然后立刻再抽一遍。现场 Attempt 3–11 连续 `LIBRA_MEDIA_FFMPEG_FAILED`。

现场证据：抽出样本头为 BDAV `04 14 … 47`。FFmpeg 识别到 Video h264、Audio dts/ac3/**pcm_bluray**、PGS。报错 `No wav codec tag found for codec pcm_bluray` / `Could not write header`。RemuxIntent 是 `copy_all_supported`，执行却 `-map 0` 全拷。

精确根因：蓝光 LPCM（`pcm_bluray`）不能作为 copy 进入 Matroska。这不是体积预算，也不是拓扑失败。

修复边界：Remux 先识别输入流，跳过 Matroska 不能 copy 的 `pcm_bluray`/`pcm_dvd`，其余视频/DTS/AC3/PGS 仍 copy。不得把 `.iso` 当流，不得把 LPCM 暗转成有损。

验收证据：探测 stderr 含 pcm_bluray 时 map 不含 `0:3`；现有 ISO/BDAV remux 回归仍通过。

当前处理决定：按 `copy_all_supported` 跳过不支持的轨。现场 Attempt 19 Remux 成功（约 20.6 GiB MKV），已进入四星转码。状态 `REGRESSION PASSED / LIVE TRANSCODE IN PROGRESS`。

当前关闭 Canary `UAT-20260822-141950-0c27c8cf6` 定向确认（2026-08-23）：《倩女幽魂2：人间道》已完成
On-deck，真实详情为`9.3 GB · MKV`、当前收藏且健康。最终MKV只读probe含HEVC、DTS、AC3和3条PGS字幕，
`pcm_bluray/pcm_dvd=0`；目标目录`IsoClipCount=0`、`PartialCount=0`。状态
`REGRESSION PASSED / CONFIRMED ON CURRENT CANARY`。UI证据：`admin-web-evidence/uat-046-iso-skip-pcm-ondeck.png`。

## 44. UAT-047：ISO 同语言编号字幕被压成一个最终名，验收报 TARGET_COLLISION

问题分类：`PLACEMENT_NAMING / RELATED_DISPOSITION`

用户侧现象：`倩女幽魂2` 四星转码已成功（约 10 GiB HEVC），停在「等待收藏架验收」。`arca.acceptance.inventory_feasibility.observe` 失败 `CLEAN_ARCA_TARGET_COLLISION`。

现场证据：源目录有 50+ 条 `…DTS.N.zh-CN.srt` 外加一条 `…DTS.zh-CN.srt`。UAT-033 在证明到 `zh-CN` 后套 `{stem}{language}{ext}`，全部变成 `倩女幽魂2：人间道 (1990).zh-CN.srt`。Collision Policy 为 `reject`，整部电影无法上架。

精确根因：语言模板在「多条已证明为同一语言同一扩展名」时没有保留源文件名中的编号区分。UAT-033 的 fail closed 针对无法区分的重复字幕；编号文件不是重复件。

修复边界：字幕模板名冲突时回退到原 basename。原名仍冲突才 fail closed。不用 hash、`(0)` 或丢掉字幕。

验收证据：三条编号/未编号 `zh-CN.srt` 最终名保持可区分原名。

当前处理决定：按根因修复。本轮 Canary 的该 Libra Run 验收已失败收口，未自动重试。已开干净 Canary `UAT-20260821-234249-d3c617add`。

干净 Canary 定向确认（2026-08-22）：`倩女幽魂2：人间道 (1990)` 已 On-deck。主文件 `倩女幽魂2：人间道 (1990).mkv` 约 10.0 GiB；编号 `.1.zh-CN.srt` … `.55.zh-CN.srt` 与未编号 `.zh-CN.srt` 保留可区分原名，无 hash 后缀；源 `.iso` 已从终态目录消失。状态 `REGRESSION PASSED / CONFIRMED ON CLEAN CANARY`。

## 45. UAT-048：同根终态目录里的源残留把 Off-load Settlement 打成 UNKNOWN_MEMBER

问题分类：`SAME_ROOT_INVENTORY / SETTLEMENT_SCOPE`

用户侧现象：BDMV `养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1` 四星转码已成功（约 8.32 GiB HEVC，低于 14 GiB），页面停在「正在完成收藏架上架」。stderr 反复 `CLEAN_ARCA_SETTLEMENT_UNKNOWN_MEMBER`。

现场证据：产品已写到 `F:\canary\养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1\`（主文件约 8.32 GiB）。源仍在 `F:\canary\养蜂人 (2024)\养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1\BDMV\STREAM\`，`00002.m2ts` 约 68.7 GiB，旁边还有 `00000.m2ts`…`00061.m2ts`。Off-load 只收了选中的主 clip 和部分 structural。Settlement listing STREAM 把其余 clip 当成未知成员；Attempt 在 `intend` 后抛错，Effect 停在 `intended`。

精确根因：UAT-039 对源目录里的未知**文件** fail closed，这是为了 `notes.txt`。蓝光 `BDMV/STREAM` 里未入包的 `.m2ts` 是同一张盘的结构件，不是外来 junk。终态产品目录里的残留 extras 同理：目录会保留，不应挡住 nested disc 源删除。

修复边界：`sourceDirectory === targetDirectory` 时跳过 unknown 扫描。`BDMV/` 树内的未入包文件不当未知成员。`notes.txt` 仍 fail closed。UAT-048 当时不删未入包 clip，以免把盘结构件当成 junk；整盘树清理由用户确认后改到 UAT-049。

验收证据：STREAM 里 `00002.m2ts` 可结算且不再因旁路 clip fail closed；同根 `banner.jpg` 保留；`notes.txt` 不同路径仍失败。

当前处理决定：按根因修复并提交。现场 executing Settlement 经服务重启按新合同重试后，On-deck Run `4d843ef9…` 已 committed。状态 `REGRESSION PASSED / CONFIRMED ON CLEAN CANARY`。未入包 clip 残留由 UAT-049 处理。

## 46. UAT-049：盘整理完后原 BDMV 整棵树仍留在收藏目录

问题分类：`DISC_UNIT / SETTLEMENT_LEFTOVER`

用户侧现象：BDMV `养蜂人` 已 On-deck，成品在收藏根目录的版本文件夹里，但原盘 `BDMV`/`CERTIFICATE` 仍嵌在 MKV `养蜂人 (2024)` 目录下。

现场证据：产品 `F:\canary\养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1\养蜂人 (2024).mkv` 约 8.32 GiB。源残留在 `F:\canary\养蜂人 (2024)\养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1\`，`00002.m2ts` 已删，其余 STREAM clip 与 CERTIFICATE 仍在。兄弟成品 `养蜂人 (2024).mkv` 也在同一标题目录。

精确根因：Off-load 只收选中主 clip 和部分 structural。UAT-048 把 `BDMV`/`CERTIFICATE` 未入包文件从 unknown 扫描排除，因此结算能过，但也不会删这些盘结构件。空目录修剪只到当前文件的父目录，整棵盘树留在收藏目录。

用户确认的业务规则：这部盘整理完后，原 BDMV 整棵树都要从收藏目录消失。

修复边界：结算已批准的蓝光源之后，删除该盘单元 `BDMV/` 与 `CERTIFICATE/` 下仍未入包、也不是终态产品的文件，再修剪空目录；空的嵌套版本目录可删。仍不得删兄弟电影、终态产品目录、`notes.txt` 这类目录级未知文件。同根产品目录里的非盘 extras（如 `banner.jpg`）仍保留。

验收证据：选中 STREAM 结算后 extra clip 与 CERTIFICATE 消失，盘根目录在变空后删除；仍受管的 structural 保留；嵌套盘文件夹删除且兄弟 MKV 仍在；同根终态目录保留产品、去掉 BDMV/CERTIFICATE；`notes.txt` 仍 fail closed。Inventory port 15/15 通过。

当前处理决定：按用户确认的盘单元规则修复并提交。已 committed 的 On-deck 不会自动再跑 Settlement；本轮 Canary 现场残留需在代码修复后单独清理，不能当作以后盘的合同。

## 47. UAT-050：媒体整理工作区当前媒体缺少可操作筛选

问题分类：`USER_EXPERIENCE / PROJECTION_FRESHNESS`

用户侧现象：媒体整理工作区顶部有待整理 / 整理中 / 需要处理 / 已完成整理四个数字，但点不了；「当前媒体」是一页混表。用户无法按状态、目标收藏架、是否需要自己处理、是否加急或片名缩小范围。

现场证据：`FormationPage.tsx` 当前表无筛选控件。`createFormationQuery.list` 只接受 `active | completed | ended`，active 默认 25 条分页。`libra_formation_projections` 已按 `classification` 分桶，但没有 `shelfId` / `needsUserAction` / `expedited` / 片名 query。前端若只筛当前页会漏数据。

初步诊断：展示缺口，不是业务分类错误。四桶 Classification 已存在；缺的是同一 Projection 上的有界过滤。

业务影响：媒体一多，需要处理的行和加急行被埋在混表里，用户无法当工作台用。

修复边界：

- 筛选同一张当前工作表，不新开一级页面；已完成整理仍在下方折叠区；
- 一级芯片与顶部四桶同一套分类：全部当前 / 待整理 / 整理中 / 需要处理；
- 二级：目标收藏架（含尚未选定）、需要我处理、已加急、片名搜索；评分和整理动作类型先不做；
- 过滤必须走 Formation 公开 Query，切筛选重置游标；禁止前端对当前 25 条本地 filter；
- 不改 Subject / Run / Handoff 合同。

验收证据：有界样本下按状态、架、需要处理、加急、片名分别过滤，计数与四桶一致，分页无重复无漏行；窄屏与键盘可用。

当前处理决定：2026-08-22 用户确认该方向。2026-08-22 代码已实现。当前媒体一级芯片全部当前 / 待整理 / 整理中 / 需要处理与四桶 Classification 同一套计数；二级按目标收藏架（含尚未选定）、需要我处理、已加急、片名走 `GET /v1/admin/formation` Query。切筛选重置游标，在 Projection 上过滤，不在前端筛当前 25 条。已完成整理仍在下方折叠区。本条不宣称 Canary 或生产通过。

证据：

- `media-service/src/helix/domains/libra/application/formation-query.js`
- `media-service/src/helix/domains/libra/persistence/formation-projection-store.js`
- `media-service/web/src/helix/FormationPage.tsx`
- `media-service/web/src/helix/api.ts`
- `media-service/test/helix-formation-projection.test.js`
- `media-service/web/test/helix-copy.test.tsx`
- Admin Web production build `npm run build:web` PASS

## 48. UAT-051：整理动作是概括句，不能展示分步施工、分步进度、用户操作与加急

问题分类：`USER_EXPERIENCE / PROJECTION_FRESHNESS`

用户侧现象：整理动作列只有一句「视频转码 / 封装整理 / 资料补齐 / 尚未形成整理动作」。下一步列把当前一步标签、一条进度条、选架、确认身份、重试、放弃、加快塞在一格。用户看不到要 Remux、怎么转码、要不要补海报；完成区也说不清这部实际做了哪些事。重叠 `UX-009`、`UX-010`。

现场证据：`formation-query.js` 的 `actionLabel(works)` 按 capability 取第一条命中；`nextAction` 只投影当前开放 Work 的一句标签加一条 `progress`。当前表列：媒体名称、当前状态、我的评分、目标收藏架、整理要求、整理动作、下一步。完成表复用 `organizingAction` 字符串。Encode / Remux Intent（CPU/GPU、目标编码、清晰度、体积）未进入 Formation 公开 Projection。

初步诊断：UAT-005 已要求「整理动作 = 整套施工方案，下一步 = 当前一步」。用户 2026-08-22 进一步要求步骤清单、每步进度条、用户操作列、加急列拆开；完成区只读同一套动作清单。这是公开 Projection 形状扩展，不是 Planner/Capability 边界变更。

业务影响：用户无法感知系统在做什么、卡在哪一步、要不要自己动手；完成历史像没整理过。

修复边界：

- 当前表固定四列职责：整理动作（有序用户步骤）、进度（每步一条进度条）、用户操作（只放需要人点的入口）、加急（加快 / 已加急 / 取消加快）；
- 步骤词表闭集，禁止 capability 名。建议：确认影片身份、补齐资料、补海报和 NFO、外部寻源（仅缺口存在时）、封装整理、视频转码（须写出 CPU/GPU、目标编码、清晰度档、体积上限）、验证整理结果、上架到收藏架；
- 尚未形成计划时写「正在评估整理方案」，不提前猜 Remux 或转码；
- 有真实字节/时长 Evidence 才用确定百分比；TMDB/等资源用不确定条；受阻/冻结停住并指向用户操作列；
- 完成区只读：实际执行过的步骤、进了哪座架、完成时间；不要「下一步」和进行中按钮；
- 步骤在单元格内纵向堆叠，避免再增加列数撑爆（`UX-016`）；
- 扩展 `libra_formation_projections` 的公开展示字段（`organizingAction: string` → `organizingSteps[]`）；完成态读已完成 Run 历史 Work，不读当前空 Run；
- 不改 Planner、Capability、Work Owner；页面不直接读 Event。

验收证据：Remux、GPU/CPU 转码、补海报、外部寻源、直接采用、完成态各一类样本的步骤清单与后端正式事实一致；进行中每步进度与 Event Progress 一致且不伪造百分比；操作列与加急列互不混放。

当前处理决定：2026-08-22 用户确认该列结构。2026-08-22 代码已实现。Formation 公开 Projection 将 `organizing_action` TEXT 存为 `organizingSteps[]` JSON（不改 P2 表合同）：闭集用户步骤含确认影片身份、补齐资料、补海报和 NFO、外部寻源、封装整理、CPU/GPU转码（编码/清晰度/体积）、验证整理结果、上架到收藏架；空计划写「正在评估整理方案」。完成态读已完成 Run 历史 Work。当前表列为整理动作 / 分步进度 / 用户操作 / 加急，步骤在单元格内堆叠；完成区只读同一套动作，无「下一步」和进行中按钮。UAT-005 剩余动作合同并入本项后关闭。本条不宣称 Canary 或生产通过。

证据：

- `media-service/src/helix/domains/libra/application/formation-query.js`
- `media-service/web/src/helix/FormationPage.tsx`
- `media-service/web/src/helix/api.ts`
- `media-service/web/src/helix/helix.css`
- `media-service/test/helix-formation-projection.test.js`
- `media-service/test/admin-web-contract.test.js`
- `media-service/web/test/helix-copy.test.tsx`
- Admin Web production build `npm run build:web` PASS

## 49. UAT-052：我的收藏一级导航不是按架，详情缺少占用空间等技术指标

问题分类：`USER_EXPERIENCE / PROJECTION_FRESHNESS`

用户侧现象：我的收藏一级是「当前收藏 / 历史」，海报墙把所有架混在一起，只在副标题写架名。详情有剧情、演职员、健康，没有当前占用空间等用户关心的技术指标。

现场证据：`CollectionPage.tsx` 筛选为 current/history + 健康状态。`collection-query.js` 已读 `arca_inventory_materials.size_bytes`，仅用于判断是否有海报，不求和、不对外。`CollectionEntry` 无占用空间、容器、编码、清晰度字段。列表为 `select-all`，无 `shelfId` 过滤。重叠 `UX-006`、`UX-026`。

初步诊断：Shelf 与 Inventory 字节已是 Arca 事实。缺的是 Collection 公开 Query 的按架过滤和详情翻译，不是新业务对象。

业务影响：多架时用户不能按收藏目录浏览；点开详情看不到这部占多少空间、主视频是什么规格。

修复边界：

- 一级导航按收藏架，保留「全部」为默认；二级才是当前 / 历史，健康筛选仅用于当前；
- 历史跟随当前所选架，不另做全局历史墙；注销中的架不进当前墙；
- 收藏一多必须后端按 `shelfId` 过滤，不能把整库拉到前端再筛；可与 `UX-026` 海报墙性能一并处理；
- 详情第一批只展示 Inventory 已有事实：当前占用空间（主视频 + 海报/NFO/字幕等成员合计，格式如 `12.4 GB`）、主视频体积与容器、视频规格（有则显示，如 `HEVC · 2160p`）、海报/NFO 是否齐全；
- 口径是当前正式收藏占用，不是源目录或 Workspace 中间文件；
- 片长、音轨、HDR 等第二批只有 Inventory 已有稳定事实才加，前端不得为填格子去 probe 磁盘；
- Collection 继续只读 Arca；不回读 Libra Run，不把整理步骤搬进收藏详情。

验收证据：多架样本下按架切换墙与计数正确；详情占用空间与 Inventory 成员字节合计一致；无海报/无规格时不编造。

当前处理决定：2026-08-22 用户确认一级按架，并保留「全部」；详情第一批即上列四项。2026-08-22 代码已实现。一级芯片为全部 + 活动收藏架；二级当前/历史跟随所选架；健康筛选仅当前且走 Query。详情只读 Inventory：占用空间合计、主视频体积/容器、编码与清晰度（有则显示）、海报/NFO。不 probe 磁盘、不回读 Libra。本条不宣称 Canary 或生产通过。

证据：

- `media-service/src/helix/domains/arca/application/collection-query.js`
- `media-service/web/src/helix/CollectionPage.tsx`
- `media-service/web/src/helix/api.ts`
- `media-service/test/helix-collection-query.test.js`
- `media-service/web/test/collection.test.tsx`
- Admin Web production build `npm run build:web` PASS

## 50. UAT-053：活动文件来源未按 SSOT 周期观察，扫描完成后页面禁止再扫

问题分类：`DOMAIN_ORCHESTRATION / USER_EXPERIENCE`

用户侧现象：文件来源把整座目录的状态写成最近一部 Candidate 的 Handoff（「已交给整理」），按钮随之置灰。绿框不是扫描进度。用户不知道扫描是否在走、新文件会不会被看见。

现场证据：

- SSOT §6.3.2：Field Observation 可由 Field 注册、周期到期、用户显式观察、启动恢复或可靠 Field 变更 Hint 触发。
- SSOT §6.9.1：Material Field 已注册且 Access 有效时，周期 / 启动恢复自动执行；允许用户显式观察。
- SSOT §10.3.3：活动 Field 启动后 2 分钟内首次 cursor sweep，随后每 30 分钟轻量变化观察；只有新增或变化成员进入 Triage Evidence。每一轮仍用同一套目录对账。
- §3.2.4「该数据模型能力不授予目录扫描、文件系统 Journal 或 rename 监听」约束的是 Physical Material Identity / Binding Health 公式本身，不禁止 Field Management 周期 Observation，也不等于「新文件可以不发现」。
- 代码：`field_observation` Work 只在 `field-observation-admin-service.js` 由 Admin `POST .../actions/observe` 签发。`fallbackReconciler` 的 Procurement 项只有 `active-procurement-runs`。登记 Field 不启动观察。无 2 分钟 / 30 分钟 Field Observation sweep。`procurementAutomation.reconcileFromObservation` 只消费已 terminal 的 Observation，自己不看目录。
- 对照：同文件 Aftercare `due-aftercare-shelf-entries`（Custody 24h）和 Off-deck 日/周 sweep 已接线。
- 前端：`MaterialFieldsPage.tsx` 在 `handoff_a_ready` / `handoff_a_accepted` 时 `disabled` 扫描按钮；`field-procurement-status-query.js` 用来源内最近一部 Candidate 的 delivery 代表整座 Field。

初步诊断：Observation 分页、增量 Eligibility、扫完后自动开 Run 已落地。缺的是 Procurement Owner 周期签发下一轮 Observation，外加页面把唯一显式入口关掉。这是实现落后于已关闭 SSOT，不是开放产品选择题，也不是要做 inotify/Journal。

业务影响：下载目录或共享盘新进的电影，系统不会自己看见。按钮灰掉后用户也无法再扫。整理工作区、收藏墙、概览会表现为「库停在第一次扫描」。Canary 路径是「登记 → 立刻点扫描」，不易自然暴露。

修复边界：

- 补上 Field Observation Owner 自动化：活动来源启动后 2 分钟内首扫，之后每 30 分钟轻量变化观察；启动恢复发现未收口的 Observation Work；用户「扫描新文件」始终可点，仅 Observation Work 进行中禁用；
- 来源页只管扫没扫完：等待扫描 / 正在扫描 / 已扫描完成；绿框展示扫描进度（页数或已查看文件数），不要写成「已交给整理」；整理进度只去媒体整理工作区；
- 不引入文件系统 Journal、rename watch 或未知路径全盘搜索；可靠 Field 变更 Hint 仍是可选加速，不是发现新文件的前提；
- 不把最近一部 Candidate 的 Handoff 当成整座来源的扫描状态；
- 不改 Handoff A/B、不改 Identity 公式、不让 Aftercare 承担 Field 扫描。

验收证据：活动来源在无人工点击时于启动窗口和 30 分钟窗口产生新的 Observation revision；目录新增独立电影后进入整理工作区；进行中按钮禁用、完成后「扫描新文件」可点；绿框进度与 Observation page chain 一致；外部 rename 不承诺自动修 Binding。

当前处理决定：2026-08-22 用户确认这是重大实现缺口；2026-08-22 代码已实现。`fallbackReconciler` 新增 `active-material-fields`：启动后立即对活动 Movie Field 做首次 Observation sweep（满足启动 2 分钟内首轮），整页完成后 30 分钟再扫；从未观察过的活动来源可在 30 分钟门闩内进入首轮。进行中或未完成的 Observation Work 不重开。来源页三态为等待扫描 / 正在扫描 / 已扫描完成，绿框只展示扫描页进度，「扫描新文件」仅 Observation 进行中禁用，不再用最近一部 Candidate 的 Handoff 代表整座来源。GET 列表无副作用。本条不宣称 Canary 或生产通过。

证据：

- `media-service/src/helix/domains/procurement/application/field-observation-automation.js`
- `media-service/src/helix/composition/create-procurement-execution-runtime.js`
- `media-service/src/helix/domains/procurement/application/field-procurement-status-query.js`
- `media-service/web/src/helix/MaterialFieldsPage.tsx`
- `media-service/test/helix-architecture/p7-field-observation-automation.test.js`
- `media-service/test/helix-architecture/p7-field-procurement-status-query.test.js`
- `media-service/test/admin-web-contract.test.js`
- Admin Web production build `npm run build:web` PASS

## 51. UAT-054：退出收藏主链已通，页面仍是内部安全链控制台

问题分类：`USER_EXPERIENCE`

用户侧现象：退出收藏页四截硬拼（规则、建议、审阅、进度），按钮像内部控制台：进入审阅、确认范围、授权并开始退出。用户看不懂每个按钮做什么，也不知道默认关闭自动建议时为什么没有待审阅。重叠 `UX-007`、`UX-015`、`UX-025`。

现场证据：`OffdeckPage.tsx` 主表面仍可能露出 `review.state`、Case、AST/无法表达的规则 JSON。规则四类草稿按钮只往表单加行，不评估；真正评估是「立即评估」「检测重复收藏」。默认 Policy `disabled`、规则为空、定期查重复关闭。后端 `offdeck-admin-application.js` 与 Foundation 销毁链已接通；「我的收藏」直接退出走同一 `direct_intent` 审阅。High-volume 二次确认、授权前可取消、授权后不可反悔均已实现。

初步诊断：这是产品信息架构缺口，不是销毁合同缺失。SSOT §6.7 的发现/授权/Case 分层已经落地。

业务影响：用户不敢点或点错阶段名；能退出，但不像「审阅清楚再删」。

修复边界：

- 按任务重排为：规则（少见、可折叠）→ 建议列表（片名、原因、体积）→ 当前这一单审阅（文件清单 + 体积 + 明确下一步）→ 正在退出的片子；
- 主按钮只用用户任务语言，例如启用自动建议、保存规则、现在检查一次、查重复、审阅这部、先留着、核对将删除的文件、再次确认大批量、授权删除、取消这次审阅；内部阶段名可降为按钮下小字；
- 主表面只用片名、评分、体积、将删文件数；`review.state`、Case ID、AST、原始 JSON 进折叠；
- 「不喜欢的人物」规则在人物偏好产品入口可用前不作为可添加规则；Policy 合同可保留；
- 不改默认自动建议关闭、unknown 不出建议、授权前可取消、授权后不可用取消审阅反悔、大批量二次确认、共享主文件拒绝删、附属留到最后引用、直接退出与建议退出共用一条链。

验收证据：无规则时页面说明「不会自动建议，可从我的收藏直接退出或先保存规则再检查」；有建议时主路径能用片名走完审阅→授权；授权前取消零文件副作用；技术标识不出现在主表面。

当前处理决定：2026-08-22 用户确认只做任务化界面，不重做销毁主链。2026-08-22 代码已实现。页面按规则（可折叠）→ 建议（片名/原因/体积）→ 当前审阅 → 正在退出重排；按钮改为审阅这部、先留着、核对将删除的文件、再次确认大批量、授权删除、取消这次审阅。人物偏好不作为可添加规则。未改销毁合同、默认 Policy 关闭、授权前可取消、授权后不可反悔。本条不宣称 Canary 或生产通过。

证据：

- `media-service/web/src/helix/OffdeckPage.tsx`
- `media-service/web/src/helix/helix.css`
- `media-service/test/admin-web-contract.test.js`
- `media-service/web/test/overview.test.tsx`
- Admin Web production build `npm run build:web` PASS

## 52. UAT-055：人物名录未接通 Beta 两条登记路径，页面只读且为空

问题分类：`DOMAIN_ORCHESTRATION / USER_EXPERIENCE`

用户侧现象：人物名录已登记/待确认均为 0。收藏详情却可能列出演职员。用户不知道名录是干什么的，也不知道为什么空。重叠 `UAT-007`（已修演示数字，仍只读）、`UX-011`。

现场证据：

- SSOT §5.9.4 / §6.8.3：Beta 只有用户直接注册，以及系统从 On-deck NFO 经 `OnDeckPersonEvidenceProjection` 每日补偿扫描形成 Candidate；强身份可自动接受，弱身份必须用户接受或忽略。People 不得写 Media-Cast，也不得读 Arca Store 或物理 NFO。
- 代码：People Store、只读 Admin Query、Capability 合同和直接注册 Domain 命令模块存在；`create-procurement-execution-runtime.js` 未启用 People；`people/planning/` 无产品 Planner；Arca 无 `OnDeckPersonEvidenceProjection` 实现；People Admin Facade 只有 GET；页面明确不能注册/合并。
- 收藏详情 `people` 来自 `arca_inventory_person_relations`，允许 `personId=null`，不是 Person Registry。

初步诊断：名录空是因为 Registry 里没有 Person，不是 Query 失败。与 UAT-053 同类：合同写了 Owner 自动化，Composition Root 没挂上；另外缺写命令入口。

业务影响：一级导航页没有产品意义；「待确认登记/合并」计数无法操作；后续 Off-deck「不喜欢的人物」也没有偏好主体。

修复边界：

- 把 People 挂进 Composition Root（Planner、Capability、fallback reconciler）；People Candidate 每日补偿扫描每页最多 100 项，见 SSOT §10.3.3；
- Arca 发布 On-deck 人物证据投影，People 只消费该投影；禁止打开物理 NFO、禁止改 Media-Cast；
- 页面改为小工作台：已登记人物、待确认登记/合并（接受或忽略）、登记一个人（姓名、可选别名/外部编号，参考图不是前置条件）；
- 文案：名录是已登记的人，不是某部电影的演员表；演员表留在收藏详情；
- 不实现联网搜演员图、人脸聚类主路径、人物页改演职员、用人物偏好做上架规则；不把 Inventory 显示名批量写成 Person。

验收证据：用户直接登记后名录出现该人且 Media-Cast 不变；上架带稳定 Provider Person Identity 的 NFO 后，周期扫描形成 Person 或 open Candidate；弱身份只出待确认；People 零 Arca Store / 物理 NFO 读取。

当前处理决定：2026-08-22 用户确认补齐 Beta 两条登记路径。2026-08-22 代码已实现。Arca 发布只读 `OnDeckPersonEvidenceProjection`；People 每日补偿扫描该投影（fallback `ondeck-person-evidence`），不读物理 NFO、不写 Media-Cast。强身份自动接受，弱身份形成待确认 Candidate。页面提供已登记 / 待确认（接受或忽略）/ 登记一个人。八项 People Capability 的 Event Runtime 主路径未在本轮展开为独立 Planner；发现与登记走 People Owner 自动化与既有 Store 事务。本条不宣称 Canary 或生产通过。

证据：

- `media-service/src/helix/domains/arca/application/on-deck-person-evidence-projection.js`
- `media-service/src/helix/domains/people/application/people-process-services.js`
- `media-service/web/src/helix/PeoplePage.tsx`
- `media-service/test/helix-architecture/p6-people-ondeck-registration.test.js`
- `media-service/test/admin-web-contract.test.js`
- Admin Web production build `npm run build:web` PASS

## 53. UAT-056：豆瓣评分缺少 SSOT 周期同步，同步与日志刷新职责混在一起

问题分类：`DOMAIN_ORCHESTRATION / USER_EXPERIENCE`

用户侧现象：设置页「同步」与评分日志「刷新」都像在更新豆瓣。点刷新日志并不去豆瓣；点过一次同步后，系统不会按 SSOT 周期再拉收藏。重叠 `UX-008`、`UX-028`。

现场证据：

- SSOT §6.8.2：外部同步使用 `perception.source.acquire@1` 分页 Observation，走 Foundation；GET 不得触发 Acquisition/Resolution 提交。Provider Acquisition terminal 后按锚加速 Resolution；30 秒 fallback 扫活动评分目标；digest 不变 no-op。
- SSOT §10.3.3：Perception Integration 低频周期，Beta 下限 6 小时、推荐初始 24 小时，不是可随意调小的普通设置。
- 代码：`SettingsPage`「同步」→ `POST /v1/admin/perception/actions/sync` → `requestAcquisition` → Foundation `acquisition_page`（acquire / normalize / commit）。评分日志「刷新」→ `GET .../perception/records`，只读。执行运行时有 `active-acquisitions`（把已开始的页跑完）和 `active-subject-rating-resolutions`（30 秒 Resolution），**没有** 6h/24h 再开豆瓣 Acquisition。前端每次同步用新的时间戳 idempotencyKey，故每次点击是新 Acquisition；Record 仍以来源 digest 幂等。

初步诊断：人工同步链正确且走 Foundation。日志刷新不走 Foundation 也正确。缺的是周期 Acquisition，以及界面把两个动作混成「刷新」。不要绑进 UAT-001 匹配率。

业务影响：豆瓣收藏变化后，评分来源停在上一次人工同步；用户以为刷新日志等于更新豆瓣。

修复边界：

- 活动豆瓣连接按 SSOT 做启动恢复与周期 Acquisition，推荐初始 24 小时、下限 6 小时；用户「同步」仍立即开一轮；
- 界面拆开：同步 = 去豆瓣拉收藏，显示 Acquisition 页进度（已有 `listAcquisitions` / `sync-state`）；刷新日志 = 只重读已落库 Record；
- Resolution 保持：同步结束后撞相交目标、30 秒 fallback、digest 不变 no-op、直接评分另走 Foundation；
- GET 评分日志不得触发同步或 Resolution 提交；不得覆盖历史 Record；不放宽模糊匹配；不把豆瓣优先级抬到 Handoff 前面。

验收证据：配置有效时无人工点击也可在 24 小时窗口内产生新 Acquisition；同步中设置页能看到页进度；刷新日志网络只有 GET records；重复同步不制造语义重复 Record。

当前处理决定：2026-08-22 用户确认补周期同步并拆开同步/日志刷新。2026-08-22 代码已实现。活动豆瓣连接经 `fallbackReconciler` `periodic-douban-acquisitions` 启动后可开一轮 Acquisition，之后 24 小时再开（下限 6 小时，不是普通设置）。用户「同步」仍立即开一轮并显示进行中进度。「刷新日志」只 GET records，不触发 Foundation。Resolution 仍由既有 30 秒 fallback 与 digest no-op 承担。本条不宣称 Canary 或生产通过。

证据：

- `media-service/src/helix/domains/perception/application/perception-acquisition-automation.js`
- `media-service/src/helix/composition/create-procurement-execution-runtime.js`
- `media-service/web/src/helix/SettingsPage.tsx`
- `media-service/test/helix-architecture/p6-perception-acquisition-automation.test.js`
- `media-service/test/admin-web-contract.test.js`
- Admin Web production build `npm run build:web` PASS

## 54. UAT-057：概览只重复旁页计数，缺少系统状态、可点待办与最近完成；不得与我的收藏合并

问题分类：`USER_EXPERIENCE / PROJECTION_FRESHNESS`

用户侧现象：概览简略，数字与「我的收藏」、整理工作区、文件来源重复；没有系统是否正常、没有可点的待办、没有带片名的最近完成。用户提出是否与「我的收藏」合并。重叠 `UX-001`、`UX-029`、`UX-013`。

现场证据：

- SSOT §9.2 旅程 I（系统与成果概览）与旅程 C（浏览正式收藏）分离。§9.4.2 概览只回答系统三态和已创造的收藏价值，含需要处理入口（链到未分拣/Frozen/授权/人物/配置）和最近完成的上架/修复/退出。§9.4.5 我的收藏是有效 Shelf Entry 的权威检索入口（海报墙）。§9.9.1：每个页面一个主要工作，概览证明价值，收藏证明 Own。Beta 八个一级入口含概览与我的收藏；UI Surface 为 8 pages + 9 journeys。
- `OverviewPage.tsx` 只有四指标 + 四条总量账本 + 页脚来源/架数。`overview-query.js` 请求内拼 Field / Shelf / Formation / Collection / Offdeck；「正式收藏」与账本「已经上架」同为 active Entry 计数；「需要处理」只加健康 attention 与退出 Candidate，不含整理工作区 `attention_required`。无系统三态、无空间节省、无本月完成修复、无带片名履历、无深链。

初步诊断：概览没做自己的工作，只抄了旁页计数，所以显得又薄又该合并。缺的是首页合同内容，不是少一面收藏墙。

业务影响：打开管理台既看不了库，也办不了事；合并会压矮海报墙（UAT-052 还要按架），并让整理/退出/人物待办从首页消失。

修复边界：

- **否决与「我的收藏」合并**；保留八个一级入口；`/` 仍是概览；
- 系统三态：尚未配置 / 正常运行 / 系统故障；尚未配置链到来源或收藏架；故障才用危险态；不把「需要处理」当成系统坏了；侧栏状态与此同一套（`UX-013`）；
- 「需要你处理」做成可点分类待办，链到整理工作区、收藏健康筛选、退出收藏、人物名录（UAT-055 后）、设置；无事项则明确空态；合计须包含整理 `attention_required`，不能只加健康+退出；
- 成果只留不重复项：正式收藏、本月新上架、健康；有事实再显示本月完成修复、累计节省空间。「正在整理」最多一条且点进工作区。删除已经上架、已检查健康、已发现的电影、页脚来源/架数；
- 「最近进展」改为带片名的短账（上架、修复、正在做的关键动作），不是库存总量；无履历则空态；
- 不做完整海报墙；最多「本月新上架」少量可点缩略图，点进收藏详情；
- Overview 保持跨域只读聚合、无写权；改进时应避免每次 GET 整表五路扫描（`UX-029`），GET 无副作用。

验收证据：概览与收藏墙仍是两个入口；待办可分别跳到整理/收藏/退出；正式收藏与已经上架不再并排；无事项与尚未配置有明确空态；主表面无 Event/Retry/队列。

当前处理决定：2026-08-22 用户确认保留两页，概览改为状态 + 待办 + 最近几件事。2026-08-22 代码已实现。概览与我的收藏仍是两个入口。系统三态尚未配置 / 正常运行 / 系统故障；待办含整理 attention_required 并可点到对应页；成果只留正式收藏 / 本月新上架 / 健康；最近进展改为带片名短账。Collection 概览统计不再五路整表 map。侧栏接同一 systemState。本条不宣称 Canary 或生产通过。

证据：

- `media-service/src/helix/projections/overview-query.js`
- `media-service/src/helix/domains/arca/application/collection-query.js`
- `media-service/web/src/helix/OverviewPage.tsx`
- `media-service/web/src/App.tsx`
- `media-service/test/helix-overview-query.test.js`
- `media-service/web/test/overview.test.tsx`
- Admin Web production build `npm run build:web` PASS

## 55. UAT-058：侧栏把文件来源与收藏架放在日常运营之前；应下移与系统设置一组并改名为配置

问题分类：`USER_EXPERIENCE`

用户侧现象：左边导航把「文件来源」「收藏架」放在概览之后、我的收藏之前。日常要用的是收藏墙和整理工作区，来源和架是一次性配置。用户要求下移，与「系统设置」形成一组；Tab 名称改为「文件来源配置」「收藏架配置」。重叠 `UX-002`、`UX-003`。

现场证据：`surface-model.ts` 的 `pages` 顺序即 `App.tsx` 侧栏顺序：概览、文件来源、收藏架、我的收藏、媒体整理工作区、退出收藏、人物、系统设置。路由仍为 `/material-fields`、`/shelves`。SSOT §9.4.1 列出同一八个一级入口，并允许按「收藏基础 / 日常运营 / 知识 / 系统」视觉分组、不增加中间路由层。§9.3.3 用户语言仍是「文件来源」「收藏架」。

初步诊断：八个入口保留。问题是日常运营和配置混排，以及配置页在导航上不像设置。

业务影响：新用户或回访都先经过配置项才能到收藏和整理。

修复边界：

- 侧栏顺序改为：概览、我的收藏、媒体整理工作区、退出收藏、人物；其下为配置组：文件来源配置、收藏架配置、系统设置；
- 配置组用视觉分隔（例如细线或小组标题「配置」），不新增路由层、不减少一级入口；
- 导航与页内标题使用「文件来源配置」「收藏架配置」；Canonical 仍是 Material Field / Shelf，路径不改；
- 不把来源/架并进系统设置页，不取消独立页面；
- 实现进入 Design 时再把 §9.4.1 导航顺序与用户别名写回 SSOT；本条不直接改 SSOT。

验收证据：侧栏上半是运营、下半是配置三页；名称与分组在桌面/窄侧栏都成立；深链 `/material-fields`、`/shelves` 仍进入原页。

当前处理决定：2026-08-22 用户确认该导航顺序与 Tab 名。2026-08-22 代码已实现。侧栏上半为概览 / 我的收藏 / 媒体整理工作区 / 退出收藏 / 人物，下半配置组为文件来源配置 / 收藏架配置 / 系统设置。路径不改，入口不减，不并进设置页。已回写 SSOT §9.4.1 导航顺序与 §9.3.3 用户别名，未改 Owner/Handoff。本条不宣称 Canary 或生产通过。

证据：

- `media-service/web/src/helix/surface-model.ts`
- `media-service/web/src/App.tsx`
- `media-service/web/src/helix/MaterialFieldsPage.tsx`
- `media-service/web/src/helix/ShelvesPage.tsx`
- `docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md` §9.4.1 / §9.3.3
- `media-service/web/test/navigation.test.tsx`
- Admin Web production build `npm run build:web` PASS

## 56. UAT-059：四星转码把 14 GiB 上限当成目标码率，把已较小的 H.264 源灌大

问题分类：`BUSINESS_CONTRACT / MEDIA_PRODUCTION`

用户侧现象：干净 Canary `UAT-20260822-194617-1ed64ca36` 中，23 部里只有 `锡尔弗顿之围 (2022)` 触发了 `libra.media.transcode@1`。四星合同是 HEVC、不超过 14 GiB。源已是 1080p stream file，体积约 1.94 GiB，转完变成约 9.35 GiB 仍低于上限。页面步骤写成「CPU转码 · HEVC · 不超过 14 GiB」，实际走的是本机 NVIDIA NVENC。

现场证据：隔离库
`C:\Users\markm\AppData\Local\Temp\ShelfDeck-Movie-Canary-UAT-20260822-194617-1ed64ca36`。
Formation 该行 `my_rating=4`、`my_rating_source=douban`，整理要求 `HEVC · 不超过 14 GiB · 补齐 nfo、poster`。源 Probe：H.264、Matroska、`sizeBytes=2077884000`、`durationMs=6062624`（约 101 分钟）、两条 `eac3`（`normalizedAudioClass=other`）。EncodeIntent：`deviceClass=nvidia_nvenc`、`rateControlMode=target_size`、`targetVideoBitrateBps=14703421`、`audio.mode=copy`、`streamIndexes=[1,2]`、`preserveRaster=true`、`forbidUpscale=true`、`pipelineProfileId=ordinary_to_hevc@1`。成品 Probe 与 `F:\canary\锡尔弗顿之围 (2022)\锡尔弗顿之围 (2022).mkv` 均为 HEVC、`sizeBytes=10032914711`（约 9.35 GiB）。体积放大约 4.8 倍。同轮另两部只 Remux、未转码：ISO `倩女幽魂2：人间道`、BDMV `养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1`。

精确根因：`deriveTargetSizeBudget` 用 `maxSizeBytes` 减去容器预留和音轨估算后，把剩余字节直接当成视频目标码率。NVENC 在有体积上限时优先 `target_size`，于是四星 14 GiB 变成约 14.7 Mbps 的灌满目标，而不是「不要超过」。源 1.94 GiB H.264 并非已经合规（缺 HEVC），所以转码触发本身正确；错的是施工码率按上限填满。SSOT §7.3.5：`maxSizeGB` 是最终空间上限，不是目标码率；Planner 可以按时长、分辨率、当前质量 Evidence、编码效率和计算成本推导内部码率，不得把估算参数写回 Shelf Standard；已经合规的产品不得为了贴近上限再次转码。相关展示偏差：`formation-query.js` 的 `transcodeLabel` 从 `deviceSnapshot` 猜 CPU/GPU，真实 Result 在 `executionDeviceRef`（`local-nvidia-nvenc-0`），因此完成态误标 CPU。

业务影响：四星 1080p 源会被无必要放大数倍，浪费收藏空间和转码时间；体积上限验收仍可通过，用户看到的是「整理后更大」。库规模上去后同一规划会系统性灌满 1–5 星各档上限。CPU/GPU 标签与真实设备不一致，UAT-051 要求的转码步骤说明不可信。

修复边界：

- 触发条件保持不变：四星 H.264 仍须转 HEVC；禁止 Direct 交差；
- `maxSizeBytes` 只作拒绝线和预算可行性下限（视频码率 ≥ 100 kbps），不得作为 `target_size` 的填满目标；
- 码率/质量须由时长、分辨率、源码率/体积和质量 Evidence 推导，目标成品不得无理由大于源；NVENC 在源已小于上限时应改质量约束或封顶到源量级，而不是打满档位 GiB；
- 不抬 14 GiB，不做音频转码，不改五星 4K/白名单，不把无评分片子强制转码；
- Formation 转码步骤的 CPU/GPU 必须读 EncodeIntent / `executionDeviceRef` 的真实 `deviceClass`，不得因缺 `deviceSnapshot` 默认 CPU；
- 本条不改 Owner、Handoff 或 Capability 边界。已 On-deck 的 `锡尔弗顿之围` 成品不可变；修复后须新 Canary 或新 Libra Run 验证。

验收证据：同型 4 星 1080p H.264、源约 2 GiB、上限 14 GiB 的样本，转码后为 HEVC、音轨 copy、体积明显低于 14 GiB 且不得数倍大于源；EncodeIntent 的 `targetVideoBitrateBps` 或 `qualityBound` 能追溯到源质量而不是 `14 GiB - reserve`；页面步骤为 GPU 转码当且仅当设备为 NVENC/QSV/VAAPI。负例：已是 HEVC 且低于上限的 3 星片子仍 Direct。UAT-044 的多音轨预算裁剪回归不得回退。

当前处理决定：2026-08-22 代码已实现。`deriveTargetSizeBudget` 在已知源体积且源小于上限时按源量级封顶，不再把档位 GiB 当 `target_size` 填满目标；可行性仍按上限。Formation 转码步骤读 `executionDeviceRef.deviceClass`。本条不宣称 Canary 或生产通过。

2026-08-23逐项封口在重建Canary `UAT-20260823-002500-519f8d7b5`完成。同一四星样本`锡尔弗顿之围 (2022)`
原始H.264 Primary为2,077,884,000字节，HEVC最终Primary为2,090,639,953字节，仅约0.6%增长，不再成为旧现场的
10,032,914,711字节。EncodeIntent仍正确使用`nvidia_nvenc`、HEVC、音轨copy，`targetVideoBitrateBps=1,919,325`，
而非旧现场按14GiB上限推得的14,703,421。真实“我的收藏”详情显示1.9GB、当前收藏且健康；FS最终文件大小与Inventory一致。
状态`REGRESSION PASSED / CONFIRMED ON REBUILT CANARY`。UI证据：
`admin-web-evidence/uat-059-four-star-transcode-size-cap-pass.png`。

## 57. UAT-060：Product Identity 写回 Subject 触发语义相同的 Acceptance Spec 重发

问题分类：`BUSINESS_CONTRACT / DOMAIN_ORCHESTRATION`

用户侧现象：干净 Canary `UAT-20260822-194617-1ed64ca36` 中，`一场很（没）有必要的春晚 (2022)` 身份/资料/海报/视频验证均已成功，页面却停在待整理。Decision Head 已从 Acceptance Spec revision 1 切到 revision 2；Run 仍绑 Spec 1，没有 `product_package.publish`、没有 Package、没有 Handoff B。用户追问头为何会切到 Spec 2。

现场证据：隔离库
`C:\Users\markm\AppData\Local\Temp\ShelfDeck-Movie-Canary-UAT-20260822-194617-1ed64ca36`。
本轮 **23/23** 部都是同一路径：Spec 1 发布时 `subject_snapshot.currentIdentityRevision = null`；Run 内 `libra.product_identity.resolve@1` 成功后写回 `currentIdentityRevision = 1`；随后 `active-acceptance-spec-subjects` 再 reconcile，发 Spec 2。两次 Perception 评分均为 `not_found`；Routing、Shelf Standard、Product Scope 不变；两次 `specDigest` 相同（春晚均为 `5a0e2e5e…`，要求仍是「补齐 nfo、poster」）。变的是 `specInputDigest` / `recordDigest` / `decisionBasisId`。春晚符合性成功于 `…527832`，Spec 2 发布于 `…542743`（间隔约 15 秒），期间没有 publish。其余 19 部在 Spec 2 前已发出 Package（符合性后约 150–250ms）；BDMV `养蜂人` 在 Remux 期间被切头，后来仍发布成功。`看不见的朋友` / `黑客帝国动画版` 未走到符合性，卡在五星冻结后的放弃路径，不是本条。

精确根因：`specInputDigest` 哈希整份 `subjectSnapshot`，含 `currentIdentityRevision` / `currentIdentityDigest`。这两项是 Run 产出的 Product Fact，不是定评分档/HEVC/体积的 Decision Input。Coordinator 用 `specInputDigest` 判断「是否还是当前 Spec」，身份从空到已确认就被当成新输入，重发语义相同的 immutable Spec，头必须跟上。SSOT §6.4.6：语义与初始 Execution Basis 都未变时，当前 Run 继续，不改写 immutable Spec/Basis。Run Creator 因 `specDigest` 相同不替换 Run，于是出现「头是 Spec 2、Run 仍是 Spec 1」。春晚另卡在符合性已过、Package 未发的窗口；不能单靠下一次 sweep 碰运气。

业务影响：每部电影整理过程都会无意义切一次头。多数片子发布够快所以看不出来；落到「验证完、尚未 publish」窗口的片子会停在待整理，用户无法理解。库规模上去后，身份确认与 Spec reconcile 交错会系统性制造这种空切。

修复边界：

- `specInputDigest` 只纳入进 Spec 的稳定输入：Subject 结构/profile、intake revision、routing 锚、已 resolved Routing、Shelf Standard、Product Scope、Perception 评分 Resolution；**不得**纳入 `currentIdentityRevision` / `currentIdentityDigest`；
- 身份从空到 TMDB 已确认不得新开 Acceptance Spec Basis、不得发语义相同的 Spec 2、不得切头；
- 头上 Spec 的 `specDigest` 与 Run 冻结 Spec 相同时，freshness 必须为 `same`，`deliverable_promotion` 必须继续；禁止只因 Spec ID / Basis ID 变化就 `replacement_required`；
- 符合性成功后必须在同一次 reconcile 或可靠 wake 里提交 publish，不得把发布留给后续 sweep；
- 不推迟第一份 Spec 到身份确认之后；不在 `specDigest` 相同时替换 Run；不禁止身份写回 Subject；不把本条交给 Aftercare；
- 不改 Owner、Handoff 或 Capability 边界。已 On-deck 的 19 部不可变；春晚现场需修复后新 reconcile 或新 Canary 验证。

验收证据：无评分样本在身份 resolve 后仍只有一份 Acceptance Spec、头不切、`specInputDigest` 不含身份指针；有评分样本仅在评分/标准/分拣真正变化时才发新 Spec。负例：符合性已过的 active Run 在语义相同的头切换后仍能 publish。本轮 23 部那种「空身份 Spec 1 → 身份写回 Spec 2」不再出现。

当前处理决定：2026-08-22 代码已实现。`specInputDigest` 不再纳入 `currentIdentityRevision` / `currentIdentityDigest` / `snapshotDigest`。身份写回不再发语义相同的 Spec 2。本条不宣称 Canary 或生产通过。

2026-08-23逐项封口首次复测发现上述实现仍不完整：旧Canary中两部同名`养蜂人 (2024)`均有3份Acceptance Spec，
每部的3个`specDigest`完全相同。页面先把4星豆瓣覆盖为同值4星直接评分、再清除直接评分；完整Perception Resolution来源、
revision和Query Result虽改变，实际评分与Requirements并未改变，旧`specInputDigest`仍因此空切两次。修复提交`3397c88f5`保留完整
Resolution/Query Result作为不可变Basis审计输入，但Spec语义判定只投影`rating`的`found/not_found`及1–5星业务值；4→5仍签发，
豆瓣4→直接4→豆瓣4不再签发。专项合同与真实E2E共18/18通过。

同日使用HEAD `3397c88f5`重建干净Canary `UAT-20260823-014246-3397c88f5`。Admin Web中`养蜂人 (2024)`完成
“4星豆瓣→同值4星我的评分→清除→恢复4星豆瓣”；该Subject全程只有Acceptance Spec revision 1，`specDigest`、
`currentDecisionBasisId`、Head revision 4、`currentAcceptanceSpecId`与`headDigest`逐字不变。另有`威尼斯惊魂夜 (2023)`、
`全面失控：特大号邮轮危机 (2025)`两个身份已写回样本，均只有一份Spec、一个completed Run并各形成一份Product Package。
状态`REGRESSION PASSED / CONFIRMED ON REBUILT CANARY`。UI证据：
`admin-web-evidence/uat-060-semantic-spec-head-stable-pass.png`。

## 58. UAT-061：豆瓣 Acquisition 翻页传输失败后不重试、不收口，设置页永久「正在同步」

问题分类：`EXTERNAL_INTEGRATION / RECOVERY_CORRECTNESS`

用户侧现象：干净 Canary `UAT-20260822-194617-1ed64ca36` 设置页豆瓣连接一直「正在同步…」，按钮禁用。用户以为还在拉收藏。

现场证据：同一隔离库。`perception_acquisitions` 仅一条，`state=active`，`terminal_at_ms=null`，`idempotencyKey=douban-sync:2026-08-22T12:10:56.059Z`。成功 commit 17 页、cursor `0→255`、`perception_records=255`，最新 cursor `has_more=1`。第 18 页 Work `perception-acquisition_page-work-35c2593159ef…` 为 `failed`；`perception.source.acquire@1` Attempt 1 终态 `P5_PROVIDER_TRANSPORT_FAILED`，`failure_class=executor`，无第二次 Attempt。`reconcileAcquisition` 用同一 `pageOrdinal` 幂等提交已失败 Work，Acquisition 永不收口。Settings 以 `syncState.activeCount > 0` 显示「正在同步」。23 个 Subject Resolution 仅 6 个 `found`、17 个 `not_found`；春晚等不在这 255 条里。

精确根因：翻页传输失败被打成一次 `executor` 终态，既不按 timeout/integration 有界重试，失败页又占住幂等键。UAT-043 已要求 lease 包装的 timeout/network/HTTP 收成可重试；本条是 Acquisition 分页在同类失败上没有收口。设置页把「仍为 active」当成进行中，没有失败态。

业务影响：同步表面永远转圈；收藏后半段评分进不来；后续 Aftercare/Spec 只能对已入库的 255 条 Resolution。用户无法点第二次同步。

修复边界：

- 豆瓣 HTTP/传输失败按 `timeout|integration` 在同一页 Work 上有界重试；不得一次 `executor` 打成整轮挂死；
- 重试耗尽后 Acquisition **收口为失败**，设置页显示失败和可再点的「同步」，禁止继续 `activeCount>0`；
- 已 commit 的页与 255 条 Record 保留；新一轮从 cursor 继续或按来源 digest 幂等，不造语义重复 Record；
- GET 评分日志仍不得触发同步。本条不改 UAT-001 匹配强度，不改 SSOT Owner。

验收证据：人为让第 N+1 页传输失败后，有界重试可见；耗尽后 Acquisition 非 active、设置页可再同步；失败前已入库 Record 仍在。负例：不得把失败显示成「正在同步」。

当前处理决定：2026-08-22 代码已实现。`P5_PROVIDER_TRANSPORT_FAILED` 记为可重试 `integration`；页 Work 终态失败后 Acquisition 收口为 `failed`，设置页 `activeCount` 归零。本条不宣称 Canary 或生产通过。不得用 copy-forward 单独关闭。

## 59. UAT-062：frozen Run Discard 后 Control 已释放，Formation 仍空转「正在评估整理方案」，未走重新入库

问题分类：`BUSINESS_CONTRACT / DOMAIN_ORCHESTRATION`

用户侧现象：对五星冻结的 `看不见的朋友 (2023)`、`黑客帝国动画版 (2003)` 点「放弃本次整理」后，前端一直停在「正在评估整理方案」。

现场证据：同一隔离库。两条 `libra_run_discard_decisions` / `receipts` 均成立，Run 为 `discarded`，`committed_run_state_revision=4`。Formation：`classification=pending`，`current_libra_run_id=null`，整理动作 `assessing:正在评估整理方案`，下一步「正在确认目标、评分、要求或身份」。豆瓣 Record 里这两部已是 5 星，Head 上仍有当前 Spec（HEVC · 4k · 50 GiB）。stderr 反复 `Libra Run input Control is unavailable.` 以及 `No Outbox consumer is registered for libra.workspace-cleanup.requested@1 -> libra_workspace_reclaimer`。

精确根因：Discard 按合同释放了 Primary Material Control，但 `ready-libra-runs` 仍对该 Subject `admit` 新 Run，Creator 要求 Control 仍由 Libra 持有，于是抛错打转。Workspace 清理 Outbox 无 consumer。页面把「无当前 Run、无 Work」译成空计划「正在评估」。SSOT §4.4.7 / `L5-Q7`：放弃是「放弃本次处理并**重新入库**」，释放 Control 后由 Field Management 在 Identity 仍属于有效 Observation 时开 **全新 Procurement**，不是 Libra→Procurement 反向 Handoff，也不是同一 Subject 立刻再开 Libra Run。

业务影响：用户以为系统在再评估；实际上新 Run 开不了、清理做不完、也不会重新入库。五星无 4K 源即使再走一遍仍应冻成「没有外部候选」，那是合同终态，不能用空转文案代替。

修复边界：

- Discard 之后禁止立刻 admit 新 Libra Run。Control 已 released 时 Creator 返回 typed「等待重新入库」，禁止 `EXECUTION_RUNTIME_ERROR` 循环；
- Control 释放后叫醒 Field Management / Procurement：仍在有效 Observation 集才开全新 Procurement Run；旧 Candidate/失败只作历史；
- 接上 `libra.workspace-cleanup.requested@1`；reclaimer是Libra内部职责，Inbox consumer必须使用Business Owner `libra`，不得把技术组件名伪装成Owner；清理不在 Discard 同一 SQLite 事务里删文件，但必须有人消费；
- 放弃后不得写「正在评估整理方案」。Discard 历史为「已结束 · 用户放弃」（UAT-018）；当前行若还在，只允许「等待重新入库 / 等待再次发现」；
- **不得**把 Control 留在 Libra 里「再试一次」。若产品要同一 Subject 留 Control 再开 Run，须先改 SSOT `L5-Q7`，本条不授权。

验收证据：五星冻结样本 Discard 后 Control released、无新 Libra Run、无 Control-unavailable 刷屏、清理 Outbox 被消费；页面不是「正在评估」；仍在 Field 内的材料能进入新的 Procurement，而不是静默消失。

当前处理决定：2026-08-23最终关闭。干净Canary `UAT-20260823-040740-0886b2723`中，《倩女幽魂2：人间道 (1990)》的frozen Run经正式放弃入口成为`discarded`，页面显示「待整理 / 等待重新入库」；Discard提交时Control为`released`。cleanup delivery以Business Owner `libra`写入Inbox并达到Delivery `acked` / Outbox `fully_acked`。随后从文件来源页面扫描新文件，形成新Procurement Run、accepted Candidate Delivery、新Subject及新frozen Libra Run；旧Subject仍只有原discarded Run。过程中另修正恢复启动顺序（先消费durable Outbox，再恢复依赖该消息的Owner Work）以及Field重观察时基于当前Control digest刷新Eligibility，均保持原Owner/Handoff边界。状态`REGRESSION PASSED / CLOSED`。

## 60. UAT-063：Aftercare 问豆瓣分与 Libra 不是同一套 Resolution/Identity Evidence，上架后评分变化不触发保养

问题分类：`BUSINESS_CONTRACT / PROJECTION_FRESHNESS`

用户侧现象：用户认为豆瓣分已经刷出来，已上架影片却没有 Aftercare。补充确认：**Aftercare 去 Perception 查豆瓣分的方法，必须和 Libra 去查的方法一致。**

现场证据：同一隔离库。`arca_aftercare_assessments` 57 行（19 部 × custody/presentation/conformance），结果全 `healthy`；`findings=0`，`cases=0`；最晚评估约 BDMV `养蜂人` On-deck 时。之后无因评分再评估。`due-aftercare-shelf-entries` 为 24h Custody / 7d Deep。Libra：`resolveDecisionFact({targetType:'subject', subjectId})`，title/year 来自 Candidate claim 经 `deriveTitleYear`，`providerIdentity=null`，锚为 `subject_id`。Aftercare：`readCurrentRating('shelf_entry', shelfEntryId)`，title 用 Collection `displayIdentity`（可含 `1080p H.264` 等展示尾缀），`providerIdentity=tmdb:providerKey`，锚为 `shelf_entry_id`。两边合同都是 `perception.rating.resolve@1`，但 Identity Evidence / `queryInputDigest` 不同。豆瓣 Record 有 Douban ID 与片名年，没有 `shelf_entry_id`，通常也对不上 `tmdb:…`。Libra 靠 `title_year` 才能 `found`（本轮仅 6/23）；Aftercare 用另一套证据，同一条豆瓣分对 Entry 变成 `not_found`。`queryHandle.consumerDomain` 写死 `libra`。叠加 UAT-061：Acquisition 停在 255 条，多数片子在 Perception 里本来就还没有分。

精确根因：Perception 不推送、不因 Record 直接建 Aftercare Case（SSOT §3.6.4），On-deck 后的 Perception 变化归 Aftercare 自己再查（§6.4.6）。Aftercare 作为消费者 (1) 构造的 Identity Evidence 与 Libra 不一致，查不到同一条 Douban Record；(2) 没有「上架后分从无到有 / 星级变化」的再查询，只靠日历扫描。用户确认的硬条件：两边查法必须是同一套 Resolution 合同加同一套 Identity Evidence 构造，不是 Aftercare 拿 `subjectId` 回流 Libra，也不是第二套匹配算法。

业务影响：整理页看得到的豆瓣分，收藏保养当没分。无评分规则收下的 H.264 后来变成 3/4 星应 HEVC 时，Aftercare 不会补做。已经符合的片子也不该被错误重做。

修复边界：

- Aftercare / Off-deck 的 `targetProjection` 与 Libra Subject 投影共用 **同一套 Identity Evidence 构造**（同一 `deriveTitleYear` / 去技术尾缀；Provider 有则同一形态，没有就不要伪造另一套键）；禁止用未剥离的 `displayIdentity` 去查；
- 继续只走 Perception 公开入口 `perception.rating.resolve@1`（`resolveDecisionFact` / `readCurrentRating`），kind=`rating`，同一匹配阶梯与消歧；Arca 不得直接扫 `perception_records`；
- 消费者仍是自己：Libra 问 Subject，Arca 问 Shelf Entry；投影来源不同，证据形状和解析规则相同。Entry 的 Canonical Identity（片名、年、TMDB）冻出的 Evidence 须能对上 Libra 当时问到的同一条 Douban Record；用户给 Entry 的直接分仍走 `shelf_entry` 锚，按既有来源优先级合并；
- Aftercare 业务流程须在「上架后第一次评分从无到有 / 星级变化、care basis 因而变化」时自己再拉一次上述查询；24h Custody 仍作兜底。这是 Aftercare 拉 Resolution，不是 Perception 推 Case；
- 新分使产品不再符合当前档才开 Aftercare Case（无评分收下的 H.264 → 3/4 星 HEVC）；已符合的保持 healthy，不得为切档重做；
- 不接受：Aftercare 用 `subjectId` 当 target；给 Entry 单独模糊匹配；评分变化重开 Libra Run；
- 本条依赖 UAT-061 把 Acquisition 收口，否则多数片子仍是 Perception `not_found`。不改 Owner/Handoff。`queryHandle.consumerDomain` 应按调用方为 `libra|arca`，不得因此换匹配规则。

验收证据：同一 Douban Record，Libra Subject Resolution 为 `found` 时，对应 Shelf Entry 用同一套 Evidence 查询也为 `found` 且星级相同；展示名含技术尾缀的 Entry 不得因此 `not_found`。上架时无分、同步后出现 3/4 星且源为 H.264 的样本，Aftercare 在评分变化后（不必空等 24h）出现 conformance 再评估；已是 HEVC 且低于上限的 3 星样本保持 healthy。负例：Aftercare 不得为查分回读 Libra Subject 或扫描 Record 表。

当前处理决定：2026-08-22 代码已实现。Libra Subject 与 Arca Shelf Entry 共用 `buildRatingTargetIdentity`（同一 `deriveTitleYear`）；`queryHandle.consumerDomain` 按调用方为 `libra|arca`。Care Basis 因评分变化后 Aftercare 立即到期，不再被 24h 列表门闩挡住。本条不宣称 Canary 或生产通过。

2026-08-23 关闭复测：干净 Canary `UAT-20260823-014246-3397c88f5` 中，Formation 的「威尼斯惊魂夜 (2023)」命中豆瓣评分；对应 Shelf Entry 在「我的收藏」详情却显示「年份未知 / 暂无评分」。通过页面提交 4 星直接评分后，Shelf Entry Resolution 立即 `found`；清除后同一 Resolution Head revision 2 明确回到 `not_found`，没有命中 Subject 使用的豆瓣记录。根因独立登记为 `UAT-068`。本轮 UAT-063 未通过资格确认，须在包含 `UAT-068` 修复的新 Canary 上重验。

2026-08-23 最终关闭：干净 Canary `UAT-20260823-024825-f6b9eded6` 与 commit `ab8184f7b` 的安全重启现场中，《威尼斯惊魂夜 (2023)》页面提交4星直接评分后无需手动健康检查于03:44:27形成三维健康Assessment；清除后恢复`3 星 · 豆瓣`并于03:45:06自动形成新三维健康Assessment。Subject与Shelf Entry Resolution当前均为`found`并命中同一Douban Record `perception-record-5628590251074f0155192bf1b1eadf8828c3258e`，未重开Libra Run。状态`REGRESSION PASSED / CLOSED`。

## 61. UAT-064：Formation 整理步骤展示与真实执行状态偏离

问题分类：`USER_EXPERIENCE / PROJECTION_FRESHNESS`

用户侧现象：干净 Canary `UAT-20260822-141950-0c27c8cf6` 中，`立春 (2007)` 页面像卡在「验证整理结果」；同页「CPU转码 · HEVC · 不超过 14 GiB」。用户追问是否卡住、以及为何在用 CPU 转码。

现场证据：同一隔离库。Formation Projection：`classification=in_progress`，`next_action_label=处理视频文件`，`next_action_state=waiting_for_resource`。`organizingSteps` 把 `transcode` 标 `running` 且文案为 CPU，把 `verify` 标 `done`。领域事实：Direct `libra.product_media.verify@1` 已成功（源校验），随后 `transcode_1_assessment` 成功；`libra.media.transcode@1` 为 `waiting_for_resource`。本机 FFmpeg 实际命令为 `-c:v hevc_nvenc -b:v 2279830`（养蜂人 BDMV 占用编码器槽）。立春在排队，不是死锁。

精确根因（登记，不深挖）：`transcodeLabel` 只从 `libra.media.transcode@1` 已落盘 Result 读 `executionDeviceRef` / `deviceSnapshot`；执行中或等待资源时 Result 为空，默认 CPU。`验证整理结果` 把 Direct 源上的 `libra.product_media.verify@1` 与成品符合性混成同一步，源校验成功后页面就显示验证完成。

业务影响：用户误判卡住或走了 CPU；CPU/GPU 标签与真实设备不一致。不改变转码触发或码率合同。

修复边界：

- 转码步骤的 CPU/GPU 必须反映真实 `deviceClass`（EncodeIntent / 设备快照 / `executionDeviceRef`），等待资源或执行中也不得默认 CPU；
- 「验证整理结果」不得把 Direct 源校验画成成品验证已完成；成品验证只在转码/Remux 输出校验之后；
- 下一步文案与步骤状态必须同一套事实。不改转码规划、不改 Owner/Handoff。本条与 UAT-059 的码率灌满是不同缺陷。

验收证据：GPU NVENC 执行中页面为 GPU 转码；排队时不得写 CPU。源不合格走转码时，「验证整理结果」不得在转码完成前为 done。负例：不得把 `waiting_for_resource` 画成验证卡住。

实现与关闭确认（2026-08-23）：commit `daaef8c3d` 让 Formation 步骤从冻结 Plan/Work/Event FACT 推导执行设备与输出验证状态。隔离运行 `F:\shelfdeck_test_zone\runs\UAT-20260823-135500-daaef8c3d` 的执行中证人曾显示 `GPU转码 · HEVC · 不超过 14 GiB = running`、`验证整理结果 = pending`；同一时点 Direct 源校验已 succeeded、转码 executing、输出校验 pending。安全重启到 commit `71e8e5b63` 后该证人自然完成，Formation Projection 显示 GPU 转码、验证与上架均 done；FACT 中 Direct 校验、NVENC 转码、输出校验及 Product Conformance 均 succeeded，EncodeIntent 与设备快照均为 `nvidia_nvenc`。最终 FACT 位于 `uat-064-final-facts.json`。Codex Browser 本机 URL 策略未能提供渲染截图；Product Owner 于同日明确接受现有 API/FACT/RESTART 证据并要求标记关闭。状态 `REGRESSION PASSED / CLOSED BY PRODUCT OWNER ACCEPTANCE`；不声称存在未取得的 UI 截图。

## 62. UAT-065：收藏详情把父目录名中的`.1`误显示为主视频容器

问题分类：`USER_EXPERIENCE / PROJECTION_FRESHNESS`

用户侧现象：逐项关闭`UAT-048`时，干净Canary的BDMV「养蜂人」已经On-deck且主视频实际为
`F:\canary\养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1\养蜂人 (2024).mkv`，但「我的收藏」详情把
主视频显示为`8.3 GB · 1`，没有显示真实容器`MKV`。

现场证据：同一详情显示当前收藏、健康、占用空间`8.3 GB`；只读Inventory确认`primary_payload`位置以上述
`.mkv`结尾，大小`8932765796`字节。`collection-query.js`的`containerFromLocation(location)`直接对完整路径执行
`/\.([a-z0-9]+)(?:$|[\\/?#])/`，先命中父目录`TrueHD5.1\`中的`.1`，因此返回`1`而不再检查basename扩展名。

初步诊断：容器推导没有先取最终文件basename。只要任一父目录含点号加字母/数字并紧邻路径分隔符，就可能把目录后缀
误当文件扩展名。这是Collection只读Projection翻译缺陷，不是Inventory、Placement或On-deck事实错误。

业务影响：用户在正式收藏详情中看到错误的主视频容器，无法可信判断媒体规格；该错误也会影响其他带点号父目录的Entry。

修复边界：`containerFromLocation`只从最终文件basename解析最后一个扩展名，并保留MKV/MP4/M2TS等现有用户文案；
无扩展名时显示未知而不是扫描父目录。不得probe磁盘，不改Inventory事实、Owner或Handoff。

验收证据：用真实Admin Web重新打开上述「养蜂人」详情，主视频显示`8.3 GB · MKV`；覆盖`TrueHD5.1`父目录、普通目录、
多点文件名和无扩展名的回归反例；不得用直接数据库修改制造通过。

当前处理决定：2026-08-22在`UAT-048`关闭作业中发现并独立登记。按一项一张作业卡规则暂停`UAT-048`关闭判定；
本记录不授权把新缺陷吞进`UAT-048`或已关闭的`UAT-052`，不触碰Canary文件、数据库、NAS或生产。

修复进展：`a59737c4a`只把容器解析收窄到最终basename并补充Windows/POSIX、带点父目录、多点文件名和无扩展名反例；
定向`helix-collection-query.test.js` 3/3 PASS。完整`npm test`为306 PASS / 2 FAIL / 18 SKIP；Procurement失败单独复跑已PASS，
Routing E2E单独复跑仍停在其既有`specs=24/runs=24`等待条件，与Collection Query无调用关系，不以本修复吞并。隔离服务已在无FFmpeg
进程时从PID 6488重启为25716，public health为`ok`。真实Admin Web刷新后，同一8.3 GB BDMV「养蜂人」详情已显示
`主视频 8.3 GB · MKV`，不再显示`· 1`；状态`REGRESSION PASSED / CONFIRMED ON CURRENT CANARY`。

## 63. UAT-066：Formation 已完成整理表丢失目标收藏架名称，全部显示`—`

问题分类：`USER_EXPERIENCE / PROJECTION_FRESHNESS`

用户侧现象：干净 Canary `UAT-20260822-141950-0c27c8cf6` 的 Admin Web「媒体整理工作区」展开「已完成整理」后，17 条已完成媒体的「目标收藏架」全部显示`—`；同一批媒体在「我的收藏」中明确属于`Movie Canary`。

现场证据：隔离库 `libra_formation_projections` 的17条`completed`行全部保留同一个非空`target_shelf_id`，`routing_state=resolved`，但`target_shelf_name`为空；6条`attention_required`行也同样保留目标ID而名称为空。修复前页面截图为`admin-web-evidence/uat-066-completed-shelf-missing-before-fix.png`。

精确根因：Arca 的正式 Shelf Routing Target Projection 只公开稳定的`shelfId`和路由/标准版本，不公开可变的Shelf名称；Formation后端Projection因此正确保留目标ID但拿不到名称。当前媒体表已经使用同页加载的Arca Shelf只读清单按`shelfId`解析显示名，而已完成表只读取`item.targetShelfName`，漏掉了同一解析接线。业务Routing Decision、Shelf Entry与目标ID均未丢失。

修复边界：只修 Formation Admin Web 的只读展示接线，让已完成表按`targetShelfId`从同页已加载的Shelf清单解析当前名称；不向Libra复制可变的Arca名称，不读取Arca Store，不改Routing Decision、业务事实、Owner或Handoff。未知/已注销Shelf仍须给出可理解的稳定降级，不得伪造名称。

验收标准：在真实 Admin Web 展开「已完成整理」，17条证人的目标收藏架均显示`Movie Canary`而不是`—`；刷新页面后保持；同页当前媒体的收藏架显示不回退。证据要求：`UI`。

当前处理决定：2026-08-22 已由 commit `e27b7e2ad` 修复。Admin Web 共用`shelfNameFor`按目标ID从同页Shelf清单解析当前名称；定向Admin Web合同测试13/13通过，production build通过。隔离服务从PID 25716安全重启为18132，public health为`ok`、generation为`helix-clean-v3`。真实页面刷新后，17/17条已完成媒体的目标收藏架均显示`Movie Canary`，6条当前媒体的收藏架显示也未回退；状态`REGRESSION PASSED / CONFIRMED ON CURRENT CANARY`。UI证据：`admin-web-evidence/uat-066-completed-shelf-movie-canary-after-fix.png`。

## 64. UAT-067：活动 Run 加急后回放既有 Supporting Work 触发 Admission 幂等冲突

问题分类：`DOMAIN_ORCHESTRATION / EXECUTION_SCHEDULING`

用户侧现象：新干净 Canary `UAT-20260823-002500-519f8d7b5` 中，为优先复测 `UAT-020`，用户页面把
`老笠 (2016)`设为「已加急」。页面随后显示身份、资料、海报与 NFO 均为 100%，但 Run 长时间停在「待整理」，
没有形成 Product Package；同期普通优先级转码继续逐项执行。

现场证据：只读领域事实显示该 Run 为 `active + expedited`，既有 `artifact_production` Work 已成功，
Identity、Metadata Observation 与 Artifact Event 均有唯一成功 Result，但 `product_fact_assembly` Work 始终不存在。
服务每 30 秒的 Owner fallback reconcile 持续报告 `P4_WORK_ADMISSION_IDEMPOTENCY_CONFLICT`。既有 Artifact Work 的
不可变 `definition_json` 冻结为 `normal_foreground / priorityRevision=1`；加急后的 Run Snapshot 为新 Priority Revision，
Coordinator 以同一 `workId/idempotencyKey` 重建不同 Work Definition，Foundation 因请求摘要不同而正确拒绝回放。

精确根因：Run Priority 是可变执行投影，但 Supporting Work Definition 与 Admission Receipt 不可变。
`libra-run-coordinator.js` 的 `submit(work)` 每次 Reconcile 都用当前 Run Priority 重建已经存在的 Work，再调用
`admission.replay(work)`；它没有复用该 Work Admission 时冻结的 Priority 字段，也没有验证「除 Priority 外定义完全相同」后
使用原定义回放。因此正常→加急或加急→正常都可能把合法优先级变更误报为 Work Definition 幂等冲突。

业务影响：加急不是单纯没有提速，而是可以使活动 Run 永久失去后续推进；Fallback Reconciler 在该 Subject 抛错后还会中断
本轮后续 Registration，扩大活性影响。Foundation 的 exact-idempotency 防线本身没有错误，不得放宽为接受任意定义漂移。

修复边界：Foundation 继续要求 Admission 请求摘要精确一致；Work Result Reader 只读公开既有 Work 的冻结 Definition 与摘要。
Libra Run Coordinator 若发现同一确定性 `workId` 已存在，只允许把当前生成定义的 `priorityClass/priorityRevision`替换为已冻结值后
比较完整 Definition Digest；仅当其余字段完全相同才按原定义 replay。其他字段、Basis、Dependency、Output Contract 或 ID 漂移
仍必须抛 `P4_WORK_ADMISSION_IDEMPOTENCY_CONFLICT`。新 Work 仍使用当前 Run Priority，Scheduler 继续从正式 Run Execution
Projection消费动态优先级；不改 Owner、Handoff、Foundation幂等语义或现有不可变 Work。

验收证据：回归覆盖 Work 已在 normal Priority Admission、随后 Run 加急、Coordinator 再次 Reconcile 能创建下一阶段 Work且无
幂等冲突；反例证明除 Priority 外任一字段漂移仍被拒绝。恢复同一 Canary 后，`老笠`以「已加急」继续形成 Package、上架且页面终态
可见；不得直接编辑数据库或重建该 Run。

当前处理决定：2026-08-23 在 `UAT-020` 新 Canary 复测中独立登记。当前只确认根因和最小边界；Canary 服务继续运行，
`F:\test_film`未修改，`F:\canary`只由 ShelfDeck 工作流处理，NAS/生产未触碰。

修复与关闭确认（2026-08-23）：commit `c78ae528c`新增Foundation只读`readDefinition(workId)`并校验冻结Definition
Digest；Libra Run Coordinator仅在当前生成定义除`priorityClass/priorityRevision`外与冻结定义完全一致时使用冻结定义replay，
其余漂移继续由Foundation exact-idempotency拒绝。定向16项回归全部通过，覆盖Priority-only回放与Output Contract漂移反例。
在无FFmpeg/FFprobe的安全点重启同一隔离服务后，原`active + expedited`的`老笠`Run直接恢复，创建后续Product Fact、
Product Package与Offer并完成On-deck；没有替换Run或数据库编辑。Admin Web已完成表显示`老笠 (2016)`进入`Movie Canary`，
动作包含验证整理结果和上架到收藏架。状态`REGRESSION PASSED / CLOSED`。UI证据：
`admin-web-evidence/uat-067-expedited-run-recovered.png`；FACT证据保留于同一UAT clean数据库和运行日志。

## 65. UAT-068：Collection 年份投影遗漏 Provider 标准字段，Aftercare 丢失 title-year Identity Evidence

问题分类：`PROJECTION_FRESHNESS / BUSINESS_CONTRACT`

用户侧现象：干净 Canary `UAT-20260823-014246-3397c88f5` 中，Formation 的「威尼斯惊魂夜 (2023)」显示豆瓣评分，但对应已上架影片在「我的收藏」详情显示「年份未知 / 暂无评分」。页面提交 Shelf Entry 直接评分能命中，清除后不能恢复豆瓣来源。

现场证据：Shelf Entry 当前 Inventory `product_metadata` 明确保存 `year_or_release_date=2023` 和 `release_date=2023-09-13`；`collection-query.js` 只读取 `year` / `release_year`，因此 Collection item 与 `targetProjection` 的 `year` 均为 `null`。页面清除直接评分后，Shelf Entry 的 `perception.rating.resolve@1` Head 从 direct `found` revision 1 变为 `not_found/no_matching_record` revision 2；未产生豆瓣 winning record。页面截图为 `admin-web-evidence/uat-063-before-health-check.png` 与 `admin-web-evidence/uat-063-direct-rating-4.png`。

精确根因：Arca Collection 只读 Projection 没有消费 TMDB Product Metadata 合同实际使用的 `year_or_release_date` / `release_date`。共享 `buildRatingTargetIdentity` 本身正确，但调用方先把有效年份丢成 `null`，导致 Shelf Entry 遗失 Libra 使用的 title-year Anchor。这不是 Perception 匹配算法或 Record 数据缺陷。

业务影响：上架影片显示错误年份；Aftercare 无法用与 Libra 同形的 Identity Evidence 命中同一外部评分，评分变化后的合规评估依据不可信。

修复边界：Collection 只读 Projection 依次接受 `year`、`release_year`、`year_or_release_date`、`release_date`，统一解析四位年份；不得扫描 Perception Record、回读 Libra Subject、修改 Inventory 事实或放宽匹配算法。不改 Owner/Handoff。

验收证据：新干净 Canary 中，真实「我的收藏」详情显示正确年份；未设置 Shelf Entry 直接评分时，页面显示与 Formation 相同的豆瓣星级；只读 FACT 证明两边 Resolution 命中同一 Douban `winningPerceptionId`。证据要求：`UI`、`FACT`。

当前处理决定：2026-08-23 已由 commit `a34dbde1f9` 修复。新增年份归一化单元反例及真实 Collection API 年份断言，相关单元/端到端 15/15 PASS；状态 `CODE_DONE_UNQUALIFIED`，等待新 Canary 独立关闭，不以测试直接记 PASS。

关闭确认（2026-08-23）：干净 Canary `UAT-20260823-024825-f6b9eded6` 中，《威尼斯惊魂夜》收藏详情显示`2023`与`3 星 · 豆瓣`；Inventory只读 FACT 保留`year_or_release_date=2023`、`release_date=2023-09-13`。Subject 与 Shelf Entry 当前 Resolution 均命中同一 Douban Record `perception-record-5628590251074f0155192bf1b1eadf8828c3258e`。状态`REGRESSION PASSED / CLOSED`；UI证据：`admin-web-evidence/uat-068-year-and-douban-rating-pass.png`。

## 66. UAT-069：评分 Resolution 已更新且 Aftercare 已及时执行，但 Planner/Capability 写回旧 Care Basis

问题分类：`DOMAIN_ORCHESTRATION / PROJECTION_FRESHNESS`

用户侧现象：干净 Canary `UAT-20260823-024825-f6b9eded6` 中，《威尼斯惊魂夜 (2023)》清除 4 星直接评分后立即恢复为`3 星 · 豆瓣`，但「我的收藏」健康状态从旧结论失效为`尚未检查`后不能形成当前评分 Basis 下的新结论。

现场证据：Shelf Entry `5a0f45890d270029b646fcda085cc5a502e98003b7469cbb7c05100a2ae30767` 的 Perception Resolution revision 2 在 `1787427217953` 命中 Douban Record；Aftercare Work `arca-care-work-fadccd6592dec42cd9c290788e2d94bde9836859` 于 `1787427217973` 创建、`1787427218098` 成功，远早于 24 小时门槛。但新 Assessment 仍使用旧 `decisionFactSetDigest=1f3cf98b0a54f3f653ebba20bd09b33390374ddfec8aebc30e81a6fb2b4ac1b8` 与 `careBasisDigest=1ade89d001aa6a9f4d9beb151392d4531b1ecd31c82be616da934e3adb790013`，没有消费 revision 2 的 `resolutionDigest`。UI 证据保存在本轮 `admin-web-evidence`。

精确根因：组合根先创建 `arcaCapabilityRegistration`，当时其 `aftercareContextReader` 没有评分读取端口；随后 Process Services 又单独创建了含评分的 Reader。Coordinator 因此能看到新 Rating Basis 并及时 Admission Work，而 Capability 与 Planning Registration 继续使用早期无评分 Reader，执行时重算并写回旧 Basis。这是同一 Owner 内的组合接线分裂，不是 Perception Resolution、24 小时门闩或数据库事实缺陷。

业务影响：评分变化会触发看似成功的保养任务，但健康 Projection 仍正确拒绝把旧 Basis Assessment 当作当前结论；用户长期看到`尚未检查`，合规状态无法封口。

修复边界：组合根只创建一个晚绑定 Perception 评分端口的 Aftercare Context Reader，并将同一实例显式传给 Capability、Process Coordinator 与 Planner。不得直接读 Perception Store、回读 Libra Subject、放宽健康新鲜度判断、修改 Owner/Handoff 或伪造 Assessment。

验收证据：新干净 Canary 通过页面改变/清除评分后，无需等待 24 小时形成新 Assessment；只读 FACT 证明新 `decisionFactSetDigest` / `careBasisDigest` 包含当前 Resolution；页面显示当前健康结论，且不重开 Libra Run。证据要求：`UI`、`FACT`。

修复与关闭确认（2026-08-23）：commit `ab8184f7b` 让 Capability、Coordinator、Planner 共用晚绑定评分 Reader；定向 Aftercare 合同 15/15 PASS。在 Formation 整理中为0且无 FFmpeg/FFprobe的安全点，仅重启同一隔离服务。真实页面中《威尼斯惊魂夜》先恢复为三维健康，随后页面 4 星直接评分与清除回`3 星 · 豆瓣`都无需手动健康检查自动形成新健康 Assessment。FACT 中三代 `decisionFactSetDigest` / `careBasisDigest` 均不同，最新不再使用旧 Basis；状态 `REGRESSION PASSED / CLOSED`。UI证据：`admin-web-evidence/uat-069-rating-aware-care-basis-pass.png`。

## 67. UAT-070：集成配置 revision 更新后，新建 Metadata Work 仍假定 revision 1，并让首轮 reconcile 阻断服务启动

问题分类：`DOMAIN_ORCHESTRATION / RECOVERY_CORRECTNESS / EXTERNAL_INTEGRATION`

用户侧现象：隔离 Canary 通过正式 Admin Web 重新连接 TMDB 后，Integration 配置 revision 前进。随后在无 FFmpeg/FFprobe 的安全点重启同一隔离服务，服务未能进入 ready，Admin Web 与 Formation 均不可访问。

现场证据：失败现场位于 `F:\shelfdeck_test_zone\runs\UAT-20260823-132053-daaef8c3d`。重连后运行期反复出现 `PLATFORM_INTEGRATION_REVISION_MISMATCH`；安全重启时 startup recovery 以同一码和 `Integration Handle revision is stale.` 直接失败，端口停止监听。失败库中 TMDB 当前 revision 为 3、存在一个活动 Libra Run，但活动 Libra Work 与 Event 均为 0；这排除了“恢复旧冻结 Event”这一初步假设。另一个健康隔离运行的 `/v1/health` 与 `/formation` 均可返回，说明 Codex Browser 的本机 URL 策略限制与本产品故障是两个独立问题。

精确根因：`product-metadata-work.js` 在创建新的 Provider Metadata source Work 时把 `configRevision` 硬编码为 1；同类 artifact fallback 也有相同潜在缺陷。当前 TMDB 已是 revision 3，因此 Platform Integration Runtime 正确拒绝了这个新造但已过期的 Handle。与此同时，`DomainReconcileRunner.start()` 等待首轮全量 sweep，并把单个 Owner scope 的异常传播为 service startup 失败；因此一个 Libra Run 的规划错误同时阻断了所有不相关业务与 Admin Web。

业务影响：用户一次正常的 Integration 重连可令仍含旧 Handle 的持久化工作在后续重启时阻断整个 ShelfDeck 服务；管理页面、Formation 与其他不相关业务一并不可用。

修复边界：commit `efaf2d827` 增加“创建新 Work 时读取当前 Integration Handle”的专用端口；Planner 只在创建边界读取一次，并把返回的真实 revision 冻结进不可变 Work，既有冻结输入的严格校验不变。Foundation reconcile 对单个 scope 的异常保留失败前 cursor、报告错误并继续兄弟 scope，使首轮启动和后续有界重试不再被单项故障击穿。未修改历史事实，未用新 Credential 偷换旧 Handle，也未改变任何 Owner/Handoff。

验收证据：真实失败库独立克隆 `F:\shelfdeck_test_zone\runs\UAT-20260823-uat070-recovery-v2` 在同一 TMDB revision 3 下安全启动为 `ready` 并干净关闭；新 Metadata Work/Event 成功，结果 sourceRef 为 `tmdb:tmdb-main@3`，`PLATFORM_INTEGRATION_REVISION_MISMATCH` attempt 为 0。相关回归最终 10/10 PASS。Codex Browser 本机 URL 策略未能提供渲染截图；Product Owner 于同日明确接受现有 FACT/RESTART/回归证据并要求标记关闭，不声称存在未取得的 UI 截图。

关闭确认：commit `efaf2d827` 完成根因修复；代码、回归与真实失败库克隆的 RESTART/FACT 均已通过。2026-08-23 Product Owner 明确接受现有证据并要求关闭，状态 `REGRESSION PASSED / CLOSED BY PRODUCT OWNER ACCEPTANCE`。未触碰 NAS/生产，未在 C 盘留下测试过程文件。

## 68. UAT-071：同一来源的多个人物关系因共享 Evidence digest 发生自动登记碰撞

问题分类：`DOMAIN_ORCHESTRATION / PROJECTION_FRESHNESS`

用户侧现象：已有电影成功上架，但人物名录没有自动登记完整演职员；同一电影的多个人物关系共用电影/NFO级`originEvidenceDigest`时，首个Candidate使后续人物被误判为已知。

精确根因：Arca投影把来源级digest直接当作People Candidate去重键，People又先按该digest短路；不同姓名、角色和TMDB Person ID因此在登记边界发生碰撞。另有24小时Process-local空扫门闩会让服务启动后的新On-deck证据延迟到下一周期。

修复边界：Arca按`relationId`、`relationDigest`、来源provenance、姓名、角色及Provider Identity计算确定性逐关系Evidence digest；People先按稳定Provider Person Identity查现有Person，再按逐关系digest查历史Candidate。移除重复的Process-local 24小时门闩，Foundation仍保持30秒有界调度。未新增表、未迁移旧Candidate、未改变Owner/Handoff。

验收证据：隔离运行`F:\shelfdeck_test_zone\runs\UAT-20260823-people-registration-avatar-91e6bb141`是确定性本地Provider stub自动化夹具，只证明逐关系Evidence、16个强身份、重启幂等与失败cursor合同，不作为真实TMDB或真实UI UAT证据。随后真实运行`F:\shelfdeck_test_zone\runs\UAT-20260823-people-real-avatar-fix-b8861a3dd`从只读`test_film`复制《放·逐 (2006)》，走正式Formation→On-deck→People链路，23个不同TMDB Person Identity对应23个active Person、0 open Candidate；安全重启后仍为23/23，源电影与NFO的size/mtime保持不变。

当前处理决定：提交`bcca79848`修复逐关系Evidence与幂等顺序，提交`0cc272d2f`修复新证据唤醒。状态`REGRESSION PASSED / QUALIFIED IN ISOLATED CANARY`；不修改保留UAT数据库或旧错误Candidate。

## 69. UAT-072：已登记人物缺少安全代理头像与UI回退

问题分类：`USER_EXPERIENCE / EXTERNAL_INTEGRATION / PROJECTION_FRESHNESS`

用户侧现象：人物页只有文字名录，已登记人物没有头像；直接把TMDB Secret或原始图片地址交给浏览器又不符合安全边界。

修复边界：新增受保护的`GET /v1/admin/people/:personId/avatar`，只读取active Person的TMDB Person Identity，以当前Integration revision请求人物资料并代理`w185`图片。边界为10秒、4 MiB、JPEG/PNG/WebP；24小时内存缓存按Integration revision与Provider key隔离，最多64项/32 MiB，不写盘。无图、Integration不可用或网络失败返回明确错误，由前端显示姓名首字头像。

验收证据：Admin Web人物页改为响应式竖向头像卡，展示姓名、登记状态、别名和外部编号，支持lazy loading、键盘焦点、窄屏单列及加载失败回退。早先`UAT-20260823-people-registration-avatar-91e6bb141`截图使用确定性本地TMDB stub，只作为自动化夹具证据，不作为真实UI UAT截图。真实运行`UAT-20260823-people-real-avatar-fix-b8861a3dd`的桌面与390px Playwright均通过：23张真实电影人物卡、21个真实TMDB代理头像、2个TMDB无图首字回退、待确认0，axe serious/critical为0。截图位于`playwright/people-real-desktop.png`与`playwright/people-real-narrow.png`；FACT位于`evidence/people-real-avatar-ui-facts.json`。头像后端另覆盖成功、无图、超时、超限、错误MIME、Integration revision变化和未授权访问。

当前处理决定：提交`7f93e1b1d`完成头像route与UI，`8b9df550f`加入专项/E2E，`ea860b19e`修复冻结People列表的Admin投影并强化真实名录UI见证。状态`REGRESSION PASSED / QUALIFIED IN ISOLATED UI E2E`。Route Inventory总数为119；未暴露Secret或TMDB原始地址。

## 70. UAT-073：NFO人物强身份丢失并与Provider关系重复

问题分类：`DOMAIN_ORCHESTRATION / EXTERNAL_INTEGRATION / PROJECTION_FRESHNESS`

用户侧现象：第一次真实《放·逐 (2006)》Canary中，人物名录自动登记16人，但同时出现23条需要用户确认的英文姓名。用户已经提供了带`<tmdbid>`的NFO，不应再确认同一批演员。

现场证据：保留现场`F:\shelfdeck_test_zone\runs\UAT-20260823-people-real-avatar-4916191ea`中，Arca有16条真实TMDB Provider强身份关系和23条NFO弱身份关系；例如`黄秋生 / tmdb_person 66717`自动登记，同时`Anthony Wong / 无Provider Identity`形成open Candidate。23条NFO演员实际都含`<tmdbid>`。

精确根因：Libra的Related NFO读取只提取演员`<name>`，硬编码`providerIdentities=[]`，丢弃同一`<actor>`块内的`<tmdbid>`；Media Cast形成又把NFO与Provider的people hints全部追加，不按稳定Provider Person Identity去重。People按合同不能用中英文姓名猜测合并，因此正确地把23条弱关系交给用户确认。

修复边界：commit`da485edc6`在Libra NFO读取边界把有效正整数`<tmdbid>`冻结为`tmdb/tmdb_person`身份，并在Metadata Media Cast形成时按`provider + namespace + providerKey`精确去重，遵守既有NFO-first来源优先级。无稳定ID的人仍保持弱身份待确认；不做姓名模糊合并，不修改People自动接受规则，不新增表、不迁移或删除旧现场Candidate、不改变Owner/Handoff。

验收证据：全新真实运行`F:\shelfdeck_test_zone\runs\UAT-20260823-people-real-avatar-fix-b8861a3dd`从只读`F:\shelfdeck_test_zone\test_film\放·逐 (2006)`复制MKV/NFO，使用真实TMDB并走正式Formation→On-deck→People。NFO预期23个唯一TMDB Person ID，Arca为23、People active为23、open Candidate为0；安全重启后数量不变，源size/mtime不变。真实UI桌面及390px均显示23人、待确认0，21个真实头像与2个首字回退；axe serious/critical为0。业务FACT为`evidence/people-real-canary-facts.json`，UI FACT为`evidence/people-real-avatar-ui-facts.json`。

当前处理决定：提交`da485edc6`完成生产修复，`b8861a3dd`加入真实电影资格脚本，`a82ea3367`加入真实UI/axe证据脚本。专项People/Libra回归52/52、Admin Web build及真实E2E通过。完整Service `npm test`为310 PASS / 18 SKIP / 1 FAIL，唯一失败是既有Routing陈旧等待条件（实际24/24、旧断言等待25/24），不得为此恢复重复Acceptance Spec。状态`REGRESSION PASSED / QUALIFIED WITH REAL MOVIE AND REAL TMDB`。

## 71. UAT-074：NFO按“更新、重建、创建”三种结果处置

问题分类：`BUSINESS_CONTRACT / USER_EXPERIENCE`

用户验收目标：ShelfDeck不再把所有NFO都解释为“重新生成”。原NFO可用时应在Libra Production Workspace中**更新**；原NFO损坏时**重建**；原来没有NFO时**创建**。普通用户只需要看到这三个结果，不需要理解XML解析错误与内容身份错误的技术区别。

当前证据：现有Planner把所有NFO统一路由到`SIDECAR_RENDER`，Renderer从最小空白草稿生成XML。以《倩女幽魂》保留Canary为证，原NFO已有丰富信息，Workspace NFO却被缩减为少量字段。这不是SSOT要求，而是当前实现缺口。

修复边界：源Material Field保持只读；所有更新或重建只发生在Libra Workspace。影片身份仍先于NFO成品处理：身份尚未确定时显示“需要确认影片身份”，不得以错误身份更新或重建NFO。修复不得移动Product Metadata Owner或改变Handoff。

验收场景：在全新隔离Canary中分别提供一份可用NFO、一份损坏NFO和一部无NFO影片；详情明确显示“检查原NFO→更新NFO→验证”“检查原NFO→原文件不可用→重建并验证”或“未发现NFO→创建并验证”。源目录size、mtime与内容不变；Workspace与最终Shelf结果符合对应处置。证据要求：`UI`、`FACT`、`FS`。

关闭确认（2026-08-23）：commit `3722e129b`实现`update/rebuild/create`三种正式Disposition。当前提交版隔离Canary `UAT-20260823-formation-074-083-b4e36d5c-v11`中，007为`related_nfo_update`、香火为`product_metadata_draft_rebuild`、威尼斯惊魂夜为`product_metadata_draft_create`；三部均完成Formation→On-deck，源文件前后快照完全一致。007真实中心详情显示“更新 NFO”。状态`REGRESSION PASSED / CLOSED`。

## 72. UAT-075：NFO更新保留信息并保证再次入库身份稳定

问题分类：`BUSINESS_CONTRACT / DOMAIN_ORCHESTRATION`

用户验收目标：所谓“更新”必须以原NFO为基底，修改ShelfDeck确实需要改变的字段，同时保留演员、外部ID、评分、系列/集合、标签、自定义字段及不能证明应删除的扩展信息；不能用更短的新文件替换丰富的原文件。与媒体现实绑定且已经过时的`fileinfo/streamdetails`等字段，可以按新成品现实更新或移除。

回归边界：演员块中的TMDB Person ID不能再次被当成电影ID或被丢失，持续保护`UAT-029`和`UAT-073`。ShelfDeck产出的NFO再次由ShelfDeck观察时，必须得到同一电影身份；不得把自己的合格输出判断为损坏、产生新的身份冲突或重复人物关系。

验收场景：以包含演员、`uniqueid`、豆瓣/TMDB/IMDb ID、rating、set、tag及自定义节点的丰富NFO作为输入，完成一次真实Formation→On-deck；逐字段对账证明应保留字段仍在、应更新字段与成品一致。再以该输出建立新的隔离Material Field，身份自动稳定解析，不要求人工确认且不产生重复人物。证据要求：`FACT`、`FS`、必要的`UI`。

关闭确认（2026-08-23）：007输出NFO为13,348字节，保留演员块、IMDb身份`tt1074638`与电影TMDB `37724`；演员Person ID `8784`未再被解析为电影ID，007无需人工确认并正常上架。损坏输入只重建可信字段，未把坏身份带入成品；相关结构与Round-trip专项测试通过。状态`REGRESSION PASSED / CLOSED`。

## 73. UAT-076：Related Artwork按可用性复用或外部获取

问题分类：`BUSINESS_CONTRACT / EXTERNAL_INTEGRATION`

用户验收目标：原材料中已有且合格的poster、fanart等Related Artwork应直接带入Workspace并随产品结算；只有缺失或损坏的目标图像才进入TMDB Artifact获取。详情必须说清“检查原海报、沿用原海报”或“未发现/不可用，下载海报”，不能统一写成含糊的“补齐资料”。

修复边界：Related Materials仍只作为引用随Candidate Package旅行，不获得独立Field Observation membership或控制锁；源文件只读。是否可用由Libra在既有责任内判断，不把该决定交给前端Projection。

验收场景：同一隔离Canary至少包含一部已有合格poster和一部缺少poster的影片。前者不得发起不必要的TMDB图片请求，最终文件与来源图像相符；后者成功获取并验证图像。两条详情均展示实际动作与结果。证据要求：`UI`、`FACT`、`FS`。

关闭确认（2026-08-23）：同一v11中，007和香火的poster均以`related_material_reference`复用，威尼斯惊魂夜缺少poster时才形成TMDB获取且结果`acquired`。真实详情显示“复用现有海报”；源目录前后不变，最终三部均上架。状态`REGRESSION PASSED / CLOSED`。

## 74. UAT-077：TMDB Artifact Handle必须在Provider调用前完整有效

问题分类：`EXTERNAL_INTEGRATION / DOMAIN_ORCHESTRATION`

用户侧现象：海报获取报`PLATFORM_INTEGRATION_HANDLE_INVALID`，但这并不是TMDB Credential或网络失败；Artifact Handle缺少`artifactKind`，运行时在真正发起TMDB请求前即正确拒绝。

修复边界：创建Artifact Work的边界必须冻结完整Handle，至少包含正确的integration、当前`configRevision`与`artifactKind`。既有Handle严格校验不得放宽；不得伪造Provider成功、不得把Secret下沉到Work或前端。`UAT-070`“创建新Work读取当前revision、单scope失败不击穿startup”的修复必须保持。

验收场景：对缺失海报的新Subject创建Artifact Work，FACT证明Handle完整且使用当前Integration revision，请求实际到达TMDB adapter并取得图片；错误Credential、网络错误与无图必须分别保留其真实错误码，不能再混成Handle invalid。服务安全重启不发生revision mismatch或startup outage。证据要求：`FACT`、`RESTART`、`FS`，真实页面展示最终结果。

关闭确认（2026-08-23）：commit `6cc38e2f2`在Artifact Intent创建边界冻结`artifactKind`并由当前Handle resolver验证。v11真实TMDB海报结果来自`tmdb:tmdb-main@1`，`PLATFORM_INTEGRATION_HANDLE_INVALID=0`、revision mismatch=0；同一库经服务自身`close()`完成优雅关闭和安全重启，subject/run计数与结果不变。状态`REGRESSION PASSED / CLOSED`。

## 75. UAT-078：Integration设置页如实呈现TMDB与豆瓣配置状态

问题分类：`USER_EXPERIENCE / PROJECTION_FRESHNESS / EXTERNAL_INTEGRATION`

用户验收目标：已保存且当前被运行时采用的TMDB、豆瓣配置，设置页不能看起来像“未配置”。页面应区分“未配置”“已配置但尚未验证”“当前可用”“最近验证失败”，且不能把配置存在与一次网络连通性混为一谈。

修复边界：Admin Web只读取正式Integration Admin Query，不读取本地Secret文件或猜测表单状态；API和页面不得回显API Key、Secret、Cookie等Credential。技术诊断可显示当前配置版本及最近验证结果，但普通状态文案优先表达用户可理解的结论。

验收场景：分别覆盖未配置、保存成功、重连后revision前进、可用、网络失败和错误Credential。刷新页面与安全重启后状态仍与运行时Handle现实一致，Secret不出现在DOM、网络响应或截图。证据要求：`UI`、`FACT`、`RESTART`。

关闭确认（2026-08-23）：commit `857df10e1`将最近验证Observation持久化为不含Credential的正式Command Receipt，设置页区分未配置、未验证、当前可用、最近验证失败和停用。v11当前提交版真实页面中TMDB与豆瓣均显示“当前可用”；DOM与证据JSON不含API Key、Secret或Cookie，优雅重启后状态保持。状态`REGRESSION PASSED / CLOSED`。

## 76. UAT-079：豆瓣评分按已解析身份重算并解释未匹配原因

问题分类：`BUSINESS_CONTRACT / PROJECTION_FRESHNESS / EXTERNAL_INTEGRATION`

用户侧现象：Formation中多部影片没有豆瓣评分，只显示`—`；用户无法区分尚未同步、身份未定、豆瓣无记录、同步失败或匹配失败。此前`UAT-001`、`UAT-023`、`UAT-025`、`UAT-056`、`UAT-063`、`UAT-068`、`UAT-069`虽分别修复过相关链路，当前新Field场景仍需以端到端结果重新资格。

修复边界：匹配输入以已解析的影片身份及规范化标题/年份为准，不直接使用带技术发布标签的原始文件夹展示名。新Subject形成、身份确认或有效Identity Evidence变化后，Resolution应自动重算；不得要求用户手工补当前保留UAT数据，也不得让Perception越界拥有Libra Subject。

验收场景：新隔离Field中覆盖自动匹配、人工确认身份后匹配、豆瓣确无记录、同步失败和候选不足。页面分别显示豆瓣评分或明确原因，不再以空白`—`吞掉状态；身份确认后无需重新添加Field或手工刷新数据库即可形成新Resolution。证据要求：`UI`、`FACT`，外部调用可审计。

关闭确认（2026-08-23）：commit `857df10e1`让Formation读取当前Perception Resolution并透传`resultKind/reasonCode`。v11三个新Subject均形成Resolution，结果为`found`或明确`no_matching_record`；页面用“豆瓣暂无匹配评分”等可理解文案替代空白`—`。对保留工作区未补历史评分；UAT-084逐行审计同时证明所有缺失评分均有状态或原因。状态`REGRESSION PASSED / CLOSED`。

## 77. UAT-080：Formation改为一张紧凑的完整媒体表

问题分类：`USER_EXPERIENCE / PROJECTION_FRESHNESS`

用户验收目标：媒体整理工作区只使用一张完整媒体表，不再把“当前、已完成、已结束”做成三张不同的表。状态可以筛选，但表结构保持一致。列表不能靠持续加宽单行承载细节。

确认列结构：媒体名称、评分及来源、目标收藏架、整理要求、当前进展、详情、用户操作、加急。媒体名称列只承担身份展示，不再混入评分、目标架、要求、状态和动作。`加急`不是一种用户操作，必须与`用户操作`语义分离；每一行媒体提供独立的紧凑加急控件，并明确区分未加急、已加急与当前不可加急。

既有能力基线：加急不是本轮新增功能。正式Admin Web已经通过`setRunExpedited`调用verified的`POST /v1/admin/formation/runs/:libraRunId/actions/expedite`与`cancel-expedite`；只对尚未Handoff B Accepted的active Libra Run开放。命令以精确Run state revision/digest和幂等Priority Intent提交，事务内把未终态Supporting Work与Event切换到`expedited_formation`；Scheduler与Resource Governor消费当前Run Execution Projection，合法replacement Run继承同一Intent，Handoff B Accepted后结束。`UAT-067`已经修复并关闭加急后既有Work replay的幂等冲突。本轮只迁移现有能力的UI位置和视觉表达，不重做Priority模型、API或调度器。

验收场景：桌面常用宽度与390px窄屏均可识别上述字段；长片名、长错误和多个操作不会把整行无限撑宽。待整理、整理中、需要处理、已完成与已结束默认都在同一张表中，状态筛选只改变当前可见行，不重复表头或复制多套Projection。逐行切换必须调用既有正式API并在刷新、重启后从`currentRun.priorityClass`恢复，不能使用前端本地状态冒充；已完成、已结束、frozen、suspended或已经Handoff B Accepted的媒体明确不可加急。加急、取消加急、已加急筛选、Priority-only既有Work replay、资源等待者重排、replacement继承和Handoff B终止均不得回退。证据要求：`UI`、`FACT`、`RESTART`、可访问性检查。

当前处理决定：单表、分列、紧凑、默认包含已结束媒体以及逐行独立加急控件均已确认；加急使用无图标的“加急/已加急”纯文字按钮，并统一使用ShelfDeck绿色状态，不引入额外强调色。该按钮必须复用上述已实现完整链路，Stub只用于视觉确认。不能退回三张表、把加急混入用户操作，或另造前端Priority状态。

Owner确认的前端基线：当前正式工作区中的`/formation?stub=1`是UAT-080与UAT-081共同采用的视觉、信息结构和交互基线。正式实现必须保持其一张完整媒体表、已确认列顺序与紧凑密度、状态筛选、绿色纯文字加急控件、单一“查看过程”入口、屏幕中央详情卡片及三段内容层级。实现工作只把Stub静态样本替换为正式Formation Projection和既有Admin API，并补齐加载、错误、分页、窄屏和可访问性状态；未经Product Owner再次确认，不得自行改成行内展开、多表、侧边抽屉、多个详情入口、不同强调色或另一套信息架构。Stub本身不作为业务FACT或UAT PASS证据。

关闭确认（2026-08-23）：commit `004c17ac4`按Owner确认Stub实现一张正式媒体表，列顺序为媒体名称、评分、目标收藏架、整理要求、当前进展、详情、用户操作、加急；既有状态筛选和正式加急API保留，加急为独立绿色纯文字控件。真实v11页面显示3条完成媒体共用同一表；390px下表容器横向滚动、页面本身不溢出，中心卡片在视口内独立纵向滚动。Admin Web 26/26与production build通过。状态`REGRESSION PASSED / CLOSED`。

## 78. UAT-081：Formation中心详情卡片透传三段正式事实

问题分类：`USER_EXPERIENCE / BUSINESS_CONTRACT / PROJECTION_FRESHNESS`

用户验收目标：每一行只有一个“详情”入口，点击后在屏幕中央弹出卡片；不在表格行内展开，也不分别放三个详情按钮。卡片按顺序展示“已接收的材料”“媒体整理”“验收与上架”。其中“媒体整理”是确认文案，不再使用“产品整理”。

事实边界：“已接收的材料”只展示Procurement完成并经Libra Intake接收的工作成果，例如接收了哪些媒体与Related Material、结果是否可用；Formation中的媒体都已完成Intake，因此不展示Field Observation的扫描文件数、当前目录、耗时或实时观察进度。“媒体整理”透传Libra实际步骤；“验收与上架”透传Handoff B与Arca事实。页面只组织显示，不创造跨域Global Plan、全局Task或前端拼凑的业务状态。

步骤文案：必须描述具体动作和结果，例如“检查原NFO”“更新NFO”“验证更新后的NFO”“检查原海报”“沿用原海报”或“下载海报”，不得只写“补NFO”“补齐资料”。技术错误码默认收在“技术诊断”中，主文案表达用户能采取的行动。

验收场景：至少以一部完成、一部Libra失败、一部Arca失败和一部需确认身份的影片见证。卡片逐项与正式Plan/Work/Event/Package/Offer/On-deck事实对账；刷新与重启后不漂移。证据要求：`UI`、`FACT`、`RESTART`。

关闭确认（2026-08-23）：commit `004c17ac4`把单一“查看过程”入口实现为屏幕中央卡片，并从正式Projection透传“已接收的材料 / 媒体整理 / 验收与上架”。v11的007详情明确显示“更新 NFO”“复用现有海报”和完成的收藏架验收；失败克隆v7的倩女幽魂详情将60个Related Material按角色计数汇总，步骤为“提交收藏架验收”而非误称已上架。状态`REGRESSION PASSED / CLOSED`。

## 79. UAT-082：Formation当前进展与失败态必须忠实可操作

问题分类：`PROJECTION_FRESHNESS / USER_EXPERIENCE / RECOVERY_CORRECTNESS`

用户侧现象：当前“分布进度100%”不能说明计划做到了什么；错误又可能被渲染成步骤完成，使《倩女幽魂》和《一场很没必要的春晚》等影片看起来只是停在那里。用户无法判断当前在做什么、在哪里失败、是否需要自己操作。

修复边界：列表“当前进展”只表达当前实际动作、已完成结果或真实阻塞，并给出可用操作；只有真实执行步骤具备可量化进度时才显示局部进度条，不再生成没有业务意义的全局100%。Projection从各Owner的durable Plan/Work/Event/Result读取，不能用外层Event成功覆盖业务Result失败，也不能把Libra完成误写成Arca上架完成。

故障证人：保留现场中《倩女幽魂》已完成Libra Package发布，但Arca因`CLEAN_ARCA_TARGET_ROOT_UNAVAILABLE`失败，页面应显示“媒体整理完成，上架失败/目标收藏架目录不可用”；《一场很没必要的春晚》在Libra conformance业务结果因`metadata_field_unmet`失败、没有Package/Offer且未进入Arca，页面不得显示“验证完成”。007身份未定时显示“需要确认影片身份”。技术码可折叠查看。

验收场景：以隔离克隆或确定性故障夹具覆盖running、completed、attention required、Libra business failure、Arca failure和可重试恢复。列表与详情一致；故障解除后状态由新事实推进，不靠前端假完成。证据要求：`UI`、`FACT`、`RESTART`。

关闭确认（2026-08-23）：commit `004c17ac4`让业务Result失败参与分类并修复启动时active Run的Owner reconcile。失败库只读克隆v7中，春晚conformance `metadata_field_unmet`被合法冻结为Run revision 3，列表显示“需要处理 / 本次整理已冻结，需要放弃后重新采购”，用户操作为“放弃本次整理”、加急禁用；中心详情将“验证整理结果”标为失败且显示尚未提交Arca。倩女幽魂独立显示目标收藏架目录不可用并提供“重试验收”。未编辑原保留库。状态`REGRESSION PASSED / CLOSED`。

## 80. UAT-083：同根第二Material Field只形成一次合法整理

问题分类：`BUSINESS_CONTRACT / DOMAIN_ORCHESTRATION / USER_EXPERIENCE`

用户验收场景：旧Material Field保持登记，不注销；旧Shelf已经按Shelf Deregistration合同结束并释放其精确Material Control。用户再添加一个指向同一Canary目录的新Material Field，期望合格材料能够重新进入Formation并正常整理，而不是因历史Field存在永久冻结。

验收结果：同一Physical Material在本轮只能形成一次有效Candidate/Subject/Libra Run与一次Control链，不得因两个Field观察同一路径而双重整理、竞争控制或生成重复Shelf Entry。若某材料仍被现行Control占用，应明确显示“仍被现有整理控制”，而不是无解释地停住；Control释放后应可由新Field触发一次合法流程。旧Field保持登记，源目录保持只读。

修复边界：不得引入global media business ID或跨Domain Store；Physical Material Identity、Field-local Material Binding与Material Control继续分离。实现可在Procurement既有Owner内选择确定性去重/资格裁决，但不能让两个Field同时拥有同一控制现实。

验收证据：只在新建隔离Canary中执行，不复用或改写保留UAT数据库。记录两个fieldId、同一物理路径的Observation/eligibility、Control取得与释放、唯一Run和最终唯一Shelf Entry；重启后不重复。证据要求：`UI`、`FACT`、`FS`、`RESTART`。

关闭确认（2026-08-23）：commit `b4e36d5c0`加入当前场景资格脚本与Admin Web合同。v11同时保留`formation-uat-field-a`和新增`formation-uat-field-b`，两者为不同fieldId但冻结同一endpoint、mount scope和root；最终只有3个Candidate、3个Subject、3个Run和3个Shelf Entry，对应三部电影各一次，没有双重整理。源文件前后快照一致，优雅重启后计数不变。状态`REGRESSION PASSED / CLOSED`。

## 81. UAT-084：当前Formation工作区逐片事实审计与问题分流

问题分类：`DOMAIN_ORCHESTRATION / PROJECTION_FRESHNESS / USER_EXPERIENCE`

审计目标：对当前保留Formation工作区中的每部影片逐行核对Subject、Identity、Libra Run/Work/Event、Package/Offer、Arca On-deck及页面Projection，解释为什么在当前状态、由谁推进、用户是否需要操作。范围至少包含007、《倩女幽魂2：人间道》《一场很（没）有必要的春晚》《威尼斯惊魂夜》《坠落的审判》，并覆盖页面当前全部行。

执行边界：本条首先是只读资格审计，不在保留现场补数据、伪造SQLite状态、重跑Observation或改变源文件。已知根因归入`UAT-074`–`UAT-083`；发现具有独立根因的新产品缺陷时，必须另立UAT，不把多个问题以一条“整理冻结”笼统关闭。暂态运行、环境故障和产品缺陷分别记录。

验收证据：形成逐片对账表，每行包含用户可见状态、真实Domain阶段、最后有效事实、阻塞/失败根因、可用恢复动作及对应UAT。所有页面行都有解释，且没有“无活动Work/Event却继续显示整理中”或“业务Result失败却显示完成”的未归类状态。证据要求：`FACT`、必要的`UI`；只读审计本身不要求修改当前影片。

关闭确认（2026-08-23）：只读审计脚本`formation-uat-084-audit.cjs`对失败克隆v7当前25行逐一读取Formation详情并与SQLite Owner事实对账，结果25/25 PASS：12条身份确认、9条历史`PLATFORM_INTEGRATION_HANDLE_INVALID`、1条历史`P5_SECRET_LEASE_INVOCATION_FAILED`、1条产品符合性失败、1条Arca验收失败、1条已完成。每行均记录用户状态、Domain阶段、最后有效事实、根因、恢复动作和对应UAT；`in_progress=0`，没有业务失败被标成完成，也没有未知类别。审计没有写数据库、重跑Observation或改变源文件。状态`FACT PASSED / CLOSED`。

## 82. UAT-085：豆瓣完整收藏同步失败后不能续传，部分数据被表现为普通未匹配

问题分类：`EXTERNAL_INTEGRATION / RECOVERY_CORRECTNESS / USER_EXPERIENCE / PROJECTION_FRESHNESS`

用户侧现象：在全新clean环境正确配置豆瓣并同步后，Formation仍有大量影片显示“豆瓣暂无匹配评分”。设置页的连接状态为当前可用，同步按钮也已恢复可点，用户无法判断本轮只取得了部分收藏记录，容易把数据未取得误认为影片身份或匹配规则失败。

现场证据（2026-08-23）：正式工作区`main@a2a0e40fc`，运行目录`F:\shelfdeck_test_zone\runs\clean-main-a2a0e40fc`。TMDB、Douban和MoviePilot均为active revision 1且最近验证passed；数据库`integrity_check=ok`，服务`helix-clean-v3` ready。本次诊断只读API、SQLite和Provider响应，没有触发新同步、修改记录或改变影片状态。

两次真实Douban Acquisition均先成功提交29页（page 0–28，每页15条，游标`0 → 435`），第30页`perception.source.acquire@1`连续3次以`failure_class=integration / P5_PROVIDER_TRANSPORT_FAILED`失败，随后Work与Acquisition正确收口为`failed`，`activeCount=0`。使用同一已配置账号对精确URL参数`start=435`进行一次有界只读诊断，Provider返回HTTP 403并将响应路径导向`/b`；这不是Integration未配置或Connection Proof失败。

当前clean库只有436条Douban Record，而此前同一账号完整基线约1547条。23个Formation Subject中14个Resolution为`found`、9个为`no_matching_record`；其中007、《短暂和平》《一场很（没）有必要的春晚》《倩女幽魂2：人间道》《坠楼死亡的剖析》《放·逐》《有话好好说》《立春》在现有436条中完全不存在，首要原因是后续收藏页没有进入Perception Store，不是这8部的匹配算法已证明失败。

《老笠》是独立的保护性未匹配：Douban Record已经存在，锚为`老笠\0 2015`，当前Subject为`老笠 (2016)`。现行Resolution要求规范化片名与年份同时成立，因此拒绝关联符合Identity保护；`UAT-085`不得通过放宽年份、模糊猜测或直接把这条记录写给Subject来提高表面命中率。若后续存在更强的跨Provider Identity Evidence，应另按正式身份合同评估。

与历史UAT的关系：`UAT-061`关闭的是“翻页失败后不重试、不收口，设置页永久正在同步”。当前实现已经有界重试3次、把失败页Work和Acquisition收口、令同步按钮恢复，因此不重开`UAT-061`。`UAT-079`关闭的是Resolution状态/原因透传和Identity变化后的重算，也不保证Provider完整收藏必然取得。本条是两者之间此前未覆盖的“完整Acquisition、续传和部分同步可见性”缺口。

初步诊断：当前页推进速度没有面向Provider拒绝的持久冷却；失败Acquisition终态后，新同步从空`initialCursorValue`重新抓取第1页，重复已提交的`0–435`并再次撞到相同Provider保护。虽有记录幂等和失败收口，但没有可持续的“从最后成功Cursor继续取得剩余收藏”路径。Settings只把`activeCount`用于“正在同步”按钮，没有向用户展示最新Acquisition的failed终态、最后成功游标、已取得记录数或“结果不完整”；Formation因此只能把缺失记录投影为普通`no_matching_record`。

业务影响：豆瓣评分是Acceptance Spec及后续Care决策的正式输入。部分同步若被误当成完整快照，会让真实已评分影片按无评分路径形成要求，且用户无法区分“账号没有这条评分”和“系统尚未取得这条记录”。反复从头同步还会增加Provider请求量并提高再次被拒绝的概率。

修复边界：

1. 遵守Provider限制，加入有界请求节奏、持久冷却和可审计的拒绝分类；不得绕过反自动化保护、伪造成功或无限快速重试。
2. 已提交页和Source Cursor继续由Perception Owner持久化；重试或后续授权同步必须能够从最后成功游标继续，不能删除已落记录、伪造SQLite或每次无条件从第1页重放。
3. Acquisition失败事实仍须终态可见；Settings应以用户语言显示“同步未完成”、最后成功进度与可恢复动作，不能仅因`activeCount=0`表现得像完整成功。
4. 新Record提交后必须精确唤醒受影响的Subject/Entry Resolution；不得让Perception越界拥有Libra Subject或Arca Shelf Entry。
5. `no_matching_record`必须区分“完整数据中无匹配”和“Acquisition不完整，尚不能下结论”。《老笠》的年份冲突继续保持显性保护，不纳入续传成功率冒充自动匹配。

验收证据：在新的隔离clean Canary中使用真实Provider完成有节奏的多页Acquisition，证明所有页提交、末页`hasMore=false`、Acquisition terminal completed，且安全重启不重复已提交页。另以确定性403/限流夹具证明拒绝后不忙等、不从头重放，冷却或恢复后从最后成功Cursor继续；Settings与Formation分别显示部分同步、失败原因和恢复后的Resolution变化。真实Provider证据记录请求页数、游标、终态和记录计数，不记录Cookie。证据要求：`FACT`、`UI`、`RESTART`；若Provider当时持续拒绝，不得伪造完整成功。

当前处理决定：commit `290883837`已实现持久游标续传、失败Acquisition新谱系、Provider限速/403重试以及同步完整性UI。最终隔离运行
`F:\shelfdeck_test_zone\runs\UAT-20260824-031004-228f39a37`中，首次真实Acquisition已提交29页、revision 29、cursor 435，随后仅作
3次有界`P5_PROVIDER_TRANSPORT_FAILED`并终态failed；人工同步建立的successor从精确revision 29/cursor 435继续，没有从0重放，仍只作3次
有界失败。终态后157秒内总Acquisition保持2、active 0，没有第三条自动重试风暴；安全重启后状态不漂移。Provider持续拒绝，因此没有伪造
`hasMore=false`或完整成功。FACT/RESTART已通过；本轮未取得新的认证后Admin Web渲染截图。2026-08-24 Product Owner明确接受现有证据并
授权关闭，状态`OWNER ACCEPTED / CLOSED`；不追记或伪造UI证据。

## 83. UAT-086：候选策略未通过被误报为整个媒体整理失败

问题分类：`PROJECTION_FRESHNESS / BUSINESS_CONTRACT / USER_EXPERIENCE`

用户侧现象：真实转码已经开始，Formation详情中的转码步骤也显示`running`，但同一媒体的外层分类却是“需要处理”，当前进展显示“媒体整理执行失败，需要处理”。《锡尔弗顿之围 (2022)》和《养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1》均出现这一自相矛盾的状态。

现场证据（2026-08-23）：正式工作区`main@a2a0e40fc`，运行目录`F:\shelfdeck_test_zone\runs\clean-main-a2a0e40fc`。调查期间《锡尔弗顿之围》的FFmpeg、Transcode Event和Attempt均为执行中，无failure code；随后该转码成功并完成上架。《养蜂人》的Transcode Event与Attempt同样为执行中，无失败或blocked Supporting Work。调查只读SQLite、进程命令行和Formation Projection，没有停止进程、修改数据库或改变影片。

两部影片都存在一个已经成功提交的`libra.product_media.verify@1` Event，其业务结果用于拒绝当前候选：锡尔弗顿的direct候选为`result=failed / video_codec_unmet`，随后正常进入转码；养蜂人的remux候选为`result=failed / max_size_exceeded`，实际约64.0 GB而上限约15.0 GB，随后正常进入转码。这些是媒体生产策略选择事实，不是Event执行失败或Run终态失败。

精确根因：`formation-query.js`中的`hasBusinessFailure()`扫描当前Run的全部历史Works，只要任一Event Result含`result='failed'`或`resultKind='not_available'`就判定整体业务失败；`classifyFormation()`和`nextAction()`又让该判断优先于当前开放Work。因此旧候选验证结果覆盖了后续正在执行的Transcode责任。正在运行的Event尚无Result，按Result提交时间选择“最新失败”也会持续命中旧验证结果。

与历史UAT的关系：`UAT-082`关闭的是终局Libra business failure或Arca failure不能被渲染成完成。本条是其后真实多策略链暴露的独立反向缺口：正常候选淘汰不能被渲染成终局失败。不得通过忽略全部业务Result来修复，否则会回退`UAT-082`。

修复边界：

1. Formation必须区分候选级Verification未通过与当前责任的终局失败；已存在可推进或正在执行的后续策略时，外层状态以当前开放责任为准。
2. direct、remux或前一ordinal候选未通过的事实可以保留在详情中，但不能让列表进入`attention_required/blocked`，也不能开放错误的用户恢复动作。
3. 真正failed/blocked的Supporting Work、没有后续策略的终局Conformance失败、frozen/suspended Run及Arca失败仍须按既有合同显性展示，不得被开放Work或通用“整理中”吞掉。
4. Projection只能解释Owner的Plan/Work/Event/Result，不改变Libra媒体生产策略链或把候选选择决策移入Projection。

验收证据：在新的隔离Canary中分别覆盖direct→transcode running、remux→transcode waiting-for-resource/executing，以及前一转码候选未通过后下一ordinal继续执行。列表必须显示“整理中”和当前转码动作，详情保留前候选未通过的具体原因但不宣称整个整理失败；最终成功后进入收藏架。另以真实终局Conformance失败和失败Work作反例，确认仍显示需要处理及正确恢复动作。刷新和安全重启后状态不漂移。证据要求：`UI`、`FACT`、`RESTART`。

当前处理决定：commit `4ebcd44e4`已修正当前successor Work与历史候选失败的Projection优先级。最终隔离运行中Formation保持
17 completed / 5 attention_required / 1 in_progress；当前Transcode即使存在旧候选未通过Result仍归入in_progress，受控重启后同一责任继续推进，
没有被旧failed Work/Result覆盖。真正冻结的5项仍保持attention_required。FACT/RESTART已通过；本轮未取得新的认证后Admin Web渲染截图。
2026-08-24 Product Owner明确接受现有证据并授权关闭，状态`OWNER ACCEPTED / CLOSED`；不追记或伪造UI证据。

## 84. UAT-087：转码执行没有真实可量化进度

问题分类：`DOMAIN_ORCHESTRATION / PROJECTION_FRESHNESS / USER_EXPERIENCE`

用户侧现象：《锡尔弗顿之围》和《养蜂人》已经由本机FFmpeg执行GPU转码，但Formation媒体整理详情只有“正在执行”，没有进度条、完成比例或预计剩余时间；用户无法判断转码是在持续推进还是已经停死。

现场证据（2026-08-23）：锡尔弗顿Transcode Event在约5分钟实际执行期间`current_progress_revision=NULL`且`fx_event_progress`为0行；随后成功结束。养蜂人调查时的Transcode Event和Attempt仍为`executing`，同样没有任何Progress行。对照同一养蜂人Run此前的Remux Event已产生55个Progress revision，证明Foundation Progress Store和Reader并非整体不可用。两条真实FFmpeg命令都没有`-progress pipe:1`。

精确根因分为两层：第一，`media-production-capability-ports.js`的Remux请求会传`reportProgress: context.reportProgress`，Transcode请求却遗漏该字段，导致下游`executeTranscode()`关闭FFmpeg progress adapter。第二，即使只补上传递，当前`clean-media-production-effect-port.js`固定报告`mode='indeterminate'`、`currentValue/totalValue=NULL`，而Formation Admin Web只为`determinate`样本渲染进度条，因此仍不能满足真实进度展示。

修复边界：

1. Transcode Capability必须把当前Event Attempt的Progress Reporter传给Media Effect Port；FFmpeg进度继续通过Foundation写入`fx_event_progress`并更新Event current revision，不能建立Libra私有进度表。
2. 使用已冻结、可审计的Source Probe时长作为Transcode正式输入，在执行侧把`out_time_us`换算为单调的`currentValue/totalValue`、rate和ETA；前端不得根据墙钟、文件大小或动画自行估算业务进度。
3. 单遍和两遍编码都必须形成单调的整体进度；两遍编码第二遍不能从零回退并触发`P4_PROGRESS_REGRESSION`。terminal成功时应形成完成样本，失败时保留最后样本并显示真实失败。
4. Formation列表当前进展与中心详情卡片读取同一最新Progress事实；等待资源可以显示明确等待态，真正开始编码后必须显示可量化进度。无可靠总时长时允许明确的indeterminate活动态，但不得伪造百分比。
5. Progress报告、Projection重建或页面刷新异常不得杀死FFmpeg、击穿服务或改变媒体生产Outcome；继续保护`UAT-027`的恢复边界。

验收证据：以新的隔离Canary执行至少一个真实单遍转码和一个确定性两遍转码见证。执行中SQLite持续形成非空、单调Progress revisions，Formation列表与详情显示一致的真实进度且能观察到中间值；完成时到达terminal完成状态。另覆盖等待GPU资源、执行失败、Progress Reporter拒绝回归和服务安全重启后最新持久样本仍可读取。证据要求：`UI`、`FACT`、`RESTART`；不得以手工构造前端Progress或直接写SQLite关闭。

当前处理决定：commit `0cc5932cd`已接入Capability Progress Reporter、FFmpeg真实媒体时间与Formation定时刷新。最终运行的受控重启后，
真实Transcode以新Attempt恢复，10分钟窗口内durable progress revision 77→194、8.4%→42.1%，另一路进程证据为9.3%→43.0%、rate
3.42–3.57x、ETA 1,665,801→1,017,376ms，全部单调；Formation Projection revision同步推进。旧Attempt保持completed/failed，
没有重复Effect。FACT/RESTART已通过；本轮未取得新的认证后Admin Web渲染截图。2026-08-24 Product Owner明确接受现有证据并授权关闭，
状态`OWNER ACCEPTED / CLOSED`；不追记或伪造UI证据。

## 85. UAT-088：同根Field与Shelf的Mount Scope分裂导致成品重复进入Procurement

问题分类：`BUSINESS_CONTRACT / DOMAIN_ORCHESTRATION / PLATFORM_INTEGRATION`

用户侧现象：用户按预期先把同一Canary根目录登记为Material Field，再把该目录登记为Shelf Physical Target。整理后的Shelf成品随后又被Field观察为新材料，Candidate、Subject、Work与Event持续增长，表现为“同一批影片不断重新整理”。同根配置本身是SSOT明确支持的场景，不能通过前端拒绝来规避。

现场证据：Field与Shelf虽指向同一`F:\shelfdeck_test_zone\canary_test`，却分别持有`local-mount-ff976…`与`local-mount-9700…`；17个inode、size与fingerprint均相同的物理文件因此得到不同Material Key。`platform_mount_scope_revisions`为0，证明Platform Mount Scope Registry未被clean host装配。周期Observation把Subject从23增至39，Work/Event近乎翻倍。

修复边界：由Platform技术Registry唯一解析并冻结local root到stable Mount Scope；Field与Shelf共同调用，注册次序不影响结果。UI不得自造scope/endpoint。Procurement Eligibility、Material Control与Arca Final Inventory继续按既有Owner合同工作；启动时对活动引用fail-closed验证，不创建global media business ID，也不禁止合法同根配置。

验收证据：新Canary按“先Field、后Shelf”的本次原顺序配置同一根，证明两者scope一致；Shelf成品只投影为`finished_goods`并被后续Extraction排除。跨安全重启、至少两个Observation周期，Candidate/Subject/Run/Shelf Entry不增长、不重复。证据要求：`UI`、`FACT`、`FS`、`RESTART`。

当前处理决定：commit `290883837`已装配Platform Mount Scope Registry并完成注册次序、重启fail-closed与同根E2E专项回归。最终Canary按
“先Field、后Shelf”把同一根冻结为同一`local-mount-b4257a…@1`；完整运行及重启后Candidate=23、Subject=23、Shelf Entry=17，
duplicate Candidate Package=0、finished-goods recandidate=0，10分钟监控全窗计数不增长。FACT/FS/RESTART已通过；本轮未取得新的认证后
Admin Web渲染截图。2026-08-24 Product Owner明确接受现有证据并授权关闭，状态`OWNER ACCEPTED / CLOSED`；不追记或伪造UI证据。

## 86. UAT-089：Arca同步大文件staging阻塞Admin Web

问题分类：`PERFORMANCE / RESOURCE_CAPACITY / USER_EXPERIENCE`

用户侧现象：真实上架2–20GB媒体时，浏览器并非永久卡死，而是在完整时间窗口内响应极慢或请求超时；Health与Admin API同时受影响。

现场证据：API监测捕获多个10秒全局超时窗口，时间与9GB、2GB、20GB Arca stage精确重合；SQLite只读仍为3–11ms且无busy/lock。调用链最终进入`clean-arca-inventory-port.js`的`copyFileSync`，在Node主线程完成整个文件复制。

修复边界：保留immutable staging intent、确定性同卷临时槽、复制后bounded fingerprint、原子rename及Effect recovery；只把实际大文件I/O改为可等待的异步filesystem effect，不把Arca Decision/Commit权力移到Platform或前端。

验收证据：确定性copy gate证明复制挂起时Event Loop仍可服务；真实Canary大文件上架期间Health p95≤250ms/p99≤500ms、Admin API p95≤1s/p99≤2s，零10秒超时；中断后重启可从精确临时槽安全恢复。证据要求：`FACT`、`PERFORMANCE`、`FS`、`RESTART`。

当前处理决定：commit `01204fe65`先把Stage改为可等待异步复制；commit `228f39a37`进一步采用与历史Mirex同型的原生
`fs.promises.copyFile`，避免JavaScript 4 MiB read/write completion loop。真实61成员Settlement中Stage为21.769秒、总耗时96.398秒，
Result最大54,165 bytes且没有重复Effect。15分06秒全窗Health p95 136.0ms/p99 222.0ms、Admin p95 184.1ms/p99 243.4ms，
零timeout；重启后10分钟资源窗口Health p95 22.001ms/p99 54.818ms/max 110.503ms。保留staging、验证、原子rename和恢复合同不变。
独立API窗口600.049秒覆盖20个30秒Reconcile周期：Health p95/p99/max为5.047/78.794/97.994ms，Admin为
122.323/130.305/134.264ms，1556样本零error、零timeout、零≥500ms，没有周期黑窗。状态
`PERFORMANCE/FS/RESTART PASSED / CLOSED`。

## 87. UAT-090：软等待、后台饥饿与终态Intake重扫造成持续高CPU和写放大

问题分类：`PERFORMANCE / EXECUTION_SCHEDULING / RECOVERY_CORRECTNESS`

用户侧现象：没有FFmpeg时Node仍长期占满一个逻辑核心，Admin Web明显变慢；大量媒体处于资源等待，Field Observation与Intake又反复处理既有历史。

现场证据：Resource Governor对未变化waiter每100ms重写`fx_resource_defer`与Event；Scheduler先按Priority Class排序，使Supply层“最低后台进展”在已选中后台Event之后才判断，实际不可达；`pending-intake-offers`每30秒从历史Outbox头部扫描，忽略Libra已经提交的Handoff A Receipt，现场形成107条`P8_ACCEPTANCE_CONTINUITY_BASIS_STALE`重放失败。

修复边界：未变化soft waiter只保留首次durable fence，释放资源仍唤醒host，已过期fence作为重启安全网；Scheduler不改Owner Priority Class，在没有`safety_liveness`或`handoff_acceptance`可运行项时提供每60秒一次background minimum lane；Libra fallback仅排除已有终态Receipt的Offer，保留Decision已写但Receipt未写的crash gap。不得用内存黑名单、删历史Outbox或吞掉真实失败。

验收证据：32个waiter持续60秒时durable行与写次数保持稳定，release到start≤500ms，重启permit为0且waiter可重建；持续normal/expedited负载下background在无保留车道竞争时≤60秒获得一次调度；1000个终态+5个pending Offer跨3轮reconcile只访问pending且终态Work/status/result零重放。真实Canary同时记录Node CPU、Event Loop lag、SQLite WAL/write rate与API延迟。证据要求：`FACT`、`PERFORMANCE`、`RESTART`。

当前处理决定：commit `a3d62ca55`完成第一轮修复，commit `290883837`关闭Permit异常释放、最低后台机会单一归属、soft waiter写放大与终态
Intake运行期过滤；commit `4d8bab651`、`72c9139ad`、`5e526e6e7`与`228f39a37`继续收口Formation fallback、Settlement和19个周期
Reconcile scope的Event Loop让渡。最终真实Acceptance Work为31，zero-attempt=0，首次Attempt延迟25–1084ms、平均680.71ms；P8=0，
无waiting-resource churn。重启后10分钟Node machine CPU平均0.446%/最大5.667%，DB只增长20,480 bytes且WAL不变，所有defer签名全窗稳定。
状态`FACT/PERFORMANCE/RESTART PASSED / CLOSED`。

## 88. UAT-091：Process Work取消遗留Resource Defer导致服务无法重启

问题分类：`RECOVERY_CORRECTNESS / EXECUTION_SCHEDULING / OPERATIONAL_SAFETY`

用户侧现象：最终Canary完成长时间复测后执行受控服务重启，端口未能恢复；Startup Recovery报告
`P4_EXECUTION_HOST_RECOVERY_BLOCKED`，即使被中断的FFmpeg Effect本身已经形成合法failed恢复点，服务仍被整体阻断。

现场证据：只读三路审计一致定位到旧Remux Event `libra-remux-media-event-61b6…`。其Event、Work与Work Attempt已在Run replacement时因
`LIBRA_RUN_SUPERSEDED`变为cancelled，但`volume_read`和`volume_write`两条`fx_resource_defer`仍为waiting，且Event保留retry时间。
Startup Recovery因此产生两条`RESOURCE_DEFER_STATE_DRIFT` hard finding。被受控停止的当前Transcode Event则为
`waiting_for_external + completed/failed Attempt + failed Effect`，按正式恢复合同合法，不是启动阻断源。

精确根因：`WorkLifecycle.cancelProcess()`在同一Foundation事务中取消Event、Attempt和Work，却没有拥有或更新Resource Defer Store，
也没有清除Event retry fence。同进程运行时内存waiter被替换流程掩盖，只有下一次fail-closed启动检查才暴露持久漂移。所有调用
`cancelProcess()`的Libra/Arca替换或围栏路径均存在同类风险。

修复边界：取消事务必须原子执行Event→cancelled、`retry_at_ms=NULL`及所有关联waiting defer→cancelled；不得在事务后单独调用Governor
制造崩溃窗口。历史库只允许对“Event已经不可逆终态”这一可证明集合执行确定性、一致性修复，并为每个Event追加Foundation Audit；孤儿Defer、
非终态Event漂移及其他未知状态继续由Startup Recovery fail-closed，不得作为fallback吞掉。

验收证据：commit `0bc45ed98`加入原子取消、CAS fence、历史终态修复审计、事务回滚与Startup fail-closed回归。专项24/24通过；完整
Service测试320 pass/18个环境skip/0 fail，Admin Web production build通过。未经手工改SQLite，原失败库由同一代码启动为health ok /
`normalSupplyAllowed=true`；两条Defer均为cancelled、Event retry为NULL，审计Evidence存在，terminal/orphan waiting defer、duplicate Effect、
committed Effect + executing Attempt均为0，`integrity_check=ok`。Candidate/Subject/Shelf Entry仍为23/23/17，业务事实未被迁移改写。

当前处理决定：`FACT/RESTART PASSED / CLOSED`。证据位于最终运行`monitoring/restart-recovery-db-analysis.json`、
`startup-recovery-readonly-audit.json`、`post-controlled-restart-db-audit.json`和`post-restart-db-monitor.json`。

## 89. UAT-092：缺演员的NFO绕过补齐并在Libra内部验收冻结

问题分类：`BUSINESS_CONTRACT / DOMAIN_ORCHESTRATION / EXTERNAL_INTEGRATION`

用户侧现象：`一场很（没）有必要的春晚 (2022)`和`全面失控：特大号邮轮危机 (2025)`在Formation显示“需要处理”。这不是Arca上架失败，
而是Libra内部Product Conformance以`metadata_field_unmet`拒绝产品并冻结Run；缺口均为演员。

现场证据：两部影片冻结Acceptance Spec都要求`actor`。原始Material Field NFO包含标题、年份、剧情等描述信息，但没有任何`<actor>`；对应
Metadata Observation只采用Related NFO，Media Cast关系数为0，没有创建TMDB Metadata Work。当前NFO renderer又只接收
`ProductMetadataDraft + SidecarProfile`，即使Provider Observation取得`peopleHints`，也无法把新演员写入更新、重建或新建NFO。

精确根因：演员有意不属于`ProductMetadataDraft.descriptiveFacts`，而属于独立`MediaCastDraft/MediaCastFact`；但Metadata阶段的ready判断只检查
普通描述字段，错误地把“描述齐全但演员为空”视为ready。Sidecar capability也没有接收Media Cast输入，导致事实模型与成品NFO序列化之间断链。

业务影响：Acceptance Spec要求演员时，原NFO只要缺演员就会稳定重现无效流程：跳过可用TMDB补齐、生成空Media Cast、在末端第一次验收失败后冻结。
用户只能看到需要处理，实际上系统具备外部补齐能力却没有使用；即使只修ready判断，输出NFO仍会继续缺演员，形成内部事实与成品不一致。

修复边界：演员继续由`MediaCastDraft/MediaCastFact`拥有，不得重新混入普通描述字段。若Spec要求演员，Metadata规划必须把现有NFO的
`peopleHints`纳入完备性判断；NFO没有演员时，即使普通描述字段已齐，也必须创建冻结当前Integration revision的Provider Work。Sidecar render必须显式接收
同一Metadata Observation Basis形成的`MediaCastDraft`：可用原NFO按“未坏则更新”保留未知/丰富字段及已有演员，仅追加未出现的强身份演员；坏NFO重建、
缺失NFO创建时写入演员姓名和可用TMDB Person ID。不得把演员Person ID解析为影片ID，不得用前端或Conformance fallback伪造通过。

验收标准：至少覆盖“描述齐全、演员为空”的Related NFO触发Provider，Provider演员进入Media Cast，更新/重建/创建NFO均输出演员，已有强身份演员不重复且
原丰富字段不丢失；同一Run应在Product Conformance前完成这一可修复缺口，不产生`metadata_field_unmet`冻结。UAT-029、UAT-073、UAT-074、
UAT-075相关回归必须同版通过。

验收证据：Metadata专项新增“描述齐全但演员为空”场景，证明Related NFO之后仍创建冻结当前Integration revision的Provider Work、
`requestedFields=[]`不阻止演员获取、Provider仍无演员时保持unresolved；NFO专项证明更新保留原评分、合集、标签、自定义字段及既有演员强身份，
只追加缺失演员，坏文件重建和缺失文件创建均写入姓名与TMDB Person ID。Product Fact/Conformance与两条真实链路回归同版通过；完整Service
`npm test`为320 pass / 18 skip / 0 fail。所有测试TEMP/TMP/TMPDIR均位于
`F:\shelfdeck_test_zone\runs\UAT-20260824-uat092-dev\tmp`。

当前处理决定：代码与自动化回归已完成，状态`CODE/REGRESSION PASSED / REAL CANARY PENDING`。尚未用全新真实TMDB Canary取得两部原问题影片的
Formation/FACT/FS终态，因此不提前标记UAT PASS/CLOSED，也不修改保留的现场数据库。

关闭确认（2026-08-24）：真实Canary `UAT-20260824-210652-fd1e1190e`中，`全面失控：特大号邮轮危机`
通过cast-only TMDB请求取得8名演员、生成含演员的NFO并进入Arca；`一场很（没）有必要的春晚`同样实际执行了
cast-only请求，TMDB合法返回零演员，因此没有伪造Media Cast或进入末端Conformance。后者的零演员后继活性缺口由
UAT-106独立登记并关闭。UAT-092原命题的Metadata规划、TMDB调用、Media Cast和NFO接线已取得FACT/UI/RESTART证据，
状态`FACT/UI/RESTART PASSED / CLOSED`。

## 90. UAT-093：Douban缺year强制详情查询阻断同步，年份关联校验全面取消

问题分类：`BUSINESS_CONTRACT / EXTERNAL_INTEGRATION / RECOVERY_CORRECTNESS / PROJECTION_FRESHNESS`

用户侧现象：用户再次点击同步后，设置页仍显示400多条；当前准确值为435，Formation后续影片继续没有豆瓣评分。

现场证据：保留运行`F:\shelfdeck_test_zone\runs\UAT-20260824-031004-228f39a37`中，最新Acquisition从
revision 29 / cursor 435正确续传，但page Work三次以`P5_PROVIDER_TRANSPORT_FAILED`失败且零page commit。精确只读诊断证明
collection `start=435`返回200、15条并存在next cursor 450；其中《网诱惊魂》Douban Subject `27608279`列表行没有year，
对应Subject详情返回404。当前Adapter把用于补year的详情404提升为整页Transport Failure，因此永久卡在同一cursor。

Product Owner决定：year仅保存和展示，全面退出User Perception评分关联；同步不得为了year或alias强制查询Subject详情。
collection页的Douban ID、title、rating与watched事实足以形成合法Record，缺year不得阻断page commit。Resolution优先明确
Provider Identity和Target Anchor，最后使用规范化title exact；year既不接受也不否决关联。同强度不同评分Record仍形成
`strongest_value_conflict/not_found`，不得模糊匹配或选择第一项。

验收标准：缺year且详情即使会404的collection行不产生详情请求，整页Record和cursor正常提交；历史仅有`title_year` Anchor的
immutable Record可以通过可重建title Projection参与新规则，原Record不改写；相同title、不同year的Subject得到相同title关联结果；
Provider/Target强身份、值冲突、幂等、断点续传和Acceptance Spec消费合同同版通过。真实保留现场须从435推进到至少450，且不是
手工修改SQLite或跳过整个collection行。

验收证据：H1 Provider、Perception Store/Resolution/Acquisition、真实形态Douban分页、Formation与Acceptance Spec专项共84/84；
完整Service`npm test`为320 pass / 18 skip / 0 fail。自动化证明缺year时只发collection请求、Record拥有title而无`title_year`也合法；
历史`title_year` Record可与不同year的同名Subject形成title-only found。所有TEMP/TMP/TMPDIR均位于F盘保留运行的`temp-uat093`。

关闭确认（2026-08-24）：保留现场未经SQLite修改，从上一版全部终态Execution Plan安全恢复到当前Catalog；未知Catalog或任一
非终态Attempt/Event仍保持fail-closed。使用既有真实账号再次同步，Acquisition从cursor 435连续提交75页，最终Record总数1547、
cursor revision 104并进入terminal complete。《网诱惊魂》Record合法提交强`provider_identity`和中等`title` Anchor，没有
`title_year`；未再因Subject详情404失败。SQLite integrity为ok，服务health ok / `normalSupplyAllowed=true`。
状态`FACT/RESTART PASSED / CLOSED`。

## 91. UAT-094：Aftercare 目标体积上限不能变成扩容目标

问题分类：`BUSINESS_CONTRACT / MEDIA_PRODUCTION / RESOURCE_CAPACITY`

用户侧现象：评分刷新触发Aftercare后，原本约1.9GB的影片被转成6–8GB；Shelf Standard的`maxSizeBytes`被错误理解为“尽量填满”的目标，而不是不可超过的上限。

精确根因：Arca Aftercare按`maxSizeBytes`直接计算视频码率，没有以当前Primary实际大小封顶；Probe Evidence还丢失音轨码率，使估算进一步偏大。这是Aftercare本域独立缺陷，不重开已关闭的Libra `UAT-059`。

修复边界与验收：Aftercare自己的冻结Strategy必须以`min(sourceSizeBytes,maxSizeBytes)`形成预算，保留音轨实际码率Evidence；不得调用或共享Libra生产状态机。覆盖小源HEVC修复、大源压缩、无size上限及不可行预算，证明修复产物不因上限而放大且最终符合Standard。

关闭确认：全新`UAT-20260825-aftercare-final-v5`中原AVI为731,172,864 bytes，真实Aftercare输出MKV为728,533,253 bytes，没有因上限扩容；重启后Inventory与文件大小不变。状态`FACT/FS/RESTART PASSED / CLOSED`。

## 92. UAT-095：Aftercare媒体符合性与输出完整性检查不完整

问题分类：`BUSINESS_CONTRACT / PRODUCT_CONFORMANCE / SAFETY`

用户侧现象：Aftercare可能把不具备要求主音轨、错误媒体形态或流集合受损的成品判为健康并关闭Case。

精确根因：当前Conformance只检查视频Codec、容器、扩展名、4K和大小，遗漏`acceptedPrimaryAudioClasses`、`mediaForm/discTopology`，且取第一视频流而不是default-first；输出验证也没有核对音轨、字幕、时长和默认流连续性。

修复边界与验收：按冻结Standard执行default-first完整检查；缺少当前Aftercare能力不能安全生成的高质量音轨或媒体形态必须`attention_required`，不得创建伪自动修复Case；Remux/Transcode输出须核对duration、default视频、音轨及字幕集合。覆盖五星音轨、原盘形态、多视频流和流丢失反例。

关闭确认：专项覆盖default-first、多视频、音轨/字幕/时长丢失和媒体形态反例；v5真实转码先形成Workspace verification再提交Inventory，最终Conformance为healthy，重启不重复验证或提交。状态`FACT/FS/RESTART PASSED / CLOSED`。

## 93. UAT-096：Aftercare NFO必须遵循“坏则重建、没坏则更新”

问题分类：`BUSINESS_CONTRACT / METADATA_INTEGRITY / USER_DATA_PRESERVATION`

用户侧现象：现有合法NFO缺少新字段时不会进入更新；一旦触发修复又会生成只含title/year/plot/tmdbid的极简NFO，原评分、合集、标签、自定义字段、演员及强Person ID可能丢失。

精确根因：当前只用`<movie>...</movie>`首尾正则判断健康，只识别missing/corrupt；renderer始终从空文档重建，没有消费完整Accepted Product Facts和Media Cast。

修复边界与验收：Aftercare本域对NFO做有界真实XML解析与语义检查；缺失=create，技术或内容损坏=rebuild，合法但缺项/过期=update。Update必须保留未知/丰富字段和既有强演员身份，只更新Shelf Standard拥有的字段；不得返回Libra补资料。与`UAT-074/075/092`原则同版回归。

关闭确认：`UAT-20260824-224753-aftercarefix`真实完成合法NFO update并保留丰富字段；独立坏XML Canary真实完成rebuild并保留8名演员与电影TMDB身份。专项与重启均保持唯一Inventory。状态`FACT/FS/RESTART PASSED / CLOSED`。

## 94. UAT-097：Aftercare Artifact必须先验证再进入Inventory

问题分类：`EXTERNAL_INTEGRATION / PRODUCT_CONFORMANCE / ATOMICITY`

用户侧现象：非空但不可解码的海报、或只具有XML外壳的NFO，可能被直接物化并提交Inventory，事后Reassessment才发现问题。

精确根因：Binary Acquire只检查非空bytes，图片检查仅魔数；NFO/Poster没有显式Verified Artifact步骤。真实Poster路径还用历史Metadata Fact的旧Integration revision，并把Arca操作Handle交给只接受Libra操作的Adapter。

修复边界与验收：Case/Work创建边界冻结当前Provider Integration revision和`artifactKind=poster`；在任何Materialize/Inventory Commit前形成Arca拥有的显式Artifact Verification Result，NFO执行parse+semantic，图片执行有界真实decode。坏字节、revision前进和验证中断均不得改变Inventory/Control；真实TMDB海报修复须通过。

关闭确认：`UAT-20260824-224753-aftercarefix`移走海报后真实使用当前TMDB Handle获取、解码验证、物化并复验健康；坏图、坏XML、revision漂移与验证中断反例均在Inventory前fail closed。状态`FACT/FS/RESTART PASSED / CLOSED`。

## 95. UAT-098：Aftercare每个正式效果必须重验当前Care Basis并安全停线

问题分类：`RECOVERY_CORRECTNESS / AUTHORIZATION_FENCE / DOMAIN_ORCHESTRATION`

用户侧现象：Standard、Placement、Identity、Decision Fact或Reservation在转码/物化/删除过程中变化时，旧Case仍可能继续写文件、提交Inventory或关闭。

精确根因：Foundation运行时的通用Fence Validator当前只回显valid；Aftercare仅在Event入口读取一次active Case，Basis变化时Coordinator又直接终结Case而不cancel/drain执行中Work。

修复边界与验收：不修改Owner/Handoff；由Arca在Event开始和每个workspace/material/control/destructive/domain commit边界重验当前Care Basis与修改授权。变化后取消未开始Event、执行中到安全点停止、回收已声明临时材料，再形成可审计invalidated结果；旧Case不得发布新Handle或提交。逐窗口故障注入并跨重启验证。

关闭确认：逐效果窗口的authority变化、Reservation竞态、物化回滚与Settlement逐删除重验均通过；v5真实链在未变化Basis下完成，安全重启后无迟到Handle、重复Effect或活动资源。状态`REGRESSION/REAL CHAIN/RESTART PASSED / CLOSED`。

## 96. UAT-099：Repair必须完成Settlement后才能Reassessment和Case Closure

问题分类：`DOMAIN_ORCHESTRATION / DESTRUCTIVE_SAFETY / ATOMICITY`

用户侧现象：Inventory刚提交但旧材料Settlement仍等待或失败时，Case可能已经显示resolved；随后Settlement因找不到active Case反而失败并遗留旧材料。

精确根因：Coordinator把存在Inventory Commit误当成整个Repair Work完成；删除Approval只是Projection临时构造，没有持久`active → consumed|stale`生命周期。

修复边界与验收：推进条件必须是精确Repair Work（包含Settlement）整体succeeded；Approval按exact scope和Care Basis持久化，Basis变化即stale，删除提交时原子consume。覆盖Inventory/Settlement之间崩溃、资源等待、逐文件中断、未知目录成员和重放；Case只能在Settlement与重新评估都成功后resolved。

关闭确认：v5只有一次Inventory Commit和一次`consumed` Settlement Approval；旧AVI物理文件核销后才形成revision 2三维健康Reassessment和`resolved / reassessed_healthy`。重启计数不变。状态`FACT/FS/RESTART PASSED / CLOSED`。

## 97. UAT-100：Aftercare失败、重试、Work lineage与终态必须可恢复

问题分类：`RECOVERY_CORRECTNESS / AUDITABILITY / LIVENESS`

用户侧现象：Prepare/Commit/Closure的Work一旦耗尽重试，active Case可能永久重放同一个failed Work；另一些路径直接写unresolved/invalidated但没有原因、Evidence或安全收口。

精确根因：Inventory revision变化后用新Basis重新计算prepare/commit Work ID，Closure引用到不存在的Work；直接终态路径没有统一cancel→drain→reclaim→terminal result，也没有完整Care Basis/实际Work lineage。

修复边界与验收：持久冻结真实Assessment/Prepare/Commit/Reassessment Work引用和完整Care Basis输入；临时故障保持active并按有界新Attempt/新Work代际恢复，业务上不可达才unresolved。所有终态保存reason/evidence并收口资源；相同Assessment trigger精确重放同一terminal Case，新的Assessment trigger才建立下一generation；每个Aftercare effect在前/中/后kill均证明forward-only/exactly-once。

关闭确认：终态重放、两代替代Work、Inventory后恢复、Case generation和Workspace收口专项通过；v5完成后及重启后均为Case=1、Commit=1、Approval=1、active Work/Event/Incident=0。状态`FACT/REGRESSION/RESTART PASSED / CLOSED`。

## 98. UAT-101：Aftercare长任务必须有真实进度、可取消且不能阻塞Admin Web

问题分类：`PERFORMANCE / PROGRESS / OPERATIONAL_SAFETY`

用户侧现象：Aftercare转码只有固定15/55/80伪百分比；大文件从Workspace复制回Shelf、Settlement和Workspace删除会同步阻塞Node，停服/取消也可能长时间等待FFmpeg。

精确根因：Aftercare FFmpeg没有`-progress`或Progress Reporter；大文件路径使用`copyFileSync`和递归sync filesystem API，临时文件名又绑定PID且失败后不能稳定恢复。

修复边界与验收：使用Foundation Progress Reporter和冻结时长形成单调current/total、rate、ETA，两遍编码整体不回退；取消/停服在有界时间终止child且不发布final Handle。大媒体复制、61成员Settlement和回收改为可等待异步I/O，保持确定性temp、bounded fingerprint、atomic rename与Effect recovery。真实窗口要求Health p99≤500ms、Admin p99≤2s、零10秒超时。

关闭确认：真实Aftercare转码形成持久单调Progress并在Collection投影当前阶段；61成员修复后Settlement窗口由79.365秒降至15.582秒。独立HTTP监控Health/Formation/Collection p99分别42.242/43.659/45.922ms，非重启窗口无超时；重启可继续或保持终态。状态`FACT/PERFORMANCE/RESTART PASSED / CLOSED`。

## 99. UAT-102：Aftercare Workspace必须进入Platform Registry并按保留期回收

问题分类：`PLATFORM_INTEGRATION / RECOVERY_CORRECTNESS / DATA_SAFETY`

用户侧现象：普通运行把Aftercare Workspace默认放到OS TEMP（Windows即C盘），Case关闭前会直接递归删除整个目录。

精确根因：当前server没有解析Aftercare Workspace Root；Handle自造endpoint/mount/root且不登记正式Workspace Material，Closure Plan顺序是先reclaim后case commit，与SSOT的terminal、无引用、保留期后回收相反。

修复边界与验收：接入既有Platform Workspace Root Registry，root不得与Field/Shelf重叠，Handle的endpoint/mount/root逐字节匹配注册快照并持久登记；所有terminal Case在无引用且满24小时后只逐项删除声明成员，未知成员fail closed；成员在全部删除并形成durable Receipt前保持active，部分删除只能由同一Foundation Effect recovery继续。测试TEMP/TMP/TMPDIR及Aftercare Root全部位于F盘。

关闭确认：全新v5将data、Libra Workspace、Aftercare Workspace、TEMP/TMP/TMPDIR全部放在独立F盘运行根；正式Handle与Registry快照一致。24小时门禁、未知成员、部分删除恢复和重启专项均通过。状态`FACT/FS/RESTART PASSED / CLOSED`。

## 100. UAT-103：Aftercare Incident与Care Projection必须有界，评分刷新不得形成同步风暴

问题分类：`PERFORMANCE / INCIDENT_AGGREGATION / PROJECTION_FRESHNESS`

用户侧现象：大量Shelf Entry在评分刷新后同时重评时，Provider/Endpoint故障会为每部影片建立Case；Care、Collection和Overview读取又反复全表扫描，导致前端响应明显变慢。

精确根因：Aftercare Store按页select-all并在JS做N×filter，Care列表逐Entry再次读取history；Douban Acquisition terminal后同步遍历全部Subject并逐项Resolution/Aftercare reconcile。

修复边界与验收：同一Provider/Endpoint/Workspace故障先聚合一个Incident并把受影响条目标为not_assessable，不批量创建修复Case；技术失败计数、Incident生命周期、Circuit开关与恢复必须由Foundation Runtime根据terminal Attempt及其冻结/实际Resource事实统一完成，Arca不得按错误码猜资源、直接`record/beginRecovery/resolve`或自建Circuit。Arca只投影业务影响并申请后续Work；Libra业务代码、Run/Spec/Workspace/lifecycle语义不变，仅证明同一Foundation机制不会改变既有业务结果。Resolution和Aftercare唤醒按持久cursor分批且每批yield。1000/10000 Entry SQL trace不得出现按Entry全表扫描，Care/Collection并发p95≤300ms、p99≤1s，重启续传且同Basis不重复Work。

关闭确认：1547条真实Douban Record完成后由持久cursor唤醒Subject与Shelf Entry Resolution；v5仅形成一个对应Aftercare Case，零开放Incident。1000/10000级批量Projection、SQL trace与故障聚合专项通过，Libra Run仍唯一。状态`FACT/PERFORMANCE/RESTART PASSED / CLOSED`。

## 101. UAT-104：Startup Recovery Gate必须先于Outbox/Inbox扩大执行范围

问题分类：`STARTUP_RECOVERY / OPERATIONAL_SAFETY`

用户侧现象：故障库启动时，Outbox可能在Startup Recovery确认安全前先消费消息、admit新Work或改变Domain状态。

精确根因：外层Service Host先启动Outbox Dispatcher，再启动包含Recovery Gate的Execution Host。

修复边界与验收：不改变Foundation状态机，只修Composition启动顺序：Effect/Workspace/Execution Recovery全部通过后才允许Outbox/Inbox dispatch；任一hard finding必须在零新ack、零新admission、零Domain mutation下fail closed。健康库反例证明Gate完成后消息正常继续。

关闭确认：hard-finding与健康库启动顺序专项通过；v5受控重启后health ok，Entry/Run/Case/Commit/Approval计数不变，active Work/Event/Incident均为0。状态`FACT/RESTART PASSED / CLOSED`。

## 102. UAT-105：全新真实Canary证明评分刷新后的Aftercare完整闭环

问题分类：`REAL_CANARY / END_TO_END / RESTART`

测试方法：从不可变`F:\shelfdeck_test_zone\test_film`选择性复制真实字节到全新隔离Canary，禁止hardlink、`/MIR`和任何基线回写；Field、Shelf、Aftercare Workspace、data、temp与monitoring根互不重叠且全部位于F盘。先配置Integration、Field、Shelf，等待所有可自动处理条目进入Arca，再同步Douban评分制造Aftercare条件。

验收范围：逐项关闭`UAT-094`–`UAT-104`的FACT/FS/PERFORMANCE/RESTART证据；至少覆盖约4.8GB Primary、61成员目录、NFO update/rebuild、真实TMDB Poster、评分驱动的媒体修复、真实进度、受控重启与baseline零变化。同时把已独立取得FACT/UI/RESTART证据并关闭的`UAT-092`作为演员链回归保护；本条只在Aftercare真实终态完整取得后关闭。

关闭确认（2026-08-25）：综合保留的61成员性能现场、NFO update/rebuild现场、真实TMDB Poster现场与全新v5评分驱动媒体修复现场关闭。v5从只读`test_film`复制《光荣的愤怒》，原基线仍为731,172,864-byte AVI；Douban完整同步1547条后评分从无到3星，Aftercare真实转码为728,533,253-byte MKV，旧AVI完成Settlement。最终Case为`resolved / reassessed_healthy`，revision 2只有一个Primary，三维Assessment均healthy；Admin Web详情显示MKV、3星豆瓣与收藏健康。受控重启后Entry=1、Libra Run=1、Case=1、Inventory Commit=1、Approval=1，active Work/Event/Incident=0。状态`UI/FACT/FS/RESTART PASSED / CLOSED`。

## 103. UAT-106：TMDB零演员结果后Libra Run没有可行动终态

问题分类：`DOMAIN_ORCHESTRATION / LIVENESS / USER_EXPERIENCE`

用户侧现象：`一场很（没）有必要的春晚 (2022)`长期显示“正在确认目标、评分、要求或身份”。Run为`active`，
5个Metadata前序Work全部`succeeded`且开放Work为0；NFO和TMDB Provider Result的`peopleHints`都为空。

历史漏项：UAT-092提交`1e339358d`修复“缺演员NFO必须创建cast-only Provider Work并把Media Cast写入NFO”；
`fd1e1190e`只移除TMDB Adapter对空`requestedFields`的错误拒绝。旧回归明确断言Provider零演员时Metadata Stage为
`unresolved`，但没有继续约束Coordinator、Run Lifecycle和Formation终态；UAT-092当时也保持
`REAL CANARY PENDING`，因此不是已关闭行为回退。

修复边界：Provider Fetch Work和Attempt保持`succeeded`。Coordinator把其durable zero-cast Result作为
`business_unachievable / product_metadata_required_cast_missing`证据，通过既有Run Lifecycle冻结当前Run；
不制造executor failure、不把演员混入普通描述字段、不改Foundation。

验收证据：提交`c07d59ac5`；真实保留库重启后Run `7d03fa...`从active revision 2进入frozen revision 3，
5个Work仍全部succeeded，当前transition evidence唯一blocker为`libra.product_metadata.fetch@1`的上述业务原因。
Admin Web显示“媒体资料中缺少验收要求的演员信息，本次整理已冻结”，不含“执行失败”。专项32/32、完整Service
320 pass / 18 skip / 0 fail。状态`FACT/UI/RESTART PASSED / CLOSED`。

## 104. UAT-107：MoviePilot未配置时Libra零资源等待被误报为执行失败

问题分类：`DOMAIN_ORCHESTRATION / EXTERNAL_INTEGRATION / USER_EXPERIENCE`

用户侧现象：`地狱尖兵 (2022)`的Direct Product Media Verification以`video_codec_unmet`、
`minimum_raster_unmet`、`primary_audio_unmet`拒绝现有媒体，并形成`no_passed_candidate`；当前环境没有MoviePilot。
Run仍active，8个Work全部succeeded、开放Work为0，但Formation显示“媒体整理执行失败，需要处理”。

历史漏项：UAT-017/UAT-030只覆盖MoviePilot已配置后候选`noncompliant`或`no_available_candidate`形成合法业务冻结；
历史“5-star without MoviePilot”E2E仅证明不得伪造Package/Offer，没有断言持久等待投影、可行动文案或UI桶。
Coordinator原有`waiting_external_integration`只是瞬时结果，Formation没有读取Platform Integration readiness。

修复边界：Run保持active且零执行资源占用，配置MoviePilot后由既有reconcile继续，不伪造Work或冻结为技术失败。
Formation通过Composition提供的只读Platform readiness，只有在durable Media Verification要求外部来源、Selection为
`no_passed_candidate`且尚无External Work时，投影`pending / waiting_for_external`和“等待配置外部获取服务后继续整理”；
其他业务失败仍为attention，不被此分支隐藏。

验收证据：提交`c07d59ac5`；真实保留库重启后地狱尖兵保持active revision 2，Projection由
`attention_required / blocked`变为`pending / waiting_for_external`，Admin Web归入“待整理”并显示精确等待文案。
专项32/32、完整Service 320 pass / 18 skip / 0 fail。状态`FACT/UI/RESTART PASSED / CLOSED`。

## 105. UAT-108：NFO磁盘漂移不得污染Material Control变化集

问题分类：`BUSINESS_CONTRACT / METADATA_INTEGRITY / MATERIAL_CONTROL`

用户侧现象：已上架影片的可用NFO删去普通资料字段后应执行“更新”，损坏XML后应执行“重建”；现场两种Repair都完成了materialize，随后Inventory却以`P3_CONTROL_FROM_SCOPE_MISMATCH`停止，页面不能回到健康。

精确根因：Materialize Receipt同时记录受Inventory控制的`retiredMaterials`和目标位置当前真实但未受控的`supersededMaterialIdentity`。旧模型把两者都加入Material Control release；后者从未属于旧Control scope，Foundation因此正确拒绝越权释放。

修复边界与验收：Control变化只释放冻结Inventory明确控制的`retiredMaterials`，仍获取新的最终NFO；Settlement继续保留并核销精确的superseded物理身份。合法NFO更新必须保留丰富字段、未知字段和演员强身份，坏、危险、超限或电影身份冲突NFO必须重建；第二次漂移、来源guard变化仍fail closed。真实运行`UAT-20260824-224753-aftercarefix`中《光荣的愤怒》合法NFO删字段后约1.9秒恢复健康；独立`canary-uat110-nfo-schema-fix`中《全面失控》破坏XML后约1.9秒完成重建，结果为合法`movie` XML、8名演员、TMDB 1484253、零`.superseded-*`。专项Aftercare 98/98通过，安全重启后Inventory/Case不重复。状态`FACT/FS/RESTART PASSED / CLOSED`。

## 106. UAT-109：冻结的Artifact missing必须支持受证据约束的absent CAS

问题分类：`RECOVERY_CORRECTNESS / AUTHORIZATION_FENCE / ATOMICITY`

用户侧现象：健康评估已冻结`artifact_missing + poster_missing`或`nfo_missing`，但Materialize仍要求目标旧文件存在，导致本来可自动补回的海报/NFO在复制前失败。

修复边界与验收：只有同一Case冻结了匹配的Custody与Presentation缺失Finding时，目标absent才是合法CAS前态；无对应Finding、出现unknown bytes、精确旧目标重现、authority变化均必须冲突或完整回滚。成功路径必须幂等materialize、Inventory acquire/release与空Settlement，不伪造retired状态。真实运行`UAT-20260824-224753-aftercarefix`中移走《倩女幽魂2：人间道》海报后，约11.9秒完成真实TMDB海报获取、验证、物化、Inventory提交与复验，最终`resolved / reassessed_healthy`；专项Aftercare 98/98通过，安全重启不重复。状态`FACT/FS/RESTART PASSED / CLOSED`。

## 107. UAT-110：Service Catalog fence、Inventory与Settlement Approval必须原子且可恢复

问题分类：`DOMAIN_ORCHESTRATION / ATOMICITY / STARTUP_RECOVERY`

用户侧现象：海报Repair已经写入文件并推进Inventory，随后报`Current Service Catalog is required`；旧故障库重启又因Control revision已推进触发`P4_EVENT_RECOVERY_INPUT_DRIFT`，Case无法继续Settlement与复验。

精确根因：生产Composition只给Planner传入Registry，Capability与Coordinator没有当前Catalog；同时Inventory/Material Control和Settlement Approval分属两个事务，前者提交后后者可以缺失。普通重算又使用提交后的Control revision，不能重建原Event冻结输入。

修复边界与验收：Composition以只读当前Catalog端口覆盖Capability、Coordinator和Planner；Inventory revision、Material Control、Settlement Approval、精确Effect-linked Commit Marker与精确typed Event Result在同一Arca/Platform/Foundation UoW原子提交。Result digest只绑定输出收据，Marker commit digest独立证明包含Inventory representation与Control变化的业务Commit。Foundation只对完整manifest Result+Evidence启用新`already_committed`捷径，先核验active Attempt、Effect、Marker、Result、Receipt scope、Effect Receipt引用、schema、canonical JSON与两类digest组成的唯一证据链，再settle原Effect Journal并完成原Event/Attempt；既有Libra/Procurement typed格式仍走原幂等Capability replay，不受新捷径误伤。不会重新投影已变化的Owner输入，也不放宽普通`input-drift`保护。缺Marker、孤立Result、非法typed Result或只有Arca业务Commit而缺Foundation Result时全部fail closed，Arca不补造Foundation Result，也不倒推或重建Foundation历史Material Control projection。故障注入进一步证明Result外键失败时Inventory、Approval、Result、Marker和Material Control revision全部一起回滚。旧真实故障库未经改库恢复为`resolved / reassessed_healthy`，Inventory、Commit、Approval、Attempt均保持唯一，二次重启不重复；独立坏NFO Canary进一步证明Settlement保持原有`PhysicalMaterialReadHandle`正式输入契约，并由Arca从冻结Care Basis Inventory精确解析唯一替换成品后完整跑完。专项Aftercare 126/126与Foundation Event Runtime 40/40通过。状态`FACT/FS/RESTART PASSED / CLOSED`。

## 108. UAT-111：逐项On-deck Settlement不得重复全量评估Accepted Inventory

问题分类：`PERFORMANCE / BOUNDED_CONTEXT / EVENT_LOOP_RESPONSIVENESS`

用户侧现象：61成员影片完成FFmpeg与Placement后，Collection Formation仍约79秒保持进行中；其间Formation与Collection请求持续约0.44–0.75秒，Settlement收口后立即恢复毫秒级。

精确根因：On-deck按合同保留61个逐材料Settlement Event，但每个Event的两个Owner Projection、Resource Demand解析和Capability执行各自调用完整`readAccepted`。该读取进一步执行`assessAcceptedInventory → inventoryPort.assess → buildPlan`，同步遍历并重新取指纹全部61个产品成员。保守形成`61 × 4 × 61 = 14,884`次同步bounded fingerprint；实测61个Event无resource wait，执行累计72.885秒、平均1194.8毫秒，证明不是资源排队。历史`UAT-089/UAT-101`只把大文件复制和Settlement文件操作改为异步，没有约束逐Event Context读取必须有界，因此未覆盖本缺口。

修复边界与验收：保持61个独立Event、Approval、Effect Receipt和逐项Deletion Evidence，不合并Settlement、不修改Foundation或Libra。Arca按`onDeckRunId + materialKey`读取冻结责任、单个Off-load成员、对应Product/Final Decision成员及完整managed-location集合；Projection、Resource Demand和Executor统一使用该窄上下文，不再触发完整Inventory assess。

关闭确认：修复后61个Event窗口为15.582秒，Capability总耗时14.234秒、平均233.3毫秒、p95 270毫秒、p99/max 671毫秒，resource wait为0；修复前窗口79.365秒、Capability总耗时72.885秒、平均1194.8毫秒。独立HTTP监控Health/Formation/Collection p99分别42.242/43.659/45.922毫秒；受控重启后没有重复Settlement Effect。状态`PERFORMANCE/FACT/RESTART PASSED / CLOSED`。

## 109. UAT-112：同根On-deck Commit必须转移Control而不是重复release/acquire

问题分类：`MATERIAL_CONTROL / ATOMICITY / SAME_ROOT`

同根Field/Shelf下，最终成员可能就是Custody已经控制的同一Physical Material。旧Commit一律释放全部旧成员、再获取全部最终成员，使同一Material Key同时出现在release/acquire集合并被正确拒绝。修复只在Arca On-deck Store：相同身份由`on_deck_custody`原子transfer至`shelf_entry`；被替换旧材料release，新物理目标按当前Projection revision acquire，任一投影分歧fail closed。v5按同根配置完成上架，专项三类变化集通过，重启Control保持唯一。状态`FACT/REGRESSION/RESTART PASSED / CLOSED`。

## 110. UAT-113：Aftercare输出必须冻结实际生产视频Profile

问题分类：`PRODUCT_CONFORMANCE / MEDIA_PRODUCTION / AUDITABILITY`

旧WorkspaceMediaHandle只记录生产意图与设备，没有记录实际动态范围操作、输出像素格式和色彩Profile；验证阶段无法证明tone-map要求与产物属于同一冻结Strategy。修复由Aftercare在Workspace Handle中写入带`profileDigest`的`productionVideoProfile`，验证只消费该正式Result并按其检查SDR/BT.709、pixel format和Dolby Vision去除。Profile digest、篡改反例及v5真实输出验证通过。状态`FACT/REGRESSION PASSED / CLOSED`。

## 111. UAT-114：同一Work下游必须消费正式sourceResult

问题分类：`DOMAIN_ORCHESTRATION / PROJECTION_FRESHNESS / LIVENESS`

Media Verify与前序Transcode在同一Work内，Foundation已把前序Result作为`sourceResult`传给Projection；旧Aftercare Projection忽略它，反而按不存在的`sourceWorkId`回查Store，造成验证输入缺失。修复优先使用正式`sourceResult`，只有跨Work的Commit阶段才读取显式冻结的Preparation Work；两种来源都缺失时fail closed。专项和v5真实链均通过。状态`FACT/REGRESSION PASSED / CLOSED`。

## 112. UAT-115：Aftercare进度必须限定当前Work并显式显示验证阶段

问题分类：`USER_EXPERIENCE / PROGRESS / PROJECTION_FRESHNESS`

旧投影会扫描Case历史所有Work，可能显示上一代转码Progress；转码Event出现100%时又会把它当作整个Case完成，后续Media Verify没有独立阶段。修复只读取当前Preparation Work，执行中的媒体Progress上限为99%，成功后切换`verifying_media`且不伪造全Case百分比；Collection Admin Web显示“正在验证媒体”。专项126/126与Web 4/4通过。状态`UI/REGRESSION PASSED / CLOSED`。

## 113. UAT-116：同根Aftercare验证的Resource Demand必须合并

问题分类：`RESOURCE_CAPACITY / SAME_ROOT / LIVENESS`

同根配置使Shelf Primary与Aftercare Workspace都落在同一Platform Mount。Composition为Media Verify分别追加两条相同`volume_read`，Foundation按合同在Attempt前以`P4_RESOURCE_DEMAND_INVALID`拒绝重复key；Event因此保持ready且零Attempt。Foundation行为正确，修复仅在Composition边界按resourceKey合并units；跨Mount仍保持两个Demand，Libra不改。真实v2由该断点恢复并继续到后续阶段，v5完整闭环；Governor反例证明未经合并的重复Demand仍被拒绝。状态`FACT/REGRESSION/RESTART PASSED / CLOSED`。

## 114. UAT-117：Aftercare播放验证不得借用Libra Workspace端口

问题分类：`DOMAIN_ORCHESTRATION / MEDIA_VERIFICATION / BOUNDARY_CORRECTNESS`

旧接线在存在`mediaEffectPort.verifyPlayback`时优先借用Libra实现；该端口只接受Libra Workspace Material Handle，因此Arca Handle在真正发起解码前以`CLEAN_WORKSPACE_MEDIA_HANDLE_INVALID`失败。修复由Aftercare根据自身Workspace Registry解析正式Handle，并用本域FFmpeg在5/50/95%三个点做有界解码；Libra不改。v2保留失败现场，v3及v5真实验证和重启通过。状态`FACT/FS/RESTART PASSED / CLOSED`。

## 115. UAT-118：跨扩展媒体替换必须同时收口文件、Inventory和Control

问题分类：`MATERIAL_CONTROL / INVENTORY_INTEGRITY / MEDIA_PRODUCTION`

第一层缺陷把Matroska/HEVC字节写回`.avi`文件名；改为按Workspace产物扩展生成`.mkv`后，第二层缺陷暴露：Receipt的旧AVI只在`supersededMaterialIdentity`，而Inventory变化只按`retiredMaterials`或相同目标路径释放，revision 2于是同时保留AVI/MKV两个Primary且两者均controlled。修复仅在旧身份确属冻结Inventory时release，未纳管NFO drift仍不释放；新Primary同时继承原episode claims，跨扩展回滚恢复原文件名。

v5最终物理目录只有728,533,253-byte MKV、NFO与图片，无AVI或superseded残留；revision 2恰有一个active Primary=MKV，旧AVI Control为released、新MKV由同一Shelf Entry controlled。Case为`resolved / reassessed_healthy`，Admin Web显示`694.8 MB · MKV`、豆瓣3星和三维健康；重启后所有计数不变。状态`UI/FACT/FS/RESTART PASSED / CLOSED`。

## 116. UAT-119：Frozen条目缺少用户显式瑕疵入库闭环

问题分类：`BUSINESS_CONTRACT / AUTHORIZATION_FENCE / DOMAIN_ORCHESTRATION / USER_EXPERIENCE`

用户侧现象：`一场很（没）有必要的春晚 (2022)`原NFO没有actor；TMDB movie 1030398的
`credits.cast=[]`且crew有4人。Libra按当前Movie Shelf Standard正确识别演员缺口并冻结，但页面只能放弃整理；
用户无法明确表示“我知道资料不完整，仍接受它成为收藏”。同样，原始媒体安全可播放但MoviePilot有界寻源
耗尽时也只能冻结或放弃。

历史漏项：UAT-092修复了可补演员时的NFO/TMDB补齐，UAT-106只保证TMDB零演员形成可行动Frozen终态；
HB-B.12/HB-B.17只验收冻结与放弃，没有覆盖“外部现实确实为空”这一合法边界，也没有约束首次接纳豁免与
Aftercare后续补齐策略必须使用同一授权事实。

修复边界：Frozen只提供用户显式的同级动作`放弃整理`与`接受瑕疵`。V1 closed set为
`actor_unavailable|external_source_exhausted`；授权绑定当前Run revision/digest、完整Terminal/Verification
Evidence、acknowledgement与idempotency。Libra保留真实unmet Requirement，Package携带Authorized Defect
Manifest；Arca独立验证实际Gap与授权集合精确相等后才形成`accepted_with_defects`并在On-deck Inventory保存
Manifest。Aftercare从observed gaps中扣除已接纳集合，不补齐、不重试这两项，但仍处理其他新问题。Identity、
结构、不可播放、Integrity、Binding、Containment、Control、stale、Shelf inactive、空间接管及未授权Gap不可豁免。

UI验收：Frozen合法场景同时显示`接受瑕疵`和`放弃整理`；按钮文案不出现“重新入库”。放弃确认说明临时文件
清理、原始媒体不删除且以后可能重新发现；瑕疵确认逐项显示原因。On-deck后收藏显示`瑕疵入库 · N项`。

验收证据（2026-08-25，隔离开发分支）：UAT-119专项覆盖演员资料确实为空、外部寻源耗尽且原始媒体仅有白名单
Gap、Provider断连/错误Capability/跨Run或不可豁免Gap拒绝、Arca精确集合验收、Aftercare只忽略授权Gap，以及旧
Clean Schema到`defect_admitted`枚举的迁移；专项5/5通过。契约/路由/Schema聚焦门禁25/25通过，相关
Libra Lifecycle、Metadata、Delivery、Handoff B与Aftercare回归72/72通过，Admin Web生产构建通过，
Manifest集合与`git diff --check`通过。完整架构集仍有People公开包、Shelf Deregistration启动一致性及
`execution-consistency-repair` P3基线失败，未把这些非UAT-119门禁误记为本功能通过。

当前处理决定：Product Owner于2026-08-25确认上述业务决定，已回写SSOT与Beta HB-B.25–26/HB-D.05；
实现与专项负向测试已完成，未经独立隔离Canary不得关闭或宣称生产验收完成。状态
`IMPLEMENTED / TARGETED LOCAL PASS / ISOLATED CANARY PENDING`。

## 117. 后续问题模板

后续发现的问题按以下结构追加：

```text
UAT-XXX：问题名称
问题分类
用户侧现象
现场证据
初步诊断
业务影响
修复边界
验收证据
当前处理决定
```
