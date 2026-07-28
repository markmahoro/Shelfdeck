# P14 Western Adult Handoff A Checkpoint

状态：**FROZEN — 待 Architecture active review / P14 独立复验**

## 范围与基线

- Architecture SSOT baseline：PBF-22 `04f310c1`，实现分支原样纳入
  `6369526c`。
- Implementation baseline：PBF-22 source checkpoint `0df6dfe8`。
- 本检查点只覆盖：
  `western_adult Field Hint → Observation → Procurement Run/Triage →
  Candidate/Offer → CandidateDeliveryPort → Libra Handoff A Accepted`。
- Routing Decision、Acceptance Spec、Libra Run、Provider、Production与Arca
  均未进入。

## 完成的正式链路

正式Admin HTTP以显式`contentProfileHint=western_adult`注册Material Field。
同一不可变Hint revision 1的value/revision/digest被逐层保存在：

1. `proc_field_profile_hint_revisions`；
2. terminal `proc_field_observations`；
3. active `proc_procurement_runs`；
4. MaterialFieldContext与正式phased Triage Plan/Event/Result。

Triage建立一个`single/western_adult` Candidate。Identity Claim为
`western_temporary`，只包含`field_content_profile_hint`与
`filename_title`弱证据；没有`javCode`、Provider Identity或Canonical Identity。
一个MKV为Primary，Episode claims为空；same-title NFO与parent-local poster为
Related Reference，unrelated NFO保持未关联且没有独立Control。

Candidate Publication、Offer、CandidateDeliveryPort历史重建、Libra Intake、
new Subject、Material Binding与Procurement→Libra Material Control transfer均复用
既有canonical transactions与Owner-local Store。Composition Root只接线。

共享Formation guard补齐现有closed profile`western_adult`后，在没有正式Routing
Policy时只返回`routing_policy_unavailable`，未写Routing Decision/Basis/Spec/Run；
这防止已成功的Handoff A被后续未开始阶段反向报错，不新增Western专用Store、
Capability或Transaction。

## Recovery与反例

- 未认证Field注册返回401。
- Triage Results已提交、Candidate Publication前注入故障：零Candidate；重启从
  exact Event Result refs恢复，不重复FFprobe。
- 同idempotency key / 同payload跨重启稳定重放；同key / 不同pageBudget返回409。
- Candidate、Offer、Subject、Intake、Binding以及两类Outbox均保持exactly one。
- CandidateDelivery历史读取重建相同`western_temporary` Claim、Primary与Related
  set。
- `p7-triage-pipeline`继续证明同一无code输入在`mixed`下固定落
  `movie_fallback`，不会被Western规则重解释。
- PBF-22既有CAS/stale反例继续证明Hint revision变化不重解释旧
  Observation/Run/Candidate。
- 使用保留P14真实MKV经`createCleanMediaProbe`/FFprobe走同一HTTP链路；
  测试仅在disposable目录建立hard link与sidecars。Primary及全部sidecar的
  SHA-256、size、mtime前后相同。

## 测试与机器基线

- Western synthetic public vertical：`1/1 PASS`。
- Western retained real-MKV + FFprobe vertical：`1/1 PASS`。
- P7 + P8 + JAV/Western Handoff A focused regression：`36/36 PASS`。
- `npm run test:helix-architecture`：`133 files PASS`。
- Machine inventory：`112 Capability / 97 Result / 178 Table /
  43 canonical Transaction`。
- Manifest aggregate：
  `a4b184ec72bbe571bfac6c441e1bd336d8ab0a5d53dad8b48b0f10f83a887ff1`。
- Contract aggregate：
  `423a5818bca505d12998d87e69bf3e1d9391b0e960d014d84eb4f762bfc2b79f`。
- findings与`prohibitedActionsRun`均为空。

## Owner / Transaction审计

- Procurement只读写自己的Field、Observation、Run、Candidate、Delivery rows。
- Libra只通过正式CandidateDeliveryPort接收完整历史Snapshot，并在自身事务写
  Intake、Subject、Binding与Control participant。
- 无跨Owner Store读取/写入、Foundation Result业务旁读、latest/current扫描、
  legacy fallback或兼容双路径。
- Domain、Owner、Handoff、Capability、Result、Table与Canonical Transaction
  inventory均未改变。

## 冻结点与剩余风险

当前媒体已在Libra成为一个active `single/western_adult` Subject，并完成Handoff A
责任转移；`libra_acceptance_specs=0`、`libra_runs=0`。在Architecture/P14接受前
不得进入Routing/Spec/Run。

本检查点不声明真实Western Provider、face、Feature/UI或Beta验收；
`F02.17`继续为`NOT_RUN`。后续仍禁止Worker/Desktop/Ollama/Python/NAS/Docker/
生产及横向503施工。
