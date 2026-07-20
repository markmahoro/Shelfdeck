# Helix Architecture Review Workbench

Status: `CLOSED — FINAL_SSOT_AUDIT_APPLIED_AND_AUDITED / POST-BASELINE DOC FIXES CLOSED` — 2026-07-20；历史Review保持关闭，Level 0–10最终全文审计、`FA-04`用户决定传播与`PBF-01`–`PBF-13`（含`PBF-09-R1`、`PBF-10-R1`、`PBF-10-R2`、`PBF-10-R3`、`PBF-11-R1`、`PBF-11-R2`、`PBF-11-R2-R1`、`PBF-11-R2-R2`、`PBF-11-R3`、`PBF-12-R1`、`PBF-13-R1`、`PBF-13-R2`、`PBF-13-R3`、`PBF-13-R4`、`PBF-13-R4-R1`、`PBF-13-R4-R2`、`PBF-13-R5`、`PBF-13-R5-R1`、`PBF-13-R5-R2`、`PBF-13-R5-R3`）bounded correction均已完成。

## 1. Purpose and authority

本文是Helix架构Review的独立工作台账，用来记录：

- 怀疑存在但尚未证明的架构问题；
- 对问题进行全局审视时收集的SSOT Evidence；
- 问题分类、讨论状态和关闭证据；
- 已由用户确认的决定、bounded change set及其Closure Evidence。

本文**不是架构合同**，不得覆盖、补充或改写
`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`。任何Review结论只有在完整回写SSOT正文、Canonical Dictionary和
全部受影响Level，并通过一致性审计后，才成为正式合同。实现、测试和历史代码也不能引用本文中的开放
问题或草案作为架构授权。

本Review执行期间使用的Audit Guard（Review关闭后仅作历史Evidence）：

- 在Audited Decision Backlog形成前，不向用户提出新的架构问题；
- 不把任何Finding、盲审结论或已确认待审决定直接视为SSOT合同；
- 不回写任何尚未关闭的架构决定；
- Review关闭前不开始Level 7；实现、E2E、Docker或生产工作仍须遵守当前Implementation Gate；
- Review台账由Codex自行维护；用户只接收经过审计的`DECISION_REQUIRED`问题。

## 2. Review principles

### 2.1 Review不是重新设计

Review的第一目标是验证SSOT是否存在真实缺陷，不是因为某个Item被标为`OPEN`就重新发明对象、状态、
Policy或流程。已有合同能够唯一推出答案时，只允许标记为`FALSE_POSITIVE`或`DOC_FIX`。

### 2.2 Evidence先于问题

向用户提出任何Review问题之前，必须先从该问题视角重新审视Level 0至当前Level的全部相关合同、
Canonical Dictionary、Amendment、已确认历史决定和上下游引用。不得仅依赖Review Item标题、对话摘要、
模型记忆或当前实现。

### 2.3 `OPEN`不等于架构缺陷

`OPEN`只表示尚未完成审计。只有完成Evidence Matrix并证明以下至少一项成立，才允许把它升级为需要用户
讨论的问题：

- SSOT对同一问题给出互相矛盾的答案；
- 已确认上层合同无法推出下层必须作出的决定；
- 某个用户旅程或业务责任没有合法Owner与收口路径；
- 某项不变量在现有合同下无法同时成立。

“表述不够顺”“实现不知道怎么写”“术语需要迁移”本身不构成新架构缺陷。

### 2.4 全局审视而非局部补丁

问题必须沿以下两个方向检查：

```text
向上：Product Ontology → Value → Domain → Object/Process
向下：Handoff → Policy → Execution → 后续Foundation/Component/Product Surface影响
```

局部章节看似缺失，但前后文已经唯一限定答案时，不得新增合同。局部修正可能改变前序Level语义时，必须
停止并回到术语首次定义的Level。

### 2.5 一个术语只能有一个Canonical定义

Review回写必须替换失效定义，不能在SSOT末尾追加“以新说明为准”并长期保留两套可读模型。工作决定可在
本文暂存；正式关闭时必须消除旧术语、旧Owner和旧关系，而不是叠加解释。

### 2.6 Level边界是硬门禁

| Level | Review允许决定 | 不得提前混入 |
| --- | --- | --- |
| 0–2 | 产品本体、价值流、业务域Charter | Object Schema、状态机、组件 |
| 3 | Business/Process Object、Identity、Fact Owner、Lifecycle、Domain Relation | DB字段、UI、扫描参数、Executor |
| 4 | Deliverable、Acceptance、责任与Control转移 | Store/API、资源实现 |
| 5 | Policy、Decision Input、Decision与Spec | Workflow节点、设备参数 |
| 6 | Process启动、状态、Attempt、恢复、并发和Priority | 物理Store、页面布局 |
| 7–10 | 按Top-down Level表逐层细化 | 反向改变已确认上层语义 |

发现跨Level问题时只登记受影响Level，不允许在当前章节顺手补齐。

### 2.7 只把真正的业务决策交给用户

Review Finding通过证据分类后，还必须经过用户决策过滤：

```text
FALSE_POSITIVE      → 自行关闭
DOC_FIX             → 自行准备有界文档修正
ENGINEERING_CHOICE  → 延后到Level 7–10由Codex设计
DECISION_REQUIRED   → 才允许提交用户讨论
```

只有涉及产品语义、用户旅程、Business/Fact/Policy Owner、Handoff责任、安全或不可逆业务取舍，且现有SSOT
无法唯一推出答案的问题，才属于`DECISION_REQUIRED`。字段、Store、API、页面、扫描参数、Runtime算法和
能够由既有合同推导的选择不得占用用户决策。

### 2.8 Blind Review用于主动反证

盲审不是表决机制，也不以数量决定架构。它用于让不继承当前对话结论的审阅者独立尝试：

- 找出主审遗漏的跨Level冲突；
- 证明候选问题其实已被SSOT回答；
- 识别Review台账本身造成的锚定；
- 验证问题是否真实影响用户旅程和责任收口。

盲审次数、切分角度和反证强度由Codex根据风险内化管理。跨域Owner、Handoff、Material Control、破坏性
操作和不可逆用户语义在提交用户前必须至少经过一次无本线程上下文的反方审查；盲审输出只作为Evidence，
仍须由主审完成最终Evidence Matrix与分类。

## 3. Status model

| Status | Meaning |
| --- | --- |
| `SUSPECTED` | 只记录了疑点，尚未完成Evidence审计；不得向用户当作架构缺陷提问 |
| `EVIDENCE_AUDIT` | 正在建立全局Evidence Matrix；不得形成新合同 |
| `FALSE_POSITIVE` | SSOT已经唯一回答，问题不存在；保存审计理由后关闭 |
| `DOC_FIX` | 业务答案已经唯一确定，只需术语、引用或结构修正；不得扩大语义 |
| `ENGINEERING_CHOICE` | 业务合同已经足够，剩余选择属于Level 7–10工程细化；不向用户提问 |
| `CONFLICT` | 已证明SSOT存在互相矛盾的正式合同，需要用户裁决 |
| `TRUE_GAP` | 已证明现有合同不能推出必要答案，需要用户讨论新合同 |
| `DECISION_REQUIRED` | `CONFLICT/TRUE_GAP`通过盲审反证和用户决策过滤后，确实需要产品Owner选择 |
| `ON_HOLD` | 当前Decision因用户补充的跨范围架构输入而暂停，等待Impact Sweep |
| `CONFIRMED_PENDING_APPLY` | 用户已经确认决定，但尚未完整回写SSOT并通过一致性审计 |
| `CLOSED` | 正文、Dictionary和受影响Level均已回写，并保存审计证据 |
| `PAUSED` | Review活动被显式停止；不得自动进入下一状态 |

旧Register中的`OPEN`必须先降为`SUSPECTED`并完成Evidence审计，不能直接视为`TRUE_GAP`。

## 4. Mandatory review process

### Step 0 — Register without mutation

只在本文登记疑点、来源和可能影响；不修改SSOT正文，不向实现派发工作，不预设解决方案。

### Step 1 — Write the problem statement

每个Item必须首先写清：

```text
Review ID
Review Level
用户旅程或业务场景
怀疑违反的已确认不变量
声称存在的缺陷
如果缺陷真实，用户或业务会看到什么后果
```

不能用“可能不清晰”“似乎缺少组件”作为问题陈述。

### Step 2 — Build the global Evidence Matrix

向用户提问前必须完成：

| Evidence dimension | Required content |
| --- | --- |
| Upstream contract | Level 0至本Level所有相关条款与Dictionary |
| Same-level contract | Object、Process、Owner、Lifecycle与关系 |
| Downstream use | 后续Level如何引用并是否已经唯一限定答案 |
| Amendment history | 已确认Amendment及其是否已回写 |
| Historical decision | 只用于证明曾讨论过什么，不覆盖SSOT |
| Implementation evidence | 只用于暴露风险，不作为业务合同权威 |
| Negative example | 至少一个能证明缺陷的实际业务旅程或边界Case |
| Existing derivation | 是否能从现有合同无歧义推出答案 |

工具输出被截断、只读到摘要或只检索一个关键词时，不得宣称完成全局审视。

### Step 3 — Prove or reject the defect

依次执行：

1. **Existence test**：所需答案是否已经在任何前序或同层条款定义；
2. **Derivation test**：即使未逐字写出，是否能从Owner、不变量和Handoff唯一推出；
3. **Conflict test**：是否存在两个正式条款给出不同答案；
4. **Journey test**：是否存在无法合法完成或收口的真实用户旅程；
5. **Boundary test**：修正是否会移动Fact Owner、Policy Owner或Handoff责任；
6. **Level test**：所谓缺口是否其实属于后续Level的实现细化。

无法证明缺陷时，分类为`FALSE_POSITIVE`或`DOC_FIX`，不得向用户重新提问。

### Step 4 — Classify before discussion

每个准备讨论的Item必须明确标记：

```text
NEW CONTRACT         现有合同确实缺失，需要新增决定
CONFLICT RESOLUTION  两项现有合同冲突，需要选择并删除另一项
TERM MIGRATION       语义不变，只迁移术语或Owner名称
DOC CORRECTION       引用、结构或遗漏回写修正
```

只有`NEW CONTRACT`和`CONFLICT RESOLUTION`允许向用户提出架构选择。

### Step 5 — Challenge and produce an Audited Decision Backlog

所有`CONFLICT/TRUE_GAP`必须先接受反证审查；高风险跨Level问题使用Blind Review。随后形成内部Backlog：

| Final class | User-visible |
| --- | --- |
| `FALSE_POSITIVE` | no |
| `DOC_FIX` | no |
| `ENGINEERING_CHOICE` | no |
| `DECISION_REQUIRED` | yes |

Backlog由Codex持久维护，用户不需要审阅Review台账。只有`DECISION_REQUIRED`进入下一步。

### Step 5A — Build one Decision Packet

问题必须附带完整Evidence Matrix、无法由现有合同推出答案的原因、对用户旅程的影响、候选方案和跨Level
影响。不能把实现字段、页面文案或运行参数包装成当前Level的架构问题。

每个Decision Packet固定包含：

```text
Decision ID与所在Level
大白话用户场景
SSOT已经确定的部分
无法继续推导的唯一分叉
可选方案及用户旅程差异
Codex建议与理由
受影响条款
明确不受影响的边界
不决策时真正阻塞什么
```

一次只讨论一个主Decision。多个技术子问题如果能由同一业务原则推出，必须先合并，不拆成多次用户提问。

用户质疑结论时，先重新核对Evidence；质疑不是结论错误的证据，也不能为了顺从而立即撤回或改写合同。

### Step 5B — Route supplemental architecture input

用户在讨论某一Decision时提出超出原问题范围的新架构意见，先记录为`Supplemental Architecture Input`，
不得顺手合入当前Decision或SSOT。Codex执行Impact Sweep并分类：

| Type | Meaning | Action |
| --- | --- | --- |
| `A-CLARIFICATION` | 澄清当前Decision语义 | 合并当前Decision |
| `UPSTREAM-AMENDMENT` | 可能改变前序Level或Canonical术语 | 当前Decision置为`ON_HOLD`，先全局审计并重新表述问题 |
| `SIBLING-ISSUE` | 暴露独立问题 | 写入Backlog；不影响当前问题时继续当前Decision |
| `DOWNSTREAM-DETAIL` | 属于后续Level实现 | 延后处理，不扩张当前讨论 |
| `ALREADY-COVERED` | SSOT已有答案 | 引用条款，不重新设计 |

Impact Sweep必须回答：它是否推翻当前Decision前提、影响哪些已确认Level、当前问题是否仍存在、是否需要
重新形成Decision Packet。用户补充意见本身不是自动生效的合同修改。

### Step 6 — Prepare a bounded change set

用户确认后，先列出而不执行：

- 首次定义受影响术语的条款；
- 所有Dictionary项；
- 全部上下游引用；
- 必须删除的旧定义；
- 只作为历史保留的Amendment Evidence；
- 不得变化的相邻合同；
- 定向一致性检查与retired-term搜索。

Change Set出现未讨论的新Object、状态、Policy、Handoff、配置或Schema时，立即停止。

### Step 7 — Apply once, by replacement

在一个有界修改中统一回写正文、Dictionary与引用。禁止先追加新定义、以后再清理旧定义；禁止让
`CURRENT_PLAN`、`CURRENT_STATUS`或Review本文成为第二套架构说明。

### Step 8 — Run post-change audits

至少完成：

1. Level内部一致性；
2. 对全部前序Level的一致性；
3. 后续Level引用一致性；
4. Canonical term唯一性；
5. Fact/Policy/Decision Owner唯一性；
6. Handoff与Control连续性；
7. Object、Process和Physical Material关系完整性；
8. 典型及负向用户旅程复演；
9. retired term、旧Owner和旧关系全文搜索；
10. `git diff`检查是否引入超出Change Set的概念。

### Step 9 — Close with evidence

只有完成Step 7和Step 8才可标记`CLOSED`。仅用户口头确认、仅写入本文、仅修改状态文档，均只能是
`CONFIRMED_PENDING_APPLY`。

## 5. Review Item template

```markdown
### Lx-Rn — Short name

Status: SUSPECTED
Type: unclassified

#### Problem statement
- User journey:
- Suspected invariant violation:
- Observable consequence:

#### Evidence Matrix
| Dimension | Clause / evidence | Finding |
| --- | --- | --- |

#### Defect proof
- Existence test:
- Derivation test:
- Conflict test:
- Journey test:
- Boundary test:
- Level test:

#### Classification
FALSE_POSITIVE | DOC_FIX | CONFLICT | TRUE_GAP

#### Confirmed decision
Only after user confirmation.

#### Bounded change set
Only before apply.

#### Closure evidence
Only after SSOT rewrite and audit.
```

## 6. Active review register

以下内容从SSOT迁出。除已经有完整Closure Evidence的项目外，所有旧`OPEN`问题都必须经过
`SUSPECTED → EVIDENCE_AUDIT`，不能直接向用户提问；独立盲审发现关闭传播不完整时允许退回`DOC_FIX`。

### Level 3

| ID | Audited classification | Review subject | Required action |
| --- | --- | --- | --- |
| `L3-R1` | `CLOSED` | Aftercare当前材料事实不能改写Libra immutable Product Material Manifest | 已统一为历史Product Manifest provenance + 每个当前有效Inventory Representation的最新committed revision |
| `L3-R2` | `FALSE_POSITIVE/CLOSED` | Recall-first Triage Claim纠正时Subject形状如何处理 | 既有Subject连续性合同已经闭合，不重开 |
| `L3-R3` | `CLOSED` | 旧Source、Material Field、Observation、Hint与Routing术语/Owner关系 | D1–D4已作为替换型Amendment传播到Level 0–6并通过封闭审计 |
| `L3-R4` | `CLOSED` | Shelf注销生命周期及活动责任影响 | DP-03已传播为Arca非破坏性Shelf Deregistration并通过封闭审计 |
| `L3-R5` | `CLOSED` | Off-load Context、Artifact、Related Reference与当前Inventory边界 | 当前Primary/Related/Artifact只由每个当前有效Inventory Representation的最新committed revision表达，Schema留Level 8 |

#### L3-R3 confirmed decisions applied and audited

`L3-R3-D1 — Material Field is the physical file source`（2026-07-16，用户确认）：Material Field是
Procurement拥有的文件源Business Object，Field Management管理多片Material Field。每片Field只有一个
`fieldId`并持有当前Field Access Binding；产品界面可以称其为“文件源”。`Source`不再作为独立架构对象，
不分配`sourceId`。

`L3-R3-D2 — Emby is provider-only and storage-independent`（2026-07-16，用户确认）：Emby只作为可选
External Provider，不提供Material Field目录发现、Physical Material盘点、Shelf Target选择、Emby Library
映射、Off-load或刷新责任。用户在Emby中独立把ShelfDeck Target目录配置为Emby Library；ShelfDeck不保存
该关系，也不以Emby状态建立Material、Inventory、Shelf Entry或Deck Fact。

`L3-R3-D3 — One explicit physical target per Shelf`（2026-07-16，用户确认）：每座Shelf恰好拥有一个
Physical Target Folder。Material Field与Shelf Target允许解析到同一Endpoint/rootLocation，但继续分别
表达Procurement原料来源与Arca Inventory目标；路径重叠本身不授予重复采购资格。

`L3-R3-D4 — Two directory roles and three control regions`（2026-07-16，用户确认）：Material Field与
Shelf Physical Target Folder是两类物理目录角色。Production Region覆盖Libra当前控制的全部正式Input与
Production Workspace材料；Finished Goods Region覆盖Arca当前控制的On-deck Custody、事务暂存与Inventory
材料；Procurement Region是Material Field完整观察集合扣除前两者。三个Region按Physical Material Identity
及Control动态投影，不按路径切割，也不新增Business Object、配置目录或路径锁。Extraction Eligibility只
能在Procurement Region内继续依据可访问性、Extraction Policy、Reservation与Control可取得性计算。

注意：D1–D4是用户已确认并完成回写、封闭审计的决定。曾提出的`D5/D6`不是有效Review决定，不进入台账。

### Level 4

| ID | Audited classification | Review subject | Required action |
| --- | --- | --- | --- |
| `L4-R1` | `FALSE_POSITIVE/CLOSED` | 通用Handoff曾错误要求Accepted每次新建Business Object | `L4-A6`已经允许建立Object、扩充范围、建立Process或Custody，不重开 |
| `L4-R2` | `ENGINEERING_CHOICE` | Domain-local Binding之外是否需要全局Physical Material Control业务对象 | 不新增全局业务对象；Control索引、token、lease、Store和事务属于Level 7–8 |
| `L4-R3` | `CLOSED` | Arca生成新Physical Material Identity时Control连续性 | 已明确受管Transformation在创建提交点取得本域Control；Fencing机制留Level 7–8 |
| `L4-R4` | `CLOSED` | superseded Libra Run的未Accepted Offer资格 | 已明确未决Offer失去Accepted资格并在Transfer Point重验eligibility |
| `L4-R5` | `FALSE_POSITIVE` | Accepted货品永久无法Off-load时责任终结 | `blocked + Arca Custody/Control + 自动恢复 + 禁止反向Handoff`已形成连续责任 |

### Level 5

| ID | Audited classification | Review subject | Required action |
| --- | --- | --- | --- |
| `L5-R1` | `FALSE_POSITIVE/CLOSED` | Shelf Standard、Placement Policy、Workspace与Off-load边界 | 固定事务已经闭合，不重开 |
| `L5-R2` | `FALSE_POSITIVE` | 首次Spec没有强Identity但声明目标Product Identity | Spec可以声明最终Identity Requirement，不要求开单时已经拥有具体强Identity |
| `L5-R3` | `CLOSED` | On-deck Canonical Content Identity错误后的Arca修正合同 | DP-01已传播：Beta只输出unsupported diagnostic，不提供自动或人工修正 |

### Level 6

| ID | Audited classification | Review subject | Required action |
| --- | --- | --- | --- |
| `L6-Q2` | `CLOSED` | active Run的Spec Basis失去Freshness且新Spec unresolved | 已传播有界suspended恢复、同/异Spec分支与frozen收口 |
| `L6-Q3` | `CLOSED` | Input Settlement不可逆处置旧Input的授权来源 | DP-02已传播独立持续Authorization与逐Run精确Approval；产品默认留Level 9 |
| `L6-Q4` | `CLOSED` | expedited是否随Spec变化传给替代Libra Run | 已传播加急Intent到合法替代Run，仍止于Handoff B |
| `L6-R1` | `CLOSED` | Off-deck Reservation与同Entry Handoff/On-deck并发 | 已传播共享排他Fence和不可逆责任先行收口 |
| `L6-R2` | `FALSE_POSITIVE/CLOSED` | User Perception是否主动发送Neutral Signal | Query-only边界完整，不重开 |
| `L6-R3` | `FALSE_POSITIVE` | Off-load Completion Fact与Projection | Arca拥有Fact并发布只读Projection，不构成双Owner；仅做命名澄清 |
| `L6-R4` | `ENGINEERING_CHOICE` | 自动运行与auto/manual用户表面 | Process自动启动矩阵已固定；页面入口属于Level 9，不建立新的业务模式 |
| `L6-R5` | `FALSE_POSITIVE/CLOSED` | Off-load动作树与固定事务流程 | 已统一固定事务流程，不重开 |

### Level 7 prerequisites

这些不是已证明的前序架构缺陷，只在Level 7获准起草后验证：

| ID | Status | Prerequisite |
| --- | --- | --- |
| `L7-P1` | `NOT_STARTED` | 验证`mountScopeId + inode + contentHash`在目标Linux/NAS挂载上的稳定性、成本与inode复用风险 |
| `L7-P2` | `NOT_STARTED` | 设计Arca Target Commit Slot的同卷rename、跨卷copy、rollback、空间Reservation、恢复和性能合同 |

## 7. Active audit gate

Evidence审计、三组隔离盲审、主审交叉反证和Audited Decision Backlog已经完成。当前Gate为：

1. `DP-01`–`DP-03`已经全部确认，不再向用户提出新的Review问题；
2. 用户讨论中的补充意见先执行Supplemental Input Impact Sweep，不能直接覆盖当前问题；
3. 三项决定确认后，连同`DOC_FIX`和已确认的`L3-R3-D1`–`D4`形成分层有界Change Set；
4. Change Set审计通过后才允许一次性回写SSOT；
5. 在Level 3–6恢复`ACCEPTED`前不开始Level 7。

## 8. Independent blind review evidence — 2026-07-16

Status: `EVIDENCE_ARCHIVED`。本节保存第一轮不继承本线程上下文的独立Clean Review原始快照；它不是新的
Canonical合同，也不会自动把任何Finding升级为`TRUE_GAP`。本节分类已经由第9节三组隔离盲审与主审
交叉反证完成校准；发生冲突时以第9–10节Review结论为准，但二者都不能覆盖SSOT。

### 8.1 Review isolation and scope

独立审阅者使用`fork_turns=none`启动，Phase A只完整读取：

- 根`AGENTS.md`；
- `docs/helix/README.md`；
- `TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`全文。

它先冻结Blind Findings，Phase B才读取本文、`CURRENT_PLAN.md`与`CURRENT_STATUS.md`做校准。未读取历史
归档、Capability文档、实现代码或测试，未修改任何文件。

审阅规则要求每项Finding执行Existence、Derivation、Conflict、Journey、Boundary与Level测试；能够由
现有合同唯一推出、或明确属于Level 7–10细化的内容不得列为架构缺口。

### 8.2 Executive verdict

独立结论是：**当前SSOT不足以继续Level 7，但主干无需推倒重来。**

