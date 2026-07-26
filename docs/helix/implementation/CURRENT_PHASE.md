# P14 Product Journey Implementation

状态：**FROZEN — Movie Production → Handoff B Offer 等待独立复验**

## 当前基线

- 分支：`codex/helix-p9`
- 已独立接受的上一检查点：`f0319035`
- PBF-18 Architecture 修正：`af880315`
- PBF-18 在实现分支的纳入提交：`8cce8e80`
- PBF-18-R1 Architecture 修正：上游 `e35b93bd`，原样纳入提交
  `1cba7b57`
- PBF-18-R1 Implementation Closure：`7531c6ba`
- Architecture SSOT 没有实现线程额外修改。
- `F02.17` 仍为 `NOT_RUN`；不得增加测试便利接口或用内部 Store 证据冒充
  用户 Feature。

## 当前冻结点

同一 disposable Movie 已沿正式 T-shaped 产品旅程推进至：

`active Libra Run → Workspace / production → Product Facts / Artifact /
Staging / Conformance → immutable OnDeckProductPackage → open Handoff B Offer`

Related NFO 是最高优先级 metadata observation；TMDB 只在 Acceptance Spec
仍未满足时通过 typed Provider path 调用。原 Movie/NFO bytes 与 mtime 未改变。
生成或变化的 Product 仅存在于 Libra Workspace。

本检查点已通过三类 crash/restart/replay：Workspace 物理效果后、Product
Fact/Artifact commit 后、Package/Control/Offer 原子提交后。重启均恢复同一
effect、Facts、Package、Product Delivery snapshot 与 Offer，不产生重复。
PBF-18-R1 已将 `packageDigest` 扩展为完整 nominal Package content digest；
读取端从全部关系重建并重算同一 digest，commit-only `publishedAtMs` 不进入
内容摘要。不存在 pending/placeholder Control、手选字段摘要或提交后覆盖
member。

机器库存保持 112 Capabilities / 97 Result families / 177 tables /
43 canonical transactions / 114 routes / 18 UI surfaces；完整 architecture
gate 通过且 `prohibitedActionsRun=[]`。详细施工证据见
`docs/helix/implementation/evidence/P14_MOVIE_PRODUCTION_HANDOFF_B_OFFER_CHECKPOINT.md`。

## 下一步

等待 Architecture / P14 独立复验。通过后才可进入 Arca Handoff B
Acceptance、Off-load 与 On-deck Commit，最终验证 Shelf Entry、Deck Fact
及 disposable Target 文件结果。不得提前进入 Series、JAV、Western Adult
或恢复横向 Feature Matrix。

## 硬边界

- 保留 P14 disposable sample roots；不得触碰 NAS 或原始样本。
- Service-only：不得触碰 Worker、Desktop、Ollama、Python/FastAPI。
- 不得修改 SSOT，不得引入兼容/双路径、hidden Store read、外域
  latest/current scan、legacy fallback 或跨 Owner 写入。
- 当前检查点不声明 Handoff B Accepted、Arca On-deck、Movie 端到端旅程或
  Beta 完成。
