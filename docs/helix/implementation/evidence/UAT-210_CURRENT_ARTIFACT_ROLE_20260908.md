# UAT-210 当前Artifact角色与真实维护链路

## 根因与本地修正

当前正式poster缺失时，Aftercare以文件名含poster的普通sidecar替代，Presentation误判健康而不建真实修复Case。SSOT 8.6的Inventory闭集角色与一文件一业务角色规则、6.6的Artifact角色映射均不允许这种提升。识别、Planner和Materialization共用精确角色：metadata_sidecar对应NFO，poster对应正式海报；普通sidecar不以扩展名取得替换授权。历史“filename-aware”测试与当前SSOT冲突，已调整为精确角色正反例。

51项关联回归、222文件架构全门禁通过。真实隔离H264媒体链路由正常后台完成People关联记录更新，未建立Case；主动删除当前NFO、当前正式海报后分别创建并完成两次实际修复，新的Inventory/Control与健康事实一致，普通sidecar保留。没有操作生产文件。

## 夹具与断言审查

供应商夹具原只返回22字节JPEG头，普通sidecar曾掩盖其不能解码；已用sharp生成真实可解码JPEG。正常People记录更新使Inventory revision增加，长链改为观察实际记录revision后逐次检查。初始输入有精确settled_to_final及final_verified证据，旧的“上架后源路径仍保留全部文件”断言不适用；改为核验后续维护不再改变Off-load完成后的源目录，外部基准夹具始终不变。

## 尚未通过的迁移收尾（关联UAT-213/128）

真实长链继续迁移Shelf Target后，Inventory已经提交新目录，但Settlement报ARCA_AFTERCARE_SETTLEMENT_HANDLE_INVALID，Case未完成。精确根因与UAT-128旧多角色问题不同：Handle构造借用当前Shelf mountScopeRevision，Effect校验又要求旧源路径/mount属于新Shelf Target。当前Inventory只保存mountScopeId/bindingRevision；不能删掉路径检查或把新Target倒填旧来源来完成测试。需在Arca所属迁移/Case合同内建立可复核的原目标绑定证据，并覆盖提交后重启与篡改拒绝。

证据日志：.codex/uat210-214-real-chain-settlement.log（67s失败，NFO与海报段已通过）；保留隔离目录helix-arca-ondeck-XhaWvX。该长链未通过，UAT-210/213均未关闭；不能只报告常规Service跳过此环境测试后的通过数。

## 生产记录更新装配缺口

5c7bc1f043后两部历史路径误判已正常健康（UAT-211），其余7部为当前正式NFO真实Identity变化：钢铁侠、攻壳机动队2、寒战2、林肯律师、新·奥特曼、信使、星际迷航。只读指纹证明inode未变而size/contentFingerprint改变；不追查外部写入归因。

精确根因：create-procurement-execution-runtime给Arca Capability注册传了computeBoundedMaterialFingerprintSync，但给Process Services遗漏；createInventoryRecordRefresh因此把undefined调用当作records_deferred。修正显式装配同一指纹Reader，并在构造期拒绝缺失依赖。12项定向、222架构文件通过。

扩展真实服务链：上架后追加合法NFO注释，经Admin检查正常增加一版Inventory、1条记录更新Receipt、0 Case，且外部NFO字节不被改写；随后原缺NFO/海报修复继续。首轮在后续Target迁移阶段失败，开启诊断发现ensureSettlementApproval以前因缺失FP提前return，新装配启用后遗漏sourceTargetBinding读入口。归UAT-213补同Owner原Target Reader，没有放宽校验；整条链正在重跑，不能以已通过的前半段声称全链通过。

## 装配及恢复调用全链复验

补齐两个调用后，真实影片全链72.2秒通过：NFO原位合法更新只刷新记录、0 Case，随后缺失NFO与海报各修复、Target迁移收尾、重启恢复、失败保留和退出均通过。日志`.codex/uat210-213-real-chain-fixed.log`；架构222文件通过，Service 530项中511通过、19项环境跳过、0失败。当前补丁尚未发布，生产7部记录更新仍待部署后自然收敛验收。
