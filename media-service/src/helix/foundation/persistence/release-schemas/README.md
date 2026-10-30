# Frozen release schema

`906ecacce4d6de62e875d1293cec93dd198564c1c53e2f7f7979d75b2eac2d0a` 固定现网 a2bf / 1.0.0 的 239 表来源；`572bd48d999c83c86ffd5c2ccc496e7177b14df2edfd09ebcffadf56e2706cb9` 固定 tip / 1.1.0 的 242 表目标。US Adult catalogue 离线 Operator（`helix-us-adult-catalogue-schema-copy.js`）只新增三张空表（`libra_us_adult_catalogue_actor_decisions`、`libra_us_adult_catalogue_bases`、`people_us_adult_catalogue_registration_origins`），并扩展 `people_person_revisions.origin_kind` CHECK 以允许 `catalogue_auto`；其余 238 张事实/执行表全部列与行逐表摘要保持。此工具只创建隔离结构副本；同卷切换见仓库 `scripts/us-adult-catalogue-schema-cutover.js`，不授权 Reset 或生产 apply。

`33ef1d7c2f07669991a8401754f7671c92f4848db8a9c1869724bc5edf8e614c` 固定US Adult离线Operator v1的224表目标；来源固定为`5e82c36bf1d63e1297cf468361be67c074df3226a64d2dfb755d472db0bbee41`的210表main结构。209个旧事实/执行表的全部既有列逐字节保留，仅人物及Provider identity增加由可靠来源推导的库类型，新14表为空。无归属/混合归属人物、未结束过程或Effect明确拒绝复制；旧确认保持内部Evidence，不自动接受/删除。此工具只创建隔离结构副本，不执行生产升级或旧运行兼容。

`c00f45c15c5540e158a688c32fd4b57fdbc146b1a28067f0ac7fe82c496d0d5d` 是上一发布的 200-table DDL 与 manifest。文件来自已冻结的历史 schema fixture；DDL 解压后的 digest 必须与文件名一致。

`6ff9269258f74ae96d99ad770d1bd1d75a2fd38677def2e0e4c1fef2e50ca5ea` 是当前已发布的 204-table DDL 与 manifest，取自 `85f0b79`。它同时固定原 JAV 200→204 Operator 的目标，避免后续开发改变历史 Operator 的边界；Libra 204→210 Operator 以它为精确来源。

Libra Operator 仅建立离线结构副本：203 个既有业务/执行表逐行保留，新增 6 个 Libra 表为空，仅新增 `fx_resource_defer.priority_revision` 可空元数据列。它不终结、修复或重置现有 Run/Effect，不替代安全停机或具体生产副本的 Host 资格。副本中的任何旧事实变化、新表事实或 priority revision 都会使基线回退检查拒绝，不能覆盖使用后新增事实。

仅供离线结构副本 Operator 核验，只读源库与当前结构的有界差异。不注册旧 Executor，不参与 Kernel startup，也不赋予未完成 Formation 兼容权。业务终态 Catalog 历史仍由既有 Witness/proof 独立核验，不能用这些 DDL 文件替代。
