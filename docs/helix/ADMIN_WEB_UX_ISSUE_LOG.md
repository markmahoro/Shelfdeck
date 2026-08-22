# Admin Web 用户体验问题台账

状态：`ADMIN WEB UX OVERHAUL IMPLEMENTED / UX-001/004/009/010/011/013/016 AND UAT-005/050–053/055–057 IMPLEMENTED / UAT-054,058 REMAIN OPEN`

建立日期：2026-08-22

审视范围：`media-service/web` 当前正式产品入口，即 `src/App.tsx` 接入的 Helix 八页：概览、文件来源、收藏架、我的收藏、媒体整理工作区、退出收藏、人物、系统设置。证据来自页面源码、样式、公开 Query/Projection 文案，以及本机 `127.0.0.1:18080` 健康接口与 `/admin` 入口确认服务可访问。本轮没有改代码、没有改 SSOT、没有动现场数据。

本文不是 Architecture SSOT，不替代 `CURRENT_PLAN.md` 或 `USER_ACCEPTANCE_TEST_ISSUE_LOG.md`。UAT 业务/执行缺陷继续记在原台账；本文只沉淀 Admin Web 的文案、排版、字体、按钮、前端拼装与美学问题。与 `UAT-005` 重叠的 Formation 信息架构缺口在此展开为全产品入口，不关闭也不改写该 UAT 项。2026-08-22 用户确认的后续改造以 `UAT-050`–`UAT-058` 为工作基线；其中 UI 可见部分与本文 `UX-001`、`UX-002`、`UX-003`、`UX-004`、`UX-006`、`UX-007`、`UX-008`、`UX-009`、`UX-010`、`UX-011`、`UX-013`、`UX-015`、`UX-016`、`UX-026`、`UX-028`、`UX-029` 交叉，不在此另开平行编号。

记录原则：

- 按用户可见结果分类，不以内部 Domain 名称分类；
- 文案问题必须能指出页面与源码位置；内部术语可以留在技术标识/诊断折叠里，不能作为一级界面语言；
- 不因页面“能用”而降级明显的可理解性或布局缺陷；
- 本文不授权实现、不改路由合同、不新增一级页面。

## 1. 分类

| 分类 | 含义 |
| --- | --- |
| `COPY_REDUNDANT` | 口号、空话、重复说明，对操作没有帮助 |
| `COPY_INTERNAL` | 把 ShelfDeck 内部对象、阶段、合同泄漏给用户 |
| `COPY_CONFLICT` | 文案含义与当前事实或页面能力冲突 |
| `LAYOUT` | 结构、栅格、溢出、未用尽空间、缺样式导致的排版混乱 |
| `TYPOGRAPHY` | 字体家族、字号、字重在同一信息层级不统一 |
| `BUTTON` | 按钮形态、尺寸、主次、危险操作样式不统一或不美观 |
| `PERFORMANCE` | 无页面 Projection 或前端多次拼装请求 |
| `AESTHETICS` | 整体视觉语言、气质与产品定位不匹配 |

## 2. 问题总览

