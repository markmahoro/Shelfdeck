# Movie Canary 真实用户全流程 UAT Checklist

状态：`CONFIRMED / NOT STARTED`  
确认日期：2026-08-21  
适用范围：Movie Collection Formation、Libra、Arca Aftercare、Off-deck、Shelf Deregistration  
执行入口：ShelfDeck Admin Web  

> 本文是面向真实用户操作的验收清单，不是测试脚本、自动化测试设计、架构
> SSOT 或活动实施计划。架构语义以
> `docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md` 为准。

## 1. 一句话成功定义

只有当真实用户能够在 Admin Web 中完成同根 Material Field / Shelf 的配置、媒体整理与评分、
21 部电影的完整收藏形成、Arca 维护、全量退出收藏和 Shelf 注销，并且全过程的**页面呈现、
领域状态与物理文件现实始终一致**，本次 UAT 才能判定为成功。

本次验收不接受“部分成功”。任一 Hard Gate 未通过，整体不得标记为 `PASS`。

## 2. 固定边界

### 2.1 文件边界

- [ ] 基线目录固定为 `G:\test_film`。
- [ ] 正式 Canary 目录固定为 `G:\canary_film`。
- [ ] `G:\test_film` 只作为不可变基线；不得写入、移动、重命名或删除其中任何内容。
- [ ] `G:\canary_film` 同时注册为 Material Field 和 Shelf Physical Target Folder，不拆分为两个根目录。
- [ ] 本次 UAT 不访问、不扫描、不写入 `Z:\Film`。
- [ ] 不访问 NAS，不执行 Docker/NAS/生产部署操作。
- [ ] Canary 之外的媒体目录不得因本次 UAT 发生任何物理变化。

### 2.2 产品操作边界

- [ ] 用户业务配置和业务动作全部通过 Admin Web 完成。
- [ ] 不用脚本伪造业务状态，不调用测试专用接口，不直接写数据库，不手工推进任务状态。
- [ ] 数据库、日志和文件系统只可用于只读取证；它们不能替代用户页面上的成功结果。
- [ ] 复用已经存在的 External Provider / Integration 连接，不重新录入或改写连接配置。
- [ ] 服务启动参数、隔离 data directory、端口等运行环境参数可以由技术侧准备，但不能替代产品内应由用户配置的业务选项。
- [ ] 测试开始前服务保持下线；只有在所有 Preflight 项确认后才允许启动。

### 2.3 观察频率

- [ ] 正常执行期间每 1 小时观察一次，不进行实时轮询或持续监控。
- [ ] 每次观察由用户实际打开或刷新相关管理页面，并记录可见结果。
- [ ] 只有安全边界被突破、发生范围不明的破坏性动作、服务完全不可用或需要用户授权时，才立即中断，不等待下一个整点。

### 2.4 测试中直接修复授权

- [ ] 用户授权 Codex 在 UAT 过程中直接诊断并修复发现的产品问题，无需对每个普通修复再次申请许可。
- [ ] 授权范围包括读取日志与领域事实、修改代码和测试、执行必要的本地构建、重启本地服务，以及从真实用户页面复测受影响流程。
- [ ] 修复不得直接改写数据库业务状态、手工推进 Work/Event、伪造 Evidence，或手工搬移媒体来制造通过结果。
- [ ] 修复不得触碰 `G:\test_film`、`Z:\Film`、NAS、生产数据或 Canary 之外的媒体文件。
- [ ] 如果修复需要改变已确认的架构 Owner、Business Handoff 或其他 SSOT 边界，停止该修复并先返回 Design，由用户确认架构变更。
- [ ] 每次修复记录根因、代码改动、服务重启点、受影响条目和复测范围；修复前的失败仍保留为 UAT Evidence。
- [ ] 修复完成后，从 Admin Web 重走受影响的用户步骤；仅有代码测试通过不能把 UAT 项标记为 `PASS`。
- [ ] 每个问题完成修复并通过必要验证后，立即创建一个范围清晰的 Git commit，作为独立回滚点。
- [ ] Commit 只包含该问题的相关改动，不夹带用户已有改动或其他未完成修复；commit message 使用英文并描述实际修复。
- [ ] 在修复记录中保存 commit SHA；未完成或尚未验证的尝试不得标记为已完成修复，也不得作为完成检查点继续后续 UAT。

