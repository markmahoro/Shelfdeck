# Arca 目标排他与恢复：审查证据和候选方案（2026-10-29）

## 状态与依据

本文是供主整合审查的实现候选和隔离证据，不是新的 SSOT、活动 Phase 或已经发布的合同。只读对照主整合 SSOT 提交 `97c4913b96cbe6509c65a2c42ae5ee106905eb17`；其 JAV 截短段沿用 `3e707a033837ca3bf2a0c6e26a65603e15678069`：首次 JAV single 的新 Decision 需要保留完整 typed 番号、原资料、同 stem 和真实扩展名，路径碰撞须结合 Arca Inventory/Control、Reservation 和 Endpoint 实际等价性拒绝未知归属。旧 Accepted/Decision 不改写；本授权不包含生产部署、重试、清理或迁移。本文代码观察基于隔离分支 `df93fe6109bcdab8aaf00e463b4c1658db0bf3ab` 及其后本次增量，不将其等同主整合当前代码。

SSOT §6.5.3 的所有 On-deck Run 仍执行唯一固定 Off-load 阶段：Resolve → Target Commit Slot/Reservation → Stage → Verify → Placement Switch → Final Verify → Settlement → Fulfillment → Commit。§7.5.3 的 `material_commit` 必须有 Material Control、Basis fence、可恢复效果和 Effect Receipt；`destructive_commit` 仍须原有独立 Authorization、精确范围和逐项 Evidence。本文只提出 Arca 如何证明相交写入范围的必要条件，不把路径冲突业务判断移给 Foundation，也不把 Arca 正式写入权限交给 Libra、Platform 或其他 Planner。

## 写入与清理范围盘点

以下路径是当前代码中直接影响正式目标或可能与其相交的入口；具体作用域和可用性仍由各自 Owner 合同决定。这里的“参加同一排他检查”只针对物理范围相交或无法证明不相交的情况，并不授权其读写彼此材料。

| 路径与当前证据 | 必须纳入比较的范围 |
| --- | --- |
| On-deck `arca.inventory.target_slot.prepare@1`、`arca.inventory.product.stage@1`、`arca.inventory.placement.switch@1`；`clean-arca-inventory-port.js` 的 `slotHandle`、`stage`、`switchPlacement` | 冻结的最终目录/成员、Slot 目录、逐文件 `.tmp-` 和 `.restore-`，以及合法输入已在目标时的受控 no-op。Slot 创建和 Stage 也是物理 Effect，不能只围住最终 Switch。 |
| 普通 Aftercare `arca.aftercare.artifact.materialize@1`、`arca.aftercare.input_settlement.delete@1`；同一 Inventory Port 也接受 `arca_shelf_entry` Aftercare | 当前受控 Inventory 位置、实际新增目标、`.staged-`、`.superseded-`、回滚及原输入删除范围；复用原 Case/Basis/Control/Authorization，不把新入藏规则推广成 Aftercare 命名规则。 |
| JAV Correction `arca.jav_correction.files.stage@1`、`files.publish@1`、`formal_retirement.execute@1` | 冻结 File Plan 的旧/新成员、Stage、retained alias 和精确退役范围。Correction 的已拥有 Entry、明确用户 Intent 与历史 Commit 不能替代首次 On-deck 的证明。 |
| Western Adult actor refresh `arca.us_adult.files.stage@1`、`files.publish@1`、`files.retire@1`（含有授权的 discard） | 原受控成员、新目标、Stage、retained/旧成员和精确 discard；保留该 Profile 原文件名与 Case 合同。 |
| Series `arca.series_presentation.files.publish@1`、`arca.series_root.files.relocate@1`，以及 Series Aftercare | shared presentation 的精确文件；迁移则覆盖完整 old/new 子树及所有成员。对不同 Season 的合法共享不能一概视作同一个 Entry，也不能仅因同剧名就允许合并。 |
| `arca.offdeck.primary_material.delete@1`、`arca.offdeck.unreferenced_related.delete@1`；`clean-arca-recycle-port.js` 的 archive/restore/purge | 已授权的精确受控文件，及可能与 Shelf Target 或其祖先/后代相交的目录树。整树 rename/remove 需与所有重叠子路径互斥；回收路径由自己的 Scope 和用户确认控制。 |

