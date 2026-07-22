# P13 Implementation Contract Baseline

Status: Frozen；Helix Local Implementation complete；P14 not started

权威施工图是提交中的typed schemas/DTO、Capability/Port、Transaction、DDL/Table、Recovery rules、Route/UI manifests与Tests；本清单仅冻结最终里程碑索引，不复制Schema正文。

| Item | Frozen value |
| --- | --- |
| Architecture governance baseline | `1619735c`（local integration `aeedb2b7`） |
| Accepted P9 baseline | implementation `fff40f8d92dbff88f07435a49bb0bcbae4934578`；manifest `7005b36d` |
| Accepted P11 baseline | implementation `b061df37`；manifest `61e42c39` |
| P12 closure | `23e3b930` |
| P13 implementation closure | `bd75e7e4` |
| Changed contract/component IDs | `helix.inventory.routes`、`helix.inventory.ui-surfaces`、Admin Route Registry/HTTP Adapter、Session Token、Projection/Activity Builder、九页Admin Web、Clean Composition Root、Backup/Restore/Clean Init/Readiness |
| Counts | Capability 112；Result 97；Table 177；Transaction 43；Shared type 29；Domain input 108；Route 114；UI surface 18 |
| Core contract aggregate | `c7e08ddbccb71e864846c5cb0ef923d3e48f37af30d1111acb0e0316544a0288` |
| Route/UI aggregate | `b7fd10af998ac1c3c60d1d973fa60b3b40c27da924ede9b3bbf402e35b4afc76` |
| Source/schema/table/transaction digests | SSOT map `a0c735fe...1a30`；shared `f5220110...7316`；result `c8d894f9...55f2`；input `e61c6504...b2fe`；table `d699bf91...1892`；transaction `3184f807...0599` |
| Verification | P12 7/7；P13 9/9；Admin Web unit 3/3 + build PASS；service unit 227 PASS/2 SKIP；full Helix Architecture 120 fixture files PASS |

Implementation-owned choices：Route和UI从冻结SSOT确定性materialize；Session token使用Platform-owned签名与expiry；Composition Root显式注入全部Facade；Backup使用稳定path排序与SHA-256；Restore只写空目标；Clean Init通过staging/retired目录完成可回滚原子替换；Readiness以generation、schema、surface和build四类Evidence共同决定。

Owner/Store/Handoff audit：五个Domain、两个单向Business Handoff及各自Owner Store均未改变；UI/API只经Facade；Composition不直接读Store；运维工具只管理整个本地data generation，不解释或改写业务事实。机器扫描未发现跨Owner写、隐藏Store读取、latest/current补读、兼容/dual path或旧Runtime fallback。

Remaining P14 risks：未运行真实来源E2E、真实Provider/FFmpeg/文件副作用、Windows/Linux/Docker、Canary或production；部署环境的HTTP server adapter必须只实例化本Baseline的Clean Composition Root并证明旧server不在运行路径。P14只能消费下述冻结package，不得把验收修复变成兼容路径。

