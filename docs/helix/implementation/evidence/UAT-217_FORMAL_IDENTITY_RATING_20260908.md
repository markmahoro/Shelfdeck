# UAT-217 正式身份评分与Acceptance重算

2026-09-08。本地实施，尚未生产部署或关闭。关联UAT-060/079与历史BR-01。

## 根因及边界

clean-service-host的Subject评分Target始终从Candidate Claim取名称，即使Libra已有持久Product Identity，仍把带版本后缀的旧名交给Perception。正式身份生产完成后也没有在继续生产前等待当前评分/Acceptance重算。

Libra公开Target改为读取已提交Identity，校验display record及当前identity digest；Movie使用正式title、已有year及真实TMDB anchor。原Claim不改，没有Provider anchor时不伪造。查询与Admin Target继续共用同一Projection。

Product Identity提交后，Coordinator通过既有Acceptance Spec Coordinator等待Perception Resolution；只在semantic specDigest变化时交回既有Run Creator接续。身份revision变化但评分结果不变不触发重做。SSOT 5.6.3已补此约束，Owner和业务交接不变。

## 验证与剩余

- 17项定向测试PASS：弱到正式目标、真实Provider/year、摘要损坏拒绝；既有Spec输入测试证明身份变化不改变语义输入、同评分不同来源不改变要求、评分变化会改变输入。
- 首轮219个architecture fixture文件与全部Gate PASS；最终复跑全部静态Gate通过；219文件并行回归有1项service health timeout，单独复跑该入口文件14 PASS/3 SKIP（启动/认证/关闭通过）。未把超时隐藏为全套PASS。
- 未用生产Reset验证；旧冻结Run保持原状态。仍缺真实评分命中、具体Acceptance要求变化、合法Run replacement及最终上架全链路，不能据上述模型测试关闭。


后续服务全量回归识别并修复异步续跑缺口：正式身份触发的新Perception Resolution返回相同5星/相同Acceptance要求时，不生成新Spec Work，原Run等待缺少完成唤醒。Perception完成通知只针对该Subject调用既有Libra Acceptance/Run Creator/Run Coordinator；是否替换仍由Libra按合同决定。原外部寻源全链路用例独立重跑仍失败，修复后约4秒通过，验证100候选选择后的实际媒体拒绝保持原有限停止规则。未用延长超时或Reset掩盖问题，未移动评分/Spec归属。此前架构门禁不足以发现此跨事件缺口，发布必须包含本次修正。


## 2026-09-09 完整接续新增缺口

新增真实媒体/完整Host测试使用隔离豆瓣页面，经正式连接/同步API保存评分；文件名 `Unmatched Release Edition` 与正式片名不同，先由正式选择API确认 TMDB 990001 / Formal Rating Movie。评分Resolver正确命中1星，产生第二份Acceptance Spec，原Run superseded并建立新Run。

但新Run只按自己的 resolved_identity Product Fact / 自己的手选Intent查找，未承接同一Subject已提交的正式身份，又走原始文件名搜索，停在等待身份确认。只读SQLite已见1份Subject正式身份、旧Run superseded/新Run active、第二次 product_identity Work完成后没有后续生产；这是217完整接续未满足，不以再次选择同一身份作为验收补丁。

测试草稿在 `helix-libra-handoff-b-scenario-e2e.test.js` 的 `UAT-217 formal identity resolves...`，尚未通过、尚未提交为交付。日志 `.codex/uat217-formal-real-chain-v2.log`。中止仅本地测试进程，未触碰生产。在同一Subject的现行正式身份/新Run证据绑定合同内检查并修复，仍须fresh Provider复核、要求未变不再替换、最终Arca实检/Commit及源保护通过。没有伪造当前Run Product Fact或倒填历史选择。

另在自定义模板准备时发现独立通知消费者缺口，已另登254；本次评分接续复现用系统现有模板，不通过忽略254错误掩盖评分结果。


## 接续修正与复验

新Run在本Run没有Identity Product Fact时，除本Run显式选择优先外，读取同一Subject当前已提交的正式身份；以Subject/revision/digest形成稳定Work依据，执行前再次验证身份摘要。使用新的 `subject_identity` 关联来源进行fresh Provider精确复核，title/year/Provider Key漂移拒绝，完成后仍通过本Run的正式Identity commit形成新Product Fact；不复制旧Run材料或伪造手选Intent。SSOT 5.6.3、输入Schema生成器/registry/source-map已同步。

隔离真实媒体Host链13.33秒 PASS：正式选择一次后自动命中豆瓣1星、两份不同Acceptance要求、两个Run分别superseded/completed、单次Arca Commit、最终片名正确、原样本不变。外部页面为可控输入，域内持久化、评分匹配、Run替换、真实媒体实检与上架均为实际实现。

12项定向PASS覆盖同Subject身份、跨Subject拒绝、损坏Evidence、Provider ID/title/year漂移。222文件架构回归只有3个派生合同一致性测试失败，其余通过；生成器/派生物/固定摘要同步后对应3文件10项全部PASS，依赖和语义检查通过。未以修改功能Oracle消除失败。原始日志 `.codex/uat217-formal-real-chain-v4.log`、`uat217-continuity-negative.log`、`uat217-continuity-architecture.log`、`uat217-contract-recheck.log`。

此前基础217修正已在696b122da4，当前接续增量尚未发布。剩余服务完整回归、新候选标准发布/Linux验证及生产只读验收；不新建生产故障、不Reset。仍未关闭。


## 2026-09-09 部署后独立验收：UAT-217关闭

正式身份→评分命中→Spec语义变化→同Subject合法Run替换→Arca Commit真实链13.33秒PASS；12项负向、10项派生合同及515 PASS/20环境SKIP完整Service证据已核对。b2978c1512标准发布与Linux readiness通过，01:14生产GET及浏览器正式片名/评分/要求展示正常。生产未制造身份重选/新入库场景；完整因果链来自隔离真实Host，不将生产历史结果冒充新链。

生产身份与发布校验见[发布证据](UAT_RELEASE_B2978C1512_20260909.md)。原始补验保存在`.codex/uat-acceptance-20260909-readonly.json`、`uat-acceptance-20260909-after.json`、`uat255-production-reads.json`及`production-monitor.jsonl`。未运行不相关的全套重复回归。
