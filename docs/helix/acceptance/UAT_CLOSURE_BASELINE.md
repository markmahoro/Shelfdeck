# Movie Canary UAT 关闭基线

状态：`FROZEN 2026-08-22 / LEDGER-DRIVEN CLEAN CANARY`

建立日期：2026-08-22

覆盖范围：`UAT-001`–`UAT-070`（70 行，无缺口、无重复）

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
8. **按干扰排队，不按编号。** 只读、不改状态 → 轻量可逆操作 → 等本 Canary 在飞生产自然完成 → 破坏性一次一件 → 本库没有证人则 `BLOCKED` 或留待下轮，不硬凑。用户现已授权实施并关闭 `UAT-064`；其最终 UI 见证因 `UAT-070` 启动恢复故障暂停，待后者关闭后继续。不得为凑分重建 Canary；转码 / ISO 进行中不得为其他行重启服务。

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

## 4. 关闭矩阵（69 行）

证据标签：`UI` 必填；`FS` 在文件现实变化时必填；`FACT` 仅旁证。

| ID | 关闭命题 | 证据 | 波次 | 冻结状态 | PASS |
| --- | --- | --- | --- | --- | --- |
| UAT-001 | 整理页豆瓣分能按 Identity Evidence 匹配到对应 Subject，匹配率达到可验收水平 | `UI` `FACT` | W4 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI Formation 多部显示豆瓣星级 |
| UAT-002 | Handoff A Intake 能持续接收 Candidate，不再被全库串行门闩打成异常低吞吐 | `UI` `FACT` | W2 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 23 Subject 已出现（11+2+3+7） |
| UAT-003 | Product Identity 不再因 TMDB 证据缺口把大量 Run 停在等待 | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 17 completed+6合法冻结，pending/in_progress均0，六行身份步骤均100% |
| UAT-004 | 大文件媒体完整性只用中段指纹，不再整文件 SHA-256 | `UI` `FACT` | W3 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260823-002500-519f8d7b5 UI 9.3 GB ISO成品当前收藏且健康；FACT 16/16大Primary的Package与Inventory均用middle-256k-sha256、完整sha256为0，小Artifact仍44/44 sha256 |
| UAT-005 | 媒体整理工作区用四桶当前状态，不再暴露内部对象语言 | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 四桶待整理/整理中/需要处理/已完成整理 |
| UAT-006 | 干净库概览显示真实计数 0，并走 Admin Session | `UI` | W0 | `CLOSED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 概览正式收藏0，非演示数字，Admin Session 登录 |
| UAT-007 | 干净库人物页显示真实 0，不再展示固定演示人数 | `UI` | W0 | `CLOSED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 人物已登记0 |
| UAT-008 | Admin Web 七个非根路径直接刷新回到对应页面，不再 404 | `UI` | W0 | `CLOSED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 八页首次打开与直接刷新 |
| UAT-009 | 整理页提交评分后刷新仍保留该评分 | `UI` | W0 | `CLOSED` | `PASS` UAT-20260823-002500-519f8d7b5 UI第二个养蜂人从4星豆瓣提交为4星我的评分，重新导航刷新后仍保留且显示清除入口 |
| UAT-010 | Routing 未配置时不开放人工选架，页面给出等待策略的明确提示 | `UI` | W0 | `CLOSED` | `PASS` UAT-20260822-064512-fe37bffec UI未路由Subject明确等待策略、无人工选架入口，首次打开与刷新Console error均为0 |
| UAT-011 | 同根 Shelf Target 前 Handoff B 能推进，不再永久等待 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI Field/Shelf同为F:\canary且Shelf有17条、收藏17部当前Entry；FS同根目录现实存在 |
| UAT-012 | On-deck Planner 带上 Settlement Approval 契约，上架能完成 | `UI` `FS` | W0 | `CLOSED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 第八个嫌疑人已为当前收藏且健康；FS主视频精确存在于F:\canary，大小2009890078与Inventory一致 |
| UAT-013 | 已解析身份进入用户可读目录名，不再渲染成哈希 Inventory 目录 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI第八个嫌疑人；FS目录F:\canary\第八个嫌疑人 (2023)存在，非哈希且无(0)年份 |
| UAT-014 | Formation 展示 Product Identity 冲突并提供候选选择 | `UI` | W0 | `CLOSED` | `PASS` 真实Canary UI显示身份冲突与Anatomy of a Fall候选，按钮写入TMDB 915935 Selection Intent；2026-08-23合同回归18/18 |
| UAT-015 | 冻结的 Libra Run 有用户可见的放弃入口 | `UI` | W0 | `CLOSED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 冻结行有放弃本次整理 |
| UAT-016 | TMDB 正确候选不再被本地语言/标题过滤误报为未找到 | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 设置 TMDB 首选语言简体中文 |
| UAT-017 | 外部寻源按 Acceptance Spec 预筛，不合格候选不会先下载再发现不可达 | `UI` | W3 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260823-040740-0886b2723 UI倩女幽魂2真实MoviePilot候选因H.264/低于4K/超50GiB在Selection前判为noncompliant，结果no_requirement_eligible_candidate且未发下载Work |
| UAT-018 | 顶部「需要处理」与 Discard 历史分离，Discard 不混进当前四桶 | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 需要处理桶与已结束区分 |
| UAT-019 | Executor 终态异常由 Owner 收口，Arca Acceptance Offer 不再悬空 | `UI` `FACT` | W3 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260823-002500-519f8d7b5 UI 16部当前收藏均健康；FACT 16/16 Offer acked、Decision/Handoff B accepted、Recovery resolved、On-deck committed，悬空为0 |
| UAT-020 | Final Inventory 成员命名与 carried-forward Settlement 完整，技术后缀不进入最终名 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260823-002500-519f8d7b5 UI老笠当前收藏且健康；FS唯一目录含用户可读Primary/NFO与老笠 (2016).zh-CN.srt，无技术标签/partial |
| UAT-021 | TMDB 别名来源不泄漏进 Product Identity 证据，整理不在取证前全员冻结 | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260823-002500-519f8d7b5 UI 6个后续寻源冻结项身份均100%、16项完成；FACT 43/43身份resolved、446个alias均为provider来源 |
| UAT-022 | 年份后的技术发布标签不再污染 TMDB 搜索词 | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260823-002500-519f8d7b5 UI原始技术后缀标题确认影片身份100%，当前终态在后续外部寻源而非provider_no_match |
| UAT-023 | 去掉技术后缀后残留年份不再导致豆瓣标题锚不相交 | `UI` | W4 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260823-002500-519f8d7b5 UI原始技术后缀标题刷新后稳定显示5星豆瓣且身份100% |
| UAT-024 | 逐成员 Settlement 后 Accepted Context 不再要求全部旧源仍存在 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260823-002500-519f8d7b5 UI有话好好说当前收藏且健康；FACT 5个逐成员Settlement全成功并On-deck committed；FS唯一完整目录无partial |
| UAT-025 | Handoff A 身份快照在技术发布标签前冻结年份锚 | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI普通/发布标签养蜂人均4星豆瓣、看不见的朋友5星；当前重建再次确认后者5星且身份100% |
| UAT-026 | Admin Web 能清除直接评分并恢复豆瓣来源 | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260823-002500-519f8d7b5 UI直接4星清除并刷新后恢复4星豆瓣；FACT追加retraction及retracts且旧Observation保留 |
| UAT-027 | 恢复中的 FFmpeg progress 冲突不再把整个服务打退出 | `UI` `FACT` | W3 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260823-002500-519f8d7b5 UI重启后Formation刷新且Console为0；FACT服务持续存活、Progress冲突/uncaught为0、专项13/13 |
| UAT-028 | 单电影目录的常见既有图像进入 Related disposition | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260823-002500-519f8d7b5 UI养蜂人当前收藏且健康；FACT/FS Inventory登记并保留banner、landscape、clearlogo，位置大小一致 |
| UAT-029 | NFO 演员 TMDB 人 ID 不再被误判为电影身份冲突 | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260823-002500-519f8d7b5 UI 007身份100%无冲突；FACT五个原样本NFO与Provider exact均resolved且电影TMDB ID唯一 |
| UAT-030 | 五星外部获取用身份搜索；无合格 4K 源时页面显示合法冻结，不像卡住 | `UI` | W5 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 五星冻结文案没有找到可获取的外部候选 |
| UAT-031 | Movie Field 默认扩展名含 ISO，倩女幽魂2 能被观察 | `UI` `FS` | W2 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260823-002500-519f8d7b5 FACT Field含.iso并形成ISO Candidate；UI倩女幽魂2当前收藏健康；FS唯一最终目录与MKV |
| UAT-032 | Aftercare Custody 绑定 objectKind 与合同一致，健康评估可执行 | `UI` | W4 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 第八个嫌疑人已上架详情显示收藏健康为健康、保管为健康，不再停在never_assessed |
| UAT-033 | 同名字幕和 stem-fanart 最终文件名可区分，同根上架不再 `TARGET_COLLISION` | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260823-002500-519f8d7b5 UI战栗空间当前收藏健康；FACT/FS双ASS与双fanart名称可区分、Inventory位置全唯一、碰撞为0 |
| UAT-034 | 同名片名+年份的两部养蜂人最终目录可区分且都能 On-deck | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 两个独立健康养蜂人当前Entry；FS普通版与edition目录各有一份MKV，非hash且无(0)年份 |
| UAT-035 | FFmpeg 非零退出按执行失败收口，Remux Attempt 不停在 executing | `UI` `FACT` | W3 | `CODE_DONE_UNQUALIFIED` | `PASS` 历史Canary 2个FFmpeg失败Attempt/Event均failed无executing；当前Canary媒体Event executing=0且ISO样本当前收藏健康；专项31/31 |
| UAT-036 | 已观察 ISO 能通过 Triage 形成 Candidate，不再因非可播放流 `triage_failed` | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI倩女幽魂2已形成并完成生产/On-deck，为健康当前收藏 |
| UAT-037 | 007 身份 provider_exact 观察不被 schema 拒绝，冻结文案不是通用句 | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 007身份步骤100%，显示没有找到可获取的外部候选；identity observe/resolve旁证均成功 |
| UAT-038 | 上架成功后 Aftercare 健康不再是 conformance/presentation 降级 | `UI` | W4 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 倩女幽魂2已上架详情刷新后收藏健康为健康，保管/呈现/合规均为健康 |
| UAT-039 | 同根上架不把源文件和兄弟电影目录当成占用/未知成员 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI同根兄弟电影均已当前收藏且健康；FS两个养蜂人一级目录独立、无嵌套兄弟目录或.partial |
| UAT-040 | ISO 原盘 Remux 走提取路径，不把映像文件当普通流输入 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI倩女幽魂2为健康当前收藏且主视频MKV；FS源ISO保留、目标只有MKV且无ISO/盘树 |
| UAT-041 | BDMV HEVC/TrueHD Remux 能处理缺 PES 时间戳，不被 Matroska 直接拒绝 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI BDMV养蜂人为健康当前收藏且主视频MKV；FS目标MKV完整、无.partial，源BDMV保持 |
| UAT-042 | 同根 Off-load Settlement 能解释源现实漂移 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI光荣的愤怒/香火均为健康当前收藏；FS最终视频/海报/NFO保留且无.partial |
| UAT-043 | 007 身份已过后，TMDB metadata fetch 的 closed-shape / lease 失败可重试，不一次打成冻结 | `UI` | W2 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 007补齐资料100%后进入无外部候选合法冻结；metadata fetch/commit旁证均成功 |
| UAT-044 | 四星 14 GiB 能规划 BDMV 多 TrueHD 轨的体积转码，音轨预算裁剪后可上架 | `UI` `FS` | W0 | `CLOSED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI四星BDMV养蜂人为健康当前收藏；FS最终8.93GB HEVC并保留2 TrueHD、裁掉4 AC3 |
| UAT-045 | ISO Remux 失败 Effect 与进程重启后 Attempt 能收口，不再永久 executing | `UI` `FACT` | W3 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI倩女幽魂2为健康当前收藏；FACT Run completed且唯一Remux Attempt completed/succeeded，无非终态Attempt |
| UAT-046 | ISO Remux 抽出 m2ts 后跳过无法 copy 的 `pcm_bluray`，不整盘重抽 | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI倩女幽魂2为健康当前收藏；FS最终MKV无pcm_bluray/pcm_dvd，保留DTS/AC3/PGS且无iso-clip/partial |
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
| UAT-059 | 四星转码把 `maxSizeBytes` 当拒绝线而非填满目标；已较小的 H.264 源不得灌到档位 GiB | `UI` `FS` | W3 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260823-002500-519f8d7b5 UI锡尔弗顿1.9GB当前收藏健康；FACT/FS源2.078GB、成品2.091GB，NVENC目标码率1.919Mbps非填满14GiB |
| UAT-060 | Product Identity 写回 Subject 不重发语义相同的 Acceptance Spec，头不空切，符合性后仍能发 Package | `UI` `FACT` | W2 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260823-014246-3397c88f5 UI养蜂人同值4星覆盖并清除后恢复豆瓣；FACT Spec仍仅revision 1且Head四元组不变，另2个身份写回样本均已发Package |
| UAT-061 | 豆瓣翻页传输失败有界重试；耗尽后 Acquisition 收口为失败，设置页可再同步。不得用 copy-forward 单独关闭 | `UI` | W4 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 本轮点同步出现正在同步，约90s后按钮恢复可点且无失败卡死（非 copy-forward 单独关闭） |
| UAT-062 | frozen Discard 后 Control 保持释放、不立刻新开 Libra Run、页面不是「正在评估整理方案」，材料走重新入库 | `UI` | W5 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260823-040740-0886b2723 UI倩女幽魂2从冻结变为待整理/等待重新入库；FACT cleanup fully ack，重扫形成新Procurement Run与新Subject，旧Subject未复活 |
| UAT-063 | Aftercare 用与 Libra 同一套 `perception.rating.resolve@1` Identity Evidence；上架后评分从无到有/变档会再评估 | `UI` | W4 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260823-024825-f6b9eded6 UI威尼斯4星直评及清除回3星豆瓣均自动形成健康Assessment；FACT Subject/Shelf Entry命中同一Douban Record |
| UAT-064 | Formation 步骤 CPU/GPU 与验证完成态必须与真实执行一致，不得默认 CPU、不得把 Direct 源校验画成成品验证完成 | `UI` `FACT` | W3 | `CODE_DONE_UNQUALIFIED` | `PASS`；commit `daaef8c3d`，执行中与完成态 API/FACT 通过；Product Owner 接受现有证据关闭，未取得 UI 截图 |
| UAT-065 | 收藏详情只从主视频basename解析容器，不得把父目录名中的`.1`显示为容器 | `UI` | W1 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 8.3 GB BDMV养蜂人主视频修复后显示8.3 GB · MKV，不再显示· 1 |
| UAT-066 | Formation 已完成整理表按目标Shelf ID显示当前收藏架名称，不得整列显示`—` | `UI` | W1 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260822-141950-0c27c8cf6 UI 已完成整理17/17条均显示Movie Canary，当前媒体6条显示未回退 |
| UAT-067 | 活动 Run 加急后既有 Work 必须按冻结 Admission Definition 回放，动态 Priority 不得制造幂等冲突 | `UI` `FACT` | W3 | `CLOSED` | `PASS` UAT-20260823-002500-519f8d7b5 UI同一已加急老笠Run恢复并完成上架；FACT形成Product Package/Offer且无替换Run或数据库编辑 |
| UAT-068 | Collection 年份投影须保留 Provider 标准年份字段，Aftercare Shelf Entry 不得因此丢失 title-year Identity Evidence | `UI` `FACT` | W4 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260823-024825-f6b9eded6 UI威尼斯详情显示2023与3星豆瓣；FACT Inventory标准年份保留且Shelf Entry/Subject命中同一Douban Record |
| UAT-069 | Aftercare Coordinator、Planner 与 Capability 必须共享包含当前 Perception Resolution 的 Care Basis；评分变化后不得写回旧 Basis | `UI` `FACT` | W4 | `CODE_DONE_UNQUALIFIED` | `PASS` UAT-20260823-024825-f6b9eded6 UI威尼斯3星豆瓣且三维健康；FACT修复后恢复、4星直评、清除回豆瓣三代Assessment均使用各自新Basis |
| UAT-070 | 集成配置 revision 更新后，新 Work 必须冻结当前 Handle；单个 reconcile scope 失败不得阻断启动或跳过失败 cursor | `UI` `FACT` `RESTART` | W7 | `CODE_DONE_UNQUALIFIED` | `PASS`；commit `efaf2d827`，失败库克隆 RESTART/FACT 通过；Product Owner 接受现有证据关闭，未取得 UI 截图 |

