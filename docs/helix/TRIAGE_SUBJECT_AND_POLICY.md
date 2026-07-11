# Helix Triage、Subject 与维护策略合同

> 2026-07-12 ownership notice: Triage、Season Subject和信息递进结论继续有效；Library
> Maintenance Policy已改由Deck拥有并解释为Deck Acceptance Policy。Pre-deck Subject不等于
> Deck ownership，`maintenanceComplete`不等于On-deck。与顶层合同冲突的旧Owner描述失效。

Status: accepted design; implementation pending.

Last updated: 2026-07-11

本文收束 Helix 在真实来源验收暂停后形成的入库、媒体主体、内容 Profile、Gate 信息边界和 Library Rule Template 决策。它是 `ARCHITECTURE.md` 的细化合同，不是平行实施计划。若当前代码或旧文档与本文冲突，以顶层 `ARCHITECTURE.md` 同步后的合同为准；冲突实现必须 clean cut，不得建立兼容双轨。

## 1. 结论总览

```text
原始 Source
-> Nexora 预检（Triage）
-> Libra 正式入库、分组和协调
-> Kairox 维护规范化 Subject
```

三个业务域分别追求：

```text
Nexora：预检准确、快速、可纠正
Libra：正确建立 Membership、Subject、分组和 Admission
Kairox：对已规范化媒体维护得又快又好
```

医院类比只用于帮助理解边界：

```text
Nexora：预检——判断是什么病人、是谁、从哪里来
Libra：入院——建立正式身份、科室关系并协调转诊
Kairox：诊疗——只处理已经完成预检的规范化病人
```

## 2. Canonical Subject 模型

### 2.1 两个正交字段

Helix 不再使用 `movie | tv | adult` 同时表达结构和内容。正式字段为：

```text
mediaType:
  single | group

contentProfile:
  movie | series | jav | western_adult
```

- `mediaType` 只回答执行结构：单体还是由多个 Asset 组成的聚合主体。
- `contentProfile` 回答内容应按哪一种业务语义解释和选择适用能力。
- `contentProfile` 不是 Flow、Objective、Rule Template 或维护套餐，不得隐式增加维护要求。

首版典型组合：

| mediaType | contentProfile | Subject 语义 |
| --- | --- | --- |
| `single` | `movie` | 普通电影 |
| `group` | `series` | 一个 Season，包含 Episode Assets |
| `single` | `jav` | 单体 JAV |
| `single` | `western_adult` | 单体欧美成人 |

组合的适用性由显式合同校验，不通过字符串暗示。未来若业务确认存在分组型成人内容，可以允许 `group + western_adult`，不需要把 Adult 重新变成结构类型。

### 2.2 Series、Season 与 Episode

电视剧维护粒度固定为 Season：

```text
Libra Series grouping（seriesId）
└─ Season Membership / Kairox Subject（subjectId）
   └─ Episode Source Assets（assetId）
```

- `seriesId` 是 Libra 拥有的跨 Season 分组身份，不是 Kairox Task key。
- 每个 Season 拥有独立 `subjectId`、Membership、Admission、Maintenance Run、Priority、Gate、Task 和 `maintenanceComplete`。
- Episode 只拥有 Nexora `assetId`，成为 Kairox Event 的 `assetScope`；Episode 不拥有独立 Run、Priority、Gate、Task 或用户维护策略。
- 用户对整部 Series 发起的停止管理、开始维护或优先维护由 Libra 展开为各 Season Subject 的 durable intent。
- 本期不建立理论 Episode Catalog，不判断缺集。`E01/E05/E07` 可以构成一个当前来源 Manifest；Basedata Gate 只证明当前 Manifest 中必要 Asset 均已观察，不证明理论集数完整。

### 2.3 身份不冗余

```text
seriesId  -> Libra Series grouping
subjectId -> Libra Membership 与 Kairox Season/Movie maintenance identity
assetId   -> Nexora source asset identity
```

不恢复 `itemId/libraryItemId/mediaItemId` 别名。Source native ID、Provider ID 和路径都是身份或 Binding 证据，不直接充当 Helix canonical ID。

### 2.4 Season Asset Manifest

Beta Manifest优先忠实表达当前实际物理资产，不强制完整Episode语义：

```text
SeasonManifest:
  subjectId
  seriesId
  seasonLabel
  assets[]:
    assetId
    sourceBinding
    episodeNumbers[]
    versionKey?
    displayName
```

规则：

