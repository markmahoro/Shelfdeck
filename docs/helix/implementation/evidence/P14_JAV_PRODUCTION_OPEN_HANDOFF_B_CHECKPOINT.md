# P14 JAV Production / Open Handoff B Checkpoint

状态：**FROZEN — 待 Architecture active review / P14 独立复验**

## Baseline 与范围

- Accepted source baseline：`75425f5f`。
- P14 Routing/Spec/active Run evidence：`32e94146`
  （local tested `a8b04442`）。
- PBF-21 Architecture correction：`bb1582af`，在实现分支原样纳入为
  `6ebdeada`。
- 本 replacement checkpoint 只覆盖：
  `active single/jav Run → Workspace / Product preparation
  → Deliverable Promotion → immutable OnDeckProductPackage
  → one open libra.product-offer.available@1`。
- 明确未进入：Arca Handoff B consumption、Inventory、On-deck、Run
  responsibility closure、Western Adult、横向 Feature Matrix。
- 实现任务没有手工修改 Architecture SSOT。

## Provider / Identity / Metadata continuity

- Candidate `jav_code=SDKI-001` 仅作为正式 Provider search 的
  query/selection evidence。Resolved Product Identity 由 typed Provider Result
  建立为 `single/jav/jav_code`；没有把 weak claim 自行升级为 Provider 或
  Arca Canonical Identity。
- `MetadataFetchIntent@1` 携带完整
  `resolvedProviderIdentity: ResolvedProviderIdentity@1`，intent digest 覆盖
  完整 tuple。Planner 从同一 Resolved Product Identity 选择
  `provider=jav, namespace=jav_code, providerKey=SDKI-001`；adapter 不反解
  digest、不读取 search cache。
- Provider adapter 只以 intent tuple 的 providerKey 查询；
  `MetadataObservation.providerIdentitySet` 必须包含逐字节相同的 tuple。
  missing/foreign identity 均 fail closed。
- `MetadataObservation@1` 的 machine contract 已物化为 closed
  Provider Identity Set：0..16 个
  `ResolvedProviderIdentity@1`、JCS UTF-8 排序、tuple unique，且
  `recordDigest`覆盖排除自身后的完整record。真实持久化的JAV
  `fx_event_result_bindings.result_json`经其声明schema及digest复验通过；
  旧`{key,value}` identity、missing/foreign exact tuple均fail closed。
- Product Metadata Source Order 为 JAV Provider only。Handoff A Related NFO
  保留在历史快照，但不作为 metadata Observation/source。
- deterministic construction fixture 返回
  `genre,jav_code,release_date,studio,title`；它只用于施工验证，不声明 real
  JAV Provider acceptance。
- Provider `peopleHints=[]` 时提交 closed、合法、关系集为空的 Media Cast
  Fact，其 Source Basis 仍是 exact Provider Metadata Observation Result。
- 当前JAV `MetadataObservation.artifactHints=[]`；Acceptance Spec中的
  Artifact Requirement不再被合成为Provider Observation hint。旧三字段
  `artifactKind/sourceRef/evidenceDigest`值按machine schema fail closed。

## Media / Artifact / Conformance / Package

- 原 Primary 通过 exact Run input Physical Read Handle 和 Media Probe，满足
  HEVC + Matroska + `.mkv`、single、≤2 GiB，因此复用 direct-original
  Product Control 分支。
- Metadata callback/Result 不携带 poster/fanart raw bytes。
- `movie.nfo` 必须通过 `libra.product_sidecar.render@1` 的正式 Supporting
  Work/Plan/Event/Result。
- `poster.jpg` 与 `fanart.jpg` 分别通过
  `libra.product_artifact.acquire@1 → ArtifactAcquisitionResult@1`，使用 exact
  IntegrationHandle/fence 与 Foundation effect journal。Verification/Staging
  只消费正式 ArtifactHandle；wrong kind、foreign handle/identity/fence 与
  `not_available` 均按 typed outcome fail closed。
