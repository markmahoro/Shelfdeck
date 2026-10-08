# Series逐成员媒体策略引擎

日期：2026-10-08；基线`ec1021b7830db678d94a969ac33da3b93bd23bc1`。唯一Series Phase媒体Aftercare工作项，无NAS部署或生产数据动作。

## 实现

原Strategy构造和码率计算固定读取第一Primary。现Series必须显式传入唯一当前Inventory material key；Arca从完整正式Inventory空间快照得到该物理文件预算，并将目标Handle、空间Basis和预算摘要绑定到Intent/结构preflight。无参数、非Primary、未登记成员和错成员Probe Evidence在读取设备前拒绝。Evidence通过实际Probe、选中Handle、源字节和观测时间完整重建核对，不能只改source digest。

保持当前Care Basis/Inventory不变，不修改每集Standard。物理文件预算用于码率计算，质量下限仍按原单集空间档位选择；例如每集2 GiB、覆盖两集的文件可获得4 GiB物理预算，但仍使用原2 GiB质量下限。零字节或分摊取整为零的预算不能转为无上限质量模式。GPU优先和有Evidence的CPU选择、禁止编码预试规则保持。

## 验证及边界

26项Series评估/策略和Movie结构策略专项通过，新增5项覆盖后续成员、共文件与part、顺序稳定、Probe篡改/错成员、其他成员变化时摘要失效、零预算和单集质量下限。最初小字节fixture低于既有16 MiB容器余量而返回无策略；改用明确的逻辑Inventory大小进行纯结构规划验证，没有降低容器余量或执行文件加工。

策略测试使用正式模型与合成设备/Probe快照，不宣称真实FFmpeg或完整Host维修。Movie原有100 Entry GPU选择、CPU拒绝证据和UAT-218质量下限回归通过。架构447文件/1395依赖、语义2065文件及diff检查通过。完整回归日志：`E:/my_project/helix-git-consolidation-20261008/series-care-member-strategy-full.log`。

这批完成单成员策略引擎，没有把多策略写入Conformance Evidence，未改变Capability schema、DDL或启用Series自动媒体维修。下一段仍需正式Assessment冻结多成员策略，贯穿Planner、单目标Effect、完整混合输出逐集终检、原子Commit和恢复；UI/Linux与整体可部署Gate保持开放。

最终全架构回归2,289通过、9既有skip、0失败，96.2秒。
