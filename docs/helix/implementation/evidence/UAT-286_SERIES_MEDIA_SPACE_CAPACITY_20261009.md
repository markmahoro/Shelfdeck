# UAT-286 Series媒体验收空间集合容量

2026-10-09，UAT-285修复后，原32/46/47集三个Run均通过资料/NFO提交；46集《情满四合院》和47集《大江大河》在下一关Product Media Candidate输入准备失败。

精确根因：`seriesSpaceBasisFor`从冻结全部Primary/Probe构建完整空间分摊集合，`buildSeriesMediaSpaceBasis`按现行SSOT ProductMediaCandidateInput合同拒绝超过32成员。93个失败Attempt的evidence_digest逐项等于`{failureCode:P4_EVENT_INPUT_PREPARATION_FAILED,failureMessage:Series media space requires one bounded frozen Run member set.}`完整canonical摘要，非推测Provider失败。32成员任务已通过该关并转码。

拟议合同：Series完整空间集合与既有Production Manifest容量对齐，允许1..1024成员，Candidate Owner执行时展开输入有界1 MiB；Movie输入与Foundation Result仍64 KiB，完整集合身份/摘要/范围校验和按覆盖集数均分、多part累加不变。不按单文件或任意小批计算而漏掉同集其他part。

用户已按Playbook §3.3确认并实施此合同变更。Windows相关39项、Linux33项通过，覆盖46/47/1024成员Candidate、1 MiB拒绝边界、Movie64 KiB保护及跨32成员边界共文件/多part分摊；P2与生成合同一致。

全新47集Host第一次在旧100秒观察窗口结束时仍正常运行、无失败Event；按新增大季场景调整测试时间窗口后，105.90秒推进到全部47个Direct verify/select及Work成功，随后在Product Conformance触发独立P9_CONFORMANCE_SELECTED_SET（现行selectedProducts[1..32]合同）。因此仅证明本项输入准备关卡修复，不能宣称47集完整E2E成功。opt-in HELIX_SERIES_LARGE_SCOPE=1保留后续失败回归，不改为预期成功或弱化断言。

本地18081仍加载UAT-285版本，正在保护《大宅门2》实际转码，未为本修复中断媒体副作用。原失败Run未Reset或改写状态；修复后的新任务重现验证及旧任务处置分别记录，不以恢复代码掩盖缺陷。未操作NAS。