## 3. 结果口径

| 结果 | 定义 |
| --- | --- |
| `PASS` | 所有 Hard Gate 和必测项完成；没有未关闭的失败或阻塞；页面、领域事实与文件现实一致 |
| `FAILED` | 产品行为或最终现实不符合清单；即使单元测试、脚本或数据库检查为绿色也仍是失败 |
| `BLOCKED` | 外部连接、资源或环境阻止继续，且产品向用户展示了真实原因；`BLOCKED` 不是通过 |
| `NOT RUN` | 尚未执行，不得推断结果 |

证据标签：`UI`（用户页面）、`FS`（物理文件）、`FACT`（领域事实）、`EXT`（外部连接）、
`RECOVERY`（中断/恢复）。每个关键结论至少需要 `UI`，涉及文件现实的结论同时需要 `FS`。

## 4. Hard Gates

### HG-01 基线绝对不变

- [ ] 开始前保存 `G:\test_film` 的相对路径、类型、大小和修改时间清单。
- [ ] 结束后使用相同口径再次读取。
- [ ] 两次清单完全一致。

失败条件：基线出现新增、缺失、改名、大小变化或修改时间变化。

### HG-02 同根拓扑真实成立

- [ ] Material Field 页面显示根目录为 `G:\canary_film`。
- [ ] Shelf 页面显示 Physical Target Folder 也为 `G:\canary_film`。
- [ ] 保存并刷新两个页面后，两个值仍完全相同且有效。
- [ ] 产品没有要求用户为了绕开实现限制而拆分源目录和目标目录。

### HG-03 物理材料唯一

- [ ] 若原位置已经满足最终 Shelf placement，同一 Physical Material 被原地接纳，不产生副本。
- [ ] 若确需移动、改名或由 successor 替换，旧位置不再保留同一材料。
- [ ] 每部电影在终态只有一份 Arca Inventory 所代表的主媒体现实。
- [ ] 没有 hash 命名目录、`(0)` 年份目录、源文件与收藏文件并存等重复结果。
- [ ] On-deck 后再次 Observation 不会把同根 Shelf Inventory 重新识别成 Procurement Candidate。

### HG-04 用户页面可用

- [ ] 全流程中所有必测页面均能首次打开和浏览器直接刷新。
- [ ] 没有白屏、无限加载、未处理异常、错误的成功提示或阻塞页面的长请求。
- [ ] 刷新后已保存配置、用户评分和业务进度不倒退、不消失、不重复。

### HG-05 全量闭环

- [ ] Canary 中全部 21 部电影均完成收藏形成；任何一部显式失败都使整体不能通过。
- [ ] 全部 21 个 Canary Shelf Entry 最终均由用户通过正式 Off-deck UI 完成退出收藏。
- [ ] 全量退出后，Canary 不再存在 active Shelf Entry / Deck Fact。
- [ ] Shelf Deregistration 独立完成，且该动作本身不修改物理文件。

## 5. 固定测试样本与预期覆盖

Preflight 以复制完成后的现实为准。当前基线预期为 21 个电影目录、455 个文件、约
133.95 GiB；如数量不符，先判定复制或基线问题，不启动 UAT。

| 场景 | 固定样本 / 预期 |
| --- | --- |
| BDMV | `养蜂人 (2024)`；作为一个 Movie 单元，不得把内部 M2TS 拆成多部电影 |
| ISO | `倩女幽魂2：人间道 (1990)`；作为一个 Movie 单元 |
| 缺少 NFO | `金的音像店 (2023)`；允许通过现有 Provider 能力补足，不得静默失败 |
| 普通本地 Transcode 候选 | `光荣的愤怒`、`老笠`、`短暂和平`、`立春`、`锡尔弗顿之围`、`香火`、`坠楼死亡的剖析` |
| Disc Remux / 可能继续 Transcode | `养蜂人`、`倩女幽魂2：人间道`，最终动作由用户评分生成的 Acceptance Spec 决定 |
| 当前五星 1080p External 候选 | `007：大破天幕杀机`、`地狱尖兵`、`黑客帝国动画版`、`金的音像店`、`一场很（没）有必要的春晚` |
| Direct 候选 | `第八个嫌疑人`、`放·逐`、`劫机`、`全面失控：特大号邮轮危机`、`威尼斯惊魂夜`、`有话好好说`、`战栗空间` |

