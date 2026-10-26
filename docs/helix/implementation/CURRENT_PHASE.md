# 当前 Phase：US Adult、演员库与每周维护窗口

2026-10-27 固定候选资格进行中：af525a728c Windows 独立包 PASS；实际 Linux 镜像通过新 Reset 核心、真实重新观察/新包/FFmpeg/Commit、独立收藏及资料 404 后显式映射旅程。镜像测试首跑混入仓库侧脚本和旧物理删除 CLI 的环境失败，保留原日志，不计为全量 Linux PASS。UI 负责人对 af525 的 pending 焦点问题判 FAIL；c2c07084f 修复后本任务四视口 40 PASS、负责人补充 16 PASS/定向 Web 5 PASS，具体版本 UI 已通过。完整架构门禁仍在固定 af525 独立 checkout 运行，后续仅 UI/镜像构建变化。

NAS 隔离装载 c2 镜像时遇到 `max depth exceeded`：镜像 127 层，本机 containerd 可运行不代表 NAS overlay2 可装载。标准构建改为合并连续 COPY 文件且不跨 RUN/多阶段边界，导出前增加 96 层预算，定向 4 PASS；新镜像资格尚未完成。691 收藏保留库在本机 Docker 因真实挂载身份不同被正确拒绝，不能当作生产启动通过。隔离副本已准备于 /vol2；生产容器未替换、未 Stop/Reset/Resume。

容量：19:28Z /vol1 可用 8,247,119,872 bytes，/vol2 可用 371,751,084,032 bytes；两个重复 DB 候选共 9,229,676,544 bytes，逐字节 SHA 与保留副本相同，尚未获准或执行删除。pre-ba75692d4 恢复基线 201 文件重新 SHA 校验通过；这是旧基线，不替代本轮停机后完整备份。

2026-10-27 冷态首次升级与生产副本检查点（开发中、未发布）：新生产只读快照包含 691 个正式 Commit，SHA256 `1789531be27e6b68079f94cf29ad16893f6c44541af75f5208fd01f7c85ae8bd`，5,126,340,608 bytes。239 表隔离保留库保留 1,332,064 行、移除 1,962,627 行，685 个保留 Subject 结束旧准入；691 个 Commit/Package、十组保护摘要、两组共享剧资料及两个精确资料依赖通过 Owner Reader、完整 FK/integrity 核验（约 1,055 秒）。这是隔离副本，不是生产 Reset，也不是完整恢复备份。

真实混合 Series 旅程证明一季 Commit/另一季 Accepted 未 Commit 时，保留前者及共享资料、清除后者责任，10 个来源/正式/共享文件字节保持。真实资料失败后 frozen Run 的显式跨 Provider Season 0/2 映射、重新执行与正式 Commit 旅程通过；本地 S01E01/E02 编号保持。四视口 Reset/映射浏览器最新 32 PASS；早期窄屏横向溢出 FAIL、修正及截图均保留，尚非固定版本 UI 负责人验收。

首次 schema 升级不能先启动新业务 Host 再 Reset，已新增显式部署关闭证明与冷态管理入口：旧 235 表仅开放原 Runtime 预检/确认，独立切换 239 表后重开 stopped；真实 SQLite 入口及源变化拒绝 2 PASS，组合 14 项首跑 13 PASS/1 FAIL（父根挂载重叠遗漏），修正后部署约束 4 PASS。标准 deploy 新模式和 Windows/Docker 打包接线仍须完整资格，生产未执行。当前完整 Architecture 长跑基于变化中的开发树，只作为开发诊断；最终长门禁必须固定 commit/独立 checkout，不能挪用。

进击的巨人三次原始 MoviePilot 日志均对应首标题“未搜索到资源”，支持零候选被误报为技术失败的独立原因；没有完整 HTTP 响应，不能声称其他别名必有候选。风骚律师旧海报失败的底层 HTTP 状态仍不可恢复；已补 TMDB image HTTP stage/status 诊断贯穿真实 Host/Handle/Secret 的 503 红绿例，不回填历史或宣称其具体网络根因已证实。生产未部署、Reset、删除备份或修改媒体，自动观察保持取消。

2026-10-27 季集映射与冷态 Reset 增量（开发中，未发布）：已新增 Libra 持久 Review / Mapping Intent / head，以及新 Run 冻结 mapping ref；当前目标 239 表、168 路由。真实 Host 隔离旅程完成显式跨 Provider Season 0/2 选择 → 新 Run → 真实媒体处理 → 一次正式 On-deck Commit，本地 S01E01/E02 与 NFO 编号保持，完整 FK/integrity 通过。首跑路由计数不同步失败、第二/三跑因新身份证据改变完整摘要而失效，均保留；已分离原确认 identityDigest 和精确身份范围 identityScopeDigest，未修改旧身份事实。映射模型/原生 SQLite/执行适用性 16 PASS，Web 交互 5 PASS，Run Admission 既有回归 16 PASS；真实 Handle/Secret/TMDB 候选查询定向已通过，最新增量仍须全量复验。UI 初版尚未完成固定候选浏览器及 UI 负责人验收。唐顿特别篇与暗算 34 集的生产逐项资料核实、两项独立失败诊断、生产新副本/共享剧混合 Reset 验证、最终镜像/完整架构门禁仍开放。

Reset 持久 pending intent 与 workflow 已改为同一次原子写入，完成 Receipt 先于清除 pending；新 Reset 不会误认前一代 complete fence。Windows 中断与管理入口定向 11 PASS；Linux 第二轮 13 PASS / 1 FAIL（容器加载了 startup 修正前源码），修正后原失败定向 1 PASS / 5 filtered skip；这是本地源码覆盖旧依赖镜像，不能替代最终镜像资格。完整旧版本 Series Routing/metadata 批次 60 PASS（约 15 分钟）发生在最新映射接入之前，不能当作最终候选全量验收。生产本轮未部署、未 Reset、未删除备份；观察保持已取消，最终生产动作仍须具体方案授权。

2026-10-27 当前实施：RESET-FRESH-GENERATION 已接正式 server Supervisor，裸 Host 禁止旧 Reset 回落；管理鉴权与原请求继续不重开业务库，原生生命周期租约与持久写入退出证明共同处理关闭阶段中断。Owner 配置保护边界已派生；真实冷态 HTTP、重采及 FFmpeg 正式 Commit 隔离旅程通过。Service 第八轮 837/808 PASS/29 skip，Web 第三轮 266 PASS，浏览器第二轮四视口 16 PASS，首跑保留。继续实现季集映射持久确认及精确生产容量清单，补混合收藏副本、最终平台/完整架构/版本 UI 验收；本轮仍未形成发布候选，未执行生产处置。下方早期默认旧 Worker/未接入口记录保留为历史。

2026-10-26 当前实现检查点：独立 Operator 全链路已含完整备份、切换、清理、回执和中断重试；冷恢复组合 27 PASS，Linux 源码隔离 29 PASS，真正鉴权 HTTP 经注入新 adapter 完成冷切换和新 Host stopped 重开 1 PASS。新 Host Workspace 初始根改由已有 Platform 登记真实挂载，旧配置不修写。默认 Reset 仍走旧 Worker；默认 Supervisor/管理界面、配置保护边界派生、季集映射持久确认和最终跨平台/媒体/UI验收未完成。Service 第七轮 826/797 PASS/29 skip；Architecture 首跑 3389/3344 PASS/19 FAIL/26 skip，受影响修复复验见 CURRENT_STATUS/Evidence，不将定向通过写成最终完整 Gate PASS。生产精确容量清理清单继续核证，尚未执行任何生产处置。

2026-10-26 用户确认并要求实施“彻底Reset+本轮故障修复”：替换旧工作台退役为安全停机下的新数据库代际，在线仅保留正式收藏及Owner定义的必要依赖、配置；无关任务历史仅留经校验离线备份。清空未入藏Procurement队列至Arca未提交责任及专用临时空间，按当前来源文件重新观察，不回滚正式文件。季集差异本轮处理，保留本地编目，新增Libra持有的显式Provider资料映射。容量清理先列精确清单，生产删除/部署/Reset待具体材料确认；完成后保持停止，启动风暴独立讨论，自动观察已终止。

当前活动工作项：RESET-FRESH-GENERATION（Implement）、RESET-STORAGE-BUDGET（Implement）、SERIES-EPISODE-METADATA-MAPPING（Implement）、PROVIDER-FAILURE-ROOT-CAUSE（Diagnose）、RELEASE-QUALIFICATION（Pending）。验收必须包含收藏依赖闭包、新包真实入藏、旧队列/回执隔离、路径与容量负例、切换中断恢复、Windows/Linux和具体版本UI；已同意的历史清空取代下方旧历史保护范围，旧记录仅为时点Evidence。

实施检查点：Operator 原生子进程/独立 SQLite 临时卷、冷关闭与持久代际屏障、Arca 共享剧资料维护依赖分类、Procurement 观察代际屏障已落地并隔离验证；旧冷备第 07 轮完整依赖核验通过。尚未接通新 Runtime 主入口与冷启动恢复，不能部署或生产 Reset。资料映射模型及 Adapter→Libra 编号投影已落地，Store/API/确认 UI 与最终完整资格仍待；历史测试失败和冷备局限详见 Evidence 当前节。


2026-10-26 恢复后13条attention修复工作项（20:38Z已为14条，多出一条演员人工确认；用户已授权诊断与实施，未新增UAT编号）：

