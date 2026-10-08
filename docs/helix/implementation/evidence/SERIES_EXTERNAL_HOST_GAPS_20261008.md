# Series外部Host发现与Movie回归修复

日期：2026-10-08；基线 `b37c88fc58431986edfd0dcba1e24260ea39215a`；当前Phase外部寻源及Movie发布回归工作项。

## 本批结果

完整隔离Series Host使用正式集成配置、SQLite/Coordinator/Provider适配器和真实临时文件；Provider网络与Probe受控。E01–E02共文件要求4K时，源观察提前进入Movie单成品路径，未携带Series Scope。修正为Series进入既有逐成员验证/完整Scope路径。Query Capability此前将Scope Work execution basis当作Run basis，导致搜索结果与Selection Criteria摘要不一致；现从Libra正式Reader读取所属Run，拒绝跨Run结果，Work/事件Fence保持。

Series搜索拒绝完整Host通过3.7秒：Search Work成功、候选not_selected、Run冻结、零下载POST、原文件存在、零Shelf Entry。普通两集Direct/Remux完整Host通过36.7秒。

Movie外部回归初跑4项中2项失败：后加工仍循环调用已取消的1..5候选参数，新Scope校验明确拒绝。改为读取唯一正式Import Work，不恢复多候选/重试下载逻辑。修复后真实Transcode和Remux上架分别45.1/38.4秒通过；同批未受此代码分支影响的真实媒体拒绝及native4k上架已分别4.1/39.8秒通过。网络仍受控，不等于真实MoviePilot下载验证。

## 用户决定保留的缺口

完整Series外部获取计划在EpisodeDelivery构造处失败：正式Run Episode Claim没有outputRequirementDigest；该值属于每个Material的正式Requirement。同集多个part可能有不同Requirement，不能从任一原成员取首值，也不能采用仅单元fixture存在的虚构逐集值。2026-10-08向用户提出完整有序Requirement集合摘要方案，用户选择“先保留此缺口，推进其他工作”。因此未修改SSOT或摘要语义；完整外部替换Host用例显式skip并标注原因，不能计为通过。范围/Import单元fixture既有自带字段不能证明正式Host可运行。

复现/后续入口：设置 `HELIX_SERIES_EXTERNAL=1`，执行 `node --test --test-name-pattern="external shared-file" media-service/test/helix-architecture/series-routing-run.test.js`。目前1通过、1合同缺口skip；取得对应合同决定后再启用完整替换用例。完整Provider获取、全Run终检、Promotion、实际Arca多目标审批/源结算/Commit仍未端到端通过。

## 验证与边界

- 外部模型/Scope/consumer/Query专项25项通过；媒体合同/路由/Coordinator边界32项通过。
- P2基线、包边界458文件/1450依赖、语义2077文件通过，diff检查通过。
- 本机Windows隔离运行；未操作NAS、未作生产部署；Linux/UI精确版本验收、内部策略耗尽寻源、Series外部后加工及其他Phase Gate继续。
- 原始日志在 `E:/my_project/helix-git-consolidation-20261008/`：`series-external-host-v2.log`至`v5.log`记录发现；`series-external-search-host.log`、`series-external-host-contracts.log`、`series-external-host-ordinary.log`、`series-query-movie-external-regression.log`、`series-query-movie-postprocess-v2.log`、`series-host-media-regression.log`、`series-host-p2.log`记录本批检查。失败记录保留，不改写为PASS。
