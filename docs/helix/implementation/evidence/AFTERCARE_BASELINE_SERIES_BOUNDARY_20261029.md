# Aftercare 基线复现与 Series 恢复调用边界（2026-10-29）

本记录用于主整合审查，附带隔离测试的原始输出和只读数据库摘录；它不是修复、发布门禁或生产验收。本文不包含生产数据导出。Series 恢复、Aftercare 和 On-deck Stage 的发现应分别判断，不能以一个场景的通过或失败替代另一个场景。

## 生产基线与 Series 候选的 Aftercare 复现

在隔离 Linux Host 的 GETCHU poster maintenance 旅程中，以**测试夹具**设置以下真实文件现场：旧 Inventory poster 被移除后，原旧文件描述符暂时保持打开，以确保新建文件 inode 不同；当 Aftercare Case 已为 active、`arca.aftercare.artifact.materialize@1` 的 Event 为 executing、Effect 为 intended，且执行器首次检查目标前，在目标位置以独占创建写入与来源相同的 286 字节。目标本来是缺失状态，此时没有创建 Stage。测试注入了夹具的目标检查时机，未修改产品实现、未伪造 stat，也未连接 NAS。

两个源码快照分别取自生产基线 `a2bf2d6fd3271dc3a3741e28ed42f533a59d99d4` 和整合候选 `4774a7e9056f644c29b8034ea07baeb4f578c4f6`；两个 Host 的原旅程均报告 **1 PASS / 73 个名称过滤 skip**。只读副本的实际结果如下：

| 快照 | 冻结旧 inode / 外部目标 inode | 最终 Inventory / Material Control | Event / Effect / Case |
| --- | --- | --- | --- |
| `a2bf` | `1965408` / `1965590` | Inventory rev 2 包含外部 inode；旧 Control released，新 Control 为对应 Arca Shelf Entry controlled | materialize 与 inventory Event succeeded、Effect committed；Case resolved |
| `4774` | `1965529` / `1965444` | Inventory rev 2 包含外部 inode；旧 Control released，新 Control 为对应 Arca Shelf Entry controlled | materialize 与 inventory Event succeeded、Effect committed；Case resolved |

两份只读检查均为 foreign-key violations 0、`integrity_check=ok`。新旧文件的内容指纹相同，但 inode 不同。这里的 PASS 表示原旅程断言未捕获误收编，**是风险复现而不是安全通过**；它证明受控条件可触发既有问题，不证明生产中已发生误收编。

源码静态核对：`a2bf`、Series 恢复候选 `27a0f68af3599a3422b21853632fc8a01878b750`、`4774` 的 `aftercare-capability-ports.js` Git blob 均为 `fb16ebeacd9fed6d407c2dd304fb19df77cd924a`；`aftercare-planners.js` 均为 `293c3b11d3332770e800129bf10c7ba25c5747d7`；`aftercare-process-coordinator.js` 均为 `0c9e359f0f4e5abaaf0b717a3d1ac3b508a214d9`。在该实现里，`materializeArtifactWithRollback` 将 `currentIsSource` 的相同字节目标视为物化结果，而该 Effect 的 intent 本身不能证明目标由本次执行创建。上述三文件完全相同支持其为**既有暴露**；完整 Host 复现只针对表中两份快照，不把 `27a0` 静态一致性称作单独 Host 通过或失败。

首次完整 Architecture 门禁中 `bc4f5c952849ed6079baedde159ddaa5ce1d39c1` 的 GETCHU 失败现场已清理，不能把这次外部目标复现或此前受控 inode 碰撞直接认定为该首轮失败的实际根因。独立补丁 `c2e2127e96659a6034b2a25caf52a8528d4bd348` 后续被证实会接纳外部同字节目标，亦可能发布或清理未经归属证明的 Stage，不能作为最终修复。

## 七条 Series 恢复与 Aftercare 的边界

主整合保存的 `FORMATION_SERIES_AND_MOVIE_DIAGNOSIS_20261028.md` 记录了假如…？、真探、亿万、越狱、继承之战、当你沉睡时和飞天大盗七条历史故障：均在 `arca.series_presentation.files.publish@1` 遇到现实冲突；正式 `tvshow.nfo` 与冻结 Prepared 内容一致，对应 partial stat 可见但 open 返回 `EINVAL`，poster/fanart 尚未发布。这是现有历史证据，不是本记录对生产的新查询；其后的飞天大盗单次用户授权线上重试也未恢复。

`series-presentation-planner.js` 的共享资料 Work 使用 `arca_series_presentation`，顺序为 source、assets、publish、commit；Aftercare 的修复计划属于 `arca_shelf_entry`，按准备结果安排 `arca.aftercare.artifact.materialize@1` 和后续 Inventory Commit。七条原始 publish 失败并不等同于上面的 GETCHU Aftercare 缺陷，但静态代码存在两处后续关联：

1. `arca_series_presentation` Work 在 succeeded、failed 或 cancelled 终态，对该共享 scope 的 active Shelf Entry 引用及 `basis.entryBinding` 调用 `aftercareCoordinator.sharedPresentationChanged`。此入口以 `sharedPresentationChanged:true` 进入协调，不受普通“无 active Case”早退条件限制；仍会经过实际 Entry、其他围栏、评估与 disposition 判断。
2. `arca_ondeck_run` 成功并产生终态 On-deck Receipt 与 Shelf Entry 后，会调用 `aftercareCoordinator.reconcile(shelfEntryId)`。该普通调用在没有 active Case 等条件下可直接返回；不能推断每次都会形成 Aftercare 修复。

