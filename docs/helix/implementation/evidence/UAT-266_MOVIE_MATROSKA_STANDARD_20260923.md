# UAT-266 Movie 成品统一 Matroska/.mkv

状态：系统模板受控升级补充实现与验证中；生产未发布，Shelf Standard 未变更，存量媒体未处置。

实现提交：`44acda5fc`（Movie规格与Libra路由）、`4dd6ba940`（系统模板受控发布）。

## 用户目标与合同

2026-09-23 用户确认：所有 Movie 成品使用 Matroska 容器及 `.mkv` 扩展名；新 Libra Run 与已上架存量均适用。随后明确选择**直接升级系统模板，不复制用户模板**。容器以 Probe 为准，扩展名以最终文件名为准；单纯改名不能修复真正的 MP4 封装。Libra 仅在自己的 Workspace 生成新成品；已上架 Entry 由 Arca Shelf Standard 重评与 Aftercare 正式修复、提交 Inventory revision，保留 Shelf Entry 身份。依据 SSOT §5.2.1、§5.5.6–5.5.7、§5.8 Aftercare 和 Beta HB-B/HB-E；不改变 Owner 或 Handoff。

## 现场与根因

生产只读核对：一个活动 Movie Shelf，绑定不可修改的 `system-beta-recommended` revision 1；当前 Shelf Standard revision 1 中 Movie base 与全部 0–5 星分支均为 `container:any`、`fileExtension:any`。所以现有 `.mp4` 正常上架并被判断合规。

当前活动 Inventory 中有 19 个 `.mp4` Primary，合计约 104.4 GiB。逐一 Probe：13 个是真 MP4 容器，6 个实际是 Matroska 但扩展名误为 `.mp4`；其中一个 H.264 的评分要求还可能需要 Transcode。`惠子，凝视 (2022).mp4` 属于后者，实际 Matroska、HEVC。上述为 2026-09-23 只读快照，正式修复前须重核当前 Inventory、Case、Workspace 与磁盘资源。

## 实现

- Beta 推荐 Movie Rule Template 的无评分和 1–5 星分支均要求 `container:matroska`、`fileExtension:mkv`。既有系统 Template/Standard 的历史 revision 保持不可变；仅更新代码中的默认值不足以改变已绑定 Shelf，须经过下述受控发布。
- ShelfDeck 启动时由 Arca Owner 检查系统模板的代码定义与持久化 Head；只有已知旧 revision 1 与精确旧规则摘要可受控发布系统 revision 2。一次 Owner 事务写入新 Template revision、全部仍绑定 Shelf 的有效 Standard revision/head/routing projection、Command Receipt/Audit 与 Outbox。新规则或未知旧依据不匹配即拒绝，不覆盖旧 revision；Admin Web 仍只读，用户不能任意编辑系统模板。新安装已含新规则，无需额外发布。
- Libra Direct 验证仅有 `container_unmet` 和/或 `file_extension_unmet` 时转入已有 Remux Work；输出仍由三点解码、实际 Probe 和 Product Conformance 验证。编码、大小等其他 Gap 继续走既有 Transcode/External 路径。
- Arca Aftercare 原有 conformance、auto-repair、Remux/Transcode、Inventory Commit 与 Settlement 路径继续作为存量 Owner；新增回归覆盖真 MP4 与误后缀 Matroska 的 Gap 区分。

## 发布与验收门禁

先完成架构与适用平台验证，再按标准镜像发布。部署前在生产副本上验证旧摘要准入、系统 revision 2、当前 Shelf Standard revision 2、重启幂等及 Aftercare 一片真实样本；正式镜像启动时由 Arca 受控发布，不使用用户模板或直接改生产 SQLite/NAS 媒体。生产发布前重核 19 项当前事实及资源；发布后监控逐项 Case、Probe、Workspace、Inventory revision、原片安全和 Shelf Entry 身份。所有 19 项完成并复验之前，UAT 保持开放。

## 已有验证

- 定向 Node 测试：Rule Template/Shelf 8/8，媒体与 Aftercare 37/37 通过。
- Aftercare Case、Effect、Workspace、安全与恢复专项 69/69 通过，包括 100 Entry 的单席位 FIFO 排队。
- 系统模板受控升级定向测试：旧系统revision 1和绑定Shelf原子升为revision 2，用户端仍只读；注入Shelf写失败时Template与Standard一起回滚；未知旧规则摘要拒绝且不改事实；重启不重复发布。
- FFmpeg 实际 1 秒样本：真 MP4 与误后缀 Matroska 均能 stream copy 产生 `matroska,webm` Probe 的 `.mkv`，视频 codec 保持 H.264。
- 初次完整架构检查 1834 项中 1821 通过、9 跳过、4 失败；四项失败均由 SSOT 插入六行使下游 Catalog 来源行号整体偏移造成。将补充合同移至 SSOT 末尾后重新 materialize Source Map，仅 `sourceDocumentDigest` 改变；四项门禁定向复验 15/15 通过。最终完整架构复验 `fixture/dependency/semantic/manifests/contracts` 全部 `ok=true`。
- 系统模板受控升级加入后再次运行完整架构复验，`fixture/dependency/semantic/manifests/contracts` 全部 `ok=true`；系统模板专项 5/5 通过。新增测试断言系统发布仅有一份Outbox与Command Receipt。

## 未完成与风险

生产镜像、正式 Template/Standard 发布、19 个存量 Case 修复及逐项验收均未执行。FFmpeg stream copy 对个别轨道或附件可能失败；失败须保留原片与明确 Case 结果，不允许通过改后缀伪造合规。新 Run 与存量的真实全链验收仍需完成。
