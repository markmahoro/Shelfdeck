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
