# US Adult 本地实施证据（开发中）

本记录不代表版本交付或生产发布。唯一活动计划仍为 `implementation/CURRENT_PHASE.md`，业务决定来源为五议题基线。

## 已落地范围

- Person/Provider Identity 按 normal、jav、us_adult 隔离；普通/JAV 弱线索保留内部 Evidence，公开确认接口拒绝用户写入。
- US 图片建档使用持久 People operation、正式 Supporting Work、import/embedding Capability、Effect、Artifact Registry，最后原子提交 Person/首图/Reference/command receipt/Outbox；未发布身份不进入人物查询。
- 姓名辅助搜索支持配置的 StashBox 与 Wikimedia，分别返回来源状态，通过全站网络策略取图；用户选图凭证冻结来源配置与网络策略，不含凭证明文。
- YuNet/SFace 模型、ONNX Runtime Node 1.30.0、输入处理、阈值及许可校验固定。参考特征按人物、参考版本、图片 digest 和完整 Model Ref 缓存。
- 2×2 四截图 Renderer 与“演员名 + 冻结原名”纯组件已有局部实现，尚未接入实际 Formation/Arca 产物。
- 维护状态机、配置 API/设置页/概览、准入筛选、安全停止、持久 cursor、周期健康与普通 Case 调度拆分已接入；到期回收与正常恢复拆开，DB 只抽样读取 FK keys，不读取大 JSON 内容或强制 VACUUM。

## 当前验证

1. 正式 Host + 实际 CPU 模型：US 上传建档、三库查询、头像原始字节、命令重放、异参数冲突、重启后查询与重放、无脸拒绝/零新增 Person 通过。
2. 最新 Host/模型准备/Kernel 组合 12 项通过、0 skip；图片准备的受控中断重放单独验证，不冒充进程退出或全部 Effect 恢复资格。
3. 实际 CPU 图像测试覆盖单脸、缩放同图、空图、多脸；2×2 像素布局及冻结原名组件测试通过。测试材料为非生产公开测试图，不是成人媒体识别验收。
4. 维护窗口固定结束、15 分钟错过跳周、结束前五分钟收尾、跨重启、手动 stop、配置幂等/版本冲突、调度前筛选及游标暂停续跑有局部证据。手动 resume 后准入延迟已修复，相关 17 项通过。
5. Web 全套 200 项通过，当前维护 UI 的 Service/Web 构建已通过；尚无具体版本 UI 负责人接受。
6. 机器合同当前为 121 Capabilities / 104 Result families / 211 tables / 51 transactions；124 domain inputs，229 references、0 unresolved。P2 aggregate：`1190861357aeea7a30265d540cd8fe88e0cbc8871a107ad147ad7f4696ab0e8e`。Package Boundary/Forbidden Semantics 定向检查通过。

Service 全套较早检查点为 667 项：625 pass、13 fail、29 skip；包含旧 Schema 升级断言、回收站原周期调用、缺失本地根依赖及 resume 准入问题。回收站及 resume 已局部修复；旧 Schema 与依赖项仍需处理。该检查点早于最终 People 接线及 211-table schema，不能记为当前版本全量通过。首轮 Architecture 全量主动终止，没有 PASS。

## 尚未闭合

演员资料编辑/演员页完整交互、推荐与来源 A 幂等确认、Formation 抽帧/匹配与暂存继续、正式海报/命名、Arca 单片刷新及恢复、离线数据副本升级、最终 Movie/Series/JAV 回归、Windows/Linux 分发及具体版本 UI 审核均须继续完成。
自动豆瓣同步未完成时用户“立即同步”继续同一Acquisition/原Snapshot/cursor，用户已确认；持久继续Intent将其转normal准入，隔离跨重启验证通过。没有进行生产发布、数据升级、Reset 或真实媒体改动。

## 上游依据

