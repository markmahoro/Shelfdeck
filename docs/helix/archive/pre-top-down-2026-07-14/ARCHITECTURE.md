# ShelfDeck Business Architecture

Status: accepted direction; detailed contracts remain in Design.

Last updated: 2026-07-13

本文是当前最高优先级业务架构合同。旧的 `Helix = Libra + Nexora + Kairox`、
`Membership -> maintenanceComplete` 和 Nexora Triage 模型均已 superseded。当前仍为
模块化单体；部门边界是业务与代码所有权边界，不表示独立进程、HTTP或部署单元。

## 1. ShelfDeck owns the Deck

ShelfDeck维护用户真正拥有的媒体收藏。Emby Library、Folder、NAS路径、SourceBinding、
`subjectId`和文件都只是输入、位置或处理实体，不是最终收藏事实。

```text
active deckId exists  = 用户拥有该媒体
active deckId absent  = 用户不拥有该媒体
```

Series的Deck颗粒度固定为Season。一个Deck Entry可以引用多个Asset和多个Inventory
Representation；位置迁移不应改变`deckId`。

## 2. Business departments

```text
ShelfDeck
├─ Procurement — 采购部：发现、预检并交付可生产原料
├─ Libra — 生产部：开生产订单、协调生产并Commit给Deck
│  ├─ Kairox — Workspace内容规范化工厂
│  └─ Nexora — Canonical Source修正与安全生产部门
├─ Deck — 库存部：标准、独立验收、所有权与库存健康
│  └─ Off-deck Management — 退出收藏与库存销毁
├─ Aftercare — 售后部：On-deck后的修复与改善
├─ User Perception — 用户感知记录与解析
└─ People Management — Person Registry与演员库维护
```

一级部门拥有独立业务目标、事实和失败责任。跨部门只交换明确的Request、Ticket、Package、
Receipt或只读Projection。共享Capability可以复用或复制，但不得复用另一部门的业务状态机。

## 3. End-to-end lifecycle

```text
External Source
→ Procurement observation / triage
→ Procurement Candidate
→ Libra resolves Acceptance Spec
→ Libra Run
→ Kairox Run(s) in Libra Run Workspace
→ VerifiedMediaPackage
→ Nexora Source Run(s)
→ SourceTransitionReceipt
→ Libra assembles OnDeckPackage and commits
→ Deck independent Acceptance Attempt
   ├─ accepted → active deckId
   └─ rejected → Libra organizes rework
→ Deck Health / Aftercare
→ Off-deck destruction
```

Pre-deck取消或生产失败不属于Off-deck。Off-deck只处理已经存在active `deckId`的收藏。

## 4. Procurement

Procurement拥有完整采购与预检业务，目标是把外部Source变成可供生产考虑的Candidate。

它负责：

- Source observation、媒体发现和非媒体剔除；
- Triage：回答“是什么、是谁、从哪里来”；
- `single | group`结构、Movie或Season候选身份及Asset关系；
- Beta召回率优先的准召判断和未来准确率建设；
- `Procurement Case`、预检Attempt和`Procurement Candidate`。

Procurement不计算Acceptance Spec，不读取Kairox Gate，不决定是否收藏。SourceBinding解析可以
是共享原子Capability；其输出Evidence进入Candidate，不因此形成一个独立SourceBinding业务域。

Triage必须在Libra Run之前完成。原料身份或边界尚不充分时不得创建生产订单，也不得调用
Kairox。Beta允许完整但低置信度的provisional identity，不等于允许缺失身份边界。

## 5. Deck standard and Libra Acceptance Spec

Deck拥有`Deck Acceptance Policy`，它只表达甲方通用标准，不感知Pre-deck此前发生了什么。
Libra作为总供应商收集当前业务上下文，将标准实例化为本次订单的确定性
`Acceptance Spec`：

```text
Deck Acceptance Policy
+ Procurement Candidate
+ contentProfile / Library context
+ User Perception projection
→ Libra Acceptance Spec Resolver
→ immutable Acceptance Spec
```

