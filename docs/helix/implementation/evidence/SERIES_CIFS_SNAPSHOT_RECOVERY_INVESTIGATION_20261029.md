# Series CIFS 稳定快照与 Effect 恢复诊断（2026-10-29）

## 已知事实与边界

主整合线程的真实 NAS CIFS 隔离重测中，`series-shared-presentation.test.js` 为 8 PASS / 8 FAIL；八个失败均为 `PHYSICAL_MATERIAL_STAT_FENCE_CHANGED`，栈位于 Series `writeExact` 的 producer temporary 完整快照检查。该路径先新建并写入私有 `.partial`、fsync/close，再逐项严格核对路径与文件描述符的 inode、size、mtimeNs、ctimeNs；首次不一致时尚未通过该步骤进入 `linkSync`，但临时文件已可能存在，不能称为“无物理副作用”。

一次另行探针在 0ms 观察到路径和 fd 的 mtime/ctime 不一致，100ms、500ms、1000ms、3000ms 样本读到一致数值；这只说明该样本后来稳定，不能证明其他文件、真实 Host 或本次线上任务必然收敛。主线程随后一个真实布局 Host 样本因首次 runtime error 而中断，尚未到达 Series publish。其测试私有 DB+WAL 副本只读查询中唯一未完成 Event 是 `arca.acceptance.accept.commit@1`，Attempt executing 且无 Effect 行；异常日志未保存 eventId/effectId，不能据此将该错误归因于 Series Presentation 或证明其他文件无副作用。

`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md` 2026-10-28 Series 恢复条款要求：稳定快照暂不可得时为 `unobservable`，只重观察原 Effect，不派发 Capability、不伪报 absent/matching；超过同一持久恢复预算时可以终结未提交技术 Effect，但物理结果仍未知，业务责任与历史必须保留。当前 Host 的默认恢复重查间隔为 30 秒。代码顺序为 Event Attempt、Effect intent、Capability dispatch；缺 Effect 的特定 Event 不证明其他 Event 的物理状态。

## 本地合成测试

对 `bc4f5c952849ed6079baedde159ddaa5ce1d39c1` 的隔离源码快照和 Linux 镜像运行。该候选与主线程后继 `27a0f68af` 的 Series IO、bounded snapshot、Effect/Host runtime 和原 Host 测试文件字节一致；这不是对后继候选完整发布门禁的证明。

- 真 Host、真实 SQLite、Docker 本地卷与 tmpfs 两个不同 `stat.dev`；不是两块实体磁盘，也不是 CIFS。仅在测试进程模拟某个实际文件的前两次 fd mtimeNs/ctimeNs 比路径早约 88ms：第一次发生在 `writeExact` 完整读取前，第二次发生在原 Effect 的 `observeWrites`；不改写生产代码或业务状态。
- 首轮 Workspace 诊断在约 30 秒后观察到稳定并使原 Effect/Attempt 成功，约 62 秒后已出现 Shared version 1、On-deck Receipt 1、FK/integrity 通过；但原 Host 固定要求 Provider 调用四次，恢复按冻结的两个资源再次读取后实际六次，故该诊断最终 **FAIL**。这个失败保留，不计为通过。
- 明确验证每次 Provider operation、资源角色和冻结路径后的隔离诊断分别覆盖 `workspace_write` 与 `material_commit`：各 1 PASS / 0 FAIL，29 个非目标用例按名称跳过，分别约 76.6 秒。两例均在 Observer 约 30.1 秒后再次得到稳定快照，然后才执行唯一 `linkSync`；同一 Event Attempt ordinal 1 成功、原 Effect committed。三项 Shared 角色、控制责任、源文件、一次 On-deck Receipt、foreign keys 和 integrity 均通过。Workspace 场景仅复读同一冻结 poster/fanart 来源，六次 Provider 调用；formal 场景为四次。
- 独立严格快照负例及原有相关组件用例合计 65 PASS / 0 FAIL，包括读取前 mtime、ctime、inode、size 不一致、读取中 mtime/ctime 变化及读取后路径 ctime/inode/符号链接变化；不一致时拒绝，稳定后完整读取成功。Series Observer 测试副本专门增加 `PHYSICAL_MATERIAL_STAT_FENCE_CHANGED`，验证 Workspace 和 formal 两种观察均返回 `unobservable`。这些均为本地合成或本地文件系统结果。

