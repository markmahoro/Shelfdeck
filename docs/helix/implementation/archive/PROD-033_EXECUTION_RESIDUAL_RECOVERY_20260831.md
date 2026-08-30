# PROD-033 — Execution Residual Recovery

状态：**COMPLETE / DEPLOYED**

日期：2026-08-31

## 目标与根因

生产中的部分 Work 已进入终态，但其 Attempt、Event 和 Effect 仍停留在活动状态。这些执行层残留持续占用全局 64 个 active Attempt 名额，使新的合法 Work 无法获得执行容量。根因是历史终态收口没有原子地覆盖全部执行派生记录，而后续恢复又只观察 Work，未识别这些孤立残留。

## 实施

1. 修复执行残留识别与终态收口，使终态 Work 下的非终态 Attempt、Event 和 Effect 可被有界恢复。
2. 增加生产专用 dry-run/apply 工具；写入前冻结目标集合、校验关系与状态并执行完整 data backup。
3. 一次性收口 39 条 Attempt、52 条 Event、2 条 Event Attempt 和 2 条 Effect。
4. 恢复后执行残留为 0，新 Work 不再被历史 active Attempt 占满全局硬上限。

## Exit Evidence

- Source commits：`a29f83477`、`5a6f09a19`。
- Backup：`/vol1/1000/docker/shelfdeck/data.backup-20260830T175325Z-prod033-execution-recovery`。
- Recovery：39 Attempts、52 Events、2 Event Attempts、2 Effects；post-check residual 0。
- SQLite integrity：`ok`；未删除、移动或改写 `/media`、`/transcode` 文件。

后续为两个已 `discarded` Libra Run 尝试的通用 Arca 恢复路径不属于本阶段的执行残留修复，并已在 PROD-034 中完全撤除。
