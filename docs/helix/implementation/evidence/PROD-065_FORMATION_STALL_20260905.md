# PROD-065：NFO 全生命周期复核与 Design-return

日期：2026-09-05。状态：根因已复现；尚未修复或部署。
基线：`d486947c8`；独立 worktree / branch：`codex/prod065-settlement-failure`。
生产操作均只读，没有重启、SQLite 修改、Reset、删除或移动媒体。

## 1. 结论

过去修正承认了最终 NFO 可由外部 Writer 改写，但未闭合旧输入 NFO 的连续性与删除授权。
在同根场景，最终 NFO 已可按语义验收，旧 NFO 一旦被正常改写仍无法 Settlement，进而不能建立 Shelf Entry。
另外，非纯异常恢复把无 Marker 当作 remaining，并在过期预算上重复 continue_forward，掩盖实际冲突。
把后者改成明确失败只能解决假运行，不能解决 NFO 正常改写后应当能完成上架的产品目标。

## 2. 生产证据

| 影片 | 状态与精确证据 | 判断 |
| --- | --- | --- |
| 寒战2 (2016) | Subject `libra-subject-9379b1755aaff22a34e7dad9b46d614687c80844`；Related NFO identity succeeded；TMDB exact identity 三个 Event Attempt 均 `PLATFORM_INTEGRATION_NETWORK_FAILED`；Run frozen | 本片当前不是 NFO Settlement 阻塞；底层网络原因被 adapter catch 抹去，无法据历史记录区分 DNS/TLS/代理/连接问题 |
| 静水城 (2021) | Libra completed；Arca offloading；Event `ondeck-settlement-d4e755faf26a0b3236-0003`；初始日志 `CLEAN_ARCA_SETTLEMENT_REALITY_DRIFT` | 旧 NFO 冻结 10871 bytes，当前 9756 bytes，指纹不同；当前修改时间 2026-09-04 01:14:17Z |
| 绣春刀 (2014) | Libra completed；Arca offloading；Event `ondeck-settlement-2eaf9a501949e88d6d-0003`；初始日志同上 | 旧 NFO 冻结 6915 bytes，当前 6898 bytes，指纹不同；当前修改时间 2026-09-04 01:12:33Z |

两条旧 NFO 均仍存在。文件发生改写已证明；这两次的具体写入进程没有审计证据，不能仅凭 XML 推定为 Emby。
现场另有《霍比特人1：意外之旅》《哪啊哪啊神去村》Settlement residue；后者明确报
`CLEAN_ARCA_SETTLEMENT_UNKNOWN_MEMBER`，涉及未纳管 torrent、字幕和 sample，不得混入 NFO 连续性授权。

## 3. 历史修正为何没有闭合本次问题

| 历史 | 已解决 | 未覆盖 |
| --- | --- | --- |
| PROD-028 / `6eb5863b4` | Aftercare 按身份与拥有字段评估说明书，避免 whole-file hash 抢写 | 上架前、旧输入删除 |
| PROD-035/037 / `da600b512` | Placement 后 Final Verify、Fulfillment、Commit 重读最终 NFO，记录实际 physical identity；Aftercare revision 收敛 | 原输入 NFO 在不同路径被改写后的连续性与精确删除 Approval |
| PROD-040 / `c44d0a702` | 同 Run prior Placement Receipt 证明最终 NFO 非陌生冲突，可恢复 Stage | prior Placement 证明的是 final target，不是原输入新版本的删除授权 |
| PROD-045 / `0ab91e243` | 修复 Libra 自己生成 genre、actor/movie ID 错误；Staged Verify 提前检查 | 外部正常改写与旧源连续性 |
| PROD-064 / `9e73fe760`、`d8d25a95a` | Aftercare renderer 集合字段幂等、Aftercare Settlement 失败收敛 | On-deck Settlement Executor 是另一条实现，仍裸抛前置失败 |

历史记录自身已承认多次只覆盖下一处窗口。不能把这些历史 PASS 当作全生命周期完成证明。

## 4. 当前代码审计

| 环节 | 定位 | 当前语义 |
| --- | --- | --- |
| Libra Related NFO 读取 | `media-service/src/clean-product-production-port.js:551` | 校验 Handoff A reference 的 inode、size、fingerprint；正常改写也可能导致 `CLEAN_PRODUCT_NFO_REALITY_MISMATCH`。这是同类潜在断点，不是本次两片现场已发生的错误 |
| Arca final NFO 验证 | `media-service/src/clean-arca-inventory-port.js:1546` | metadata_sidecar NFO 按 Movie Identity 与 owned presentation fields 校验 |
| Arca 旧源 Settlement | 同文件 `settleInputAsync`，约 1786–1945 | final NFO 先语义检查，old source 不同路径时又按 frozen size/fingerprint 检查，漂移即拒绝 |
| Executor 失败 | `media-service/src/helix/domains/arca/capabilities/on-deck-capability-ports.js:333` | Settlement 无 typed pre-effect failure 转换；与 Placement/Aftercare 已有转换不同 |
| Reality observer | `media-service/src/helix/composition/create-procurement-execution-runtime.js:455` | destructive scope 没有 Marker 即 remaining，没有证明当前现实确可继续 |
| Recovery budget | `media-service/src/helix/foundation/execution/event-runtime.js:643`、`:697` | durable recovery deadline 不续期；safe_retry 可终态，continue_forward 过期仍抛异常，Host 后续继续尝试 |

