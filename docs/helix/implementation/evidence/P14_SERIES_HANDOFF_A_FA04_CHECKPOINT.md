# P14 Series Handoff A / FA-04 Checkpoint

状态：**FROZEN FOR ACTIVE REVIEW**

## Baseline

- Architecture SSOT：保持当前分支已纳入版本，实施线程未修改。
- Movie accepted baseline：`468b4ee8`。
- Series delta construction contract：`94ac7753`。
- Implementation closure：本检查点提交。
- 范围：只到 `Series Candidate publication → Handoff A Accepted → Libra
  Season Subject/Episode scope`；未进入 Series Routing、Acceptance Spec、Run 或
  Production。

## Closed vertical

- Procurement 只把可播放媒体扩展名作为 Primary；Episode/Season NFO、图片及
  其他 sidecar 只能形成 Related Material association 或 unresolved read-only
  layout evidence，不会成为第二个 Primary Candidate。
- 同一 `claimedTitle + explicit season claim` 的多个 Series Primary 在一个 Run
  内聚合为一个 `group/series/season` Triage Unit；每个 Physical Material 保存
  自己的 `1..N` Episode claims，Candidate Manifest 保留完整 N:M relation。
- Candidate 内部 Episode overlap 直接形成 `structure_ambiguous/not_ready`，不会
  发布冲突 Package。
- Candidate publication 在既有 Procurement canonical transaction 中原子提交
  Package、2 个 Primary、Episode relations、Related NFO relations、Offer、
  marker、Result 与 Outbox。
- Libra 仅通过正式 Candidate Delivery Port 消费 immutable Snapshot，并使用既有
  Handoff A canonical transaction原子提交 Intake Decision、Season Subject、
  Episode scope、Bindings、Material Control transfer、Receipt、Result、marker
  与 Accepted Outbox。
- 正式 Admin HTTP 覆盖 auth、Observation、Candidate/Handoff A、Owner rows、
  source zero-change 与跨重启 exact replay。

## P14 sidecar correction

P14 evidence `595358b5` 证明初版 generic/Season sidecar association 会从整个
Field 的 Primary 中选择稳定最小项，可能把 Show A 的 sidecar 绑定到 Show B。
修正后：

- Episode same-stem sidecar 仍只在同目录精确关联；
- generic `tvshow.nfo/movie.nfo` 与 Season poster/fanart 先以 sidecar 所在目录为
  parent-local scope，再按 Primary 的本地 Season topology 分组；
- 只有恰好一个本地 Season group 时，才在该已证明唯一的组内选择稳定 relation
  anchor；
- 零组或多组保持 unresolved/read-only，不通过 `stableFirst` 解决跨
  Series/Season 歧义；
- Show A/Show B 同为 Season 1 时，各自的 sidecar 只进入自己的 Candidate group；
  放在两者共同 Field root 的 generic sidecar 保持 unresolved；
- 单一 Series 的 `tvshow.nfo`、`season01-poster`、Episode NFO/artwork 仍可从
  Candidate Delivery Snapshot完整历史重建。

该修正不把目录或标题升级为 continuity identity，也不改变 Candidate、Owner、
Handoff、Capability 或 transaction。

## P14 Candidate Publication Plan binding correction

P14 evidence `ac0ae793` 证明初版 Candidate Publication Plan 把完整
`CandidateDraft` 内联到 `fx_plan_nodes.input_bindings_json`，真实 Series Draft
为 17,092 bytes，超过固定 16 KiB table contract。修正后：

- 同一 Supporting Work 的正式前序 Events 固定为
  `Media Probe → Playability → Structure → Identity Claim → Primary Manifest`；
  每个 Event 的完整 typed Result 保存在 `fx_event_result_bindings`，单项继续受
  64 KiB Result contract 约束；
- Plan node 只保存 versioned closed binding refs、完整 typed Handle，以及精确
  Run/Rule/Selection/Layout fence；Candidate Publication node 只引用 Structure、
  Identity、Manifest 的 `eventId/resultId/capabilityRef/resultSchemaRef/resultDigest`，
  不再保存完整 Draft、Related 或 Manifest arrays；
