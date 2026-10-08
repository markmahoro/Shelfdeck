# Series Case消费成员策略

日期：2026-10-08；基线`8bd705183ceb196cf84ecaaae19df910e4a72c3f`。Series Phase媒体维修工作项，无NAS部署/生产数据动作。

## 实现

将完整成员证据的纯校验提取为Arca model，由观察汇总和Case消费共用；Primary Read Handle构造移入同Owner合同工具，字节形状不变。文件现场Identity Fence继续由Capability执行，Planner/Projection不做文件I/O。

Case必须active且Care Basis、CareRequirement摘要一致，basisInputs只允许一个精确健康Work引用。解析该Work中已进入正式conformance Assessment历史的唯一整季结果，验证Result/Envelope、完整成员集合摘要及requiredEffects/acceptanceDigest。每个媒体Finding必须对应该Assessment正式Finding，按成员观察里的精确条件确定目标；同成员同时需要Remux/Transcode时采用其冻结Transcode策略。Projection必须带目标materialKey，缺失、非目标或无合格策略不能选择首文件代替。

## 验证

39项评估/策略/Projection专项通过。新测试经正式成员Capability和汇总生成Evidence，再构造精确Case/历史输入；E01正常、E02编码不符时只选E02，正式Projection返回其冻结Strategy。测试拒绝终态Case、错健康Work/重复Work引用、篡改Requirement、错Finding/Assessment、漏成员、错策略Handle、错集合摘要及当前Binding变化。Case为模型fixture，不声称运行时已自动建立媒体维修Case或执行转码。

架构检查448文件/1402依赖、语义2066文件及diff通过。没有Capability schema、DDL或Result容量变更。本批不重跑重型Host；前批正式成员调度Host证据保留，当前纯集合校验与Handle提取由专项和完整架构回归覆盖。回归日志在`E:/my_project/helix-git-consolidation-20261008/series-case-member-strategy-full.log`与`series-case-member-strategy-stage.log`。

最终分组全架构2,293通过/9既有skip/0失败：并行2,277通过（97.6秒），串行stage 16通过（0.1秒）。

## 后续门禁

本批接通目标解析和策略Projection，不开放Series自动媒体维修。后续必须让维修Planner为每个目标生成独立节点，Effect精确绑定同一原成员及输出，再完成混合成品逐集验收、Inventory-Control原子提交/Settlement与恢复。真实媒体、UI精确版本/Linux及整体可部署资格仍未完成。

## 追加：精确验证成品消费

基线`13fb55e8b3e720d166c1d7281770b8af3f1ef04b`。Commit Planner为每个媒体物化节点冻结其验证Event。Projection从同一准备Work读取唯一通过的CareProductVerification，沿持久输入Binding找到生产Event，要求Handle ID、producingEventId、Result schema、Work/Attempt/Plan及Result摘要均一致。缺失、重复、失败或跨执行结果拒绝；同Work的执行期投影仍直接使用Foundation已经解析的Result。没有新增schema或修改Owner边界。

15项Projection/Planner专项通过，包含三个Remux/Transcode输出乱序解析、正式Plan schema验证及17种损坏/跨执行变体。分组全架构2,296通过/9既有skip/0失败（并行2,280，95.8秒；串行stage 16，0.2秒）；架构448文件/1402依赖、语义2066文件和P2合同通过。日志：`series-verified-media-output-full.log`、`series-verified-media-output-stage.log`、`series-verified-media-output-contract.log`，位于既有外部日志目录。本批是有界后端输出绑定修复，没有新增真实FFmpeg/Host、UI、Linux或部署证据。

仍需逐目标准备Planner/Effect、完整混合输出逐集验收、精确物化和原子提交/结算/恢复；Series自动媒体维修保持关闭。

## 追加：逐目标准备计划与执行输入

基线`63b64422bbf7c19860a1082a7a562608cf70e4c1`。准备Planner从冻结Case证据获取排序后的维修目标，每个成员独立调度Remux或Transcode及其Verification；Strategy Projection和三个现有媒体Capability参数显式绑定materialKey。Movie省略参数保持单源行为，没有新增Capability、Owner或DDL。

执行入口重建精确Case目标，核对维修方式、Strategy、CareRequirement及现场Inventory Identity，拒绝默认取首个成员。Series Workspace媒体Handle的来源摘要绑定该Primary Read Handle；Remux路径、Workspace Handle与outputTarget身份加入成员键，Transcode保留成员Strategy路径，避免相同字节或同种加工互相占用。Verification选择对应原文件、复核来源Handle并检查冻结文件预算；这仍不能替代完整混合成品集合的逐集空间验收。Workspace部分输出清理从实际Remux Event所属Plan node参数重建路径，不再假设共用remux.mkv。

验证：106项评估/策略/Plan/Workspace/合同专项通过；新增Remux清理后Workspace 14项通过。混合Case fixture含1个健康文件、2个转码目标、1个Remux目标，六节点通过正式Plan schema，乱序证据不改变Plan；实际Capability入口捕获的Probe Handle逐一匹配目标，缺成员、健康成员、foreign成员或错误维修方式在Probe/FFmpeg/Workspace写入前拒绝。此捕获测试未执行真实FFmpeg，不能当作媒体加工完成。原生SQLite加实际临时文件验证两个Remux遗留输出经过终态双审计后分别回收。

最终分组全架构2,297通过/9既有skip/0失败（并行2,281，95.2秒；串行stage 16，0.2秒）。架构448文件/1403依赖、语义2066文件与P2合同通过；生成的三个参数schema及registry已同步，P2 aggregate为`fdd2ec6d9660f95b93f618ad869376b0fa20a764ec94fe41b853472e478a02c0`，历史catalog witness本体未改。外部日志前缀`series-member-repair-`，包括targeted/workspace/full/stage/contract。

