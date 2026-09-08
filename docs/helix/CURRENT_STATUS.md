# ShelfDeck 当前状态

更新：2026-09-08。主线未全数关闭；逐项状态见[UAT总表](UAT_ITERATION_REGISTER.md)，后续顺序见[CURRENT_PLAN](CURRENT_PLAN.md)。

## 最新链路发现（2026-09-09）

UAT-217真实媒体Host已证正式身份评分命中/要求重算/Run替换，但新Run再次要求相同身份确认，接续仍待修；失败测试草稿保留未交付。隔离Host准备自定义模板时发现发布通知没有消费者，已独立登记254；生产未改。总表254行，本轮新增关闭12项，86项待实施/验收，206另保留承接核实。217改用系统现有规则继续验证，不能通过延迟通知假装254通过。

## 最新逐项验收（23:45）

UAT-119真实NAS代理连接、资料、人物头像及海报共7次GET均200；11项集成回归及生产Edge配置核对通过，逐项关闭。本轮新增关闭12项，85项仍待实施/验收，206另保留被取代承接核实。没有重启或修改生产配置。

## 最新本地修正（23:40）

UAT-213真实Host旧Case创建目标在Target修订/新Case/重启后保持不变，70.97秒链路通过。实际DTO浏览器发现非媒体目标遗漏并已修正，65 Web/build及Edge显示通过；基础快照已部署696b122da4，新增UI尚未部署，需新构建，不能沿用d24候选声明包含本次改动。

## 最新发布准备（23:00）

候选d24f13b3db已从干净发布工作区构建、标准上传并通过SHA256校验，dry-run生成；隔离Linux 12个GET通过/readiness ready。尚未apply，生产保持696b122da4并保护在飞转码。tar与校验见UAT-243 Evidence；最终发布前须刷新运行状态及一致备份。

## 上一本地修正（22:54）

UAT-243核实历史修复不完整：来源刷新会重读全部分拣策略并覆盖草稿。已改为展开才读取、刷新保留草稿、读取失败阻止发布并提供明确重试；64 Web测试、构建及实际浏览器HTTP请求数量验证通过，尚未部署。

## 上一逐项验收（22:48）

UAT-146阶段说明已通过生产页面核对及本地72页完成/2批分拣/空整理区真实浏览器操作，独立关闭。UAT-128新增真实ASS、持久Approval及子进程崩溃/恢复/重放/后生文件保护验证25项通过，完整Host自动恢复Canary仍开放。生产仍696b122da4，22:44有70部收藏、2个Libra进行中及1个FFmpeg；没有为验收重启或Reset。

## 上一本地交付（22:25）

UAT-212真实浏览器对照了美国队长转码和素媛资源等待，发现并修正等待说明误称执行、历史失败阶段提示需要处理及终态残留当前进度。25后端过程测试、61 Web测试、Web构建和架构校验通过；本地Edge失败场景验证通过。尚未发布，保护生产在飞任务；整个212仍开放。计划/执行包已整理过时进度并保留历史快照。

## 最新清理事实（22:10）

用户要求优先清理NAS且仅限本项目。UAT-253第二批精确删除ShelfDeck根内54旧tar，释放36.87 GiB；当前系统卷可用65.71 GiB、使用率62%。保留24个近期/稳定tar及所有Docker镜像、备份、数据库和媒体。无容器重启，29个容器身份未变；ShelfDeck仍为696b122da4。6个API检查均200；当时收藏70部、整理2进行中/0待处理、0活动维护Case，业务由正常运行继续推进。完整清单见UAT-253 Evidence。

## 上一生产验证快照（21:52）

