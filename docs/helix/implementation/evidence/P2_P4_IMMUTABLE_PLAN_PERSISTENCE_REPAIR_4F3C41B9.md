# Immutable Plan Persistence SSOT Repair Evidence

Date: 2026-07-17  
Authorized repair commit: `4f3c41b9`  
First consuming Runtime commit: `3788d9fc`

## 1. Reason and authority

P4-08实现审计证明：SSOT §7.3要求immutable Workflow Plan持久保存Work Objective及每个Node的Approval、Authorization、
Retry、Timeout、Output和Compensation合同，但原§8.5.10的`fx_workflow_plans`/`fx_plan_nodes`没有对应列，也没有
可重建的完整Plan Artifact。`graph_digest`只能验证，不能反解原Plan；把字段塞入parameters/when JSON会突破typed schema。

用户于2026-07-17明确授权“针对这个已证明的矛盾返回Design，修正SSOT后继续”。修正仅闭合持久化矛盾，不改变
Business Domain、Owner、Handoff、Outcome、Authorization语义、表数量或产品范围。

## 2. Minimal repair

- `fx_workflow_plans`新增`work_objective_type_ref`、`work_objective_version`、`diagnostic_classification`；`state`继续保存四种Resolution。
- `fx_plan_nodes`新增`approval_requirement_ref`、`authorization_requirement_ref`、`retry_policy_ref`、
  `timeout_policy_ref`、`output_contract_ref`、`compensation_for_event_id`、`compensation_contract_ref`。
- compensation两列必须成对，target显式FK到同一Plan预声明Event；Plan validator只允许匹配target的单一terminal dependency。
- Plan/Node合同均变为immutable；publisher先插入同Plan Event identity，再写Node/Edge，完整字段与graph digest同事务提交。
- 新增确定性SSOT source-map materializer，传播顺序固定为SSOT extract → source map → table contracts → DDL。

## 3. Digest propagation

| Evidence | Before repair | After repair |
| --- | --- | --- |
| SSOT aggregate | `9d6f117d8987d69c5b3e118e17e2e4bda8e6325c45f6bf18750221bd84eeae38` | `8b250ce46f852c65b0843ef9a6e58dcf12d33258c22f3895ed7b0e513e5ba934` |
| P2 contract aggregate | `aab78271f712df7714233f0a79e24453e0c1a85c5d214ebf926dc6e71adba247` | `fe2f4433cab34d9c7dc4c682d92409552d3c50aee217bb477d553ccc89ef8160` |
| table contract aggregate | prior P3 baseline | `7ad7a3051530a8801d90260cfef4fc3fb9cb1e0ac606f7662ff65c9e864300c9` |
| DDL | `98e50feb79165844951ab5133f383eedc82848e83b0e4a2c4a58059121548b11` | `29a8e6b6c857ab551b25197231ef6e37feb1e5ea4ee469f31d50ba181a4db7b5` |

Unchanged component digests：Shared Types `af6cb77b…`、Result Types `e5963ae4…`、Domain Inputs `ac3bae51…`、
Capabilities `3ffa356d…`、Canonical Transactions `6e942ae3…`。Inventory仍为112/96/156/18；DDL仍为156 tables、
72 indexes、19 partial unique。FK总数由148增至149，仅新增compensation Event FK。

## 4. Machine evidence

- 45组SSOT/source-map/table/DDL/Plan/Runtime定向fixture PASS；
- Plan header和七项Node执行合同存在性、immutability、compensation pair/FK、terminal dependency声明均有负例；
- P4 Runtime专项29/29 PASS：四种Outcome、双Fence、Approval exactness、DAG ready/cancelled/skipped、Result唯一、
  Progress、Permit timing、Executor crash recovery facts；
- 完整architecture gate PASS：43 fixture files、dependency findings=0、semantic findings=0、aggregate
  `fe2f4433…`、`prohibitedActionsRun=[]`；
- P3 persistence aggregate PASS：18 transactions、132 participant/COMMIT fault points、18 revision fence failures、
  10 stale Control CAS、11 Outbox contracts；
- `4f3c41b9` fresh detached-worktree完整architecture + P3 aggregate PASS；
- `3788d9fc` fresh detached-worktree P4专项 + 完整architecture gate PASS。

## 5. Boundary result

`PASS / SSOT CONFLICT REPAIRED / NO COMPATIBILITY OR MIGRATION / HISTORICAL EVIDENCE PRESERVED`

未运行E2E、Docker/Canary、production、真实媒体副作用，未修改`media-desktop`，未接旧Runtime。
