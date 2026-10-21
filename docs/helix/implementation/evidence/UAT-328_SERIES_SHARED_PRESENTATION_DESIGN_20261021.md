# UAT-328：Series 剧级公共资料完整生命周期设计

状态：2026-10-21用户确认本设计并授权与UAT-326/327一起开发；首批基础组件已开发，完整运行链路未接通，未验收、未发布。正式合同已回写唯一架构SSOT，归属唯一CURRENT_PHASE，不建立平行开发计划。开发证据见文末。

## 1. 已确认的用户目标与范围

用户已确认：一部剧首次有任意一季上架时，既要建立本季目录，也要使剧集母目录资料完整；后续其他季加入时复用已有剧级成果；同季追加新集继续扩充该季。首个上架的可以是第三季，不依赖第一季先存在。

2026-10-21用户另行明确：剧级 tvshow.nfo、poster、fanart 三项均为必需项。默认文件名分别为 tvshow.nfo、poster.jpg、fanart.jpg；具体格式、命名和位置仍必须在 Arca Placement 合同中精确表达，不能只验三个 artifact kind 的任意目录文件。

本设计覆盖首次建立、后续新季、同季新集、原目录资料利用、缺失修复、并发、崩溃恢复、资料刷新、退出、现有已入藏缺口与验收。用户已授权新增职责合同与开发；生产补文件仍需具体只读预览及对应写入授权。UAT-326/327此前已确认的处理方向继续有效。

## 2. 现状与真实缺口

只读检查生产10个 Season Entry：当前 Inventory 成员均在各季目录内。新目标《半泽直树》《绝命毒师》和 3 Body Problem 的剧根只有季子目录；原5star目录中前两部的 tvshow.nfo、poster、fanart仍存在。其他剧根有旧资料，不能据此证明现生产链能生成剧级资料。

当前 Libra metadata路径产生 product/season.nfo、product/poster.jpg 等；Arca Series NFO scope只区分季和集。剧级公共资料没有独立的生产依据、共享登记、正式落位和完成验收闭环。

Provider也有范围缺口：现有TMDB文字查询已读取整剧详情与季详情，但持久结果依附带 seasonNumber 的身份和sourceRef；图片获取统一调用整剧 /tv/{id}/images，尚未按剧/季/集区分。不能假定当前Season目录内的poster已经是该季封面。

## 3. 三层内容与正式身份

| 层级 | 必需或现有成果 | 复用与变化 |
| --- | --- | --- |
| 剧级公共呈现 | tvshow.nfo、剧poster、剧fanart，三项均必需 | 多季共享；普通加季/加集不重建、不自动刷新已有完整成果 |
| 季级 | 季目录、season.nfo、季poster，以及该季Standard要求的其他文件 | 新季新建；同季新集扩充原季；不能用剧poster假称季poster |
| 集级 | Episode视频、逐集NFO及已有规则下的字幕/集图 | 按冻结Episode交付范围建立或扩充 |

示意：

~~~text
剧名 (首播年份)/
  tvshow.nfo                 整剧资料
  poster.jpg                 整剧海报
  fanart.jpg                 整剧背景
  Season 01/
    season.nfo
    poster.jpg               第一季封面
    剧名 - S01E01.mkv
    剧名 - S01E01.nfo
  Season 03/
    season.nfo
    poster.jpg               第三季封面
    剧名 - S03E01.mkv
    剧名 - S03E01.nfo
~~~

剧根内的 season03-poster.jpg 如需兼容某Placement布局，仍属于第三季的呈现，不能因为放在母目录就当成整剧共享poster。此镜像命名不自动成为必需第四项；默认沿用Season内poster位置，是否输出额外镜像由明确Placement规则决定。banner、logo、landscape不在本次固定最低要求内，但既有文件的处置责任不能因为它们是可选资料而消失。

共用判断使用经Libra确认的Provider剧身份，例如同一Shelf内相同TMDB series_id；不是中文标题、年份、目录名或“都在一个文件夹”。不同Shelf各自拥有正式呈现。多个同名剧、不同Provider映射不明确或同剧独立版本的目标范围有歧义时，按明确冲突处理，不能猜测合并或指定重复项赢家。

Season仍是Subject和Shelf Entry主体；不新增用户可上架、取消、评分或退出的整剧Shelf Entry，也不引入全局媒体ID。

## 4. 已确认的职责与新增合同

建议让 Arca 管理剧级公共呈现这一份共享的正式成果。Libra继续负责身份确认、产品事实及季/集生产，并通过Handoff B提供已确认的剧级事实与素材依据；Arca负责共享成果建立、复用、正式位置、登记、健康、引用和退出。

| Owner | 责任 |
| --- | --- |
| Procurement | 在冻结Observation内捕获与本剧有关的原剧根NFO/图像证据；不把分类层级直接判作已确认剧身份，不把共享剧资料转为某季独占Primary |
| Libra | 确认剧/季/集身份；按真实scope取得并冻结Provider或合格本地来源的事实；继续生产季/集Product；提供可审计的剧级呈现依据，不选择正式母目录位置 |
| Arca | 将相同剧的季Entry关联到同一共享呈现范围；决定正式母目录；按固定事实渲染剧NFO、按已确认剧身份取得/验证两张图、物化与登记；提交时验收共享成果；维护修复与共享退出 |
| Platform / Provider adapter | 端点、配置版本、操作许可、短期访问授权、网络和读取；不判断收藏已完成，不拥有剧/季归属和正式目录 |
| Foundation | Supporting Work、调度/资源、Effect与恢复、原子Owner提交；不决定哪个Provider结果代表这部剧，不因三项文件存在代替Arca决定 |

这不是现有代码已经支持的路径。需在SSOT中明确三项扩展后实施：

1. Arca新增有界的剧级共享呈现责任与精确Process/Work Scope；正式目录和共享Artifact由该Arca范围登记，各季引用，不各自取得同一文件的排他控制。
2. Handoff B增加可重建的剧级事实/素材依据；剧根三项不是每季必须重复加工和交付的一套Product Material。剧级呈现准备可复用原子renderer/acquisition/materialization效果，但必须有其正式输入、资源及恢复合同，不能借用只允许Aftercare Case调用的端口或以composition直接写文件。
3. Arca On-deck Fulfillment/Commit增加剧级完整性与共享引用的原子条件；同季/跨季复用不会建立第二份整剧Own事实。

选择Arca统一管理的原因是：它已经拥有正式位置、Inventory与跨Season共享Related责任。若每个Libra Run各自判断、构建母目录，会重复下载并出现并发覆盖；若将选择和写文件放进adapter或通用runtime，会越过现有Owner边界。本方案不把季/集媒体加工或正式身份决策搬给Arca，不增加第三次Business Handoff或Arca反向命令Libra生产。

### 4.1 Handoff B到底带什么，以及何时取得剧图