- Season 0 / Specials按普通Season Subject处理，独立拥有Run、Gate和Task。
- 一个`S01E01-E02`物理文件只有一个`assetId`，`episodeNumbers=[1,2]`；Kairox不得重复执行文件操作。
- 同一Episode的1080p/2160p等多个物理版本分别拥有`assetId`，可共享Episode编号并用可选`versionKey`区分；Beta不自动选择主版本或删除重复版本。
- Season边界已经由Library声明、目录规则或Nexora分拣建立时，无法识别Episode编号的文件仍可Admission，`episodeNumbers=[]`；Asset identity和SourceBinding不能缺失。
- Basedata/Metadata/通用物理维护按实际Asset执行；整季Upgrade逐集校验等必须依赖Episode编号的Capability在信息不足时明确blocked，不猜测编号。
- Manifest不建立理论全集目录，不判断缺集，也不把一个物理文件拆成多个虚假Asset。

## 3. Nexora 是 Source Triage Domain

### 3.1 业务定义

```text
Nexora = Source Triage
        + Source Observation
        + SourceBinding
        + Re-triage / Rebind
        + Offboarding Source Operations
```

Nexora 不只是 SourceBinding adapter。SourceBinding 是预检过程中的一个原子能力产物，而不是整个预检过程。

Nexora 内部可以使用目录结构、文件名、Emby hierarchy、Provider、sidecar、FFprobe、字幕/内嵌标题、抽帧或 VLM。它可以保存自身改进准确性所需的 classification/topology evidence、confidence 和人工修正，但这些内部依据不进入 Libra 或 Kairox 的业务合同。

### 3.2 对 Libra 的最小交付

Libra 只关心：

```text
你是什么结构？  -> mediaType
你按什么内容理解？ -> contentProfile（由 Libra 最终赋值）
你是谁？        -> identity
你从哪里来？    -> SourceBinding
```

正式交付保持最小：

```text
OnboardingCandidate:
  candidateId
  mediaType: single | group
  identity:
    sourceIdentity
    displayName
    seriesIdentity?     # group + series
    seasonIdentity?     # group + series
  sourceBinding:
    sourceRevision
    sourceReference
    assets[]
  status: ready | needs_review | rejected
```

`identity` 是入库所需的最小稳定身份和用户可读名称，不是 Kairox Metadata。Nexora 不向 Libra 交付剧情、演员、海报、码率、编码、Planner 推理或预检依据。

SourceBinding 继续只回答真实来源和资产如何访问。对于 Season，它包含 Episode Asset 绑定；它不拥有 Kairox Basedata 或 Metadata Facts。

Triage发生在Libra创建`subjectId`之前，因此SourceBinding不能再以`subjectId`作为自身identity。Nexora使用`sourceId`和`assetId`标识候选来源与资产；Libra接受candidate、生成`subjectId`后，再通过幂等accept/bind command建立Subject与这些Nexora identity的关联。该关联不改变SourceBinding identity，也不复制Source facts到Libra。

### 3.3 contentProfile 的赋值

`Subject.contentProfile` 是 Libra canonical fact。Nexora 可以参与低成本识别，但不被要求通过昂贵 VLM 对所有来源自动判断 Profile。

专用 Library：

```text
Library 固定 Profile
-> Libra 为候选赋值 Subject.contentProfile
-> Nexora 在该 Profile 上下文中完成身份预检
```

混合 Library：

```text
媒体级用户明确设置
-> Library 路由规则
-> Source native metadata / sidecar
-> Nexora Beta轻量分拣结果
-> 用户确认（规则无法产出完整结论时）
-> Libra 正式赋值 Subject.contentProfile
```

首版不以Provider验证或通用VLM分类作为Admission前置依赖。Beta优先保证召回率：Library声明、路径、文件名和轻量规则只要能够产出完整的`mediaType/contentProfile/identity/Subject边界/SourceBinding`，candidate即可`ready`，不设置预检准确率或confidence发布门槛。无法产出完整结论时才是`needs_review`。

Library 保存的是 Profile 赋值政策，而不是媒体 canonical Profile：

```text
profileResolutionMode: fixed | rules | review
defaultContentProfile?
allowedContentProfiles[]
contentRoutingRules[]
unknownProfileAction: review | reject
```

专用库与混合库使用相同 Subject 模型，区别只是 Profile 的赋值来源。Kairox 不关心该值来自 Library 默认、规则、Nexora 建议还是用户确认。

### 3.4 Identity Readiness

