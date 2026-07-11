# FlowPlan 业务复刻验收

状态：**未通过（1 个架构 blocker）**  
日期：2026-07-11  
范围：Kairox Basedata、Metadata、Optimize 的 Planner / Graph / Event Runtime；不包含真实四库 E2E 或生产部署。

## 验收方法

验收不以 Capability 名称存在为证据，而是同时要求：

1. 删除前复杂 Executor 的每项有效行为具有明确映射。
2. 代表性 Objective 能生成完整、类型合法、依赖正确的不可变 Graph。
3. 每个业务 Capability 至少能从一个系统 Planner 场景到达，不存在只注册不规划的“摆设能力”。
4. Runtime 能证明审批、资源、重试、重启、取消、补偿和 generation fencing。
5. Capability 内不存在跨业务阶段轮询、调用另一 Capability、Task/Event 写入或跨 Helix 域写入。

## 结果

| 业务链路 | 复刻结果 | 证据 |
| --- | --- | --- |
| Emby Basedata | 通过 | observe → verify → publish；Emby layout 节点按条件 skip |
| Folder Basedata | 通过 | probe + layout observe → verify → publish |
| 普通 Emby Metadata | 通过 | identity → provider → Person → optional artifacts → verify → publish |
| JAV Metadata | 通过 | 独立番号解析、Provider、Person、NFO/poster/fanart、publish |
| 欧美成人本机识别 | 通过 | frames → embed → cluster → match → compose → common Metadata tail |
| 欧美成人 Worker | 通过 | register → upload → request → single observe → normalize → common Metadata tail |
| Transcode | 通过 | precheck、DV approval、预声明多策略 encode/verify、select、disposition、preview、replace/discard、cleanup、publish |
| Disc Remux + Transcode | 通过 | `container.remux` 产生统一 StagedMediaAsset 后进入共享链路 |
| Movie Upgrade | 通过 | MoviePilot check、identity、search、approval/request、download/transfer observe、settle、strong identity、verify、shared replace |
| Upgrade + Transcode 复合 Objective | 通过（验收中修复） | Upgrade 只验证其负责的 Objective gap；Transcode 明确依赖 Upgrade outcome，最终只发布一次 |
| Organize / Artifact materialize | 通过 | Organize Graph 终止；Libra→Nexora rebind 后的新 admission 才能规划 materialize/layout/publish |
| No-op Optimize | 通过（验收中修复） | `optimization.objective.verify` 重新计算 gap，不再无条件返回 true |
| Source incident / Offboarding fencing | 通过（验收中修复） | executing Event 被 durable cancel；late output 不能复活；commit_once 临提交再次检查 generation |
| Season / Series Upgrade | **未通过** | 旧 Season 级精确 TMDB/季号搜索和整季替换没有被 Helix Episode Task 模型复刻 |

## 本轮发现并修复的问题

1. 复合 Upgrade + Transcode Graph 对 Upgrade 输出错误执行完整 Codec Objective 验证，导致 Transcode 无法开始。新增 `output.media.verify(objectiveScope=upgrade_stage)`。
2. Transcode precheck 显式空依赖覆盖 Graph tail，使 Upgrade 与 Transcode 并行。现已明确依赖 Upgrade outcome。
3. `optimization.objective.verify` 无条件返回通过。现重新运行 Objective gap analysis，错误 no-op 会失败。
4. `workflow.blocked` 曾把 reason 塞入未声明的 inputBindings。现改为正式、类型校验的参数合同。
5. Runtime 只在 Event 开始前 fencing。现向 Capability 注入 Runtime-owned `assertFence()`，所有 admission-fenced `commit_once` 在真实提交前必须调用；静态测试强制执行。
6. Source suspension 只修改 Task 状态，没有取消执行中的 Event。现同步 durable-cancel，调用 Capability cancellation contract，并拒绝 late output。
7. 本机抽帧、人脸 Worker 和远端媒体上传缺少取消能力。现接入统一 cancellation contract。
8. Event 性能曾把所有 Transcode 策略混为一组。现按 Capability、resourceKey 和参数（如 QSV/NVENC/CPU strategy）分别统计。

## 唯一未关闭的架构 Blocker

旧模型的 Season Upgrade 是一次“季级 source mutation”：

```text
Series/Season identity
→ TMDB + season exact search
→ one season download/transfer
→ TMDB + season-number verification
→ one folder replacement
```

Helix 当前约束则是：Series/Season 只作为 Libra scope，Episode 才是 playable Kairox subject。若简单把 scope 展开为多个 Episode Run，每个 Episode 都可能下载并替换同一季目录，既不等价也不安全。

当前安全措施：任何 `episode|season|series` 的 Upgrade gap 都稳定进入 `series_scope_upgrade_architecture_unresolved`，不会继续 MoviePilot 请求或文件替换。这是显式 blocker，不是完成方案。

边界判断：

- Library hierarchy、scope 扩展和成员集合属于 Libra。
- Upgrade Objective、candidate selection、download、verify、replace 仍属于 Kairox Optimize。
- 替换后的 SourceBinding re-observe/rebind 属于 Nexora，由 Libra 协调。

因此不能把完整 Upgrade 移给 Nexora，也不能让 Libra 执行 MoviePilot/replace。待确认的设计点是：Kairox 是否允许一个由 Libra scope 授权的“季级维护对象”，并确保一个 scope 只有一个 Upgrade Run/Task，完成后再由 Libra/Nexora 刷新所有 Episode admission。

## 自动证据

- Service：`221/221` 通过。
- Admin Web：TypeScript + Vite production build 通过。
- 本报告记录的是 Subject/Asset clean cut 之前的 50 项基线；当前 62 项 Catalog、Series Season Upgrade 与 multi-Episode Transcode 证据以 `CURRENT_STATUS.md` 为准。
- 静态审计：Capability 不引用 Libra/Nexora，不写 Task/Event，不发跨域 signal，不调用另一 Capability，不包含旧复杂 Executor 路由或内部进度轮询。
- Runtime：重试不消耗 Task attempt、重启恢复、durable approval、conditional approval、Permit、cancel、late-output rejection、commit fencing 均有行为测试。

## 结论

Movie、单文件、Episode Transcode、Metadata、成人识别、Organize 与 Artifact 链路已通过业务复刻验收。由于 Season Upgrade 是原系统有效能力且当前 Helix 尚无等价安全模型，本次总验收仍为 **未通过**。在该架构决策确认前，不恢复真实四库 E2E 或生产运行。
