# Arca Offer Withdrawal 与 Fresh-generation Reset 依赖审计（2026-10-29）

## 后继实现检查点

审计后，主整合为当前244表建立明确Owner保留声明：Arca Withdrawal为dependent，Custom Intent/Preview为dependent、Head为clear，演员Catalogue Basis为dependent。复制操作从同一只读源快照分页读取Arca验证过的Withdrawal，对目标中保留的精确Libra Run/Work、Package、Arca Acceptance Work及Offer Outbox/Command检查依赖；必要时保留该Withdrawal和原Command/Marker/Audit，直至保留集合不再扩张。未关联记录不进入新代际。Arca Accepted/Custody与Withdrawal矛盾、原证明缺失或篡改均拒绝；独立只读Verifier再次比较源与目标并校验原始证明，不靠相同Subject或目标名选择。

隔离夹具实际创建原Arca Withdrawal Command、Receipt、Marker和Audit，证明已保留自定义Spec的前序Run必须连同对应否决凭据保留，而同Subject无关旧Offer及其Package不保留；人为在测试策略中保留pending/delivered未ACK Outbox，真实Foundation Dispatcher重投后复用原Withdrawal、ACK且不新建Assessment。源Marker缺失、目标Receipt丢失和Accepted矛盾等负例拒绝。首次旧实现因漏留必要凭据及未检查缺证两项失败；修复后相关负例通过。首轮扩展回归61通过/1失败为缺少Closure时错误类型不正确，修正后62项通过；最新加入旧执行及People/结构回归后隔离Linux **85 PASS / 0 FAIL / 0 skip**。日志为本线程ignored目录中的`reset-withdrawal-first.log`、`reset-withdrawal-reviewed.log`、`reset-withdrawal-reviewed-retry.log`和`reset-244-closure-final.log`。

另一个隔离负例确认：此前只要保留历史Libra Run就会带入其无依赖ready Work；现在仅由Run选择已终态Work，确有其他保留证据引用的未终态Work、Attempt、Event或Effect在规范化时明确阻断。首轮两项失败及修后六项通过分别留在`reset-old-work-before.log`与`reset-old-work-cases.log`；不修改历史Work伪造完成，也不恢复旧执行。冷态239→244隔离Host的完整停止、校验备份、切换及中断恢复集合**85 PASS / 0 skip**（`reset-244-managed.log`）；后续带新规则的管理入口定向**2 PASS / 7 name-filter skip**（`reset-244-operator-final.log`）。这些是独立合成数据，不是生产数据闭包、最终合版或实际Reset通过；未来结构变化仍须重新审查。SSOT同步后，首轮P2因sourceDocumentDigest漂移失败，重新生成source map后四项静态门禁通过。

本文件是只读代码/合同审计和负例建议，不是 Retention 声明、Reset 授权或资格通过。核对的主整合快照为 `436714456014ddadc659e872e5f102409e921b4a`；唯一 SSOT 中 Fresh-generation Formation Reset 保留已完成 On-deck Commit 所需最小闭包与收藏维护责任，其余无收藏依赖的旧在线 Formation 历史清除，完整历史在校验离线备份。未连接生产，也未预检或执行 Reset。

**审计结论：不能仅凭“该 Offer 未 Accepted”就将 `arca_offer_withdrawal_receipts` 全表或其记录定为 `clear`。** 该 Receipt 是原 Offer 后续准入、重新 Assessment 和首次 Accepted 的永久否决证据；若停止态选择的保留集合仍包含能投递或重新形成该 Offer 的责任，必须在切换前证明其闭包已安全收口，或保留与该责任精确对应的否决证明及必要依赖。当前只读检查没有证明所有可能保留责任都不能重投旧 Offer；也没有证明生产中存在实际重投或错误 Accepted。具体保留方案及跨 Owner 读取须由主整合按各 Owner 合同确认。

## 已核对的事实