- [ONNX Runtime Node](https://onnxruntime.ai/docs/get-started/with-javascript/node.html)
- [固定 OpenCV Zoo 模型版本](https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98)
- [OpenCV SFace 实现](https://github.com/opencv/opencv/blob/4.x/modules/objdetect/src/face_recognize.cpp)
- [StashBox GraphQL schema](https://github.com/stashapp/stash-box/blob/master/graphql/schema/schema.graphql)
- [Wikimedia Imageinfo API](https://www.mediawiki.org/wiki/API:Imageinfo)

测试日志与下载模型在忽略的 `.codex/us-adult-validation`、`.codex/us-adult-models` 下；不提交模型二进制、运行数据库、导出的生产数据或生成 dist。

## 追加：人物页、资料编辑和图片维护

- 三库人物页取消旧确认队列；普通/JAV只读，US提供姓名/别名、上传或明确选图、进度查询、姓名/别名编辑及补充参考图。新增StashBox测试并启用设置；保存仅传已验证Proof，清空输入凭据。
- 资料编辑使用独立People Profile Update事务及typed Decision，Person revision CAS、immutable revision/aliases/原Provider identities、Projection checkpoint、Command Receipt/marker/audit原子提交；旧版本拒绝、网络重试和重启后原命令重放保持。
- 补充参考图由三个正式Event执行：import、CPU embedding、people.reference_fact.commit。冻结Person/reference两版本，独立Reference revision及People-internal Outbox；不广播Arca。重复图片明确拒绝；同一Owner的相同内容Artifact按digest复用，publication intent保持同operation不同输出拒绝；Linux发布目录fsync。
- 用户确认豆瓣续接选择。新增Perception-owned immutable resume Intent，原Scope执行来源、Snapshot和cursor均不重写；Scheduler只读取Owner的normal/maintenance分类。当前活动采集转normal，Source/config变化拒绝，命令重放先于终态/配置检查。
- 本阶段最新Web全套207通过，构建通过；真实CPU Host覆盖建档、改名/别名、加图、重复图拒绝和重启重放；受控图片端口3项真实模型通过。Perception/搜索/Host组合较早32项通过，另有同Acquisition/Work/Scope/cursor跨重启的定向证据。非真实进程死亡资格，尚无浏览器/UI负责人审核。
- 最新P2为121 Capabilities /104 Result families /212 tables /53 transactions，126 domain inputs、229 refs、0 unresolved；aggregate `db5e05ab7d5ebb0482c7fab21bdbc0aeae84d4d0d30cc85c97dcb5f9038ac74a`。Package Boundary通过。新增数据升级尚未实现；原全量Service及平台缺口继续开放。

本段是本地检查点，不宣称五议题开发完成。下一步接入当前Libra Run的US身份/人脸匹配/暂存确认，后续推荐、正式命名/海报与Arca单片刷新仍须完成。

## 追加：当前Libra身份分支与真实抽帧

当前Libra Run已新增US internal_source身份Observation/Commit分支；唯一Primary与原始叶文件名绑定。正式Person无关的内部Identity仅作为Subject Anchor，displayIdentity持久原名与provenance digest；合法replacement沿原Subject Fact读取，不从新名称反推。Canonical Source Chain重验完整US Intent/Observation及原名，篡改后即便重建合法Fact digest仍拒绝。

SQLite正式Fact/Result/marker提交与重放、原名跨replacement连续、纯Observation不请求Provider及closed schema 4项通过；JAV/Series/US组合较早42项通过，新增加的原名替换反例另行定向通过。机器P2及Package Boundary局部通过，尚无US完整Host/上架链路。

新抽帧端口使用Service FFmpeg、独立进程登记/停止、逐帧执行围栏、30秒单帧限时、10MiB输出上限及源文件前后inode/指纹/时间核验。默认20个区间中点，CPU遍历全部检测人脸；按全部有效参考取最高分，稳定Person ID决胜，明确冻结模型、阈值及Reference版本。实际FFmpeg两秒非生产静态测试片完成20点抽帧及真实CPU匹配，另覆盖空库、真实无脸图、模型变化、来源追加字节拒绝，2项通过。该证据是端口/算法真实运行，不冒充正式Work、暂存、Arca或成人媒体识别验收。

下一步仍是正式Work/参考版本快照、暂存原位确认、推荐与来源A衔接、完整产品海报/命名及Arca刷新。Windows/Linux分发、升级、完整回归与具体版本UI审核继续开放。

## 追加：完整演员参考库分页

新增People只读UsAdultPersonSnapshot/PeopleReferenceLibraryPage：姓名、Person/reference及Projection版本和完整digest一起冻结。分页使用相同library head digest；库变化明确拒绝不完整快照。每页最多256人并有字节预算，不把库截断为前256人。Reference Projection超过正式大小上限的写操作整体回滚。

People执行Construction Registration已登记，并在public内部构造Store、命令和执行Port；Construction对象只返回构造方法，不直接返回Store。新增Reference查询方法沿既有PersonReferenceQueryFacade。270人跨页、普通库排除、并发加人导致旧digest拒绝、nominal schema及既有People/public boundary检查通过；最新组合32项通过（含真实20点抽帧和CPU模型）。更早Host/US/JAV/Series身份组合46项通过、0 skip；最新增加的匹配版本字段守卫已定向重验。

P2当前128 Domain inputs、212 tables、53 transactions；121/104 Capability/Result families不变，229 references、0 unresolved。aggregate `c970f7b4fb6c3971fcac2024433d3f391ae77d141330a9dc7d83b4e5c7330e56`。Package Boundary及diff check通过。完整Libra Analysis Basis/Work和暂存确认仍待接入，不能将端口/正式Identity Fact证据表述成US影片已能完成整理。


## 追加：分析Basis、正式Work构造与分页评分

新增Libra-owned不可变Analysis Basis及Reference Page两表，在独立事务中冻结同Run正式Identity、Workspace、Source Probe引用、模型、20点采样和完整People页集；原始输入不随演员库后续更新而改变。原子写页中断回滚、重放先于Run后续状态、截断/乱序/旧版本及持久页损坏拒绝通过。当前合同214 tables /54 transactions /129 Domain inputs、121 Capabilities /104 Result families /229 references /0 unresolved，P2 aggregate `511d9beaa3e564223e8e58818382e2362ef6f459bae2db635add6c2401ddadde`。

Service已装配正式抽帧、Embedding、Cluster和分页Match Capability及Planner/Owner Projection，shared embedding由Composition按明确Owner分派，People单图约束保持。Workspace写入携带Foundation Effect授权，复用既有Artifact恢复；Root只接service-local FFmpeg/CPU模型。每页只发布最高有效原始cosine、阈值、Person/reference/photo和模型版本；完整页集验证后按最高分及稳定ID折叠，缺页不能判未识别。Cluster保留所有成员特征，不用centroid替代逐脸匹配；CPU循环主动让出事件循环并重验执行授权。

受控算法/端口与真实模型组合9项通过，含真实20帧、无脸、空库、同分稳定顺序、来源变化及1000×1500共享Renderer；SQLite Basis/Planner/跨页折叠5项通过。相关旧Western/正式产品Fact/Result Builder组合39 pass、2既有或显式模型skip；单独真实模型9项0 skip。正式People Host回归1项通过，建档/编辑/加图/重启保持。Package Boundary 591文件、2031依赖检查通过；diff check通过。根工具依赖ssh2已按锁文件本地安装，NAS命令构造单测通过，无NAS连接或操作。

本段仅证明Basis及Work构造/执行端口接线；主Formation协调器尚未接完演员选择、暂存原位继续和下游US Product链路，未进行正式US影片Host Work全链路验收。新版Service全量仍在运行，首轮旧人物确认页断言和缺失本地工具依赖已修正并局部25项通过，不把该局部修正记成全量PASS。推荐/来源A确认、Arca演员刷新、版本化副本升级、平台和具体版本UI资格继续开放。


本检查点真实模型及Basis/Planner组合最终14项通过、0 skip。Service首次全量667项：627 pass /11 fail /29 skip；其中旧人物页断言、工具依赖和8项历史Schema Kernel保护为已定位失败。Kernel现在按明确冻结Schema版本启用新增library guard，历史14项及当前DDL/Kernel19项均通过，新增反例确保当前Schema仍拒绝跨库Provider Identity。对应页面/工具命令局部25项及部署脚本无副作用dry-run3项通过。正在重跑Service全量，未记总体PASS；历史migration模块和历史DDL Oracle均未重写。

后续Service全量在015fd5f60检查点完成：676 tests /647 pass /29既有skip /0 fail。单个US演员快照查询随后新增到正式People Query Facade，必须同时匹配Person/reference revision，跨库、陈旧输入和后续编辑不改变旧快照的反例及相关People/public检查26项通过；该新查询尚未代表影片选择命令已经接好。P2 214/54/129与Package Boundary继续通过。新US数据升级仍未实现，历史Schema Kernel验证通过不等于新Schema副本升级资格。

## 追加：Libra用户演员选择Intent

Libra已新增按Subject连续修订的演员选择Intent与head，来源Run、期望Run状态/Basis、People单人快照、两个人物版本、用户和请求摘要一起冻结。独立正式命令把Intent/head/Receipt/marker/audit原子提交，先查既有命令再读People；重放时不依赖当前Run或已变化的演员库。主Libra Construction已构造该服务，但REST/Formation UI、当前Run恢复及下游Media-Cast/产品消费尚未接完。

命令原子回滚、CAS、旧版本/跨Profile及交付竞争拒绝、完成后People不可用仍重放通过；当前DDL/Kernel、Analysis Basis/Work和真实People Host组合28项通过，0 skip。合同216 tables /55 transactions /132 Domain inputs，121/104及229 references不变、0 unresolved；P2 aggregate `3d195bee66aaee4f8d2496a999cf85b05741b0a9fef95c7a7feda3fc4ef8fbc5`，Package Boundary594文件/2040依赖通过。此前Service全量PASS属于015fd5f60检查点，后续Intent变更只具备上述局部证据；不是US影片完整整理、推荐认领或Arca刷新验收。

## 追加：完整匹配完成事实

Libra新增不可变UsAdultMatchCompletion，只有完整冻结页集的全部Match Work正式成功，才冻结全部Result/input集摘要、脸数、胜者快照及原始Evidence引用。完成后只读取这份Owner事实和必要的胜者Result，不再读取整个人物库或重新发布分析Work；People后续编辑不会重算其他影片。无脸正常空结果与缺页、失败、未完成严格分开。完成行中断回滚、当前Run变化拒绝、完成后重放及不重新查库反例通过。

当前P2为217 tables /56 transactions /133 Domain inputs、121/104和229 references不变、0 unresolved；aggregate `1d04d2791f3c1e837ce6f1e1c09b467f8797ad449714e8a36fdbf268d6111fe2`。DDL/Kernel/People及完成事实42项通过；真实CPU/20点FFmpeg/共享Renderer和正式People Host组合7项通过、0 skip。新增Foundation validateWorkflowPlan后发现并修正分析Planner的Event依赖格式及各Capability资源声明，正式Plan合同及负例组合5项通过。此前只检查Planner输出的局部测试不冒充正式Plan发布或影片Host链路。完整Formation/Arca/推荐/新副本升级及适用最终验收仍未闭合。


## 追加：明确演员选择与单演员Fact

新增UsAdultActorSelectionBasis统一人工Intent与自动完成匹配；人工确认不伪造人脸分数或PersonMatchEvidence。Media-Cast的closed Source Basis加入us_adult_actor，Owner提交重验同Run正式Identity、Analysis Basis、当前Subject选择head或完整Match Completion，且恰有一位冻结姓名、人物版本和有效图片的演员。空演员、未持久Intent、旧head、替换姓名均在Fact/Result发布前拒绝；人工来源保留Owner Intent，自动来源重验精确Work/Result链。

共享Poster Capability改为消费明确Actor Selection与Frame Set；真实CPU/Renderer局部验证含人工选择，避免无脸后人工确认仍被强制要求匹配Evidence。原Movie/Series/JAV的两种Media-Cast来源字段及产物保持，nominal Source Basis统一命名为LibraMediaCastSourceBasis。当前134 Domain inputs、217表/56事务；P2与Package Boundary通过。Domain Input/SQLite产品Fact组合22项、真实CPU/Renderer/Actor组合21项及Profile/Result回归63项分别通过，不相加冒充一次全量。

尚未接通主协调器的US Metadata/Artifact生产、原Run暂存继续或REST/UI演员选择。上述持久链测试为隔离准备的Foundation事实，不是影片正式Host旅程；完整五议题、数据升级、平台与UI资格继续开放。


## 追加：当前Run产物生产与真实CPU Host

US主协调器已接正式Analysis/Normalize Supporting Work，按冻结演员和原名生成有来源链的Western Metadata，NFO消费单演员Draft，Poster通过共享Renderer生产/验证后进入原有Media、Conformance、Handoff B及Arca On-deck链路。输入Plan完整冻结AnalysisSpec/上游Result；Normalize的literal Variant在Canonical提交中重验精确Work/Result。首次未识别在既有二号车间等待，明确选择后继续原Subject/Run；已有产物Work消费旧演员的改选经现有replacement准入保留旧事实。新增选择演员POST接口及155条Route库存；Formation选择UI与查询尚未接完。

实际Windows Service Host、真实固定CPU模型和FFmpeg的两条非生产旅程通过（2 pass /0 skip）：无脸影片在空演员库完成匹配后进入二号，重启后建演员并经正式HTTP确认，同Run完成上架；已有人物库通过真实最高匹配直接上架，无用户Intent。检查最终演员名加冻结原名/实际mkv扩展、NFO姓名/标题、1000×1500海报、唯一演员、暂存释放及完成后命令重放。测试材料仅公开良性人像及生成静态片，不代表真实成人媒体识别质量、实际杀进程恢复或Linux资格。

Host首轮揭示并修正：当前Profile准入缺失、抽帧Sink错误追加无Event的独立Effect、Poster未提供目标路径、来源Basis带nominal合同外字段；未把前几轮失败算通过。Sink现在只沿Event Effect发布，新增精确单Effect反例；Host跨重启证明已完成分析无孤立Effect。固定不前进的测试时钟曾使资源等待不推进，已改成非维护日的递增时钟，未改业务Scheduler绕过资源。

Libra Package及Arca On-deck提交现要求精确一个非空US演员Fact，metadata瑕疵授权不能豁免该不变量。Arca初次Placement从冻结原名和Actor Fact构造名称，实际容器扩展不沿原后缀；不走旧180字符截断，重复目标始终拒绝。Package/Inventory负例及Movie/Series相关文件行为组合89项、产品Plan/Workspace Effect组合34项、早期公共合同/元数据/二号API组合33项分别通过。此前Service全量647 pass属于旧检查点；新一轮全量仍在运行。

当前机器P2为121 Capabilities /104 Result families /217 tables /56 transactions /134 Domain inputs /230 referenced types /0 unresolved，aggregate `5f8d6ce66e5f419d44445f479f5d78c78b514f9b56bbe2262e7b6da89fff1250`；Package Boundary 602文件/2088依赖通过。全部生成合同已重新传播；不是完整Architecture Gate。US推荐及来源A、照片替换/释放、普通/JAV深度维护、Arca刷新、数据副本升级、最终跨平台和具体版本UI审核仍开放。


## 追加：Formation演员选择与查询

新增Libra只读actor-selection查询，返回当前Run/Subject选择版本、冻结演员与匹配状态；未识别通过既有Identity Issue Read-model显示“需要确认演员”，不产生普通/JAV用户待办。US整理页独立演员选择弹窗只搜索已有US库，展示图片、分页加载及确认；未加载或失败的图片禁止选择。原Actor选择body在网络重试中完整复用，版本冲突停止重试并刷新；没有建档快捷入口。文件来源现可选择US Adult，收藏标准显示US单演员/原名命名说明。

最新两条真实模型Host旅程复验2 pass /0 skip，追加了Formation attention/文案、只读query、原Run确认及完成后只读状态的HTTP检查。Web全套212项/39文件通过，最终TypeScript/Vite构建通过（约530kB bundle既有体积警告保留）；尚未做浏览器自查或具体版本UI负责人审核。Query/路由/Surface组合24项、Formation相关60项通过。上一后端检查点的Service全量676 tests /647 pass /29 skip /0 fail已完成；Actor Query/Formation新投影及本次UI只具有上述追加证据，不将旧全量归到最终版本。

当前Route为156（155 admin +1 health），机器数量仍121/104/217/56、134 Domain inputs /230 references /0 unresolved，P2与Package Boundary603文件/2090依赖通过。全部工作项仍未交付；推荐认领与来源A、Arca单片刷新、人物维护残余、照片维护残余、版本化副本升级、最终全Architecture/平台及UI资格继续开放。


## 追加：推荐可复用的人脸位置证据

当前Frame Embedding Artifact在特征向量之外保留有界frameGeometry@1：20点图片摘要/尺寸/时间，人脸frame ordinal/位置/质量，以及原完整Analysis摘要。读取必须恢复并校验完整Analysis，严格校验模型、向量归一化、人脸来源、质量计算与closed字段；零脸仍保留完整截图证据。现有Reference feature格式和固定模型版本保持。Service原生帧模式缺少几何证据时明确拒绝，不回调旧Face HTTP或重抽整部影片。

技术Artifact仍由原Embedding Event的Foundation Effect持久发布，Handle摘要覆盖特征及几何；实际Host的空库/无脸旅程额外读回正式Workspace文件并验证20点证据。真实模型/20帧/Renderer/两条Host组合8项通过、0 skip；closed几何及替换负例4项通过。P2与Package Boundary604文件/2095依赖通过，数量134 Domain inputs/217表/56事务/156路由不变。推荐Source只读端口、People分组/当前五人快照及认领来源A尚未实现；不将这份基础证据写成推荐功能完成。

### 推荐来源 Owner Query 检查点

Libra公开精确的UsAdultRecommendationQueryFacade，只读扫描完整零匹配、有脸且仍待演员的当前Run；返回冻结原名、完整Frame/Embedding/Cluster Result引用及版本。认领/交付/Run变化使旧Source失效。三个有界DTO正式传播，P2门禁PASS（p2-recommendation-query2.txt）；recommendation-query-first.txt中24项通过，包含无脸、来源篡改和并发版本变化拒绝。此处使用隔离Owner事实及合成Result fixture，尚不代表真实Host推荐或People推荐/认领完成。

### 推荐图片受控读取与真实Host

Root只读图片端口核验完整截图/Embedding几何/Cluster分组，主分组选最清晰来源图，返回有界JPEG及证据摘要，不开放路径或写权限。图片编码结束前再次确认Libra Source版本。Windows/Docker文件清单已纳入该端口。真实CPU空库Host产生20帧有脸零匹配，正式Owner Query及Workspace Artifact端口可读取图片；重启来源不变，用户确认演员后旧图片Source拒绝且原Run完成上架。recommendation-real-host-fixed.txt中5项通过（含这条真实Host及4个图片检查），recommendation-image-package-final.txt中6项通过。首轮真实Host因Cluster二次归一化与源向量字节不同而拒绝，已按既有normalizeVector精确重算并补浮点回归；未采用容差放行。入口依赖检查同步补齐此前新增的People图片、维护和抽帧技术适配器白名单，仍明确禁止旧Runtime。当前只是Source/图片基础，五人推荐快照、认领Saga及UI尚未完成。

### 推荐维护构建、快照与只读HTTP检查点

People四张Owner表持久化cycle、来源Observation、内部分组和Publication；不创建/合并Person，不改影片Actor。每步有界推进，64组分页比较保存最佳候选；来源只贡献一次，排名pass再次校验所有有效来源。固定版本策略按覆盖数、清晰度和稳定ID选最多五位；Publication在固定window end后可见，维护期间沿用上轮快照，未完成比较/排名跨周恢复。只读列表及JPEG接口已接People Facade/Root，卡片不暴露特征或Workspace路径；失效来源隐藏且旧图请求拒绝。

当前121 Capability /104 Result families /221 tables /56 transactions /137 Domain inputs /158 routes（157 Admin + health）；P2 PASS，Source Map aggregate b637719e43cbec5bfb9dfa42f39e6f52969645393c024e8b42519a9a12c42164。Package boundary PASS（610 files/2115 dependencies）；recommendation-combined-final.txt中60项通过，涵盖DDL、Kernel、排名、Owner Query、跨周cursor和生效时间。recommendation-maintenance-real-host-third.txt中新增真实CPU Host旅程通过：空库有脸→维护正式构建→维护中隐藏→重启→安全退出→正式HTTP列表及JPEG→用户人工确认来源→旧推荐失效→原Run上架。前两次分别暴露30秒逐步轮询导致90秒测试预算不足，以及测试时钟跳至结束后未等待安全退出；现使用Runner原5秒预算内最多8个有界scope，并明确等normalSupplyAllowed，无绕过维护准入。

当前仍缺推荐认领/新建与来源A自动确认Saga、推荐UI、Arca演员刷新、离线升级副本和最终全量/平台/UI资格；不得称五议题开发完成。

### 推荐认领与来源A持久确认检查点

新增People-owned Claim及Libra UsAdultRecommendationCommandFacade。已有演员冻结Person/Reference版本；新建先复制明确选择的图片至People ingress并冻结prepared Registration，再保存Claim，随后经原People Work/Effect准备与发布Person。短期搜图token不参与持久恢复。活动来源唯一，原请求key/digest先重放Claim；普通调度推进待确认消息。Libra派生claimId/sourceDigest命令key，复用原Actor Choice事务；已有Receipt先于失效Source重放。People ACK丢失、Actor库随后编辑或来源已进入交付时，仍能确认原命令回执；未提交前Actor/来源版本变化则明确冲突，不覆盖新决定。

真实CPU Host用两部相同演员的合成影片验证：空库→20帧分析各自未匹配→维护聚合为覆盖2片的单一推荐→窗口结束后展示→从来源截图创建1位演员→只确认A→模拟ACK中断→重启/原请求重放→A沿原Run上架并使用演员名加冻结原名，B仍在暂存且无Actor Choice。People Person、图片操作和Libra Actor Intent各恰好1条。recommendation-claim-two-films-host-final.txt中该Host旅程通过；先前fixture误用关闭后的UOW、误把A单片确认后的来源列表断言为空，均已修正且保留失败log，不算产品失败后伪报PASS。

US人物页已接最多五张有图推荐卡、已有演员选择及手动/辅助新建、同次请求重试及Claim进度查询。无图/图片加载失败禁用确认，Formation原选择器继续不提供建档入口；正常/JAV不读取推荐。共享建档组件的推荐路径通过单一Claim命令耦合A，不由浏览器拼接两个写请求。Source Owner查询每批最多扫描32条完成索引，遇有效来源才占用返回限额，终态Run不读取大型Completion正文。

当前121 Capability /104 Result families /222 tables /56 transactions /138 Domain inputs /230 referenced types /0 unresolved /160 routes。p2-recommendation-claim-final.txt PASS，P2 aggregate 36df52db6109565fa8610394927808ec5f8e9504cfc06b76712d97cc623fb2bc；Package boundary PASS（615文件/2129依赖）。recommendation-claim-contract-final.txt 47项通过；web-recommendation-all.txt 218项/40文件通过，Web构建通过（现有大chunk警告仍在）；service-recommendation-checkpoint.txt 677总项/648通过/29既有skip/0失败。上述是本地检查点，未完成全量Architecture、Linux/Windows分发、真实进程强制中断或具体版本浏览器/UI负责人资格。

继续开放：普通/JAV深度维护与US参考图生命周期、Arca演员刷新、离线隔离副本升级、维护残留清扫及最终跨平台/UI资格；本版未交付、未部署。

### Arca刷新输入、共享匹配和单演员NFO基础检查点

共享抽帧入口只接受匹配的Owner/物理scope/process三元组，覆盖Libra Run及Arca Shelf Entry；跨Entry、跨Owner或错误process在访问媒体前拒绝。原物理stat、fingerprint及20点采样校验保持。最高分参考匹配独立为无Domain Store/Work权限的技术组件，继续逐版本核验People Projection、特征内容、参考图模型和缓存键；Libra适配只映射自身cluster字段，Arca可以传递自己的脸组身份，无需构造Libra Handle。

Arca售后目标规划读取本域当前Inventory冻结的唯一Actor及关系索引、首次原名与digest，不读取实时People姓名、不从成品名剥前缀。新增16 KiB精确UsAdultInventoryPresentation绑定Case/Entry/Inventory/Canonical及Actor关系digest；Root命名端口只在Arca Aftercare作用域使用它，初次Package验收仍走原严格单演员Fact。Movie/Series原命名路径保留。真实CPU Host从初次自动匹配、成品上架至Arca当前库存只读目标规划通过，且无Libra生产演员快照伪造或目标文件写入（arca-inventory-naming-host-final.txt，1 pass/0 skip）。首轮读取误用了无wrapper的relations digest，被真实Host拒绝；已按既有libra.media-cast-relations@1精确核验并修正fixture，保留失败记录。

新增US专用NFO纯渲染精确替换全部直接Actor节点为一位，保留其他可读字段、私有ID及嵌套扩展内容；不捏造Provider编号，不使用普通影片追加演员规则。相同输入重复渲染字节稳定，损坏/缺失源按明确重建/创建结果处理。首轮替换会累积空白，幂等字节反例失败；已改为原位替换首Actor及删除其他直接Actor，重复结果精确一致。

arca-shared-analysis-native.txt中33项通过/0 skip，含真实ONNX推理、Arca/Libra各自20帧及共享匹配同分数；arca-inventory-nfo-final.txt中23项通过，含Movie/JAV既有NFO回归。新增Domain input使当前为121/104/222/56、139 Domain inputs、230 referenced types/0 unresolved及160 routes。arca-presentation-p2-final.txt PASS，aggregate 910566a56d80f1f75c5398b6a59308cfb4f18e9cae8dc47785eecb20a1b4c84e。第二轮Product Surface materializer遇Windows UNKNOWN open manifest-registry.json；原文件可读完整，保留失败log后只重跑该materializer及DDL/P2成功，不绕过校验。完整Architecture进程已启动，尚无结果，不算PASS。

此处完成的是刷新输入、只读规划和渲染基础；尚无用户Actor Refresh Case至文件Effect/Inventory Commit的完整实现或中断恢复资格，不能称单片演员刷新已交付。其他未关闭工作项不变。

### Arca用户刷新Intent及Case原子准入检查点

新增UsAdultActorRefreshIntent固定Entry/Inventory/Deck/Canonical版本、Care Basis、Known Bindings、唯一视频binding、首次原名、模型/Renderer版本及原请求digest。指定演员经People正式查询读取完整Person/Reference预期版本；自动模式读取完整同版分页，逐页摘要、稳定排序、人数及pageSetDigest连续验证。重复key先读持久Intent，不依赖当前影片或Actor仍可选择；不同请求同key明确冲突。没有HTTP/UI入口，尚未接实际Supporting Work执行。

两个Arca-owned表保存不可变Intent及完整参考分页，与既有Aftercare Case同一事务建立。Case创建要求本Owner产生的精确准入Participant，复制标签/缺失Intent均在写入前拒绝；不伪造Health Finding。Case解决只结束演员刷新目标，不关闭无关健康Finding。隔离SQLite实际重开、完整三页保存、快照篡改、迟发事务回滚、库存CAS变化、调用方对象突变及Finding隔离七项通过（arca-actor-refresh-persistence-semantic.txt）。这些fixture验证Owner事务，使用合成库存上下文，不代表真实媒体Actor Case全链路。首轮真实People Store指出命令遗漏Person/Reference两项预期版本，已修正；后续fixture两处误写表名修正，原失败log保留。

独立Arca技术引擎用自己的Entry读取权限执行实际FFmpeg20帧、固定CPU分析、共享参考匹配和共享海报Renderer。保持与初次生产冻结特征相同的归一化计算；实际最大分数精确对照通过。截图或参考图字节替换拒绝；无Libra Run/Actor Selection伪装。arca-inventory-preparation-native-final.txt三项通过/0 skip，包含上述真实推理和海报；arca-intent-canonical-host.txt初次真实自动上架后库存/Canonical一致性与只读命名规划通过。另已查看本机海报布局样张（poster-layout-5995003a6.jpg，合成场景与公共良性参考图），不代替浏览器或负责人UI验收。

当前121 Capability /104 Result families /224表 /56事务 /140 Domain inputs /230 referenced types /0 unresolved /160路由。参考分页的512 KiB数据库预算仅按精确表/列允许，没有放宽其他JSON上限。arca-intent-p2-final.txt PASS，aggregate da03ee4a1c0e075980d13e73ffafe9e89cf0ebfaf92c3f7f8a3305425331b4d2；arca-intent-checkpoint-final.txt 82项通过；Package boundary PASS（623文件/2168依赖/47包）。Table validator的旧210/251/88计数实际读取当前活动合同，并非历史冻结oracle，已更新为224表/269 FK/102 JSON列；负例保持且通过。Windows偶发manifest-registry.json UNKNOWN open原始log保留，独立重跑同一materializer及DDL/P2成功，尚无证据确定外部占用方。

service-arca-intent-checkpoint.txt为本检查点重新执行Service：677总项/648通过/29既有skip/0失败（135秒）。Web本轮未改，沿用前序218项及构建证据；尚未取得具体版本浏览器/负责人UI资格。

arca-groundwork-full-architecture.txt这次完整门禁在昂贵fixture运行后，因并行修改SSOT而在后置汇总抛出Table count drift（父进程仍缓存222，文档已224）。没有输出可用的fixture汇总，不能推断这些fixture通过，也不能记为Architecture PASS。已修复汇总器：后置检查异常产生失败Finding并保留已完成fixture输出，四个专门反例通过；Playbook明确长门禁在固定提交独立checkout运行。此修复不把异常转换为成功。下一次完整门禁使用独立版本快照。

继续开放：Arca正式Source/准备/文件Effect/Inventory Commit/恢复及UI，普通/JAV深度维护与US参考图生命周期，离线副本升级，维护剩余清扫和最终跨平台/UI资格。本版未交付、未部署、未改生产或真实媒体。


### 2026-10-19 Arca源准备 Work与不可变分析工作区（未交付）

- 新增`arca.us_adult.source.prepare@1`：正式`arca_shelf_entry` Supporting Work、Owner投影、Planner、精确输入/结果语义检查和`workspace_write` Receipt接入现有调度。源Handle由Root读取真实stat/有界fingerprint后签发，绑定Case/Intent/Entry/原物理Target/Control，24小时有效；无伪造时间或借用Libra作用域。
- `ArcaUsAdultSourcePrepared`≤16 KiB，只引用本Case自己的Frame manifest与Features Handles；20张JPEG和两个JSON各自进入既有Workspace Registry。完整特征/几何恢复后沿用相同CPU匹配和共享2×2海报，后继读已完成工作区不重新获取已到期源读权限。
- Workspace仅写声明的内容寻址路径；全SHA、inode、有界fingerprint和无链接父路径均验证；短临时写入必须明确safe_retry并匹配原字节前缀才清理，异字节不覆盖。实际SQLite重开及3项写入恢复/取消/链接检查通过。Owner/Work/Intent/Control/Planner反例3项通过；真实FFmpeg+ONNX+工作区恢复组合6项通过，0 skip。
- 标题投影拆出`buildUsAdultTitle`，不为标题检查捏造`.mkv`容器；实际扩展名确定后执行255 UTF-8字节预算。新增252字节标题可配`.ts`、不可配`.mkv`的边界回归。
- Package Guard原词法扫描把RegExp中的引号当成字符串，新增独立标题校验后误报。修复仅明确表达式前缀位置的RegExp扫描，保留除法中的真实require审计；12项含负例通过。原Poster三处模板插值显式改为相同字节拼接，遵守既有禁止动态模板规则。Package Gate通过632 files/2208 dependencies/47 packages。
- P2：122 Capability、105 Result families、224表、56事务、141 Domain Inputs、233 referenced types、0 unresolved、160 routes；aggregate `5b94bf91ef9654e18ca81c76bc2d28b67e34c495712a9f9bb84f59992762a268`。源准备接线首次Host启动发现Planner列表多一项而种类索引未更新，精确修复后真实CPU自动匹配至初次上架Host通过1项（44.2秒）；此证据不代表演员刷新文件提交已完成。
- 接线前启动的Service批次在更新期间遇到旧Planner索引并失败，不能算通过；修复后的Service全量677项，648 pass/29既有skip/0 fail（135.6秒）。固定提交`64e2649d4`的完整Architecture在独立managed worktree运行，与此开发树分开；尚无完整结果。所有失败日志保留在忽略的`.codex/us-adult-validation/`。
- 未完成：Arca完整分页匹配/目标选择、文件stage/publish/verify/Inventory commit/retirement、Case中断恢复、用户HTTP/UI及其资格。People图管理/深度系统维护、版本化离线副本升级、维护剩余资格及最终全量/跨平台/UI审核仍开放。未操作生产。


### 2026-10-19 Arca单片演员刷新主链路与恢复检查点（本版仍未交付）

- 用户恢复开发后，已接通Arca Source、完整冻结参考分页匹配、唯一最高Actor选择、资产准备、stage/publish/verify、Inventory/Control原子提交、旧材料退役、Case原子结案。指定/自动刷新均通过正式HTTP创建原Case；库编辑不创建Case。Arca自身Metadata/Actor Fact不伪造Libra Fact，首次原始命名、Shelf Entry/Deck/Canonical持续。
- GET `/v1/admin/collection/:shelfEntryId/actor-refresh`只读返回当前版本/演员/执行状态；POST `actions/refresh-us-adult-actor`提供指定/自动命令及幂等/CAS。收藏页新增有图的演员选择、自动刷新、状态及冲突提示；未知响应重用完整同命令，不能混入另一种操作。
- 真正启用固定CPU模型的HTTP/Host：改名指定Actor整链及重复命令通过；有脸自动刷新、Source后跨Host重启、同名不重叠前缀通过；无脸自动刷新保留原Actor且不产生Inventory/file Work通过。`arca-pipeline-automatic-host-final.txt`两项119.2秒，`arca-pipeline-owner-recovery-final.txt`一项47.6秒。后者在真实Owner UOW最后追加迟发失败，证明Inventory/Control/Result回滚后沿同Case恢复；无关健康Finding未被关闭；Collection投影显示更新标题/Actor。
- `arca-pipeline-local-final.txt`18项：完整分页证明、目标产物/版本、Inventory与Control守恒、文件冲突及恢复。文件专项最新`arca-pipeline-file-recovery.txt`7项，包含发布第一项/旧别名退役后真实子进程Exit73，再按同Plan向前恢复；这是物理Effect进程边界证据，不冒称整个正式Host被强杀。短stage临时文件只有明确恢复决定、精确字节前缀和稳定stat均通过才清理，外部异字节不覆盖。
- Owner/命名34项、Actor原子准入/结案7项、既有Aftercare/事务69项、当前Catalog/路由/负例22项通过。Case必须具备准确Capability、实际执行Work/Event/Attempt、全部前置Result和原子Result/marker才可resolved；无匹配不触碰原库存，其他健康修复不受此Case关闭影响。
- 派生合同P2通过：130 Capability、108 Result families、224表、56事务、144 Domain inputs、240 referenced types、0 unresolved、162路由；aggregate `8a222ba39e25315d5f183e848dbdad3b8cae6463832fabd7c91bbff273f0c6a1`。两项提交使用既有Domain Fact/Aftercare Inventory事务精确variant；没有另建跨域事务。Package Gate 650文件/2286依赖/47包通过；保留Contracts纯规则，物理路径解析留在Domain/Root。
- Web全量222项/41文件通过，构建通过（既有>500 kB chunk提示）；本轮Service677总项/648通过/29既有skip/0失败。完整Architecture及最终具体版本UI、平台和离线升级资格仍须独立完成。本轮局部验证过程中曾暴露资源合同/重复资源键、Workspace resolver参数、SQLite BigInt及GET查询作用域接线错误，已准确修复并保留失败log，不算通过证据。
- 先前`64e2649d4`固定提交完整Architecture及匹配阶段Service均已按用户暂停指令取消，不能记PASS，也未在后台继续。全部原始log保存在本地忽略目录`.codex/us-adult-validation/`。当前停止的旧验证checkout无用户改动或需保留的忽略产物，将按managed流程退出，后续长门禁使用新固定提交。
- 继续开放：全链真正Host异常进程退出/并发冲突资格、UI负责人具体版本审核及适用Linux/Windows；People深度系统维护、US参考图生命周期及关联作品；离线副本升级；维护清扫/超时/跨重启整体资格。不得以本检查点认定五议题开发完成；未部署、未操作生产数据或真实媒体。


### 2026-10-19 固定提交门禁首轮、验证依赖恢复与词典对齐

固定提交`86a96f2ad0d1cda7f878dc54889cfa221d049341`独立checkout完整Architecture未通过，不计PASS：旧验证checkout经App managed archive退出时，工具连带移除了其依赖junction指向的共享node_modules内容，导致新checkout大量`better-sqlite3/sharp`缺失；此次不具有完整运行资格。共享Service/Web依赖已分别在原物理目录按原lockfile `npm ci`恢复（161/205包），源码和业务数据未改。新验证checkout先验证并仅移除两个junction本身，再按本提交lockfile安装物理独立Service/Web依赖（177/205包）；不再与主开发目录共享依赖。

该轮另准确暴露：当前Catalog已有增长而一组Builder/Registry测试仍断言旧121/140/210/51基线，旧transaction shard豁免仍指向不存在的051文件；US Adult已支持但旧“不支持profile”负例仍使用western_adult；Arca Intent内`sourceBinding`名称触碰既有禁止旧概念词典。处理为更新当前活跃基线的具体断言及精确056定位，保留未知profile负例并新增US Field可准入正例；将Arca Domain-local读取绑定明确命名`sourceMaterialBinding`及相应scope digest键，不增加词典豁免或放宽Owner规则。

新P2通过，counts不变，aggregate `8680996346407ca5d0314faa9cca70e7b23a87466117d36f9257a77128b1e4e1`。语义Gate2524文件/42原有精确豁免/0 Finding。词典改名后的Owner/匹配/Source/负例/P2等30项通过；Builder组合原113项中112通过，唯一剩余旧137/135 route实际数量断言已修正且其所属fixture在上述30项中通过。完整Architecture须依赖恢复及修复后的新固定提交重跑，不从这次失败推断实际业务旅程是否通过。


## 2026-10-19 Arca真实Host异常退出、冲突与人物作品读取

基线`1dd51987bd67849b22d5fc06e895d649ea685650`后的本地增量，未发布。

- 实际子进程运行正式Host、真实固定CPU模型和隔离合成视频。第一次在Inventory/Control/Result写入后、事务COMMIT前直接exit 73，第二次在真实COMMIT返回后、Event/Effect完成前exit 74。重开原数据后，均由原Case收口；每Case只有一次Inventory Commit，Entry/Deck/Canonical身份不变，NFO/海报/命名及旧别名退役一致。日志`.codex/us-adult-validation/arca-actual-host-crash.txt`：1 PASS，67.5秒。
- 同一Host旅程继续制造外来目标目录。保留外来字节和当前库存/演员、明确显示原Case失败，禁止重复刷新；日志`arca-actual-host-crash-conflict.txt`：1 PASS，72.1秒。初次测试揭示预检异常被转成通用recovery conflict；现只在首次只读预检证明尚未写入时返回typed failure，部分发布/恢复仍保留uncertain Effect合同。专用文件负例8 PASS，不能把预检失败证明用于continue_forward。
- 旧海报读取围栏：Actor Case active且旧Inventory仍current时，仅提供精确retained旧poster；head更新后读新poster。错误Basis拒绝。2 PASS（`arca-retained-poster.txt`，后续相关合批再次通过）。
- 人物相关作品由Arca按当前出演关系、People确认的库类型及有界稳定cursor读取，排除历史关系/已退出Entry/其他库；Facade挂载在既有ArcaCollectionFacade路由，未移动Owner。后端2 PASS；Web新增分页/去重、跨库响应拒绝、迟到响应和精确Entry深链，相关14 PASS。完整Web 226 PASS为新增冲突文案测试前检查点，之后Actor弹窗5 PASS；构建PASS（548.69 kB既有单chunk告警）。
- 正式HTTP作品读取随真实Owner迟发失败回滚旅程复验1 PASS（47.3秒）；当前包边界650文件/2290依赖/47包、语义2524文件/42精确豁免均PASS，P2保持130/108/224/56/144及原aggregate；固定`1dd51987b`完整Architecture Gate仍在独立物理依赖checkout执行，尚无整体PASS，不覆盖本增量。
- Arca终态失败后的用户恢复入口、Source Handle过期等剩余恢复资格、People深度系统维护/参考图片生命周期、离线副本升级、维护剩余项及平台/UI负责人资格仍开放；当前版本不称完成。
- 子进程夹具两次修正均记录在忽略日志：一次错误地在父Host关闭后调用旧UoW只读，另一次unref计时器导致子进程在目标边界前正常退出；修正后才计PASS。未操作NAS、生产或真实媒体。


## 2026-10-19 US参考图库、释放与原子替换

基线`4a862c3d9`后继续同一Phase，未发布。

- GET人物详情发布当前owned active图片ID，头像端口按精确asset/current Reference revision只读图片；拒绝其他人物/已释放图片。头像及两处US演员选择使用版本URL，避免同URL留旧图。
- 既有DELETE Reference路由接入People-owned image operation、独立正式commit Work/Event、Result/marker与Outbox。release不运行import/embedding；last Reference保留约束在准入及事务内分别复验。只释放图片/内部Face，不删除Person。
- replace_image是既有People Reference Image Commit内的原子variant：先准备新图/单脸特征，事务内释放精确旧Asset/Face、写新Asset/Face及一个新Reference revision/checkpoint。迟发失败回滚后旧图/Face/head仍完整；无脸替换不改变旧图。仍无People Merge/Person停用/删除及影片自动刷新。
- API/内部operation closed union、Decision/Result、table enum、DDL及P2来源已传播；130/108/224/56/144不变，P2 aggregate=`4c0f2063ab5142c0ae691e80c1f625b588518bb50e0a822bfba2c6f6fad8ab80`。现有路由162，construction real139/worker4046/unavailable50317，不将未实现入口算完成。
- People图片import/特征/commit显式绑定内部图片mount的读写/sqlite/CPU资源；上传Ingress先由Root建立受控平台Root，资源投影只读现有Root。初次接线发现Root创建时机及resource schema仍为CPU，均已按精确Owner/合同修正，无旁路或silent fallback。当前真实模型Host加Image Port 4 PASS（9.2秒）；本批Owner/合同27 PASS（含事务迟发失败回滚），先前完整相关Builder63 PASS。
- 图库弹窗接补图/替换/释放、版本围栏及失联同命令重试；UI专项12 PASS，最新全Web231 PASS/43文件，build PASS（553.54kB既有单chunk warning）。实际浏览器及跨层具体版本负责人资格仍开放。
- 本批Service首次637 PASS/29既有skip/2失败：本地tools的ssh2缺失导致Reset/部署dry-run合同未加载；按原tools lockfile npm ci恢复后两个文件13 PASS。没有执行SSH/NAS动作；完整Service重跑677 total/648 PASS/29既有skip/0 fail，137.3秒（reference-service-all-restored.txt）；该项是本地检查点，最终固定版本资格仍需统一记录。
- 释放Reference不立即回收二进制，已冻结Libra/Arca快照仍可读取原Artifact。完整Reference审计/到期GC、系统People Evidence正式维护、离线副本升级、维护/平台最终资格继续；未宣布US-PEOPLE或本版完成。


## 2026-10-19 系统People正式维护、Actor失败收口与跨Profile回归

同一Phase、602505d35后的本地增量；没有生产、NAS、真实媒体或Desktop操作。

- 普通/JAV不再在reconciler内直接open/accept Candidate：Arca发布完整有界media_cast/NFO Projection，People冻结Supporting Work与policy；observe→Candidate Commit→可靠身份Person Commit全部采用正式Planner/Event/typed Result/Owner事务及Outbox。弱来源仅形成内部Evidence/Candidate，US库不走系统注册；可靠ID冲突在事务内拒绝，不按同名合并。每次最多32个未完成People Work，global准入上限768低于正常1000，避免维护遗留挤满正常准入；deferred不伪报已创建Work。
- Arca精确读取同时校验Entry、Inventory、relation与Projection digest；150个历史版本不干扰当前来源。合法NULL Provider identities表示无强身份，非法非数组数据拒绝。JavDB仅在影片身份已核实且演员链接为精确同源/无凭据/无query/hash的actors ID时发布javdb_actor身份；同名不同ID保留，外链等仍为弱Evidence。
- 真实JAV正式Host：窗口外不注册；维护内正式Evidence Work自动建立可靠演员并更新Arca当前关系，弱演员仍无Person且用户确认队列为空；原收藏/入藏Receipt/纠正Receipt/视频不变。连同不兼容实际分段的正常终结，2 PASS/80.4秒（jav-weak-terminal-qualified.txt）。后者修复RunOutcome/瑕疵预览错误地要求Plan拒绝具有Event Capability的缺口，保留完整closed planning-rejection成员。
- Series真实Host：跨季同标题保护、NFO修复、NFO+poster修复均在实际维护窗口补齐People后回到正常供给，3 PASS/346.6秒（series-maintenance-people-host.txt）。JAV来源语义恢复纳入实际全局网络route，重复配置revision不触发新Case；实际海报失败后来源改变的新Case恢复1 PASS/96.9秒，旧失败Effect/收藏保持（jav-final-three-host.txt，该日志其余两条是后续已修正fixture断言，不能算该三条全PASS）。
- Actor首次发布前的无写入失败现在持久保存精确技术Evidence。Arca以新Canonical边界Aftercare Actor Publication Failure Closure重验原Inventory及实际Work/Event/Attempt/Effect，只能原子终结为unresolved；拒绝uncertain、reconcile_required、写入已开始或证据变动，晚发Foundation拒绝回滚Owner写入。旧失败历史保持，用户从原单片入口显式再次提交新Intent；部分发布仍原Case恢复。无成功Result/marker或无关Finding结案。
- 真实固定CPU Host再次在Inventory提交前/后exit 73/74恢复原Case，随后目标外来文件冲突保持原收藏/外来字节；失败Case收口后移走fixture冲突文件，再通过显式新Intent完成演员/NFO/海报/命名，旧失败Work/Case不变。1 PASS/79.3秒（arca-failed-publication-retry-host-final.txt）。Owner失败闭合/旧Actor持久化/Aftercare安全组合24 PASS（arca-failure-proof-transactions-final.txt）。
- 历史204→210副本Operator改读其原始精确target archive，不将当前224表误当旧target；两个archive从1f36d9ed8提取并校验原DDL摘要，旧保留、别名/覆盖拒绝和回退负例通过，未操作实际升级副本。Gate旧计数、US admission及系统People旧确认断言分别按具体合同更新；不删除负例或扩大旧架构权限。
- 当前P2：130 Capability/108 Result/224表/57事务/144 Domain inputs/31 shared/240引用/0 unresolved，aggregate 64d18131ff41a7774b4de095156e81c45f6297996561b8be9e775061e9da3856。新增事务仅失败Case收口，不新增顶层Business Object。包边界657文件/2317依赖/47包通过；semantic精确transaction shard豁免随057文件更名，最终2532文件/42原有精确豁免/0 Finding通过。
- Service本批677 total/648 PASS/29既有skip/0 fail，146.7秒（arca-system-people-service-final.txt）；Web232 PASS/43文件及build PASS（既有553.74 kB chunk warning）。此前People Owner/Source/parser/Arca记录等定向组合49 PASS、parser/Projection12 PASS，容量/事务Builder/negative合同29 PASS；日志有交叠，不相加为独立总数。
- canonical crash/Owner组合247项中246 PASS，唯一Windows打包因本checkout node_modules为共享junction而cp尝试创建symlink被Windows拒绝，尚无本轮Windows分发PASS。应在已准备的独立物理依赖checkout对固定提交复验，不改共享依赖或放宽打包隔离测试。固定1dd51987b完整Gate已结束：3061 total/3006 PASS/33 FAIL/22 skip，旧检查点不覆盖4a/602或本批；已按Owner根因修复及局部复验，仍须新固定版本完整Gate。
- 开放项：失败Actor Case已完成stage材料的到期精确清扫；其他恢复/Source过期资格；普通/JAV可靠归并/补全与Reference审计GC；离线升级副本、维护截止/重启剩余资格、最终固定版本全量Gate/Windows/Linux及浏览器/具体版本UI负责人审核。不得据这些局部证据宣布五议题完成或发布。