- 镜像`markmahoro/shelfdeck:helix-beta-20260908-696b122da4`，source `696b122da4`，Image ID `sha256:c35d7ad1672a8859da85fb9224461cdd13cb4d9eb71ce0163c6cb0bd744893b8`，Tar SHA256 `9edf350c11efcd317e0507e986cef5ca0a164b185660dacc0cf6953b6c0eb640`。标准build/upload/checksum/dry-run/readiness/apply完成；747110c653基线Service511 PASS/19 SKIP及真实影片全链72.2秒通过；本次回收15项、Web59/build、222架构文件、Linux隔离12个GET通过。启动13:47:31 UTC。
- 69部收藏，63完成上架/2待处理/0进行中；Aftercare44成功/11历史失败结束/3 invalidated，0活动Case。活着/沙丘旧失败未Reset。黑寡妇已上架，不能继续引用旧待确认快照。
- UAT-210缺失指纹装配修正已发布：12条NFO记录更新Receipt，0新增Case；原7部NFO记录问题均自然恢复healthy。13:42 UTC全部69部均healthy，0新增维护Case。UAT-211/214既有关闭保留。
- 备份`backups/uat-iteration-20260908-696b122da4-final`，DB SHA256 `c8653b171657959b825d4434cb6bcdbc56d0850bff1b49b9caad1c49c5fe587e`，加密凭据齐全。此前5c7bc1f043/79874990b6/6e37bf5679镜像及引用备份保留。
- UAT-215生产7个新On-deck自动收尾记录已验证，6个在用原目录保留；黑寡妇3张剩余图片经实际浏览器精确确认后已归档可恢复。收尾读投影已随696b122da4发布，真实浏览器及3文件SHA256核验通过，215关闭。216完整1080p版本保留，52.6秒样片处置仍开放。
- UAT-252有界readiness发布验证已关闭；UAT-253清理32旧tar共16.73 GiB已关闭。本次新镜像/备份后NAS可用约28.9 GiB。
- 总表253连续编号；接手后新增关闭130/144/145/211/214/215/219/239/252/253。其余87行待实现或验收、206被取代待核清；UAT-251两项具体用户结果仍待确认，继续推进独立项。
- 当前还有重复`P3_CONTROL_CAS_CONFLICT`：精确材料为宇航员旧BDMV/CLIPINF/00000.clpi，Control仍属Procurement Field，非这7部NFO。待定位原场景及历史映射，不直接修改Control或Reset掩盖。

## 接手与日内历史快照（以下不代表当前部署）

- 接手核实：集成工作区`codex/user-pain-iteration` HEAD为`7c858523c`；唯一既有dirty文件为Aftercare调查Evidence，原内容受保护。相关UI任务idle，交付e6b7f0424尚未整合。本轮未部署、未重置、未修改生产媒体；下述生产镜像与Image ID现已通过SSH只读复核一致，health正常。
- 全量台账初步一致性对账：251个连续ID；153历史关闭、1文档关闭、1非缺陷接受、95待实现/验收、1被取代待核承接。96行已补具体场景/依赖/排程；历史资格待核不能转为本轮PASS。已发现终局、健康三态、全量续拉、退出页常驻整库及43部旧恢复基线与最新决定不一致，正在传播合同。

- 生产镜像：`markmahoro/shelfdeck:helix-beta-20260908-6e37bf5679`，source `6e37bf5679`。
- Image ID：`sha256:356c034aca554dc206d7c2050b38d9ba646c6c0c1f43f66d7a57aa1f86f3d976`。Tar SHA256：`404da86c43eccc15c68b00b5d63832b1012d165ea7768d89deed6870fc581d90`。
- 标准发布已通过。回滚镜像275923039f及备份`/vol1/1000/docker/shelfdeck/backups/aftercare-health-case-20260908`保留。
- 本地1755743c1：详情加载/错误/迟到响应保护、倍速显示、大NFO有界记录同步；Service501 PASS/18 SKIP、Web47 PASS、214 Fixture Gate通过，未发布。
- 独立UI交付e6b7f0424：Service串行501 PASS/18 SKIP、Web49 PASS、构建与214 Fixture Gate通过，1440/1280浏览器fixture验证；并发测试曾有依赖缺失和watchdog超时，原Evidence保留。未整合、未部署，不代表生产UI验收完成。

## 最近现场与未完成项

09-08 12:57只读快照：56部收藏、54绿/2红/0黄，原54部全保留。两项红灯是007与第三度嫌疑人历史路径身份变化，修正归UAT-211；不手改健康字段。

09-08 14:03已知旧目录核查：Top Gun为定向回收（11文件、4,015,976字节、哈希复验）；霍比特人1/信使只剩种子，哪啊哪啊神去村含sample命名视频，夺宝奇兵5含另一1080p视频。本次其余文件未移动；UAT-215流程未建立，UAT-216存量未完成。

