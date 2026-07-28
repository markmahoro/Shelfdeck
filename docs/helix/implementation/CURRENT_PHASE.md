# P14 Product Journey Implementation

状态：**H1.0 CHECKPOINT FROZEN — 等待 Architecture 主动复审与 P14 独立验收**

## H1-only 授权与阶段门

P14 已独立接受 Western final responsibility closure：source `ddc3e519`，
tested local `210b2262`，evidence `6866b68e`。Movie、Series、JAV 与
Western Adult 四条 backend vertical 均已到达 terminal responsibility
closure。`ddc3e51909ca4e9f5729c4326b05daee4792326f` 从现在起是 H1 的
immutable regression baseline。

用户当前只授权 H1，且要求逐 phase 推进：

1. `H1.0` Governance + read-only preflight/change-scope guard；
2. `H1.1` Platform secure Integration config foundation + real TMDB 最小纵切；
3. `H1.2` real Douban、JAV/Adult、MoviePilot、optional Emby integrations；
4. `H1.3` Libra Workspace、Arca Aftercare、Artifact Roots、安全 probe 与本机
   device/resource readiness；六条 Worker route 继续 Beta `404`；
5. `H1.4` service-local Node/ONNX face runtime，复用 PBF-23 formal chain，
   不得引入 Python 或独立服务；
6. `H1.5` Setup/Readiness projections、H1 全量回归与 Feature 证据归档；
7. H1 完成后 **HARD STOP**；未经用户明确授权不得进入 H2。

每个 phase 都必须经过：

`implementation checkpoint → Architecture 主动复审 → P14 独立验收
→ 下一 phase`

实现线程不得自行 accept，也不得在前一 phase 未被双重接受时开始后一 phase。
Luna Runner 只可由 Architecture 线程创建、调度、接收、终止与归档；P14 只提交
已冻结的重复测试清单，不直接触发 Luna。Luna 只跑确定性大批量回归，不分析
异常、不修复、不宣布 PASS。

H1 是施工批次，Feature Matrix 是用户结果验收表。一项 H1 基础能力可以支撑多个
Feature，但不会自动把任何 Feature 标为 PASS。四条已接受 backend vertical
同样不能折算为真实 Admin route 或 Feature PASS。

## H1.0 冻结施工图

本 checkpoint 只修改 implementation docs，并增加一个机械 scope/regression
guard；没有修改业务实现、Architecture SSOT 或 Feature baseline。只读盘点结果
与后续 phase 的 allowed modules、forbidden vertical core、sentinel regressions、
历史 ignored 配置边界及潜在 Design Return 已冻结在：

`docs/helix/implementation/evidence/P14_BETA_IMPL_03_PRODUCT_SURFACE_CONSTRUCTION_MATRIX.md`

机械 guard：

`media-service/scripts/p14-h1-change-scope-guard.js`

它以 `ddc3e519` 为 baseline，按 phase allowlist 检查完整 diff，并对以下路径
始终 fail closed：Architecture SSOT、Feature baseline、Procurement/Libra/Arca
Domain core、全部 formal contracts/DTO、Foundation runtime、legacy `app.js`、
Worker 与 Desktop。H1 只允许在正式 Port、Adapter、Platform config、
Composition seam 接入真实输入。若完成真实接线必须修改上述 immutable scope、
Owner/Handoff/Canonical Transaction 或正式 DTO，立即返回 bounded Design
Return，不绕开 guard。

当前机器盘点为 `112 Capability / 97 Result / 178 Table / 43 Canonical
Transaction / 114 routes / 18 UI surfaces`。真实路由状态为 `36 real / 6
intentional Worker Beta-404 / 72 unavailable-503`；旧 ledger 的 `4/6/104`
表达已纠正。四条 backend vertical 没有增加 route 实现数。

历史 ignored 配置只做了文件存在性与 key-family 盘点，未读取、输出或写入任何
secret value。后续只允许操作员把可复用值通过正式
`test-before-save → encrypted Secret Store/Secret Handle` 流程重新提交；
不得直接导入历史 runtime config。Western 的 Worker/Python/Mirex/Ollama 字段
明确不可复用。