| ID | 问题 | 分类 | 主要页面 | 严重度 | 状态 |
| --- | --- | --- | --- | --- | --- |
| UX-001 | 概览标题与导语是空话，不说明本页能做什么 | `COPY_REDUNDANT` | 概览 | High | 已实现 |
| UX-002 | 各页 eyebrow / 英文副标题 / 口号式 h1 重复导航语义 | `COPY_REDUNDANT` | 全站 | Medium | OPEN |
| UX-003 | 侧栏「收藏运营台」「本地 Projection」对用户无意义 | `COPY_REDUNDANT` | 全站导航 | Medium | OPEN |
| UX-004 | 文件来源把候选包、访问合同、Observation、Handoff A 当作主文案 | `COPY_INTERNAL` | 文件来源 | High | 已实现 |
| UX-005 | 收藏架/注销确认暴露 Routing、Material Control、On-deck 责任账 | `COPY_INTERNAL` | 收藏架 | High | OPEN |
| UX-006 | 我的收藏与健康详情使用 Shelf Entry / Deck / Evidence 内部口径 | `COPY_INTERNAL` | 我的收藏 | High | OPEN |
| UX-007 | 退出收藏把 Policy AST、Case、Reservation、原始 ID 直接铺开 | `COPY_INTERNAL` | 退出收藏 | Critical | OPEN |
| UX-008 | 设置页 Provider / Landing / revision / Event 术语未翻译 | `COPY_INTERNAL` | 系统设置 | Medium | OPEN |
| UX-009 | 已完成整理仍显示「尚未形成整理动作」 | `COPY_CONFLICT` | 媒体整理工作区 | Critical | 已实现 |
| UX-010 | 已完成行复用「下一步动作」列和进行中操作控件 | `COPY_CONFLICT` | 媒体整理工作区 | High | 已实现 |
| UX-011 | 人物页声称维护身份，实际只读且无操作 | `COPY_CONFLICT` | 人物 | High | 已实现 |
| UX-012 | 设置页承诺「空间、资源与安全」，实际只有连接和评分日志 | `COPY_CONFLICT` | 系统设置 | Medium | OPEN |
| UX-013 | 侧栏固定「正常运行」，与真实健康无关 | `COPY_CONFLICT` | 全站导航 | Medium | 已实现 |
| UX-014 | 评分日志仍指引用户去已更名的「上架进度」 | `COPY_CONFLICT` | 系统设置 | Low | OPEN |
| UX-015 | 退出收藏页卡片/行/危险阶段无样式，JSON 规则编辑器直出 | `LAYOUT` | 退出收藏 | Critical | OPEN |
| UX-016 | 媒体整理「当前媒体」九列表格未用尽横轴且内部横向溢出 | `LAYOUT` | 媒体整理工作区 | High | 已实现 |
| UX-017 | 四项整理统计塞进三列 `source-facts` 栅格 | `LAYOUT` | 媒体整理工作区 | Medium | OPEN |
| UX-018 | 收藏架注销确认框没有对话框样式 | `LAYOUT` | 收藏架 | High | OPEN |
| UX-019 | 收藏详情「退出收藏」区域与 `sr-only` 缺少样式 | `LAYOUT` | 我的收藏 / 整理 | Medium | OPEN |
| UX-020 | 登录会话在八页各自复制，文案和布局不一致 | `LAYOUT` | 全站 | Medium | OPEN |
| UX-021 | 两套 CSS 与一套废弃 `src/pages` 并存 | `LAYOUT` | 全站 | Medium | OPEN |
| UX-022 | 同页混用 Aptos / Inter / Georgia / 系统黑体，字号阶梯过碎 | `TYPOGRAPHY` | 全站 | High | OPEN |
| UX-023 | 中文 eyebrow 套英文 uppercase + 大字距，同一层级字号不稳 | `TYPOGRAPHY` | 全站 | Medium | OPEN |
| UX-024 | 按钮至少八种互不相干的形态 | `BUTTON` | 全站 | High | OPEN |
| UX-025 | 退出收藏与整理表内按钮退回浏览器默认样式 | `BUTTON` | 退出收藏 / 整理 | High | OPEN |
| UX-026 | 收藏墙逐张拉海报，详情再打健康与评分接口 | `PERFORMANCE` | 我的收藏 | High | OPEN |
| UX-027 | 文件来源按 Field 再打 Routing Policy，观察期间 1s 轮询整表 | `PERFORMANCE` | 文件来源 | High | OPEN |
| UX-028 | 设置页切到连接 Tab 仍拉取 100 条评分日志 | `PERFORMANCE` | 系统设置 | Medium | OPEN |
| UX-029 | 概览所谓 Projection 是请求内五路拼账 | `PERFORMANCE` | 概览 | High | OPEN |
| UX-030 | 退出收藏 3～4 路拼装，preparing 每 500ms 重拉 | `PERFORMANCE` | 退出收藏 | Medium | OPEN |
| UX-031 | Helix 页未使用已引入的 QueryClient，切页无共享缓存 | `PERFORMANCE` | 全站 | Medium | OPEN |
| UX-032 | 整体仍是「内部台账皮肤」，缺少统一的媒体产品视觉 | `AESTHETICS` | 全站 | High | OPEN |

## 3. `COPY_REDUNDANT`：冗余或非用户友好文案

### UX-001 概览标题与导语是空话

页面：概览。

用户打开管理台第一屏看到：

- eyebrow：`收藏维护账本`
- 标题：`你的收藏，正在被认真照料`
- 导语：`只看系统能否持续履职，以及 ShelfDeck 最近为收藏创造了什么价值。`
- 区块标题：`业务履历` / `当前可证明的进展`
- 底部：`危险操作只会在 fresh Projection 提供精确 Scope 后出现`

这些句子不回答「现在有多少收藏、有没有要处理的事、下一步该去哪」。标题在表演产品人格，导语在解释架构态度。真正有用的是下面四个数字，但数字附注仍然是内部口径。

证据：`media-service/web/src/helix/OverviewPage.tsx`；`surface-model.ts` 仍保留同一套演示文案。

