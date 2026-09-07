# Aftercare全链路审计与能力分类

2026-09-08；计划第1—2步交付，非第二份活动计划。审计基线为worktree `codex/user-pain-iteration`、HEAD `8c05999c1`。
5个前序未提交源码/测试文件仍保留（进度采样时间、等待状态、旧进度显示）；它们不等于生产已部署。
本轮只读代码/合同审计、纯函数隔离复算与文档更新；未连接生产或Emby、未部署、未修改Case或媒体文件。

## 结论

原SSOT已有Assessment与Case两层，现有实现也有分离的Assessment Planner，但“可观测变化→健康缺口→真实处理目标”
之间缺少完整分类和准入证明，文件记录同步因此被塞进Case。前端暴露了这个合同缺口，不能只靠隐藏任务解决。
另外，健康投影、Case列表、详情、检查阶段重计算、派生合同一致性均需联动修正。

本轮覆盖14个Aftercare原生Capability、7个Planner、协调器、存储事务、Foundation恢复/资源/巡检入口、两页投影与UI，
并检查Person Evidence、Off-deck/Deregistration及回收站边界。没有把通用Foundation或全部People实现宣称为重新完整验收。

## 已确认用户合同（实施必须采用）

- 第一类：健康状态检查及更新，作用于我的收藏及必要管理记录；不创建整理Case。
- 第二类：真正上架后处理，才是Aftercare Case；它有可执行目标、准入、过程和完成Evidence。
- 海报灯：绿=健康；红=已确认不健康，含等待席位Case；黄=Case已取得席位正在处理；灰=尚未检查/无法判断。
- queued Case不进入媒体整理区，也不计入该列表任务统计；黄灯必须能定位同一维护Case。
- Spec变化先使旧结论失效，经有界重评确认不满足项后大量变红；默认一个取得席位变黄，完成且复验后变绿。
- 无可行处理方案时保持红并说明原因，不建立空任务；环境不可判断是灰，不能假装影片已损坏。
- 收藏详情保留健康文字、依据与必要跳转，删除重复状态灯。
- 整理列表追加任务类型列：上架任务（Libra Run）/维护任务（Aftercare Case）。
- 维护详情复用Libra Run的设计理念、信息结构和组件：真实阶段/计划/动作、等待、进度、结果，技术证据按需展开；
  不另建简化详情，不复制Libra专属业务操作，不合并后端Owner。

上述灯色及queued不可见是用户在SSOT 09-08首次修订后补充的确认；第3步必须回写正文及所有派生定义。

## 全链路对应表

路径均相对仓库根；行号以本审计时点为准。