## 5. 计数

冻结时（代码状态，不是本轮 Canary）：`CLOSED` 11，`CODE_DONE_UNQUALIFIED` 52，`RECORDED_UNIMPLEMENTED` 1（064）。本轮逐项关闭期间新增并完成`UAT-065`、`UAT-066`、`UAT-067`，并新增已修复待资格确认的`UAT-068`、`UAT-069`；`UAT-064` 已实现，`UAT-070` 已完成根因修复与失败库克隆 RESTART/FACT。当前代码状态为`CLOSED` 12、`CODE_DONE_UNQUALIFIED` 58、`RECORDED_UNIMPLEMENTED` 0；验收状态则已由 Product Owner 的明确证据接受决定收口为70/70 `PASS`。

逐项关闭累计覆盖干净 Canary `UAT-20260822-141950-0c27c8cf6`、`UAT-20260823-002500-519f8d7b5`与
`UAT-20260823-014246-3397c88f5`；当前 PASS 总账：

| 口径 | 数量 |
| --- | --- |
| 总行 | 70 |
| 累计 `PASS` | **70** |
| 尚未通过（`NOT RUN`+`FAILED`+`BLOCKED`） | **0** |
| 是否都通过 | **是**（70/70） |

累计 `PASS`：001–070。001–063、065–069 的证据包含干净隔离库 Admin Web `UI`；要求文件现实的行另有`FS`。064、070 由 Product Owner 明确接受现有 API/FACT/RESTART 证据关闭，未声称存在未取得的 UI 截图。
`UAT-064` 与 `UAT-070` 均已完成代码及真实隔离现场的 FACT/RESTART 资格；2026-08-23 Product Owner 明确接受现有证据并要求关闭，两项由 `BLOCKED` 转为 `PASS`。这是显式验收决定，不追记或伪造 UI 证据。