只有预检 `ready` 的候选可以 Admission。Beta中`ready`表示必需字段与Subject边界完整，不表示内容分类或正式作品身份已经通过Provider/VLM验证。

`single` 最低条件：

```text
mediaType 明确
contentProfile 已由 Libra 确认
source-scoped admission identity可建立（文件名/来源名称可作为Beta identity label）
SourceBinding valid
```

`group + series` 最低条件：

```text
Nexora能够给出一个完整的Series/Season分组结论（允许来自目录/命名规则，Beta不要求验证准确率）
Episode归属该Season的结论完整
每个已接纳 Episode 的 SourceBinding valid
```

以下结果不得 Admission：

```text
mediaType/contentProfile/Subject边界没有任何可用结论，无法决定E01、E05、E07属于哪个Subject
```

它停留在 `identifying/needs_review`。但如果Library声明、用户选定目录或轻量规则已经产出一个完整Season分组，Nexora可以用source-scoped provisional identity使其`ready`；Beta不要求该分组经过Provider验证。不得在没有任何分组规则时把全库未知Episode任意合并。

不连续 Episode 合法：

```text
已知 Series / Season 1 / E01、E05、E07
```

它可以 Admission，但本期不宣称没有缺集。

### 3.5 Beta 准召策略

Beta保持“未知不能入库”，但严格区分未知与可能不准确：

```text
未知：无法形成完整Triage contract -> needs_review/rejected
可能不准确：contract字段完整但未经高成本验证 -> ready
```

Beta优先召回率，不把预检准确率作为发布门槛：

- 专用Library的Profile声明可以直接成为分拣输入。
- 文件名、目录结构和Source native hierarchy可以直接产生provisional identity/topology。
- 不强制番号Provider命中、普通影视Provider ID、VLM或人工确认。
- Nexora后续准确率建设取决于其分拣Capability质量，但不得改变Service最小输出合同。
- Kairox发现误判后发布`TriageMismatch`；Libra协调Nexora重预检，这条反馈闭环是Beta纠错机制。

召回率优先不允许伪造缺失字段：SourceBinding不可用、无法建立任何Subject边界或规则不能产出mediaType/contentProfile时，结果仍然是未知，不能Admission。

### 3.6 用户在 Admission 前看到什么

用户不应看到裸文件堆或 `subjectId`。Libra 查询投影组合 Nexora OnboardingCandidate：

```text
待识别媒体
来源：Y:\mixed\folder-17
发现文件：3
状态：正在识别 / 等待确认
```

部分识别时可显示：

```text
疑似剧集
已发现：E01、E05、E07
剧名和 Season 尚未确认
```

Admission 后显示优先级：

```text
Kairox canonical Metadata title
-> Nexora source displayName
-> 简化 source locator
-> 最后才是内部 ID
```

### 3.7 人工纠正事实

人工纠正是一等持久事实，自动预检不得静默覆盖。优先级固定为：

```text
用户明确纠正
> Library显式规则
> Source native structure/metadata
> Nexora自动分拣
```

事实Owner按领域拆分：

- Libra保存canonical `contentProfile`纠正、Series grouping归属和Subject级用户确认。
- Nexora保存Source grouping、Episode编号、多集/多版本映射和Source排除等Triage纠正。
- Kairox保存正式Metadata、Person关系、User Perception和Artifact选择等维护域纠正。

用户入口可以统一经过Libra协调，但不能把Source纠正写入Libra或把Metadata纠正写入Nexora。

每条Triage correction至少包含稳定scope、用户指定值、匹配的Source revision/fingerprint、correctionRevision和`active|conflicted|cleared`状态。用户可以显式清除修正并恢复自动分拣。

Source发生根本变化使人工修正前提失效时，Nexora不得盲目沿用或自动删除修正，必须标记`conflicted`并等待用户选择沿用、更新或清除。普通页面只显示“用户确认”“来源变化，需要重新确认”“恢复自动识别”，内部revision/evidence进入诊断。

## 4. Triage、Basedata 与 Metadata 的信息递进

三者不是三个“刮削深度”，而是三类不同事实：

```text
Triage：建立身份和来源拓扑
Basedata：建立当前物理、技术和布局事实
Metadata：建立用户需要的描述性丰富信息
```

### 4.1 Triage

回答：

```text
是什么结构、是谁、从哪里来
```

不拥有 codec、bitrate、resolution、plot、actors、poster 或 Optimize 判断。

### 4.2 Basedata

回答：

```text
已经绑定的媒体资产当前物理上是什么状态
```