| 环节 | 当前实现与输入/输出 | 审计结果与下一动作 |
| --- | --- | --- |
| 1 触发 | `care-query.js:12`发布Standard/Placement后wake；`create-procurement-execution-runtime.js:892,903,1079`处理On-deck、Work完成及周期；显式check进入Coordinator | 触发入口齐备；HTTP收集全Shelf ID、手动/周期/完成触发去重及失败推进需专项验证 |
| 2 有界巡检 | `domain-reconcile-runner.js:12`默认每页100、每注册5秒、30秒调度，持久cursor，每Entry后yield；Coordinator按24小时/7天及jitter决定due | 有界基础存在，不能说完全无节流；该预算限制协调循环，不等于异步重计算总量 |
| 3 冻结依据 | `aftercare-context-reader.js:read/healthProjectionInputs`从Arca现有Inventory、Standard、Placement、Identity、Facts形成Care Basis | 保留Owner和已知来源约束；检查记录更新后需明确哪些Evidence失效及如何避免无谓整套重评 |
| 4 Custody检查 | `aftercare-capability-ports.js:404`逐个已知文件stat/有界指纹，形成Finding或Endpoint Incident | Primary安全核对保留；资料文件记录变化须分流，不能等同损坏 |
| 5 Presentation检查 | 同文件`:420`检查NFO存在/可读与海报可用性；不再调用演员/剧情语义比较函数 | 内容比较已收缩，但没有消除NFO指纹→Case路径；必要文件修复仍保留 |
| 6 Conformance检查 | 同文件`:431`Probe、媒体要求、位置、旧Binding；必要时选设备并FFmpeg预检 | 判断与施工可行性试跑耦合；需给检查阶段独立资源预算，且分类不能超出实际Planner覆盖 |
| 7 Assessment提交 | `aftercare-store.js:127`持久三维Assessment/Finding，`assessment.commit`发布结果 | 有审计基础；缺少独立记录更新事务与Receipt，不能借Case Commit同步Binding |
| 8 健康/Disposition | `aftercare-contract.js:258,303`组合三维结论与Case | 红黄灰映射不正确；健康与处理需分开投影，并保持跨Inventory提交的Case关联 |
| 9 Case创建 | `aftercare-process-coordinator.js:reconcile`把auto_repair Findings全量转为RequiredEffect；`aftercare-store.js:133`冻结Basis、Requirement、generation/trigger | 有去重和终态历史，缺少“真实处理必要性/全部目标有执行路径”的明确建单门槛 |
| 10 席位准入 | `aftercare-store.js:178`原子FIFO，默认1，queued不创建Repair Work；Coordinator排队Basis失效则invalidated | 保留机制；新验收要证明红灯等待→黄灯执行→绿灯完成，而非只测DB席位 |
| 11 处理规划 | `aftercare-planners.js:20`prepare、`:35`commit，读取active Case并选择有限节点 | 无节点会抛错，证明Planner兜底较晚；应在创建目标时排除不可执行/仅记录型要求 |
| 12 实际处理 | text/binary/media/placement输出到Workspace或精确位置效果；`aftercare-capability-ports.js`保留fence、rollback、结果校验 | 保留安全边界；统一详情应消费这些真实Plan/Event，不编造阶段完成 |
| 13 Inventory与收尾 | 同文件`:inventoryCommit`、`aftercare-store.js:219`原子Inventory/Control/Result/Marker；后续精确Settlement | 不放宽精确删除保护；记录更新应建立独立事务，不复用要求Case FK的现有commit |
| 14 复验与终结 | Coordinator `progressCase`等待提交/Settlement成功、深度复验、closure后resolved；失败有有界替换和unresolved | 保留，不以Capability成功提前关单；修正自有Inventory提交后健康投影丢失活动Case的问题 |
| 15 停止与恢复 | 同文件`stopCase/basisMatchesCase`、Foundation恢复、Off-deck Reservation/Deregistration fencing | 不合并Libra生命周期；终态不重开，Basis变更不能改旧目标；新增记录更新需进入相同并发保护 |
| 16 Workspace回收 | `aftercare-workspace-store.js:194,265`终态24小时及引用/活动Work检查；Coordinator独立reclaim Work | 回收是处理生命周期技术收尾，不应再产生用户维护Case；未解决诊断保留与中间文件保留要区分 |
| 17 持久回收站 | `recycle-application.js`精确来源、扫描根隔离、manifest、物理归档/恢复/到期清理 | 与临时Workspace不同；已有上架源收尾不应被重复包装成无关Care Case，归属需在合同显式列明 |
| 18 用户投影 | `care-query.js:19`列表/计数及详情；`CollectionPage.tsx:167,199`海报/详情；`FormationPage.tsx:ProcessDetail`及`CareWorkRow.tsx` | queued泄漏、全历史读取、详情不统一；需按用户确认重做投影合同并复用视图组件 |

以上后端Arca路径前缀为`media-service/src/helix/domains/arca/`；Foundation与composition路径如名称所示。

## 全能力分类

分类A=健康状态检查及更新；B=真实上架后处理；C=保留Finding/环境观察、无可执行Case；L=处理生命周期/行政收尾。