建议：标题直接用「概览」或「收藏现状」；导语改成一句可验证的摘要，例如「当前正式收藏、本月新上架、需要你处理的事项」。删掉履职、照料、账本、Fresh Projection、精确 Scope。用户 2026-08-22 确认概览改为系统状态 + 可点待办 + 带片名的最近进展，**不与「我的收藏」合并**，不做第二面海报墙。见 `UAT-057`。

2026-08-22 实现：标题改为「概览」，导语说明系统状态、待办与最近上架；删除口号与旁页重复账本。证据见 `UAT-057` 与 `media-service/web/src/helix/OverviewPage.tsx`。本条随 UAT-057 关闭，不宣称 Canary 通过。

### UX-002 各页用口号式 h1 重复导航，不增加信息

| 导航 | 实际 h1 | 问题 |
| --- | --- | --- |
| 文件来源 | 先确认从哪里发现电影 | 把设置动作写成开场白 |
| 收藏架 | 先确定电影收藏最终应该成为什么样子 | 空泛，用户要的是「建一个收藏目录」 |
| 我的收藏 | 已经正式上架的 Shelf Entry | 口号 + 内部对象 |
| 退出收藏 | 审阅清楚，再执行不可逆退出 | 训诫语气，不是页面名 |
| 人物 | 维护人物身份，而不是改写媒体演职员事实 | 用否定句讲架构边界 |
| 系统设置 | 连接与可追溯记录 | 「可追溯记录」对用户无操作含义 |
| 媒体整理工作区 | 媒体整理工作区 | 相对最好，仍叠一层 eyebrow「媒体整理」 |

几乎每页都是 `eyebrow + 超大衬线标题 + 一段解释架构的 lede`。导航已经告诉用户在哪一页，h1 应是页面任务，不是年度报告封面。

证据：各 Helix 页面 header；`helix.css` 把 h1 设为 `clamp(34px,4vw,56px)` Georgia。

### UX-003 侧栏品牌区说「收藏运营台 / 本地 Projection」

`App.tsx` 侧栏：品牌副标题 `收藏运营台`，底部永远是 `正常运行` + `本地 Projection`。用户不需要知道自己在看 Projection，更不需要「运营台」这种内部工作名。底部状态若不接健康接口，就是装饰。用户 2026-08-22 确认侧栏顺序改为运营在上、配置在下（文件来源配置、收藏架配置、系统设置），见 `UAT-058`。

---

## 4. `COPY_INTERNAL`：内部运作机制泄漏

### UX-004 文件来源把 Procurement 流水线当作界面语言

`MaterialFieldsPage.tsx` 对用户可见的主文案包括：

- 状态：`候选包已准备好` / `候选包已被收藏生产接收` / `候选包未被接收` / `Triage尚未形成候选包` / `Procurement Run正在准备`
- 字段：`访问合同 revision N`、`开采规则 revision N`、`观察事实 revision N`
- 按钮旁说明：`观察严格停在 Candidate Package / Handoff A 待交付`
- 页脚：`保存后只建立 Material Field、Access revision 和 Extraction Policy revision`
- 行程条：`Run N 个；Candidate N 个；待交付 Offer N 个`，再跟 `candidatePackageId` 代码块
- 右侧标签：`Procurement`

用户在这一页要做的事是：指出电影目录、让系统去看、决定以后进哪座收藏架。他们不需要合同、revision、Handoff A 或 Offer。技术标识已有 `<details>`，主表面不应再重复。

建议用户语言：`等待扫描` / `正在扫描` / `已扫描完成`；绿框展示扫描进度，不要写 `已交给整理`。整理进度只去媒体整理工作区。访问合同改为「目录位置」或干脆不展示 revision。用户 2026-08-22 确认的完整合同见 `UAT-053`：周期 Observation 是 SSOT 已有义务，不是文案选择题；扫描完成后按钮应变为「扫描新文件」，仅进行中禁用。

2026-08-22 实现：来源页主表面改为上述三态与「扫描新文件」；绿框只写扫描页进度，不再渲染 Candidate / Handoff A。证据见 `UAT-053` 与 `media-service/web/src/helix/MaterialFieldsPage.tsx`。本条随 UAT-053 关闭，不宣称 Canary 通过。

### UX-005 收藏架把 Routing、Placement、责任账写进主界面

`ShelvesPage.tsx`：

- 摘要：`可成为Libra Routing目标`、`Target probe · Template binding`
- 列表：`Routing投影 revision`、`收藏标准 revision`、`可供Routing读取`
- 注销确认：`Primary`、`受控材料`、`On-deck / Off-deck / Aftercare / Reservation`、`释放精确 Material Control`、`Target Folder`

