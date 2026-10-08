# Series 跨文件系统上架与维修（2026-10-08）

归属CURRENT_PHASE恢复/平台验证工作项。运行代码为`372768b68`构建的Linux测试镜像（镜像身份见SERIES_LINUX_DOCKER_20261008），本批仅增加可重复执行的Host测试选项，不改变运行代码或合同。未操作NAS。

## 方法与合同

在现有真实N:M Aftercare Host增加显式测试开关`HELIX_SERIES_CROSS_DEVICE=1`。来源、Workspace和SQLite继续位于容器`/tmp`，Shelf Target使用新建`/dev/shm/helix-series-target-*`目录；先核对Linux平台及两个根目录的`stat.dev`不相等，才运行正式Shelf登记与后续流程。测试结束检查目标realpath的父路径、唯一前缀后清理，默认不开启此路径。

沿现有Arca落位/结算和Libra Workspace合同，用真实文件系统穿越复制及最终同目录rename，不注入EXDEV，不移动Owner或绕过实际审批/验证。

## 结果

容器命令核心：

```text
HELIX_SERIES_MEDIA_REPAIR=1 HELIX_SERIES_CROSS_DEVICE=1 node --test --test-name-pattern="with real N:M media Aftercare$" test/helix-architecture/series-routing-run.test.js
```

实际1项通过，0失败，31项仅名称筛选skip；96.91秒（含进程）。日志证明sourceDevice=93、targetDevice=106。实际两集/共文件/part上架后，正式Aftercare执行Remux与software_cpu转码，完整Claims和Inventory/Control末尾写入故障回滚检查通过，旧文件结算及未改成员保护断言保持。最终逐集分摊为E001=36251/2字节、E002=11829/2字节；本例没有Space上限，日志1MiB仅是事后分摊检查，不宣称有界压缩通过。

原始日志在仓库外`E:/my_project/helix-git-consolidation-20261008/series-linux-cross-device.log`。为保持已启动的完整架构回归输入稳定，先在仓库外生成精确测试增量并只读挂载进容器；成功后将相同测试文件写回仓库。运行源码没有挂载覆盖。

## 未覆盖

真实跨设备崩溃/恢复、长片/HDR、磁盘满及NAS存储压力没有由本例证明。其他完整外部链路/UI接受/升级回退门槛继续。并行启动的277文件Windows完整架构回归仍在运行，不能据此先报全量通过；其正式入口1项失败已单独复验通过，需待原完整错误摘要完成再审查，不覆盖原失败。
