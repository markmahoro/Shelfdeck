# ARCA-PATH-COMPONENT-BUDGET 本地证据（2026-10-29）

## 范围与依据

基线为 `a2bf2d6fd3271dc3a3741e28ed42f533a59d99d4`。本工作仅在隔离工作区、Linux Docker 和合成文件中验证；没有连接 NAS、操作或 Reset 生产数据，也没有修改既有生产 Decision。工作项由主整合 Phase 跟踪，不新建 UAT 编号。

此前只读排查中，HALT-094 的目录、文件名及带 `.tmp-` 后缀的文件名分别为 232、236、257 UTF-8 bytes；EMLB-094 分别为 264、268、289 bytes。六次首发异常均在 CIFS 上的临时路径 `lstat` 报 `ENAMETOOLONG`，先于复制；对应暂存目录为空，未发现放置或提交证据。每个条目各有三个 Work generation，每个 Effect 的恢复窗口约一小时；缺少提交 marker 时原通用 material-commit observer 要求 forward，重复相同路径，最终各自耗尽预算。此处不把缺少 marker 推断为没有写入。

SSOT §6.5.3、§10.5.3 由 Arca 冻结 Final Inventory Decision 并持有 Placement，SSOT JAV 约定对非法、过长或碰撞路径使用现有错误合同；已入藏 JAV Correction 不能通过自动后缀避让碰撞。路径无法安全表达时，不能静默缩短名称或改变旧 Decision 来制造成功。

## 实现和验证边界

- Arca 在形成新 Decision 和开展 Inventory Feasibility 时按 UTF-8 bytes 校验每个路径组件。当前实现以 255 bytes 为单组件上限，为 `.shelfdeck-stage-` 加 16 位后缀保留 33 bytes，为 `.restore-` 加 16 位后缀保留 25 bytes；后者也覆盖较短的 `.tmp-` 后缀。目标目录最后一个组件最多 222 bytes，最终文件名最多 230 bytes，其余路径组件最多 255 bytes。碰撞策略产生的后缀也在形成 Decision 前检查。
- 移除原来的 UTF-16 `slice(0, 180)` 静默截断，保留完整扩展名、剧集标记和可表示的 US Adult 原名；超限或无效 Unicode 明确失败。目录和文件名不自动追加 hash，不删除或覆盖冲突材料。US Adult 超限继续使用其原名不可改写的错误合同。
- `arca.acceptance.inventory_feasibility.observe@1` 是纯观察。仅在该纯观察中，Arca 将确定的目标组件错误返回为 `retryDirective: never` 的失败，并保留有界字节数字作为诊断；其他未知异常照原样传播。没有改变 Foundation 对非纯 Effect 的观察、恢复或重试判断。
- 旧 Decision 仍须通过原有完整摘要/内容比对。历史名称因取消截断而与重建结果不同，测试确认 `CLEAN_ARCA_FINAL_DECISION_DRIFT` 在创建 Slot 前拒绝；本工作不迁移、修复或重写旧条目。旧 Decision 自身超限也会被明确拒绝。
- 对极长剧名叠加大量集号、最终完整组件超限的情况，保持集号不截断并在写入前拒绝；32 集短标题的合成示例仍完整保留所有集号。

修复前，两个合成多字节案例在 Linux Docker 的实际暂存中复现 `ENAMETOOLONG`。修复后，边界内的两组合成案例完成 Stage、展示文件恢复、验证和 Placement；超限案例在写入前拒绝。相关测试覆盖同步/异步 Inventory 路径、旧 Decision、US Adult 原名、JAV Correction、目录及文件后缀边界、碰撞、不可用 Unicode、Series 集号/缩略图和未知错误传播。Linux 容器内使用本地基线镜像的 Node 20 和只读源码挂载，网络禁用；相关 12 个测试文件共 214 项通过，`git diff --check` 通过。

## 未完成项

- 这项预防性修复不使 HALT-094 或 EMLB-094 的旧 Effect 自动恢复，也不证明它们已入藏；生产上的旧状态仍须依各自事实、既有合同及单独授权处理。继续使用原冻结的超限名称将被拒绝。
- 255-byte 预算是当前实现的保守限制，不是所有 Endpoint 文件系统能力的证明；真实 CIFS 路径及生产端到端验证未执行。
- 本地修改会改变历史上曾被 180 个 UTF-16 单元截断的名称，并可能改变可见路径或报错。未做对应版本的 UI 任务走查及用户指定 UI 负责人的审查；不得声明 UI/UAT 通过。
- 完整服务测试未完成：隔离容器缺少仓库工具依赖 `tools/node_modules/ssh2`，且后续测试涉及本项之外的 Reset 逻辑，已停止该容器。本地全量尝试中的 Reset 测试仅使用隔离合成数据。部署、发布和生产验收均未进行。

