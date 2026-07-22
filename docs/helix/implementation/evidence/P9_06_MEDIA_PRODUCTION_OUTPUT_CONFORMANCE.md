# P9-06 Media Production, Output Selection and Conformance Evidence

Status: PASS

Date: 2026-07-23

## SSOT traceability

- 唯一架构来源：`TOP_DOWN_ARCHITECTURE_CONFIRMATION.md` 6.4.7.1、8.6.19及8.7。
- Product Media链固定为Acceptance Spec派生的完整`MediaRequirement@1`、Primary stream评价、Plan声明候选、显式rank选择和纯Conformance执行；Executor不读取Repository、Store、latest/current或旧Runtime。
- Architecture Agent已主动复审实现提交`4267410f`并接受P9-06；实现任务未修改SSOT，未新增Owner、Store、Handoff、Capability、事务或兼容路径。

## Implementation evidence

- Media Requirement从同一immutable Acceptance Spec完整重建并验证唯一ID/digest；Product Candidate与Verification必须逐字节命中同一Requirement，foreign/forged Requirement以closed integrity failure拒绝。
- Primary Video/Audio只取全部`dispositionDefault=true`的流；无default时只取最低`streamIndex`。secondary stream不能满足Primary codec、raster或audio要求，音频只使用正式`normalizedAudioClass`。
- direct input逐字节验证Run immutable Material Handle digest/fence；workspace output逐字节验证同Run Workspace Media Handle、Target、Intent、Effect Receipt及Probe连续性。
- Artifact Verification逐项验证完整Artifact Requirement、Verified Manifest item、Result ref、Handle及verification/basis digest；不相关的passed Result不能证明NFO可渲染或图片可解码。
- Output Selection只按Plan冻结的显式rank及verification ID tie-break选择，不使用caller数组位置、文件大小或运行时间。
- Product Conformance Coordinator只装配显式Plan-bound Owner rows和Foundation typed Results；pure Executor评估Identity、Structure、Metadata、Mandatory Media、Space与Inventory六组closed规则。
- media effect通过Effect Journal按同一idempotency key重放；restart返回同一Workspace output，不产生第二份输出。

## Machine counterexamples and tests

- schema-first正例在执行前验证完整输入/Result；错误`normalizedClass`、缺失stream事实和open DTO均拒绝。
- 反例覆盖secondary non-default 4K/audio、foreign Media Requirement、unrelated Artifact Requirement verification、同Handle ID但digest/fence/Run不同、错误Target/Receipt及非法rank。
- `p9-media-production-contracts.test.js`与`p9-product-conformance.test.js`：15/15 PASS。
- P9-06接受点完整`npm run test:helix-architecture`：768/768 PASS；后续PBF-16机器合同重物化后的完整门禁继续PASS。
- 未运行E2E、Docker、Canary、生产、真实FFmpeg/媒体副作用；未触碰`media-desktop`。

## Exit decision

P9-06 PASS。媒体生产输入验证、Target-bound fake-port执行、Product Media Verification、显式输出选择、完整Product Conformance、restart/replay和pure Executor边界均已闭合。下一工作包为P9-07 External material acquisition and import。
