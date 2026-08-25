# Helix-beta 验收基线（Movie 全链路）

Status: `ACTIVE`  
确认：Product Owner 于 2026-08-22 将 Helix-beta 收窄为 **仅支持 Movie 的全功能版本**  
Owner: Architecture / Product  
Architecture authority: `docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`（唯一架构 SSOT）  
作废文档: `docs/helix/archive/BETA_FEATURE_ACCEPTANCE_BASELINE_FOUR_PROFILE_2026-07-23.md`（2026-07-23 四类媒体 271 行 Feature Matrix）

本文是 SSOT 面向 Helix-beta **发布范围**的验收投影。它不建立第二份架构权威，也不从 SSOT 删除 Series / JAV / Western Adult。那些 profile 仍是架构对象；Helix-beta **不交付、不验收、不宣称支持**它们。

## 1. 产品定义

**Helix-beta = 只做 Movie 的 ShelfDeck Service 全功能版本。**

「全功能」指 SSOT §9.1 旅程 A–I 在 `content_profile=movie` 上全部成立，而不是「只做到上架」：

| 旅程 | SSOT | 用户意图 | Helix-beta 是否包含 |
| --- | --- | --- | --- |
| A 建立系统 | §9.1.1 | 原料在哪、成品在哪、收藏标准与自动运营条件 | 是 |
| B 新材料进入收藏 | §9.1.2 | 发现 → 整理 → 只有 On-deck Commit 才成为正式收藏 | 是 |
| C 浏览正式收藏 | §9.1.3 | 只看有效 Shelf Entry / Deck Fact | 是 |
| D 收藏健康与有界自修 | §9.1.4 | 存在、可访问、符合标准；不能修的要说清楚 | 是 |
| E 标准变化后改善 | §9.1.5 | 同一 Entry 按新标准评估，不回流首次形成 | 是 |
| F 评分、已看、人物 | §9.1.6 | 知识被保存；不假装立刻改片 | 是 |
| G 退出收藏 | §9.1.7 | 审阅、授权、销毁、终结 Deck Fact | 是 |
| H 注销整座 Shelf | §9.1.8 | 收藏事实结束，文件不动 | 是 |
| I 系统与成果概览 | §9.1.9 | 是否履职、最近做了什么、还有什么要人决定 | 是 |

「仅 Movie」约束：

- Field / Shelf / Template / Routing / Spec / Entry 的 Helix-beta 验收对象只有 `content_profile=movie`、`structure_kind=single`。
- 产品表面不得把 Series / JAV / Western Adult 宣称为已支持能力；不得用 Movie 样本的通过去给那些 profile 打 `PASS`。
- SSOT 中的 Season 颗粒度、FA-04、JAV 番号、Western 内部分析与人脸抽帧 **不是** Helix-beta 交付范围。

## 2. 权威与协作

1. 架构语义只以 SSOT 为准。本文只投影 **Helix-beta 要让用户看见的结果**。
2. 2026-07-23 四类媒体 Feature Matrix 已作废，不得再作为 DoD、阻断或「缺 F08 就不能发 Beta」的依据。
3. 实现不得把本范围收窄解释成可以删 SSOT、改 Owner/Handoff，或在 Movie 链路上做 workaround。
4. API `200`、页面渲染、单元测试或 Mock 不能单独证明旅程通过。页面、公开 Projection 与（涉及文件时）物理现实必须一致。
5. **旅程通过至少要求对用户可用。** 这不是高效执行或容量优化：后台转码可以很久，只要进度和等待原因诚实。若首屏/刷新无法结束、整页卡死、无理由转圈、或页面写「整理中」却没有任何执行证据，该旅程不得标为通过。
6. 破坏性 Off-deck 只允许在用户授权的 Movie 样本根（当前为 `F:\canary`，基线 `F:\test_film` 只读）或一次性 disposable root。生产 NAS 与 `Z:\Film` 不在范围。

状态词汇：

| Status | 含义 |
| --- | --- |
| `NOT_RUN` | 尚未按本基线取得用户可见 Evidence |
| `PASS` | 已在要求环境中证明用户结果和安全边界 |
| `BLOCKED` | 当前实现交不出已确认的 Movie 用户结果 |
| `OUT_OF_BETA` | 明确不属于 Helix-beta；不等于 SSOT 删除 |