- `SERIES-PRESENTATION-PORT-WIRING`：真实Host composition按operation分派Source到Observation、Assets到Artifact；真实Handle/Secret/adapter仅隔离HTTP传输的poster/fanart回归先红后绿，保留反向端口拒绝。前次ee0c仅覆盖Handle发放，不能作为生产接线正确的证据。候选b2dac98fc实际镜像回归通过，五条线上验收仍待部署。
- `PROVIDER-EMPTY-SEARCH`：MoviePilot明确“未搜索到任何资源”且空data为该关键词零候选，保留其他关键词候选及去重；未知失败/非空矛盾响应/HTTP失败仍拒绝。真实Platform端口回归先红后绿；不改变唯一候选获取或身份/质量筛选。
- `PROVIDER-FAILURE-EVIDENCE`：TMDB JSON HTTP stage/status经Secret broker安全白名单及Metadata failed Outcome持久保留；不回填缺失历史证据，不新增UI文案或业务权限。
- `SERIES-EPISODE-NUMBERING`：唐顿S02E09/S06E09、暗算S01E11精确接口404已现场复现，本地NFO缺所需剧情；当前合同禁止拿别季/别集或整剧剧情替代。用户对保留本地编号/采用TMDB编目的方向待答复，未实现映射、放宽Spec或改媒体。
- `FROZEN-PACKAGE-DISPOSITION`：琅琊榜旧包15:49Z冻结错误相对根；庆余年旧包10月12日缺season poster Reference，Arca无覆盖资格。普通重试不重建冻结输入；分别按未Accepted/已Accepted责任边界提出有界线上方案，不以新兼容逻辑改旧包、不再次全量Reset。
- `PROCUREMENT-QUEUED-OFFER-RETIREMENT`（Design，未授权合同扩展）：庆余年10月12日发布的同一Offer在10月25日15:55Z才首次Accepted，说明工作台Reset后新Subject仍可来自旧采购队列。20:54Z共有129个open Series Offer，其中114个包无seriesSourceRefs；不能把它们全计为失败，但不能承诺Reset等于重新采集全部包。现有Reset从Subject/token/open Intake Work发现范围，不覆盖尚无Libra责任的待接纳Offer。拟定停止态、精确旧Offer范围、跨Owner分别留退役Receipt、仅释放该Selection及自然重新观察的保留历史方案；需确认合同后才实施，不增加版本兼容或直接改库。
- `PROCUREMENT-TERMINAL-FAILURE-QUERY`：已sealed且Candidate全部成功的旧采购，不应为判定技术失败重建其旧Structure。先读取精确Owner/Process的Work终态，确有Candidate失败才重建归属证据；保留真正失败的证据拒绝。真实SQLite红例2 FAIL→相关15 PASS，生产只读三组旧事实红绿验证通过；未写生产、未引入旧规则解释器。
- `MEDIA-PROBE-TS-CRASH`：固定Linux FFprobe对现场TS及全新生成TS均SIGSEGV。John Van Sickle 7.0.2同样失败，BtbN8.1.3虽读TS但丢HEVC色彩、原三条真实验收失败，均不采用。Ubuntu24.04的7:6.1.1-3ubuntu5对现场8MiB只读样本及29项媒体验收通过；Docker固定该Probe并保留原FFmpeg，Compute自测同步尊重FFPROBE_PATH。Windows32 PASS/2既有平台或外部fixture skip；最终镜像ISO/TS/色彩及配置/自测已纳入102 PASS/1外部fixture skip的资格，不降低探测预算或验收标准，完整影片生产验收仍开放。

最终实现候选b2dac98fc的实际Linux镜像102 PASS/1外部fixture skip，Service684 PASS/29 skip、四项静态及Windows/Linux独立启动通过；0438334a4完整Architecture首跑3338 PASS/3 FAIL/26 skip，三项同步断言/隔离环境复验通过，采购首跑一次失败原因未保留明细，补明细后原严格门槛再验通过。采购/Probe增量分开记录，不能宣称b2全量一次通过。生产未部署，五条线上验收未完成。现场证据、测试覆盖与限制见[本轮Evidence最新节](evidence/FORMATION_TERMINAL_CLOSURE_DIAGNOSIS_20261023.md)。当前三条演员确认保持用户选择，不自动代选。

2026-10-26 02:47（Asia/Shanghai）按用户明确授权，仅通过线上discard取消《走向共和》旧Run e2e307359a9883a1f335b32fee058bf23be68836de9b7676664b3aae315bae93，18:46:48.665Z完成：Run discarded、Subject abandoned、59个Control released、token释放、取消Receipt完成。182个来源文件stat清单及旧Candidate全文摘要前后相同；22组既有历史原行无缺失/改写、682收藏不变。未Reset或强制重新采购；等待正常采购新包，单条取消不再待确认。

2026-10-26 02:33（Asia/Shanghai）修复镜像e78dbd82f已标准部署，18:26:15.819Z正式Resume完成：running/normalSupplyAllowed=true/error=null。旧取消Work的媒体Circuit资格已由Foundation正常释放，随后真实成功执行使Circuit closed/INVARIANT_RESTORED；18:32Z媒体生产Event成功288次，来源观察成功3次，无active且无Run/token异常。部署前后及恢复后22组原记录无丢失/改写，682收藏/941 ended Run保留，未再次Reset。UI当前13进行中/1 attention：新增《地狱尖兵》外部素材检索P5_PROVIDER_TRANSPORT_FAILED三次重试耗尽；《走向共和》旧冻结包取消/重采等待明确确认，唐顿庄园/暗算既有资料请求阻塞仍开放。不可称全部媒体验收通过。详见本轮Evidence末节。

2026-10-26 02:07（Asia/Shanghai）修复发布资格：最终运行代码e2cc23c81，待部署镜像e78dbd82f仅追加SSOT来源摘要及node:path依赖声明，运行JS/Schema/测试字节相同。真实NAS副本235表验证通过：仅Circuit/Incident两表预期变化，233表完全一致，682收藏/941 ended Run及22组保护基线保存；Windows独立包、Linux候选56项、四项静态及合同派生复验通过。完整分片Architecture长旅程继续；生产仍c91fbed63停机，未部署、未再次Reset。

2026-10-26 EXECUTION-RECOVERY-RESERVATION-CLOSURE / SERIES-SOURCE-ABSOLUTE-ROOT 修复资格进行中：在线取消及独立Reset Operator在提交后交由Foundation核对恢复占用；普通启动/Resume补查当前recovering责任，只对精确匹配、Work/Attempt/Event均终态且无未决Effect/等待者的占用重新开放Circuit，保留Incident及发生次数，不伪造成功。采购构建Series sourceRoot改用物理路径join，保留读取端绝对路径/containment校验。真实Host已通过“阻塞媒体→正式Reset→仍停止→模拟通知丢失→重启→Resume→正常重采→真实FFmpeg探测和入藏→Circuit关闭”；首轮暴露独立Operator漏接，修正后通过。生产仍c91fbed63，未部署或再次Reset；完整门禁和镜像资格待完成。

2026-10-26 00:53（Asia/Shanghai）只读诊断确认恢复后媒体探测阻塞根因：已被Reset取消的旧Work仍独占Foundation Circuit recovering资格，14个新Work/194个ready Event被挡；实际取消入口与终态扫描存在收尾缺口，临时SQLite复现。另《走向共和》新包sourceRoot丢失Linux绝对路径首斜杠，触发正确的范围校验。两项未修，未改生产；7个Arca维护事件等待合法，调度器并非整体死亡。HTTP失败/P7记录漂移另行承接，见Evidence最新节。

2026-10-25 23:46（Asia/Shanghai）恢复观察：7轮/42次API请求全部成功、running且无Runtime错误；五来源可读，国产剧21页及JAV1页新扫描完成，其余扫描进行中。工作台12进行中/0 attention，已核对无active且无Run/token异常。恢复后22组原记录仍missing=[]/changes=[]，新增Handoff/Decision正常保留；RestartCount0/OOM=false，其他15容器与fnOS正常。一次continuity basis过期已由Owner重规划成功。AbortSignal监听器数量警告保留观察，尚未证实泄漏；不得据短采样宣称吞吐、全部媒体验收或所有历史证据通过。既有24小时只读监控继续。

2026-10-25 23:41（Asia/Shanghai）历史机制候选 `c91fbed63` 已标准部署，15:41:29.688Z Resume完成，running / normalSupplyAllowed=true / error=null。232→235原子切换及231原表保护通过；恢复前22组逐行历史完全相等，682收藏/941 ended Run不变。51,246 Plan证据迁入、27项保留明确失败审计，未重复Reset。五来源现场可读，新的常规观察及业务推进正在监控；真实自然重采验收和4K忙载吞吐仍开放。完整发布身份、门禁与残余见本轮Evidence。

2026-10-25 23:11（Asia/Shanghai）历史机制候选 `c91fbed63` 已取得最终镜像副本资格：51246 Plan证据导入/27项保留失败审计、231原表保护，Resume→Stop→重开均通过，682收藏/941 ended Run及22组记录不变。Architecture首跑3351项含3失败，原断言同候选复验3项通过，组合3325 PASS/26 skip，四项静态PASS；Service681 PASS/29 skip、Windows包、实际镜像100项合同及8项恢复旅程通过。原首跑失败与既有ISO FFprobe故障保留记录。生产仍f280已退出，198文件冷备完成，来自新冷备的准备副本已导入51246/27并进行最终原表复查；尚未切库/部署/Resume，不重复Reset。

2026-10-25 EXECUTION-CONTRACT-EVIDENCE / STARTUP-RESPONSIBILITY-RECOVERY / HISTORICAL-AUDIT-CUTOVER开发检查点：原子合同与责任快照、独立历史审计及一次性证据导入已实现；旧日期档案移至离线工具。复制/导入严格保护原表，未知来源明确记unverified，不以终态白名单补造证明。已追加当前Owner未决Effect证明、持久导入失败审计、三个有合同索引及原子切换工具；定向40 PASS/1历史快照skip、Windows独立包与JAV基础新任务旅程通过。继续固定候选完整门禁和实际镜像生产副本资格；未部署/未Resume，不重复Reset。

2026-10-25 用户确认实施 EXECUTION-CONTRACT-EVIDENCE / STARTUP-RESPONSIBILITY-RECOVERY / HISTORICAL-AUDIT-CUTOVER：清理按版本累积的运行兼容分支，合同证据随数据保存，启动按当前责任闭包验证，独立历史审计；保留收藏/历史且不重复Reset。按合同→原子保存→当前恢复/历史审计→一次性迁入→副本及发布资格顺序实施。补档案候选不单独部署。

2026-10-25 用户要求审视逐次升级累积历史兼容的机制。678687b8e补档案候选暂停发布；已确认全局Catalog绑定、全历史启动验真与全局阻断的耦合。下一步先确认持久合同证据、当前责任恢复与独立历史审计的边界，再实施机制修订；不擅自跳过验真或扩充兼容白名单。生产仍未恢复供给，既有Reset不重复。详见本轮Evidence最新节。

2026-10-25 恢复运行诊断：用户已授权 Resume 与运行监控。正式 Resume 于 10:21:42Z 受理、10:23:46Z 因 `P4_EXECUTION_HOST_RECOVERY_BLOCKED` 失败，Runtime error / desired stopped / normalSupplyAllowed=false，未恢复供给。五个来源目录现场 stat/opendir 均成功；界面不可用来自 10-22 的失败 Observation，不是当前挂载失效。完整生产副本复现恰好 1707 个 PLAN_CATALOG_DRIFT：hostfix4 的终态 Catalog 8f5dded2 缺少 frozen archive。已从 b70a9f6f6 原镜像提取精确合同并接入只读历史验真，定向118/118通过；修复副本正常 Resume 资格进行中，尚未部署。此前 stopped Host 资格不等同正常恢复资格；不重做 Reset，不改历史记录、不放行旧执行器。

