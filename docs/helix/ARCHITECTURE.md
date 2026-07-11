# ShelfDeck / Helix Architecture

Status: accepted business-domain contract; implementation design paused.

Last updated: 2026-07-12

本文记录 ShelfDeck 在 Helix Beta 复盘后确认的顶层业务边界。旧的
`Helix = Libra + Nexora + Kairox` 只描述 Pre-deck 上架维护组织，不再代表整个
ShelfDeck。任何旧文档中与本文冲突的 Membership、长期 maintenance、Policy、Person
或 offboarding 归属均以本文为准。

## 1. ShelfDeck owns the Deck

ShelfDeck 是用户媒体收藏的最终 owner。Emby Library、Folder、NAS 路径只是 Source、
Metadata 或呈现方式，不是“用户拥有哪些媒体”的最终事实。

```text
active deckId exists  = 用户拥有该媒体
active deckId absent  = 用户不拥有该媒体
```

`deckId` 是逻辑收藏身份，不等于文件、目录、Emby item、SourceBinding、`subjectId` 或
单台 NAS。一项收藏可以有多个 Inventory Representation，并分布在多个存储位置。

## 2. Business departments

```text
ShelfDeck
├─ Libra — Pre-deck 上架维护部
│  ├─ Nexora — Triage 与 Source preparation
│  └─ Kairox — Pre-deck media maintenance
├─ Deck — 收藏与库存维护部
│  ├─ Deck Acceptance
│  ├─ Deck Health
│  ├─ Inventory Management
│  └─ Off-deck Management
├─ Aftercare — Post-deck 售后维护部
│  ├─ Case Coordinator
│  ├─ Inventory Recovery
│  └─ Media Remediation
├─ User Perception — 用户感知记录与解析
└─ People Management — Person Registry 与演员库管理
```

这些部门平级。Libra 不拥有 Deck，Deck 也不指挥 Libra。Nexora、Kairox仍然只属于
Libra。Aftercare 不调用 Nexora/Kairox；跨部门只交换明确交付物或只读 projection。

## 3. Lifecycle

```text
Source discovery
→ onboarding / triage
→ Maintenance Scope
→ Kairox maintenanceComplete attestation
→ OnDeckPackage
→ Deck acceptance
→ active deckId
→ Deck Health / Aftercare
→ Off-deck
```

- Onboarding、Triage 和 Kairox Maintenance 全部属于 Pre-deck。
- `maintenanceComplete` 只证明 Kairox 对当前验收清单 revision 的可投影要求已满足。
- `maintenanceComplete` 不等于 On-deck，不证明用户已经拥有媒体。
- Deck 独立验收并创建 `deckId` 后，媒体才进入收藏。
- Pre-deck 取消不属于 Off-deck；Off-deck 只处理 active deckId。

## 4. Libra, Nexora and Kairox

Libra owns:

- Maintenance Scope、Pre-deck operation、重试与协调状态。
- Nexora/Kairox交付顺序和 OnDeckPackage 组装。
- 来自 Deck Acceptance Policy 的 immutable checklist snapshot 传递。

Nexora owns:

- Source observation、source identity、SourceBinding 与 Source topology。
- Admission 前 Triage：回答“是什么、是谁、从哪里来”。
- re-observe/rebind及预检准确性建设。

Kairox owns:

- Pre-deck Subject maintenance、Basedata/Metadata/Optimize Facts。
- Lifecycle、Objective Gap、Task、FlowPlan、Event Runtime和`maintenanceComplete`证明。
- Pre-deck Media-Cast Relation的判断与发布。

Kairox发现预检错误时只发布`TriageMismatch`；Libra要求Nexora重新预检。Kairox不能
写SourceBinding或Triage事实。

## 5. Triage and media structure

```text
mediaType: single | group
contentProfile: movie | series | jav | western_adult
```

