# Movie Canary UAT 关闭基线

状态：`FROZEN 2026-08-22 / LEDGER-DRIVEN CLEAN CANARY`

建立日期：2026-08-22

覆盖范围：`UAT-001`–`UAT-064`（64 行，无缺口、无重复）

> 本文是关闭台账的冻结验收工件，不是 Architecture SSOT，也不是活动实施计划。
> 问题叙述仍以 `docs/helix/USER_ACCEPTANCE_TEST_ISSUE_LOG.md` 为准。
> 架构语义以 `docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md` 为准。
> 操作边界以 `docs/helix/acceptance/MOVIE_CANARY_USER_UAT_CHECKLIST.md` 为准。
>
> 已删除不可靠的 `.grok/workflows/helix-beta-user-e2e.rhai`。不得再引入全链 E2E 编排器来关闭本表。
> 单元测试、脚本或 SQLite 只读都不能单独把一行标为 `PASS`。

## 1. 作业规则（现行有效）

1. **正式关闭时立刻汇报、不暂停。** 某一 `UAT-XXX` 在干净 Canary 上按本表证据标签通过、行状态改为 `PASS` 后，立即向用户汇报该 ID，然后继续下一行。不要为汇报而停下整轮关闭作业。
2. **确认关闭过程中发现新产品缺陷时暂停。** 停止当前这条的关闭判定，与用户讨论并登记新的 `UAT-XXX` 之后再继续。不得把新缺陷吞进旧行，也不得 workaround 后强行 `PASS`。
3. **关闭证据。** 每个关键结论至少要有 Admin Web 的 `UI`。涉及文件移动、重命名、删除或体积现实时同时要有 `FS`。`FACT`（领域事实、SQLite、日志）只作旁证，不能替代 `UI`。
4. **干净 Canary。** 固定只读基线 `F:\test_film`、正式目录 `F:\canary`。不访问 `Z:\Film`、NAS、生产。不得伪造 SQLite 业务状态来铸造关闭。Copy-forward 的 Douban Record 不能单独关闭 `UAT-061`。
5. **本表状态口径。** 基线冻结时的状态来自问题台账，不是 Helix-beta `HB-*` 验收。`PASS` 只在后续干净 Canary 按本表收口后写入。代码修复加回归测试最多把 `RECORDED_UNIMPLEMENTED` 推进到 `CODE_DONE_UNQUALIFIED`。
6. **一项一张作业卡。** 任意时刻只允许一个 `UAT-XXX` 处于正在封口。作业卡必须抄本表关闭命题、证人（哪部片 / 哪一页 / 哪条路径）、允许动作、禁止动作、通过标准。未把该行写成 `PASS` / `FAILED` / `BLOCKED` / 新登记之前，不得开始下一 ID。
7. **旁证停车。** 封 A 时看到 B 的现象只记作业备注，不写 B 的 `PASS`。轮到 B 再使用或补证。禁止一次巡视给多行写 `PASS`。同一部影片可以服务多行，但每行仍要独立作业卡和独立结论。
8. **按干扰排队，不按编号。** 只读、不改状态 → 轻量可逆操作 → 等本 Canary 在飞生产自然完成 → 破坏性一次一件 → 本库没有证人则 `BLOCKED` 或留待下轮，不硬凑。`UAT-064` 本程序跳过，不实现。不得为凑分重建 Canary；转码 / ISO 进行中不得为其他行重启服务。

## 2. 状态

| 状态 | 含义 |
| --- | --- |
| `CLOSED` | 已在真实 Admin Web（或已确认的干净 Canary 页面）上关闭该缺陷。本轮不必为关闭它再开专项；若新 Canary 回归失败，重新打开。 |
| `CODE_DONE_UNQUALIFIED` | 代码已落地并有回归，尚未在本关闭程序的干净 Canary 上用 `UI`（及必要时 `FS`）资格确认。 |
| `RECORDED_UNIMPLEMENTED` | 台账已登记，代码尚未实现。 |
| `VOID` | 已确认不是产品缺陷，或已被后续行吸收且不得再独立关闭。 |
| `PASS` | 本关闭程序在干净 Canary 上按证据标签正式关闭。单元测试通过不得直接写 `PASS`。 |

冻结时没有 `VOID` 行。`PASS` 列为关闭作业写入栏，冻结时全部为空。

## 3. 验证波次

