# P14 Western Responsibility Closure Checkpoint

状态：**FROZEN — 待 Architecture active review / P14 独立复验**

## Baseline 与停止点

- P14 已接受的 Western Arca Handoff B / On-deck source：
  `62dfe460`；P14 evidence：`20e873e1`（tested local `8e0e3d3b`）。
- 当前实现闭合由本文件所属 checkpoint commit 冻结。
- 输入是正式 `arca.product.accepted@1` 与 durable
  `arca.offload.completed@1` Projection；Off-load wake 仅作可丢失唤醒。
- 停止点是 Western Libra Run、Cleanup Scope、Workspace 与 Foundation
  Workspace Registry 全部 terminal；不进入横向 Feature/UI 工作。

## 完整责任闭环

同一 Western Product Package 复用 Movie/Series/JAV 已接受的共享责任闭合路径：

`arca.product.accepted@1
→ Libra Delivery Receipt / Inbox / terminal Run
→ durable Arca Off-load Completion Projection
→ 24h grace
→ 两次真实、间隔一个 Reclaimer cycle 的 Reference/Control observation
→ Admission UoW exact recheck
→ one Cleanup Scope
→ journaled Workspace reclaim
→ Reference release / terminal Scope + Workspace + Foundation Registry`

Clean Host 只移除 Western 在 Arca On-deck 后的阶段门禁；Coordinator、Owner
Store、canonical transaction、Result 与 physical-effect recovery 均复用同一正式
实现，没有 Western 专用 Store、事务或 Result 重构。

## Result、消息与恢复连续性

- Run completion 成功但 Accepted delivery ack 前故障后，重启直接读取并返回
  持久化完整 `LibraRunLifecycleResult@1`。公开 Result 的 canonical JSON、
  storage digest 与内部 `resultDigest` 均与首次 commit 完全一致。
- 该恢复只补 Intended Libra consumer 的 ack；Run completion revision、
  Event Result 与 Commit marker 计数均不增加。
- `arca.product.accepted@1` 与 `arca.offload.completed@1`各只有一条 Outbox、
  一条 Libra Delivery 和一条 consumed Libra Inbox；均最终 `fully_acked`，
  没有其他 consumer。
- 丢失 Off-load wake 时，durable Projection 仍独立推进 grace、audit 与 cleanup；
  wake 可见性不进入 Decision digest。

## Two-cycle audit 与 cleanup recovery

- grace 结束前不创建 Cleanup Scope。
- 第一次真实 observation 仅返回 `workspace_cleanup_audit_pending`，无 Scope、
  Effect 或物理删除。
- 重启不会把一次读取回填成两次 observation；过早第二次调用继续 pending。
- 一个完整 cycle 后才执行第二次 owner-row read，并由 Admission UoW重新读取、
  byte-compare exact current References 与 Controls 后建立唯一 Scope。
- shared cleanup 反例证明：两轮间新增 Reference或第二次读取后 Control漂移均
  fail closed，Scope与物理 Effect为0。
- 首个 physical delete 后故障保留一个 intended Effect、零 completed member；
  重启按同一 reality/Effect提交首个 member。
- 首个 member commit 后、响应前故障重启继续同一 Scope；最终每个 Workspace
  member恰有一个 committed reclaim Effect，Scope/Workspace/Registry terminal。

## Product history 与物理安全

- Cleanup前后正式 ProductDelivery historical reconstruction保持一个
  `primary_payload`、一个`metadata_sidecar`和一个`poster`；三者Episode Claim
  集合均为空。
- Arca 3-member Binding、Inventory、active Shelf Entry与Deck Fact保持不变；
  cleanup不读取、解释或改写Arca Inventory。
- 原 Western Primary/NFO/poster/unrelated源文件与Arca Target三文件的
  SHA-256、size、mtime保持不变。
- 唯一被回收的是 Libra disposable Workspace中的正式current members；
  References、Workspace与Foundation registry均通过正式terminal状态释放。

## 验证与机器基线

- Western责任闭合定向：`3/3 PASS`。
- Western + shared cleanup + Movie/Series/JAV/P10回归：`34/34 PASS`。
- 完整 `npm run test:helix-architecture`：
  `133 files / 899 tests PASS`。
- Dependency、semantic与machine findings均为0；
  `unresolvedTypeRefs=0`，`prohibitedActionsRun=[]`。
- 核心库存：112 Capability / 97 Result family / 178 Table /
  43 Canonical Transaction。
- Manifest aggregate：
  `345a974464886d213ca36ba21678bd7ad88ece5b2a081f34f4ddbc94accdc3d9`。
- Contract aggregate：
  `c5a62e222ce4063f7ad05073f343e525d417f625cc937ee5f1284a2cf2090995`。

## Residual

- deterministic Western Provider/analysis与合规HEVC/Matroska/MKV输入仅为
  construction evidence，不是real Provider/face acceptance。
- 现有真实 Western H.264/MP4且大于1 GiB样本继续对冻结Spec正确fail closed；
  本checkpoint未实现转码或放宽Requirement。
- `F02.17`仍为`NOT_RUN`。本checkpoint不声明Feature/UI/Beta完成，也未启动
  horizontal、Worker、Desktop、Ollama、NAS或生产路径。
