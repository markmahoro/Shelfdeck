# ARCH_SYSTEM_OVERVIEW — 媒体管理服务、OpenClaw 集成与「经典回顾」典范流程

> **SSOT 路径**：`[ARCH_SYSTEM_OVERVIEW.md](./ARCH_SYSTEM_OVERVIEW.md)` · 文档索引 `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`

> **文档目的**：固化三条战略方向——（1）前后端分离且后端优先支持 Windows 与飞牛 fnOS；（2）后端以 **MCP 工具** 为主、以 **Skill** 为辅对接 OpenClaw 等智能体；（3）将 **「经典回顾」** 定义为 **用户发起 → OpenClaw → 后端服务** 的标杆场景。  
> **读者**：产品/架构/后端/客户端实现者。  
> **非目标**：替代 `../project/PRJ_MANAGEMENT.md` 的里程碑表，也不替代 `../design/DESIGN_TASK_CENTER.md` 的可执行条文；本文描述 **目标态与接口形态**，具体任务状态机仍以任务中心 SSOT 为准。

---

## 1. 三条主线（摘要）


| #     | 方向              | 要点                                                                                                                                  |
| ----- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **架构前后端分离**     | 前端（Electron）负责观影与全功能 UI；后端（媒体管理服务）负责任务持久化、7×24 转码 Worker、Emby 批量操作、对外 API。**后端部署优先支持：Windows 原生/服务化 与 飞牛 fnOS 上 Docker（及 Compose）**。 |
| **2** | **Agent 可调用**   | 后端暴露 **MCP Server**（工具 = 可执行能力）；OpenClaw 等运行时通过 MCP 发现与调用。**Skill** 用于规定编排惯例（何时澄清、何时必须确认），不替代 MCP 工具。                               |
| **3** | **经典回顾 = 典范场景** | 用户在外部渠道（如微信）表达「想重温某部」→ OpenClaw 解析与澄清 → 调用后端 **对齐片库 + 写入重温队列（及可选后续动作）** → 前端「经典回顾」消费同一数据源。                                          |


---

## 2. 目标架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│  用户设备：Electron 客户端（全 UI：海报墙、经典回顾、媒体库、任务中心等）   │
│  — 播放：可直连 Emby 取 PlaybackInfo / 起播（低延迟，可配置）              │
│  — 业务读写：优先调用「媒体管理服务」HTTP API（配置、队列、重温、任务状态）    │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS / 内网
┌────────────────────────────▼────────────────────────────────────┐
│  媒体管理服务（后端）                                                  │
│  — REST/JSON API + 鉴权（API Key / 用户令牌）                        │
│  — MCP Server（同一进程或 Sidecar，共享认证与领域服务）               │
│  — 持久化：任务队列、重温队列、用户绑定、策略缓存等                      │
│  — 7×24 Worker：转码/洗版流水线（ffmpeg；GPU 按部署 profile）         │
│  — Emby Client：Items / UserData / 删除等（与现有逻辑对齐）            │
└──────┬───────────────────────────────┬────────────────────────────┘
       │                               │
       ▼                               ▼
┌──────────────┐                 ┌──────────────────┐
│  Emby Server │                 │ 可选：MoviePilot   │
│              │                 │ Webhook / HTTP API │
└──────────────┘                 └──────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  OpenClaw（及微信等通道适配插件）                                    │
│  — 对话、澄清、多轮确认                                              │
│  — 调用 MCP：媒体管理服务工具                                           │
└────────────────────────────┬────────────────────────────────────┘
                             │ MCP（stdio / SSE 等，依 OpenClaw 配置）
                             ▼
                    媒体管理服务 MCP Server