H1.0 验证：

- scope guard unit/negative：`6/6 PASS`；
- immutable vertical sentinels：`27/27 PASS`；
- 完整 `test:helix-architecture`：`134 fixture files PASS`；
- inventories：`112 / 97 / 178 / 43 / 114 routes / 18 UI surfaces`；
- machine manifest aggregate：
  `345a974464886d213ca36ba21678bd7ad88ece5b2a081f34f4ddbc94accdc3d9`；
- contract aggregate：
  `c5a62e222ce4063f7ad05073f343e525d417f625cc937ee5f1284a2cf2090995`；
- unresolved type refs、findings 与 `prohibitedActionsRun` 均为 `0`。

本 checkpoint 完成后保持冻结，等待 Architecture 主动复审；不得开始 H1.1。

## 当前最新检查点

PBF-22 Architecture source `04f310c1` 已在实现分支原样纳入为
`6369526c`。Material Field Profile Hint 的 Procurement Owner-row/API/
Observation/Run/Retry/Triage immutable continuity 已完成并冻结，详细证据见：

`docs/helix/implementation/evidence/P14_PBF22_WESTERN_FIELD_PROFILE_HINT_PRECLOSURE.md`

机器库存为 `112 / 97 / 178 / 43`，Procurement拥有16张表；全部P7 fixtures
`57/57 PASS`，完整architecture gate为`132 files / 891 tests PASS`，
findings与`prohibitedActionsRun`为空。

P14已独立接受PBF-22（source `0df6dfe8`，evidence
`597e253b99ee788351ca32fa5b30a5f29eaeef2f`）。随后同一Western disposable
journey已通过正式Admin HTTP推进到：

`explicit western_adult Field Hint
→ Observation / active Procurement Run / phased Triage
→ immutable single/western_adult Candidate + Offer
→ CandidateDeliveryPort
→ Libra Accepted Intake / new Subject / Binding / Material Control`

Identity Claim为弱、可纠正的`western_temporary`；没有Provider/Canonical/JAV
身份升级。MKV是唯一Primary，NFO/poster只作Related Reference。Triage Result后、
Publication前故障可跨重启恢复且不重复Probe；Candidate/Handoff A全链路
exactly-once。真实保留P14 MKV已通过内置FFprobe走同一HTTP链路，全部源文件
SHA-256/size/mtime零变化。

P14已独立接受Western Handoff A（source `da96d036`，tested `c360b5f6`，
evidence `6590ffad`）。在该基线上，正式HTTP已使用active Western Shelf、
Beta Standard及Field Routing Policy继续推进到：

`resolved Routing Decision
→ ready Routing/Spec Decision Bases
→ immutable Western Acceptance Spec
→ exactly one active Libra Run + one-member run_input Manifest`

Spec精确要求`internal_identity + title`、NFO/poster、HEVC/Matroska/MKV与
1 GiB；Western Profile不声明rating，因此没有Perception query。Handoff A的
`western_temporary`仍为弱、可纠正证据，没有升级Provider/Canonical Identity。
Clean Host在缺少正式Provider adapter时停于active Run，Workspace/Product/
Handoff B/Arca表保持零。详细证据见：

`docs/helix/implementation/evidence/P14_WESTERN_ROUTING_SPEC_RUN_CHECKPOINT.md`

P14已独立接受Western Routing / Spec / active Run（source `5b7990ee`，
evidence `43c86f4c`）。PBF-23 Architecture correction `9dc37de7`已原样纳入
实现分支为`5186469a`，同一Western Run现已通过clean service-local
Frame/Embedding/Cluster/Analysis/People Match链推进到：

`Workspace / Product Facts / role-aware Staging / six-group Conformance
→ immutable OnDeckProductPackage
→ exactly one open libra.product-offer.available@1`

当前冻结在Arca消费前；详细证据见：