| 波次 | 目的 | 典型页面 |
| --- | --- | --- |
| W0 | 已页面关闭的账，只在新 Canary 上做回归抽查 | 原关闭时的页面 |
| W1 | 设置、概览、导航、人物只读表面 | 系统设置 / 概览 / 侧栏 / 人物 |
| W2 | 文件来源观察、Handoff A、整理身份/评分/分拣 | 文件来源配置 / 媒体整理工作区 |
| W3 | 生产（Direct / Remux / Transcode）、Package、On-deck | 媒体整理工作区 / 我的收藏；`FS` |
| W4 | 豆瓣 Acquisition、Perception Resolution、Aftercare | 系统设置 / 我的收藏健康 |
| W5 | Discard 后重新入库，禁止空转评估 | 媒体整理工作区；必要时文件来源 |
| W6 | 退出收藏、Shelf 注销 | 退出收藏 / 收藏架配置 |

同一部影片可以服务多行，但每行仍要独立 `UI` 结论。不得用「23 部 completed」一口吞掉整表。

## 4. 关闭矩阵（63 行）

证据标签：`UI` 必填；`FS` 在文件现实变化时必填；`FACT` 仅旁证。

| ID | 关闭命题 | 证据 | 波次 | 冻结状态 | PASS |
| --- | --- | --- | --- | --- | --- |
| UAT-001 | 整理页豆瓣分能按 Identity Evidence 匹配到对应 Subject，匹配率达到可验收水平 | `UI` `FACT` | W4 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI Formation 多部显示豆瓣星级 |
| UAT-002 | Handoff A Intake 能持续接收 Candidate，不再被全库串行门闩打成异常低吞吐 | `UI` `FACT` | W2 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 23 Subject 已出现（11+2+3+7） |
| UAT-003 | Product Identity 不再因 TMDB 证据缺口把大量 Run 停在等待 | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-004 | 大文件媒体完整性只用中段指纹，不再整文件 SHA-256 | `UI` `FACT` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-005 | 媒体整理工作区用四桶当前状态，不再暴露内部对象语言 | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 四桶待整理/整理中/需要处理/已完成整理 |
| UAT-006 | 干净库概览显示真实计数 0，并走 Admin Session | `UI` | W0 | `CLOSED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 概览正式收藏0，非演示数字，Admin Session 登录 |
| UAT-007 | 干净库人物页显示真实 0，不再展示固定演示人数 | `UI` | W0 | `CLOSED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 人物已登记0 |
| UAT-008 | Admin Web 七个非根路径直接刷新回到对应页面，不再 404 | `UI` | W0 | `CLOSED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 八页首次打开与直接刷新 |
| UAT-009 | 整理页提交评分后刷新仍保留该评分 | `UI` | W0 | `CLOSED` | `NOT RUN` |
| UAT-010 | Routing 未配置时不开放人工选架，页面给出等待策略的明确提示 | `UI` | W0 | `CLOSED` | `NOT RUN` |
| UAT-011 | 同根 Shelf Target 前 Handoff B 能推进，不再永久等待 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-012 | On-deck Planner 带上 Settlement Approval 契约，上架能完成 | `UI` `FS` | W0 | `CLOSED` | `NOT RUN` |
| UAT-013 | 已解析身份进入用户可读目录名，不再渲染成哈希 Inventory 目录 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-014 | Formation 展示 Product Identity 冲突并提供候选选择 | `UI` | W0 | `CLOSED` | `NOT RUN` |
| UAT-015 | 冻结的 Libra Run 有用户可见的放弃入口 | `UI` | W0 | `CLOSED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 冻结行有放弃本次整理 |
| UAT-016 | TMDB 正确候选不再被本地语言/标题过滤误报为未找到 | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 设置 TMDB 首选语言简体中文 |
| UAT-017 | 外部寻源按 Acceptance Spec 预筛，不合格候选不会先下载再发现不可达 | `UI` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-018 | 顶部「需要处理」与 Discard 历史分离，Discard 不混进当前四桶 | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 需要处理桶与已结束区分 |
| UAT-019 | Executor 终态异常由 Owner 收口，Arca Acceptance Offer 不再悬空 | `UI` `FACT` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-020 | Final Inventory 成员命名与 carried-forward Settlement 完整，技术后缀不进入最终名 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-021 | TMDB 别名来源不泄漏进 Product Identity 证据，整理不在取证前全员冻结 | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-022 | 年份后的技术发布标签不再污染 TMDB 搜索词 | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-023 | 去掉技术后缀后残留年份不再导致豆瓣标题锚不相交 | `UI` | W4 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-024 | 逐成员 Settlement 后 Accepted Context 不再要求全部旧源仍存在 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-025 | Handoff A 身份快照在技术发布标签前冻结年份锚 | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-026 | Admin Web 能清除直接评分并恢复豆瓣来源 | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-027 | 恢复中的 FFmpeg progress 冲突不再把整个服务打退出 | `UI` `FACT` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-028 | 单电影目录的常见既有图像进入 Related disposition | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-029 | NFO 演员 TMDB 人 ID 不再被误判为电影身份冲突 | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-030 | 五星外部获取用身份搜索；无合格 4K 源时页面显示合法冻结，不像卡住 | `UI` | W5 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 五星冻结文案没有找到可获取的外部候选 |
| UAT-031 | Movie Field 默认扩展名含 ISO，倩女幽魂2 能被观察 | `UI` `FS` | W2 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-032 | Aftercare Custody 绑定 objectKind 与合同一致，健康评估可执行 | `UI` | W4 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-033 | 同名字幕和 stem-fanart 最终文件名可区分，同根上架不再 `TARGET_COLLISION` | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-034 | 同名片名+年份的两部养蜂人最终目录可区分且都能 On-deck | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-035 | FFmpeg 非零退出按执行失败收口，Remux Attempt 不停在 executing | `UI` `FACT` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-036 | 已观察 ISO 能通过 Triage 形成 Candidate，不再因非可播放流 `triage_failed` | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-037 | 007 身份 provider_exact 观察不被 schema 拒绝，冻结文案不是通用句 | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-038 | 上架成功后 Aftercare 健康不再是 conformance/presentation 降级 | `UI` | W4 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-039 | 同根上架不把源文件和兄弟电影目录当成占用/未知成员 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-040 | ISO 原盘 Remux 走提取路径，不把映像文件当普通流输入 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-041 | BDMV HEVC/TrueHD Remux 能处理缺 PES 时间戳，不被 Matroska 直接拒绝 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-042 | 同根 Off-load Settlement 能解释源现实漂移 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-043 | 007 身份已过后，TMDB metadata fetch 的 closed-shape / lease 失败可重试，不一次打成冻结 | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-044 | 四星 14 GiB 能规划 BDMV 多 TrueHD 轨的体积转码，音轨预算裁剪后可上架 | `UI` `FS` | W0 | `CLOSED` | `NOT RUN` |
| UAT-045 | ISO Remux 失败 Effect 与进程重启后 Attempt 能收口，不再永久 executing | `UI` `FACT` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-046 | ISO Remux 抽出 m2ts 后跳过无法 copy 的 `pcm_bluray`，不整盘重抽 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-047 | ISO 同语言编号字幕最终名可区分，验收不再 `TARGET_COLLISION` | `UI` `FS` | W0 | `CLOSED` | `NOT RUN` |
| UAT-048 | 同根终态目录的源残留不再把 Off-load Settlement 打成 `UNKNOWN_MEMBER` | `UI` `FS` | W0 | `CLOSED` | `NOT RUN` |
| UAT-049 | 盘整理完成后原 `BDMV`/`CERTIFICATE` 整棵树从收藏目录消失 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-050 | 当前媒体筛选走后端 Projection Query，不在前端筛当前页 | `UI` | W1 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 当前媒体筛选芯片与目标收藏架 |
| UAT-051 | 整理动作展示分步施工、分步进度、用户操作与加急；完成区只读同一套动作 | `UI` | W1 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 分步动作/进度/加急列 |
| UAT-052 | 我的收藏一级按架（含「全部」），详情展示占用空间与主视频规格 | `UI` | W1 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI「全部 17」/「Movie Canary 17」独立切换；第八个嫌疑人详情为占用 1.9 GB、主视频 1.9 GB · MP4、有海报/有 NFO；倩女幽魂2详情为占用 9.3 GB、主视频 9.3 GB · MKV、有海报/有 NFO；Inventory无videoStreams时页面未编造编码/清晰度 |
| UAT-053 | 活动文件来源按 SSOT 周期观察；「扫描新文件」仅进行中禁用 | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 扫描新文件进行中禁用 |
| UAT-054 | 退出收藏页面按任务重排，不再是内部安全链控制台 | `UI` | W6 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 退出收藏按审阅-授权重排 |
| UAT-055 | 人物名录接通 Beta 两条登记路径：强身份自动接受，弱身份可确认 | `UI` | W1 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 人物已登记/待确认/登记一个人 |
| UAT-056 | 豆瓣评分按周期同步；同步与刷新日志职责分离 | `UI` | W4 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 同步与评分日志拆开；本轮点同步后不再卡正在同步 |
| UAT-057 | 概览为系统状态 + 可点待办 + 带片名最近进展，不与「我的收藏」合并 | `UI` | W1 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 概览系统状态+待办+最近进展，不与收藏合并 |
| UAT-058 | 侧栏运营在上、配置在下；文件来源/收藏架改名为配置并与系统设置一组 | `UI` | W1 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 侧栏配置组：文件来源配置/收藏架配置 |
| UAT-059 | 四星转码把 `maxSizeBytes` 当拒绝线而非填满目标；已较小的 H.264 源不得灌到档位 GiB | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-060 | Product Identity 写回 Subject 不重发语义相同的 Acceptance Spec，头不空切，符合性后仍能发 Package | `UI` `FACT` | W2 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-061 | 豆瓣翻页传输失败有界重试；耗尽后 Acquisition 收口为失败，设置页可再同步。不得用 copy-forward 单独关闭 | `UI` | W4 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 本轮点同步出现正在同步，约90s后按钮恢复可点且无失败卡死（非 copy-forward 单独关闭） |
| UAT-062 | frozen Discard 后 Control 保持释放、不立刻新开 Libra Run、页面不是「正在评估整理方案」，材料走重新入库 | `UI` | W5 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-063 | Aftercare 用与 Libra 同一套 `perception.rating.resolve@1` Identity Evidence；上架后评分从无到有/变档会再评估 | `UI` | W4 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-064 | Formation 步骤 CPU/GPU 与验证完成态必须与真实执行一致，不得默认 CPU、不得把 Direct 源校验画成成品验证完成 | `UI` | W3 | `RECORDED_UNIMPLEMENTED` | `NOT RUN` |

