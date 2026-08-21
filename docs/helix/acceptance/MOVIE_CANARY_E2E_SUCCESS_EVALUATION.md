# Movie Canary E2E 成功评估与终态对账标准

状态：`CONFIRMED FOR NEXT CLEAN RUN`

适用范围：下一轮独立任务中的真实 Admin Web Movie Canary E2E/UAT

关联执行清单：`docs/helix/acceptance/MOVIE_CANARY_USER_UAT_CHECKLIST.md`

> 本文回答“怎样才算测试成功”。它不是脚本测试设计，也不允许用数据库或脚本制造业务通过。
> 架构语义以 `docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md` 为准；操作步骤以关联 Checklist 为准。
> 本文与旧现场路径冲突时，下一轮固定使用本文的 `F:` 路径。

## 1. 最终结论的定义

下一轮只有在以下结论同时成立时，才可以标记为 `PASS`：

1. `F:\test_film` 在开始和结束时完全相同；
2. `F:\canary` 从基线的精确副本开始，只通过真实 Admin Web 业务流程发生变化；
3. 22 个顶层媒体单元形成且只形成 22 个 Movie Subject；
4. 22/22 Movie 全部到达 Arca On-deck Commit；
5. Arca 中存在 22 个唯一 active Shelf Entry、22 个唯一 active Deck Fact，并且每个 Entry 的
   Inventory 能逐文件解释 `F:\canary` 中的最终现实；
6. `F:\canary` 最终只有 22 个用户可读的电影目录，每部电影只有一个最终 Primary 现实；
7. 页面刷新、服务重启和重复 reconcile 不产生重复事实、重复文件或状态倒退；
8. 没有未闭环技术失败、无 Ack Delivery、悬空 Acceptance、无限恢复循环或用户不可见的未知候选行为；
9. 全程未访问 `Z:\Film`、G 盘旧 Canary、NAS、SSH、Docker、生产环境或 Canary 以外媒体目录。

任一项不成立，即使自动化测试全部通过，也不能宣布本轮成功。

## 2. 本轮成功检查点与破坏性后续阶段

本文定义的主成功检查点是：**22/22 已稳定进入 Arca，且 `F:\canary` 已整理完成并保留现场**。

在该检查点完成截图、逐文件清单和签字以前：

- 不执行 Off-deck；
- 不执行 Shelf Deregistration；
- 不删除或重建已经通过的 `F:\canary`。

原因是 Off-deck 的正式目标就是退出收藏并可能删除已授权的 Inventory 文件；如果先执行它，便无法再用
`F:\canary` 的整理终态证明本轮 Collection Formation 成功。Aftercare、Off-deck 和 Shelf
Deregistration 如需继续验收，应在主检查点签字后作为第二阶段记录，或从 `F:\test_film` 另建新的 Canary 运行。

## 3. 固定物理边界与基线指纹

### 3.1 固定路径

| 用途 | 固定路径 | 权限/作用 |
| --- | --- | --- |
| 不可变基线 | `F:\test_film` | 只读；禁止写入、移动、改名或删除 |
| Material Field | `F:\canary` | 只允许本轮 ShelfDeck 流程操作 |
| Shelf Physical Target | `F:\canary` | 与 Material Field 同根 |
| Libra Workspace | `<isolated UAT data directory>\workspaces\libra` | 系统隔离、按需创建；不得指向 Canary |

G 盘旧目录只作为历史现场，不属于下一轮测试范围，不读取、不复用。

### 3.2 已只读核验的基线总量

下一轮启动前必须重新得到以下精确结果，否则立即停止：

| 指标 | 精确期望 |
| --- | ---: |
| 顶层媒体单元 | 22 |
| 文件 | 455 |
| 递归目录 | 42 |
| 文件总字节 | 143,829,090,011 |

开始前和主成功检查点各生成一次相同口径的基线 Manifest。比较键必须至少包括：

- 相对路径；
- 文件或目录类型；
- 文件大小；
- 修改时间。

四项必须零差异。不得只比较文件数量或总大小。

### 3.3 Clean Canary 起点