| 能力或场景 | 当前路径 | 应有分类与边界 |
| --- | --- | --- |
| 已知Primary存在、可读、身份核对 | custody.observe | A；发现丢失/身份无法证明后C，不搜索替代来源 |
| Endpoint暂不可用 | custody.observe的Incident | A→C观察/灰灯，恢复后重评，不批量建损坏Case |
| NFO存在可读，仅大小/指纹或演员剧情呈现变化 | custody Finding→textRender→artifact reconcile→Case commit | A；精确取证和独立记录更新，零Case、零文件改写 |
| 必需NFO缺失、空、不可读 | presentation.observe→text_artifact.render | A发现，确定可生成时B，否则C；不能因“有生成器”就跳过来源/权限验证 |
| 海报存在且可用 | presentation.observe | A；无谓再生成不进入B |
| 海报指纹变化但实际可用 | custody目前material_identity_changed→attention | 待补精确资料角色/关联证明；满足要求且安全可证时A，否则C，不能推广为自动接纳Primary |
| 海报缺失/损坏，稳定Provider与获取路径存在 | binary_artifact.acquire | A发现、B补取；Provider暂不可用要与产品Gap分别表达 |
| 媒体Probe/要求比较 | conformance.observe | A；尽量复用仍有效Evidence，避免普通健康查询触发 |
| 编码、容器、扩展名、体积不符合要求 | transcode/remux/media.verify | 有确定策略时B；环境/策略不支持时C，不推动Procurement寻源 |
| 其他音频、分辨率等要求缺口 | probeConformance目前非4类可修复码→attention | C，除非新增合法处理能力；不能承诺当前均可自愈 |
| 已知Inventory位置/布局不合规 | placement相关5个arca.inventory Capability | A发现、B精确迁移；既有collision-only规则保留，不按同目录猜归属 |
| 位置与其他媒体/资料缺口组合 | hasIncompatibleRepairCombination | 当前C保守拒绝；保留明确限制或设计顺序处理，不声称已支持所有组合 |
| 旧Binding重复/未知残留 | conformance旧Binding检查、Settlement、独立recycle | 已证明的实际收尾B或既有流程L；未知C；单独settlement_gap当前不自动建Case |
| Metadata、Media-Cast、Person确定性关联记录 | Arca现有relation Evidence Projection | A；补齐观察与记录更新合同，不能删除People能力或为记录修正建Case |
| Assessment/Finding/健康投影持久更新 | assessment.commit | A，操作Receipt不是CaseResult，不计完成维护数 |
| 输出materialize、Inventory/Control commit、精确旧文件Settlement | artifact.materialize/inventory.commit/input_settlement.delete | B内部步骤；记录型Binding同步从该链路拆出 |
| 输出复验和Case结果提交 | media.verify/case.commit及复评 | B内部收口；复验不是新的独立维护任务 |
| 临时Workspace回收 | workspace.reclaim | L，引用/fence/保留期保护；不制造新Case |
| 持久回收站恢复和到期清理 | recycle application | L，独立生命周期与精确授权；不是例行健康检查 |
| Off-deck/Deregistration停止维护 | reservation/fence | L行政边界；不因此授权删媒体或回流Libra |

14个原生Capability分组：A四个（custody/presentation/conformance observe、assessment.commit），B九个（text.render、
binary.acquire、artifact.materialize、media.remux/transcode/verify、input_settlement.delete、inventory.commit、case.commit），
L一个（workspace.reclaim）。记录同步目前没有独立Capability/Command/Receipt闭包，是必须补齐的缺口；不能拿分类表冒充实现完成。

## 问题清单（已证实）

| ID | 层级/影响 | 证据 | 修正与验收 |
| --- | --- | --- | --- |
| AC-01 | 合同/后端：记录漂移被升级为Case | `custodyIdentityChangedFinding:213`对NFO给auto_repair；Planner`:21`支持nfo_identity_changed；`:449,513`产生Workspace再reconcile原NFO | 独立记录更新Command/Receipt/Inventory-Control事务；可读NFO漂移零Case、字节不变、重放无重复revision |
| AC-02 | 投影：红黄灰不准确 | `projectHealth:287`queued→observing；纯auto_repair Finding没有明确unhealthy分支 | 下述隔离复算已证实；新增明确健康与维护关联，不靠前端猜状态 |
| AC-03 | 生命周期/投影：自有Inventory提交后活动Case关联断开 | `projectHealth:261`仅保留careBasisDigest等于当前的Case，而正常commit使inventoryRevision改变；Coordinator另有basisMatchesCase处理此情况 | 复算可出现Case仍active却整体healthy；投影应消费合法commit连续性，在完整收口前保留对应维护关系 |
| AC-04 | 资源：检查阶段存在席位外编码试跑 | `assessMediaRepairStrategy:358`→`clean-media-production-effect-port.js:339`编码24帧、30秒超时；composition`:660`该Assessment只申请cpu_heavy及volume_read，设备token只在真正transcode节点申请 | 判断必要性与试跑分层；试跑按真实encoder/worker资源准入；批量Spec变化验证所有重计算都受控 |
| AC-05 | 前后端：queued仍进入列表/计数 | `care-query:20–34`全Case排序、计数、分页，无queued排除；UI合并careItems | queued保留后台红灯等待，但列表、搜索、分页和统计均排除；黄灯关联的active任务必须可定位 |
| AC-06 | 前端：维护详情只是摘要卡 | `CareWorkDetail`只含目标、阶段、百分比与reasonCode；Libra `ProcessDetail/ProcessStageView`有真实Plan/Event和证据 | 后端提供Case专属过程投影，前端提取共用详情组件；不能仅改CSS或在浏览器拼造步骤 |
| AC-07 | 性能：列表分页发生在全历史读取后 | `care-query:21`listCases读取全Case，active逐项caseProgress又读取上下文/历史/Work；`shelfBasisChanged`在HTTP枚举全部Entry | 实际DB有界分页、批量投影、历史按需；检查规模增长及并发两页读取，不用单端点快照冒充整页验收 |
| AC-08 | 派生合同漂移 | transaction aftercare-case-creation仍写Case active；model CASE_STATES漏queued；table/Store已使用queued | 统一SSOT、机器合同、状态枚举、API、UI、Fixture；不能仅让schema测试通过 |
| AC-09 | People合同覆盖不足 | SSOT §6.6.2.1要求有界NFO人物观察；`on-deck-person-evidence-projection`只读现有arca_inventory_person_relations，无新NFO文件观察 | 明确保留已有关系Evidence消费；补齐新观察→确定关联记录更新路径或列出未实现项，不声称人物能力已完整守恒 |
| AC-10 | 收藏UI与新要求不符 | CollectionPage隐藏healthy海报标识，observing黄色/repairing蓝色CSS，详情还存在第二组灯 | 四色语义统一；删除详情重复灯；语义文字与可访问名称保留 |

