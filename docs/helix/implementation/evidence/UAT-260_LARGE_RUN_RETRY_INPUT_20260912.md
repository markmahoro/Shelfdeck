# UAT-260：大Run失败准备重试输入超限

2026-09-12。状态：已复现、待修复。发现于UAT-125/250最新生产副本隔离恢复演练；未对生产执行Retry、Reset或修改数据。

## 触发与因果

同一cd4f一致副本中，原两Token精确Reset、5份旧Offer正式拒绝及消费后，真实NAS只读Observation完成73页、18,531文件，revision1367。普通选材形成601和574成员的两个Run，原23成员全部入选、admitted Control revision1；5条拒绝消息由真实OutboxDispatcher ACK，第二次drain无重复。后续测试SSH桥未编码BigInt，使9项BDMV纯观察失败并按正式路径封账。该桥接故障属于测试设施；已修wire encoding并只读复验真实BDMV topology，不把此故障描述为产品媒体读取失败。

在该失败副本上请求正式FailedPreparationRetry，产品重试器在Plan激活时触发`length(CAST(input_bindings_json AS BLOB)) <= 16384`约束。源证据c12d38d4b确认Supporting Work admission已提交、activation事务回滚：`failed-preparation-retry-work-259b09306770898082bfa66e0829ddeaa666f4fb`为admitted，Attempt/Plan均0，尚未创建Retry Intent/新Run/Candidate；输入字节数待补原始失败审计。失败副本保留，不能通过改DB上限、时间戳、旧Work或扩大Reset来使测试通过。另建一致副本使用修正桥继续正常链，并不消除本缺陷。[源演练证据](UAT-125_250_INTAKE_RECOVERY_20260912.md)。

## 代码及Owner合同核验

同一失败Work的真实`assemble()`输出在`activate`写入前截获，以项目`canonicalJson()`和UTF-8 byte length测得：`retry-intent-commit`输入659,539 bytes，`retry-admission`输入1,198,905 bytes，均显著超过16,384。部署任务已核对`measure-retry.cjs`的测量位置及`rehearsal/retry-node-byte-audit.json`；该诊断主动止于activation前，没有执行新的Plan事务。Work仍admitted、Attempt/Plan0，待补修复后的恢复验收。

- `failed-preparation-retry-admin-service.js`的`assemble()`为两步构造完整`intentRequest`与`admissionRequest`，后者包含`newRunBasis`与Control scope；`retry()`先submit Work，再调用`workRuntime.activate()`。
- `synchronous-domain-work.js:285`所在Plan node insert直接将`canonicalJson(step.input)`写入`input_bindings_json`；`clean-schema.sql`的16384-byte CHECK按合同拒绝大DTO。
- SSOT §8.6表`fx_plan_nodes`明确每项JSON≤16 KiB；typed binding说明明确Plan只保存versioned typed binding refs，大Decision由Coordinator在提交边界按精确refs装配，current输入有revision/digest Fence并在Canonical Transaction重验，Executor不得读Store。
- 因此修复应保留Procurement对Retry Intent/Run admission的业务所有权及Foundation通用执行边界，采用正式有界引用和同Basis装配。扩大DB JSON上限、把业务选择移入Foundation、直接Store旁读或旧Plan fallback均不符合现行合同。完整字段/合同传播与实现仍待工程设计；不在部署脚本内临时绕过。

## 验收条件

1. 新建可复现的大Run失败准备场景，覆盖实际601/574成员量及合同1/1024边界；超过1024的不可拆分Scope仍按原合同拒绝。
2. 正式Retry Intent及Run admission全链完成；Plan各JSON守住16 KiB，完整成员和Digest可重建；原失败Run/原Package/无关Control及Delivery保持。
3. Intent提交、admission及Plan激活前后的失败/重启重放无重复Intent/Run/消息；revision或digest变化被明确拒绝，不遗留无法恢复的admitted Work。
4. 适用Windows/Linux、generated合同与相关UAT-129消息重启回归通过，最终镜像和生产所需验收完成后独立关闭。不重开已完成的UAT-129原消息消费者缺陷，也不以本轮正常Triage重放代替重试验收。

原始材料：`%TEMP%/shelfdeck-intake-recovery-20260912/fresh-cd4f/rehearsal/post-observation-audit.json`、`triage.log`、`nas-retry-observations.json`；复用脚本`retry-triage-fresh.cjs`。它们仅适用于明确隔离目录，不是生产操作入口。源任务详细证据交付后补链接；该文件为缺陷Evidence，唯一排程仍在CURRENT_PLAN/CURRENT_PHASE。