2026-10-25 18:18（Asia/Shanghai）生产发布及新版整工作台Reset完成：镜像 `markmahoro/shelfdeck:f280e6bd4`，source `f280e6bd495e8bb75f4185d532adc18e0f1b0071`，NAS image ID `sha256:6f57fec925c007f810ab23af323a75f3dd3499259e6f18b8acbb56186a78e723`，tar SHA256 `192445c85c44a26f38cb1490a30f5b7b29a8ab48b8e24732861a017a545c107c`。正式Runtime Reset于10:13:54.769Z完成，275步退役225Subject/14Run，14Workspace保留；工作台范围归零。22组收藏/历史逐行摘要完全一致：682 Entry、927既有ended Run及修订、既有Decision/Receipt/Outcome保持，Attempt仍158424；1个停止态执行以正式Receipt终止，executing归零。结束Run总数941含新增14个行政退役，不能误算成历史改变。FK/integrity、health/Formation/collection、fnOS与15个无关容器通过。Runtime `stopped`、desired `stopped`、normalSupplyAllowed=false、error=null，容器restartCount0；未Resume。完整Architecture Gate414文件/四项静态、Service667PASS/29skip、实际镜像98项、具体版本UI和NAS副本资格通过；真实自然重采媒体验收未完成，4K忙载吞吐按用户要求延后。正式Reset及备份ID、证据和回退边界见FORMATION_TERMINAL_CLOSURE_DIAGNOSIS_20261023 Evidence。


2026-10-23 14:28 固定候选f280e6bd4完整Architecture Gate通过：414测试文件退出0，四项静态检查均PASS；成功报告未保留逐项计数，不推算总测试数。Service667PASS/29skip，实际镜像98PASS及真实入藏历史正反例1PASS；具体版本UI按171源码/9资源同指纹继承PASS。NAS225Subject/14Run隔离Reset最终通过，10组收藏事实及158424个Attempt保持，14Workspace字节保留、1条停止态终止Receipt；实际镜像Worker回执重放通过，停止态/资源上限等最后核验继续。用户已明确授权生产部署后执行新版整体Reset，已完成196文件新冷备及标准deploy dry-run，原生产仍停止且尚未切库/部署/Reset。4K忙载吞吐按用户新决定延后，不再作为本轮发布阻塞。

2026-10-23 13:25 Reset副本性能修正（未部署）：013aec7ce实际镜像定向97/97和真实入藏证明1PASS通过，Service667PASS/29skip，具体版本UI依据171源码/9资源同指纹继承PASS。生产规模journal发现992步中741个execution取消只有14个范围含open Work，约30MB清单空步骤重复序列化造成明显延迟。现仅冻结含open Work的取消步骤，全部Owner/最终scope核验保留；新增遗漏scope中新Work必须阻断负例，组合66/66通过。旧副本已停止并完整保留其冻结journal/部分退役证据，另从原始232库新建副本重演，不改写已有journal。013完整Gate因候选替换记STOPPED；最终候选仍待完整资格。原生产保持停机，无业务变更。

2026-10-23 13:09 副本Reset资格缺陷修正（未部署）：26ce2a6b8具体版本UI负责人PASS（浏览器14/Web264/真实Host1），实际镜像Series/停止态32项及新版Reset22项通过；另25个旧Reset测试首轮缺隔离mount开关失败，按既有fixture配置复验47/47通过。NAS完整备份成功后，Operator准备被6个已Commit历史包的Custody状态假设拦住，退役尚未提交。已改由Arca既有readCommittedByPackage核验正式Inventory历史，6包副本证明通过、真实Host正反例及定向65项通过；范围仍225Subject/14Run，不扩大到6个历史包。复用同一冻结预览的完整备份演练真实journal收尾中，所有备份SHA仍重验。26ce完整Gate因候选淘汰停止，未记PASS；将固定新候选重跑。生产保持停机，无Reset/部署。

2026-10-23 12:47 资格修正检查点（未部署）：固定2c5204186完整Architecture为3321 total/3290 PASS/5 FAIL/26 skip，四项静态检查通过；原报告保留。已修复整剧目标预检误触发完整文件验证、阻断普通NFO修复的回归，两个真实Host修复场景及两季冲突重试通过；三项静态断言同步。补齐停止态脚本的Docker/Windows打包，Windows独立包含Reset预检通过；Web264、Service667PASS/29skip、定向75PASS/2skip及四项静态通过。真实副本备份需求约93.3GB，原数据卷容量不足已正确拒绝；新增独立备份卷部署配置与不读取媒体的容量预检，NAS隔离副本正在完整备份/Reset。新固定全量Gate、镜像、最终UI及副本收口仍待；生产保持停止，未Reset/迁移/部署。

2026-10-23 整剧迁移交互沿用收藏详情的“立即检查健康”：显示真实涉及季数、移动中状态及具体冲突原因；移动期间防止重复检查与退出，冲突解决后同入口显式重试冻结计划，完成后回到健康检查结果。后端当前状态、批量收藏Projection及前端同源；具体新版本仍需UI负责人验收。

2026-10-23 用户确认新增两项纳入本轮：`SERIES-ROOT-PLACEMENT`（整剧所有季与共享文件统一迁移，修复旧绑定遮蔽新规则的假healthy）；`STOPPED-EXECUTION-CLOSURE`（停止态仅收尾冻结的原执行，供给始终关闭）。第二项结合用户转码澄清：Reset无需等待或重跑转码，走实际终止及文件现实核验，随后行政退役。SSOT已补合同；实现及隔离回归进行中，生产保持停机，未授权/执行生产Reset、迁移或部署。

2026-10-23 09:11 候选d4b5c00b8标准镜像构建/导出/独立SHA256复核及具体版本UI负责人验收通过（0开放UI问题）。镜像内Reset/取消/重采53PASS、两片新包2PASS、转码停机重启一次Commit1PASS；测试空间/PIDs不足的首轮失败保留，调整隔离资源后通过，未改产品规则。候选仅就UI文案增加b9/d4，证据按精确diff继承。生产仍原版本停止，无上传/部署/Reset。已有Series根迁移FAIL及生产中断转码Effect恢复仍开放，整体发布资格未通过；详见接手Evidence末节。

2026-10-23 06:11 固定候选 `44b725e6a` 已提交，未发布。标准Docker构建因本机Docker Desktop启动崩溃而阻塞，未产生镜像/tar；已通过的Windows包和Linux源码覆盖不能替代镜像资格。完整架构Gate的既有Series根迁移FAIL、精确版本UI负责人验收、生产中断转码Effect恢复仍开放。生产保持停止，无Reset/部署。详见接手Evidence末节。

2026-10-23 06:08 候选收口（未部署、生产保持停止）：新版历史保留 Reset 已完成 Owner 管理退役、精确 Control 释放、原 Handoff A 接纳回执收尾与独立完成核验；真实浏览器验证停机→确认→完成→重启仍停机→普通观察创建新 Subject，原历史及源文件保持。最新 Service695项/666PASS/29skip、Web262PASS、Linux53PASS、Windows独立包Host及空预检PASS；NAS最终结构副本230表摘要/FK/完整性与stopped Host通过。完整架构首跑3278项/3224PASS/28FAIL/26skip，20项失败在接手基线复现；已修正其中19项旧fixture/合同清单及本轮预期，17文件重跑129PASS，另有定向PASS，不能记完整Gate全绿。已有Series根目录迁移失败在原基线与当前均存在，未放宽断言或擅改共享根合同。两片对应新包旅程PASS，真实生产自然重采仍开放。性能已取得Formation/收藏查询局部改善及海报缓存回归，未解决4K忙载吞吐。只读生产Reset范围225 Subject/14 Run/11共享scope，20条历史Effect已证明后继履行，仅中断转码的1 Effect/1executing Event继续阻挡。06:07复核生产exited/RestartCount0、其他15容器运行、无诊断容器残留。Docker候选、精确版本UI review及生产处置尚未完成；无生产Reset/部署授权。

2026-10-23 05:35 开发检查点（未部署、生产保持停机）：新版 Reset 保留历史、追加各 Owner 管理退役，完成核验直接反查冻结 Scope、Control release revision、保护历史及本次备份/清单对应 Receipt；正式 Host API 的停机→Reset→重启保持停机→普通观察新 Subject 旅程通过。只读生产范围225 Subject/14 Run/11共享scope；20条旧 Arca Effect已获正式Owner后继履行证明，保留原历史，仅1条中断转码Effect及其executing Event继续阻挡Reset。最终12处CHECK结构副本已通过230表逐行摘要/FK/完整性（18.8分钟），候选NAS Host验证进行中。Service694项/665 PASS/29skip/0fail；Windows独立分发Host及空Reset预检通过，首轮发现并补齐打包文件遗漏；Linux最终定向和完整架构测试继续，后者三项旧fixture/旧终局预期已定向修正，不能记完整PASS。真实转码停机及重启一次Commit通过。NAS收藏标题页中位451→213ms；海报增加有界字节派生缓存，保留每次Owner/文件校验。4K处理路径已确认但没有并发性能修复结论。高达/凡人歌生产自然重采、完整新包、最终同版UI及发布资格仍开放；无生产Reset或发布授权。

2026-10-23 04:29 开发检查点：新版历史保留 Reset 已接入用户入口与 worker；pending intake 分别经 Libra/Procurement Owner 命令终结，不伪造 Handoff；持久日志支持 commit 后中断重放，恢复保持停止。退役 intake 的低层席位准入也有同事务门禁。未被 Arca 观察的已发布 Offer 已接入真实 ProductDeliveryReader 验证，保留旧 Package。Reset/Runtime/intake 70项、真实 Promotion/退役29项、Web262项和Web build通过；完整Service首跑689项中657通过/29skip/3失败，发现并修复终态短路跳过拒绝席位释放，另一失败为旧隐藏规则断言；三个失败文件重跑6项通过，完整Service尚待重跑，不能记全绿。新增精确231→231结构副本仅扩展11处状态CHECK，230个事实/执行表逐行保留，副本/回退保护2项通过，尚未做生产副本Host资格。共享builder和Workspace物理回收仍未完成；当前回执明确保留Workspace字节。04:29只读复核生产仍为hostfix4 exited、RestartCount0，无Reset/部署。性能后续诊断、两片新包旅程、完整Gate和同版UI资格仍开放。

2026-10-23 02:38 实施开始：用户确认本轮七项工作并授权先安全停机。Runtime stop已持久desiredMode=stopped/revision23；唯一生产容器于02:38:23退出，其他15容器保持运行。因恢复中FFmpeg未在60秒内排空，日志为P4_SHUTDOWN_CHECKPOINT_TIMEOUT/exit1，未记优雅排空PASS；无Reset、部署或源文件改动。data冷备196文件逐文件SHA256一致；完整Host隔离副本随后通过外键/完整性检查并以stopped启动，未恢复供给。停机前单次CPU357.95%、内存2.088GiB，Node/FFmpeg均有消耗；这只是采样，不构成性能根因结论。