阻断原因不是问题数量，而是少数合同会直接影响Level 7的Capability、Fencing、原子提交和破坏性操作：

- stale/superseded Handoff Offer仍可能被Accepted；
- Arca Input Settlement的业务授权边界未定义；
- Accepted原子Control转移与上游Material Field延迟收口存在时点冲突；
- Level 5仍残留Aftercare改写Libra immutable Product Material Manifest的条款；
- Canonical Content Identity纠错、Spec unresolved收口和替代Run Priority尚未闭合。

### 8.3 Blind findings

下表是Phase A当时冻结的完整Finding集合，保留其原始分类供审计追溯；最终分类见第9.2节。

| ID | Blind classification | Severity | Evidence and proven concern | Minimum affected scope |
| --- | --- | --- | --- | --- |
| `BF-01` | `TRUE_GAP` | HIGH | `3.4.7`允许同一Libra Run顺序发布多个Package且最多一个成功；Rejected和Spec变化可以产生新Package/Run，但通用幂等只约束单个Offer。SSOT没有withdraw/invalidate旧Offer或按Run/交付范围排他的合同，旧Offer可能在Run superseded后仍被Accepted | Handoff B Offer eligibility、withdrawal及同一交付范围Acceptance fencing；对应原`L4-R4` |
| `BF-02` | `TRUE_GAP` | HIGH | Libra被禁止修改正式Input，Arca固定Off-load事务必须执行Placement Switch/Input Settlement，但SSOT明确把其Approval/Authorization留为未决。Material Control不自动等于破坏性业务授权 | Arca Placement Switch/Input Settlement效果授权与失效边界；对应原`L6-Q3` |
| `BF-03` | `RESOLVED_MODEL_CONFLICT` | HIGH | 盲审按旧“Material Field=当前Procurement库存集合”定义推导出Accepted与Field membership冲突；经已确认的多Field物理文件源模型校准后，冲突只存在于旧文档表述，不存在于业务模型 | Handoff A Accepted原子结束Procurement Control/Procurement Region并建立Libra Control/Production Region；Material Field Observation持续存在，Receipt只幂等收口本域投影 |
| `BF-04` | `DOC_FIX` | HIGH | Level 3已固定Product Material Manifest为Libra immutable历史交接单，Arca当前库存由Inventory Representation维护；Level 5仍要求Custody读取“当前Product Material Manifest revision”并让Aftercare更新Product Material Manifest | `5.8.2.1`、Care Basis、Case commit及相关Dictionary；原`L3-R1`关闭不完整 |
| `BF-05` | `AMBIGUITY` | MEDIUM-HIGH | Inventory Representation保留历史revision且只有最新提交revision代表当前Inventory；Off-deck却称销毁“全部Inventory Representation中的Primary Material”，同时Destruction Scope又从最新Inventory生成，可能误删历史材料 | Off-deck Destruction Scope读取的Inventory revision语义；与原`L3-R5`局部相关 |
| `BF-06` | `TRUE_GAP` | MEDIUM-HIGH | Arca拥有Canonical Content Identity，但SSOT只声明纠错另行定义；Duplicate、Off-deck、Aftercare都依赖该Identity。发现身份错误后没有合法Decision、Evidence Basis和Shelf Entry连续性合同 | Arca Identity Correction Decision；对应原`L5-R3` |
| `BF-07` | `TRUE_GAP` | MEDIUM | Spec Basis失去Freshness且新Spec长期unresolved时，Level 5只禁止旧Basis提交；Level 6 Draft引入`suspended`但没有确定有界收口和最终frozen边界 | Libra Run在Spec unresolved下的责任与生命周期；对应原`L6-Q2` |
| `BF-08` | `AMBIGUITY` | MEDIUM | Level 0–6把Source同时用于用户配置、Emby/Folder/NAS/MoviePilot、Observation、enabled和Source–Shelf Routing；无法唯一推出连接配置、Procurement观察资格与Libra Routing关系各自的Fact Owner | Source/Material Field/Observation/Routing词汇与Owner边界；对应`L3-R3`但不证明现有D1–D4可直接回写 |
| `BF-09` | `AMBIGUITY` | LOW | Libra Run Priority止于Handoff B已明确，但Spec变化产生替代Run时`expedited`是否继承仍有两种合理语义，Level 7无法自行决定 | 替代Libra Run的Priority来源；对应原`L6-Q4` |
| `BF-10` | `DOC_FIX` | LOW | Deck已固定为非Business Object的抽象成果，Collection Assurance应从Shelf Entry/Deck Fact出发；Level 1 Dictionary仍写“从Deck出发”，可能诱导全局Deck Aggregate | Level 1 Dictionary及直接继承文本 |
| `BF-11` | `DOC_FIX` | LOW | `L3-A9`已经进入Amendment和Dictionary，但Level 3 Dictionary状态仍声称只应用`L3-A1–A8` | Level 3状态与Amendment摘要 |

### 8.4 Independently judged clean areas

盲审没有发现以下主干边界需要重做：

- Deck是抽象成果、Shelf Entry是唯一Own事实，只有Arca On-deck Commit建立或扩充Deck Fact；
- 五个一级业务域及Charter稳定，Kairox和Platform Foundation没有重新取得顶层业务Owner地位；
- Collection Formation只有`Procurement → Libra → Arca`两次单向Handoff；
- Candidate Package、Subject、Shelf Entry保持Domain-local，没有恢复全局MediaItem、Membership或SourceBinding；
- Physical Material Identity、Domain-local Binding、Material Control与Manifest快照的概念分离成立；
- Policy → Decision Preparation → Acceptance Spec → Libra Production → Arca Acceptance → On-deck Commit主链Owner唯一；
- User Perception和People Management不直接推进消费者流程或修改媒体业务事实；
- Aftercare与Off-deck的Process/Decision/Authorization分层总体成立，Capability成功没有冒充业务完成；
- Level 6的Business Process、Supporting Work、Work Attempt、Freshness与bounded retry通用语法可追溯；
- Workspace回收、Neutral Signal和Priority止于Libra Handoff B的边界连续。

### 8.5 Workbench calibration

#### Existing items supported by blind evidence

- `BF-01 → L4-R4`
- `BF-02 → L6-Q3`
- `BF-06 → L5-R3`
- `BF-07 → L6-Q2`
- `BF-09 → L6-Q4`
- `BF-08`部分支持重新审计`L3-R3`
- `BF-03`要求把宽泛`L4-R2`窄化为明确的Accepted/Field收口时点冲突
- `BF-05`揭示`L3-R5`尚未明确登记的破坏性revision歧义

#### Previously closed item that requires DOC_FIX re-open

`L3-R1`不能继续被视为全文传播完成：Level 3已经采用正确的Inventory Representation模型，但Level 5仍有
改写/读取“当前Product Material Manifest revision”的残留。恢复Review时应只以`DOC_FIX`完成传播，不重新
设计Fact Owner。

#### New blind findings not precisely recorded before

- `BF-03`：Accepted转移与Material Field当前库存延迟移除的Canonical时点冲突；
- `BF-05`：Off-deck当前Inventory与历史revision的销毁范围歧义；
- `BF-10`：Collection Assurance Dictionary仍写“从Deck出发”；
- `BF-11`：Level 3状态漏记`L3-A9`。

#### Existing suspected items that may be false positives

- `L5-R2`：现有合同可能已经区分“目标Identity Requirement”和“当前Resolved Identity”；没有实际循环旅程前应倾向`FALSE_POSITIVE`；
- `L4-R5`：Arca blocked、保留Control且不可反向Handoff可能已经完整表达永久不可Off-load责任；
- `L6-R3`：Arca Canonical Fact及其只读Projection未必形成双Owner，可能只是`DOC_FIX`；
- `L6-R4`：Process Owner自动化矩阵可能已经完整，auto/manual用户表面可能只是Level 9自由度；
- 宽泛`L4-R2`不能因为未来需要Fencing/Store就直接推导出新的全局Control业务对象。

#### Existing suspected items with enough preliminary evidence to retain

- `L4-R3`：Arca复制产生新Physical Material Identity时的Control取得点需要审计；
- `L6-R1`：Off-deck Reservation阻止Commit但未必阻止Handoff B Acceptance，存在新Custody悬挂风险；
- `L3-R4`：Shelf lifecycle仍需要从完整用户旅程验证；
- `L3-R5`：题目过宽，但Artifact、Related Reference与当前Inventory传播确有局部Evidence。

#### Confirmed-but-unapplied D1–D4 caution

独立审阅者没有读取本线程，Phase A只证明`BF-08`的旧Source模型存在真实歧义；它没有独立推出“多片
Material Field、删除Source对象、每Shelf单Target、三个Region投影”这组具体方案。恢复Review时，D1–D4
继续保留为用户已确认但未回写的决定，但仍须通过全局Evidence Matrix和有界Change Set审计，不能因
“已经确认”直接修改SSOT。

### 8.6 Independent suggested audit order（historical，已执行）

1. 以`DOC_FIX`重新完成`L3-R1`全文传播，并一并检查`BF-05`、`BF-11`；
2. 对`L3-R3`建立完整Evidence Matrix，校准`BF-08`与D1–D4；
3. 审计Shelf lifecycle、Manifest/Related/Artifact和Arca Identity Correction；
4. 审计Handoff/Control连续性：`BF-03`、窄化后的`L4-R2`、`L4-R3`、`BF-01/L4-R4`；
5. 对`L4-R5`做false-positive审计；
6. 审计破坏性与并发：`BF-02/L6-Q3`、`L6-R1`；
7. 审计Run liveness与Priority：`BF-07/L6-Q2`、`BF-09/L6-Q4`；
8. 校准`L6-R3`、`L6-R4`；
9. 完成Level 0–6全文术语、Owner、Handoff、Control与用户旅程审计；
10. Level 3–6恢复`ACCEPTED`后才进入Level 7。

## 9. Multi-perspective clean audit — 2026-07-16

### 9.1 Audit construction

本轮Decision提炼使用四层证据链：

1. 主审完整读取SSOT与现有Review台账，建立初始Finding映射；
2. 第一轮无本线程上下文的全局独立盲审，冻结`BF-01`–`BF-11`；
3. 第二轮使用三个互相隔离、只读且无本线程上下文的审阅者，分别从Domain/Handoff/Control、
   Policy/Identity/Acceptance和Level 6 Execution三个视角完整读取SSOT后反证；
4. 主审只保留无法由既有合同唯一推出、且会改变用户旅程或不可逆权限语义的分叉。

盲审者没有读取实现、历史归档或彼此结论，也没有修改文件。各审阅者都必须同时执行Existence、
Derivation、Conflict、Journey、Boundary与Level测试。两个方案如果只改变Store、Fencing、API、队列、
状态名或页面表达，不得升级为用户架构决策。

### 9.2 Audited Finding backlog

| Finding / Review item | Final classification | Audited resolution |
| --- | --- | --- |
| `BF-01 / L4-R4` stale or superseded Offer | `DOC_FIX` | Run永久失去提交资格时，其未决Offer同步失去Accepted资格；Transfer Point重验eligibility，具体Fence留Level 7–8 |
| `BF-02 / L6-Q3` old Input settlement authorization | `CONFIRMED_APPLIED_AUDITED` | 用户确认采用独立持续授权；Arca逐Run按精确Scope派生Approval，自动模式默认授权作为下游产品默认值 |
| `BF-03 / L4-R2局部` Accepted与Field收口时点 | `DOC_FIX` | Accepted原子转移Control并使Identity离开Procurement Region、进入Production Region；Material Field Observation不结束，Receipt只做幂等投影收口 |
| `BF-04 / L3-R1` Product Manifest被当作当前库存 | `DOC_FIX` | Product Material Manifest保持Libra immutable历史；Arca当前材料只由Inventory Representation revision表达 |
| `BF-05 / L3-R5局部` Off-deck历史Inventory revision | `DOC_FIX` | Destruction Scope只读取每个当前有效Representation的最新revision；历史revision永不进入销毁范围 |
| `BF-06 / L5-R3` Canonical Identity correction | `CONFIRMED_APPLIED_AUDITED` | 用户确认Beta不建设Identity Assurance或纠错流程；当前只记录能力缺口与禁止静默改写，未来另行设计 |
| `BF-07 / L6-Q2` Spec长期unresolved | `DOC_FIX` | 有界`suspended`恢复耗尽后必须进入既有`frozen`合同；预算数值留工程层 |
| `BF-08 / L3-R3` Source模型歧义 | `FALSE_POSITIVE` for current model | 旧模型本身可闭合；`D1`–`D4`是用户已确认的上游重设计，按Amendment Impact Sweep处理，不伪装成文档修正 |
| `BF-09 / L6-Q4` replacement Run priority | `DOC_FIX` | 用户加急意图不因内部Spec revision变化消失；替代Run重新取得Run-local expedited，仍止于Handoff B |
| `BF-10` Assurance从Deck出发 | `DOC_FIX` | 统一为从Shelf Entry与Deck Fact出发，不建立Deck Aggregate |
| `BF-11` Level 3状态漏记A9 | `DOC_FIX` | 修正状态摘要和Dictionary传播 |
| `L3-R4` Shelf lifecycle | `CONFIRMED_APPLIED_AUDITED` | 用户把删除定义为整座Shelf的非破坏性注销；原“空Shelf或draining”二选一作废，详见`DP-03` |
| `L3-R5` Manifest/Related/Artifact边界 | `DOC_FIX` | 补齐当前Primary快照与Related/Artifact引用传播；不新增全局Manifest Store |
| `L4-R2` global Control authority object | `ENGINEERING_CHOICE` | 不新增业务对象；Control registry/token/transaction属于Level 7–8 |
| `L4-R3` new Physical Identity Control | `DOC_FIX` | Arca受管Transformation在创建提交点取得新Identity Control；实现机制留Level 7–8 |
| `L4-R5` permanently blocked Off-load | `FALSE_POSITIVE` | Arca持续持有Custody、Control和恢复责任，不存在无Owner旅程 |
| `L5-R2` strong Identity absent before first Spec | `FALSE_POSITIVE` | Spec可以声明最终Identity Requirement，不要求开单时已取得具体强Identity |
| `L6-R1` Off-deck versus On-deck concurrency | `DOC_FIX` | Reservation/Authorization与Acceptance/On-deck共享排他Fence；已有责任按既有不可逆合同先收口 |
| `L6-R3` Completion Fact versus Projection | `FALSE_POSITIVE` | Arca拥有Fact并公开只读Projection，不构成双Owner |
| `L6-R4` auto/manual surface | `ENGINEERING_CHOICE` | Process自动启动资格已固定；显式入口与页面表达属于Level 9 |

### 9.3 Disagreement resolution

- Canonical Identity纠错：盲审曾在合同补全与用户安全分叉间存在不同判断；用户随后明确Beta完全不建设
  Identity Assurance及纠错流程。该项已转为`CONFIRMED_APPLIED_AUDITED`，不再阻断Beta设计。
- Shelf生命周期：盲审证明原合同缺少业务终点；用户随后把删除定义为整座Shelf的非破坏性注销，原
  “空Shelf或draining”分叉作废。该项已转为`CONFIRMED_APPLIED_AUDITED`。
- 替代Run Priority：审阅者对`DOC_FIX/ENGINEERING_CHOICE`标签有分歧，但既有“不陪诊”的用户意图和
  Priority止于Handoff B合同可唯一推出延续语义，因此不占用用户决策。
- Input Settlement：所有审阅者一致认为Material Control不能替代破坏性用户授权；用户已确认采用独立
  持续授权，并补充自动模式默认启用该授权。

## 10. Audited Decision Backlog

### DP-01 — On-deck Canonical Content Identity correction authorization

Status: `CLOSED`（2026-07-16；已应用并通过post-change封闭审计）。

**用户旅程**：一项媒体已经成为Shelf Entry，后来强Evidence证明其TMDB/Series/JAV等Canonical Content
Identity指向了错误内容。

**确认决定**：Beta不建立Identity Assurance，不新增第四个Aftercare保障维度，不建设主动身份复核、
Identity Correction Candidate、自动纠正或用户纠正流程。Canonical Content Identity在On-deck Commit后
不允许被Beta Runtime静默或人工改写；检测到矛盾只能作为未支持诊断事实报告，不得伪装修正成功。

Identity Assurance及Canonical Identity Correction整体延后，未来必须重新定义发现来源、Evidence门槛、
Decision、Shelf Entry连续性和下游重算合同；本次决定不预先授权未来自动或人工纠错方案。

### DP-02 — On-deck old Input destructive settlement authorization

Status: `CLOSED`（2026-07-16；已应用并通过post-change封闭审计）。

**用户旅程**：Arca已经Stage并验证最终产品，需要处置Handoff B明确接管、且不再承载最终Inventory的旧
Primary Input，才能完成Input Settlement。

**已经由合同确定**：Arca是唯一Owner；Final Primary必须先验证；只允许处理immutable Off-load Context
Scope中的受控材料；未知碰撞、目录外材料和未交接文件必须阻断；Basis或Scope变化使旧Approval失效；
Off-deck Authorization是另一条收藏退出合同。

**确认决定**：采用清楚、独立、可审计的持续授权。Arca为每个On-deck Run依据当前Authorization revision、
immutable Off-load Context、Final Inventory Decision与Freshness Basis派生精确Approval；授权不是目录级任意
删除权，也不覆盖未知、未交接或Scope外材料。Scope/Basis变化使旧派生Approval失效；若持续授权仍有效，
Arca可以基于新Scope重新派生，不要求逐媒体陪诊。

**Supplemental downstream detail**：未来产品“自动模式”默认启用该持续授权。该默认值属于Level 9的模式
预设与配置表达，不改变Level 6的Owner、Scope、Fencing和安全前置条件；不能把创建Shelf、Material Control
或任意自动化资格本身解释成无限删除授权。手动模式的默认值、用户如何查看/变更以及配置生效时点留给
Level 9统一设计。

### DP-03 — Shelf deregistration lifecycle

Status: `CLOSED`（2026-07-16；已应用并通过post-change封闭审计）。

**用户旅程**：用户在ShelfDeck中“删除Shelf”的真实意图是注销整座Shelf。注销后普通用户视角中该Shelf
如同从未存在，但任何已有正式媒体文件、Related Material与Target Folder都保持原样。

**确认决定**：非空Shelf也允许注销。Shelf Deregistration是Arca拥有的独立管理流程，不是Collection Exit、
批量Off-deck、Pause或长期`draining`。它使用`active → deregistering → deregistered`完成有限责任收口：

1. 立即使Shelf失去新Routing和新Acceptance资格；
2. 已有工作按现有不可逆Intent与Safety Liveness到安全边界，不建立反向Handoff；
3. 依据当前有效Inventory冻结精确Deregistration Release Manifest；
4. 原子终结该Shelf的活动Shelf Entry与Deck Fact、释放对应Physical Material Identity的Arca Control，并使
   Finished Goods Region投影同步移除这些Identity；
5. 不删除、移动、替换或重命名正式媒体，不删除Target Folder，也不按目录范围释放未知Material；
6. 普通活动视图隐藏该Shelf，内部保留最小tombstone、历史Inventory与Control Release Evidence，不伪造历史；
7. 被释放Material若位于有效Material Field中，随后可以独立回到Procurement Region；否则成为ShelfDeck
   不再管理的External Material Reality。该变化不是Arca到Procurement的反向Handoff。

这构成Shelf Entry/Deck Fact除Off-deck之外的第二种终结原因：Off-deck表示单项收藏退出并销毁媒体；Shelf
Deregistration表示整座Shelf的行政注销并保留媒体。它不恢复逐媒体`retain_source`能力。

### 10.1 Decision order and change gate

`DP-01`–`DP-03`已经全部确认，`DOC_FIX`、`L3-R3-D1`–`D4`与三个Decision Amendment已按第11节有界
Change Set一次性回写SSOT并通过post-change封闭审计；不得借后续用户复核扩张新语义。

## 11. Bounded Change Set — 2026-07-16

Status: `APPLIED_AND_AUDITED`。本节只保存本轮允许写回SSOT的边界和Closure Evidence，不是第二份
架构合同。

### 11.1 Change Set不变量

本轮回写不得新增一级Business Domain、Business Handoff、全局媒体主键、全局Material Binding、全局
Control Business Object、第四个Aftercare保障维度、Identity Correction Process或跨域通用状态机。
两次单向Handoff、Deck不是Business Object、Accepted与On-deck Commit分离、Own只由有效Shelf Entry
表达、Deliverable immutable、Material Control唯一以及各Domain Fact Owner不变。

特别校准`BF-03`：`L3-R3-D1`–`D4`确认后，Material Field表示持续观察的文件源Business Object，不能再
把Handoff A Accepted解释为删除Material Field observation membership。Transfer Point原子结束的是
Procurement Control与Procurement Region资格，并建立Libra Control与Production Region；Receipt只做
Procurement本域投影的幂等收口。该校准服从已确认上游模型，不重新占用Owner Decision。

### 11.2 Change Group A — Material Field、External Provider与Control Region

允许改写Level 0–6中仍把`Source`当作独立架构对象的合同，并统一为：

- `Material Field`是用户配置的物理文件源Business Object；Procurement可以拥有`0..N`片Field，每片拥有
  `fieldId`与当前`Field Access Binding`；
- `External Material Reality`只表示ShelfDeck之外真实存在的材料、位置、状态与变化；
- Emby只属于可选`External Provider`，不发现或拥有Physical Material、Inventory、Shelf Target、Off-load、
  Shelf Entry或Deck Fact，也不建立Emby Library与Shelf/Target Folder映射；
- `Material Field Observation Membership`、Domain-local Material Binding与Material Control是三件不同事实；
- `Procurement Region`、`Production Region`、`Finished Goods Region`只按Physical Material Identity、Observation
  与当前Control动态派生，不是Business Object、Store、用户配置目录或路径锁；
- Material Field与Shelf Physical Target Folder可以解析到相同路径；目录重叠不产生重复采购资格；
- 每座Shelf恰好拥有一个明确Physical Target Folder，不建立多Target Shelf或独立targetId。

传播范围包括Level 0–2本体与Dictionary、Level 3对象图/物理关系/主键/基数/Owner/生命周期矩阵、Level 4
两次Control transfer、Level 5 Extraction/Routing/Placement Decision、Level 6自动化/并发/Reality恢复及全部
Canonical Dictionary。退役业务术语包括独立`Source`、`External Source Reality`、`Source Material Set`、
`Source Context`、`Source Provenance`、`Source–Shelf`、`Source enabled|disabled`及“系统唯一Material Field”。

### 11.3 Change Group B — Shelf Deregistration

允许增加Arca拥有的`Shelf Deregistration Process`，但不得把它提升为新Value Flow或第三次Handoff：

- Shelf生命周期为`active → deregistering → deregistered`，非空Shelf也允许注销；
- 注销开始即失去新Routing与新Acceptance资格；已有不可逆责任按Safety Liveness到达安全边界；
- Arca从当前有效Inventory冻结精确`Deregistration Release Manifest`，原子终结活动Shelf Entry/Deck Fact、
  释放其中精确Physical Material Control并更新Finished Goods Region；
- 不删除、移动、替换、重命名正式媒体、Related Material、Target Folder或Scope外材料；
- 保留最小tombstone、历史Inventory与Control Release Evidence；
- 被释放Identity只有仍属于有效Material Field observation set时才可重新进入Procurement Region，否则成为
  不受ShelfDeck管理的External Material Reality；这不是反向Handoff；
- Shelf Deregistration是Deck Fact的第二种终结原因；单项Off-deck仍表示授权销毁，不恢复逐项
  `retain_source`语义。

