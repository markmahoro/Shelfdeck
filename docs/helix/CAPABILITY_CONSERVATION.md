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
| Western adult video analysis | provider-specific analyze Event | gap: currently hidden inside generic `metadata.provider.fetch` |
| Person canonical resolution and item relations | `person.relations.resolve` | gap: current executor returns observations but does not persist Person relations |
| NFO rendering | `metadata.sidecar.render` to Artifact Workspace | mapped |
| Poster/fanart acquisition | `metadata.poster.acquire` / `metadata.fanart.acquire` | mapped |
| Artifact checksum/manifest verification | `metadata.artifacts.verify` | mapped |
| Metadata canonical publication | `metadata.publish` | mapped |
| Organize after scrape | Optimize `source.organize`; never Metadata | deliberately moved by accepted architecture |

## Transcode

| Legacy behavior | New owner / capability | Status |
| --- | --- | --- |
| Source/disc/season precheck | dedicated precheck/probe/remux Events where applicable | gap: current `media.transcode` hides precheck and disc/season parity is missing |
| Device and rate-control attempt plan | encode implementation policy, snapshotted in Event result | partial: device selection exists; full retry ladder parity not proven |
| Dolby Vision detection and approval | precheck evidence + Event approval prerequisite | gap: current Graph has no DV-specific approval boundary |
| FFmpeg encode | `media.transcode` | mapped for single playable file |
| Episode batch progress | Episode is the playable Kairox subject; one Event per Episode Task | deliberately replaced by Helix hierarchy model |
| Output probe, duration/codec/resolution/bitrate verification | `output.media.verify` | partial: preview, size regression and complete objective checks are missing |
| Oversized output discard | explicit output disposition capability | gap |
| Preview generation for replace approval | preview artifact capability | gap |
| Replace approval | `media.replace` Event approval prerequisite | mapped |
| Atomic replacement and retry | `media.replace` | mapped, parity audit pending |
| Partial/workspace cleanup | explicit cleanup Event/retention policy | gap |
| Basedata invalidation and Optimize result publication | Runtime post-commit + `optimization.result.publish` | partial: invalidation is currently hidden inside replace executor |

## Upgrade

| Legacy behavior | New owner / capability | Status |
| --- | --- | --- |
| MoviePilot connectivity precheck | integration health / planning prerequisite | gap in Task Graph evidence |
| Media identity/TMDB resolution | identity resolution Event | gap |
| Torrent search and candidate ranking | separate search + deterministic candidate-plan Event | partial: search exists; smart selection parity missing |
| Candidate user approval | download-request Event approval prerequisite | mapped |
| Submit MoviePilot download | `source.upgrade.request` | gap: bundled into `source.upgrade.download` |
| Observe download progress | durable `source.upgrade.observe-download` retry Event | gap: internal polling loop |
| Observe MoviePilot transfer/scrape | durable transfer observation Event | gap: internal polling/settle behavior |
| Resolve staged output | output resolution Event | gap: bundled into download executor |
| Verify TMDB/season/source identity | identity verification Event | gap |
| Verify technical Optimize objective | `output.media.verify` | partial |
| Atomic folder/file replace and rollback | dedicated commit-once replace Capability | partial: current replace is file-oriented and does not preserve old folder parity |
| Cleanup staging/backup | explicit cleanup/retention Event | gap |
| Basedata invalidation and Optimize result publication | Runtime post-commit + publish Event | partial |

## Layout, Artifacts And Source Mutation

| Behavior | New owner / capability | Status |
| --- | --- | --- |
| Move media into organized layout | `source.organize` commit-once effect | mapped |
| Persist `SourceMutationResult` | Kairox Runtime post-effect handler | gap: currently performed inside executor |
| Emit neutral source-mutation signal | Kairox Service/Runtime after durable result | gap: currently performed inside executor |
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