`arca.aftercare.text_artifact.render@1`、媒体转码、JAV Correction Workspace 和 Series Presentation Workspace 等仅在各自 Workspace 内写入；其 Workspace 自有 Scope 不应被误认为正式收藏目标。若配置导致 Workspace 与正式目标物理重叠，必须作为错误或明确的冲突处理，不能因名字不同推定隔离。`movie-ondeck-coordinator.js` 仍含直接 `materialize` 路径，本分支源码检索没有发现运行时构造它；旧 `seriesSeasonReplacementService.js` 由历史 built-in 注册引用。不能只凭文件存在或不存在推定两者在所有部署中可用/不可用；主整合须以最终实际注册清单审计，若可执行而能触及相交目标，也必须受同一边界约束。

当前 On-deck `targetAvailability` 只按 `target_endpoint_id` 和 `target_location` 字符串相等筛选 `ready/offloading/blocked` Run；`target_reserved_at_ms` 在进入 offloading 的 Arca 事务中写入，blocked 持有，committed 后不再阻挡。它没有统一约束上述其他写入者或证明文件系统等价。当前 `resolveStageSlotDirectory` 依据 legacy sibling 是否存在选 Slot；存在本身不证明由当前 Run/Effect 创建。现有 Stage 还可能以相同 fingerprint 使用已有 final 文件，Placement 之后有路径式 `renameSync`。这些事实不能作为不同 Entry 的目标归属证据。

主整合 `bc88955b6` 的 `AFTERCARE_ARTIFACT_STAGE_OWNERSHIP_REVIEW_20261029.md` 已用真实 Host 与文件反例证明：在首轮执行前外部预放同字节 Stage、或预先构造同字节 Stage/target hardlink 时，仅有相同 inode、原 Effect Intent 和 `continue_forward` 仍无法证明创建者。该文是未批准的 Aftercare 证据设计候选，不能直接把 Aftercare Artifact 伪装为 On-deck Product member，也不能将两者权限合并。On-deck 的 Stage 创建者证明需按其现有独立 Slot、Product、Work/Event/Effect 和 Arca Owner 合同闭合；中断发生在独占创建之后、创建 Evidence 持久化之前时，未知文件仍须保留。

## 候选的路径等价与排他合同

