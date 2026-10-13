# OPS：安全停机与用户Formation Reset

2026-10-13。所属唯一Phase：OPS-CONTRACT / OPS-RUNTIME / OPS-RESET / OPS-SURFACE。用户确认开发两项能力及Reset默认“全部未完成整理，确认前显示清单”；本轮仅开发与本地隔离验证，未执行生产停机、Reset或媒体重处理。

## 合同与实现

- SSOT §10.1.6及§9.7.3注册运行控制与5个Admin端点。使用原Foundation供给/派发/Owner/Outbox生命周期，没有新增业务Owner、资源管理体系或单任务Pause。
- stop先持久化stopped意图，关闭业务写与新后台派发，等待既有Event、Recovery、Owner收口、Outbox delivery及已经受理的异步Admin业务命令。在线停机没有60秒硬超时；信号退出仍有原60秒checkpoint预算。HTTP、鉴权、只读管理查询继续可用；重启保留停机意图，明确resume通过Recovery Gate后才恢复供给与业务写。
- Reset只在停稳后提供服务端清单；actor-bound幂等键、previewDigest及confirmed=true冻结确认，不允许客户端传路径/SQL/Subject范围。独立Operator worker复用既有typed Reset闭包；主业务runtime不import raw Operator SQL。
- 用户范围为active Subject的active/suspended/frozen Run、尚未建立Run的Subject及pre-Subject Intake token。已结束Run/history、正式收藏、配置与来源文件保护；清理闭包交叠已结束历史、已有Commit、范围外引用、未知文件Effect或不能归属的孤儿责任时阻塞，不扩大删除或谎报成功。文件来源扫描、已入藏维护、Off-deck及外部下载不在此范围。
- 先备份数据库、内部伴随文件及选定工作区，SHA256、source drift、integrity/FK、容量、symlink与注册Workspace可达性检查完成后，再次检查冻结清单并持久化pendingReset；随后才执行精确删除。备份存于dataDir/operator-backups，与清理工作区分离。Linux同步文件及目录元数据；Windows使用原子文件替换及文件flush。
- 成功刷新受影响读模型、保留备份并保持stopped。备份失败不会开始清理；清理中断留下备份引用和error，禁止自动Resume，须由Operator检查；不自动猜测回滚，不开放恢复出厂或灾难恢复HTTP入口。

## Windows本地证据

已运行，不按加总当成互不重复测试：

- Foundation/真实Node Host/route/entrypoint等第一批：66 pass、2既有skip。第二批Formation/overview/Owner cursor/边界guard/运行控制：61 pass。后续改动的受影响项再验。
- 既有Reset工具、用户Reset及H1路由/集成回归一批57 pass；用户入口额外补历史交叠/孤儿阻塞测试。
- 全Web Vitest：29文件、150 pass；TS/Vite构建通过。
- Playwright desktop 1440×900及narrow 390×844：4 pass。覆盖正常运行→停机等待→停稳→只读预检→列表/后果/checkbox确认→Reset结果→明确恢复；失败重新核对、阻塞与取消；键盘Space/Escape、焦点恢复、无横向溢出及dialog Axe零违规。API受控fixtures用于状态覆盖，不冒充生产链路；真实Node HTTP生命周期由service测试独立验证。
- 浏览器截图/轨迹：ignored `.codex/ops-runtime-20261013/browser/`。截图人工检查后发现侧栏仍写“正常运行”；已修正为读取同一Runtime Operational Projection，并重跑全Web及4项浏览器走查通过。

## 待完成与适用边界

具体代码SHA、Linux精确镜像测试、打包审查与跨层UI负责人结论待补。本轮未做生产升级/停机/Reset、NAS真实媒体上的长时FFmpeg停稳或断电演练；没有宣称避免所有NAS磁盘/SMB事故。停机不能解决服务外部下载器持续写盘、目录失联或已有语义缺陷，只为升级提供停止新工作、等待收口和保留停机意图的正式边界。
