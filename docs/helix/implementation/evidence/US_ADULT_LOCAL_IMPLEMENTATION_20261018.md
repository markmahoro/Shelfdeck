# US Adult 本地实施证据（开发中）

## 2026-10-20 最终候选准备：ThePornDB唯一来源

### 安全停机完成及暂停批次保护补充

完整副本演练：旧210表源在隔离目录精确Reset10项、FK0/integrity ok，224表复制及209表逐列摘要和条件式Schema rollback验证通过。首个旧Host因复制后的Aftercare挂载身份不同报ROOT_CONFLICT，不计通过；随后数据独立可写、原数据目录仅用于保留原Workspace只读挂载身份，生产DB路径以空只读文件遮挡，Root仅打开`/case/current-host/data`。原镜像完整Host health200、normalSupplyAllowed=true、多轮正常Owner/Intake reconciliation、errors0并安全关闭，通过。两次环境失败及原始日志均保留；未改生产挂载/数据/媒体。

d485候选完整Host构造/health200、正常供给及局部Owner循环达成，但有4次`PERCEPTION_ACQUISITION_ORIGIN_REQUIRED`，**整体验证不通过**。旧验证脚本曾只按health和至少一轮循环输出qualification_pass，该行是判定器缺陷，已修正为unexpected runtime errors拒绝；不能引用该PASS。原生产31条provider Acquisition全部缺少新executionOrigin，但其Scope digest有效、ID均唯一匹配旧周期协调器的source/config/previous-terminal请求身份；含1个active。Perception Owner新增严格旧Scope/摘要/时间/唯一请求身份只读证明，未确认来源仍拒绝，禁止猜manual或改历史JSON/hash/cursor。显式用户Resume Intent优先于缺失旧来源，保留原Scope与Work；既有Scope显式无效origin仍拒绝。实际31/31证据证明与24项定向回归通过，包含当前/旧周期/来源未确证三类游标跨重启及用户继续。需要新精确镜像和完整副本复验，不把d485构造成功当交付。

实际副本初检eligible=false，精确剩余4 Work/3 Attempt/3 Event：两个Field和一个Perception处于waiting_for_resource，另一个Field已完成上一Attempt、Work为ready等待下一页。无executing或未决Effect，属于安全停机应保留的持久责任。证明补充仅允许无执行的资源等待，并检查活动Work的已关闭前页；外部等待仍拒绝。复用Foundation正式SupportingWorkDefinition校验、摘要/大小及Owner/process/work metadata一致性，不接受仅改hash的跨域定义。真实副本12个后台图（7重复检测、4观察图、1豆瓣图）在只读私有技术fixture中全部通过当前证明；未执行Domain投影、不是正式Host资格。最新局部29项通过；c726固定Gate已不含此增量，不能当成最终PASS，最终固定代码须重跑。

打包补齐后的e37镜像Linux四文件119/119 PASS，2638文件摘要全部与源码一致，审核UI JS/CSS保持。标准完整构建此前继承上游FFmpeg的OCI revision，不能当作ShelfDeck提交；已在标准构建参数统一显式写入当前Git revision，最终镜像须复核标签和字节身份。隔离Reset补/tmp后实际Exit0，10 active Run归零、611 Entry保持；首轮disk I/O只属于只读测试容器缺少SQLite临时写入空间，不能算旧Reset业务失败或生产变更。新副本继续Schema/Host资格，尚未生产部署。

正式stop操作于08:29:24.650 UTC受理，09:12:47.808 UTC完成（本地17:12:47），mode/desiredMode均stopped、operation completed、normalSupplyAllowed=false，Events/Recoveries/Owner/Admin四个在途通道及deferred recovery均0，faulted=false。只读/proc确认FFmpeg退出；受理后新增Event Attempt及Work Attempt均0。10个未完成Run、11个暂停后台Work与611条收藏保持，证明当前执行收敛，不表示排队Work全部完成。随后Compose stop正常退出，新完整冷备`/vol1/1000/docker/shelfdeck/backups/us-adult-20261020T091400Z`的64文件共3,842,413,191 bytes逐文件摘要及mode/uid/gid一致，compose/secret摘要一致，根700、receipt600。081900备份只保留先前现场。生产尚未Reset、迁移或换版。

检查发现64d1缺少生产最新Catalog的历史证明，Copy也会阻挡安全暂停的非Formation批次。新增公开合同档案的95 manifests/1220 schemas逐项与Git `5367179429d6e6785c1adf8c8da363bc21def9bd`一致，原policy重建Catalog为`b3a5256d59ef03005d5d3d0b20f264f1c77fb7aae8e4787870bd8de644d18bae`，档案canonical digest为`02c61b170e4209eb07f6abb1172eece6e598ed06ab9ad9fa227a5fea32803a6c`。档案无生产数据、凭据或executor；终态沿既有完整Verifier证明，不按digest直接接受。

非终态证明仅限Procurement field_observation、Perception acquisition_page、Arca offdeck_duplicate_detection三个精确Owner/process/work kind及六个Capability。当前manifest（除源码定位）、完整Schema closure、retry/timeout/compensation必须与冻结旧版完全相同；技术图、绑定及Result/证据摘要沿既有Bounded Verifier复查，拒绝executing Event/Attempt、未决Effect和其他Capability。Root与只读Copy共用证明，原Catalog、Work、Attempt、Result及Domain cursor不变，不注册旧executor、不清理后台批次。Libra/Formation无兼容例外，仍限用户授权的精确10项Reset。

三个本地测试文件94/94 PASS，另25项Startup回归及四个静态Gate通过，实际空数据完整Host构造/关闭通过。固定c726完整Gate运行中。首个c726镜像Linux119项中的脚本文件未装入导致111通过/1文件失败，未计PASS；补canonical Dockerfile COPY后须重建，Root/Helix源码及UI保持。构建器回归的旧四层断言未包含现有第五个script destination，保留完整destination一致断言并更正五组边界。首轮隔离Reset遇disk I/O error，生产未操作；隔离库仍10 active Run/611 Entry，正补SQLite可写临时目录验证，不能先记成功。生产副本升级/回退、完整Host资格、新镜像及标准部署仍待通过。私有记录：`production-safe-stop-completed.json`、`production-safe-stop.jsonl`、`production-safe-cold-prepare.txt`、`canonical-nas-preflight.txt`、`source-catalog-audit.json`、`paused-batch-local-tests.txt`、`paused-batch-empty-host.txt`、`paused-batch-linux-tests.txt`及`isolated-reset*.txt`。

### 补充清理授权、完整Gate结束与安全停机纠正

用户先允许原10项整理进度清理后升级；复核时原1部电影已完成、系统补入1部新电影，当前收藏611而非先前607。已明确提出范围变化，用户补充允许包含新1项，只清理停机冻结时当前10项，全部已完成收藏保持。没有据旧清单删除已完成条目，也没有把补充授权扩大到其他业务范围。

候选64d1固定checkout完整Architecture Gate于07:44:04 UTC完成，387个测试文件、3137 total/3111 PASS/26 skip/0fail，dependency/semantic/manifests/contracts均PASS。26项skip为未提供显式材料/opt-in等适用条件，不计覆盖；本轮没有调用真实身份识别。前后4183个tracked输入SHA256摘要同为`2c0245319b51bdac20298cc56c650407c1784fb73580715d2518e57003fc9f94`。全量日志及未选中用例留ignored原始记录，不只保存筛选摘要。

生产原容器在约08:19 UTC走标准Compose stop，Service收到SIGTERM，60秒执行checkpoint预算耗尽，Exit1、P4_SHUTDOWN_CHECKPOINT_TIMEOUT，仍有1个Event在途并回收自身FFmpeg进程。此结果只证明容器退出，不是概览安全停机成功。随后在`/vol1/1000/docker/shelfdeck/backups/us-adult-20261020T081900Z`保存完整data及compose/secret；65文件共3,861,661,861 bytes逐文件内容、mode/uid/gid与来源一致，配置及Secret摘要一致，备份根700。没有Reset/迁移/部署、没有改原片或已上架媒体；这个冷备保留初次停服现场，但不代替后续新鲜备份。

用户质疑为何不先使用概览安全停机，并进一步明确“先安全停机，成功后开始部署升级”，还要求检查任务收敛。核对代码后承认顺序问题：正式stop先持久化desiredMode=stopped并quiesce，无60秒强制结束预算；Compose stop走SIGTERM stop，只有有限checkpoint预算，两者不能混称。为满足新前置要求，08:24:43 UTC按既有Compose恢复原精确镜像，未换版或改运行数据文件；旧Host约4分41秒启动后，08:29:24 UTC正式公开`POST /v1/admin/runtime/actions/stop`受理固定幂等命令。当前desiredMode=stopped、normalSupplyAllowed=false、mode=stopping；inFlightEvents从1降0、inFlightRecoveries仍1，无运行故障。该恢复属于libra.media.transcode@1，FFmpeg正在运行；两次只读/proc采样CPU ticks及同一输出文件从625,999,872增至820,248,576 bytes、mtime推进，不能误判为卡死或已停止。旧进度表存在前次执行采样，不能用旧采样当新恢复的准确ETA。

本地53项现有收敛回归全部PASS：先关闭供给、Event和Owner closure等待、Admin command等待、进程内未获许可等待队列释放、持久等待保留、失败不假报stopped、停止意图跨重建保持。生产仍必须实际等恢复动作及Owner收尾清零，再复查FFmpeg和稳定快照；active Run或待续批次Work留存不等于还有执行在途。目前尚无SAFE_STOP_COMPLETED，不执行Reset/迁移/标准deploy apply。后续须基于本次安全停止后的最新完整冷备重新做精确副本和回退，不沿用初次备份资格。

私有原始记录为`production-authorized-reset-preflight.txt`、`production-authorized-runtime.txt`、`production-cold-prepare.txt`、`production-shutdown-check.txt`、`production-safe-stop-restore.txt`、`production-safe-stop-request.txt/jsonl`、`production-convergence-before*.txt`、`production-convergence-progress.txt`、`production-safe-stop-encoder-liveness*.json`及`safe-stop-convergence-regression.txt`；初次只读诊断SQL误用了不存在的Subject current_run_id，未写库，修正为直接读libra_runs后留失败与成功两份证据。

### 最终候选、适用审核及实际升级阻挡

冻结候选commit `64d1b067024b98e51b9fa75942e465e8958b0a9c`，包含当前生产`5367179429`完整祖先链。标准`build-image.js`构建`helix-beta-20261020-64d1b06702`，771.3MiB tar的SHA256为`1edf357198efd8c3c7384e786481ab6198b4ebe8648165d55e3ecaf1ddc8799a`；标准upload完成NAS逐字节校验，标准deploy dry run通过，没有apply或生产停服。第一次构建手填短hash末位错误被构建器拒绝，正确精确10位后完成；第一次dry run因当前worktree无本地Secret文件被拒绝，随后只在子进程环境使用主checkout既有Secret，未生成/轮换Secret或复制到文档/命令参数。完整镜像2634个Runtime/脚本/资源/模型/资产文件与源码逐项SHA256一致，无源码覆盖挂载；Web JS为`index-DP-CFWjn.js`、SHA256 `3a0fe1d8b451359882e51a3c8fe9d9e20e979b4a46fe2f4017b3688299abe3d8`，CSS保持原接受字节。

