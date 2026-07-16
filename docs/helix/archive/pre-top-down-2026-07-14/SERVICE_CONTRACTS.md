# ShelfDeck Cross-domain Service Contracts

Status: direction accepted; field-level schemas remain Design work.

Last updated: 2026-07-13

本文只定义业务交付方向和禁止依赖。任何部门不得通过读取另一部门Store代替Service合同。

## 1. Contract map

```text
Procurement
  └─ ProcurementCandidate → Libra

Deck
  └─ AcceptancePolicy projection → Libra

User Perception
  └─ Perception projection → Libra

Libra
  ├─ KairoxRunTicket → Kairox
  ├─ NexoraSourceRunTicket → Nexora
  └─ OnDeckPackage / AcceptanceRequest → Deck

Kairox
  └─ KairoxRunResult / VerifiedMediaPackage → Libra

Nexora
  └─ SourceRunResult / SourceTransitionReceipt → Libra

Deck
  └─ AcceptanceResult accepted|rejected → Libra
```

Kairox与Nexora不得互调。Procurement、Kairox、Nexora不得调用Deck。Deck不得调用这些部门的
业务Service；独立验收只调用边界清晰的公司级或Deck Capability。

## 2. Procurement Candidate

Procurement在预检完成后交付最小Candidate：

```text
candidateId
procurementCaseId
candidateRevision
mediaType: single | group
identityCandidate
assetStructure
sourceBindingEvidence
displayProjection
```

Candidate不包含Metadata丰富事实、Acceptance Policy、User Perception、Gate、Objective、Flow或
预检内部推理。`admissible`只表示足以供Libra考虑开单，不表示必然收藏。

## 3. Acceptance Spec

Libra读取Deck Acceptance Policy、Procurement Candidate、Library Context和User Perception
Projection，生成不可变Acceptance Spec。Deck不替Libra计算Spec，Kairox也不读取形成Spec的
任何上游事实。

```text
AcceptanceSpec
  acceptanceSpecId
  ownershipTarget
  contentProfile
  requirements
  generatedFromPolicyRevision
  generatedFromInputRevisions
```

`acceptanceSpecId`只由规范化后的确定性产物要求生成；provenance、revision、priority、Source、
设备和执行信息不参与语义相等判断。

## 4. Libra Run and tickets

Libra Run只在Candidate、Ownership Target和Acceptance Spec均确定后创建。一个Run可拥有多张
顺序执行的Kairox/Nexora Ticket，但每个部门同一时间最多一张活动Ticket。

```text
LibraRun
  libraRunId
  ownershipTarget
  acceptanceSpecId
  state: running | blocked | succeeded | abandoned | superseded
  priorityClass: normal | expedited
  currentKairoxRunTicket
  currentNexoraSourceRunTicket
  onDeckPackageId
```

Attempt属于相应跨域委派，不属于Event或Task retry。新Attempt使用新的ID和输入快照；相同
快照不得机械重复签发。连续事实振荡或Attempt耗尽使Libra Run进入明确`blocked`或
`abandoned`，不能形成重试风暴。

## 5. Kairox Run Ticket

```text
KairoxRunTicket
  ticketId
  libraRunId
  kairoxRunId
  acceptanceSpec
  initialExternalFactsSnapshot
  sourceInputSnapshot
  subjectAssetSnapshot
  capabilityPolicy
  priorityProjection
  issuedAt
```

不得包含Deck Policy、User Perception、评分推导、Nexora phase或指定Flow/Event/Executor。

Kairox返回：

```text
KairoxRunResult
  kairoxRunId
  libraRunId
  state: completed | blocked | abandoned
  packageId?
  packageAttestation?
  invalidatedDependencies?
  failureEvidence?
```

`completed`只表示VerifiedMediaPackage已经在Libra Run Workspace中封装；不表示Source修改、
On-deck或Deck accepted。

## 6. Event fact dependencies

每个Event Intent声明自己的局部事实依赖和expected revision。Runtime只比较Kairox本地Ticket/
Fact Projection，不调用外部部门，也不校验整张Ticket的无关字段。