1. SSOT 的 `Arca Superseded Offer Closure` 仅在公开 Delivery Fence 为 `target_not_current`、没有 Libra 终态 Delivery Receipt 且 Arca 不存在 Accepted Attempt/Decision/Custody 时建立不可变 Withdrawal Receipt；不转移 Control、不写文件，也不等于 Rejected。Receipt 包含精确 Offer、原 Fence、关闭时间及摘要。已 Accepted 的重放优先，不能被撤回。迟到同 Offer 只消费同一关闭结果；初次 Inbox 结果不可被后续 Recovery 或 Withdrawal 改写。
2. `offer-withdrawal-store.js` 对 `receipt_json`、header、Package revision/digest 和整个 Receipt digest 作重建检查；`handoff-b-acceptance-store.js` 在 Assessment/Accepted 等路径查询该表并拒绝已撤回 Offer。`on-deck-process-coordinator.js` 在准入时先读 Withdrawal；有记录则校验精确 Offer、停止旧 Work 并重用 Receipt。无记录时它读取 Libra 当前 Delivery Fence：只有当前仍明确为 `target_not_current` 才能重新关闭，否则可能进入后续 Assessment 准入。最终是否能 Accepted 还取决于其他资格与 Fence，不能把缺少 Receipt 直接说成必然成功入藏。
3. `fx_outbox` 保存 `libra.product-offer.available@1` 的 Package/Offer/message identity，`fx_outbox_deliveries` 保存消费者状态和下次尝试，`fx_inbox` 保存首次消费。Foundation Dispatcher 查询 `pending/failed/delivered`，其中精确的 Handoff B→Arca `delivered` 未 ACK 允许再次投递；遇到 Withdrawal 时先重验 Arca Admission Participant，再 ACK，已有 Inbox 不重写。仓库现有 `offer-withdrawal-store.test.js` 已用真实 Outbox/Inbox 测试关闭提交后、停止 Work/ACK 前中断，以及重投沿同一 Receipt 完成；这些不是 Reset 后保留闭包测试。
4. `formation-reset-owner-policy.js` 当前从各 Owner 确定的保留根/依赖构造闭包：精确保留的 `libra_product_packages` 可通过 `producer_domain=libra`、`aggregate_type=on_deck_package`、`state=fully_acked` 关联其 `fx_outbox`，再关联对应 `fx_outbox_deliveries` 和 `fx_inbox`；`libra_delivery_receipts` 和 Package 成员也由精确 Package 关联。它不是“按 Subject 保留所有 Run/Package”，也不能仅因保留 Subject 就断言旧 Offer 被保留。该代码当前没有 `arca_offer_withdrawal_receipts` 的 Owner 选择边或无可重投责任的专门证明；完全无关联外键也不会自动选择它。
5. 主整合当前正式 `formation-reset-owner-retention.json` 仍为 **239 表**，schema digest `906ecacce4d6de62e875d1293cec93dd198564c1c53e2f7f7979d75b2eac2d0a`，没有 Withdrawal 表声明；生成 schema 为 **244 表**、digest `294bb8243aca2857729f70fa07fbc59b69efad5da5854a5db528386e19179bc6`。在禁网容器对固定代码和 manifest 直接调用纯 `buildOwnerRetentionPolicy`，返回 `RESET_RETENTION_SCHEMA_UNREVIEWED`；这验证了该函数当前 fail closed，不证明任何具体源库可通过 Reset。`formation-reset-schema.js` 的 cold import 允许新增表名单也未包含 Withdrawal 表；主整合既有 `SERIES_INTEGRATION_GATE_20261029.md` 记录的空 239→244 隔离源预检得到 `RESET_SOURCE_SCHEMA_UNREVIEWED`，不是生产数据验证。
6. `formation-reset-custom-target-copy.test.js`、`formation-reset-standard-spec-history.test.js` 和 `fresh-reset-catalogue-retention.test.js` 中的 `{table:'arca_offer_withdrawal_receipts', disposition:'clear'}` 是为了其他目标在内存里临时模拟 schema 分类的测试夹具。它们不修改正式声明，也没有据此证明 Withdrawal 的跨 Owner 投递依赖已收口。`formation-reset-copy.js` 只会沿显式 Owner seed/edge 和已选择行的 SQL FK 遍历；若有声明的保留依赖指向 `clear` 会报 `RESET_COPY_PROTECTED_DEPENDENCY_CONFLICT`，但**不存在的逻辑边不会自动被发现**。Withdrawal 表无跨 Owner FK 不能证明无依赖。