`docs/helix/implementation/evidence/P14_WESTERN_PRODUCTION_OPEN_HANDOFF_B_CHECKPOINT.md`

Architecture未接受首版Production实现`2a3764a5`，指出Plan binding深层shape与
Frame composite真实bytes/Effect identity两项ordinary缺陷。该replacement已将
12阶段Plan binding物化为exact closed variants，并由clean Workspace port在
engine执行前建立stable target-bound Effect/sink；Frame Artifact digest覆盖index
与实际member bytes，相同Effect identity的output drift直接fail closed。完整
architecture gate重新通过；当时冻结在同一open Handoff B Offer，Arca消费为0。

P14已独立接受该replacement（source `713aa834`，tested local `e5a0d7c6`，
evidence `eb7448e1`）。同一Western Package现已继续复用PBF-19正式receiving
path推进到：

`ProductDeliveryPort historical reconstruction
→ Arca Handoff B Accepted
→ Custody / Control / Final Inventory Decision / initial On-deck Run
→ Inventory staging
→ On-deck Commit
→ active Shelf Entry / Deck Fact / Own`

当前冻结在Arca On-deck Commit之后。Libra尚未消费Accepted或Off-load消息，
Libra Run保持active，Delivery Receipt与Workspace Cleanup Scope均为0。详细证据：

`docs/helix/implementation/evidence/P14_WESTERN_ARCA_ONDECK_CHECKPOINT.md`

P14已独立接受该Arca Handoff B / On-deck检查点（source `62dfe460`，
tested local `8e0e3d3b`，evidence `20e873e1`）。同一Western journey现已继续
复用Movie/Series/JAV已接受的共享responsibility closure推进到：

`Accepted message consumption / terminal Libra Run
→ durable Off-load Projection（wake可丢失）
→ 24h grace + 两次真实cycle-separated Reference/Control audit
→ one Cleanup Scope
→ journaled Workspace reclaim
→ released References / terminal Scope + Workspace + Foundation registry`

Run completion后、delivery ack前故障从持久完整
`LibraRunLifecycleResult@1` byte-identical重放，只补ack且不增加revision/result/
marker。首个cleanup physical effect与首个member commit后的故障均恢复同一
Scope/Effect；Reference或Control drift反例保持零Scope。Arca三成员Inventory、
Deck Fact、源文件与Target文件保持不变。详细证据：

`docs/helix/implementation/evidence/P14_WESTERN_RESPONSIBILITY_CLOSURE_CHECKPOINT.md`

## 当前基线

- 分支：`codex/helix-p9`
- P14 已接受的 Product Package / open Handoff B Offer 检查点：
  `7531c6ba`；证据 `06155670`。
- PBF-19 Architecture 修正：`ff1b833a`；实现分支原样纳入：
  `942fc692`。
- PBF-19 P14 独立接受证据：`de0dff64`（tested `3d9ebab4`）。
- 当前实现检查点：Western backend final responsibility closure；
  详细施工证据见
  `docs/helix/implementation/evidence/P14_WESTERN_RESPONSIBILITY_CLOSURE_CHECKPOINT.md`。
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

P14 已独立接受 Series final responsibility closure：source `77c21785`，
tested integration `d79ab17b`，evidence `5f6a6327`。在该冻结基线上，当前
JAV disposable journey 已通过正式 Admin HTTP 推进到：

`Field Observation
→ Procurement Eligibility / active Run / phased Triage
→ immutable single/jav Candidate Package + Offer
→ CandidateDeliveryPort
→ Libra Accepted Intake / Subject / Binding / Material Control transfer`

当前public链路只声明`mixed → jav_code`的code-positive分支。`SDKI-001`仅作为
弱、可纠正的typed `jav_code` evidence；未伪造Provider或
Canonical Identity。唯一视频为Primary；same-stem NFO、generic movie NFO与
poster仅作为local Related references，unrelated NFO不关联。formal
Plan/Event后的故障重启复用相同Probe/Triage Results，Candidate/Handoff A与
Owner rows exactly-once。真实保留P14样本已使用内置FFprobe通过同一public HTTP
journey，源文件bytes/mtime零变化。