## 追加复核：长标题可否自动缩短

2026-10-29，针对“前置拒绝尚不足以完成上架”的复核，读取本工作区 SSOT，并通过本地 Git 只读比较当时整合分支 `afe279548` 的对应段落；以下合同在两者一致。结论是**工作项继续开放**，现有证据不足以按当前合同实现未经确认的自动缩写，也不能把 `b492e3a1a` 视为两条案例已解决。

1. SSOT §5.5.10 的 Movie 默认 stem 是 `片名 (年份)`，只有显式用户 Placement 模板渲染结果可以改变默认名；digest 等内部技术名称不得直接成为永久 Shelf 名称。该条适用于 Movie，不能直接当作所有 Profile 的同一命名规则。
2. SSOT JAV 来源与身份合同的推荐 Placement 是「番号 + 标题」、Primary/NFO 同 stem，`jav_code` 为独立 typed token；非法、过长、碰撞路径走现有错误合同。该条没有定义新条目长标题自动截短的规则。JAV Correction 另明确不通过自动后缀避让碰撞。历史 `safeSegment(...).slice(0, 180)` 是代码行为，不是对缩写、碰撞和身份保留的合同授权。
3. US Adult 有独立精确保名合同，以首次原名主体和实际容器扩展名命名；现有实现对不可保留原名的情况明确失败。不能将任何潜在的普通/JAV 缩写规则推广到它。
4. 当前 Arca Placement Policy 闭合 token 只有 `{title}`、`{year}`、`{stem}`、`{ext}` 等；`inventoryDisplayIdentity` 对非 US Adult 只向渲染传入 title/year/edition。虽然 SSOT 要求 `jav_code` 为独立 typed token，当前该渲染路径没有暴露 `{jav_code}`：不能通过猜测标题中的字符串证明截短后保留了完整番号。此差距需要在 Arca 的 Policy/Decision 合同及实现中明确处理，不能通过搬到 Libra 或从文件名猜测补值解决。

合成验证分别构造 232/236/257 与 264/268/289 bytes 的 JAV 目录、媒体名和 `.tmp-<16hex>` 临时名，与现场两种字节形状一致，但不使用真实标题或媒体。当前 `b492e3a1a` 分别在目标目录预算 222 和 255 bytes 的检查处拒绝；目标根仍空，源文件不变。它们**没有完成 Stage、Placement 或 Commit**。HALT 形状的正式目录本身小于 255 bytes，222 是现实现对旧 sibling Slot 后缀的保守预算；EMLB 形状的正式目录本身超过 255 bytes。两者不能混为同一种限制。

另一个合成反例使用相同完整番号 `IPX-178` 和仅在长标题末尾不同的两份名称。直接按 222-byte UTF-8 前缀截断，两份结果相同，即使番号仍完整也会碰撞；当前实现对两者都在写入前拒绝。反例只证明朴素前缀截断不安全，并不证明不存在其他符合用户意图的方案，也不授权自动 hash/后缀避让。新添加的三项合成负例、现有模板负例及相关 12 个测试文件在禁网 Linux Docker 中共 **218 PASS / 0 FAIL / 0 skip**，`git diff --check` 通过；这不是两条新条目成功上架的证明。

需要先由用户确认的新条目合同问题：是否允许 Arca 在保留完整 typed 番号、必要身份、扩展名及 Primary/NFO 关联的同时，对标题进行可预览、确定性且版本化的缩写；当不同完整输入映射到同一短名、已有目标被其他 Entry 占用、或无剩余预算时如何明确拒绝或处理；是否允许任何永久后缀。若允许，先修订 SSOT 和 Placement Policy/预览合同，再在 Arca 形成新 Decision 前实现并验证；不能事后重写 Decision。独立、短的**系统临时名**可能避免 HALT 形状的临时后缀超限，但需单独证明 Slot 命名、Intent、未知文件和中断恢复；它不能使 EMLB 形状的 264-byte 正式目录可寻址，当前未实施或宣称资格。

