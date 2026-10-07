# Series多成员Direct交付接线

2026-10-08；CURRENT_PHASE节点1「Series身份与逐集生产接线」。用户要求持续推进首个可部署Series版本，本增量不构成版本完成。

## 实现

Libra完整重建冻结Run的逐Primary Verification/Selection，拒绝缺失、重复、跨Run、Handle变更、选择摘要改写及借用其他集结果。Direct Staging/Conformance/Product Material Manifest消费完整集合；每个Primary保留自身Episode claims及Off-load source-to-final mapping。逐集NFO与Season NFO按已有Artifact生产目标区分，不给sidecar添加Episode relation。

Product Package携带完整逐Primary ShelfAcceptancePrimaryReadSet，独立核对每个来源、Product Handle与Verification，保留Movie原盘的既定来源拓扑。2/24集Host从正式Field走到Product Package发布，检验唯一Package、Primary数、Episode claims、Season+逐集NFO、读取权限及passed Conformance。Provider/Probe/Playback仍为fixture；尚未真实FFmpeg及Arca上架。

24集暴露ProductionProvenance外层64 KiB约束与SSOT 8.6.19已嵌入的1 MiB ShelfAcceptancePrimaryReadSet矛盾。本次同步SSOT 8.5表约束与8.6.21完整Provenance形状，将该Owner JSON外层上限对齐1 MiB，其他JSON、子Snapshot、16 MiB Package及Foundation Result上限不改；正式generator重建表合同和DDL。未变更Owner、Handoff或效果权限，也没有截断证据。沿既有原子schema入口扩展精确前版本digest，仅重建Package证据字节CHECK，逐字节保留原Package及引用、索引，不翻译或恢复Formation条目；已处于当前schema或由紧邻前schema升级时不执行历史UAT退休逻辑。本地验证正常升级、失败回滚、重放、FK/integrity、70 KiB可存及超过1 MiB拒绝。生产规模副本升级/镜像回退资格仍未完成，禁止宣称可部署。

## 当前验证

- series-source-media.test.js：43项通过，包含完整Result集合负向测试。
- series-routing-run.test.js最终17项通过：2/24集Product Package与读取权限断言通过。
- Movie Conformance/Delivery lifecycle/UAT-131 recovery三文件23项通过。
- P2合同检查通过，aggregateDigest=194ec732382eba05b763d22a49f36dcf28847944a378634a1762d09e22a3efa7。
- 首轮完整架构检查：2045项，2034通过、2项历史升级失败、9跳过；已补齐schema升级链，受影响历史两文件7项通过，新增原子容量升级专项1项通过。最终完整复验250文件通过，dependency/semantic/manifests/contracts全部ok:true，findings为空；最终工具未输出逐项计数。git diff --check通过。

上述计数不相加。本机输出位于E:/my_project/helix-git-consolidation-20261008/series-package-host-final.txt、series-delivery-movie-regression.txt及series-package-architecture.json。

## 剩余门槛

尚需逐成员Remux/Transcode及混合结果消费、N:M最终逐集计量、Arca正式Season/Episode落位和独立验收、追加/恢复/维护/退出、真实媒体与Linux、旧安装升级/回退、适用UI负责人版本验收。当前Series失败成员尚不能进入完整加工分支；未开放Series入口、未构建发布镜像、未部署生产。用户原有未跟踪诊断文档保持原状。
