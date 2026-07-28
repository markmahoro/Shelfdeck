# P14 JAV Handoff A Implementation Checkpoint

状态：**FROZEN — 待 Architecture active review / P14 独立复验**

## Baseline 与范围

- Accepted source baseline：`77c21785`。
- Architecture SSOT last-touch baseline：`6178437b8648c3557ce54d2001881cbc83748826`。
- 本检查点只覆盖：
  `Field Observation → Procurement Triage/Candidate Publication
  → CandidateDeliveryPort → Libra Handoff A Accepted`。
- 明确未进入：Routing、Acceptance Spec、Libra Run、Workspace、Production、
  Handoff B、JAV Provider acceptance、Western Adult、横向 Feature Matrix。
- Architecture SSOT 未修改。

## JAV typed continuity

- 当前正式 public HTTP 路径仍是 `mixed → jav_code` 的 code-positive 分支；
  `SDKI-001` 仅作为 Triage 产生的弱、可纠正 `jav_code` Identity Evidence；
  没有提升为 Provider 或 Canonical Identity，也没有从目录或标题猜测强 Identity。
- Candidate 为 `single/jav/single`，恰有一个 `primary_payload`。
- 与唯一 Primary 同目录的 same-stem NFO、generic `movie.nfo` 与 poster 作为
  Related Material references 进入 immutable Candidate/Delivery Snapshot；
  unrelated NFO 不关联，也不成为第二个 Primary。
- Identity Claim 同时保存 `filename_title` 与显式 `jav_code` typed source hint，
  两者按 UTF-8 稳定排序并各自带 Evidence digest。
- Libra 通过正式 CandidateDeliveryPort 接收完整历史快照，原子建立
  Accepted Intake、新 `single/jav` Subject、current Binding 与 exact Material
  Control transfer。无 Routing Policy 时返回 typed `routing_unresolved`，检查点
  在此冻结。

## Owner / Transaction

- Procurement 仅写既有 Field/Observation/Run/Triage/Candidate/Offer Owner rows。
- Handoff A 只使用既有 Procurement Candidate Delivery public port 与 Libra
  accepted-intake canonical transaction；Composition Root 只接线。
- 没有 Procurement↔Libra Store side-read/write、Foundation Result 旁读、
  latest/current scan、新 Capability/Table/Transaction 或兼容路径。
- 机器库存保持 112 Capabilities / 97 Result families / 177 tables /
  43 canonical transactions；114 routes / 18 UI surfaces。

## Recovery 与验证

- formal phased Supporting Work/Plan/Event 在 Candidate Publication 前故障；
  重启复用已提交 Probe/Triage Results，Media Probe 不重复执行。
- Candidate、Offer、Handoff A、Subject、Intake、Binding、Control 均 exactly-once；
  same-key/same-payload 稳定重放，same-key/different-payload 返回 409 且零新增事实。
- CandidateDelivery historical reconstruction 复算并验证相同 JAV Claim、
  Primary Manifest 与 Related Reference set。
- synthetic construction：`1/1 PASS`。
- retained P14 JAV sample + built-in FFprobe：`1/1 PASS`。
- direct Triage contract证明：显式`jav` Hint下，无合法番号时
  `displayIdentity`回退到既有title，`javCode`与`jav_code` source hint均不存在；
  相同文件在`mixed` Hint下仍按固定precedence进入`movie` fallback。
- Procurement/Candidate/Handoff/Series regression：`20/20 PASS`。
- 完整 `npm run test:helix-architecture`：`131 files PASS`，
  findings 与 `prohibitedActionsRun` 均为空。
- Contract aggregate：
  `30089e947738bab7933af3b606cd22336746321e05ae4d4d44a4bd5534e2d4e5`。
- Manifest aggregate：
  `351063009c3d50fe07c3fb70503bb4ff71e30b1ebef40beb3700c2e22a414b18`。
- retained sample 的 MKV/NFO/poster bytes 与 mtime 在正式 HTTP journey 前后
  完全不变。

## Residual risk / 下一步

- 本检查点不声明 real JAV Provider、Routing/Spec/Production 或 Feature/UI
  acceptance。
- Material Field `contentProfile Hint`的Owner-row与正式HTTP配置连续性尚未实施；
  本检查点没有增加Field列/API，也没有caller/Composition临时注入。该能力须在
  Western纵切前通过单独Architecture closure正式闭合。
- Architecture/P14 ACCEPTED 后才可推进 JAV Routing/Spec/active Run；在结论前
  保持冻结。
- `F02.17` 继续为 `NOT_RUN`。