1. **先证明物理命名空间。** 以 Platform 已登记的 Endpoint/Mount Scope revision、稳定挂载证据和当前 Shelf root Binding 为输入，要求只读的、版本化 Endpoint 现实证据回答路径关系 `same / disjoint / unknown`，并覆盖现有父目录、最终不存在的组件及目录祖先/后代关系。不同 Endpoint ID、不同路径字符串、`path.resolve`、统一小写、NFC/NFD 转换或单个 `stat` 值，均不足以独立证明两个路径不相交；不同挂载名/绑定仍可能指向同一实际目录。大小写及 Unicode 行为可能随 Endpoint 或目录变化，不能把 Linux/Windows 的本机规则套到 CIFS。需要比较的 namespace 或父目录关系为 `unknown` 时，按可能相交处理或明确阻断，不能假定无冲突。
2. **比较的是写入足迹，不是电影身份。** Footprint 至少列出最终目录/各文件、完整 Slot、实际临时文件、retained/旧值、原输入处置范围及被移动或删除的树。相同目录、大小写/Unicode 等价目录、祖先/后代及路径别名均须覆盖；整目录迁移/删除与树内任一文件冲突。Series shared root 的不同 Season 文件可以按现有共享合同声明精确文件范围；冲突不因番号相同、标题前缀相同或文件字节相同而自动变为同一责任。
3. **由 Arca 原子取得并持有对应 Reservation。** 合法实际 Owner 的 Run/Case/relocation/recycle 等须在各自修改物理路径前参加一个 Arca-owned 相交范围检查；同一个物理 namespace 的检查、对当前 active claims/Inventory 与 Control 的重验和新增持有者必须在同一可靠事务中串行，不能先查后另事务插入。现有 SQLite kernel 使用 `BEGIN IMMEDIATE`，可作为单数据库事务的组成部分，但不自动证明其他数据库、旧进程、外部应用或文件系统写入者被围住。冲突者不得抢占；已发生或可能发生物理 Effect 的持有者在恢复收口前保留，不按 TTL、Work 预算耗尽或进程退出自动释放。
4. **合法复用必须有原业务合同证明。** 已经在目标的受控 Product 可按现有同一 Control/no-op 合同工作；Correction/Aftercare/Series 可在各自已授权、精确的原 Inventory 与共享 Scope 内替换或扩充。未知外来目标、不同责任占用、无匹配 Control、当前 Basis 漂移或不能证明唯一关系时应停止并保留原内容。上一个失败 generation 的未知 Effect 未收口时，新 generation 不能靠新的 Claim 或相同字节接管。
5. **数据库预约不是文件系统原子性。** 所有可用内部写入者必须先接入并在启动/升级边界共同生效；外部程序不会自动遵守预约。实际文件操作仍需 Endpoint 已资格验证的独占创建/不覆盖切换、可信的父目录绑定、每步 Fence 和独立结果验证。现有路径字符串上的 `lstat` 后再 `link`/`rename` 仍有进程间 TOCTOU 窗口；若无法证明操作锁定同一个父目录及不覆盖语义，不能启用正式短名发布。跨设备复制、硬链接不可用、inode 不稳定、零 inode、别名或服务重启均不能靠 fallback 猜测成功。

一种可供主整合评审的实现映射如下；名称是**候选**，不是现行机器合同：

| 层次 | 需要冻结或返回的最小信息 | 必须保持的规则 |
| --- | --- | --- |
| Platform Endpoint 技术观察 | `endpointId`、`mountScopeId`/revision、当前 root/alias 证据、目录组件等价和祖先关系观察、可用原子操作及组件字节限制的版本化摘要；每项允许明确 `unknown` | Platform 只提供有来源和有效期的技术观察，不决定 Entry 身份或授予写入。现有 Mount Scope 的 `stableMountFingerprint` 和 `inodeCapabilityDigest` 是可复用输入，不等于现成的大小写/Unicode 等价或原子发布资格。 |
| Arca `TargetFootprint` 候选 | `processType/processId`、Owner 当前 revision 与 Basis/Decision 或 File Plan digest、Endpoint 现实证据引用、按类型区分的有界精确路径集合及完整 digest | 由各现有 Owner Context 计算；Stage、旧值、删除 Scope 不能被文件名模式或调用方临时添加扩大。路径记录有 exact-file 与 subtree 两种不同覆盖语义，并显式记录实际目标及受控旧成员。 |
| Arca `TargetReservation` 候选 | reservation ID、上述完整 Footprint/digest、namespace 观察 digest、Owner scope/Basis、状态与 CAS revision、创建时间、收口 Evidence/Receipt 引用 | 可考虑 Arca-owned reservation head 与 path member 表；不借 Foundation Effect 表承载业务判断。取得时与所有相交 active claims 原子竞争，blocked/unknown Effect 持有；只在原 Owner 事务核验相应 Commit 或经合同认可的无效果/已收口 Evidence 后释放。任何具体表/索引和历史数据处理须由主整合决定并传播生成物。 |
| 执行和恢复 guard | 原 Work/Event/Attempt、Effect Class 与 idempotency key、输入/原 fence/Intent digest、持有的 Reservation revision、精确 Owner Basis、Stage Manifest Record、必要的 current Material Control 和实际目标观察 | 使用 Arca 对 Foundation 的声明式只读 participant，借鉴 `series-root-relocation-execution.js` 的 exact Work/Event/Attempt/Effect 和 Control admission fence；不得通过读写其他 Owner 私有库或自己改变 Foundation 状态来放宽资格。 |