传播范围为Level 0的Deck Fact终结说明、Level 1的Value Flow非等价说明、Level 2 Arca Charter、Level 3
对象/Process/Fact/Lifecycle、Level 4 Offer eligibility、Level 5 Routing/Acceptance eligibility与Decision、
Level 6 Trigger/状态/恢复/自动化/并发/故障/Dictionary。

### 11.4 Change Group C — Canonical Identity Beta boundary

允许写入`DP-01`，且只能写入以下语义：Canonical Content Identity仍由Arca在On-deck Commit固化；Beta中
此Identity此后不可由Runtime或用户改写；不建设Identity Assurance、第四保障维度、Correction Candidate、
自动或人工Correction Process。矛盾Evidence只能形成unsupported diagnostic，不能伪装修复成功、替换
Shelf Entry或触发身份重算。首次Shelf Acceptance的Identity Requirement与Level 1完整产品价值不得降低。

传播范围为Level 3 Shelf Entry/Identity合同，Level 4 Accepted后矛盾Evidence边界，Level 5 Arca Decision与
关闭状态，以及Level 6 Aftercare/Reality/失败/Dictionary。必须删除`L5-R3`开放引用。

### 11.5 Change Group D — Input Settlement Authorization

允许写入`DP-02`，并严格区分：

1. 用户授予的、独立、可审计、带revision的持续`Input Settlement Authorization`；
2. Arca按On-deck Run，基于当前Authorization revision、immutable Off-load Context、Final Inventory Decision
   与Freshness Basis派生的精确`Input Settlement Approval`。

Final Primary验证成功后才可Settlement。Approval只覆盖Handoff B明确接管且不再承载Final Inventory的旧
Primary Input；未知碰撞、未交接、Scope外材料、Related引用与目录范围均不在授权内。Authorization、Basis
或Scope变化使旧Approval失效；持续Authorization仍有效时可重新派生。Material Control、Shelf创建、
自动化资格和Capability可用均不能替代Authorization；Off-deck Destructive Authorization是另一份合同。
已进入持久化物理提交后只按Safety Liveness恢复。

“产品自动模式默认启用该持续Authorization”只登记为Level 9待表达的已确认默认值；不得在Level 6制造
auto/manual Business Mode或无限目录删除授权。

### 11.6 Change Group E — Existing DOC_FIX propagation

本批必须同时完成以下唯一答案的传播，不改变Owner或业务语义：

- stale/superseded Libra Run永久失去提交资格时，全部未Accepted Offer同步失去Accepted资格；Transfer Point
  重验Run、Package、Offer、Spec、Shelf lifecycle、Control与排他Fence eligibility；历史Offer继续immutable；
- Domain受管Transformation在创建提交点取得新Physical Material Identity的本域Control；新Identity不继承
  旧Identity Control，也不形成新Handoff；
- Product Material Manifest始终是Libra immutable历史交接快照；Arca当前材料只由每个当前有效Inventory
  Representation的最新committed revision表达；Aftercare提交新Inventory revision，不改写历史Manifest；
- Off-deck Destruction Scope只读取上述最新当前revision；历史Inventory revision不进入销毁范围；
- active Libra Run的Basis stale且新Spec unresolved时进入有界`suspended`；同Spec恢复、异Spec supersede并
  建立替代Run，预算耗尽进入既有`frozen`；无Run的unresolved Subject不冻结；
- 同一生产范围因Spec变化建立替代Run时，持续用户加急Intent使替代Run重新取得Run-local expedited；
  Priority不挂Subject、不传Arca，仍止于Handoff B Accepted；
- Off-deck Reservation/Authorization与同一Shelf Entry扩充、相交Material或相交目标范围的Acceptance/
  On-deck Commit共享排他Fence；谁先跨越既有不可逆边界，谁先按原合同安全收口；
- Collection Assurance Dictionary改为从Shelf Entry与Deck Fact出发；不建立Deck Aggregate；
- Level 3状态摘要必须包含`L3-A9`。

### 11.7 Mandatory post-apply audit

回写后必须逐项审计：Level 3五张矩阵、Level 4五张交接矩阵、Level 5 Policy/Decision矩阵、Level 6
Process/Automation/Priority/Concurrency/Failure/Recovery矩阵及Level 0–6全部Dictionary。正文不得残留
`L3-R5`、`L5-R3`、`L6-Q2`、`L6-Q3`、`L6-Q4`或“待确认”引用。

以下搜索结果必须为零，或只存在于明确标注的Historical Audit/Amendment Evidence：退役`Source`业务对象、
`External Source Reality`、系统唯一Material Field、当前Product Material Manifest revision、改写Product
Material Manifest、全部历史Inventory进入销毁范围、Shelf `draining/retire`、`retain_source`、`deckId`以及
Emby Library映射。最终不变量仍是两次单向Handoff、无反向Handoff、Deck非对象、Manifest历史不可变、
Inventory当前revision唯一、Beta Identity不可改写、Deregistration非破坏、Control Region只为动态Projection。

### 11.8 Closure Evidence — 2026-07-16

本Change Set已经完成回写和封闭审计，结论为：`CLOSED / NO_UNRESOLVED_BLOCKER / NO_NEW_OWNER_DECISION`。
封闭时SSOT SHA256为：

```text
1229645EE5E99D54404506AEA6825C5B9F13734BB6D82A397F9CAD0E46B3BF30
```

审计Evidence：

1. 主审逐项复核Level 3对象/Owner/基数/生命周期矩阵，Level 4 Handoff/Transfer/Control矩阵，Level 5
   Policy/Decision覆盖矩阵，以及Level 6 Execution Context、Automation、Priority、Concurrency、Failure和
   Recovery矩阵；两次Business Handoff、Canonical Owner和Material Control transfer没有发生漂移。
2. 两轮相互隔离的post-apply blind review均完整读取冻结SSOT。第一轮未发现Blocker或新Owner Decision，
   提出4项确定性DOC_FIX；第二轮识别出3项会阻断文档封闭的合同歧义和4项DOC_FIX。所有问题都可以由
   已确认上游合同唯一推导，已完成修正，未引入新对象、Owner、Handoff、状态或用户旅程。
3. 修正项覆盖：Extraction Eligibility与Control acquire时点、Perception Acquisition scope、Shelf
   Deregistration与已Accepted On-deck责任的先后、Authorization所属Level、Inventory current-revision精确
   表述、Level 5 Review状态、Level 6 Execution Context矩阵命名、Dictionary继承规则和Canonical term统一。
4. 精确搜索确认正文不再残留bare `Product Package`、bare `Physical Target Folder`、`Shelf Target Folder`、
   `External Reality`、`External Source Reality`、系统唯一Material Field、当前Product Material Manifest、
   全部历史Inventory销毁、`retain_source`或Shelf `draining/retire`等活动合同漂移。`deckId`只保留在明确
   “不分配deckId”的否定合同中；旧`L6-Q2`–`L6-Q4`只保留在已关闭状态记录中。
5. Final invariant review确认：Deck不是Business Object；Collection Formation仍只有两次单向Handoff；
   Product Material Manifest仍为Libra immutable历史；Arca当前现实只由每个当前有效Inventory
   Representation的最新committed revision表达；Beta Identity不可改写；Shelf Deregistration非破坏；
   三个Control Region仍只为按Observation与Control动态派生的Projection。

Closure表示本轮bounded Change Set已经正确回写并通过审计。用户已于2026-07-16复核并确认Level 3–6为
`ACCEPTED`，Architecture Review至此关闭。Level 7起草期间的业务决策只进入独立非Canonical
`LEVEL7_BUSINESS_DECISIONS.md`，不重新占用本审计台账；实现、E2E与部署仍未授权。

## 12. Level 9 Journey Reverse Audit — 2026-07-16

### 12.1 Audit trigger、scope与mutation gate

用户在Level 9接受前要求：从已经确认的九条经典用户旅程反向审计Level 0–8，证明每个用户可见结果、
Command、长期配置和失败恢复都拥有完整的Owner、Fact、Process、Control、事务和Projection来源。

本轮沿用第2–4节Evidence-first规则，并增加三次相互独立的阅读视角：

1. **Journey pass**：只从用户开始、关闭浏览器、重启、并发修改及最终可验证结果出发；
2. **Owner pass**：只检查每个Command、Decision、Authorization、Projection是否落在唯一Canonical Owner；
3. **Physical closure pass**：只检查Level 8逐表、事务、Capability、Outbox和Read-model是否足以实现前两者。

在本节关闭前：

- Level 9不得标记`ACCEPTED`；
- `9.10.5`–`9.10.6`原“无Blocking Gap”结论视为正在复核，不作为实施依据；
- 本节Finding不得直接修改SSOT；先证明缺口、排除可由现有合同闭合的假阳性，再形成bounded change set；
- 只有存在两个业务结果都合法的分叉才提交用户。已有Accepted合同能够唯一推导的修正由Codex收敛。

### 12.2 Journey evidence matrix

| Journey | Level 0–6 semantic basis | Level 7–8 physical closure | Audit result |
| --- | --- | --- | --- |
| A 建立系统 | Material Field、Shelf、Routing、Standard、Workspace和standing Authorization Owner均已定义 | Routing/Template aggregate head、standing Authorization及若干Platform设置没有完整持久合同 | `CONFIRMED_GAP` |
| B 新材料上架 | 两次Handoff、Libra生产、Arca Acceptance/Off-load及Frozen语义完整 | Frozen discard事务和用户Activity progress持久来源不完整 | `CONFIRMED_GAP` |
| C 浏览收藏 | Shelf Entry、Deck Fact、Inventory与三维Health语义完整 | Aftercare Assessment/Case没有完整冻结Care Basis，部分当前结果不能安全重建 | `CONFIRMED_GAP` |
| D 健康与修复 | Aftercare三维评估、Case和专业复验闭环完整 | Placement变化与Decision Fact revision未完整进入Trigger/Basis/Schema | `CONFIRMED_GAP` |
| E Standard变化 | Template-follow、Standard revision和同一Shelf Entry持续改善已明确 | Template active revision/binding/archive与Aftercare Basis物理合同不完整 | `CONFIRMED_GAP` |
| F 感知与人物 | Perception immutable Record/Resolution及People Candidate/确认边界完整 | Registration Candidate没有Domain事实表；Merge Candidate缺少异步提交闭环 | `CONFIRMED_GAP` |
| G 退出收藏 | Candidate、Reservation、Scope、Authorization、Case与批量升级语义完整 | Level 8缺少Review/Reservation/Whitelist/Batch/Escalation事实，且Scope/Case顺序与Level 6冲突 | `CONFIRMED_GAP` |
| H 注销Shelf | 非破坏性行政终结、精确Control释放及恢复均完整 | Deregistration表、Capability与事务边界完整 | `PASS` |
| I 系统与成果 | 系统故障、业务待处理、资源等待与业务成果已分离 | Activity progress及部分Platform运行事实缺少可重建来源 | `CONFIRMED_GAP` |

这张矩阵不表示Levels 0–8整体失效。审计确认Level 0–6的五Domain、两次单向Handoff、Object continuity、
Material Control、Frozen、Aftercare、Off-deck和Deregistration业务边界仍成立；缺口主要是Level 8没有把已经
Accepted的业务合同完整投影为物理合同，以及Level 9少量公开接口没有反向验证这种缺失。

### 12.3 Confirmed finding register

#### L9-RA-01 — Frozen Libra Run discard没有责任与Control原子闭环

- **Classification**：`DOC_FIX + ENGINEERING_CHOICE`；不需要新业务Decision。
- **Existence evidence**：`5.6.7`、`6.4`和`9.5.3`已经唯一规定`frozen → discarded`、保留历史、释放原始
  Primary Control、清理可销毁Workspace产物并允许全新Procurement流程。
- **Gap evidence**：`8.5.4`没有Libra discard责任/Control事务；`8.5.11`只有`libra_runs.state`，没有不可变
  discard Decision/Receipt或等价合同；`8.6`没有能原子终结Run并释放精确Control的typed commit；普通
  `libra.workspace.material.reclaim`也没有定义已Promotion但未Accepted产品Material的Control收口顺序。
- **Required correction boundary**：必须明确一个Domain-owned discard commit，把用户Decision、Run terminal、
  原始Input Control release、Workspace cleanup eligibility与Outbox原子收口；实际文件清理由Libra Reclaimer
  异步幂等执行，不能先释放Workspace Product Control后留下无Owner文件。

#### L9-RA-02 — Shelf Placement变化没有进入Aftercare完整Basis

- **Classification**：`DOC_FIX`；不需要新业务Decision。
- **Derivation evidence**：`0.4`、`1.10`和`3.5.6`已经规定迁移NAS/路径只演进Inventory Representation，不能
  改变Shelf Entry、Deck Fact或Canonical Identity；`2.6`把Collection Care交给Arca Aftercare。
- **Gap evidence**：`9.4.4`承诺更改收藏位置后由Aftercare迁移，但`6.6.2` Trigger、`5.8.2.4` Care Basis、
  `6.6.4` invalidation和`8.5.12` Assessment/Case唯一性都未包含Shelf Placement Policy revision或当前
  Placement alignment。现有Conformance Capability输入也只写Standard。
- **Required correction boundary**：Placement不是第二份Shelf Standard；Aftercare必须把当前Placement
  alignment作为Arca-owned Care输入，冻结实际依赖的Placement revision，并在安全迁移后提交新的Inventory
  Representation。不得回流Libra、重新Routing或创造新Shelf Entry。

#### L9-RA-03 — Routing与Rule Template可变aggregate缺少current head及正确Owner映射

- **Classification**：`DOC_FIX`；不需要新业务Decision。
- **Routing evidence**：Level 9允许不同Field分别采用direct/sorting；`libra_routing_policy_revisions.mode`却位于
  Policy revision本身，且没有Field到当前Policy revision的head/binding。`arca_shelves.routing_priority`又把
  Libra拥有的Shelf Routing Priority写入Arca Store，与`5.4`和`9.6.1`冲突。
- **Template evidence**：Level 5/9规定Shelf绑定Template后跟随其active revision，User Template可发布、恢复和
  archive；`arca_rule_templates`只有immutable revision rows，没有Template aggregate head/status。当前
  `arca_shelf_standard_revisions.rule_template_id + rule_template_revision`可以作为Shelf binding的历史快照，
  但Level 8尚未明确它也是当前binding的权威来源，也没有支持Template active/archive lifecycle的current pointer。
  依赖`MAX(revision)`会直接违反`8.5.9`current pointer规则。
- **Public-surface evidence**：Level 9提供copy/preview/publish/archive，但没有明确可恢复Draft或publish payload
  合同，尚不能证明用户完成“复制后编辑再发布”的旅程。
- **Required correction boundary**：Routing仍归Libra、Template/Standard仍归Arca；补齐各自aggregate head、
  binding与revision合同，删除Arca对Routing Priority的写权，并让公开编辑合同能在浏览器关闭后恢复。

#### L9-RA-04 — Activity Ledger缺少durable progress source

- **Classification**：`DOC_FIX + ENGINEERING_CHOICE`；详细动作可见性已经由用户确认，不再讨论是否需要。
- **Existence evidence**：`7.9.4`要求长耗时Capability持续发布非业务progress sample；`9.1.2`与`9.8.4`要求
  百分比、速度、耗时和合理ETA，且关闭浏览器/重启后可恢复。
- **Gap evidence**：`fx_workflow_events`、`fx_event_attempts`和`fx_audit_records`均没有typed progress sample或
  current progress字段；Audit只保存`evidence_digest`，不足以重建Level 9的`current/total/unit/rate/etaMs`。
  `8.3.7`允许Projection Builder读取Foundation diagnostics，但没有定义Domain Process语义与technical Event
  progress组合成Activity的versioned public summary合同。
- **Required correction boundary**：Progress仍是Foundation技术事实，Activity仍是Read-model；不得把
  progress写成Business Process状态，也不得让UI读取日志猜百分比。

#### L9-RA-05 — Aftercare Assessment与Case没有持久化完整Care Basis

- **Classification**：`DOC_FIX`；不需要新业务Decision。
- **Existence evidence**：`5.8.2.4`要求Case冻结Standard、Canonical Identity、历史Package provenance、当前
  Inventory、实际Decision Fact revision及Care Requirement Set；`6.6.4`要求任一实际依赖revision变化使旧Case
  invalidated。
- **Gap evidence**：`arca_aftercare_assessments`唯一键只有`inventory_revision + standard_revision + kind`，
  Decision Fact或Placement变化时无法提交新的同维Assessment；`arca_aftercare_cases`没有`care_basis_digest`
  或等价immutable Basis引用；Capability Result也只返回Inventory/Standard摘要。
- **Required correction boundary**：Care Basis属于Arca Domain业务事实，不得只藏在Foundation
  `fx_supporting_works.basis_digest`或大JSON Evidence中；Assessment/Case/Planner/commit必须引用同一Basis。

#### L9-RA-06 — Level 9长期Platform设置和Arca standing Authorization缺少Canonical持久合同

- **Classification**：`DOC_FIX + ENGINEERING_CHOICE`；不需要新业务Decision。
- **Gap evidence**：`arca_ondeck_settlement_approvals`引用`standing_authorization_revision`，但Level 8没有拥有
  该revision的Arca表；`platform_resource_profiles`不能单独表达“当前即时Profile + 每周Operating Schedule”；
  其表合同同时把`profile_id`声明为PK又声称以`profile_id + revision`版本化，物理上不能形成多revision aggregate；
  Level 9可管理Worker、设备允许状态和API credential，但Level 8没有相应durable aggregate或明确复用
  `platform_integrations`的typed合同。Catalog还引用未定义的`WorkerHandle`。
- **Journey consequence**：Journey A的Full Automation Readiness、资源时段、Worker与Security无法在重启后由
  Canonical Fact确定；Journey I也无法可靠解释当前运行状态。
- **Required correction boundary**：Input Settlement Authorization仍归Arca；Resource/Worker/Security仍归
  Platform。不能以全局`config.json`或环境变量替代用户发布的revisioned设置。

#### L9-RA-07 — People Registration/Merge Candidate缺少Domain事实闭环

- **Classification**：`DOC_FIX`；不需要新业务Decision。
- **Existence evidence**：`5.9.4`和`6.8.3`要求弱Identity只能形成Registration/Merge Candidate，用户确认后才
  注册或合并。
- **Gap evidence**：Level 8已有`people_merge_candidates`表，但没有Registration Candidate表；Catalog只有
  Registration Evidence观察和Merge Candidate计算，也没有说明Domain completion callback如何把两类异步
  结果提交为People-owned durable Candidate Fact。Foundation Event Result不能替代可被用户确认的People业务对象。
- **Required correction boundary**：Candidate仍归People Management；它不能写Media-Cast Fact，也不能因候选
  自动注册弱Identity。

#### L9-RA-08 — Off-deck用户审阅链路的物理模型与Accepted顺序冲突

- **Classification**：`DOC_FIX`；不可逆授权语义已经确认，不需要再次询问用户。
- **Existence evidence**：`5.8.5`和`6.7`固定顺序为Candidate或Direct Intent → Reservation → immutable Scope →
  Authorization → Off-deck Case；批量只是一份Envelope，高量级需要独立第二次确认，Authorization后不可取消。
- **Gap evidence**：Level 8没有Reservation、Review、Duplicate Whitelist、Batch Envelope或High-volume Escalation
  Receipt表；`arca_offdeck_cases.candidate_id`不能表达无需Candidate的Direct Intent；`arca_offdeck_scopes`反向
  FK到Case，迫使Case在Authorization前存在，直接违反`6.7.1`“只有Authorization后创建Case”；
  `arca_offdeck_policy_revisions`也没有current head或其他Owner pointer，自动评估不能在不使用`MAX(revision)`的
  前提下确定当前Policy。
- **Required correction boundary**：先以Review/Reservation拥有pre-authorization Scope，Authorization后再创建
  每Entry独立Case；Direct Intent与Candidate路径在Scope前汇合；Scope freshness、批量Envelope和Escalation
  Receipt必须durable，不能信任客户端布尔值。

### 12.4 Rejected suspects and clean areas

以下疑点经全局反证后不构成架构缺口：

- **Material Field与Shelf Target路径重叠**：Levels 3、5、7、9已一致规定按Material Control派生Region；同路径
  不会使On-deck材料重新采购。
- **Overview是否需要新的Canonical Owner**：不需要。Overview是可重建Read-model，各Domain仍只发布自己的
  Facts；确定性聚合不形成第六个Business Domain。
- **Perception变化是否应Signal消费者**：不应。Level 5–6已经明确消费者只在自己的Decision/Freshness时点查询，
  不由User Perception中断流程。
- **Shelf Deregistration是否缺少物理闭环**：没有。Level 6状态/并发和Level 8表、Capability、原子Control release
  已完整覆盖，且没有文件副作用Capability。
- **Activity是否意味着恢复Task/Gate/Flow控制**：不意味着。Activity只读投影真实原子工作，不能成为Planner
  路由键或用户技术控制入口。

### 12.5 Audit classification result

本轮尚未发现必须提交用户的新业务分叉。八项Confirmed Finding都能由已经Accepted的用户结果、Owner、
Handoff、Authorization和Object continuity唯一推导；问题是合同传播和Level 8物理闭合不足，而不是需要重新
讨论ShelfDeck做什么。

因此当前状态为：

```text
LEVEL 9 ACCEPTANCE          BLOCKED
CONFIRMED FINDINGS          8
DECISION_REQUIRED           0
UPSTREAM BUSINESS REDESIGN  0
BOUNDED DOC/PHYSICAL FIX    REQUIRED
IMPLEMENTATION AUTHORIZED   NO
```

该状态是回写前的审计结论；Section 13已经按此顺序完成bounded change set和六类post-change audit。Level 9
现已重新进入用户Acceptance，但Implementation Gate仍未开放。

## 13. Level 9 Journey Bounded Change Set and Closure — 2026-07-16

### 13.1 Change-set invariants

本轮只允许补齐Section 12已经证明的8项合同传播/物理闭合缺口，并保持：

- 五个Business Domain和两次单向Handoff不变；
- Procurement/Libra/Arca的Object identity、Domain-local Binding与Material Control分离不变；
- Shelf Standard、Shelf Placement Policy、Routing Policy、Off-deck Policy继续由各自Owner分别维护；
- Activity/progress不成为Business Process状态、Planner输入或用户技术控制；
- Input Settlement Authorization、Aftercare Settlement Approval与Off-deck Destructive Authorization继续分离；
- Off-deck Authorization之后Intent不可撤销，Case只在Authorization后建立；
- 不新增兼容层、全局Config、跨Domain Store、Task/Gate/Flow写入口或第六Business Domain。

### 13.2 Applied change groups

| Change group | Finding | Applied SSOT scope | Result |
| --- | --- | --- | --- |
| A Run discard/control | `L9-RA-01` | Level 3/5/6 Run Discard Decision、Cleanup Scope；Level 8 transaction/schema/catalog；Level 9 Activity | closed |
| B Placement care | `L9-RA-02` | Level 3 Inventory、Level 5 Placement/Conformance/Care Basis、Level 6 Trigger/invalidation、Level 8 schema/capability | closed |
| C Routing/template aggregate | `L9-RA-03` | per-Field Routing head、移除Arca Routing Priority、Template aggregate/draft/current lifecycle、atomic publish、Level 9 draft API | closed |
| D Durable progress | `L9-RA-04` | Level 7 Event Progress/Activity Summary、Level 8 Repository/table/port、Level 9 Activity source | closed |
| E Care Basis persistence | `L9-RA-05` | relationized Case Basis inputs、Assessment uniqueness、Case creation transaction及typed DTO | closed |
| F Platform/standing authorization | `L9-RA-06` | Arca Authorization head、Resource Operating Policy、Device/Worker/Credential/Secret scope及WorkerHandle | closed |
| G People candidate | `L9-RA-07` | Registration Candidate table、generic People Candidate commit、durable UI target | closed |
| H Off-deck review chain | `L9-RA-08` | Policy head、Duplicate Group/Whitelist、Review/Reservation/pre-auth Scope、Selection/Escalation/Batch、post-auth Case | closed |

