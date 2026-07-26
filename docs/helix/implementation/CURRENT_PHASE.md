# P14 Product Journey Implementation

状态：**FROZEN — Series Production / open Handoff B 待主动复验**

## 当前基线

- 分支：`codex/helix-p9`
- P14 已接受的 Product Package / open Handoff B Offer 检查点：
  `7531c6ba`；证据 `06155670`。
- PBF-19 Architecture 修正：`ff1b833a`；实现分支原样纳入：
  `942fc692`。
- PBF-19 P14 独立接受证据：`de0dff64`（tested `3d9ebab4`）。
- 当前实现检查点：本次提交；详细施工证据见
  `docs/helix/implementation/evidence/P14_SERIES_PRODUCTION_OPEN_HANDOFF_B_CHECKPOINT.md`。
- 实现线程未额外修改 Architecture SSOT。
- `F02.17` 仍为 `NOT_RUN`；不得增加测试便利接口或用内部 Store 证据冒充
  用户 Feature。
- Movie 全链路已由 P14 独立接受：tested `c0b548ed`，evidence `219acac2`。
- Series delta 施工合同：
  `docs/helix/implementation/evidence/P14_SERIES_DELTA_CONSTRUCTION_CONTRACT.md`。
- Series Handoff A / FA-04 checkpoint：
  `docs/helix/implementation/evidence/P14_SERIES_HANDOFF_A_FA04_CHECKPOINT.md`。
- Series Routing / Acceptance Spec / active Run checkpoint：
  `docs/helix/implementation/evidence/P14_SERIES_ROUTING_SPEC_RUN_CHECKPOINT.md`。
- P14 已独立接受 Series Routing / Spec / active Run：source `643ced69`，
  tested `36ae8eb6`，evidence `a927a655`。

## 当前冻结点

P14 已独立接受 Series Handoff A、formal phased Plan/Event，以及
Routing/Acceptance Spec/active Run。当前同一 disposable Series Run 已复用
Movie production/PBF-17/PBF-18-R1公共链路推进到：

`active Series Run + E001/E002/E003 Manifest
→ Workspace admission/effects
→ Product Facts + role-aware Artifact Staging
→ six-group Conformance
→ immutable OnDeckProductPackage
→ exactly one open Handoff B Offer`

两个Primary保留exact N:M Episode continuity：第一个保存E001/E002，第二个保存
E003。生成NFO与Poster是非Primary Artifact role，`episodeClaims=[]`且使用empty
claim-set digest；Artifact scope只通过Artifact Requirement/Manifest/verification
表达。Product Package包含四个member，只冻结三条Primary member/Episode
relation。Product Delivery历史读取按`episode_delivery`重建相同的三个Primary
relation且没有Artifact relation，也没有压平N:M。原MKV、Episode NFO、tvshow NFO
和Season artwork bytes/mtime不变，物理写入仅在disposable Libra Workspace。

本段额外闭合合法Series Fact payload超过Plan 16 KiB的ordinary缺陷：
`LibraProductFactCommitPlanBinding@1`只冻结exact typed refs/digests，完整Fact
payload仍在execution/commit boundary内存组装；未放宽表上限、截断数据或建立
旁路。三个高风险故障窗口（Workspace physical effect、Fact/Artifact commit、
Package/Control/Offer commit）均证明重启只形成一个Package/Offer和一组Fact/
Workspace effects。

`ProductionMaterialManifest@1`的domain/application machine schema、Workspace
Staging与Promotion均已加入“只有Primary可携带Episode Claims”的closed guard。
完整architecture gate为`129 files / 876 tests PASS`，机器库存保持
112/97/177/43；Contract aggregate更新为
`31c50aca25c02424e214c6ddd2ba52e13452cb926e8e176e02d324958ee0d43d`。
当前明确冻结在open Handoff B Offer，未调用Arca Acceptance；等待
Architecture/P14主动复验。typed TMDB response只作为construction fixture，
不声明真实Provider acceptance。

## 已接受的 Series Handoff A 基线

Series disposable journey 已经通过正式 Admin HTTP 与 Handoff A public port 推进到：

`Field Observation → one group/series/season Candidate Package
→ immutable Offer / Candidate Delivery Snapshot
→ Libra Accepted Intake / new Season Subject
→ Episode scope + Binding + Material Control transfer`

同一 Season 的多 Episode Primary 被聚合到一个 Candidate；NFO/图片保持 Related
Reference，不成为第二个 Primary。当前 sample 没有稳定 Series-level Provider
anchor，也没有可合法使用的 persisted grouping lineage，因此 Candidate 的 exact
continuity claim 集为空，FA-04 正确选择 `new_subject`；未按标题、路径或目录猜测
extension。