本轮完整Service677 total/648 PASS/29既有skip/0fail；最终Linux镜像15个受影响文件252个唯一用例，首轮251 PASS/1fail，失败为P2 CLI用例预期repositoryRoot/media-service目录而测试镜像只提供/app的夹具布局，不是Runtime失败。补齐只读CLI脚本仍因根布局不完整失败；随后用一次性tmpfs内目录映射补齐完整repository布局，原P2三项均PASS，不修改源码、镜像或Oracle，也不把初轮计作PASS。其余251项不因夹具修正重复执行，不重复累加数量。完整Architecture Gate已在独立checkout固定该commit运行，4183个tracked输入预先摘要为`2c0245319b51bdac20298cc56c650407c1784fb73580715d2518e57003fc9f94`；目前尚未结束，后续必须核对退出码/全部夹具及前后摘要，不能继承旧完整Gate。

UI负责人按同一冻结commit接受80份源码、9项资产，宽窄12/12 PASS；受控API验证固定地址、仅Key字段、失败重试/读取恢复、成功清空凭据、保留草稿新标签定位、唯一来源空/失败结果及明确选图；三份非真人合成海报验证1000×1500、暖白底、四格cover裁切及宽文字边界。报告为`E:/my_project/helix-git-consolidation-20261008/us-adult-ui-review-64d1b0670-20261020/owner-review.json`，SHA256 `30ac9d0714f25ba95eb61bf813fd79abdca1f4652937d88e0f15c96cdf987fa6`；没有调用真实身份识别或外部Provider。

实际生产数据库一致快照在独立应用子目录`production-preflight-20261020-064000`生成，原生产目录只读挂载，资源限定1CPU/768MiB/network none；快照库约3.8GB。当前离线operator返回eligible=false：30,941 Person全部可靠归库，无缺失/冲突；阻挡为libra_runs10、fx_supporting_works10、fx_work_attempts10、fx_workflow_events22、fx_event_attempts1、fx_effect_journal1个未完成责任。未改升级guard。仅捕获数据库与加密管理员文件，不是完整冷备/完整Host或回退证明；生产health检查成功、image/StartedAt/RestartCount保持。

当前公开Formation为3 Movie/7 Series；其中一个电影仍转码，其余等待资源。按确切10个Subject运行标准`formation-reset-nas.js --subject-ids ...`只读预览，ready=true/blockers为空：10 Runs、10 Workspaces、653个历史/活动Supporting Works（活动10）、248 Controlled Materials、259 Artifacts，Packages/Custody/On-deck Run均0；607条已Commit收藏属于保护集合。此预览不授权删除。Playbook §3.4明确当前迭代不能给未Commit整理自行增加通用兼容，且生产Reset要单独授权；已向用户发出“保留进度待完成/允许清理这10项后重整”选择，等待回答。未执行Reset/停止生产/数据库升级；未改变原片或既有成品，也未把测试API Key投入生产。即使取得清理授权，实际执行前仍须重新核对现场、精确副本演练及完整备份，不能沿用可能已完成的旧清单。

私有日志在ignored目录：`release-service.txt`、`release-web*.txt`、`tpdb-only-web-final.txt`、`release-linux.txt`及两次P2夹具重跑日志、`release-image-build*.txt`、`release-upload.txt`、`release-image-audit.json`/files、`release-deploy-dry-run*.txt`、`production-schema-inspection.txt`、`production-reset-preview*.json/txt`和`release-gate-64d1b06702*`。未将生产导出、真实标签或凭据纳入提交。

用户确认US Adult不需要Wikimedia，只保留ThePornDB，并要求改完直接生产升级。已同步SSOT姓名辅助搜图合同：固定`https://api.theporndb.net/graphql`，用户只填写API Key，继续全站网络策略和用户明确选图。移除Commons请求及来源展示，来源失败/未配置/空结果均明确返回唯一来源状态，不隐藏切源。内部沿用既有`stashbox`协议标识及Platform proof/CAS/Secret保存；新配置拒绝其他地址，旧非TPDB配置及已签名的Wikimedia选择在取图前拒绝。手工上传及已存参考图保持，不执行批量人物修改。

新选图合同`PeopleSelectedImageHandle`与构建器/Registry同步移除Wikimedia。Source-map仅传播SSOT文档摘要，检查原counts/categoryDigests/aggregateDigest一致；P2新总摘要`1b9df5e2fd2ffe41a64382f2159c8d8537b037fb47c15a30222086c173b5f2ba`，131/110/224/58/145及243 references保持。四项静态Gate通过。

Windows受影响Service两文件30 PASS，包含正式Host错误凭据、固定地址拒绝且零传输、proof保存/重启后搜索，以及唯一来源/无备用请求、签名旧来源拒绝、网络和配置变化、过期、篡改及超界资料。Web43文件242 PASS及build（保留既有chunk大小提示），随后新增唯一来源失败状态用例，受影响两文件14 PASS。P2与搜图合同九项PASS；新UI及最终候选资格继续验证，不继承旧UI审核。

生产只读预检记录当前镜像`helix-beta-20261018-5367179429`及image ID `fe8fe2f77c2d32bdc3fe59c14e616610fc48e304704baea9b92352261267fe60`，607条Shelf Entries、30,941个Person、10个活动Run。Schema为210表来源版本。使用现有隔离Runtime和当前离线operator精确源码，对生产只读挂载进行SQLite一致快照及升级资格检查；输出在隔离应用新子目录，未写生产数据库/凭据/媒体、未停止生产。此检查只有数据库和加密管理员文件，不能作为完整备份或完整Host资格。一次性TPDB测试凭据不复制进生产。全部私有原始记录留ignored `.codex/us-adult-validation/`，不提交凭据、人物/影片标签或导出生产数据。

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


### 925145631固定副本与打包延迟依赖补齐

独立物理依赖checkout已切到925145631：Service 677 total/648 PASS/29既有skip/0 fail（146.1秒，service-925145631.txt），Windows独立包启动1 PASS（56.7秒，windows-925145631.txt）。该Windows检查只证明原HTTP/基础二进制启动；后续人工审查发现新Arca Root analysis adapter为函数内延迟require，Windows/Docker显式打包清单均漏列，原启动不能证明Actor动作可用。已为两种分发加入精确文件，Windows包检查增加实际require及包内原生YuNet/SFace模型加载、空图推理；有显式良性参考图时还检查单脸128维特征，不使用外部NODE_PATH。Windows/Docker静态入口防漏1 PASS；新增包内原生检查待新固定提交复验。没有因启动PASS关闭完整平台资格，失败stage残留清扫仍开放。


## 2026-10-19 Actor失败stage回收、真实第三崩溃边界及Source期限

- c04641bab后的同Phase本地增量。无写入发布失败不直接结束Case：Arca冻结失败Evidence及实际stage Result，原Case准入独立discard Supporting Work，复用arca.us_adult.files.retire@1、material_commit及正式Planner/Event/Effect；仅精确stage manifest可被删除。成员、hash、物理身份及目录边界全量预检，逐项删除前再次验证；未知/变字节/链接不扩大清扫，也不碰原片、retained/final或外来冲突字节。
- 失败收口事务要求成功discard Work/Event/Attempt/typed Result、正确manifest/plan digest及闭合Effect；清扫未完成、reconcile_required、Evidence更改或晚发Foundation拒绝均禁止Owner结案。没有新Canonical事务或新Capability，闭合既有057事务合同。
- 实际正式Host：Inventory COMMIT前exit 73、COMMIT后但Event完成前exit 74；第三次外来目标冲突后，在真实删除第一项stage文件立即exit 75。重启原数据，沿原Case/Effect删除剩余精确stage，再unresolved；原库存/外来目标字节保持。用户显式新Intent完成刷新，旧失败Work/Case保持。源准备Result在其历史24小时源租约过期一天后仍以冻结Work结果消费，Result与digest不变。日志arca-discard-expired-source-host.txt：1 PASS、85.0秒。
- Source单独4 PASS（arca-source-lease-renewal.txt）：过期物理读取租约拒绝；Owner以同物理源及同冻结Work重新捕获当前授权。不能用历史Source结果取得新的过期媒体读取权。最新组合arca-discard-final-local.txt为20 PASS，含文件改变/未知stage拒绝、真实子进程部分删除恢复、Owner迟发回滚、只读当前Basis冲突及P2；此前31项组合与其重叠不累加。
- GET状态检测已知当前Basis/执行来源冲突并明确reasonCode，不改变Case、不捏造Work。前端显示活动冲突及实际discard阶段；Web233 PASS/43文件，build PASS（既有554.03 kB chunk warning），日志arca-discard-web-final.txt及arca-discard-web-build-final.txt。没有自动取消/重设冻结Case，其他未知错误仍明确失败。
- 当前P2：130 Capability/108 Result/224表/57事务/144 Domain inputs/31 shared/240引用/0 unresolved/162路由；aggregate a26df8c4641a9a08b5bb3dc18daa12009acddd9fff8037af4f9ca907be3e804a。固定c04641bab完整Architecture仍独立运行，其输入快照4140文件aggregate 7ca7843fac25b4656534d5cad5046b0197ee812d68982ae9d05bcbf767ad63f5，不能冒称覆盖本增量。
- 开放范围：普通/JAV深度可靠归并/补全、Reference审计与无引用GC、离线副本升级、维护剩余资格、Formation迟发选择正式Host、最终固定版本全量/平台/浏览器及具体版本UI负责人审核。无生产、NAS、真实媒体或Desktop操作，本版仍未交付。


## 2026-10-19 TMDB人物可靠编号与离线结构副本

- 正常/JAV系统维护继续只依可靠人物ID，不按姓名归并。NFO新观察统一使用tmdb_person；People将严格数字TMDB Person的两个既有命名空间作为同一Provider身份查询，按库隔离，并在正式及直接Owner提交内重验，拒绝并发重复建档。多个不同Person命中保持内部冲突，不任取一条。历史事实不改写；头像端口转为标准tmdb_person调用，历史NFO人物可显示头像，冲突ID不选肖像。Movie/Series NFO保留可靠历史编号并拒绝矛盾或重复编号。69项定向通过，人物页9项通过，日志people-tmdb-namespace.txt及people-namespace-web.txt。
- 版本化Operator helix-us-adult-schema-copy.js：冻结main 210表来源5e82c36bf1d63e1297cf468361be67c074df3226a64d2dfb755d472db0bbee41与224表目标33ef1d7c2f07669991a8401754f7671c92f4848db8a9c1869724bc5edf8e614c，来源/目标archive都验证DDL/manifest。逐表保留209个既有事实/执行表的全部旧列/行；仅Person/Provider identity新增library_kind，新14表为空。分类用可靠TMDB/JavDB编号、既有Arca Canonical Profile及历史Merge关联，不用姓名/默认库，不静默拆身份。未知/冲突归属或未结束Process/Work/Effect拒绝复制，源始终只读；禁止覆盖及软/硬链接别名，中断不发布目标。
- 历史普通/JAV确认项保留内部Candidate，不批量接受/删除。已被用户接受的旧弱Evidence经精确Candidate状态/原始payload digest/唯一Person origin恢复历史关联，不要求给旧不可变JSON添加libraryKind，当前Person提供隔离归属。旧名字、收藏Person关系、整数历史、Preference/Reference及执行记录全部按行集摘要保护。回退只做资格检查，新事实/旧字节变化或新分库赋值变化均拒绝，不执行替换。
- 隔离archive fixture：实际复制、完整性/FK、三库同名身份、旧待确认保留、已接受弱来源可读、Merge归属传播与冲突、未完成责任、改库/旧字节/新事实后禁止无损回退、别名/覆盖与写入中断均通过；最新21项合批包含8项Operator及13项People证据（us-upgrade-origins.txt）。没有读取/导出/升级生产数据，该证据不代表生产副本Host资格。Windows/Docker显式分发清单已补入工具及精确依赖，仍须最终独立包检查。
- 72963fb39的Service全量677项/648 PASS/29既有skip/0 fail（135.9秒，arca-discard-service-final.txt）；本文增量尚未全量Service。当前包边界658文件/2320依赖/47包通过，P2保持130/108/224/57/144及aggregate a26df8c4641a9a08b5bb3dc18daa12009acddd9fff8037af4f9ca907be3e804a。固定c04641bab完整Gate仍独立运行，不覆盖本增量。
- 剩余：系统People可靠归并正式运行、Reference引用审计/无引用GC、维护完整资格、Formation迟发选择实际Host、最终固定提交全量及Windows/Linux/浏览器/具体版本UI审核。全部五议题仍未交付；无生产操作。