建议增加有界的Series Presentation Basis，至少完整保存：已确认剧身份（Provider及series_id，并保留派生自哪个已确认Season身份的证据）、真正剧级文字事实及来源Observation引用、可用本地共享资料的精确证据、Provider集成/config与素材查询绑定、三项最低要求及render/selection规则版本。它不带正式target位置、某季虚构的剧级Own、Secret或短期Handle。值、引用及集合均可重建并完整摘要，不只存一个opaque digest。

剧级文字事实可从当前已经取得的show详情形成明确scope的独立结果，不额外对每个Episode请求整剧。图片Basis可以携带已冻结的精确locator，也可以是按相同已确认series_id取得图片的稳定查询绑定；不能把“有一个URL”当成图片已成功生产的证明。

Arca先检查共享成果：健康时不展开素材查询，不访问图片列表/下载端口。只有缺失项才在自己的新共享准备/修复Work中查询图片候选并持久化本次Source Observation，随后按选定的精确locator获取字节、验证和物化。这些是新Arca剧级呈现职责的必要一部分，须明确相应Provider操作许可，不能私用Aftercare专属端口。Provider或配置变更时必须以明确重评产生新Basis；不能在同一冻结Attempt内换站点、配置或图像候选。

该安排避免两个极端：每个Libra Run都下载三项再让Arca丢弃多余副本；或Arca发现旧剧根损坏后反向命令某个早已结束的Libra Run重新生产。Arca只能对已确认剧身份做有界呈现资料取得，不重新搜索/改变剧身份，不加工Season视频。

Acceptance须区分两种可执行依据：现有健康共享成果，或满足身份/配置/本地资料与来源Readiness的共享准备Basis。已知无必需素材、身份冲突或无合法取得路径，应在接收前明确暴露为资料/Readiness问题，不能靠接受后永远转圈代替决策。接收后发生的真实下载失效由Arca承担，进入已有恢复语义；不能把“Basis已通过”说成三项实际已完成。

## 5. Provider如何取得三层资料

### 5.1 先确认身份，再按scope查询

一季确认到TMDB身份后，使用同一经验证的 series_id 查询整剧，不再拿目录名重新搜索另一部剧。请求与结果必须显式区分 series、season、episode；季查询绑定 seasonNumber，集查询还绑定 episodeNumber。现有要求positive seasonNumber的Metadata请求不能直接把seasonNumber删掉冒充剧级请求，需要闭合的新variant/contract。

| 用途 | TMDB正式查询 | 本系统应保存的范围 |
| --- | --- | --- |
| 整剧标题、首播日期、简介、类型等 | /tv/{series_id}；按需求合并credits等子请求 | 剧级事实，不带“本地当前有几季”这种会随加季变化的派生状态 |
| 整剧海报和背景候选 | /tv/{series_id}/images | 只从该series的posters选poster、backdrops选fanart |
| 某季信息与集清单 | /tv/{series_id}/season/{season_number} | 精确该季；Provider理论集清单不等于本次交付范围 |
| 某季封面候选 | /tv/{series_id}/season/{season_number}/images，或该季详情的对应图片引用 | 仅该季的poster；不回退到另一季或整剧poster并声称仍是季图 |
| 某集详情或缺失字段补查 | /tv/{series_id}/season/{season_number}/episode/{episode_number} | 仅精确该集；不能拿整剧简介补成单集剧情 |
| 某集剧照 | 对应episode images接口 | 集级still，不作为整剧fanart |

Provider返回JSON事实，不返回tvshow.nfo文件。tvshow.nfo由已冻结的剧级事实经过确定性NFO renderer生成；不能把season.nfo或现有按季渲染、根标签偶为tvshow的内容改名后当作整剧NFO。三个层级都必须有scope一致的内容校验。

### 5.2 NFO字段与图像选择

剧NFO至少携带可验证的整剧Provider ID、剧名/原名、首播年份/日期、剧简介及已取得的正常描述字段。剧级演员、类型等只能来自相应整剧事实；不能让最后加入的一季覆盖整剧演员清单。无需为了新季入藏重写剧NFO中的“本地季数”；本地季/集集合从Arca引用及Inventory读出。

图像候选必须记录scope、源路径、语言、尺寸、选择规则revision及来源配置。建议剧poster按配置语言、原语言、无语言、其余可用图的明确顺序选择；fanart优先无语言且满足背景图形态的候选。类内按明确质量/尺寸及稳定路径排序，不能取接口数组第一项作为未声明的政策。语言区域如zh-CN必须规范化到TMDB图像所用的语言语义；候选为空时，先排除语言过滤造成的假缺失，再形成“确实没有可用素材”的结果。

图像下载URL按Provider的configuration、size和file_path构成；下载后验证真实类型、可解码性、大小与内容摘要。不能只看URL扩展名，也不能把竖版poster当fanart。每次网络执行重新验证当前配置及许可，短期Handle不进入长期业务依据，复用UAT-326方向。

### 5.3 已有本地资料与缺失

已有正式母目录资料完整且经身份/绑定验证时直接复用，不查Provider重建。原来源剧根中的NFO/图像可以作为有界来源证据：须在冻结的明确祖先关联范围内、与本次已确认series_id一致、通过相应NFO/图片检查；不能向任意祖先或同名目录借图。原文件若仍供其他未整理季使用，不因本季上架而移动或删除；正式目标使用经登记的非破坏性复制/派生，原共享输入仍保留正确责任。

缺项从同一已确认剧身份的Provider或合格本地来源补齐，不更换剧身份、不拿季图/集图凑数。网络故障、权限/配置问题、真实无素材、身份冲突必须分别形成可识别原因。用户要求三项必需，素材确实缺失时不能标为完成或用空NFO/占位图通过。

不虚构当前已有人工补图入口。实现验收必须证明在原条目中能获知缺项并在修正资料/配置后通过“重试任务”触发正式重评；若所有现有来源均无素材，至少支持对用户提供的明确本地补充资料进行验证接管这一有界恢复路径，具体交互纳入原条目设计，不增加独立“剧根维护”页面。

### 5.4 何时查、何时复用

| 场景 | 剧级查询/构建 | 季/集查询 |
| --- | --- | --- |
| 首个季首次上架 | 取得一次足够的剧级依据，物化三项 | 本季及本次实际交付集 |
| 后续新季，剧级成果健康 | 复用已有公共成果；不重新下载两张剧图、不重写NFO | 查询新季及其交付集；身份核验所需的有界读取不等于重建剧根 |
| 同季追加新集 | 同样复用公共成果 | 仅扩充需要的新集和必要季信息 |
| 剧级文件缺失/损坏 | 只对缺失或需修复项生成新的正式修复依据 | 不重加工已有视频，不重做无关季 |
| 用户显式刷新剧级资料 | 形成独立维护意图和新revision，按预览/冲突策略更新 | 不借普通加季暗中刷新 |