典型事实包括 existence/readability、size、mtime、fingerprint、duration、container、codec、bitrate、resolution、stream facts 和 layout observation。

Season Basedata 由 Episode Asset facts 聚合。Basedata Objective 是 Kairox 固定运营合同，用户不可关闭，不属于 Rule Template。

### 4.3 Metadata

回答：

```text
关于这个已确认身份，用户要求哪些描述性丰富信息
```

典型事实包括正式/原始/本地化标题、年份、剧情、类型、地区、演员、导演、Provider identities、poster、fanart 和 NFO Artifact。

Nexora `identity.displayName` 与 Kairox正式标题可能文字相同，但职责不同：前者是 Admission identity label，后者是可配置 Metadata Objective 下的 canonical presentation fact。

### 4.4 Adapter 与事实所有权

Emby 一次响应可能同时返回 hierarchy、path、stream、plot、people 和 artwork。允许 Adapter 做请求合并或短期缓存，但不允许混合 canonical ownership：

```text
Nexora 认领 type/identity/hierarchy/SourceBinding
Kairox Basedata 认领机械和技术 Facts
Kairox Metadata 认领描述和 Artifact Facts
```

Nexora 为身份识别调用 FFprobe/VLM，不代表 Kairox Basedata/Metadata Gate 已通过。两个域可以复用底层技术 adapter，但不能共享业务 Capability 或跨域写 canonical facts。

## 5. Kairox 发现预检错误

Kairox 可以在 Basedata、Metadata 或 Optimize 执行时发现 Admission 与实际媒体矛盾，但不能修改 SourceBinding、contentProfile、Series/Season关系或重新分类。

```text
Kairox 发布 TriageMismatch
-> Libra 暂停 Admission 并 fence 旧 generation/Graph
-> Libra 建立 durable retriage operation
-> Libra 要求 Nexora 重新预检原 SourceBinding
-> Nexora 重新交付 identity + SourceBinding + status
-> Libra 保持、修正、拆分、合并或关闭 Subject
-> Libra 发放新 Kairox Admission
```

稳定 mismatch code 至少包括：

```text
MEDIA_TYPE_MISMATCH
CONTENT_PROFILE_MISMATCH
SUBJECT_SCOPE_MISMATCH
SOURCE_CONTENT_MISMATCH
ASSET_STRUCTURE_MISMATCH
```

Kairox 只报告合同矛盾和受影响 Binding，不替Nexora作正式诊断。当前Task/Graph的身份前提失效时必须 `plan_invalidated`；不得在同一Graph里链式调用Nexora、改写Subject后继续。

若Kairox某项昂贵能力偶然产生身份线索，该结果只能作为中性 hint 交由Libra协调Nexora重新预检。常规未知媒体识别仍必须发生在Admission前，不能把Kairox变成第二个Triage owner。

## 6. Rule Template 是 Library Maintenance Policy 的载体

### 6.1 当前事实与目标模型

当前Rule Template主要承担Optimize Objective；Metadata Gate Objective仍散落在普通/成人硬编码状态判断中。因此当前Rule Template尚不是完整的Library Maintenance Policy载体。

目标模型不是新建第二套Policy，而是强化现有Rule Template：

```text
RuleTemplate:
  templateId
  revision
  metadataObjective
  optimizeObjective
```

```text
Basedata Objective = Kairox固定运营合同
Metadata Objective = Rule Template
Optimize Objective = Rule Template
```

### 6.2 唯一策略体系

Subject不拥有媒体级Metadata或Optimize Policy。每个Subject的Objective是派生结果，不是第二套用户配置：

```text
Rule Template（Library标准）
+ Subject canonical facts
+ contentProfile / mediaType 作为条件输入
= Resolved Subject Objective / Objective Gap
```

允许的媒体级用户事实和意图包括contentProfile纠正、身份纠正、User Perception、Maintenance Run intent和Priority；不允许媒体级码率目标、Gate、Flow、Capability或策略覆盖。

若混合Library确实需要Profile差异，条件必须显式存在于该Library绑定的Rule Template中，而不能由`contentProfile`在Runtime偷偷追加：

```text
默认要求：title、poster
when contentProfile=jav：额外要求 identityCode、actors
when contentProfile=western_adult：额外要求 personRelations
```

这仍是一份Library Policy。

### 6.3 各Policy的独立职责

```text
Rule Template / Maintenance Policy：最终要达到什么结果
Automation Policy：谁建立Maintenance Run
Capability Policy：Planner允许使用什么手段
Provider Policy：允许从哪些内容来源获取信息
Approval Policy：风险Event是否等待确认
Resource Governor：何时有容量执行
Priority：谁先排队
```