## 5. 本地最小复现与测试盲点

对现有 `clean-arca-inventory-port.test.js` 的 same-root fixture 进行内存插桩，在旧 NFO identity 冻结后，
只添加 `<dateadded>2026-09-05</dateadded>`，title/year/plot/genre/TMDB/actor 全部保持不变。
Final Inventory 与 replacement 已通过原有验证。调用真实 `settleInputAsync`，稳定得到
`CLEAN_ARCA_SETTLEMENT_REALITY_DRIFT`；源文件仍存在。

2026-09-05 本地五项 same-root fixture 通过，其中新增断言证明缺陷仍存在，**不是修复后 PASS**。
没有把临时插桩作为源码修改。首次插桩因测试变量名错误失败，修正变量后复现成立。
原 same-root success fixture 在删除调用前即时计算旧 NFO identity，没有模拟从历史 Snapshot 到清理之间的改写；
final NFO semantic rewrite fixture 的 offloadContext 为空，因此不能证明旧 NFO Settlement 支持外部 Writer。

## 6. 精确合同缺口与 Decision Packet（历史提出，现已授权实施）

当前 SSOT Final Reality amendment 允许最终 NFO 的实际 physical identity 改变；但 5.8.7 与 6.5.3 明确限定
Approval 仅覆盖 Handoff B 已接管、已由最终验证证明替代的旧 Input Identity。Physical Material Identity 又包含
inode/size/fingerprint，故不能把新字节当作旧 Identity 直接删除。已有 Approval revision 更新条款不自动证明
新物理版本仍属于原来接管的唯一 Related 成员。

推荐确认：**NFO 是可变的资料呈现文件，其受管关联连续性不能等同于某次字节快照。**

1. 原关联的 Primary、Owner、精确位置及 NFO role 必须连续且唯一；不能靠 `.nfo` 后缀、目录或相似片名取得权限。
2. 外部正常改写产生新的实际 Snapshot / Evidence，不改历史 Candidate、Package、Plan、Receipt；领域 Owner
   按正式连续性合同消费新证据。错电影、共享、陌生替换、不可解析或无法证明关联保持阻断。
3. 最终 NFO 仍按 ShelfDeck 内部 Identity / Metadata / Cast 验证；不能将 Emby 内容提升为 Canonical Facts。
4. 对已经证明仍为同一唯一受管 NFO 的旧版本，Arca 在 standing Authorization 覆盖下，从当前现实重派生精确
   Settlement Approval；删除前核验当前版本及 replacement，消除“格式改写导致必须人工清理”这一失败模式。
5. 身份连续、内容呈现是否达标、实际删除哪个 Snapshot 是三个独立证明。旧 NFO 不必与新成品全部字段相等，
   否则“旧资料被新版补齐并替代”的正常路径仍会失败。
6. Recovery 区分未删除、已删除未记账、部分完成、源改变、未知成员，保存精确证据；不能以 Marker 缺失猜测
   remaining，不能无限重放已过期 deadline，也不能把已发生删除回写成未发生。

本决定改变旧输入 NFO 物理版本变化后可否自动处置的不可逆授权语义，触发 AGENTS.md Change Discipline 与
ENGINEERING_PLAYBOOK §3.3 Design-return。实施线程不能自行修改 SSOT；需要用户协调 Architecture Agent
确认并形成可识别合同记录后再实施。不会用局部 typed failure 补丁冒充此次根治。

## 7. 完成标准

在 source observation 后、Libra 读取前、Placement 前后、Settlement 前、删除后回执前、Fulfillment/Commit 前
以及 Aftercare 和 restart 中分别注入 Emby 等价改写；同时覆盖 inplace rewrite 与 atomic replacement、同根/不同根、
旧 NFO 与最终 NFO 同址/异址。完整新建 Formation 应可达到 On-deck Commit。
错片、共享/陌生 NFO、持续写入、权限失败、未纳管其他文件作为负向夹具，证明没有扩权或假成功。
寒战2的网络故障另行追踪，不用 NFO 修正声明其已恢复。生产恢复和部署需各自明确授权。


## 8. 2026-09-07 实施审计

用户已明确答复“授权本任务完成合同、审计和修复”，本任务承担本包合同固化；不是重新确认NFO事实原则。
SSOT的Final Reality、MetadataObservation和ProductionProvenance已补齐源NFO的语义连续性。