正式 Observation 前，`F:\canary` 必须是从 `F:\test_film` 复制得到的新目录，并通过相同四项严格比较。
禁止使用 `/MIR`、`/MOVE`、`/PURGE`，禁止覆盖一个已有目录来伪装 clean start。

如果上轮 Canary 已被业务流程或失败修复污染，应先原子重命名保存为
`F:\canary.failed-<timestamp>-<short-sha>`，再创建原本不存在的 `F:\canary`。历史失败现场不得删除。

## 4. 必须通过页面确认的运行配置

以下配置必须在 Admin Web 中可见、可保存，并在刷新后保持：

- Material Field：`F:\canary`；
- Shelf Target：`F:\canary`；
- TMDB 语言：`zh-CN`；
- MoviePilot 最大下载尝试：3；
- MoviePilot Landing 与 Libra Workspace 互相独立，也都不与 Field/Shelf 重叠；
- Placement：
  - 目录：`{title} ({year})`；
  - Primary：`{stem}{ext}`；
  - NFO：`{stem}.nfo`；
  - 字幕：`{stem}{language}{forced}{sdh}{ext}`；
  - Poster：`poster{ext}`；
  - Fanart：`fanart{ext}`；
  - Collision：`reject`；
- 保存前预览必须呈现类似：
  `示例电影 (2026)\示例电影 (2026).mkv`、`示例电影 (2026).nfo`、
  `示例电影 (2026).zh-CN.forced.sdh.srt`、`poster.jpg`、`fanart.jpg`。

当前运行仅支持 `default` Resource Profile。下一轮不得声称已经验收“火力全开”；该能力不属于本轮通过条件。

## 5. 22 部电影的身份与形成结果

### 5.1 唯一性

必须同时证明：

- 22 个 Candidate Package；
- 22 个且只有 22 个 Subject；
- 每个基线顶层单元恰好对应一个 Subject；
- BDMV 内部 M2TS 不得拆成多个 Movie；
- ISO 不得展开成多个 Movie；
- `养蜂人`目录内的 BDMV、现有 MKV 和 Related Material 只能形成一部 Movie；
- 再次 Observation 后新增 Candidate 为 0，不重开已 On-deck 的 Inventory。

### 5.2 评分与身份专项门禁

- `养蜂人`显示 `4 星 · 豆瓣`；
- `看不见的朋友`显示 `5 星 · 豆瓣`；
- `香火`显示 `4 星 · 豆瓣`；
- 至少对一部电影通过页面设置直接评分，刷新后仍为“我的评分”；
- 再通过页面清除该直接评分，恢复为原有豆瓣来源或可解释的“暂无评分”；
- `坠楼死亡的剖析`如出现 TMDB `Anatomy of a Fall (2023)` 身份冲突，必须显示候选并由用户确认，不能自动选第一个结果；
- 任一身份、评分或候选为 unknown 时，页面必须显示 unknown/需要处理，不能继续下载或伪装完成。

### 5.3 Formation 四桶

“待整理、整理中、需要处理、已完成整理”必须互斥，行级状态与四桶计数一致，合计始终为 22：

- 只有 Arca On-deck Commit、Shelf Entry 和 Deck Fact 全部成立才是“已完成整理”；
- Package published、Handoff B Accepted 仍是“整理中”；
- Frozen、Suspended、Executor failure、身份待确认、Acceptance 技术失败是“需要处理”；
- 用户放弃的旧 Run 只在历史中显示“已结束 · 用户放弃”，不能占用当前四桶的重复名额。

## 6. `F:\canary` 的最终目录合同

### 6.1 顶层必须恰好是以下 22 个目录