保留的 `fully_acked` Outbox 本身按当前 Dispatcher 不处于待投递队列；这降低一种直接重投风险，但不足以独立证明没有其他保留 Producer、未 ACK Delivery、持久 Work/重发责任或经公开接口重建相同 Offer 的路径。反之，如果一个精确旧 Offer 和全部投递/重建责任经各 Owner 的同一停止态快照证明均不会保留或继续执行，且离线历史按合同保全，则是否可清除其在线否决 Receipt 由主整合在该证明基础上作出，不要求无条件保留全部未入藏历史。

## 建议的负例与收口证据

以下均为建议，尚未作为 Reset 资格执行；不要求放宽停止态或越过 Owner：

1. **撤回后延迟投递**：构造精确旧 Offer 的 `pending`、`failed`、`delivered` 未 ACK 三种真实 Delivery，以及首次 Inbox 已存在/不存在两种分支。若 retained snapshot 会保留任一可重投责任却丢失该 Receipt，预检必须拒绝或保留精确 Receipt 与所需闭包；恢复后不得新建 Assessment、改写既有 Inbox digest 或产生 Accepted。
2. **保留 Producer 与关联数据**：对每条待清除 Receipt，以完整 `offerId/onDeckPackageId/packageRevision/packageDigest` 关联实际 `libra_product_packages`、可信 Outbox payload/digest、Delivery/Inbox 和精确 Work/Plan/Owner 公开引用，检查保留集合中是否仍可重建或投递该 Offer；不同 Package、同 Subject 新 Run 与无关 fully-acked 消息不得借名字或 Subject 粗粒度混入。无法证明排除时 fail closed，而不是先清除回执。
3. **关闭中断**：在 Withdrawal Receipt/Command Receipt/marker 已提交、旧 Work 尚未取消或消息尚未 ACK 的窗口复制停止态快照。验证保留或清除的各记录、原 Inbox 和 Work 状态按原合同一致；不能只留下可恢复的投递而清除唯一否决，也不能把取消中断伪装成 Accepted/Rejected 或已经停止。
4. **闭包完整性**：人为去掉或篡改 receipt header/JSON/digest、保留 Receipt 但去掉其必须重放的 Command/marker 或必要 Owner 事实、不同 Offer 复用 message/dedup、或同 Offer 与 Accepted/Custody 同时存在；必须检测完整性错误并阻断，不补造事实。现有表无 FK 的关系须由各 Owner 的显式只读描述或证据校验覆盖。
5. **无可重投责任的正例**：同一个冻结源快照和 generation fence 下，精确证明旧 Offer、未终态 Delivery、可能重新发出它的受保留责任均不在在线保留集合，完整离线备份可校验；预期由主整合确定该条 Receipt 能否清除，同时保留已 Commit 收藏、其他已 ACK 历史及不相关新的 Offer。不能通过保留整个 Subject 历史或复活旧 Run 凑闭包。
6. **双重 schema 围栏**：分别覆盖 239→244 cold import 和 244→244 已有 Withdrawals；在正式表分类、关联边、Owner 证据与验证器尚未审核时，分别保持 `RESET_SOURCE_SCHEMA_UNREVIEWED` 或 `RESET_RETENTION_SCHEMA_UNREVIEWED` 等明确阻断。测试夹具中的模拟分类不能被当成发布声明；恢复后重建/重放、断电重开与取消/ACK 窗口须在独立副本覆盖。

正式设计应将每条 Receipt 的保留或安全清除依据、Offer 身份、相关 retained references、必要 Owner/Effect 和投递状态、源快照 digest 绑定到 Reset 的停止态预检与复核；当选择结果或 source generation 变化时重新验证。这里没有确定最终表分类、修改 Owner 声明或执行任何生产动作。
