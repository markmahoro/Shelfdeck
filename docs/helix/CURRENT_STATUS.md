# Helix Current Status

Last updated: 2026-07-11

## State

Helix Beta 的 Service 主链路与 Admin Web 产品级重构均已完成：

```text
Helix = Libra + Nexora + Kairox

Libra Library Automation
  -> Nexora observation / SourceBinding
  -> Membership / Kairox admission

Kairox Maintenance Automation
  -> basedata -> metadata -> optimize -> required basedata refresh
  -> maintenanceComplete
```

物理形态保持模块化单体。统一 Person Catalog、演员偏好策略、clean configuration contract 与八个 Admin 用户页面已经落地。`media-desktop` 不在本次范围。生产 clean initialization 与新的 production canary 尚未执行，必须由用户单独授权。

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

## Acceptance Evidence

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

- 生产当前数据与 clean runtime 不兼容；上线必须先单独确认 dry-run、backup、clean initialization 和 canary，不允许自动迁移或 dual read。
- 真实生产 source incident、detach/delete 与 media replace 仍未获具体剧集授权；只在 disposable/automated tests 中验证。
- `media-desktop` 仍需后续完整性重构。
- 本轮应用内浏览器额外 spot-check 因浏览器视图连接失败未完成；四 viewport Playwright 路由与 Axe 验证已通过，生产 Admin 最终视觉验收仍随 production cutover 单独进行。
