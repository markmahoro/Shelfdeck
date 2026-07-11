# Helix Current Status

Last updated: 2026-07-11

## State

Helix Beta **尚未达成**。生产运行已于 2026-07-11 停止，当前状态是：

```text
Beta not achieved
Production disabled
Recovery implementation in progress
```

此前的 Service 主链路与 Admin Web 实现提供了后续修复基础：

```text
Helix = Libra + Nexora + Kairox

Libra Library Automation
  -> Nexora observation / SourceBinding
  -> Membership / Kairox admission

Kairox Maintenance Automation
  -> basedata -> metadata -> optimize -> required basedata refresh
  -> maintenanceComplete
```

物理形态保持模块化单体。`media-desktop` 不在本次范围。当前不得以文件、接口、组件单测、小样本 E2E 或 Docker 启动成功宣称 Beta 完成；必须先通过真实四库、完整产品闭环、资源不变量和性能门禁。

### 2026-07-11 Production Failure Evidence

- 生产真实规模首次同时形成数百个 Maintenance Run/Task 后，Task supply cap 未按全局 Gate 生效。
- Scheduler、Resource Runtime 与 Governor 在 queue full 时形成 `queued <-> waiting_for_resource` 状态振荡和持续 Event 写入。
- 停止时 `tasks.db` 已增长到约 369 MiB；该增长不是正常业务历史，而是控制协议缺陷。
- Admin Web 的 Emby API Key 配置没有完成 User 选择，连接可显示成功但 Library observation 缺少 `userId`。
- Browser E2E 只证明页面路由和 accessibility；单媒体 full-auto E2E 不能证明真实规模的 supply、backpressure、SQLite 或 UI responsiveness。

因此，下面的既有 Acceptance Evidence 仅作为历史实现证据，不再构成当前 Beta acceptance。

### 2026-07-11 Local Real-Source Recovery Evidence

- Task Creator 已在 Task Store 内完成权威全局 Gate cap 准入；Runner 只从本轮 bounded admission batch 供给，Optimize 饱和不再饿死 Basedata/Metadata 或定向 manual Run。
- `waiting_for_resource` 在重启后只恢复一次到 `queued`，不消耗执行 retry budget；真正 executing 的工作仍使用 Flow recovery contract。
- Transcode rate-control plan 现在按用户配置的设备池和 priority 生成。NVENC 先于 backup-only CPU，不再硬编码为 QSV/CPU。
- Windows 设备探测同时使用短编码和本机显卡 inventory。本机实际包含 RTX 4080 SUPER 与 AMD 集成显卡；Admin Web 明确只启用 CPU + NVENC，AMF 未进入设备池。
- 上述修复后 Service 全量测试 167/167 通过，Admin Web production build 通过。
- 本机已备份并重新 clean initialize。MoviePilot、Douban、成人 Provider、API Key、workspace 与资源池均由 Admin Web 配置；Folder onboarding 达到 JAV 676/676、欧美成人 707/707，没有直接写配置 API。
- Person Catalog 的创建、别名、普通/成人分类和五级偏好已在 clean runtime 中通过 Admin Web 复验。
- 成人真实 E2E 暴露合同缺口：Metadata 当前只发布 canonical facts，`writeNfo`、poster/fanart 与 `organizeAfterScrape` 没有运行时执行；随后通用 adult Optimize objective 会错误选择 MoviePilot Upgrade。新增或选择成人 mutation Flow 前必须先确认架构。
- 该合同缺口已完成 Design 对齐，但尚未实现：当前 Task/Gate 边界已 Kairox 化，执行内核仍以 `flowKind -> complex Flow Executor` 路由，`task_events` 只是审计记录，Event 不是独立 durable 调度对象，Runtime 也仍按整条 Flow 预取资源。因此本机四库 E2E 暂停，现有 Flow 证据不得作为 Beta 验收。
- 已确认的 clean rebaseline 是：Basedata/Metadata/Optimize 全部由真正的 Flow Planner 生成不可变 Workflow Graph；复杂 Executor 原子化为 Capability Executor；Event Runtime 逐 Event 调度、申请 Permit、恢复并记录性能。Library 只配置允许的副作用 Capability，`flowKind` 不再参与 Executor 路由。
- 文件布局合规归属 Optimize Objective。Metadata 生成的 NFO、poster、fanart 先写入持久化 Metadata Artifact Workspace；Optimize 再按计划执行 organize/materialize/layout verify。该工作区必须可由用户配置，默认位于 `<dataDir>/workspaces/metadata-artifacts`，不能被当作可随时清理的 Transcode temp。
- organize/replace 的路径或 source identity 变化由 Kairox 持久化中性 `SourceMutationResult`；Libra durable 消费并协调 Nexora rebind，随后 Kairox 基于新 admission/source revision 独立产生 Basedata Task，禁止 Gate Task 链式创建。
- 2026-07-11 已完成执行内核 clean cut：旧 `flowPlanner.js` 与 Basedata/Scrape/Transcode/Upgrade 四个复杂 Flow Executor 已物理删除；Resource Runtime 不再按 `flowKind` 路由，Workflow Graph、Event Store、Event Runtime 与 Capability Registry 成为唯一执行主路径。
- 新内核已完成第二轮 clean cut：TaskStore 物理删除 Bridge、`flowKind`、复杂 Executor/steps 和 `resumePoint` 列；Scheduler 不再恢复 Flow phase，Event Runtime 是唯一恢复 owner。Optimize Planner 直接按 Objective gap 组合 Capability，classification 只在 Graph 生成后派生。
- `source.organize` 现在是当前 Graph 的终点；SourceMutationResult 被 Libra 消费并经 Nexora rebind、新 admission 和独立 Basedata Task 后，才允许后续 materialize/verify/publish。
- Event Runtime 已补齐 plan revision invalidation、immutable input snapshot、output contract、Capability/Gate 校验和 durable approval resume。Service 全量测试与 Admin Web production build通过；准确测试计数以最近一次验收命令输出为准。
- Metadata Artifact Workspace 已实现 revision/checksum/manifest、Windows atomic flush/rename 探测和路径重叠拒绝；SourceMutationResult 的 Libra→Nexora rebind 单 generation 协调测试通过。
- 欧美成人本机分析在 internal face-embedding Integration 未启动时正确 terminal failure；重试该场景前必须先建立本机 face service/model runtime。
- Emby clean re-authentication 仍缺账号密码。备份按安全合同只保存 username/userId/access token，不允许把旧 token 直接写入新配置作为绕过。

