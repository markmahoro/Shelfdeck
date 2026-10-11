# UAT-300：On-deck Commit 准备查询超过500项

77集混合来源诊断容器 `shelfdeck-uat298-settlement-diagnostic` 运行约3572秒后退出1，不是80分钟预算耗尽。保留fixture `/tmp/helix-series-routing-K1Wa7a`，并复制到仓库外供只读核对。数据库最终231项来源结算全部succeeded，Fulfillment也succeeded，唯一未完成Event为 `arca.ondeck.commit@1`。最后一条30秒进度只有220项结算，不代表最终状态。

根因：On-deck Capability将Product、Offload和Stage身份合并后一次调用普通Material Control Query，触发 `P3_CONTROL_QUERY_KEYS_INVALID` 的500项限制。Arca其他入口已有分批只读装配模式；SSOT §8.3.6每批500项仍保持，最终Control Authority按完整变化集在原事务中CAS和提交，不拆分Control提交或扩大权限。

修复范围：Arca On-deck接受、Stage Custody以及Commit准备查询统一使用500项批次，完整排序去重结果用于原有所有权/revision/digest校验。不新增兼容或Reset，不改Foundation查询与提交合同。验收要求：真实公共Query超过500项拒绝，Arca装配1024项完整返回，相关On-deck回归及77集完整Host通过；独立记录长耗时，不能把修复查询等同于解决结算性能。

Windows/Linux各21项专项通过，覆盖1024项真实public Query装配、原查询500项边界、陈旧Control拒绝、事务回滚及重放。77集完整混合来源Host已以容器shelfdeck-uat300-mixed-77重新运行并保留fixture；未出终态，不计完整PASS。本地18081尚未加载此补丁，两条新Run继续执行。

2026-10-11最终组合代码761c5e98a完整77集混合NFO/Provider Host双平台通过：Windows984.83秒，Linux1302.94秒（容器exit0），231项来源结算、Fulfillment及On-deck Commit完成。Linux Stage208536字节、Final175314/159436字节，Foundation结果仍有界；232条metadata observation、show request1次。日志uat302-windows-final-77.log和uat302-linux-final-77.log均在仓库外预览目录，Linux fixture保留于已停止容器/tmp/helix-series-routing-AStqWb。这是实际Host/文件系统加受控Provider/mediaProbe场景，不代表真实77集FFmpeg或现场上架验收；未构建新发布镜像，Linux以现有测试镜像挂载当前src/test/scripts。

现场18081仍为81a5a2e41，已加载UAT-300但未加载UAT-301/302，真实转码继续。UAT-304停机缺口另行开放，未主动重启、Reset或操作NAS；本项不作为整体Series发布关闭依据。无UI变化，无Desktop构建要求。
