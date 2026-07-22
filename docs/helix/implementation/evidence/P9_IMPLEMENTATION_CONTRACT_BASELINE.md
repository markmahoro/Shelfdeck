# P9 Implementation Contract Baseline

Status: Frozen

这是P9机器施工图的里程碑索引；权威合同是本提交中的Schema、DTO、Capability/Port、Transaction、DDL、Recovery rules与Tests，本文件不复制其正文。

| Item | Frozen value |
| --- | --- |
| Architecture SSOT baseline | `1619735c`（local integration `aeedb2b7`） |
| Implementation closure | `fff40f8d92dbff88f07435a49bb0bcbae4934578` |
| Changed contract families | P5 external-material exact operations；Libra production application DTO；`ProductionMaterialManifest@1`；P9 Capability registrations；Libra delivery/discard/cleanup transaction contracts及owner tables |
| Counts | Capability 112；Result 97；Table 177；Transaction 43；Shared type 29；Domain input 108 |
| SSOT source-map digest | `a0c735fe2d1001cc3de9f750ba4d1076a4690eb05f927794c4354f78f29b1a30` |
| Contract aggregate digest | `c7e08ddbccb71e864846c5cb0ef923d3e48f37af30d1111acb0e0316544a0288` |
| Schema/DDL/transaction digests | shared `f5220110...7316`；result `c8d894f9...55f2`；input `e61c6504...2fe`；table `d699bf91...892`；transaction `3184f807...599` |
| Verification | Full Helix architecture 116 files PASS；focused P9 lifecycle/acquisition 13/13 PASS；crash/restart/replay and negative fixtures PASS |

Implementation-owned choices：canonical JSON + SHA-256稳定ID/digest；ordinal排序与去重；单member import；clone/commit隔离ledger故障注入；Cleanup只在typed Evidence后释放Control。已知剩余风险：未运行真实Provider、FFmpeg、文件删除、E2E、Docker或生产；这些明确留给后续独立验收。

