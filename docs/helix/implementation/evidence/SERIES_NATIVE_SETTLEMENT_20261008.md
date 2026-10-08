# Series原生完整目标源结算

日期：2026-10-08；基线 `d2c6ca44c8f99cea414e98eceaa1753e6593f588`，当前Phase源结算工作项。

异步Inventory端口增加完整finalTargets路径：严格要求Series、唯一原Offload source、完整排序keys、source物理身份/位置与映射摘要；逐一要求唯一Product/Final Decision、Workspace Primary Claims、Season落位范围及当前真实指纹。真实路径检查拒绝目录junction逃逸、目标重复和源路径别名。所有目标通过后观察原source并沿既有身份检查，最后复核Owner审批，仅删除该文件一次；不删目录或其他文件。

返回所有目标key/location/observed reality digest和集合摘要，删除后重放仍先重验全部目标，preDeleteIdentityDigest不伪造。同步旧入口明确拒绝finalTargets，以免混合scalar输入忽略其他目标。既有异步scalar路径保持。

原生Inventory全文件81项测试通过（2.4秒），含新增11项多目标临时真实文件验证：成功一次源删除、完整证据、删除后重试与目标变更拒绝；每一个目标的缺失/改写/缺Decision/重复Decision均保留source及notes；审批撤销、混合基数和junction逃逸拒绝。最初fixture使用非canonical E1 Episode scope，改为正式E001后复验；没有放宽业务合同。P2完整基线、包边界455文件/1440依赖、语义2074文件及diff检查通过。

日志 `E:/my_project/helix-git-consolidation-20261008/series-native-settlement-regression-v2.log`、`series-native-settlement-contracts.log`。本批为端口真实文件验证，未运行完整Series Host；未改Capability传参与完成/历史证据消费，端到端仍不能启用。下一步继续Capability完整列表、Commit完成证据、真正审批Store与进程重启；外部Read Set/Coordinator/真实Provider及Linux/UI等发布门禁保持，未操作NAS。
