# P14 Series Delta Construction Contract

状态：**FROZEN — SERIES-ONLY CONSTRUCTION BASELINE**

## 基线与范围

- 已接受 Movie backend 基线：实现 `468b4ee8`，P14 evidence `219acac2`。
- Architecture SSOT 保持只读；Implementation Contract 只冻结 Series 相对 Movie
  的差异，不复制机器 Schema 全文。
- 复用现有 P14 disposable Series library；优先使用其四个 bounded Episode
  functional slices 与既有 related NFO/artwork。不得触碰来源/NAS。
- 顺序固定为三个检查点：
  1. Procurement Series Triage → Candidate/Handoff A → FA-04；
  2. Libra Episode-scoped Run/Workspace/Production → open Handoff B；
  3. Arca On-deck/Shelf Entry extension → Libra completion/offload cleanup。
- 三个检查点完成前不进入 JAV、Western Adult 或横向 503。

## Series 差异合同

### Procurement / Handoff A

- Triage group 粒度固定为 Season；一个 Candidate 的 Primary Input Manifest 可包含
  `1..N` Episode media members，每个 member 保存 `1..N` parent-local Episode
  claims，允许 N:M，但同一 claim relation 不重复。
- Episode key 使用已冻结的 Season-local canonical key；文件名/目录只产生
  Triage Evidence，不能升级为 Canonical Identity。
- Episode NFO、Season NFO、poster/fanart 与 Episode artwork 均为
  Related Material Reference 或 Artifact evidence，不成为独立 Primary、不获得
  独立 Field membership/Control。
- Candidate Package 无损保存 Season Continuity Claims、Primary→Episode N:M
  relations、Related References、Identity/Profile/Structure Evidence。
- FA-04 唯一 extension 条件：
  exact `provider_season_identity` 或 persistent `triage_grouping_lineage`；
  恰好一个 active Season Subject match；Candidate Episode scope 与 Subject
  Episode scope 零重叠。任一条件不满足均创建新 Subject，不做猜测。
- Intake Acceptance 与 Control transfer 继续使用既有 P8 canonical transaction；
  crash/replay 只形成一个 Decision、Subject revision、Binding set 与 Receipt。

### Libra Production / Handoff B

- Subject/Run scope 固定为 `structureKind=season, contentProfile=series`；每个 Run
  冻结自己的 immutable Episode Delivery Manifest，不锁死整个 Season。
- Acceptance Spec 对 Manifest 中每个 Episode 独立冻结 metadata、NFO、HEVC 与
  per-Episode space requirement；Season 总大小不作为阻断值。
- Run Material、Workspace Reference、Product Staging、Product Manifest 与
  Conformance 全程保存 Primary/Artifact member 到 Episode claims 的映射。
- Related NFO 为 metadata/artifact 路径，不伪造 Media Probe；typed Provider
  fixture 只用于 construction 补缺，必须在 evidence 中披露，不能声明真实
  Provider acceptance。
- Handoff B Package 保持完整 Episode Manifest、Control、Provenance 与
  Attestation continuity；不新增 Domain、Owner、Handoff、Capability 或事务。

### Arca / Responsibility Closure

- 首次 On-deck Commit 建立 Season Shelf Entry/Deck Fact；后续非重叠 Episode
  delivery 只扩充同一 Entry，不创建重复 Own。
- Arca 在 accepted/commit UoW 内重验 Season identity、Episode overlap、Shelf
  Standard/Placement、Inventory/Control；重叠或重复 Own fail closed。
- Off-load Projection、24h grace、两次真实 Reference/Control audit、journaled
  Workspace cleanup 完全复用已接受 Movie 路径；只清理本 Run Workspace，不修改
  source Episode/NFO、其他 Run 或 Arca final Inventory。

## 机器门禁

- 每个检查点必须通过真实 public HTTP 与 formal Handoff message；Composition
  Root 只接线，不持 Store 或选择业务结果。
- 必备反例：multi-Episode/N:M conservation、NFO reference-only、FA-04
  0/1/N match、Episode overlap、same-offer replay、Handoff crash/restart、
  Run overlap、Product mapping drift、Shelf Entry duplicate/overlap、cleanup
  exactly-once。
- Owner audit：Procurement/Libra/Arca 只读写各自 Store；跨域只用 public
  Port/Projection/Handoff。禁止 latest/current guessing、Foundation Result
  旁读、legacy/compatibility path。
- 库存目标保持 112 Capability / 97 Result family / 177 table /
  43 canonical transaction；任何变化先按真实 Architecture gap 处理。

## 当前第一个冻结点

只实现并验收 `Series Observation/Run → Triage/Candidate Package →
Handoff A → Libra new Subject / exact Season extension`。在该检查点通过前，
不得进入 Routing、Acceptance Spec、Workspace 或 Production。
