# Series内部策略耗尽后的完整范围寻源

日期：2026-10-08；基线 `206def7ae91dd626e0d7a419630b45ae0fde992e`。当前Phase外部寻源工作项，未改SSOT。

## 变更

Series此前把Transcode Assessment的真实 `media_device_strategies_exhausted` 当作一般技术终态冻结。现沿既有Movie策略规则识别该明确代码，或在有界策略遍历完成后，以原成员所属完整Episode/Primary连通Scope继续外部流程。规格本身需要寻源与本地耗尽复用同一Scope入口，不选单个part、不建立新的候选重试下载。`media_size_budget_infeasible`继续尝试有界后继策略；其他技术失败、cancelled及完整性拒绝维持原路径。

Series保留首个实测仅体积失败的成品Evidence，已到质量下限或最终策略耗尽时复用现有size-cap冻结判断，避免仅因设备耗尽而绕过体积/质量保护。此保护使用真实已成功Work验证结果；本批未新增授权豁免，也未建立合成失败Evidence。

## 验证

正式隔离Host通过：一个E01–E02共文件使用受控H.264 10-bit 4:2:2 Probe和仅支持4:2:0的CPU快照，正式Assessment产生一次 `source_pixel_format_unsupported/strategy_rejected`，后继Work正式报告策略耗尽；之后完整Scope搜索成功但没有候选，最终由 `no_available_candidate` Evidence冻结。零Transcode Event、零下载POST、零Shelf Entry，原输入保留。真实SQLite/Work/Result/Run生命周期运行，网络和Probe受控，不声称真实转码或外部下载。

反例Host在结构兼容的输入上注入 `LIBRA_MEDIA_FFMPEG_FAILED`：保持技术终止，配置探测完成后的Run未搜索/下载，源字节保持。连接测试请求单独计量。另有原规格直接外部搜索拒绝Host及普通Direct/Remux上架Host回归，后者35.6秒通过。

46项媒体合同、路由、Coordinator边界、完整Scope/Import消费测试通过；P2、包边界458文件/1450依赖、语义2077文件、diff检查通过。本批未独立实测质量下限/纯体积冻结Host和取消恢复，相关广覆盖发布Gate保留。

最初DV fixture未在当前要求下触发转码而正常上架，因此不能用于耗尽验证；改为明确违反HEVC要求、设备像素格式不支持的H.264 fixture。技术反例首轮误把集成配置探测算作Run搜索，分开计量后通过；未放宽实际Run断言。

日志目录 `E:/my_project/helix-git-consolidation-20261008/`：`series-exhaustion-host-v1.log`（无效DV测试）、`series-exhaustion-host-v2.log`、`series-exhaustion-host-v3.log`、`series-exhaustion-technical-host.log`、`series-exhaustion-technical-host-v2.log`、`series-exhaustion-final-host.log`、`series-exhaustion-unit.log`、`series-exhaustion-p2.log`。

EpisodeDelivery逐集Requirement摘要合同仍按用户决定保留，不启用完整外部替换Host；Series外部获取/后加工/Arca全链路、恢复及Linux/UI等发布门禁仍未完成。未操作NAS。