- 三项 Artifact 与 Primary 的 Episode claims 均为空；每项均经过 Artifact
  Registry Handle、ArtifactManifestVerification 和 role-aware Product Staging。
- six-group Product Conformance 使用完整 Acceptance Spec、Media
  Requirement、Product Facts、Verified Artifact Manifest 与 Product Material
  Manifest；没有放宽 Requirement 或使用 opaque digest 跳过。
- PBF-17/PBF-18-R1 顺序保持：Package ID → Control post-state projection
  → Product member/set/manifest → Attestation/Package digest
  → Receipt/Offer/Decision → atomic Promotion。
- ProductDelivery historical read 重建同一 Package：1 Primary +
  NFO/poster/fanart、零 Episode relation；Package、Attestation、Receipt、
  Control 与 Offer digest 连续。

## Owner / Transaction / Recovery

- 新事实、Workspace、Staging、Package 与 Offer 均留在 Libra owner-local
  application/Stores；Foundation 仅执行既有 Plan/Event/Result、Effect journal
  与 canonical transaction participants。
- 无 Procurement/Arca Store 读取、跨 Owner 写、Foundation Result 旁读、
  latest/current scan、compatibility 或 fallback。
- fault/recovery 覆盖：
  - Provider Metadata Result 已提交、Artifact Capability 尚未完成；
  - Artifact physical effect 后、journal/Result 前；
  - Artifact Result 已提交、Event/response 尚未完成；
  - Product Fact/Artifact commit 后；
  - Package + Control + Offer commit 后、response 前。
- Metadata Result 后重启不会再次 fetch metadata；Artifact physical effect
  后从 effect reality 恢复，不依赖 caller bytes；Artifact Result 后复用正式
  Result。效果日志按各正式物理步骤独立记账，不再声称“每kind一个effect”。
- 重放收敛为3个实际Workspace Artifact输出、3个active Artifact
  Handles、1个`product_sidecar.render` Result、2个
  `product_artifact.acquire` Results、3个Product Staging
  references、3 个 Product Facts、1 个 immutable Package 与 1 个 pending
  Offer。
- Arca Acceptance/Inventory/Shelf Entry/Deck Fact 表保持为零，Offer 没有
  Arca Inbox receipt。
- 原 JAV MKV/NFO/poster bytes、size、mtime 不变；新写入仅位于 disposable
  Libra Workspace。

## 验证与机器基线

- Result machine、Product Fact、JAV persisted Result/recovery focused gate：
  `33/33 PASS`。
- Movie/Series shared production regression：`5/5 PASS`。
- 完整 `npm run test:helix-architecture`：
  `132 files / 887 tests PASS`，findings 与 `prohibitedActionsRun` 均为空。
- 机器库存：
  112 Capabilities / 97 Result families / 177 tables /
  43 canonical transactions / 114 routes / 18 UI surfaces。
- Contract aggregate：
  `c1cd53125ffc6055e57cd00b2c8a388b42405b49194ec0aa1292ff5cb350447a`。
- Result type registry：
  `96623a26fd6bed204710bd1a5b1c1580cc7832e60ddd25b0f5f08b977cabee53`。
- SSOT source-map aggregate：
  `a54b0b3934b8a5a574cf7e1d17370501564e136cdbe9c470082efe9d1f7ce209`。
- Manifest aggregate：
  `1078633da3e788979098d811d0409c1a5520e46d67aac54d33655f4288e77c37`。

## Residual risk / 下一步

- deterministic typed JAV Provider fixture 不是 real Provider acceptance。
- 当前冻结在 open Handoff B Offer；Architecture/P14 ACCEPTED 前不得让 Arca
  消费 Offer，也不得开始 responsibility cleanup。
- Material Field `contentProfile Hint` Owner-row/API continuity 仍是 Western
  纵切前的独立 Architecture closure。
- `F02.17` 继续为 `NOT_RUN`。
