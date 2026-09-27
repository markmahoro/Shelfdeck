# UAT-271 Aftercare恢复输入漂移复发

2026-09-28用户授权修复并随UAT-270发布。关联UAT-210的2026-09-09标准并发变化复现及UAT-125/250的Libra冻结输入修复，后者没有覆盖Arca。

## 生产精确证据

Work arca-care-work-40519dd67d128d3646dcef56a09b59694e3f6cac，Event care-assessment-commit-6fdd1c337f28c06b36。三个专业Result均属于Inventory revision 4，Basis 6bbb736a7e4b99637dd5a589654b9cf066e6478d11e7f03d53fc85bdceeeb6af。提交Attempt于2026-09-25T22:17:39.545Z开始，Effect自22:17:40.493Z即reconcile_required，早于本次复制升级。

逐版重建1至9的Care Basis及完整双输入，只有revision 5精确匹配持久Attempt摘要1be88dcc6370d8947dbc4603f953d2b08accf6cd92eebc46fcefccf91af2c932。当前Inventory revision 9；该Entry无已提交Assessment。证明提交投影把revision 4证据重标为revision 5，然后当前依据继续变化造成恢复漂移。不是新复制代码造成。

## 修复及验收范围

Arca投影拒绝旧专业Evidence与当前Basis混用；执行前最后校验返回typed stale_input失败，禁止提交陈旧结果。Foundation保留原摘要Fence，仅对重新Reality分类为absent且intent精确匹配的domain_fact_commit记录输入准备失败并放弃未提交Effect；文件/外部请求/已提交或不确定副作用不得走此路径。已failed Effect重启后无需重投影业务输入，完成原Attempt失败，防止收尾崩溃再次进入漂移循环。业务重评仍由Arca拥有。

待：针对性正反例、完整架构、Linux、生产原Event收尾和当前Basis重评验收；不手工改库、不Reset，不以服务health代替任务验收。

## 本地与Linux验证

Windows完整架构240文件通过；恢复输入失败、已提交/冲突/错误intent拒绝、文件Effect禁止沿用、已failed重启、Arca投影过期及执行前Basis变化均有定向测试。Linux同组连同UAT-270 Governor/Host/Scheduler共188项通过，0失败/跳过。使用SSH隧道连接NAS Docker，在无网络、1 CPU/1536MiB、无生产挂载的临时单测容器执行；退出0后移除该容器，不搭服务实例。

精确Entry影片为《加勒比海盗2：聚魂棺 (2006)》。Inventory revision 5于2026-09-25T22:11:47.477Z提交，早于原Attempt；revision 4和5的Product Facts摘要集合相同。未把正常Inventory revision变化豁免为“无关变化”，仍由Arca重新评估。