> 上表用于保证路径覆盖，不把初始推测强行当成最终 Production 决策。用户在媒体整理页改分后，
> 必须以新的有效 Acceptance Spec 解释实际 Direct、Transcode 或 External 路径，并保留旧 revision 的历史。

## 6. Preflight Checklist

### 6.1 Canary 副本

- [ ] `G:\test_film` 到 `G:\canary_film` 的复制已自然完成，没有仍在写入的文件。
- [ ] Canary 与基线的相对路径、文件类型和文件大小逐项一致。
- [ ] Canary 当前为可写；基线仍保持只读使用约束。
- [ ] `G:` 剩余空间足以容纳最坏情况下的 Workspace、转码输出和临时文件。
- [ ] 保存开始前 Canary 文件清单和磁盘可用空间证据。

### 6.2 服务隔离与安全

- [ ] 使用本地隔离 UAT data directory，未连接 NAS/生产数据目录。
- [ ] UAT 中不存在指向 `Z:\Film` 或其他真实媒体库的 active Material Field / Shelf。
- [ ] 已有外部连接可被当前服务读取，但未因隔离环境而复制、覆盖或重新配置凭据。
- [ ] 服务启动后公共 Health 正常，Admin Web 可登录。
- [ ] 在执行任何 Observation 前，再次从页面确认 Field/Shelf 精确路径。

Preflight 结论：`[ ] PASS  [ ] FAILED  [ ] BLOCKED`

## 7. Admin Web 页面刷新验收

对每个页面执行：侧栏进入 → 等待首屏稳定 → 浏览器直接刷新 → 再次等待稳定 → 执行一个只读筛选或翻页。

| 页面 | 首次打开 | 直接刷新 | 状态保持 | 无白屏/5xx/未处理异常 | 证据 |
| --- | --- | --- | --- | --- | --- |
| 概览 | [ ] | [ ] | [ ] | [ ] | |
| 文件来源 | [ ] | [ ] | [ ] | [ ] | |
| 收藏架 | [ ] | [ ] | [ ] | [ ] | |
| 媒体整理 / 上架进度 | [ ] | [ ] | [ ] | [ ] | |
| 我的收藏 | [ ] | [ ] | [ ] | [ ] | |
| 收藏健康 | [ ] | [ ] | [ ] | [ ] | |
| 退出收藏 | [ ] | [ ] | [ ] | [ ] | |
| 人物 | [ ] | [ ] | [ ] | [ ] | |
| 系统设置 | [ ] | [ ] | [ ] | [ ] | |

- [ ] 后台长任务运行时，页面仍能在合理时间内响应和刷新。
- [ ] 页面展示的是可理解的业务状态，而不是内部 Event/数据库术语堆叠。
- [ ] 页面提示的成功、失败或等待状态与后续实际结果一致。

## 8. 用户配置验收

所有配置均通过页面完成并在刷新后复核。

### 8.1 Material Field

- [ ] 用户在“文件来源”新增或启用 Movie Material Field。
- [ ] 物理根目录填写为 `G:\canary_film`。
- [ ] 页面能执行并显示有效的访问/可用性检查结果。
- [ ] 用户可见且可配置本次所需的 Observation / 自动化选项。
- [ ] 保存、离开页面、刷新后配置不变。

### 8.2 Shelf

- [ ] 用户在“收藏架”新增或启用 Movie Shelf。
- [ ] Physical Target Folder 填写为同一个 `G:\canary_film`。
- [ ] Routing、Acceptance、placement、collision 和自动化相关业务选项均有用户可见入口。
- [ ] 记录本次实际采用的 placement/collision 配置：`________________`。
- [ ] 保存、离开页面、刷新后配置不变。

### 8.3 External Connections

- [ ] 只查看并确认本次所需的现有 Douban、TMDB、MoviePilot 等连接状态。
- [ ] 未重新录入、删除或改写现有连接。
- [ ] 外部连接不可用时，页面明确展示失败或阻塞原因，不把它伪装为成功。

本阶段结论：`[ ] PASS  [ ] FAILED  [ ] BLOCKED`

## 9. Procurement / 媒体整理验收

