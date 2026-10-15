# Frozen release schema

`c00f45c15c5540e158a688c32fd4b57fdbc146b1a28067f0ac7fe82c496d0d5d` 是上一发布的 200-table DDL 与 manifest。文件来自已冻结的历史 schema fixture；DDL 解压后的 digest 必须与文件名一致。

仅供离线结构副本 Operator 核验，只读源库与当前结构的有界差异。不注册旧 Executor，不参与 Kernel startup，也不赋予未完成 Formation 兼容权。业务终态 Catalog 历史仍由既有 Witness/proof 独立核验，不能用这些 DDL 文件替代。
