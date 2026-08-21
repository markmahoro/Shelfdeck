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

本文不是Architecture SSOT，不替代`CURRENT_PLAN.md`。历史UAT问题仍保留原有处理状态；2026-08-21 Movie Canary真实用户UAT期间，用户已授权在不改变已确认架构边界的前提下直接修复、页面复测并为每项修复建立独立Git回滚点。

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

## 2. 问题总览

| ID | 问题 | 主分类 | 次分类 | 主要责任边界 | 影响维度 | 严重度 | 当前状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UAT-001 | 豆瓣评分与Libra Subject匹配率明显偏低 | `BUSINESS_CONTRACT` | `PROJECTION_FRESHNESS`、`EXTERNAL_INTEGRATION` | User Perception + Libra Identity输入 | 正确性、时效性 | High | 已诊断，待统一复盘修复 |
| UAT-002 | Handoff A Intake接收Subject吞吐异常偏低 | `DOMAIN_ORCHESTRATION` | `EXECUTION_SCHEDULING`、`PERFORMANCE` | Libra Intake + Foundation Work Supply接线 | 吞吐、活性 | High | 已诊断，队列仍推进，待统一复盘修复 |
| UAT-003 | Libra Run在Product Identity阶段大量等待 | `BUSINESS_CONTRACT` | `EXTERNAL_INTEGRATION`、`DOMAIN_ORCHESTRATION` | Libra Product Identity + TMDB Evidence | 正确性、活性 | Critical | 已诊断，1条继续推进，其余等待统一复盘修复 |
| UAT-004 | 大型Workspace媒体完整SHA-256导致无必要的全文件读取 | `BUSINESS_CONTRACT` | `PERFORMANCE`、`USER_EXPERIENCE` | Libra Workspace Material + Handoff B/Arca Inventory媒体完整性合同 | I/O、CPU、交付延迟 | High | 已诊断并确认方向，待SSOT统一修订 |
| UAT-005 | Libra Admin Web使用内部对象语言且不能直观表达媒体整理过程 | `USER_EXPERIENCE` | `PROJECTION_FRESHNESS` | Admin Web Formation Projection + Libra公开状态翻译 | 可理解性、可观察性 | High | 已讨论并确认页面重构方向 |
| UAT-006 | clean库概览仍展示固定演示数字并绕过管理会话 | `USER_EXPERIENCE` | `PROJECTION_FRESHNESS` | Overview Query Projection + Admin Web | 正确性、可信度、安全会话 | Critical | 已修复并完成真实页面复测 |
| UAT-007 | clean库人物页展示固定人数且无正式Query接线 | `USER_EXPERIENCE` | `PROJECTION_FRESHNESS` | People Admin Query + Admin Web | 正确性、可信度、安全会话 | Critical | 已修复并完成真实页面首次打开复测 |
| UAT-008 | Admin Web非根路径直接刷新返回404 | `USER_EXPERIENCE` | `PROJECTION_FRESHNESS` | Clean Service static adapter + Admin Web routing | 可用性、刷新恢复 | Critical | 已修复并完成七个页面直接刷新复测 |
| UAT-009 | 媒体整理页评分提交成功但刷新后仍显示暂无评分 | `USER_EXPERIENCE` | `PROJECTION_FRESHNESS` | Perception Query Projection + Formation Projection | 正确性、持久化可见性 | Critical | 已修复并完成真实页面刷新复测 |
| UAT-010 | Routing尚未配置时Formation错误开放人工选Shelf并返回内部错误 | `USER_EXPERIENCE` | `RECOVERY_CORRECTNESS` | Formation Admin Web + Clean Service error adapter | 可理解性、命令安全 | Critical | 已修复并完成真实页面复测 |

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

## 2.5 UAT-010：未配置Routing时错误开放人工选Shelf

