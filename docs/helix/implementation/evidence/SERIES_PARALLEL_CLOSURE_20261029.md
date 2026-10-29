# 2026-10-29 Series 并行补丁候选

本记录承接用户本轮拆线程授权，属于 Phase 2 的专属诊断/开发 Evidence，不建立第二份活动计划。生产七条故障需保留并经原任务恢复；本分支没有生产操作或生产成功结论。

## 基线与边界

- 独立 worktree：`C:/Users/markm/.codex/worktrees/shelfdeck-series-parallel-20261029/emby_third_party-helix`；分支 `codex/series-recovery-parallel-20261029`，基线 `a2bf2d6fd3271dc3a3741e28ed42f533a59d99d4`。
- 最新治理只读参照主整合 worktree。主分支 `f24164ae0` 的 Series 实现来自 `1cf810220`，相关文件之后没有进一步 Series 修改。本轮复用该正确实现，不带入 People、buffalo、MoviePilot、自定义目标、新表或未提交代码。
- 主整合线程独占 SSOT、生成器、全局 manifest/DDL 及活动计划；本线程不修改这些文件。
- Linux Docker 是唯一交付验证目标。本机原生检查仅为开发反馈；NAS 本轮不部署、不重试、不停机、不启动重测试容器、不改库或媒体。

## 已有修复与仍欠缺的证明

七部历史样本：假如…？、真探、亿万、越狱、继承之战、当你沉睡时、飞天大盗。原生产完整只读证据见 `FORMATION_SERIES_AND_MOVIE_DIAGNOSIS_20261028.md`：正式 NFO SHA/大小正确，精确 producer partial 与正式文件的 dev/ino/size/mtimeNs/ctimeNs 稳定相同，partial open 为 EINVAL，另外两项未发布。

`1cf810220` 已实现两项独立修复：严格验证正式文件后证明冗余 hardlink 别名；IO 暂不可观察进入原 Effect 的有界重新观察，真正冲突继续拒绝。恢复不更换 Owner/Scope/Control，不补造 Receipt，不覆盖正式文件。该提交尚未在上述生产基线运行。

已有完整 Host 证据分别覆盖自动恢复、三次不可观察及一般人工重试；本轮增加“终态失败后，用户通过普通重试上架 POST，新 Work 仍遇到不可读 producer alias”的组合旅程，并核对原失败 Work/Attempt 完全保留、唯一 Command Receipt/Commit 及正式 NFO inode 保持。

## 资料修复的精确合同前置

季海报复用和同集语言补充已获主 SSOT 2026-10-28 合同确认，现有实现同样位于 `1cf810220`。生产基线仍缺以下生成字段；这些不是旧包兼容需求，不能用省略 proof 或宽松校验绕过。由主整合线程从该提交的精确最小变更统一整合/再生成后，才可部署资料切片：

| 生成入口 | 最小变化 |
| --- | --- |
| `domain-input-schema-builder.js` 的 `metadataFetchIntentSchema` | Provider Series 精确 Episode 请求允许冻结 `episodePlotPolicyRef=tmdb.episode-plot-language@1`。 |
| `result-type-schema-builder.js` 的 `metadataObservationSchema` | `episodePlotSourceProof` closed proof；仅 Series/provider/显式 episodeScope，保留真实语言、精确 Provider Episode 与剧情 SHA。 |
| 同文件 `ArtifactAcquisitionResult` 分支 | `seasonPosterSourceProof` closed proof；仅 acquired poster，禁止与 JAV derivation 混用。 |

对应生成文件仅 `domain-types/MetadataFetchIntent/v1/schema.json`、`types/MetadataObservation/v1/schema.json`、`types/ArtifactAcquisitionResult/v1/schema.json` 及其登记摘要。**不需要新增表、DDL、数据迁移或双读写。** 本分支不提交生成器/生成文件；资料切片在上述前置集成前不具备独立部署资格。恢复切片没有这个前置。

## 验证记录（持续追加）

- 首轮受限沙箱原生测试中，临时 hardlink 创建被 EPERM 拒绝；记录保留为环境失败，不修改产品代码绕过。
- 权限更新后的本机原生恢复批次：155 PASS / 0 FAIL / 0 skip；日志 `.codex/series-parallel-20261029/native-recovery.log`。该项不是 Linux Docker 资格。
- 本机 Docker Desktop 原先停止，已启动用于独立 Linux 验证；未调用 NAS。
- Linux 固定依赖镜像 `sha256:afb5fad462130beb66162fff081e96d089adf49ee7e2bb600e9fdac72aea0357`（本机已有的生产基线镜像，仅借用 Linux Node/原生依赖），源码使用独立冻结副本、只读挂载、network none、2 CPU/3 GiB，不挂生产。
- Linux 恢复批次：155 PASS / 0 FAIL / 0 skip，`linux-recovery-unit.log`；155 项包含严格 alias 正负例、执行围栏/替换、Observer 归属、原 Effect/Intent/持久恢复预算与 Host 供给。
- 新增 Linux 普通重试+不可读 alias Host 旅程：1 PASS / 29 名称过滤 skip，59.7 秒，`linux-manual-alias-first.log`。EPERM 明确失败留下同 inode NFO/partial，partial 的 open 持续注入 EINVAL；真实 POST `/v1/admin/formation/acceptance/{offerId}/actions/retry` 后新 Work 完成三项共享文件和唯一正式 Commit；原 failed Work/Attempt 完整行不变、原正式 NFO inode 保持、partial 未被 open、重放命令不重复 Commit。
- 首次冻结源码使用 Windows tar 解包时，一个中文 VBS 文件名被本机 tar 拒绝；改用 Git ZIP/.NET UTF-8 解包，失败目录保留。源码/产品实现没有为该环境错误变更。

恢复切片复验：在上述基线依赖镜像中，挂载候选仓库到 `/src:ro`，`NODE_PATH=/app/node_modules`；六文件 unit 批次为 `series-shared-presentation`、`series-presentation-recovery-observation`、`p4-effect-journal`、`p4-effect-reconcilers`、`p4-event-runtime`、`p4-execution-runtime-host`（均 `.test.js`）。Host 使用独立本机 Docker volume 作 `TMPDIR=/scratch`，设置 `HELIX_SERIES_SHARED_UNREADABLE_ALIAS=manual`，运行 `node --test --test-name-pattern="^Isolated Host schedules 2 Episodes through metadata and Direct On-deck Commit$" test/helix-architecture/series-routing-run.test.js`。

## 尚未完成

本轮 Linux 定向回归、组合人工重试 Host 旅程、资料切片前置下的集成验证、固定候选镜像/完整门禁和主整合安排的真实 CIFS/七条生产逐项验收均需分别记录。不得将历史通过结果或本机反馈宣称为当前生产已修。
