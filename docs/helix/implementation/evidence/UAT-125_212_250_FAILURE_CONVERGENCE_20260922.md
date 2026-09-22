# UAT-125/212/250 整理失败收敛修复

2026-09-22，用户授权开始修复，明确网络方案不要复杂化。本记录承接既有 UAT，不新增重复问题或宣称关闭。

## 生产证据

生产镜像 `markmahoro/shelfdeck:helix-beta-20260912-286fe56f1e`。《极盗车神》Run `d84c727cd37c14c7872d95f57e967a45bd30972cbd5e3439d2b956f0d4cb917c` 本地 NFO 成功后，TMDB 身份观察在 16:13:52–16:14:01 三次网络失败，16:14:04 已 discarded。代理请求均路由至同一失败节点；16:14:23 节点切换后其他影片请求成功。历史具体 TLS/socket 原因因诊断丢失不能追认。

《角斗士》《伸冤人》正式 Run 已结束，旧 Projection 仍 active；列表在读取当前事实前过滤，读取后未复核，导致活动与已结束列表重复显示，并错误停留在成功的“保存本次整理决定”。

《星际迷航2：暗黑无界》Run `2a0b649f11822a3c59afec9fc9d1af14f743453822b8bd4add58fdaa05825fe4` 的预检 Attempt 自 09-14 16:00:48 留在 executing，现场无对应 FFmpeg。历史触发点未证实。代码确定存在：Event deadline 覆盖本地 30 秒限额、预检没有接入 AbortSignal、timeout 被误作为编码策略不适用。

## 修复边界与 UI 路径

- 网络沿用现有 Retry Policy：总共 3 次，间隔 30 秒/120 秒，仅 Libra Provider 观察；不加代理切换、后台恢复框架或无限重试。
- Secret Broker 仅透传既有白名单 stage/networkCode/timeout，身份观察保存到 Outcome diagnostics；不记录 URL、凭证、原始异常文本。
- 用户从媒体整理的活动列表查看真实仍在处理的条目，数量与分页同步；已结束 Run 保留在既有“已结束”入口。复用原有状态和操作，不改布局或文案。UI 负责人已确认此范围，要求覆盖活动保留、终态移出、分页/计数及历史可查。
- 预检执行同时受本地限额与 Event deadline 约束，取消传给子进程；等待进程 close 后收尾。超时保留技术失败，不生成编码不兼容的业务结论。
- 不直接修改生产数据，不恢复/迁移旧 Run，不宣称旧挂起 Attempt 因代码修复已恢复。部署及旧条目处置遵守既有负责人和精确授权。

## 验证

- Windows Node v25.9.0：身份观察、Formation、Secret、实际 FFmpeg 专项 71 PASS / 1 SKIP（缺真实 BDMV 样本）。命令为 `node --test test/helix-product-identity-selection.test.js test/helix-formation-projection.test.js test/helix-architecture/p5-secret-lease.test.js test/clean-media-production-effect-port.test.js`。
- `node scripts/helix-architecture-verify.js`：239 测试文件、依赖边界、语义、Manifest、Contract 全通过，包含预检 Capability timeout/取消权传递/过期返回防护测试。
- `node test/fixtures/helix-device-qualification-worker.js software_cpu`：实际 CPU `two_pass_abr`、`strict_abr`、`quality_bound` 三种模式设备验证和24帧源预检通过；过期 deadline 为技术 timeout。
- `HELIX_LIBRA_HANDOFF_B_E2E_ROOT` 指向既有隔离 `uat215-media-fixture`，`node --test --test-name-pattern='P14 one-movie product path' test/helix-libra-handoff-b-scenario-e2e.test.js`：1 PASS，0 SKIP，160.3 秒，实际 Handoff B 与 Arca Commit 端到端通过。此前未设置样本目录的运行跳过，已由本次实际运行补齐。
- 所有 media-service diff 可无冲突应用到生产基线 `286fe56f1e`。独立工作区应用后，上述专项加 `p9-media-production-contracts.test.js` 共90 PASS / 1 SKIP（同一真实BDMV样本缺失）。代码不依赖 `884a154def` 共用 Workspace Root，可独立进入旧Root发布线。
- 本机 Docker daemon 不可用，Linux/QSV未验证；未进行真实故障代理网络重放。有限重试仍使用既有执行器，未更改耗尽后的Owner合同。
- 未生产发布、未执行页面走查、未关闭 UAT。部署负责人已接收范围，需检查新增 Retry Policy 对 catalog 的影响，执行 Linux/旧库完整Host/回退门禁；不得用重置旧 Run 绕过门禁。

## 发布拆分

部署负责人复核 `bounded-catalog-transition.js`：既有 witness 要求当前 `policyRegistry.digest` 精确相等，并用同一 registry 重算旧 catalog。新增 Provider Policy/绑定会使 witness 失效，空库 E2E 不能证明286旧计划可启动。本批因此拆成两项提交：第一项只有诊断、列表、预检及测试/证据，不改变 registry；第二项仅4行 Provider Policy/绑定变更，暂不发布。不得挑选第二项后绕过 catalog 验证，不引入迁移、Reset或静默兼容。30/120秒方案仍为候选，需合法旧计划启动策略后落地；生产当前仍使用原有退避。

本地日志位于系统临时目录 `shelfdeck-failure-fix-architecture.log`、`shelfdeck-failure-fix-e2e.log`、`shelfdeck-failure-fix-production-base.log`，不包含生产凭证，不提交临时运行数据。
