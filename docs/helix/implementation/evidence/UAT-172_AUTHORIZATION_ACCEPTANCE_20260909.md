# UAT-172 正式持续授权执行闭环

2026-09-09。实现与本地验收完成，待标准生产发布及核验；目前仍开放。用户已确认精确旧输入持续清理，无需重复业务决定。

## 最终实现

Arca在同Run正式Final Product Verification成功后，由Owner协调器派生并保存arca_ondeck_settlement_approvals；按Foundation已有Owner Work状态分页读取，每页最多100项，只扫描running的On-deck Work。Projection只读已持久Approval，缺授权或Approval时以既有输入等待机制保留文件，不制造失败Attempt。Domain Model及Persistence使用Arca业务错误，Planning将其转换为Foundation输入等待，未跨层依赖Execution。

Scope冻结精确成员、source-to-final mapping、本次Final Verification及当前Authorization digest。历史Libra conformance不再冒充Arca Final Verification；拒绝共享/未知角色、无独占派生依据的Related、缺少已验证successor的Scope。当前授权及精确Scope在异步文件观察前和实际删除前重读，撤销、范围不足或Basis变化不再使用旧Approval。物理文件路径按平台规范比较；额外BDMV成员也必须通过精确Owner批准，不能凭目录位置继承删除权。

收藏架配置增加折叠的实际授权状态、范围说明、显式授予/撤销和读取失败状态；命令使用当前revision及幂等键。移除Readiness中的productChoice及全局模式文案，不恢复历史“全自动/关键步骤确认”产品开关；沿用既有正式命令路由，不增加兼容路径。未授权时等待持续授权，不承诺不存在的逐片确认入口。Off-deck销毁保持独立。

## 验证

- Windows真实ISO：无授权时Final已通过但0 Approval/0 Entry、原片仍在；仅Primary/结构授权允许相应精确Settlement，独占海报保留；正式撤销至revision 2后重启，海报逐字节不变且无Entry；重新授予含Related的revision 3后完整上架。六项Acceptance Check通过、1 Entry、0失败Event，70.22秒。日志`.codex/uat172-host-restart.log`。
- Windows真实Direct HEVC：当前代码下无授权保留原片，正式授权后直接上架，无transcode/remux；六项检查通过、0失败，40.25秒。日志`.codex/uat172-direct-windows.log`。
- Linux使用原生产镜像运行当前src与测试的只读挂载：ISO上述撤销/重启完整链110.76秒、Direct44.53秒；加授权角色/范围/Final Basis及删除前撤销负向，共11项PASS、76项名称过滤SKIP。日志`.codex/uat172-linux.log`。此为当前源码测试，尚不能当新镜像已发布证据。
- 76项相关Windows回归通过；224文件全量架构测试与依赖/语义/Manifest/P2合同四道检查通过，`.codex/uat172-architecture-final.json`。随后只修改Readiness模式字段/文案及相应断言，正式Admin命令测试再次通过，`.codex/uat172-admin-final.log`。旧111测试改为提供正式Final输入并读取Approval Store，不恢复合成system-policy做法。
- 11项Web测试通过，包括实际范围、当前revision撤销、显式授予、读失败不猜授权、命令失败不伪造状态；TypeScript/Vite构建通过。隔离真实Host浏览器完成授权revision 1及撤销revision 2，两次POST均200；`.codex/uat172-browser-requests.json`。范围说明与最终未授权状态实际渲染核对通过，没有修改生产授权。

最初SQLite bigint/number比较和Windows路径分隔差异导致测试失败，已分别规范revision及物理路径比较；未以放松授权检查或旧Scope兼容解决。正常全链测试夹具现在通过显式正式授权满足前置条件，UAT-172负向夹具明确跳过该前置授权。

## 发布与关闭

待记录新镜像、备份、生产只读前后对照和当前授权revision核验。未改SSOT、Schema或生产存量数据；既有失败事实不改写为成功。172通过不自动关闭其他57项中的任何项目。
