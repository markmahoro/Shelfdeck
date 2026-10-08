# UAT-283 Series Run准入有界Evidence

状态：2026-10-09原Subject准入及首次生命周期检查验收关闭。2026-10-09本地Series E2E在UAT-282资源修复后出现新阻塞。1777个Probe均成功，39候选包published，3 Subject已接受，Formation显示准备下一项整理工作；日志重复SQLITE_CONSTRAINT_CHECK：evidence_json UTF-8长度超过65536。

fx_event_result_bindings依据SSOT §8有64 KiB闭合约束，大Payload只允许typed handle，不得直接扩大列或截断Evidence。初步代码追踪Run Admission finish把完整Decision（内含Run Basis/Manifest）重复放进Foundation evidence_json；需精确调用栈/边界复现确认。为获取栈帧在仓库外本地启动器添加仅code和stack frames诊断，保留原日志，重载本地服务；当时仅4个只读primary_manifest.build Event执行中，未有媒体写入/下载。保留原数据库，未Reset或重扫，恢复按正式Event合同执行。

验收：容量边界正负、准入/回滚/重放及Movie保护，原Subject形成Run并推进；该项不得关闭独立Series生产容量等后继问题。

精确栈确认Run准入写入点run-admission-store.js:1139。用户2026-10-09批准LibraRunAdmissionDecisionRecord，完整Basis替换为Run ID/Basis digest，原Decision digest保持；Foundation保存完整Record storage digest，重建及重放验证完整Decision。Windows/Linux各44项准入/生命周期/Series连续性通过，含95 Primary大Decision超过64 KiB而Record小于4 KiB、篡改负向与事务回滚。P2首次发现此前UAT-282导致SSOT表source line漂移；重新生成source map/table contract并更新固定摘要后P2及Libra Schema13项通过，DDL未修改。语义2081文件通过。

本地18081在只有4个只读Manifest Event执行时保存uat283-before-reload.db，加载修复；没有Reset/重扫或修改媒体。实际原Subject准入进展待核验。另4个Procurement Manifest Event的EventRuntime Result超限仍独立定位，不据此推断也是evidence_json。

原现场验收：准入修复后3个原Subject于00:15:08形成active Run。随后Lifecycle同类完整Evidence重复内联超限；用户另行确认Lifecycle Decision Record，完整Evidence保留immutable Run revision，typed Record绑定精确committed revision/schema/digest。补齐后00:18三Run均active/state_revision=2，00:19三组身份Observation/Resolve均成功，38个product_metadata.fetch成功、3个执行中。原准入与首次生命周期阻塞已越过；完整逐集加工/上架未通过，不在本项宣称E2E成功。

最终本轮Windows45项相关回归通过（组合含DDL时首次仅trace manifest过期失败，正式重建后DDL9项通过，SQL DDL字节不变）；Linux45项通过，使用旧候选镜像挂载只读当前源码/测试，不代表发布镜像已重建。P2/应用Schema13项、包边界及语义检查通过。未改UI、未部署NAS、未Reset、未写来源媒体。UAT-283按原准入/生命周期关卡验收关闭；Procurement Result/Unit边界另记UAT-284。