UAT-213建单目标Evidence、UAT-214人物观察仍未实现；UAT-217/218支线未修复。真实浏览器整合验收与后续发布未完成。5分钟自动化保持PAUSED，停止Emby归因审查。

详细事实见[实施证据](implementation/evidence/AFTERCARE_HEALTH_CASE_IMPLEMENTATION_20260908.md)。此前停机、恢复、测试与中间镜像流水保留于[整理前状态快照](implementation/archive/20260908_PRE_PROD_CONSOLIDATION/CURRENT_STATUS.md)，不再混入当前事实。当前库存以机器manifest为准，不在多份治理文档手工复制计数。

本轮本地：6aff1635b完成全量排程/已确认合同传播；2a9efbbac实现UAT-211精确历史Settlement排除（40定向PASS，215架构Fixture文件及全部Gate PASS）；799433c65整合UAT-212交付。收藏分页补充实施中，Web50 PASS，尚未浏览器/生产验收。原Aftercare调查Evidence未提交修改仍保留，未关闭功能UAT。

### 2026-09-08 迭代本地整合补充

UAT-213创建时有效目标快照dcbcc8314；UAT-212收藏分页7f80831c2、实际动作6b7486d43及统一有界整理分页完成本地回归。218个architecture fixture文件与全部Gate、Web53项、Web build通过；本地Edge合成场景翻页/刷新/跨页筛选/详情通过。以上未部署、未新增验收关闭。生产林肯律师73%转码与黑寡妇等待资源仍受保护，活着仍保留P5_PROVIDER_RESPONSE_INVALID原失败。NASpreflight正常，准备干净检出构建，不能因当前在飞工作未结束而强行打断。

UAT-144现有生产普通HTTP来源/收藏架页已实际导航验收，无randomUUID定向回归通过，按原问题边界单项关闭；UAT-145保存与146来源进度保持开放。详见UAT-144_HTTP_PAGE_ACCEPTANCE_20260908.md。

UAT-217已完成正式身份评分Target与生产前Acceptance重算本地修正，17项定向回归通过；仍待全链路验收，未关闭。UAT-213先前“未实现”描述为接手历史快照，创建目标快照已由dcbcc8314实现，剩余验收以总表为准。

发布候选8398986494已由独立干净检出完成标准build/upload，镜像helix-beta-20260908-8398986494，Tar SHA256 `94742bcac9029d7232db03928b80e373f018d1c9d3ca25636276e17b7815976c`，NAS上传校验与deploy dry-run通过。Linux Docker使用隔离数据库副本、network none且无媒体挂载完成health/admin/整理/收藏/维护/回收站只读smoke，两轮均200。未apply；生产仍为6e37bf5679。后续代码不自动包含于该候选，最终发布必须重新绑定确切提交。

UAT-217提交9fb736ac1；UAT-218质量保护本地47项定向PASS，仍需真实转码与失败保原片验收。UAT-217最终并行入口测试曾出现一次health timeout，隔离复跑该文件14 PASS/3 SKIP，未隐去失败记录。

UAT-218整合验证：220个architecture fixture文件与Dependency/Semantic/Manifest/Contract全部Gate PASS（.codex/uat218-architecture.json）。其中包含UAT-217最终代码回归。

UAT-251独立UI修正：瑕疵预览失败不再静默隐藏，新增只读重试与旧revision迟到隔离，去除永久不修复承诺。Web56 PASS/build PASS；新终局和修复合同仍未完整实施。16:46只读API刷新：林肯律师92.4%转码，黑寡妇仍等待资源，活着原冻结未改；这不是浏览器验收。

UAT-250：《活着》原Query在一致性副本上只读重放，当前100候选138631字节超过旧65536预算，HTTP/字节/摘要均正确；Search与AcquisitionCandidates同步256 KiB后重放通过。31针对性、220文件架构全门禁通过，另补新预算上限拒绝测试通过。未Reset或重写原冻结Run，未部署此修复。