### 13.3 Post-amendment evidence

六类审计结果：

1. **Journey**：A–I均能从用户Intent走到durable结果；浏览器关闭、进程重启和Projection rebuild不依赖前端内存。
2. **Owner**：Routing Priority只在Libra；Placement/Care/Off-deck只在Arca；People Candidate只在People；
   Platform技术设置不进入Business Store。
3. **Negative path**：Frozen discard、Placement conflict、Template publish conflict、Candidate确认、Scope stale及
   Platform restart均有唯一收口路径，不使用silent fallback。
4. **Restart**：Cleanup Scope、progress current pointer、Care Basis、Review/Reservation、Authorization、Worker/
   Credential current revision均durable；Signal只负责唤醒。
5. **Destructive safety**：原始Input release与Workspace Product cleanup分离；Off-deck Case只在Authorization
   后创建；High-volume必须有独立Escalation Receipt；Input Settlement与Off-deck授权不复用。
6. **Mechanical**：

```text
HEADINGS                     unique
CAPABILITY REFS              112 / 112 unique
RELATIONAL TABLES            147 / 147 unique
HTTP METHOD+PATH ROUTES      109 / 109 unique
MARKDOWN FENCES              balanced
OLD OWNER/ORDER DRIFT        0
DIFF CHECK                   pass
```

### 13.4 Closure result

本轮结论为：

```text
CONFIRMED FINDINGS          8
APPLIED                     8
POST-AMENDMENT AUDIT        PASS
DECISION_REQUIRED           0
LEVEL 9 ACCEPTANCE          CONFIRMED / 2026-07-16
IMPLEMENTATION AUTHORIZED   NO
```

该Closure在形成时只证明Level 9可以重新提交用户整体确认；用户随后已于2026-07-16确认Level 9。该确认不
授权代码实现、E2E、Docker或生产部署，Level 10仍须独立设计与确认。本Review审计职责已经完成并转为
`CLOSED`历史Evidence；当前Accepted状态只以SSOT Confirmation State为准，不需要让Review台账重新保持活动。

## 14. Level 0–10 Final SSOT Audit — 2026-07-16

### 14.1 Trigger、scope与blind-review isolation

用户确认Level 10后，要求对唯一SSOT的全部Level 0–10做最终全面审计，并明确授权使用其他智能体执行盲审。
本轮以三个互不继承当前线程结论、只读取SSOT的隔离视角进行反证：

1. Business semantics、Owner、Object continuity与Handoff；
2. Schema、Runtime、Recovery、Safety与Operational closure；
3. 九条用户旅程、negative path、API与Projection闭环。

盲审结论只登记为Candidate。主审仍须对每项执行Existence、Derivation、Conflict、Journey、Boundary与Level
测试；严重度标签和审阅者数量都不能代替SSOT Evidence。没有证明的问题不得改写SSOT。

### 14.2 Candidate register after deduplication

| ID | Candidate | Initial class | Mutation rule |
| --- | --- | --- | --- |
| `FA-01` | Workspace新Material的Control取得条件把Workspace与Production Material Set混为一谈 | `DOC_FIX` | 只修正同域Workspace/Product Staging语义 |
| `FA-02` | 目录、布局、命名同时被Shelf Standard与Shelf Placement Policy声明拥有 | `DOC_FIX` | 以既有Placement唯一Owner合同消除冲突 |
| `FA-03` | 无Run unresolved Subject有放弃语义但无持久Decision、API与产品入口 | `DOC_FIX` | 传播既有唯一终结语义，不新增旅程分叉 |
| `FA-04` | Series Handoff A未定义新建Season Subject与扩充既有Subject的确认判据 | `EVIDENCE_AUDIT` | 涉及Business Object continuity；证明后才能决定是否提交用户 |
| `FA-05` | Beta Canonical Identity不可纠正是否违反Level 0真实性 | `SUSPECTED` | 先核对已确认Beta限制和unsupported diagnostic |
| `FA-06` | 通用Handoff允许同一Deliverable多次顺序Decision，Handoff A schema只容纳一次 | `DOC_FIX` | 对齐Offer/Decision基数，不改变唯一Accepted |
| `FA-07` | Business Handoff在Level 1与Level 4的适用范围同词异义 | `DOC_FIX` | 修正首次定义，保持Formation只有两次Handoff |
| `FA-08` | sealed Procurement failure允许用户明确重试但无Intent、API与用户入口 | `DOC_FIX` | 传播既有重试语义，不伪造Fact revision |
| `FA-09` | Journey E承诺全部标准Gap形成Aftercare Case，超出closed-world服务目录 | `DOC_FIX` | 收窄Journey文案，不新增外部采购路径 |
| `FA-10` | mountScopeId没有稳定Registry、revision与启动能力验证 | `ENGINEERING_CHOICE` | 补技术身份Registry，不新增Business Object |
| `FA-11` | 所有Command幂等要求没有同步Command的durable receipt | `ENGINEERING_CHOICE` | 增Foundation Command Receipt并与Owner事务原子提交 |
| `FA-12` | Off-deck批量授权被物理合同写成跨Entry原子事务 | `DOC_FIX` | Batch Intent与per-Entry Authorization/Case分事务收口 |
| `FA-13` | High-volume两次确认只有一个API动作 | `DOC_FIX` | 补独立第二次确认Command/API |
| `FA-14` | `deferred`正常观察与failure retry budget混用 | `ENGINEERING_CHOICE` | 分离失败预算和有界观察期限 |
| `FA-15` | 旧Snapshot恢复无法证明Snapshot之后的不可逆Effect | `ENGINEERING_CHOICE` | 增保守Safety Watermark/拒绝可写恢复合同 |
| `FA-16` | Full Operational Backup没有SQLite与Workspace/Artifact一致切面 | `ENGINEERING_CHOICE` | 固定停机/quiesced backup |
| `FA-17` | Outbox/Inbox没有consumer ack与Retention合同 | `ENGINEERING_CHOICE` | 补delivery/ack与有界GC，不让Projection依赖消息历史 |
| `FA-18` | Production Canary引入上游不存在的媒体级授权 | `DOC_FIX` | 区分部署许可和既有业务Authorization |
| `FA-19` | 无界fan-out原子事务与固定SQLite commit baseline不能同时闭合 | `ENGINEERING_CHOICE` | 明确supported scale、preflight与timeout语义 |
| `FA-20` | HTTP总数漏计公共health route | `DOC_FIX` | Admin/public分别计数 |
| `FA-21` | Process表的单一`work_id`与Process→Supporting Work `0..N`冲突 | `DOC_FIX` | 以Foundation owner/process反向关系为唯一链接 |
| `FA-22` | 持久`resource_lease_id`与Permit纯内存合同冲突 | `DOC_FIX` | 删除权威lease持久字段，只保留timing Evidence |
| `FA-23` | Physical contentHash算法、缓存与重新验证时点仍未闭合 | `ENGINEERING_CHOICE` | 固定Beta SHA-256与stat-fenced缓存 |
| `FA-24` | 5星Movie的4K-class精确判据被保留到Level 8但未兑现 | `ENGINEERING_CHOICE` | 补可执行raster判据和Probe字段 |
| `FA-25` | People Candidate有dismissed状态但无用户Command/API | `DOC_FIX` | 补统一dismiss动作，不改变注册/合并Owner |
| `FA-26` | Security页面承诺active credential revoke但无安全恢复旅程 | `DOC_FIX` | 收窄为rotate与session logout |
| `FA-27` | 已关闭Reservation仍有少量前瞻/旧术语文本 | `DOC_FIX` | 只做active text治理 |
| `FA-28` | 后续Dictionary重复定义前序Canonical Term | `DOC_FIX` | 保留每Level字典，重复项改为明确引用而非第二定义 |
| `FA-29` | Off-deck授权Identity已被外部删除/替换缺少强制fixture | `ENGINEERING_CHOICE` | 补测试矩阵，不新增授权分支 |

本Register尚不是缺陷结论。`FA-04`若在全局审计后仍存在两个产品含义不同的合法方案，才形成唯一
`DECISION_REQUIRED`；其他Candidate只有在既有合同能唯一推出修正时才允许bounded回写。

### 14.3 Defect proof and classification result

| ID | Final class | Evidence result |
| --- | --- | --- |
| `FA-01` | `DOC_FIX / APPLIED` | Level 3已把Production Material Set限定为外部Input、Workspace分为Working/Staging；Level 4误写“纳入Production Material Set才取得Control”。已替换为Workspace创建即域内Control、Promotion后进入Product Manifest。 |
| `FA-02` | `DOC_FIX / APPLIED` | Level 3/5已唯一把Endpoint/location/layout/name交给Placement；Level 5一处“可进入Profile Rule Set”是冲突文本，已删除第二Owner。 |
| `FA-03` | `DOC_FIX / APPLIED` | Level 5/6已有唯一用户终结语义；已传播Subject Abandon Decision/Receipt、原子Control release、fixture、Facade、页面、API和Attention。 |
| `FA-04` | `CONFIRMED / APPLIED` | 用户确认Exact continuity方案：只有provider-season identity或持久Triage grouping lineage精确唯一命中且Episode零重叠才扩充，否则接管为新Subject。已传播Level 3/4/5/6/8。 |
| `FA-05` | `FALSE_POSITIVE / CLOSED` | `L3-A12/L6-A9`是用户明确确认的Beta限制；矛盾Evidence进入unsupported/not_assessable且不伪造健康，仍可进入用户attention/off-deck。没有隐藏错误成功。 |
| `FA-06` | `DOC_FIX / APPLIED` | Level 4允许同一Deliverable顺序Decision且最多一个Accepted；Handoff A表错误限制为一个Decision。已改为多Offer/单Offer单Decision/Deliverable单Accepted。 |
| `FA-07` | `DOC_FIX / APPLIED` | Level 1措辞被误读为只允许inter-value-flow；已统一为Domain间责任交接，可位于同一或不同Value Flow，非责任协作仍不是Handoff。 |
| `FA-08` | `DOC_FIX / APPLIED` | Level 6明确允许用户重试sealed failure；已补一次性Retry Intent、Run basis消费、fixture、页面、API和Attention，observe不再冒充retry。 |
| `FA-09` | `DOC_FIX / APPLIED` | Aftercare closed-world边界唯一；Journey E已收窄为确定性Gap建Case，其余attention，不新增外部采购职责。 |
| `FA-10` | `ENGINEERING_CHOICE / APPLIED` | Physical Identity依赖稳定mount scope；已补Platform Mount Scope Registry、revision、Field/Shelf opaque ref、启动probe与unsafe错误。 |
| `FA-11` | `ENGINEERING_CHOICE / APPLIED` | 同步Command不用Work，旧revision重试无法仅靠Work幂等；已补与Owner事务同提交的Foundation Command Receipt及保留/fixture。 |
| `FA-12` | `DOC_FIX / APPLIED` | Level 5禁止跨Entry原子Case；已拆为Batch Authorization Intent与per-Entry Authorization/Case独立事务。 |
| `FA-13` | `DOC_FIX / APPLIED` | High-volume必须两次独立操作；已补`confirm-high-volume`，selection与escalation receipt不再由同一动作生成。 |
| `FA-14` | `ENGINEERING_CHOICE / APPLIED` | deferred不是failure；已新增Observation Budget并与failure retry、hard timeout分离。 |
| `FA-15` | `ENGINEERING_CHOICE / APPLIED` | 旧Snapshot无法自行证明post-snapshot destruction；已补先于不可逆点推进的外部Safety Watermark，不连续Restore保持faulted只读。 |
| `FA-16` | `ENGINEERING_CHOICE / APPLIED` | Full Backup需要SQLite与可变文件一致切面；Beta固定stopped/quiesced backup gate和digest复验。 |
| `FA-17` | `ENGINEERING_CHOICE / APPLIED` | 已补frozen consumer set、per-consumer delivery/ack、payload/tombstone retention；Projection rebuild仍只依赖Canonical Facts。 |
| `FA-18` | `DOC_FIX / APPLIED` | Canary consent不是媒体业务Authorization；已改为部署许可加普通On-deck/Settlement/Aftercare/Off-deck合同。 |
| `FA-19` | `ENGINEERING_CHOICE / APPLIED` | 原子fan-out不能无界；已固定Beta支持规模、preflight、writer busy与wall-clock含义，不以Recovery Sweep掩盖超限。 |
| `FA-20` | `DOC_FIX / APPLIED` | 原109只统计Admin。新增遗漏动作后机械结果为113 Admin + 1 public health，已分别计数。 |
| `FA-21` | `DOC_FIX / APPLIED` | Level 7固定Process→Work为0..N；已删除Process表单一work_id，以Foundation owner/process反向关系为唯一链接。 |
| `FA-22` | `DOC_FIX / APPLIED` | Permit不持久化；已从Event Attempt移除resource lease字段，仅保留资源timing Evidence。 |
| `FA-23` | `ENGINEERING_CHOICE / APPLIED` | Level 3保留项未兑现；已固定SHA-256、首次/Control前全Hash、stat-fenced缓存、变化重Hash和volume资源预算。 |
| `FA-24` | `ENGINEERING_CHOICE / APPLIED` | 4K-class保留项未兑现；已固定display-raster long/short edge判据和MediaProbe必需字段。 |
| `FA-25` | `DOC_FIX / APPLIED` | Candidate有dismissed生命周期但无Command；已补统一dismiss action、merge状态和无副作用语义。 |
| `FA-26` | `DOC_FIX / APPLIED` | 单一active credential的直接revoke缺少恢复旅程；Beta页面收窄为rotate和session logout，revoked只作旧revision历史。 |
| `FA-27` | `DOC_FIX / APPLIED` | 已修正Profile、retry/resource reservation、旧itemId示例和已兑现保留项文本。 |
| `FA-28` | `DOC_FIX / APPLIED` | 重复定义均兼容但不够显式；Confirmation Protocol已固定typed refinement规则，后续重复项改为引用前序定义。 |
| `FA-29` | `ENGINEERING_CHOICE / APPLIED` | 已补“授权Identity外部消失/被替代”的强制fixture：只能证明精确absence，不能触碰替代Identity。 |

Bounded amendment后的机械证据：

```text
HEADINGS                    unique
MARKDOWN FENCES             balanced
CAPABILITY REFS             112 / 112 unique
RELATIONAL TABLES           156 / 156 unique
ADMIN METHOD+PATH ROUTES    113 / 113 unique
PUBLIC HEALTH ROUTES        1 / 1 unique
DIFF CHECK                  pass
```

### 14.4 Audited Decision Packet — `FA-04`

**所在Level：** Level 3 Object continuity、Level 4 Handoff A、Level 5 Libra Intake Rules。

**大白话场景：** ShelfDeck已经有一项Season Subject；以后又采购到一批声称属于同一Season的新Episode。
Libra必须决定把它们追加给原Subject，还是创建新的Subject。这个决定不能等到Schema/代码阶段再猜。

**SSOT已经确定：**

- Subject的group粒度固定为Season；Episode是parent-local child；
- 同一Season的非重叠Episode Candidate可以扩充既有Subject；
- Triage Identity Claim是弱、recall-first、可纠正的，不等于Canonical Content Identity；
- 一份Candidate只能Accepted到一个Subject，同一Episode范围不能重叠；
- Beta不建设Canonical Identity correction或Subject split/merge流程。

**唯一未确定分叉：** 什么Evidence足以让Libra说“这批Candidate已确认属于原来的Season”。

**方案A（推荐）：Exact continuity claim。** Procurement在Candidate中提供稳定、可审计的Season Continuity
Claim；只有稳定Provider season identity完全相同，或同一Triage grouping lineage的continuity key完全相同，
并且Episode范围不重叠时才扩充。标题/年份/文件夹模糊相似只能用于Triage显示，不能合并Subject；无法证明时
建立新Subject。优点是不会把错误Triage永久焊进一个无法拆分的Season Subject；代价是少数真实同Season可能
暂时形成多个Pre-deck Subject，最终强Identity相同时仍可由Arca On-deck Commit扩充同一Shelf Entry。

**方案B：Libra fuzzy continuity。** 允许Libra按规范化标题、年份、season number和Field context做模糊匹配，
优先扩充既有Subject。优点是追剧场景更容易自动合并；代价是Recall-first Claim一旦误合并，Beta没有合法
Subject split/identity correction路径，错误范围可能共同进入同一生产对象。

**不建议方案C：每份Candidate永远新建Subject。** 它虽然最简单，但直接放弃已经确认的Season Subject可持续
接管新Episode语义，不能视为实现选择。

**推荐理由：** 方案A保持“弱Claim可以粗入库”与“对象范围扩充必须有确定Evidence”同时成立，把不确定性留在
可继续处理的新Subject，而不是把不可逆错误合并进既有Subject。它不把Canonical Identity提前到Procurement，
也不让Libra建设第二套Metadata中心。

**影响范围：** `3.4.2`、`3.8.2`、`4.4.3/4.4.8`、`5.4.1`、`6.4.2`、Level 8 Candidate/Subject match schema与
contract fixture。Domain、Handoff数量、Triage recall-first、Arca Canonical Identity和Shelf Entry continuity
均不变化。

Status: `CONFIRMED / APPLIED`（2026-07-16）。用户确认方案A；Section 14.5记录传播与关闭证据。

### 14.5 `FA-04` bounded propagation and final closure

用户确认的唯一业务规则固定为：Series Candidate只有在`provider_season_identity`或持久
`triage_grouping_lineage`与恰好一个active Season Subject形成exact交集、且Episode范围完全不重叠时才扩充；
claim缺失、零命中、多命中或任一重叠都不拒绝粗入库，而是建立新Subject。标题、年份、路径、目录和模糊
相似度禁止用于Subject continuity。

传播范围：

1. Level 3补齐Candidate Claim、Subject continuity、基数、Owner与Canonical Dictionary；
2. Level 4补齐Handoff A Acceptance范围、Subject Continuity Resolution和不变量；
3. Level 5补齐Intake Decision Function、Basis digest、new/extension确定结果与Dictionary；
4. Level 6补齐并发recheck、Basis失效与Accepted执行语义；
5. Level 8补齐两张typed relation table、Intake Decision字段、Candidate DTO、Accepted atomic fact set和crash fixture；
6. 不新增Business Domain、Handoff、Capability、API或用户陪诊动作；Triage recall-first与Arca Canonical Identity
   边界保持不变。

Post-change audit：

```text
HEADINGS                    unique
MARKDOWN FENCES             balanced
CAPABILITY REFS             112 / 112 unique
RELATIONAL TABLES           156 / 156 unique
TABLE PREFIX COUNTS         fx25 proc13 libra31 arca54 perception7 people10 platform16
ADMIN METHOD+PATH ROUTES    113 / 113 unique
PUBLIC HEALTH ROUTES        1 / 1 unique
DICTIONARY REDEFINITION     0
OWNER / HANDOFF DRIFT       0
DIFF CHECK                  pass
```

Negative-path复演确认：无claim、0命中、N命中、Episode overlap均建立新Subject；唯一exact match才extension；
并发Subject/Episode变化使旧Basis失效并重算；Resolved Product Identity新增provider anchor只影响未来Intake，
不追溯合并Subject；相同Candidate幂等返回原Accepted结果。

最终结论：`FINAL SSOT AUDIT PASS / ALL FINDINGS CLOSED / NO OPEN BUSINESS DECISION`。这只关闭架构审计，
不授权代码实施、E2E、Docker或生产部署。

## 15. Post-baseline bounded document corrections

### 15.1 `PBF-01` — Platform physical package omission

Status: `CLOSED / DOC_FIX APPLIED` — 2026-07-17

实施差距审计发现Level 8存在一处机械矛盾：`8.1.2`的固定物理根目录清单没有列出`platform/`，但
`8.3.8`、`8.5.2`、`8.5.13`、Level 8 Dictionary、Level 9 API与Level 10 Runtime合同已经共同要求Platform
拥有revisioned technical aggregates、`platform_*` Repository、typed runtime ports和`PlatformAdminFacade`。

全局复核证明这不是新的Business Domain、Owner或用户选择，而是物理目录清单与Composition Root描述漏项。
有界修正如下：

1. `8.1.1` Runtime总图补列Platform settings，并补齐Domain只能通过typed runtime ports读取Platform的依赖方向；
2. `8.1.2`在`media-service/src/helix/`根目录补列与`domains/`、`foundation/`平级的`platform/`，并固定其
   `public|model|application|persistence`内部边界与唯一public入口；
3. `8.1.3`补齐Composition Root对Platform public package、Repository、typed ports和Admin Facade的装配责任；
4. Level 8 Dictionary补齐`Platform Package`并修正`Helix Composition Root`定义。

该修正不重新打开Level 0–10，不改变五个顶层Business Domain、Handoff、Fact Owner、Schema或公开API，
也不授权实施跨越现有Implementation Gate。自动架构检查必须把`platform/`视为SSOT要求的合法且必需顶层包。

### 15.2 `PBF-02` — Perception Acquisition vertical contract closure

Status: `CLOSED / SEMANTIC FIX APPLIED / REALIZABILITY EXTENDED BY PBF-03` — 2026-07-17

P6-03实现合同审计证明，Level 3/6已经确定Perception Acquisition、immutable Record、来源内幂等、
`supersedes|retracts`历史和consumer query-only边界，但Level 8的Capability、nominal type、关系表与Domain
Commit恢复合同没有形成一条可执行的数据链。已确认的缺口为：

1. `PerceptionObservationPage`只有ID/revision/digest，Normalize无法读取冻结事实内容；
2. Record commit input没有Source/cursor transition，无法让Record与cursor head同事务成立；
3. Record Draft缺少source revision/digest、observedAt与结构化Anchor；
4. 实现草案使用`0..10`而Canonical schema与Level 5 Decision Fact固定`1..5`；这是实现漂移，不是业务选择；
5. Accepted的`supersedes|retracts`与dedup关系没有正式Draft/Commit路径；
6. Domain Fact Commit强制Outbox与Perception禁止consumer change Signal之间缺少“本域技术receipt不是业务Signal”的澄清；
7. commit marker没有绑定durable typed result，commit后响应前崩溃无法恢复原始Result；
8. Level 3的`perceptionAcquisitionId` Process Root没有传播到Level 8关系Schema。

全局审计证明以上均可由Accepted合同唯一推导，不产生新的用户Decision。Bounded change set为：

- Level 6把Acquisition固定为单Source/config revision、稳定Acquisition ID和逐页
  `Acquire → Normalize → Atomic Commit`；
- 外部Source经Acquire Capability形成Page；用户即时Intent由Owner从已验证Command payload形成同schema单页
  Page，两者从Normalize开始共用同一提交链；
- Observation item必须携带digest-bound bounded typed payload或immutable ArtifactHandle，Normalize禁止Provider二次读取；
- Normalize输出完整`PerceptionAcquisitionCommitDraft`，Canonical rating固定`null|integer 1..5`，原始scale留Provenance；
- page commit原子提交Acquisition/page、Record、Anchor、显式source-lineage Relation、cursor CAS、receipt、typed
  Event Result、marker和Perception-internal Outbox；最后一页同时终结Acquisition；
- `perception_dedup_relations`收束为通用immutable `perception_record_relations`；来源lineage由record commit提交，
  `duplicate_of`由resolution commit提交，均不得按revision大小隐式推断；