注销是危险操作，需要说清楚「文件不会被删、收藏记录会结束、不可恢复」。不需要把 Arca 责任账四项英文状态甩给用户。规则模板 ID、digest 应留在技术标识。

### UX-006 我的收藏详情是内部事实浏览器

`CollectionPage.tsx` / `collection.css`：

- 标题：`已经正式上架的 Shelf Entry`
- 导语：`海报上的检验章来自当前 Inventory、Standard 与 Placement 的 fresh Evidence`
- 空态：`健康结论只会基于当前 Shelf Entry Basis 显示`
- 详情 eyebrow：`Deck r{n}`
- 事实：`Inventory r{n}`、`身份来源 tmdb · 278`、原始 `status`
- 健康三维：保管/呈现/合规的状态直接渲染 `never_assessed` 等英文枚举
- 发现：`{findingKind} · {repairability}`
- 页脚：`Inventory r · Standard r · Placement r`

海报墙本身是对的。点开后应看到片名、评分、是否健康、能否退出。revision、Basis、Evidence、findingKind 不是用户语言。检验章 `◆` 也没有图例，六个筛选要靠猜。用户 2026-08-22 确认一级导航改为按收藏架（保留「全部」），详情第一批补占用空间、主视频体积/容器、编码与清晰度、海报/NFO 是否齐全，见 `UAT-052`。

### UX-007 退出收藏是内部安全链控制台

`OffdeckPage.tsx` 几乎没有用户语言层：

- 导语：`推荐和直接退出共用同一条 Reservation、Scope 与 Authorization 安全链`
- 规则：`保存并发布revision`、`Entry Policy`、`Rule ID`、`Shelf IDs（逗号分隔）`、`Closed Condition AST（支持all / any）`，条件是原始 JSON
- 建议列表：标题是 `shelf_entry_id` / `duplicate_group_id`，不是片名
- 审阅标题直接渲染 `review.state`（`open` / `preparing` / `selection_confirmed` 等）
- 范围：`N 个 Physical Material`、`role · location · deleteCondition`
- 进度：`{shelfEntryId}` + `{state} · recovery revision {n}` + `重新授权同一Case`

这是本轮最严重的内部机制泄漏。用户要的是：哪些片子建议退出、重复的两部留哪部、删除前确认文件和大小、授权后看到进度。规则编辑如果必须保留，也该是「评分≤2 且收藏超过 1 年」这类表单，不是 AST JSON。用户 2026-08-22 确认按任务重排页面、主按钮用用户语言，不重做销毁主链；「不喜欢的人物」在人物偏好入口可用前不作为可加规则。见 `UAT-054`。

### UX-008 设置页未翻译集成与执行术语

豆瓣/TMDB/MoviePilot 区块 eyebrow 分别为 `User Perception Provider`、`Identity, Metadata & Artwork Provider`、`External Acquisition Provider`。已连接态还展示 `配置 revision`、`Binding revision`、`Landing 与 Libra Workspace`、`等待身份输入的Event`。评分日志列 `recordKind`、`resolutionStatus`、`subject · {id}`。连接表单本身可以技术化，但一级标题和表格单元格应使用「豆瓣 / 电影资料 / 自动寻源」「已匹配 / 未匹配」。

同属此类、穿插在其他页：

- 整理表「下一步动作」旁的 `item.nextAction.state` 原样输出 `completed` / `frozen` / `pending`；执行异常输出 `phase`、`errorCode`、`责任方`、`恢复代际`。
- 分拣策略：`direct · revision N`、`预览Facts（高级诊断）` JSON、发布成功 `Policy revision N 已发布`。
- 概览数字附注：`active Shelf Entry`、`已完成 On-deck Commit`、`具有 fresh 健康结论`。

---

## 5. `COPY_CONFLICT`：文案与实际情况冲突

### UX-009 已完成整理仍写「尚未形成整理动作」

用户点名的冲突。整理表有「整理动作」列，完成区与当前区共用 `MediaTable`，列值来自 Projection 的 `organizingAction`。

根因在 `formation-query.js`：

1. `actionLabel(works)` 在没有匹配到转码/Remux/资料/验证 capability 时返回 `尚未形成整理动作`；
2. `works` 只从 `active | suspended | frozen` 的当前 Run 读取；
3. 已完成条目的当前 Run 为空，于是 `works=[]`，完成结果一律落到默认句。

用户看到的是：这部已经在收藏架上，动作却是「尚未形成」。完成区应写实际做过的事。用户 2026-08-22 确认不再用一句概括，而用步骤清单（含「怎么转」），见 `UAT-051`。这是展示翻译缺陷，不是业务事实缺失；修复应落在 Formation 公开 Projection 的完成态动作，而不是让前端猜。

