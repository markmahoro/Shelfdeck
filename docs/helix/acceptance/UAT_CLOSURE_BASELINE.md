# Movie Canary UAT 关闭基线

状态：`FROZEN 2026-08-22 / LEDGER-DRIVEN CLEAN CANARY`

建立日期：2026-08-22

覆盖范围：`UAT-001`–`UAT-066`（66 行，无缺口、无重复）

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

## 4. 关闭矩阵（66 行）

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
| UAT-012 | On-deck Planner 带上 Settlement Approval 契约，上架能完成 | `UI` `FS` | W0 | `CLOSED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 第八个嫌疑人已为当前收藏且健康；FS主视频精确存在于F:\canary，大小2009890078与Inventory一致 |
| UAT-013 | 已解析身份进入用户可读目录名，不再渲染成哈希 Inventory 目录 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI第八个嫌疑人；FS目录F:\canary\第八个嫌疑人 (2023)存在，非哈希且无(0)年份 |
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
| UAT-032 | Aftercare Custody 绑定 objectKind 与合同一致，健康评估可执行 | `UI` | W4 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 第八个嫌疑人已上架详情显示收藏健康为健康、保管为健康，不再停在never_assessed |
| UAT-033 | 同名字幕和 stem-fanart 最终文件名可区分，同根上架不再 `TARGET_COLLISION` | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-034 | 同名片名+年份的两部养蜂人最终目录可区分且都能 On-deck | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 两个独立健康养蜂人当前Entry；FS普通版与edition目录各有一份MKV，非hash且无(0)年份 |
| UAT-035 | FFmpeg 非零退出按执行失败收口，Remux Attempt 不停在 executing | `UI` `FACT` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-036 | 已观察 ISO 能通过 Triage 形成 Candidate，不再因非可播放流 `triage_failed` | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-037 | 007 身份 provider_exact 观察不被 schema 拒绝，冻结文案不是通用句 | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-038 | 上架成功后 Aftercare 健康不再是 conformance/presentation 降级 | `UI` | W4 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 倩女幽魂2已上架详情刷新后收藏健康为健康，保管/呈现/合规均为健康 |
| UAT-039 | 同根上架不把源文件和兄弟电影目录当成占用/未知成员 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI同根兄弟电影均已当前收藏且健康；FS两个养蜂人一级目录独立、无嵌套兄弟目录或.partial |
| UAT-040 | ISO 原盘 Remux 走提取路径，不把映像文件当普通流输入 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-041 | BDMV HEVC/TrueHD Remux 能处理缺 PES 时间戳，不被 Matroska 直接拒绝 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-042 | 同根 Off-load Settlement 能解释源现实漂移 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-043 | 007 身份已过后，TMDB metadata fetch 的 closed-shape / lease 失败可重试，不一次打成冻结 | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-044 | 四星 14 GiB 能规划 BDMV 多 TrueHD 轨的体积转码，音轨预算裁剪后可上架 | `UI` `FS` | W0 | `CLOSED` | `NOT RUN` |
| UAT-045 | ISO Remux 失败 Effect 与进程重启后 Attempt 能收口，不再永久 executing | `UI` `FACT` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-046 | ISO Remux 抽出 m2ts 后跳过无法 copy 的 `pcm_bluray`，不整盘重抽 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `NOT RUN` |
| UAT-047 | ISO 同语言编号字幕最终名可区分，验收不再 `TARGET_COLLISION` | `UI` `FS` | W0 | `CLOSED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI倩女幽魂2已为当前收藏；FS 56条zh-CN字幕名全部唯一，含未编号与.1-.55，无hash/(0)补丁 |
| UAT-048 | 同根终态目录的源残留不再把 Off-load Settlement 打成 `UNKNOWN_MEMBER` | `UI` `FS` | W0 | `CLOSED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 8.3 GB BDMV养蜂人已为当前收藏且健康；FS主视频存在、大小匹配、目标无BDMV/CERTIFICATE残留 |
| UAT-049 | 盘整理完成后原 `BDMV`/`CERTIFICATE` 整棵树从收藏目录消失 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 8.3 GB BDMV养蜂人已为当前收藏；FS两个养蜂人根中BDMV/CERTIFICATE为0、正式MKV为2 |
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
| UAT-065 | 收藏详情只从主视频basename解析容器，不得把父目录名中的`.1`显示为容器 | `UI` | W1 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 8.3 GB BDMV养蜂人主视频修复后显示8.3 GB · MKV，不再显示· 1 |
| UAT-066 | Formation 已完成整理表按目标Shelf ID显示当前收藏架名称，不得整列显示`—` | `UI` | W1 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 已完成整理17/17条均显示Movie Canary，当前媒体6条显示未回退 |

## 5. 计数

冻结时（代码状态，不是本轮 Canary）：`CLOSED` 11，`CODE_DONE_UNQUALIFIED` 52，`RECORDED_UNIMPLEMENTED` 1（064）。本轮逐项关闭期间新增并完成`UAT-065`、`UAT-066`；当前代码状态为`CLOSED` 11、`CODE_DONE_UNQUALIFIED` 54、`RECORDED_UNIMPLEMENTED` 1（064）。

本轮干净 Canary `UAT-20260822-141950-0c27c8cf6`（HEAD `0c27c8cf6`）PASS 列：

| 口径 | 数量 |
| --- | --- |
| 总行 | 66 |
| 本轮 `PASS` | **31** |
| 本轮未通过（`NOT RUN`+`FAILED`+`BLOCKED`） | **35**（全部为 `NOT RUN`；0 `FAILED`；0 `BLOCKED`） |
| 是否都通过 | **否**（31/66，未通过 35） |

本轮 `PASS`：001、002、005、006、007、008、012、013、015、016、018、030、032、034、038、039、047、048、049、050、051、052、053、054、055、056、057、058、061、065、066。证据均包含本隔离库 Admin Web `UI`；要求文件现实的行另有`FS`。W5 Discard 重新入库、W6 退出收藏/注销在本坐席未跑完，保持 `NOT RUN`。

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

### UAT-038（`PASS`）

- 关闭命题：上架成功后 Aftercare 健康不再是 conformance/presentation 降级。
- Canary：`UAT-20260822-141950-0c27c8cf6`。
- 证人：Admin Web「我的收藏」→「Movie Canary」→「倩女幽魂2：人间道」详情；该条目已On-deck且当前收藏健康为健康。
- 路径：我的收藏 → Movie Canary → 打开「倩女幽魂2：人间道」详情 → 读取收藏健康总状态及保管/呈现/合规三项状态 → 刷新后复核。
- 允许动作：页面进入、只读切换、打开/关闭详情、页面刷新、截图；SQLite/日志只读旁证。
- 禁止动作：点击「立即检查健康」、修改评分、退出收藏、重启服务、重建Canary、修改文件或数据库；当前NVENC转码不得受本项影响。
- 通过标准：已上架证人在详情页显示收藏健康为健康，保管、呈现、合规均为健康；不再出现`old_binding_unreadable`或`nfo_corrupt`降级。
- 证据要求：`UI`。
- 旁证停车：本作业观察到的其他UAT现象只记备注，不改其他行结论。
- 关闭结论：`PASS`。重新打开本地Admin Web并刷新收藏页后，「倩女幽魂2：人间道」仍显示「收藏健康 · 健康」，保管、呈现、合规三项均为健康；没有`old_binding_unreadable`或`nfo_corrupt`降级。
- UI证据：`admin-web-evidence/uat-038-aftercare-healthy-chinese-ghost-story-2.png`（位于本Canary隔离证据目录）。

### UAT-032（`PASS`）

- 关闭命题：Aftercare Custody绑定`objectKind`与合同一致，健康评估可执行。
- Canary：`UAT-20260822-141950-0c27c8cf6`。
- 证人：Admin Web「我的收藏」→「Movie Canary」→「第八个嫌疑人」详情；该条目已On-deck并完成Aftercare健康评估。
- 路径：我的收藏 → Movie Canary → 打开「第八个嫌疑人」详情 → 读取收藏健康总状态及保管状态。
- 允许动作：页面进入、只读切换、打开/关闭详情、截图；SQLite/日志只读旁证。
- 禁止动作：点击「立即检查健康」、修改评分、退出收藏、重启服务、重建Canary、修改文件或数据库；当前NVENC转码不得受本项影响。
- 通过标准：已上架证人不再停在`never_assessed`，详情页保管状态为健康，证明Custody评估已成功执行且未被`objectKind` schema拒绝。
- 证据要求：`UI`。
- 旁证停车：呈现/合规状态及其他条目健康只作本项旁证，不改其他行结论。
- 关闭结论：`PASS`。「第八个嫌疑人」已上架详情显示「收藏健康 · 健康」，其中保管为健康并有完成时间，不再是`never_assessed`；Custody评估已经成功执行。
- UI证据：`admin-web-evidence/uat-032-custody-healthy-eighth-suspect.png`（位于本Canary隔离证据目录）。

### UAT-012（`PASS`）

- 关闭命题：On-deck Planner带上Settlement Approval契约，上架能完成。
- Canary：`UAT-20260822-141950-0c27c8cf6`。
- 证人：Admin Web「我的收藏」→「Movie Canary」→「第八个嫌疑人」；Inventory主视频`F:\canary\第八个嫌疑人 (2023)\第八个嫌疑人 (2023).mp4`。
- 路径：我的收藏 → Movie Canary → 打开「第八个嫌疑人」详情确认当前收藏 → 只读核验Inventory主视频现实。
- 允许动作：页面进入、只读切换、打开/关闭详情、截图；文件系统、SQLite和日志只读旁证。
- 禁止动作：启动On-deck、修改评分、退出收藏、重启服务、重建Canary、修改文件或数据库；当前NVENC转码不得受本项影响。
- 通过标准：真实Admin Web显示证人已建立当前Shelf Entry且健康；Inventory声明的主视频在`F:\canary`精确路径存在，大小与Inventory一致；页面不再停在「等待收藏架接收」。
- 证据要求：`UI`、`FS`。
- 旁证停车：目录命名、Aftercare状态及其他Entry只作旁证，不改其他行结论。
- 关闭结论：`PASS`。真实Admin Web显示「第八个嫌疑人」属于Movie Canary当前收藏且健康；Inventory主视频`F:\canary\第八个嫌疑人 (2023)\第八个嫌疑人 (2023).mp4`真实存在，大小`2009890078`字节，与Inventory声明精确一致。
- UI证据：`admin-web-evidence/uat-012-ondeck-complete-eighth-suspect.png`（位于本Canary隔离证据目录）。
- FS证据：2026-08-22只读`Get-Item -LiteralPath`核验上述精确路径，`Exists=True`、`Length=2009890078`、`SIZE_MATCH=True`。

### UAT-013（`PASS`）

- 关闭命题：已解析身份进入用户可读目录名，不再渲染成哈希Inventory目录。
- Canary：`UAT-20260822-141950-0c27c8cf6`。
- 证人：Admin Web「我的收藏」中的「第八个嫌疑人」；对应Inventory目录`F:\canary\第八个嫌疑人 (2023)`。
- 路径：我的收藏 → Movie Canary → 打开「第八个嫌疑人」详情确认用户可读Identity → 只读核验Inventory父目录名及主视频路径。
- 允许动作：页面进入、只读切换、打开/关闭详情、截图；文件系统、SQLite和日志只读旁证。
- 禁止动作：修改评分、退出收藏、移动/重命名文件、重启服务、重建Canary、修改数据库；当前NVENC转码不得受本项影响。
- 通过标准：页面Identity为「第八个嫌疑人」，Inventory位于用户可读的`第八个嫌疑人 (2023)`目录，目录名不是Package/哈希ID，也不含错误年份`(0)`。
- 证据要求：`UI`、`FS`。
- 旁证停车：成员命名、Settlement和其他Entry目录只作旁证，不改其他行结论。
- 关闭结论：`PASS`。Admin Web以「第八个嫌疑人」展示正式收藏；对应Inventory目录精确为`F:\canary\第八个嫌疑人 (2023)`，目录存在，`IsHashName=False`、`HasZeroYear=False`，其5个成员均在该用户可读目录内。
- UI证据：`admin-web-evidence/uat-013-readable-inventory-eighth-suspect.png`（位于本Canary隔离证据目录）。
- FS证据：2026-08-22只读核验目录存在，名称为`第八个嫌疑人 (2023)`，非哈希、无`(0)`年份，包含主视频、NFO、poster、fanart、clearlogo共5个成员。

### UAT-047（`PASS`）

- 关闭命题：ISO同语言编号字幕最终名可区分，验收不再`TARGET_COLLISION`。
- Canary：`UAT-20260822-141950-0c27c8cf6`。
- 证人：Admin Web「我的收藏」中的「倩女幽魂2：人间道」；Inventory目录`F:\canary\倩女幽魂2：人间道 (1990)`。
- 路径：我的收藏 → Movie Canary → 打开「倩女幽魂2：人间道」详情确认当前收藏 → 只读枚举最终字幕名称。
- 允许动作：页面进入、只读切换、打开/关闭详情、截图；文件系统、SQLite和日志只读旁证。
- 禁止动作：修改评分、退出收藏、移动/重命名文件、重启服务、重建Canary、修改数据库；当前NVENC转码不得受本项影响。
- 通过标准：证人已经On-deck为当前收藏；最终目录同时保留未编号和`.1`–`.55`编号`zh-CN.srt`，文件名全部唯一，无hash/`(0)`补丁，不再因字幕目标碰撞阻止上架。
- 证据要求：`UI`、`FS`。
- 旁证停车：ISO提取、主视频编码、源ISO清理及其他成员只作旁证，不改其他行结论。
- 关闭结论：`PASS`。Admin Web显示「倩女幽魂2：人间道」属于Movie Canary当前收藏且健康；最终目录有56条`zh-CN.srt`，名称56/56唯一，其中未编号1条、编号`.1`–`.55`共55条，`HashOrZeroPatchCount=0`。
- UI证据：`admin-web-evidence/uat-047-iso-numbered-subtitles-ondeck.png`（位于本Canary隔离证据目录）。
- FS证据：2026-08-22只读枚举`F:\canary\倩女幽魂2：人间道 (1990)`，`SubtitleCount=56`、`UniqueNameCount=56`、`NumberedCount=55`、`PlainCount=1`、`.1=True`、`.55=True`、无hash或`(0)`补丁。

### UAT-048（`PASS`）

- 关闭命题：同根终态目录的源残留不再把Off-load Settlement打成`UNKNOWN_MEMBER`。
- Canary：`UAT-20260822-141950-0c27c8cf6`。
- 证人：Admin Web「我的收藏」中第二个「养蜂人」Entry；Inventory目录`F:\canary\养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1`及主视频`养蜂人 (2024).mkv`（`8932765796`字节）。
- 路径：我的收藏 → Movie Canary → 打开第二个「养蜂人」详情确认当前收藏 → 只读核验Inventory目录和盘树残留。
- 允许动作：页面进入、只读切换、打开/关闭详情、截图；文件系统、SQLite和日志只读旁证。
- 禁止动作：修改评分、退出收藏、移动/重命名文件、重启服务、重建Canary、修改数据库。
- 通过标准：BDMV证人已经On-deck为当前收藏而非停在「正在完成收藏架上架」；Inventory主视频真实存在且目录不含BDMV/CERTIFICATE残留，Settlement没有被旁路clip错误打成`UNKNOWN_MEMBER`。
- 证据要求：`UI`、`FS`。
- 旁证停车：整盘树清理由UAT-049独立关闭，本项不得顺带把UAT-049写为`PASS`。
- 暂停原因：定位到8.3 GB BDMV「养蜂人」Entry时，Admin Web把真实`.mkv`主视频显示为`8.3 GB · 1`。该独立Projection缺陷已登记为`UAT-065`；按作业规则停止`UAT-048`关闭判定，不写`PASS`。
- UI证据：`admin-web-evidence/uat-048-bdmv-settlement-ondeck.png`（位于本Canary隔离证据目录；同时保存UAT-065新缺陷现场）。
- 恢复条件：`UAT-065`已由`a59737c4a`修复并在同一Canary定向关闭；本卡恢复后只判定Settlement命题。
- 关闭结论：`PASS`。修复UAT-065后恢复本卡，真实Admin Web显示8.3 GB BDMV「养蜂人」为Movie Canary当前收藏且健康；主视频`F:\canary\养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1\养蜂人 (2024).mkv`存在且大小`8932765796`与Inventory一致，目标目录`DiscTreeCount=0`，没有因旁路clip停在`UNKNOWN_MEMBER`。
- UI证据：`admin-web-evidence/uat-048-bdmv-settlement-ondeck-after-065.png`（位于本Canary隔离证据目录）。
- FS证据：2026-08-22只读核验`TargetExists=True`、`PrimaryExists=True`、`PrimaryLength=8932765796`、`SizeMatch=True`、`DiscTreeCount=0`。

### UAT-049（`PASS`）

- 关闭命题：盘整理完成后原`BDMV`/`CERTIFICATE`整棵树从收藏目录消失。
- Canary：`UAT-20260822-141950-0c27c8cf6`。
- 证人：Admin Web中8.3 GB BDMV「养蜂人」当前Shelf Entry；`F:\canary`下两个「养蜂人」用户可见目录。
- 路径：我的收藏 → Movie Canary → 打开8.3 GB「养蜂人」详情确认盘产品已上架 → 只读递归核验两个养蜂人目录的BDMV/CERTIFICATE树和兄弟MKV。
- 允许动作：页面进入、只读切换、打开/关闭详情、截图；文件系统、SQLite和日志只读旁证。
- 禁止动作：修改评分、退出收藏、移动/删除文件、重启服务、重建Canary、修改数据库。
- 通过标准：盘产品已是当前收藏；`F:\canary`的养蜂人范围内不存在`BDMV`或`CERTIFICATE`目录，嵌套盘根已消失；两个正式兄弟MKV仍精确存在。
- 证据要求：`UI`、`FS`。
- 旁证停车：Settlement、成员命名和其他电影目录不改其他行结论。
- 关闭结论：`PASS`。真实Admin Web显示8.3 GB BDMV「养蜂人」已经是Movie Canary当前收藏且健康；`F:\canary`下有2个养蜂人用户可见根、2个正式MKV，递归`BDMV`/`CERTIFICATE`目录为0，盘树已从收藏目录消失且兄弟MKV保留。
- UI证据：`admin-web-evidence/uat-049-bdmv-tree-removed.png`（位于本Canary隔离证据目录）。
- FS证据：2026-08-22只读核验`BeekeeperRootCount=2`、`DiscTreeCount=0`、`MkvCount=2`、两份MKV合计`15113048136`字节。

### UAT-065（`PASS`）

- 关闭命题：收藏详情只从主视频basename解析容器，不得把父目录名中的`.1`显示为容器。
- Canary：`UAT-20260822-141950-0c27c8cf6`；修复commit `a59737c4a`。
- 证人：Admin Web「我的收藏」中8.3 GB BDMV「养蜂人」Entry；Inventory主视频`F:\canary\养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1\养蜂人 (2024).mkv`。
- 路径：修复后重启隔离服务 → 我的收藏 → Movie Canary → 打开8.3 GB「养蜂人」详情 → 读取主视频容器。
- 允许动作：页面进入、只读切换、打开/关闭详情、刷新、截图；文件系统、SQLite和日志只读旁证。
- 禁止动作：修改评分、退出收藏、移动/重命名文件、重建Canary、修改数据库。
- 通过标准：同一Entry详情把主视频显示为`8.3 GB · MKV`，不再显示`· 1`；Inventory路径和字节不发生变化。
- 证据要求：`UI`。
- 回归证据：定向Collection Query 3/3 PASS；完整suite独立Routing等待失败已如实记录，不改写本项结论。
- 旁证停车：Entry已On-deck和Settlement只作旁证，不提前恢复或关闭UAT-048。
- 关闭结论：`PASS`。修复后刷新真实Admin Web，同一8.3 GB BDMV「养蜂人」详情显示`主视频 8.3 GB · MKV`，不再显示`· 1`；Inventory路径和`8932765796`字节未改变。
- UI证据：`admin-web-evidence/uat-065-container-mkv-after-fix.png`（位于本Canary隔离证据目录）。

### UAT-066（`PASS`）

- 关闭命题：Formation 已完成整理表按目标Shelf ID显示当前收藏架名称，不得整列显示`—`。
- Canary：`UAT-20260822-141950-0c27c8cf6`；修复commit `e27b7e2ad`。
- 证人：Admin Web「媒体整理工作区」已完成整理17条；同页当前媒体6条；活动收藏架`Movie Canary`。
- 路径：修复后安全重启隔离服务 → 媒体整理工作区 → 展开已完成整理 → 核对17条目标收藏架 → 刷新后复核当前媒体和已完成表。
- 允许动作：页面进入、展开、刷新、截图；SQLite只读旁证。
- 禁止动作：修改评分、放弃Run、重新观察、修改Routing/Shelf事实、重建Canary、修改数据库。
- 通过标准：17条已完成媒体均显示`Movie Canary`而不是`—`；刷新后保持；当前媒体收藏架显示不回退。
- 证据要求：`UI`。
- 关闭结论：`PASS`。真实页面刷新后，已完成整理17/17条目标收藏架均显示`Movie Canary`；当前媒体6条也均显示`Movie Canary`。Libra Projection中的稳定`target_shelf_id`未变，页面使用同页Arca Shelf只读清单解析当前名称。
- UI证据：`admin-web-evidence/uat-066-completed-shelf-movie-canary-after-fix.png`（位于本Canary隔离证据目录）。

### UAT-034（`PASS`）

- 关闭命题：同名片名+年份的两部养蜂人最终目录可区分且都能 On-deck。
- Canary：`UAT-20260822-141950-0c27c8cf6`。
- 证人：Admin Web「我的收藏」中两个独立「养蜂人」当前Entry；`F:\canary`下两个养蜂人目录。
- 路径：我的收藏 → 分别打开两个养蜂人详情 → 核对当前收藏、健康与占用空间 → 只读枚举两个最终目录及MKV。
- 允许动作：页面进入、打开/关闭详情、截图；文件系统只读枚举。
- 禁止动作：修改评分、退出收藏、移动/重命名文件、重启服务、重建Canary、修改数据库。
- 通过标准：两个独立Entry都已On-deck；最终目录分别保留普通版与来源edition，可区分且不使用hash或`(0)`年份；每个目录各有一份正式MKV。
- 证据要求：`UI`、`FS`。
- 关闭结论：`PASS`。真实Admin Web中两个养蜂人Entry均为Movie Canary当前收藏且健康，详情占用分别为`8.3 GB`与`5.8 GB`。FS目录精确为`养蜂人 (2024)`与`养蜂人 (2024) - 2160p HEVC Atmos TrueHD5.1`，各有一份MKV，字节分别为`6180282340`与`8932765796`；两目录均非hash且无`(0)`年份。
- UI证据：`admin-web-evidence/uat-034-two-beekeepers-distinct-entries.png`、`admin-web-evidence/uat-034-beekeeper-first-entry-detail.png`、`admin-web-evidence/uat-034-beekeeper-second-entry-detail.png`（位于本Canary隔离证据目录）。
- FS证据：2026-08-22只读枚举上述两个目录，`RootCount=2`、每个`VideoCount=1`、`IsHashName=False`、`HasZeroYear=False`。

### UAT-039（`PASS`）

- 关闭命题：同根上架不把源文件和兄弟电影目录当成占用/未知成员。
- Canary：`UAT-20260822-141950-0c27c8cf6`。
- 证人：共享`F:\canary`根完成上架的两部养蜂人、光荣的愤怒、香火及其兄弟目录现实。
- 路径：我的收藏核对同根证人均为当前收藏且健康 → 只读枚举`F:\canary`一级目录、嵌套养蜂人目录与`.partial`。
- 允许动作：页面进入、截图；文件系统只读枚举。
- 禁止动作：触发On-deck、移动/删除文件、修改评分、退出收藏、重启服务、重建Canary、修改数据库。
- 通过标准：同根证人均完成上架，不再停在`TARGET_OCCUPIED`/`UNKNOWN_MEMBER`；两个养蜂人是独立一级兄弟目录，不互相嵌套；无未收口`.partial`。
- 证据要求：`UI`、`FS`。
- 关闭结论：`PASS`。真实Admin Web显示两部养蜂人、光荣的愤怒、香火均为Movie Canary当前收藏且健康。`F:\canary`有22个一级电影目录、两个独立养蜂人一级目录，`NestedBeekeeperRoots=0`、`PartialCount=0`；同根源与兄弟目录未再阻止Stage/Switch或Settlement。
- UI证据：`admin-web-evidence/uat-039-same-root-sibling-entries-ondeck.png`（位于本Canary隔离证据目录）。
- FS证据：2026-08-23只读枚举`F:\canary`，`CanaryRootCount=22`、`BeekeeperRootCount=2`、`NestedBeekeeperRoots=0`、`PartialCount=0`。