Helix-beta 交付门禁：范围内条目不得无解释 `NOT_RUN`，不得有 `BLOCKED`。`OUT_OF_BETA` 必须有负向/未宣称 Evidence。

## 3. 用户表面

Helix-beta Admin Web 仍是 SSOT §9.4.1 的八个一级入口：

```text
概览
我的收藏
媒体整理工作区
退出收藏
人物
── 配置 ──
文件来源配置
收藏架配置
系统设置
```

普通表面不出现 Task / Gate / Capability / Flow 控制。内部术语只进 Advanced Diagnostics。

## 4. Movie 全链路结果（从 SSOT 抽象）

下列 `HB-*` 是 Helix-beta 验收行。编号按旅程，不继承已作废的 F01–F21。

### HB-A — 建立可自动运营的 Movie 收藏系统

SSOT: §9.1.1, §9.4.11, §9.6.2–§9.6.8, §9.6.5

| ID | 用户结果 | 主要验证 |
| --- | --- | --- |
| HB-A.01 | 唯一 Admin Owner 可认证；未认证访问被拒绝 | UI, API, NEG |
| HB-A.02 | 「建立收藏」向导按序完成 Shelf、Field、模板、去向、Provider、Workspace、自动化预设；完成后只宣称具备发现/生产/上架条件，不宣称已有收藏 | UI, API, VISUAL, NEG |
| HB-A.03 | 每座 Shelf 有且仅有一个已验证 Physical Target Folder | UI, API, FS, NEG |
| HB-A.04 | 用户可新增/选择 Movie Material Field，并验证可达、可读、containment | UI, API, FS, NEG |
| HB-A.05 | Movie Field 与同一 Shelf Target **允许同根或重叠** | UI, API, E2E, FS |
| HB-A.06 | 用户选择不可改写的系统推荐 Movie Rule Template，或复制后发布自己的 revision | UI, API, NEG |
| HB-A.07 | 用户选择全自动或关键步骤确认，并看见准确后果；全自动不授予 Off-deck 销毁权 | UI, API, VISUAL, NEG |
| HB-A.08 | Setup 报告 Field / Shelf / Routing / Workspace / Provider / 计算 Readiness | UI, API |
| HB-A.09 | 浏览器关闭后可继续已保存 Setup；Service 重启保留已完成配置事实 | UI, API, RECOVERY |

### HB-B — Movie 从文件来源进入正式收藏

SSOT: §9.1.2, §9.4.3, §9.4.6, §5.5.3–§5.5.7, §6.3–§6.6