- 新增`perception_acquisitions`与`perception_acquisition_commits`，关系表总数由156变为158，
  `perception_*`由7变为9；Capability ref仍为112，Result family仍为96；
- 通用Domain Fact Commit Handle补齐result schema，commit marker引用同事务`fx_event_result_bindings`；重放
  返回第一次保存的typed result，同marker不同payload稳定拒绝；
- Level 8 transaction fixture与Level 10 fault matrix覆盖payload冻结、cursor CAS、typed result、marker和Outbox
  全部崩溃窗口。

PBF-02当时的semantic post-change audit（实现可实现性结论由后续`PBF-03`补充，不单独作为P6-03 readiness证据）：

```text
CAPABILITY REFS             112 / 112 unique
RESULT FAMILIES             unchanged: 96
RELATIONAL TABLES           158 / 158 unique
TABLE PREFIX COUNTS         fx25 proc13 libra31 arca54 perception9 people10 platform16
PERCEPTION PIPELINE         acquire → normalize → atomic commit closed
CURSOR/RECORD ATOMICITY     closed
TYPED COMMIT REPLAY         closed generically
CONSUMER CHANGE SIGNAL      none
NEW BUSINESS DECISION       none
```

该修正不改变User Perception Owner、消费者query-only关系、公开API、Shelf Standard或Rating业务语义；
实现线程必须重新生成相关P2 schema/fixtures，禁止通过ambient Store、Provider二次读取或重放扫描猜测Result。

### 15.3 `PBF-03` — Perception implementation realizability closure

Status: `CLOSED / DOC_FIX APPLIED_AND_AUDITED` — 2026-07-17

`PBF-02`完成语义纵向闭合后，P6-03实施前反证证明五项技术合同仍不能直接生成无歧义P2 schema/fixture：

1. “首个page revision=0”混淆了首次Source同步与每次Acquisition首页，第二次Acquisition必然CAS失败；
2. `current_cursor_revision=0`与revision从1开始的SQLite composite FK无法同时成立；
3. Commit Handle的`payloadDigest`若覆盖包含Handle自身的完整named input，会形成自引用digest；
4. `pure_observation` Acquire被要求在超限时创建Artifact，违反Effect Class；
5. typed Result内部的`resultDigest`与“完整typed value digest”形成第二处自引用和双basis风险。

这些是跨组件、持久化、Effect Class和恢复合同，不是实现Agent可自行选择的局部编码细节；但它们均可从
Accepted Owner与Process语义唯一推导，不产生用户业务Decision。Bounded change set为：

- Source storage head改成nullable composite FK pointer；Commit CAS仅在“从未存在cursor row”时使用逻辑sentinel
  `expectedCursorRevision=0`；
- 每个Acquisition冻结创建时真实head。配置/scope兼容时继承`cursorOut`，不兼容时从`cursorIn=null`重扫，
  但revision仍从当前head继续递增；同Source至多一个active Acquisition；
- `commitPayload`固定为全部typed input/parameter排除当前Commit Handle与Runtime context后的canonical object；
  Perception Record Commit的payload恰好为`PerceptionAcquisitionCommitDraft`；
- typed JSON统一使用UTF-8 RFC 8785 JCS + SHA-256 lowercase hex；digest字段不进入自己的basis；
- Perception Acquire只输出Normalize所需的bounded inline DTO，禁止创建Artifact；Adapter通过字段投影和分页
  满足`16 KiB/item`与`64 KiB/page`，无法满足时稳定失败且不推进cursor；
- `PerceptionRecordCommitResult`删除内部`resultDigest`；`fx_event_result_bindings`与Acquisition receipt表对同一
  `result_json`保存同一storage digest；
- Transaction fixture补齐第二次Acquisition、配置/scope重扫、真实SQLite FK、digest self-reference和
  pure-observation副作用反证。

Post-change audit：

```text
SECOND ACQUISITION CURSOR   closed; first page uses frozen real head
SQLITE OPTIONAL FK          realizable with nullable composite pointer
SQLITE IN-MEMORY PROBE      first/second/reset CAS=1; invalid pointer rejected
COMMIT PAYLOAD DIGEST       exact non-self-referential basis
TYPED RESULT DIGEST         one storage basis; no inner self digest
PURE OBSERVATION EFFECT     no Artifact creation path
CAPABILITY REFS             112 / 112 unique
RESULT FAMILIES             unchanged: 96
RELATIONAL TABLES           158 / 158 unique
NEW BUSINESS DECISION       none
```

`PBF-03`关闭后，`PBF-02`的semantic direction与P6-03 contract-generation readiness才同时成立；这不打开
SSOT的Implementation Gate。实现仍必须以
生成的JSON Schema、SQLite DDL和second-acquisition crash/replay fixture证明遵守合同，不能以文档通过代替测试。

### 15.4 `PBF-04` — Nominal Result identity与People Candidate payload continuity

Status: `CLOSED / DOC_FIX APPLIED_AND_AUDITED` — 2026-07-17

实现前schema生成反证发现两项表面问题，纵向审计后确认People链路还有同一根因下的三项关联缺口：

1. `perception.dedup.resolve@1`把说明文字放进output type cell，机器会把
   `PerceptionResolutionDraft(with explicit duplicate relation drafts)`抽成不存在的nominal Result；
2. `people.candidate.commit@1`把`(registration|merge)`拼进nominal input名称，`people.person.commit@1`则使用
   没有formal schema的`Registration/merge decision`；
3. `PeopleCandidateDraft`只有payload digest，没有Candidate Commit必须保存的`proposedName`、Alias、Provider
   Identity、Reference hint或normalized Person pair/evidence；
4. Candidate没有immutable state revision，Level 9的expected-revision dismiss/accept无法映射到真实SQLite CAS；
5. Candidate accepted到Person create/Merge、Preference冲突选择和Merge correlation没有一个formal typed input与
   原子事务，若实现自行补齐，只能旁读Foundation Result、Provider、缓存或其他非正式来源。

这些问题都属于既有People Owner、Candidate用户确认语义、immutable revision规则与Commit Participant边界的
工程合同闭合，不新增用户业务Decision。Bounded change set为：

- Capability表只保留精确nominal identity：Perception output固定为`PerceptionResolutionDraft`；说明文字移到
  schema语义段；People input固定为`PeopleCandidateDraft`与`PeopleCandidateAcceptanceDecision`；
- 原`people.merge_candidate.resolve@1`更名为`people.merge_evidence.resolve@1`，明确其只生产Evidence；真正的
  `PeopleCandidateResolver`是People application内pure Decision Function，不被伪造成Capability；
- Resolver正式消费typed Registration/Merge Evidence与`PeopleCandidatePolicyRef`，输出完整discriminated
  `PeopleCandidateDraft | no_candidate`；Candidate payload直接携带Registration facts或normalized Merge pair、
  精确Person revision、冲突和Evidence continuity，digest只覆盖该payload；
- Candidate Commit只消费完整Draft，不得旁读Foundation/Provider/缓存；Registration/Merge各增加immutable
  Candidate revision表，head保存immutable payload与current revision/state投影；
- 新增formal `PeopleCandidateAcceptanceDecision`：绑定candidate revision/payload、decision origin、新Person ID或
  source/target Person revision以及Preference选择；strong identity仍先建立Candidate，Preference冲突时禁止自动接受；
- People Candidate Acceptance事务同时终结Candidate并完成Registration的Person/Alias/Provider Identity，或
  Merge的target/source Person revision、Merge Record和必要Preference revision；Reference hint只保留为后续
  Reference Maintenance输入，不伪造成已导入资产；
- People API request discriminator、transaction/crash fixture和Level 10 fault matrix同步闭合。关系表新增两张
  Candidate revision表，总数从158变为160，`people_*`从10变为12；Capability仍为112，Result family仍为96。

Post-change audit：

```text
CAPABILITY REFS             112 / 112 unique
RESULT FAMILIES             unchanged: 96
RELATIONAL TABLES           160 / 160 unique
TABLE PREFIX COUNTS         fx25 proc13 libra31 arca54 perception9 people12 platform16
DECORATED NOMINAL OUTPUT    none
SQLITE CANDIDATE FK/CAS     deferred head↔revision + registration/merge acceptance atomic probes pass
PEOPLE CANDIDATE PAYLOAD    evidence → complete draft → immutable candidate closed
CANDIDATE ACCEPTANCE        typed decision → candidate terminal + person facts atomic
FOUNDATION/PROVIDER SIDEREAD forbidden; People-owned exact revision CAS only
NEW BUSINESS DECISION       none
```

该修正不改变People Management业务目标、媒体Cast Fact Owner、用户确认语义、Domain/Handoff或公开路由数量。
实现仍须用生成的Decision/Candidate/Person JSON Schema、SQLite FK/partial unique DDL、Candidate acceptance
crash/replay fixture和nominal identity extractor证明遵守合同；不得通过生成器清洗类型名、Foundation旁读、
Provider二次查询或兼容路径掩盖缺口。

### 15.5 `PBF-05` — Perception Resolution input closure与People Person schema conservation

Status: `CLOSED / DOC_FIX APPLIED_AND_AUDITED` — 2026-07-17

P6 schema实施反证发现两项新的可实现性缺口；主审沿Level 3→5→6→8纵向审计后确认第一项还关联三处同源
合同断点：

1. `perception.dedup.resolve@1`的正式输入只有Record identity/digest与Rule revision/digest，缺少请求fact kind、
   Query Identity Evidence、Record value/Anchor/Provenance/lineage以及可执行Rule语义；pure Executor无法按
   `5.9.2`选择winner，又被`8.7.1`禁止旁读Store；
2. `CanonicalQueryHandle`的概念定义要求typed input，但mandatory字段只保留`inputDigest`，无法作为可读取Query；
3. Resolution revision没有冻结`recordSetDigest/ruleDigest`或完整typed found/not_found结果，Facade无法证明返回
   value/provenance对应哪份输入切片；
4. winner matching与`duplicate_of` proof没有分离，存在把fuzzy match或相同值误提交为duplicate relation的风险；
5. `people_person_revisions.content_scope`既不属于Level 3 Person模型，也不存在于Registration Candidate或
   Acceptance Decision，People Commit无法从正式输入产生该字段。

以上均属于Accepted User Perception/People Owner内部的typed input、决策可执行性与Schema数据守恒，不改变
用户旅程、Domain、Handoff、公开API或不可逆授权。Bounded change set为：

- `PerceptionResolutionInputAssembler`成为Perception Application内唯一Resolution输入准备组件；它可以读取
  本域Repository并按同一Rule的retrieval clauses冻结完整候选超集，但不得决定winner、冲突或duplicate；
- `perception.dedup.resolve@1`正式输入改为
  `PerceptionResolutionQuery + PerceptionResolutionRecordSet + PerceptionResolutionRuleSnapshot`；三者均有
  bounded typed schema和独立digest，Executor保持pure且禁止Store/Provider/Foundation旁读；
- `CanonicalQueryHandle`补回bounded `typedInputSchemaRef + typedInput`并验证`inputDigest`，digest-only Handle不再
  合法；
- 版本化Rule Snapshot携带candidate retrieval、Anchor matcher/strength、同tier conflict、duplicate proof与
  candidate bound的可执行声明式语义；Beta固定最高strength同值found、同tier冲突not_found，不按数组/DB顺序
  猜winner；fuzzy match和相同value不能单独证明duplicate；
- `perception_records.record_digest`冻结Record标量与Anchor set；Resolution revision持久化query/fact kind、
  record/rule digests及完整typed Result，Resolution/head/duplicate relation/typed Result/marker同事务；
- 增加Perception Resolution crash/contract fixture，覆盖retracted/superseded、缺kind、同值、同tier冲突、fuzzy
  duplicate反证、三重digest freshness与重放；
- 删除孤立的`people_person_revisions.content_scope`。Person继续是全局Registry，媒体content profile和
  Media-Cast relation仍由媒体事实Owner维护，不新增默认值、support column或隐藏输入。

Post-change audit：

```text
CAPABILITY REFS                 112 / 112 unique
RESULT FAMILIES                 unchanged: 96
RELATIONAL TABLES               unchanged: 160
PERCEPTION RESOLVER INPUT       typed query + complete record set + executable rule snapshot
PURE EXECUTOR STORE READ        forbidden; owner assembler is the only repository reader
WINNER / DUPLICATE PROOF        separated and deterministic
RESOLUTION COMMIT CONTINUITY    query/record/rule → draft → revision/head/result closed
CANONICAL QUERY PAYLOAD         bounded typed value present; digest-only handle rejected
PEOPLE CONTENT_SCOPE            removed; no orphan schema field or invented default
NEW BUSINESS DECISION           none
```

该修正不打开Implementation Gate。实现必须通过generated JSON Schema、Resolver fixtures、SQLite Resolution
commit/replay probe和orphan-column audit证明遵守合同；不得在Executor中查询Perception Store、按输入顺序挑
winner、把fuzzy match写成duplicate，或为People自行补一个`content_scope`默认值。

### 15.6 `PBF-06` — Reference Image、Person discovery、Media-Cast与Metadata闭合

Status: `CLOSED / DOC_FIX APPLIED_AND_AUDITED` — 2026-07-18

P6-08实现反证证明原Reference合同无法从通用`ArtifactHandle`唯一产生Reference Asset/Face事实：缺少业务
discriminator、稳定ID、Face来源、Embedding/model、expected revision/state、Projection digest及正式Face命令。
随后沿Person用户旅程、On-deck NFO人物发现、Media-Cast Owner和Product Metadata补齐链做纵向审计，确认还有
四项同源的“概念存在但正式输入/交付不闭合”问题：

1. 用户直接注册Person与Reference添加没有明确分成两个事务；
2. “系统从Deck Facts发现Person”没有可执行的Arca Projection → People Candidate路径；
3. Libra Media-Cast只交付digest摘要，Arca无法在不旁读Libra/People的情况下保存完整relation，未注册人物也
   没有正式表示；
4. `libra.product_metadata.fetch@1`没有表达Related NFO与Provider的单来源意图及Beta来源顺序。

用户确认的产品语义为：

- 用户只管理Reference Image；Reference Face是从一张图片内部派生的事实，不暴露增删命令；
- 一张Reference Image必须恰好包含一张人脸，零张或多张均拒绝；
- direct Person Registration先独立成立，Reference Image可随后上传或跳过，失败不回滚Person；
- 系统周期消费Arca从On-deck NFO发布的人物Evidence；stable Provider Person Identity可自动接受强Candidate，
  name/alias/image/face等弱Evidence只形成用户Candidate；
- 联网搜索演员图片只是独立便利能力，不属于注册或Candidate，明确延后到Post-Beta并记录于
  `FUTURE_PRODUCT_CAPABILITIES.md`；
- Movie/Series Product Metadata固定Related NFO优先、TMDB补缺，JAV使用JAV Provider，Western Adult使用
  Libra既有自建分析；不建设Metadata Center或隐藏fallback。

Bounded change set保持五Domain、Owner、Handoff、112项Capability与113个Admin route不变：

- 新增formal `DirectPersonRegistrationDecision`、`PeopleReferenceMaintenanceDecision`、
  `MetadataFetchIntent`、`MetadataObservationSet`、`OnDeckPersonEvidenceProjection`与完整
  `PersonReferenceProjection` typed合同；
- `people.reference_fact.commit@1`只消费完整Reference Decision；add同时建立稳定Asset/Face，release同时终结
  二者，CommitParticipant禁止旁读Artifact/Foundation/Workspace补字段；
- 增加`people_reference_revisions`及Person current reference pointer，关系表由160变为161，`people_*`由12变为13；
- Merge不复制Reference；target Projection按correlation展开source贡献并把每个source revision/digest计入
  Projection digest；
- People public命令只保留`addReferenceImage/releaseReferenceImage`，不存在Face命令；
- Arca现有Presentation Assessment发布NFO人物Projection；People现有Planner/Coordinator/Candidate链消费；
  Arca只按exact Provider identity、accepted Candidate origin Evidence或Merge correlation确定性修正自己拥有的
  Media-Cast；
- `MediaCastFact`与On-deck Product Package携带完整relation snapshot，未注册关系以`personId=null`保存；
- 既有Production Planner选择来源并在每次durable Observation后重新计算Gap；一次metadata fetch只观察一个
  来源，Provider Adapter不选择fallback、不写Fact。

P6-08原始设计返回逐项复核：

```text
Asset/Face discriminator       CLOSED: add_image | release_image；Face随Image派生
stable asset/face IDs          CLOSED: Coordinator预分配并进入digest-bound Decision
Face source/embedding/model    CLOSED: exact Artifact + single FaceEmbeddingSet + modelRef
expected revision/state        CLOSED: Person/reference CAS + active→released terminal
Projection revision/digest     CLOSED: nullable local ref pointer + persisted projection checkpoint + named JCS bases
Merge correlation projection  CLOSED: expand without copying; contributor revisions in digest
Face facade command            CLOSED BY PRODUCT DECISION: no user/internal public Face command
partial commit/replay          CLOSED IN CONTRACT: one People transaction + durable typed result
CAPABILITY REFS                unchanged: 112
RESULT FAMILIES                unchanged: 96
RELATIONAL TABLES              161 / 161 unique
NEW BUSINESS DOMAIN/HANDOFF    none
OPEN BUSINESS DECISION         none
```

结论：`P6-08 architecture-blocking design return = RESOLVED`。该结论只表示SSOT已给出唯一可实现合同；P6-08仍须
以generated schemas、SQLite deferred FK/CAS、zero/one/multi-face fixtures、add/release crash-replay、Merge
Projection digest fixture及static boundary audit证明实现遵守合同。联网图片搜索不属于P6-08 Beta验收，不能
用复用Registration Evidence或隐藏Provider调用的方式提前实现。

### 15.7 `PBF-06-R1` — Reference Projection formal realizability follow-up

Status: `CLOSED / BOUNDED DETAIL FIX APPLIED` — 2026-07-18

PBF-06实现复审确认Reference add/release原子事务及原Design Return其余项目已经闭合，但指出三项不会改变产品
语义或结构的formal-realizability gap：无Reference的Projection无法表达、四类Reference digest没有唯一basis、
`projectionRevision`缺少初值和持久恢复规则。该问题不要求新的业务决策，也不改变Domain、Owner、Handoff、
Capability、Facade命令、Face产品语义或关系表数量。

有界修正固定为：

- `PersonReferenceProjection.currentReferenceRevision`是`null|positive`并且只表示查询Person的local pointer；
  从未提交local Reference时为JSON `null`，无Merge contribution才返回空数组，merged-source只读贡献不受该
  null影响；曾有local Reference但active集合为空仍保存正整数revision和owner空集合Contribution；
- Reference ID集合统一按exact ID的UTF-8 bytes升序；`activeAssetSetDigest`、`activeFaceSetDigest`和
  `referenceSetDigest`分别使用带固定schema discriminator的命名JCS object；`factDigest`覆盖排除自身后的完整
  `PersonReferenceRevision`，不得使用数据库行顺序、locale sort或另一套storage basis；
- Projection semantic digest明确排除`projectionRevision`与`projectionDigest`，覆盖
  `projectionContract/personId/personRevision/currentReferenceRevision/contributions`；
- `people_persons`保存`current_reference_projection_revision/digest`技术checkpoint。Person成立时revision固定
  为`1`；任何改变basis的People事务在同一事务内按digest变化CAS递增，GET不补写；进程重启或payload cache
  重建必须由Canonical Facts与Merge correlation重算相同digest并复用checkpoint，缺失或不一致形成明确系统
  invariant violation，禁止lazy default或revision reset。

因此本修正仍是对既有PBF-06合同的细化，不新增表或架构结构。实现线程后续对null fixture、digest golden
fixture、首次revision、Reference/Merge后递增及restart rebuild continuity进行验证即可反证本合同。

### 15.8 `PBF-07` — Field Observation payload与revision continuity

Status: `CLOSED / BOUNDED DETAIL FIX APPLIED` — 2026-07-18

P7-03实现反证确认原Field Observation合同存在两个真实的formal-realizability gap：

1. `FieldObservationPage.materialObservations[]`只被抽取为opaque object/revision/digest ref，但
   `proc_field_materials`要求完整Physical Identity、hash/stat、Endpoint/location、Binding与Provenance，正式
   Commit input中不存在合法Resolver；
2. `ObservationCommitResult`继承revisioned `DomainFactEnvelope`，但Field Store没有Observation current head或
   revision chain；Access revision、page ordinal、时间戳和observation ID都不能冒充该revision。

该问题不涉及新的用户业务结果。Bounded fix保持Procurement Owner、Material Field Object、Field Observation
Supporting Work、现有两项Capability和表数量不变：

- 新增formal `FieldObservationPageRequest`与内联`FieldMaterialObservationSnapshot` DTO；snapshot完整携带
  PhysicalMaterialIdentity、全文件SHA-256、stat、location、Access/Mount/containment provenance及命名digest，
  pure page observe不得写Artifact或让Commit旁读Snapshot Store；
- `bindingRevision`不由pure Observer输入或猜测；Procurement CommitParticipant只比较本域同Material current
  Binding的endpoint/location，以首次1、无变化保持、变化加1的规则唯一演进；
- `PhysicalMaterialIdentity.materialKey`固定为带schema discriminator的JCS SHA-256，inode在JSON中使用十进制
  string，避免实现间精度/tuple差异；
- Observation aggregate固定为`aggregateType=material_field_observation, aggregateId=fieldId`；
  `proc_material_fields.current_observation_revision`保存nullable head，`proc_field_observations(field_id,revision)`
  保存跨Work/page持续递增的immutable chain，逻辑expected 0只映射首次SQL NULL；
- 每页Commit在一个事务中执行Field/access/head CAS、Material current-row upsert、Observation revision/head、
  durable typed Result、统一result digest和commit marker；相同work/page/pageDigest重放返回原Result；
- 新Material只初始化为`unknown/unknown`；P7-04现有Field Management reconcile独占最终
  Eligibility与Control Projection推导，Observation Commit不得直接宣称eligible或伪造Region；
- cursor在Supporting Work内分页，后续新Work只重置cursor、不重置Field revision；terminal page结束Work，
  restart从commit marker和原Result恢复。

因此`P7-03 Field Observation Design Return`的架构阻塞已经在SSOT层闭合，没有新增Domain、Process Root、
Business Object、Capability、表或用户Decision。实现仍需以generated schema/DDL、first/subsequent work CAS、
page replay/conflict、完整snapshot materialization、result-digest/marker和restart continuity fixtures证明遵守合同。

### 15.9 `PBF-07-R1` — Field Observation durable payload与optional Outbox follow-up

Status: `CLOSED / BOUNDED DETAIL FIX APPLIED` — 2026-07-18

PBF-07重物化及crash/restart反证通过后，P7-03继续证明两项纵向合同没有闭合：

1. `FieldObservationPage`允许`512 KiB`，但Foundation durable Event Result/Evidence各自只有`64 KiB`；
   `proc_field_observations`只存digest，Material current row会被后续页面改写，因此合法Page缺少唯一可恢复位置；
2. 具体Field Observation Transaction声明`outboxRequired=false`，而generic Domain Commit Coordinator把
   `domain_fact_commit`误实现为永远要求non-empty Outbox。

Bounded fix不新增Domain、Business Process、Capability、关系表或用户Decision：

- `FieldObservationPage`正式收敛为最多100项且完整UTF-8 JCS value≤`65,536` bytes；Observer同时遵守item/byte
  budget，不能由实现私下降低后丢字段；
- Field Observation Commit把完整Page作为`FieldObservationPage@1` typed Evidence、把完整
  `ObservationCommitResult@1`作为typed Result写入同一`fx_event_result_bindings`，二者与Field head、immutable
  revision、全部Material current rows和commit marker同事务成立；