P14 已接受 JAV Handoff A（source `26b63c4e`，evidence `94c060d1`）。
当前同一 accepted Subject 已继续通过正式 Arca Projection 与 Libra Owner-local
事务推进到：

`Field Routing Assessment/Decision
→ input-free Decision Basis
→ JAV Acceptance Spec
→ one active Libra Run + one-member single Run Material Manifest`

JAV Spec 从 `system-beta-recommended@1` Shelf Standard 精确派生：identity
`jav_code`、single structure、HEVC + Matroska + `.mkv`、2 GiB，且不声明
rating Decision Input，因此未调用或伪造 Perception Resolution。Run Manifest
恰有一个 Primary，Episode claims 为空。正式 JAV Provider adapter 尚未装配，
clean host 在 active Run 停止，Workspace/Product/Production 表保持零写入。

P14 已接受 JAV Routing/Spec/active Run（source `75425f5f`，evidence
`32e94146`）。当前同一 active Run 已继续推进到：

`Workspace admission/effects
→ exact typed JAV Provider identity/metadata
→ Product Identity/Metadata/empty Media Cast Facts
→ NFO/poster/fanart verification + Product Staging
→ six-group Conformance
→ immutable OnDeckProductPackage
→ exactly one open libra.product-offer.available@1`

Resolved Identity 精确为 `provider=jav, namespace=jav_code,
providerKey=SDKI-001`，Candidate weak code只作为query evidence。Metadata五个
必需字段全部来自JAV Provider Observation；Related NFO没有成为metadata source。
Provider无人物数据时提交closed empty Media Cast关系。Primary满足既有HEVC/
Matroska/MKV与2 GiB要求，三项Artifact在disposable Workspace生成并经过
role-aware Staging；全部Product members的Episode claims为空。

当前冻结在JAV open Handoff B Offer，Arca Acceptance/Inventory/Entry/Deck Fact
均为零。详细证据见
`docs/helix/implementation/evidence/P14_JAV_PRODUCTION_OPEN_HANDOFF_B_CHECKPOINT.md`。
完整architecture gate为`132 files PASS`，机器库存保持112/97/177/43，
Contract aggregate
`30089e947738bab7933af3b606cd22336746321e05ae4d4d44a4bd5534e2d4e5`，
Manifest aggregate
`351063009c3d50fe07c3fb70503bb4ff71e30b1ebef40beb3700c2e22a414b18`，
findings与`prohibitedActionsRun`均为空。

纯Triage contract同时锁定：显式`jav` Hint下，无合法番号时
`displayIdentity`使用既有title回退，不生成`javCode`或`jav_code` hint；
相同文件在`mixed`下仍进入movie fallback。Material Field contentProfile Hint的
Owner-row/API连续性当前尚未实施，本检查点未新增Field列/API或临时注入；该缺口
须在Western纵切前单独Architecture closure。

## 已接受的 Series responsibility closure

P14 已接受 Series Arca Handoff B / On-deck checkpoint `b0d1163e`
（evidence `f10a3890`）。当前同一 Series Run 又沿已接受的 Movie closure
合同完成：

`arca.product.accepted@1
→ Libra Delivery Receipt / Inbox / terminal Run
→ durable Off-load Completion Projection
→ 24h grace
→ 两次真实、间隔一个cycle的Reference/Control audit
→ one Cleanup Scope
→ journaled Workspace reclaim
→ Reference release / terminal Workspace + Foundation registry`

Signal丢失时仍由durable Projection推进。首次观察不创建Scope，重启会重新开始
真实两周期计时；第二次观察后Admission UoW再次精确读取References与current
Controls。Run completion后、delivery ack前故障会从正式Inbox恢复并只补ack，
并直接返回持久化完整`LibraRunLifecycleResult@1`；公开Result与首次commit的
canonical JSON/digest byte-identical，不重复Run revision/Result/marker。
Cleanup physical effect后及member commit后故障均只恢复同一Scope/member/effect。

