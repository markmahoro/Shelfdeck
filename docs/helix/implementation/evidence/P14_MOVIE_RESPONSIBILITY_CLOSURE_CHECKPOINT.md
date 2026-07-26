# P14 Movie Responsibility Closure Checkpoint

状态：**IMPLEMENTATION CORRECTED — 等待 Architecture / P14 独立复验**

## 基线与范围

- 上一已接受实现基线：`3d9ebab4`（PBF-19 Arca Handoff B / On-deck）。
- Architecture SSOT 未修改。
- 本检查点只关闭同一 disposable Movie 的最终责任链：
  `arca.product.accepted@1 → Libra Run complete →
  arca.offload.completed@1 → 24h grace / last-reference audit →
  Workspace cleanup / reclaim`。
- 未进入 Series、JAV、Western Adult、横向 503、Provider 真实验收、Worker、
  Desktop、Ollama、NAS。

## 实现合同

- `arca.product.accepted@1` 只由 Libra Run Lifecycle 正式 consumer 消费；
  Delivery Receipt、Inbox、Run terminal revision/head、Result/marker 原子提交。
- `arca.offload.completed@1` Signal 只负责 wake，允许丢失；Libra 始终先经 Arca
  read-only public projection 发现 durable Completion。存在 exact intended-consumer
  Signal 时才幂等消费/确认，Signal 不进入 Admission Decision digest。
- cleanup admission 使用注入时钟，严格执行 24h grace。首次调用只保存一次真实
  owner-row observation 并返回 `workspace_cleanup_audit_pending`，不建 Scope、不执行
  effect；同进程达到至少一个 Reclaimer cycle 后才做第二次真实读取。进程重启会安全
  重启完整两次观测，不持久化或倒填技术时间。
- Admission UoW 在任何写入前重新读取 exact target References、其他 active
  References 与 Material Control projections，逐字节比对第二次 observation 和
  member set；变化时整笔拒绝且不建 Scope。
- cleanup effect 先以 `fx_effect_journal` 固化 intent，再删除或验证 absence；只删除
  immutable Workspace Handle 约束的目标。terminal Evidence 与
  `fx_workspace_materials active → reclaimed` 同一 Foundation commit。
- 每个完成 member 在 Libra 事务追加唯一 released Reference revision；全部完成后
  Scope、Workspace、Workspace Registry 进入 terminal reclaimed。
- 已完成 Arca On-deck 可从 Arca 自有 Run / Final Decision / Receipt / Completion
  历史行及已提交 effect 重放，不再要求合法回收后的 Libra Workspace 源文件存在。

## 恢复与反例

- grace 未到：返回 `workspace_cleanup_grace_active`，不创建 cleanup Scope。
- 第一次 audit 与未满 cycle 的重复调用均返回 pending，Scope/effect 计数保持 0。
- restart between observations 丢弃内存技术观察并从一次新的真实读取重新计时，
  不把旧读取冒充第二次 observation。
- 两次观察间新增其他 active Reference：`P14_CLEANUP_REFERENCE_AUDIT`，无 Scope。
- 第二次观察后、Admission CAS 前 Control 改变：
  `P14_CLEANUP_ADMISSION_AUDIT_STALE`，UoW 零写入。
- 隐藏/丢失 Off-load Signal 时，durable found Projection 仍可完成 Scope admission
  与 cleanup；待 exact wake 可见后可独立幂等消费。
- fault after physical Workspace deletion：Effect 保持 intended、member 仍 pending；
  重启验证 absence 后提交同一 Effect/Evidence，不发生第二次物理删除。
- fault after first member commit：重启从同一 trigger Scope、admission Result、
  member head 继续，不重复 Scope、Receipt 或 physical effect。
- 最终恰有一个 completed Scope；每个 Workspace member 恰有一个 terminal
  result、released Reference 与 reclaimed material row。
- 原 Movie、related NFO、unrelated NFO 的 bytes/mtime 不变；Arca final Shelf
  Inventory 文件仍存在。
- source guard：Libra closure 不导入 Arca/Procurement persistence，不执行
  latest/current scan；Arca projection 为 owner-local read-only port。

## 机器证据

- 修正定向回归：`13/13 PASS`（audit 3、Movie real HTTP 1、P9 lifecycle 9）。
- 完整 `npm run test:helix-architecture`：`126 files PASS`。
- 库存保持：112 Capabilities / 97 Result families / 177 tables /
  43 canonical transactions / 114 routes / 18 UI surfaces。
- Contract aggregate：
  `45ba7a467e7411c7671587cb5b265b1cedf9a53974d76b7a7209d7d80923574e`。
- Manifest aggregate：
  `35d209a3c5141d397b824796995508a453035df2420b032e34fc83b0a4cfe829`。
- Clean DDL digest：
  `de1dab24d95b689e60477b090c685fe855e560662cc36a60555f85e869ed6697`。
- DDL ordinary closure：nullable JSON 约束保留 NULL，cleanup uncontrolled
  Control revision 允许 `0`；非 nullable JSON 与其他 revision 约束不放松。
- `prohibitedActionsRun=[]`。

## 剩余边界

- 本检查点仅声明 Movie core backend 的责任关闭链已实现，尚待独立复验。
- `F02.17` 仍为 `NOT_RUN`。
- 不据此声明 Beta 完成；独立 ACCEPT 后才按既定顺序进入 Series。
