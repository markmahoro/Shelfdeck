# Series完整Aftercare Host重启恢复

日期：2026-10-08；基线`9143f3a34`，对应当前Phase进程恢复门槛。仅新增隔离测试，未改产品恢复逻辑。

## 中断边界与断言

新开关`HELIX_SERIES_AFTERCARE_RESTART=1`通过独立子进程运行既有真实N:M媒体Aftercare Host。两个成品已完成Materialize并持久化正式Receipt，但`arca_aftercare_inventory_domain`事务尚未执行时直接`process.exit(73)`，没有正常关闭或异常回滚。中断快照包含当前Entry/Inventory、同Case、两份Materialize Receipt及0个Inventory Commit。

新Service Host重开同一SQLite与runtime目录，让正式调度恢复原Case。断言原Inventory revision恰增加1、只有一个Inventory Commit、两份原Materialize Receipt完全不变；每个实际成品SHA256与中断时相同，Episode Claims对应原成员，共文件+part未丢失；未变NFO/海报保留key和字节，superseded文件完成清理。再启动第三个Host，完整业务摘要、Inventory及Receipt与第二个Host相同。范围外sentinel保留，foreign_key_check为空，integrity_check为ok。

此处验证真正完整Host的进程中断，补充既有三个rename边界的独立Capability恢复；不把两类测试相互替代。

## 结果

Windows目标1项通过/0skip，108.19秒，日志`series-aftercare-host-restart-v3.log`。前两次失败均为新增测试Harness：初次写死初始Inventory=1而实际为2，改为比较中断时正式revision+1；第二次服务启动日志混入stdout导致JSON解析失败，改为唯一显式结果行且要求恰一行，没有过滤运行时错误或业务失败。

当前源码构建本地Linux测试镜像`shelfdeck-series-test:9143f3a34`成功，ID `sha256:b0b73df6d6abce87b9c0b4050d1e9b9ccc16abf3c4bf33ce02fa22db99d9abfe`。无release tag、未上传NAS。Linux同一路径1项通过/0skip，100.67秒；容器自动删除。默认未开关测试显式skip，不能将默认skip算恢复证据。

P2合同、459文件/1455依赖包边界、2078文件语义检查及diff检查通过。

全部日志位于仓库外`E:/my_project/helix-git-consolidation-20261008/`：`series-aftercare-host-restart{,-v2,-v3,-linux}.log`、`series-aftercare-linux-build.log`。

## 保留边界

不证明其他所有Aftercare强杀位置、磁盘满、外部交付或生产副本升级/回退。完整浏览器用户旅程仍未验收。本次代码不改变已获UI接受的页面。NAS只进行部署准备的只读inspect/数据库元数据检查，没有复制生产数据、创建远端文件、部署或修改生产服务。