当前实施顺序取代下面“建议”中的两项scoped Reset及性能排除：

03:06检查点：Reset先补实际删除闭包的ended历史阻挡，41项通过。用户随后确认采用“保留历史记录、追加管理性退役、旧 Subject 不再调度”，现进入重做实现；该确认不等于本次生产 Reset 授权。overview同次读取复用及progress线性关联已修，三文件145项回归通过；隔离Host对照Formation中位1063.9→830.7ms，完整性能/发布资格未完成。Season poster真实port中断→重试→替换→settle用例通过，不替代两片完整新包或生产验收。详见接手Evidence最新节。

1. SERIES-PRESENTATION-HANDLE：真实Handle/NFO和实际文件边界；当前11剧根/12条记录，生产运行时复验。
2. RETRY-ACTION-MAPPING：三段动作、状态/命令/结果一致性，删除冲突入口。
3. FORMATION-RESET-WORKBENCH：重新设计整体工作台兜底；不新增单片UI，不能用运维scope代替用户入口；明确历史、共享引用、其他新Owner、源文件、未知Effect保护；完整备份和中断恢复须实际验收。
4. FORMATION-TERMINAL-CLOSURE：明确自动终局资格，按single/Series闭合Subject/Run/Control/token及正式审计，修Projection误分类；6条历史审计缺口单独取证。
5. TARGET-CONFLICT-REENTRY：高达双独立收藏、凡人歌单Season及poster替换的隔离新包旅程；生产自然重采时间不可保证，现场问题保持开放，不为验收改变采购顺序。
6. PERFORMANCE-DIAGNOSIS-ITERATION：独立从请求/SQL/事件循环/资源/文件IO建立基线，诊断4K及overview/Formation/收藏/海报；按证据确定修复和同条件对照，不继承旧agent优先级或结论。
7. RELEASE-QUALIFICATION：固定候选受影响测试/完整Host与具体版本UI、平台/副本验证，然后按生产边界完成发布；Reset具体执行需独立范围授权。统一离线补剧根文件、Subject-scoped Control改造仍不纳入。

2026-10-23 接手诊断已补生产只读核账（02:18–02:25，基线ee0c4786b未上线），不改产品或生产。原问题已扩至14条attention：11个剧根共享资料失败影响12条记录，加高达/凡人歌2条target occupied。原198快照现为197个active残留Subject；其937个去重Primary/结构材料的Control分别为Procurement380/released435/其他Libra Subject41/Arca On-deck81，无Control仍属对应旧Subject。不能按旧绑定释放新流程责任，也不能以旧Subject数推断材料全停摆。隔离复现的系统Subject终局缺口、UI按文案隐藏及Reset误删protected ended历史仍成立；6个discarded Run缺Decision/Receipt/Outcome仍待追根。详见[诊断与验收条件](evidence/FORMATION_TERMINAL_CLOSURE_DIAGNOSIS_20261023.md)。

接手早期建议（已由上方七项执行范围取代，不作为当前生产 Reset 授权）：

1. `SERIES-PRESENTATION-HANDLE` / `RETRY-ACTION-MAPPING`：保留ee0c中的真实Handle/NFO修复与三段动作；将生产验收范围更新为当前12条共享资料attention。固定候选的真实Handle/真实文件、受影响Service/Web/Host旅程及同版UI检查通过后，按发布授权进入标准部署，随后走原条目“重试上架”验收正式三项共享资料、Season Commit及无重复收藏。不可将共享Work故障误归为Libra无Run异常。
2. `FORMATION-RESET-WORKBENCH`：在同一候选发布前解决删除闭包与ended历史保护矛盾，增加含终态历史/跨Subject同材料/共享资料引用的副本保护测试。现场仅先为高达、凡人歌两个未Commit Subject准备精确scope、备份/receipt及保护集合；不Reset其他12条共享资料失败、14个active Run或197个历史残留。取得具体生产执行授权后以新镜像停机scoped Reset并启动，经普通新Observation/新Candidate/新Package验收高达两条独立收藏与凡人歌一条Season及poster替换。源文件不手改、无反向Handoff。
3. `FORMATION-TERMINAL-CLOSURE`：单独修正系统自动终局资格、single/Series责任收敛及Projection事实分类，保持现行Owner模型；temporary failure与真正终局的typed分类需明确定义。新任务验证系统/用户终局、其他Run/Episode保留、token及Control精确revision保护、崩溃重放；不能以Reset掩盖新增缺陷。追查6条缺审计链及未见后续Selection材料，不先假定缺TTL或5项release漏提交。
4. 原14条现场收口与生命周期新任务验收分别记证据。197项旧数据的选择/保留/清理另按精确闭包决定，不延用198/225数字执行，也不新增兼容层修补旧在途。该早期性能排除建议已被用户后续追加的性能诊断及迭代取代；统一离线补剧根文件仍排除。

2026-10-23本轮修复与兜底Reset检查点：用户确认本轮修5个剧集呈现缺陷、重试UI映射和Formation Reset范围扩展，性能留待后续。已实现：剧集`source.observe`/`assets.prepare`的合法Integration Handle artifact操作、`tvshow.nfo` `-1`占位不误判（20项定向PASS）；媒体整理行改为“重试接收/重试整理/重试上架”，移除“处理冲突”（49项Web定向PASS）；Reset按当前工作台`in_progress|attention_required`+pending intake选择，覆盖Accepted未Commit，保留收藏/历史/Aftercare/源文件，增加全量备份与durable receipt，概览按钮改为“重置工作台”并只要求一次确认词（Reset 40项PASS、Runtime UI 6项PASS）。尚未执行生产Reset、未部署；完整服务/Web Gate与副本演练待跑。

2026-10-22最终历史验真收口：回收原子提交后退出的输入漂移已修，4类真实重启、Service648/29 skip、Linux18、Windows独立Host均通过。生产副本定位6c当前Catalog未入终态档案：沿用Frozen Catalog History精确归档120执行合同/1324 Schema，仅验真终态，不允许旧在途继续；历史证明与Owner/active/篡改负例71 PASS。16个未Commit Subject的限定Reset只在独立副本预览ready，生产未执行；原样全副本启动FAIL保留。最终固定Gate及平台/UI资格继续，三UAT尚未关闭或发布。详见UAT-328 Evidence §23。

2026-10-22最终资格追加：328真实上架、补图重试、缺项维护、跨季复用与共享退出均已接通；5eaf具体版本UI负责人38/38、Web258、Linux17、Windows包及真实浏览器通过。新增回收原子提交后进程退出复现输入漂移，正在以原登记修订稳定投影修复并重新冻结最终Gate。完整旧生产副本Host启动未通过，结构前向/反向复制及224业务表保护通过；不将隔离legacy-shape维护测试冒充完整生产副本资格。三项UAT开放，未部署/未Reset/未补写生产。详见UAT-328设计Evidence §22。

2026-10-22恢复与退出收口：326跨TTL真实进程恢复、327真实1081媒体/65包/2Run继续有效；328完整上架/原任务补图重试/当前收藏缺项维护、部分Assets来源失效复用及旧Workspace回收、命令受理后admission前进程退出、最后季维护失败退出及批量全季退出均有实际Host证据。Web256 PASS，核心12 PASS；ab5f UI审查CHANGES_REQUIRED已修，等待新候选复验。精确225→231逐表保护/有损回退拒绝工具已补。当前136/115/231/61、149 inputs；最终固定Gate/平台/UI继续，未关闭UAT或发布。生产只读新预览为659历史Entry/13 active Season，三根三项全缺、另三根缺fanart；未补写生产，旧ABF-153仍executing。详见既有UAT-328 Evidence §20。

2026-10-21追加运行链检查点：原任务重试/双图上传/真实视频上架、当前收藏缺图重试/单图上传/健康的完整浏览器旅程通过；两类写文件后人工重试、旧已Commit Season隔离软件修复、合格原来源只读复制与别剧资料拒用均有定向证据。新增共享健康head失效与空Workspace来源重评继续验证，当前136/115/231/61。沿用三项工作项；未关闭UAT、未发布、未改生产历史文件，最终资格与Source物化后的失败恢复收口仍继续。详见既有UAT-328设计Evidence §18。

2026-10-21继续实施（尚未完成最终资格）：UAT-326新增真实进程退出后跨60秒Handle TTL恢复同一Identity Event、一次上架及再次重启不重复Commit演练通过；UAT-327真实Host对4star分类目录1081媒体形成65个完整季包和2个Run，文件/成员不重不漏。UAT-328已接通共享Supporting Work/Provider资格/字节配方/正式Control与Ready原子提交、Accepted预留与On-deck版本引用、原任务重试及上传、健康缺项修复/维护补图和Workspace回收；初始S03、跨季复用、同季加集、Workspace/正式文件真实进程退出、来源无图人工补图及真实N:M最后一季退出均取得定向证据。最后引用退出纳入原确认范围的三项共享文件，以持久retirement围栏阻止竞争准入；其他引用/Accepted预留保护共享文件。当前136 Capability/115 Result family/231表/60事务。最新追加代码仍在回归；三项UAT未关闭、未发布，旧生产收藏补齐预览/正式恢复、来源祖先资料资格、显式刷新及最终平台/UI/完整Gate仍继续。


2026-10-21用户已确认UAT-328完整设计并要求326/327/328全部开始开发。当前执行顺序为：326稳定来源资格与执行期短期授权；327共享本地完整分组及确定性Run分批；328 Arca剧级公共呈现及三层Provider合同、首次/跨季/新集与维护闭环。先回写SSOT，再实施和定向回归、具体版本UI审核；不继承先前版本资格，不将开发授权视为生产旧任务Reset或现存剧根补文件授权。下方待审描述保留为历史时点。

首批开发检查点（产品提交`85ab5c7e1`）：326的Identity/Metadata/Artifact使用稳定JavSourceQualification，执行时重签短期Handle，并保存Metadata真实核准时刻，避免长查询跨TTL后误判来源；327采用共享本地完整分组、Triage Rule revision 3及local_media_group，分类目录可分批而真实1024上限保留；328已实现基础剧级文本Basis、Provider图片scope及稳定缓存key、共享登记/CAS/版本引用组件和精确文件IO。组合342项定向测试、2项隔离JAV Host及最后受影响范围77项通过；P2合同、Manifest、包边界和语义静态检查通过。328尚未接通Supporting Work、正式Control/Ready提交、Accepted/On-deck/维护退出、原条目恢复及本地补充资料完整入口，三项均未完成最终验收/发布。完整长时门禁曾提前启动后停止，记STOPPED，不计PASS；后续固定完整增量再执行。