## 真实 CIFS 隔离复验方案

仅由主整合线程在生产资源允许的窗口执行，使用最终精确候选的 Linux 镜像。测试只用新建、独占的两块临时区域：本地 scratch 位于与实际 Workspace 同类的文件系统，CIFS scratch 位于与实际正式目标同一 share/root/mount options 的单独空目录；二者必须为不同 `stat.dev`。不挂载生产数据库、真实源片或现有收藏。先原样重跑 16 项直接 IO，保留通过/失败结果；再运行不注入故障的两集跨设备 Host 诊断。仅当每条运行时 stat 告警均绑定原 Event/Effect，所有相关 Effect 最终收敛且三项共享资料、原材料、Control、唯一 On-deck Receipt、foreign keys 和 integrity 均闭合时，才记录 Host 成功；自然样本无告警时，只证明普通路径成功，不证明故障恢复。

诊断副本记录 Event/Effect 身份、每次分类与 Evidence digest、path/fd 的 dev/inode/size/mtimeNs/ctimeNs（路径只记 digest），并延长测试观察窗口到最多 300 秒；未知错误、缺关联、Work 未收敛和不一致仍失败。设置保留环境变量后，测试在完成或失败时保留两处精确测试根、SQLite/WAL 和文件，不手工清理 `.partial`，由主线程在取证后按其测试目录政策处置。不得将该诊断副本的通过当作 16 项原始用例通过。

上述不注入故障的诊断副本以 1 CPU、768 MiB 上限在本地不同文件系统完成 1 PASS / 0 FAIL、29 项按名称跳过，约 49.8 秒；自然错误 0、记录 1723 条 stat、Shared version 1、On-deck Receipt 1。随后单独使用本地测试注入器验证诊断工具对确切 Effect 的追踪，也为 1 PASS / 0 FAIL，记录 `observe_again → continue_forward`；该注入器不用于 NAS 自然资格。此前该诊断生成器的两个早期本地试运行分别因脚本变量/语法错误失败，日志保留；两次均为测试夹具错误，不计入通过。

建议单容器限 1 CPU、768 MiB 内存，本地及 CIFS scratch 各预留最多 1 GiB。直接 IO 原样样本约 3 秒；连同准备、一个 Host 及必要的 30 秒重观察，预留 5–10 分钟。实际环境持续不可观察可能超过此范围：测试达到上限保留现场并报告，不强行重试、删除、归类为 absent 或推进发布。资源上限不是实际消耗的保证；主线程以生产可用内存和负载决定窗口。

本任务没有连接 NAS、访问生产数据或更改主整合工作树。真实 CIFS 原 8 项失败、Host 中断、完整发布门禁及七条线上恢复验收均保持开放。

## 本机原始输出

日志与诊断生成器位于独立工作树的忽略目录 `.codex/continuity-evidence-20261029/`，可由主整合线程只读复制；关键 SHA256：

| 文件 | SHA256 |
| --- | --- |
| `linux-synthetic-cifs-host.log`（首轮 FAIL） | `f4a712038d42bfdade28ea2cf9554faca0824ea0ed0da93be41701e799663c41` |
| `linux-synthetic-cifs-workspace.log` | `fe46eae85b1852b4b37f024194b0c62982949117fe62b3f39ced740fdfcb1abd` |
| `linux-synthetic-cifs-formal.log` | `66c12129b679b8da1cbd3418f3d7b16915a6a711316ec219cb5446173688ddb5` |
| `linux-cifs-fence-negatives.log` | `fd300cf23ade6a136997f80e1e8194e532b116b0bbfdc5f4adcfbd4935258230` |
| `prepare-cifs-observed-host.cjs`（不注入故障的诊断生成器） | `aabf51edf1455a292c90f368344029c5e7c04fc033fec3d0ec9ead0fc480a9fc` |
| `linux-observed-harness-natural.log` | `6d28453ec66e97375b4c62c422c1833cfebf3013274dfc597c80bb9cf6ed7578` |
| `linux-observed-harness-synthetic.log`（工具自身的合成验证） | `cc1267b41a499540b9a9f090ba89ea10009a507b302d65e8104e8685e579cd9e` |
