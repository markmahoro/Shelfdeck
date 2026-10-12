# UAT-318：有界查询的部署前UI接受

2026-10-12，UI负责人接受 `9a23b01c7ff8c5d16272898e2efe3296e500cd0c` 的受影响查询输出、当前动作、评分、分类和详情入口，部署前UI门禁通过。主任务可继续用户已授权的标准部署流程；UAT-318真实生产Tab/HTTP长尾性能仍开放。未修改产品代码、部署、Reset或重处理任何生产媒体。

根因、主任务双平台验证及生产备份交错对照见 [UAT-318实施Evidence](UAT-318_FORMATION_TAB_QUERY_PERFORMANCE_20261012.md)。同快照的12次三section JSON等价是查询层证据，不构成完整Host、浏览器或生产性能PASS；本负责人审阅了对照脚本及记录，没有重跑NAS备份对照。

## 审查与独立验证

Foundation只有显式传入有界 `resultCapabilityRefs` 的调用精简Result正文，Event结果头部及时间保持。Libra列表声明10个分类/分支/当前动作所需Capability，打开详情不传该范围，仍完整读取并执行原JCS与digest fence。Perception当前评分按target、query digest及当前head有界读取；retraction、Resolution及Winner保持原Owner判断。没有前端替代事实、丢弃事件、删除历史、状态回退或兼容绕行。与9478a4fc7比较，Web产品代码、文案和布局没有diff。

从指定SHA的git archive冻结副本执行：

- `helix-formation-projection.test.js`、`formation-process-projection.test.js`、`helix-architecture/p6-perception-store.test.js`、`helix-architecture/p6-perception-resolution-resolver.test.js`：81通过、0失败、0跳过。包含列表/详情当前动作一致、Result头部保留、所需正文及默认完整读取的篡改拒绝、无关历史不全扫、600目标跨500边界、缺失目标、retraction与当前Winner不变。
- TypeScript/Vite构建通过；JS `index--m8OvhRG.js`、CSS `index-BxRYbDd1.css` 与上一已验收Web产物名称保持。没有依靠修改界面掩盖读取问题。
- 隔离Chromium实际加载该bundle，HTTP适配器调用真实FormationQuery与SQLite ProjectionStore，当前事实/history ports为fixture。与父版本比较，三个section的完整fixture查询返回deepEqual；跨section summary保持一致。
- 额外用真实ExecutionProgressProjectionReader构造两个Event：含64KiB资料正文的metadata与含保留原输入结果的settlement。列表范围从本SHA声明的10个Capability提取，metadata只有头部，settlement完整；默认详情保留metadata正文。由实际ProcessDetail/currentPlanSummary构建，精简/完整读取所得当前动作一致，仍为“保留原有输入作为最终文件”。
- 浏览器同一条目显示该当前动作及“4星·豆瓣”，打开原“查看过程”，按真实折叠控件展开后可见metadata正文中的“完整资料示例”及保留原输入的处理结果。Esc关闭并恢复按钮焦点。评分的有界Owner读取由上述Perception回归单独证明；浏览器的current-rating port为受控值，不冒充真实豆瓣同步。
- stale/ready与两种active/completed响应先后，共4组合通过；状态/片名/收藏架筛选、刷新、reload、历史、空态及最后一页控件保持。1920×1080与390×844计数/入口可见，九列不变、无横向溢出。0浏览器异常、0未预期接口、0写请求。

审计目录 `E:/my_project/helix-git-consolidation-20261008/uat318-20261012/`：源码包 `source-9a23b01c7.zip` SHA256 `ae9dc79ae7dc3622bce8df7ee2866d3c53150f3be10d55dba9d7e6a0327f74b2`；`owner-tests.log`、`web-build.log`、最终 `browser-run-v2.log`。浏览器脚本 `formation-browser-audit.cjs` SHA256 `fadb02bf5562bf0901bf4e1223b90ae030006f52e1747b27c6cb2b196f8db6d6`，`browser-evidence.json` SHA256 `0dc3564a09374e364387b0d7968c63423d0f3cbb1167eeeb79f64508dd5791d0`。

已目检 `full-detail-desktop.png`、`all-unfiltered-desktop.png`、`ended-390.png`。首轮浏览器脚本误将已展开阶段再次点击关闭，导致其内部Plan不可见而超时；保留 `browser-run-v1.log`，改为先读原生open状态，仅展开尚未展开的控件，完整路径重跑通过。没有强制改DOM、放宽产品校验或修改产品以通过fixture。

## 接受边界

以上是指定版本的部署前UI与读取语义接受。隔离场景为既有Movie形状的Subject、受控current-fact/history ports及Process事件fixture；不是完整Clean Host、真实Series整季生命周期、生产NAS并发负载或豆瓣服务验收。完整生产备份查询等价另由原实施Evidence记录，不能拼接成新版本整页性能PASS。

本项最终镜像构建/部署资格由主任务处理。部署后需重测真实四Tab、刷新、自动更新的请求与结果可用时间、当前动作/评分/分类/详情，保留HTTP长尾、health及NAS/后台执行的独立证据；此前9478a4fc7曾观测约18.9秒请求，不因局部字节数下降而关闭。五项失败媒体继续保持用户“暂不重处理”的决定，不通过停止业务、Reset或改变事实口径获取性能结论。后续任何用户表面diff需按新SHA重验。