2026-10-21新增UAT-328设计评审里程碑：[剧级公共呈现完整生命周期草案](evidence/UAT-328_SERIES_SHARED_PRESENTATION_DESIGN_20261021.md)已完成。用户已确认三项剧级文件均必需及首次/跨季/新集复用目标；Arca共享呈现职责和Handoff/Commit扩展、来源及维护细则为待审建议，非已实施合同。设计包含Provider精确三层接口、共享登记/引用、首次S03及并发/崩溃/缺损/退出与现场修复验收矩阵。326/327既有方案已确认，实施授权持续；无本轮产品或生产修改。

2026-10-21 UAT-326/327处理方案审视完成：326优先复用Arca已有“冻结来源资格、执行时签短期Handle”的模式，并单独落实旧在途纯查询的正式收束/恢复；327需讨论撤销第一层目录不可拆，以共享本地完整分组规则及确定性分批替代，保留1024原子上限。当前无产品/SSOT或生产修改，未将方案记为确认；实施范围和验收见既有生命周期Evidence。

2026-10-21 UAT-325已完成：移除独立准备异常入口，原任务统一“重试任务”，历史只读数组导致的500修复。精确6c7493964经UI负责人验收及标准生产部署，17:47:53恢复正常供给，原转码重启推进，八项接口与前后80组事实保护通过。本次用户明确允许标准重启中断当前转码；原完整副本Host FAIL例外保持。该UAT按自身证据关闭，当前Phase继续承接其他开放问题，不替代Phase Exit。

新增开放UAT-326：ABF-153的JAV识别Event重启后因短期Handle到期时间变化导致输入摘要漂移，重复恢复被拒；本次只定位记录，尚未修复。相关代码与408旧版相同；实际转码恢复和本次UAT-325修复通过不等于全部任务已恢复。详见同一生命周期Evidence。

2026-10-21 当前承接：生命周期与合并增量已标准部署40861e877并恢复正常供给。用户上线后反馈UAT-325：已结束任务查询500，以及独立“准备异常”入口不符合用户旅程。根因已定位为历史分页修改只读数组；继续本Phase修正，恢复统一为原任务“重试任务”，未接收成功者纳入同一列表且不伪造Subject/Run。修正版验证与发布继续；先前待部署快照按历史保留。

2026-10-21 用户已接受本次完整副本 Host 演练例外，保留 FAIL 及原因记录；其余检查通过后直接继续已授权的标准上线，不再等待该项决定。固定全量资格、安全停机、冷备/结构安装及部署后核验仍须完成，无生产 Reset 授权。

2026-10-21 FORMATION-PACKAGE-DESTINATION发布检查点：实现、未上线增量及主线整合已完成，固定c66d55b4a全量资格仍运行；UI负责人接受、Windows/Linux相关验证与实际照片建档通过。225表升级和保留候选新增事实的224表回退复制通过，完整Host达到正常供给但演练含只读物理操作错误，仍为FAIL；旧版另有已修复的优先级版本号问题。发布例外待用户决定，生产保持af2257c423，无Reset。下一步为完整门禁结果、例外决定及标准安全切换，详见唯一专项Evidence，不新增并行Phase。

2026-10-21第二批实施检查点：DESTINATION-IMPLEMENTATION上述取消/排除/撤销、前置失败恢复、退休来源释放及用户确认D07已实现，UAT-322补既有superseded Cleanup Scope路径；SSOT/225表/164路由已同步。当前仍在发布资格阶段，不继承前序版本UI/完整Gate/跨平台PASS；不授权生产Reset或专项旧Workspace手工删除。具体本地证据见本专项Evidence最新节。

2026-10-21本地检查点：生产容量清理完成，两次人物照片建档自动完成。DESTINATION-IMPLEMENTATION首批已修改Libra历史失败拒收、Run公平初始轮次/包发布时间、Procurement技术失败下一Observation资格及Arca恢复分页首项阻塞；46项定向回归和3项隔离Host通过，未发布。持久取消、无Run退出、排除/撤销、退休Field闲置Control及其用户入口尚未完成；完整Gate/跨平台与具体版本UI资格不继承。

## 2026-10-21 实施授权与当前顺序

用户已授权整合工作区/远端/生产、交付未上线增量、修复本专项及生产人物建档问题。既有审查记录的“仅审查、未授权实施”描述为历史时点。当前工作项：WORKSPACE-CONSOLIDATION（已合并 US Adult 与 JAV 增量，尚未推送/部署）；PRODUCTION-CAPACITY（已确认 SQLITE_FULL/ENOSPC，按用户明确授权清理测试/历史备份/无使用旧镜像）；DESTINATION-IMPLEMENTATION（按审查中的已确认决定修复；新合同缺口不擅自决定）；PEOPLE-REGISTRATION-RECOVERY（两次 preparing 请求在 import 资源等待，验收 ISO scratch 与同卷不足链仍在核查）。产品改动、精确版本 UI 与平台资格、生产部署分别记证据，不复用旧版验收。

## FORMATION-PACKAGE-DESTINATION / “死包”专项（2026-10-21，当前优先）

用户要求在进一步性能优化及 UI polish 前完成全生命周期归宿审视，已恢复完整排查。起点为来源中的媒体文件，包含从未成包者；核心是控制责任不能收敛、以及错误准入限制，UI/入口为第二层。覆盖观察/资格/Triage、A、Libra、B、Arca Commit/合法非入藏、替代和再进入。600 包为目标示例，非已读取的生产清单；结束本次尝试与排除材料是两个独立意图。

- **DESTINATION-AUDIT**：本轮业务分支审查完成，B01–B37 补全未成包范围及实际出口；证据：[Evidence](evidence/FORMATION_PACKAGE_DESTINATION_AUDIT_20261021.md)。三条新增 Host 复现无 Run 放弃缺实现、退休 Field Control 阻断新来源、重试 Offer 拒收消耗资格；五项 Coordinator/Store fixture 确认前置 Work 失败持续 pending 与 Arca 两类恢复问题。F07–F14 区分实现问题/有人工出口/合同待决，不将合法等待一律判死。
- **DESTINATION-CONTRACT**：待逐项讨论 D01–D07：尝试结束与排除/撤销、重试何时消耗资格、退休 Field 闲置责任、Arca Accepted 后永久无法 Commit 的收口、等待边界、持久放弃意图、人工与自动恢复预算。尚未确认新合同，不用 Retry/Reset/反向交接代替设计。
- **DESTINATION-SURFACE**：方案需让用户从正常入口发现所有未入藏材料，看到当前原因、责任与有效动作，并能确认结果；已有系统失败重新整理局部入口不等于完整维护窗口。不预设新页面，按 Playbook §11.1/§12.3 与 Beta §7.1 验收。
- **DESTINATION-QUALIFICATION**：后续修复以冻结来源物理范围为分母，含未成包材料，逐项核对 Commit/合法非入藏/明确在途/错误阻塞，不重不漏。本轮 120 定向测试通过，加原再开采/激活和三条新增 Host、五项组件验证；无全路径实景/浏览器/生产专项 PASS，不能将已完成审查视为已修复。

本次仅审视和方案记录，不授权部署、生产扫描/激活/排除/删除/Reset；保留既有发布与 UAT 历史，不以新专项关闭旧项。涉及 Owner/终局/副作用权限的合同调整先取得用户确认，再实施。

2026-10-18 最新授权及结果：用户要求部署上线，已标准发布 `helix-beta-20261018-5367179429`（source `5367179429d6e6785c1adf8c8da363bc21def9bd`）；完整副本候选/使用后旧版回退、冷备、精确镜像及生产健康/历史保护通过。包含统一代理、空间不足转二号与UAT-318本轮热点优化，先前“未部署/暂停发布”仅为历史状态；未授权生产清理。未追加性能硬门槛或大批等价试验，未跑完整生产媒体E2E，UAT-318及其他未闭业务验收保持开放。详情见既有UAT-318 Evidence最新发布节。
2026-10-21 新增用户确认工作项 `JAV-ACTOR-COMPLETENESS`：补JavMenu同站演员提取；JAV演员结果必有，缺失时关联People管理的统一“未知演员”档案，覆盖首次Cast/NFO/入藏及Arca纠正，不伪造来源字段或外部人物ID，不改其他库。按SSOT同日合同实施、隔离验证和精确版本UI验收；未授权部署/生产历史修复。既有UAT-323/324和UAT-322各自保持独立状态。

本项本地代码与受影响Windows/浏览器验证完成；Service648 PASS/29既有skip、核心54、来源/Cast48、Owner回归93、真实Host3及宽窄UI2项通过。五项静态检查通过，SSOT摘要已按正式materializer更新；UI负责人已接受具体产品提交`7b318ef956`，宽窄8/8，无阻断项；后续仅测试/文档变更，92份产品源码/9资产相同，Linux/独立分发及发布资格不继承。UI旅程沿用人物→JAV演员→未知演员→相关作品→收藏详情，首屏真实登记数和姓名即为结果，无人工确认待办或新增说明文案。详见[JAV演员Evidence](evidence/JAV_ACTOR_COMPLETENESS_20261021.md)。

20:14生产发布完成：标准部署精确af2257c423，正式Resume已持久完成，health/Admin/正常供给与正常Owner周期、611原收藏/13组历史保护、15无关容器及fnOS通过。获授权的10项旧整理已清理，新整理按正常调度推进（复验9项进行中）；维护默认周六03:00–09:00上海时区，US辅助只保留ThePornDB，测试Key未进入生产。当前承接使用反馈，不把原固定全量环境失败改成一次全绿，不将未统计身份准确率或完整生产媒体E2E记为PASS，不批量关闭既有UAT或代替正式Phase Exit Audit。精确身份、备份与回退限制见CURRENT_STATUS及本项Evidence。

20:05检查点：生产新224表主库原子发布并验证摘要成功，13组历史事实/611原收藏保护通过。标准af2257部署apply进行中，未记正常供给完成。最终组合资格3145 PASS/26既有或opt-in skip/0剩余失败、四项静态检查PASS；全量首轮唯一Windows打包项因漏Web依赖失败，相同锁文件补齐后定向复验PASS，4190 tracked输入四次摘要完全相同，首轮ok=false记录保持。首个分离bind mount换库EXDEV未替换原库；单一父目录挂载经NAS隔离验证后成功。细节见既有US Adult Evidence。