Policy与Spec不是同一个概念：Deck定标准，Libra根据当前对象出Spec。原先
`Acceptance Checklist Snapshot`统一收敛为`Acceptance Spec`，不并存第二个名称。

Spec只包含最终产物要求，不包含Policy、Perception、Source、设备、Flow或执行理由。
规范化后的确定性内容产生`acceptanceSpecId`。只有Spec语义内容变化才表示订单目标变化；
Policy revision或Perception revision变化但Spec相同，不影响当前订单。

Policy或User Perception变化时发布中性Signal。Libra重新计算活动订单的Spec：

```text
new acceptanceSpecId == current acceptanceSpecId
→ 当前Libra Run继续

new acceptanceSpecId != current acceptanceSpecId
→ 旧Libra Run superseded
→ 新Libra Run + 新Workspace
```

User Perception不直接接触Kairox，也不命令消费者；是否重新开单由Libra自己的合同决定。

## 6. Libra Run: the production order

Libra Run是一张确定性生产订单，也是Libra的核心业务实体：

```text
Libra Run = Ownership Target + immutable Acceptance Spec
```

它只在Procurement Candidate、Ownership Target和Acceptance Spec均已确定后创建。它拥有：

- `libraRunId`和订单状态；
- 全局`normal | expedited`优先级；
- Acceptance Spec与目标身份；
- Kairox Run Ticket、Nexora Source Run Ticket、Attempt与Receipt；
- Libra Run Workspace的引用生命周期；
- OnDeckPackage组装、Deck Commit与返工协调。

建议状态收敛为：

```text
running | blocked | succeeded | abandoned | superseded
```

Libra只理解子部门交付合同，不理解Gate、Task、Flow、Event、codec或文件操作phase。它不能
写成按内部步骤推进的中央Mirex状态机。

全局Priority属于Libra Run，并投影到Kairox/Nexora Ticket和Libra交付工作。它不属于冻结的
Acceptance Spec或外部事实快照。Run终结或用户取消加急后才清除。

## 7. Kairox Run and Workspace

Kairox是内容规范化工厂。它只读Canonical Source，只写属于Libra Run的持久化Workspace，
不执行原地Replace、Reorg、Move、最终Materialize或旧Source清理。

```text
Libra Run Workspace/<libraRunId>/
├─ inputs/
├─ artifacts/
├─ staged-media/
├─ evidence/
├─ packages/
└─ manifest
```

Workspace以`libraRunId`为物理与清理边界，不按Kairox生产批次分目录。Kairox Run只是同一
生产订单下基于一张Ticket和一份`InitialExternalFactsSnapshot`的一次生产批次。

Kairox Run的业务目标是：

> 在Workspace内生产并封装满足Acceptance Spec的VerifiedMediaPackage。

Kairox Run完成不表示Source已修改、已On-deck或Deck已接受。一个Libra Run可以签发多张
Kairox Run Ticket；新Ticket形成新不可变Graph，但可在同一Workspace内使用依赖仍有效的
Evidence/Artifact。任何产物不得跨Libra Run复用。

Workspace在Libra Run活动或仍被Nexora/Deck交付引用时保留。Libra Run成功、abandoned或
superseded且引用归零后整体延迟清理。空间压力必须阻止新生产并形成明确故障，不能静默删除
活动订单产物。

## 8. Kairox Lifecycle and Event fencing

Kairox永远不接触Deck Policy或User Perception。Ticket只告诉它“要生产什么”和“可使用什么
生产资料”。Lifecycle是Kairox内唯一的Spec-to-Objective翻译器和Gate判断组件：

```text
Acceptance Spec + Kairox canonical facts
→ Basedata / Metadata / Optimize Objectives
→ Objective Gap
→ Task Creator
→ Flow Planner
→ immutable Event Graph
→ Capability Executors
→ new facts / artifacts
→ Lifecycle重新判断
→ VerifiedMediaPackage attestation
```