最新关闭证据：`UAT-070` 的失败库克隆 `UAT-20260823-uat070-recovery-v2` 已通过 RESTART/FACT；`UAT-064` 的 `UAT-20260823-135500-daaef8c3d` 已通过执行中与完成态 API/FACT。Product Owner 接受两项现有证据并明确要求关闭，UAT 总账至此为70/70。

### Post-closure qualification（不改写历史70行）

2026-08-23在70/70关闭之后，独立登记并修复`UAT-071`（多人自动登记Evidence碰撞）、`UAT-072`（已登记人物头像）与真实Canary进一步暴露的`UAT-073`（NFO人物强身份丢失及重复关系）。三项属于post-closure qualification，不追加进上方`UAT-001`–`UAT-070`表、不改变70/70历史结论，也不追溯修改`UAT-055`的已接受证据。

同日后续使用保留Canary时，Product Owner另确认下一轮`UAT-074`–`UAT-084`，权威范围与验收标准见`docs/helix/USER_ACCEPTANCE_TEST_ISSUE_LOG.md`。这些条目已在当前提交版隔离Canary和失败库只读克隆中逐项关闭，作为post-closure qualification记录于本文末尾；它们不改写上方历史70/70，也不改变`UAT-071`–`UAT-073`的资格结论。之后登记的`UAT-085`–`UAT-087`仍为OPEN，不得计入本关闭基线的PASS数量。

