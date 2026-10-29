# Series 并发 Intake 门禁诊断（2026-10-29）

## 范围与结论

主整合线程在 Linux 完整架构门禁的 1081 视频 Procurement Host 用例中观察到一条 `P8_ACCEPTANCE_CONTINUITY_BASIS_STALE`。原测试对 `fx_event_attempts` 中任何非空 `failure_code` 均断言零条，但该表保留不可变历史 Attempt；SSOT 的 Handoff A Accepted 故障注入合同要求 continuity 竞态使 Decision 失效时重新装配，而不是抹除失败记录（`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md` 8.9.7 的 Handoff A Accepted 矩阵及 Subject Continuity Global Head 定义）。

生产基线 `a2bf2d6fd3271dc3a3741e28ed42f533a59d99d4` 与 Series 候选 `1d8a45843f9c8982c91bb0a367eb0adfa1c5c310` 的原测试、Libra Intake planner、continuity resolver、acceptance contract 和对应 Owner replan 分支字节一致。候选其他 Foundation 改动仍可能影响执行时序，文件未改动本身不证明不存在任何间接影响。

首次门禁仅保留失败 Event ID、错误码和 evidence digest，测试清理了当次临时数据库；因此不能证明该**具体实例**后来已收敛，也不能由后续通过抹除原失败。下面的隔离复现证明，同一错误及 digest 可以来自合同允许、最终成功的真实跨 Subject 竞态，足以说明原有“历史失败必须为零”判定与该合同不一致。

## 独立 Linux 对照

- 原样 `1d8a45843f` 1081 文件用例，在独立 Linux 容器、主线程门禁同时运行时为 1 PASS / 0 FAIL；测试约 60.2 秒、进程约 74.3 秒。原样主线程单项重跑也为 1 PASS / 0 FAIL。两次通过均不能还原首次失败的后续状态。
- 对基线及 `1d8a45843f` 各构造独立诊断快照：三个不同 Show、每个 20 集；仅在测试副本延迟首个真实 `intake-accept` 15 秒并记录状态，不伪造或改写 Decision、Owner、Effect 或 Result。两次均见冻结 head revision 0，而投影时 head 为 2；候选为 `new_subject`、无 continuity claims、Episode 范围为 20 集。
- 两次都产生与首次门禁相同的错误码和 evidence digest `0d050ee412d65e73b2816800231d182a942a2ffc26a62eeec5eb7deabeb7e267`。失败 Event 的 Effect 和 Result 均为 0；原 Work 的 ordinal 1 失败、ordinal 2 成功，Work 最终 succeeded，失败 Attempt 保留。各自 60 个源文件存在、foreign key 检查为空、SQLite integrity 为 `ok`。诊断副本保留了原零失败断言，因此两次有意显示 FAIL；这不是宣称原门禁通过。
- 候选诊断快照中，另外两个 Show 的真实 Accepted Decision 分别将 head 从 0 推进至 1、从 1 推进至 2；被延迟的第三个 Show 重规划后从 2 推进至 3。其独立 Subject、20 个 Binding、20 个 Episode、20 条同一 commit marker 的 Procurement → Libra Control transfer 均可在保留的隔离数据库中对应。原诊断结束时第三个 Procurement Delivery 仍 open、Outbox pending；该诊断只证明 Libra Work 成功，不声称该时点跨域消费已完成。

## 测试修正与负例

`procurement-category-host.test.js` 保留 1081 个不同物理成员、65 个 Season Candidate、两个有界 Run、数据库完整性等原断言，并逐个校验源文件内容。对每条失败 Attempt，只接受满足以下全部条件的历史 stale：输入投影失败、精确 Libra Intake Acceptance Work、失败 Event 无 Effect/Result；同一 Work 的更高 ordinal 成功；成功 Event 与 Effect、Result、commit marker、Decision、Receipt、Subject、Candidate 全部对应；Episode scope、所有源 Binding 和历史 Procurement → Libra Control transfer 精确一致；Procurement 消费同一 Handoff A Receipt 后，完整 Selection 均为 `transferred/handoff_accepted`。任何其他失败、未收敛、额外 Effect/Result 或责任不一致均失败，等待期间继续检查 runtime error，并输出被验证的历史记录身份。

`procurement-continuity-replan-host.test.js` 使用仅存在于测试进程的 Event 调度屏障，使另一个真实 Subject 先推进 head，再释放被冻结的 Acceptance。测试等待三个不同 Subject 的 Handoff A 全部被 Procurement 消费，核对各自全套责任链、源文件内容及数据库完整性；还用只读查询替身验证未知失败、额外 Effect、额外 Result、失败 Work、缺少后续成功、错误 Subject Binding、不完整 Control transfer 和不完整 Selection 均不能通过。屏障续租只是维持人为暂停期间的技术 lease；没有生产代码或 Owner 边界变更。

## 本机验证与限制

在上述基线/候选快照之外，测试代码先叠加于 `7265d4b5ec4077cb21152219a9a53e85a97ac3f9` 的隔离工作树，以 Linux Node 20 和容器私有临时数据执行：

```text
node --test --test-concurrency=2 \
  test/helix-architecture/procurement-category-host.test.js \
  test/helix-architecture/procurement-continuity-replan-host.test.js
```

- 一次组合重验 2 PASS / 0 FAIL，约 38.2 秒；1081 文件用例自然产生一个 `intake-binding` stale，测试验证其恢复及完整责任链后保留并输出其历史记录。受控样本 head 0 → 1 → 重规划 head 2，旧 ordinal 1、成功 ordinal 3。
- 最终文件组合重验 2 PASS / 0 FAIL，约 37.2 秒；受控样本 head 0 → 2，旧 ordinal 1、成功 ordinal 2。仍出现已知 `MaxListenersExceededWarning`；未据此推断泄漏或因调高阈值掩盖。
- 将同三份测试文件叠加到主线程精确候选 `bc4f5c952849ed6079baedde159ddaa5ce1d39c1` 的独立源码快照，并使用其 Linux 镜像重跑相同命令：2 PASS / 0 FAIL，约 37.0 秒；受控样本 head 0 → 1，旧 ordinal 1、成功 ordinal 2。此项是定向兼容性验证，不是对原门禁样本的追溯。
- 没有访问或修改 NAS、生产数据或主整合工作树。这里的定向结果不代替最终整合提交的完整发布门禁，也不代替七条真实任务的线上恢复验收；后者由主整合线程统一执行。

原始输出保留于该任务独立工作树的忽略目录 `.codex/continuity-evidence-20261029/`；主要日志 SHA256：

| 日志 | SHA256 |
| --- | --- |
| `candidate-original.log` | `3e4812bf97dc9baff12092878965862372efd07d8349e112a24a500f85a302db` |
| `baseline-forced-race.log` | `07ce2157549ecf737e89f3618e66af203e3679bedee39c15a79528f0b22c87dd` |
| `candidate-forced-race.log` | `de4df4a5165967809ad7715d5b665543eb0b85f5bace199d79423366269436b6` |
| `linux-final-tests.log` | `516df0538aacfe4c62e3f579dec79c6a28a06b23919dcfefc0cc34c245437013` |
| `linux-final-tests-v2.log` | `e8cb3de5d8a407b7071fd8122885c5c2550fc9065a2593f95ccc6a14cc4bdb78` |
| `linux-bc4-tests.log` | `2723fca98c7c9c9d789c8eecbc04170795b079d0c0871e2d722c94c786b34765` |
