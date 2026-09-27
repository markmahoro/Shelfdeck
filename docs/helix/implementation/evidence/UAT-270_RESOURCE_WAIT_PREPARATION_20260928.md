# UAT-270 资源等待输入准备与Aftercare上下文去重

2026-09-28。用户要求按两批计划修复。第一批UAT-269已在原《荒野猎人》任务验收，本批针对已实测的后台重复计算，不更改评分规则、Owner、资源容量或许可持有范围。

## 实现合同

- Foundation Governor公开`preparationWait(eventId)`只读提示：仅本进程已有、最近5秒完整准备过的waiter，且其完整资源bundle仍无容量时返回waiting。无需DB读写，不签发Permit，不变更队列顺序。
- Event Runtime只对`waiting_for_resource`采用提示，释放Scheduler lease、反馈resource_wait且不创建Attempt/Effect。未知/重启丢失提示、达到5秒、容量释放时均重新走完整input preparation、需求解析、Fence和Governor acquire。
- 5秒上限沿用既有BACKOFF_MS首档；防止旧资源绑定永久抑制重新解析。等待提示不缓存业务输入，不授权副作用，不绕过资源仲裁。Recovery lane不采用该提示。
- Arca单次Assessment投影将已经读取的context传给assessmentSet，消除同次重复读取；每次project仍重新读取，避免跨调度缓存评分/库存事实。
- Composition对`arca.aftercare.assessment.commit@1`直接声明既有固定`sqlite_write`需求，跳过只为解析资源而重复读取的Aftercare上下文；业务输入与Fence仍走原有核验。
- Perception候选匹配、候选上限、结果摘要及sqlite_write合同不变。现阶段不引入索引/迁移，不删除导入许可；若去重后仍存在独立瓶颈，再以现场证据确定检索优化范围。

## 验证与关闭条件

Windows Governor/Event Runtime专项65通过；Aftercare/Host/Scheduler专项78通过。覆盖等待提示无持久化操作、无额外Permit、5秒后强制刷新、容量释放立即重验、未知Event无提示、Scheduler lease释放、无新增Attempt、正常执行，以及跨次上下文新鲜性。

完整架构检查240文件通过（`helix-architecture-verify.js`，`ok=true`）；固定资源需求分支另经Aftercare合同与共享挂载需求34项回归通过。待完成Linux同组和生产验证。发布前检查运行任务，保留标准备份与回退资料；不得重跑已完成的荒野猎人导入来制造性能证据。以正常队列运行与定向等待观测验收，不在生产额外制造压力。

## 中断恢复与当前阻塞

用户报告异常中断后复核：第一批生产镜像仍为`helix-beta-20260928-b8cf321d65`，health正常、normalSupplyAllowed=true；原电影四个Event保持succeeded。第二批代码完整保留，未部署、未关闭。

本机Docker Desktop启动失败：Inference运行时通信入口`dockerInference`无法访问，后端退出。正常停止后精确重命名该入口失败；精确清理该入口的请求被自动审批策略拒绝，未执行。没有恢复出厂、清理镜像或修改NAS数据。Linux验证和标准镜像构建因此阻塞，须待本机Docker恢复后继续，不能用Windows检查代替Linux或生产验收。

2026-09-28接续：已通过SSH隧道使用NAS Docker完成包含本批的Linux188项回归，0失败/跳过；临时单测容器不挂载生产数据、无网络且限制CPU/内存。随后继续标准镜像脚本；本机Docker本身尚未修复。
