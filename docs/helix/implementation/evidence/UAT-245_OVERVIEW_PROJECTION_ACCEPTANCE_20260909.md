# UAT-245：概览独立生成与有界读取

2026-09-09。已按现行条件验收关闭；生产版本`7ceaeca7fb`。

## 根因与修复

旧GET虽名为OverviewQuery，仍在请求内拼接领域读取。Field展开历史Run/Candidate/Delivery和Work；Shelf附带注销详情；Collection载入全部Entry后归并健康；Off-deck展开候选/重复组/成员/抑制记录；People先构造全部人物再截取一项。

现在独立Producer生成内存中的可重建概览快照，正常5秒周期，领域读取之间让出事件循环；完整生成后原子替换。GET只取已发布快照，不触发重建、领域读取或写入。启动生成不阻塞HTTP/正常生产；首份结果前返回明确503；生成失败保留有时间戳的旧结果并标记failed，超过30秒标记stale，停止时不发布未完成结果。完整服务停止等待Producer结束。

Owner仍负责原有业务判定：

- Procurement读取Field当前访问配置及有界Work状态；候选与Delivery计数在数据库内聚合，不再展开历史。Foundation只返回通用Work/Attempt事实，目录失败解释仍在Procurement。
- Arca Shelf与People/Off-deck使用数据库计数。退出收藏待审阅只计当前workbench实际可审阅的open候选；旧代码排除的suppressed/completed/terminal并非该表有效状态，造成stale等历史候选混入待办，本次与现行workbench对齐。
- Collection按100项读取活跃Entry、调用既有Arca健康判定并在批次间让出执行时间；只保留累积计数和最近5项，不复制/简化已接受瑕疵、Care Basis或终局判定。Formation维持当前可见性与有界近期记录规则，在Producer内生成。
- 用户看见过期/失败时间提示；侧栏和主状态都变为读取失败，不能继续显示“正常运行”，保护已关闭141。没有重新引入旧NFO一致性或自动修复已接受瑕疵规则。

无新增业务事实表、Schema/API路由或Owner变化；Projection metadata是既有概览响应的生成状态。不存在旧GET实时计算fallback。

## 发布前验证

- 4000活跃SQLite Entry加5历史Entry：41个受限页、健康输入最大100项、近期记录5项，聚合及open候选/People计数正确。此fixture的健康判定输入由固定测试值提供，用于验证分批协议，不声称4000部真实媒体健康检查或整体压力验收。
- 完整服务使用NAS一致备份的隔离副本、无网络/生产媒体挂载：100次GET，p95 2.879ms/p99 3.743ms，请求AsyncLocalStorage范围的领域仓储调用0、写入语句0；82收藏/本月72/健康81。首份概览等待1983ms。不是在生产数据上运行测试写入。
- 并发刷新期间只返回上个完整结果；1000次读取不触发Producer；失败保留旧数据且不泄露内部错误；过期、恢复、停止时丢弃未完成代次、全新实例重建通过。
- 16项相关后端测试通过；226个架构测试文件及边界/语义/Manifest/Contract门禁通过；Web全量87项及后补概览7项通过（新增2项failed/stale保留数值但不宣称正常），构建通过。
- 初始隔离备份以WAL模式从只读目录打开失败；改为容器临时目录内副本再建立一致快照，未放宽生产目录权限。旧静态People方法禁令误匹配新增计数字段，改为完整标识符边界匹配，未允许任何旧方法。

日志：`.codex/uat245-{bounded-tests,projection-tests,architecture,web-tests,overview-web-final,web-build-final,linux-runtime}.log`。125/152整体恢复与压力、247跨页缓存、其他列表分页条件保持独立开放。

## 最终镜像与生产验收

标准发布见[发布记录](UAT_RELEASE_7CEAECA7FB_20260909.md)。最终镜像不覆盖src，仅注入测试脚本，隔离备份完整服务100次GET：p95 1.302ms、p99 1.430ms，首份结果1926ms，请求内领域仓储调用仍为0。

生产11:13:12.709Z的30次GET：p95 4.694ms、最大23.423ms，全部200、Projection ready。实际只读浏览器刷新仅请求一个`/v1/admin/overview`，响应头31.275ms；截图显示82正式收藏、72本月上架、81健康收藏、1健康待处理、887人物待确认、855等待进入整理、2正在整理，保持原值与当前阶段。原生页面刷新、近期记录和当前整理标题正常，无新生产写操作。

245关闭只覆盖概览请求与本次Producer验收，不宣称完成所有列表分页、4000部真实媒体健康检查或整机长时压力验收。141失败状态未回退；125/250既有输入漂移继续开放。