`UAT-20260823-people-registration-avatar-91e6bb141`仅为确定性本地TMDB stub自动化夹具，证明合同与回退，不作为真实UI UAT证据。权威post-closure真实资格运行是`F:\shelfdeck_test_zone\runs\UAT-20260823-people-real-avatar-fix-b8861a3dd`：从只读`test_film`复制《放·逐 (2006)》，使用真实TMDB走正式Formation→On-deck→People，23个唯一TMDB Person Identity形成23个active Person、0 open Candidate，安全重启后不增不减；桌面与390px真实页面显示23张卡、21个真实代理头像、2个无图首字回退，axe serious/critical为0。FACT与截图均保存在该运行目录；既有Canary、旧Candidate与历史UAT证据均未修改。

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

### UAT-040（`PASS`）

- 关闭命题：ISO原盘Remux走提取路径，不把映像文件当普通流输入。
- Canary：`UAT-20260822-141950-0c27c8cf6`。
- 证人：《倩女幽魂2：人间道》源ISO与当前Movie Canary Shelf Entry。
- 路径：我的收藏 → 打开倩女幽魂2详情 → 核对当前收藏、健康和主视频容器 → 只读核验源ISO及最终目录。
- 允许动作：页面进入、打开/关闭详情、截图；文件系统只读核验。
- 禁止动作：重跑Remux、修改评分、退出收藏、移动/删除文件、重启服务、重建Canary、修改数据库。
- 通过标准：新Run完成On-deck；只读源ISO保持不变；最终产品是MKV且目标中没有ISO或盘树，不能以原ISO直接交差。
- 证据要求：`UI`、`FS`。
- 关闭结论：`PASS`。真实详情显示倩女幽魂2为Movie Canary当前收藏且健康，主视频`9.3 GB · MKV`。源ISO`F:\test_film\倩女幽魂2：人间道 (1990)\倩女幽魂2：人间道 (1990) - 1080p AVC DTS.iso`仍为`23393665024`字节；目标为`F:\canary\倩女幽魂2：人间道 (1990)\倩女幽魂2：人间道 (1990).mkv`、`10021609024`字节，`TargetIsoCount=0`、`TargetDiscTreeCount=0`。
- UI证据：`admin-web-evidence/uat-040-iso-extracted-remux-ondeck.png`（位于本Canary隔离证据目录）。
- FS证据：2026-08-23只读核验上述源ISO和目标目录，`SourceIsoCount=1`、`TargetMkvCount=1`、`TargetIsoCount=0`、`TargetDiscTreeCount=0`。

### UAT-041（`PASS`）

- 关闭命题：BDMV HEVC/TrueHD Remux能处理缺PES时间戳，不被Matroska直接拒绝。
- Canary：`UAT-20260822-141950-0c27c8cf6`。
- 证人：BDMV来源的8.3 GB养蜂人Movie Canary Entry与只读源盘树。
- 路径：我的收藏 → 打开8.3 GB养蜂人详情 → 核对当前收藏、健康和MKV → 只读核验源M2TS、目标MKV与partial。
- 允许动作：页面进入、打开/关闭详情、截图；文件系统只读核验。
- 禁止动作：重跑Remux/Transcode、修改评分、退出收藏、移动/删除文件、重启服务、重建Canary、修改数据库。
- 通过标准：新Run完成On-deck，不再因unknown timestamp冻结；源BDMV保持；最终MKV完整且没有partial残留。
- 证据要求：`UI`、`FS`。
- 关闭结论：`PASS`。真实详情显示BDMV养蜂人为Movie Canary当前收藏且健康，主视频`8.3 GB · MKV`。只读源`BDMV/STREAM`有61个M2TS、合计`69941790720`字节；最终MKV为`8932765796`字节，`TargetPartialCount=0`。
- UI证据：`admin-web-evidence/uat-041-bdmv-timestamp-remux-ondeck.png`（位于本Canary隔离证据目录）。
- FS证据：2026-08-23只读核验源BDMV与目标MKV，`SourceBdmvCount=1`、`SourceClipCount=61`、`TargetMkvExists=True`、`TargetPartialCount=0`。

### UAT-042（`PASS`）

- 关闭命题：同根Off-load Settlement能解释源现实漂移。
- Canary：`UAT-20260822-141950-0c27c8cf6`。
- 证人：同根in-place替换的《光荣的愤怒》《香火》当前Shelf Entry与最终目录。
- 路径：我的收藏核对两部电影均为当前收藏且健康 → 只读核验最终视频、海报、NFO与partial。
- 允许动作：页面进入、截图；文件系统只读核验。
- 禁止动作：触发On-deck/Settlement重试、移动/删除文件、修改评分、退出收藏、重启服务、重建Canary、修改数据库。
- 通过标准：两部电影完成On-deck；同根被替换路径按最终产品identity收口；最终产品成员保留且没有partial。
- 证据要求：`UI`、`FS`。
- 关闭结论：`PASS`。真实Admin Web显示《光荣的愤怒》《香火》均为Movie Canary当前收藏且健康。两者最终目录各有1个视频、1个`poster.jpg`和1个NFO，文件总数均为4，`PartialCount=0`；Settlement没有再因旧源fingerprint报reality drift。
- UI证据：`admin-web-evidence/uat-042-same-root-settlement-complete.png`（位于本Canary隔离证据目录）。
- FS证据：2026-08-23只读核验`F:\canary\光荣的愤怒 (2006)`与`F:\canary\香火 (2003)`，两者`VideoCount=1`、`PosterCount=1`、`NfoCount=1`、`PartialCount=0`。

### UAT-044（`PASS`）

- 关闭命题：四星14 GiB能规划BDMV多TrueHD轨的体积转码，音轨预算裁剪后可上架。
- Canary：`UAT-20260822-141950-0c27c8cf6`。
- 证人：四星BDMV养蜂人源主clip与8.3 GB Movie Canary当前Entry。
- 路径：我的收藏 → 打开8.3 GB养蜂人详情 → 核对当前收藏、健康与MKV → 只读ffprobe源主clip和最终MKV。
- 允许动作：页面进入、打开/关闭详情、截图；文件系统和媒体元数据只读核验。
- 禁止动作：重跑Remux/Transcode、修改评分、退出收藏、移动/删除文件、重启服务、重建Canary、修改数据库。
- 通过标准：新Run生成低于14 GiB的HEVC产品并完成On-deck；多音轨预算裁剪保留TrueHD主音轨，不因全轨预算不可行而冻结；时长不漂移。
- 证据要求：`UI`、`FS`。
- 关闭结论：`PASS`。真实详情显示证人为Movie Canary当前收藏且健康，主视频`8.3 GB · MKV`。源主clip为`68676919296`字节、HEVC Main10、2 TrueHD + 4 AC3、`6336.288278s`；最终为`8932765796`字节、HEVC Main10、2 TrueHD、`6336.289000s`，低于14 GiB且裁掉4条AC3。
- UI证据：`admin-web-evidence/uat-044-bdmv-four-star-budget-ondeck.png`（位于本Canary隔离证据目录）。
- FS证据：2026-08-23用部署ffprobe只读核验源与目标，视频编码/时长连续，`SourceAudioCount=6`、`TargetAudioCount=2`、目标两轨均为TrueHD。