2026-08-22 实现：完成区读已完成 Run 的 `organizingSteps[]`，空计划写「正在评估整理方案」，禁止「尚未形成整理动作」。证据见 `UAT-051` 与 `media-service/web/src/helix/FormationPage.tsx`。本条随 UAT-051 关闭，不宣称 Canary 通过。

### UX-010 完成区仍使用「下一步动作」和进行中控件

`nextAction` 在 `classification === 'completed'` 时为 `已进入收藏架`，列名却仍是「下一步动作」，单元格还可能渲染评分、选架、加快、放弃。完成历史应是只读结果：完成时间、做了什么、进了哪座架。进行中列名和按钮不应出现在完成区。用户 2026-08-22 确认当前表拆成整理动作 / 分步进度条 / 用户操作 / 加急四列，见 `UAT-051`；当前媒体筛选见 `UAT-050`。

2026-08-22 实现：完成区只读整理动作、目标架与完成时间；加快/放弃/选架留在当前表的用户操作与加急列。证据见 `UAT-051`。本条随 UAT-051 关闭，不宣称 Canary 通过。

### UX-011 人物页能力声明与页面事实冲突

标题要求用户「维护人物身份」，导语提到 Preference 与 Reference Image，摘要有「注册候选 / 合并候选」。页面没有注册、确认、合并、参考图，也没有写命令。UAT-007 已去掉无效注册按钮，但文案还在假装这是工作台。当前诚实说法是「人物名录（只读）」；做不到的能力不要写在 h1。用户 2026-08-22 确认要接通 Beta 两条登记路径（直接注册 + On-deck 发现），名录改为可确认候选的小工作台，不是把收藏详情演职员复制进名录。见 `UAT-055`。

2026-08-22 实现：人物页改为已登记 / 待确认（接受或忽略）/ 登记一个人；文案写明名录不是演员表。证据见 `UAT-055` 与 `media-service/web/src/helix/PeoplePage.tsx`。本条随 UAT-055 关闭，不宣称 Canary 通过。

### UX-012 设置页范围小于它自己的承诺

`surface-model.ts` 仍写：`连接、空间、资源与安全`，以及工作区互不重叠、运行强度。正式 `SettingsPage` 只有「连接与集成」和「评分日志」。空间探测、计算设备、运行强度入口不存在。用户若从旧文案或架构叙述进来会以为漏了设置。

### UX-013 侧栏「正常运行」不反映系统状态

`App.tsx` 把 `正常运行` 写死。服务 faulted、Projection stale、Formation rebuilding 时侧栏仍绿灯。概览也没有接健康接口。状态灯要么接 `GET /v1/health` 的公开结论，要么不要装成运行监视。

2026-08-22 实现：侧栏与概览共用 Overview `systemState` 三态（尚未配置 / 正常运行 / 系统故障）；需要处理不算系统故障。证据见 `UAT-057` 与 `media-service/web/src/App.tsx`。本条随 UAT-057 关闭，不宣称 Canary 通过。

### UX-014 评分日志指向已更名页面

空态：`请在上架进度或我的收藏中评分`。正式导航已是「媒体整理工作区」。这是过期产品名，会把用户带到不存在的入口。

其它冲突：

- 健康三维把 `never_assessed` 直接显示，筛选标签却是「尚未检查」。
- 收藏详情 `当前Package没有提供剧情简介`：用户看到的是一部电影，不是 Package。
- 文件来源/收藏架第三指标写死 `当前里程碑 · Movie`，这是开发阶段标记，不是用户指标。
- `surface-model.ts` 仍含 2,430 / 416 等演示数字；正式页已改走 API，但通用 `HelixPage` 仍会渲染假数据。

---

## 6. `LAYOUT`：排版混乱

### UX-015 退出收藏页几乎没有版面契约

`OffdeckPage` 使用 `source-card`、`source-card-heading`、`source-row`、`danger-stage`、`form-grid`。`helix.css` 与 `collection.css` 都不定义前三类。结果是：

- 规则、建议、审阅、进度四段没有卡片边界、间距或标题层级；
- 每条规则是 Rule ID + Shelf 范围 + 七行 JSON textarea +「移除规则」挤在一起；
- 底栏六个动作（低评分、不喜欢的人物、长期健康问题、收藏保留时间、立即评估、检测重复）横排换行，没有主次；
- 重复组成员只列出 UUID；
- 高量确认与普通按钮视觉权重不够。

这就是用户说的「退出收藏页面排版混乱」。根因是页面按内部安全链堆了控件，却没有为这些 class 写布局。

### UX-016 媒体整理「当前媒体」没有用尽横轴

