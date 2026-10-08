# Series真实媒体维修Host证据

日期：2026-10-08；基线`eaa489482364ec1df6c928905645fd5d1f75c765`。Series Phase媒体维修工作项，全部使用本地隔离Host/临时数据/生成媒体，无NAS生产动作。

## 实现与准入

正式Series Conformance汇总只把容器/扩展名问题，以及所有受影响成员都有有效冻结Strategy的编码/空间问题纳入既有auto_repair。没有策略、播放等其他缺陷仍保持attention_required；全Finding集合继续受原Case准入限制。沿既有Owner、Case与三维健康模型，不新增Capability/DDL，不调用External Acquisition。

用户仍从既有维护检查入口看到等待、维修与健康结果；没有新增说明文案。业务状态可见变化的精确版本UI负责人走查尚未完成，发布Gate保持。

## 正式链路

新增可选真实媒体fixture：`HELIX_SERIES_MEDIA_REPAIR=1`，运行`series-routing-run.test.js`中`with real media Aftercare$`。FFmpeg生成三段3秒1080p SDR视频，无音轨：E01 HEVC/MKV，E02 HEVC/MP4，E03 H264/MKV。通过正式Field、Routing、Run、Direct On-deck先在宽松标准下收藏，断言Libra没有Remux/Transcode；再用正式规则模板发布与Shelf bind-template API要求HEVC/Matroska/MKV，并从维护检查API触发Aftercare。

最终增强复验99.6秒通过：E01及Artifact文件字节不变，E02由Aftercare Remux、E03由NVIDIA NVENC Transcode加工；两份输出源Handle摘要和Workspace路径不同。正式Case resolved、健康healthy。每个新Primary保留原成员Episode Claims，旧Physical Material Control释放，新Inventory所有成员归属同一Arca Shelf Entry。恰好一份Aftercare Inventory Commit、一份已消费Settlement Approval，暂存旧文件完成结算。SQLite foreign_key_check为空、integrity_check为ok。

UnitOfWork decorator在真实Aftercare Inventory事务最后追加故障参与者：包含Inventory、facts/relations、Control/revisions、Commit markers及Event Result等12张表快照全回滚；随后原参与者正常执行，一次提交成功。此为事务内故障注入，不能代替进程被终止后的重启恢复。

## 回归与限制

27项评估/策略专项通过，新增缺成员Strategy时仍需处理的拒绝断言。最终分组全架构2,300通过/9既有skip/0失败（并行2,284，98.2秒；stage 16，0.1秒）。架构449文件/1412依赖、语义2067文件及diff通过。外部日志位于`E:/my_project/helix-git-consolidation-20261008/`：`series-media-aftercare-host-v2.log`首次完整通过，`series-media-aftercare-host-v3.log`增强复验；专项/全量为`series-media-host-targeted.log`、`series-media-host-full.log`和`series-media-host-stage.log`。

最初Host测试在首次Direct上架后被旧Libra混合加工断言阻止；改为显式验证初次没有Libra加工后通过，不是产品链路缺陷。按临时目录CreationTime读取的中间诊断无法可靠绑定该次进程，已撤回相关判断，不作为本证据来源。

本批将“自动媒体维修关闭”的历史状态更新为已按安全成员证据开放，并验证上述短SDR普通一集一文件链路。N:M维修、长片压缩/音轨/HDR与更多设备、真正进程崩溃/跨设备恢复、Off-deck、外部寻源、UI/Linux/升级回退及整体首版发布门槛仍开放；不声明Series已可部署。

## N:M 真实媒体维修追加

基线 `55b75442b0d70e4ea3ae336b64b6cc392ca73c81`，仅增加隔离Host测试与证据，未改产品代码。新增 `with real N:M media Aftercare$`：E01–E02共用HEVC/MP4，E01另有H264/MKV part；先按宽松标准Direct入库，再经正式模板/Shelf API要求HEVC/MKV，以无空间上限完成Aftercare Remux与NVIDIA NVENC Transcode。

最终 `series-nm-media-aftercare-host-v3.log` 98.5秒通过。按最终磁盘字节与持久Claims独立重建，E001为13,493字节，E002为5,927字节，与正式Arca空间模型精确有理数结果一致；1 MiB仅为事后计量比较值，不能声称维修按该上限执行。全部Artifact字节保持、两个Primary Claims原样保留；12表事务故障注入完整回滚后单次Commit、旧Control释放、新Control归属、Settlement和SQLite完整性均通过。

初次 `series-nm-media-aftercare-host.log` 使用1 MiB维修上限，短片不足既有策略至少16 MiB预留，编码Finding保持attention_required且没有Case；未放宽预算策略。第二次 `series-nm-media-aftercare-host-v2.log` 已完成Case，但复用的普通E01字节保持断言误用于N:M独立part；按映射修正测试后第三次完整通过。此前失败日志保留。

相关评估/完整成品集合专项30项通过，架构449文件/1412依赖、语义2067文件及diff检查通过。本批未重复全架构2,300项历史回归，没有产品实现修改。真实有界压缩仍需合适大小的源文件；长片/音轨/HDR、进程中断恢复、跨设备、运营/UI/Linux及首版发布Gate继续开放，无NAS动作。
