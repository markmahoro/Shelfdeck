# Series联合展示维护Case

日期：2026-10-08。基线`cf7a4a742883129f761cb8b631d06f975cbe3279`；属于唯一Series Phase完整运营验证。无生产部署/数据动作。

## 验证范围

在既有正式隔离Host场景新增联合维修变体：先由真实Field/Libra/Arca上架E01/E02；随后仅在fixture中删除E01 NFO与登记poster、清空E02 NFO。检查同一个Aftercare Case沿正式Assessment、独立Artifact准备、物化、Inventory/Control原子提交、Settlement和重新评估终结。

Provider fixture记录所有Artifact请求；Aftercare海报必须仅请求一次，namespace为tmdb_series、providerKey为1399、seasonNumber为1，响应仍经过正式图像解码/身份校验和Workspace登记。两个NFO按原scope恢复、海报字节精确恢复；未维修Primary及Season NFO保持，旧revision事实保留。复用实际事务最后参与者抛错/全回滚、旧Control释放/新Control归属、superseded清理、People关联收敛及Host/SQLite关闭重开断言。

本批只扩展验证，没有改变生产运行逻辑。首轮已完成Case和物化，因测试过滤器误写Capability名称而失败；已改为正式`arca.aftercare.binary_artifact.acquire@1`，原失败日志保留。最终完整Host通过，92.0秒、0失败/skip；diff检查通过。

## 证据边界

使用真实文件、SQLite、Workspace和执行Host；Provider响应与媒体Probe/播放抽样为fixture。证明已登记poster缺失与两个NFO缺陷可以联合修复，不证明真实网络/媒体、所有海报损坏情形、进程崩溃恢复、Placement变更或整体Series发布完成。UI精确版本、Linux/Docker及其他Phase门槛仍开放。

日志：`E:/my_project/helix-git-consolidation-20261008/series-presentation-case.log`、`series-presentation-case-final.log`。前一实现批全架构2,271通过/9既有skip的结果保持历史证据，本批不重复声明运行全架构。