## 2026-10-19 系统人物可靠归并、作品连续性与固定版本完整Gate

- 普通/JAV新增维护内有界人物分页及可靠Merge Supporting Work。仅Provider人物编号确证且其他编号无矛盾、历史Preference一致的同库active人物可准入；不同名也可确证，同名本身不作依据，US禁止。Work冻结人物Fact/Preference及policy，既有merge_evidence.resolve→candidate.commit→person.commit形成真实typed Result、Owner原子Merge/Result/marker及内部Outbox/Inbox ACK。提交再次重验身份/Preference；稳定保留较早身份，源原名成为有来源别名；原记录/引用不删除。共享现有32个People活动Work上限及维护准入，不用reconciler直接改人物。
- 原图/引用和Merge合同继续由People持有；当前作品查询由People发布同库有界历史身份Scope，Arca据当前Inventory出演关系分页、去重读取。既有Arca关系不必为展示立即重写，US仍严格单Actor，HTTP调用方不能覆盖Scope。相关Owner/规则/作品18项通过（system-merge-owner-collection.txt），既有People/窗口33项检查点通过；最新Package660文件/2329依赖/47包及semantic2535文件/42精确豁免通过。
- 正式Host在窗口外不归并，窗口内真实三步Work及两类消息ACK后仅归并可靠同库对；同名不同编号、跨库、Preference冲突保持。跨Host重开不重复归并、历史来源连续可读及相关作品身份Scope验证1 PASS/49.9秒（people-system-merge-host-final.txt）。首次20秒等待小于正式30秒reconciler cadence而无Work，不是业务成功；随后测试清理句柄顺序错误已修正，只有最终完整通过计PASS。Arca真实固定CPU指定刷新/正式HTTP相关作品复验1 PASS/63.9秒（merge-arca-related-host.txt），收藏身份不变。
- 独立物理依赖固定c04641bab完整Architecture完成：3076 total/3062 PASS/1 FAIL/13 skip，3516.1秒（architecture-c04641bab.txt）。输入前后4140文件aggregate均7ca7843fac25b4656534d5cad5046b0197ee812d68982ae9d05bcbf767ad63f5，没有开发中改动。Package/semantic/manifests/P2均PASS；唯一失败为P3生成manifest未随table contract摘要重新物化，DDL digest仍33ef1d7c…且无物理结构变化。已重新物化追溯manifest并同步未发布Operator目标archive trace，P3/P2/construction24项及Operator8项通过（merge-frozen-contracts.txt、merge-upgrade-archive.txt），不把局部修复后的版本称为完整Gate PASS。
- 同一固定c046完整Gate内，独立Windows分发包使用自带依赖启动、拒绝覆盖及本机原生ONNX/YuNet/SFace加载/空图推理和显式良性图128维特征检查通过1项/29.7秒；相关模型、初次整理、原Run人工确认、推荐建档/来源A、Actor自动/指定/真实提交崩溃及图库Host均通过。13项skip不代表适用Linux/真实Provider/平台或最终UI资格通过。完整Gate不覆盖后续729/be4及当前归并增量。
- 当前仍有Reference显式引用审计/无引用GC及维护剩余资格，最终固定版本Service/Web/Architecture、适用Linux与实际浏览器/具体版本UI负责人审核。未部署、未操作生产或真实媒体，五议题尚未交付。

本增量Service全量677项/648 PASS/29既有skip/0 fail，141.2秒（system-merge-service.txt）；规则排序与最终Scope专项5项再次通过。未将独立固定c046旧版本Gate结果推广到新提交。


## 2026-10-19 实际浏览器首轮及Actor卡片修复

固定47a615f70本地隔离正式Host，使用良性参考图及合成3秒视频形成一部入藏US影片、两位已建档Actor；没有生产或真实媒体。实际浏览器检查三库、普通/JAV零确认、US建档来源反馈、图库最后一图禁用释放，以及单片指定Actor真实Case。第一次实际UI刷新完成后，墙面标题和当前Actor更新；截图保留在本地忽略目录.codex/us-adult-ui。

首轮发现Actor选择radio继承通用.dialog input的100%宽度，挤压姓名为竖排；已以精确radio样式限制尺寸，保留选中/焦点状态，供Formation、推荐认领及Arca三处共享使用。另发现完成后弹窗标题仍沿旧item快照；改为精确读取当前Entry并校验ID/库存版本，关闭后迟到响应不重开，墙面过滤后也能更新标题。US资料来源internal改为演员库。完整Web235 PASS/43文件及build通过（ui-current-actor-web-final.txt、ui-current-actor-build-final.txt），新增墙面排除影片时仍显示正确新标题的回归；更新后实际浏览器和具体版本负责人审核待继续。

开发中原Host只为启动时的精确静态资产注册路由，重建Web后旧Host不服务新hash资产导致浏览器空白；已定位为隔离验证过程的版本切换方式，需正常重开Host加载新构建，不放宽静态路由或以旧hash冒充新文件。旧正式Case已完成，测试Host正在安全关闭，后续以新固定UI版本重新建立隔离数据。


## 2026-10-19 具体版本UI审核及修正

UI负责人对5e923a411冻结77份源码、9项资产进行1920×1080及390×844受控API走查：28项中18 PASS/10 FAIL，结论CHANGES_REQUESTED，非真实模型Host结论。六项明确修正：参考图换版加载状态、已受理Arca命令的状态读取恢复、内部错误码外露、StashBox缺配置入口、宽文字海报裁切、常驻说明/重复认领进度/异常样式。外部审核owner-review.json SHA256及具体截图由负责人保留，未改源码或生产。

已逐项修改：图片就绪按实际版本URL隔离，已选快照在新版出现后失效，未知提交保持原命令；Arca保存已受理Case并提供只读查询重试，未知状态禁止新提交；建档失败使用可操作文案；缺StashBox时从新标签打开精确设置锚点，当前草稿保留；去除普通常驻说明，来源A及文件变更后果仍在提交意图处说明，认领进度只显示一次；状态/错误使用既有语义样式。

共享海报Renderer升级为us-adult-presentation@2，Pango按实际字形宽度在固定姓名/标题区域换行，超出高度以省略号收尾，不改冻结原始文件名；四张2×2大截图和肖像区域保持。生成机器合同及P2 aggregate更新为87b9d2e9ca8e3480122e4b249e1868b2c39c4d69530ad2a16668ae1ebae6fdd6，仍130/108/224/57/144。Web最终241 PASS/43文件，build PASS（555.22kB已有分块告警）；Renderer/持久化helper13项、P2/P3/Actor Intent与Owner及离线副本36项PASS，日志ui-review-*.txt。首次构建的nullable类型约束和首次P2旧固定摘要断言失败均已修正并最终复验；没有把失败计PASS。当前修改仍需具体新提交负责人复验、最终全量及平台资格，Reference审计GC等剩余项继续。


### UI负责人第二轮与残余修正

2b03d5200冻结审核：宽窄屏32 PASS/4 FAIL；US-UI-1/2/3/5通过，配置地址可达但SPA异步渲染未滚动定位StashBox，来源A片名仍在进度与卡片重复，StashBox配置卡还残留常驻说明。已在设置与来源卡加载完成后处理精确hash定位；去除该说明；来源卡存在时，进度区只保留操作状态，片名显示一次，若卡已离开推荐集合才由进度区保留来源。新增异步定位和来源A不重复断言。Web242 PASS/43文件，相关源码build PASS；具体新提交负责人复验继续。没有修改生产或宣布UI/Phase交付。


## 2026-10-19 Reference 到期回收与最终资格候选

- 新增正式 `people.reference_usage.audit@1` Supporting Work，分批审计 People 当前图片/特征、Libra 冻结分析/选择、Arca 冻结刷新及 retained Inventory Cast。完整双轮、至少60秒静默、同boot/root/source epoch；分页连续性、固定schema、规范JSON及摘要不完整时拒绝删除。Reference Asset ID经People自身历史映射保护对应图片/embedding，不跨Owner查询数据库。
- 仅登记且30天到期的Reference image/embedding有资格，相关技术操作90天且无未决责任；活跃、未知、未登记残留保留。每批及物理删除前复验维护准入；截止/手动停机禁止新增删除。持久intent、真实Effect、单文件预像与独立缺失证明接入 Registry claim/Receipt/marker原子提交，支持删除后中断、窗口外仅恢复结算和已删除Artifact经真实重新发布验证后重新激活。
- Foundation按需 opaque read fence 保护跨Owner只读Projection到People claim的间隔，比较SQLite data/schema version及精确64-bit changes，在BEGIN及Owner事务内显式复验；UOW仍只含People及绑定People的Platform读参与者。没有跨People/Libra/Arca原子事务或新全局业务revision。
- 实际GC Host两条（真实无脸失败导入到期清扫；unlink后真实SQLite marker trigger导致晚发回滚、窗口外原Effect恢复）此前2 PASS/115.2秒，本候选新增摘要/缺页加固后继续原生复验。初次两条架构边界失败已按P3单Owner约束修正，不放宽UOW验证器。
- 后期人工改Actor先提交原Choice Intent，再由Libra Owner在唤醒Planner前按既有准入事务创建合法replacement。真实CPU Host同Subject、一replacement、旧产品事实保持、Actor/NFO/命名及唯一Entry、旧命令重放1 PASS/45.5秒；提交后续跑失败重试负例通过，不重复Intent或revision。没有把replacement并入Choice原子事务。
- 最终P2：131 Capability /110 Result families /224 tables /58 transactions /145 Domain inputs /31 shared /243 refs /0 unresolved，aggregate `ec14f57ab8512de541597a8a482688f6399648f6b16f9273685cba0b65e19b23`。物理DDL仍33ef1d7c2f07669991a8401754f7671c92f4848db8a9c1869724bc5edf8e614c，源210升级归档保持。冻结引用及Choice重试8项、Arca引用分页5项通过，计数有重叠。
- UI负责人对 `d8cff243b2af7b0bf440ee72c8904f443c802da0` 的受影响宽窄屏8/8通过，US-UI-4/6关闭；其余四项按75个未变源码及Renderer继承2b03d5200通过，六项全部关闭。不是三轮重叠计数相加；后端GC不改变UI或Renderer。9项dist资产与78份源码冻结，JS SHA256 `1d5d97cb4466612443cb8424954786c4c73633ac44a94cf3d7abe81deda5e519`。
- 此前 Service648 PASS/29既有skip、Web242 PASS/43文件及build通过；c046完整Gate唯一trace漂移已修复，但不称最终全绿。接下来固定新提交独立依赖完整Architecture、Service、Windows分发及本机Docker Linux实际原生/Host验证；保留未测/跳过解释。没有生产/NAS/真实媒体操作，没有部署或正式版本发布。


