# Helix用户侧测试待修复问题台账

状态：`USER-SIDE TESTING IN PROGRESS / ISSUES DEFERRED FOR CONSOLIDATED REVIEW`

建立日期：2026-08-20

## 1. 文档定位

Helix主体开发已经完成，Movie从Procurement、Libra到Arca及Shelf Deregistration的主生命周期已经接通。当前阶段是用户使用真实配置、真实媒体库和真实Integration进行用户侧测试。

本文统一记录这一阶段发现的待修复问题，作为后续集中复盘、Design Return、修复排序和回归验收的工作基线。

本文不是Architecture SSOT，不替代`CURRENT_PLAN.md`，也不表示记录后立即修改运行中的系统。测试期间发现的问题先保留现场证据、影响和初步诊断；待本轮用户侧测试结束后统一确认修复范围。

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

#### C. 部分Subject没有可靠年份

当前`deriveTitleYear`只识别“标题末尾直接以括号年份结束”的形式。若Candidate标题仍带有发行或编码标签，例如：

```text
标题 (2025) - 2160p HEVC TrueHD
标题 (2014) 1080p DTS-sample
```

年份无法拆出。Subject只剩内部`subject_id` Anchor，而豆瓣Record不可能拥有这个内部ID，因此在没有Provider Identity时无法匹配。

现场259个Subject中有64个缺少有效年份，其中62个已经形成`not_found`。

分类：真实Identity Evidence生成缺口。

#### D. 新Record进入后的Resolution刷新滞后

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
- 缺少Provider Identity时，建立有界、确定性的发行标签剥离和年份提取合同；
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

## 8. 后续问题模板

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