## 2026-10-13生产审核：呈现接受，性能尚未通过

主任务完成9a23b01c7标准部署后，UI负责人于00:10–00:37（Asia/Shanghai）执行真实Edge四Tab、手动/后台刷新、当前动作/评分/分类及详情只读审核。接受本版本服务优化的受影响用户表面；**不接受整体Tab/HTTP性能已达标，UAT-318性能仍开放**。后续纯前端加载空态补丁由主任务核验，本轮没有重复审核它，也没有修改产品、流程文档、CURRENT_STATUS或UAT总表。

### 计数与可见事实

00:22正式GET交叉取证：active/completed/ended均为total512、inProgress8、attention0、completed504、ended101，Projection ready且asOfMs一致；维护counts为completed56/ended31。实际四Tab为700/8/0/692，符合`512+101+87=700`及`504+101+87=692`。

期间正常业务流转，页面先后为700/7/0/693、700/5/0/695。00:37再次正式GET，三个section均为total512、inProgress6、attention0、completed506、ended102且同一ready时点；不是与00:22共享事实快照，不把变化归为旧查询口径横跳。未停止业务或冻结任务来取得相等计数。

列表当前动作与公开API对应：保存整理决定、确认身份、检查最终产品等仍显示；海王2/叶问/宇宙探索编辑部分别保留3/4/5星豆瓣值，待匹配和暂无匹配仍为简短状态。伸冤人3等条目期间进入后续步骤，保留对应事实时点，未要求动态任务动作永远不变。

三国真实95集/95文件详情保留3阶段，首次观察220 Plan/726 Node，后续正常推进为221 Plan/730 Node；列表与详情对应当前视频处理步骤。详情DOM仍含获得信息、数量、运行/检查结果、文件大小、时长、视频、画面、主要音轨等实际字段。独立临时页核验Esc关闭及焦点回到三国“查看过程”。既有九列、评分及分类入口保留；没有评分、加急、放弃、重新整理、Reset或其它业务写操作。

### 普通操作样本与长尾

使用浏览器原生PerformanceResourceTiming读取同源请求，未注入页面状态或改产品；下表的“结果观测”包括控制通讯/采样开销，要求本次请求结束且分类行数匹配，不能等同纯渲染时间。

| 动作 | 控件反馈 | 请求结束及结果观测 | 对应主要HTTP耗时 |
| --- | ---: | ---: | --- |
| 已结束 | 0.309s | 1.401s | completed0.769s、ended1.027s、care1.315s |
| 全部 | 0.310s | 1.712s | active0.542s、completed1.164s、ended1.417s、care1.625s |
| 刷新 | 0.911s | 3.591s | active1.776s、completed2.372s、ended2.631s、care2.690s |
| 需要处理 | 0.302s | 0.662s | active分类0.603s、care0.204s |
| 整理中 | 0.307s | 0.763s | active分类0.712s、care0.386s |

首轮没有作为异常删除：共享页reload的首轮四路HTTP为0.760/1.882/1.862/1.962s，从reload动作至四路HTTP结束约4.801s；因DOM采样启动过晚，不给这一轮精确可交互/结果绘制时间。独立临时页首轮HTTP亦保留，active1.197s、completed3.054s、ended2.280s、care2.352s。它们不是P95资格样本。

**残余长尾真实存在。** 共享页后台active曾25.423s；独立页一轮active/completed/ended分别42.045/42.701/42.942s（00:32:41发起），另有约33–36s样本。末尾两轮恢复至约0.418–1.543s，也不能反向抹去长尾。三国首个详情HTTP6.924s；后续共享页约0.805–1.455s，独立页精确观测至完整详情5.491s，另有2.755s自动详情请求。普通Tab部分样本比9478较快，但两个时点的业务负载/缓存/浏览器状态不同，不据此单独归因全部改善，更不宣称总体性能问题已修复。

ResourceTiming包含浏览器调度、网络及服务端请求阶段，本轮未同步取得NAS/服务端剖析，也未固定并发或满足SLO样本量；不能将42.9s直接认定为某个数据库、I/O或前端原因。两次只读API取证health均ok/normalSupplyAllowed=true；健康快照不等于没有长尾。主任务须继续性能剖析及有边界的长尾验收，不以发布或有限低延迟样本关闭本项。

### 取证与未测边界

原审计目录下 `production-9a23b01c7-20261013/` 保存脱敏`production-browser-final-evidence.json`（SHA256 `be32c55324612450bc6989ad15abb936973cd0f1ebacfff7d5690e0989b8a66a`）、`read-only-api-evidence.json`及`read-only-api-evidence-round2.json`。仅保留请求路径/查询、时长/状态、有限公开字段与DOM结构摘要；API key在脚本进程内从既有ignored配置读取，没有打印、截图或复制到证据。没有Header/Cookie、完整响应正文或凭据文件内容。

