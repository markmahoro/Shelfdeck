# Series完成绑定资格与原生新进程重开

日期：2026-10-08；基线 `9ba6da59665b43414f09716a853723df66695140`，当前Phase源结算恢复工作项。

审查纠正先前“历史恢复需统一传播”的宽泛判断：terminal-effect-history-observer及historical-on-deck-effect-inputs明确是UAT-261旧未授权实现的只读历史见证，禁止用于新执行/授权，因此不改写其历史输入语义。旧见证回归继续通过，不能把扩展旧兼容代码当作Series恢复。

实际缺口位于Aftercare的completed-settlement-bindings：原先只认可scalar，合法多目标源删除后仍留在旧绑定观察集合。本次沿已有资格规则补齐typed final_targets：完整2..1024排序唯一key/location/观察摘要、精确字段、source mapping摘要、集合摘要、互斥scalar，以及既有record/payload/成功/Commit时间约束。仅排除已完成的旧offload source，不移除当前Inventory或其他未完成绑定。

16项历史资格/旧见证/完成投影回归通过。多目标资格涵盖缺失、乱序、重复、混合scalar、旧集合摘要及Commit后Evidence拒绝；重新计算外层摘要不能掩盖错误目标集合。原生临时文件测试另启动全新Node子进程：原source删除后新进程重新观察全部目标并返回同一完整证据/集合摘要，preDeleteIdentityDigest为null；改变成品后另一个新进程明确exit 1，拒绝恢复确认。该测试为端口重开，不是完整Host在Effect持久化边界强杀/恢复。

P2合同、包边界456文件/1444依赖、语义2075文件及diff检查通过。日志 `E:/my_project/helix-git-consolidation-20261008/series-completed-bindings.log`、`series-native-settlement-reopen-v2.log`、`series-completed-bindings-contracts.log`。

完整Host和真实审批持久化、外部Read Set/Coordinator/Provider仍待闭环；Linux/UI/发布门禁继续，未操作NAS，Series尚不可声明可部署。