| # | 最终目录 | 最终 Primary 模式 | 样本专项 |
| ---: | --- | --- | --- |
| 1 | `007：大破天幕杀机 (2012)` | `007：大破天幕杀机 (2012)<final-ext>` | External 候选/真实 Probe |
| 2 | `地狱尖兵 (2022)` | `地狱尖兵 (2022)<final-ext>` | External 候选/真实 Probe |
| 3 | `第八个嫌疑人 (2023)` | `第八个嫌疑人 (2023)<final-ext>` | Direct |
| 4 | `短暂和平 (2013)` | `短暂和平 (2013)<final-ext>` | Transcode |
| 5 | `放·逐 (2006)` | `放·逐 (2006)<final-ext>` | Direct |
| 6 | `光荣的愤怒 (2006)` | `光荣的愤怒 (2006)<final-ext>` | AVI/Transcode |
| 7 | `黑客帝国动画版 (2003)` | `黑客帝国动画版 (2003)<final-ext>` | External 候选/真实 Probe |
| 8 | `劫机 (2024)` | `劫机 (2024)<final-ext>` | Direct |
| 9 | `金的音像店 (2023)` | `金的音像店 (2023)<final-ext>` | 缺 NFO |
| 10 | `看不见的朋友 (2023)` | `看不见的朋友 (2023)<final-ext>` | 顶层单文件转标准目录 |
| 11 | `老笠 (2016)` | `老笠 (2016)<final-ext>` | Transcode/Settlement 回归 |
| 12 | `立春 (2007)` | `立春 (2007)<final-ext>` | Transcode |
| 13 | `倩女幽魂2：人间道 (1990)` | `倩女幽魂2：人间道 (1990)<final-ext>` | ISO 单 Movie/字幕冲突 |
| 14 | `全面失控：特大号邮轮危机 (2025)` | `全面失控：特大号邮轮危机 (2025)<final-ext>` | Direct |
| 15 | `威尼斯惊魂夜 (2023)` | `威尼斯惊魂夜 (2023)<final-ext>` | Direct |
| 16 | `锡尔弗顿之围 (2022)` | `锡尔弗顿之围 (2022)<final-ext>` | Transcode |
| 17 | `香火 (2003)` | `香火 (2003)<final-ext>` | 豆瓣评分/Transcode |
| 18 | `养蜂人 (2024)` | `养蜂人 (2024)<final-ext>` | BDMV 单 Movie/现有 MKV |
| 19 | `一场很（没）有必要的春晚 (2022)` | `一场很（没）有必要的春晚 (2022)<final-ext>` | External 候选/真实 Probe |
| 20 | `有话好好说 (1997)` | `有话好好说 (1997)<final-ext>` | Direct/逐成员 Settlement |
| 21 | `战栗空间 (2002)` | `战栗空间 (2002)<final-ext>` | Direct/多字幕 |
| 22 | `坠楼死亡的剖析 (2023)` | `坠楼死亡的剖析 (2023)<final-ext>` | 身份确认/Transcode |

`<final-ext>` 不能在测试前凭文件名猜测。它必须来自当前 Acceptance Spec、实际 Production 路径和最终真实 Probe；
Direct 可以保留经验证的扩展名，Remux/Transcode 通常形成 `.mkv`，External 必须以下载完成后的真实 Probe 为准。
无论扩展名为何，stem 必须严格等于目录名。

### 6.2 每个目录的最低逐文件要求

每个 Movie 目录至少必须有：

1. 恰好一个当前 `primary_payload`：`片名 (年份)<final-ext>`；
2. 恰好一个当前 NFO：`片名 (年份).nfo`；
3. 恰好一个当前 Poster：通常为 `poster.jpg`；
4. 当前 Product/Inventory 要求的字幕，按
   `片名 (年份)[.language][.forced][.sdh].ext` 命名；
5. 如 Product Package 或既有受管 Related Material 含 Fanart，则为 `fanart.<ext>`；
6. 被识别的 `banner`、`clearlogo`、`landscape`、`logo`、`discart` 等其他 Related Material：
   要么以原稳定名称进入 Inventory，要么有逐成员、可验证的 supersede/settlement 结果，不能静默遗失。

`金的音像店`和`看不见的朋友`的源没有 NFO；成功终态仍必须有由正式 Provider/Product 流程生成并验证的标准 NFO，
不能手工复制或创建。缺少现成 Poster 时同理。

### 6.3 字幕与碰撞

- 语言、forced、SDH 后缀只有在 Evidence 能证明时才添加；未知语言不能猜成 `zh-CN`；
- 多条字幕不能覆盖同一路径，也不能生成随机 hash 或内部 ID；
- `倩女幽魂2：人间道`基线含大量同型字幕，系统必须给出确定性、用户可解释的唯一命名或明确进入“需要处理”；
- Collision Policy 为 `reject` 时，任何无法无损决定的冲突必须在写入前停止，不能产生 `(0)`、`(1)` 或静默覆盖。

