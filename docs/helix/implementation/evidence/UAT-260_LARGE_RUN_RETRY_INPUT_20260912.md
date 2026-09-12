# UAT-260：大Run失败准备重试输入超限

2026-09-12。状态：开发修复及隔离重试验证通过，待干净集成树/Linux/发布验收。发现于UAT-125/250最新生产副本隔离恢复演练；未对生产执行Retry、Reset或修改数据。

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

## 有界引用实施与隔离验证

SSOT §8.6.20 已明确 `procurement.failed-preparation-retry-planner@2`：原两步同步 Work 改为
`EventInputBindingSet@1`，每步只保存自己的 versioned Procurement command projection ref，以及同一
closed `ProcurementRetryCommandPlanReference@1`。该 Application Schema 已生成并进入 Procurement
registry（17→18项），不新增 Catalog Capability、表或通用 blob。引用冻结原精确请求、Intent/Scope 摘要、
新 Run ID 及 Run Basis digest。原16 KiB CHECK、Work/Basis幂等键、Marker/Result/Outbox稳定身份保留。

Procurement Coordinator 在 Intent 前重建同摘要 proposal，在 Intent 后用 Owner relation rows验证完整
Head、成员、Scope、precondition、Intent摘要，再按当前正式 Control 和 Owner事实准备 Admission。
`prepare()` 是只读 proposal，不提交结果；原 `consume()` 的 Canonical Transaction 独立重读全部成员及
current head/Control，做原 CAS 并选择 created/stale。matched proposal 必须命中冻结 Run Basis digest，
事实损坏或无法重建不生成替代 Basis。终态重放读取原持久 Receipt；Outbox恢复同样核对Receipt与Owner
create_result_digest，不能凭一条Intent row重造已提交事实。旧 inline Plan 不增加兼容分支。

在保留失败演练 DB 的另一份复制 `uat260-retry.db` 上，使用真实 Retry Admin Service、同步 Work Runtime、
Intent/Admission Store及Material Control participant，**没有启动Host、没有NAS连接、没有新扫描或媒体操作**：

| 原失败Run成员 | 新Run完整成员 | 两个Plan JSON字节数 | 幂等重放 |
| --- | --- | --- | --- |
| 601 | 601 | 1333 / 1339 | 原Receipt与新Run复用 |
| 574 | 574 | 1333 / 1339 | 原Receipt与新Run复用 |

原601成员的 `failed-preparation-retry-work-259b09306770898082bfa66e0829ddeaa666f4fb` 原样从
admitted/无Plan恢复为succeeded；未改其旧Work/Basis，也未清库。两个原失败Run的完整成员行保持不变；
62张 Arca、Candidate/Delivery、Material Control 受保护表全行摘要前后相同，FK0。
临时脚本 `uat260-real-retry.cjs`、审计 `uat260-real-retry-audit.json` 位于上述TEMP根目录；生产导出不入Git。

Windows自动化定向 **70/70通过，无skip**：新建1/574/601/1024成员真实admission→seal→retry→replay；
既有1025成员超界拒绝；Plan激活前后、Intent提交前后、Admission提交后及Work完成前中断重放；
读proposal后改变Field状态，原事务将全部成员标为stale且不建Run；已发布Plan在Intent前发生Binding
变化明确拒绝、不生成Intent；替换/扩展/超长引用及重复幂等键冲突拒绝。另用真实数据库关闭/重开及
真实OutboxDispatcher从已提交Intent恢复Admission、Inbox、ACK，首次1条、再次0条，只有一个新Run。
原Admission、Retry eligibility、Startup Recovery、同步Work恢复、Application Schema和Source Map回归通过。
持久Intent校验使用Registry中原精确immutable Rule；active Rule变化仍交原consume CAS返回
`triage_rule_changed`，不误判原Intent损坏。新Intent校验仍必须匹配active Rule。新增该规则切换以及
成员摘要损坏、成员缺失、Receipt摘要不一致反例，均不创建额外Run。
Package boundary、forbidden semantics、manifest、P2 baseline四类静态gate通过，DDL未变。

未把“明确拒绝的冻结Plan”重置或改成新Basis；仍保留原诊断事实。上述是开发机隔离验收，不代表完整
生产Host、Linux精确发布镜像、Triage产出或席位吞吐已验收。UAT-260保持开放，由已获用户生产部署授权的统一部署任务
按最终联合版本独立验收；不能用UAT-261启动通过替代本项容量/恢复闭环。


## 2026-09-12 联合发布后独立验收关闭

真实601/574成员隔离Retry保留全成员且Plan仅1333/1339 bytes；1/1024边界、1025拒绝、失败/重启/Outbox幂等和62表保护通过。Windows70及最终镜像Linux28通过，286标准发布及生产健康/持久事实保护通过；未在生产人为触发Retry。 精确image/source/SHA、完整Host及回退边界、备份与生产只读证据见[286发布记录](UAT_RELEASE_286FE56F1E_20260912.md)。此前未部署/开放状态为历史时点，本段满足本项关闭条件；不连带关闭251或历史存量项。