19:37检查点：获授权的精确10项标准Reset已完成、保持停服；清理后66文件完整备份及权限校验通过。生产新库只在独立release目录准备，未覆盖原210表数据库或切换镜像。af2257正常周期后13组历史事实再次逐项摘要保护通过；最终固定完整Gate继续运行。前段“Reset进入apply”保留为此前检查点。

19:18检查点：af2257候选已在完整隔离生产副本中验证health200、normalSupplyAllowed=true及放行后常规字段协调（4来源、errors0）、安全关闭；原Workspace挂载身份只读保留，生产DB路径遮挡。13组历史事实表不变。生产正式安全停机已完成，精确10项标准Reset已备份并进入apply；未换库或切换镜像。d485完整Gate3158/3132 PASS/26 skip已结束，af2257全量独立Gate仍运行，不能以旧基线代替。最终切换须等候选资格及生产新库准备完成。

日期：2026-10-20。状态：`BASELINE QUALIFIED / QUERY INCREMENT LOCALLY VERIFIED / IDENTITY ACCURACY UNASSESSED`。

最新执行顺序：用户已授权当前10项未上架整理清理（含补入1项），611条收藏保护。正式安全停机09:12:47 UTC成功：四个在途通道/deferred recovery均0、FFmpeg退出、受理后无新增Attempt。随后容器正常停止，新完整冷备64文件/3,842,413,191 bytes逐文件内容/权限一致。正在补齐最新生产终态历史及三类合同完全不变的暂停后台批次证明，拒绝Formation兼容/未决Effect，不扩大清理范围；局部94项及空Host通过，具体副本及新固定Gate仍待验。旧64d1完整Gate3137 total/3111 pass/26 skip不替代新增代码资格。生产未Reset/迁移/升级，准确率统计停止。

发布检查点：精确候选`64d1b06702`的镜像已标准构建/上传并校验，dry run及当前UI负责人审核通过，Service和Linux增量验证通过；固定checkout完整Gate尚在运行。生产副本10个未完成Run阻挡210→224升级；标准显式10 Subject Reset仅完成只读预览。依Playbook §3.4等待新的生产数据处理决定，不擅自Reset或加兼容。生产尚未切换，冷备/完整Host/回退资格未完成；详见既有US Adult Evidence最新补记。

最新授权覆盖下方早期仅本地范围：用户要求改完直接生产升级，并将US Adult搜图收敛为唯一ThePornDB来源、固定地址及API Key设置。沿用同一活动Phase处理候选整合、UI与生产副本升级/回退证明及标准部署；不新增清库、Reset、旧任务终结或一次性测试凭据进入生产的授权。准确率统计按用户决定停止。

海报新排版补记：用户确认暖白底、顶部演员名、四帧2×2裁切铺满及页脚小肖像/原名的中性预览。唯一共享Renderer和冻结合同升级为us-adult-presentation@3；Windows55 PASS/1既有opt-in skip、Linux31 PASS/1同项skip、四项静态Gate通过。局部本地完成，未更新NAS镜像或已有成品，不继承原完整版本资格。用户已停止准确率统计，身份准确性状态继续保持未完成，不再主动收集统计；详见既有US Adult Evidence最新节。

真实辅助建档补记：用户提供仅用于本轮隔离验收的临时TPDB凭据。两处适配缺陷已修复并通过Windows29项、Linux相关6项及四项静态Gate；原验收镜像加两处只读适配修复后，正式连接/保存/搜图API和浏览器图片加载通过。来源候选数量不是身份正确率；旧Wikimedia缺陷随最新唯一来源决定退出当前范围，未追认旧结果。生产未改，无新增完整发布资格；证据见既有US Adult Evidence最新节。

## 1. 基线与授权

- 2026-10-20用户恢复开发，先完成ONNX worker thread改造，再复验实际N95隔离环境性能和整体验证。昨日暂停、未通过的性能预算及已取消Gate均保留为历史，不能计PASS；已确认业务决定沿用，无生产部署授权。

- 分支 `codex/us-adult` 从同步后的 `main@ac278f33e644f0fe52f93043bfa1ac0f2eb40b18` 建立；GitHub 默认分支已改为 main。
- 用户已确认五个议题并要求本地开发；[产品决定与开工取证](evidence/US_ADULT_DECISION_BASELINE_20261018.md)不是第二份架构。
- 沿用 Playbook §3.3：本任务先记录并回写已确认合同，再传播机器门禁、实现与测试；不为已确认决定重复申请授权。
- 本地代码、合同/单元/隔离 fixture 与构建在范围内；NAS 部署、停机、Reset、生产数据或真实媒体改动不在本次授权内。
- 前一开发包保留在 [历史交付快照](archive/JAV_AND_RUNTIME_DELIVERY_AC278F33E_20261018.md)。原未关闭 UAT、精确收藏保护与验收限制不变。
- 本次工作区忽略资料移存只用于保护本地文件，不新增 ShelfDeck 备份产品功能。

## 2. 顺序与当前工作

| 工作项 | 可验收结果 | 当前状态 |
| --- | --- | --- |
| `JAV-STABLE-SOURCE-RECOVERY`（UAT-326） | 无业务变化的JAV观察/元数据/图片Event跨TTL和重启可恢复，配置变化仍拒绝；旧在途事件不靠改摘要修复 | 三条稳定来源路径及跨TTL真实进程恢复/一次Commit通过；旧生产条目收束与最终发布资格未完成，不关闭UAT |
| `PROCUREMENT-COMPLETE-GROUP-SLICING`（UAT-327） | 分类目录下多剧多季完整分组后确定性分批；所有材料无重无漏；真实完整组1024上限不变 | 真实Procurement Host 1081媒体/22剧/65完整季包/2Run及既有P7回归通过；最终资格与生产验收继续 |
| `SERIES-SHARED-PRESENTATION`（UAT-328） | 剧根三项真实完整、跨季/新集复用、共享归属/维护/退出全生命周期可达 | 上架、重试补图、来源代际、维护、共享Control/历史引用及两类退出已接正式Host；定向证据见§20，最终固定Gate/平台/具体版本UI与生产旧根验收继续 |
| `SERIES-PRESENTATION-HANDLE`（隶属 `SERIES-SHARED-PRESENTATION`） | 剧集公共资料取图使用合法 Integration Handle；既有 tvshow.nfo 的 `-1` 占位不被误判；真实 Handle 校验回归 | 代码修复完成：profile `artifactOperations` + NFO `-1` 接受；20项定向PASS；待全量Gate/发布 |
| `RETRY-ACTION-MAPPING` | 媒体整理行按阶段显示“重试接收/重试整理/重试上架”；删除“处理冲突”对话框，失败原因留在查看过程 | 已实现；Web定向49项PASS；待全量/发布 |
| `FORMATION-RESET-WORKBENCH` | 当前工作台兜底Reset：`in_progress` + `attention_required` + pending intake，含Accepted未Commit；保留收藏/历史/Aftercare/源文件，释放Arca custody/on-deck/target | 已实现scope/receipt/UI；Reset 40项、Runtime UI 6项PASS；待副本演练/生产授权 |
| `JAV-ACTOR-COMPLETENESS` | 来源演员保留；缺失时统一真实未知演员；Cast/NFO/收藏/相关作品一致，无伪造来源身份 | 本地开发及适用Windows/浏览器PASS；产品7b318具体版本UI负责人8/8接受，未发布 |
| `US-CONTRACT-BASELINE` | 五个议题映射至 Owner、命令、事实、Effect、恢复和验收；SSOT 与派生合同一致，负例与 Architecture Gate 通过 | PASS：SSOT及派生合同、Owner/Effect/恢复负例及固定0c82ee862原始完整Gate通过 |
| `US-PEOPLE` | 三库独立；普通/JAV 零用户介入；US Adult 有图手动/辅助建档、编辑、每轮最多五位推荐；认领来源影片无二次确认 | 本地实现及适用工程资格PASS；范围限制见下文 |
| `US-FORMATION` | 真实 service-local 抽帧/人脸匹配，唯一最高有效演员；未识别进入既有暂存车间，确认后原位继续，有演员才可上架 | 本地实现及适用工程资格PASS；范围限制见下文 |
| `US-PRESENTATION` | 初次生产和 Arca 刷新共用正式 Renderer；四张 2×2 大截图；演员名加冻结原名；无展示用自建番号 | 本地实现及适用工程资格PASS；范围限制见下文 |
| `US-ARCA-REFRESH` | 仅用户单片手动指定/自动刷新创建本类 Aftercare Case；演员、NFO、海报、相关命名一致更新，收藏身份不变 | PASS：正式链路/真实进程恢复/UI、Windows/Linux及N95单片指定刷新；身份连续 |
| `SYSTEM-MAINTENANCE-WINDOW` | 每周配置、安全进入/退出、游标续跑和任务分类；概览只显示维护状态与当前任务 | 本地实现及适用工程资格PASS；范围限制见下文 |
| `US-QUALIFICATION` | 正式 Host 旅程、恢复反例、适用跨平台验证和具体版本 UI 审核有 Evidence | 工程资格PASS：完整Gate、Windows/Linux/N95通过；真实出演身份准确性未评估，整体业务验收保持开放 |

本 Phase 滚动细化当前工作项；不另建活动计划，不分配开发用 UAT。缺失真实模型/适配器不能由旧 Face HTTP 服务、Mirex Store、mock Result 或空演员关系替代。

## 3. 验收门禁

- People：跨库同人可独立建档、唯一性/查询按库隔离；普通/JAV 无用户写操作/确认待办；不按同名强行归并。
- US Adult：姓名和有效单人参考图必需；无效图不发布可用演员；修改姓名/图片不广播改写已上架影片；无合并/停用/删除。
- 推荐：每轮最多五位且聚合人物；用户认领只作用于明确来源 A，Owner 命令幂等生效；跨域交互不伪装成共享 Store 或跨域原子事务。
- Formation：覆盖最高匹配、无匹配、无脸、空库、人工改选、暂存原位继续、单演员验收、重启和重复命令；沿用席位/公平与责任边界。
- Arca：本类 Case 仅由用户 Intent 创建；无结果保留原演员；命名冲突不覆盖；提交前后崩溃可恢复，Shelf Entry/Deck Fact/Canonical Identity 连续。
- 产物：预览可看清 2×2 截图，姓名/标题不遮图；原名冻结，刷新不重复追加演员前缀；不以文件名替代内部身份。
- 窗口：默认周六 03:00–09:00 Asia/Shanghai；跨重启、配置修订、手动停机、长转码错过进入、到点退出和单任务失败均有反例。
- 调度：周期健康检查只签发 Case，Case 与 Run 在正常模式执行；维护及安全收尾所需的 Foundation/消息能力不被全局 stop 误停。
- 数据：已入藏事实/引用保留；旧普通/JAV 确认项只经 Owner 有界再解析，不盲目接受、同名合并或硬删除。
- 执行适用 Service/Web/Architecture 检查，Windows/Linux 原生依赖按影响验证；未测项明示，fixture 不冒充真实模型或媒体验收。
- 本轮为跨层开发，UI 按 Playbook §12.3 接受具体版本审核，后续 UI diff 重验受影响路径。