如果当前 Platform 契约不能给出上述证明，新增版本化技术观察及其 Endpoint adapter 是一个待主整合确认的**精确合同增量**，不是允许 Arca 猜测等价性的权限。若实现采用新 Arca Reservation 表、Footprint/Result schema 或新增 Capability 输入，需先确认其生命周期、所有现有写入者的参与、版本化、机器 Registry/manifest、执行与恢复、失败投影及 Reset/备份依赖；不应修改已冻结 `FinalInventoryDecision/v1` 或使用其 `objectId` 字符串暗藏截短标志。

## Effect 与物理恢复证据矩阵

| 时点或现实 | 允许的结论 | 不允许的推断 |
| --- | --- | --- |
| 首次派发、任何本 Effect 写入前发现确定外来占用 | 有当前 Owner/Reservation、真实目录观察和 `effectWriteStarted=false / before_publication` 的精确失败，可按所属 Capability 合同终止该次 Effect | 不能由本次无写入断定之前 Slot/Stage 或其他 generation 完全零副作用；失败映射也不能覆盖之后已写入的异常。 |
| 仅创建目标目录后崩溃，缺少可核验的原 Effect 与归属记录 | 保留空目录及 Stage，标记现实未知并请求处理；若未来有经合同允许且能够确证创建者的持久证据，才可按该证据分类 | 空目录存在、inode 或名字与预期相同，不证明由当前 Effect 创建。 |
| 成员已部分切换、Receipt 未提交 | 只在原 Intent/Attempt、Stage 的独占创建来源与完整 Record、原 Reservation 和 Owner/Control fence 与当前物理身份均可证明时，按**专属**观察结果继续；有外来、未知、重复或替换成员即停止保留 | 通用 `forward_required`、缺少 marker、仅含现状身份的 Stage Manifest、相同大小/有界 fingerprint、相同番号或一个现有文件，都不能单独证明归属。不同 generation 未结算的 Effect 不能被忽略。 |
| 所有最终成员出现但 Result/Receipt 尚未提交 | 重验完整成员、原 Slot 和 Owner 责任，按原 Effect 与实际持久证据判定；无法证明则仍是 unknown | 不能以“看起来齐全”写成功 Result、Inventory 或 Control。 |
| Effect 已提交 | 精确匹配原 Effect/Scope、immutable Receipt/Result 与 marker 后重建相同结果；验证当前现实若有需要须独立读取当前 Inventory/Control | 重放不能重发文件、覆盖缺失文件或顺带清理 Stage。后续合法 Aftercare 已改变当前材料时，历史 Receipt 仍是历史；不能靠原 Stage 把当前收藏改回旧样。 |
| Stage、retained alias 或旧目录需清理 | 依原合同建立独立、限定 Scope 的 Effect/Authorization 与 Receipt，逐项验证当前归属、未知成员和其他活跃 Claim | 不能把已提交 Placement 的重放当成清理许可，也不能递归删除未知文件。 |

当前通用 On-deck `material_commit` observer 缺 marker 时返回 `forward_required`，随后 Foundation 将其分类为 `continue_forward`；它没有专门证明目录归属。要安全接入短名，需由 Arca 为适用的 Slot/Stage/Placement 提供按原决策、Owner/Reservation、Stage Record、Effect 和物理现实构造的专属观察，并在组合层按 Capability 路由；Foundation 继续只持有技术 Intent/Receipt/marker。现有 `priorOnDeckPlacementReceipt` 查找同 Run、可选同 Slot 的成功 Result 是有用输入，但不单独替代精确 Work/Attempt/Effect/marker 和当前 Control 的闭合证明。

## 本次隔离测试与可说明的范围

