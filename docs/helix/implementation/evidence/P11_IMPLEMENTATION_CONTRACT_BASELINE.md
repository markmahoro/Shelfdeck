# P11 Implementation Contract Baseline

Status: Frozen

权威施工图是提交中的typed schemas/DTO、Capability/Port、Transaction、DDL/Table、Recovery rules与Tests；本清单仅冻结里程碑索引，不复制Schema正文。

| Item | Frozen value |
| --- | --- |
| Architecture SSOT baseline | `1619735c`（local integration `aeedb2b7`） |
| P9 construction baseline | `fff40f8d92dbff88f07435a49bb0bcbae4934578` + manifest `7005b36d` |
| P10 closure | `2b3f989e` |
| P11 implementation closure | `b061df37` |
| Changed contract IDs | Arca acceptance/inventory/ondeck 16 Capability refs；Aftercare/Off-deck/Deregistration 25 Capability refs；Handoff-B、On-deck、Aftercare、Off-deck、Deregistration canonical transactions |
| Counts | Capability 112；Result 97；Table 177；Transaction 43；Shared type 29；Domain input 108 |
| Contract aggregate | `c7e08ddbccb71e864846c5cb0ef923d3e48f37af30d1111acb0e0316544a0288` |
| Source/schema/table/transaction digests | SSOT map `a0c735fe...1a30`；shared `f5220110...7316`；result `c8d894f9...55f2`；input `e61c6504...b2fe`；table `d699bf91...1892`；transaction `3184f807...0599` |
| Verification | P10 7/7；P11 6/6；full Helix architecture 118 files PASS；negative and crash/restart/replay PASS |

Implementation-owned choices：canonical JSON + SHA-256 stable identity；review scope按`shelfEntryId`排序；Marker replay冲突拒绝；Aftercare以same-identity作为不可越过的更新栅栏；Off-deck逐Entry终态；Deregistration使用显式零副作用guard。已知剩余风险：未接API/UI/startup，未做E2E、真实文件/媒体、Docker与生产验证；这些属于P12以后及独立验收线程。