现有证据未证明上述七个现场具有何种 Entry 引用、实际触发哪一次 Aftercare Materialize，或已完成线上恢复。Series 修复使原 Work 能向前推进，可能改变后续可达状态；静态源码一致不能证明没有调度或间接影响。`a2bf` 到 `27a0` 的 Series IO 和 capability port 确实发生变化；`27a0` 到 `4774` 另有 Perception 和 Foundation 改动，composition 中新增的条件针对 Perception。不得因此假称候选没有改变 Series 文件处理，也不得把这一 Aftercare 复现直接判作 Series 补丁新引入的回归。

附带的早前 Linux Series 隔离 Host 记录，覆盖一次人为构造的终态失败、人工 POST 重试和不可读 producer alias：1 PASS / 29 个名称过滤 skip，保留旧失败历史、三项共享资料和一次 On-deck Commit。它不是 NAS 资格，也未记录完整 Aftercare 调用谱系或七条线上任务结果。

## 既有原型记录及未完成限制

早期 Aftercare Stage 方案中，“持久 Stage 证据加仍匹配的同 inode 别名即可跨重启证明连续”的判断**不成立**。隔离真实文件测试曾在完整删除并重建后观察到 inode、size、mtimeNs、ctimeNs 及 Physical Material Key 均与旧快照相同，但原型仍选择 `replay_publication`；对应 v3 集合为 36 PASS / 1 FAIL。该现象不能据此推断特定 NAS 文件系统行为，但足以否定只凭这些快照证明文件对象连续。

后续 v5 原型在独立 Linux 文件及**合成 Foundation/Arca SQLite fixture** 上记录 41 PASS / 0 FAIL，包括外来目标、Stage、作用域伪造和多处进程中断；它在失去进程内描述符时对未提交物化和清理保守保留，已提交历史 Receipt 也不声称当前目标现实。其运行时源码没有作为不可变版本随该次日志冻结；这些数字只能作为探索记录，不能作为正式 Host、所有崩溃恢复、CIFS 或发布通过。保守策略对跨进程恢复可用性的影响及可向用户操作的 attention 路径仍需设计与验证。

原型使用的 SQLite trigger 不能照搬到正式库：现有 Foundation SQLite catalog 不接受未登记的 trigger。新增两张 Arca 表也会改变当前 239 表 Schema；正式合同、Owner 事务、升级/回滚、未完成 Effect 和证据的保全均未完成，不能混入现有 Series 候选。主整合另行记录的 CIFS 文件发布/恢复隔离测试中，实际文件用例未通过；本地 Host 或合成 fixture 的结果不能作为 NAS 资格。CIFS 挂载身份需按 Platform 的稳定挂载指纹和 revision 处理，不能把跨重启 `dev` 当成稳定持久身份。

On-deck Stage 外部预占的另案只证明另一处 Stage/Manifest 问题，尚未证明 Control 或 On-deck Commit；不能把其结果与本 Aftercare 误收编合并。最终版本的完整发布门禁、精确 UI 复核及七条任务线上恢复验收由主整合线程负责，本记录没有完成或替代它们。

## 随提交保存的原始隔离证据

以下文件为原始输出或原始只读摘录的逐字节副本，均为隔离测试数据；SHA256 可用于核对。Host 夹具注入器 `jav-preexisting-target-diagnostic.cjs` 的 SHA256 为 `435b1bc1396a2c08ab9383d0989faeaf7e3fb97ab0ee5b4d10574e4fe1663a5b`，原件及保留的 fixture 位于本工作区 ignored `.codex/continuity-evidence-20261029/`。

| 文件 | SHA256 |
| --- | --- |
| [a2bf Host](aftercare-external-host-20261029/a2bf-host.txt) | `5c1a7f8e9a29dd2c91f0eeb6b302bbdeb6e0287e8875f7a50d806b22cc6dd248` |
| [a2bf DB 摘录](aftercare-external-host-20261029/a2bf-inspect.json) | `93eca643f1eff24c9bb68160814edcd8addfdecb5a588b6c17dbe7128ca75eff` |
| [4774 Host](aftercare-external-host-20261029/4774-host.txt) | `d9fcbcee3467dfba1c89f2cd4e2611ba2f9f49be95ac383c535891f247ebd67f` |
| [4774 DB 摘录](aftercare-external-host-20261029/4774-inspect.json) | `8c21eed9b7dcd180d74fa1a952e6cc92d8ef5f40cef732c38080fb0217c23b71` |
| [Series 人工重试 Host](aftercare-external-host-20261029/series-manual-alias-host.txt) | `4580a55d783e3c58abcf8c1e6eb571c664a7c4893f38d9f851767e88a0b5dbfa` |
| [原型 v3](aftercare-external-host-20261029/prototype-v3.txt) | `4009ad8572e99d45c57a21327272ffd3600c5feaf17b54c59a7528391ae4f949` |
| [相同快照重建观察](aftercare-external-host-20261029/reused-snapshot.txt) | `454c753cfed4e1a7b370f5ce683ec7d120c1a9d1da3a62cbfadac59e1f5d1631` |
| [原型 v5](aftercare-external-host-20261029/prototype-v5.txt) | `13b6b9fd52aa0ce53fd6a7520f99bfd1f2febbd4394643d80995d0abdf7e4fe2` |
