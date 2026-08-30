# ShelfDeck Helix 当前实施阶段

状态：**PROD-034 ACTIVE — ONE-TIME ABORTED HANDOFF CORRECTION**

日期：2026-08-31

## 目标

对“唐人街探案 (2015)”和“赤壁（上） (2008)”执行一次性生产数据纠正：保留既有失败执行与 Handoff 审计，终止继续恢复这两个已 `discarded` 的 Libra Run，释放其 Arca Custody、Material Control 和 Binding，并移除可重建的陈旧 Formation Projection。

## 边界

- 只允许命中已冻结的两个 Subject、Libra Run、Package、Offer、Custody 和 On-deck Run ID；任一关系、状态、数量或执行终态变化都必须 fail closed。
- 不删除或改写既有 Handoff B Accepted、Libra Package、Supporting Work、Attempt、Event、Effect 或 Final Inventory Decision 历史。
- Material Control 以带 `PROD-034` basis 与 commit marker 的新 `release` revision 收口；Custody 与 Binding 只转为 `released`。
- Formation Projection 是可重建读模型，可删除这两条陈旧行；运行时按 `discarded` Run 重建为“等待重新入库”并从 active section 隐藏。
- 不删除、移动或改写 `/media` 或 `/transcode` 文件；不引入恢复 fallback、双路径或长期兼容行为。
- 生产写入前必须重新执行 fnOS preflight、标准部署 dry run、镜像 checksum 校验与完整 data backup。

## Exit Gate

- 一次性工具的成功、幂等与 active-Attempt 负向测试通过；正常 Arca Inventory / Context 回归通过。
- 服务、Architecture、Admin Web tests/build、SQLite integrity、image checksum、NAS health 通过。
- 生产后两个 Custody 为 `released`，7 项 Material Control 为 `released`，35 条 Binding 不再 active，两个目标无活动 Attempt。
- Formation active section 不再出现这两条；此前 3 条待整理记录继续不受 global active-Attempt hard cap 阻塞。
- 通用 Arca 恢复兼容路径已撤除，仓库工作区与当前文档收敛。
