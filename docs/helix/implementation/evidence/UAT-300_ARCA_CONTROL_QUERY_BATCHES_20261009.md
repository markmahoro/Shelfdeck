# UAT-300：On-deck Commit 准备查询超过500项

77集混合来源诊断容器 `shelfdeck-uat298-settlement-diagnostic` 运行约3572秒后退出1，不是80分钟预算耗尽。保留fixture `/tmp/helix-series-routing-K1Wa7a`，并复制到仓库外供只读核对。数据库最终231项来源结算全部succeeded，Fulfillment也succeeded，唯一未完成Event为 `arca.ondeck.commit@1`。最后一条30秒进度只有220项结算，不代表最终状态。

根因：On-deck Capability将Product、Offload和Stage身份合并后一次调用普通Material Control Query，触发 `P3_CONTROL_QUERY_KEYS_INVALID` 的500项限制。Arca其他入口已有分批只读装配模式；SSOT §8.3.6每批500项仍保持，最终Control Authority按完整变化集在原事务中CAS和提交，不拆分Control提交或扩大权限。

修复范围：Arca On-deck接受、Stage Custody以及Commit准备查询统一使用500项批次，完整排序去重结果用于原有所有权/revision/digest校验。不新增兼容或Reset，不改Foundation查询与提交合同。验收要求：真实公共Query超过500项拒绝，Arca装配1024项完整返回，相关On-deck回归及77集完整Host通过；独立记录长耗时，不能把修复查询等同于解决结算性能。

Windows/Linux各21项专项通过，覆盖1024项真实public Query装配、原查询500项边界、陈旧Control拒绝、事务回滚及重放。77集完整混合来源Host已以容器shelfdeck-uat300-mixed-77重新运行并保留fixture；未出终态，不计完整PASS。本地18081尚未加载此补丁，两条新Run继续执行。