### 固定13e5db4cd回归及Linux构建根因

Service677 total/648 PASS/29既有skip/0 fail（149.1秒）；Web43文件/242 PASS（18.7秒）。GC最终加固后真实Host2 PASS/105.0秒；UOW/GC/当前P2专项17 PASS。完整Architecture仍在独立13e5db4cd checkout运行，前后tracked输入摘要独立保存，尚无完整结论。

本机linux/amd64首次构建发现NodeSource apt源连接拒绝，setup脚本仍返回成功，后续apt选择Ubuntu Node18。该构建取消，不记镜像或平台PASS。改为与Web同一个官方Node20阶段复制/usr/local运行时，并在镜像层显式断言major20；继续使用原FFmpeg/驱动base，没有降级或改用旧Face HTTP。该Docker-only修复不改13e5的Service/合同/UI输入，最终镜像必须独立重建及实际执行。


### 维护截止直接时钟围栏

审计补强allows(maintenance)：除持久准入状态外，物理批次准入直接检查当前时钟在[start,end−5min)内，避免协调器下一tick前的短间隙继续新增批次。无需写状态或改变安全收尾；safety及人工stop优先保持。初次新fixture从08:54首次进入正确触发15分钟超时skip，已改为03:00进入后直接推进时钟，再验证无需tick即截止。窗口/正式Host/豆瓣续跑组合10 PASS（maintenance-clock-cutoff-final.txt）；完整13e5固定Gate继续，其后只增加本围栏及Docker运行时修正，需独立记录适用增量与最终镜像验证，不能称13e5覆盖这两项新diff。


### Linux模型安装阶段分发审计

审查实际多阶段镜像发现：安装脚本在service-dependencies阶段require固定us-adult-face-model-pack.json，但该阶段此前只COPY资源license和脚本，src合同只在后续runtime阶段复制。已在安装前精确COPY manifest，安装的版本/尺寸/SHA256校验及许可不变。这是Docker-only分发修正；等待最终重建，不以先前Windows包通过冒充Linux模型分发通过。


### Linux全新安装的旧registry解析修正

镜像npm ci实测因registry.npmmirror.com/typedarray的ECONNRESET失败（linux-build-7515a087a8.txt），官方npm及模型上游实际HEAD200。Service/Web锁文件分别189/244处resolved旧镜像URL统一改为registry.npmjs.org；结构比较证明只变resolved host，全部版本/依赖树/integrity不变，不换包、不忽略校验或静默回退。旧失败构建不计PASS；最终重新安装/镜像及Web资产摘要仍需复验。固定13e5完整Gate仍独立运行，不将该后续分发diff记为其原始覆盖。


### Linux原生启动及隔离环境/字体发现修正

8079ae7bb4本机linux/amd64镜像构建通过，实际Node20.20.2、224表/162路由、Sharp/FFmpeg、包内YuNet/SFace空图及单脸128维推理通过，Python不可执行。镜像2,631文件逐字节等于本提交源/资源；JS/CSS SHA256与d8 UI接受完全相同。镜像ID及原始输出保存在本地linux-image/source-audit/native-smoke日志。

第一轮read-only容器/tmp只给3 GiB，低于既有Workspace需求1.2×输入+5 GiB，正确等待空间而无Workspace。该轮已终止，不记旅程PASS；改为12 GiB tmpfs上限（实际内存独立限额，材料仍隔离），不修改准入规则。窗口时钟围栏后的Windows实际GC2 PASS/132.3秒，缺失文件窗口外只结算保持。

后续Linux发现fonts文件虽已安装，但--no-install-recommends未带Fontconfig配置，/etc/fonts/fonts.conf不存在，Sharp报告Cannot load default config。已在runtime阶段显式安装fontconfig并生成缓存，指定正式配置路径；不改Renderer或应用逻辑。必须以最终新镜像验证文字与旅程，不以有fonts文件或旧无配置渲染成功冒充正确字形发现。


### Linux真实旅程与额外Series恢复竞态

8079ae7bb4以12 GiB隔离tmpfs、实际内存/CPU限额及network none运行16文件：68 PASS/0 FAIL/0 skip、337.2秒。覆盖实际US三库/参考图、20帧、暂存原位确认、最高匹配、推荐A-only ACK重启、Arca单片刷新与Inventory提交前/后及stage discard真实进程退出、后期Actor replacement、GC双轮/窗口外结算、可靠People归并、离线210→224副本、维护配置/截止/豆瓣续跑。该镜像字体配置发现后已另行补强，最终镜像字体及受影响海报旅程需重验。

额外跨Profile组合7 PASS/1 FAIL，98个非选中测试为name过滤，不计覆盖。唯一失败是opt-in Series外部Transcode进程恢复：Arca已接管Package Product Control、Accepted消息尚未消费的间隙，Libra freshness试图suspend而被原有P9_RUN_LIFECYCLE_PACKAGE_CONTROL围栏拒绝。实际child在预定exit73前因该RuntimeError结束1，不是预期恢复PASS。

Libra自身read投影现扩展为当前Run已发布Package Product/Offload的Material Control，只在发现Arca custody时返回技术handoff_resolution_pending，等待既有durable Accepted消息；不把Control当Accepted事实、不完成Run、不读取Arca Store、不放宽transition fence。已有直接非complete越权仍拒绝，新增promoted product不在原输入Scope的确定性负例证明零Run/head/Result/marker写入、原输入Basis比较保持；Owner/Series continuity30 PASS。首次新fixture未列Package的7个列名导致SQL错误，修正后通过，未改表或放宽SQL规则。实际额外Series恢复需最终复验。


## 最终Linux资格：edbb470256

- 本机Docker Desktop linux/amd64，镜像`shelfdeck-us-adult-local:edbb470256`，immutable image ID `sha256:ac79715cecf3cb54f0c92aa95b650d70d7210eed956f7cc175f7ea159426d40d`，808,637,613 bytes；只构建本机标签，无registry push/NAS/生产挂载。
- 镜像自身启动/原生smoke PASS：Node20.20.2、224表、162路由，独立HTTP Admin及Sharp/FFmpeg/FFprobe，包内固定YuNet/SFace实际空图和单脸128维，Python不可执行。Fontconfig实际发现Noto Sans CJK，纯Renderer@2中英混排及四张2×2合成帧已实际生成并目视检查，无缺字框或重叠；样例仅本地非生产材料。
- 2,631份打包Source/Script/Admin资产/模型资源与本提交逐字节一致；JS SHA256 `1d5d97cb4466612443cb8424954786c4c73633ac44a94cf3d7abe81deda5e519`、CSS `eefaa8a482d7e83261b84cf0d9e209ea3fd027e6f588c8f7bf21a49b6b027dcd`，精确继承d8 UI审核，不仅按文件名推断。
- network none、只读root、12 GiB tmpfs容量上限及独立6 GiB/4 CPU资源限额：18文件98 PASS/0 fail/0 skip，335.5秒。包含本次Libra custody间隙修正30项、全部此前68项US/People/维护/GC/离线副本及真实进程退出旅程。日志`linux-native-journeys-edbb470256.txt`。
- 另组隔离跨Profile8个选中场景全部PASS/0 fail、385.3秒；98个name filter跳过不计资格。涵盖JAV实际HEVC入藏/系统演员维护、Movie真实合成媒体独立decode三反例、Series N:M Aftercare、外部Transcode、Off-deck的实际跨进程恢复；外部Transcode修正后PASS/130.0秒，原Run/Entry/Receipt连续，无重复下载。日志`linux-profile-edbb470256.txt`。这些不是生产真实媒体E2E或NAS平台资格。
- 两组最终容器均已退出并自动删除；当前无本轮运行容器。最终完整固定13e5 Architecture与Windows最新Source分发继续，不能将当前Linux结论提前等同整个Phase完成。


## 最终Windows与Service增量资格：edbb470256

- 独立managed checkout `us-adult-windows-final`，精确Code SHA `edbb4702563e4857757fd9178627130e8ab570c8`。Service/Web/tools依赖从前一独立验证目录作物理副本；全树无symbolic link，非主工作区junction、无外部NODE_PATH。版本/integrity与锁文件保持，registry host变更不换包。
- 第一轮40 PASS/1 FAIL，唯一Windows包在首次模型下载fetch failed，非编译或推理失败，保留`windows-final-edbb470256.txt`；向独立构建提供两份逐项大小/SHA256匹配固定manifest的离线模型输入后，重新完整Windows分发+维护/Owner组合41 PASS/0 fail/0 skip、35.6秒（windows-final-pinned-edbb470256.txt）。实际包含自身Node、Native与模型，启动224表/162路由、Sharp/FFmpeg/FFprobe及空图/单脸128维通过，require cache无包外依赖，重复/源码内/junction目标均拒绝覆盖。
- 网络随后HEAD200，在全新空目录直接执行相同installer再次下载两模型并校验PASS（windows-model-fresh-download.txt）；首次故障视为瞬时连接失败，不删除原失败记录，也不把离线分发冒充该首次下载成功。两份临时下载文件校验后精确删除及空目录移除，没有递归清扫用户目录。
- 最新Service677 total/648 PASS/29既有skip/0 fail、139.3秒（service-final-edbb470256.txt）；Web最终242 PASS/43文件为13e5固定Source，之后无web/src/Renderer变更，官方registry干净Linux重建及Windows build均产出相同审核JS/CSS字节。
- 最终Package boundary、semantic、manifests及P2静态门禁全部PASS（final-edbb-static-gates.json）；P2仍131/110/224/58/145、31 shared、243 refs、0 unresolved，aggregate ec14f57ab8512de541597a8a482688f6399648f6b16f9273685cba0b65e19b23。
- Windows临时managed checkout已申请归档；归档前全树无link且Git干净，主Service/Web的E盘依赖junction目标与存在性前后保持。两份过渡本机测试镜像已删除，只保留最终edbb本机镜像；无本轮测试容器常驻。固定13e5完整Architecture仍在运行，保持独立来源边界。


## 固定13e5完整Gate结果与修正

固定13e5完整Architecture结束：386文件、3118 tests /3099 PASS /6 FAIL /13既有skip，3557.2秒。Package boundary/semantic/manifests/P2均PASS，4,178个tracked文件前后digest相同：3cf2ce9121ba790bc6eb9f404c755be6e868cb59babd508e7a122bcbd5f3c411。52条JAV隔离旅程及其余实际Host均通过；该轮整体为FAIL，不计全绿。