- `mediaType`描述执行结构；`contentProfile`描述内容处理Profile。
- Series只作为Libra分组；Kairox剧集维护主体为Season，`subjectId`对应Season。
- Episode是Season下的Playable Asset，不建立独立Run、Priority或Task。
- Beta保持“未知不能入库”，但采用召回率优先：字段和边界完整的provisional
  classification可以进入；不要求Provider/VLM证明准确率。
- 本期不建设理论Episode Catalog和缺集策略。

详细Triage/Season合同见`TRIAGE_SUBJECT_AND_POLICY.md`；其中Policy和长期Owner描述若
与本文冲突，以本文为准。

## 6. Deck

Deck owns:

- Deck Library、Deck Entry与`deckId`。
- Inventory Representation、位置、副本和当前已验收媒体描述。
- Deck Acceptance Policy / Template。
- On-deck验收、Deck Health、重复与冗余治理、存储分布。
- Off-deck Management。

用户“添加媒体库”是一个统一产品动作，内部创建：

```text
Deck Library + Nexora Source Scope + Libra Intake Route
```

Deck Health是Top-down验证：从`deckId`出发，证明全部Inventory Unit真实存在且健康。
Nexora Observation是Bottom-up发现：从Source出发发现新媒体或Binding变化。两者可能
使用相似I/O，但业务目标、Store与Planner不同；Deck不得调用Nexora完成健康检查。

## 7. Deck Acceptance Policy and Kairox Lifecycle

Library Maintenance Policy正式归Deck，并改称Deck Acceptance Policy。现有Rule Template
应演进为其模板载体。

```text
Deck Acceptance Policy revision
→ Libra freezes checklist snapshot for a Maintenance Scope
→ Kairox Lifecycle projects Kairox-applicable requirements into Objectives
→ Objective Gap → FlowPlan → Events → Facts
→ maintenanceComplete attestation
→ Deck independently validates OnDeckPackage
```

Policy可同时包含Kairox可处理要求（Metadata、codec、bitrate、字幕、布局）和Deck本地
要求（存在性、唯一性、副本与存储分布）。Lifecycle是确定性Evaluator，不拥有Policy，
不得根据contentProfile、资源压力、Provider可用性或Automation偷偷追加目标。

## 8. Aftercare

Post-deck优化和修复属于Aftercare，不返回Libra/Kairox：

```text
Deck Health / user intent
→ Aftercare Case
→ independent diagnosis and repair workflow
→ Repair Package
→ Deck revalidation
```

Inventory Recovery处理文件缺失、位置、副本和存储恢复；Media Remediation处理
Metadata、编码、质量和媒体关系修复。Repair Planner可借鉴Kairox Flow Planner的技术
结构，但两者是不同业务组件。只有Company Capability和纯Runtime基础设施可共享。

## 9. Off-deck

Off-deck Management是Deck内独立子部门，拥有物理`offDeckPolicyEngine`及自己的Policy、
Plan、Events、验证和Receipt。

用户语义固定为：

```text
退出收藏 = 销毁该Deck Entry拥有的全部媒体表示并退役deckId
```

不再提供“停止管理但保留媒体”、detach或retain模式。任一存储位置不可访问或销毁结果
不可验证时不得提交Off-deck。只删除冗余副本而保留deckId属于Inventory Management。

Off-deck Policy可使用收藏时长、播放/保护状态、User Perception和人物策略，但不得绕过
破坏性授权及逐Deck Entry验证。

## 10. User Perception

User Perception是一级部门；不引入全局`contentId`。业务主键是不可变`perceptionId`，
每条记录表达一项感知事实。`subjectId`、`deckId`、Provider ID和名称只作为依赖证据和
查询上下文。

- Perception可自行从Douban/Emby/手工输入获取记录。
- 原始记录不可变；去重、冲突与优先级在查询时解析。
- 查询只返回`found`或`not_found`，匹配规则系统内置且支持batch。
- Pull-only：不通知、不打断消费者正在执行的流程；消费者决策时查询并冻结结果。
- Kairox Lifecycle可在解析Objective时读取当前Perception projection。