HTTP缓存与并发合并的key必须包括稳定的Provider/config、series_id、scope、季/集编号、语言及查询合同版本；不能用短期Handle到期时间作为缓存业务key，仍须逐次检查当前访问权限。缓存不是正式Ready证明。Provider结果一旦被选为本次正式依据须持久化为不可变Observation，重启不能重新查询后覆盖旧依据。响应失败不持久化为永久“此剧无资料”；跨季构建去重由Arca共享事实负责，不靠一个无限期进程内Promise。

## 6. Arca共享登记与可复用证明

建议新增Arca域内的共享呈现登记与版本化清单，复用现有Related Reference语义；不建立跨域Store。关键内容为：

- 本地共享范围ID、Shelf、经确认的Provider剧身份、唯一的正式剧根Binding/Placement依据；目录改名不产生另一部剧，普通新季也不因Provider标题变化新建母目录。
- 不可变的剧级事实/素材来源依据及版本、三项文件各自的角色、实际Material/Artifact身份、位置、checksum与验证记录；可选项必须显式登记，不能扫描目录后取得任意文件处置权。
- 已Commit Season Entry的引用，以及已Accepted待Commit On-deck的有界预留引用。两类引用分别记录，不能把待入藏季算作已经Own。
- 当前共享Inventory版本、准备/修复Work与失败原因。可复用由三项当前验证及版本围栏推导，不能只保存一个永久为真的initialized布尔值。

同一Shelf、同一精确剧身份默认复用同一正式呈现范围。若已有多份独立版本/多个目标目录，必须通过Placement和原有Duplicate/冲突规则确定唯一范围；无明确分组依据时需处理，不自动合并既有目录。不同Shelf各自管理；物理Target重叠仍服从已有碰撞和Material规则。

Season Inventory持有共享范围引用，剧级文件只在共享清单登记一份，不复制成各季的独占Inventory成员。历史Season Commit保存当时共享版本和验证Evidence；当前健康读取显式组合当前Season Inventory与当前共享Inventory版本，不能读取current共享文件来伪造历史Commit。

共享呈现生命周期与进度、可用性分开：已登记范围及引用是责任事实；准备/修复Work保存执行进度；三项当前验证决定可复用性。未建立、准备中、可复用、需补齐、冲突、已释放只是可由这些事实推导的状态，不另建一个替代Subject/Run/Entry的全局媒体状态机。

~~~mermaid
flowchart LR
  A[Libra确认剧季身份与交付范围] --> B[季和集产品及剧级依据]
  B --> C[Arca接收并确定正式位置]
  C --> D{剧级三项当前可复用}
  D -->|是| E[复用共享登记]
  D -->|否| F[共享准备或修复Work]
  F --> G[取得缺项并正式物化验证]
  G --> E
  E --> H{本季交付也已验证}
  H -->|是| I[Commit本季并提交共享引用]
  H -->|否| J[原条目继续处理或重试]
~~~

## 7. 核心用户旅程

### 首个季上架（例：先有第三季）

1. Libra确认本季属于哪个series_id，完成当前Episode范围及季/集Product，冻结足够的剧级事实/素材依据。
2. Arca按正式Handoff B接收，解析唯一母目录与本季目录；检查已有共享呈现。存在不等于健康，已有合法成果可据实no-op。
3. 未就绪时由Arca共享准备Work构建或补齐三项；本季文件准备可独立推进，但不能提前标为已上架。
4. 共享三项真实验证通过且本季Fulfillment满足后，Arca Commit在同一Owner事务中提交本季Own/扩充事实及共享引用，保存双方版本围栏。

### 后续第四季加入

同一series_id定位原共享范围，不依据“第四季目录名”重新建剧。对三项做必要的当前绑定/健康验证，正常情况不访问Provider重新下载剧图、不重渲染剧NFO；只建立第四季内容并增加该季的共享引用。第三季不被修改、暂停或替换。

### 第四季继续增加新集

沿用既有Season连续性、Episode零重叠、Run交付范围和Entry扩充合同；共享引用按Season Entry幂等存在，不按每个Episode或每次Run重复增加。不能因追加十集产生十份公共资料或十份Season引用。

### 剧根已有但缺一张图

先验证已有NFO和poster，保留其字节及来源；只准备缺失fanart。若NFO表明另一部剧，进入冲突，不能按“补缺”把两部剧拼在同一目录；若已登记文件被外部改写，先做正式重评，不直接覆盖用户修改。

## 8. 并发、失败与重启

| 情况 | 规则与恢复 |
| --- | --- |
| 两季同时成为首批 | 以同一共享范围/期望revision唯一准入一个共享构建意图；两季共等同一结果。季视频生产可并行。不能用仅进程内mutex保证跨重启唯一性 |
| 最先触发的季失败 | 共享Work不能以“那一季成功”为存活前提；仍有其他Accepted引用和有效来源依据时继续。不能永远等一个已终结条目 |
| 两季对剧级资料给出不同快照 | 已有健康正式版本不被后来的季隐式覆盖；首次竞争按正式reservation/revision选择并冻结一次有效依据，其他季核验同剧后复用；真正身份或策略冲突需处理 |
| 网络失败或真实缺素材 | 有界自动恢复、明确原因；已有原条目的“重试任务”进入Owner重评。多季重试命中同一构建/修复意图，不放大成多份下载任务 |
| 三项只写入部分即崩溃 | 全部在有界Workspace/Commit Slot中验证，通过journal与确切字节进行重放/冲突分类；三项未齐不能发布Ready。不能凭目录或单个文件存在推定完成 |
| 三项完成、本季Commit前崩溃 | 持久清单及Effect Receipt验证后复用；引用以On-deck身份幂等推进，不重复下载或重复计数 |
| Commit后的文件被外部删改 | 保留原Own和历史证据，当前健康降为需修复/冲突；触发同一Arca共享修复责任，不篡改原Commit或把全剧全部视频退回Libra |
| 服务升级/重启 | 按正式Work/Plan/Effect/Owner版本恢复，源查询结果与选图依据固定。未知物理效果不得统一安全重试，不改Attempt摘要掩盖漂移 |

物理文件切换和SQLite不假定为一个跨系统原子事务。各文件依据既有Effect/Slot协议切换并保留确切恢复证据，全部实检通过后再CAS发布共享Inventory版本；Season Commit在SQLite事务内核对共享版本、当前Reference/Reservation和既有Season不重叠条件。共享版本被修复/退出竞争改变时重新评估，不拿旧Ready证据直接提交。

正常加季只“确保已有成果可复用”，不进行主动资料刷新。missing-only修复和显式refresh使用不同意图及Evidence，不把重试解释为无条件覆盖现有三项。已Accepted后的取消权限继续服从原Arca合同，本设计不新增取消权。

## 9. 验收与完成条件

新增Season或Season扩充的完成式为：现有本季/本批Episode Fulfillment通过 + 剧级三项满足当前固定最低要求 + 当前共享绑定与引用可原子提交。