| ID | 用户结果 | 主要验证 |
| --- | --- | --- |
| HB-B.01 | 活动 Movie Field 启动后首次观察，之后按 SSOT 周期做轻量变化观察；用户可「扫描新文件」，仅进行中禁用 | UI, API, E2E |
| HB-B.02 | 新的 eligible 物理材料被确定性 Triage 为 Movie Candidate Package，不冒充 Canonical Identity | E2E, FS, NEG |
| HB-B.03 | **同一顶层目录内，独立 stream 文件与嵌套盘包是两部 Movie**；BDMV 内部 M2TS/playlist 不得再拆；ISO 是一部 Movie。内容去重属于退出收藏 Duplicate，不是 Formation 拦截 | E2E, FS, NEG |
| HB-B.04 | Movie Field 默认允许的媒体扩展名包含 ISO 等盘镜像；缺 NFO 走补齐路径，不静默失败 | UI, API, E2E, FS |
| HB-B.05 | 已处于 Production / Finished Goods 的同根文件不再被采购 | E2E, FS, NEG |
| HB-B.06 | Libra 解析唯一目标 Shelf，或明确 unresolved；用户可一次性选架，不改长期 Policy | UI, API, E2E, NEG |
| HB-B.07 | Acceptance Spec 由当前 Movie Shelf Standard 与评分事实确定性计算 | E2E, NEG |
| HB-B.08 | 变更产品只在 Libra Workspace 生产；已合规输入真实 no-op；容器不合规真实 Remux；编码或大小不合规真实 Transcode | E2E, FS, PROBE |
| HB-B.09 | BDMV/ISO 在形成可消费 `stream_file` 之前不能 On-deck | E2E, FS, PROBE, NEG |
| HB-B.10 | Movie On-deck 要求有效 TMDB Movie Identity；NFO 有效值不被 TMDB 默认覆盖；产品含可解析 NFO 与可解码 Poster | E2E, PROVIDER, FS, NEG |
| HB-B.11 | 1–5 星 Movie 空间/媒体要求按 SSOT §5.5.7；无评分以 stream-file 正式 On-deck，不强制 4K/高质量音轨/空间上限 | E2E, NEG |
| HB-B.12 | **五星要求不可达**（无合格 4K 源等）时，页面进入可读「需要处理 / 冻结」，不得伪装完成，也不得当作监测 DONE；这是合法终态，不阻断其余可上架账 | UI, E2E, NEG |
| HB-B.13 | 外部寻源（已配置 MoviePilot 时）按当前 Requirement 预筛；明确不合规不下载；真实字节仍由 Probe 验收 | UI, API, PROVIDER, NEG |
| HB-B.14 | 只有 Arca 独立接受且 On-deck Commit 成功，才建立或扩充 Shelf Entry 与 Deck Fact；Handoff B Accepted 不是「已完成整理」 | E2E, NEG |
| HB-B.15 | 同根终态：每部 Movie 一份 Primary 现实；禁止 hash 目录、`标题 (0)` 目录、未解释的源/收藏双份；Settlement 按 `carried_forward` 或 `replaced_and_settled` 解释；盘整理完成后按合同处理原 BDMV/CERTIFICATE 树 | E2E, FS, NEG |
| HB-B.16 | 再次 Observation 不把已 On-deck Inventory 重新采购 | E2E, FS, NEG |
| HB-B.17 | 中断恢复不产生重复物理副作用，也不丢失责任；预算耗尽进入 Frozen，用户可放弃后重新入库 | E2E, RECOVERY, NEG |
| HB-B.18 | 用户可加快/取消加快当前 Libra Run；优先级不传给 Arca | UI, API, E2E, NEG |

媒体整理工作区（§9.4.6 + 已确认工作台合同）：

| ID | 用户结果 | 主要验证 |
| --- | --- | --- |
| HB-B.19 | 行级旅程标签使用 SSOT 稳定阶段：`已发现\|正在准备\|待选择去向\|正在生产\|正在验收\|正在上架\|需要处理\|已完成` | UI, API, VISUAL |
| HB-B.20 | 当前工作台四桶互斥：`待整理\|整理中\|需要处理\|已完成整理`。完成必须同时证明 On-deck Commit、Shelf Entry、对应 active Deck Fact；Package published 仍是整理中；Frozen/blocked/身份确认/技术失败进需要处理 | UI, API, E2E |
| HB-B.21 | 当前媒体筛选走公开 Query（状态/架/要我处理/加急/片名），禁止只筛当前页 | UI, API |
| HB-B.22 | 整理动作是步骤清单（含「怎么转」），每步进度、用户操作、加急分列；完成区只读同一套动作 | UI, API, VISUAL |
| HB-B.23 | 可量化转码/下载才显示真实百分比；不能计算时不编造 ETA；等待原因必须是资源/Provider/Approval 等真实原因 | UI, E2E, NEG |
| HB-B.24 | 普通 UI 不暴露 Task、Gate、Capability、Flow | UI, NEG, AUDIT |
| HB-B.25 | Frozen Movie只有用户可选择同级动作`放弃整理`或`接受瑕疵`；V1仅允许演员外部资料为空、或原始媒体安全可播放但外部寻源耗尽。授权使用精确revision/digest和幂等CAS，其他Gap拒绝 | UI, API, E2E, NEG, AUDIT |
| HB-B.26 | 瑕疵入库不伪造普通合格：Libra保留真实unmet Requirement，Arca独立验证为`accepted_with_defects`，On-deck后显示`瑕疵入库 · N项` | UI, API, E2E, NEG |

### HB-C — 我的收藏

SSOT: §9.1.3, §9.4.5