### UAT-046（`PASS`）

- 关闭命题：ISO Remux抽出m2ts后跳过无法copy的`pcm_bluray`，不整盘重抽。
- Canary：`UAT-20260822-141950-0c27c8cf6`。
- 证人：ISO来源的《倩女幽魂2：人间道》最终MKV与Movie Canary当前Entry。
- 路径：我的收藏 → 打开倩女幽魂2详情 → 核对当前收藏、健康与MKV → 只读ffprobe最终流 → 检查iso-clip/partial残留。
- 允许动作：页面进入、打开/关闭详情、截图；文件系统和媒体元数据只读核验。
- 禁止动作：重跑ISO提取/Remux、修改评分、退出收藏、移动/删除文件、重启服务、重建Canary、修改数据库。
- 通过标准：产品完成On-deck；最终Matroska无`pcm_bluray/pcm_dvd`，仍保留可copy的视频、DTS/AC3/PGS；没有iso-clip或partial执行残留。
- 证据要求：`UI`、`FS`。
- 关闭结论：`PASS`。真实详情显示倩女幽魂2为Movie Canary当前收藏且健康，主视频`9.3 GB · MKV`。最终MKV含HEVC视频、DTS与AC3音频、3条PGS字幕，`UnsupportedPcm=0`；目标目录`IsoClipCount=0`、`PartialCount=0`。
- UI证据：`admin-web-evidence/uat-046-iso-skip-pcm-ondeck.png`（位于本Canary隔离证据目录）。
- FS证据：2026-08-23用部署ffprobe只读核验最终MKV及目标目录，支持轨道保留且无不兼容PCM或执行中间文件。

### UAT-045（`PASS`）

- 关闭命题：ISO Remux失败Effect与进程重启后Attempt能收口，不再永久`executing`。
- Canary：`UAT-20260822-141950-0c27c8cf6`。
- 证人：《倩女幽魂2：人间道》当前Shelf Entry及其Run/Remux Event/Attempt。
- 路径：我的收藏打开倩女幽魂2详情 → 核对当前收藏与健康 → SQLite只读核验该Subject全部Run与Remux Attempt终态。
- 允许动作：页面进入、打开详情、截图；SQLite只读旁证。
- 禁止动作：触发重试或恢复、重启服务、修改评分、退出收藏、重建Canary、修改数据库。
- 通过标准：页面不再停在Remux；Run completed；Remux Work/Event/Attempt均终态成功，没有任何executing Attempt。
- 证据要求：`UI`、`FACT`。
- 关闭结论：`PASS`。真实详情显示倩女幽魂2为Movie Canary当前收藏且健康。只读事实显示Run为`completed`；唯一`libra.media.remux@1` Work/Event均`succeeded`，Attempt ordinal 1为`completed/succeeded`且有完成时间，无非终态Remux Attempt。
- UI证据：`admin-web-evidence/uat-045-remux-attempt-terminal-ondeck.png`（位于本Canary隔离证据目录）。
- FACT旁证：2026-08-23只读查询隔离SQLite，Subject `libra-subject-6a0f51918c202e17cf6e6213ac485e59503bc1ad`的Remux Attempt总数1、非终态0。

### UAT-036（`PASS`）

- 关闭命题：已观察ISO能通过Triage形成Candidate，不再因非可播放流`triage_failed`。
- Canary：`UAT-20260822-141950-0c27c8cf6`。
- 证人：纯UDF ISO来源的《倩女幽魂2：人间道》当前Shelf Entry。
- 路径：我的收藏 → 打开倩女幽魂2详情 → 核对正式身份、当前收藏、主视频与健康。
- 允许动作：页面进入、打开/关闭详情、截图。
- 禁止动作：重新观察、触发Triage、修改评分、退出收藏、重启服务、重建Canary、修改数据库。
- 通过标准：新Observation/Run已让ISO形成Candidate/Subject并完成后续链路；页面不是缺失或triage失败，而是正式当前收藏。
- 证据要求：`UI`。
- 关闭结论：`PASS`。真实Admin Web显示《倩女幽魂2：人间道》为Movie Canary当前收藏且健康，主视频`9.3 GB · MKV`并有海报/NFO；ISO已穿过Triage、Libra生产和Arca On-deck，不再是`triage_failed`。
- UI证据：`admin-web-evidence/uat-036-iso-triage-candidate-ondeck.png`（位于本Canary隔离证据目录）。

### UAT-037（`PASS`）

- 关闭命题：007身份`provider_exact`观察不被schema拒绝，冻结文案不是通用句。
- Canary：`UAT-20260822-141950-0c27c8cf6`。
- 证人：Formation当前媒体中的`007：大破天幕杀机 (2012)`。
- 路径：媒体整理工作区 → 定位007 → 核对身份/资料/外部寻源步骤与需要处理文案 → SQLite只读旁证identity事件。
- 允许动作：页面进入、刷新、截图；SQLite只读旁证。
- 禁止动作：放弃Run、修改评分、触发外部获取、重启服务、重建Canary、修改数据库。
- 通过标准：身份步骤完成，不出现身份冲突或通用冻结；无合格五星候选时显示明确的合法冻结文案。
- 证据要求：`UI`。
- 关闭结论：`PASS`。007页面身份、资料、海报/NFO、外部寻源、验证五步均100%，终态为「没有找到可获取的外部候选，本次整理已冻结」。旁证中两次identity observe与一次resolve均`succeeded`，没有`P4_CAPABILITY_SCHEMA_REJECTED`。
- UI证据：`admin-web-evidence/uat-037-007-identity-resolved-legal-freeze.png`（位于本Canary隔离证据目录）。

### UAT-043（`PASS`）

- 关闭命题：007身份已过后，TMDB metadata fetch的closed-shape/lease失败可重试，不一次打成冻结。
- Canary：`UAT-20260822-141950-0c27c8cf6`。
- 证人：Formation当前媒体中的`007：大破天幕杀机 (2012)`及其metadata事件。
- 路径：媒体整理工作区 → 定位007 → 核对补齐资料与外部寻源终态 → SQLite只读旁证metadata fetch/commit。
- 允许动作：页面进入、刷新、截图；SQLite只读旁证。
- 禁止动作：放弃Run、修改评分、触发外部获取、重启服务、重建Canary、修改数据库。
- 通过标准：身份之后metadata获取与提交成功；页面资料步骤完成；若五星候选不足，应在外部寻源后合法冻结而不是metadata阶段通用冻结。
- 证据要求：`UI`。
- 关闭结论：`PASS`。007页面「补齐资料」100%，外部寻源也100%，终态为明确的无可获取候选冻结。旁证中两次`libra.product_metadata.fetch@1`和一次`libra.product_metadata.commit@1`均`succeeded`，没有closed-shape或lease终态失败。
- UI证据：`admin-web-evidence/uat-043-007-metadata-success-legal-freeze.png`（位于本Canary隔离证据目录）。

