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

## 生产发布及关闭

2026-09-28：UAT-270/271已发布`helix-beta-20260928-1281d4dd76`（git `1281d4dd76`，tar SHA256 `39ea8a00e8d8b949a1941b3f1c981c48bb12a18ca2cc2badce9312c632d7d41d`）。Windows完整架构240文件、Linux188项通过。旧Aftercare Work/Attempt/Effect正式失败收尾，当前Inventory revision 9重新检查三维healthy，Arca Care GET200/healthy/basisCurrent=true；原Inventory/材料/Product Facts摘要不变，荒野猎人四Event仍succeeded，另一转码已由Attempt 2执行。UAT-271验收关闭；270已部署、等待抑制由专项证明，未追加生产高并发性能定量结论。readiness通过后启动超过脚本等待窗，随后健康/正常调度/Admin/五挂载/QSV/镜像及fnOS补验全部通过。下方状态为历史时点。

标准build-image.js通过SSH本机回环隧道使用NAS Docker引擎，复用依赖/Web未变化的b8cf321d65运行时；包仍导出至本机，经upload-nas-image.js重新上传且远端checksum验证。没有绕过本机通信文件清理审批，未修复或重置Docker Desktop。按用户已明确要求，不搭完整隔离服务；临时单测和标准readiness快照不挂载生产数据写权限。

发布备份：/vol1/1000/docker/shelfdeck/backups/uat271-20260928-1281d4dd76/runtime.tar，1,938,995,200 bytes，SHA256 3e939ea5d2ef79a1f5b08227b71d7840f651da64fc7e8e2d132a437599c1c3dc。停服一致打包data/compose/secret；原目录权限保持。备用镜像b8cf321d65保留；常规代码回退应保留当前数据走标准发布，不能直接覆盖已产生新事实的数据库；该备份是事故恢复资料，不是自动回退动作。

第一次apply在readiness快照报SQLITE_CANTOPEN，新镜像未启动；随即重新启动原容器。旧服务重建WAL/SHM后，相同候选镜像只读快照测试成功。第二次标准apply的readiness为ready/findings=[]并完成重建；新容器StartedAt 2026-09-27T23:11:32.033Z，启动超出脚本约180秒健康等待窗，脚本因此退出1。07:15:46 CST实查health200/normalSupplyAllowed=true；随后逐项执行脚本剩余健康、Admin、挂载、镜像与无代码覆盖检查全部通过，restart=0/OOM=false，fnOS200及无关容器状态保持。没有为补验再次重启。

旧Event在1790550799223以ARCA_AFTERCARE_ASSESSMENT_BASIS_STALE结束，原ordinal 1/摘要保持，Work failed、Effect failed。通过正式POST /v1/admin/care/:shelfEntryId/actions/check以幂等键uat271-recovery-check-20260928复验精确Entry，202返回新Work arca-care-work-32477315d5329bb24e05bac1329566c0d6f1090c。revision 9三维Assessment于1790551112589正式持久提交，GET health=healthy/basisCurrent=true/maintenance=none。最终比对Inventory、全部历史材料和Product Facts摘要逐项不变；无Reset、手工改库或媒体文件处置。发布后4分钟日志无输出，旧输入漂移未再出现。

另一活动转码的Attempt 1因正常停服以LIBRA_MEDIA_FFMPEG_FAILED收尾，发布后Attempt 2已executing且FFmpeg进程存在；未宣称字节断点续转或整部电影完成。荒野猎人导入链四Event保持succeeded。启动耗时超脚本窗口是本次已记录的运维限制，不由health通过冒充启动性能改善。
