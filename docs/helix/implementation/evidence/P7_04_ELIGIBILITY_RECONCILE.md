# P7-04 Extraction Eligibility Reconcile Evidence

Status: complete；P7-05 may proceed under standing Local Implementation authorization.

Date: 2026-07-18

## 1. SSOT traceability

| SSOT contract | Local realization |
| --- | --- |
| §5.3.1 `ExtractionPolicy@1` | closed Policy shape、JCS digest、path/extension/size/material exclusion验证 |
| §8.5.11 Field Material current decision fact | `proc_field_materials`保存Eligibility revision、reason及Observation/Policy/Selection/Control basis |
| §8.6.4 unique reason precedence | pure `evaluateExtractionEligibility`，无历史duplicate suppression |
| §8.6.4 versioned Control Projection | Foundation-owned bounded Query/同事务read participant；Region只由current Control映射 |
| §8.6.4 stale-safe Reconcile | 同一UoW重读全部current basis，逐项canonical decision equality与Eligibility revision CAS |
| §8.8 canonical transaction | `field-eligibility-reconcile-commit`为第26项；current rows是唯一durable output，零Result/marker/Outbox |

## 2. Implementation receipts

- Architecture delta原样纳入：`fede4f2b`（上游`2ff2f60d`）；实现线程未编辑SSOT。
- P2物化：`4c4a2c8a`，aggregate `b8668f30b6ff6195b281829dece5c140f68f57c2f829946322b21aeb46ca0127`。
- Policy、Evaluator和Control Projection：`9419e8f5`。
- Atomic Reconcile：`5a36fdbc`。

## 3. Machine counterexamples

- 非closed或digest漂移的Policy、Selection、Control snapshot拒绝；typed unavailable Control只形成`unknown`。
- reason precedence固定，且不存在duplicate-suppression输入或旧Store旁读。
- Control读取为单次、排序、唯一、最多500键；Reconcile按单Field和最多100键进一步限定，避免跨Field放大。
- Batch顶层Field/Access/Observation/Policy必须与逐项Decision一致；digest或排序漂移拒绝。
- Reconcile同事务重读Field、Access、terminal Observation、Policy、Material Binding、Selection与Foundation Control；任何basis漂移进入`staleMaterialKeys`且不覆盖row。
- applied row用`expectedEligibilityRevision` CAS；事务故障由canonical crash harness证明全部回滚。
- exact Batch重放进入`noOpMaterialKeys`，Eligibility revision不增长。
- `fx_outbox`保持零；没有Event Result或commit marker写入路径。

## 4. Verification

- Focused Node tests：`19/19 PASS`（最终加强snapshot digest反例后的相关子集`13/13 PASS`）。
- Complete Helix architecture tests：`533/533 PASS`。
- `npm run test:helix-persistence`：`ok=true`；161 tables、75 indexes、26 transactions；
  `prohibitedActionsRun=[]`。
- `git diff --check`：PASS。

没有运行Service、E2E、Docker、Canary、production、真实Field/媒体副作用；没有修改`media-desktop`。

## 5. Conclusion

P7-04已按SSOT clean-cut闭合，不依赖兼容层、dual path、旧Runtime fallback或跨Domain Store读取。P7-05可以开始；
最终P7是否完成仍取决于P7-05–P7-11及独立Phase Exit Audit。