旧条目的路径单独处理：SSOT §6.5.5 要求 Accepted 后的 Off-load 在原 On-deck Run 和冻结 Basis 上恢复，不能撤回 Accepted、退回 Libra 或伪造上架；两条现有 Decision 仍将指向超限名称，普通重试不能解决。Fresh-generation Formation Reset 是另一项**停止态、全范围管理操作**：需要明确本次生产授权、冻结范围、完整校验备份和收藏/依赖保护；未提交运行归档并清除在线状态，来源及正式收藏文件保留，专用暂存清理须独立冻结和校验。它不能替代新条目根因修复，也不能从“无 Commit”推断可直接删 Slot。本次未验证存在仅针对这两条的现成单项退役入口；未经精确授权与 Owner/Effect 证据，不作任何恢复、重试、清理或 Reset。

## 现有合同、模板与用户可见状态

以下是现行 SSOT 原文和适用范围，不是新的合同决定：

| 位置 | 原文摘录 | 本案含义 |
| --- | --- | --- |
| §5.5.10 Movie Shelf Placement Policy | “只有显式用户Placement模板的渲染结果可以改变上述默认名。” | Movie 默认名不能由后台另加未声明的缩写规则；不将这段直接扩大为所有 Profile 的完全相同命名规则。 |
| “JAV资料来源、身份与封面合同” Placement 段 | “推荐Placement为‘番号 + 标题’目录、同stem Primary/NFO及固定poster/fanart名，jav_code是独立typed token……路径非法/过长/碰撞使用现有错误合同。” | 现行 JAV 合同未规定如何自动缩写标题；超长渲染结果走现有错误。 |
| “JAV身份纠正范围”上架后段 | “不能用后缀自动避让或删除冲突文件冒充成功。” | 这是已入藏 JAV Correction 的明确限制；它不是一条允许对首次上架自动加后缀的规则。 |
| §6.6.8 US Adult 单片演员刷新 | “冻结的原文件名生成‘演员名 + 空格 + 原名主体’，扩展名对应实际容器” | US Adult 不纳入拟议的 JAV 缩写规则。 |
| §6.5.5 恢复、幂等与 Workspace 释放 | “Off-load中断时必须恢复同一On-deck Run，不能创建第二份Shelf Entry或退回Libra。” | Accepted 后的旧责任不能通过更换模板或伪造新条目改写。 |

当前可保存的目录模板必须包含完整 `{title}`；Primary 模板必须包含 `{stem}` 与 `{ext}`，NFO 必须包含 `{stem}`。在当前实现里 stem 本身由完整 title 和可用年份组成；模板没有截取操作，也不接受 `{jav_code}`。用户可将有额外年份或固定文字的目录模板改为 `{title}`，只在额外部分造成超限时可能缩短目录；它不能缩短 title 本身，也不能让 Primary stem 省略实际已并入的年份。两组合成样本的 title 自身分别为 232/264 bytes，最短的 `{title}` 仍不能通过当前 222/255 预算；真实两条冻结 Decision 也不会因发布新模板被改写。现有 `suffix` 碰撞选项会增加名称长度，不能作为截短功能。发布 Placement revision 还会触发已有收藏的影响预览与既有 Aftercare 评估，不是本次授权。

`b492e3a1a` **没有部署**。按代码和禁网隔离投影模拟：新条目的纯 Inventory Feasibility 以 `CLEAN_ARCA_TARGET_SEGMENT_INVALID`、`retryDirective: never` 失败，保存可用的 `actualBytes/maxBytes` 诊断；同一 Event 不再耗费 material-commit 的一小时恢复预算。Arca Acceptance Recovery 投影会标为 `attention_required`，通用下一步为“媒体整理完成，收藏架验收或上架失败”，且当前 `canRetry` 为 true，界面可出现“重试上架”。相同输入与策略的人工重试不会缩短名称；当恢复触发摘要改变时，Owner 的其他 Work-generation 规则仍需单独评估，不能把 Event 的 `never` 说成全局永不重试。

过程节点的隔离投影结果是“检查上架可行性 / 执行失败”，描述回退为“这一步没有完成；ShelfDeck 记录的失败代码是 CLEAN_ARCA_TARGET_SEGMENT_INVALID。”，失败原因显示“系统没有保存可展示的文字原因”。当前详细诊断查询主要读取 On-deck 或 Libra 执行，未把 Acceptance 的字节数字接成该条目的可操作提示；前端即使收到仅含字节数字的 diagnostics，也不渲染这些字段。以上是代码路径与合成投影，不是完整 Host/浏览器现场验收；这一 UI 缺口和无效重试入口不能标为通过。

## 供确认的最小合同修订方案（设计稿，未批准、未实施）

