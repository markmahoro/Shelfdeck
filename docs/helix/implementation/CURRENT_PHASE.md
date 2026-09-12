# 当前活动包：逐项关闭UAT

2026-09-12 UAT-251生产复验追加：用户确认修复已接受瑕疵误识别、9项误建维护Case及19部收藏状态。隔离实施`codex/aftercare-accepted-defects`；读取精确Handoff B冻结要求、正式取消未提交的自动瑕疵修复、重新检查旧笼统结论；保护原片、授权与历史，交统一部署负责人发布。证据见`implementation/evidence/UAT-251_ACCEPTED_DEFECT_RECOVERY_20260912.md`（执行包相对路径为`evidence/`）。

更新：2026-09-12。ACTIVE；合同审查及三项用户确认已完成，用户要求整理文档后继续推进。
唯一排程为[Master Plan](../CURRENT_PLAN.md)，状态及每项现行关闭条件为[UAT总表](../UAT_ITERATION_REGISTER.md)。

## 当前执行位置

2026-09-13 00:04最新：UAT-251 `e7c84dd536`候选已构建/上传/校验，真实Linux公共端口、完整Host及旧286回退通过；切回副本正式检查使8误Case终结，但《拆弹部队》旧Effect reconcile_required阻止drain，其他检查提交仍待资源。当前生产未apply；原开发任务正在补正式收尾，部署任务保留现场并继续验收，不以Reset/释放资源行绕过。见[本批门禁](evidence/UAT-251_ACCEPTED_DEFECT_RECOVERY_20260912.md#联合部署验证与收尾阻塞)。

2026-09-12 22:33最新：《人生密密缝》获用户“确认”后，唯一旧重复输入已备份移出，正式工具精确Reset旧Subject/23 Works/1 Workspace；原健康收藏、122收藏事实及其余9文件保护通过。原版本重启healthy，活动整理查询已无本片旧条目。后台旧候选仍open、Reservation待结束，生产3席位满，不能把副本拒绝/ACK证据写成生产已闭环；接续只核验正常队列的最终拒绝/ACK，不重复Reset、不提高席位或处理其他Token。范围、备份及验证见[执行结果](evidence/UAT-125_250_INTAKE_RECOVERY_20260912.md#人生密密缝获授权生产清理结果)。125/250保持开放，定时任务仍停止。

2026-09-12 21:34最新：《宇航员》当前Token（acquired1789162455613）+2旧Work精确生产Reset已获用户“允许”并执行。离线完整备份和相同manifest复核通过，80表/其他2Token保留，删除Subject/Run/Workspace/Control/收藏0；同286镜像重启健康。生产新Evidence→正式Rejected→Procurement ACK→释放5Reservation/目标Token闭环通过，正常队列已接入下一项；原122收藏保留。此前接收错误未再出现，AbortSignal警告另行保留。证据见[生产清理结果](evidence/UAT_RELEASE_286FE56F1E_20260912.md#获授权生产精确清理结果)。本具体阻碍已收口，125/250其他条件及251完整验收仍开放，定时任务保持停止。

2026-09-12 21:00最新：联合286fe56f1e已标准发布并完成生产健康、接口、数据保护验证；完整副本升级/备用切换/切回及真实媒体链均通过。接续251剩余业务/UI验收和125/250存量责任，不再等待本批部署。定时任务停止。详见[本批发布](evidence/UAT_RELEASE_286FE56F1E_20260912.md)；下方过程描述为历史时点。

2026-09-12 12:45Z接续：联合fa96完整副本Host、精确Linux与真实媒体链已验证；e056恢复修复已合入，源81e95重复聚合修复已交付。剩余为最终合并镜像、同格式备用镜像对运行后同一副本的验证与标准发布。旧cd4f不支持197表/d8；不得使用旧DB覆盖新媒体事实。最新证据见CURRENT_STATUS，不再沿用下面“联合镜像未验证”的旧时点结论。

2026-09-12最新：261独立5428精确镜像已通过完整生产副本Host启动，旧7项阻断清零；候选开始运行后新增4个d8 Plan使cd4f回退失败。251最终9bd17be50与260源5096ab55a已合并，联合197表与87cap schema闭包已同步；全架构/精确联合镜像Host及运行后可行回退仍须验证。251此前迁移失败原子回滚不代表197→189成功降级。部署授权持续有效，生产仍cd4f，详见CURRENT_STATUS与261部署Evidence；不沿用下方历史“待提交”状态。

UAT-251由本任务连续实施至验收：先完成精确Gap及Libra持续授权、有限终局与责任收尾，再接通Arca精确接纳/手动修复/同条件失败抑制及健康投影，最后完成协同确认后的UI、真实媒体、重启和适用生产验证。“自动授权瑕疵上架”初始未授权；用户开启后由后台对当前及未来合格候选逐项建立正式授权，关闭只阻止后续新授权。UI协同与逐项Evidence追加到既有[251记录](evidence/UAT-251_TERMINAL_OUTCOME_AUDIT_20260908.md)，不建立平行计划。

2026-09-12追加：UAT-261 精确 Catalog retirement 本地实现按旧/新完整语义及 schema 闭包、持久 DAG 和提交引用核验；最新一致副本 4764 Plan 中4757通过，仅7项23个未决物理Effect保留阻断。既有LibraProductFactEvidence名义合同补齐schema，历史缺生成物事实明确保留；活跃旧Intake不兼容。完整Host门禁、未决Effect正式收口和生产决定仍交统一部署任务，未关闭、未部署。详见[验证与精确责任清单](evidence/UAT-261_CATALOG_RETIREMENT_PROOF_20260912.md)。UAT-260三个未提交实现文件保留，未夹带本批。

2026-09-12第二批d7a6da2802发布失败：数据库readiness通过，但完整Host因大量历史PLAN_CATALOG_DRIFT未启动。已标准回退cd4f3f5b2d，StartedAt2026-09-11T21:32:51.809272745Z，健康/五挂载/fnOS/113收藏及970份Delivery复核通过。此前原两Token精确Reset已执行且保留，未恢复DB；5旧Offer仍open，旧版已产生新Token，不得扩大或复用旧Reset范围。新增261优先定位启动合同与补完整Host门禁，260随后，251独立。[事故记录](evidence/UAT-261_CATALOG_STARTUP_DEPLOYMENT_20260912.md)。

2026-09-12新增UAT-260：隔离演练中大Run FailedPreparationRetry将完整DTO内联至Plan，触发16 KiB CHECK；SSOT要求typed binding refs，禁止扩大上限或旧Work fallback。正常恢复链用修正BigInt桥另建副本继续；重试缺陷单独修复验收，生产未变更。见[缺陷证据](evidence/UAT-260_LARGE_RUN_RETRY_INPUT_20260912.md)。


首批cd4f3f5b2d已部署，257/258/259逐项验收关闭。新扫描73页完成、六片普通选材产生新Package/open Delivery、原8份拒绝不变；生产UI与授权保持通过。当前接续251、正式Control拒绝链及精确旧条目恢复，详见本批发布证据。

发布由“收口并部署上线”任务统一负责合并、工作区清理及上线，按UAT-251、接收恢复、UAT-257扫描修复的实际依赖与验证结果自主安排批次；UAT-258完整提交38e89d145已生产验收关闭。此次任命无需广播，不限制必要技术协调。各开发任务不独立部署；当前生产为cd4f3f5b2d，首批标准部署及健康/浏览器验证已完成。见[接手审计与发布缺证](evidence/UAT_JOINT_DEPLOYMENT_READINESS_20260912.md)。

2026-09-12接收恢复：9820e7b85核心已部署，9ecf7b2a1正式Control拒绝和d591d6867证据已合入d7a6da2802。独立发布区Windows组合38/38、完整架构1647通过/9跳过/0失败，DDL不变，候选镜像Linux117/117通过，试发布完整Host失败已回退；CAS后竞争保持原Evidence/Effect/Token。原两Token Reset已执行、最新副本scoped正常链已通过；下一步261完整Host启动修复及现场重新核验，不能再次沿用原两Token清单。[范围与证据](evidence/UAT-125_250_INTAKE_RECOVERY_20260912.md)、[集成验证](evidence/UAT_JOINT_DEPLOYMENT_READINESS_20260912.md)。

2026-09-12：UAT-256已获用户实施授权，在`codex/ui-polish`隔离工作区完成前端视觉与文案整理，89项测试、桌面八页本地与83235c9260生产八页/五Tab验收通过，已独立关闭；[范围与证据](evidence/UAT-256_UI_POLISH_20260912.md)。不夹带其他开放项，不修改媒体整理现有列表或业务逻辑。

1. 整理已确认合同及活动文档，去除旧暂停/待决策和已关闭队列；检查261项连续、状态计数、剩余32项归属及链接。历史过程保留Evidence。
2. UAT-171已按现行Oracle关闭，见[真实媒体/生产证据](evidence/UAT-171_NFO_CURRENT_CONTRACT_ACCEPTANCE_20260909.md)。135/136已按真实ISO完整链与生产48077d71bd发布逐项关闭；132已按Windows/Linux真实Direct HEVC完整链关闭；137/160已按[独立真实媒体证据](evidence/UAT-137_160_FRESH_MEDIA_ACCEPTANCE_20260909.md)关闭。
3. UAT-210：记录更新已部署，继续单席位、批量变化、健康与处理状态分离的完整验收；已接受瑕疵及同条件重复Case部分按251已确认合同实施，不把局部通过当整项完成。
4. 接续B1–B5：125/152使用新确认规则；172已按正式授权闭环独立关闭，见[验收](evidence/UAT-172_AUTHORIZATION_ACCEPTANCE_20260909.md)；134已按[精确范围及重放证据](evidence/UAT-134_SCOPED_SETTLEMENT_ACCEPTANCE_20260909.md)关闭；159/163回收已关闭；156/157真实设备及预检亦已关闭。继续125/152更广恢复与压力条件核验。218真实质量保护已独立验收关闭；210/125接续检查过程中更换标准导致旧Assessment提交/恢复失败的隔离复现。251已确认typed合同，继续实现，无待询问的旧业务决定。
5. 125/250恢复输入漂移保留精确因果证据，不吞错/Reset；209/216存量核验保护现有收藏、正常生产、sample及另一完整版本。
6. 245已按独立生成快照、Owner计数/分批读取、真实备份完整服务及生产浏览器验收关闭；240/241/248已按[八页浏览器及隔离确认验收](evidence/UAT-240_241_248_BROWSER_ACCEPTANCE_20260909.md)分别关闭；接续251已确认typed合同落地。247跨页缓存仍独立开放。

## 验收及保护

每项按原问题、现行SSOT、实现、正负路径、适用真实媒体/浏览器与生产版本核验；提交、测试或部署不单独等于关闭。仅有新变化、失败或缺证时重复已通过检查。发现已被取代要求时按当前条件验收，不能为使旧测试通过恢复旧行为。

本轮73项功能关闭、32项开放及206承接已核实。当前生产`cd4f3f5b2d`，[发布及回滚证据](evidence/UAT_RELEASE_CD4F3F5B2D_20260912.md)。

用户授权实施、本地验证后标准发布、允许中断FFmpeg；精确Input清理持续授权已明确。有效媒体/持久事实/Secret/备份/回滚保护不变，不直接SQL修改生产，不任意Reset。原Aftercare调查Evidence修改不覆盖、不夹带提交。工程选择自主处理，真正新增业务边界才逐项询问。

## 已部署三片修复的剩余范围

本节以下为历史冻结方案。《人生密密缝》现已证实有另一健康正式收藏，原两文件隔离及旧Run重试不得执行，现行方案以页首及恢复证据为准。

9月11日已部署代码纳入本次集成；《太阳帝国》恢复已完成，其他条目不随本次UI发布自动关闭。以下保留原包冻结范围，不在本次UI/Procurement验收中额外执行。



1. 已完成：标准build-image → upload-nas-image → SHA256 → deploy dry-run/apply；完整data和配置备份位于`/vol1/1000/docker/shelfdeck/backups/three-films-c10e516e64-20260911`。未clean-init/Reset或直接改SQLite。
2. 《人生密密缝》精确 On-deck Run 为 `844d2564f525ee73c36564559e8b5cbefc704f8cf65457796af7b72bf6215615`。停服后重验下面两个冲突文件的 size、SHA256、非 symlink、路径 containment，以及当前 Inventory/Libra Binding/Off-load Context 未引用它们；任何变化停止。
   - 2026-09-12 10:02Z只读重验已停止后续操作：Run仍blocked、Commit0，但NFO变为7416 bytes/SHA256 `06124f81db048bfb6030c90744a407c30677dc702fc01bf0e0e8f65a677cdfd2`，原poster未变；operator返回`QUARANTINE_EXPECTED_IDENTITY_CHANGED`。本轮未隔离或修改文件，不沿用下面原清单执行。记录在ignored `resume-close-knit.json`，需先重新核对当前冲突与授权范围。
   - 10:08Z进一步只读核对：两文件现在均有current Arca/Libra Binding及Off-load Context引用，即便按当前指纹模拟inspect仍为`QUARANTINE_REFERENCED_FILE`。关联Subject为`libra-subject-16840a150d21691ee3d8d67e7c926af7d55f4f10`、Arca owner_object_id为`0ed81eff0ac03622a5e09c78a4f289d333941d0dd33da8fa2d3c2053ef2db7d4`，Package为`e9938da46df82bc89a1d0a6affdd595661dd72d409712e88359d01dc38cf2154`；不得将其当作无主冲突文件隔离。待原Owner核对现行责任，不仅是更新文件摘要。
   - `/media/Film/人生密密缝 (2017)/人生密密缝 (2017).nfo`：7427 bytes；SHA256 `0c36f85dad179428446e6fb946a98df535913aa297dc9e90be83285560df25d4`。
   - `/media/Film/人生密密缝 (2017)/poster.jpg`：1031527 bytes；SHA256 `db80299781122985c4dea6001f88bcffce25c7f5952c91823259eb3bc98f8619`。
   - 两项先复制到应用根下独立备份目录，验证复制的 SHA256 及原件仍未变化，再移出冲突位置；保留 manifest 与原件恢复路径。原 MKV、字幕、旧源 NFO、fanart、torrent 不在隔离范围。
3. 已完成：《太阳帝国》精确On-deck Run为`28c2d89e239b3e6d50bbbcdaeafe37fb5e04685fe9a1aa1c68238863d673fbb9`。恢复前重新验证7项Final；generation 5正式retry成功，11项精确旧输入均absent，7项当前Inventory核验通过，246项范围外文件前后不变，BACKUP/META保留。详情见本包证据。
4. 两条均使用正式 `POST /v1/admin/formation/acceptance/:offerId/actions/retry`，以当前持久事实解析 Offer ID，不手改 Work/Event/Effect。若旧执行仍活动，先让修复后的当前 Owner 恢复流程收敛，不人为置终态。
5. 验收必须看到每条恰好一个 On-deck Commit、相应 Shelf Entry/Deck Fact、精确 Inventory 文件、settlement/member 终态及无活动相关执行。只看到 UI 进度变化不算恢复。
6. 《一战再战》保留合法外部下载；验证页面当前阶段及解释，不取消下载、不放宽 DV 转换、不调整14 GiB要求。
7. 回滚先保留新现场及失败证据；新镜像无 Schema 变更，可回滚 binary，但不把已完成的正常业务 Commit 当作应回滚数据库。冲突备份只在目标无人占用且核实当前 Owner 后恢复，禁止覆盖新产品。
