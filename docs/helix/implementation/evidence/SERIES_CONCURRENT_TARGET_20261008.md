# Series 并发 Run 与目标预约证据

2026-10-08；对应 CURRENT_PHASE 的并发 Run / 同 Season 落位工作项。承接 `37521a59c`，本批不关闭 Series Phase，不声明可部署或生产发布。

## 实现与边界

Libra 已在 checkpoint 保留各 Run 的冻结 Episode 范围、Spec dependencyRef 与执行 Basis；本批保留这些行为并贯通后续 Arca 落位。两个独立 Field 同时观察显式 Series anchor，进入一个 Subject、两个非重叠 Run。Acceptance 可以并行；物理落位按 Final Inventory Decision 的精确 Endpoint/location 协调。

Arca Owner projection 在目标被其他 Run 预约时返回通用暂不可用输入，不创建物理 Slot。Owner 在首次 offloading 事务中再次检查占用并写 `target_reserved_at_ms`，随后才执行 Slot 副作用。预约跨 blocked / 数据库重开保留，Commit 后失效但历史时间保留；尚未取得预约的 blocked 不阻塞其他 Run。恢复重新验证同目标持有者；不同 Endpoint 或不同 location 可独立推进。没有放松 Material Control 或允许两份 Custody 共持共享海报。

现有 `(state,created_at_ms)` 索引查询未终结 Run，再精确读取其不可变 Decision；不扫描已提交历史。未知目标责任冲突显式拒绝。预约写入失败与 offloading 状态转换同事务回滚。

DDL digest：`f1016a2c9f4a314554c7a9863a487e4874ec77f93e6010c51fbb281b4204c2cb`。从上一精确 schema 升级只增加 nullable 预约时间，已提交历史不补造预约。存在未完成 On-deck Run 时明确拒绝升级，要求另外获得授权的 Formation Reset；本批未执行 Reset。升级失败回滚、重放、已提交行保护和新 Kernel 启动已验证。

## 验证

- 预约专项 5 项通过：同目标互斥、不同目标独立、未预约失败不阻塞、重开后持有、恢复竞争、预约写入故障回滚、Owner 输入等待无文件效果、已提交 schema 保护与未完成升级拒绝。多个断言归属同一测试，不累加。
- Owner context / bounded settlement / 预约早期专项 9 项通过；最终预约与 P2 摘要复验 8 项通过，集合有重叠。
- 除 Series Host 文件外的架构回归 2,057 项：2,047 通过、9 既有 skip、1 固定摘要断言失败。更新 schema 对应摘要后，该文件与预约专项 8 项全部通过。未把首次全量结果写成全绿。
- 独立并发 Host 在调整等待窗口后通过，约 93.4 秒。真实 Foundation / Owner / SQLite / 文件落位；Provider、媒体探测及 Playback 为隔离替身，文件为测试字节，不是 FFmpeg 真实媒体验收。两份 On-deck Commit Receipt 指向唯一 Season Entry 的不同 Inventory revision，当前 Primary 精确覆盖 E001/E002/E003，两个 Run 的冻结 Basis 和 Manifest 保持不变。
- 原 90 秒并发等待窗口不足以容纳两批串行落位及既有 30 秒输入重试；读实际运行库确认前批已提交、后批等待正常 Approval，无失败 Attempt。窗口调整为 150 秒；没有改短生产重试或跳过结算。断言改为精确 Commit Receipt，而非会被 Aftercare 推进的全局 Deck Fact 数量。
- 最终完整 Series Host 文件 20 项全部通过（343.5 秒），覆盖 2/24 集、无claim补集、显式anchor顺序补集和并发补集；并发项93.3秒。最终代码的预约写CAS断言由追加专项复验覆盖。
- 架构边界与语义检查均无 findings。
- P2 无 findings，aggregate `bb80bf108665bc5132634f3bb33535379132d6e83c18bd99347bbaff01157fb1`；`git diff --check` 通过。

历史迁移测试扩展检查：6 文件 27 项中 18 通过、9 失败；全部失败来自 `helix-uat-schema-migration.test.js`。使用 `HEAD`（`2d85620f3`）的 migration 模块、DDL 和 manifest 做隔离 preload 复现同一文件，仍为 2 通过 / 9 失败。其中旧 fixture 用当前 DDL 伪装早期 schema 导致重复建表；两项要求 already-current 自动退役，与当前保留行为不符。此次未修改这些历史测试或恢复自动退役，作为发布前必须处理的验证缺口保留。当前精确旧 schema 的预约升级由本批新测试独立覆盖。

日志在工作区外 `E:/my_project/helix-git-consolidation-20261008/series-target-*`、`series-concurrent-target.txt`。本批不涉及 UI；没有 UI PASS、Linux/真实媒体、生产升级或回退结论。

## 后续

继续逐成员 Remux/Transcode、N:M 最终空间证据、重叠/重复/真实 Host 恢复、共享材料运营及 Series 页面；必须补真实媒体/Linux、历史迁移测试有效性、冻结版本 UI 接受及发布资格。首个可部署版本目标保持进行中。
