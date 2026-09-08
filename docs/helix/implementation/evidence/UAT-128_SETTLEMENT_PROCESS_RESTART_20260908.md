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

## 2026-09-09 03:35 完整 Host 补证与关闭

以当前生产代码95d7bb5734运行真实一部电影链：异步观察、Libra生产、Arca上架、People记录更新、NFO及海报修复、Target迁移。在迁移前关闭父Host，再由独立Node子进程通过正式HTTP发布Placement；仅拦截隔离夹具逐项枚举的旧Inventory文件unlink。

子进程确认Inventory Commit已落库、current Inventory已指向新revision、原Settlement Approval active；真正删除首个旧文件后保持在该调用边界，父进程SIGKILL。此时Settlement Event executing且没有Result，Approval仍active。全新Host不再发布Placement或发送修复命令，自动恢复原Settlement、消费同一个Approval并将同一Case收口resolved。Approval除state外逐字段不变，已提交Inventory全部行及全部最终文件SHA256不变，范围外字幕保留；旧目标目录最终清空、健康恢复，之后再次Host重启仍通过原链断言。

命令：设置`HELIX_LIBRA_HANDOFF_B_E2E_ROOT=.codex/uat215-media-fixture`与`HELIX_UAT128_HOST_RESTART=1`，运行`node --test --test-name-pattern='P14 one-movie product path' media-service/test/helix-libra-handoff-b-scenario-e2e.test.js`。80.06秒PASS，无跳过；`.codex/uat128-host-restart.log`。最初两轮夹具失败分别是子进程缺保活及测试读取不存在的Event时间列，已改正；未据此改运行时代码。

证据组合界限：同tuple的offload/Product角色唯一性及真正多重匹配拒绝，仍由前述真实Capability/SQLite/子进程场景证明；完整Host场景使用当前合法Inventory迁移旧材料，验证自动恢复和不扩大范围，没有伪造生产旧Custody或重建旧事故。当前211已排除成功Settlement的旧义务，不能为复现而重新赋予其删除权限。实际95d7bb5734 Linux镜像再次运行25/25 Settlement安全/角色/进程恢复测试通过，日志`.codex/uat128-linux-settlement.log`。

当前生产95d7bb5734正常启动/挂载/71部收藏及六路GET已验证，本次只增加测试，无新运行时变更需要再部署；未制造生产故障。结合原精确角色正负路径、真实进程退出、当前完整Host自动恢复和211独立排除证据，UAT-128按总表Oracle关闭。125/250及251不随本项关闭。
