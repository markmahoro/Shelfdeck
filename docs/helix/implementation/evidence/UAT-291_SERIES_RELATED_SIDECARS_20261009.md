# UAT-291：逐集关联文件交付与旧季目录残留

2026-10-09 用户发现《棋士》上架后同时存在 Season 1 与 Season 01，希望逐集 thumb 作为 sidecar 带入新目录。

只读现场：旧 Season 1 有 22 张 `*-thumb.jpg` 和 22 份逐集 NFO；新 Season 01 有 22 个 MKV、23 份 NFO 和 1 张图片。本次 Off-load Context 只有 22 个 carried_forward original_input，遗漏关联文件。未改动现场文件，未 Reset。

根因：合并整季 Candidate 的 relatedScope 使用 `@candidate`，Candidate Reader 把标记直接当作目录查询，未展开冻结 Primary 的真实父目录。Related 重建还按父目录取首个 Primary，不能正确绑定多集 NFO/thumb。已有字段命名对 generic sidecar 保留旧名，缺少正式 Primary 映射。

用户已确认：

- Arca 仅在完整交付及结算后清理已记录的旧 Season 空目录；不得递归、删除母目录或最终目录，有未知残留保留。
- Libra 将关联文件的原 Primary 和最终视频映射交给 Arca，thumb 按最终视频名命名，并持久保存用于迁移；一对多或歧义明确待处理，不猜集数或复制分配。

进一步审查：Arca 已有 On-deck Commit 后 source cleanup / recycle 检查机制，空目录可进入回收，非空目录待确认。复用此正式机制，不在单文件 Settlement 中添加目录删除。其保护范围及 Series 实际效果继续验证。

实现：修复 @candidate 物理父目录展开及逐集精确匹配；逐集 NFO 对应 Episode artifact；Package 携带正式 Primary 映射，Arca 入藏及迁移保存并校验映射，thumb 随最终视频命名。空目录复用原有后台清理，检查及物理操作为两个 30 秒周期。

验证：Windows 定向 98 项、合同/Owner 边界及 Aftercare 66 项、原清理安全 15 项通过；Movie HTTP Host 6.48 秒通过。带两集 thumb/NFO 的 Windows 入藏通过；完整迁移 91.75 秒、同目录改名 91.93 秒通过；Linux 完整入藏及空季目录清理通过（总进程109.16秒）。逐张校验字节及 Primary 对应关系、来源关联文件结算、旧空季目录消失和母目录保留。未运行本轮全架构及 Desktop 构建，无 UI 改动。

第一次空目录断言仅等待10秒，记录仍 pending revision1；按后台两个30秒周期延长至90秒后实际清理通过。迁移测试将等待清理放在全部业务动作后，保留同样物理断言；另一次等待后立即修改规则触发旧健康检查 Care Basis 规划异常，独立登记 UAT-292，不以本项通过关闭它。

本地升级副本：正式 additive migration 通过，196张原表内容摘要与行数完全一致、foreign_key_check/integrity_check通过。用户已授权直接更新本地18081；以 SIGINT 优雅停机，原服务日志确认 clean service stopped，没有强杀 FFmpeg。加载与现场复验结果后补。

UAT仍开放：已上架《棋士》遗漏的旧文件不会由本次代码自动追认，不手改 Inventory、不手动移动现场残留；新批次链路与存量处置需分别验收。
