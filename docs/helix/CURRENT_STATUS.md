# Helix Current Status

Last updated: 2026-07-10

## State

Helix Beta 的 `media-service` 与 Admin Web 实施范围已完成：

```text
Helix = Libra + Nexora + Kairox

Libra Library Automation
  -> Nexora observation / SourceBinding
  -> Membership / Kairox admission

Kairox Maintenance Automation
  -> basedata -> metadata -> optimize -> required basedata refresh
  -> maintenanceComplete
```

物理形态保持模块化单体。`media-desktop` 不在本次范围。生产 clean initialization 与新的 production canary 尚未执行，必须由用户单独授权。

## Implemented Boundaries

- Libra 唯一拥有 LibraryMembership、Helix phase、quarantine、admission generation、durable library work 和跨域协调。
- Nexora 唯一拥有 source identity、SourceBinding、observation evidence、diagnose/rebind/offboarding cleanup。相同 source reality 的重复 observation 不增加 canonical source revision。
- Kairox 唯一拥有 admission skeleton、Basedata/Metadata/User Perception/Optimize objective/facts、Task/Flow/Event 与 `maintenanceComplete`。
- `kairoxAutomationRunner` 是唯一内层薄 Runner；Lifecycle 决定 next gate，Automation Policy 决定自动触发，Task Creator 创建 task，Scheduler 只排序/恢复/派发。
- `ingest|archive|delete` maintenance target、旧 SmartTask/Strategy/Observation clocks、混合 `media_items` Store、旧 schedule/config 与 delete-candidate runtime 已从 clean path 删除。
- Delete 只存在于 Libra Offboarding 的 `cleanupMode=delete_source`，必须显式 destructive authorization；Kairox 只可投影 `disposalRecommendation`。
- Shared Resource Governor 是唯一 capacity owner，具有 bounded queue、aging、control capacity、multi-resource flow permit 与 diagnostics；resource wait 不写 gate failure。
- Automatic terminal failure 和无收益 transcode 投影为 blocker；同一 generation/target/objective 不会形成 retry storm。

## Public Runtime

- Library 配置只保存 `libraryAutomationMode` 与 `maintenanceAutomationMode`；“全自动”只写 `auto/auto`，不改变 approval/authorization。
- `POST /v1/admin/sublibraries/:uuid/actions/observe` 创建 durable observation work。
- `GET /v1/admin/automation` 返回两层 engine、work/cursor 与 Governor pressure。
- `POST /v1/tasks` 只接受 `basedata|metadata|optimize`。
- `GET /v1/admin/offboarding-candidates` 读取 Kairox recommendation；三个 cleanup mode 全部进入 Libra。
- Admin Web 已移除 Archive/legacy automation UI，展示两层自动化、Helix phase/maintenance 与 Governor。

## Acceptance Evidence

- Windows host Service suite：`npm test`，113 项测试全部通过。
- Admin Web：TypeScript + Vite production build passed。
- Production dependencies：升级 Fastify/Static/Undici 及受影响 transitive dependencies 后，`npm audit --omit=dev` 为 0 vulnerabilities。
- Static audit：Nexora/Kairox 无互相依赖；只有 Libra composition root 同时组合两个 Service；Scheduler 不读 Library facts 或 capacity；clean executor registry 只有 Basedata/Scrape/Transcode/Upgrade。
- Disposable host E2E：新建 `auto/auto` Emby stub library，经 restart 后自动到 `maintenanceComplete`，task 只有 Basedata 与 Metadata。
- Linux production image：依赖升级后重新构建 `shelfdeck:helix-beta-local` 成功；一次性 clean runtime 中 Admin Web HTTP 200、Libra/Kairox Automation 均为 green，重启后 durable work 正常恢复；测试容器和 volume 已删除。
- Disposable Docker read-only chain：Basedata/Metadata/no-op Optimize 自动完成，容器重启后 task 数不增加。
- Disposable Docker real mutation chain：测试生成的 H.264 文件经显式 `transcode.beforeReplace` 确认后替换为 HEVC；task 顺序为 `basedata,metadata,optimize,basedata`，全部 `done`，最终 `maintenanceComplete=true`；容器重启后仍保持 4 个 task，无重复 replace。
- Docker E2E 使用独立 container/network/named volumes，完成后已全部删除；未连接 NAS、未挂载生产媒体。

## Earlier Production Evidence

重基线之前，生产 `公共_国产剧` 曾完成 non-destructive retain-source/re-add、onboarding/admission/restart 和单个 read-only Metadata canary。该证据证明旧阶段的 Service 边界，但不替代本次 clean runtime 的 production cutover；本次实现没有修改生产 Emby Library、Emby metadata 或媒体文件。

## Open Risks / Deferred Work

- 生产当前数据与 clean runtime 不兼容；上线必须先单独确认 dry-run、backup、clean initialization 和 canary，不允许自动迁移或 dual read。
- 真实生产 source incident、detach/delete 与 media replace 仍未获具体剧集授权；只在 disposable/automated tests 中验证。
- `media-desktop` 仍需后续完整性重构。
