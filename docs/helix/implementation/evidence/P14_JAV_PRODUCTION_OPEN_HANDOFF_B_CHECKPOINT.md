# P14 JAV Production / Open Handoff B Checkpoint

状态：**FROZEN — 待 Architecture active review / P14 独立复验**

## Baseline 与范围

- Accepted source baseline：`75425f5f`。
- P14 Routing/Spec/active Run evidence：`32e94146`
  （local tested `a8b04442`）。
- Architecture SSOT last-touch baseline：
  `6178437b8648c3557ce54d2001881cbc83748826`。
- 本检查点只覆盖：
  `active single/jav Run → Workspace / Product preparation
  → Deliverable Promotion → immutable OnDeckProductPackage
  → one open libra.product-offer.available@1`。
- 明确未进入：Arca Handoff B consumption、Inventory、On-deck、Run
  responsibility closure、Western Adult、横向 Feature Matrix。
- Architecture SSOT 未修改。

## Provider / Identity / Metadata continuity

- Candidate `jav_code=SDKI-001` 仅作为正式 Provider search 的 query/selection
  evidence。clean P5 adapter 要求 typed identity result 精确为
  `provider=jav, namespace=jav_code, providerKey=SDKI-001`；foreign key、
  foreign namespace/provider 均 fail closed。
- Resolved Product Identity 由该正式 Provider Result 建立为
  `single/jav/jav_code`。没有把 Candidate weak claim 自行升级为 Provider 或
  Arca Canonical Identity。
- Product Metadata Source Order 为 JAV Provider only。Provider metadata intent
  是 `sourceKind=provider, providerKind=jav`；所有五个必需字段的 provenance
  都是 Provider。Handoff A 的 Related NFO 仍保留在历史快照，但没有被读取为
  metadata Observation/source，也没有套用 Movie/Series NFO→TMDB 路径。
- deterministic construction fixture 返回：
  `genre,jav_code,release_date,studio,title` 与 exact JAV Provider identity。
  它只用于施工验证，不声明 real JAV Provider acceptance。
- Provider `peopleHints=[]` 时提交 closed、合法、关系集为空的 Media Cast Fact；
  其 Source Basis 仍是 exact Provider Metadata Observation Result，没有伪造
  People identity。

## Media / Artifact / Conformance / Package

- 原 Primary 通过 exact Run input Physical Read Handle 和 Media Probe，满足
  HEVC + Matroska + `.mkv`、single、≤2 GiB，因此复用 direct-original
  Product Control 分支，没有不必要的 remux/transcode。
- Workspace 只物化三项 required artifacts：
  `fanart.jpg`、`movie.nfo`、`poster.jpg`。JAV Provider 必须提供 poster/fanart
  typed bytes；NFO 从完整 Provider Metadata Draft 确定性渲染。
- 每项 Artifact 均经过 Artifact Registry Handle、
  `ArtifactManifestVerification`、role-aware Product Staging。三者 Episode
  claims 全空；Primary 同样为空。
- six-group Product Conformance 使用完整 Acceptance Spec、Media
  Requirement、Product Facts、Verified Artifact Manifest、role-aware
  Product Material Manifest；没有放宽 Requirement 或用 opaque digest 跳过。
- PBF-17/PBF-18-R1 顺序保持不变：exact Package ID → Control post-state
  projection → Product Material member/set/manifest → Attestation/Package
  digest → Receipt/Offer/Decision → atomic Promotion。
- ProductDelivery historical read 重建同一 Package：1 Primary + NFO/poster/
  fanart，零 Episode relation；Package、Attestation、Receipt、Control 与 Offer
  digest 连续。

## Owner / Transaction / Recovery

- 全部新事实、Workspace、Staging、Package 与 Offer 仍在 Libra owner-local
  application/Stores；Foundation 只执行既有 Plan/Event/Result、Effect journal
  与 canonical transaction participants。
- 无 Procurement/Arca Store 读取或跨 Owner 写。Composition 仅在正式 JAV
  Provider adapter 缺失时停在 active Run，并在 open Offer 时不触发尚未授权的
  Arca consumer。
- fault windows：
  - Workspace physical effect 后、journal/result 前；
  - Product Identity/Metadata/Media Cast/Artifact commit 后；
  - Package + Control + Offer commit 后、response 前。
- 重启/重放收敛为 3 个 active Artifact Handles、3 个 Product Staging
  references、3 个 Product Facts、1 个 immutable Package 与 1 个 pending
  Offer；没有重复物理效果、Fact、Control 或 Offer。
- Arca Acceptance/Inventory/Shelf Entry/Deck Fact 表始终为零，Offer 没有 Arca
  Inbox receipt。
- 原 JAV MKV/NFO/poster bytes、size、mtime 全程不变；所有新写入只在 disposable
  Libra Workspace。

## 验证

- JAV synthetic + retained P14 sample / built-in FFprobe：`3/3 PASS`。
- Movie/Series/JAV + Fact/Conformance/Promotion/Delivery targeted regression：
  `60/60 PASS`。
- 完整 `npm run test:helix-architecture`：
  `132 files PASS`，findings 与 `prohibitedActionsRun` 均为空。
- 机器库存：
  112 Capabilities / 97 Result families / 177 tables /
  43 canonical transactions / 114 routes / 18 UI surfaces。
- Contract aggregate：
  `30089e947738bab7933af3b606cd22336746321e05ae4d4d44a4bd5534e2d4e5`。
- Manifest aggregate：
  `351063009c3d50fe07c3fb70503bb4ff71e30b1ebef40beb3700c2e22a414b18`。

## Residual risk / 下一步

- deterministic typed JAV Provider fixture 不是 real Provider acceptance。
- 当前明确冻结在 open Handoff B Offer；Architecture/P14 ACCEPTED 前不得让 Arca
  消费 Offer，也不得开始 responsibility cleanup。
- Material Field `contentProfile Hint` Owner-row/API continuity 仍保留为
  Western 纵切前的独立 Architecture closure。
- `F02.17` 继续为 `NOT_RUN`。