- [ ] 用户从页面触发或启用对 Canary Field 的正式 Observation。
- [ ] 页面最终呈现 21 个 Movie 整理对象，不多、不少、不重复。
- [ ] BDMV 被识别为一个 Movie 单元，ISO 被识别为一个 Movie 单元。
- [ ] 普通文件、普通目录、BDMV 和 ISO 的可见标题与材料归属正确。
- [ ] 缺少 NFO 的 `金的音像店 (2023)` 进入正常识别/补充路径。
- [ ] Provider ambiguous、not found 或连接失败时保持真实的待处理/失败状态，不自动选第一个结果。
- [ ] 用户可从页面理解每部电影目前在等待什么、失败在哪里、下一步是什么。
- [ ] 页面刷新不会重复创建 Subject、Candidate 或可见条目。

本阶段结论：`[ ] PASS  [ ] FAILED  [ ] BLOCKED`

## 10. 用户评分与 Acceptance Spec 验收

- [ ] 媒体整理页能展示已同步的用户豆瓣评分。
- [ ] 至少选取 Direct、Transcode、External 三类预期路径各一部，在页面上修改评分。
- [ ] 修改评分后页面立即或按明确状态反馈保存结果。
- [ ] 刷新后新评分仍存在；再次进入详情时一致。
- [ ] 用户直接评分优先于已有豆瓣评分，并形成新的有效 Acceptance Spec revision。
- [ ] 旧评分和旧 Spec 作为历史保留，不被覆盖或制造重复 active revision。
- [ ] 清除一次用户直接评分后，产品按正式规则恢复到可解释的评分来源和 Spec。

| 电影 | 初始豆瓣评分 | 页面设置评分 | 预期 Requirement / Production 路径 | 实际结果 | 证据 |
| --- | ---: | ---: | --- | --- | --- |
| | | | Direct | | |
| | | | Transcode | | |
| | | | External | | |

本阶段结论：`[ ] PASS  [ ] FAILED  [ ] BLOCKED`

## 11. Libra Production 与 Handoff B 验收

- [ ] 用户从页面启动/允许正式生产流程，不使用脚本或数据库推进。
- [ ] Direct 样本走真实 Direct 路径，且最终包可验证。
- [ ] 普通 Transcode 样本执行真实媒体加工，产物满足当前 Acceptance Spec。
- [ ] BDMV/ISO 样本先形成正确的单标题材料；需要时再按 Spec Transcode。
- [ ] External 样本使用已有连接取得精确匹配材料；Landing 原件不被删除或改写。
- [ ] 缺 NFO 样本生成或取得满足要求的 NFO/Metadata。
- [ ] Workspace 输入、产物与 Related Material 的来源和 settlement 均可追溯。
- [ ] 每部电影只有一个有效的当前 Libra Run / Package 结果，不出现并行重复收藏。
- [ ] Handoff B 只有在包完整、自包含且验证通过后才 Accepted。
- [ ] 失败、暂停、重试、空间不足或外部等待在页面中如实呈现，不静默 fallback。
- [ ] Handoff B Accepted 后，Libra 按 Arca durable Off-load Completion Projection 回收应回收的 Workspace 材料。
- [ ] 21 部电影全部到达 Handoff B Accepted / Arca 接管；否则整体不通过。

本阶段结论：`[ ] PASS  [ ] FAILED  [ ] BLOCKED`

## 12. Arca On-deck 与同根物理现实验收

### 12.1 收藏事实

- [ ] “我的收藏”最终显示 21 个 active Canary Shelf Entry。
- [ ] 每个 Entry 都有对应的 active Deck Fact 和可追溯的 Inventory revision。
- [ ] 海报、标题、年份、评分、版本和健康状态与实际条目一致。
- [ ] 刷新页面后条目数、详情和状态保持一致。

### 12.2 同根 settlement

逐部记录以下二者之一：

- `carried_forward`：最终 Inventory 继续引用同一 Physical Material，且只存在一份物理现实；或
- `replaced`：successor 已进入 Inventory，旧材料完成精确 settlement，旧位置不再存在。

