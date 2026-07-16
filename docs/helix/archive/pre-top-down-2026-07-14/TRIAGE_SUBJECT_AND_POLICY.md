# Procurement Triage、Season与Acceptance Spec合同

Status: accepted direction; implementation paused.

Last updated: 2026-07-13

本文细化Procurement预检、媒体结构以及Deck Policy到Libra Spec的边界。顶层Owner以
`ARCHITECTURE.md`为准。

## 1. Information progression

```text
Procurement Triage
→ 回答“是什么、是谁、从哪里来”

Kairox Basedata
→ 回答已交付生产资料当前物理和技术上是什么状态

Kairox Metadata
→ 回答已确认身份需要哪些描述性丰富信息与Artifact
```

三者不是不同深度的同一刮削。Adapter可以复用请求或底层Capability，但不得混合业务事实。

## 2. Procurement Triage

Procurement而非Nexora拥有Triage。它内部可以使用目录结构、文件名、Emby hierarchy、Provider、
sidecar、FFprobe、字幕/内嵌标题、抽帧或VLM，并对召回率、准确率和人工纠正负责。

对Libra的最小Candidate只回答：

```text
是什么？  mediaType: single | group
是谁？    identityCandidate + user-visible display
从哪来？  sourceBindingEvidence + assetStructure
```

不交付剧情、演员、海报、码率、编码、Planner推理或Triage内部依据。SourceBinding是
`source.binding.resolve`等Capability的Evidence输出，不等于整个Triage流程，也不需要独立成为
全局业务域。

Beta保持“未知不能开生产订单”，但采用召回率优先。Library声明、路径、文件名和轻量规则只要
形成完整、稳定、可纠正的provisional identity与边界即可准召；不要求Provider/VLM证明准确率。

## 3. Media structure

```text
mediaType: single | group
contentProfile: movie | series | jav | western_adult
```

`mediaType`描述生产结构；`contentProfile`描述适用的内容处理Profile。Procurement可以提供建议，
但Libra结合Library Context和人工规则形成订单上下文；Kairox只消费最终Acceptance Spec。

### Single

Movie、JAV和单体成人文件通常为`single`。Candidate必须包含稳定identity和至少一个Source Asset。

### Group / Series

Series的生产与收藏颗粒度固定为Season：

```text
TMDB Series identity
+ seasonNumber
→ Ownership Target
```

- Series只是跨Season分组字段，不是生产或Deck主体。
- Season 0按普通Season处理。
- Episode是Season下的Playable Asset，不建立独立Libra Run、Priority、Gate或Task。
- 双集文件允许一个Asset对应多个`episodeNumbers`。
- 多版本允许同一Episode保留多个Asset。
- Season边界成立但无法识别Episode号时，Beta允许`episodeNumbers=[]`。
- 本期不建设理论Episode Catalog或缺集策略。

如果预检只能得到离散Episode 1/5/7但无法确认真实Series/Season，可在明确的source-scoped
provisional Season边界下准召；不得在没有任何分组规则时把全库未知文件任意合并。

## 4. Identity baseline

| Profile | Beta identity readiness |
| --- | --- |
| Movie | TMDB Movie ID |
| Series | TMDB Series ID + Season Number |
| JAV | 非空稳定番号；不二次判断番号合法性 |
| Western Adult | 当前识别能力能够稳定赋予的内部媒体身份 |

Western Adult未来可增加内容感知身份和去重，但Beta不以高成本VLM为同步准召门槛。去重是
On-deck后的Deck Feature，不得在准召阶段以“疑似重复”阻止收藏。

## 5. Human correction

人工纠正优先于自动预检，至少记录稳定scope、指定值、匹配的Source evidence、revision和
`active | conflicted | cleared`。Source根本变化使纠正前提失效时，Procurement不得盲目沿用或
自动删除，应标记`conflicted`并让用户选择沿用、更新或清除。

纠正Owner按语义划分：

- Procurement：媒体结构、候选身份、Episode/Season Asset映射和Source排除；
- Libra：Library Context、contentProfile确认、Ownership Target与Acceptance Spec；
- Kairox：正式Basedata/Metadata Facts及Package Artifact；
- People Management：Person Registry，不拥有媒体演员关系。

## 6. Kairox发现Triage错误

Kairox可以在生产中发现Ticket与实际输入矛盾，但不能修改Procurement事实或自行重新预检：

```text
Event返回SOURCE/IDENTITY/ASSET evidence mismatch
→ Event invalidated
→ Kairox Run abandoned并返回Libra
→ Libra停止当前生产批次
→ 新发现回到Procurement重新Triage
→ 新Candidate改变Ownership Target时，旧Libra Run superseded
→ Candidate只改变生产资料且Spec不变时，同一Libra Run签发新Kairox Ticket
```

Kairox偶然产生的身份线索只能作为中性Hint进入Procurement Case，不成为第二个Triage Owner。

## 7. Deck Policy、Libra Spec与Kairox Lifecycle

唯一链路为：

```text
Deck Acceptance Policy（甲方通用标准）
+ Procurement Candidate / Library Context / User Perception
→ Libra Acceptance Spec Resolver
→ immutable Acceptance Spec（本次生产订单要求）
→ Kairox Lifecycle
→ Basedata / Metadata / Optimize Objectives
→ Objective Gap
→ FlowPlan / Events
```

Deck不感知Pre-deck历史，因此不替Libra计算Spec。Libra不选择Gate、Flow或Capability。Kairox
不读取Policy、Perception或Spec推导理由；Lifecycle只把已经确定的Spec翻译为Kairox Objectives，
并独立判断是否满足。

Rule Template应演进为Deck Acceptance Policy的模板载体，而不是Kairox配置。当前成人Metadata
硬编码和Optimize-only Rule Template尚未符合该链路，必须clean cut，不能保留双轨。

## 8. Objective ownership

```text
Deck owns:
  Acceptance Policy / Template

Libra owns:
  Acceptance Spec Resolver
  immutable Acceptance Spec
  Libra Run

Kairox Lifecycle owns derived facts:
  resolvedBasedataObjective
  resolvedMetadataObjective
  resolvedOptimizeObjective
  objectiveRevision
  objectiveGap
  gate state
```

Basedata最低要求可以是Kairox固定运营合同，但仍由Lifecycle投影为Objective。Flow Planner只回答
如何补Gap；Capability Policy只限制可用手段；Approval、Resource和Priority都不能改变目标。

## 9. Metadata baseline

Metadata Spec服务于最终媒体消费所需的描述和Artifact，但不验证Consumer UI是否已经展示，
也不包含User Perception。形式检查保持轻量：NFO由受控renderer生成且可解析；要求的图片存在、
非空并绑定当前revision。

| Profile | Beta requirements |
| --- | --- |
| Movie | TMDB ID、title、year/release date、plot、genre、actor、director、NFO、poster |
| Season | Series title/plot/genre/actor/NFO/poster；seasonNumber；已观察Episode的number/title/plot/NFO |
| JAV | 番号、title、release date、studio、genre、NFO、poster、fanart |
| Western Adult | 内部身份、title、NFO、poster |

“至少一项”适用于genre/actor/director等集合字段。未列字段为可选；本期不验证理论缺集。

## 10. Product configuration boundary

Library/Admin产品配置可以表达：

- Procurement Source与准召规则；
- 专用/混合Profile赋值方式；
- Deck Acceptance Policy Template；
- Provider与允许Capability；
- Automation、Approval和Resource Policy。

用户不能指定Gate、Flow、Event或Executor。普通界面不展示Triage evidence、revision、Graph或
内部ID；诊断视图才展示详细推导和执行证据。
