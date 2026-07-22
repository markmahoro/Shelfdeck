# P9-05 Product Facts, Metadata, Cast and Artifacts Evidence

Status: PASS

Date: 2026-07-23

## SSOT traceability

- 唯一架构来源：`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md` 6.4.7.1、8.5.11、8.6.19、8.6.20及8.7。
- Architecture Agent的`933ced25`闭合Western Result内部领域摘要与Foundation完整typed Result storage digest的连续性；实现分支原样纳入为`538b04e8`。
- Architecture Agent的`724286a4`把Media Cast关联从Draft移至Product Metadata Commit的显式nullable `mediaCastFactRef`；实现分支原样纳入为`98ba17b9`。
- 实现任务未修改SSOT，未新增Owner、Store、Handoff、Capability、事务、跨域补读或兼容路径。

## Implementation evidence

- Movie/Series/JAV metadata只接纳显式Libra Supporting Work链上的durable `MetadataObservation@1`，按固定来源优先级补缺；相同Intent语义重放只接受相同payload digest。
- Western metadata严格冻结Analysis Result完整storage digest、Result内部领域digest、Analysis Variant、Normalize Plan input、Normalize Result与Commit Draft的逐字节连续性；二者不混用。
- Product Metadata Draft不再携带Media Cast Draft引用；Commit显式提交`mediaCastFactRef`或`null`。非NULL引用只按`productFactId`精确读取同Run immutable Media Cast Fact，并重算完整Fact与digest，禁止latest/current扫描。
- Media Cast仍由Libra拥有；People只通过正式Projection支撑Person引用。Western `matches=[]`形成合法空relations Evidence，非空match必须被Draft relation解释。
- Artifact Requirement、Registry Handle、Verification Plan input、typed Result及Verified Artifact Manifest逐项闭合；Manifest与Product Fact、Source refs、Foundation Result/marker在同一Domain Fact Commit事务冻结。
- `libra_product_fact_source_refs`关系化保存Observation、Western Analysis+Normalize或Western Match的精确Work/Attempt/Plan/Event/Result链，历史Fact不被后来Result替换。

## Machine counterexamples and tests

- 拒绝跨Run Media Cast Fact、错误Fact revision/digest/schema、缺失显式nullable引用、伪造Draft digest及不一致Artifact链，且零Owner write。
- 拒绝把Western Result内部`resultDigest`误当Foundation storage digest、Normalize输入/输出漂移、Basis/source-ref digest漂移、Match state与relations不一致。
- SQLite isolated fixture证明Result、marker、Product Fact、Source refs全有或全无；post-marker Owner write crash全部回滚。
- 完整`npm run test:helix-architecture`：PASS；111 fixture files，dependency/semantic/contracts均`findings=[]`。
- 合同计数保持112 Capability、97 Catalog Result family、177 tables、43 Canonical Transactions；P2 aggregate为`fd28a03618c383e694933867719478fbf24f263571cfbe0b7880b55fb9696633`。
- 未运行E2E、Docker、Canary、生产、真实媒体副作用；未触碰`media-desktop`。

## Exit decision

P9-05 PASS。Metadata gap reconcile、Observation/Western Draft、Artifact验证、Media Cast/Product Metadata Fact、精确Source refs、同Run Fact引用、重放与crash atomicity均已闭合。下一工作包为P9-06 Media production, output selection and conformance。
