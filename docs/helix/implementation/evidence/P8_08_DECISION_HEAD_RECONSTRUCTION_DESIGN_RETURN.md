# P8-08 Decision Head Reconstruction Design Return

Status: Open；已发送 Architecture Agent；不涉及业务决策。

Date: 2026-07-19

## 已完成的安全实现

- PBF-12 的 38 项 transaction、169 张表及 typed source map 已重物化；
- 修正生成器中把 canonical `contentProfile=series` 错写为 structure `season` 的遗留；
- pure Decision Input、Routing AST/Assessment/Decision、Product Scope 与六类 Acceptance Spec Resolver 已实现；
- Decision Basis 5-table transaction 已实现首次 logical head revision 0、Owner snapshot/Policy freshness、relationized input、
  Result/marker、replay、CAS rollback；
- DDL compiler 已把 `libra_decision_basis_revisions.expected_head_revision` 精确限制为 non-negative，而不是统一正整数。

Focused 8/8 与完整 P3 persistence gate PASS；`findings=[]`、`prohibitedActionsRun=[]`。

## 阻塞缺口

`DecisionInputSet@1` 的 `inputSetDigest`覆盖完整
`expectedDecisionHead{revision,digest,currentRoutingDecisionId,currentDecisionBasisId,currentAcceptanceSpecId}`，但当前 Owner
持久化只在 `libra_decision_basis_revisions`保存 `expected_head_revision`；
`libra_decision_basis_inputs.input_kind` closed set也没有 Decision head snapshot。

因此 current head 被后续 Basis / Routing / Spec CAS 后，历史完整 Input Set不能只从 Libra Owner rows恢复。实现不能使用
Foundation Result、caller cache或 current row猜测补值。受影响的 Routing Decision Commit、Acceptance Spec Publish及历史
semantic replay暂不继续。

## 需要架构闭合的连续性

架构合同需唯一规定完整 expected head snapshot 的 Owner 持久化位置、DTO→row映射、reconstruction公式及对应 transaction
read/write set。闭合不得新增跨域 Store、Foundation fallback、兼容路径或 current-head推断。

本 Design Return 已发送架构任务 `019f4a67-4a29-7c62-8af5-bf79083226ca`。实现线程未修改 SSOT。