允许Capability不等于要求使用它，也不等于授予Approval或destructive authorization。

### 6.4 Library Maintenance Policy 与 Kairox Lifecycle

二者不是两套目标系统，也不是上下级Automation组件。关系固定为：

```text
Library Maintenance Policy
  定义“这个Library要求媒体最终达到什么标准”

Kairox Lifecycle
  将该标准应用到一个具体Subject，判断“现在是否达到、还差什么、下一Gate是什么”
```

Library Maintenance Policy是desired-state declaration；Lifecycle是deterministic evaluator。Lifecycle不得发明、补充或覆盖Library的可配置Metadata/Optimize要求。

#### Canonical ownership

```text
Libra owns:
  Rule Template binding
  Library Maintenance Policy snapshot
  policyRevision

Kairox Lifecycle owns derived facts:
  resolvedMetadataObjective
  resolvedOptimizeObjective
  objectiveRevision
  objectiveGap
  gate achievement/freshness
  nextTargetGate
  maintenanceComplete
```

Basedata是例外但不是第二套Library Policy：它的最低Objective由Kairox固定运营合同定义，用来保证Kairox能够安全观察和操作Admission中的Source Assets。

#### Runtime data flow

```text
Library binds Rule Template
-> Libra persists policyRevision
-> Libra includes immutable policy snapshot in Kairox Admission
-> Lifecycle resolves the snapshot for this Subject
   using mediaType/contentProfile and current revisions
-> Lifecycle compares resolved Objective with canonical Facts
-> Lifecycle publishes objectiveGap/gate projection/nextTargetGate
-> Task Creator creates only the Lifecycle-selected Gate Task
-> Flow Planner consumes the persisted Gate Objective + gap
```

Lifecycle只能使用Admission中的policy snapshot及Kairox canonical facts，不得直接读取Libra Store、Admin config或当前Rule Template文件。这样运行中的Task可以明确绑定创建时的`policyRevision/objectiveRevision`，不会因一次无审计的配置读取改变语义。

#### Objective resolution

`resolveObjective()`可以作为Lifecycle物理模块中的纯函数/子组件，不需要建立与Lifecycle平行的重型Policy Engine。它只做：

```text
Rule Template Objective
+ explicit Library overrides（若合同允许）
+ contentProfile/mediaType条件匹配
= resolved Subject Objective
```

它不得读取Priority、Automation Mode、Approval、Governor pressure或Provider运行状态。这些信息不能改变“维护到什么程度”。

Lifecycle随后只做：

```text
resolved Objective
vs current canonical Facts/freshness/revisions
-> gap + Gate state + nextTargetGate + maintenanceComplete
```

Flow Planner才负责回答“如何补齐gap”；Lifecycle不得选择Provider、Capability或Workflow Graph。

#### Policy change

Library绑定的Rule Template或其有效内容变化时：

```text
Libra increments policyRevision
-> updates Kairox Admission policy snapshot
-> Kairox recomputes resolved Objective/objectiveRevision
-> old unstarted Graph is plan_invalidated
-> old executing/commit work is fenced at the declared revision checkpoints
-> Lifecycle evaluates the new gap
-> existing Run continues or a new Run starts according to Automation Mode
```

Policy变化不改变Libra `phase=maintenance`，也不直接创建指定Gate Task。它只改变Kairox随后用于Lifecycle判断的desired state。

如果新Policy降低标准，Lifecycle可以在不创建Task的情况下将Gate重新判断为passed；如果提高标准，则产生新的gap并由正常Runner/TaskAdmission路径供给Task。

#### Prohibited coupling

禁止：

- Lifecycle根据`contentProfile=jav/western_adult`自行追加Metadata required facts。
- Rule Template指定Flow、Event、Executor或固定Capability序列。
- Libra根据Rule Template逐Gate调用Kairox。
- Flow Planner重新解释Rule Template并产生不同于Lifecycle gap的目标。
- Policy change通过修改既有immutable Graph实现；必须使旧Plan失效并重新规划。

## 7. 统一 Objective Gap -> FlowPlan

三个Gate中，Basedata使用固定Objective；Metadata和Optimize使用Rule Template Objective。统一决策链为：

```text
Objective
-> Lifecycle计算当前Fact gap
-> Flow Planner读取gap、contentProfile、mediaType、Provider Policy、Capability Policy和runtime availability
-> immutable Workflow Graph
-> durable Event Runtime
-> canonical Facts
-> Lifecycle重新判断Gate
```