- [ ] 21 部电影均有明确、可验证的 disposition。
- [ ] 所有 Primary、Related、Artifact 均位于预期 placement。
- [ ] `G:\canary_film` 中不存在 hash 命名收藏目录。
- [ ] 不存在类似 `标题 (0)` 的异常年份/冲突目录。
- [ ] 不存在原始位置一份、收藏位置又一份的未解释重复媒体。
- [ ] 文件指针、来源引用或历史 Binding 没有被误当作当前 Inventory 成员。
- [ ] 再次从页面触发/等待一次 Field Observation 后，新增 Candidate 数为 0。
- [ ] 再次 Observation 不改变 21 个 Shelf Entry，也不启动重复 Libra Run。

本阶段结论：`[ ] PASS  [ ] FAILED  [ ] BLOCKED`

## 13. Arca Aftercare 验收

故障注入不是业务配置。只有在 21 个 Entry 稳定 On-deck 后，才允许在
`G:\canary_film` 内对一个已记录的非 Primary Artifact/Related 文件制造一次可恢复缺失；
动作前必须记录精确 Entry、路径和预期修复方式。不得触碰基线或删除主媒体。

- [ ] 故障注入对象：`________________`。
- [ ] 精确路径：`________________`。
- [ ] 注入前 Inventory revision / 文件证据已保存。
- [ ] 下一个小时观察点，“收藏健康”显示真实 Finding，严重度和原因可理解。
- [ ] 用户从页面查看 Finding 和可用维护动作。
- [ ] 用户通过页面发起正式 Repair；不直接写文件或数据库伪造修复。
- [ ] Repair 使用 Arca 已拥有且位置明确的材料，不越权回流 Procurement/Libra。
- [ ] 修复后生成新的 Inventory revision，缺失 Artifact/Related 被恢复并验证。
- [ ] Custody、Presentation、Conformance 的新鲜 Evidence 收口后，Case 才变为 resolved。
- [ ] 非故障对象和其他 20 部电影的物理内容未被改变。
- [ ] Aftercare 不自动创建 Off-deck 授权，不继承或猜测用户的删除意图。
- [ ] 页面刷新后 Finding、Case、历史和当前健康状态一致。

本阶段结论：`[ ] PASS  [ ] FAILED  [ ] BLOCKED`

## 14. 全量 Off-deck 验收

本阶段具有破坏性，但授权严格限于 `G:\canary_film` 中 21 个 Canary Shelf Entry 的
冻结 Destruction Scope。开始本阶段前必须再次确认基线与范围。

- [ ] 用户在“退出收藏”页面选择全部 active Canary Entry。
- [ ] Review 页面逐项展示精确范围、Primary/Related 影响及共享材料风险。
- [ ] 实际 Entry 数超过高容量阈值时，产品要求并完成第二次 High-volume 确认。
- [ ] 用户在页面作出明确破坏性授权；没有授权的 Entry 不发生任何物理删除。
- [ ] 每个 Entry 都形成独立 Case/Authorization，不以一个模糊批次结果替代逐项事实。
- [ ] Physical deletion 只覆盖冻结 Inventory Scope，不删除 External Landing 或 Canary 外路径。
- [ ] 共享 Primary/Related 在仍有引用时被保留或拒绝删除，最后引用释放后才按授权处理。
- [ ] 某项删除或 Verification 失败时，该 Entry 保持可恢复的进行中/失败状态，不被伪标为 offdecked。
- [ ] 每个 Entry 只有在 Destruction Verification 完成后才终结 Deck Fact、释放 Control 并进入 offdecked。
- [ ] 最终 active Shelf Entry 数为 0，active Deck Fact 数为 0。
- [ ] `G:\canary_film` 中不再存在本次已授权 Inventory 的主媒体和应删除 Related/Artifact。
- [ ] 产品保留 Off-deck、Entry、Deck Fact、Authorization 和 Verification 历史。
- [ ] `G:\test_film` 与 Canary 外所有路径保持不变。

本阶段结论：`[ ] PASS  [ ] FAILED  [ ] BLOCKED`

## 15. Shelf Deregistration 验收

Shelf Deregistration 与 Off-deck 是两个不同动作。它只能在全量 Off-deck 验收完成后执行，
不得用来代替退出收藏或物理删除。