### UAT-003（`PASS`）

- 关闭命题：Product Identity不再因TMDB证据缺口把大量Run停在等待。
- Canary：`UAT-20260822-141950-0c27c8cf6`。
- 证人：Formation全部23个Subject，尤其当前6个五星冻结证人。
- 路径：媒体整理工作区 → 核对四桶总账 → 核对6个当前媒体的身份及后续步骤。
- 允许动作：页面进入、刷新、截图。
- 禁止动作：放弃Run、修改评分、触发外部获取、重启服务、重建Canary、修改数据库。
- 通过标准：不再有大量pending/in_progress停在身份阶段；已完成项进入completed；不可达五星项必须已越过身份并显示合法外部候选冻结。
- 证据要求：`UI`。
- 关闭结论：`PASS`。Formation显示17 completed、6需要处理、`pending=0`、`in_progress=0`。六个需要处理项的确认身份、资料、海报/NFO、外部寻源与验证均100%，终态均为无可获取外部候选的合法冻结；不存在Product Identity等待堆积。
- UI证据：`admin-web-evidence/uat-003-product-identity-no-mass-wait.png`（位于本Canary隔离证据目录）。

### UAT-011（`PASS`）

- 关闭命题：同根Shelf Target前Handoff B能推进，不再永久等待。
- Canary：`UAT-20260822-141950-0c27c8cf6`。
- 证人：活动Material Field、Movie Canary Shelf及17个当前Shelf Entry。
- 路径：文件来源配置核对Field路径 → 收藏架配置核对Target路径和条目数 → 我的收藏核对当前Entry。
- 允许动作：页面进入、刷新、截图；文件系统只读旁证。
- 禁止动作：扫描、修改路由/Shelf、触发On-deck、退出收藏、重启服务、重建Canary、修改数据库或文件。
- 通过标准：Field与Shelf Target同根；Handoff B/On-deck仍能完成；收藏架和收藏页出现正式当前Entry，不停在等待接收。
- 证据要求：`UI`、`FS`。
- 关闭结论：`PASS`。文件来源与Movie Canary Target均为`F:\canary`；收藏架为可接收整理结果并有17条，收藏页17部均为当前收藏。`F:\canary`现实包含22个一级电影目录；同根Handoff B没有永久等待。
- UI证据：`admin-web-evidence/uat-011-same-root-shelf-config.png`、`admin-web-evidence/uat-011-same-root-handoff-b-complete.png`（位于本Canary隔离证据目录）。
- FS证据：2026-08-23只读枚举`F:\canary`，同一根存在正式电影目录与产品文件，未做任何修改。

### UAT-017（`PASS`）

- 关闭命题：External Acquisition按当前Acceptance Spec在下载前预筛；有明确不合格广告声明的候选不得触发下载。
- Canary：`UAT-20260823-040740-0886b2723`，HEAD `0886b2723`。
- 证人：Formation中的《倩女幽魂2：人间道 (1990)》；5星Acceptance Spec要求HEVC、最低4K、合格premium audio、最大50 GiB并含NFO/Poster。
- 路径：系统设置确认真实MoviePilot连接 → Formation等待外部候选 → 打开冻结详情 → 核对候选Requirement Assessment、Selection结果与下一步。
- 允许动作：真实Admin Web读取、刷新、截图；真实Provider Search；SQLite只读旁证。
- 禁止动作：直接写数据库、伪造Candidate声明、手工触发下载、改媒体文件或触碰NAS/生产。
- 通过标准：明确低于4K、H.264或超50 GiB的候选为`noncompliant`，Selection为`no_requirement_eligible_candidate`，且不存在对应下载/Acquisition Work。
- 证据要求：`UI`；`FACT`只作旁证。
- 关闭结论：`PASS`。真实MoviePilot只返回一个候选，广告声明为`below_4k`、`h264`、190,900,558,889 bytes；页面对应冻结详情显示没有符合要求的外部候选。持久事实的拒绝理由为`video_codec_unmet`、`minimum_raster_unmet`、`max_size_exceeded`，Candidate为`noncompliant`，Selection为`not_selected / no_requirement_eligible_candidate`，未形成该候选的下载Work。UI证据：`admin-web-evidence/uat-062-frozen-before-discard.png`（同一截图先完成本行独立作业卡，随后才用于UAT-062）。

### UAT-020（`PASS`）

- 关闭命题：Final Inventory成员命名与carried-forward Settlement完整，技术后缀不进入最终名。
- Canary：旧失败`UAT-20260822-141950-0c27c8cf6`；关闭证人`UAT-20260823-002500-519f8d7b5`。
- 证人：Admin Web「我的收藏」中的《老笠》及`F:\canary\老笠 (2016)`正式Inventory目录。
- 路径：我的收藏 → 打开老笠详情 → 核对当前收藏与健康 → 只读枚举唯一目录及正式Inventory成员名。
- 允许动作：页面进入、打开/关闭详情、截图；文件系统与SQLite只读核验；按已确认关闭程序从不可变Baseline重建新Canary。
- 禁止动作：手工移动/重命名文件、触发Aftercare修复、退出收藏、修改数据库或改写旧Inventory。
- 通过标准：唯一用户目录；主视频/NFO/字幕等正式成员均使用Placement决定的用户可读名；技术发布标签不进入最终名；无旧目录或partial。
- 证据要求：`UI`、`FS`。
- 关闭结论：`PASS`。新Canary中老笠为健康当前收藏，且只有`F:\canary\老笠 (2016)`一个目录；正式成员为`老笠 (2016).mp4`、`老笠 (2016).nfo`、`老笠 (2016).zh-CN.srt`、`poster.jpg`、`fanart.jpg`，无技术发布标签、旧兄弟目录或partial。
- UI证据：`admin-web-evidence/uat-020-final-subtitle-normalized-pass.png`（位于新Canary隔离证据目录）。旧失败截图继续保留为修复前证据。
- FS证据：2026-08-23只读枚举及`uat-020-fs-evidence.json`，`SiblingRootCount=1`、`PartialCount=0`，字幕basename精确为`老笠 (2016).zh-CN.srt`。

### UAT-062（`PASS`）