## 5. 计数

冻结时（代码状态，不是本轮 Canary）：`CLOSED` 11，`CODE_DONE_UNQUALIFIED` 52，`RECORDED_UNIMPLEMENTED` 1（064）。

本轮干净 Canary `UAT-20260822-141950-0c27c8cf6`（HEAD `0c27c8cf6`）PASS 列：

| 口径 | 数量 |
| --- | --- |
| 总行 | 64 |
| 本轮 `PASS` | **20** |
| 本轮未通过（`NOT RUN`+`FAILED`+`BLOCKED`） | **44**（全部为 `NOT RUN`；0 `FAILED`；0 `BLOCKED`） |
| 是否都通过 | **否**（20/64，未通过 44） |

本轮 `PASS`：001、002、005、006、007、008、015、016、018、030、050、051、052、053、054、055、056、057、058、061。证据均为本隔离库 Admin Web `UI`。W3 转码/ISO/BDMV 上架、W5 Discard 重新入库、W6 退出收藏/注销在本坐席未跑完，保持 `NOT RUN`。

`UAT-005` 剩余动作合同并入 `UAT-051` 后仍保留本行，用四桶状态在新 Canary 上资格确认，不把 005 标 `VOID`。

## 6. 本关闭程序不做什么

- 不把 Helix-beta `HB-*` 标为验收 `PASS`
- 不声明整份 Movie Canary checklist 一次通过
- 不在 NAS / `Z:\Film` / 生产上取证
- 不改 SSOT Owner/Handoff（`L5-Q7` Discard 仍是「重新入库」，不是把 Control 留在 Libra 再开 Run）

