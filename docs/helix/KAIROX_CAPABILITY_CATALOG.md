# Kairox 原子 Capability 目录

> Historical capability catalog only. 本文保存当前/历史实现中的能力名称、接口和性能目标，不决定
> clean Helix中的Business Domain、Fact Owner或调用方向。历史组织名、Source、Gate和Flow等旧归属
> 必须由`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`后续Level重新安置后才能成为新合同。

状态：Historical Catalog snapshot v1（非clean Canonical合同）
代码事实源：`media-service/src/capabilityCatalog.js`
快照数量：62 项历史业务 Capability；另有 1 项 Runtime 阻断原语 `workflow.blocked`。

2026-07-16 Level 7 Conservation Audit已经证明：本快照中的名称、数量、Effect、Owner和接口均不能原样
进入clean Catalog；逐项去向以`CAPABILITY_CONSERVATION.md`为Evidence。所谓“原子”只描述该历史阶段的
设计意图，不证明其符合当前Atomic Capability Contract。

## 为什么有 62 项

Kairox 不再把“一个用户功能”实现为一个复杂 Executor，而是把观察、解析、外部请求、验证、选择、文件提交和 Facts 发布拆成可独立调度与恢复的效果。因此能力数量增加，但每项只有一个职责，Transcode 与 Upgrade 也能共享验证、替换、清理等能力。

62 项并非 62 个进程、服务或线程，而是进程内注册的内部接口。Flow Planner 将它们组成不可变 Workflow Graph，Event Runtime 逐 Event 调度。

## 统一合同与性能口径

```text
execute({ task, event, config, input, parameters })
  -> { result: <声明的 Type@Version>, evidence? }
```

- `input` 只能包含 Planner 声明且类型兼容的端口；当前合同均为 v1。
- `pure` 可安全重试；`staged_write` 复用 Event 暂存产物；`commit_once` 要求 commit marker、幂等键和提交前 fencing。
- Executor 不管理 Task/Event 状态、Permit、审批、重试、恢复或后续节点。
- `?` 表示可选输入；`[]` 表示汇合输入。

Runtime 按 Capability 与 `resourceKey` 统一采集：`count`、`failed`，以及 `queueWaitMs`、`resourceWaitMs`、`approvalWaitMs`、`executionMs` 的 p50/p95/p99。下表“性能指标”是各能力应重点观察的业务维度；绝对 SLA 必须由真实来源 E2E、受限 Profile 和 NAS canary 形成，本文不编造开发机阈值。

## Basedata（5 项）

| Capability | 功能 | 输入 | 输出 | 效果 / 资源 | 性能指标 |
| --- | --- | --- | --- | --- | --- |
| `emby.item.observe` | 只读观察一个 admitted Asset 的 Emby 技术基础数据 | `asset: AssetSnapshot` | `SourceObservation` | pure / Emby | API 延迟、失败率、同 revision 重复请求数 |
| `filesystem.media.probe` | stat/FFprobe 一个 admitted Asset | `asset: AssetSnapshot` | `SourceObservation` | pure / filesystem | Probe 时间、Volume 等待、吞吐 |
| `filesystem.layout.observe` | 观察一个 admitted Asset 的目录和文件布局 | `asset: AssetSnapshot` | `LayoutObservation` | pure / filesystem | 扫描时间、文件数、Volume 等待 |
| `basedata.verify` | 验证基础事实满足 Gate 要求 | `observation: SourceObservation`；`layout?: LayoutObservation` | `VerifiedBasedata` | pure / CPU | 执行时间、验证失败率 |
| `basedata.publish` | 发布 Basedata canonical fact | `basedata: VerifiedBasedata` | `BasedataPublication` | commit_once / SQLite | DB 写延迟、revision 冲突、重复 commit |
| `basedata.subject.publish` | 所有当前 Asset fresh 后发布 Subject 聚合 Basedata | `assets: BasedataPublication[]` | `BasedataPublication` | commit_once / SQLite | Asset 数、汇合时间、不完整率 |

## 通用 Metadata 与 Artifact（11 项）