- [ ] 用户从“收藏架”页面发起 Canary Shelf Deregistration。
- [ ] 页面明确说明该动作是非破坏性的行政生命周期操作。
- [ ] 注销后 Shelf 不再作为 Routing / Acceptance 目标。
- [ ] 注销终结剩余 active Shelf administrative facts 并释放精确 Material Control。
- [ ] Deregistration 前后 `G:\canary_film` 的物理文件清单完全相同。
- [ ] Target Folder 本身仍存在；产品未删除、移动、重命名该目录。
- [ ] 历史 Shelf、Entry、Deck Fact 和执行证据仍可追溯。
- [ ] 如需停用/注销 Canary Material Field，用户通过“文件来源”独立执行，且动作同样不修改物理文件。

本阶段结论：`[ ] PASS  [ ] FAILED  [ ] BLOCKED`

## 16. 每小时观察记录

不在两个观察点之间持续刷新或轮询。每个观察点只记录用户在页面能看到的真实进度，并做一次最小只读取证。

| 时间 | 刷新的页面 | 当前阶段/数量 | 过去 1 小时变化 | UI 响应 | 外部/资源状态 | 安全边界 | 结论/下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |

每次观察固定检查：

- [ ] 页面能正常刷新并响应。
- [ ] 可见数量与阶段单调、可解释；没有重复条目或无原因倒退。
- [ ] 失败/阻塞有明确用户可见原因。
- [ ] 未发现基线、`Z:\Film`、NAS 或 Canary 外路径被触碰。
- [ ] 未发现 hash 目录、`(0)` 目录或同一媒体双份并存。
- [ ] 不需要新授权；如需要，立即停止相应动作并交由用户决定。

测试中修复记录：

| 时间 | 失败现象 | 精确根因 | 修复 commit SHA / 文件 | 服务重启 | 页面复测范围 | 复测结果 |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |
| | | | | | | |

## 17. 必须立即判失败的情况

出现以下任一情况，不得继续用重试、脚本修库或静默 fallback 掩盖：

- [ ] `G:\test_film` 发生任何变化。
- [ ] 服务访问或修改了 `Z:\Film`、NAS 或其他未授权媒体路径。
- [ ] Admin Web 显示成功，但领域事实或物理文件现实不一致。
- [ ] 同根场景产生 hash 目录、`(0)` 目录或源/收藏双份媒体。
- [ ] 已 On-deck Inventory 被再次 Observation 为新 Candidate。
- [ ] BDMV 内部文件被拆成多个 Movie，或 ISO 被错误展开为多个收藏条目。
- [ ] 通过直接数据库写入、测试接口或脚本推进业务状态后声称 UAT 成功。
- [ ] Provider 错误、转码错误或删除失败被吞掉，页面仍显示完成。
- [ ] Handoff B 未满足包验证就被 Accepted，或 Arca 未完成 disposition 就建立最终 Entry/Deck Fact。
- [ ] Aftercare 越权采购新媒体，或自动推断 Off-deck 授权。
- [ ] Off-deck 未经明确授权、越过冻结 Scope，或先终结事实再验证物理删除。
- [ ] Shelf Deregistration 修改或删除任何媒体文件。

## 18. 最终收口与签字

- [ ] 再次完成第 7 节全部页面刷新检查。
- [ ] 开始/结束基线清单比较通过。
- [ ] Canary 外路径无变化。
- [ ] 21 部电影收藏形成数量：`____ / 21`。
- [ ] 21 个 Entry 完成 Off-deck 数量：`____ / 21`。
- [ ] 未关闭 `FAILED` 数量：`____`。
- [ ] 未关闭 `BLOCKED` 数量：`____`。
- [ ] 所有偏差已记录到 `docs/helix/USER_ACCEPTANCE_TEST_ISSUE_LOG.md`，没有在现场静默修库。
- [ ] 如需重跑，从不可变 `G:\test_film` 重新创建新的 Canary 副本；不把本轮终态当成新基线。

| 项目 | 记录 |
| --- | --- |
| UAT 开始时间 | |
| UAT 结束时间 | |
| 操作者 | |
| Service commit / identity | |
| Material Field | `G:\canary_film` |
| Shelf Target | `G:\canary_film` |
| 开始基线证据 | |
| 结束基线证据 | |
| 关联问题 | |
| 总体结果 | `[ ] PASS  [ ] FAILED  [ ] BLOCKED` |
| 用户签字 / 确认 | |
