# Series 逐Primary Direct验证增量

日期：2026-10-08。归属 CURRENT_PHASE 节点1「Series身份与逐集生产接线」。本地开发，不是节点Exit、UI验收或生产发布。

## 实现与合同

- Planner为每个冻结物理Primary创建独立Direct Verification与Selection，Selection只消费自身Verification；member digest及精确Source Work约束保留在Owner projection，完整Probe集合拒绝缺失、重复、foreign及payload改写。
- Movie保留单源node/candidate身份；Series允许0.75/1.5 GiB等正数上限，要求精确对应安全整数bytes。
- 用户确认共文件按覆盖集数均分、同集多part份额相加；SSOT §5.5.8记录最终Product大小的逐集算法。新增纯计算核心以BigInt有理数保存份额，比较不取整，验证完整集覆盖及唯一物理成员。
- 该计算核心尚未接入typed聚合证据、Conformance和Arca验收。有上限N:M的Direct路径明确拒绝LIBRA_SERIES_SPACE_AGGREGATION_REQUIRED；无上限时仍按物理文件验证一次。不得据此宣称复杂映射已交付。
- SSOT插入合同导致生成sourceLocator及digest同步；DDL SQL未改变，trace manifest由正式materializer重新生成，无表结构或数据迁移。

## 验证与边界

Windows：4份受影响测试84项通过，0失败/跳过；追加单集失败不得借用其他Primary通过结果的测试后，series-source-media.test.js 35项通过。计数重叠，不相加。2/24集Host使用真实调度器、SQLite、Owner projection和Workspace文件，Provider、Probe及Playback为fixture，未运行真实FFmpeg。

首次全量架构检查249文件中仅DDL trace manifest再现性失败（2037项，2027通过、1失败、9跳过）；同步正式生成物后重新执行全量检查：249文件通过，dependency、semantic、manifests、contracts均ok:true，findings为空；合同aggregateDigest为cea738d4bdd9f624dea4354ab9d39ed905616777919bd8bc394295b7987f27ae。最终工具仅保留文件数及通过状态，未输出逐项通过/跳过总数。git diff --check通过。

测试停在Direct Work成功且逐成员Selection落盘边界。Run Coordinator仍需消费多Selection，Remux/Transcode、Product Package、Conformance和Arca Commit尚未贯通；不等于整个Run完成。未执行Linux/真实媒体、浏览器、Desktop打包或NAS部署，无UI交付。下一段按同一Phase接多Selection与逐Primary加工，N:M完整证据继续在所属节点验证。

本机原始输出：E:/my_project/helix-git-consolidation-20261008/series-direct-host-tests.txt、series-direct-negative.txt、series-direct-architecture-final.json。不得将本批代码/测试通过作为Series上架资格。