Task done不等于Gate passed；只有Lifecycle判断Objective满足。Task Creator、Flow Planner、
Event Runtime和Capability Executor不得重新解释Spec。

每个Event Intent只声明自己实际依赖的Ticket事实。Event Runtime在执行前、Permit后、Artifact
激活前和Package发布前，使用Kairox本地Ticket/Fact Projection做局部比较；Event不得调用
Procurement、Libra、Nexora、Deck或User Perception，也不得全量校验无关事实。

依赖变化时：

```text
Event → invalidated（不是普通failed，不消耗retry/Task attempt）
Kairox Run → abandoned: INPUT_SNAPSHOT_INVALIDATED
Kairox → Libra返回失效证据
Libra重新取得生产资料并冻结Snapshot
同一Libra Run下签发新Kairox Run Ticket
```

生产资料变化但Acceptance Spec不变，不创建新Libra Run。产物目标变化才创建新订单。

## 9. Nexora safety production

Nexora不再拥有Triage。它的独立业务目标是：

> 将VerifiedMediaPackage安全地修正为Libra要求的Canonical Source状态，并证明结果。

Nexora负责Replace、Reorg、Move/Rename、最终Artifact Materialization、路径冲突、containment、
原子切换、回滚、旧Source替换清理和SourceTransitionReceipt。Source Run必须验证Ticket、
Authorization、Source revision、Package checksum、目标范围和commit marker。

Kairox Package按不可信输入处理；Package不得指定任意绝对目标路径或绕过Nexora自己的安全
规划。Nexora不理解Acceptance Policy、Gate、Objective或Deck状态。

Nexora内部技术重试只允许发生在结果可判定且幂等的边界。危险切换结果不确定时必须先
Inspect/Reconcile，不能盲目重放。一次Source Run业务Attempt明确失败后，只有Libra可以在
同一Libra Run下签发新的Attempt。

Nexora清理旧Source只服务于“媒体继续存在”的Source修正。退出收藏并销毁库存不属于Nexora，
而属于Deck Off-deck Management。

## 10. Libra delivery and Deck acceptance

Kairox和Nexora交付齐备后，Libra以固定数量的事实读取完成轻量组装：

```text
Acceptance Spec
+ VerifiedMediaPackage
+ SourceTransitionReceipt
+ current Source evidence
+ Ownership Target
→ immutable OnDeckPackage
→ idempotent Deck Acceptance Request
```

组装不得复制媒体、执行FFprobe、重新计算Spec或读取子部门Store。正常路径由中性Signal立即
唤醒，启动恢复与周期Reconcile只负责Signal丢失后的最终恢复。

Deck拥有独立Acceptance Engine/Planner/Attempt。它可以调用公司级或Deck专属只读Capability，
直接检查最终Source、大小、stream、Metadata Artifact、布局和身份，而不是只相信Kairox自证。
Deck不调用Libra/Kairox/Nexora内部组件。

```text
accepted
→ Deck创建active deckId
→ Libra Run succeeded

rejected
→ 结构化AcceptanceRejection返回Libra
→ Libra判断新Kairox Ticket、新Nexora Attempt或新Libra Run
```

Policy更新存在正常时序摩擦：Libra可能按旧标准生产，Deck按当前标准验收后退货。架构不使用
跨域长事务消灭这一窗口，而通过Signal、revision、结构化Evidence和返工闭环收敛。Policy
revision不同本身不是失败；实际适用标准或产品不合格才拒绝。

## 11. Resource priority

共享Resource Governor只拥有容量、Permit、排队和背压，不拥有业务状态。优先级固定为：

```text
safety control plane
→ Deck Acceptance
→ Libra delivery assembly / commit
→ expedited Libra Run work
→ normal Libra Run work
→ background observation / cleanup
```

Deck Acceptance是最高业务优先级。它不得抢占已经执行的危险操作，但资源释放后必须优先，
并应先执行低成本、高淘汰率检查。缩短验收和Libra组装时间是后续持续性能目标。