- 关闭命题：frozen Run Discard 后 Control 保持 released、不立刻新开 Libra Run；页面显示等待重新入库，材料由 Field Management 进入全新 Procurement。
- Canary：`UAT-20260823-040740-0886b2723`，HEAD `0886b2723`加本轮同Canary缺陷修复后的安全重启。
- 证人：《倩女幽魂2：人间道 (1990)》；原Run `8fdf9e2e...`，原Subject `libra-subject-fc12e089...`，材料保持在原Field Observation。
- 路径：真实MoviePilot候选预筛后形成frozen Run → 页面出现放弃入口 → 放弃本次整理 → 刷新确认待整理/等待重新入库 → 文件来源页面扫描新文件 → Formation与FACT复核新链。
- 允许动作：用户即时确认后由正式Admin Web提交本地私密MoviePilot配置；页面Discard；刷新、等待、截图；SQLite/日志/文件系统只读旁证。
- 禁止动作：直接写Integration Secret或SQLite、伪造frozen、在未冻结时调用Discard API、手工改Control或媒体文件、触碰ShelfDeck NAS生产服务。
- 通过标准：旧Run为discarded；Control released；无新Libra Run；页面不是正在评估而是等待重新入库/等待再次发现；清理Outbox被消费；仍在Field Observation中的材料形成新Procurement链。
- 证据要求：`UI`；`FACT`只作旁证。
- 关闭结论：`PASS`。页面放弃后显示「待整理 / 等待重新入库」，旧Run成为`discarded` revision 4，Discard提交时Control revision 3为`released`；cleanup消息由consumer `libra`形成Inbox并达到Delivery `acked` / Outbox `fully_acked`。页面重新扫描后形成新Procurement Run `procurement-run-8ecd820a...`及accepted Candidate Delivery，材料进入新Subject `libra-subject-5e1b9392...`并形成新frozen Run；原Subject仍只有旧discarded Run，没有被直接复活。UI证据：`admin-web-evidence/uat-062-frozen-before-discard.png`、`admin-web-evidence/uat-062-awaiting-reintake-pass.png`。FACT仅作上述时序旁证；未编辑数据库或媒体文件。

### UAT-063（`PASS`）

- 关闭命题：Aftercare 使用与 Libra 相同的 `perception.rating.resolve@1` Identity Evidence；上架后评分从无到有或变档时重新评估。
- Canary：失败证人 `UAT-20260823-014246-3397c88f5`；重验 Canary 待 HEAD `a34dbde1f9` 安全重建。
- 证人：Formation 与「我的收藏」中的《威尼斯惊魂夜》；另选一部已符合当前档的 HEVC 低体积 Shelf Entry 作保持健康反例。
- 路径：Formation 读取外部豆瓣星级 → 我的收藏打开对应详情 → 核对年份及豆瓣星级 → 通过页面提交/清除 Shelf Entry 直接评分 → 立即检查健康并等待 Assessment 完成 → 页面复核健康状态。
- 允许动作：Admin Web 页面读取、评分提交/清除、立即检查健康、刷新、截图；SQLite/日志只读旁证；当前在飞媒体生产自然结束后按用户授权重建干净 Canary。
- 禁止动作：修改 SQLite 业务状态、直接扫描 Perception Record 代替产品入口、回读 Libra Subject 作为 Aftercare 输入、手工修改媒体文件、触碰 NAS/生产、在转码/ISO 活动时重启。
- 通过标准：Subject 与 Shelf Entry Resolution 都为 `found` 且命中同一 Douban Record/星级；技术尾缀不导致 `not_found`；评分变化后无需等待 24 小时即形成新的 conformance Assessment；已符合档位的 HEVC 证人保持 healthy，不重开 Libra Run。
- 证据要求：`UI`；`FACT`只作旁证。
- 关闭结论：`PASS`。`UAT-069`修复后，页面提交4星直接评分且不点健康检查，03:44:27自动形成三维健康Assessment；清除后页面恢复`3 星 · 豆瓣`，03:45:06再次自动形成三维健康Assessment。Subject与Shelf Entry当前Resolution均为`found`，共同命中`perception-record-5628590251074f0155192bf1b1eadf8828c3258e`；没有重开Libra Run。UI证据：`admin-web-evidence/uat-063-rating-change-auto-aftercare-pass.png`。

### UAT-069（`PASS`）

- 关闭命题：Aftercare Capability、Process Coordinator 与 Planner 共享同一个包含当前 Perception Resolution 的 Care Basis；评分变化后的 Assessment 不得写回旧 Basis。
- Canary：失败证人 `UAT-20260823-024825-f6b9eded6`；重验 Canary 等当前媒体生产自然结束后，从包含本修复的新 HEAD 安全重建。
- 证人：「我的收藏」中的《威尼斯惊魂夜 (2023)》；页面直接评分由 4 星清除并恢复 `3 星 · 豆瓣`。
- 允许动作：Admin Web 页面提交/清除评分、立即检查健康、刷新和截图；SQLite/日志只读旁证；无 FFmpeg/ISO 活动时按既有授权重建本地 Canary。
- 禁止动作：修改 SQLite 业务状态、直接制造 Assessment、回读 Libra Subject 代替 Arca 输入、手工修改媒体文件、触碰 NAS/生产、在媒体生产中重启。
- 通过标准：评分 Resolution revision 更新后自动或手动形成的 Assessment 使用包含该 `resolutionDigest` 的新 `decisionFactSetDigest` / `careBasisDigest`；页面从`尚未检查`收口为与当前档位一致的健康结论，且不重开 Libra Run。
- 证据要求：`UI`；`FACT`只作旁证。
- 关闭结论：`PASS`。commit `ab8184f7b` 后在无媒体生产的安全点只重启同一隔离服务，未重建数据、未编辑数据库或文件。页面最终显示`3 星 · 豆瓣`且保管/呈现/合规均健康。修复后恢复现场、4星直接评分、清除回豆瓣分别形成三组新 Assessment；最新三代 Care Basis 为`d315adad...`、`e7f6011e...`、`4b27fdc...`，均不再使用旧`1ade89d0...`。UI证据：`admin-web-evidence/uat-069-rating-aware-care-basis-pass.png`。

### UAT-068（`PASS`）

- 关闭命题：Collection 年份投影保留 Provider 标准年份字段，Aftercare Shelf Entry 不因年份丢失 title-year Identity Evidence。
- Canary：`UAT-20260823-024825-f6b9eded6`。
- 证人：「我的收藏」中的《威尼斯惊魂夜 (2023)》及 Formation 同一 Subject。
- 允许动作：Admin Web 页面读取、刷新、截图；SQLite只读旁证。
- 禁止动作：修改数据库、扫描 Perception Record 代替产品入口、回读 Libra Subject 作为 Arca 输入、修改媒体文件或触碰生产。
- 通过标准：详情显示2023；无直接评分时显示Formation相同的豆瓣星级；两边Resolution命中同一Douban Record。
- 证据要求：`UI`、`FACT`。
- 关闭结论：`PASS`。详情显示`2023`与`3 星 · 豆瓣`；Inventory保留`year_or_release_date=2023`和`release_date=2023-09-13`。Subject与Shelf Entry当前Resolution均命中`perception-record-5628590251074f0155192bf1b1eadf8828c3258e`。UI证据：`admin-web-evidence/uat-068-year-and-douban-rating-pass.png`。