Libra Workspace回收后，Arca final Inventory与Deck Fact保持不变并可历史重建：
两个Primary分别保持`[E001,E002]`和`[E003]`，NFO/Poster保持empty claim set。
cleanup仅按exact Workspace Reference/Control工作，不读取或重解释Episode rows。
原Series源文件bytes/mtime保持不变。

Series责任闭环已经由Architecture/P14接受，作为当前JAV纵切的冻结基线。
typed TMDB response仍仅为construction fixture，不声明真实Provider acceptance；
`F02.17`仍为`NOT_RUN`。

定向责任闭环组合回归`28/28 PASS`；完整architecture gate为
`130 files / 880 tests PASS`，机器库存保持112/97/177/43，Contract aggregate
`30089e947738bab7933af3b606cd22336746321e05ae4d4d44a4bd5534e2d4e5`，
Manifest aggregate
`351063009c3d50fe07c3fb70503bb4ff71e30b1ebef40beb3700c2e22a414b18`，
findings与`prohibitedActionsRun`均为空。

## 已接受的 Series Arca On-deck 基线

P14 已独立接受 Series Handoff A、formal phased Plan/Event、
Routing/Acceptance Spec/active Run，以及 Production/open Handoff B。当前同一
disposable Series Run 已复用 Movie PBF-19 receiving-owner path推进到：

`open libra.product-offer.available@1
→ ProductDelivery historical reconstruction
→ Arca Handoff B Accepted
→ Custody / Binding / Control transfer
→ Inventory staging / physical effect
→ On-deck Commit
→ active Series Shelf Entry / Deck Fact / Own`

PBF-20与其`sourceMaterialKey`有界修正已原样纳入。一个E001/E002双Episode
Primary在Arca中仍只有一条Material Binding与一条Inventory Material；E003保存于
第二条Primary。NFO/Poster的Episode Claim集合保持empty。`ArcaMaterialEpisodeClaims@1`
以closed、UTF-8有序、唯一、0..32、16 KiB machine contract持久化完整集合，
Binding evidence、Inventory Representation与Deck Fact历史读取都重算相同集合。
`StagedInventoryManifest`同时保存source Product materialKey与新的target
Physical materialKey，按source/target排序且分别唯一；Inventory只写target key。

Handoff B Accepted事务中断证明Attempt保持active且Accepted责任集合全无；
Inventory物理效果后中断保留可恢复journal且没有Shelf Entry；On-deck Commit后
中断重启只历史重建同一Entry、四条Inventory Material与一份Receipt。Deck Fact
读取从exact Inventory rows重算Representation，再用原Package digest、
Standard/Inventory/Deck revision重算Fact；篡改Fact digest后fail closed。

完整architecture gate为`130 files / 880 tests PASS`，机器库存保持
112/97/177/43；Contract aggregate更新为
`30089e947738bab7933af3b606cd22336746321e05ae4d4d44a4bd5534e2d4e5`。
当前明确冻结在Arca On-deck Commit之后、Libra消费Accepted/Off-load消息之前；
等待Architecture/P14主动复验。typed TMDB response只作为construction fixture，
不声明真实Provider acceptance。原Series/NFO/artwork bytes/mtime不变，Arca
Target写入只发生在disposable路径。

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

等待Architecture active review与P14独立复验Western backend responsibility
closure检查点。接受前不得恢复横向Feature Matrix，也不得扩大到UI/Provider/
Worker/Desktop/Ollama/NAS。

## 硬边界

- 保留 P14 disposable sample roots；不得触碰 NAS 或原始样本。
- Service-only：不得触碰 Worker、Desktop、Ollama、Python/FastAPI。
- 不得修改 SSOT，不得引入兼容/双路径、hidden Store read、外域
  latest/current scan、Foundation Result fallback、legacy fallback 或跨 Owner
  写入。
- 当前检查点只声明 Western core backend responsibility closure 已实现，不声明
  Real Provider、Feature/UI或Beta完成。
