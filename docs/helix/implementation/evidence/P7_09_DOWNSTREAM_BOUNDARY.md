# P7-09 Downstream Boundary Verification

Status: PASS

## SSOT traceability

| Contract | Realization |
| --- | --- |
| §4.4.2–4.4.3 | Offer明确指向Libra Intake；Acceptance Basis只由final Package派生 |
| §8.1.4 | 跨域读取只经Domain public Handoff Port，不暴露Store |
| §8.2.1 | `CandidateDeliveryPort`返回只读Candidate delivery snapshot |
| §8.4.2 | Libra从typed Offer读取Candidate；Acceptance/Subject/Control transfer留给P8 |

## Implementation

- `CandidateDeliveryService`只接受`ProcurementCandidateOfferAvailableMessage@1`，以Candidate ID、revision和digest向注入的
  read-only reader请求exact Package。
- 返回值经canonical serialization复制并deep-freeze，不向下游传递Procurement内部可变对象引用。
- 服务重算`CandidatePackage.packageDigest`、`CandidateIntakeAcceptanceBasis@1`、stable `offerId`和完整typed Offer；任何
  ID/revision/digest/basis漂移均fail closed。
- 该服务不导入Procurement Persistence/Store，不创建Subject、不决定Routing、不转移Control、不依赖Runtime或进程内Signal Bus。

## Machine evidence

- synthetic Libra只能持有绑定后的`CandidateDeliveryPort`；同一Offer重复读取返回值相等且无法修改。
- reader只收到exact `{candidatePackageId,packageRevision,packageDigest}`，不收到Store handle或写权限。
- 篡改Offer Acceptance Basis或Package内容均稳定拒绝。
- Candidate Publication回归保持Package/Offer派生公式不变；完整Architecture gate保持112/96/163/30与合同aggregate不变。

未执行Handoff A Acceptance、E2E、Docker、Canary、生产或真实媒体副作用；未修改SSOT或`media-desktop`。