- NFO：是整剧scope、对应同一Provider剧ID、语法可读、必需事实齐全；不是季NFO改名或未知目录中的同名文件。
- poster/fanart：是同一整剧的正确素材角色，真实可解码、来源和字节验证闭合；不得以两个不同文件名指向同一张竖版图冒充背景齐全。
- 两张图和NFO都位于Arca正式Placement目标并被登记，不能只在原分类目录或Workspace中存在。
- 本季各项与共享项分别验收；poster这个kind在Season目录出现，不能满足剧根poster要求。
- 新标准以版本化的Series剧级最低要求进入新流程，不能悄悄改写历史Acceptance Spec/历史Commit。user确认的三项必需不能被旧的仅nfo/poster Artifact集合误满足。

已齐全公共资料无需重新生成，但每次Commit仍取得适用的真实健康/绑定Evidence；这类本地验证不等于重新取Provider资料或重新构建。

## 10. 维护、换季与退出

共享修复仍由Arca承担，复用正式呈现核验/Artifact原子效果，不重新辨认整部剧、不重跑视频。若旧定位已失效或图像源消失，形成新的明确重评Basis与Source Observation，不将新网络数据塞回旧Attempt；普通修复默认只处理缺损项，已合法完整项保持。

显式改海报、换资料语言、重命名母目录或更正剧身份不属于普通加季。它们须走已有或后续明确的维护/纠正意图，预览影响到哪些季；不以最后加入的季资料覆盖所有季。季级Standard变化也不能暗改已经共享的剧NFO。

退出某季只释放该Season Entry的引用。尚有其他已Commit季或Accepted待Commit季预留时，三项公共文件必须保留；不能让一个季的Off-deck/维护清理删掉其他季的剧资料。最后一个引用释放也不自动构成删除授权：只有现有Off-deck明确删除意图覆盖精确共享文件、无其他引用/预留、版本与物理围栏都有效时才能删除；“保留文件退出管理”则按该意图释放管理。

最后一季删除的确认应包含本次一并删除的已登记剧级文件，已有UI确认承载后果，不新增独立入口。未知文件、未入藏季、人工额外资料不进入删除范围；目录非空不得递归删除。共享Work孤立时也必须有正式责任收束和清理证据，不能因为创建者失败就留下无维护主体的永久准备中。

## 11. 已上架缺口的修复策略

现有Entry不是重新上架或Formation Reset的对象。推荐通过Arca正式呈现维护补齐：

1. 只读生成审计清单：按Shelf+精确剧身份归组，列目标剧根、已引用Season、三项实际状态、冲突、可用原资料与拟写入范围。
2. 对《半泽直树》《绝命毒师》等空母目录，优先验证原5star剧根资料；适用时非破坏性复制并登记，原共享资料仍保留。3 Body Problem按已验证的真正series_id取得资料，不能与其他“三体”同名剧合并。
3. 已有母目录不能直接全部宣称就绪：原backdrop、poster等需按正式角色/Placement核验，不擅自改名、覆盖或丢弃额外文件。
4. 预览每组动作、保留文件与冲突；生产执行仍是独立、明确、有界的媒体写入授权，不因批准本设计或已允许部署而自动取得。
5. 每组独立Work与幂等结果；验证三项真实落位与共享登记，保护既有视频字节、Season Entry/Canonical身份/Episode集合与历史事实。

修复可以通过正式Owner提交增加共享登记、引用及必要的新Inventory/健康revision；保护的是既有事实不被删除/改写、视频不变和身份/集归属不变，不是假定维护后全库每一行都必须完全不动。修复验收应分别证明原历史前缀保持、新revision连续、实际新增文件与新共享引用闭合。

修复期间旧Entry不被伪造为未入藏；实际健康缺口在原收藏/维护路径显露。新季则不能借已有残缺母目录绕过本次完整性门槛。

## 12. 用户可见路径

用户继续只处理原整理条目。正常等待公共资料时在原行提供简短真实阶段；故障显示具体缺项/冲突原因和原“重试任务”。已入藏公共资料损坏从现有收藏/维护路径处理，同剧关联季显示同一个共享缺口；重试汇入一次正式修复。

不增加“准备异常”“剧根维护”等独立页面或技术入口。必要补充资料应在原条目的恢复旅程内完成，不能只留一句“调整文件后重试”却没有可理解的缺项和可达恢复路径。实施前需以具体宽窄屏、键盘、自动等待、需处理、重试成功和冲突场景完成既有UI负责人的同版验收。

## 13. 实施落点与依赖

| 切片 | 受影响合同/代码 | 必须交付的证据 |
| --- | --- | --- |
| Scope与Provider | TMDB适配器、Metadata/Artifact scope union、Source Observation、选图规则、短期Handle路径 | 三层请求精确、错误层级/外剧拒绝、正确语言/真实缺图、不会重复下载 |
| Libra/Handoff B | Series剧级事实与素材Basis、manifest/Spec/Conformance范围、原剧根Related捕获 | 不把季资料当剧资料，不要求每个Run重复Product Artifact；来源和Control守恒 |
| Arca共享责任 | 域内共享登记/版本化清单/Season引用与Accepted预留、公开端口、Work/Effect合同 | 同剧唯一构建、跨季复用、并发/崩溃及缺项恢复、无跨域私读 |
| On-deck/Inventory | Placement、Artifact scope、Fulfillment/Commit前后围栏、历史与当前组合读取 | 三项和本季都通过才Commit，真实文件与登记一致，版本竞争不假成功 |
| 维护/退出 | 共享范围的呈现修复和精确Off-deck引用释放 | 任一季不能误删共享资料，最后引用/预留/授权竞态保护，未知文件保留 |
| UI及现场恢复 | 原条目状态/重试、现有维护及确认、只读修复清单 | 不靠额外入口解释；生产修复未授权时只交付可审阅plan |

UAT-326的凭据/冻结依据分离是同类原则的依赖，不能新引入另一套到期字段参与输入摘要。UAT-327需让共享剧根来源证据保持有界关联，但此设计不能为解决呈现缺口恢复“分类目录整块不可拆”。不为当前旧Libra条目增加通用兼容/双写；若需要精确保留某在途条目，先按项目纪律明确范围。已正式入藏的Inventory保护和有界Arca维护本身属于正式产品责任，不能以迭代Reset替代。

## 14. 完整验收矩阵

