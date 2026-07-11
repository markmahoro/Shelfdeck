# Kairox Capability Conservation Matrix

Status: active closure evidence; subordinate to `ARCHITECTURE.md` and `CURRENT_PLAN.md`.

本文用于证明复杂 Flow Executor 原子化时没有静默丢失有效能力。每一行必须具有明确的新 owner、可执行 Capability/Event 或明确的产品删除决定；`gap` 行阻止 atomic runtime closure。

## Atomicity Rule

一个 Capability Executor 只能完成一个可命名的业务效果，并返回一个 durable Event result。它可以调用完成该单一效果所需的底层 protocol/library，但不得：

- 在内部轮询跨越多个业务阶段；
- 调用另一个 Capability Executor；
- 创建或追加 Graph 节点；
- 写 Task status、推进 Gate 或选择后续 Capability；
- 隐藏 approval、resource wait、retry/recovery 或 commit 边界。

Capability 采用 nominal、versioned internal API。Planner 必须声明并校验每个 output-to-input binding；Executor 只接收已解析 input ports。相同效果必须合并：所有 staged media producer 均输出 `StagedMediaAsset`，并复用唯一的 `output.media.verify` 和 `media.replace`。

## Domain Owner Audit

| Capability group | Domain owner | Boundary |
| --- | --- | --- |
| source observation、SourceBinding、rebind、offboarding cleanup | Nexora | 不得进入 Kairox Capability Catalog |
| basedata/metadata/optimize observation and mutation for admitted media | Kairox | 可以作为 Kairox Capability |
| Membership、admission generation、mutation coordination | Libra | Runtime 只发 durable neutral result/signal |
| `source.organize` | Kairox Optimize | 只提交在库布局 mutation；不得直接 rebind 或写 SourceBinding |
| `media.replace` | Kairox Optimize | 通用 staged asset commit；不得直接写 Nexora facts |

## Basedata

| Legacy behavior | New owner / capability | Status |
| --- | --- | --- |
| Emby item observation | `emby.item.observe` | mapped |
| Folder source FFprobe/stat observation | `filesystem.media.probe` | mapped |
| Layout observation | `filesystem.layout.observe` | mapped |
| Observation validation | `basedata.verify` | mapped |
| Canonical Basedata publication | `basedata.publish` | mapped |
| Season-level episode aggregation | Libra Series scope + playable Episode admission; containers do not create Kairox Tasks | deliberately removed from Kairox execution |

## Metadata

| Legacy behavior | New owner / capability | Status |
| --- | --- | --- |
| Emby descriptive metadata observation | `metadata.provider.fetch` with Emby adapter | mapped |
| JAV ID extraction and provider scrape | `media.identity.resolve` + provider-specific fetch | partial: identity resolver is currently a pass-through |
| Western adult local video analysis | `media.frames.extract -> person.faces.embed -> person.faces.cluster -> person.faces.match -> metadata.poster.compose -> adult.metadata.compose` | mapped |
| Western adult Worker analysis | `compute.asset.register -> compute.asset.upload -> adult.analysis.request -> adult.analysis.observe -> adult.metadata.normalize` | mapped; observe performs one status read per Event attempt |
| Person canonical resolution and item relations | `person.relations.resolve` | mapped; writes Kairox Person Catalog relations |
| NFO rendering | `metadata.sidecar.render` to Artifact Workspace | mapped |
| Poster/fanart acquisition | `metadata.poster.acquire` / `metadata.fanart.acquire` | mapped |
| Artifact checksum/manifest verification | `metadata.artifacts.verify` | mapped |
| Metadata canonical publication | `metadata.publish` | mapped |
| Organize after scrape | Optimize `source.organize`; never Metadata | deliberately moved by accepted architecture |

## Transcode

| Legacy behavior | New owner / capability | Status |
| --- | --- | --- |
| Source precheck | `media.transcode.precheck` | mapped for playable files; disc Remux remains below |
| Device and rate-control attempt plan | precheck evidence consumed by encode Event | partial: plan is snapshotted; verify-driven retry ladder remains gap |
| Dolby Vision detection and approval | `media.transcode.precheck -> transcode.tonemap.accept` conditional approval | mapped |
| FFmpeg encode | `media.transcode` | mapped for single playable file |
| Episode batch progress | Episode is the playable Kairox subject; one Event per Episode Task | deliberately replaced by Helix hierarchy model |
| Output probe, duration/codec/resolution/bitrate verification | `output.media.verify` | partial: preview, size regression and complete objective checks are missing |
| Oversized output discard | explicit output disposition capability | gap |
| Preview generation for replace approval | shared `output.preview.generate` | mapped |
| Replace approval | `media.replace` Event approval prerequisite | mapped |
| Atomic replacement and retry | `media.replace` | mapped, parity audit pending |
| Partial/workspace cleanup | `workspace.cleanup` | mapped after successful replacement; failure/cancel retention cleanup remains gap |
| Basedata invalidation and Optimize result publication | Runtime post-commit + `optimization.result.publish` | partial: invalidation is currently hidden inside replace executor |

## Upgrade

| Legacy behavior | New owner / capability | Status |
| --- | --- | --- |
| MoviePilot connectivity precheck | integration health / planning prerequisite | gap in Task Graph evidence |
| Media identity/TMDB resolution | identity resolution Event | gap |
| Torrent search and candidate ranking | separate search + deterministic candidate-plan Event | partial: search exists; smart selection parity missing |
| Candidate user approval | download-request Event approval prerequisite | mapped |
| Submit MoviePilot download | `source.upgrade.request` | mapped |
| Observe download progress | durable `source.upgrade.observe-download` retry Event | mapped; no Executor polling loop |
| Observe MoviePilot transfer/scrape | durable `source.upgrade.observe-transfer` retry Event | mapped; explicit settle evidence still pending |
| Resolve staged output | `source.upgrade.output.resolve` | mapped |
| Verify TMDB/source identity | `media.identity.inspect -> media.identity.accept` conditional approval | mapped for playable Movie; Series/Season are Libra scopes and do not create Kairox Tasks |
| Verify technical Optimize objective | shared `output.media.verify` | mapped for codec/resolution/bitrate; additional source-quality dimensions remain objective-specific work |
| Atomic folder/file replace and rollback | shared `media.replace` consuming `replacementScope=file|folder` | mapped |
| Cleanup staging/backup | folder replace cleanup + shared `workspace.cleanup` | mapped for success path; failure retention cleanup remains gap |
| Basedata invalidation and Optimize result publication | Runtime post-commit + publish Event | partial |

## Layout, Artifacts And Source Mutation

| Behavior | New owner / capability | Status |
| --- | --- | --- |
| Move media into organized layout | `source.organize` commit-once effect | mapped |
| Persist `SourceMutationResult` | Kairox Runtime post-effect handler | mapped |
| Emit neutral source-mutation signal | Kairox Service/Runtime after durable result | mapped |
| Materialize selected metadata revision | `metadata.artifacts.materialize` | mapped |
| Verify final layout/materialization | `filesystem.layout.verify` | mapped |
| Libra consume/rebind/new admission | Libra Reconciler → Nexora Service | mapped and tested |

## Planner Inventory Gaps

The Planner schema currently advertises capabilities that are not registered. They must be implemented or removed from Planner, Library policy and UI as one atomic change:

- `subtitle.search`
- `subtitle.download`
- `subtitle.verify`
- `container.remux`

No `gap` or unproven `partial` row may remain when this document is marked complete.