初版检查点的定向 `22/22` 与完整 architecture `128 files` 均 PASS，机器库存保持
112/97/177/43。P14 `595358b5` 指出的跨 Series sidecar association 随后已收紧为
parent-local exact Season topology。P14 `ac0ae793` 指出的 oversized inline
CandidateDraft，以及 Architecture对 `f911023a` 发现的 pre-Plan Probe与未物化
binding schema，现已一并闭合为正式 phased Work/Plan/Event + generated closed
binding union。最终 Procurement/Series定向 `54/54`、完整 architecture
`128 files / 871 tests` 均 PASS，并已由 P14 独立接受。

## Movie accepted baseline

同一 disposable Movie 已沿正式 T-shaped 产品旅程推进至：

`Arca Handoff B Accepted / On-deck Commit →
Libra accepted message consumption / Run complete →
Arca durable Off-load Completion projection（Signal可丢失） →
24h grace + 两次真实、间隔一个cycle的Reference/Control audit →
Workspace cleanup / Reference release / terminal reclaim`

PBF-19 修正后，Assessment 只留下 `active` Acceptance Attempt。唯一
`helix.transaction.handoff-b-accepted` 在同一 UoW 内完成：

- exact Attempt `active → accepted` CAS；
- Shelf active、Standard revision、Placement revision 重验；
- Acceptance Decision、immutable Final Inventory Decision、initial On-deck Run；
- Custody、Bindings、Material Control transfer；
- Receipt、Result、marker、Accepted Outbox。

事务失败时 Attempt 仍为 active，且上述 Accepted 责任事实全部不存在；事务成功时
全部同时存在。后续 On-deck Store 只验证该 Process Root，不再通过第二事务创建
Run/Decision。On-deck Commit 仍是唯一建立 Shelf Entry、Inventory、Deck Fact 与
Own 的边界。

原 Movie/NFO 与 unrelated NFO bytes/mtime 均未改变，Arca final Shelf
Inventory 保持存在。Libra Run 已 terminal completed；cleanup Scope、全部
Workspace members/References、Workspace 与 Foundation Registry 已按正式合同
terminal reclaimed。

## 验证

- PBF-19 transaction-internal fault：
  Attempt CAS、Run/Decision insert、Control、Receipt、Outbox 五个边界；
- 既有 effect/recovery fault：
  Handoff B Accepted 后、首个 Inventory 物理效果后、On-deck Commit 后；
- 每次 pre-commit fault 均证明零部分 Accepted 责任事实；重启/重放只形成一份
  Attempt terminal state、Run、Decision、Custody、Control、Receipt 与 Outbox；
- 最终 cleanup 额外覆盖 physical-effect-before-journal 与
  member-commit-before-response 两个 crash window；重启只复用同一
  Scope/Effect/Receipt；
- Cleanup Admission 修正额外覆盖 first/early/second observation、restart
  重新计时、other-reference/Control stale、Signal lost + durable Projection；
- 修正定向组合回归：`13/13 PASS`；
- 完整 `npm run test:helix-architecture`：`126 files PASS`；
- 机器库存：112 Capabilities / 97 Result families / 177 tables /
  43 canonical transactions / 114 routes / 18 UI surfaces；
- Contract aggregate：
  `45ba7a467e7411c7671587cb5b265b1cedf9a53974d76b7a7209d7d80923574e`；
- Manifest aggregate：
  `35d209a3c5141d397b824796995508a453035df2420b032e34fc83b0a4cfe829`；
- `prohibitedActionsRun=[]`。

详细证据见
`docs/helix/implementation/evidence/P14_MOVIE_ARCA_ONDECK_CHECKPOINT.md`。

## 下一步

Architecture/P14 接受后，只推进同一 Series Package/Offer 的Arca Handoff B、
On-deck与最终责任closure；不得提前进入JAV、Western Adult或横向Feature Matrix。

## 硬边界

- 保留 P14 disposable sample roots；不得触碰 NAS 或原始样本。
- Service-only：不得触碰 Worker、Desktop、Ollama、Python/FastAPI。
- 不得修改 SSOT，不得引入兼容/双路径、hidden Store read、外域
  latest/current scan、Foundation Result fallback、legacy fallback 或跨 Owner
  写入。
- 当前检查点只声明 Series Production / immutable Product Package / open Handoff B
  construction vertical 已实现，不声明Series Arca On-deck、端到端、Provider、
  Feature/UI或Beta完成。