## 11. People Management and cast ownership

People Management本期业务目标是自动、半自动或手工建立可靠Person Registry，而不是
演员作品补齐。它拥有：

- Person、姓名、别名、Provider Identity、头像和Reference Face。
- 人物特征、匿名人脸聚类、注册候选、人工注册、自动注册与人物合并。
- 从Deck已验收演员关系派生的人物—媒体反向索引与统计。

它不拥有Media-Cast Relation。Canonical边界为：

```text
系统认识哪些演员                         → People Management
Pre-deck媒体由哪些演员出演               → Kairox
On-deck当前已验收演员描述                → Deck
Post-deck演员关系修正                    → Aftercare，Deck重新验收
某演员在Deck有多少部媒体等反向查询投影   → People Management
```

Person注册不自动证明其出演任何媒体。Kairox可以使用Provider信息、番号、抽帧、人脸
匹配、People Registry Reference Face和用户确认闭合关系。JAV与欧美成人只是证据不同，
Owner相同。

家庭自拍视频中，People Management可以聚合匿名人脸并让用户统一命名，建立Person；
Kairox随后逐媒体抽帧比对，独立确认出演关系。对应能力语义必须分开：

```text
People: face clustering for person registration
Kairox/Aftercare: face matching for media cast relation
```

未来可增加演员作品目录、收藏覆盖率、缺失、新作追踪、保护或Off-deck候选；本期不做。

## 12. Capability scopes

Capability分为Company和Department两级。Scope创建后不可变：

- Company Capability必须领域中立，不读写部门Store、不发布部门Canonical Fact。
- Department Capability只服务所属部门业务。
- 不设计promotion、wrapper、alias、inheritance或兼容层。
- 需要公司级能力时创建新的明确Capability，迁移调用者后删除旧能力。
- 允许代码重复；禁止为复用牺牲输入输出边界。

Capability数量本身不是性能问题；隐式I/O、过大Payload、资源声明不清和职责过宽才是。
Event Runtime、DAG、Governor和类型校验属于基础设施，不是业务Capability。

## 13. Physical form and dependency rule

当前仍采用`media-service`内的模块化单体，不增加内部HTTP、独立进程、独立部署或消息
中间件。Service Facade、Store owner、typed handoff和composition root构成物理边界。

跨部门不得直接写对方Store或伪造对方Canonical Fact。低层Adapter请求可以合并并形成
不可变Evidence；事实边界不应造成对相同外部页面的重复抓取。

## 14. Superseded assumptions

以下旧结论正式失效：

- Emby Library或Libra Membership是最终收藏事实。
- Onboarding后进入永久maintenance；`maintenanceComplete`等于拥有媒体。
- Deck是Libra的一部分。
- Library Maintenance Policy归Libra或Kairox。
- Post-deck优化交回Kairox。
- Aftercare调用Nexora/Kairox。
- Offboarding包含retain/detach。
- People Management拥有Media-Cast Relation或接管Kairox Metadata流程。
- Person注册自动意味着出演关系成立。

## 15. Design freeze and open questions

实现和真实来源E2E保持暂停。下列问题必须继续Design并经用户确认后才能编码：

1. `OnDeckPackage`精确Schema、幂等性和验收失败返回协议。
2. Pre-deck SourceBinding到Deck Inventory Representation的交接。
3. `deckId`唯一性、Movie/Season/Series及多版本模型。
4. Deck Acceptance Policy Schema及Policy变更后的Deck/Aftercare路由。
5. Deck Health检查集合、频率、Emby表示和故障等级。
6. Aftercare Case、Repair Plan、Repair Package、lease与恢复协议。
7. Person Observation/Candidate/Reference Face模型及自动注册门槛。
8. Media-Cast Relation的On-deck交付与Person merge后的引用处理。
9. Off-deck自动化授权和不可访问Inventory的长期状态。
10. 新顶层架构的正式名称，以及“Helix”是否仅保留为Libra内部架构名。