`contentProfile`只帮助Planner判断能力和Provider适用性。例如Library要求actors和poster：

```text
movie          -> 普通影视Provider
jav            -> JAV Provider
western_adult  -> 成人Provider或允许的人脸/VLM能力
series         -> Series/Season Provider
```

它不能自动产生“JAV必须NFO”“成人必须organize”“Movie必须Upgrade”等目标。

### 7.1 当前成人Metadata偏差

当前成人Metadata已经完成Capability/Event原子化，但决策层仍近似：

```text
mediaType/adultRegion
-> 硬编码成人Metadata要求
-> Planner成人专用完整Graph
-> 成人专用Gate判断
```

因此当前实现只完成执行内核统一，没有完整遵循：

```text
metadataObjective -> gap -> FlowPlan
```

必须将`adultId/scrapeStatus/title/protagonist`等必要性收回Rule Template Metadata Objective，将`adultRegion`直接Planner分支替换为gap与适用Capability选择。已有JAV Provider、抽帧、人脸、VLM、Person、NFO、poster和fanart原子能力必须保留，不能因统一Planner丢失业务能力。

## 8. Library 与用户产品模型

Library页面需要分别表达：

```text
Profile赋值方式：专用 / 规则 / 人工确认
允许的contentProfile
默认contentProfile（专用库）
Rule Template：Metadata和Optimize维护标准
Provider Policy
Allowed Capabilities
Automation Mode
Approval Policy
```

媒体详情表达：

```text
mediaType: single/group
contentProfile
身份与Series/Season关系
来源
当前维护目标和状态
```

用户可以纠正contentProfile和身份，但不能直接指定Gate、Flow、Event或Executor。

普通界面不展示Triage证据、confidence、revision、generation或Graph。复杂内部信息只进入高级诊断。

## 9. 已明确不做

- 本期不判断理论缺集。
- 不让未知媒体先Admission到Kairox再识别。
- 不以通用VLM作为混合库Admission的默认必需能力。
- 不建立媒体级Maintenance Policy覆盖。
- 不让contentProfile成为Flow名称或Objective模板的隐藏选择器。
- 不建立成人专用Metadata/Optimize执行引擎。
- 不迁移旧Series Subject、Task、FlowPlan或Facts；使用clean schema marker。
- 当前真实来源E2E和生产部署继续停止，直到本合同实现和能力守恒审计完成。

## 10. 尚需在实现设计中定死的细节

以下不是架构方向疑义，但必须在编码前形成可测试合同：

1. Movie/Season Identity Readiness方向已确定为Beta召回率优先；实现仍需为各adapter定义如何生成完整的provisional identity/Subject边界，但不得加入Provider/VLM准确率门槛。
2. Season Manifest已确定：Season 0是普通Season；双集文件一个Asset对应多个episodeNumbers；多版本保留多个Asset；Season边界成立时episodeNumbers可空。实现仍需固化schema和Capability前置条件。
3. 人工纠正规则已确定：用户纠正持久优先，自动预检不可覆盖；Source根本变化时进入conflicted，用户决定沿用、更新或清除。实现仍需固化各域command/schema。
4. 重新预检后Subject保持、改挂Series、拆分、合并和关闭的决策表。
5. Nexora Triage Work如何复用共享Workflow/Event基础设施，而不复制Kairox Gate/Run/Task体系。
6. Emby原始Observation的请求复用方式，确保优化网络访问但不混合Fact ownership。
7. Source改名、移动、Episode增删、Emby parent变化和Kairox mismatch各自触发的retriage范围。
8. Season级offboarding与Episode资产消失规则；不提供Episode级Membership/offboarding。
9. Rule Template Metadata Objective的字段schema及首版是否支持显式contentProfile条件。
10. Profile assignment和Triage的性能、抖动率、人工确认率与资源上限验收；准确率作为Nexora持续建设指标记录，不作为Beta Admission门槛。

## 11. 实施顺序

```text
1. 合同与能力迁移对账
2. Nexora Triage + Profile assignment
3. Libra Series grouping + Season Membership/Subject
4. Kairox Season Admission + Episode Asset Event
5. Rule Template metadataObjective
6. Lifecycle Metadata gap统一
7. Metadata Planner移除adult直分支并保全全部能力
8. Admin Web候选/Profile/Rule Template产品入口
9. clean initialization、静态审计和自动测试
10. 另行确认后重新制定真实来源E2E
```