**待确认范围：仅首次 JAV single On-deck 的新 Decision；Movie、Series、US Adult、JAV Correction 和既有 Decision 保持各自现行合同。** 若用户选择保留当前精确渲染/超长报错，不做以下变更，本工作项继续受长标题阻断。

1. **显式启用与身份。** 由 Arca 为 Shelf Placement Policy 增加版本化、闭合的长标题选项，默认仍为 `reject`；只有用户明确启用 JAV 标题前缀模式并完成预览后才允许缩短。该模式的模板须显式包含一次 `{jav_code}` 和一次 `{title}`；番号只从冻结且已验证的 `provider=jav / namespace=jav_code / providerKey` 读取，完整保留前导零与后缀，不从标题或路径猜测。候选规则：标题恰以完整番号加一个空格开头时，该精确前缀作为番号展示，剩余文本作为标题；其他情况保留整段标题，不作模糊去重。正式 Identity/Metadata Fact 永不截断或改写。
2. **按完整结果计算字节预算。** Arca 在形成新 Decision 前，结合冻结 Policy、Endpoint 能力、目录字面量/edition/年份和所有相关最终成员的实际扩展名/字幕限定词，计算同一个标题前缀。逐一校验生成目录、正式文件及使用的临时名、恢复名与 Slot；按当前实现，组件上限取 255 bytes 时目录预留 33 bytes、文件预留 25 bytes，也覆盖较短的 21-byte `.tmp-` 后缀。255 只是当前保守上限，不能替代 Endpoint 的实际文件系统能力证明；若不存在可靠上限或文件系统不支持该名，应明确阻断。标题前缀按固定版本 Unicode 分段规则确定，不截断 code point/组合字形，不使用非法 Unicode；若固定番号、保留字段和至少一个完整标题字形都放不下，明确失败。
3. **名称关系与碰撞。** 目录、Primary、NFO 使用同一冻结前缀及完整番号，实际容器扩展名、NFO 扩展名及必要的字幕/edition 信息不变；固定 poster/fanart 和本应保留原名的其他成员不能借此被截短。完整名称已符合预算时不缩短。不同完整标题映射到同一目标、同号不同 Entry、外来目录/文件或未知文件系统等价关系，均不凭相同番号或短名前缀合并；Arca 结合 Inventory/Control、目标 Reservation 与实际 Endpoint 语义进行竞争安全检查，不能安全区分就返回冲突并保留原文件。此提案对缩写冲突采用拒绝，不自动加 hash、数字或其他永久后缀。
4. **人工冲突与版本边界。** UI 展示冲突目标及可核实的处理范围，只有存在正式、可达的更改规则或目标操作时才提供该操作；当前闭合模板不支持单片短名，不承诺一个尚不存在的逐片别名入口。若要新增逐片指定名称或扩大碰撞后缀能力，须作为明确的新合同另行确认。新规则只作用于用户确认的 Policy revision 下尚未冻结的 Decision；已有 Accepted/Decision、Receipt、Work、Effect 及现场不重写。发布新 Policy 对已入藏 Entry 的影响须按 §5.5.10 预览并沿既有 Aftercare 规则处理，不能假装零影响，也不能将本设计视为授权生产迁移。
5. **验收。** 先传播经确认的 SSOT、Policy schema/validator、Preview、Arca Owner/Plan/Decision 及必要文档，再实现；合成 232/236/257 和 264/268/289 两种形状必须真实完成 Stage→Verify→Placement，最终名称含完整番号、对应扩展名及相同 stem，原始完整标题仍在事实中。负例包括多字节/组合字形、乱码、过小预算、同前缀不同完整标题、同号不同 Entry、目标被占用、大小写/规范化等价、并发 Reservation、未知成员、不同成员后缀和中断恢复；既有 Decision 与未知 Effect 状态不得被覆盖或推断为零写入。
6. **UI 与发布。** Shelf 规则保存前可见实际短名示例及缩写结果；新条目的“需要处理”状态指出路径长度或冲突，并提供真实可达的下一步，不能把恒定失败的“重试上架”当解决方案。按 Playbook §11.1/§12.3 和 Beta 基线 §7.1 覆盖正常、缩写、冲突、失败和完成态及键盘/窄屏；由于是跨层及用户可见命名变化，须用户指定 UI 负责人审核**具体版本**。本地测试、真实 CIFS 资格、UI、完整 Gate 和生产发布各自单独记录，任何一项缺失都不能宣称已验收。

本段仅供主整合向用户说明并取得明确决定；未修改 SSOT、Policy、UI、运行逻辑或生产。若用户确认的是不同的预算、缩写或冲突语义，应先改设计而非按本草案猜测实施。
