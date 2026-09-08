# UAT-254：规则模板发布通知缺少消费者

2026-09-09，隔离真实Host测试发现，待修复；不宣称生产已出现相同日志。

通过正式API复制系统模板、修改草稿、预览和发布自定义收藏规则，发布本身成功，但 Host 报 `No Outbox consumer is registered for rule_template_published -> read-model`。Arca rule-template-store 确实在同一发布事务中生成 `ArcaRuleTemplatePublished/v1`，intendedConsumers 为 read-model；当前 outbox-dispatcher-host 没有对应处理分支，失败会重试。

发现于217评分链路准备自定义规则时，原始日志 `.codex/uat254-template-consumer-failure.log`。另一个既有媒体测试使用 deferredDeliveryKeys 排除此通知，不能作为生产消费者已具备的证据。

剩余：审查模板发布后既定投影/唤醒合同及读模型归属，补必要消费者或纠正无效通知的生产方合同，禁止加无验证的通用ACK或吞掉错误；通过真实Host发布、崩溃/重放与受影响收藏规则投影验收，确认无永久pending/failed及无重复副作用后发布关闭。

执行B2，关联217的验收准备但不阻塞系统现有规则的217链路；不覆盖旧UAT，不归为规则页面文案问题。无生产修改。