- 两个独立进程竞争一个实验目标时仅一个成功创建目标；不同 Owner 的同字节已有 final、同字节不同 inode 的 Stage 替换均拒绝，原文件保留。实验原语及测试 guard 尚未绑定正式 Reservation。
- **Stage 预先被外来材料占用的反例**：在隔离 Slot 已创建但 Stage 首次执行前放入与 Product 相同字节、不同 inode 的外来 primary；现有 Stage 将该 inode 记录进 Manifest，实验原语随后接受该 Manifest、将外来 inode 链接到目标并 unlink Stage。Windows/Linux 均复现；这是实验路径的安全失败证据，不是 Control、Effect Receipt 或 On-deck Commit 成功，也不是允许清理外来文件的行为。单纯事后比对 Stage Manifest、文件身份和 Owner guard 不能补上它，必须先证明 Stage 的创建来源；因此原语继续禁止正式接线。
- 一个实验写入者在首个成员后中断，旧 On-deck Port 的另一个写入者也在实际 `renameSync` 第一份成员后中断；目标出现两个不同 Stage 物理身份，原实验写入者的 `continue_forward` 停止，两个 Slot 的剩余文件和目标均保持。此测试只证明实际隔离物理 Port 竞争及实验原语拒绝，不证明第二个 Run 获得 Control 或提交。
- 部分发布后注入未知文件、未知目录和目录内文件，恢复拒绝且保留。首次建空目录后中断不能证明归属；无已提交证据时不能伪装 `already_committed` 补文件。
- Linux 隔离 SQLite 使用真实 Foundation Effect Journal 的 `intend`、`settle` 和持久 marker；测试自带物理 verifier/Owner guard 记录提交，再验证精确重放没有新的物理 Effect、保留仍存在的 Stage，错误 Owner scope 被 Journal 拒绝，final 被同字节不同 inode 替换后实验原语拒绝并保留。该夹具不是实际 Arca Host 的 Reservation、Result 投影或恢复 observer，也不是生产 Receipt。
- 实验原语已调整：`already_committed` 只验证并返回，不再顺带 unlink Stage；Stage 清理必须有独立 Scope/Effect。该原语仍未接入正式流程，而且它要求当前 final 身份与原 Stage 相同，不能直接当作合法后续 Aftercare 之后的历史 Receipt 重建实现。
- Windows 本机和 Linux 隔离文件系统均在真实操作中区分本测试的 NFC `é` 与 NFD `e + ◌́`，两条不同路径各可物理创建；Windows 大小写等价竞争另有一胜一拒绝测试。同一实际 Shelf root 经 symlink/junction 和不同 Endpoint 标签访问时，实验原语拒绝该别名根并保留两方文件；这不覆盖 bind mount、UNC 或 CIFS 多挂载别名。每个结果只适用于被测目录，不证明 CIFS、其他目录或所有 Unicode 等价规则。

本次最终定向集合：禁网 Linux Docker、源码及 docs 只读挂载的 25 个文件 **441 PASS / 0 FAIL / 1 SKIP**，跳过的是大小写等价实测（该 Linux 临时目录大小写敏感）；Windows 名称和文件定向 **27 PASS / 0 FAIL / 3 SKIP**，跳过 Linux symlink 负例及两项本机未装 `better-sqlite3` 的 Journal 夹具，前者和后两者均在 Linux 通过。上述 PASS 包含按预期**复现不安全行为**的 Stage 预占反例，不代表该反例已修复。第一次 26 文件扩展运行中，`series-root-relocation-recovery.test.js` 启动的嵌套真实进程长时间未结束，主动停止本任务自有容器，该轮不计通过；后续集合明确排除该文件。第一次 25 文件运行为 **439 PASS / 1 FAIL / 1 SKIP**，失败是容器未挂载 `/docs` 导致 US Adult 测试启动时 `ENOENT`；补只读 docs 挂载后该测试单独通过，并得到上述完整 25 文件复验。以上均不替代完整 Host 或发布资格。

最终资格还包括：真实 Host 从新事实到 Acceptance/Decision/Stage/Verify/Placement/Control/Commit 的完整路径；与所有上述写入/删除路径的并发和跨进程中断；原 Owner 隔离及未知 Effect 拒绝；真实 CIFS 上实际组件上限、目录等价、稳定 Identity、独占创建/不覆盖切换及重启；新旧 Decision 和其他 Profile 的合同回归；准确冲突与失败处理的具体版本 UI 和用户指定 UI 负责人审查。实验原语不应直接接入或部署。生产未连接、未更改、未重试。