AC-04不等于已证明无限并行：当前仍有cpu_heavy/volume Governor；缺陷是Case席位没有覆盖这段真实encoder工作，
且缺少对应设备资源申请。需要批量故障/容量测试确定实际峰值，不以代码判断捏造生产雪崩。

隔离纯函数复算：使用真实`projectHealth`，三维Assessment当前Basis，Conformance存在auto_repair编码Gap：

| 输入 | 当前输出 | 用户合同期望 |
| --- | --- | --- |
| 无Case、已确认编码不满足 | never_assessed | 红/已确认不健康 |
| 同Basis queued Case | observing | 红/等待席位 |
| 同Basis active Case | repairing | 黄/可定位维护任务 |
| 正常Inventory提交后的新Basis三维healthy、原Case仍active | healthy | 不能丢掉正在收口的Case关联；以完整结束条件决定转绿 |

脚本保存在ignored `.codex/audit-aftercare-health.cjs`，无真实媒体或数据库依赖。这是局部可复验反例，不是完整E2E。

## 已有机制应保留

1. closed-world已知Inventory输入，Arca不搜索未知来源、不回流Procurement/Libra、不直接Off-deck。
2. 分页cursor、周期/jitter、每Entry yield，以及默认单席位原子FIFO和queued零Repair Work。
3. Basis和Off-deck/Deregistration fence；有界重试，终态不原地重开。
4. 文件替换rollback、精确Identity/Settlement许可、Inventory与Control及Event Result原子提交。
5. 提交和收尾后再复验，Case终结与Workspace延迟回收分离；持久回收站独立。

已存在测试包括`p15-aftercare-case-generation`单席位100项测试、effects-safety精确替换/回滚测试、contract周期/
Basis/Placement测试、projection-source进度测试及recycle故障恢复测试。本轮没有重跑这些完整套件，不把前序通过
解释为新用户合同已经验证；尤其100 Case存储测试不覆盖整Shelf触发、FFmpeg预检、两页灯色或真实提交收口。

## 需要在后续实现前补证的风险（未声称已复现缺陷）

- 手动check、周期到期、Work完成和Basis变化交错时：触发是否漏推进、重复深检或延迟Case创建；检查失败后是否
  及时形成可理解状态。当前完成回调仅对succeeded直接reconcile，其他依赖周期，须端到端验证。
- Rating Resolution pending在Coordinator最前面可能阻挡其他独立健康检查；需验证只阻挡实际依赖评分的维度。
- Workspace/Provider/Device故障：不能把环境暂不可用与产品持久Gap混为一谈，需Incident聚合/恢复测试。
- 健康Evidence过期时UI如何表达freshness；Basis变化和到期的灰灯规则应统一，不能一处红一处灰。
- record更新与活动Case、自有Inventory提交、Off-deck并发的原子性与失效传播；暂无新事务，不提前声称已安全。
- 未解决Case的诊断Evidence与临时文件24小时回收的关系；清理不得销毁必须保留的解释证据。
- 旧NFO Case生产处置必须重新读取精确状态、Work与物理效果；09-08早先queued记录只作历史证据。

## 下一步衔接（从属于CURRENT_PHASE）

第1—2步本轮完成。第3步优先闭合三组合同：健康/处理双维状态与四色投影、独立记录更新事务、Case目标与
准入前后资源边界；同时统一真实过程详情Projection及所有派生状态。随后按AC-01→AC-02/03/04→AC-05/06/07
推进实现，穿插AC-08/09传播与AC-10前端验收，再按原计划进行生产数据处置、部署和清理。
本报告不要求重新授权已批准方向，也不授权跳过新事务/Owner合同闭合直接改生产数据。
