# P7-07 Candidate Publication Design Return

Status: OPEN / RETURNED_TO_DESIGN

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

P7-07在这些合同闭合前不写Candidate Store，不引入兼容层、Store旁读或旧Runtime fallback。