| ID | 用户结果 | 主要验证 |
| --- | --- | --- |
| HB-C.01 | 「我的收藏」只列出当前有效 Movie Shelf Entry；Candidate / Subject / Run / 未 On-deck 货品永不计入 Own | UI, API, E2E, NEG |
| HB-C.02 | 一级按收藏架浏览（保留「全部」） | UI, VISUAL |
| HB-C.03 | 可按健康、评分、空间、编码、On-deck 时间筛选 | UI, API |
| HB-C.04 | 详情显示标题、封面、TMDB 身份、物理位置、占用空间、主视频容器/编码/清晰度、海报/NFO 是否齐全；不把内部 Handle 当用户身份 | UI, API, FS, NEG |
| HB-C.05 | 历史筛选可看 offdecked / deregistered 记录，但不计入当前 Own | UI, API, NEG |

### HB-D / HB-E — 收藏健康与标准变化后改善

SSOT: §9.1.4, §9.1.5, §9.4.7, §5.7

| ID | 用户结果 | 主要验证 |
| --- | --- | --- |
| HB-D.01 | 健康并入「我的收藏」，不另开一级页。三维：实物承载、资料呈现、收藏要求 | UI, API, E2E |
| HB-D.02 | 用户可要求立即有界健康检查 | UI, API, E2E |
| HB-D.03 | 低成本、高成功率、非破坏性 Finding 自动修，修完独立复验 | E2E, FS, RECOVERY |
| HB-D.04 | 不确定/不可修复显示 `需要处理`，不提供虚假修复按钮；不自动创建 Off-deck 授权 | UI, API, E2E, NEG, AUDIT |
| HB-D.05 | Aftercare不补齐、不重试已接纳的精确瑕疵，但继续处理同一Entry中新出现或未授权的其他问题 | API, E2E, NEG, RECOVERY |
| HB-D.05 | Aftercare 只用 Arca 已拥有且位置明确的材料，不回流 Procurement/Libra 采购新媒体 | E2E, NEG, AUDIT |
| HB-E.01 | 发布新 Movie Shelf Standard / Placement 后，现有 Entry 重新评估；身份保持同一 Entry | UI, API, E2E |
| HB-E.02 | 完全可规划 Gap 走 Aftercare；需要外部 Acquisition 的 Gap 保持可解释 attention | UI, API, E2E, NEG |

### HB-F — 评分、已看与人物

SSOT: §9.1.6, §9.4.9, §5.9, §6.8

| ID | 用户结果 | 主要验证 |
| --- | --- | --- |
| HB-F.01 | 用户可在整理中与已上架后持久化 1–5 星；直接评分优先于豆瓣；可清除后恢复可解释来源；刷新后不丢 | UI, API, RECOVERY |
| HB-F.02 | 用户可持久化 watched / unwatched | UI, API, RECOVERY |
| HB-F.03 | 已配置豆瓣后可执行/安排有界 Perception 同步；Helix-beta 周期 Acquisition 按 SSOT 运行 | UI, API, PROVIDER |
| HB-F.04 | 用户可直接注册 Person、维护姓名/别名/五级偏好 | UI, API, RECOVERY |
| HB-F.05 | On-deck NFO 人物证据：强身份可自动接受，弱身份待确认；页面可登记/接受/忽略；People Command 不改 Libra/Arca Media-Cast | UI, API, E2E, NEG, AUDIT |
| HB-F.06 | Person Preference 不作为 Acceptance Rule 输入（SSOT §9.1.6）；退出规则在人物偏好入口可用前不得先把「不喜欢的人」做成可添加项 | UI, API, NEG |

Reference Image 单人脸校验若 Helix-beta 人物页提供上传，必须 fail closed（零脸/多脸拒绝、不形成部分 Fact）。Western 抽帧分析链路 **OUT_OF_BETA**。

### HB-G — 退出收藏

SSOT: §9.1.7, §9.4.8, §5.8, §9.6.4

Helix-beta **包含完整退出收藏**，不是可选项。