### 6.4 BDMV、ISO 与双表示

- `养蜂人`最终只是一部 Movie、一个 Shelf Entry 和一个 Primary；
- BDMV 内部 `.m2ts`、playlist、certificate 等不能各自成为 Inventory Primary；
- `养蜂人`的 BDMV 和现有 MKV 都必须有明确 disposition，不能在最终目录中形成两个等价 Primary；
- `倩女幽魂2：人间道`的 ISO 只形成一部 Movie；若 Acceptance Spec 要求 stream file，ISO 是输入而不是永久第二 Primary；
- Disc 输入完成 Remux/Transcode 后，旧 Disc 表示只有在冻结授权、Final 验证和 Settlement 完成后才可移除。

### 6.5 绝对禁止的最终文件现实

出现以下任何一项，物理终态立即判定失败：

- 顶层仍有 `看不见的朋友 ... CHDWEB.mkv` 这类散落单文件；
- hash、Subject ID、Run ID、Package ID 或 Event ID 命名目录；
- `片名 (0)`、`片名 (年份) (1)` 或其他碰撞逃逸目录；
- 永久文件名包含 `transcode-*`、`.partial-*`、`.staged-*`、`.tmp`；
- 同一主媒体字节在旧位置和最终位置同时保留且没有共享材料解释；
- BDMV/ISO 被拆成多部电影；
- Final Inventory 未列出的遗留 Related Material；
- Inventory 指向不存在、越界或与记录大小/指纹不一致的文件。

## 7. Arca 必须展示并可逐文件对账的内容

### 7.1 收藏总览

“我的收藏 · Arca”必须显示：

- 当前收藏 `22` 部；
- 每部恰好一张卡片，无重复身份；
- 规范化片名、年份、Shelf 名称和 Poster；
- active 状态；
- 当前健康状态，且技术失败不能显示为健康完成。

### 7.2 每部 Entry 详情

每部电影的 Arca 详情或其正式链接的 Inventory 详情必须向普通 Admin 用户展示：

- Shelf Entry ID 与状态；
- Canonical Content Identity：Provider、Provider Key、片名、年份；
- Deck Fact 当前 revision；
- Inventory 当前 revision；
- Standard revision 与 Placement revision；
- On-deck Commit/完成时间；
- Custody、Presentation、Conformance 三维健康结论与 Evidence 新鲜度；
- **逐文件 Inventory 成员表**。

逐文件成员表每行至少显示：

| 字段 | 成功要求 |
| --- | --- |
| Role | `primary_payload`、`metadata_sidecar`、`subtitle`、`poster`、`fanart` 或明确 Related role |
| 文件名/相对路径 | 精确相对于 `F:\canary`，用户可读，不泄漏内部 ID |
| 大小 | 与磁盘实际字节一致 |
| 当前状态 | current/active，或明确 superseded/settled 历史 |
| 来源/形成方式 | Direct、Remux、Transcode、External、Provider Artifact 或 carried-forward Related |
| Disposition | carried forward、replaced/moved and settled，或有理由的 superseded |
| Verification | Final Probe/Artifact 验证通过；至少可见结果和时间 |

如果 Admin Web 只能显示“Inventory r1”而不能让用户看到具体有哪些文件，则本项不通过；数据库里存在文件记录不能替代用户验收。

### 7.3 三方逐项相等

对每个 Entry，必须满足：

`Arca 当前 Inventory 文件集合 = Final Inventory Decision 文件集合 = F:\canary 对应目录的受管文件集合`

比较至少包括 role、规范相对路径、类型、大小和当前/历史状态。差异处理规则：

- 磁盘有、Inventory 无：失败，属于遗留或越权文件；
- Inventory 有、磁盘无：失败，属于 Reality drift；
- 两边都有但路径/大小不同：失败；
- 历史 superseded 文件仍在最终位置：失败，除非有明确共享引用且页面可见；
- Final 文件已正确但旧源仍存在：Settlement 未闭环，失败。