- 历史Page唯一通过`proc_field_observations.commit_marker → fx_commit_markers.result_id →
  fx_event_result_bindings.evidence_json`恢复；该Observation revision仍存在时其Evidence禁止GC或压缩；
- `pageDigest`继续覆盖命名Page basis，`evidence_digest`覆盖完整typed Page，两者不混用；Result使用统一storage
  digest；
- Outbox cardinality由精确Transaction Contract决定：true必须non-empty并装配participant，false必须允许零消息且
  不装配/伪造Outbox。Field Observation固定false，由Workflow Result、启动恢复和周期reconcile继续推进。

因此本轮关闭的是payload capacity/storage continuity和Coordinator条件装配语义；PBF-07既有snapshot、revision、
cursor与初始责任结论保持不变。

### 15.10 `PBF-08` — Extraction Eligibility Policy、Control freshness与reconcile continuity

Status: `CLOSED / USER DECISION APPLIED / BOUNDED DETAIL FIX APPLIED` — 2026-07-18

P7-04纵向实现审计证明Field Observation输入已经闭合，但Extraction Eligibility仍有四项真实缺口：

1. Extraction Policy只有opaque JSON存储，没有唯一可执行schema、匹配语义或reason precedence；
2. §5.3.1残留“重复开采抑制”必要条件，但Procurement没有该事实、Owner或表，且它与§5.3.7“不从失败历史
   形成隐藏抑制”冲突；
3. Material Control只有写Authority，没有versioned read Projection，Procurement不能证明Region Projection
   对应哪个current Control revision；
4. P7-04缺少terminal missing、Access/Observation切换、stale write、atomic current-row update和restart恢复的
   唯一合同。

用户确认Beta Extraction Policy只支持五项确定性输入：`includedDirectories[]`、`excludedDirectories[]`、
`allowedExtensions[]`、`minimumSizeBytes`与`excludedMaterialKeys[]`；不支持glob、wildcard、regex或文件名模糊
匹配。空include表示整片Field，exclude优先，其余采用精确且可重放的Linux/Field-root-relative语义。

Bounded correction保持五Domain、两Handoff、112项Capability与161张关系表不变：

- 删除Procurement Eligibility中的duplicate-suppression conjunct并显式禁止读取Arca Off-deck Suppression或从
  failed Run/Candidate形成隐藏规则；
- 固定`ExtractionPolicy@1`closed schema、上限、排序、目录边界、extension/size/materialKey判断和稳定reason
  precedence；
- 在既有`MaterialControlAuthority`public port增加bounded、batch、versioned read Projection；从未有row、released、
  controlled及typed unavailable均有唯一表达，最终Run admission仍执行Control CAS；
- 由既有`MaterialFieldManager`承担Input Assembly、纯确定性evaluation和current-fact reconcile，不新增Catalog
  Capability、Business Process或Object；
- `proc_field_materials`保存Eligibility revision/basis、Field/Observation/Policy/Selection与Control basis，所有
  Query先验证freshness；旧Decision不能覆盖新Reality或新Control；
- current terminal Work未出现的历史Material保留Binding历史并置为ineligible；non-terminal Work或Access变化使旧
  basis立即effective unknown，无需mass rewrite；
- Reconcile Batch在单一SQLite事务中重验全部basis，以applied/no-op/stale summary收口；它是可重建current
  decision-fact事务，不写Event Result、commit marker或Outbox，启动恢复与周期reconcile保证收敛。

因此`P7-04 Extraction Eligibility Reconcile Design Return`已经闭合。该修正包含一项已确认用户Policy Decision，
其余为既有Owner边界内的formal-realizability细化；没有引入兼容层、跨Domain Store读取、默认allow/deny、隐藏
suppression或新的架构结构。

### 15.11 `PBF-09` — Procurement Run Admission、Seal与Retry continuity

Status: `CLOSED / BOUNDED DETAIL FIX APPLIED` — 2026-07-18

P7-05实现反证确认Procurement Run的业务语义已经存在，但Level 8没有形成可执行的纵向合同：Selection允许
4096项而Control Handle/Receipt只允许1024项；Run只保存opaque digest；Run创建、Selection唯一性与全部Control
取得没有同一事务；Seal没有区分Run Selection与保留的Procurement Control；Retry只定义Intent创建，没有闭合
消费与唯一新Run。

该问题不要求新的用户业务决定。Bounded correction保持五Domain、两Handoff、既有Process Root、112项Capability
和96个Catalog Result family不变：

- 单Run Selection固定为`1..1024`，超出范围由多个互不重叠Run处理，空Selection与1025项输入稳定拒绝；
- 正式定义`ProcurementRunExecutionBasis@1`与完整`SelectedFieldMaterialSet@1`，冻结Field Access、terminal
  Observation、Extraction Policy、Triage rule和逐Material Binding/Eligibility/Reality/Provenance/Control snapshot；
- 使用增强后的`proc_procurement_runs + proc_run_materials`关系化持久完整Basis，不以大JSON、Foundation Work或
  最新Field current row替代历史输入；
- Procurement Control固定归`material_field/fieldId`稳定scope；Admission在一个SQLite事务中建立Run/Basis/
  Selection并对全部成员acquire或assert同Field retained Control，typed Receipt改为count/set digest而非大key数组；
- Candidate发布把成员转成`candidate_delivery` reservation；Seal只释放未成Package的Run Selection，Handoff A
  终态再把Reservation置为transferred/released，避免sealed Run后材料被重复采购；
- Retry Intent以relationized逐材料precondition冻结精确失败scope；consume CAS与新Run Admission同事务，或原子
  进入stale且不建Run；同一Intent最多关联一个新Run，响应前崩溃重放原Result；
- 新增一张Procurement-owned `proc_procurement_retry_intent_materials`关系表承载逐材料Retry fence，关系表总数
  从161调整为162；它不是Business Object、组件、Capability或兼容层。

因此`P7-05 Procurement Run Admission Design Return`的五项阻塞已经在SSOT层闭合。实现仍需通过1/1024/1025
边界、Admission中途崩溃、same-Field assert、Candidate Reservation、Seal、Retry consume/stale及restart replay
反例证明合同物化正确。

### 15.12 `PBF-09-R1` — Run Seal Evidence、Retry replay与Triage Rule authority

Status: `CLOSED / BOUNDED DETAIL FIX APPLIED` — 2026-07-18

P7-05对`PBF-09`物化前再次做纵向反证，提出三项formal-realizability疑点。主审分别沿正式DTO、Owner relation
rows、canonical transaction、commit marker/replay和current freshness核对后，确认三项均为真实缺口，而不是实现
线程对已定合同的重复提问：

1. Seal Decision和Receipt都要求逐成员`evidenceDigest`，但Run member row只有terminal disposition；aggregate
   `seal_evidence_digest`无法恢复released set，且三项Seal digest没有唯一JCS basis；
2. Retry只保存expected member摘要和一个singular stale reason，无法重建实际consume snapshot、closed reason
   precedence、primary/aggregate映射或五项digest；
3. Triage Rule虽然已有Procurement Owner和Run frozen revision语义，但没有唯一Registry authority，也没有在Run
   Admission/Retry freshness中拒绝调用者伪造或过期Rule tuple。

本轮修正不改变业务语义，不需要用户Decision。Bounded correction保持五Domain、两Handoff、既有Procurement
Process、112项Capability、96个Catalog Result family和162张关系表不变：

- `proc_run_materials`增加terminal Evidence digest、Run head补齐Seal Decision ID，Run Seal在同一事务写逐成员
  Evidence、candidate/released set digest及aggregate seal digest；三项公式、排序、空集合和count含义唯一化；
- Retry Intent冻结完整Admission Head，existing member relation增加expected Selection fence以及一次写入的typed
  consume snapshot；Run/Retry expected Control row补齐与正式Snapshot一致的Evidence digest；failed member、member
  precondition、scope、precondition set和stale set digest均有唯一JCS formula；
- stale reason收敛为13项closed set、固定precedence、每member唯一primary code、Result去重排序数组和Intent head
  primary映射；所有terminal member snapshot、typed Result与marker同事务成立；
- `TriagePlanner`包内的immutable `ProcurementTriageRuleRegistry@1`成为唯一Rule Authority；新Run只使用active
  Snapshot，已有Run按保留的historical entry恢复，Retry consume把Rule active freshness纳入Admission Head；
- Registry是versioned contract artifact，不新增Store、Capability、Business Object、顶级Domain或用户配置。

全文一致性审计覆盖Level 5 Policy Owner、Level 6 Run/Seal/Retry、Level 8组件树、transaction、162-table schema、
formal DTO/digest、application flow、crash fixture与Dictionary，以及Level 10 Registry startup/readiness。结果为
`PASS / PBF-09-R1 CLOSED / NO OPEN BUSINESS DECISION`。

### 15.13 `PBF-10` — Procurement Triage typed pipeline continuity

Status: `CLOSED / BOUNDED DETAIL FIX APPLIED` — 2026-07-18

P7-06在P7-05 Run Basis已经物化后逐项审计四个Triage Capability，证明旧Catalog摘要无法由正式输入唯一形成
正式输出。主审没有接受实现线程结论作为前提，而是从Level 3 Candidate合同、Level 5 Triage Readiness、Level 6
Run执行、Level 7 pure Capability边界、Level 8 nominal schema/transaction逐层反证，确认以下均为真实缺口：

1. `SelectedMaterials/Roles/Structure`是互不关联的generic数组/opaque refs，无法证明Material→Role→N:M Episode
   Claim、Binding revision、Run Selection subset或ordinal；机器Schema还把ordinal错误套用revision最小值1；
2. Structure缺少完整Field/layout/probe typed Evidence、closed profile/season/disc/related decision contract，无法在
   不旁读Store或路径猜测时形成Unit；
3. Playability没有Probe Result continuity、closed reason set和precedence；
4. Identity Claim没有mediaType/contentProfile/structure/Identity Metadata到Candidate Draft/Package的完整连续性；
5. pure Manifest Builder直接输出带业务发布时间的published Manifest，使最终Candidate Commit无法证明唯一输入
   closure；Candidate schema也没有N:M Episode Claim的可恢复关系。

Bounded correction不新增Domain、Owner、Business Process Root、Handoff、Store或Capability：

- 四个Capability改为exact named DTO；完整Run Selection仍为`1..1024`，Probe按`1..100`分页并显式绑定
  Material/Binding/Read Handle/MediaProbe Evidence；
- 现实读取只由既有`shared.material.media.probe@1`与`shared.material.layout.observe@1`通过typed port完成；四个
  Triage Executor保持pure，不调用Filesystem/FFprobe/Provider/Repository/Facade或另一个Executor；
- Run内固定为Evidence Assessment与逐Candidate Unit Assembly两段Supporting Work；只有Run Coordinator可以从
  已终结Evidence签发后续Work，Planner/Executor不得链式创建；
- `ProcurementTriageRuleSnapshot`补齐closed Playability/Profile/Series token/Disc/Related/Identity规则；
  `TriageStructureEvidence`按≤64 KiB page把完整Selection分区为non-overlapping Unit或unassigned reason；
- `TriageUnitSnapshot`完整携带mediaType/contentProfile、Identity Metadata、Role、N:M Episode Claim、Related
  Reference和唯一digest；Identity/Manifest分别消费同一Unit，禁止数组位置、调用者默认值或Store旁读；
- pure Builder输出`PrimaryInputManifestDraft`，替换原Catalog Result slot；Candidate Publication以完整
  `CandidateDraft`原子建立final Manifest、Package、Episode/Related relation、Reservation、Offer/Outbox、typed
  Result/marker，并使用Run package revision head保证重放连续；
- 新增一张Procurement-owned `proc_candidate_primary_material_episode_claims`关系表表达Manifest Member↔Episode
  Claim N:M关系，表总数从162调整为163；它不是新Store、Business Object、组件或Capability。

全文审计覆盖Level 3 Candidate/Manifest、Level 5 Triage Rule、Level 6 Supporting Work/Run、Level 7
Planner/Capability/Event binding、Level 8 Catalog/DTO/transaction/163-table schema/crash fixture/Dictionary及Level 10
contract counts。结果为`PASS / PBF-10 CLOSED / NO OPEN BUSINESS DECISION`。

### 15.14 `PBF-10-R1` — Candidate Publication transaction table continuity

Status: `CLOSED / BOUNDED DETAIL FIX APPLIED` — 2026-07-18

P7-07在物化`helix.transaction.procurement-candidate-publication@1`时发现：8.5.4的业务原子集已经要求final
Manifest及N:M Episode Claim relation，8.5.11也已经定义并要求
`proc_candidate_primary_material_episode_claims`与Publication同事务成立；但8.5.4没有把该Canonical
Transaction的domain participant表集逐表列成机器合同。生成后的`participants[domain].tables`与
`writeTables`因此漏掉该表。实现写入它会突破白名单，不写则违反既有原子事实集。

主审沿Candidate Draft、Manifest Draft/final Manifest、Episode relation table、Canonical Transaction、crash
fixture和163-table inventory反证，确认这是formal machine-contract gap，不是新的业务要求，也不是实现线程对
已定Owner边界的误读。Bounded correction只做以下闭合：

- 在8.5.4把Candidate Publication的Procurement domain participant固定为7张表，并显式纳入
  `proc_candidate_primary_material_episode_claims`；
- 固定Foundation participant为3张既有表，`writeTables`为两者精确并集10张，`readTables`保持2张；
- 明确某次Candidate没有Episode Claim row不允许从Transaction白名单删除关系表；
- crash fixture显式要求Episode relation表与Package、Manifest、Related relation、Reservation、Offer、Outbox、
  typed Result和marker全有或全无。

本修正不新增或删除关系表，`163 tables / 163 unique names`保持；不改变Domain、Owner、Store、Handoff、
Capability、Candidate业务语义或Publication事务边界。Transaction materializer/validator必须按该精确表集重新物化，
不能继续从概括性“Manifest/Relation”文字推断。审计结果为
`PASS / PBF-10-R1 CLOSED / NO OPEN BUSINESS DECISION`。

### 15.15 `PBF-10-R2` — Candidate Publication Offer input and persistence continuity

Status: `CLOSED / BOUNDED DETAIL FIX APPLIED` — 2026-07-19

P7-07完成`PBF-10-R1`重物化后，对Candidate Publication Store、Handoff A Offer与Libra Intake做第二次纵向
审计，提出Acceptance Basis、Offer/Outbox以及Season Continuity kind三项formal-realizability疑点。主审没有把
实现反馈当作结论，而是分别核对Level 3 exact continuity、Level 4 Handoff Offer/Acceptance、Level 5 Libra
Intake、Level 8 Candidate DTO/table/Facade/Outbox/transaction/crash fixture，确认三项均为真实合同缺口：

1. `proc_candidate_deliveries.acceptance_basis_digest`和`libra_intake_decisions`要求同一Basis，但正式Draft、Package
   与Handoff合同都没有唯一来源或digest formula；它不能私自等于`packageDigest`；
2. Candidate Publication要求同事务建立Offer与Outbox，但没有stable `offerId`、typed message、consumer、dedup key
   和payload合同；
3. Level 3和两侧Store只允许`provider_season_identity|triage_grouping_lineage`，而物化器因typed DTO未写死枚举，
   自行生成了`exact_provider_season|persistent_triage_grouping`，跨Handoff无法无损持久化。

Bounded correction不新增Domain、Owner、Store、Handoff、Capability或兼容路径：

- `CandidateIntakeAcceptanceBasis@1`由final `CandidatePackage@1`和固定
  `helix://handoffs/procurement-to-libra/v1`唯一派生；它是Offer-side basis，不包含Libra current Subject、Episode
  overlap或Control Decision Evidence，也不写回Candidate Package；
- `offerId`由Package revision/digest与Acceptance Basis按JCS/SHA-256唯一计算；
  `ProcurementCandidateOfferAvailableMessage@1`固定producer、唯一Libra consumer、aggregate、payload、consumer
  set digest、dedup key、message ID与payload digest；Facade改为消费该typed message；
- 新增的`SeasonContinuityClaim@1`只是既有exact Claim的nominal DTO，统一字段与枚举并明确从Triage Unit、
  Candidate Draft/Package、Procurement relation到Libra relation不改名、不映射；错误别名稳定拒绝；
- `CandidatePackage@1`继续保留PBF-10完整字段，不加入Offer字段或Libra `subjectId`；Offer/Acceptance facts仍由各自
  Owner持久化。

全文一致性审计覆盖Level 3 continuity、Level 4 Handoff A、Level 5 Intake、Level 8 Capability output、formal DTO、
7+3 participant transaction、163-table inventory、Facade、Outbox/Inbox、crash fixture与Dictionary。结果为
`PASS / PBF-10-R2 CLOSED / NO OPEN BUSINESS DECISION`。

### 15.16 `PBF-10-R3` — Candidate Publication Run revision-head write-set continuity

Status: `CLOSED / BOUNDED DETAIL FIX APPLIED` — 2026-07-19

P7-07在`PBF-10-R2`重物化后的Candidate Publication Store开工审计中证明：正式事务已经要求对
`proc_procurement_runs.candidate_package_revision_head`执行expected-head CAS并把新head作为Package/Result
revision，但`PBF-10-R1`固定的domain participant清单只列了Candidate、relation、Delivery及Reservation七张表，
把承载该CAS写入的`proc_procurement_runs`只放进`readTables`。因此合法实现无法同时遵守revision序列化和机器
write whitelist。

主审沿8.5.4 atomic fact set、8.5.11 Run表合同、Candidate Package revision、commit marker replay、crash fixture与
163-table inventory独立反证，确认这是既有同一事务中的formal machine-contract gap，不是新的业务语义、Owner
变更或实现线程对CAS的额外要求。Bounded correction只做以下闭合：

- 把既有`proc_procurement_runs`加入Candidate Publication的Procurement domain write participant；
- domain participant由7张修正为8张，Foundation participant保持3张，`writeTables`精确并集由10张修正为11张；
- `proc_procurement_runs`继续保留在`readTables`：同一表先用于expected-head fence read，再在相同事务执行CAS
  increment，read/write双重出现是该事务的明确合同；
- crash atomicity明确覆盖Run revision head、Package、final Manifest/Episode/Related relations、Reservation、
  Acceptance Basis/Offer、typed Result/marker及Outbox全有或全无；
- `PBF-10-R2`闭合的Acceptance Basis、stable Offer/Outbox、canonical continuity kind与完整Candidate Package合同
  全部保持不变。

本修正不新增或删除关系表，`163 tables / 163 unique names`保持；不改变Domain、Owner、Store、Handoff、
Capability或兼容策略。Transaction materializer/validator必须重物化为8张Procurement表加3张Foundation表的11张
精确写集。审计结果为`PASS / PBF-10-R3 CLOSED / NO OPEN BUSINESS DECISION`。

### 15.17 `PBF-11` — Libra Intake delivery、N:M Episode与Decision CAS continuity

Status: `CLOSED / BOUNDED DETAIL FIX APPLIED` — 2026-07-19

P8-02在开始Libra Intake Store前沿Candidate Delivery、FA-04、Subject/Binding持久化和Handoff A Accepted事务
纵向反证，提出六项formal-realizability疑点。主审没有直接接受实现返回，而是分别核对Level 3 Subject continuity、
Level 4 Handoff A、Level 6 Intake concurrency、Level 8 public Port/Capability/DTO/table/transaction/crash fixture：

1. CandidateDeliveryPort已经是正式边界，但没有versioned output DTO；Package/Manifest也没有Primary
   endpoint/location，而Binding却强制这些字段；
2. Procurement Manifest允许一个Material拥有`0..32` Episode Claim，Libra Binding和Store却只能保存一个
   `episodeKey`，也没有Subject accepted Episode scope；
3. SSOT要求并发match/overlap重算，但没有防0/1/N query phantom的Libra head、唯一target Intake CAS或set digest；
4. exact provider-season anchor的业务语义已存在，且SSOT已要求Resolved Identity发布时追加Subject continuity
   relation；真实缺口不是新Identity模型，而是没有明确这张可枚举relation是Intake唯一查询落点、opaque
   provider identity digest不得被反解；
5. new Subject在Identity尚未解析时没有合法pointer初值；
6. Accepted payload没有冻结Offer/Basis、Delivery、Owner-authored resolution、target CAS、N:M Binding scope或
   Decision digest，调用者提供的Subject ID可能越过Libra Decision authority。

这些问题不需要新的用户业务决定。Bounded correction保持五Domain、两Handoff、既有Process Root、112项
Capability、96个Catalog Result family、现有组件和单SQLite Store不变：

- `CandidateDeliveryPort@1`正式返回digest-bound `CandidateDeliverySnapshot@1`，把Offer/Acceptance Basis/
  Package/完整Manifest与从Procurement immutable Run Basis重建的逐Primary Location Evidence闭合；Libra不旁读
  `proc_*`；
- Binding恢复为每Material一条、Episode Claim独立N:M relation，并增加Subject accepted Episode scope作为
  FA-04 overlap唯一权威来源；
- 增加Libra `active_subject_continuity` global CAS head防query phantom，并在Subject row增加Intake revision与
  current continuity/Episode scope digests；extension同时CAS global/target，new Subject只CAS global且由Libra
  分配ID；
- 0/1/N matching只保存Decision所需0/1/2个确定性witness，one分支关系化完整Episode overlap；完整
  `SubjectContinuityResolutionDecision@1`、`AcceptedIntakePayload@1`、Binding Draft、Receipt和accepted message均有
  唯一digest；
- Resolved Product Identity的exact Season Claim使用同一`SeasonContinuityClaim@1` nominal value并在identity
  commit时关系化；Intake只读该relation，不反解identity digest；new Subject的`current_identity_revision`固定NULL；
- Handoff A Accepted机器事务固定10张Libra-owned表与5张Foundation表，global/target head、Decision Evidence、
  Subject/claim/Episode、Binding/N:M relation、Control、Receipt/Result/marker/Outbox全有或全无。

为保存既有Owner事实，新增`libra_subject_continuity_heads`、`libra_intake_resolution_match_witnesses`、
`libra_intake_resolution_episode_overlaps`、`libra_subject_episode_scopes`、
`libra_material_binding_episode_claims`五张Libra-owned关系/头表；它们不是新Store、组件、Business Object或
Capability。关系表总数由163调整为168，`libra_*`由31调整为36。审计结果为
`PASS / PBF-11 CLOSED / NO OPEN BUSINESS DECISION`。

### 15.18 `PBF-11-R1` — Candidate Related Reference immutable reconstruction

Status: `CLOSED / BOUNDED DETAIL FIX APPLIED` — 2026-07-19

P8-03在实现`CandidateDeliveryPort@1`前反证完整Package的历史重建路径，证明`proc_candidate_related_references`
只保存Endpoint/location/checksum和一个模糊Evidence digest，缺失`RelatedMaterialReference@1`强制的
`PhysicalMaterialIdentity`五元组、association Evidence和`referenceDigest`。Checksum不能反推出Mount Scope、inode或
materialKey；在Offer关闭后旁读current Material row、Foundation Event Result或旧Runtime都不能恢复原Package。

该问题成立且不需要业务决策。Bounded correction：

- 固化`RelatedMaterialReference@1` nominal value、稳定`referenceId/referenceDigest`公式、排序和上限；
- 扩充既有`proc_candidate_related_references`，逐列保存完整Identity、Endpoint/location、checksum、association
  Evidence和reference digest；Primary关联仍通过同Candidate的`primary_ordinal`复合FK重建，不复制第二份Primary事实；
- Candidate Publication继续使用原8张Procurement与3张Foundation事务表，完整Related row与Package、Manifest、
  Reservation、Offer、Result/marker和Outbox全有或全无；