| Capability | 功能 | 输入 | 输出 | 效果 / 资源 | 性能指标 |
| --- | --- | --- | --- | --- | --- |
| `media.identity.resolve` | 从 Admission 与现有事实解析媒体身份 | 无 | `MediaIdentity` | pure / CPU | 解析时间、无法解析率 |
| `series.identity.resolve` | 解析 Series 级稳定身份 | 无 | `MediaIdentity` | pure / CPU | 解析时间、身份完整率 |
| `metadata.provider.fetch` | 从配置的 Provider 获取描述性事实 | `identity: MediaIdentity` | `MetadataObservation` | pure / Emby、scraper | Provider 延迟、限流、命中率、失败率 |
| `series.metadata.provider.fetch` | 获取 Series/tvshow 描述性事实 | `identity: MediaIdentity` | `MetadataObservation` | pure / Emby、scraper | Provider 延迟、剧级命中率 |
| `person.relations.resolve` | 解析演员关系并更新 Person Catalog | `metadata: MetadataObservation` | `ResolvedMetadata` | commit_once / SQLite | 匹配时间、候选数、DB 写延迟 |
| `metadata.sidecar.render` | 在 Artifact Workspace 渲染 NFO | `metadata: ResolvedMetadata` | `MetadataArtifact` | staged_write / filesystem | 渲染时间、产物字节数、写延迟 |
| `series.metadata.sidecar.render` | 在 Artifact Workspace 渲染 tvshow.nfo | `metadata: ResolvedMetadata` | `MetadataArtifact` | staged_write / filesystem | 渲染时间、产物字节数、写延迟 |
| `metadata.image.acquire` | 获取 poster 或 fanart，类型由参数指定 | `metadata: ResolvedMetadata` | `MetadataArtifact` | staged_write / filesystem | 下载延迟、图片大小、失败率 |
| `metadata.artifacts.verify` | 校验 Artifact manifest 与 checksum | `artifacts: MetadataArtifact[]` | `ArtifactManifest` | pure / filesystem、CPU | 校验时间、总字节数、损坏率 |
| `metadata.publish` | 发布 Metadata Facts 与 Artifact 引用 | `metadata: ResolvedMetadata`；`artifacts?: ArtifactManifest` | `MetadataPublication` | commit_once / SQLite | DB 写延迟、revision 冲突、重复 commit |
| `series.metadata.publish` | 发布 Series Metadata 与 tvshow Artifact 引用 | `metadata: ResolvedMetadata`；`artifacts?: ArtifactManifest` | `MetadataPublication` | commit_once / SQLite | DB 写延迟、revision 冲突、重复 commit |

## 欧美成人本机识别（6 项）

| Capability | 功能 | 输入 | 输出 | 效果 / 资源 | 性能指标 |
| --- | --- | --- | --- | --- | --- |
| `media.frames.extract` | 抽取用于识别的代表帧 | `identity: MediaIdentity` | `FrameSet` | staged_write / transcode | FFmpeg 时间、帧数、设备等待 |
| `person.faces.embed` | 为帧中人脸生成 embedding | `frames: FrameSet` | `FaceEmbeddingSet` | pure / AI | 人脸数、推理时间、无脸率 |
| `person.faces.cluster` | 将 embedding 聚类为人物候选簇 | `embeddings: FaceEmbeddingSet` | `FaceClusterSet` | pure / AI、CPU | embedding 数、聚类时间、簇数量 |
| `person.faces.match` | 将候选簇与 Reference Face 匹配 | `clusters: FaceClusterSet` | `PersonMatchSet` | pure / AI、CPU | 候选数、匹配时间、置信度、未匹配率 |
| `metadata.poster.compose` | 从人物与场景信息合成展示数据 | `people: PersonMatchSet` | `WesternPresentation` | staged_write / filesystem | 合成时间、图片尺寸、写延迟 |
| `adult.metadata.compose` | 将本机识别结果组成标准 Metadata observation | `presentation: WesternPresentation` | `MetadataObservation` | pure / CPU | 执行时间、字段完整率 |

## 欧美成人远端 Worker（5 项）

| Capability | 功能 | 输入 | 输出 | 效果 / 资源 | 性能指标 |
| --- | --- | --- | --- | --- | --- |
| `compute.asset.register` | 向计算 Worker 登记媒体资产 | `identity: MediaIdentity` | `ComputeAsset` | commit_once / worker | 注册延迟、失败率、重复注册 |
| `compute.asset.upload` | 上传或暴露资产给 Worker | `asset: ComputeAsset` | `UploadedComputeAsset` | staged_write / worker | 上传字节数、吞吐、耗时、重传率 |
| `adult.analysis.request` | 提交一次成人识别作业 | `asset: UploadedComputeAsset` | `AdultAnalysisJob` | commit_once / worker | 请求延迟、接受率、重复作业 |
| `adult.analysis.observe` | 单次观察远端作业，不在 Executor 内轮询 | `job: AdultAnalysisJob` | `AdultAnalysisResult` | pure / worker | 单次延迟、未完成比例、总观察次数 |
| `adult.metadata.normalize` | 规范化 Worker 结果 | `analysis: AdultAnalysisResult` | `MetadataObservation` | pure / CPU | 规范化时间、字段完整率、无效率 |

## Transcode 与输出决策（11 项）

