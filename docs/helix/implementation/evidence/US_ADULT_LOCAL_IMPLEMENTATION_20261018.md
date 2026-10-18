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