用户点名的问题。约束叠在一起：

- `.helix-main` 左右 `clamp(28px, 5vw, 76px)`；
- `.source-page` `max-width: 1320px`，宽屏右侧留空；
- `.formation-table td { min-width: 128px }`，首列 `300px`，九列最小约 1324px，刚好大于容器，出现横向滚动；
- 真正要看的「整理动作 / 下一步」被挤到表外，需要左右拖。

宽屏浪费空白，窄于 1320 的内容区又滚动。当前媒体应改成「主列用尽可用宽度、次要列可收起」的工作台：片名+状态占满左侧，动作固定在右侧，评分/要求/时间进入次级或详情，而不是九列强制等宽。

2026-08-22 实现：当前表改为媒体名称 + 整理动作 / 分步进度 / 用户操作 / 加急；步骤在单元格内纵向堆叠，评分/架/要求收入名称列，工作区 `max-width: none`。证据见 `UAT-051` 与 `media-service/web/src/helix/helix.css`。本条随 UAT-051 关闭，不宣称 Canary 通过。

### UX-017 四项统计放进三列栅格

整理页顶部待整理 / 整理中 / 需要处理 / 已完成 四个数字，用的是 `.source-facts { grid-template-columns: repeat(3, ...) }`。第四项掉到下一行，和文件来源三指标的版面不一致。概览用的是四列 `metric-strip`，同一产品两种摘要栅格。

### UX-018 收藏架注销确认不是对话框

`role="dialog"` 的 `source-confirm` 没有对应 CSS：无遮罩、无居中、无最大宽度。确认块渲染在列表底部，可与页面一起滚动，危险确认缺少模态约束。字段来源注销用了页内 `source-stop-confirm`，两套危险确认交互还不一致。

### UX-019 收藏详情退出区与隐藏标签缺样式

`collection-exit` 在 `CollectionPage` 使用，`collection.css` 未定义。退出按钮落到详情流里的默认按钮，和「立即检查健康」不齐。`FormationPage` 使用 `sr-only`，全站 CSS 未定义，TMDB ID 标签可能露在表内或失去无障碍隐藏。

### UX-020 八页各自复制登录与页头

每个页面自己做 `checking | required | ready`、自己画一份登录卡、自己写「正在读取…」。登录标题从「查看收藏概览」到「打开你的收藏运营台」不等；有的登录无说明，有的解释 clean initialization。刷新按钮有的在 header，有的在 registry heading，有的没有。缺少统一壳层：一次会话、一个页头槽位、一个错误槽位。

### UX-021 双重样式与废弃页面

`main.tsx` 先加载 `styles/theme.css`（Inter、旧 `.app-shell` / `.btn`），`App.tsx` 再加载 `helix.css`（Aptos、Georgia、铜绿）。旧 `src/pages/*` 与 `Sidebar.tsx` 不在路由里，仍进入工程体积与心智负担。Helix 页误用 `form-grid` 时会吃到旧主题栅格，和 `source-form-grid` 并存。

其它布局：

- 整理「下一步」列把进度条、身份候选、加快、放弃、重试堆进一个 `td`；
- 文件来源卡片在 2 列主区 + 220px 动作列后再插入分拣策略和 code，窄屏会折成很长的一列；
- 收藏筛选是两行 pill，与海报墙之间没有稳定的工具条；
- 侧栏 Helix 导航在 `<=800px` 变成横向滚动，旧 theme 的 900/1279 断点不作用于它。

---

## 7. `TYPOGRAPHY`：字体与字号

### UX-022 至少三套字体家族同时在线

| 来源 | 字体 |
| --- | --- |
| `theme.css` `:root` | Inter, Noto Sans SC, Microsoft YaHei UI |
| `helix.css` `:root` | Aptos, Noto Sans SC, Microsoft YaHei UI |
| 标题 / 指标 / 表内片名 | Georgia, Noto Serif SC |
| 路径、digest、健康状态 | ui-monospace / Consolas |
| 品牌标记 `SD` | Georgia 13px |

用户要求尽量一种字体。现状是无衬线 + 衬线 + 等宽，而且 Aptos 在多数 Windows 中文环境和 Docker 浏览器里不存在，会跳到 Noto/雅黑；Inter 又在 theme 里抢一次。中文大标题用 Georgia 再 fallback 到 Noto Serif SC，和正文黑体不是同一骨架。

### UX-023 同一信息层级字号过碎

仅 Helix 样式里出现的字号大约有：9、10、11、12、13、14、15、16、17、18、22、24、28、30、34，以及 h1 的 40–58。字重有 500、650、700、720、730、750、800。eyebrow 还对中文使用 `letter-spacing: .16em; text-transform: uppercase`，中文被拉开，英文才像标签。

