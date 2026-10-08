# Series完整范围外部调度接线

日期：2026-10-08；基线 `16a4e660db622a46eb796c3ad58c7721da2fb66f`，当前Phase外部寻源工作项。

Series Coordinator现在将spec_external缺口路由到冻结Primary/Episode完整关联Scope。Search→Acquire→Import使用既有绑定Scope的Work，下一阶段必须等前阶段成功且选中/验证通过；已存在的Scope在候选集合读取前继续，以便失败Import按其真实Evidence明确冻结，避免读取ineligible集合时报内部异常。Integration未就绪返回明确等待，不提交获取。

成功Import必须经过完整正式consumer重建；逐个实际Workspace Handle只附着自己覆盖的冻结Episode Claims，然后回到全Run完整候选终检/交付。共文件及part不复制整季Claims；失败媒体暂以对应Verification原因冻结，不循环重新获取。内部策略耗尽后的寻源路由与外部失败媒体后加工仍待实现/验收，不据此关闭所有外部场景。

14项Scope/Import/调度回归通过：三阶段按序推进、逐阶段pending/failed/cancelled不提前启动后继、拒绝候选不获取、拒绝Package不Import、完整2文件分别附着2集/1集Claims、失败媒体不附着部分集合。阶段测试使用正式Import consumer和受控Work reader/admission hooks，未证明真实Provider或完整外部Host。首次误调用未导出的scope校验已去除，直接使用Work builder内已有精确Scope校验，复验通过。

P2完整基线、包边界458文件/1450依赖、语义2077文件通过。日志目录 `E:/my_project/helix-git-consolidation-20261008/`：`series-external-coordinator-v3.log`、`series-external-coordinator-host.log`、`series-external-coordinator-contracts.log`。未操作NAS；实际完整外部Host、审批/重启、内部耗尽路由、后加工以及Linux/UI等发布门禁继续，Series尚不可声明可部署。

普通两集Direct/Remux正式Host完整上架通过35.4秒，既有内部路径保持；diff检查通过。
