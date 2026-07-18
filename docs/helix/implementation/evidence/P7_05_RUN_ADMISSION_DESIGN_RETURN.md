# P7-05 Procurement Run Admission Design Return

Status: open architecture contract gap；implementation paused before P7-05 code.

Date: 2026-07-18

## 1. Scope and invariant

本审计只比较当前SSOT和已物化机器合同，没有修改
`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`。P7-04已PASS；本Design Return只阻塞P7-05。

SSOT要求：Run开工时冻结明确Selection和Triage revision；全部Primary在同一admission中取得Procurement Control；
Execution Basis可审计、可做Freshness检查；sealed失败Run只能通过一次性Retry Intent建立一份新Basis和新Run，旧Run不重开。

## 2. Proven gaps

### G1 — Selection cardinality不能形成一个合法原子提交

- `SelectedFieldMaterialSet@1.materialKeys[]`允许`0..4096`项。
- `ResponsibilityControlCommitHandle.expectedControlRevisions[]`最多1024项。
- `ProcurementControlReceipt.acquiredMaterialKeys[]`最多1024项。
- 当前Foundation Control批量读取最多500项；P7-04 Reconcile为100项，但Run admission没有自己的closed上限。
- §6.3.2要求“针对全部选择成员原子取得Control”，因此不能把一个合法4096项Set拆成多次acquire后仍声称Run原子成立。

无法实现的输入：1025..4096项Set无法生成符合现有Handle和Receipt schema的单次结果；空Set是否允许建立Run也没有唯一答案。

### G2 — `SelectedFieldMaterialSet`不是SSOT描述的完整物理关系

当前DTO只有`objectId/revision/digest/procurementRunId/fieldId/materialKeys/selectionDigest`。它没有：

- 每项role；
- Field Material binding revision、Eligibility revision/basis、Reality/Observation Evidence；
- Endpoint/location Evidence；
- 当前Control revision/projection digest及admission expected revision；
- Run冻结的Triage rule identity/revision/digest。

这与§3.3.3、§4.2.3、§6.1.4、§6.3.2对Selected Set和Execution Basis的要求不连续。Executor若在提交时旁读
`proc_field_materials`补齐，只能得到“此刻current row”，不能证明它就是Coordinator冻结并由Handle签名的Selection basis。

### G3 — Run Store不能重建可审计Execution Basis

`proc_procurement_runs`只有`field_id,run_basis_digest,retry_intent_id,state,priority_class,timestamps`；
`proc_run_materials`只有`material_key,role,binding_revision,selected_at_ms`。没有位置保存：

- Field Access/terminal Observation/Extraction Policy revision与digest；
- Triage rule revision；
- 每项Eligibility revision/basis、Reality/Provenance/Control expected revision；
- 可解析的完整Run Basis schema/value。

`run_basis_digest`是opaque checksum，不是§6.1.4要求的可审计Basis。Foundation Work/Plan只有basis digest，且没有正式合同
允许其替Procurement拥有Run业务Basis。重启、freshness check、Candidate publication或Retry都无法从durable facts唯一恢复原Basis。

### G4 — Run admission/seal原子合同缺失

SSOT有`procurement.material.control.acquire@1` Capability，但26项canonical transaction中没有闭合以下同一提交：

- 创建Run及完整Run Basis；
- 插入Selected Field Material Set并激活跨Run Selection唯一性；
- 重验Field/Access/Observation/Policy/Eligibility/Binding；
- 对全部Identity执行Foundation Control CAS acquire；
- 返回可重放`ProcurementControlReceipt`及明确marker/Result/Outbox cardinality。

同样没有sealed transition的expected state/basis、失败Evidence、`finished_at_ms`、Selection guard释放规则。§6.3.7明确
失败封口不释放Procurement Control，但当前合同没有区分“结束Run Selection唯一性”和“保留Procurement Control”的原子写法。

### G5 — Retry只定义了Intent创建的一半

`Procurement Retry Intent Commit`只声明Intent + marker + Outbox和三张current read table，但没有closed command/result/outbox payload；
也没有定义多Material“current eligibility precondition”的exact snapshot、revision/digest和失败原因要求。

更关键的是，缺少消费事务：

- `open → consumed|stale`的expected-state CAS；
- current Basis/Eligibility重验；
- 恰好一份新Run和新Execution Basis；
- 新Run与`retry_intent_id`的正式FK/unique关系；
- Intent、Run、Selection、Control acquire、typed Result/marker/Outbox的原子边界；
- 响应前崩溃后的原Result重放，以及新Run再次同因sealed时不自动创建下一Intent的机器条件。

因此无法证明§6.3.3和§8.9.7的“一个Intent最多建立一个新Run、旧Run始终sealed、失败不自动连锁”。

## 3. Required SSOT closure packet

建议Architecture Agent以一个bounded PBF闭合，具体命名可调整，但必须提供等价连续性：

1. closed、`1..N`且与Handle/Receipt/Control一致的Run admission上限；禁止通过分批acquire破坏原子性；
2. formal `ProcurementRunExecutionBasis@1`和增强的`SelectedFieldMaterialSet@1`，明确每项typed basis、排序、digest及Triage revision；
3. Procurement-owned durable Basis表或等价可解析持久化，不以opaque digest或Foundation Store替代；
4. Run admission正式事务：exact input/output、Owner participants、Selection uniqueness、Eligibility/Binding/Control CAS、
   typed Result/marker/Outbox cardinality、replay和rollback；
5. Run seal正式decision/transaction：allowed transition、failure Evidence、finished time、Selection guard结束、Procurement Control保留；
6. Retry Intent create与consume/new-Run两段正式合同：typed command/result/outbox、idempotency、state CAS、stale终态、
   新Run唯一关联及崩溃恢复；
7. 对应table constraints、transaction inventory、shared/domain/result schemas及machine counterexamples同步物化。

## 4. Forbidden implementation guesses

- 不得把4096本地改成100/500/1024后声称符合SSOT；
- 不得多事务逐批取得Control后再创建Run；
- 不得只保存`run_basis_digest`或依靠日志/Work input充当Business Basis；
- 不得在Candidate publication时旁读最新Field row替代Run冻结Evidence；
- 不得原地重开sealed Run、观察一次伪造revision、自动连续创建Retry Intent；
- 不得为旧Runtime或旧Store增加兼容读取。

## 5. Implementation status

P7-05没有写入production code。最后已验证的实现边界仍为P7-04提交`5a36fdbc`和证据提交`6703ecdf`；
完整Architecture gate与P3 Persistence gate均PASS。Architecture Agent闭合上述合同并提交后，本线程可原样纳入、重物化并继续。