同一层级的典型冲突：表头 10px uppercase、单元格 13px、片名 18px Georgia、动作说明 11px、错误 10px。人物摘要 `active Person` 是 12px muted，与「已注册人物」中文标签不等价。

建议收成四级即可：页面标题、区块标题、正文、说明。不要为每个新区块发明一个 px。

---

## 8. `BUTTON`：按钮不统一且不美观

### UX-024 现货按钮形态

| 形态 | 出现位置 |
| --- | --- |
| 铜底白字 `.surface-action` | 多数页头刷新/展开 |
| 透明描边 registry 按钮 | 文件来源/收藏架「刷新」 |
| `.source-stop` 幽灵按钮 | 注销来源 |
| `.source-danger` 红底 | 确认注销 |
| `.text-action` 文字链 | 分拣规则上移/删除 |
| 虚线 `.routing-add-rule` | 添加分拣规则 |
| pill `.health-filters` | 收藏筛选 |
| `.danger-quiet` | 断开集成 |
| 无 class 的原生 `<button>` | 退出收藏几乎全部动作、整理表内「选择/验证」 |
| 圆形关闭 | 收藏详情 |

没有主按钮 / 次按钮 / 危险按钮 / 文字按钮的统一尺度。圆角 4px、5px、8px、999px 混用。主操作有时是铜底，有时是白底铜边，有时是浏览器默认灰按钮。

### UX-025 关键流程退回默认按钮

退出收藏的「进入审阅 / 继续保留 / 授权并开始退出 / 保存并发布revision」都是未皮肤化的 `<button>`。整理表内「选择」「验证此身份」同样。这些是产品里最重的操作，视觉却最弱。危险操作「授权并开始退出」只有一个未定义的 `danger` class，样式不确定。

建议：全站只保留四种按钮，高度 36 或 40 二选一，主色一处定义。表内动作用同一小号，不要再在单元格里塞 `.surface-action`（44px 高度）。

---

## 9. `PERFORMANCE`：无页面 Projection、前端拼装

Formation 已有 durable `libra_formation_projections`，这是正确方向。其它页仍在用「打开页面 → 打多个 Owner Query → 浏览器拼画面」。`@tanstack/react-query` 已进 `package.json` 且在 `main.tsx` 包了 `QueryClientProvider`，Helix 八页完全不用，每页 `useCallback + useEffect` 自己 fetch。

### UX-026 我的收藏：列表 + N 张海报 + 详情二次请求

`listCollection()` 一次取回全部条目，前端再按当前/历史和健康筛选。每张有海报的片子再请求 `GET /v1/admin/collection/:id/poster`。点开详情：`getCare`；收藏评分控件没有 initialRating，再打 `listPerceptionRecords`。墙面规模上去后，这是典型的「一个列表页打出 N+2 类请求」。缺少：服务端筛选/分页的收藏墙 Projection、有界海报（或雪碧/定宽衍生）、详情健康字段随列表走。

### UX-027 文件来源：Field 列表 × Routing Policy，外加 1 秒整表刷新

`listMaterialFields` + `listShelves` 之后，每个活动来源的 `RoutingPolicyPanel` 再 `getRoutingPolicy(fieldId)`。观察开始后 `setInterval(loadFields, 1000)` 重拉整表。来源数一多就是 N+1；观察期间则是每秒全量。应有「来源登记簿」Projection：来源、扫描状态、当前分拣策略摘要一行返回；观察进度用单条状态或短轮询，不要重拉全部 Field。

### UX-028 设置页无论当前 Tab 都拉评分日志

`load` 固定并行：豆瓣、TMDB、MoviePilot、`listPerceptionRecords({limit:100})`。用户只看连接时也会拉 100 条评分。筛选变化再整组重跑。评分日志应在进入该 Tab 时再请求，或由独立 Projection 提供。

### UX-029 概览 Projection 名不副实

`overview-query.js` 在一次 GET 里同步调用 Field、Shelf、Formation、Collection、Offdeck 五条读模型再聚合。对前端是一个请求，对后端仍是请求内拼账，不是 Formation 那种按 Subject 持久化、可脏可重建的 Projection。收藏和健康变了，概览要重扫公开列表。数字一多，概览会变成最贵的只读页。

### UX-030 退出收藏四路拼装 + 500ms 轮询

打开页：`getOffdeckPolicy` + `listOffdeckCandidates` + `listOffdeckCases`，URL 带 review 时再 `getOffdeckReview`。`review.state === 'preparing'` 时每 500ms 拉整份 review。每次任意按钮成功后再 `load()` 全量刷新。应有「退出工作台」Projection：建议（含片名）、当前审阅、进行中案件，preparing 只推进度字段。