## 9. Post-closure UAT-074–UAT-084（2026-08-23）

共同当前提交：`3722e129b`、`6cc38e2f2`、`857df10e1`、`004c17ac4`、`b4e36d5c0`。共同干净Canary：`F:\shelfdeck_test_zone\runs\UAT-20260823-formation-074-083-b4e36d5c-v11`；共同FACT：`evidence/formation-uat-074-083-facts.json`。失败态与逐片审计证人：`F:\shelfdeck_test_zone\runs\UAT-20260823-uat082-formation-failure-witness-v7-dc10a5b9`。未触碰NAS生产，Credential未进入文档、截图或FACT。

### UAT-074（`PASS`）

- 关闭命题：可用NFO更新、损坏NFO重建、缺失NFO创建，源Field只读。
- 关闭结论：007、香火、威尼斯惊魂夜分别形成`related_nfo_update`、`product_metadata_draft_rebuild`、`product_metadata_draft_create`；三部均上架，源前后快照一致。真实007详情显示“更新 NFO”。

### UAT-075（`PASS`）

- 关闭命题：NFO更新保留丰富字段并稳定电影/人物强身份。
- 关闭结论：007输出NFO为13,348字节，保留演员、IMDb `tt1074638`与电影TMDB `37724`；演员Person ID `8784`未再成为电影ID，007无身份冲突并完成上架。

### UAT-076（`PASS`）

- 关闭命题：合格Related Artwork复用，缺失时才外部获取。
- 关闭结论：007与香火poster来自`related_material_reference`；威尼斯惊魂夜缺图才使用TMDB并成功`acquired`。详情明确显示“复用现有海报”。

### UAT-077（`PASS`）

- 关闭命题：Artifact Handle在Provider调用前冻结当前revision与`artifactKind`。
- 关闭结论：真实威尼斯海报请求使用`tmdb:tmdb-main@1`并成功；`PLATFORM_INTEGRATION_HANDLE_INVALID=0`、revision mismatch=0。服务自身优雅关闭和重启后结果稳定。

### UAT-078（`PASS`）

- 关闭命题：设置页如实区分Integration配置与最近验证状态，不暴露Credential。
- 关闭结论：真实页面TMDB与豆瓣均显示“当前可用”，优雅重启后保持；DOM和FACT不含API Key、Secret或Cookie。UI证据：`evidence/uat-078-settings-current-available.png`。

### UAT-079（`PASS`）

- 关闭命题：新Subject按规范化身份形成豆瓣Resolution，空值必须解释。
- 关闭结论：v11三部新Subject均形成`found`或明确`no_matching_record`；页面用“豆瓣暂无匹配评分”而非空白`—`，保留现场未补历史数据。

### UAT-080（`PASS`）

- 关闭命题：按Owner确认Stub实现一张紧凑媒体表，用户操作与加急分列。
- 关闭结论：真实页面使用一张表和确认的八列；状态筛选、正式加急API、绿色纯文字控件保留。390px下仅表容器横向滚动，页面不被撑宽；Admin Web 26/26和production build通过。

### UAT-081（`PASS`）

- 关闭命题：单一中心卡片透传已接收材料、媒体整理、验收与上架三段正式事实。
- 关闭结论：真实007详情显示三段事实、“更新 NFO”“复用现有海报”和完成验收；倩女幽魂失败详情将60个Related Material按角色计数，Libra发布写作“提交收藏架验收”。UI证据：`evidence/uat-074-081-007-detail.png`。

### UAT-082（`PASS`）

- 关闭命题：业务Result失败不能显示完成，列表与详情必须给出可用恢复动作。
- 关闭结论：失败克隆中春晚`metadata_field_unmet`Run被冻结为revision 3；列表显示“本次整理已冻结，需要放弃后重新采购”，操作为“放弃本次整理”、加急禁用，详情“验证整理结果”为失败且尚未进入Arca。倩女幽魂独立显示`CLEAN_ARCA_TARGET_ROOT_UNAVAILABLE`与“重试验收”。UI证据：`evidence/uat-082-spring-gala-frozen-detail.png`。

### UAT-083（`PASS`）

- 关闭命题：旧Field保留时新增同根第二Field，只形成一次合法整理。
- 关闭结论：`formation-uat-field-a`与`formation-uat-field-b`为不同fieldId、同endpoint/mount/root；最终三部电影仅有3个Candidate、3个Subject、3个Run和3个Shelf Entry，源快照不变，重启后不重复。

### UAT-084（`PASS`）

- 关闭命题：当前Formation每行均可落到正式Owner事实、根因和恢复动作。
- 关闭结论：`evidence/uat-084-formation-audit.json`对25/25行审计PASS：12身份确认、9历史Artifact Handle失败、1历史Secret Lease失败、1产品符合性失败、1 Arca验收失败、1完成；`in_progress=0`，无失败标完成、无未知类别。审计只读，未修改保留SQLite、Observation或源文件。

## 10. Post-closure OPEN UAT-085–UAT-087（2026-08-23）

以下三项在历史70/70与`UAT-074`–`UAT-084`关闭之后由新的clean环境真实使用发现。它们只登记为新的OPEN资格项，不追溯改写既有PASS；完整合同、现场证据和修复边界以`docs/helix/USER_ACCEPTANCE_TEST_ISSUE_LOG.md`为准。

### UAT-085（`OPEN`）

- 关闭命题：豆瓣多页Acquisition失败后能够从持久游标有节奏地续传，并在Settings与Formation显性区分“同步未完成”和完整数据中的无匹配。
- 当前状态：`RECORDED / OPEN`，尚未实现或资格关闭。

### UAT-086（`OPEN`）

- 关闭命题：候选级媒体验证未通过但已进入后续策略时，Formation显示当前整理责任和真实执行状态，不误报整个Run失败；真正终局失败仍须显性可操作。
- 当前证人：《锡尔弗顿之围》direct候选`video_codec_unmet`后正常转码并上架；《养蜂人》remux候选`max_size_exceeded`后正在转码，外层曾错误显示blocked。
- 当前状态：`RECORDED / OPEN`，尚未实现或资格关闭。

### UAT-087（`OPEN`）

- 关闭命题：真实Transcode从FFmpeg到Foundation Progress、Formation Projection和中心详情形成持久、单调、可量化的执行进度；无可靠总量时明确显示indeterminate而不伪造百分比。
- 当前证人：锡尔弗顿与养蜂人的Transcode Event均无Progress行；同一养蜂人Run的Remux已有55个Progress revision。
- 当前状态：`RECORDED / OPEN`，尚未实现或资格关闭。