## 4. 停线与完成

未确认新业务边界只暂停依赖工作，纯工程选择由实施方处理。不得跨 Owner 写入、引入旧 Runtime、隐藏来源失败或擅自清理生产。
全部工作项具备具体实现与适用验收证据后才能称本版开发完成；本文件当前记录本地开发进度。实际发布、数据升级与真实媒体效果需要相应精确授权。

## 5. 2026-10-19 本地开发检查点（未交付）

- People：三库隔离、普通/JAV零用户确认、US上传/搜图建档、姓名/别名编辑、补图已接正式链路；深度系统维护、参考图释放/图库和关联作品仍待完成。
- Formation：service-local真实CPU固定模型、20点抽帧、最高有效单演员、无脸/空库转二号、原Run人工确认、NFO/共享2×2 Poster、精确Actor加原名与初次On-deck已贯通；Formation现有演员选择无建档快捷入口。
- 推荐：维护内持久化扫描、分组与排名，窗口结束后最多五位可见；用户认领/新建经持久Claim及Owner命令自动确认明确来源A。两片聚合、真实截图建档、ACK丢失跨重启、只确认A而B仍暂存的CPU Host通过。UI已接，尚未做浏览器及具体版本负责人验收。
- 维护：独立准入、安全进入/收尾、配置及概览、既有任务分类/持久cursor已接。手动豆瓣沿原Acquisition/cursor转普通调度已验证；残留清扫及完整截止/重启资格仍开放。
- Arca刷新基础：精确Arca物理作用域、共享匹配器、当前库存Actor/原名与目标规划、单演员NFO替换及独立20帧CPU/海报引擎通过局部验证。用户Intent、完整同版参考分页与Case已接Owner原子准入，数据库重开、迟发回滚、篡改与库存CAS反例通过；Arca源准备已有正式Supporting Work/Planner、workspace_write Capability和Root真实读取/CPU适配器；全部20帧及特征逐项注册，跨数据库重开可读，局部中断/链接/改字节围栏通过。后续匹配/文件Effect/库存提交和HTTP仍未完成。
- 当前合同：122 Capability /105 Result families /224表 /56事务 /141 Domain inputs /160路由，P2通过。一次完整Architecture在后置汇总被开发中SSOT修订打断，未获得可用完整结果，不算PASS；固定提交`64e2649d4`的隔离checkout完整门禁及匹配阶段Service回归已按用户暂停指令取消，均无PASS；恢复后需在新固定提交重跑。
- 最新已完成本地验证：上个提交Service648 pass/29既有skip/0 fail；源准备接线后的全Service648 pass/29既有skip/0 fail，首次启动暴露的Planner种类索引未同步已修复。Arca合同/事务/DDL等82项通过，P2及包边界通过；Web218项及构建为前序UI检查点。真实CPU Host证据单列，不把合成Result fixture当成推理证据。
- 继续实现Arca单片演员刷新Case。离线升级副本、适用跨平台、实际进程中断恢复及具体版本UI资格仍开放。未部署、未操作生产或真实媒体。

具体历史、失败记录与验收限制见[本地实施Evidence](evidence/US_ADULT_LOCAL_IMPLEMENTATION_20261018.md)。全部五议题及适用验收闭合前不称开发完成。

## 2026-10-19 暂停记录及本轮NAS验收授权

- 开发继续暂停；`codex/us-adult@461d8805d`已保存，工作区干净，正在运行的完整Architecture验证进程已按用户要求停止，不记PASS。恢复开发后先核验当前提交及原始完整Gate结果，不能使用已撤销的分组执行资格。
- 用户追加两项发布前验收，纳入现有`US-QUALIFICATION`，不另建活动计划。仅本节记录不会恢复开发或启动NAS进程；下一轮恢复开发时执行。此前“本轮仅本地”限制在以下精确NAS隔离测试范围内被最新授权扩展，不构成生产发布或数据修改授权。
- **N95性能资格**：在实际NAS核验CPU、内存及当前可用资源后建立独立容器、端口、数据目录、Workspace和输出；为测试容器设置CPU/内存及并发边界，监测共机生产服务，不停生产或接入其数据库。先建立空载基线，再运行实际模型冷/热启动、20点抽帧、参考特征缓存、识别与海报、单片刷新及维护批次；从单任务逐步增加有界并发。记录每片/阶段耗时、吞吐、CPU、内存峰值、swap/OOM、磁盘I/O/iowait、测试API响应及共机生产健康/响应变化。若出现持续无响应、资源失控或生产明显退化，立即停止测试供给并安全收尾，记录失败，不为追求压力继续加载。验收须给出实际N95可用并发/资源配置、瓶颈及剩余风险；有卡死、OOM、无界积压或无法安全退出时不得认为性能达标，修正后复验。交互可用性数值预算在执行前结合基线明确记录，不能事后凭主观“不卡”判PASS。
- **真实媒体E2E资格**：从用户指定`/vol02/1000-0-24018892/US/scraped`有界挑选少量具有不同画质、镜头及人脸条件的影片，冻结测试清单、大小/摘要及选择理由；只读挂载原目录，并将选中材料复制到独立测试输入，避免来源结算、重命名或删除作用于原件。记录复制与空间成本，不扫描/复制全库、不提交影片/人脸图像或人物隐私资料到Git。测试数据与产物只保存在隔离目录。
- 以可核实演员身份及用户确认的独立参考图建立真值；不能把算法最高分或文件名当真值，也不能从同一测试片取参考图来证明跨片可靠性。若无法可靠核实某片演员，报告未标注，不虚报准确率；新的确证信息需要用户判断时才讨论。记录逐片真值、帧/人脸检出、最高匹配及次高差距、阈值/模型/参考图版本、耗时、自动命中/误认/暂存，以及人工确认结果。小样本结果明确分母和局限，不外推全库准确率；不为凑通过而对测试集调阈值。
- 实际E2E覆盖隔离Field→Libra识别/未识别暂存→已有演员人工确认→NFO/2×2海报/命名→Arca唯一上架，并覆盖单片指定/自动刷新及身份连续性；无脸/空库等场景可补独立对照，缺少自然样本时明确其fixture性质。验收后复核原件未变、生产数据未接入、测试进程安全退出。NAS环境、精确代码/镜像、资源限制、测试清单及性能/识别结果存入现有Evidence，不能用本机Linux或合成媒体证据替代。
- 以上与尚未通过的最终完整Architecture Gate共同构成本轮剩余资格；Windows/本机Linux及UI既有PASS按精确版本保留，新代码修改按影响补验。生产正式部署、生产数据升级及原媒体改动仍需对应授权。

用户后续已明确恢复开发；以上暂停为历史状态。原始完整Gate正在独立`72388341e`验证checkout重跑，不分组或筛选测试。实际NAS性能及用户指定路径的隔离媒体验收已开始准备，精确环境、预算和范围限制见现有Evidence最新节；真实人物身份准确性不由本轮自动人脸比对判定，保留人工验收，不能用检出率替代身份准确率。

用户随后再次要求暂停：`72388341e`完整Gate已取消，不记PASS；本机所属验证进程已停止，NAS隔离测试容器已正常退出且无运行的本轮测试容器，生产身份/StartedAt/RestartCount保持。实际N95四片20点检出、两片技术标签E2E及单片指定刷新、维护截止/手动停机/下一窗口原Work续跑已取得证据。独立5 Hz探针482次请求零错误，但p95约511 ms、最大2.58秒，未达到预设500 ms预算；profile及本地ONNX backend源码证明推理Promise内仍同步调用native。已开始将模型计算移入service-local worker thread，三个Integration文件的未提交修改保留，尚未运行测试、打包或NAS复验，不视为已修复。恢复时先审查线程生命周期/队列/异常及真实模型一致性，再重建精确镜像和Windows包、复验N95预算及最终完整Gate。真实演员身份准确性仍须人工验收。


## 6. 2026-10-19 恢复开发检查点

用户恢复本地开发，优先Arca单片演员刷新；既有决定沿用。Arca指定/自动Actor的Source→匹配/选择→海报/NFO/Plan→stage/publish/verify→Inventory/Control原子提交→退役→Case结案已接正式Work、调度、HTTP和收藏页。有脸/无脸/同名/跨Host重启及真实UOW迟发失败回滚恢复通过；Shelf Entry/Deck/Canonical与无关健康Finding保持。当前130/108/224/56/144、162路由，P2通过；Web222项和构建通过；Aftercare69项、当前合同22项、文件进程退出等局部证据见现有Evidence最新节。Service648 pass/29既有skip/0fail为本轮检查点，仍须最终固定版本全量资格。先前暂停的Gate/Service不记PASS。

下一步在固定提交checkout跑完整Architecture；继续People深度维护/参考图/关联作品、离线副本升级、维护剩余项和整体验证。Arca正式Host异常进程退出与并发冲突、适用平台和具体版本UI资格仍开放。没有生产操作或发布，本版尚未完成。


### Arca异常退出与当前库存读取增量

真实固定CPU Host在Inventory提交前/后实际进程退出均已恢复原Case，外来目标冲突保持当前收藏和外来字节且精确报告；独立文件恢复8项通过。人物当前作品查询/分页及Collection深链、刷新期间retained旧海报读取已接通。正式HTTP相关作品复验、最终全量Gate/版本UI仍继续。失败Case用户恢复、People系统深度维护/图库生命周期、离线升级和维护剩余资格未关闭；具体日志及未测范围见既有Evidence最新节。


### US参考图片生命周期增量

图库/current Reference图片读取、补图/释放及原子replace_image已接正式Work/Effect/Owner事务；保留US最后有效图片，替换失败回滚和无脸保留旧图、重放跨重启由真实模型Host验证。Web231项及构建、Owner/合同27项通过，P2保持130/108/224/56/144（aggregate见Evidence）。普通/JAV系统维护正式链、Reference审计/无引用GC及具体版本浏览器/UI资格继续；Service补齐本地tools依赖后的全量648 PASS/29既有skip/0 fail。没有生产操作。


### 系统People及Actor失败重新提交增量