## 12. Deck, Aftercare and Off-deck

Deck独立拥有Acceptance Policy、Acceptance、`deckId`、Inventory Representation、Deck Health、
重复治理和Off-deck。Deck Health从`deckId`出发Top-down证明库存真实存在；Procurement从外部
Source Bottom-up发现原料，两者不能互相代替。

Aftercare只处理active deckId后的修复与改善。它可以建立自己的Case Coordinator、Planner和
下级部门，复用或复制原子Capability，但不调用Libra/Kairox/Nexora业务状态机。

Off-deck Management是Deck内独立业务，拥有Policy Engine、候选、用户授权、Destruction Run、
Evidence和deckId终结。退出收藏即销毁对应库存，不存在“退出收藏但文件保留且ShelfDeck不管”。

## 13. Media structure and Beta baselines

```text
mediaType: single | group
contentProfile: movie | series | jav | western_adult
```

- Series的生产与收藏主体为Season；Episode只是Season下的Playable Asset。
- `contentProfile`由采购结果、Library Context和人工规则提供给Libra，不由Kairox推断。
- 本期不建设理论Episode Catalog或缺集策略。
- Movie identity使用TMDB Movie ID；Series使用TMDB Series ID + Season Number；JAV以非空番号
  作为Beta身份；Western Adult接受当前能够稳定赋予的内部身份。
- User Perception必须有`found`结果才能形成Acceptance Spec；低评分媒体仍正常生产并On-deck，
  是否退出收藏只由后续Off-deck决定。

Movie Optimize标准继续固定为：

| User Perception | `maxSizeGB` | Mandatory requirements |
| --- | ---: | --- |
| 1 star | 2 GiB | HEVC、`mediaForm=stream_file` |
| 2 star | 4 GiB | HEVC、`mediaForm=stream_file` |
| 3 star | 8 GiB | HEVC、`mediaForm=stream_file` |
| 4 star | 14 GiB | HEVC、`mediaForm=stream_file` |
| 5 star | 50 GiB | HEVC、`mediaForm=stream_file`、4K、高质量音频 |

高质量音频白名单为E-AC3 Atmos、TrueHD、TrueHD Atmos、DTS-HD MA和DTS:X；必须是正片主音轨。
Kairox不提供音频转码Capability，缺失时只能形成Upgrade Gap或blocked，不能伪造满足。

## 14. Superseded assumptions

以下旧结论不得继续指导实现：

- `Helix = Libra + Nexora + Kairox`代表整个ShelfDeck；
- Libra同时承担Intake，或Nexora拥有Triage；
- Libra只是typed message relay，不拥有生产订单；
- Kairox Maintenance Run跨越Source Transition直到`maintenanceComplete`；
- Kairox读取User Perception或Deck Policy；
- Kairox直接Replace/Reorg/Materialize Canonical Source；
- SourceBinding是一个必须独立维护全局状态的业务域；
- Deck只检查单据或直接相信Kairox Attestation；
- Off-deck删除属于Nexora；
- `maintenanceComplete`等于拥有媒体。

## 15. Remaining design work

1. Procurement Candidate的精确Schema、Attempt和人工纠正合同。
2. Acceptance Spec Schema、规范化和`acceptanceSpecId`算法。
3. Libra Run、Kairox Run、Nexora Source Run的状态与Ticket/Attempt Schema。
4. Workspace Artifact引用、局部依赖复用和垃圾回收合同。
5. VerifiedMediaPackage、SourceTransitionReceipt、OnDeckPackage和AcceptanceRejection Schema。
6. Deck Acceptance Planner、Capability和性能预算。
7. SourceBinding Evidence到Deck Inventory Representation的交接。
8. deckId生成、多版本与Season Asset模型。
9. Deck Health、Aftercare和Off-deck后续细化。

上述合同确认并完成实现计划前，代码实施、真实来源E2E和生产部署继续暂停。
