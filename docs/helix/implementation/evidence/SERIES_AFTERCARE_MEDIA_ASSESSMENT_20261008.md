# Series Aftercare 全成员媒体评估

2026-10-08；关联唯一活动 Phase 的节点4运营准备。未部署NAS，未声明Series可部署。

## 问题与实现

原Conformance Capability仅Probe/播放抽样当前Inventory的第一个Primary，并以该物理文件大小对比单集上限；会漏掉后续集的异常，也会误判共享文件和同集多个part。

Arca现按当前Inventory中的全部物理Primary执行Probe和三点播放抽样；沿SSOT §5.5.8及已确认的共文件均分、多part累加规则，通过共享精确分数计算器计算完整逐集空间。无整季总大小门槛，不读取Libra的运行状态或修改正式媒体。读取前和结束时核验全部成员Physical Identity，每个可播放成员抽样后再核验；评估后续成员时较早成员发生变化也拒绝本次结论。

同类媒体Finding聚合并将全部受影响成员的摘要纳入Finding digest，避免长Season重复同类条件撑满Finding集合；空间Finding绑定超限Episode的精确份额与上限。原Movie单Primary路径和修复策略继续使用既有规则。

现有维修策略仅能冻结一个source handle。Series媒体缺陷在本批保留attention_required和空修复策略，不把后续成员的缺陷交给第一文件的维修流程。逐成员自动/人工维修、修复后完整集合复验及Inventory事务仍是后续必须完成的工作，不能据本批关闭Aftercare或首版发布门槛。

## 验证

- 新增专项15项通过：普通三集全部被检查、N:M恰好达标/超限、小数字节不能向下截断、后续成员编码/播放异常、24成员Finding聚合及顺序稳定、读取前/中/后成员漂移、重复材料/无Claim/重复Claim拒绝；Movie物理大小回归。
- 正式Conformance Capability入口使用隔离文件和受控Probe/播放端口；验证生成结果通过实际ConformanceAssessmentEvidence schema及完整依赖图，并保持Custody阻断后不读媒体。本专项未启动完整Host/调度或真实FFmpeg，不能替代真实Aftercare闭环证据。
- 首次全量架构：2,159项，2,149通过、9既有skip、1失败（99.0秒）。失败为未改动的 `p14-terminal-stage-history.test.js` 检测到 `ARCA_STAGE_REALITY_UNPROVEN / Stage path changed during observation`；该observer同时检查文件系统根至stage目录的时间戳，可能被共享临时目录的并发活动触发。单独复验16项通过，不能将首次失败删除或声称已修复。第二次全量2,150通过、9既有skip、0失败（98.3秒），日志为同目录 `series-aftercare-media-full-recheck.log`。
- 架构边界、语义检查通过；未改变schema/Capability合同。

## 未覆盖与后续

未执行本版本浏览器/UI负责人验收、Linux、Docker/Desktop构建或生产升级/回退。Series展示/Related维护、Placement变更、共享材料退出及完整维修仍开放；外部寻源N:M多目标结算合同仍待此前用户确认。

全量日志保存在仓库外 `E:/my_project/helix-git-consolidation-20261008/series-aftercare-media-full.log`，不提交媒体、数据库或运行导出。
