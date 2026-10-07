# 《太阳帝国》On-deck 只读诊断

日期：2026-09-10。范围：生产只读取证与精确生产源码审阅；未实施、部署、重试或修改生产文件/数据库。

## 结论

生产 BDMV Input Settlement 将逐文件授权与整盘 leftover 清理混用，造成部分已完成文件删除后的技术失败；另一组文件被原盘未纳入处置范围的目录阻塞。上架没有 Commit，不能当成正常完成。拒绝范围外删除的授权检查应保留。

## 精确身份

- Running image：`markmahoro/shelfdeck:helix-beta-20260909-7ceaeca7fb`
- Image ID：`sha256:12db15cbc07e12becd793b20cb0f1270e03ec29241ddab05f4dde42d8152eb83`
- 审阅源码：Git `7ceaeca7fb`；与当前工作区 HEAD、2026-09-03 Current Status 的旧生产记录不同，不能用工作区代码代替生产代码。
- Subject：`libra-subject-83b9fdc57b82ee02788eb53ab9038c335eecf332`
- Package：`f12303b4d76914b2beabeb4ffcccedd24f52893120686c324acbe7f94b995c9e`
- On-deck Run：`28c2d89e239b3e6d50bbbcdaeafe37fb5e04685fe9a1aa1c68238863d673fbb9`，`blocked`，Commit receipt count = 0。

## 已确认事实

Libra 转码、产品验证、Arca Acceptance 均成功。最新 final-product verification 为 `passed`，reasonCodes 为空。
正式目录 `/media/Film/太阳帝国 (1987)` 中七个产品文件均存在。MKV 为 7,888,988,781 bytes，其与五张图片的 size / bounded fingerprint 均匹配 Package。NFO 为 6,675 bytes，与最新 staged Physical Identity 的 size / fingerprint 精确匹配；它与 Libra 原始 NFO bytes 不同，不能据此误报损坏。

旧输入根为 `/media/Film/太阳帝国 (1987)/太阳帝国 (1987)`。最新 settlement Event 后缀为 `ffe235b0a3ecb9b50e`：

| 后缀 | 输入（相对旧输入根） | 最新状态 | 现场 |
| --- | --- | --- | --- |
| 0001 | BDMV/CLIPINF/00042.clpi | APPROVAL_STALE | 原文件已不存在 |
| 0002 | BDMV/index.bdmv | UNKNOWN_MEMBER | 原文件仍存在 |
| 0003 | BDMV/MovieObject.bdmv | UNKNOWN_MEMBER | 原文件仍存在 |
| 0004 | BDMV/STREAM/00042.m2ts | APPROVAL_STALE | 原文件已不存在 |
| 0006 | BDMV/PLAYLIST/00100.mpls | APPROVAL_STALE | 原文件已不存在 |

其余六项（旧 NFO、poster、clearlogo、banner、fanart、landscape）settlement Event succeeded，旧路径不存在。三轮执行均重复上述五项错误。

## 根因链

1. `clean-arca-inventory-port.js@7ceaeca7fb:1912` 的 async 路径先检查当前文件父目录。`index.bdmv` 与 `MovieObject.bdmv` 的父目录为 BDMV；`BACKUP`、`META` 不在 managedLocations 及其祖先集合，故拒绝。
2. 上述具体名称由持久化、digest 验证通过的 failure evidence 确认，而非仅从现场推测。Evidence digest：`34e490d0674011771b246e3cad4ab534ef0061f06cdd07840035cb2bfb4f2810`；unknownNames 为 `[BACKUP,META]`。
3. 另三项位于 CLIPINF/STREAM/PLAYLIST。该判断允许 BDMV 内的额外普通文件，因而先处理精确 source，然后进入整盘 `listBluRayDiscTrees` / `listFilesRecursive` leftover 循环。
4. `clean-arca-inventory-port.js@7ceaeca7fb:1964` 对不在 allowed 集合的 leftover 调用 `assertCurrentApproval(leftover)`。现场按同一只读枚举规则得到的首项为 `BDMV/index.nfo`，共有 246 个范围外剩余文件。此数量仅描述当前现场，不证明其历史来源或全部业务归属。
5. `on-deck-capability-ports.js@7ceaeca7fb:190` 要求 location 必须等于当前单个 member.materialHandle.location。因此 leftover 必然越界，抛出 `Deletion exceeds the exact approved member.`；:199 将它统一包装为 `ARCA_ONDECK_SETTLEMENT_APPROVAL_STALE`。
6. 因失败发生在 source 删除之后，Event 不会产出成功 Settlement Evidence。重新执行时 source 已不存在，但仍进入同一 leftover 循环，再次失败。两个 UNKNOWN_MEMBER 则在删除前失败。最终五项不能终态，阻止 On-deck Commit。

这里的 “stale” 不等于按时间过期，也没有证据显示用户撤销了授权。精确的底层异常字符串未被持久化：`failure-diagnostics.js:13` 的白名单不保留包装时的 `details.reason`，对应 evidence `2e3395064b5954feca8329293a9b1ebe862bcbe5f73258bf5462d0efbc7ad8b7` 只有空 diagnostics。越界链由生产源码与现场路径证明；不冒充读取到了缺失的历史异常详情。

## 合同、测试与影响

- SSOT BDMV main-title amendment（约 241–264 行）区分 selected title 与 non-primary title；选主片不产生整盘删除权。
- SSOT 5.8.7 的精确 Settlement Approval 与 10.10.2.1（约 14846–14864 行）的逐成员终态要求，均不允许用目录存在隐式扩大 Scope。空目录也不在本轮 Formation 的隐式授权范围。
- 当前阻断与拒绝越界是必要保护；将单文件处置尾部扩展为整盘清理是实现问题。UNKNOWN_MEMBER 保护不能简单删除；BDMV 已观察但不属于本次处置的内容，与真正的未知/变化内容需要依据 Owner 正式事实区分。
- 生产版本 `clean-arca-inventory-port.test.js:1080` 等测试明确期待删除 unplanned STREAM/CERTIFICATE，且调用同步 `settleInput`、传占位 approval，没有生产 async 路径的 exact approval callback。这些测试固化了整盘清理假设，未覆盖实际授权冲突。此处为测试源码审阅，未运行测试。
- 历史上另四个 Run 出现 UNKNOWN_MEMBER，但当前均 committed；当前查询中只有《太阳帝国》仍 blocked。不能将四条历史失败报成当前事故，也不能据此断言其他 BDMV 输入均安全。

## 后续修复应满足的边界

Arca 保持精确成员授权，移除隐式扩大到整盘文件/目录的效果；BDMV 剩余范围须依正式 Scope 判定。补充 async capability + 真实精确 Approval 的隔离验证，覆盖 BACKUP/META、非主片、source 已删除但 Evidence 尚未提交，以及三次执行收敛。错误诊断应使用安全的 typed reasonCode 区分越界与授权事实变化。

本报告不授权生产恢复。现场已存在删除效果，不能盲目 Formation Reset 或重跑原盘流程；任何恢复都应先冻结该条目的现有最终产品和未提交 Settlement 事实，并适用当前 Gate。未修改 SSOT、Current Phase 或实施代码。