| ID | 用户结果 | 主要验证 |
| --- | --- | --- |
| HB-G.01 | 低评分 / Duplicate / 长期未解决 Care Finding 可按 Policy 产生候选；无评分 ≠ 低评分 | UI, API, E2E, NEG |
| HB-G.02 | Duplicate Group 由用户选择保留/退出，系统不指定赢家；可全部保留 | UI, API, NEG, VISUAL |
| HB-G.03 | 候选展示片名、原因、Entry、预计释放空间；主表面不用 Case/Reservation 内部账 | UI, VISUAL |
| HB-G.04 | 授权前可取消并释放 Reservation，零文件副作用 | UI, API, E2E, FS, NEG |
| HB-G.05 | 破坏性 Authorization 后不可撤销；批量过大须独立二次确认 | UI, API, NEG, AUDIT |
| HB-G.06 | 只删除目标 Entry 独占 Primary；Related 最后引用才删；共享 Primary 拒绝 | E2E, FS, NEG |
| HB-G.07 | 全部成员合法收口后才终结 Deck Fact、置 offdecked、释放精确 Control；历史保留 | UI, API, E2E, RECOVERY |
| HB-G.08 | 全自动永不签发破坏性 Off-deck Authorization | E2E, NEG, AUDIT |

### HB-H — Shelf 注销

SSOT: §9.1.8, §9.4.4

| ID | 用户结果 | 主要验证 |
| --- | --- | --- |
| HB-H.01 | 强确认后非破坏性注销：终结 active Entry/Deck Fact，释放精确 Control，不删/移/改名文件，不删 Target Folder | UI, API, E2E, FS, NEG |
| HB-H.02 | 注销中/已注销 Shelf 不再作为 Routing / Acceptance 目标 | UI, API, E2E |
| HB-H.03 | 已注销历史可查，不计入当前 Own | UI, API, RECOVERY |
| HB-H.04 | Field 注销停止新观察，不改物理文件；已被接管的责任继续收口 | UI, API, E2E, FS, NEG |

### HB-I — 概览与运行安全

SSOT: §9.1.9, §9.4.2, §9.6.9

| ID | 用户结果 | 主要验证 |
| --- | --- | --- |
| HB-I.01 | 概览系统三态：尚未配置 / 正常运行 / 系统故障；可点待办；带片名的最近进展。不与「我的收藏」合并，不做第二面海报墙 | UI, API, VISUAL, NEG |
| HB-I.02 | 报告正式 Movie 收藏数量，不把未 On-deck 对象算进去 | UI, API, E2E |
| HB-I.03 | `GET /v1/health` 公开且不暴露 Secret/收藏详情；其余 Admin 需要会话 | API, NEG |
| HB-I.04 | Credential 不出现在 URL、日志、HTML、localStorage；已保存 Secret 只显示掩码 | UI, API, NEG, AUDIT |
| HB-I.05 | Advanced Diagnostics 只读 | UI, API, NEG, AUDIT |
| HB-I.06 | 关闭/刷新浏览器不取消 durable 长操作 | UI, API, E2E, RECOVERY |
| HB-I.07 | 后台长任务进行时，八个正式页面仍能打开、刷新和完成只读操作。不得以无进度转圈、整页卡死、或「整理中」却无执行证据冒充旅程通过。不要求高效或容量优化 | UI, E2E, NEG |

### HB-P — Movie 所需平台能力

SSOT: §8.2, §8.4, §9.6.6–§9.6.8, §7.2–§7.4

| ID | 用户结果 | 主要验证 |
| --- | --- | --- |
| HB-P.01 | 可测试并保存真实 TMDB（默认语言 `zh-CN`）、豆瓣、MoviePilot；测试连接在 Save 前不持久化 | UI, API, PROVIDER, NEG |
| HB-P.02 | 可选 Emby：保存 Token/Secret Handle 而非密码；不要求 Library Mapping；永不创建/修改 Emby Library | UI, API, PROVIDER, NEG, AUDIT |
| HB-P.03 | Workspace / Aftercare Workspace / Artifact Root 互不重叠，也不与 active Field/Shelf Target 重叠 | UI, API, FS, NEG |
| HB-P.04 | 本机 CPU/GPU 只有真实短编码/Probe 后才显示可用；不得只凭 NVENC 名称 | UI, API, PROBE, NEG |
| HB-P.05 | 用户可选择默认 Resource Profile；「火力全开」若提供，只提高供给、不降低验证 | UI, API, NEG |
| HB-P.06 | Beta 不交付 Remote Worker 探测、注册或保存 | AUDIT |
| HB-P.07 | 不存在音频转码 Capability；不存在 AI Upscale 路径 | E2E, NEG, AUDIT |

## 5. Helix-beta 明确不包含

这些是 **发布范围排除**，不是 SSOT 删除。负向验收：产品不得宣称支持，Helix-beta 不得因它们未跑而不让 Movie 全链路收口。

