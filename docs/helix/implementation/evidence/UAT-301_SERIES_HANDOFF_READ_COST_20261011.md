# UAT-301：Series 逐集生产重复解析整季 Handoff A

2026-10-11用户要求启动本地服务并继续修复。基线81a5a2e41，现场18081以原preview-uat294/data启动，health正常，未Reset或部署NAS。停机数据库备份SHA256为77bb181ac683558d324fee5b70758b12d2b9d3982496866579326f47709a85fe；备份目录中的Workspace复制中止，不作为完整媒体备份。

17集混合来源完整Host基线PASS，121.81秒；CPU profile中Libra readRunInternal约8.96秒，canonicalJson累计约17.90秒。Reader在每个成员中重复查询同一Intake、解析完整Candidate Delivery，并对整季Package和Manifest重复canonical比较。这里确认的是Libra读取放大，不据此认定Arca结算全部耗时已定位。

修复保持Libra Owner、Handoff A及现有校验合同：单次readRunInternal事务内按精确intakeDecisionId复用Intake与已校验Delivery；每个成员的origin tuple、Primary、Episode和Related校验仍执行；不同Intake仍比较完整Package/Manifest；下一次读取重新查询，不建立跨请求缓存或兼容分支。

验收：两集真实Host通过，追加同Intake一次读取、下一次重新读取、第二成员origin/Primary漂移拒绝、后续Delivery漂移拒绝。17集同配置性能复验、Linux77集完整混合来源及Movie回归继续，未关闭本项或UAT-300。

后续验证：17集同配置完整Host 91.75秒PASS，readRunInternal CPU从9.01秒降至0.84秒，canonicalJson累计从17.92秒降至11.19秒。该单次对比受并行负载影响，不承诺固定提速比例。两集最终Host 39.26秒PASS，追加不同Intake独立读取与不同Package拒绝。Windows相关47项、最终边界/结算27项，Linux结算/Control/终态22项通过；完整Service最终626项，599通过/0失败/27既有skip，138.58秒。原5项回归失败及修复见UAT-303，不能抹去原失败记录。

日志与profile保留于仓库外E:/my_project/shelfdeck-series-local-preview-20261008。此前shelfdeck-uat300-mixed-77容器于2026-10-09 23:12退出1（非OOM），日志只到结算5/231、无TAP终态；原因未证明，不能记为容量修复失败或PASS。当前Windows77集基线和Linux77集新代码各自独立运行，保留原失败证据。

为集中验证最终UAT-301/302组合，以上两次中间诊断已主动停止并保留日志，不能视为完整PASS；最终双平台77集使用uat302-windows-final-77.log与shelfdeck-uat302-final-77-20261011。Task生成的不完整Workspace备份副本清理被自动审批策略拒绝，副本保留；数据库停机备份摘要校验通过，原数据未受该操作影响。