2026-07-11：Maintenance Run 与 MediaItem Priority rebaseline 已完成并通过
Windows、Admin Web、Playwright 与 Linux Docker 验证。生产部署继续暂停，等待用户
验收和单独确认 clean cutover。

## Implemented Boundaries

- Libra 唯一拥有 LibraryMembership、Helix phase、quarantine、admission generation、durable library work 和跨域协调。
- Nexora 唯一拥有 source identity、SourceBinding、observation evidence、diagnose/rebind/offboarding cleanup。相同 source reality 的重复 observation 不增加 canonical source revision。
- Kairox 唯一拥有 admission skeleton、Basedata/Metadata/User Perception/Optimize objective/facts、Task/Flow/Event 与 `maintenanceComplete`。
- `kairoxAutomationRunner` 是唯一内层薄 Runner；Lifecycle 决定 next gate，Automation Policy 决定自动触发，Task Creator 创建 task，Scheduler 只排序/恢复/派发。
- 每个 playable MediaItem 最多有一个未终结 Maintenance Run。auto Library 由 Runner 建立 Run，manual Library 只由一次用户 intent 建立；Run 建立后都由 Lifecycle 连续推进到 `maintenanceComplete`。
- MediaItem Priority 是 Kairox canonical fact，只分 `normal|expedited`，不建立 Run、不改变 Gate/Flow/Approval。Runner、Scheduler、Governor 分别读取该事实完成局部排序；Run 完成后自动恢复 normal。
- Movie、Episode 和成人文件是 playable 维护对象；Series/Season 是 Libra durable scope，只扩展到受管理 Episode，自身不创建 Task。
- `ingest|archive|delete` maintenance target、旧 SmartTask/Strategy/Observation clocks、混合 `media_items` Store、旧 schedule/config 与 delete-candidate runtime 已从 clean path 删除。
- Delete 只存在于 Libra Offboarding 的 `cleanupMode=delete_source`，必须显式 destructive authorization；Kairox 只可投影 `disposalRecommendation`。
- Shared Resource Governor 是唯一 capacity owner，具有 bounded queue、aging、control capacity、multi-resource flow permit 与 diagnostics；resource wait 不写 gate failure。
- Automatic terminal failure 和无收益 transcode 投影为 blocker；同一 generation/target/objective 不会形成 retry storm。

## Public Runtime

- Library 配置只保存 `libraryAutomationMode` 与 `maintenanceAutomationMode`；“全自动”只写 `auto/auto`，不改变 approval/authorization。
- `POST /v1/admin/sublibraries/:uuid/actions/observe` 创建 durable observation work。
- `GET /v1/admin/automation` 返回两层 engine、work/cursor 与 Governor pressure。
- 用户不再创建 target-gate Task；Admin 只提交 neutral Maintenance Run、MediaItem Priority 或专项 refresh intent。
- auto 模式拒绝“开始维护”，只允许“优先维护/取消优先”；manual 模式未启动时只允许“开始维护”，Run active 后才允许优先维护。
- `GET /v1/admin/cleanup-recommendations` 读取处置建议；三个 cleanup mode 全部进入 Libra。
- Admin Web 固定为概览、媒体库、媒体、演员、任务中心、清理建议、管理策略、系统设置八个一级页面；普通页面使用用户语言，内部事实只在折叠诊断中展示。
- 通用 `/v1/config`、旧 Adult People、旧 Offboarding/Delete Candidate 与 Transcode raw-config 入口均不存在；资源、安全和维护策略使用 scoped API。
- Kairox Person Catalog 统一普通/成人演员，支持五级偏好、强身份自动归并、同名候选人工合并、reference face cold artifact 与关联媒体 objective 重算。