采样缺口明确保留：旧浏览器绑定首次失效；Network事件订阅没有产生可用记录，改用原生ResourceTiming。晚观测的85s/45s等值不是UI加载耗时，已标无效。共享页详情曾在用户导航后消失，不能当作产品关闭失败；随后用同浏览器独立临时页完成详情/返回。首个独立页样本沿用了捕获旧句柄的helper，因此未形成完整计时，不纳入表格；最终独立取证使用固定句柄，记录各自timeOrigin，不混合两个页面的请求时钟。资源缓冲有限，243条共享页及240条独立页记录不是全部生产流量或完整请求分布。

截图01–06已取证并目检关键页面，其中`05-independent-detail.png`显示真实95集完整计划；本次只用实际最大化视口，没有扩展窄屏或SLO资格。临时页已关闭，原用户页保留。依用户最新精确边界，其他层开发涉及UI仍由负责人审核；本项收尾仅属于9a23服务变更，不承接或重复主任务的纯UI空态补丁。

## 第二轮候选6feda0d26：部署前呈现门禁通过

2026-10-13，UI负责人接受 `6feda0d26a3d3ff5994a17d23d83ac1bc3a756ce` 的后端改动在受影响用户表面的呈现，主任务可继续已授权标准部署。纯前端加载空态部分沿用实施任务的14专项及实际Chromium验收，本轮没有重测等待→空态等纯UI场景。此结论不覆盖本候选生产Tab长尾，也不关闭UAT-318性能；之前9a23的约42.9秒请求继续保留。

审查确认：Formation只消费Shelf ID/name，改为Arca既有public facade的`listShelfNames`，仍来自同一`arca_shelves`持久事实，包含活动及历史Shelf，不读Inventory/注销摘要。完整Admin Shelf读取、路由/标准/物理安全校验路径没有改动。名称获取没有变成Libra或前端事实。概览producer原本已await读接口；新async Formation callback在四次读取间让出线程，仍仅在完整bundle生成后原子发布，旧完整快照、失败/停止保护和五秒cadence保持。原子发布不等于多次Owner查询共享数据库事实快照，未扩大这一承诺。

从精确git archive冻结源码验证，未读取共享工作区的其它改动：

- Shelf名称、Formation查询/详情、Overview query/producer及4000条有界汇总共6文件，66通过、0失败、0跳过。覆盖名称无Inventory/注销/物理检查读取、分类/当前动作/历史、概要和详情、概览旧完整快照保留、重建失败与停止保护。
- TypeScript/Vite构建通过，产物`index-BaNkdIXh.js`。这是包含主任务已验收纯前端补丁的精确候选，不用旧Web bundle冒充本版。
- 隔离HTTP/Chromium稳定数据走查调用真实Arca facade、FormationQuery、SQLite ProjectionStore、ProcessDetail及OverviewProjectionHost；底层Shelf rows/current-fact/history为受控fixture，不是完整Clean Service Host。Arca名称读取在fixture中禁止Inventory/注销摘要及物理检查，活动“电影·档案架”与已退役“曾用收藏架”均显示正确；下拉、列表与详情的名称一致。
- 执行从本SHA Host提取的实际async Formation callback，同固定事实下完整bundle与原四个同步查询结果deepEqual；实际Overview producer发布内容与原OverviewQuery生成值deepEqual，页面保持正式收藏、正在整理6部、5个当前标题与最近上架结果。Host接入轻量名称callback同时经过源码检查；没有宣称完整Host接线E2E。
- 三个section完整fixture输出与父版本deepEqual，计数一致；当前动作“保留原有输入作为最终文件”、4星豆瓣、分类、完整资料与原详情入口保持。键盘打开/展开/返回及焦点恢复通过，九列不变，0浏览器异常、0未预期接口、0写请求。没有新增等待或空态断言来重复审查纯UI部分。

已目检`all-unfiltered-desktop.png`、`full-detail-desktop.png`、`overview-desktop.png`。首轮脚本误写概览原单位为“项”，真实页面为“部”，保留`browser-run-v1.log`；修正测试Oracle后完整稳定路径`browser-run-v2.log`通过，没有修改产品文字。

审计目录：`E:/my_project/helix-git-consolidation-20261008/uat318-6feda0d26-20261013/`。源码ZIP SHA256 `5dd9d85d60747314784db3ab236f9b895ab11c8cd017074f7845411df7fc39f4`；`owner-tests.log`、`web-build.log`、`browser-evidence.json`。脚本`backend-fields-browser.cjs` SHA256 `72b238622a6e0dd982d6b729435c3b6cb45d1dd10f3990373bf0808ec71dad50`；浏览器Evidence SHA256 `6ebcd62dd997ddd4e63e94cb8e100fe270af3ef266e498f33c66dacc5f554bf6`。

本次没有NAS部署/副本对照、生产性能或真实Series生命周期复验，没有改变五项失败媒体或其它任务。主任务的最终镜像资格与本项UI门禁各自保留边界；发布后仍需真实Tab、概览更新、详情与长尾取证，不能以66项或稳定fixture关闭性能。未改产品、流程文档、CURRENT_STATUS或UAT总表，未清理不属于本任务的untracked测试输出。