| Capability | 功能 | 输入 | 输出 | 效果 / 资源 | 性能指标 |
| --- | --- | --- | --- | --- | --- |
| `container.remux` | 将光盘类或容器不合规来源重新封装为暂存资产 | 无 | `StagedMediaAsset` | staged_write / transcode | 耗时、实时倍率、输入输出字节、设备等待 |
| `media.transcode.precheck` | 解析来源、设备池、码率策略、工作区和 DV 条件 | `sourceAsset?: StagedMediaAsset` | `TranscodePrecheck` | pure / transcode | 探测时间、可用设备数、无策略率 |
| `transcode.tonemap.accept` | 承载 Dolby Vision Tonemap 条件审批 | `precheck: TranscodePrecheck` | `TranscodePrecheck` | pure / approval | 审批等待、拒绝率 |
| `media.transcode` | 按一个明确编码策略执行一次转码尝试 | `precheck: TranscodePrecheck`；`previousAttempt?: VerifiedMediaAsset` | `StagedMediaAsset` | staged_write / transcode | 总耗时、实时倍率、FPS、利用率、输出码率、失败率 |
| `output.media.verify` | 验证暂存输出可播放性、时长、编码与目标 | `stagedAsset: StagedMediaAsset` | `VerifiedMediaAsset` | pure / filesystem | Probe 时间、时长偏差、失败率 |
| `output.media.select` | 从多个验证结果选择合格输出 | `attempts: VerifiedMediaAsset[]` | `VerifiedMediaAsset` | pure / CPU | 候选数、选择时间、无合格输出率 |
| `output.media.disposition` | 决定替换或因变大/不达标而保留原件 | `verifiedAsset: VerifiedMediaAsset` | `VerifiedMediaAsset` | pure / CPU | discard 比例、预计节省字节 |
| `output.preview.generate` | 为替换审批生成预览 | `verifiedAsset: VerifiedMediaAsset` | `VerifiedMediaAsset` | staged_write / transcode | 生成时间、预览大小、设备等待 |
| `staged.asset.discard` | 安全丢弃不应提交的暂存资产 | `verifiedAsset: VerifiedMediaAsset` | `MediaReplacementEvidence` | commit_once / filesystem | 删除时间、回收字节、残留率 |
| `workspace.cleanup` | 按 Evidence 清理本 Event 的内部工作区 | `replacement: MediaReplacementEvidence` | `CleanupEvidence` | commit_once / filesystem | 清理时间、回收字节、残留数 |
| `optimization.outcome.select` | 汇合 Replace/Discard 分支为唯一结果 | `outcomes: MediaReplacementEvidence[]` | `MediaReplacementEvidence` | pure / CPU | 分支数、选择时间、非法多结果数 |

## Upgrade / MoviePilot（13 项）

| Capability | 功能 | 输入 | 输出 | 效果 / 资源 | 性能指标 |
| --- | --- | --- | --- | --- | --- |
| `integration.moviepilot.check` | 检查 MoviePilot 集成可用性 | 无 | `IntegrationEvidence` | pure / MoviePilot | API 延迟、可用率、认证失败率 |
| `media.upgrade.identity.resolve` | 解析 MoviePilot/TMDB 稳定身份 | `integration: IntegrationEvidence` | `UpgradeIdentity` | pure / MoviePilot | 解析延迟、TMDB 命中率、歧义率 |
| `source.upgrade.search` | 搜索并筛选升级候选 | `identity: UpgradeIdentity` | `UpgradeCandidates` | pure / MoviePilot | 搜索延迟、候选数、零候选率 |
| `source.upgrade.request` | 审批后提交一次下载请求 | `candidates: UpgradeCandidates` | `UpgradeRequest` | commit_once / MoviePilot | 请求延迟、接受率、重复请求、审批等待 |
| `source.upgrade.observe-download` | 单次观察下载状态 | `request: UpgradeRequest` | `DownloadObservation` | pure / MoviePilot | 单次延迟、完成率、观察次数 |
| `source.upgrade.observe-transfer` | 单次观察下载后转移状态 | `request: UpgradeRequest`；`download: DownloadObservation` | `TransferObservation` | pure / MoviePilot | 单次延迟、转移耗时、失败率 |
| `source.upgrade.output.resolve` | 从转移结果定位暂存媒体 | `transfer: TransferObservation` | `StagedMediaAsset` | pure / filesystem | 路径解析时间、候选文件数、失败率 |
| `source.upgrade.output.settle` | 单次确认输出文件已停止变化 | `stagedAsset: StagedMediaAsset` | `StagedMediaAsset` | pure / filesystem | 检查时间、未稳定率、大小变化 |
| `media.identity.inspect` | 对升级输出做强身份一致性检查 | `stagedAsset: StagedMediaAsset` | `IdentityInspection` | pure / filesystem | 检查时间、匹配率、冲突率 |
| `series.upgrade.identity.resolve` | 解析 Series + Season 升级身份 | `integration: IntegrationEvidence` | `UpgradeIdentity` | pure / MoviePilot | TMDB/Season 完整率 |
| `source.season-upgrade.search` | 搜索严格匹配指定 Season 的 package | `identity: UpgradeIdentity` | `UpgradeCandidates` | pure / MoviePilot | 精确候选数、零候选率 |
| `source.season-upgrade.output.resolve` | 定位完整 Season 暂存目录 | `transfer: TransferObservation` | `StagedMediaAsset` | pure / filesystem | 解析时间、目录可见等待 |
| `series.season-package.verify` | 验证强身份与当前 Episode key superset | `stagedAsset: StagedMediaAsset` | `VerifiedMediaAsset` | pure / filesystem | 文件数、缺集拒绝、身份歧义率 |