## Historical Acceptance Evidence (Withdrawn As Beta Proof)

- Windows host Service suite：`npm test`，126 项测试全部通过。
- Admin Web：TypeScript + Vite production build passed；Vitest 3 项组件/产品语义测试通过。
- Browser E2E：Playwright 在 `1440×900`、`1280×800`、`1024×768`、`390×844` 四个 viewport 完成八页路由与窄屏导航验证，共 8 项通过。
- Accessibility：四个 viewport 的 Axe serious/critical violations 为 0；收窄侧栏保留完整 accessible name，reduced-motion 与键盘 focus token 已审计。
- Visual QA：in-app browser 实查 1440、1024 与窄屏，无横向溢出；概览以维护账本展示“尚未配置/正常/故障”和维护成果。
- Admin dependency audit：包括 dev dependencies 的 `npm audit --registry=https://registry.npmjs.org` 为 0 vulnerabilities。
- Production dependencies：升级 Fastify/Static/Undici 及受影响 transitive dependencies 后，`npm audit --omit=dev` 为 0 vulnerabilities。
- Static audit：Nexora/Kairox 无互相依赖；只有 Libra composition root 同时组合两个 Service；Scheduler 不读 Library facts 或 capacity；clean executor registry 只有 Basedata/Scrape/Transcode/Upgrade。
- Maintenance Run/Priority audit：公开 `POST /v1/tasks`、用户指定 Gate/Flow、Task execute/retry/pause、Task priority 调整和“执行下一步”均不存在；Task approval 只保留显式确认入口。
- Priority acceptance：auto/manual Run 互斥、Priority durable revision、Task snapshot、Runner/Scheduler/Governor 严格 expedited-first、Governor waiter reprioritize 均通过自动测试。
- Disposable host E2E：新建 `auto/auto` Emby stub library，经 restart 后自动到 `maintenanceComplete`，task 只有 Basedata 与 Metadata。
- Linux production image：依赖升级后重新构建 `shelfdeck:helix-beta-local` 成功；一次性 clean runtime 中 Admin Web HTTP 200、Libra/Kairox Automation 均为 green，重启后 durable work 正常恢复；测试容器和 volume 已删除。
- 本轮 Linux image `shelfdeck-helix-maintenance-run-test` 构建成功；`helix-beta-maintenance-run-v2` clean volume、all-in-one 启动、Admin HTTP 200 和 container restart recovery 通过，临时 container/volume 已删除。
- 同一 Linux image 内执行 Service 全量测试 126/126 通过，包括 full-auto `maintenanceComplete`、Run/Priority、Series scope、Resource Governor、source fencing 与 native SQLite。
- Disposable Docker read-only chain：Basedata/Metadata/no-op Optimize 自动完成，容器重启后 task 数不增加。
- Disposable Docker real mutation chain：测试生成的 H.264 文件经显式 `transcode.beforeReplace` 确认后替换为 HEVC；task 顺序为 `basedata,metadata,optimize,basedata`，全部 `done`，最终 `maintenanceComplete=true`；容器重启后仍保持 4 个 task，无重复 replace。
- Docker E2E 使用独立 container/network/named volumes，完成后已全部删除；未连接 NAS、未挂载生产媒体。
- 本轮 Admin 最终 disposable image 为 `shelfdeck:helix-admin-web-local`（image id `sha256:6e73486f89d5711f0da320a19e8a377215217b61a9d711b0fa931cf39ab8dde4`）；clean init、Admin HTTP 200、Person API 与 container restart recovery 均通过，临时 container/volume 已删除。无 Library 的 clean runtime 对外 operational health 为 red，但 Admin 正确投影为“尚未配置”，不是失败列表。

## Earlier Production Evidence

重基线之前，生产 `公共_国产剧` 曾完成 non-destructive retain-source/re-add、onboarding/admission/restart 和单个 read-only Metadata canary。该证据证明旧阶段的 Service 边界，但不替代本次 clean runtime 的 production cutover。

## Authorized Production Canary Fixture

