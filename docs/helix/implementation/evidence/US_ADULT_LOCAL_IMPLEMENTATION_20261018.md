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