## 共享提交、布局与发布（10 项）

| Capability | 功能 | 输入 | 输出 | 效果 / 资源 | 性能指标 |
| --- | --- | --- | --- | --- | --- |
| `media.identity.accept` | 对身份冲突执行条件审批后的接受 | `inspection: IdentityInspection` | `StagedMediaAsset` | pure / approval | 审批等待、冲突接受率 |
| `optimization.objective.verify` | 验证无需重资产处理时 Objective 已满足 | 无 | `ObjectiveVerification` | pure / CPU | 验证时间、通过率 |
| `media.file.replace` | Movie/Adult Transcode/Upgrade 共用的回滚安全单文件替换 | `verifiedAsset: VerifiedMediaAsset` | `MediaReplacementEvidence` | commit_once / filesystem | 替换时间、字节数、回滚、审批等待 |
| `series.season.replace` | 事务性整季替换并发布 SourceMutationResult | `verifiedSeasonPackage: VerifiedMediaAsset` | `SourceMutationEffect` | commit_once / filesystem | 文件数、字节数、回滚、审批等待 |
| `source.organize` | 整理媒体布局并发布 SourceMutationResult | 无 | `SourceMutationEffect` | commit_once / filesystem | 移动字节数、耗时、跨卷复制率、失败回滚率 |
| `metadata.artifacts.materialize` | 原子写入已验证的 NFO/图片到最终目录 | 无 | `ArtifactMaterialization` | commit_once / filesystem | 文件数、字节数、fsync/rename 延迟、失败率 |
| `filesystem.layout.verify` | 验证整理和 Artifact 落盘后的布局 | `materialization?: ArtifactMaterialization` | `LayoutVerification` | pure / filesystem | stat 数、验证时间、布局失败率 |
| `series.assets.layout.verify` | 汇合并验证 Series 当前 Asset 路径 | `outcomes: MediaReplacementEvidence[]` | `LayoutVerification` | pure / filesystem | Asset 数、缺失率、Volume 等待 |
| `optimization.result.publish` | 发布 Optimize canonical fact | `layout: LayoutVerification`；`replacement?: MediaReplacementEvidence` | `OptimizePublication` | commit_once / SQLite | DB 写延迟、fencing 冲突、重复 commit |
| `series.optimization.result.publish` | 汇合 Episode outcome 后发布 Series Optimize fact | `layout: LayoutVerification`；`replacements: MediaReplacementEvidence[]` | `OptimizePublication` | commit_once / SQLite | 汇合数、DB 写延迟、重复 commit |

## 数量核对

| 分类 | 数量 |
| --- | ---: |
| Basedata | 6 |
| 通用 Metadata 与 Artifact | 11 |
| 欧美成人本机识别 | 6 |
| 欧美成人远端 Worker | 5 |
| Transcode 与输出决策 | 11 |
| Upgrade / MoviePilot | 13 |
| 共享提交、布局与发布 | 10 |
| **合计** | **62** |

## 非业务 Runtime 原语

`workflow.blocked` 是第 63 个 Catalog 条目，但不是媒体处理能力。Planner 在 Objective 无可用 Capability、Library policy 禁止能力或 Runtime 缺少实现时，用它持久化稳定阻断原因。它只应统计阻断计数和原因分布，不应产生资源等待或长执行时间。

## 性能基线如何固化

1. 使用真实来源完成每类 Capability 的代表性 Graph。
2. 通过 `GET /v1/admin/diagnostics/event-performance` 导出按 Capability 与 Resource Key 分组的分位数。
3. 分别记录开发机正常 Profile、受限 Profile 与 NAS QSV canary。
4. 对内存能力、外部集成、文件系统和长耗时媒体处理分别设阈值，不共用单一超时。
5. 基线完成前，失败率、重复 commit、Permit 泄漏、状态振荡和 Capability 内隐藏轮询仍是立即失败的不变量。