### UX-031 无共享会话与缓存

切页会重复 401/重试；Formation 已有 `targetShelfName` 仍每次 `listShelves`；评分提交后 30 秒内 300ms 轮询 perception records。`QueryClient` 空转。最低限度也应有会话壳和按路由的 staleTime；页面级仍应优先后端 Projection，而不是把拼账搬进 react-query。

其它：

- 人物 `limit:50` 无搜索、无下一页按钮，但 API 有 cursor。
- 收藏海报 URL 无尺寸参数，详情和缩略图打同一资源。
- 整理完成/历史展开会再打独立 section，这是对的；当前区刷新却会在展开时顺带重拉完成与历史。

---

## 10. `AESTHETICS`：整体美学（建议，可自由取舍）

当前视觉是「铜绿衬线年鉴」套在「领域对象台账」上：大 Georgia 标题、薄荷纸面、侧栏深青绿、内容却是 revision 和 UUID。气质和信息层级打架，所以会显得既正式又临时。

建议方向：把 Admin Web 收成一个克制的中文媒体管理台，而不是架构说明书，也不是杂志封面。

1. **一种无衬线中文黑体走完全站。** 推荐 `Noto Sans SC` + 系统 UI。取消 Georgia/Aptos/Inter 三套并存。数字可用 `tabular-nums`，不要换家族。等宽只用于用户主动展开的路径/ID。
2. **把「海报墙」当视觉中心，其它页当工具。** 「我的收藏」已经最接近产品；概览不要再做封面诗，做成收藏墙的缩小状态 + 待办。整理工作区应像工单台：密、清楚、横向用满，而不是年鉴表格。
3. **标题降一档。** 页面标题 22–28px 即可，与导航字重连续。删掉 uppercase 英文 eyebrow；若需要分组，用 12px muted 中文小节名。
4. **色板收成四色。** 墨色文字、一条品牌强调色、成功绿、危险红。铜橙和青绿同时做品牌会让筛选 pill、检验章、主按钮各画各的。检验章改用语义色 + 简短文字，不要单独一个 `◆`。
5. **八页共用一个壳。** 左导航（现有深色栏可以留）、顶栏只放页面名和主操作、内容区默认用满主栏宽度。登录只做一次。
6. **导航用图标+中文，不用几何符号。** `◈ ⌁ ▤ ▦ ⇢ ⌫ ◎ ⚙` 不能扫读。图标尺寸 20px，选中态一条强调色即可，不必 inset 铜条再加字色变化。
7. **空状态要能行动。** 「还没有文件来源」应直接带「添加电影目录」；「还没有收藏」应指向整理工作区。不要再用内部口径解释为什么是空的。
8. **允许技术折叠，但默认隐藏。** 每条来源/收藏架底部的 `<details>技术标识</details>` 是对的，应推广：digest、revision、AST、Case ID 都进这里。默认屏幕只留用户决策。
9. **动效减少。** 全页 `arrive` 8px 上移对工作台无帮助；海报 hover 抬起可以留，表格行不要再做杂志式阴影。
10. **不要把未完成能力画成产品。** 人物、空间资源、运行强度要么做完，要么从导航文案里拿掉。半完成的只读名录可以留在设置里，不必占一级导航。

一句话：用收藏海报和整理进度当产品脸，用一种字体、四种按钮、一个壳把八页收口；内部机制只出现在用户点「详细信息」之后。

## 11. 建议修复顺序（不授权开工）

在用户明确授权实现之前，建议按用户能感知的伤害排序，而不是按 Domain：

1. 文案层：去掉口号与内部术语，先改概览、文件来源、退出收藏、已完成整理动作（UX-001/004/007/009）。完成态动作属于公开 Projection 翻译，需 Libra 只读查询配合。
2. 退出收藏与整理表布局（UX-015/016/017/025）：补样式、改工作台栅格、统一按钮。
3. 字体与按钮系统（UX-022/024）：先停掉 theme.css 对 Helix 的污染，收字号阶梯。
4. 页面 Projection（UX-026～030）：收藏墙、来源登记簿、概览、退出工作台；禁止前端 N+1。
5. 美学收口（UX-032）：在前四项之后做，避免先换皮肤后改信息架构。

与已有 UAT 的关系：`UAT-005` 与 `UAT-051` 的 Formation 信息架构代码已落地（四桶 + organizingSteps）；本文 UX-009/010/016 随 UAT-051 关闭。其它条目不是 UAT 回归失败，而是全产品入口的独立 UX 债。