尚未完成：精确成员物化、完整混合输出验收、Inventory-Control原子Commit/Settlement/恢复及真实媒体Host。自动媒体维修保持关闭；UI/Linux与首版可部署条件不因此关闭，无NAS动作。

## 追加：精确媒体成员物化

基线`1868bc1ece3fe1ab931f3daf121881ad19fe84a0`。物化入口不再默认选择Series首个Primary，而是由WorkspaceMediaHandle的sourceMaterialHandleDigest反查冻结Case唯一目标，并校验生产Intent/Strategy、Result摘要、Workspace所属Case/Entry及Handle摘要。写入前重新检查Workspace实际Physical Identity和内容。Series媒体回执显式列出精确原成员，旧文件的删除仍由独立superseded证据与Settlement授权负责；既有Inventory组装可从此原成员继续取得Episode Claims，不用文件名推断。

实际文件专项：四个Inventory Primary中三个维修目标分别写入对应原位置，独立保存各自旧文件；正常成员字节保持。forward恢复复用相同成品与回执身份，Material Control计算恰好释放三个原成员、取得三个新成员。错source摘要、错Intent、foreign Workspace/摘要及实际成品改写均在替换前拒绝。fixture改用正式bounded fingerprint集成，MaterialEffectReceipt通过正式schema。媒体字节为合成文件，本批没有FFmpeg、正式Case调度或Inventory事务的新增证据。

27项增强专项通过；分组全架构2,297通过/9既有skip/0失败（并行2,281，94.7秒；stage 16，0.2秒）。架构448文件/1403依赖、语义2066文件及diff通过；无schema/DDL修改。外部日志前缀`series-media-materialization-`（targeted/full/stage）。

后续仍须完整混合输出逐集验收、正式Inventory-Control原子提交/Claims持久化、Settlement及崩溃恢复和真实媒体Host；本批没有解除自动媒体维修或整体发布门禁，无生产动作。

## 追加：完整准备成品集合门禁

基线`2e765eff9be98bccaad5a4f96371199a0066875b`。Arca model共用精确验证Event→生产Event解析，完整准备集合要求冻结Case每个目标恰好一份生产与通过验证的成品，全部来自相同Work/Attempt/Plan，Case、CareBasis和Requirement一致。原成员/施工意图及Workspace身份继续逐一校验。以完整原Inventory的Episode Claims构建“已维修成品 + 未替换成员”的混合集合，按成品Handle中记录的测量字节精确计算逐集份额；拒绝缺目标、重复源或输出物理成员、foreign来源及超限。集合摘要绑定空间Basis、各成品与验证Result，并纳入VerifiedCareInventoryChange摘要。

Commit Planner在生成任何物化节点前执行集合门禁，媒体成品Owner Projection再次重建集合后选择精确验证Event；没有把文件I/O放入Planner/Projection。零成品不能借同Case的Artifact结果绕过媒体目标完整性要求。现有同Work执行期投影及Movie单源消费维持原路径。

45项专项通过：混合Case正式Commit Plan schema及Projection消费，缺目标/零输出/重复生产、失败验证、错Case/Basis/Requirement及跨Attempt/Plan均拒绝。独立空间测试含共文件与保留part相加、半字节超限拒绝、未替换成员超限、重复物理输出和改写size。正式物理复核/最终Inventory事务尚未增加证据，不能把本批纯集合验证视为完整媒体维修闭环。

最终分组全架构2,300通过/9既有skip/0失败（并行2,284，100.2秒；stage 16，0.1秒）。架构449文件/1411依赖、语义2067文件及diff通过；无Capability schema或DDL修改。外部日志前缀`series-prepared-set-`（targeted/full/stage）。后续继续提交前现场复核、原子事务/Claims持久化、Settlement/崩溃恢复及真实媒体Host；自动媒体维修和发布门禁保留，无NAS动作。

## 追加：Inventory提交前现场复核

基线`ee11f998a66d29a18daadb6ff7b8407c5bb52de2`。Series媒体Inventory Commit在Control查询及事务构造前重建完整准备集合，并要求物化回执恰好覆盖目标。核对Case/Requirement、原成员Identity、目标路径/endpoint/mount、最终内容与成品一致、回执Reality/Binding摘要；现场检查最终文件、暂存原文件和未替换Primary的Physical Identity。由实际最终Identity及原成员Claims再次重建完整逐集空间结论，任何漂移均拒绝。新Inventory组装的来源改为Case冻结Inventory集合，继续从精确原成员继承Claims。

57项专项通过：最终集合与准备集合的逐集结果一致、原成员Claims保持；十种缺失/重复/错Scope/错路径/改写Identity或回执拒绝。实际Inventory Capability在正常样本进入Control查询，fixture于Control门禁停止；分别改写最终文件、暂存旧文件、未替换Primary后均以`ARCA_AFTERCARE_SERIES_FINAL_REALITY_STALE`在Control查询前拒绝，未发生事务写入。这里验证入口及拒绝顺序，不声称真实数据库原子Commit或Claims持久化完成。

最终分组全架构2,300通过/9既有skip/0失败（并行2,284，108.5秒；stage 16，0.1秒）。架构449文件/1412依赖、语义2067文件及diff通过；无schema/DDL修改。外部日志前缀`series-final-reality-`（targeted/full/stage）。真实Inventory-Control事务、Settlement、进程崩溃恢复及媒体Host仍待完成，自动媒体维修和发布门禁保留，无NAS动作。
