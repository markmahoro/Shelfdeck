# P6-05 People Registry and Candidate scoped Repositories Evidence

Status: `PASS / CLEAN 12-TABLE REWRITE COMPLETE`

Date: 2026-07-17

## 1. SSOT traceability

| SSOT contract | Implementation evidence |
| --- | --- |
| §8.2.5 exactly two persistence components | `PersonRegistryRepository`与`PeopleCandidateRepository`是仅有的People Repository定义 |
| §8.5.13 exactly 12 `people_*` tables | Registry精确拥有7张Person/Identity/Preference/Reference表；Candidate Repository精确拥有5张Candidate revision/head/Merge表 |
| Person is a global Registry | Person revision不含`content_scope`；状态只允许`active|merged`；head同时匹配精确revision和state |
| Person revision and Candidate origin continuity | Person revision完整携带nullable Candidate kind/ID/revision/payload digest四元组；只允许全空或全有 |
| Alias and stable Provider Identity are People facts | Alias和Provider Identity均引用精确Person revision；当前稳定Provider tuple通过`active_guard`保持active unique |
| Preference has explicit current pointer | `people_persons.current_preference_revision`是唯一热路径；首次初始化和后续expected-revision CAS均与新immutable Preference同事务，不使用`MAX(revision)` |
| Candidate payload is complete and immutable | Store只接受完整`PeopleCandidateDraft`；保存精确typed `candidatePayload`，JCS digest不匹配即fail closed |
| Candidate state is revisioned | Registration和Merge各有head表与immutable revision表；revision 1固定为`open`且不携带Decision |
| Merge Candidate freezes exact Person snapshot | normalized left/right pair同时冻结Person revision、fact digest和nullable Preference revision；任何current fence漂移均拒绝 |
| Reference stores handles only | Asset只保存Artifact handle/digest；Face只保存Embedding handle/model ref，并验证同一Person owner |

## 2. Clean disposition

- 删除：旧`contentScope`模型、10-table manifest、Candidate单行`state`更新、digest-only Candidate Draft、无head的Preference追加、
  简化Merge Record接口和四个旧Registration/Merge direct lifecycle API。
- 重写：People model、两个Repository statement catalog、Person/Preference/Candidate映射和P6-05反例。
- 原子化复用：P3 Owner Repository、scoped Unit of Work、deferred composite FK、JCS digest、SQLite partial unique能力。
- 未引入：compatibility field、dual table path、legacy Store fallback、跨Owner读取、raw SQL或Foundation Result旁路。

Table materializer同时修正了一个可证明的实现误判：含显式current pointer的head表必须可CAS更新；“payload/snapshot
immutable”不得把整个head row标成immutable。反例覆盖Registration/Merge Candidate head及Libra Decision head，SSOT未修改。

## 3. Machine counterexamples

P6-05 focused `9/9 PASS`覆盖：

1. 两个Repository精确覆盖12表；
2. global Person无`contentScope`且revision/head/state一致；
3. stable Provider Identity冲突整事务回滚；
4. Preference显式pointer拒绝stale/skipped/fractional/out-of-range；
5. Reference Face跨Person owner失败；
6. Registration Candidate必须是complete payload + initial open revision，digest-only失败；
7. stored Candidate payload tamper失败；
8. Merge Candidate只接受normalized pair和精确current Person/Preference snapshot；
9. source scan拒绝旧10-table API、raw SQL、跨Owner prefix与`MAX(revision)`。

组合证据：

- P2/P3/table/package/Perception/People focused：`68/68 PASS`；
- canonical transaction crash + semantic/package/People：`103/103 PASS`；
- P2 inventory：`112 Capability / 96 Result / 160 table / 22 transaction`；
- current P2 aggregate：`65f96c638a668817085611035870c461f96a71209198b64eae62886ecc6549ac`；
- current table aggregate：`b26caa99ccf2c627964c12c99ea8cc09093888de2b78ad47f741f3dd0f8fe5cd`。

## 4. Scope and next dependency

P6-05只闭合People Store/Repository，不宣称Registration acceptance、Merge commit、Preference conflict decision或Reference
lifecycle完成。下一工作包是P6-06 Person Registration and Candidate lifecycle。

未运行E2E、Docker、服务启动、真实来源、真实媒体或生产动作；未修改SSOT和`media-desktop`。
