# UAT-254：规则模板发布通知缺少消费者

2026-09-09，隔离真实Host测试发现，待修复；不宣称生产已出现相同日志。

通过正式API复制系统模板、修改草稿、预览和发布自定义收藏规则，发布本身成功，但 Host 报 `No Outbox consumer is registered for rule_template_published -> read-model`。Arca rule-template-store 确实在同一发布事务中生成 `ArcaRuleTemplatePublished/v1`，intendedConsumers 为 read-model；当前 outbox-dispatcher-host 没有对应处理分支，失败会重试。

发现于217评分链路准备自定义规则时，原始日志 `.codex/uat254-template-consumer-failure.log`。另一个既有媒体测试使用 deferredDeliveryKeys 排除此通知，不能作为生产消费者已具备的证据。

剩余：审查模板发布后既定投影/唤醒合同及读模型归属，补必要消费者或纠正无效通知的生产方合同，禁止加无验证的通用ACK或吞掉错误；通过真实Host发布、崩溃/重放与受影响收藏规则投影验收，确认无永久pending/failed及无重复副作用后发布关闭。

执行B2，关联217的验收准备但不阻塞系统现有规则的217链路；不覆盖旧UAT，不归为规则页面文案问题。无生产修改。


## 实施与恢复验证

Arca本来就在发布事务内更新绑定Shelf的Standard与Routing Projection，没有待异步重做的业务决定。新增Arca公开只读端口按templateId/revision精确读取不可变已发布规则并校验其规则摘要；Foundation只消费这一具体通知：核对Arca生产方、类型、aggregate、revision和摘要，再以read-model观察Receipt确认。旧通知不重做规则，不用当前revision替换历史revision。

read-model为工程Owner，不是Business Domain。新增只限read-model的纯投影信号Inbox方法，仅写Foundation Receipt；原Business Domain消费仍强制Domain Participant，不能调用该方法绕过领域副作用。SQLite Owner边界没有放宽。

真实Host正式API复制/绑定/修改/预览/发布后，暂停该通知到重启消费；篡改payload规则摘要且重算Envelope摘要仍拒绝、Inbox为0；恢复正确通知后完成ACK。模拟Inbox已提交但ACK丢失，再重启后仍只有1条Inbox、Shelf Standard仍revision3，未重复发布。现有CAS/故障回滚与重启全文件3项PASS。独立Receipt重放/摘要冲突/禁止Business Domain绕过，加投影停机回归合计36项PASS；222文件架构和全部静态Gate PASS。

早期测试误把失败重试状态期望为failed；实际Foundation使用pending+attempt_count递增，已按现行合同改验重试次数及未ACK。另暴露的投影停机竞态归125并修正，未吞掉Kernel关闭错误。

日志 `.codex/uat254-template-restart.log`、`.codex/uat254-inbox-uat125-shutdown.log`、`.codex/uat254-architecture.log`。ACK丢失为隔离数据库精确状态注入配合Host重启，未声称实际OS进程崩溃。尚未部署，剩余统一发布/Linux运行验证；不修改生产规则制造验收场景。


## 统一候选已准备

干净发布工作区241436b8da构建 `markmahoro/shelfdeck:helix-beta-20260909-241436b8da`，Image ID `sha256:b9b42019d46035d0e0b0548fc763a97f3b521c15419325d284e126e02e7f8724`，tar SHA256 `1688415c8aa4acc9dff60299e89d46b8d1796e1a9eb97e908f085a9790029bd0`。标准上传到NAS项目根并通过校验，deploy dry-run生成；未apply。该候选包含213/217/222/243/254与125停机修正，取代未部署d24候选的发布位置。

Linux容器使用独立一致性DB/加密凭据副本，network none，无生产媒体挂载；两轮共12个GET均200，readiness ready，正常关闭退出0。首轮冷启动页面/接口较慢，第二轮formation93ms、collection450ms、care177ms；只证明隔离Linux兼容与基本接口，不当作真实浏览器性能验收。日志 `.codex/uat-release-241436b8da-{build,upload,dry-run,linux}.log`。

生产仍696b122da4且FFmpeg在飞；最终apply前须更新精确在飞清单、完成新一致备份与标准readiness，不能沿用候选准备快照。
