# Perception Resolution 终态投影证据

本工作以 `4774a7e9056f644c29b8034ea07baeb4f578c4f6` 为基线，在隔离工作树中验证。UI 负责人此前以受控持久终态证明 Decision 读取为失败而评分单条和批量投影仍为 `pending`；这不是生产已发生的证据。

Perception 以当前 Query、Record Set、Rule 三项基准定位 Resolution 或对应 Work。当前基准的 Work 失败或取消时，评分和已看只读投影分别暴露技术状态，未形成 Decision Fact；只有真实提交的 `not_found` 才表示没有可用记录。Libra Acceptance Spec 将技术终态作为准备状态传递，不把它改写为 No-rating 事实。目标不可用仍返回原有 HTTP 错误形状。Formation 在终态改变后刷新投影；直接评分控件只在新命令的预期 revision 已出现时采纳终态，避免把旧输入的失败归到新命令。

批量评分查询每批最多 100 个目标，逐项重建并检查 Record Set，避免把相同 Query/Rule 的旧 Record Set 结果当成当前结果。Foundation 以精确 Work ID 分批读取状态与 Attempt；`fx_work_attempts` 的 `(work_id, ordinal)` 唯一索引支持该读取。历史标题别名与关系读取每批各共享一次，并在该次事务内建立临时索引，不缓存可变事实。每批首次读取仍可能随全部历史标题锚点和关系增长，历史规模本身无上限；这一残余成本需要在实际部署规模评估。

真实 Host 定向测试在 Resolution Commit 投影期间暂时改变公共 Target 版本，其余使用真实 Work/Plan/Event 调度与退避：同一个 Work 的 Attempt 1、2、3 全部以 `P4_EXECUTION_INPUT_BASIS_SUPERSEDED` 失败，Formation 和评分 GET 显示失败，未生成 Resolution Fact、Acceptance Spec 或该 Work 的 Commit Effect。随后通过实际评分命令增加 Record、形成新 Record Set，新基准 Work 成功，旧 Work 保持失败。测试还检查 Foundation 批量与单条状态一致、不可用目标的 404 错误形状。独立负例覆盖取消、真实空 Record Set 的 `not_found`、相同 Query/Rule 但 Record Set 变化、标题别名/关系和溢出。

实现过程中首次定向运行发现批量缓存键对无参数查询传入 `undefined` 会被 JCS 拒绝，以及旧测试 mock 的 Work ID 与实际稳定 ID 不一致；已分别修正并保留为测试依据。Windows 工作树使用 Node 25.9.0 与本机现有依赖；Linux 使用隔离 Docker 镜像 `shelfdeck-series-gate:27a0f68af`、Node 20.20.2、只读代码和依赖挂载、禁网络。100 目标、1350 条合成记录的 Windows 冷批次约 22 ms、Linux 约 27 ms；这不是生产容量基准。

上述均为定向验证，不是全量、生产 CIFS、生产数据恢复或部署资格。本次包含后端驱动的可见状态，需要用户指定的 UI 负责人审查最终集成版本。
