# UAT-269 外部导入复制吞吐与既有任务恢复

2026-09-28。实施中，生产未发布。

用户确认移除外部导入的JavaScript流式复制限定，并要求复用《荒野猎人》已下载原件继续原任务，不重新下载；不要求独立隔离服务环境。验证使用本地临时文件回归及上线后真实任务。没有授权重置任务或改写生产数据库。

## 现场与范围

生产基线 `83eb276a12`；Event `libra-external-import-event-5a9f7b41e5c42c702e5b27b0e432458c3d52b710`，源文件26,653,495,609 bytes，当前导入仍executing且仅有partial。实测64 KiB读写回调间隔约0.5–0.95秒，主线程持续忙；Aftercare上下文/评分候选检索是主要CPU热点。等待sqlite_write的44个维护Event在约5秒内无进展，触发28次上下文读取。

第一批仅将Libra Workspace导入改为`fs.promises.copyFile(..., COPYFILE_EXCL)`；保留源前后stat/有界指纹、目标指纹/身份、Effect Journal、Receipt及原资源需求。Owner和业务合同不变。SSOT复制机制限定按用户确认同步调整。

原生复制不支持按块取消。当前批次不新增取消或提前释放资源；重启后的恢复必须在旧进程结束后经既有Reconciler进入同一Effect，清理受管partial并从Landing重拷贝，不宣称字节断点续传。不得重发下载、Reset或手工修改Event。

## 验证

- Windows Workspace专项29/29通过，包括新增外部导入partial恢复、复制失败不提交、源变化拒绝、独立副本、同Effect重放唯一Handle。
- External pipeline、Effect Reconciler及完整external Handoff B fixture合计16/16通过。
- Linux生产基线运行时挂载候选源码，同组45/45通过；NAS只读preflight通过，无告警。
- 候选镜像、标准发布、真实恢复/吞吐尚未完成。吞吐以现场前后数据验收，不将小文件测试当性能证明。

## 后续独立批次

按第一次真实恢复结果继续验证Aftercare单次准备上下文复用、Foundation等待任务重复准备抑制及Perception候选检索优化。不得跨Owner缓存业务事实或改变评分结果。sqlite_write持有范围需要精确资源合同设计，不能直接删除许可。第二批不夹入第一批，以保留复制方式变化的因果证据。

## 关闭条件

同一已下载材料完成导入、同一任务继续后续步骤、无重复外部请求；源文件保持、独立目标校验通过；记录纯复制与完整导入耗时和实际吞吐。恢复若遇正式Fence拒绝，保留证据按该合同处理，不绕过校验。