| ID | 排除 | 必须看到的负向结果 |
| --- | --- | --- |
| XB-01 | Series / Season 产品能力 | 不把 Season 颗粒度、缺集、Episode 扩充宣称为 Helix-beta 已支持 |
| XB-02 | JAV 产品能力 | 不把番号/JAV Provider/2 GiB JAV 模板当 Helix-beta 已支持 |
| XB-03 | Western Adult 产品能力 | 不把内部分析/抽帧/1 GiB Western 模板当 Helix-beta 已支持 |
| XB-04 | Homemade profile | 不暴露 |
| XB-05 | AI Upscale | 不存在工具、设置、Capability 或借此通过的 4K 路径 |
| XB-06 | 多用户 / RBAC | 只有一个 Admin Owner |
| XB-07 | 手动生产手段 | 不向用户暴露 FFmpeg 参数、码率、Flow、Gate、Task |
| XB-08 | 业务 Pause / 零容量档 | 不存在 |
| XB-09 | 自动 Off-deck 授权 | 任何自动化不得在缺少用户明确动作时销毁 |
| XB-10 | 自动选择重复项赢家 | 系统不指定保留哪个版本 |
| XB-11 | media-desktop / media-worker | 不构建、不启动、不作为 Helix-beta 依赖 |
| XB-12 | 生产 NAS 部署 | 不因 Helix-beta 验收去改 NAS |
| XB-13 | 旧架构兼容 | 无 Kairox/Mirex dual-read/write/run |
| XB-14 | Person Preference 作为 Acceptance Rule | SSOT 已禁止；Helix-beta 不提前开放 |

## 6. 与 Movie Canary 车辆的关系

Helix-beta 的真实来源验收车辆是 Movie Canary：

| 角色 | 路径 |
| --- | --- |
| 不可变基线 | `F:\test_film` |
| 工作副本 / 同根 Field 与 Shelf Target | `F:\canary` |
| 禁止 | `Z:\Film`、`G:\canary_film`、NAS `192.168.12.230`、生产数据 |

操作清单与成功检查点仍见：

- `docs/helix/acceptance/MOVIE_CANARY_USER_UAT_CHECKLIST.md`
- `docs/helix/acceptance/MOVIE_CANARY_E2E_SUCCESS_EVALUATION.md`

口径修正（已确认，覆盖成功评估旧稿中「23 部都必须 On-deck」的过宽句子）：

- 形成 23/23（`养蜂人` 现成 MKV 与嵌套 BDMV 各一部 + ISO `倩女幽魂2` 一部）；
- 合同允许上架的都必须 On-deck；
- 其余只允许 HB-B.12 的合法五星冻结；
- 产品阻塞必须清零。

主检查点签字前不执行 Off-deck / Shelf 注销。G/H 作为第二阶段，或从 `F:\test_film` 另建 Canary。污染后的重建规则：先把 `F:\canary` 改名保留，再 `robocopy /E` 出新目录；禁止 `/MIR` `/MOVE` `/PURGE`。合法 On-deck 后与基线有 diff **不是**污染。

「生产 Canary 部署」与样本库 `F:\canary` 不是同一个词。

## 7. 验证方法与 Evidence

沿用既有代码：`UI` `API` `E2E` `MEDIA-S` `MEDIA-F` `PROVIDER` `FS` `PROBE` `RECOVERY` `NEG` `VISUAL` `AUDIT`，以及对应 `EV-*`。Helix-beta 的 `full_length` 代表执行仍适用于 5 星体积、4K raster、盘片 Remux/Transcode 与真实 Off-deck。

## 8. 作废声明

自 2026-08-22 起：

1. 四类媒体 Feature Matrix（F01–F21、P14-J01–J15 作为 **Beta DoD**）作废。
2. 「Movie 打通之后还要 Series → JAV → Western 才算 Beta」不再是 Helix-beta 门禁。那些 profile 是 SSOT 后续产品工作，另开范围。
3. 历史 checkpoint 里「未进入横向 Feature Matrix」只作施工史，不能再阻断 Movie 全链路验收。
4. 本文未把任何 `HB-*` 标为 `PASS`。实现进度见 `CURRENT_STATUS.md` 与 UAT 台账；Canary 真实验证仍按第 6 节车辆执行。
)
