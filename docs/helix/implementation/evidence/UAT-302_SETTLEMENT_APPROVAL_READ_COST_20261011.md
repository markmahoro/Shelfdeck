# UAT-302：整季来源结算审批重复读取完整交付包

2026-10-12 现场补验：加载优化后58/33/36集真实任务均完成来源结算及唯一On-deck Commit；结合已有双平台77集231项结算、撤销授权/变Basis拒绝专项，关闭本项。逐文件删除前Fence和授权仍重读，原历史未修改；没有可比的现场整链路耗时，不能推算新的速度倍数。证据`.codex/series-release-20261012/local-committed-evidence.json`。

2026-10-11接续UAT-298/300的77集混合来源耗时诊断。Windows基线81a5a2e41运行进入231项来源结算，25.18秒CPU采样中readSettlement占17.45秒，readOffer占16.27秒；其中reconcileSettlementApprovals占5.13秒。该同步循环已先readAccepted验证完整Context，却又为每个尚未结算成员调用readSettlement，重复读取及重建整季Package。

修复只在Arca同轮同步审批准备内从已验证的完整Context逐成员派生boundedSettlementContext；复用已有精确映射函数，不缓存跨轮结果、不改变Libra Product Delivery public port。每个Approval仍绑定单一source、完整final mapping、Final Product Verification和当前Standing Authorization；下一轮重新readAccepted/current authorization。执行输入准备、资源需求和实际删除前的readSettlement及Fence保持。

本轮函数只同步写Approval，不执行媒体Effect；审批写入不改变已冻结Package、接受Basis或Control。未新增所有权、权限或副作用合同。依据SSOT现有Handoff B、On-deck接受依据与Input Settlement Approval合同，属于实现性能修复。

8项专项通过：231成员、已完成source跳过、230份唯一精确审批、第二轮撤销授权零新增、Basis变化拒绝，以及既有有界执行、N:M完整映射和缺失/歧义拒绝。Windows/Linux77集最终代码完整回归及Service回归继续。此前Windows基线和Linux仅UAT-301中间诊断已主动停止、保留日志，均不计完整PASS；最终独立容器为shelfdeck-uat302-final-77-20261011。

本地18081仍运行81a5a2e41、未加载本次优化，保留真实转码；没有NAS部署或Reset。日志位于仓库外E:/my_project/shelfdeck-series-local-preview-20261008/uat302-*。

2026-10-11最终Windows77集混合NFO/Provider完整Host通过，984.83秒，231项来源结算及On-deck Commit完成。Stage证据220188字节、Final证据177879/162001字节仍由Owner持有，Foundation结果保持有界。日志uat302-windows-final-77.log，fixture保留于测试日志所列临时目录。该场景使用受控Provider/mediaProbe，不能代替现场真实影片/FFmpeg验收。修复提交761c5e98a；完整Service599通过、0失败、27既有skip。

2026-10-11最终组合代码761c5e98a完整77集混合NFO/Provider Host双平台通过：Windows984.83秒，Linux1302.94秒（容器exit0），231项来源结算、Fulfillment及On-deck Commit完成。Linux Stage208536字节、Final175314/159436字节，Foundation结果仍有界；232条metadata observation、show request1次。日志uat302-windows-final-77.log和uat302-linux-final-77.log均在仓库外预览目录，Linux fixture保留于已停止容器/tmp/helix-series-routing-AStqWb。这是实际Host/文件系统加受控Provider/mediaProbe场景，不代表真实77集FFmpeg或现场上架验收；未构建新发布镜像，Linux以现有测试镜像挂载当前src/test/scripts。

现场18081仍为81a5a2e41，已加载UAT-300但未加载UAT-301/302，真实转码继续。UAT-304停机缺口另行开放，未主动重启、Reset或操作NAS；本项不作为整体Series发布关闭依据。无UI变化，无Desktop构建要求。

2026-10-11 13:44用户要求加载新代码并明确本地Series无需等待安全退出窗口。精确终止旧服务及子进程后保存停机数据库快照，18081已以5c3effc20/PID41120启动，health正常且normalSupplyAllowed=true；人世间transcode与新FFmpeg进程恢复，历史失败计数未增加。加载前后只读采样为仓库外pre-fast-reload-20261011.log、post-fast-reload-ready-20261011.log，运行日志series-fast-20261011.stdout/stderr.log。未Reset、重扫或操作NAS；正常stop缺口仍由UAT-304独立跟进，不以强制终止方式恢复来关闭它。
