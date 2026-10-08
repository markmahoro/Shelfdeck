# Series NFO完整维护Case

日期：2026-10-08。基线`86fd0bff82f6f7dab90952636f4c99944c85c289`，属于唯一Series Phase的完整运营工作项。无NAS部署或生产数据操作。

## 本批实现

已登记Series NFO具有有效Artifact scope、原批次已接受资料且能够受控渲染时，缺失/空文件可进入既有自动Aftercare。目录、symlink、不可读、scope或资料不完整继续attention_required；不改变外部可读文本的既有观察口径。来源Fence、Case冻结、逐Artifact Planner与正式物化均沿前批合同。

## 正式Host证据

新增`series-routing-run.test.js`的`with scoped NFO repair`变体。真实临时文件、正式Host/HTTP、SQLite、Workspace注册和Arca/Control事务贯通：E01/E02上架后，仅删除E01 NFO、置空E02 NFO；同一Case生成独立Artifact、精确替换两成员、Inventory revision 1→2、原子转移Control、消费Settlement Approval、删除superseded文件、重新评估并resolved。

事务测试在正式Inventory/Control参与者之后注入异常，断言Inventory、Product Facts、People/Related、Commit/Approval以及Control revision/marker/result表完整回滚，再执行原事务。最终旧材料失去Control，全部当前材料仍由相同Arca Entry控制。其他Primary/NFO/海报字节及scope、旧Inventory事实保持；SQLite外键与完整性检查通过。没有通过直接改写运行数据库或注入业务成功结果推进。

People异步关联可合法生成额外Inventory修订；测试等待关联及其健康评估收敛，再关闭和重建Host、重新登录，核对关键Arca/Control表完全一致、Case仍resolved且健康状态healthy。这是同Node进程中的Host/SQLite关闭重开，不声称真正进程kill/restart恢复已覆盖。媒体Probe/播放抽样为受控fixture，Provider也是fixture；本批不替代真实媒体或网络验收。

## 验证与限制

14项NFO Effect/准入专项通过。首次完整Host对Case终态误用completed、Windows路径分隔符和Control查询排序三处fixture断言已修正。重开曾因People关联改变Basis而失败，定位为合法Owner更新，未修改生产代码抑制该更新；修正收敛时机后完整Host通过。原失败日志保留。

完整架构共2,280项：2,271通过、9项既有skip、0失败，97.6秒。边界446文件/1387依赖、语义2064文件、P2及diff检查通过。日志目录`E:/my_project/helix-git-consolidation-20261008/`，核心日志`series-nfo-repair-host-multi.log`、`series-nfo-repair-reopen-origin.log`、`series-nfo-repair-host-stable.log`、`series-nfo-repair-host-qualified-final.log`、`series-nfo-repair-full.log`。

尚未覆盖真正进程中断恢复、Series媒体维修、完整海报/Placement维护、外部N:M替换、Linux/Docker、浏览器及精确版本UI验收。完整Series发布资格仍开放。
