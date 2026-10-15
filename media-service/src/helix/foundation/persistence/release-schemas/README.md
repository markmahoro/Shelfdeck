# Frozen release schema

`c00f45c15c5540e158a688c32fd4b57fdbc146b1a28067f0ac7fe82c496d0d5d` 是上一发布的 200-table DDL 与 manifest。文件来自已冻结的历史 schema fixture；DDL 解压后的 digest 必须与文件名一致。

`6ff9269258f74ae96d99ad770d1bd1d75a2fd38677def2e0e4c1fef2e50ca5ea` 是当前已发布的 204-table DDL 与 manifest，取自 `85f0b79`。它同时固定原 JAV 200→204 Operator 的目标，避免后续开发改变历史 Operator 的边界；Libra 204→210 Operator 以它为精确来源。

Libra Operator 仅建立离线结构副本：203 个既有业务/执行表逐行保留，新增 6 个 Libra 表为空，仅新增 `fx_resource_defer.priority_revision` 可空元数据列。它不终结、修复或重置现有 Run/Effect，不替代安全停机或具体生产副本的 Host 资格。副本中的任何旧事实变化、新表事实或 priority revision 都会使基线回退检查拒绝，不能覆盖使用后新增事实。

仅供离线结构副本 Operator 核验，只读源库与当前结构的有界差异。不注册旧 Executor，不参与 Kernel startup，也不赋予未完成 Formation 兼容权。业务终态 Catalog 历史仍由既有 Witness/proof 独立核验，不能用这些 DDL 文件替代。
