# UAT-208 NFO生命周期验收

2026-09-09。按[前后合同核对](UAT_NFO_CONTRACT_PRECEDENCE_20260909.md)修正后的当前Oracle，UAT-208关闭。取消旧Final呈现全等要求，不取消源文件覆盖/删除的精确权限。

- 当前生产`955fe42daf`镜像Linux 94项PASS：真实Host原NFO观察→原子改写→重启→同Run携带原witness→On-deck；Inventory同根/异根、同步/异步Settlement、同名Placement覆盖及缺证/冲突拒绝，Aftercare Effect安全。此组Host使用Probe替身，未冒充真实媒体。
- 为补真实媒体缺证，既有`helix-uat131-defect-admission-e2e.test.js`增加显式`HELIX_UAT208_REAL_MEDIA`选项，仅限actor-only场景；复制隔离真实视频，使用Host默认真实Probe与媒体Effect实现，完全移除该模式的探测与播放桩。Provider仍为确定性替身，用于控制已有演员缺口，不声称外部服务实网验收。
- Windows实际媒体链12.96秒PASS；当前生产镜像Linux实际媒体链7.18秒PASS。都在持久MetadataObservation形成之后原子替换NFO并重启，最终恰一个Shelf Entry、completed Libra Run和fully-acked Handoff；ProductionProvenance中的sourceNfoObservations逐字节等于重启前witness，源NFO已清理，独立版本和未知子目录文件保留。
- 使用`.codex/uat215-media-fixture/SDT-M01-Standalone-H264 (2008).mkv`（3179785 bytes）实际可播放视频；Docker仅以read-only挂载该夹具与测试文件，业务代码来自当前生产镜像。没有生产影片修改，没有补写旧Package的源证据。
- 现行Final检查走`readableNfo`；源Settlement安全走`mutableSettlementBasis`与`verifySettlementSource`。通过的源冲突负向不得被误读为恢复默认健康呈现内容审查。

本次仅扩展测试，无运行时代码或Schema变化，无需再次部署相同运行时。生产955fe42daf的标准发布/健康/挂载与72部收藏连续性已独立核对，见[发布证据](UAT_RELEASE_955FE42DAF_20260909.md)。未制造生产NFO改写、未重复旧Formation恢复；旧在飞记录由250处理。171/210的现行记录更新与零Case范围仍开放，131的三终局由251承接，不能被本测试名称或局部成功自动关闭。

原始记录：`.codex/uat208-linux-nfo.log`、`uat208-real-media-windows.log`、`uat208-real-media-linux.log`。