统一发布准备：a56753f7c6候选完成标准build/upload/SHA校验/dry-run与Linux隔离启动/API smoke；tar SHA256=e13dab8c2ff4fea5a009ab269714dabdb0e688a3d61b845c09ed5ed290a82baa，尚不含随后UAT-250预算修复。17:04一致性备份位于NAS backups/uat-iteration-20260908-a56753f7c6-r2，DB SHA256=e699447a167085170474724f6248b9c9422a5c5bef168dccbb2df9cdb637614f；保留Compose、凭据文件及加密integration envelopes。未执行deploy --apply，生产仍6e37bf5679；17:19黑寡妇转码12.3%，不强制重启。林肯律师离开在办不等于已证明成功，沙丘新冻结须另查原因。

UAT-251终态展示已本地修正：移除默认放弃再采购提示，Provider技术失败不再被旧空候选结果遮盖；36项Formation测试通过。内部Run状态及重新处理合同未改变，仍未关闭。

服务全量首轮520测试：496通过、18跳过、6失败。5项为UAT-212/文案旧断言，另1项为UAT-217正式身份评分重算后同要求不生成Spec Work、Run缺少续跑通知；已修复精确Subject通知，独立真实媒体链路通过，准备全量复验。UAT-214 NFO人物解析19项通过，尚未接入投影/记录更新，不算交付完成。

后续验证：服务串行全量502 PASS/18 SKIP/0 FAIL；并发复验的唯一200ms watchdog失败独立复验通过，未放宽生产超时。UAT-214观察半链221文件架构全门禁通过，确定关系记录提交仍待完成。真实Edge补验林肯律师已上架且健康、沙丘P5响应校验失败，以及本地瑕疵预览503可见并可重试；详见各UAT Evidence。

UAT-214确定性关联及Arca关系记录刷新已本地实现；222文件架构全门禁通过，真实NFO→People→Inventory revision链路通过且零Case/无媒体及Control改动。当前未部署，后台驱动与历史exact origin验收仍待完成。事务仍45项，增加既有记录刷新事务的无Control人物关系变体。架构测试并发限制4，解决反复出现的本机测试进程过量争用，不放宽产品超时。

UAT-219/239核实当前字体栈统一，克制收敛五组中文标签至12px/正常字距；Web56 PASS/build PASS，真实Edge宽屏与390px收藏/维护详情验收通过，临时视口已恢复。待统一发布后复验，未关闭。

- UAT-215已本地建立On-deck Commit同事务收尾责任、按Run有界检查及Settings待办。21定向、Web58/构建、222文件四门禁PASS；真实媒体与完整Service仍在运行，未部署/未关闭。当前合同计数113/99/188/45；旧Entry不回填自动清理责任，UAT-216未执行。详见`implementation/evidence/UAT-215_ONDECK_SOURCE_CLEANUP_20260908.md`。

- UAT-215新增真实隔离媒体链路38.2s PASS，后台正常检查持久责任、公开API可见、重启不重复且零Case。Service串行509 PASS/18 SKIP。旧Aftercare长链路遇到文件名推角色和固定Inventory revision的测试假设，后续按UAT-210/214继续精确验收，不算全链路已通过。

- UAT-214连续性修正106575a06，51关联测试与222文件架构门禁通过。UAT-210精确Artifact角色修复通过真实NFO/海报两次维护；长链Target迁移后Settlement源Handle校验失败，尚未闭合。19:11生产只读仍3活跃展示（1进行/2需处理）、62收藏，无active维护Case；未部署或清理生产。

- UAT-213原Target Binding证据已本地补齐，新增Arca不可变表，当前113/99/189/45，DDL SHA256 42281705d35e3aa6d5103525544ce7d9a199bd2660c93e2faf2729d333475066。33定向与222文件全门禁通过，真实媒体两链101.3s通过；完整Service复验及生产验收继续，未关闭。

- UAT-213本地最终：Service510 PASS/19 SKIP/0 FAIL（529项），隔离媒体长链69.8s PASS、Binding重启不重复；24项Settlement负向复验PASS。未发布，生产在飞保护不变。

- UAT-145已逐项验收关闭：Edge非localhost普通HTTP保存隔离Field、Node同合同摘要一致、无效目录可读拒绝。接手后仅144与145新增验收关闭；其余逐行状态不变。

- UAT-130已独立验收关闭：普通HTTP浏览器Landing修订、Secret字节复用、CAS/重放/重启及重叠拒绝通过。接手后新增验收关闭130/144/145；其余92行待实现或验收、206被取代待核清，保留逐行Oracle。