- Candidate/Run/Offer关闭后这些published rows不可删除，Delivery Port只能从Procurement immutable Owner rows重建
  相同`CandidatePackage/relatedReferenceSetDigest/packageDigest/deliverySnapshotDigest`，不得使用current-row修补或
  Foundation Result fallback。

本修正不新增Domain、Owner、Store、Handoff、Capability或关系表；`112 Capability / 168 tables`保持。
审计结果为`PASS / PBF-11-R1 CLOSED / NO OPEN BUSINESS DECISION`。

### 15.19 `PBF-11-R2` — Handoff A Rejected terminal continuity

Status: `CLOSED / BOUNDED DETAIL FIX APPLIED` — 2026-07-19

P8-05在实现Libra Intake Rejection路径前，沿typed Decision、Libra Owner rows、Receipt重建、Outbox和Procurement
Reservation收口做纵向反证，提出四组formal-realizability疑点。主审没有直接接受实现返回，而是核对Level 4
Handoff A rejection语义、Level 6 Intake responsibility、Level 8 Capability/DTO/table/transaction/fixture，确认全部
成立，且共同根因是Rejected Acceptance被错误挤进了Accepted continuity decision family：

1. `SubjectContinuityResolutionDecision@1`只合法表达`new_subject|season_extension`，但旧
   `libra_intake_decisions`把`rejected`混进同一result并要求同一decision digest；
2. rejected row强制填写target Subject和committed continuity head，违反“不创建/扩充Subject、不推进head”；
3. `StructuredRejection@1`与`RejectionReceipt@1`没有可由Libra Owner Store完整重建的Reason/Evidence、identity和
   digest连续性；
4. 没有Libra Rejected commit/typed Outbox及Procurement消费Rejected终态、释放Candidate Reservation但保留
   Procurement Material Control的精确原子事务。

Bounded correction保持五Domain、两Handoff、既有Process Root、112项Capability与单SQLite Store不变：

- 保持`SubjectContinuityResolutionDecision@1`为Accepted-only；Continuity无匹配、多匹配或Episode overlap仍按
  已确认规则建立new Subject，绝不成为Rejection reason；
- 新增同一Intake Owner内的`IntakeRejectionDecision@1` typed variant，固定Handoff A closed reason precedence、
  Reason/Evidence排序和JCS/SHA-256公式，并让`libra.intake.rejection.commit@1`消费该完整Decision；
- 把`libra_intake_decisions`与`libra_handoff_a_receipts`改为明确互斥的accepted/rejected列variant；rejected
  不保存Subject、continuity head、Binding或Control假值；
- 新增一张Libra-owned `libra_intake_rejection_reason_evidence`关系表，逐项保存多reason和Evidence，使
  `StructuredRejection@1`、`IntakeRejectionDecision@1`与`RejectionReceipt@1`均可历史重建；
- 固定`LibraCandidateRejectedMessage@1` producer/consumer/dedup/payload合同；Libra Rejected canonical
  transaction为3张Libra表加3张Foundation表全有或全无；
- 固定Procurement rejection consume为`proc_candidate_deliveries + proc_run_materials + fx_inbox`三表原子事务：
  Delivery进入rejected、全部Candidate Reservation进入`released+handoff_rejected`、终态Evidence绑定同一Receipt，
  Procurement Material Control保持不变；重复消息重放相同closure result，迟到Accepted或成员不完整稳定拒绝。

全文一致性审计覆盖Handoff A调用方向、Accepted/Rejected互斥、Capability nominal input、Owner table variant、
canonical transaction write set、Outbox/Inbox、row-to-typed reconstruction、crash fixture、Dictionary与Level 10
计数。关系表由168调整为169，`libra_*`由36调整为37；没有新增Domain、Owner、Store、Business Object、Handoff、
Capability、兼容路径或跨Store读取。审计结果为
`PASS / PBF-11-R2 CLOSED / NO OPEN BUSINESS DECISION`。

### 15.20 `PBF-11-R2-R1` — Receipt digest consistency and Handoff B rejection propagation

Status: `CLOSED / BOUNDED DETAIL FIX APPLIED` — 2026-07-19

P8-05在重物化`PBF-11-R2`后执行全局反向审计，提出两项回归疑点。主审逐项核对formal nominal type、Owner
row、Capability output、row-to-typed reconstruction和两次Handoff语义，确认两项都成立：

1. Handoff A accepted的formal `SubjectAndTransferReceipt@1`固定
   `ReceiptEnvelope.scopeDigest=AcceptedIntakePayload.payloadDigest`，但新Receipt表说明误写成“accepted/rejected
   都使用Decision digest”，与同节后续重建规则冲突；
2. Handoff A需要的多Reason/Evidence富拒绝合同被扩成通用`StructuredRejection@1/RejectionReceipt@1`后，
   `arca.acceptance.rejection.commit@1`也被迫返回同一富类型，而Arca现有Decision/Receipt rows无法在重启后重建
   这些字段，形成新的Capability↔Owner Store断裂。

Bounded correction没有把Handoff A实现细节强行传播为Arca内部模型，而是按两个既有Handoff的不同验收语义分型：

- Handoff A accepted在所有位置唯一使用`accepted_payload_digest`作为Receipt scope digest；rejected继续使用
  `IntakeRejectionDecision.decisionDigest`；
- Handoff A富拒绝改为专用`IntakeStructuredRejection@1`和`IntakeRejectionReceipt@1`，保留PBF-11-R2已经闭合的
  多Reason/Evidence、closed precedence、Decision、Outbox和Procurement consume合同；
- Handoff B保留通用`StructuredRejection@1/RejectionReceipt@1`，但收窄为5.7.3 closed rejection code和可由
  `arca_acceptance_checks`唯一重建的Evidence set；新增formal `ArcaAcceptanceRejectionDecision@1`及
  `ArcaProductRejectedMessage@1`，不新增Capability；
- 扩充既有`arca_acceptance_attempts/decisions/handoff_b_receipts`列variant，使Rejected Decision、Receipt和
  typed Outbox能由Arca Owner Store历史重建；补齐Handoff B Rejected canonical transaction与crash fixture；
- 扩充既有`libra_delivery_receipts`并固定Libra rejection consume，使Delivery Owner幂等收口Rejected Package，
  这只是既有Handoff B终态消费，不是反向Handoff；
- Handoff A/Handoff B rejection output分型后，112项Capability不变，unique Catalog Result family由96变为97；
  未新增关系表，inventory保持`169 tables / arca_54 / libra_37`。

全文反向审计覆盖Accepted/Rejected Receipt公式、Capability nominal output、Arca/Libra Owner rows、两项canonical
transaction、Outbox/Inbox、accepted与rejected互斥、crash/replay、table count及Domain/Owner/Handoff不变量。
没有新增Domain、Owner、Store、Business Object、Handoff、Capability、兼容路径或跨Store读取。审计结果为
`PASS / PBF-11-R2-R1 CLOSED / NO OPEN BUSINESS DECISION`。

### 15.21 `PBF-11-R2-R2` — Candidate Delivery lifecycle CAS semantics

Status: `CLOSED / BOUNDED DETAIL FIX APPLIED` — 2026-07-19

P8-05在注册Procurement Handoff A rejection consume Repository时证明一个机器合同矛盾：canonical transaction
要求把`proc_candidate_deliveries`从`open` CAS为`rejected`，但表合同中的“terminal列写后immutable”被materializer
错误抽取成整表`immutable=true`，Repository因此在执行前拒绝任何UPDATE。反向审计又确认Accepted消息消费需要
同一类`open → accepted`终态化，不能只修拒绝分支。

该问题成立，但不改变业务语义。Bounded correction：

- 固定逐表`rowMutability`的机器区分：`append_only`禁止UPDATE，`cas_lifecycle`只允许该表closed transition set中的
  expected-state CAS；列write-once或terminal immutable不得再被推导为整表append-only；
- 把`proc_candidate_deliveries`显式声明为`cas_lifecycle`，唯一允许的转换为一次
  `open → accepted|rejected`；Decision/Receipt/terminal Evidence/closed time同一CAS写入，进入任一终态后只能相同
  Evidence幂等重放，不能改写相反Outcome；
- 把已有`proc_run_materials`Reservation合同显式声明为`cas_lifecycle`，closed transitions保持
  `run_selection → candidate_delivery|released`及`candidate_delivery → transferred|released`，Basis、Candidate FK与
  terminal bundle继续write-once；
- 对称固化Procurement Handoff A Acceptance Consume application transaction，并定义可从Delivery和Run member终态
  rows重建的`ProcurementCandidateAcceptanceClosureResult@1`；它与Rejected consume都使用
  `proc_candidate_deliveries + proc_run_materials + fx_inbox`，均不得再次操作Material Control；
- crash/replay fixture同时覆盖Accepted与Rejected：Delivery、全部Reservation terminal Evidence和Inbox result全有或
  全无；迟到的相反消息、缺成员或digest冲突稳定拒绝。

全文审计覆盖两条Handoff A终态消费、Repository注册语义、closed transition set、terminal replay、Owner rows恢复、
canonical transaction write set、crash fixture与计数。没有放宽全局Repository gate，没有新增Domain、Owner、Store、
Business Object、Handoff、Capability、关系表或兼容路径；inventory保持`112 Capability / 97 Catalog Result family /
169 tables`。审计结果为`PASS / PBF-11-R2-R2 CLOSED / NO OPEN BUSINESS DECISION`。

### 15.22 `PBF-11-R3` — Handoff A Accepted Control revision-set digest continuity

Status: `CLOSED / BOUNDED DETAIL FIX APPLIED` — 2026-07-19

P8-06在实现Handoff A Accepted canonical transaction前，沿`AcceptedIntakePayload@1`、
`ResponsibilityControlCommitHandle`、Material Control participant、`SubjectAndTransferReceipt@1`与Owner-row replay
反证`controlRevisionSetDigest`。主审确认反馈成立：现有合同只保存aggregate digest，没有唯一规定成员字段、scope、
expected/committed revision与projection digest、排序或historical reconstruction；实现自行选择公式会使同一Receipt
在不同实现或重启后无法互认。

Bounded correction没有改变Handoff A业务语义：

- 固定Control set为与Payload精确相等的`1..1024`个唯一materialKey，按UTF-8 bytes排序；每项完整包含
  expected/committed revision及projection digest，以及Procurement Material Field → Libra Subject的from/to scope；
- 固定`libra.handoff-a-transferred-control-set@1` JCS/SHA-256公式，并把`intakeDecisionId`、`subjectId`与
  `controlScopeDigest`纳入basis；committed revision严格等于expected revision加1；
- 固定Commit Handle为Handoff A transfer，逐字节绑定Accepted Payload、Binding set、Control scope、expected revision
  set及Receipt contract；Control revision的`basis_digest/commit_marker/from/to`必须与其一致；
- 明确每个historical Control revision的post-state Projection由append-only revision row确定性重建；current Control后来
  转给Arca或released时不得污染旧Receipt。Receipt Owner row通过同一Handoff commit marker的transfer revisions和各自
  previous revisions重算set digest，不依赖Foundation Event Result JSON或调用方缓存；
- Handoff A物理事务表仍是10张Libra加5张Foundation，其中5张可按职责拆读为2张Material Control与3张
  result/marker/outbox表；总计15张不变。

全文反向审计覆盖Payload/Handle/Receipt、current与historical Control projection、Owner row replay、commit marker、
crash fixture、canonical participant及计数。没有新增Domain、Owner、Store、Business Object、Handoff、Capability、
Result family、关系表或兼容路径；inventory保持`112 Capability / 97 Catalog Result family / 169 tables`。
审计结果为`PASS / PBF-11-R3 CLOSED / NO OPEN BUSINESS DECISION`。

### 15.23 `PBF-12` — Libra Routing、Decision Basis与Acceptance Spec continuity

Status: `CLOSED / BOUNDED DETAIL FIX APPLIED` — 2026-07-19

P8-08在Handoff A Accepted实现通过后，对Subject接管后的Routing与Acceptance Spec前半链做实现可实现性反证。
主审沿Level 5已确认的first-match Routing、Decision Preparation、Shelf Standard Projection、六类产品要求和
Level 8 Owner/Store/Transaction逐段核对，确认实现返回的五项缺口成立，第六项是必须保持的边界：

1. Routing只有概念形状与关系表，没有formal Policy/Subject/Arca Projection/Decision Fact输入、Readiness、
   Assessment Evidence、Decision DTO及closed unresolved reason；
2. 35项Canonical Transaction没有Routing Decision、Decision Basis与Acceptance Spec三项Owner commit，head CAS、
   typed Result/marker和crash replay无法唯一生成；
3. `DecisionInputSet@1`无法无损映射`queryResultSetDigest/routingInputDigest/specInputDigest`及relation rows；
4. Acceptance Spec没有六类Requirement的closed typed值、Product Scope、semantic/record digest、ID/revision与publication
   transaction；
5. 物化Schema误把Season结构语义写成`contentProfile=season`，与Canonical
   `movie|series|jav|western_adult`冲突；
6. Libra不能为补输入跨Store读取Arca，也不能让Candidate提前携带Shelf或在本切片创建Run/Workspace。

纵向审计同时证明两个同根缺口：Handoff A虽有Candidate Snapshot，但Libra Intake rows未保存后续Routing所需的
Field/content profile provenance，Subject也未固化content profile；Series Acceptance Spec在Run创建前缺少确定
Product Scope。它们均可扩充既有行与typed DTO闭合，无须新表或新组件。

Bounded correction保持已Accepted业务结构：

- 在既有Handoff A payload/Intake Decision中保存完整Field/profile/Identity Claim provenance，Subject固定
  `structureKind + contentProfile`；extension要求逐字节相同，Routing不得回读Procurement；
- Arca通过既有`ArcaShelfFacade`发布versioned `ShelfRoutingTargetProjection@1`与
  `ShelfStandardProjection@1`，并为Shelf current status/Standard维护routing projection revision/digest；Libra只冻结
  typed Query snapshot，事务不读取`arca_*`；
- 固定`RoutingMatchExpression@1`安全AST、Field Routing Policy Snapshot、Subject/Decision Fact Snapshot、
  Routing Readiness、Assessment Evidence、resolved/unresolved Decision及全部ID/digest/排序/closed reason；
- 把一次性选Shelf保持为独立`ManualShelfSelectionIntent@1`而非长期Rule Fact；其Command Receipt随routing
  Decision Basis原子保存，Routing Decision只验证并引用，避免Policy与用户Intent互相污染；
- 把`DecisionInputSet@1`分为`routing|acceptance_spec`两个closed variant，关系化保存所有typed input snapshot，唯一
  计算query/routing/spec/input-set digest；`DecisionBasisRevision@1`补齐ID/revision/readiness/basis digest；
- 固定`ShelfStandard@1`的Profile Rule Set和六类closed Requirement，增加`ProductScopeSnapshot@1`；
  `AcceptanceSpec@1`唯一使用`contentProfile=series + structureKind=season`，并区分产品要求的semantic
  `specDigest`与包含Policy/Query provenance的`recordDigest`，避免revision变化误触发生产目标变化；
- `libra_subject_decision_heads`增加revision/digest CAS；新增三项既有Owner canonical transaction正式物化，均
  `hasOutbox=false`且使用typed application result/marker。首次Basis才建立head；Spec publication不创建Run，Run Creator
  在创建前重新Query Arca current Projection并验证freshness；
- Canonical Transaction由35增至38；112项Capability、97个Catalog Result family、169张关系表、五Domain、两Handoff、
  Owner/Store和既有物理组件全部不变。

反向审计覆盖Level 3/5语义、Handoff A provenance、Arca public Query、Libra table reconstruction、三项事务
read/write set、cross-domain freshness、Series Product Scope、Spec semantic equality、machine content profile、crash fixture、
一次性Routing Intent与长期Rule vocabulary分离、Rating/No-rating分支的确定选择、计数和Run/Workspace负边界。
没有新的用户业务分叉。审计结果为
`PASS / PBF-12 CLOSED / NO OPEN BUSINESS DECISION`。

### 15.24 `PBF-12-R1` — Decision Basis pre-CAS Head snapshot continuity

Status: `CLOSED / BOUNDED DETAIL FIX APPLIED` — 2026-07-19

P8-08在实现Decision Basis Commit并反证Routing Decision重启恢复时指出：`DecisionInputSet@1`把完整
`expectedDecisionHead`纳入`inputSetDigest`，但既有Basis row只保存expected revision，input relation的closed kind
又没有Head Snapshot；current Head在Basis、Routing Decision和Spec提交时持续原地CAS，因此历史前置pointer/digest
会消失。实现若读取current row、Foundation Result或caller缓存补值，均无法重建原Input Set并违反Owner合同。

主审从formal DTO、Basis relation、Head状态机和三项canonical transaction反向核对，确认缺口成立且不涉及业务分叉。
采用最小关系化闭合：

- 新增formal `SubjectDecisionHeadSnapshot@1`，明确`absent/revision 0`与`present/positive revision`两个variant、
  三个pointer、head digest及snapshot digest唯一公式；
- `DecisionInputSet.expectedDecisionHead`直接使用该Snapshot；每份Basis必须在既有
  `libra_decision_basis_inputs`以唯一`decision_head_snapshot` row保存，固定ordinal、typed JSON和digest映射；
- `libra_decision_basis_revisions`增加`expected_head_snapshot_digest`，与relation row及
  `DecisionBasisRevision@1`逐字节绑定；basis digest同时覆盖expected revision/snapshot digest；
- 新Basis提交验证pre-CAS Snapshot后推进Head；semantic replay从immutable Basis/relation rows重建历史Input Set，
  不要求current Head回退。Routing Decision与Spec提交先重建Basis，再验证current Head恰为该Basis产生的确定post-state；
- restart/crash fixture增加首次无Head、后续多次Head CAS和历史Basis重放反例。

全文反向审计确认：没有新增Domain、Owner、Store、Handoff、Capability、Result family、Canonical Transaction或关系表；
计数保持`112 Capability / 97 Catalog Result family / 38 Canonical Transaction / 169 tables`。实现线程自行修正
`expected_head_revision>=0`的DDL传播与本合同一致，不需要第二份SSOT规则。审计结果为
`PASS / PBF-12-R1 CLOSED / NO OPEN BUSINESS DECISION`。

### 15.25 `PBF-13` — Libra Run、Workspace、Product Package与Reclamation continuity

Status: `CLOSED / BOUNDED DETAIL FIX APPLIED` — 2026-07-20

P9-01在P8 Routing/Spec closure后，对Libra Run creation、Production Workspace、Deliverable Promotion、Run
Discard和Workspace Reclamation做实现可实现性反证。主审从Level 3/6 Accepted业务语义向8.5 Owner rows、8.6
formal DTO、Canonical Transaction及crash recovery逆向核对，确认六组反馈全部成立且共享同一根因：Level 6已经定义
Run的业务状态和责任边界，但Level 8只留下digest/current row摘要，没有一条可独立恢复“Run基于什么材料、怎样建立
Workspace、交付了什么、为何可以Discard/回收”的Libra Owner history。具体表现为：

1. Run Creator没有formal Decision/Result、Subject级admission CAS、state revision或replacement原子事务；
2. Run的Production Material/Episode scope只有aggregate digest，N:M Episode与完整Binding/Control snapshot无法恢复；
3. Workspace没有stable aggregate head/revision，Working→Product Staging关系无法证明或安全重放；
4. On-deck Product Package formal DTO、relation rows和Promotion write set不足以恢复完整Product Fact/Artifact/Media
   Cast/Physical Reality/Off-load Context/Attestation；
5. Discard与Cleanup current rows缺expected revision、typed deletion Evidence和合法nullable状态，不能形成安全CAS；
6. Off-load Completion虽是Arca durable Fact，却没有typed read、grace/reference audit到Cleanup Scope Admission的原子连续性。

Bounded correction严格复用既有Domain、Owner、Business Object与Handoff：

- 增加Subject级`libra_run_admission_heads`、append-only `libra_run_revisions`与formal
  `LibraRunExecutionBasis/AdmissionDecision/LifecycleDecision`，统一证明single唯一资格、Season Episode不重叠、Spec
  或初始Execution Basis变化时的replacement和frozen不可自动替代；Run-local Priority与immutable Execution Basis
  分离，单纯加急不触发replacement，合法replacement仍继承当前Priority；Lifecycle complete variant消费typed `ArcaProductAcceptedMessage`，在Libra事务
  同时保存Delivery Receipt、Inbox、Run completed revision与active-scope移除，避免Arca跨域写Run；
- 把旧Episode-only摘要表收敛为通用`libra_run_material_manifests/members`，并新增N:M Episode claim relation，
  完整冻结Physical Identity、Location、Binding、Control和output Requirement；
- 增加Workspace revision history，把Platform Root/space admission、完整Workspace Physical Identity与Material Reference
  固定为append-only
  `working→product_staging→released`状态流；Reference保留完整bounded Episode claims，Product Promotion不能只凭摘要
  或caller补Episode；Capability只产生Workspace handle/effect，不能暗写业务relation；
- 扩充Product Package/Material/Off-load rows并增加Package Fact/Artifact relation，使完整
  `OnDeckProductPackage@1`只从Libra Owner rows历史重建；Product Fact Manifest在Handoff DTO中展开immutable typed
  fact value，使Arca不必回读Libra/Provider补Identity或Metadata；direct-original Control assert与new Workspace Product
  acquire使用显式discriminator，不按handle种类猜测；完整Package不进入64 KiB Foundation Event Result，Catalog
  commit output改为bounded `OnDeckProductPackageCommitReceipt@1`并占用原Result slot，完整Deliverable只经Port读取；
  Handoff B Accepted用同一SQLite内的read-only Libra delivery fence消除Run supersede/Acceptance竞态，不写Libra Store；
- 补齐Run Discard、Cleanup Scope Admission、Cleanup Commit的typed Decision/Evidence/Receipt、closed CAS、nullable
  状态和exact Control release；superseded Run、Arca Off-load Completion与discard使用互斥资格进入同一Reclaimer，
  completed/blocked outcome均有typed Evidence；Cleanup成员显式区分uncontrolled、Libra-owned与other-owned，后者
  只能验证already absent而不能主动删除，避免把Arca Control误当“无Control”；Signal仍只wake；
- 新增Run Admission、Run Lifecycle Transition、Workspace Admission、Workspace Material Reference Commit、Workspace
  Cleanup Scope Admission五项Canonical Transaction，精确化既有Deliverable Promotion、Run Discard和Workspace
  Cleanup的participants/read/write/outbox/crash合同；
- 新增七张Libra-owned关系表：Run admission head、Run revision、Run Material Episode claim、Workspace revision、
  Package Material Episode claim、Package Fact ref、Package Artifact ref。旧两张Episode Manifest表被clean
  rename/generalize，不构成新增计数。

全文一致性审计覆盖Level 3/6业务状态、Run/Subject/Spec owner boundary、Series overlap、Priority延续、Workspace
containment、Package Handoff B完整快照、Material Control、Discard不可逆授权、Off-load Completion/grace、semantic
replay、crash matrix、row nullability及machine write set。没有新增Domain、Owner、Store、Business Object、Handoff、
Catalog Capability、Catalog Result family或用户业务分叉；Capability保持112、Result family保持97，Libra tables由37
增至44、总表由169增至176，Canonical Transaction由38增至43。新增的Product Material↔Episode relation保存
完整N:M交付成员，避免只存摘要而无法恢复Package。审计结果为
`PASS / PBF-13 CLOSED / NO OPEN BUSINESS DECISION`。

### 15.26 `PBF-13-R1` — Workspace Reclamation Port callable contract

Status: `CLOSED / BOUNDED DETAIL FIX APPLIED` — 2026-07-20

