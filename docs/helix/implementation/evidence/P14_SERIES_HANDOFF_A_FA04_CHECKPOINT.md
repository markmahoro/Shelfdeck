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

- Focused vertical：`22/22 PASS`
  - Series layout/Season aggregation/overlap；
  - Candidate publication atomicity与Outbox crash rollback；
  - Handoff A stale-head、Outbox crash、Control rollback与replay；
  - FA-04 exact extension及所有 new-Subject branches；
  - real public HTTP + restart replay。
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