## 7. 单项关闭作业卡

### UAT-052（`PASS`）

- 关闭命题：我的收藏一级按架（含「全部」），详情展示占用空间与主视频规格。
- Canary：`UAT-20260822-141950-0c27c8cf6`；当前代码工作区HEAD以关闭提交记录为准。
- 证人：Admin Web「我的收藏」；收藏架「Movie Canary」；电影「第八个嫌疑人」「倩女幽魂2：人间道」。
- 路径：登录 → 我的收藏 → 比较「全部」与「Movie Canary」一级架导航及计数 → 打开「第八个嫌疑人」详情。
- 允许动作：页面进入、只读切换、打开/关闭详情、页面刷新、截图；SQLite/日志仅可只读旁证。
- 禁止动作：修改评分、启动/重试/放弃Run、重新观察、重启服务、重建Canary、修改文件或数据库；当前NVENC转码不得受本项影响。
- 通过标准：页面同时提供「全部」与活动收藏架入口，切换后的墙和计数一致；详情可见当前占用空间、主视频体积/容器、视频规格（有事实才显示）、海报/NFO状态；页面不从Libra整理过程或磁盘临时probe编造字段。
- 证据要求：`UI`。
- 旁证停车：本作业观察到的其他UAT现象只记备注，不改其他行结论。
- 关闭结论：`PASS`。页面「全部 17」与「Movie Canary 17」均可独立选中且墙为17部；「第八个嫌疑人」展示占用`1.9 GB`、主视频`1.9 GB · MP4`、有海报/有NFO；「倩女幽魂2：人间道」展示占用`9.3 GB`、主视频`9.3 GB · MKV`、有海报/有NFO。只读Inventory Product Fact无`videoStreams`，页面没有编造codec/raster。
- UI证据：`admin-web-evidence/uat-052-shelf-movie-canary.png`、`admin-web-evidence/uat-052-detail-eighth-suspect.png`、`admin-web-evidence/uat-052-detail-chinese-ghost-story-2.png`（位于本Canary隔离证据目录）。
