# UAT-137 / UAT-160 当前合同验收

日期：2026-09-09。两项分别验收关闭。运行时为已发布的 `6bcfd7b33b`；本次仅补测试和证据，无运行时修改、无再次部署。

## 现行依据与历史边界

[SSOT](../../TOP_DOWN_ARCHITECTURE_CONFIRMATION.md) 的 Shelf Acceptance 独立媒体检查及 2026-09-09 用户确认优先：workspace Source 保留 fresh Probe、精确 Read Handle/Fingerprint 与必要对照，Product 独立三点解码；Direct 的 Source 就是 Product，仍实际解码。历史标签不能代替现场事实。不得以旧 Source 三点抽检要求否决合法 workspace 成品。

[137 原记录](../../USER_ACCEPTANCE_TEST_ISSUE_LOG.md) 的旧 SHA/Canary 资格失败保持失败；本证据不改写该结果，也不宣称重新完成该历史全量 Canary。[160 原记录 PROD-017](../../PRODUCTION_DEPLOY_ISSUE_LOG.md) 的《影子写手》旧拒收事实保持不变，未重试或直接修改该生产条目。现行逐项关闭 Oracle 见[总表](../../UAT_ITERATION_REGISTER.md)。

## 独立结果

| 条目 | 实际验证及结果 | 关闭结论 |
| --- | --- | --- |
| 137 | 新生成 HEVC SDR Source/Product，冻结历史 Source=unknown、Product=HDR；实际 Probe 两侧 SDR、Product 三点解码通过，Mandatory 完整且 Gap 为空。另有 fresh preserve 漂移、非 DV Source tone-map、错误输出颜色/DV 残留/解码失败负向仍拒绝 | 当前事实优先及负向边界满足，关闭 |
| 160 | 对真实 Source 注入 bitstream 噪声，独立诊断三点全部解码失败，但容器仍可 Probe；合法 Product 实际三点解码通过，Mandatory Gap 为空。反向损坏 Product 返回 playback_decode_failed。两侧字节验前验后相同 | 合格成品不受原片抽检误拒；成品安全检查保留，关闭 |

用真实 FFmpeg、Host 相同工厂的 Probe、bounded fingerprint 和 Mandatory observer，Package/Handle 为构造并重签摘要的隔离夹具。三个新增场景不是完整 Host 流程；已完成的 [132 Direct 完整链](UAT-132_DIRECT_UNKNOWN_ACCEPTANCE_20260909.md)、[135/136 ISO 完整链](UAT-135_136_ISO_SOURCE_ACCEPTANCE_20260909.md) 与 [172 正式上架链](UAT-172_AUTHORIZATION_ACCEPTANCE_20260909.md) 提供相邻集成证据，不冒充本次全链重跑。

## Windows / Linux 与夹具纠正

同一测试文件 `media-service/test/helix-architecture/p15-uat131-arca-mandatory-media-observation.test.js`，设置 `HELIX_UAT137_REAL_MEDIA=1`：Windows 30 PASS / 0 FAIL / 0 SKIP（约 1.41 秒）；生产同版 Linux image 30 PASS / 0 FAIL / 0 SKIP（约 1.02 秒）。Linux 禁网，仅只读挂载 test，不挂载 src，实际执行镜像内已发布实现。

首次 Linux 验证失败有明确夹具原因：测试曾把 FFPROBE_PATH 强行传给 Probe，而正式 Host 使用无 binary override 的 createCleanMediaProbe（bundled ffprobe）；生成器还需显式 x265 VUI BT.709 标记，不能只依赖容器 CLI metadata。最终按正式 Host 工厂配置，并在生成阶段明确 x265 colorprim/transfer/colormatrix；raw ffprobe 独立断言 primaries/transfer=bt709 后再运行观察。没有修改生产 Probe 选择、推断缺失色彩标签为 SDR、放宽 Gap 或伪造预期。无需额外 hevc_metadata 重写。

本地日志：`.codex/uat137-160-windows.log`、`.codex/uat137-160-linux.log`；均为本次最终通过版本。测试临时媒体自动回收，无 NAS 媒体、库存或旧失败事实写入。Service Windows 与 Docker 覆盖；本次无 API/UI/Desktop 行为变更，不重复无关构建。

生产身份及部署验证仍引用[6bcfd7b33b 发布证据](UAT_RELEASE_6BCFD7B33B_20260909.md)。其他 UAT 不随本证据关闭。