| 场景 | 必须观察到的结果 |
| --- | --- |
| 空剧根、先上架S03 | 三项剧级资料及S03就绪；没有强造S01或整剧Shelf Entry |
| 再加S01 / 同季追加Episode | 复用同一剧根；三个公共文件不写入、图片不重复下载；同季引用不累加 |
| 并发S01与S02首次入藏 | 一份共享构建及正确两季引用；中途重启仍不双写 |
| 触发者失败、另一季继续 | 另一季有可恢复正式路径，不等待已终结触发者 |
| 只存在目录、只有一张图或图损坏 | 不误判Ready；只补/修真正缺损项 |
| 全部已有有效剧级文件 | 验证接管/复用，无Provider重建；额外文件保留 |
| 另一部同名剧 / 跨Shelf / 独立版本冲突 | 不误合并、不覆盖、按精确身份与Placement处理 |
| Provider整剧/季/集结果相互串用 | scope或identity错误明确拒绝；正确三层各自验收 |
| 图片本地化无结果 / 无语言背景 | 不把语言过滤误作永久缺图；选图顺序可重放 |
| 原source仍被未整理季使用 | 不移动/删除共享原资料；正式副本有独立登记 |
| 网络、权限、真实无图 | 三类结果区分；重试可达、无占位图假通过、无无限准备中 |
| 物化一项/两项后进程退出 | 根据精确Effect与字节恢复，三项全齐才Ready |
| Ready后删文件 / 修复竞争Commit | 原Own保留且健康显露；过期共享版本不能使新季Commit |
| 普通加季遇到新Provider资料 | 不覆盖已有剧级成果；显式refresh独立留历史 |
| 删除一个季 / 最后一个季且另有Accepted预留 | 前者保留共享文件；后者也不能提前删除 |
| 最后一季明确删除 / 保留文件退出 | 两种用户意图分别执行；未知文件不删；无幽灵引用 |
| 现有三部缺根资料的修复演练 | 原Season/视频/Canonical/Episode/历史保持；三项补齐、共享登记与当前健康通过 |

本设计评审不冒充上述测试已通过。正式关闭UAT-328须绑定具体版本、实际文件与共享登记证据、Provider和Windows/Linux相关覆盖、真实重启、既有Movie/Series/JAV回归及适用UI验收；部署或纯fixture通过不等于关闭。

## 15. 事实来源与待确认点

内部依据：TOP_DOWN_ARCHITECTURE_CONFIRMATION §3.2.6 Season主体、§5.5.9–5.5.10 Standard/Placement、§6.5 Acceptance与Commit、§5.8 Off-deck共享Related引用、§8.6.10–8.6.11原子Inventory/Aftercare能力；本问题生产只读对比见FORMATION_PACKAGE_DESTINATION_AUDIT_20261021。