六项：clean public export精确清单缺Libra/Arca只读Reference Audit Source factory；正式server dependency图缺GC Root adapter；P3 verifier模块白名单缺reference-audit-source导致两个fixture前置拒绝；Result schema图仍121而应123、Capability输出families仍106而应108。已逐项补精确成员及新Evidence/Receipt结构断言，无宽泛豁免、未放宽跨Owner/未知module/legacy拒绝。相关49项47 PASS/2既有环境skip。

为保留完整验收并减少重复串行耗时，Gate执行器将唯一长JAV文件的52个独立literal测试按原声明顺序分成四组独立Node进程；其他文件仍独立执行，总并发始终不超过4。声明解析、重复/动态名称、pattern字符转义、选中数及全部文件覆盖均fail closed；每个case恰执行一次，额外name-filter跳过单独计数，不冒充覆盖。失败子进程不被吞掉，也不阻止其他已计划项输出结果。新执行器/原报告负例8 PASS，实际两文件CLI21 PASS。下一轮标准Architecture命令重新执行全部当前文件及全部52条JAV，没有继承旧fixture PASS跳过执行。该执行器是开发验证工具，不改业务Runtime或Docker/Windows分发内容。


### aec928e1d执行器结果撤销及覆盖修正

aec928e1d工具汇总返回ok=true、3102 tests/3089 PASS/13 skip/0 fail，输入4,181文件前后相同（28758f838e2b85b57cad6e1fec4356aadfd26a118e79b122810232e067afe09d），耗时1790.5秒。但反向逐名称比较发现JAV实际上74条：52个直接声明、22个for循环生成。新静态分组器只识别了前52条，selected数自检只验证自身不完整清单；Node25对非选中case不报告过滤skip，filtered=0也不能证明完整。缺少15个special/class source、2个collection operation及5个phase recovery共22条，故这轮整体资格撤销，不记最终完整Gate PASS。前文及聊天中“52条JAV”的表述仅指直接声明，完整范围应为74。

已移除新分组执行器和其4项单元测试，恢复edbb时原始Node --test/全文件/concurrency4执行路径；保留六项精确合同/模块清单修正。没有用旧PASS补齐未执行case，也不继续修改框架来减少本次验收。重新固定提交执行全部原始文件/实际动态声明；预期相比13e5只新增维护时钟及custody间隙两项，具体数量以实际报告及名称覆盖审计为准。底层业务、最终Linux镜像及Windows分发字节均未因此改变。

## 2026-10-19 恢复开发与实际N95隔离资格准备

用户明确恢复开发；固定`72388341e`独立物理依赖checkout原始全文件Architecture重跑中。此前`461d8805d`一轮已按暂停指令终止，未记PASS。

实际303NAS只读确认Intel N95四核、7,734 MiB内存、约3.6 GiB available、已有约2.5 GiB swap使用；生产ShelfDeck原镜像`sha256:fe8fe2f77c2d32bdc3fe59c14e616610fc48e304704baea9b92352261267fe60`，StartedAt `2026-10-18T04:31:06.595469109Z`、RestartCount0。测试应用根`/vol1/1000/docker/shelfdeck-us-adult-qualification`与生产目录分离，核验父目录/挂载/无symlink后新建；不挂载生产数据及原媒体目录。参考原影片仅从用户指定目录复制四份，共946,647,416 bytes；每份完整SHA256与原件一致，源size/mtime/ctime/inode前后保持。清单及原路径只存ignored证据，不以文件名推断演员真值。

测试镜像复用已逐字节审计的edbb运行时，ID `sha256:ac79715cecf3cb54f0c92aa95b650d70d7210eed956f7cc175f7ea159426d40d`；本机docker save后通过标准upload-nas-image.js上传隔离目录，tar SHA256 `43612de4080f2649821abbd6d2072f952907116fbccb64cbe23c3f0393bfe119`。没有调用生产deploy/apply。首轮资源限制1 CPU、1536 MiB且禁止容器额外swap、256 PIDs，端口仅NAS loopback18124，独立数据库/Workspace/Shelf、rootfs只读、复制输入只读、无特权或设备透传。

执行前预算：先做无推理基线及模型冷/热加载，再逐片20点抽帧/检出和有界并发2；单独记录模型加载、抽帧、每帧推理、峰值RSS、容器cgroup CPU/内存/IO及宿主swap/iowait。测试API p95目标500 ms、单次超时上限5秒；生产健康连续3次失败/超过3秒、可用内存连续3次低于768 MiB、测试OOM或生产重启则停止测试供给并安全关闭，仅该测试容器可被停止。生产p95相对同轮空载基线变化与最大值明确报告，p95预算为max(500 ms, 2×基线p95)，保留既有波动，不能以单次快响应证明达标。早期空载12点已有一次4.89秒，另一次只读观察1.75秒；准备期间文件复制/镜像导入可能影响I/O，因此正式推理前另采无准备负载基线，不将准备阶段观测算作稳定空载结论。

真实媒体只报告技术检出数量、时延及业务状态；不执行真实演员身份比对或声称身份准确性。正式链路可用空演员库→暂存→显式技术标签选择验证，技术标签不代表真实出演者。跨片演员身份与错误匹配率保留给用户独立人工验收；不把循环自匹配、文件名、已有NFO或最高分当作真值，不以小样本检出率替代识别可靠性PASS。测试脚本与原始日志保存在ignored目录，Evidence只记录技术统计与摘要，不提交媒体/人脸图像。

### N95技术结果、性能缺口及再次暂停

导出包核验澄清：Desktop的`ac79715c…`是OCI index，NAS实际image config为`sha256:9e2522da9b306eadc0768679543175fba7c04a1bca92ee7d3489b4019389e007`。已对导出config完整SHA256、全部74个diff layers、平台及配置进行精确比较；Docker补出的Entrypoint/OnBuild=null和User空串按明确默认值校验，未跳过其他差异。首次严格ID比较正确中止，核验后才运行。首轮cap_drop ALL配root无法读取750/660测试目录/脚本，EACCES退出；改为NAS自身1000:1001运行，未改宿主权限。后续HOME/XDG_CACHE_HOME指向可写/tmp解决测试非root字体cache目录问题，不更改生产。

单CPU下四片各20点完成，抽帧+推理分别14.389/14.509/15.205/34.581秒，检出6/12/7/18张脸；模型冷加载640 ms，四片合计78.691秒。双任务热测试仍限制单CPU，两个样本27.607/41.696秒、总41.697秒，模型加载0 ms。以上仅检出/耗时，无人物识别准确率结论。纯合成40个特征对100/1000/5000个参考身份冷/热耗时192/87、645/414、2394/2906 ms，cache不超过1024；不是真实身份比较或完整DB库规模资格。

实际HEVC样本02（640×360/10-bit/AAC）与03（512×384/8-bit/MP3）在空库进入暂存，随后显式选任意技术标签，沿原两Run完成NFO/1000×1500 Poster/命名及唯一上架；更新标签后只有用户指定单片刷新，另一片Inventory不变，Entry/Deck/Canonical身份连续、命令重放通过。1核、1.5核及带profile探针三次隔离运行均通过，后两次为响应预算疑点复验，非新增独立覆盖数。未比较真实人物身份、不展示或分析原影片画面。原四片SHA256及size/mtime/ctime/inode已在测试后核对保持，原目录未挂入测试容器。

维护实际重开同两条收藏，受控周六时钟进入窗口、08:55收尾、用户stop及重启stop优先通过。首轮3条facet评估时尚有一个health Work运行，不把其日志`health-batch-completed`字样误算完整批次PASS。下一周显式resume后，该精确Work ID成功，原两个health Work全部succeeded、评估6条，随后截止/stop/重启通过；两轮cgroup峰值约260/270 MiB、oom/oom_kill均0。下一周首试harness误用不存在的actions/start返回404，已按正式actions/resume修正；失败JSON及容器日志保留。维护使用本fixture自有secret root通过现有session-token-service.issueAuthenticated签发有界cookie，不算登录交换覆盖，也未读/改生产凭据。

性能资格未关闭：正式无推理基线30次有2次5秒超时，不能把生产既有尾延迟归因于新版本。低频串行推理17点测试API p95约349 ms；双任务8点约649 ms、完整E2E22点约588 ms。1.5核复验低频17点p95约1.276秒，不能因此宣称增加CPU已解决。独立5 Hz、最多4在途的探针在完整E2E期间实际482次请求、0错误、14次受在途上限限制未发起；p50 5.20 ms、p95 510.74 ms、p99 1545.45 ms、max2579.85 ms，严格未达500 ms预算；probe在Host正式供给前同步启动、结束前排空，不把预期关闭后的连接失败纳入稳态结果。1.5核非profile完整E2E cgroup峰值650,383,360 bytes，oom/oom_kill均0；不能把新空库1.5GiB测试上限当作现有约2.25GiB生产Service的合适内存限额。

CPU profile发现onnxruntime-node/dist/backend.js的run在setImmediate内同步调用native，Promise不代表脱离HTTP主线程；主线程native约5.87秒、GC约5.55秒，另有Canonical JSON及Arca authority重复检查开销，未将inclusive时间相加作CPU总量。已起步将现有native模型实现移至local-face-model-native.js、local-face-model-worker.js，原local-face-model.js作为线程客户端；未提交、未测试或构建，生命周期/满队列close/异常恢复等仍须审查，没有性能修复PASS。模型/阈值/预处理、Owner和持久合同尚无改变。

用户此时再次明确暂停。固定72388341e原始完整Gate进程已停止，不计PASS；NAS测试容器exited0、OOM=false且无运行的本轮测试容器，生产image fe8fe2f7…、StartedAt 2026-10-18T04:31:06.595469109Z及RestartCount0保持。原始日志、CPU profile、脚本与测试数据均保留于本机ignored目录及NAS精确测试根，未部署或改生产数据。本版保持未完成，恢复先审查/验证线程调整，再做精确Windows/Linux/N95及最终完整Gate；真实演员身份准确性仍保留人工验收。

## 2026-10-20 worker thread恢复开发检查点

用户明确恢复开发。固定模型/阈值/预处理及Owner合同保持；图片解码、缩放、对齐与ONNX会话由单一service-local技术线程持有，主线程只传输自有Buffer副本和接收结果，不传递Domain/Work/Store权限。32个请求/32 MiB排队图片双重上限，close独立控制槽，FIFO收尾；启动/崩溃/协议故障拒绝所有等待者且不自动回退主线程。校验Pack拆为纯模块，Main不加载native推理会话；许可和SHA256保持原合同。仅Integrations external allowlist新增精确node:worker_threads，Domain依赖规则不变。

实际线程fixture八项通过：同步忙算不阻塞Main timer、原Buffer保留、满队列close、字节上限释放、结构化失败后下一请求、崩溃/错误关联响应拒绝所有请求、不静默重建、推理期间Owner执行权限撤销后拒绝发布。预备真实模型/帧/图片/Renderer四文件14项全通过，线程输出与原native实现逐字段完全相同；此轮通过显式NODE_PATH读取独立验证目录的固定ORT，不代表独立分发资格，最终物理依赖checkout/Windows/Linux/N95必须另验。首次Package Gate精确缺少node:worker_threads许可已补，未放宽跨Owner边界；其余semantic/manifests/P2通过，完整新Gate待固定提交。

## 2026-10-20 worker thread与N95固定候选资格

