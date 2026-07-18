# P8-02 Libra Intake Store Evidence

Status: PASS

Date: 2026-07-19

## 1. Architecture basis

- Architecture Agent提交：`be3ecb89914b8fb008bae615dd7da07d9ddd17fe`（`PBF-11`）。
- 本分支原样纳入提交：`df7f86f2`；SSOT blob为`a2e31505d7012e882921cdf18ce99a7ec138ad2d`，
  与Architecture提交完全一致，实现线程没有修改SSOT。
- `PBF-11`正式闭合Candidate Delivery Snapshot、global/target continuity CAS、Resolved Identity exact Claim、
  Subject/Binding N:M Episode关系、new Subject nullable identity和Accepted Payload连续性。

## 2. Materialized contracts

- P2精确基线：112 Capability、96 Result Family、168 table、30 canonical transaction。
- Handoff A Accepted精确写集合：10张Libra表 + 5张Foundation表；Decision、global/target revision、match/overlap
  Evidence、Subject/Claim/Episode scope、每Material Binding及全部Episode relation、Control、Receipt/Result/marker/Outbox全有或全无。
- P2 aggregate：`c03cb78014a196e184be300de2a80657d8e01ced96f05e612858b89a8e3bf8ca`。

## 3. Implementation

- `LibraSubjectRepository`、`LibraBindingRepository`、`LibraIntakeDecisionRepository`只绑定SSOT规定的10张`libra_*`表。
- 唯一`active_subject_continuity` head以revision `0`幂等初始化；后续更新要求revision与digest双CAS。
- Subject Episode scope与Material Binding Episode Claim分别关系化保存，不把N:M压扁为单列。
- Continuity Claim只接受`provider_season_identity|triage_grouping_lineage`和
  `candidate|resolved_identity`正式provenance；集合digest使用确定性UTF-8排序，重复Episode fail closed。
- new Subject允许`current_identity_revision = NULL`，没有伪造Canonical Identity。
- Libra Store没有读取或写入`proc_*`，也没有引入跨域Store、兼容路径或Runtime fallback。

## 4. Verification

- Focused：17/17 PASS。
- Full `npm run test:helix-architecture`：89 fixture files PASS。
- Dependency guard：47 packages、92 files、135 dependencies，`findings=[]`。
- Semantic guard：1530 files，`findings=[]`。
- Manifest/contract gate：112/96/168/30，198 type refs，0 unresolved。
- `prohibitedActionsRun=[]`。

## 5. Prohibited actions

未运行E2E、Docker、Canary、生产、Service startup、socket或真实媒体副作用；未触碰`media-desktop`；未修改SSOT。
