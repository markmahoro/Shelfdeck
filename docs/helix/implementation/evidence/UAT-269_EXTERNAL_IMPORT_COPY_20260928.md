# UAT-269 外部导入复制吞吐与既有任务恢复

2026-09-28。第一批已部署，指定电影外部导入及后续校验通过；后台治理另行推进。

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

## 第一批生产结果

- 代码提交：`5bb030534c`；合同摘要：`b8cf321d65`。完整架构240文件通过；Windows/Linux专项各45通过。
- 标准build/upload/checksum/dry-run/apply完成。镜像`markmahoro/shelfdeck:helix-beta-20260928-b8cf321d65`，tar SHA256 `e0f0b09b1583cb23bb9ae3d87c13c0d480e24561401d49f87236ceb73283e4c4`。健康/Admin/五挂载与镜像身份通过。
- 停服一致备份：`/vol1/1000/docker/shelfdeck/backups/uat269-20260928-b8cf321d65/runtime.tar`；SHA256 `a2d385f85f0d78671ba82acdd28e752a55a31bf022a225040c1fddf04904369a`。无生产SQL修改，无Reset，无重新下载。
- 容器StartedAt `2026-09-27T21:22:10.056Z`；导入在`2026-09-27T21:24:01.010Z`成功，启动后约111秒（含启动和恢复等待，不能当作纯复制耗时）。完整副本26,653,495,609 bytes，原Event/Attempt ordinal 1保持，原Effect committed；import/probe/verify/select四Event均succeeded。
- 源dev/inode/size/mtimeNs/ctimeNs和有界内容指纹与升级前完全相同；副本inode不同，内容指纹一致。未新增SHA256全文件校验；产品现行有界指纹与媒体验证均通过。
- 采样的10.45 GB partial不能归为新实现吞吐证据：旧进程停机期间也可能推进。只以完成事实和111秒上界报告，不伪造逐秒复制率。
- 恢复日志INPUT_DRIFT经精确运行时定位属于`care-assessment-commit-6fdd1c337f28c06b36`；电影三个literal输入与原Attempt digest一致。诊断临时探针已撤除。
