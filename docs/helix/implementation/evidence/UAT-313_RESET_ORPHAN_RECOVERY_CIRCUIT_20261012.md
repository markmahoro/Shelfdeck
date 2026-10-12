# UAT-313 Reset残留恢复占用阻断寻源

后续最新事实：《绿头苍蝇》该Work实际`libra.external_material.search@1`已产生3次Attempt，最后finished_at_ms=1791813042889，均P5_PROVIDER_TRANSPORT_FAILED；Run进入frozen revision3。此前按固定旧Event ID查询零Attempt不代表该Work全部执行记录仍零Attempt，后续改为按Work关联全部Event核对。失败诊断`962fce4d34536f4950a2480ba6e43d4c291a520dc0545250a571303845af41df`明确networkCode=ECONNREFUSED。MoviePilot容器exited/exit135/OOM=false，Docker State.Error记录hosts写入ENOSPC，解释当前连接拒绝；恢复MoviePilot待用户授权。《燃情岁月》仍running/搜索ready。旧reservation已释放，但外部服务恢复和两片实际搜索结果仍不能计为完成。

2026-10-12生产精确处置：用户明确授权释放旧Work恢复占用。处置前再次核对Work不存在、Circuit仍recovering且reservation精确匹配。通过现有Foundation `abandonExecution(workId)`执行，维护事务仅允许两张Foundation表的UPDATE；前置快照保存在生产`data/diagnostics/uat313-recovery-release-20261012.json`。结果reopened=1、Circuit/Incident均open、occurrence_count=31、resolved_at_ms=null，其他Circuit/Incident逐行保持。未Reset、未删媒体、未改写事故为resolved。后续两搜索Event仍ready/零Attempt，且NAS再次满盘；因此仅完成孤儿reservation释放，真实搜索启动验收仍开放，不关闭UAT。

2026-10-12继续排查：本地Reset工具按选定Work与reservation精确摘要识别占用，在同一事务中将对应recovering Circuit/Incident恢复为open，保留事故次数和历史，不伪造resolved。冻结manifest包含该占用并进行清理后postcondition。Windows Reset32项通过，覆盖选定探针释放、范围外保留、重复执行及既有回滚；未部署，旧生产已删Work的孤儿探针仍待精确处置。安全停机可减少维护竞争，不能替代Reset本身的引用闭包。

2026-10-12，用户澄清为NAS生产《绿头苍蝇》《燃情岁月》卡在寻找合规媒体源。只读诊断完成，未修改生产、未重启、未重试、未Reset。

## 精确证据

- 《绿头苍蝇》Run `fbbe5ad0b75cb032eab6b93de6cc1e006cb1d487b30d002e4c2e0419c8951d4c`，search Event `libra-external-search-event-6c1a5b080135d785c30b03cdbb8d7ebee7da143a`，ready_at_ms=1791797718188。
- 《燃情岁月》Run `7e1ae2a83f81a5e5c7a38b851dfa81286469851892eb445b4cab91efdeddbbec`，search Event `libra-external-search-event-38fbdf2325791b303e9ff2e8f07b28c3a5ecbe2a`，ready_at_ms=1791799125580。
- 1791800220299时两项均ready，无Event Attempt、Result或resource_defer；分别已等待约42分钟、18分钟。后续复查仍ready。搜索请求尚未发出，不能归因候选不存在、下载耗时或原盘接入。
- `canonicalDigest({resourceKey:'integration:moviepilot-main'})`精确为`4d66f3389d802b21173c6451d65ad0448978505268604c6747aaa01479a729cf`。对应`owner/libra/libra_run/workspace_media_production/resource/…` Circuit仍为recovering，reservation evidence digest=`09adcb8c569bb837acc1db56fd36ddc23def585ccf2f2e7b674ef01273785718`。
- 停机备份`/vol1/1000/docker/shelfdeck/backups/series-preflight-20261012-05-stopped/data/shelfdeck.db`以SQLite URI mode=ro打开，只读逐Work重算reservation digest，唯一匹配`libra-external-material-search_selection-work-2915b3cf3799078c49378f848e5155d81c780944`，Run `ee2dae01eff61468e247e5069c2b8f4f6316005d5086c19a54cbafa165ff1c08`，影片《宇宙探索编辑部》。该片属于升级时获批的四项限定Reset。
- 当前库上述Work已不存在，Circuit仍保留相同reservation。`executor-incident-registry.prepareExecution`对recovering且reservation不属于当前Work返回`resource_recovery_in_progress`；`event-runtime`在创建Attempt/申请资源前返回`circuit_deferred`，解释两项ready/零Attempt/无resource_defer。

## 结论与修复范围

Formation Reset删除持有恢复名额的Work，却未释放对应Execution Foundation Circuit的恢复占用，形成无Owner的reservation。现存新Run因此无法启动搜索。应在Foundation所属合同内修复Reset闭包与恢复占用生命周期，并增加独立postcondition；不得通过重新寻源、扩大Reset或裸SQL强制关闭Circuit掩盖缺陷。

本项与UAT-312外部原盘候选接入不同。先前用户确认的“外部寻源排除原盘”仍需独立实施，不因本项诊断宣称已生效。

验收：限定Reset可释放精确被删除Work的恢复reservation、保留范围外占用和事故历史；失败回滚及重复执行幂等；新进程不得永久等待不存在的Work；原两片真实search产生Attempt及后续结果，生产修复需对应授权，不以只读根因定位关闭。
