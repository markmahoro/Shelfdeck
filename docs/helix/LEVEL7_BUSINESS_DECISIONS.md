# Level 7 Business Decision Register

Status: `LEVEL_7_ARCHITECTURE_CLOSED`；Helix-beta 发布范围见 2026-08-22 `L7-PS-01`

Last updated: 2026-08-22

## Purpose and authority

本文是Level 7起草期间曾用于与用户讨论**业务决定**的非Canonical工作文档。它不是Architecture Review、
不是SSOT、不是活动计划，也不能覆盖`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`。

Level 7正文可以自主确定纯技术架构，例如DAG表示、Event状态、类型系统、Permit算法、队列结构、重试
实现和物理组件候选。只有无法由Level 0–6唯一推导、并且会改变以下至少一项内容的分叉，才进入本文：

- 用户需要表达什么Intent或作出什么Decision；
- 用户能看到的业务结果或失败后果；
- 不可逆操作的授权、取消或责任边界；
- Business Domain、Canonical Owner、Business Handoff或业务对象连续性；
- 同一事实下用户是否会得到不同的收藏结果。

以下内容不得提交给用户作为业务决策：类名、表名、Store、队列、DAG算法、状态字段、资源键、默认重试
次数、Capability拆分粒度、代码复用方式、性能采样实现或Level 8物理组件映射。它们由Codex依据已确认
合同和工程证据自行收敛。

## Decision workflow

每个真实业务决策使用`L7-DP-xx`编号，并且必须包含：

1. 引用的Level 0–6条款；
2. 无法唯一推导的具体业务分叉；
3. 每个方案造成的用户旅程差异；
4. 对Owner、Handoff、Authorization和失败责任的影响；
5. Codex建议及反例；
6. 用户确认结果；
7. 回写SSOT的bounded change scope。

用户确认前，该问题只能阻断受影响的Level 7分支，不能把假设写成正式合同。确认后仍须先回写SSOT并
完成Level 0–7一致性审计，才能关闭Decision Item。

## Product scope decisions after Level 7 closure

Level 7 架构合同保持 Accepted/Closed。下列决定不改 Owner、Handoff 或 SSOT profile
定义，只收窄 **Helix-beta 发布范围**。

### L7-PS-01 Helix-beta 仅为 Movie 全链路

确认日期：2026-08-22  
确认人：Product Owner

**分叉：** Helix-beta 是四类媒体（Movie / Series / JAV / Western Adult）全部验收，
还是只把 Movie 的 SSOT 旅程 A–I（含退出收藏、Shelf 注销、人物、健康、概览）作为
全功能 Beta。

**用户确认：** Helix-beta = 仅支持 Movie 的全功能版本。退出收藏等全部 Movie 功能点
都在范围内。2026-07-23 四类媒体 Feature Matrix 作废。

**对架构的影响：** 无。SSOT 仍定义 Series / JAV / Western Adult。Helix-beta 不得宣称
支持那些 profile，也不得从 SSOT 删除它们。

**回写：** `docs/helix/BETA_FEATURE_ACCEPTANCE_BASELINE.md`；归档
`docs/helix/archive/BETA_FEATURE_ACCEPTANCE_BASELINE_FOUR_PROFILE_2026-07-23.md`。
不修改 `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`。

## Open business decisions

没有开放的Level 7架构业务决策。Execution Foundation已经由Level 0–6唯一推导并通过封闭审计：用户定义Outcome，
系统自主选择Means；正式Material副作用、Input Settlement和Off-deck继续受既有Authorization合同约束；
资源不足只形成等待或背压，不改变业务结果。2026-07-16完成的62项Capability Conservation Audit同样没有
发现新的用户旅程、Owner、Handoff或Authorization分叉。

### L7-DP-01 Frozen Run支持用户显式瑕疵入库

确认日期：2026-08-25
确认人：Product Owner

**用户确认：** `接受瑕疵`与`放弃整理`是Frozen Run上的同级决定；V1只支持`actor_unavailable`与
`external_source_exhausted`，且只能由用户逐项显式指定。瑕疵On-deck后Aftercare不再尝试补齐或重新寻源，
但仍处理其他新问题。`放弃整理`不使用“重新入库”作为按钮文案，后果在确认页说明。

**Owner/Handoff影响：** 不新增Domain或Handoff。Libra拥有用户Decision和Authorized Defect Manifest；Arca在
Handoff B独立验证并把Manifest保存为Accepted Inventory Fact。事实不改写为普通合格。

**回写：** SSOT §5.6.7、§5.7.2、§5.8.2、§6.5.2、§8.5.11、§9.5.3；Beta HB-B.25–26、HB-D.05；UAT-119。

## Deferred product decisions

以下问题尚未确定，但不阻断Level 7 Foundation合同，并且不在本层要求用户决策：

| Topic | Why it does not block Level 7 | Receiving level |
| --- | --- | --- |
| Resource Operating Profile采用两档、三档或四档及具体名称 | Level 7只要求Profile映射容量且不改变业务状态 | Level 9 |
| 忙时/闲时的用户配置方式 | Foundation只消费生效后的Profile revision | Level 9 |
| Admin Web如何展示Workflow、Event性能和等待原因 | 不改变Runtime与业务Owner | Level 9 |
| 具体性能阈值、队列上限和NAS canary标准 | 不改变Foundation职责 | Level 10 |

## Closed decisions

Level 7没有产生需要用户补充的业务分叉；2026-07-16封闭审计后整体Accepted。本文关闭并只保留为非
Canonical历史决策Evidence。