- 原输入NFO：一次bounded snapshot读取当前bytes，记录实际Snapshot digest，不重新声称旧Physical Identity是当前版本。
- 不可变证据：MetadataObservation保存关键标量、genre/director/studio集合及演员/Provider身份；XML表示、重复集合项、无关Emby字段不影响该证据。
- 交接：现有ProductionProvenance JSON内按sourceRef携带同Run观察。无需新增物理表列，DDL保持基线；无自动迁移、旧Package补写或兼容恢复路径。
- Arca：限定原exclusive related mapping，比较已有关键事实；新增不冲突字段可以存在，旧NFO无需包含后来补充的Product Facts。最终NFO仍验证完整accepted presentation。
- 精确删除：当前版本通过连续性检查后，再次stable snapshot核对，记录实际preDeleteIdentityDigest。源已不存在的恢复或同址no-op使用NULL，避免伪造删除前像。
- 恢复：确定前置失败返回typed failure；continue-forward预算耗尽持久化失败并释放资源，不循环续用过期deadline；物理Effect的不确定日志不会因Event终态被错误abandon。
- 其他确定缺陷：CDATA/实体只解码一次、XML换行规范化、genre集合去重、同名不同强演员ID不能通过验证，renderer恢复所需演员。
- 解析复用：纯XML及NFO语义record逻辑位于contracts包；Domain不依赖filesystem/integration适配器。

本地已有证据：50项Inventory adapter测试（含24个新NFO改写/拒绝组合及删除后重放）、81项恢复/交接测试、源语义专项测试通过；真实Admin HTTP的8项既有验收通过。完整回归与加入源NFO改写、重启、交接、On-deck的专项正在收尾，最终结果以追加验收记录为准。

生产当前残留不能从缺失历史witness推造授权。部署和旧Formation处置需另行给出明确方案并获授权；本次未修改生产。


## 9. 端到端复现补齐的两个遗漏

1. 新增测试在真实本地Admin HTTP流程中提供NFO，等待MetadataObservation持久化，原子改写NFO并重启，再继续同Run。初次失败停在artifact_production：productMetadataContext重建旧Observation输入时调用issuePhysicalReadHandle，仍进入exactPhysicalReality并产生CLEAN_PRODUCT_REALITY_MISMATCH。修复后NFO专用Handle从不可变Reference确定性重建，不读取当前mtime/bytes；当前现实只由观察Executor记录。普通Primary及Shelf Acceptance的精确物理检查保持原合同。该场景最终通过On-deck Commit，数据库中的ProductionProvenance.sourceNfoObservations逐字节等于重启前观察，源NFO实际已清理。
2. 同名NFO覆盖在Placement Switch的完整preflight中检查原Related mapping与原语义witness，并在最终修改前复核快照。过去仅以managed pathname允许替换的fixture改为负向断言：没有原映射/原事实证据或同Run Placement Receipt，不能覆盖陌生文件。独立Aftercare仍使用其既有当前修改授权。

源NFO专项覆盖30个组合：Settlement同步/异步×同根/异根×6种改写/冲突，另有6种同址Placement覆盖。56项Inventory测试与30项Aftercare effect safety测试合计86项通过。NFO源观察重建还验证了普通非NFO同等物理漂移继续被拒绝。

架构验收：npm run test:helix-architecture通过，210个测试文件，dependency/semantic/manifest/contracts无findings；合同aggregateDigest为b2ff9915fcc1739603a695af5ff2bcb22f875eb945edbfc9cdc603ef1f7c646d。仅因正式合同字段变化更新其锁定摘要，未放松校验。

服务完整回归的并行执行曾出现已在修复前复现的FFmpeg watchdog定时测试偶发超时；未修改FFmpeg运行时或该测试来掩盖失败。当前串行重跑完整服务集合，以消除跨测试进程调度干扰，结果追加于最终验收。


## 10. 最终本地验收（2026-09-07）

- 完整服务集合：node --test --test-concurrency=1 test/*.test.js，491项，473 PASS / 18条件SKIP / 0 FAIL，150秒。18项依赖显式外部媒体/环境的场景未运行；不以此声称生产/真实Emby集成已验证。
- 架构：npm run test:helix-architecture，210个测试文件PASS，所有合同、机器库存、依赖及语义检查PASS。
- 源改写全链：真实本地Admin HTTP + SQLite + 实际文件原子替换 + 服务重启；Provider/Probe使用测试替身。证明原witness未被当前文件替代，最终到达On-deck且旧NFO已清理。
- 同名覆盖及Aftercare：86项PASS，缺少映射/证据、Movie或title冲突均保留原文件。
- git diff --check：PASS；DDL与表库存不变；未执行自动数据迁移、旧数据补证或生产恢复。
- 本地Windows验证完成。Docker/Linux/NAS上的真实Emby并发写入、部署与生产残留处置未执行，需后续对应Gate。

交付范围为本次已定位根因的合同与代码修复。生产旧Package没有新源语义证据，不能凭当前内容倒推历史授权；旧Formation处置与上线必须另行明确方案。本地已验证的新建流程不得再以格式/mtime/hash变化无限卡住。
