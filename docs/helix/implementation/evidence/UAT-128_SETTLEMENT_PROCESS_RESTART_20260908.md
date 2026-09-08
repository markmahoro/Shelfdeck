# UAT-128：同路径跨角色旧字幕的进程恢复验证

2026-09-08 22:44；实现基线ad7ba26df。原场景与旧证据见USER_ACCEPTANCE_TEST_ISSUE_LOG.md §125，当前边界见SSOT UAT-211及总表128。原代码修复不变，本批补恢复证据。

## 已验证

在本地临时目录创建真实旧ASS字幕及相同内容、不同物理身份的最终字幕；旧tuple同时保留offload:related_input和product:subtitle。使用生产Settlement Capability、真实SQLite Kernel与持久Approval，子Node进程执行：

1. 仅Product Binding、两个offload Binding均返回HANDLE_INVALID；旧文件存在，Approval active。
2. 合法双角色通过Effect检查，删除旧字幕后、消费Approval前强制process.exit(73)。最终字幕物理身份不变，Approval仍active。
3. 全新Node进程重开同一数据库，读取原冻结上下文/Handle，完成原范围Settlement并消费Approval。
4. 再次新进程重放返回完全相同Result/Evidence。
5. 在原路径创建后来出现的无关字幕，已消费Approval重放返回REPLAY_REALITY_CONFLICT、retryDirective=never；新文件与最终字幕均保留。

命令：`node --test media-service/test/helix-architecture/p15-aftercare-settlement-approval.test.js`，25/25通过；本地日志`.codex/uat128-restart.log`。初次复用旧单元fixture暴露缺Shelf Entry FK，已补测试父行而未绕过启动完整性检查；负向结果按正式typed failure断言，非异常退出。

## 证据界限与下一步

这是Capability/Approval真实进程恢复，输入Owner上下文采用冻结fixture；不等于整个生产Host的自动恢复Canary。2026-09-08 22:44只读刷新70条收藏，未匹配到原《短暂和平》条目；当前仍2个正常Libra任务、1个FFmpeg、0活动Case。不能为了重现旧现场创建生产Case、Reset或重启在飞任务。

UAT-128维持开放；剩余精确工作为隔离完整Host形成同tuple旧义务，在Inventory提交后、Settlement未落Result的窗口重启并由运行时自动收口，同时核对当前Inventory和真正未完成义务检查。现有已完成Settlement排除由211独立证据承接。没有修改生产媒体或数据。
