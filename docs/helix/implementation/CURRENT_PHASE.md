# 当前Phase：安全停机与用户Formation Reset

2026-10-13用户要求实现两项能力，并确认Reset默认全部未完成整理、确认前展示清单。本次开发及隔离验证，不在生产执行停机/Reset或重处理五项媒体。Series冻结阶段见[归档](archive/SERIES_DEVELOPMENT_20261008.md)。本包为唯一活动Phase，不为新功能分配UAT编号。

| Work item | 结果与验收 | 状态 |
| --- | --- | --- |
| OPS-CONTRACT | SSOT登记停机/恢复/受保护Reset；Owner不变、在线停机与进程退出分开 | 已登记，待Exit复核 |
| OPS-RUNTIME | 停止新供给/派发，等待已开始操作及Owner收口；HTTP可读、业务写关闭；可恢复且重启保留意图 | 已实现，本地验证/最终审核中 |
| OPS-RESET | 停稳后预检清单/摘要/阻塞；备份验证后精确执行，保护历史/收藏/配置/范围外控制；成功仍停机 | 待实现 |
| OPS-SURFACE | 概览停机/恢复/Reset，等待反馈和确认；desktop/narrow/键盘/失败路径、具体版本UI负责人审查 | 待实现 |

安全停机不硬杀Event，不因超时谎报停稳，不提供单任务Pause；已开始的remux/transcode可能较久。Reset不是恢复出厂或全库清空，沿用Operator范围/Control/Workspace保护，用户入口额外拒绝清理已结束历史及未知Effect。文件来源扫描、已入藏维护及外部下载器不纳入上架Formation Reset。

验证：并发供给/派发/Owner/outbox停稳及恢复；持久意图与崩溃后禁自动运行；GET/鉴权/业务写门禁；Reset摘要漂移、保护交叠、未知Effect、备份失败、重复命令和中断拒恢复；正常/阻塞/空清单/失败/完成UI。未验证项保留事实，不用部署替代验收。

证据入口：[OPS运行控制与Reset](evidence/OPS_RUNTIME_RESET_20261013.md)。用户从概览读取状态、点击停机；停稳后可恢复或核对Reset清单，明确后果确认后清理，结果就地显示且保持停机。跨层UI具体版本审核与Linux资格完成前不关闭Phase。
