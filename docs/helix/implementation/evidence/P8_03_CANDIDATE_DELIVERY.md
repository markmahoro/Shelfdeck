# P8-03 Candidate Delivery Evidence

Status: PASS

Date: 2026-07-19

## Architecture and contracts

- Architecture commit：`5d5e37c9`（`PBF-11-R1`）；本分支SSOT blob与其完全一致，实现线程未编辑SSOT。
- 既有`proc_candidate_related_references`扩充为完整`RelatedMaterialReference@1`逐列事实；168-table inventory不变。
- Port：`CandidateDeliveryPort@1.readSnapshot(CandidateDeliveryQuery@1) → CandidateDeliveryReadResult@1`。
- Machine baseline：112 Capability、96 Result Family、168 table、30 transaction、94 domain input type、0 unresolved ref。

## Implementation evidence

- Candidate Publication验证Physical Material Identity、referenceId/referenceDigest唯一公式，并在原8+3事务内保存完整Related row。
- Candidate Delivery Reader只读8张Procurement Owner表；不读Foundation Result、current Field Material、Libra Store或旧Runtime。
- Snapshot逐项重建Package、Manifest、N:M Episode、Related、Run Location/Reality/Provenance及Offer/Basis，并重算全部digest。
- Offer关闭及Run member进入terminal state后仍返回同一历史Snapshot；缺失/篡改identity、relation、query或digest均fail closed。
- Related和Episode relation的复合FK均物化到SQLite DDL，不只停留在文档语义。

## Verification

- Full Architecture：594/594 PASS；90 fixture files。
- Dependency：47 packages、93 files、136 dependencies，`findings=[]`。
- Semantic：1534 files，`findings=[]`。
- P2 aggregate：`57d5e116b5cf4a1fcc9595d3e27ba92c60a7626ae72f223fef9255b0b99fb597`。
- `prohibitedActionsRun=[]`。

未运行E2E、Docker、Canary、生产、Service startup、socket或真实媒体副作用；未触碰`media-desktop`。