TMDB官方接口核对（2026-10-21）：[整剧详情](https://developer.themoviedb.org/reference/tv-series-details)、[整剧图片](https://developer.themoviedb.org/reference/tv-series-images)、[季详情](https://developer.themoviedb.org/reference/tv-season-details)、[季图片](https://developer.themoviedb.org/reference/tv-season-images)、[集详情](https://developer.themoviedb.org/reference/tv-episode-details)、[集图片](https://developer.themoviedb.org/reference/tv-episode-images)、[图片语言](https://developer.themoviedb.org/docs/image-languages)、[图片URL构成](https://developer.themoviedb.org/docs/image-basics)、[合并子请求](https://developer.themoviedb.org/docs/append-to-response)。接口事实与本设计的选图/复用政策分别记录；官方存在这些接口不代表当前Adapter或权限允许列表已接入。

已经确认的是用户生命周期和三项必需。仍需用户审阅确认的是§4推荐的Arca共享呈现职责及其Handoff/Commit扩展；本设计也建议普通加季只补缺、已有合法文件不覆盖、显式刷新独立、共享删除遵循最后引用及明确授权。确认后再回写SSOT并传播机器合同；本文件本身不修改Owner权力或宣告所有建议已获批准。


## 16. 首批开发证据与当前界限（2026-10-21）

已回写SSOT并生成135 Capability / 114 Result family / 231 Table / 59 canonical transaction合同；数量是开发中的新结构，不是生产现状或实现覆盖率。新增四个剧级Capability当前尚未接入执行注册/Supporting Work，Series Presentation Commit合同尚未接入完整Control/Ready原子实现。

已开发基础：

1. Libra正式Metadata Observation持有精确整剧文本Source，包含原语言与来源配置；Draft/Product Fact携带Series Presentation Basis。非Episode的Series metadata准备不能仅凭Related NFO宣布资料已全。tvshow.nfo按剧事实确定渲染，不依赖第一季。
2. TMDB请求明确剧/季/集scope；季poster查询对应Season images，剧图查询show images，Episode still仅按自身scope返回；Series缺失scope直接拒绝。图片选择规范化语言，剧poster可按原语言及无语言回退，fanart按背景形态选择；缓存key不含短期Handle expiry。根图Source观察和按精确locator重新取得是两个独立操作，后者不再重新选择图片。Episode图片目前只完成Adapter叶端验证，未据此声称生产图像旅程已启用。
3. Arca共享scope、build、version、pending reservation、Season reference及历史Commit link组件，以及跨季固定根绑定查询。真实SQLite组件反例验证单builder、Version/head回滚、reference/link/reservation原子变化及旧Ready的版本围栏。尚未把这些participant接入真实Handoff B/On-deck/Off-deck事务。
4. 有界文件IO验证NFO身份/层级、图像解码/JPEG格式/角色与完整SHA256；只写确切Workspace和根三项，拒绝覆盖不同现存字节、跨根/符号链接、别剧NFO与季NFO改名。部分发布后的Adapter重建沿冻结字节继续，完成的临时文件可精确清理。此为文件层恢复证明，不是完整Foundation进程恢复证明。

仍需完成：Supporting Work/Planner及Effect reality observer接线；正式共享Control/Ready提交及Workspace回收；Accepted pending和On-deck Own的同事务引用/围栏；健康组合、跨季/新集复用、修复/刷新、退出和原任务恢复；本地祖先资料的范围资格及明确用户补充资料的入口；完整剧级描述/演员呈现规则；生产旧缺口只读修复清单；17情境完整旅程、跨平台及具体版本UI负责人验收。不得据基础组件测试关闭本项，也不得发布半接通功能或直接补生产文件。

目前组合342项定向回归和两项隔离JAV Host通过；最后受影响范围77项通过，包含本项8项共享组件/真实文件验证及4项TMDB图片scope叶端验证。P2/Manifest/包边界/禁止语义静态检查通过。完整长时门禁STOPPED、未作本版本发布资格；无生产变更。

首批产品提交：`85ab5c7e1`。对应唯一CURRENT_PHASE中的JAV-STABLE-SOURCE-RECOVERY、PROCUREMENT-COMPLETE-GROUP-SLICING、SERIES-SHARED-PRESENTATION；三项UAT均保持开放。本提交为本地开发检查点，未推送、合并或部署。

## 17. 运行链路集成检查点（2026-10-21，持续实施）

本轮接通实际Arca路径，不以首批基础组件代替完成：

- 4阶段共享准备Work（Source、Assets、Publish、Ready）及独立Workspace Reclaim Work已注册；读写/网络/Control资源、执行围栏、Source/Assets Result及Effect现场观察均接运行。Source冻结精确图片locator/原始及转换字节摘要；恢复不重选已成功的来源。Provider短期Handle仍仅在执行阶段生成，独立图片资格不重写Libra文字Observation。
- Accepted同事务创建pending reservation；共享Ready以canonical transaction同时建立三项正式Material Control/版本/head/Result/marker；Season Fulfillment记录精确共享版本及三项Control证明，Commit同事务追加/复用Season reference、固定历史Commit link。当前健康另读current共享版本。
- 共享准备失败在原Formation条目标成需处理，动作仍是“重试任务”；纯查询终态且没有任何非纯Event Attempt才可新Scope重评来源，可能已有物理效果者继续原配方。上传通过原重试对话框提供至多poster/fanart两张8MiB图片，校验真实尺寸/可解码性/物理Identity/SHA，作为有界Arca user ingress来源；不用People人物上传或反向Handoff。
- 新增持久协调覆盖Work admission容量defer后无回调、进程退出漏发的共享准备/Workspace回收，防止形成新钉子户。Source失败不会由协调器无限自动创建新尝试。
- 现有共享版本的missing-only维护接原健康检查；来源已消失时可从当前收藏条目的重试补图，保留其他健康字节、历史Commit及Season Inventory，不伪造Aftercare Case。维护失败/进行中由Arca当前事实输出，不靠解释文案补入口。
- Off-deck仅最后引用且无Accepted预留时把三项共享文件纳入原确认范围；授权同事务取得retirement_scope_id，每次物理Effect重验，终态原子释放Season引用、共享Control和retirement围栏；未知文件保留。普通Season Control与共享Control各用有界Authority Handle。原Season/Related的1024上限保持，闭合范围可额外表达固定三项公共文件。
- Shelf注销释放共享引用和Control而不删除字节。共享引用/版本的SQLite断点验证覆盖pending保护、另一季保护、真实最后引用、授权后新Accepted/新builder拒绝及历史链接不变。

本轮已取得的定向证据（OS TEMP内日志，不能当最终固定版本资格）：

| 范围 | 结果 |
| --- | --- |
| JAV真实进程退出、超过原Handle有效期恢复、完整上架、再次重启 | 1 PASS，原Event恢复succeeded，恰1 Commit，无Input Drift；`shelfdeck-326-ttl-host.tap` |
| 1081视频/22剧/65完整季组的真实Procurement Host | 1 PASS，65包、2 Run、1081唯一成员及来源保留；`shelfdeck-327-category-host.tap` |
| 首个S03完整上架 | 1 PASS；`shelfdeck-328-s03.tap` |
| 跨季与同季加集 | 各1 PASS；跨季首轮因人物后台等待时点未通过，相同Oracle单独复验通过，未删除原失败记录 |
| 首次必需图片无来源，原任务人工重试 | 1 PASS；`shelfdeck-328-retry.tap` |
| Provider完全无图，原任务上传两张图片后上架 | 1 PASS；`shelfdeck-328-supplement.tap` |
| 实际浏览器失败行→重试→错误方向就地拒绝→上传→键盘提交→收藏结果，1920/390px | 1 PASS，图片在`shelfdeck-328-browser/`；后续取消可达性/清理校验及收藏维护UI增量仍需同版复验和UI负责人审核 |
| 已上架fanart缺失且Provider已无来源，从原收藏维护补图 | 1 PASS；`shelfdeck-328-maintenance-supplement.tap` |
| Workspace写入后真实进程退出并恢复 | 1 PASS；`shelfdeck-328-process.tap` |
| 正式文件首次发布后真实进程退出并恢复 | 初轮FAIL（material_commit观察返回了workspace形状），修正为forward_required/rollbackDeclared后1 PASS；`shelfdeck-328-publish-recovery.tap` |
| 真实N:M视频的最后季Off-deck，额外三项共享文件，未知sentinel保留 | 1 PASS；`shelfdeck-328-offdeck.tap`；后续Control分组/1027技术上限及完整字节证明增量须重验 |
| Off-deck和大规模Shelf注销既有回归 | 25 PASS；`shelfdeck-328-exit-regressions.tap` |
| 共享引用/retirement围栏及Off-deck组件组合 | 30 PASS；`shelfdeck-328-reference-guards.tap` |
| 当前Contract/边界/语义静态检查检查点 | PASS；最终source-map/生成合同和完整门禁仍须固定后执行 |

三项保持开放。仍需完成/核对：既有无shared登记的生产Season只读修复预览及正式软件路径（未获生产数据补写授权）；来源祖先资料有界资格；显式刷新与冲突/所有引用维护收口；最终完整回归、Windows/Linux相关覆盖和具体版本UI审核。当前未改生产，不把未跑或被停止的完整门禁改为PASS，不以任何Reset修复旧收藏。


## 18. 完整运行链与追加反例（2026-10-21，继续实施）

最新已验证：326/327与328两处进程退出组合4 PASS（JAV跨TTL、1081媒体/65包/2Run、Workspace及正式发布中断）；Service 648 PASS/29既有skip；Web 248 PASS。上述为测试运行时工作区，不冒充后续增量或固定发布版本资格。

328真实视频浏览器旅程`shared-task-attention → 原任务双图补充 → 上架 → 我的收藏缺fanart → 原收藏重试单图 → 健康`通过，包含1920/390px、错误方向校验、清除就地错误、键盘提交及禁止Accepted后取消；截图在本机TEMP的`shelfdeck-328-browser-qualification/`。早期占位媒体走查不能达到整体健康的FAIL保留：Presentation已健康，但真实FFmpeg正确报告占位视频不能解码，后续换真实视频复验通过，没有放宽健康Oracle。

工作区写入后失败、正式根首次文件写入后失败，原任务人工重试各1 PASS；修正了“仅看成功Result就推测未进入非纯Attempt”导致人工恢复也被错误拒绝的风险。Sources纯查询失败可重评；物化后继续原配方，不借新Provider输入摘要掩盖Effect。追加空Workspace强证明的来源重评事务仍在验证。

既有无共享登记的Season本地Host修复1 PASS：按当前已Commit剧身份和唯一根形成Arca维护请求，Source只查精确整剧详情，三项补齐后登记当前引用；7组原Season/视频/身份/Inventory/入藏历史逐行摘要保持，不补造历史共享Commit link、不创建Aftercare Case。此为隔离legacy形状重建，不是生产副本实修资格。旧生产无登记项只能先报告缺口，须用户主动检查/已批准修复，不能在部署后借周期维护自动补写历史收藏。

原来源资料已增加独立只读候选引用：最近明确Season目录的共同父剧根、Field内最多三项、真正tvshow NFO确认整剧ID、完整SHA及Physical Identity；不加入exclusive Related/Control转移或输入删除范围。匹配来源Host最终1 PASS，别剧来源Host1 PASS，原件保留；PNG→JPEG及失配/漂移边界叶端1 PASS。发现并修正Windows斜杠归一化比较误把文件当父目录的缺陷。

健康新增共享head证据；Root准备/版本变化不会改Season Inventory或Care Case业务依据，但使旧共享健康检查失效，错过完成回调时可由正常协调重新检查。进行中/失败由Owner真实Work组合当前健康，不把后台健康通知当作用户主动重试。该最后增量尚须最终回归。当前136 Capability/115 Result family/231表/61 canonical transaction；三项UAT仍未关闭，尚无本轮生产变更。


## 19. 来源重评与后续入藏补查（继续实施）

强证明的空Workspace来源重评Host已通过：维护仅缺fanart，Source选定后Assets下载失败且没有字节/Material/Artifact；人工重试在固定Source Reassessment UoW结束旧空Registry并建立新build。新图片资格configRevision2、原Libra文字Source configRevision1均保持，最终共享version2及全部Workspace回收。首轮因Foundation Attempt实际终态为completed/outcome_kind=failed而非state=failed导致沿旧配方重试（6次而非7次）未通过，修正精确终态读取后复验1 PASS，原失败不改记成功。

新增只读当前文件验证用于后续加季准入：共享登记的Ready不能永久代替实际文件存在。已有版本三项当前字节/Identity缺失或冲突，必须先进入同一共享准备/修复Work，不能让新季反复在Fulfillment失败。其跨季缺图反例正在验证。

继续实施的来源恢复收口：Assets应先取得并验证本次全部字节再写Workspace，避免NFO先写导致图片暂时失效也变成“已有物理效果”。若已有Assets物化但从未开始正式Publish，人工重试可由Arca在Foundation终态/无Publish Attempt强围栏下建立新Source代际，保留/复用已成功产生的确切Workspace成果；新scope须明确supersedesBuildId和最多三项有完整Source/Identity/SHA的只读成果引用，不能伪造旧Assets成功Result、不能改旧Scope/Observation、不能丢弃未决Effect。旧Workspace在同一共享范围获得新Ready且不再有活跃引用后走正式回收；不新增“重新整理”或技术维护入口。正式Publish已开始时，完整Assets已持久化，继续原配方，不换已发布字节。此段是实施中的收口选择，尚未完成代码或验收，不能据此关闭UAT。

当前最新本地检查点ab5f610ae已提交，UI负责人正在按同版审查；后续增量不自动继承其资格。未推送或部署。


## 20. 2026-10-22 完整恢复与退出收口（最终资格继续）

本轮继续完成运行链，不再停于基础组件：

- Source/Assets重评：全部字节先取得并验证后再写Workspace；Assets已写NFO/海报、fanart来源永久失效时，原任务上传fanart，新Scope引用原成功Source recipe与实际完整成果，原始失败历史不改。真实Host 1 PASS，两个build、复用两项、旧登记一项，两个Workspace和全部Material/Artifact正式终结，恰一次入藏。日志`shelfdeck-328-closeout-partial-source.tap`。
- 原任务/当前收藏重试命令按目标、幂等键和精确上传字节记录Owner Command Receipt；同一命令晚到重放先于当前状态和已回收输入检查。请求未知后不能换图片或键，成功POST后的GET失败只能刷新。当前收藏维护补图/回收后晚到重放1 PASS（`shelfdeck-328-maintenance-command-replay.tap`）；命令事务后、Work admission前真实进程退出及两次重启1 PASS（`shelfdeck-328-command-admission-restart.tap`）；Receipt回滚/键冲突单测PASS。
- 原ab5f610ae具体版本UI负责人结论为CHANGES_REQUIRED，8/20通过，不能改记PASS。已补未知响应和成功后刷新失败两种写入保护、焦点/Tab/Escape/返回焦点、中文语义错误及样式。新增8项UI反例通过；最新Web 256 PASS/45文件，build通过。当前真实视频宽窄旅程再次通过（`shelfdeck-328-ui-recovery-real.tap`），新候选仍须负责人复验。
- 无引用退出：两季在同一批次退出，原预览未包含共享三项，文件字节/inode全保留，Season引用和共享Control归零；实际Host 1 PASS（`shelfdeck-328-batch-retirement.tap`）。最后一季在共享维护Publish写出文件后失败时仍能正常Off-deck；Arca按terminal Work/settled Effect收束builder，保留未获删除授权根文件并正式回收私有Workspace，1 PASS（`shelfdeck-328-closeout-retirement.tap`）。retained-root head、Control和Command Receipt注入事务末尾失败全部回滚，不伪造Ready。
- 新增closed `SeriesPresentationReclamationBasis`，上限128 KiB/至多三项登记，支持实际committed、superseded和retired三类；回收不伪造旧Assets成功、不删除正式根或外来文件。当前136 Capability/115 Result family/231 tables/61 canonical transactions/149 domain inputs。
- 提供精确225→231离线结构复制工具`scripts/helix-series-presentation-schema-copy.js`，只添加六张共享表、三张表的五列及327的local_media_group CHECK取值。224原业务表逐列/逐行保护；未产生新事实时反向复制通过，有新共享、来源、健康或分组事实时拒绝旧版回退；两项测试PASS。它不清理旧Libra/Formation、不修改历史输入摘要，也不是生产apply。

最新生产只读预览（2026-10-22 00:46前后本地时区，准确时间以TEMP日志为准）：生产仍225表，659条历史Entry、13条active Season、16个非终态Libra Run；原ABF-153 Event仍executing。三部新剧根三项全缺，另三部既有剧根仅缺fanart；因此不能继续沿用旧“10季/三部”数量或直接套旧修复名单。未写生产目录、未Reset、未停服/部署。完整缺口明细仅在本机TEMP`shelfdeck-328-production-root-preview.json`，正式补写仍先按精确预览取得生产数据授权。

§10的显式换海报/语言/根目录/剧身份仍属于独立已有或后续维护意图；本次普通加季与重试不获得覆盖合法现存三项的权力。外部改写、别剧NFO、不可读/不合法现存文件保持明确冲突，须先修正资料或经对应明确纠正意图；不能借“重试”无条件覆盖用户字节。该边界与缺项修复不同，不把未来refresh能力列为本次已实现。

仍在执行：固定候选全量Architecture Gate、适用Service/Windows/Linux、具体版本UI复核和完整生产副本资格。上述定向日志不冒充最终固定版本总体PASS，三项UAT未按开发提交直接关闭；未发布。


## 21. 具体版本复验发现的追加问题（2026-10-22）

Service全量2e000eb9e：677 total/647 PASS/29 skip/1 FAIL，失败为已完成Formation条目也查询当前Work，违反既有完成态保护测试。2631f4ee0修复：非in_progress条目只读其原committed reservation对应的历史sharedBuildId；既有保护测试复验PASS。不能将该首轮记为全绿。固定2e000和2631的长时Architecture运行因追加修复主动停止，均保留STOPPED、不作最终资格。

UI负责人对2e000/2631的独立真实页面补测又发现两项遗漏：Formation父级load吞掉GET异常，导致已受理重试被弹窗清除；提交按钮disabled后浏览器焦点跌出modal。已改为原Series重试回调显式要求本轮读成功，Formation及Collection列表的失败/过期响应会向弹窗传播，其他普通刷新仍使用原错误处理；accepted命令保持，只允许刷新。busy阶段同步把焦点交给对话框，并阻止外层focusin夺焦点。新增两项真实页面组件测试（含工作区关闭重开仍为刷新、收藏Care读取成功但wall读取失败），加忙碌焦点反例通过；本轮专项27+13 PASS，Web build PASS，尚待负责人冻结新候选并复跑浏览器，不以单测代替该项。


## 22. 回收原子提交后进程退出的恢复缺陷（2026-10-22）

新增真实process.exit(78)边界：`arca_series_reclaimed_commit`事务完成，Workspace/Material reclaimed、Artifact deleted及Result/Commit Marker均已提交，但Event仍executing且Effect journal尚未结算。原5eaf代码在重启时复现`P4_EVENT_RECOVERY_INPUT_DRIFT`，日志`shelfdeck-328-reclaim-commit-restart.tap`；不能把此前workspace/publish/command三类进程演练视作已覆盖此边界。5eaf完整Gate因该新增已复现产品缺陷主动停止，记STOPPED，不能计最终PASS。

根因为snapshot把回收后live Artifact revision 2投影进原revision 1的ReclamationBasis。修复保留原登记revision，同时强校验live修订等于原登记加唯一回收增量；登记两种Handle修订必须一致。不放宽Foundation输入摘要、不改变旧Attempt、不增加跨Owner事实。恢复worker现在等待全部共享Event成功，不能因Registry已reclaimed就提前通过。定向重启、完整Gate与平台增量复验继续。

5eaf固定候选已有Service 648 PASS/29既有skip（src与2631相同）、Web 258 PASS/45文件、真实视频完整浏览器旅程1 PASS、UI负责人38/38宽窄页面PASS、独立Windows打包及打包Node Host smoke PASS、Linux 17/17 PASS；追加修复后的运行代码仍须重新绑定资格，不直接继承完整Gate。

生产副本精确225→231结构复制及空新事实反向复制均PASS，224原业务表逐列逐行保护。真实旧三剧根全Host补齐演练未通过：原始namespace mount identity防护正确拒绝Aftercare Root冲突；只在隔离副本重新注册测试namespace根后，Startup Recovery仍拒绝正常供给，未发出共享修复Work。两轮FAIL保留，不能称完整生产Host升级PASS；未修改生产/原件，未Reset旧Formation历史、未放宽Root或Recovery fence。旧收藏原维护链的隔离legacy-shape Host测试PASS不替代本次完整副本结果。


## 23. 已发布终态合同补齐与生产副本范围（2026-10-22）

06d4回收修复的四类真实进程边界4/4 PASS；Service 648 PASS/29既有skip、Linux 18/18 PASS、Windows独立包与packaged Node Host PASS。UI负责人按169份Web输入、9个资产逐字节相等将38项浏览器/258项Web资格绑定06d4（owner-review目录uat328-ui-review-06d4c915a-20261022）。完整06d4 Gate随后因下面新增已定位的历史合同缺口及静态精确基线漏项停止，不计PASS。

完整旧数据副本Startup Recovery分类为4339项PLAN_CATALOG_DRIFT，全部来自现生产6c74939646的Catalog b7e4d607f2684ef6e061e47215aea6607d408fdaf148be3c4b79e7eb0a7ec714（4323个终态Work的Plan与16个在途Plan）。已发布终态不能因新增能力失去历史验真资格。本次沿用既有Frozen Catalog History，只增加6c7493964674eea2d944e915654dc3c64abf8929精确终态数据档案；不挂旧Executor、不改记录、不授权在途Attempt继续。来源为已核对ID的生产镜像ad0f738f2969439d555e46833ad0e197f38b3e3babd265af66252fef622ca1fe，收集精确ENABLED的120份执行合同（去sourceLocator）及1324份Schema、原政策和三种full Result Evidence closure，重建Catalog完全相符；archive canonical digest 214b8cf2272f740034ae8fe68d3b18e493c720bb7fd6dac7d5b692d58db03ed6。补齐既有People Owner allowlist，仍要求Manifest Owner精确一致。71项历史验真及active/foreign Owner/篡改拒绝通过；原静态负例精确列表补充328已实际改变的presentation.observe、offdeck.deletion.verify和destruction_scope.verify三项，不改变旧witness或放行变更合同。

原始全副本启动FAIL和namespace-profile重试FAIL均保留。进一步仅为旧收藏维护演练准备的隔离副本：既有Reset工具按16个明确未Commit Subject限定预览ready=true、无blocker；默认全库Reset预览因保留历史关联而被正确拒绝，未执行。可以对独立host-data执行该16项fixture Reset并通过Libra Owner配置席位0，然后验证既有Arca收藏的三剧根补齐。此结果只证明经显式测试清场后的旧收藏维护，不称原样全Host升级PASS；生产未Reset、未补图、未部署。生产原ABF-153仍未恢复，真实在途整理的处置需要独立明确授权，不能偷偷加旧Attempt兼容层。

最终固定候选完整Gate、适用平台和同版UI收口继续。Windows初次打包因旧输出存在拒绝、独立smoke因临时Secret不足32字节拒绝，均为夹具设置错误；新目录及有效随机测试Secret后通过，不涉及生产密钥。


## 24. 隔离副本Reset资格发现与修复（2026-10-22）

限定16个未Commit Subject的旧工具预览ready，但apply在foreign_key_check发现US Adult分析/人工Actor选择四表遗漏，整笔回滚；补齐直接父关系后第二次又发现analysis的reference_pages子表遗漏，再次整笔回滚。完整FK依赖枚举最终确定五张Libra表（analysis_bases、reference_pages、match_completions、actor_choice_intents、actor_choice_heads），无People主档删除。失败日志分别shelfdeck-328-copy-reset.log和copy-reset-fixed.log；均为私有host-data，无生产操作，不能记PASS。

修复以选定run集合发现并冻结analysis IDs、choice intent IDs和对应head Subject IDs，检查Subject/Workspace及completion均属于既定清场范围，子表先于父表删除。独立Frozen Manifest verifier按冻结ID逐表验证清零，不从已删除父对象重建Scope；范围外历史、共享人物和正式收藏保持。现有完整Reset40项PASS；含reference_pages的新增两项定向复验PASS（选定清零/另一Subject历史逐行保护、跨Subject伪归属拒绝、故意残留由独立verifier拒绝）。原第一轮38/40的失败为旧测试手写manifest缺新增必需冻结字段及新测试误写错误码，修正夹具后保留失败并复验，不放宽产品verifier。真实完整副本该16项精确清场及后续旧根维护还在验证。

444230441固定Service仍648 PASS/29既有skip，完整Gate因上述工具缺陷追加修复而主动停止，不计最终资格。之后冻结新候选再做全量Gate及适用平台，不继续叠加无关功能。
