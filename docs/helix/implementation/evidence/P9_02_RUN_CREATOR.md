# P9-02 Run Creator and Immutable Delivery Scope Evidence

Status: PASS

Date: 2026-07-20

## Scope

本Evidence覆盖Run Creator、immutable Run Input Manifest、Execution Basis、active scope head、initial/replacement
Admission及其canonical transaction。唯一架构SSOT为`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`；实现任务未修改SSOT。

## Implemented continuity

- Run Admission只从Libra Subject、Subject Decision Head、immutable Acceptance Spec、current Material Binding/Episode
  relations及同事务Material Control snapshot装配；不读取Procurement Store、current Field或caller补值。
- Physical Identity、size、Location、Candidate Delivery provenance、Binding revision/Evidence和Control revision/projection
  逐项重验后冻结到Run-owned Manifest；`outputRequirementDigest`由完整Acceptance Spec、Material role与Episode scope
  的closed公式派生。
- absent logical head revision 0不建立sentinel row；首次commit建立revision 1。后续Admission对head revision/set digest
  执行CAS并保存pre/post snapshot。
- initial建立stable Run/Manifest identity、normal empty Priority、state revision 1及完整Result/marker；不产生Outbox。
- replacement只接受`active|suspended`目标，逐字节复制Priority，保持Subject/Product/Episode delivery scope，原子建立新Run、
  将旧Run置为`superseded`并追加双方revision，最后一次性切换active scope set。
- single范围拒绝并存eligible Run；Season按Material key与Episode key拒绝重叠，同时保留其他不重叠eligible Run于scope set。
- immutable Execution Basis Record只引用同Run Manifest；历史事实不由later current Subject、Spec、Binding或Control补齐。

## Machine counterexamples

- stale/wrong-owner Material Control使完整Admission事务回滚，Run、Manifest、revision、Result和marker均为0 row。
- Foundation Result/marker均已写入后注入crash，SQLite canonical transaction仍全有或全无。
- replacement验证旧Run state/revision/digest/Spec/Basis、Priority及delivery scope；frozen或scope drift fail closed。
- stable marker replay只返回durable Result，不新增Run、revision、Manifest或Outbox。

## Verification

- Run Admission contract/store isolated fixtures：9项PASS（5个model fixtures、4个SQLite transaction fixtures）。
- package boundary、Persistence boundary与canonical transaction validator：PASS。
- 完整`npm run test:helix-architecture`：PASS；103 fixture files，dependency/semantic/contracts均`findings=[]`。
- 合同计数保持112 Capability、97 Result family、176 tables、43 canonical transactions；
  `prohibitedActionsRun=[]`。
- 未运行E2E、Docker、Canary、production或真实媒体副作用，未触碰`media-desktop`。

## Exit decision

P9-02 PASS。Run Creator及immutable delivery scope具备SSOT可追溯Owner row、digest/revision/CAS、replay和crash
atomicity。下一工作包为P9-03 Run freshness, lifecycle and priority。