```

**原则**：片库与任务的 **权威状态** 在后端；前端不强制「另开浏览器」配置——所有设置仍在 Electron 内，通过 API 落库。

---

## 3. 前后端分离

### 3.1 前端（Electron）

- **保留**：现有信息架构能力（配置、海报墙、媒体库管理、任务中心、播放记录等）的 **界面与交互**。
- **可用性前提（产品一致口径）**：五页壳层业务体验以 **媒体管理服务可达** 为前提（`GET /v1/health`，详见 `[DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY.md](../design/DESIGN_DESKTOP_MEDIA_SERVICE_AVAILABILITY.md)` / `[REQ_FEATURE_desktop-requires-media-service.md](../requirements/REQ_FEATURE_desktop-requires-media-service.md)`）；与「渐进迁移 IPC→REST」不冲突——现迭代收紧的是 **用户何时可依赖本应用**，而非单条 API 归属。
- **演进**：将「任务持久化、调度决策、转码执行」从 **渲染进程 + IPC** 逐步迁移为 **调用媒体管理服务 API**；本机 IPC 收缩为 **播放相关**（`launchPlayer`、可选本地探测等）——**路径映射规则的权威在媒体管理服务**，见 **§3.4**。
- **经典回顾 Tab/页**：消费后端 `GET /revisit`（或等价）列表；与「未看」数据源解耦。

### 3.2 后端（媒体管理服务）

- **API 层**：配置、健康检查、片库搜索/摘要、重温 CRUD、任务入队与查询、Emby 同步触发等。
- **Worker 层**：从队列取任务，执行转码/替换/验收；支持并发上限与资源限制（CPU/GPU/IO）。
- **集成层**：MoviePilot、未来补源；Webhook 入口（鉴权 + 幂等）。
- **MCP 层**：工具实现 **调用与 REST 相同的应用服务**（禁止两套业务逻辑分叉）。
- **REST 契约（机器可读 SSOT）**：仓库内 `[../api/openapi.yaml](../api/openapi.yaml)`（索引、IPC→REST 对照与 lint 说明见 `[../api/API_README.md](../api/API_README.md)`）。具体路径、方法、鉴权与错误体以 OpenAPI 为准；本文仅描述战略分工，若与 OpenAPI 冲突则 **先修订 OpenAPI 与本文至一致再实现**。

### 3.3 部署：优先 Windows 与飞牛 fnOS

两种 **部署 profile**，**同一套容器镜像或同一套可执行产物 + 配置**，差异在 **进程管理、路径、GPU 透传**。


| 维度       | Windows（优先）                                                  | 飞牛 fnOS（优先）                                                                                                      |
| -------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **形态**   | 服务进程（如 Windows Service / NSSM）或 **Docker Desktop**（若团队统一用容器） | **Docker Compose** 为主                                                                                            |
| **配置**   | 环境变量 + 本地配置文件；数据目录可定 `D:\...\media-service-data`             | 环境变量 + 卷挂载（数据库、临时转码目录、日志）                                                                                        |
| **媒体路径** | 盘符、SMB 映射；需与 Emby 所见路径一致或可配置映射                               | 飞牛共享文件夹挂载进容器，与 Emby 一致                                                                                           |
| **GPU**  | NVIDIA/AMD 依本机驱动；若用 Docker on Windows 需 WSL2 + GPU 透传策略      | **NVIDIA**：宿主机驱动 + `nvidia-container-toolkit`，Compose 声明 GPU；**AMD 核显**：`/dev/dri` 等（需按机型与系统版本实测）；失败则 **CPU 兜底** |
| **发布物**  | 安装包或 zip + 说明；可选附带 `docker-compose.windows.yml`              | `docker-compose.yml` + 飞牛论坛可参考的 GPU 前置步骤链接（文档内说明）                                                                |


**说明**：「优先」指 **文档、测试矩阵与默认 Compose 先覆盖这两类环境**；不排斥后续泛化到其它 Linux NAS。

### 3.4 路径映射与配置 SSOT（产品约定）

Emby 与本地盘符/SMB/容器挂载 **不是同一套字符串**；若用户只在客户端配好「能起播放器」的映射，而媒体管理服务未配 **可读写的媒体路径规则**，会出现 **「能播但预检/转码/替换失败」**。采纳以下约定，避免两套互不同步的「暗映射」：


| 原则                   | 说明                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **配置权威在媒体管理服务**         | 媒体路径映射、`transcodeTempRoot` 等与 **读源、写临时、替换** 相关的项，以 **媒体管理服务持久化配置为唯一真相（SSOT）**。                                                                |
| **Electron 只做展示与编辑** | 设置页 **读写均经 API 落到媒体管理服务**；不在 `localStorage` 另存一套与 Worker 对打的映射真相。                                                                             |
| **UI 写清楚**           | 主配置区展示 **「媒体管理服务 / Worker 用」** 的映射（及临时目录等）；仅在 **媒体管理服务运行环境与用户桌面不一致**（如 Docker 在 NAS、桌面在 Windows）时，再展开 **可选的「本机播放附加映射」**，并与主表 **明确区分**，避免用户只配到一半。 |
| **预检与 Worker 同源**    | 转码预检、验收、替换路径解析 **与媒体管理服务使用同一套规则**；禁止客户端一套、服务端再硬编码一套导致行为分叉。                                                                                    |
| **实现上允许「两个解析函数」**    | 代码可有 `resolveForPlayback` 与 `resolveForWorker`，但输入须来自 **同一份已保存的配置**（或配置内 **命名清晰** 的两段），禁止隐式互相引用或重复真相。                                      |


---

## 4. OpenClaw 集成：MCP 与 Skill

### 4.1 分界


| 层级                  | 职责                                                                             | 载体                         |
| ------------------- | ------------------------------------------------------------------------------ | -------------------------- |
| **MCP Tools**       | **可执行、可审计** 的原子或高阶操作：查库、写入重温、入队洗版/压缩、查询任务状态等。描述与 JSON Schema 需 **自解释**，便于模型选型。 | 媒体管理服务 MCP Server           |
| **Skill（Playbook）** | **编排与话术**：如「用户说整理库 → 先 `summarize_library` → 再给方案 → 洗版前必须二次确认」。不实现业务写操作。       | OpenClaw 侧 Skill 文件 / 系统提示 |


### 4.2 MCP 工具（目标清单，名称可迭代）

下列为 **目标态** 能力分组，实现时可合并或拆分，但 **语义应保留**：

**片库与状态**

- `library_search`：按标题/模糊/类型搜索，返回 Emby `itemId`、标题、是否已看、策略摘要（若已有）。
- `library_summarize`：可选范围（库/类型）下的统计：待压缩、待洗版、重温队列长度等（供「整理库」澄清）。

**经典回顾**

- `revisit_add`：将指定 `itemId`（或高置信匹配结果）加入用户重温队列；幂等策略（已存在则更新 `source`/`updatedAt`）。
- `revisit_list` / `revisit_remove`：列表与移除。

**任务与治理**

- `task_enqueue_transcode` / `task_enqueue_wash` / `task_enqueue_delete`：入队；返回 `taskId`；危险操作需 `confirmed: true` 或独立 `confirm_token`（实现待定）。
- `task_status` / `task_list`：查询。

**解析辅助（可选）**

- `share_resolve`：接受用户粘贴的 URL 或短文本，返回 **候选标题列表 + 置信度**（内部可 HTTP 跟随短链，需注意频率与 ToS）；**最终以 `library_search` 为准**。

**认证**：每个工具调用携带 **用户上下文**（如 API Key 映射到 `userId` / Emby UserId），与 REST 使用同一 RBAC。

### 4.3 OpenClaw 侧前置

- 已配置与本媒体管理服务可达网络（内网/Tailscale）。
- 注册 MCP Server（如 `openclaw mcp add` 指向本服务启动命令）。
- Skill：为「经典回顾」「整理库」各写简短 Playbook，强调 **先工具后结论**、**洗版需确认**。

---

## 5. 「经典回顾」典范业务流程

**定义**：用户在外部动机下（例：刷到《无间道》切片）希望 **重温**；通过 **OpenClaw（微信等）** 与后端协作，**不写死**「必须打开桌面客户端粘贴」。

### 5.1 参与者与数据


| 参与者       | 职责             |
| --------- | -------------- |
| 用户        | 发起自然语言、分享链接或片名 |
| 微信（或其它通道） | 消息投递           |
| OpenClaw  | 澄清、多轮、调用 MCP   |
| 媒体管理服务     | 片库真相、写重温队列     |
| Electron  | 展示重温列表、一键播放    |


**核心数据对象**（逻辑模型）：

- `IngestEvent`：原始消息 id、渠道、文本/链接。
- `WorkCandidate`：解析出的片名候选 + 证据。
- `LibraryMatch`：`embyItemId`、匹配质量、策略快照（可选）。
- `RevisitEntry`：`userId`、`embyItemId`、`addedAt`、`source`（如 `openclaw:wechat`）、`note`（可选）。

### 5.2 主成功路径（Happy Path）

1. 用户在微信中对 Agent 说：「刚刷到无间道剪辑，帮我加进经典回顾。」
2. OpenClaw 若信息不足，追问年份或确认片名；若含抖音短链，可调用 `share_resolve` 再 `library_search`。
3. `library_search` 返回 1 条高置信匹配 → OpenClaw 简述并调用 `revisit_add(embyItemId, source=…)`。
4. 后端写入 `RevisitEntry`，返回成功。
5. 用户打开 Electron「经典回顾」→ 拉取列表 → **同一条目已出现** → 播放仍走 Emby + 本地播放器配置。

### 5.3 分支

- **多匹配**：OpenClaw 展示列表，用户回复序号后再 `revisit_add`。
- **无匹配**：返回「库中未找到」；可选 `task_enqueue_acquire` 或记录「找片意向」（与 MoviePilot 集成时再接）。
- **库中有但策略建议洗版**：OpenClaw 可读 `library_search` 附带的策略摘要，询问是否 `task_enqueue_wash`；**必须用户确认** 后入队。

### 5.4 非功能要求

- **幂等**：同一用户同一 `embyItemId` 重复 `revisit_add` 不产生重复脏数据。
- **审计**：记录 MCP 调用与结果摘要（便于排错与合规）。
- **超时与降级**：解析外链失败时退化为「请用户输入标准片名」。

---

## 6. 与现有仓库能力的关系

- **当前**：`media-desktop` 以 Electron 主进程 `embyService` + `preload` IPC 为主；任务与豆瓣等大量在渲染进程与 `localStorage`。
- **迁移策略**：引入 **领域服务层** 与 **单一后端真相**；新功能（重温队列、MCP）**优先后端实现**，前端改为 API 消费者。转码执行迁往媒体管理服务容器后，与「7×24」一致。
- **任务中心条文**：洗版/删除/转码状态名、Flow 与验收规则仍以 `../design/DESIGN_TASK_CENTER.md` 为 SSOT；后端实现应对齐该文档，避免双规格。
- **HTTP 接口条文**：与 Emby 无关的媒体管理服务自有 REST 以 `[../api/openapi.yaml](../api/openapi.yaml)` 为 SSOT（当前 Electron 发版仍以前端 IPC 为主，见 `[REQ_PRODUCT_BASELINE_v1.0.0.md](../requirements/REQ_PRODUCT_BASELINE_v1.0.0.md)` **工程实现快照**）。

### 6.1 Electron 桌面客户端（media-desktop）进程分层与现状（对照目标形态）

下列为 **Electron 桌面客户端** 与「目标形态」对照的摘要；与发版标签、时间线交叉验证见 `[PRJ_MANAGEMENT.md](../project/PRJ_MANAGEMENT.md)`。若与 `[DESIGN_TASK_CENTER.md](../design/DESIGN_TASK_CENTER.md)` 冲突，**以 DESIGN_TASK_CENTER 为行为规格**，以本节为 **桌面客户端落地说明**。

**目标形态（进程分层）**

- `renderer`：页面交互与轻状态，不执行重任务。
- `main`：调度中枢（队列、生命周期、托盘、恢复逻辑）。
- `worker`：后台执行（`transcode` Flow 的 FFmpeg 压制、`upgrade` Flow 的补源搜索与落盘校验等、任务刷新）；其中 **洗版** **不** 与 **高码率压缩** 共用同一套重编码资源池定义（见 DESIGN_TASK_CENTER **§2.4.1、§2.4.9（B10）**）。

**资源与壳层（目标）**

- 默认低并发（删除 / 转码 / 洗版 **各类** 至少可单独配置并发；常见起点如各 1 并发，以实现为准）。
- 观影会话活跃时自动降载/暂停高负载任务。
- 磁盘阈值保护：不足时禁止新任务启动。
- 关闭窗口默认行为：最小化到托盘（不退出）；托盘菜单：显示主窗口 / 开始批量执行 / 暂停队列 / 退出应用；只有显式“退出应用”才进入真正终止流程。

**截至 `package.json` `1.0.0-beta.9` 与目标形态之差**

- **无独立 `worker` 进程**：`transcode` Flow 的 FFmpeg/ffprobe 子进程与占槽逻辑在 `main`（`media-desktop/electron/transcodeService.js`）；`upgrade` Flow 仍主要为渲染进程调度占位，未接补源执行体。
- **队列与配置**：任务列表、调度 tick、`flowLog` 等以 **渲染进程**（React）为主；持久化依赖浏览器 `localStorage`，**非**主进程全量队列落盘（与上文「main 为调度中枢」之目标仍有差距）。
- **IPC**：`transcode:`*、`emby:`* 等由 preload 暴露至 `window.embyApi`；条文与状态机仍以 DESIGN_TASK_CENTER 为 SSOT。

---

## 7. 落地阶段建议（与本文档配套）


| 阶段     | 内容                                                                                       |
| ------ | ---------------------------------------------------------------------------------------- |
| **P0** | 媒体管理服务 MVP：鉴权、配置、Emby 只读搜索、重温队列 REST；Electron 只读展示重温（或双写过渡期）。                               |
| **P1** | MCP Server 与 P0 同源调用；OpenClaw 联调「经典回顾」主路径；转码 Worker 迁入媒体管理服务（飞牛 Compose + Windows profile）。 |
| **P2** | 任务入队全量迁后端；MoviePilot Webhook；Skill 丰富「整理库」与高阶批量工具。                                       |
| **P3** | 解析类工具 hardened、多通道、审计与运营工具。                                                              |


---

## 8. 追溯与关联文档


| 文档                                                                                 | 关系                              |
| ---------------------------------------------------------------------------------- | ------------------------------- |
| `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`                                        | 全库索引                            |
| `[ARCH_INTEGRATIONS.md](./ARCH_INTEGRATIONS.md)`                                   | Emby / 豆瓣 / MoviePilot / MCP 边界 |
| `[ARCH_DEPLOYMENT.md](./ARCH_DEPLOYMENT.md)`                                       | Windows / fnOS 部署               |
| `[REQ_PRODUCT_BASELINE_v1.0.0.md](../requirements/REQ_PRODUCT_BASELINE_v1.0.0.md)` | 需求母版                            |
| `[DESIGN_TASK_CENTER.md](../design/DESIGN_TASK_CENTER.md)`                         | 任务中心 SSOT                       |
| `[openapi.yaml](../api/openapi.yaml)`                                              | REST 契约                         |


---

## 9. 修订记录


| 日期         | 说明                                                           |
| ---------- | ------------------------------------------------------------ |
| 2026-04-20 | 增补 **§6.1** Electron 桌面客户端进程与队列现状；**§8** 追溯表（修订记录顺延为 **§9**）。 |
| 2026-04-19 | 初稿：基于前后端分离、Windows/fnOS 部署、MCP/Skill、经典回顾典范流程。               |