实现固定提交：
- a4a673c206a1e4e02fc7441118a53e90863fc76d：模型Pack验证与原生预处理/ORT会话拆分到Service-local Worker；32请求/32MiB有界队列，16MiB单图，owned ArrayBuffer转移，FIFO和独立close控制槽，线程失败/协议错误拒绝所有等待调用、不重启或主线程回退。Owner/Work/租约/取消/Effect及最终持久事实仍在原组件。
- 0c82ee862a380bc1f590f94266ba656987ec3eff：profile证明剩余冷编译热点后，仅将Foundation Ajv inlineRefs设false，复用共享名义Schema的编译函数；不删校验、不强转/填默认值。9个Arca US输入冷编译对照本机148.76→68.30ms、生成入口代码338033→22928字符（不等于总代码尺寸或NAS加速承诺）。递归/共享引用、闭合字段、format、完整错误路径、调用方bytes及恢复后校验10项通过；精确builtin断言只增加Integration的node:worker_threads，其他边界保持。

实际N95前置read-only preflight通过。仍使用/vol1/1000/docker/shelfdeck-us-adult-qualification独立project、loopback18124、UID1000:1001、只读root/drop ALL/no-new-privileges、1536MiB且无额外container swap；生产数据库和原媒体未挂载。两片完整E2E使用相同1.5核、5Hz/最多4 in-flight/5秒timeout的独立探针及Main profile。结果：

| 固定输入 | 请求数 | 错误 | p50 ms | p95 ms | p99 ms | max ms | 既定p95≤500ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 改造前edbb | 482 | 0 | 5.20 | 510.74 | 1545.45 | 2579.85 | FAIL |
| a4a673c20仅线程 | 445 | 0 | 2.84 | 555.13 | 1587.93 | 2738.87 | FAIL |
| 0c82ee862线程+共享编译 | 434 | 0 | 2.58 | 410.05 | 836.48 | 2619.84 | PASS |

新候选探针因4个请求同时未完成跳过12个200ms发起槽，已计数，不能称每个计划槽均发出。两片技术标签（任意Qualification Actor A/B，不代表真实出演者）完整暂存、原Run用户选择、NFO/1000×1500海报/命名、唯一On-deck、单片指定刷新与幂等全部通过，Entry/Deck/Canonical不变、仅目标库存+1；无RuntimeError。峰值930701312bytes（887.59MiB），memory.events全0，正常退出。小样本仍有约2.62s长尾；共机旧生产health本来有数秒波动，不声明解决其既有性能，也不将测试内存限额推广到已有约2GiB以上生产数据库进程。

在同一1核/1.5GiB限制下四份既有只读副本各抽20点：sample01/02/03/04总耗时9621/14844/17563/23000ms，face counts 6/12/7/18与旧版一致；冷load576ms，串行wall65096ms、Main loop p95 80.02ms/max177.47ms。02+04双任务wall37212ms、warm load0、loop p95 81.85ms/max112.85ms；吞吐没有证明应提高正式并发，保留cpu_heavy=1。四份源文件完整SHA256、大小、mtime/ctime和inode与上轮完全相同，复制输入累计946647416bytes；未标注真实身份、不报告准确率、不按文件名猜真值。

维护在精确候选上以受控窗口时钟测试：安全进入、两Entry健康批次、08:55停止新增、用户stop跨Host重启保留；下一周显式resume后同一个pending running健康Work变succeeded（两个Work最终均成功），不重建责任。两轮errors为空，最终容器exit0/OOM=false/RestartCount0。生产image fe8fe2f7…、StartedAt 2026-10-18T04:31:06.595469109Z、RestartCount0保持；fnOS和无关服务200。镜像archive会同时携带latest标签，导入后即时恢复NAS原latest指向原生产image，测试始终使用自身精确tag；没有重建或停止生产容器。

标准build-image.js/upload-nas-image.js构建上传，无deploy-nas --apply。测试标签us-adult-worker-20261020-0c82ee862c是任意Docker标签，源码以上述完整commit为准（标签尾c不作为commit）；tar SHA256 a1dafee04805ea636142fc2c483b835096737791616da2d5d1c01fd267ecca2e，Desktop index sha256:4bdb714c2393acf6436055d645ad1c729cfe652294add7c4ac88439d539e0112，NAS实际config sha256:34c1d31b358be90cf516b759a9035ea6b912f5f33d31d7d52dc2791dba325ed1；archive config bytes及74层rootfs/Config/platform精确核对一致。2634个runtime代码、合同、脚本、资源/模型及dist文件全量比Source，0差异；UI JS/CSS与d8接受字节相同。无push、生产部署/数据升级。

最终Linux network-none/只读root/4CPU/6GiB/12GiB tmpfs（容量上限）47文件208 PASS/0fail/0skip，325.25s；额外readonly挂载测试和测试专用Schema工具及SSOT，不覆盖产品src/native依赖。首轮仅挂test漏测试用工具，13个MODULE_NOT_FOUND失败保留为测试环境FAIL，修正挂载后完整重跑，不往产品包添加开发工具。Service新候选677 total/648 PASS/29既有skip/0fail，231.39s；Web43文件242 PASS/0fail，源码未变。完整Gate及额外跨Profile/Windows最终资格继续，真实出演身份准确性未评估，尚不关闭Phase。

原始日志均在ignored .codex/us-adult-validation/worker-*，NAS各轮独立子目录保留；最后输入/输出摘要及Gate/JAV动态覆盖核验待补。

独立Windows精确候选再验：物理依赖checkout、NODE_PATH清空、固定模型离线输入，实际package-win.js打包、自带node.exe/Native/Worker/包内YuNet/SFace、Host 224表/162路由、FFmpeg/FFprobe和单脸128维均通过；拒绝覆盖已有/源码内/junction输出，1 PASS/0fail/0skip、29.59s。Main require cache无包外依赖，Worker通过实际模型调用证明包内动态入口可用。日志worker-final-windows-package.txt。最终Service完整677 total/648 PASS/29既有skip/0fail已复验。

共机安全观察没有触发SAFETY_STOP；E2E监控期间NAS最低MemAvailable约3.28GiB，测试后30次生产health有1次5s超时、p95约2.105s（之前空载基线已有2次超时），不声称旧生产延迟已修复或共机开销为零。全部本轮NAS容器最终停止，root owner/mode保持root:root/755；不自动清理保留的测试数据或旧镜像。

额外跨Profile精确候选：同一Linux镜像的5文件组合106条测试中5 PASS/0fail、98个name-filter未选中与3个Movie显式opt-in跳过；补齐HELIX_UAT137_REAL_MEDIA=1后独立Movie文件3 PASS/0fail/26个name-filter未选中。合计8个不同选定场景均PASS，不把过滤/opt-in跳过记覆盖。包含JAV实际HEVC完整入藏及窗口内系统演员维护、Movie三类独立Product decode反例、Series Aftercare（48.24s）/external Transcode（125.97s）/Off-deck实际跨进程恢复，组合380.25s、Movie补验1.14s。Main CPU profile旧版有9个ORT backend frame，新候选为0，原生推理不再出现在Main profile；仍保留其他同步热点和长尾，不称所有CPU开销消失。日志worker-final-profile-tests.txt、worker-final-movie-tests.txt及对应command.json。

## 2026-10-20 最终原始完整Gate及收尾

固定0c82ee862a380bc1f590f94266ba656987ec3eff原始helix-architecture-verify.js（原spawnSync、原Node test并发，不分组/不筛选）完成exit0/ok=true。387文件、3129 total/3116 PASS/13既有skip/0fail，fixture3493823.1298ms；Gate从UTC18:19:34.041至19:18:01.656。4183 tracked输入前后aggregate均73c06dab33d3a59329af8f17519b7579b9c98ef0062c38317d63ae4d5f4e7a80；独立checkout干净。JAV测试定义清单仅用于核对、并非执行证据，实际全量输出逐名证明74/74 PASS（52 literal+22动态），无缺项。

包边界47包/672文件/2367依赖、semantic2560文件、manifests、P2全部PASS/零findings。P2保持131 Capability/110 Result families/224表/58事务/145 Domain inputs/31 shared/243 refs/0 unresolved，aggregate ec14f57ab8512de541597a8a482688f6399648f6b16f9273685cba0b65e19b23，162路由不变。原始输出architecture-0c82ee862.json/.fixture.txt、前后inputs JSON及worker-final-jav-inventory/coverage.json均保留。

13个Gate既有skip：1个未提供的完整历史快照；6个已被新实际旅程取代的里程碑旧skip；3个Movie实际媒体opt-in和3个Series跨进程opt-in。后6个已在同一Linux精确候选显式启用并通过，不能把Gate skip本身算通过；冻结历史快照资格仍未提供，不改旧skip或历史发布结论。额外8个选定跨Profile场景的未选中/首次opt-in缺失如上节明示。

收尾检查发现主Service node_modules仍是指向E盘另一工作区的junction且缺ORT，不能让合格代码依赖NODE_PATH临时绕行。已核实物理输入目录无任何symlink，复制独立依赖4978文件/542512457bytes；先在ignored staging准备，再只rename原junction对象到.codex/service-node-modules-shared-link，原E盘target及其依赖lock摘要前后不变，无删除/安装/修改外部目录。主Service现在是独立物理目录、ORT1.30.0；默认resources/face-models两份模型逐项size/SHA256匹配固定manifest，正式installer再验通过。NODE_PATH清空、使用本工作区默认模型的真实线程/模型/图片/帧/analysis五文件22 PASS/0fail/0skip，worker-local-own-dependencies-tests.txt；环境调整不改tracked runtime、合同或SSOT。Web/tools既有共享依赖未改。

良性参考图91814bytes，SHA256 7de7ed51a1594fff247f4cae2301eceacf5313d6011e37b4a4c8733f7bb72c07，本机与NAS一致；模型固定输入记录在worker-final-native-inputs.json，不提交图像或生物特征。最后NAS只读核验测试exited0/OOM=false、无运行qualification容器；生产image fe8fe2f7…、StartedAt 2026-10-18T04:31:06.595469109Z、RestartCount0及latest原指向保持，root:root/755。主本地验证及Docker测试进程均已退出；工作区最后提交只有验收文档变更，不要求重建等价runtime镜像。

Phase Exit反向检查：五议题实现/正式Owner/Effect/恢复、唯一计划、无跨域authority/新Business Object/旧Runtime可达/兼容双路径/后续Phase耦合均有证据；本轮线程和编译技术优化不移动事实。**适用工程资格PASS，整体Phase业务验收不关闭**：真实出演者身份准确率未评估，真实影片仅检出/技术标签链路；N95小样本预算PASS不外推大库生产容量，max2.62s长尾保留。生产发布、生产数据升级与真实媒体改动均未执行，不能称整版已发布或全部业务验收完成。


## 2026-10-20 人工验收准备与安全停止

同一固定0c82ee862镜像在既有隔离根下新建manual-uat-v1；仅挂载新验收数据、四份冻结输入副本和验收启动脚本，不挂载生产、原片或历史测试凭据。初始人物0、Libra Run 0、接收席位0。四份副本完整SHA256校验后才发布到测试来源；setup-complete记录已下载并验证样本数4、席位0、operator_review_pending。真实身份由用户根据独立参考资料确认，不将文件名或技术标签当真值。

