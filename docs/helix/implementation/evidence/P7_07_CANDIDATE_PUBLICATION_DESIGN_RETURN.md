# P7-07 Candidate Publication Design Return

Status: CLOSED / IMPLEMENTED

## 已闭合前提

- `PBF-10-R1`已把`proc_candidate_primary_material_episode_claims`纳入Candidate Publication的7张
  Procurement表与精确10张`writeTables`。
- 实现侧机器合同生成器和反例已同步，完整事务白名单不再漏表。
- `CandidatePackage@1`生成Schema已按SSOT 8.6.19补齐Run、Rule、Field、Structure、Control、Related和完整
  continuity字段，并删除错误的Libra `subjectId`前置要求。

## 阻塞合同

1. `proc_candidate_deliveries.acceptance_basis_digest`是必填持久化事实，也进入Libra Intake Decision；但
   `CandidateDraft@1`、`DomainFactCommitHandle`、`CandidatePackage@1`和8.4.2调用均不携带该值，SSOT也没有唯一digest basis。
2. Candidate Publication必须同事务建立`offer_id`和Offer Outbox；当前没有稳定Offer ID来源、正式message kind、
   payload schema、dedup key及完整payload合同。
3. Candidate Unit/Package使用`exact_provider_season|persistent_triage_grouping`，而
   `proc_candidate_season_continuity_claims.claim_kind`只接受
   `provider_season_identity|triage_grouping_lineage`；SSOT没有定义可执行的一一映射或统一命名。

## 实施反证

- 令`acceptanceBasisDigest=packageDigest`会私自合并两个被表合同分别持久化并在Libra Intake中分别CAS的事实。
- 从`candidatePackageId`或Commit Marker私造`offerId`及Outbox schema会使重放、dedup和Facade输入不受SSOT约束。
- 静默转换continuity kind会改变跨Handoff A的业务对象连续性，不能作为普通字段适配处理。

P7-07在这些合同闭合前未写Candidate Store，也未引入兼容层、Store旁读或旧Runtime fallback。

## 架构闭合

- `PBF-10-R2`固定`CandidateIntakeAcceptanceBasis@1`的typed来源与唯一JCS/SHA-256公式，固定stable `offerId`、
  `ProcurementCandidateOfferAvailableMessage@1`、message ID、consumer set和dedup公式，并把continuity kind全链统一为
  `provider_season_identity|triage_grouping_lineage`。
- `PBF-10-R3`把承载`candidate_package_revision_head` CAS的`proc_procurement_runs`纳入Procurement participant和
  `writeTables`。最终事务为8张Procurement表与3张Foundation表的精确11表并集。
- 机器合同重物化保持112 Capability、96 Result Family、163表、30 canonical transaction；未新增Domain、Owner、Store、
  Handoff或Capability。

## 实现闭合

- pure publication contract builder从最终Package唯一派生Primary Manifest、Acceptance Basis、Offer ID、typed Offer message、
  dedup key和message ID，并拒绝非canonical continuity alias、乱序/重复成员及digest断裂。
- scoped Candidate Publication Store在同一SQLite Unit of Work中CAS Run revision head并写入Package、Season Claim、Primary、
  Episode Claim、Related、Delivery、Run Material Reservation、typed Result、Commit Marker与`fx_outbox`。
- Candidate专用Outbox participant只写canonical事务声明的`fx_outbox`，不越界写`fx_outbox_deliveries`；Libra仅作为正式
  consumer出现在typed payload，不发生跨域Store写入。
- typed Result Evidence必须精确对应Draft引用的Structure Evidence ID和payload digest；marker replay返回同一immutable事实。

## 机器证据

- 正常提交与业务幂等重放：Package/Manifest/Episode/Related/Reservation/Offer/Result/marker/Outbox全量闭合。
- Outbox注入崩溃：11张canonical write table、Run revision head及Run Material state全回滚。
- stale Run member fence、错误Structure Evidence、legacy continuity alias均在持久化前或事务内封闭拒绝。
- 完整Architecture gate保持112/96/163/30与aggregate baseline不变，semantic findings和prohibited actions均为空。

结论：原Design Return三项业务连续性缺口及后续Run head写集缺口均已由SSOT正式闭合，P7-07实现PASS，可进入P7-08。
