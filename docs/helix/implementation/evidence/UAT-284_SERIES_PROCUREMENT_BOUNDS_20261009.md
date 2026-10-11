# UAT-284 大季Procurement有界结果

状态：开放。2026-10-09真实Series扫描：39包发布，另4个primary_manifest.build在00:02:18后无法提交成功。精确诊断为EventRuntime complete写入result_json超过65536，而非EvidenceEnvelope。能力已输出六字段小Evidence；PrimaryInputManifestDraft完整members重复内联到Foundation Result导致超限。

另第一Run的三国 (2010)/Season 1共95成员，Structure正式Result记录triage_unit_contract_too_large，全部released/triage_failed，Run sealed/partial_failure。这符合当前Unit 64 KiB上限，不能直接提高限制或拆季声称修复。

提出Manifest Draft Record方案待用户确认：Procurement仍从不可变Run member与Structure Evidence重建完整Draft，Record绑定精确Run/Structure/Unit与成员摘要；纯Capability不新增领域写入；Publication原子边界与全部物理身份/Claim/摘要校验保持。95成员Unit的问题未包含在该提案，须另审设计。验收需大集合正负、重放/摘要篡改保护、原4 Event正式完成封包；长季失败项按独立条件验收。无媒体写入、Reset或生产操作。

用户2026-10-09已确认Manifest Record方案。已实现PrimaryInputManifestDraftRecord，保留原完整Draft digest与Run/Structure/Unit/member集合摘要，Candidate Context使用同一个Manifest Input构造器重建并逐字段核对后发布。100成员回归中完整Draft超过64 KiB，Record小于4 KiB；成员缺失、数量、Structure、摘要及未知字段负向拒绝。Windows相关44项通过（含P2/Result Schema），Linux22项通过，真实Movie Material Field HTTP Host回归通过9.1秒，包边界/语义/diff通过。Linux为旧候选镜像只读挂载当前源码/测试，并非新发布镜像。

现场验收00:29：仅4只读Manifest Event executing时备份uat284-before-reload.db并重载本地18081。原4 Event正式成功，4 Publication成功，总计43包，第二Procurement Run sealed/completed；无Reset、重扫或媒体改写。Manifest Result子项按原链路通过；三国95成员Unit明确失败仍保留开放，不批量关闭UAT-284。现3个Libra Run阻塞在Metadata Draft容量，另记UAT-285等待合同确认。

2026-10-11继续修复时重新核对：SSOT仍明确普通Unit完整members及完整Unit≤64 KiB；现有compact memberScope只授权BDMV，不能直接套给Series。根因在mergeSeriesUnits形成整季members/identity sourceHints后conserveUnitBound拒绝；仅提高数据库列或拆Season都不成立。

待用户确认的有界方向：Series完整Triage Unit保留全部成员、Episode Claims、identity sourceHints及连续性证据，Owner内重建上限1024成员/8 MiB；Foundation Structure Result只携带精确Unit Record（Run/Structure输入依据、Unit ID/完整digest、成员数量/集合digest），记录仍≤64 KiB。Procurement仅从不可变Run Selection及已冻结Probe/Playability/规则依据确定性重建完整Unit，交接前核对完整digest；不新增跨域Store、反向Handoff、任意路径读取或旧Run兼容。Movie/BDMV合同与Foundation上限不变，一季仍为一个Candidate。

批准后先传播SSOT、typed Schema/Record/Reader和生成manifest，再覆盖95集真实封包、1024/1025及字节边界、成员/来源证据缺失与篡改拒绝、重放相同digest、Movie/BDMV回归。当前仅记录方案，未实施此合同调整；独立UAT-300/301/302修复验证继续。

2026-10-11用户回复“确认”，批准上述Series Unit方案。实施按SSOT回写→typed合同/manifest→Owner重建→正负及平台验证推进；不授权NAS部署、现场重扫或Reset。

实现结果：Series Structure只输出SeriesTriageUnitRecord，绑定Run/Basis/Selection/Rule、完整Structure input digest、页预算、Unit ID/digest、完整成员摘要/数量及字节数。Evidence Index经同一Projection与纯Structure算法重建并逐字段核对整页，Candidate Context继续使用完整Unit。原Movie/BDMV结果合同和Foundation64 KiB保持；无新增表、Store、跨域读取、旧Run兼容或媒体Effect。Projection的location/endpoint/Observation摘要改为冻结Run member值，后续current Observation或Handle变化不再污染重建输入。Series来源提示的typed集合容量同步传播，非Series256项保护保留；这不扩大IdentityClaim/Foundation既有字节上限。

验证：
- Windows/Linux隔离95文件Host均发布一个Season Candidate，95份filename来源提示完整，Unit67785字节、Structure结果2022字节；新建Evidence Index从持久Run/Work Result重建后Unit及metadata逐字相同，改动current Observation/Handle的只读对照不改变Structure输入。最终Windows2.93秒、Linux19.79秒。真实Host/文件系统加受控mediaProbe，不是原三国真实影片重扫或上架。
- 95/1024成员完整重建、1025拒绝、成员/Unit/Rule/输入/页预算/字节数及未知字段漂移拒绝、缺失Probe/来源漂移拒绝、清空缓存后重建通过。8 MiB最后可容纳值保留，下一字符步进越界拒绝。专项14项通过；1024验证限于Structure Unit，未宣称1024集端到端入藏。
- Windows P7及Schema回归186项通过，包含Movie/BDMV；新增字节边界随后单独通过。两集完整On-deck Commit Host通过45.92秒。Service626项：599通过、0失败、27既有skip，150.20秒。
- Linux最终P7回归156项通过、1项环境失败：旧P7 Exit审计依赖Git，测试镜像缺少Git及仓库上下文；两次日志均保留，不记整套PASS。最终95文件持久重建Host独立exit0。Linux沿用测试镜像只读挂载当前src/test/scripts，没有构建新发布镜像。
- P2合同/SSOT Source Map检查通过，无未解析引用；语义扫描通过，18项边界Guard测试通过。实际全仓package扫描8项与manifest扫描1项失败已与修复前dc2dd653e归档对照一致，另登记UAT-305，不声称全仓架构门禁通过。

日志保存在仓库外E:/my_project/shelfdeck-series-local-preview-20261008/uat284-*。最终Windows fixture为临时目录helix-series-routing-F8NtxJ，Linux fixture为容器shelfdeck-uat284-rebuild-20261011中的/tmp/helix-series-routing-zVbfxQ；均保留供核对。未更改UI，无Desktop/Web构建要求。

13:24本地18081仍为81a5a2e41，人世间transcode执行中，Arca Commit仍0；未加载本轮及301/302代码。UAT-304停机缺口尚未修复，未主动重启、Reset、重扫或操作NAS。UAT-284本次合同实现及隔离封包通过，但原三国95成员的新现场封包仍待验，保留开放。