首次初始化HTTP400来自验收夹具的allowedExtensions未按既有sorted-set合同排序；原失败保留，诊断记录确认material-fields接口拒绝。修改夹具为.mkv/.mp4后，以原幂等命令恢复，未删除/重置数据或变更产品代码。期间一次恢复探针未进入初始化步骤，已停止该短生命容器；随后完成setup，Host报告ready。该过程不计产品修复或完整UAT通过。

NAS生产health三次连续5秒超时，既有保护监控自动停止唯一测试容器，Exit0、OOMfalse；测试最后CPU 0.17%、内存160.2MiB。未继续放宽监控或自动重启测试。停止后UTC04:17:38起三次生产health均200，耗时14.369483、1.107050、0.251698秒；不能据此判定慢响应根因。生产image仍fe8fe2f77c2d32bdc3fe59c14e616610fc48e304704baea9b92352261267fe60、StartedAt仍2026-10-18T04:31:06.595469109Z、RestartCount0。未修改生产实例或业务数据。

本机127.0.0.2:18125到NAS loopback18124的SSH转发已关闭；入口、登录及会话验证被停止打断（fetch failed），不可宣称可用入口。测试数据和mode600凭据保留；本机私有登录文件移除继承ACL，仅当前用户可读。私有清单包括建档、开启席位、人工匹配判断、海报/命名、单片指定及自动刷新。暂不让用户操作，待NAS响应稳定后继续入口资格及人工验收。未展示或判断实际人像，身份准确性仍未评估。

原始记录均为ignored：manual-uat-preflight.txt、manual-uat-prepare.txt、manual-uat-start.txt、manual-uat-monitor-active.txt、manual-uat-post-stop.txt、manual-uat-setup-complete.json（均在.codex/us-adult-validation）。夹具、Compose、受限凭据与清单亦仅在ignored目录；不提交密钥、图片或媒体。后续只需恢复此隔离环境并完成入口检查，无需重新跑已合格工程套件；生产发布仍无授权。


## 2026-10-20 NAS health超时诊断、启停对照与验收入口

用户要求先确认超时与测试环境的关系，再准备人工入口。本轮仅生产只读观测及临时诊断采样，未改变生产代码、配置、数据库或运行意图；生产image/StartedAt/RestartCount仍为上节原值。两次临时Inspector采样均已关闭，最终独立端口检查ECONNREFUSED。生产正常工作持续，含已有FFmpeg子进程；不存在锁步工作量控制，以下不是生产修复或SLO资格。

### 停测基线与真实热点

测试已停止时，生产第一次6次health全部200，最大3.843124秒；随后12次独立基线最大0.828081秒。该时点生产Docker CPU126.98%、缓存计入后容器约2.234GiB，Node RSS约0.66GiB；NAS可用内存约3.6GiB、无OOM。30.01秒生产PID1 counters：rchar逻辑读取约414.09MiB/s、read_bytes实际读取约0.624MiB/s、write_bytes约0.275MiB/s、read syscall约20260/s；不能将逻辑量误写为物理磁盘带宽。数据库约3.75GB。短时本地iostat未见盘饱和，NAS仍有约20%–25%iowait和较高I/O PSI，另存在CIFS挂载，不能仅据整机iowait认定本地盘故障或USB饱和。

两次仅诊断profile不混入无Profiler启停样本：
- 第一轮约13.36秒采样，event-loop max912ms；同步UOW/Repository约4.8s inclusive，概览约1.7s，其中Libra Formation约1.57s，Arca健康输入约1.30s。
- 第二轮约24.46秒采样，event-loop max2074ms；domain reconcile约18.40s、同步UOW约14.82s、Libra Run reconcile约8.26s、Perception候选读取约4.71s、People NFO reconcile约2.91s inclusive，canonical serialization/digest亦占明显成本。父子inclusive重叠，不得相加。主要栈为既有同步SQL/当前事实投影、候选扫描及完整摘要计算，而非US人脸推理。health handler本身读取现有运行快照；重活持续占用同一主事件循环会延后HTTP。

### 已初始化测试的启停对照

已初始化manual-uat-v1恢复后不再复制/重复校验四片；只保持演员0、Run 0、席位0，不进行模型或整理运行。容器稳定约127–128MiB，多数CPU0.16%–1%，一次28.51%短峰；重启累计Docker BlockIO约249MB读/3.89MB写，前次首次初始化计数为约5.89GB读（均为Docker报告值，不解释为唯一设备的物理量）。本次没有重做首次冷初始化，不能由此量化它当时的额外影响。

| 时段 | 样本 | 全200 | 最大响应 |
| --- | --- | --- | --- |
| 测试停止，第一独立基线 | 12 | 是 | 0.828081s |
| 测试运行但不整理 | 8 | 是 | 4.528290s |
| 再次停止测试 | 12 | 是 | 6.113250s（另有4.357574s） |

因此已证明生产自身在没有测试时也会超过原5秒探针预算；测试不是超时的必要条件。采样确认后台同步查询/计算占用主线程。首次测试初始化确有同机CPU/I/O负载，可能放大已有竞争；工作量持续变化且没有重做冷启动，不能声称完全零影响，也不能从一组启停均值证明因果改善。此现象关联既有UAT-318生产响应性能问题，本轮不引入生产热修复或改动已合格候选。

### 已恢复的人工入口

最终UTC04:27:28（北京时间12:27:28）隔离容器running/healthy/OOMfalse，1.5CPU、1.5GiB；health约1.69ms。仍为固定0c82ee862镜像，独立manual-uat-v1、四份测试副本；生产与原片不挂载。NAS端仅loopback18124，本机SSH转发仅127.0.0.2:18125，入口 /people。主运行与Web代码未变。

入口资格：public health200、未认证admin401、独立凭据换session204、HttpOnly/SameSite Cookie、来源1、席位0、US人物0，页面200；JS555524字节、CSS85890字节均200。未用生产凭据、没有将密钥写入URL或浏览器存储；私有登录文件仍仅当前Windows用户可读，清单在ignored .codex。已请求在Codex面板打开，工具返回queued，不冒充浏览器人工验收或显示完成。

保护监控保留原条件：三次生产health失败或超过3秒（单请求5秒预算）、三次MemAvailable低于768MiB、生产StartedAt变化均停止唯一测试容器；新增监控正常到期、退出或收到结束信号也停止精确scope测试容器，避免留下无保护测试负载。未放宽健康阈值，没有自动重试启动。监控运行中，人工识别尚未开始；用户先建演员库，再自行把测试来源席位0→1。技术性能通过不替代真实身份判断；Phase业务验收继续开放。

ignored记录：nas-health-diagnose-baseline.txt、nas-production-counters.jsonl、nas-production-diagnostic-profile.json、nas-production-diagnostic-profile-long.json、nas-production-profile-summary.json、nas-health-off-baseline-long.txt、nas-health-on-idle.txt、nas-health-off-after.txt、nas-storage-diagnose.txt、nas-uat-causal-monitor.txt、manual-uat-ready-monitor.txt。私有图片/身份/密钥不进入仓库。入口检查由私有verify脚本完成且最终复验PASS；本轮无产品代码改动，不重复整套工程资格。


## 2026-10-20 用户追加的查询优化增量

用户在确认既有查询优化及生产profile机会后要求实施。本轮限同一Phase、本地Service：先处理整季空间重复计算及Perception重复候选扫描，不改生产、不更换正在供用户人工验收的NAS固定镜像。未实施新的概览查询方案或跨周期跳过完整Resolution重算，也未调整维护窗口分类、调度频率、匹配规则或候选上限。

### 实现与正确性边界

- Libra series-media-space提供显式同步evaluation scope，纯整季分配计算在一次Direct Selection重建内按不可变Basis身份、Run和maxSizeBytes复用。仅本模块构造并深冻结的完整Basis可复用，外来/可变Basis每次完整校验；scope在同步调用结束或异常后立即销毁，异步/过期/外来scope拒绝。逐文件Handle/Probe digest、大小和完整Episode分配核验继续；单独调用和Effect/新读取均重新完整验证。候选ID、Canonical输入、摘要公式与最终安全检查不变。
- Perception Store内增加最多256项的候选ID查询索引，键为完整检索Clause/Evidence，版本为同一事务读取的全体Source cursor heads。所有合法Record插入均与Source cursor推进同事务提交，因此任何新Source/资料页使旧索引失效；不使用TTL或进程内猜测版本。只存候选ID，不存Record、Relation、Resolution或业务裁决。每次仍重新读取完整匹配记录和当前关系、检查集合上限，Assembler/Resolver与摘要计算不变。纯exact检索继续原有精确SQL，不额外读取heads。冷查询/淘汰后继续完整原检索；失败不发布索引，不产生新的静默业务回退。
- 无Schema、表、索引DDL、持久事实、Public Facade/API、合同、UI或desktop变更；P2仍131/110/224/58/145（shared31、refs243、unresolved0），aggregate ec14f57ab8512de541597a8a482688f6399648f6b16f9273685cba0b65e19b23。没有跨Owner读取或向Worker迁移业务权限。

### 增量验证

最终19个明确受影响文件261 tests/261 PASS/0skip/0fail，四个改动Runtime文件及19个测试文件的SHA256前后完全相同。覆盖评分导入/Resolution/维护续跑、Movie/JAV Perception连续性、媒体生产合同/路由、Series source/空间/预算/Arca接受及外部替换/交付。新增负例含跨Store提交使缓存空结果失效、候选上限及规则变化、容量淘汰、exact路径不增heads读取、未变Acquisition cursor时仍读到新Resolution关系、不同Run/大小限制、Probe/Handle篡改、可变和冻结accessor Basis、异常/异步/过期scope。

Linux基于原固定镜像，只读挂载本次src/test及测试脚本，在本机Desktop Docker隔离运行；9文件190 PASS/0skip/0fail。首轮188 PASS/1fail来自未挂载测试专用series-media-space-schema脚本，补齐测试挂载后重跑；失败日志保留，未修补产品分发。后续最终代码与负例复验同为190 PASS。Windows最终定向178项及专项41项通过；package boundaries/semantic/manifests/P2四项静态检查零finding。

曾启动过宽的83文件扩展回归，包含未选择逐名过滤的整套JAV真实媒体长旅程；因超出本次增量范围，精确识别本机唯一runner并结束其两个子进程，未清理fixture或媒体，原日志保留，**该轮取消不计PASS或完整Architecture资格**。其已完成的四个JAV旅程不据此推断全部JAV场景资格。最终261项为后续独立、明确文件集，非把取消轮重新标绿。原0c82ee862全量Gate只证明旧固定基线，不覆盖本次新Runtime。最终Service常规结果及组件对照见本节下方补记。

本轮未修改或重建NAS生产/验收容器；不声称生产health超时已解决，亦未将US身份准确性业务验收关闭。当前增量没有新镜像/N95性能或独立Windows分发资格，发布前仍须按最终候选补齐适用资格。Web字节与接口无变化，未重复无关UI构建或浏览器验收。


### 最终常规回归与组件对照

最终代码Service常规677 total：648 PASS、29既有skip、0fail，134580.38ms；本轮较早一轮同为648 PASS/29skip，后续Basis证书与exact fast path收口后完整重跑，以最终日志为准。最后再次计算四个Runtime/19个测试文件摘要，仍与最终261项回归输入完全相同。期间只更新文档；所有本轮本机测试/采样进程均已结束，保留既有人工验收SSH入口和安全监控。