- 用户已明确授权 `边水往事 (2024)` 作为可销毁的 Optimize 测试样本，不要求备份。
- 2026-07-10 在部署前通过本地可访问路径原位准备样本：21 集均以 FFmpeg stream copy 截取为约 10 秒 MKV，未修改该目录外的文件。
- 全量 FFprobe 校验结果：21/21 有效，均包含 HEVC video 与 audio，分辨率 `3840x1920`，时长 `10.16–10.28s`，总体积 `95.55 MiB`，无临时文件残留。
- 该授权只覆盖上述剧集的 Optimize/replace 测试，不覆盖其他媒体、Emby Library 配置、Emby metadata 或 delete_source。

## Open Risks / Deferred Work

- 2026-07-11 用户终止当前四库 E2E；localhost `18181` Service 已停止，现场数据仅保留为诊断证据。不得继续创建 Library、推进真实 maintenance 或执行真实媒体 mutation。生产 ShelfDeck 仍停止。
- 重新审计撤回“原子 Capability 重构已完成”的结论：Event Runtime 主骨架和旧 `flowKind` 路由删除已经完成，但 `source.upgrade.download` 仍在单个 Executor 内包含提交、轮询、transfer 查询和输出定位；Planner 还声明了未注册的 subtitle/remux capability；Organize/SourceMutation 后处理边界仍需收束。因此当前状态是 **atomic runtime closure in progress**，不能宣称非换皮验收通过。
- 当前首要验收不是 E01-E40，而是 capability-conservation：旧 Basedata/Scrape/Transcode/Upgrade 的所有有效能力、安全检查、审批、恢复和证据必须逐项映射；任何未映射能力均为 release blocker。
- 2026-07-11 Capability API 第一阶段完成：Canonical Catalog 定义 nominal/versioned input/output、effect、resource、approval 和 fencing contract；Planner 对每条 binding 做类型检查；Runtime 只向 Executor 提供已解析 ports。Transcode/Upgrade 统一输出 `StagedMediaAsset` 并复用 verify/replace，poster/fanart 合并为参数化 `metadata.image.acquire` 且保留分别允许的产品配置。
- Upgrade 已拆分 request/download-observe/transfer-observe/output-resolve，Executor 内不再轮询。欧美成人 local 与 Worker Metadata 链路已分别拆为抽帧、embedding、cluster、match、poster、compose，以及 asset register/upload、job request/observe、normalize Event；generic provider adapter 已禁止回退到旧 `analyzeVideo()` 复杂调用。
- SourceMutationResult、neutral signal 和 Basedata invalidation 已从文件 Executor 移入 Runtime post-effect；commit marker 在 post-effect 前持久化，重启只恢复 post-effect，不重复文件 commit。当前剩余主要 blocker 是 Transcode precheck/DV/rate-control/preview/disposition/cleanup、Upgrade identity/preview/folder rollback、Remux 和 subtitle capability 决策。
- Transcode 已进一步拆为 `media.transcode.precheck -> transcode.tonemap.accept -> media.transcode -> output.media.verify -> output.preview.generate -> media.replace -> workspace.cleanup`；Dolby Vision approval 由 Runtime 根据 typed precheck evidence 条件触发。Upgrade 使用相同 preview/verify/replace/cleanup，并新增强 TMDB identity inspect/conditional accept。
- 唯一 `media.replace` 现在消费通用 `VerifiedMediaAsset`，按 `replacementScope=file|folder` 执行文件或 rollback-safe 目录提交；不存在 Transcode/Upgrade 各自的 replace Executor。Service 全量 188/188 通过。尚未关闭的 Transcode blocker 是 verify-driven rate-control retry、oversized-output disposition、disc Remux 与 failure/cancel cleanup。
- Metadata Artifact Workspace 已有引用保留期清理；容量耗尽、符号链接/挂载差异和长时间清理故障验收仍未完成。成人 NFO/poster/fanart 已禁止直接写入未整理媒体根目录。
- 需要 Emby username/password re-authentication，之后才能从 Admin Web 重建两个真实 Emby Library。
- 需要建立本机 face-service dependencies/models，之后才能重试欧美成人 Metadata。
- normal/constrained performance profile、restart/fault matrix 与 active/idle soak 仍需在最终四库 runtime 完成。
- 本机真实来源验收将在 `Z:\Film`、`Z:\chn_series`、`Y:\JAV`、`Y:\US` 上执行；生产在本机报告获用户确认前保持停止。
- 生产当前数据与 clean runtime 不兼容；上线必须先单独确认 dry-run、backup、clean initialization 和 canary，不允许自动迁移或 dual read。
- 真实生产 source incident、detach/delete 与 media replace 仍未获具体剧集授权；只在 disposable/automated tests 中验证。
- `media-desktop` 仍需后续完整性重构。
- 本轮应用内浏览器额外 spot-check 因浏览器视图连接失败未完成；四 viewport Playwright 路由与 Axe 验证已通过，生产 Admin 最终视觉验收仍随 production cutover 单独进行。
