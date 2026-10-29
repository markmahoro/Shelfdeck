# Series候选资格与NAS恢复记录（2026-10-29）

本记录描述独立候选`1d8a45843f9c8982c91bb0a367eb0adfa1c5c310`及其UI修复后继`7265d4b5ec4077cb21152219a9a53e85a97ac3f9`，不宣布生产发布或业务验收。原始日志在本任务工作区的`.codex/series-integration-20261029/`，下表摘要用于校验该忽略目录中保留的原始证据。新提交形成后须重新核验受影响的具体版本。

## CIFS隔离验证

| 记录 | SHA256 | 结论 |
| --- | --- | --- |
| `nas-cifs-first.log` | `df2cf1e22c5b7131000e05c186e0018afa29ce55acaa4173f31a020dcc2b835f` | 首轮将Workspace和SQLite误放共享盘，6/16通过；不能当生产布局资格。 |
| `nas-cifs-retest.log` | `4db97d19bbe4a0f672ca117b13389fb394586e5324288334c7aa88c1e7747fe1` | 按生产拓扑重跑，8项直接文件调用遇`PHYSICAL_MATERIAL_STAT_FENCE_CHANGED`，未通过。 |
| `nas-cifs-stat-probe-retry.log` | `f47babefd8106b20276c8de21910141a3a56802c53ddfcf6872b21d4e13ece25` | 隔离新文件的fd/path时间戳有短暂不一致与后续变化；不能凭该现象推定内容未变或降低围栏。 |
| `nas-cifs-host-diagnostic.log` | `d452fc5af2a3b32e8140c1ddae10e2909bbe93fbd59cc8247a9a28bef843e5fe` | 真实Host的Series publish Effect进入`reconcile_required`；首版测试把该恢复通知当作致命异常。 |
| `nas-cifs-host-observed.log` | `3a7916787dbc71f88edd16f230b012368c73017f9022805c117a4267a6e0265d` | 14:43启动的观察版本在NAS异常期间连接断开，日志没有最终测试结果；不能依据本地进程退出码判定通过。 |

上述测试仅在任务专属目录及临时数据运行，未操作生产材料。候选镜像仅加载供测试，未部署；七条线上重试未执行。

## NAS响应与原绑定恢复

发生响应超时后，ICMP/TCP可达但SSH握手、管理页及健康接口无应用响应，停止任务容器的SSH请求未获握手。用户说明前序其他Docker部署导致NAS卡死并自行重启；该原因未独立验证。重启后任务容器不存在，生产仍为原容器`1792e7209ca39dcd83eb64d91107803bb7bdf234103a4d5b00d4381bf1d29493`与`markmahoro/shelfdeck:a2bf2d6fd`。

原`/media`和`/adult`宿主机CIFS源重启后缺失，生产容器先绑定到了启动时的本地空目录；用户重新挂载原共享后，宿主机源正确但容器内仍显示本地文件系统。核验两条原CIFS源、容器ID、镜像和bind路径后，执行仅针对该原容器的`docker restart --time 60 shelfdeck`；容器内两条路径随后均显示`smb2`，容器ID与镜像不变。健康接口返回200，Runtime曾返回running与normalSupplyAllowed=true；后续管理状态查询有一次10秒超时，NAS swap约2GiB，稳定性仍开放。不将这次恢复当作候选部署。

| 记录 | SHA256 |
| --- | --- |
| `nas-after-user-reboot.log` | `bce09ec8f08ce501c0530df97319de817812ece197a74c5408025ce781213091` |
| `nas-post-reboot-media-check.log` | `0cc88373992c337421072ab14f3c65d0673d7ff8f11364b97bdbbe0b79bad73b` |
| `nas-after-user-remount.log` | `f3968708c1475417beb955f936523f09381281337255c54fd11872c9a851cc96` |
| `nas-production-rebind-restart.log` | `7cf9a6903f1de9ee5e8e6c2246dcf34fc809f7c69374f85fff982147f79ccbaf` |
| `nas-after-production-rebind.log` | `8d49588f66b103a94c74921e00a70f54f9a7618a073439f99a5c5e7ec68ff5b6` |

## 本地固定候选

构建镜像的4541个跟踪文件与冻结检出字节一致。Linux Web初跑缺少相邻Service源码，48文件中2组无法加载；修正隔离环境后48文件、271测试通过，首跑和因只读挂载点缺失无法启动的重试均保留。对应日志`linux-web-test.log` SHA256 `a24b8786dcdecedf20e48e74f16a34fe8d13b3e2b94a7ff526f1e7e705fc2c63`、`linux-web-retry.log` `2add2022c052c3ea0ff3a18a718fc934e349686ecc94a63c6ee138b07c89e2b5`、`linux-web-second-retry.log` `80ac97e3577ddb9e469ebd03e80a5e3f8814ba1adfbf9cffc3de4bd198b317cf`。

Service首个容器命令未展开通配符；首个完整执行787通过、32失败、26跳过，其中有工具/Service/Web依赖和一次性`/transcode` tmpfs未挂入的环境问题，Linux下Windows路径断言另待核查。日志`linux-service-first.log` SHA256 `bad1169bd4e5008819ca97c2a65454ad1496a425840c77bc0027bff7bb336385`，完整执行`linux-service-retry.log` `03f0524d594bc283d5b655df3a4f3c069dee62a3c81e6e7c6102a6f4da0481cd`。

补齐三组依赖及一次性tmpfs后，第二次完整Service执行835通过、2失败、28跳过，`linux-service-second-retry.log` SHA256 `e028fe41899a3dc296cad21e33d0eefeea19f772ec753b1ec4a63be71b7c3772`。Event deadline失败的同一原测试单独通过，八次记录实际错误字段的诊断重放均满足原条件，但原失败未记录具体字段，原因不能断言；`linux-deadline-targeted.log` SHA256 `37bd1f06ac0a700c4d030a8481de3ab098aaf7bcba48e2f800a0bea61e20d7b9`。另一失败为Windows样式`Z:\\Film`在Linux先经`path.resolve`转成本地相对路径，生产基线与候选该实现/测试blob一致；电影线程独立处理，不能仅删断言。完整架构门禁仍在执行。

电影线程独立提交`db539e9df79520edbeb207f46345c786bade6633`，在主机解析前拒绝盘符/UNC字符串并补覆盖，报告Linux和Windows各14项通过；只说明字符串形式防护，不宣称该工具能识别Linux上已挂载的SMB。此提交与US功能改动分开，适合独立挑入候选后重跑完整Service。

UI负责人独立结果为浏览器28 PASS/8 FAIL，隔离Linux 231 PASS、Host 3 PASS；两处失败各在四视口复现，整体UI为FAIL。精确错误码及证据已交Series线程；修复后重新绑定实际最终候选复验。

Series线程在上述候选后追加纯Web修复`60f123a71`、浏览器回归`567ad89ca`和Evidence `7265d4b5e`。实现线程报告Linux Web 274通过/0失败、四视口浏览器44通过/0失败，含原失败的重新验证；具体局限见该线程专属Evidence。新候选`7265d4b5ec4077cb21152219a9a53e85a97ac3f9`的标准镜像已在本地构建，tar SHA256 `42ba2e2497b2db51d4a2889599895f337779f5dc30203f545e06100159cb3697`，日志`image-build-7265d4b5e.log` SHA256 `3f7f29cbfdeca447e9caa92062936741097075c238cfa71ae699f2e423de4e70`；UI负责人已收到新镜像的独立复验请求，尚未出具结论。