```text
expected == current → execute
expected != current → Event invalidated
```

`invalidated`不是Capability failure，不消耗Event retry或Task attempt。Kairox汇总后将Run标记为
`abandoned: INPUT_SNAPSHOT_INVALIDATED`并返回Libra。若Spec未变，Libra在同一Libra Run下重新
冻结生产资料并签发新Ticket；若Spec变化，则建立新Libra Run和新Workspace。

## 7. VerifiedMediaPackage

Package表达Kairox生产的逻辑产品及Evidence：

```text
packageId
libraRunId
kairoxRunId
acceptanceSpecId
mediaArtifacts[]
metadataArtifacts[]
logicalRoles
relativeLayoutRequirements
checksums
packageAttestation
```

Package不得携带任意绝对目标路径、删除命令或绕过Nexora安全规划的操作序列。它不获得
Canonical Source所有权。

## 8. Nexora Source Run

Libra根据Package签发Source Run Ticket：

```text
NexoraSourceRunTicket
  ticketId
  libraRunId
  sourceRunId
  attemptId
  packageId
  expectedSourceEvidence
  requestedTransition
  authorization
  priorityProjection
```

Nexora拥有自己的Source Operation Planner、Run、Attempt、fencing、commit marker、rollback和
Evidence。它不读取Acceptance Policy、Gate、Task、Flow、Event或Deck状态。

```text
SourceTransitionReceipt
  sourceRunId
  attemptId
  packageId
  oldSourceEvidence
  newSourceEvidence
  operationEvidence
  committedAt
```

Nexora完成的是安全Source修正，不是Libra的OnDeck Commit。结果不确定时先Inspect/Reconcile，
不得盲目重放危险操作。退出收藏销毁不使用该合同。

## 9. Libra delivery

Libra组装：

```text
Acceptance Spec
+ VerifiedMediaPackage
+ SourceTransitionReceipt
+ current Source evidence
+ Ownership Target
→ OnDeckPackage
```

组装只验证引用、revision、correlation和fencing，不能重新生产、重新探测或读取子部门Store。
`OnDeckPackage`与Deck Acceptance Request必须幂等。Signal负责正常秒级唤醒，周期Reconcile只
负责恢复。

## 10. Deck Acceptance

Deck建立独立Acceptance Attempt，按当前标准调用只读Capability检查实际交付物，不只检查单据，
也不复用Kairox Lifecycle。

```text
AcceptanceResult
  acceptanceAttemptId
  onDeckPackageId
  evaluatedPolicyRevision
  accepted: true | false
  deckId?
  rejectionReasons[]?
  observedEvidence
```

Deck rejected只返回Libra。Libra依据结构化Evidence判断：

- 产品不符合Spec：同一Libra Run下签发新Kairox Ticket；
- Source修正不合规：同一Libra Run下签发新Nexora Attempt；
- 当前Policy/Perception使Spec变化：旧Run superseded并创建新Libra Run；
- 不可恢复：blocked或abandoned。

只有Deck可以创建active `deckId`。

## 11. Priority and resource classes

Libra Run拥有全局Priority，并投影到子Ticket。各部门独立排序，Resource Governor只负责Permit：

```text
safety_control
deck_acceptance
libra_delivery
expedited_production
normal_production
background
```

Priority变化不得修改Acceptance Spec或Kairox初始事实快照，也不得抢占已执行的危险操作。

## 12. Post-deck contracts

- Deck Health从`deckId`出发Top-down验证Inventory；不得调用Procurement或Nexora业务Service。
- Aftercare接收Deck Case并交付Repair Result；不得复用Libra/Kairox业务Run。
- Off-deck Management独立拥有Policy、Destruction Run、Authorization、Evidence和deckId终结。
- User Perception只提供Projection和中性变化Signal；不会直接控制Libra、Kairox或Deck流程。
- People Management拥有Person Registry；媒体演员关系仍由相应媒体处理业务判断。