## 8. External、Executor 与恢复门禁

### 8.1 MoviePilot

- 候选必须先按标题/年份、大小、媒体要求和明确不合规项预筛；
- 明确不合规候选不得下载；
- 信息未知候选可以保留，但 unknown 必须在页面可见；
- 下载尝试最多 3 次；
- 下载完成后必须对真实落地文件 Probe，不能以种子名或候选元数据代替；
- External Landing 原件不得被当成 Shelf Inventory，也不得被 Settlement 删除；
- 导入 Libra Workspace 后必须形成独立 Physical Material。

### 8.2 技术失败闭环

- Executor failure 显示为“需要处理”，包含稳定错误码、阶段、尝试次数和恢复入口；
- 终态失败不能显示“已完成整理”；
- 自动恢复最多建立一个合法新代际，不得无限循环；
- 用户重试保留旧 Work/Event/Attempt 历史；
- 重启和重复 reconcile 不重复文件效果、Acceptance、Delivery、Ack、Shelf Entry 或 Deck Fact；
- 不存在 Handoff B Acceptance 无对应 Ack Delivery，也不存在 On-deck Commit 前未完成的逐成员 Settlement。

## 9. 证据包与最终判定表

下一轮应在隔离 UAT data directory 外建立只读报告目录，但不得放进 `F:\canary`。至少保存：

1. Git branch、起始 SHA、每个修复 commit SHA、最终 SHA 和 clean status；
2. `F:\test_film` 开始/结束 Manifest 及零差异报告；
3. Clean copy 后 `test_film`/`canary` 四项零差异报告；
4. On-deck 完成后的 `F:\canary` 完整相对路径/类型/大小/mtime Manifest；
5. Admin Web 九页首次打开、刷新、返回和服务重启恢复证据；
6. 22 行 Formation 终态及四桶计数；
7. 22 张 Arca Entry 详情证据和逐文件 Inventory 导出/截图；
8. 每部电影的 Inventory/Decision/FS 三方比较结果；
9. MoviePilot 候选预筛、unknown 可见性、下载和真实 Probe 证据；
10. 所有失败、根因、修复 commit、专项回归、架构门禁、Admin Web build 和真实页面复测记录。

最终签字表：

| Gate | PASS 条件 | 结果 |
| --- | --- | --- |
| Baseline | `F:\test_film` 前后四项零差异 | |
| Clean start | 初始 Canary 与基线四项零差异 | |
| Identity | 22 Candidate → 22 unique Subject | |
| Ratings | 三部指定豆瓣评分正确；直接评分/清除恢复通过 | |
| Formation | 四桶互斥、合计22、失败不冒充完成 | |
| Libra | Direct/Transcode/External/Disc/缺NFO全部真实执行与验证 | |
| Handoff B | 22/22 Accepted，无悬空/无Ack/无限恢复 | |
| Arca | 22 Entry + 22 Deck Fact + 22 current Inventory | |
| Files | 22标准目录、每部唯一Primary、Related全部有Disposition | |
| File UI | Arca逐文件展示与磁盘现实一致 | |
| Recovery | 刷新、重启、reconcile不重复 | |
| Safety | 未越过任何路径/环境边界 | |
| Open failures | `FAILED=0`、`BLOCKED=0` | |

只有全部为 `PASS`，总体结果才是 `PASS`。

## 10. 修复纪律

UAT 中发现问题时：

1. 先记录用户操作、页面现象和最小只读物理证据；
2. 定位精确根因，不使用 workaround、静默 fallback 或直接改库；
3. 如修复越过 SSOT Owner/Handoff 边界，停止并返回 Design；
4. 修改代码与专项测试，执行相关 Architecture/Persistence Gate 和 Admin Web build；
5. 从真实 Admin Web 重走受影响流程；
6. 每个完成且验证过的问题单独 Git commit；
7. 如果 immutable Candidate/Run 或 Canary 文件现实已污染，保留失败现场并从基线重建，不在污染现场续跑；
8. 从最后一个可证明安全的页面检查点继续。

测试脚本只能证明修复的局部技术性质，不能代替本文任何 `UI + FS` 成功结论。