- Publication Coordinator 从上述 immutable Results 重新装配完整
  `CandidateDraft`，两次执行 canonical digest 与 `validateDraft`，然后才把完整
  Draft + Commit Handle交给既有 CommitParticipant；CommitParticipant未增加
  Foundation/Provider旁读；
- Probe只在自己的正式前序 Event执行。前序 Results提交后、Publication前崩溃，
  重启从同一 refs恢复，Probe调用次数不增加；
- Result JSON篡改、Result ref缺失/变更、binding digest不一致均在零 Candidate
  publication rows时 fail closed；
- 每个生成的 Candidate assembly Plan binding均实测不超过 16 KiB，且行内容不含
  `candidateDraft`、`relatedReferences` 或 `primaryInputManifestDraft`；
- 单个 Triage Unit的 canonical JCS bytes继续固定不超过 64 KiB；超限形成
  `triage_unit_contract_too_large`，不会转化为 Plan overflow。

该修正未提高JSON上限、未压缩/截断业务值、未引入Artifact fallback，也未新增
Capability、Result family、Owner、Store、table或transaction。

## FA-04 boundary

现有 P14 Series disposable sample 已只读核对。Episode NFO 只提供 Episode-level
TMDB ID，没有稳定 `series key + season number` Provider anchor；当前 Procurement
也没有一份可从路径/标题临时制造的 persisted grouping-lineage input。依据 SSOT，
本次真实 Candidate 的 `seasonContinuityClaims=[]`，因此 Handoff A 必须选择
`new_subject`。

这不是 continuity 缺失修复或降级：

- 标题、Season 目录、路径和 filename normalization 只用于同一 Candidate 内的
  Triage grouping/display，不会升级为 `triage_grouping_lineage`；
- `provider_season_identity`、`triage_grouping_lineage` exact one-match +
  zero-overlap 才能 `season_extension`；
- zero/multiple/overlap/no-claim 均新建 Subject；
- FA-04 exact extension、overlap、multiple、title/year/path/fuzzy negative 已由
  `p8-subject-continuity-resolver.test.js` 保持机器反例。

后续当正式 Product Identity commit 关系化 exact provider-season claim 后，新的
非重叠 Candidate 可复用同一 FA-04 路径；本检查点没有伪造 Provider acceptance。

## Evidence

- Focused vertical：`24/24 PASS`
  - Series layout/Season aggregation/overlap；
  - Candidate publication atomicity与Outbox crash rollback；
  - Handoff A stale-head、Outbox crash、Control rollback与replay；
  - FA-04 exact extension及所有 new-Subject branches；
  - real public HTTP + restart replay。
- Plan binding correction focused regression：`31/31 PASS`，覆盖 bounded rows、
  typed Result refs、tamper/missing fail-closed、crash/restart no-reprobe、
  Candidate/Handoff A replay、sidecar locality与Unit 64 KiB negative。
- Full `npm run test:helix-architecture`：`128 files PASS`。
- Inventory：112 Capabilities / 97 Result families / 177 tables /
  43 canonical transactions / 114 routes / 18 UI surfaces。
- Contract aggregate：
  `45ba7a467e7411c7671587cb5b265b1cedf9a53974d76b7a7209d7d80923574e`。
- Manifest aggregate：
  `35d209a3c5141d397b824796995508a453035df2420b032e34fc83b0a4cfe829`。
- `prohibitedActionsRun=[]`。

## Remaining risk / next blocker

- 等待 Architecture/P14 对本检查点独立复验。
- 下一段仅为同一 Series Subject 的 Routing/Acceptance Spec/active Libra Run，
  需要把 Episode scope冻结为非重叠 Episode Delivery Manifest；当前未实施。
- 未开始 Series Production/Handoff B/Arca extension/cleanup。
- 未开始 JAV、Western Adult、横向 503、Provider acceptance 或 UI/Feature
  Matrix。