普通/JAV已走正式Evidence Supporting Work→Candidate→可靠身份Person Commit，弱线索内部保留、无用户确认；Arca精确来源Projection及可靠JavDB Actor ID接通，维护后当前出演关系由Arca自行更新。真实JAV强/弱线索Host2项、Series维护人物/修复Host3项通过。Actor无写入发布失败可严格证明后原子收口unresolved，用户从原入口显式新Intent完成；实际提交前/后进程退出及冲突后再提交1项通过，未知/部分效果不能采用此收口。新增失败收口Canonical事务，当前130/108/224/57/144、162路由；P2 aggregate与具体资格见既有Evidence最新节。Service648 PASS/29既有skip，Web232 PASS及build通过。

继续失败Actor stage精确清扫、系统People深度维护/Reference审计GC、离线副本升级与维护剩余资格；随后完成新固定版本全量Gate、独立依赖Windows分发、Linux及实际浏览器/具体版本UI审核。前一完整Gate33失败已逐项修复/局部复验但新整合未跑；本checkout Windows打包因共享依赖junction失败，非分发PASS。未操作生产，本版未完成。


### Actor stage精确清扫与Source期限增量

首次发布无写入失败后，原Case先准入独立discard Supporting Work，复用既有retire Capability及material_commit Effect；只清理其冻结stage manifest，全部成员预检后逐项复验，不触碰原片、retained或外来目标。实际Host在删除第一项stage文件后exit 75，重启沿同Case/Effect完成清扫，Owner才原子收口unresolved；再由用户新Intent完成刷新。另两个Inventory提交前/后exit 73/74继续通过，已准备Source在历史租约过期一天后可继续消费冻结结果。当前Basis冲突由只读状态明确投影，不伪造执行或擅自取消Case。

真实CPU Host组合1 PASS/85.0秒；Source租约4项、最新Actor/文件/Owner/P2组合20项通过，Web233 PASS及build通过。当前130/108/224/57/144及162路由，P2 aggregate a26df8c4641a9a08b5bb3dc18daa12009acddd9fff8037af4f9ca907be3e804a。完整Architecture正在独立固定c04641bab运行，不覆盖本增量；Service和剩余人物/维护/升级/平台/UI资格继续，尚未交付。


### 历史人物与离线升级增量

TMDB NFO/credits可靠人物命名空间统一查询及提交复验，跨库/多人物冲突不任取；历史头像与NFO编号保留，69项及人物页9项通过。离线main 210→224版本化结构副本已实现、归档精确DDL并接入分发清单：可靠归属填库类型，全部209个旧事实表原列逐字节保留，新14表为空，未知/冲突归属或未完成责任拒绝；旧确认仅内部保留，历史已接受来源可只读恢复。8项Operator及13项People合批通过。未操作真实生产副本或发布。72963fb39 Service648 PASS/29既有skip；最终全量/平台/UI及Reference GC、正式可靠归并等仍开放。


### 可靠系统归并与完整Gate检查点

维护内普通/JAV可靠归并已接正式Supporting Work、typed Evidence、Candidate/Owner Merge事务及消息ACK；同名不作依据，US不参与，偏好冲突保留内部。正式Host1 PASS/49.9秒、Owner/规则/作品18项、Arca真实CPU指定刷新及HTTP作品1 PASS/63.9秒。People明确历史Merge身份Scope使当前作品在Arca普通关系刷新前连续可读，不跨Owner改关系。

固定c04641bab独立完整Architecture为3076 total/3062 PASS/1 FAIL/13 skip，输入摘要前后一致；唯一生成DDL trace manifest漂移已重新物化，物理DDL不变，相关24项及副本8项通过。该固定版本独立Windows包含原生模型检查通过。最终新版本完整Gate及Linux/浏览器/UI负责人资格、Reference审计GC和维护剩余项继续；不能把本检查点视为五议题交付。


### Reference GC、后期Actor续跑与UI收口

正式双轮Reference审计及维护内精确Artifact回收、claim/Receipt恢复和重新发布验证接通；保持P3单Owner UOW，以Foundation opaque read fence保护跨Owner读间隔。后期人工Actor选择由Libra在唤醒生产前完成原位或合法replacement判定，真实CPU Host1项及提交后续跑重试负例通过。具体d8cff243b UI负责人8/8受影响检查通过、六项发现全部关闭；UI/Renderer后无变化。当前P2 131/110/224/58/145及162路由，物理DDL不变。最终固定提交完整Gate、Service/Windows/Linux资格继续，尚未交付；日志及准确限制见既有Evidence最新节。

### 2026-10-20 固定线程版本与NAS复验

`a4a673c20`完成线程客户端、原生模型/预处理、纯Pack验证及线程入口拆分；`0c82ee862`补齐共享Schema编译复用和精确Integration builtin负例基线。模型/阈值/业务Owner及持久合同不变。第一轮仅线程改造445请求p95 555ms仍FAIL；新固定版本434请求p95 410.05ms、p99 836.48ms、max 2619.84ms、零错误，达到既定p95≤500ms，偶发长尾仍存在。此结论限实际N95的1.5核/1.5GiB、两片技术标签旅程，峰值约887.6MiB、无OOM；不等于大库生产容量或实际身份准确性保证。

四片各20点检出与改造前一致；1核串行总65.096s，双任务37.212s（两片），主事件循环p95约80/82ms。两片暂存→原Run确认→唯一上架→用户单片指定刷新、维护截止/手动停机/跨Host重启及下一窗口原健康Work续跑均通过；原件四份完整hash/大小/时间戳/inode未变，生产镜像/StartedAt/RestartCount保持。独立Linux最终47文件208项全通过；前序环境遗漏测试专用脚本的13失败已保留，修正测试挂载后重跑，不改产品包。新镜像2634文件逐字节与Source/资源相同，UI摘要沿用已接受版本。

当前Service648 PASS/29既有skip、Web242 PASS；最终固定`0c82ee862`原始完整Gate不筛选/不分组，仍在运行。最初`a4a673c20`完整Gate因追加有证据的性能修复而中止，不计PASS。不得提前关闭Phase；具体镜像、原始日志、范围限制及最后结果以现有Evidence为准。

## 最终工程验收与Phase退出检查（2026-10-20）

固定0c82ee862原始完整Gate PASS：387文件、3129 total/3116 PASS/13既有skip/0fail，fixture 3493.8s。74个JAV名称（52 literal+22动态）逐名核验全部PASS；4183 tracked files前后aggregate 73c06dab33d3a59329af8f17519b7579b9c98ef0062c38317d63ae4d5f4e7a80完全相同。包边界、semantic、manifests、P2均PASS；此前取消/分组遗漏/失败轮次不计最终资格。

Service/Web/Windows/Linux/N95及UI的适用工程证据已齐备，跳过和未选中项均单列。主工作区Service原E盘junction已仅移动链接对象至ignored恢复入口，换成独立物理依赖；未改外部target，ORT1.30.0及默认固定模型完整，清空NODE_PATH后22项真实CPU/线程检查通过。代码/持久合同/SSOT在资格后未改，仅更新文档。

从SSOT反向检查：五议题代码、正式Owner/命令/Effect和实际恢复链均有证据；Worker仅持有图片计算/模型、不持有Domain事实，编译优化仍在Foundation Validator内，不引入跨域authority或新业务对象；无旧Runtime/双读/迁移兼容路径，无media-desktop或后续Phase耦合。原件完整hash/stat及生产image/StartedAt/RestartCount保持，测试已退出，无生产发布授权。

**不关闭整体Phase**：真实出演者身份准确性仍未评估。本轮只对真实素材检出/技术标签业务链路、固定模型一致性和性能负责，不能用最高算法分、文件名或未标注样本证明真实身份准确率；500ms预算仅在已记录的小样本/资源配置通过，2.62s长尾及生产容量限制保留。所有实现工作项的工程检查PASS不替代该业务验收，也不等于生产可部署或已发布。


### 2026-10-20 人工验收准备

同一固定镜像的独立manual-uat-v1已准备四份校验副本，空演员库、席位0、无Run，等待用户独立建档和评估身份。初始化夹具排序400经原幂等命令恢复，未重置数据或修改产品。NAS生产health连续三次5秒超时，安全监控已停止测试容器（Exit0、无OOM），本机转发亦关闭。停测后生产三次health 14.369/1.107/0.252秒，image/StartedAt/RestartCount保持；不判断慢响应根因。入口与会话资格未完成，暂不交付用户操作。私有清单/受限登录文件及全部隔离数据保留；待NAS稳定继续入口资格，身份和实际效果验收未开始，Phase保持开放。详情见既有Evidence最新节。


### 2026-10-20 超时关系核验及入口就绪

已完成生产只读profile与测试启停对照：停测后12次health仍出现6.113s及4.358s；测试不整理时8次均200、最大4.528s。证明生产自身存在超过5秒的慢响应，后台同步SQL/Libra reconcile、Perception候选/摘要和概览健康计算占用主线程；不能排除首次测试冷初始化加重同机竞争，也不宣称已修复生产性能。两次Inspector均关闭，生产实例身份保持；详见既有Evidence，不改已合格候选。

同一隔离数据已恢复，入口http://127.0.0.2:18125/people的health、登录session、未认证拒绝、Cookie、空人物库/席位0、页面及JS/CSS全部检查通过；未作浏览器人工身份验收。私有登录文件和清单已准备。1.5CPU/1.5GiB及原安全停测阈值保持；监控退出亦停止唯一测试容器。当前等用户独立建档、开启整理并判断匹配/海报/命名/单片刷新；Phase业务验收开放，无生产发布。


### 2026-10-20 查询优化增量完成（本地）

用户要求实施前述机会后，完成Series Direct Selection同次同步计算内的整季空间分配复用，以及Perception按完整Clause/Evidence和同事务Source cursor heads约束的256项候选ID查询索引。仅深冻结且由本模块构造的Basis可复用；逐文件Probe/Handle仍核验，scope结束/异常即失效。评分仍每次读取当前记录/关系并执行原规则；新资料使索引失效，exact路径不增加head查询。未实现新的Resolution未变快返或概览方案。

最终19文件261 PASS、Linux9文件190 PASS、Service648 PASS/29既有skip、四项静态Gate零finding；运行与测试输入摘要前后保持。此前83文件过宽扩展轮已取消，不计PASS或完整Gate；Linux首次缺测试脚本的1fail保留，补齐验证挂载后通过。原0c82ee862完整Gate只证明固定旧基线，增量没有新完整Gate/分发/N95资格，NAS验收入口仍原固定镜像。

本机组件5轮中位数：96成员纯Series分配58.09→0.77ms；1500记录64个重复候选查询73.45→3.64ms，输出相同，冷查83.38→81.81ms；并行干扰下曾有冷查变慢，已保留。不能当作整机CPU或生产health改善。表/API/UI/摘要规则及Owner不变，当前P2 aggregate不变。整体身份业务验收继续开放，无生产发布；实现、安全负例、原始记录及准确范围见既有US Adult Evidence最新节。
