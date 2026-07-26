# P14 Product Journey Implementation

状态：**FROZEN — Movie Arca On-deck Commit 等待独立复验**

## 当前基线

- 分支：`codex/helix-p9`
- P14 已独立接受的 Product Package / open Handoff B Offer 源检查点：
  `7531c6ba`；施工证据提交：`ec4f76e7`；P14 复验证据：`06155670`。
- 当前实现检查点：本次提交（Arca Handoff B Acceptance → On-deck Commit）。
- Architecture SSOT 没有实现线程额外修改。
- `F02.17` 仍为 `NOT_RUN`；不得增加测试便利接口或用内部 Store 证据冒充
  用户 Feature。

## 当前冻结点

同一 disposable Movie 已沿正式 T-shaped 产品旅程推进至：

`open libra.product-offer.available@1 → Arca Handoff B Accepted →
Custody/Control transfer → Inventory staging → On-deck Commit →
active Shelf Entry + Deck Fact + Own`

Arca 只消费正式 ProductDeliveryPort 与 Handoff B Offer。Handoff B Accepted
事务建立 Arca Custody/Binding 并转移完整 Package Material Control，但不提前
建立 Own；只有 On-deck Commit 原子建立 Shelf Entry、Canonical Identity、
Inventory Representation/Materials/Product Facts、Deck Fact、最终 Material
Control 与 Off-load Completion Fact。

目标 Shelf 已形成三份正式 Inventory material（primary、metadata sidecar、
poster）。原 Movie/NFO 及无关 NFO 的 bytes 与 mtime 均未改变。Libra
Workspace 与 Run 尚未 cleanup/complete；`arca.product.accepted@1` 和
`arca.offload.completed@1` 仍等待 Libra 正式消费。

本检查点已通过三个新增 crash/restart/replay 窗口：

1. Handoff B Accepted 后：恢复同一 Acceptance Decision/Custody/Receipt；
2. 首个 Arca Inventory 物理效果后：恢复同一 Effect Journal 与目标文件；
3. On-deck Commit 后、Run finalize 前：从 Arca Receipt/Completion 重建同一
   Result，再完成 owner-local state CAS。

重启均保持一份 Package、Offer、Acceptance、Custody、Shelf Entry、Deck Fact
及目标文件，不重复 Control、事实或物理效果。详细证据见
`docs/helix/implementation/evidence/P14_MOVIE_ARCA_ONDECK_CHECKPOINT.md`。

机器库存保持 112 Capabilities / 97 Result families / 177 tables /
43 canonical transactions / 114 routes / 18 UI surfaces。完整 architecture
gate 为 857/857 PASS，`prohibitedActionsRun=[]`。

## 下一步

等待 Architecture / P14 独立复验。通过后下一段只处理 Libra 对正式
`arca.product.accepted@1` 与 `arca.offload.completed@1` 的消费、Run
completion 和 Workspace cleanup/reclamation，闭合 Movie 旅程。不得在复验前
推进该段，也不得进入 Series、JAV、Western Adult 或恢复横向 Feature Matrix。

## 硬边界

- 保留 P14 disposable sample roots；不得触碰 NAS 或原始样本。
- Service-only：不得触碰 Worker、Desktop、Ollama、Python/FastAPI。
- 不得修改 SSOT，不得引入兼容/双路径、hidden Store read、外域
  latest/current scan、Foundation Result fallback、legacy fallback 或跨 Owner
  写入。
- 当前检查点不声明 Libra Off-load completion 消费、Workspace cleanup、
  Movie 端到端旅程或 Beta 完成。
