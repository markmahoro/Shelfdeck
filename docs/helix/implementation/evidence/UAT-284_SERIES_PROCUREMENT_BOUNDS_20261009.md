# UAT-284 大季Procurement有界结果

状态：开放。2026-10-09真实Series扫描：39包发布，另4个primary_manifest.build在00:02:18后无法提交成功。精确诊断为EventRuntime complete写入result_json超过65536，而非EvidenceEnvelope。能力已输出六字段小Evidence；PrimaryInputManifestDraft完整members重复内联到Foundation Result导致超限。

另第一Run的三国 (2010)/Season 1共95成员，Structure正式Result记录triage_unit_contract_too_large，全部released/triage_failed，Run sealed/partial_failure。这符合当前Unit 64 KiB上限，不能直接提高限制或拆季声称修复。

提出Manifest Draft Record方案待用户确认：Procurement仍从不可变Run member与Structure Evidence重建完整Draft，Record绑定精确Run/Structure/Unit与成员摘要；纯Capability不新增领域写入；Publication原子边界与全部物理身份/Claim/摘要校验保持。95成员Unit的问题未包含在该提案，须另审设计。验收需大集合正负、重放/摘要篡改保护、原4 Event正式完成封包；长季失败项按独立条件验收。无媒体写入、Reset或生产操作。

用户2026-10-09已确认Manifest Record方案。已实现PrimaryInputManifestDraftRecord，保留原完整Draft digest与Run/Structure/Unit/member集合摘要，Candidate Context使用同一个Manifest Input构造器重建并逐字段核对后发布。100成员回归中完整Draft超过64 KiB，Record小于4 KiB；成员缺失、数量、Structure、摘要及未知字段负向拒绝。Windows相关44项通过（含P2/Result Schema），Linux22项通过，真实Movie Material Field HTTP Host回归通过9.1秒，包边界/语义/diff通过。Linux为旧候选镜像只读挂载当前源码/测试，并非新发布镜像。

现场验收00:29：仅4只读Manifest Event executing时备份uat284-before-reload.db并重载本地18081。原4 Event正式成功，4 Publication成功，总计43包，第二Procurement Run sealed/completed；无Reset、重扫或媒体改写。Manifest Result子项按原链路通过；三国95成员Unit明确失败仍保留开放，不批量关闭UAT-284。现3个Libra Run阻塞在Metadata Draft容量，另记UAT-285等待合同确认。