P9-01在纳入`PBF-13`后继续按Public Port反向实现，证明`WorkspaceReclamationPort`仍只有职责句，没有formal
method、Query/Command/Result、freshness outcome或Owner-row reconstruction。该反馈成立：Cleanup Scope与Run Discard
底层事务虽然已经闭合，但实现无法仅凭“暴露current/history Query与Discard receipt”唯一决定读取粒度、历史revision、
stale/integrity语义或幂等命令返回值；继续实现只能自行发明Facade合同。

Bounded correction没有删除该Port，也没有扩张业务边界，而是固定两个callable method：

- `readCleanupScope(WorkspaceCleanupScopeQuery@1) -> WorkspaceCleanupScopeReadResult@1`以
  `cleanupScopeId + current|exact revision`为唯一查询identity，current可携带expected state revision/digest；Result
  使用`found|not_found|stale|integrity_error` closed union，只返回Scope与Member聚合计数/digest，不展开Material、
  Handle、Control owner或路径；
- `discardFrozenRun(LibraRunDiscardCommand@1) -> LibraRunDiscardCommandResult@1`只接收Run、expected frozen
  revision/digest及actor/idempotency。Coordinator从Libra Owner rows重建完整既有`LibraRunDiscardDecision@1`并进入
  原Run Discard transaction；成功及semantic replay都返回同一durable Receipt，不引入“立即删除”或第二套Discard；
- 历史Scope revision由Admission row、immutable member set和唯一`committed_scope_state_revision`顺序恢复；Discard
  Result由Decision/Receipt、Run revision、Input Control history及可选Cleanup Scope/member rows恢复。任何缺号、digest
  或Receipt连续性破坏只返回typed integrity outcome，不允许Foundation Result、caller cache、目录Reality或跨Store补值；
- Query/Command、Projection和Result的stable ID/digest公式、closed reason code与nullable Scope语义全部固定。

全文一致性审计覆盖8.2.2 public boundary、8.5.11 Owner rows、8.6.21 application DTO、Run Discard canonical transaction、
Workspace Cleanup revision history、Level 9无副作用Query和用户不可直接触发物理删除的Authorization语义。修正不新增
Domain、Owner、Store、Business Object、Handoff、Capability、Catalog Result family、关系表或Canonical Transaction；
计数保持`112 Capability / 97 Catalog Result family / 176 tables / 43 Canonical Transactions`。审计结果为
`PASS / PBF-13-R1 CLOSED / NO OPEN BUSINESS DECISION`。

### 15.27 `PBF-13-R2` — Run initial-zero、Package head与Material requirement binding

Status: `CLOSED / BOUNDED DETAIL FIX APPLIED` — 2026-07-20

P9-02对`PBF-13` Run Admission机器合同反向物化时证明两组独立但同属Run/Promotion连续性的缺口成立：

1. initial Admission formal Decision明确使用absent Run admission head revision 0，实际head row允许不存在，但
   `libra_run_revisions.expected_admission_head_revision`没有明确non-negative机器约束；生成`CHECK >=1`会使首条
   Run revision无法保存真实pre-CAS snapshot；
2. `libra_runs.package_revision_head`语义明确为Run建立时0、每次Promotion CAS+1，但逐表合同没有固定SQLite
   INTEGER类型，机器物化可能把head误推断为TEXT；
3. Run/Product `ProductionMaterialManifest@1`都要求每个member携带`outputRequirementDigest`，但该值没有typed
   Acceptance Spec来源、role/Episode application scope映射或唯一公式，Run Creator只能接受caller opaque值或自行
   选择六类Requirement子集，破坏Execution Basis与历史恢复。

Bounded correction固定：

- `libra_run_revisions.expected_admission_head_revision`为non-negative INTEGER，只有initial Admission首条revision
  允许0；`committed_admission_head_revision`及实际`libra_run_admission_heads.head_revision`仍是从1开始的正整数，
  不建立revision 0 sentinel row；
- `libra_runs.package_revision_head`为`INTEGER NOT NULL DEFAULT 0 CHECK >=0`；Promotion的
  `expectedPackageRevisionHead`也是non-negative integer，首个Package expected 0并提交revision 1；
- 新增formal application data contract `ProductionMaterialOutputRequirement@1`作为既有Manifest字段的唯一来源。
  它绑定完整immutable Acceptance Spec六类Requirement、manifest/material role、materialKey和closed application
  scope：primary按single product scope或本member Episode subset建立关联，structural dependency只声明生产辅助，
  其他Product role关联完整Product scope；所有分支仍绑定完整Requirement set，但不声称单个Material独立满足整份
  Spec，也不形成member-local Policy；
- Run与Product历史都只从对应immutable Acceptance Spec及各自Manifest/member/Episode Owner rows重算同一digest，
  不读取current Spec、caller cache、Foundation Result或跨Domain Store。

反向审计覆盖initial/replacement/Lifecycle Run revision、admission head absent/present、首个/后续Package Promotion、
Run Input与Product Delivery两类Manifest、single/season Episode scope及Owner-row replay。其余initial-zero字段无需改动：
实际Run admission revision、state revision、committed head和Package revision均从1开始。修正不新增Domain、Owner、
Store、Handoff、Capability、Catalog Result family、关系表或Canonical Transaction；计数保持
`112 Capability / 97 Catalog Result family / 176 tables / 43 Canonical Transactions`。审计结果为
`PASS / PBF-13-R2 CLOSED / NO OPEN BUSINESS DECISION`。

### 15.28 `PBF-13-R3` — Run Input Physical Identity与size跨Handoff连续性

Status: `CLOSED / BOUNDED DETAIL FIX APPLIED` — 2026-07-20

P9-02继续对Run Admission反向实现时指出：Field Material current row虽然拥有完整Physical Identity和size，
但`SelectedFieldMaterialSet@1`及`proc_run_materials`只冻结materialKey和摘要；Candidate Primary relation、
`CandidatePrimaryMaterialDelivery@1`与`LibraBindingDraft@1`也没有这五项。materialKey/digest不可逆，导致Handoff A
无法合法写满`libra_material_bindings`，后续Run Creator也无法从Libra Owner rows建立
`ProductionMaterialManifest@1`。若由caller补值或回读current Field/Provider/Foundation Result，会突破既有Owner、
Handoff和immutable history合同。

主审沿Field Observation→Procurement Run→Candidate Publication→Candidate Delivery→Handoff A→Libra Binding→Run
Manifest逐段反证，确认缺口成立且不涉及用户业务分叉。Bounded correction固定：

- `SelectedFieldMaterialSet@1`成员增加完整`PhysicalMaterialIdentity@1`与`sizeBytes`；Run Admission必须同事务从
  current Field Material重读、验证materialKey公式并写入immutable `proc_run_materials`，纳入member/Basis digest；
- final `PrimaryInputManifest@1`与`proc_candidate_primary_materials`逐项复制同一Run member的Identity/size，
  Candidate Publication把它们纳入Manifest、Candidate relation及Delivery digest；
- `CandidatePrimaryMaterialDelivery@1`正式输出Identity/size；`CandidateDeliverySnapshot@1`必须交叉校验immutable
  Candidate relation与Run Basis，Candidate/Run/Offer关闭后仍可重建同一Snapshot；
- `LibraBindingDraft@1`逐项复制Delivery的Identity/size/endpoint/location，Handoff A将其写入既有
  `libra_material_bindings`；Run Admission只从该immutable Binding revision重建Run Input Manifest；
- 任一层缺失或不一致返回integrity failure，不允许materialKey反解、current Field/Provider补读、Foundation Result
  fallback或caller cache。

全文反向审计覆盖Run Basis digest、Candidate Manifest/package/delivery digest、Handoff A exact input、Libra Binding
历史恢复、Run Input Manifest materialKey验证、Candidate/Run关闭后的historical read以及Candidate Publication/Handoff A/
Run Admission三项事务。修正只扩充既有typed DTO与`proc_run_materials`、`proc_candidate_primary_materials`、
`libra_material_bindings`列语义，不新增Domain、Owner、Store、Handoff、Capability、Result family、关系表或Canonical
Transaction；计数保持`112 Capability / 97 Catalog Result family / 176 tables / 43 Canonical Transactions`。审计结果为
`PASS / PBF-13-R3 CLOSED / NO OPEN BUSINESS DECISION`。

### 15.29 `PBF-13-R4` — Run Freshness与suspended bounded recovery

Status: `CLOSED / BOUNDED DETAIL FIX APPLIED` — 2026-07-20

P9-03反向实现证明原SSOT只描述了`active→suspended→resume|frozen`的业务结果，却没有给出可执行的freshness
输入、原始/当前Basis比较、恢复预算、attempt持久化和重启连续性。通用Evidence ref不足以证明“为什么暂停、为什么恢复、
为什么第五次后冻结”；按revision数量或墙钟时间猜测又会让frozen边界随实现变化。set_priority也缺唯一typed授权输入。

Bounded correction没有增加状态或组件，而是固定：

- `LibraRunComparableBasisSnapshot@1`从旧Run immutable Basis/Manifest与current Spec/Binding/Episode/Control分别重建，
  只比较Acceptance Spec、Product Scope、Material Binding、Material Control和Output Requirement五个会改变订单的维度；
- `LibraRunRecoveryPolicySnapshot@1`作为随binary版本化的Beta工程合同，固定五个due offset和最多五次assessment；
  `LibraRunFreshnessAssessment@1`给出ready|unresolved、same|changed|unresolved、closed reason、完整Owner evidence与唯一digest；
- 首次unresolved进入suspended attempt 0；due point 1..4仍unresolved只更新suspended revision；第5次仍unresolved
  进入frozen且永不自动恢复。重启只读持久化Policy/start/attempt/next due，不从revision数量或caller cache恢复；
- active ready/same只追加freshness-confirmed revision；ready/changed只作为replacement Admission的旧Run Evidence；
  production手段确定耗尽的active→frozen继续使用独立typed terminal Evidence，不与freshness unresolved混淆；
- `LibraRunPriorityIntent@1`成为set_priority唯一Authorization Evidence；complete继续消费既有
  `ArcaProductAcceptedMessage@1`、Delivery Receipt和Inbox，无需新增Handoff合同；四种Evidence的ID/digest映射唯一。

全文反向审计覆盖active/suspended/frozen状态机、replacement Admission、Priority、Handoff B complete、Run aggregate/
revision历史恢复、attempt 4/5、跨due重启和crash fixture。修正不新增Domain、Owner、Store、Handoff、Capability、
Catalog Result family、关系表或Canonical Transaction；计数保持
`112 Capability / 97 Catalog Result family / 176 tables / 43 Canonical Transactions`。审计结果为
`PASS / PBF-13-R4 CLOSED / NO OPEN BUSINESS DECISION`。

### 15.30 `PBF-13-R5` — Platform Workspace Root与space admission typed边界

Status: `CLOSED / BOUNDED DETAIL FIX APPLIED` — 2026-07-20

P9-04证明Workspace Admission要求的`PlatformWorkspaceRootSnapshot@1`与既有P5 runtime port不连续：旧输出暴露
resolved path，却缺endpoint、mount scope revision、state、opaque handle与snapshot digest；space admission又只有
opaque Evidence ref，没有authority、bytes、freshness或workspace/run/root绑定。Libra因此既无法验证Admission，也无法在
重启后从Owner rows重建当时使用的Platform事实。

Bounded correction把既有P5 runtime port正式重签为`PlatformWorkspaceRuntimePort@1`：

- `resolveWorkspaceRoot`只返回closed found/not-found/stale/inactive/integrity result与不含路径的完整Root Snapshot；
  `resolved_root`仍由Platform Owner保存，只允许Platform内部用于containment与statvfs；
- `assessWorkspaceSpace`接收绑定workspace、Run Basis、Root Snapshot和input bytes的typed Request；Beta按既有
  120%+5GiB fallback形成需求，返回30秒有效的typed Evidence及admitted/insufficient/root-unavailable/range outcome；
- Workspace Admission只接受current active Root tuple和未过期admitted Evidence，逐项验证workspace/run/root/request/
  bytes，随后把完整Snapshot和Evidence复制进既有Libra Workspace row；历史恢复不依赖后来Platform current row或路径；
- Canonical transaction只增加既有`platform_workspace_roots`只读participant，Domain write set、表数和事务数不变。

全文审计覆盖Platform Owner边界、P5 port语义、Workspace Admission input/row/replay、resolved-path禁止传播、空间不足与
过期Evidence、Workspace后续写入重新校验以及crash fixture。修正不新增Domain、Owner、Store、Handoff、Capability、
Catalog Result family、关系表或Canonical Transaction；计数保持
`112 Capability / 97 Catalog Result family / 176 tables / 43 Canonical Transactions`。审计结果为
`PASS / PBF-13-R5 CLOSED / NO OPEN BUSINESS DECISION`。

### 15.31 `PBF-13-R4-R1` — Run Lifecycle canonical read-set与TOCTOU闭合

Status: `CLOSED / BOUNDED PROPAGATION FIX APPLIED` — 2026-07-20

P9-03-R1证明`PBF-13-R4`的业务正文与Owner-row重建规则已经正确，但Canonical Transaction机器清单仍保留旧的
窄`readTables`。如果实现只接受事务外构造的Freshness Assessment，Decision Basis、Binding或Control可在Assessment
与Run CAS之间变化；如果只信caller Evidence，又违反Owner-row与integrity fault合同。该反馈成立，是同一修正没有
完整传播到machine transaction manifest，而非新业务缺口。

Bounded correction固定Lifecycle transaction的variant-superset read whitelist：

- freshness/recovery必须在同一SQLite事务读取Subject Decision Head、Decision Basis及input relation、Acceptance Spec、
  immutable Run Manifest/member/Episode、current Binding/Episode与historical/current Material Control，并重建两个
  Comparable Basis；
- 非complete且已有published Package时，额外从Package、Package Material、Material↔Episode与Off-load Context
  relation重建完整Product/Off-load Control member set并重验Control仍归Libra；无Package时这些relation合法为空；
- Product Fact/Artifact不参与custody fence，明确不扩读；direct terminal freeze才使用Work/Plan/Event/Attempt，complete
  才消费Arca accepted message；
- Assessment构造、Owner-row验证、Run/head CAS和revision/Result/marker提交必须处于同一事务。caller typed Evidence只做
  逐字节交叉验证，不能替代Owner事实或把缺失事实伪装成unresolved。

修正只扩充既有Canonical Transaction的只读白名单；writeTables、participant owner、Domain、Handoff、Capability、
Result family、关系表和事务数全部不变，仍为
`112 Capability / 97 Catalog Result family / 176 tables / 43 Canonical Transactions`。审计结果为
`PASS / PBF-13-R4-R1 CLOSED / NO OPEN BUSINESS DECISION`。

### 15.32 `PBF-13-R4-R2` — Arca Accepted Message ID canonical object

Status: `CLOSED / BOUNDED FORMULA FIX APPLIED` — 2026-07-20

P9-03-R2证明`ArcaProductAcceptedMessage@1`的ID公式把`handoffReceipt.receiptDigest`写在JCS对象成员位置，
但没有声明它是顶层property、嵌套对象还是含点号的property name；三种合法JSON shape会得到不同digest，使Arca
producer与Libra consumer无法互认同一messageId。该反馈成立。

修正把canonical object唯一固定为
`{schema,offerId,acceptanceDecisionId,receiptDigest:handoffReceipt.receiptDigest}`，恰含四个顶层property；不嵌套
`handoffReceipt`，不使用点号property name，也不扩大ID对完整Message的覆盖。Message本身字段、Receipt、Owner、
Handoff、Store、Transaction与dedup语义均不变。反向检查producer/consumer与Lifecycle complete Evidence后无其他冲突。

同轮addendum继续证明`LibraRunTerminalDeliveryEvidence@1`虽已要求逐项验证，却未固定`evidenceId`与
`blockerSetDigest`。补充修正固定member的完整typed JCS公式、`workId+terminalEventId`唯一键及两级UTF-8排序；
blocker set覆盖Run/Basis/blocker kind与排序后的完整members，Evidence ID覆盖Run/Basis/kind/set/assessedAt。
相同ID必须对应逐字节相同Evidence，重放不得刷新时间或依赖caller数组顺序。该补充同样不改变字段或业务语义。

修正不新增Domain、Owner、Handoff、Capability、Result family、关系表或Canonical Transaction；计数保持
`112 Capability / 97 Catalog Result family / 176 tables / 43 Canonical Transactions`。审计结果为
`PASS / PBF-13-R4-R2 CLOSED / NO OPEN BUSINESS DECISION`。

### 15.33 `PBF-13-R5-R1` — Workspace aggregate/revision首次建立循环FK

Status: `CLOSED / BOUNDED SQLITE REALIZABILITY FIX APPLIED` — 2026-07-20

P9-04 SQLite fixture证明`libra_workspaces.current_revision`与`libra_workspace_revisions.workspace_id`形成双向
immediate FK：先插任一row都会立即失败，违反Workspace Admission同事务首次建立aggregate与revision 1的合同。
该反馈成立，不是插入顺序可以规避的问题。

最小修正只把aggregate的`(workspace_id,current_revision) → libra_workspace_revisions`复合FK固定为
`DEFERRABLE INITIALLY DEFERRED`；revision→aggregate的普通父FK保持immediate。Admission固定先插
`libra_workspaces(current_revision=1)`、再插revision 1，transaction commit统一验证复合current head、state与digest。
任一步失败时aggregate、revision、Foundation Workspace Registry、Result和marker全部回滚。禁止关闭FK、sentinel
revision、nullable后补或事务外预写。

反向检查Workspace Reference、Cleanup revision和crash fixture后无需其他结构变化。修正不改变Owner、Store、Handoff、
Capability、Result family、表或Canonical Transaction计数，仍为
`112 Capability / 97 Catalog Result family / 176 tables / 43 Canonical Transactions`。审计结果为
`PASS / PBF-13-R5-R1 CLOSED / NO OPEN BUSINESS DECISION`。

### 15.34 `PBF-13-R5-R2` — Workspace space Evidence的Run Manifest read-set

Status: `CLOSED / BOUNDED PROPAGATION FIX APPLIED` — 2026-07-20

P9-04 addendum证明Workspace Admission虽要求从immutable Run Primary members求和`inputPrimaryTotalBytes`，但机器
read set只有Run aggregate/revision；Execution Basis record明确排除了大型Manifest members，无法重建size或验证
request/required bytes。信任caller或事务外求和都会破坏Owner验证及TOCTOU合同。该反馈成立。

修正把`libra_run_material_manifests`与`libra_run_material_members`加入既有Workspace Admission exact read set；
事务内通过Run manifest ref验证identity、member count与member set，仅对完整`role=primary_payload`成员的`sizeBytes`
求和，随后重算固定空间公式、request digest并交叉验证Platform Evidence。Episode Claim不影响字节，明确不读取
`libra_run_material_episode_claims`；也不允许改读Binding、Workspace或current Reality。

该修正只扩充既有transaction只读白名单，不改变writeTables、Owner、Store、Handoff、Capability、Result family、
表或Canonical Transaction计数，仍为`112 / 97 / 176 / 43`。审计结果为
`PASS / PBF-13-R5-R2 CLOSED / NO OPEN BUSINESS DECISION`。

### 15.35 `PBF-13-R5-R3` — Workspace Material Handle与Product Verification连续性

Status: `CLOSED / BOUNDED INPUT-PERSISTENCE FIX APPLIED` — 2026-07-20

Workspace Material Reference Commit反向实现证明四项缺口成立：Foundation material row不能重建完整
`WorkspaceMaterialHandle@1`；promotion只携带opaque verification pair；Libra reference history不能恢复完整验证输入；
Decision ID又把property access写成含糊JCS成员。继续实现将被迫信任caller或旁读Foundation Result。

Bounded correction保持既有结构：

- `fx_workspace_materials`增加完整Handle schema/JSON/digest/fence及缺失热字段；Workspace write effect在bytes关闭、
  stat/hash/containment完成后，把Handle与Effect receipt同事务登记，之后才返回Handle；
- `WorkspaceMaterialHandle@1`固定Handle ID、fence digest与只读access scope公式；Reference Commit从Foundation Owner row
  重建并逐字段验证，不能从current Registry或caller重造；
- 复用既有`libra.product_media.verify@1 → ProductMediaVerification`，补齐Run/Event/Material Handle/fence绑定；新增的
  `WorkspaceProductVerificationSnapshot@1`只是Application input snapshot，不是Catalog Result family；
- Decision携带完整passed Verification，Libra reference revision保存schema/JSON/digest；working四列全NULL，staging
  全非NULL，released逐字节沿用。文件清理后仍能从Libra Owner rows恢复历史Decision/Result；
- Reference decision ID固定为7个显式顶层property，不使用嵌套推断或点号property name。

反向审计覆盖Workspace write effect、Foundation material lifecycle、Reference attach/promote/release、Deliverable
Promotion与Cleanup replay。修正只扩充既有两张表的列和既有Capability Result字段，不新增Owner、Store、Handoff、
Capability、Result family、表或Canonical Transaction，计数保持`112 / 97 / 176 / 43`。审计结果为
`PASS / PBF-13-R5-R3 CLOSED / NO OPEN BUSINESS DECISION`。

### 15.36 `PBF-14` — Product Metadata / Media-Cast Fact commit闭包

Status: `CLOSED / BOUNDED INPUT-PERSISTENCE FIX APPLIED` — 2026-07-20

P9-05反向实现审计证明四项缺口成立：两个`domain_fact_commit`没有可选择的no-Outbox精确variant；Product Fact
缺稳定ID/revision/Handle/marker与Evidence映射；Planner所谓“当前Metadata Observation集合”没有正式选择及历史
连续性；正文完整DTO与机器物化存在缩水漂移。继续实现会迫使Coordinator伪造Outbox、信任caller revision，或把
Foundation Result作为未声明Store旁读。

Bounded correction保持既有Domain与组件结构：

- 在已计数的`domain-fact-commit@1`内注册`libra_media_cast_fact@1`与
  `libra_product_metadata_fact@1`两个exact variants，均`outboxRequired=false`；固定Libra/ Foundation read/write
  tables，禁止generic模板注入`fx_outbox`；
- 按`libraRunId+factKind`固定aggregate ID，以同kind immutable rows的最高revision执行logical 0 / CAS+1，固定
  Product Fact ID、Handle ID、commit key、payload/evidence/result digest和marker replay；不新增可变head；
- `MetadataFetchIntent`显式绑定Run Execution Basis与source priority；只从同Run/Basis的正式
  Work→Attempt→Plan→Event→typed Result链构造Set，相同Intent不同digest为integrity fault；
- 新增`libra_product_fact_observation_refs`，逐项FK引用被选中的durable Result。Fact Commit同时写Fact与refs，历史
  Fact只由这些refs重建原Set；Foundation Result由显式relation引用并受保留，不再是隐藏fallback；
- 补齐`MetadataObservation(Set/Selection)`、`VerifiedArtifactManifest`、Draft/Fact完整字段、排序、大小及JCS公式；
  两个Commit的完整named payload与Domain Fact Handle逐字节绑定，缩水DTO不能进入实现。

反向审计覆盖Observation重复/replacement、Run/identity fence、Fact revision并发、Artifact/Media-Cast引用、crash
marker replay、Deliverable Promotion与Product Fact Manifest。没有新增Business Domain、Owner、Store、Handoff、
Capability、Catalog Result family或顶层Canonical Transaction；新增1张Libra-owned关系表，计数更新为
`112 Capability / 97 Catalog Result family / 177 tables / 43 Canonical Transactions`。审计结果为
`PASS / PBF-14 CLOSED / NO OPEN BUSINESS DECISION`。
