# UAT-159/163：Movie Workspace 回收与恢复

2026-09-09，本地修复、Windows/Linux验收及标准生产发布通过，159/163分别关闭。

## 两个已证实根因

1. 正式 workspace-cleanup-store 在释放 Material Control 时，仅展开 WorkspaceMaterialHandle 内嵌 identity tuple，漏了完整 PhysicalMaterialIdentity/v2 的 schemaRef/schemaVersion。真实 Movie 拒收后通过正式 Discard，文件物理回收成功但 Libra 原子记账失败，P3_CONTROL_INVALID_IDENTITY，Scope 留在 active。按现有 product-delivery-assembler 的相同适配方式补完整身份头；没有修改 Handle、Schema 或旧事实，没有兼容分支。
2. 后台回收每次最多处理一个成员；翻页到尾部后总是休眠15分钟，未区分 Scope 仍有成员。保留每次1成员的处理上限，以有进展的未完成 Scope 安排1秒后续轮（实际由正常 Runner 调度）；刚完成两轮审计且已准入的 Scope 唤醒 active cleanup，仍需审计时遵循 nextObservationAtMs。空闲保留15分钟兜底，不取消引用/Control/身份/删除证据检查。

## 实际验证

- Windows 真实生成ISO→Movie完整生产→Arca空间明确拒收→正式Discard→回收→Host重启，94.96秒通过。3份Workspace材料（含实际remux）回收；真实中断partial回收；原片目录字节与时间戳不变；另一Workspace目录内同格式partial逐字节保留。
- Linux 同一拒收/放弃真实链111.83秒通过；与两个真实进程退出恢复场景合计3 PASS / 31名称筛选SKIP。
- Windows 成功上架→两轮审计→回收→重启155.02秒通过，1Entry、1completed Run、6项Checks全过；3份Workspace材料及partial清理，最终Shelf文件与另一Workspace目录保持。未为验收伪造terminal状态或直接写业务表。
- Linux 成功上架后回收169.81秒通过，1Entry/1completed Run/6Checks通过，3份Workspace材料及partial回收，重启后稳定；1 PASS / 19名称筛选SKIP。
- 两个独立真实进程退出点：物理unlink后立刻exit(91)，以及Effect/材料记账后exit(92)。新进程使用同一Intent恢复；每个场景仅1个committed Effect，已提交Evidence逐字节重建，未提交删除通过实际缺失重新证明，材料最终reclaimed。Windows14项Workspace port测试通过。
- 224个架构测试文件、dependency/semantic/manifest/contract Gate全部通过，P2 aggregate保持ddde0d8761a0388e966b5756d07be4f4603af9cbe7c4c538bbf4c32340c12543。

测试入口仍复用真实ISO Host夹具：HELIX_UAT135_REAL_MEDIA=1，分别附HELIX_UAT159_REAL_MEDIA=1或HELIX_UAT163_REAL_MEDIA=1。回收专用变体直接授予完整精确持续授权，不重复172的窄授权/撤销测试。此前窄授权用例在并行整套测试时卡在65秒验收窗，未通过该轮；后续回收专用变体通过。运行时没有放宽授权。

本地日志：.codex/uat159-host-windows-final.log、uat163-host-windows-final.log、uat159-163-linux.log、uat163-host-linux-final.log、uat163-crash-windows.log、uat159-163-architecture.json。Linux预发布验证挂载当前src/test/scripts，不冒充已发布镜像结果。隔离临时目录包含保留的失败证据，不触碰生产媒体。其他Workspace保护使用独立目录边界夹具，不宣称第二条正式业务Run的全链重跑。

## 发布前事实

fnOS只读预检通过，/vol1约55GiB可用。原生产6bcfd7b33b；2026-09-09 17:39:35北京时间，六路GET200，82收藏、2整理中/0待处理，Care44完成/11历史结束、回收站4。备份目录 /vol1/1000/docker/shelfdeck/backups/uat-iteration-20260909-workspace-reclaim-predeploy，DB SHA256 b77cc352e69e2d85223f297e904df3ddc1d950480574f93f0cddcf7b62fa96c0，下载校验相同；Compose/secret.env/Admin凭据及3份加密Integration envelope备份完成。无Schema变化，保留原镜像与回滚材料。

发布镜像内部代码的真实Discard链92.45秒及两项真实进程恢复通过；生产82收藏和六路接口前后同口径保持。见[发布及回滚证据](UAT_RELEASE_04FFA8B116_20260909.md)。125/152仍开放。
