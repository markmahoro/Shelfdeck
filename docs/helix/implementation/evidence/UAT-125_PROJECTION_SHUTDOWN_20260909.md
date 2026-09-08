# UAT-125：后台投影停机回调

2026-09-09，局部修复，125整体仍开放。

254真实Host反复重启验收发现：Formation projection startup sweep / wake 已排入 setImmediate，stop时尚未成为running，数据库关闭后仍进入sweepPage读取cursor，引发 P3_SQLITE_KERNEL_CLOSED。不是数据库损坏或业务失败。

run入口现在拒绝stopping/stopped生命周期的排队回调；已运行任务仍由stop等待，不吞掉运行错误。新增立即start/enqueue/wake/stop后关闭真实SQLite Kernel、再排空两轮事件循环的验证，确认零读取、零错误。既有投影完整性/故障恢复与Inbox合计36项PASS，254的真实Host快速重启也通过。222文件架构及全部静态Gate PASS。

仅完成125的后台停机隔离子项；Workspace治理、其他Runner隔离、Root/重启及完成/放弃回收仍按总表分别验收。未部署。