组件benchmark使用Windows本机合成数据，旧实现通过git show 0c82ee862加载，SQLite来自本机私有临时数据库，最终清理仅针对自行创建并验证位置/名称的临时目录。没有导出生产数据或访问原片。两组输出deepEqual，评分另逐条断言64个查询均命中预定唯一ID，避免空结果产生虚假收益。

| 工作量 | 旧实现 | 新实现 | 计量范围 |
| --- | --- | --- | --- |
| 96成员、完整Series分配 | 58.0869ms | 0.7728ms | 一轮完整成员集合；各5轮中位数，仅纯计算 |
| 1500记录、64个标题候选冷查询 | 83.3758ms | 81.8052ms | 一次，不声称冷查显著加速 |
| 同64个重复候选查询 | 73.4538ms | 3.6364ms | 各5轮中位数；当前Source heads未变 |

另一次与Service测试并行的采样为Series111.0355→2.2308ms、重复查询305.407→14.9751ms，但冷查询196.3266→263.1209ms较慢，保留在query-opt-benchmark-concurrent.json。该轮存在本机并行负载干扰，不用它或最终单次冷查证明无退化/SLO。以上均不是实际NAS整机CPU、完整Direct Selection路径、真实大库Source规模、生产health长尾或新分发镜像性能资格；不得将组件降幅乘到整体。超过256查询项或新资料提交后会重新进行原完整检索，冷启动成本及Resolver完整摘要仍在。

原始ignored日志：query-opt-targeted-final.txt、query-opt-fence-final.txt、query-opt-final-regression.txt、query-opt-final-inputs.json、query-opt-service-final.txt、query-opt-static-final.json、query-opt-linux.txt（首轮失败）、query-opt-linux-final.txt、query-opt-benchmark.json及并行轮、query-opt-affected.txt（取消轮）。复现脚本在ignored .codex/us-adult-query-benchmark.cjs与us-adult-query-linux.cjs。未新增活动计划、API或数据升级责任。本轮两项优化本地完成，整体US Adult业务验收/发布仍按原Phase开放边界执行。

## 2026-10-20 TPDB真实辅助建档连接修复

用户要求通过ShelfDeck实际姓名辅助建档，并提供仅用于本轮验收的临时TPDB API Key。凭据只从用户指定本地文件读取，经隔离实例正式Platform test/proof/configure流程保存；未提交、输出或复制进脚本、Compose、证据正文或生产配置。原有全站代理策略保持，未修改生产或Clash服务。

- 初始真实账户连接已成功，但StashBox适配器返回摘要遗漏`capabilityCodes`，被Platform以`PLATFORM_INTEGRATION_TEST_RESULT_INVALID`拒绝。补回Profile声明的冻结能力清单，保留原验证/版本/加密Secret和Owner提交流程，未绕过校验。
- 连接后真实搜图返回GraphQL错误：线上TPDB没有`searchPerformers`，而支持`searchPerformer`。改为一次有界数组查询及严格数组结果校验；不做异常后换协议重试。该字段仍在[官方Stash-box Schema](https://github.com/stashapp/stash-box/blob/master/graphql/schema/schema.graphql)内。真实返回资料用于核验协议形状，未据图片判定人物身份。
- Windows完整受影响两个测试文件29 PASS/0skip/0fail；新增正式Host测试覆盖错误凭据拒绝、test-proof-save、重启后Secret保留和正常搜图，不只mock适配摘要。新增空数组、错误形状、超界及GraphQL错误拒绝，验证不隐式补发请求。首轮新增测试误将Provider错误HTTP断言为400，实际合同502，准确修正为502及错误码后复验；不计首轮为PASS。
- Linux固定本地Runtime加只读当前源/测试挂载，相关6 PASS/23未选中skip/0fail；23项不记覆盖。另一次仅连接回归1 PASS/23未选中。四项静态Gate再次通过，DDL/API/Owner/业务合同未改；没有重跑或继承新完整版本Architecture Gate。

NAS只更新`shelfdeck-us-adult-qualification`，原`manual-uat-v1`数据及席位0保持；先通过原监控停止隔离实例，再核验原镜像、路径、摘要和生产健康，以单文件只读挂载先复验连接，再加入搜图修复挂载。原Compose和镜像保留。当前Compose为`compose-manual-uat-tpdb-v2.yaml`，基础image仍为`sha256:34c1d31b358be90cf516b759a9035ea6b912f5f33d31d7d52dc2791dba325ed1`；本轮是明确标识的增量验收叠加，不是新完整发布镜像，也未带入此前查询优化。两处文件SHA256：

| 文件 | SHA256 |
| --- | --- |
| stashbox-provider-adapter.js | f87c60c549311cfa559b8ff689eda5df439916d0956355a792119eadade6f025 |
| people-image-search.js | 5d6761977b9eb63541e639d9711ec8e4cad5a887210ffa179a39be3d29b3bd75 |

实际公开Admin API连接验证200、配置保存200/revision1；三个测试演员查询均200，TPDB返回候选图47/5/5，约2.57/2.92/3.09秒。47项包含近名人物，不能宣称均属于查询演员。浏览器实际进入US Adult新建演员、输入一个测试姓名并按辅助搜图，五张图片均complete且naturalWidth/Height非零；未自动选图或提交人物。Wikimedia仍独立返回来源错误，已定位其中官方thumbnail host被现有白名单拒绝，尚未修复，不伪报全部来源可用。真实出演者识别准确性仍未评估。

隔离监控沿用生产连续健康超时/低可用内存停止测试阈值及退出trap；未放宽保护。两次重建前生产健康成功，生产image `fe8fe2f77c2d32bdc3fe59c14e616610fc48e304704baea9b92352261267fe60`、StartedAt `2026-10-18T04:31:06.595469109Z`、RestartCount0保持。本轮不改原片、不部署生产。

私有ignored证据：`tpdb-live-connection.txt`、`tpdb-live-search-shape.json`、`tpdb-singular-search-shape.json`、`shelfdeck-assisted-search-before-query-fix.json`及当前`...search.json`、`tpdb-search-local-regression.txt`、`tpdb-search-linux-regression.txt`、`tpdb-final-helix-*.json`、`tpdb-overlay-manifest.json`、`tpdb-connection-monitor.txt`/`tpdb-search-monitor.txt`、不含Key的`tpdb-connected.png`和`tpdb-assisted-search-ui.png`。真实姓名、选择凭证及原片路径仅留私有验收资料。

### 用户建档后入口恢复与只读交接

用户随后自行完成4个人物建档。正式GET检查三位真值所需身份均存在，另有一个额外身份；Formation active/completed/ended和Collection均为空。用户问下一步时入口已不可达：原监控在2026-10-20T05:53:39Z记录生产health连续三次超过3秒或超时，触发`SAFETY_STOP health=3 lowMemory=0`；测试Exit0、无OOM，不能将其记作测试环境崩溃或识别失败。

恢复前确认原实例停止、精确scope及数据路径。首次对只读WAL数据库查询得到`SQLITE_CANTOPEN`，未更改原库/Journal；改为在原Host停止期间将数据库及WAL从只读挂载复制到一次性容器tmpfs内，检查该一致副本，query_only读取4个人物、唯一uat-us-field席位0、Run0。此项仅验证技术数据和准入状态，不读取人脸或执行匹配。六次生产health预检均成功（0.014–0.328秒），原apply脚本另三次成功后恢复原v2实例/数据，不重建档案或复制影片；生产image/StartedAt/RestartCount保持。原阈值监控重新启用。

恢复后正式GET返回200，4个人物保留、整理及收藏仍为空；浏览器文件来源显示4包等待接收、累计接收0、接收席位0/暂停接收。只展开席位设置并保存交接截图，未改席位、指定演员、发起识别或生成准确率结论。结果文字统计工具仅处理独立产生的文本记录，不调用人脸模型或Service识别命令。私有ignored证据：`operator-entry-readonly-wal-error.txt`、`operator-entry-preflight.txt`、`operator-entry-restore.txt`、`operator-entry-monitor.txt`、`existing-output-check.json`及`operator-entry-seats-zero.png`。本节不新增产品实现或扩大旧资格。

## 2026-10-20 用户确认的海报新排版v3

用户指出黑底及左上角头像/姓名的资料卡布局不合适，随后明确确认中性示例右侧排版。按该确认更新SSOT §7海报段及冻结Intent版本，正式共享Renderer维持1000×1500，使用暖白底`#f3f0e9`、顶部姓名（920×124有界文本区）、四格450×510居中cover裁切（左40/510，顶210/750）、页脚原始片名（800×108有界文本区）及76×100小肖像。文字及肖像不覆盖截图，边距/行间距与已确认示例一致。截图由contain改为cover，明确裁切两侧而不生成大块黑色留边；透明图片先flatten到纸色，中间以低压缩PNG合成、最终一次JPEG编码，保持纯函数及输入大小限制。

首次Libra生产和Arca单片刷新继续调用原唯一`renderUsAdultPoster`，未新建第二套排版端口、Owner或业务事实。`US_ADULT_PRESENTATION_VERSION`由@2升至@3，正式Arca Intent/Selection Schema和domain-input registry同步；新Intent冻结@3并拒绝把正确摘要的旧版Intent渲染为新版。原始命名Provenance、姓名前缀和实际容器规则保持。当前SSOT source-map只更新文档摘要，逐项核对counts/categoryDigests/aggregateDigest未变；P2当前131/110/224/58/145、31 shared types、243 references/0 unresolved，完整aggregate为`476c0fd150cd9fb2b44a0379c1b5f37b97003af013b44e9e6b14e355d22f7411`。

验证：Windows九个受影响测试文件56 total/55 PASS/1既有opt-in skip/0fail，包含渲染像素区域、四格完整填满、暖白边距、页脚肖像、实际姓名/片名字形边界、版本冻结/旧版拒绝、Arca Inventory/Case持久化、命名/Package及P2负例。Linux本地固定Runtime加只读当前src/test/架构脚本/docs挂载，四文件32 total/31 PASS/1同项skip/0fail。该skip是要求显式模型和测试图的既有真实CPU场景，本轮未执行；不记为新真实媒体或身份匹配资格。四项静态Architecture/semantic/manifest/P2检查通过，`git diff --check`通过。首次P2因SSOT sourceDocumentDigest变化失败，精确同步并验证目录计数和分类摘要不变后复验通过，保留失败日志；不把失败或旧全量资格算作本轮PASS。

正式Renderer已用同一组非真人、非影片的合成风景/图形素材生成并检查中性对照图，画面与用户确认的提案一致；没有读取实际影片画面或参考人像。私有ignored证据为`poster-v3-regression-final.txt`、`poster-v3-linux.txt`、`poster-v3-helix-*.json`、`poster-v3-p2.json`及失败快照、`poster-layout-v3-implemented-neutral.jpg`和`poster-layout-v3-implemented-comparison.png`。未构建/上传/部署NAS镜像，未修改原片、测试现场或已上架海报；新Runtime完整最终资格及发布仍另行完成，不把局部回归当成整版完成。用户已停止准确率统计，后续不继续该统计。