22个Subject停在`preparing`时，Formation目标列仍显示“选择”。真实页面选择唯一Shelf后返回“Clean Service请求处理失败”。
精确根因是人工选择命令只允许`unresolved` Subject且要求有效Decision Head，但页面仅凭`targetShelfId`为空就开放按钮；同时HTTP adapter
未映射Manual Routing的输入、状态与Head冲突错误，因而把可预期的业务冲突降质为500。

修复后Formation仅在`unresolved`且Decision Head完整时展示人工选择；`preparing`明确显示“等待发布文件来源的收藏架分拣策略”。
Manual Routing输入错误映射为400，Subject不存在映射为404，状态或Head冲突映射为409。Admin Web生产构建和Routing E2E均通过；
同一UAT库真实页面显示22条明确等待提示、0个无效“选择”按钮，Console无warning/error。


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

- 问题已记录并完成初步诊断；
- 当前用户侧测试继续；
- 暂不修改SSOT、Resolver或历史Resolution事实；
- 不通过扩大模糊阈值进行临时修补；
- 待本轮用户侧测试结束后，与其他问题一起统一复盘、排序和修复。

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

- 当前服务和队列继续运行，不手动改库或清队列；
- 问题已完成初步定位并记录；
- 暂不在用户侧测试过程中修改Foundation或Libra Coordinator；
- 待本轮用户侧测试结束后，与其他问题一起统一复盘修复。

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

- 问题及用户确认的方向已记录；
- 当前运行中的Workspace文件、Event和数据库保持原样，不直接改库或中止服务；
- 本轮用户侧测试期间暂不修改SSOT和产品代码；
- 待集中复盘时作为正式Design Return处理，并与Handoff B/Arca媒体合同一起回归。

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

### 7.2 顶部三项统计

顶部Dashboard固定展示三个互斥节点：

| 节点 | 建议业务定义 |
| --- | --- |
| 待整理 | 已经完成Handoff A Acceptance，但尚未建立可执行的当前Libra Run；包括正在确认媒体身份、目标收藏夹、评分或整理要求，以及等待用户提供必要信息 |
| 整理中 | 已建立当前有效Libra Run，但尚未发布当前有效Handoff B Offer；包括资料补齐、Remux、Transcode、外部获取、结果验证、等待资源、suspended或frozen |
| 已完成整理 | 当前有效Product Package已经发布且Handoff B Offer已经形成；这是Libra责任完成，不要求Arca已经接受或建立Shelf Entry |

若Handoff B被拒绝并形成replacement Run，该媒体重新进入`整理中`，不得继续计入`已完成整理`。三个统计值必须由同一Formation Projection计算，不能由前端分别拼接可能不一致的API数量。

### 7.3 页面上下分区

页面采用工作区式上下结构，不以三个Tab隐藏彼此：

```text
媒体整理工作区

[待整理 N] [整理中 N] [已完成整理 N]

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
- 当前仅记录到用户侧测试台账，不立即修改正在运行的Admin Web或API；
- 具体统计边界和Projection字段在集中修复进入Design时再写入唯一SSOT及机器合同；
- 不以纯前端字符串替换掩盖缺失的业务状态Projection。

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

当前处理决定：仅记录问题，暂不修改代码、Integration配置或既有不可变Observation/Run事实。重新请求仅为只读诊断，没有写入业务状态。

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

当前处理决定：用户明确要求修复并先记录。问题保持OPEN；本次只登记架构缺口和预期结果，不修改当前SSOT、代码、MoviePilot配置、不可变Run事实或Canary文件。后续修复必须先取得返回Design并修改SSOT合同的明确授权，完成并验证后单独git commit。

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

当前处理决定：用户已确认记录统一处理方案。问题保持OPEN；本次仅登记Executor Failure Closure合同缺口和验收边界，
不修改SSOT、代码、旧Work/Event、运行时数据库或Canary文件。后续若需改变Domain状态或新增Owner事实，必须先完成Design确认；
实现、回归及真实浏览器验收完成后单独git commit。

## 17. 后续问题模板

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
