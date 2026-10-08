# Series 跨文件系统进程恢复（2026-10-08）

归属CURRENT_PHASE恢复/平台验证工作项，沿现有Materialize/continue_forward合同，无运行代码或Owner变更。执行镜像为`372768b68`构建的Linux镜像，身份见SERIES_LINUX_DOCKER_20261008；本批只增补测试开关。

## 验证

现有`series-aftercare-media-assessment.test.js`混合成员维修用例在`HELIX_SERIES_CROSS_DEVICE=1`时，将准备成品Workspace放到新建`/dev/shm/series-care-workspace-*`，Inventory仍在普通容器临时文件系统。先确认Linux及不同设备号；cleanup核对真实父路径和唯一前缀。默认Windows/普通测试路径保持。

实际Linux设备号Workspace106、Inventory93。正式Arca Materialize Capability依次在暂存复制完成、旧文件退役、最终文件落位三个rename后直接process.exit(73)。每次新Node进程读取同一冻结Owner fixture和准备结果，以continue_forward恢复，并由第三次执行核对相同Receipt；外部写入冲突均明确拒绝且保留其字节。共文件/part、扩展名变化、原文件退役、未改成员、完整Claims/空间集合断言均保持。

```text
HELIX_SERIES_CROSS_DEVICE=1 node --test --test-name-pattern="^Series Case plans mixed member repairs and fences exact effect sources against its frozen evidence$" test/helix-architecture/series-aftercare-media-assessment.test.js
```

Linux1项通过，27项仅名称筛选skip，约1.20秒；Windows默认完整文件28项通过、0skip，2.24秒。日志位于仓库外`E:/my_project/helix-git-consolidation-20261008/series-linux-cross-recovery.log`、`series-cross-recovery-windows.log`。diff whitespace检查通过。

## 范围

本例是真实跨文件系统副作用与跨进程Capability恢复，Owner输入采用冻结fixture；不代表完整Service Host的所有跨设备启动恢复。完整Host跨设备正常上架/维修另见SERIES_CROSS_DEVICE_HOST_20261008。磁盘满、长片/HDR、其他崩溃位置、完整外部链路及UI/发布门槛继续开放，未操作NAS。277文件完整Windows架构回归仍保持同一运行句柄，未重启或先行声明通过。
