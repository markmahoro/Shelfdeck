# Series 最终逐集空间接纳

2026-10-08；CURRENT_PHASE 逐集最终空间接纳工作项，基于 `ad21d67d4`。本批推进首版能力，不关闭 Phase，不声明已可部署。

## 根因与实现

原 Arca Space Check 将本批所有 Primary 大小相加，与单集上限比较；两个各自合格的 Episode 会因总量超限被错误拒绝。现按 SSOT §5.5.8 对本批最终 Product Manifest 的每个物理 Primary，按 distinct Episode 数均分，并对同集所有 part 的份额求和。比较采用 BigInt 有理数，不向下取整，不累计已上架的旧集，不计入海报等非 Primary。

Arca Space `AcceptanceCheck` 增加有界、closed、optional `episodeSpaceEvidence`，保存 Product Manifest digest、Episode scope digest、上限及逐集精确分子/分母、判定与 Evidence digest。Movie 和其他 Check 不带此字段；stale Standard 返回 stale Basis，不发出逐集通过证据。最终 Gap 仍为既有 `max_size_exceeded`，不改完整 Acceptance union / Defect 授权职责。

同时修正 Arca Structure 的错误数量限制：`requireOnePrimaryPerEpisode` 表示覆盖，不要求 Primary 数量小于等于集数；一集多个 part 有效，未携带 Episode Claim 的 Primary 仍被拒绝。Libra 最终 Conformance 从冻结 Acceptance Spec 和完整最终 Product Manifest 独立重算逐集份额，不因单文件 Verification 标记 passed 而漏掉聚合超限。缺失/多余 Episode coverage仍为明确业务 Gap。

精确算术移至 contract 层纯 helper `episode-byte-allocation.js`，由两个 Owner 各自使用；没有跨 Domain internal import、共享业务 Store 或 Owner 决策转移。没有 UI 变化或生产副作用。

## 验证证据

- 正式 Arca Capability、精确算术及 Mandatory Media 回归：46 项执行，43 通过、3 既有 skip。后续增加多 part Structure 正反例通过。
- Libra Conformance 文件 15 项通过，新增共享文件在上限 49/50/51 字节的精确边界；100 字节共用文件的每集份额为50，即使单文件 Verification 已passed，49仍拒绝、50/51通过。
- 最终受影响合同见证 / Arca Space / Conformance 3 文件共86项通过，无 skip。
- 实际隔离 Host：使用正式模板 copy→draft→preview→publish API，设置Series每集24字节上限；两集各24字节，总量48字节，完成正式Handoff B和唯一Season Entry。持久化Space Check保存两集`24/1`及passed，不是单独数学helper测试。该样本35.3秒通过；24集无上限Host53.1秒通过，两项共88.9秒。Probe/Provider/Playback仍为隔离替身，不能视为真实Series媒体验证。
- 除Series Host文件外的全架构回归：2,068项执行，2,058通过、9既有skip、1历史合同见证预期失败。共享AcceptanceCheck schema变化使4个额外Capability的schema闭包相对历史见证发生变化；更新拒绝范围断言后，原文件及相关专项86项通过。历史见证内容和digest保持原值，没有授权旧合同继续执行新输入。
- Movie真实媒体隔离Host回归通过：正式Handoff B、Arca Commit及上架后维护/历史保护检查，1项通过、无skip，159.9秒。使用既有受保护fixture的隔离副本，没有操作NAS或原始媒体。
- Domain boundary与forbidden semantics检查均通过，无findings；`git diff --check`通过。
- P2无findings，aggregate为`9e33b97ab1f38ba2161bdc04a9fc939cb985352d067b60ee00c36e2aeef66698`；DDL没有变化。

日志：工作区外`E:/my_project/helix-git-consolidation-20261008/series-space-*`、`series-bounded-host.txt`、`series-arca-space.txt`。

## 未完成边界

Libra Direct入口对有上限的N:M仍显式拒绝`LIBRA_SERIES_SPACE_AGGREGATION_REQUIRED`；本批不移除该保护。Arca及Conformance能够正确评估完整N:M成品，不表示所有N:M候选已能生产到该位置。继续接线逐成员Direct/Remux/Transcode及完整分摊Basis、复杂映射纵向样本、恢复/运营/UI、真实媒体/Linux与部署资格；历史迁移测试缺口继续保留。未部署NAS，未执行Formation Reset。
