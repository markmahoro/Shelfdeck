# DESIGN_CONFIG_FIELDS_REFERENCE — 配置字段参考（SSOT）

> **SSOT 路径**：`[DESIGN_CONFIG_FIELDS_REFERENCE.md](./DESIGN_CONFIG_FIELDS_REFERENCE.md)` · 文档索引 `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`

本文档是 **ShelfDeck 所有配置字段的单一事实来源（SSOT）**。所有配置字段的定义、类型、默认值、验证规则均以本文为准。其他文档（`DESIGN_CONFIG_AND_PATHS.md`、`DESIGN_FRONT_PLAYBACK.md`、`DESIGN_TASK_CENTER.md` 等）在提及配置字段时应引用本文档，而非重复定义。

---

## 配置归属与持久化

配置字段按持久化位置分为三类：

1. **媒体管理服务配置**：业务真相，由 `media-service` 持久化（如 `control-plane-state.json` 或等价存储）
2. **小助手配置**：仅 ShelfDeck 小助手使用的设置（如开机自启、退出行为）
3. **桌面客户端本地配置**：仅桌面使用的 UI 状态（如 `localStorage` 缓存）

**本文档主要覆盖第 1 类（媒体管理服务配置）**，这些配置通过桌面客户端的配置中心编辑，经 REST API（如 `GET/PATCH /v1/config`）写回媒体管理服务。

---

## 配置字段分类

### 1. ShelfDeck 媒体管理服务连接（小助手独占写入）

这些字段由 **ShelfDeck 小助手独占写入** 到共享连接文件，桌面客户端 **只读**。详见 `[DESIGN_DESKTOP_BACKEND_ENDPOINT.md](./DESIGN_DESKTOP_BACKEND_ENDPOINT.md)`。

| 字段名 | 类型 | 必填 | 默认值 | 说明 | 相关文档 |
|--------|------|------|--------|------|----------|
| `shelfdeck.mediaService.baseUrl` | string | 是 | - | ShelfDeck 媒体管理服务 HTTP 基址（无尾部 `/`），用于健康检查 `GET /v1/health` 及后续 REST 调用 | `DESIGN_DESKTOP_BACKEND_ENDPOINT` §2 |
| `shelfdeck.mediaService.apiKey` | string | 否 | - | 可选 API Key，对应 HTTP 请求头 `X-API-Key` | `DESIGN_DESKTOP_BACKEND_ENDPOINT` §2 |

**注意**：桌面客户端配置中心 **不包含** 这两个字段的编辑表单。用户必须在小助手中配置。

---

### 2. Emby 服务器连接与播放器

这些字段用于连接 Emby 服务器和配置第三方播放器。在桌面客户端的 **配置中心 → Emby 与播放器** 分区编辑。

| 字段名 | 类型 | 必填 | 默认值 | 说明 | 相关文档 |
|--------|------|------|--------|------|----------|
| `baseUrl` | string | 是 | - | Emby 服务器基址（如 `http://192.168.1.100:8096`） | `DESIGN_FRONT_PLAYBACK` §3.4 |
| `apiKey` | string | 是 | - | Emby API Key | `DESIGN_FRONT_PLAYBACK` §3.4 |
| `userId` | string | 是 | - | Emby 用户 ID（从用户列表选择，不手动输入） | `DESIGN_FRONT_PLAYBACK` §3.4 |
| `embyUserPassword` | string | 否 | - | Emby 用户会话密码，用于删除等写操作鉴权 | `DESIGN_TASK_CENTER` §4.5 |
| `enabledSectionIds` | string[] | 是 | `[]` | 启用的媒体库 Section ID 列表（用户勾选） | `DESIGN_FRONT_PLAYBACK` §3.4 |
| `playerExePath` | string | 是 | - | 第三方播放器可执行文件路径（如 PotPlayer） | `DESIGN_FRONT_PLAYBACK` §3.4 |
| `argsTemplate` | string | 是 | - | 播放器启动参数模板，支持 `{path}` 和 `{itemId}` 占位符 | `DESIGN_FRONT_PLAYBACK` §3.4 |

---

### 3. 路径映射

用于将 Emby 服务器路径映射到本机可读路径。在桌面客户端的 **配置中心 → Emby 与播放器** 分区编辑。

| 字段名 | 类型 | 必填 | 默认值 | 说明 | 相关文档 |
|--------|------|------|--------|------|----------|
| `pathMapFrom` | string | 否 | - | 源路径前缀（Emby 服务器路径，如 `/mnt/media`） | `DESIGN_CONFIG_AND_PATHS` §路径映射 |
| `pathMapTo` | string | 否 | - | 目标路径前缀（本机路径，如 `Z:\media`） | `DESIGN_CONFIG_AND_PATHS` §路径映射 |

**注意**：
- 路径映射权威以媒体管理服务持久化配置为 SSOT
- Playback / 预检 / 转码使用的本机可读路径均经此映射解析
- 媒体库列表刷新时结合映射解析本机路径，用于原盘类（ISO/BDMV）判定

---

### 4. 播放回写

控制何时将播放状态回写到 Emby 服务器。在桌面客户端的 **配置中心 → Emby 与播放器** 分区编辑。

| 字段名 | 类型 | 必填 | 默认值 | 说明 | 相关文档 |
|--------|------|------|--------|------|----------|
| `markPlayedThresholdPercent` | number | 否 | 90 | 播放进度百分比阈值，超过此值标记为已播放 | `DESIGN_FRONT_PLAYBACK` §3.4.2 |
| `fallbackMinSeconds` | number | 否 | - | 当总时长不可得时的兜底最小秒数 | `DESIGN_FRONT_PLAYBACK` §3.4.2 |

---

### 5. 任务调度与并发

控制任务中心的调度行为和并发限制。在桌面客户端的 **配置中心 → 任务调度与补源** 分区编辑。

| 字段名 | 类型 | 必填 | 默认值 | 说明 | 相关文档 |
|--------|------|------|--------|------|----------|
| `executionMode` | string | 是 | `"manual"` | 执行模式：`"manual"`（手动）或 `"auto"`（自动） | `DESIGN_TASK_CENTER` §7.2.1 |
| `deleteConcurrency` | number | 是 | 1 | 删除任务同时占类型任务槽的条数上限 | `DESIGN_TASK_CENTER` §7.2.2 |
| `transcodeConcurrency` | number | 是 | 1 | 转码任务类型任务槽上限（与各编码设备子槽独立，须同时满足） | `DESIGN_TASK_CENTER` §7.2.2 |
| `upgradeConcurrency` | number | 是 | 1 | 洗版任务同时占类型任务槽的条数上限（洗版不占转码编码设备子槽） | `DESIGN_TASK_CENTER` §7.2.2 |
| `wallRatingAutoEnqueue` | boolean | 是 | `false` | 海报墙确认已观看并完成打分后，是否按策略自动创建并入队任务 | `DESIGN_TASK_CENTER` §7.2.3 |

**执行模式说明**：
- `manual`：任务创建后处于 `pending_manual` 状态，需用户显式「执行」操作
- `auto`：任务创建后自动进入 `queued` 状态，按 FIFO 排队执行

---

### 6. 转码配置

转码任务的详细配置。在桌面客户端的 **配置中心 → 任务调度与补源 → 转码 Flow** 分区编辑。

| 字段名 | 类型 | 必填 | 默认值 | 说明 | 相关文档 |
|--------|------|------|--------|------|----------|
| `transcodeTempRoot` | string | 是 | - | 转码临时根目录，任务输出写在此目录下的每任务隔离子目录 | `DESIGN_TASK_CENTER` §5.2 |
| `transcodeReplaceConfirmRequired` | boolean | 否 | `false` | 替换前是否需要用户确认（默认关闭，校验通过后自动进入 replace） | `DESIGN_TASK_CENTER` §5.3 |
| `transcodeEncodingDevices` | object[] | 是 | `[]` | 编码资源池设备列表，每个设备包含：`deviceId`、`type`（如 `nvenc`/`qsv`/`cpu`）、`slots`（子槽数）、`priority`（优先级） | `DESIGN_TASK_CENTER` §5.1 |
| `transcodeCpuParticipationStrategy` | string | 是 | `"normal"` | CPU 参与策略：`"normal"`（CPU 正常参与池）或 `"backup"`（CPU 仅备用） | `DESIGN_TASK_CENTER` §5.1.2 |

**编码资源池说明**：
- 用户勾选参与池的每张显卡 / 核显 / CPU x265 等，不同后端、不同物理卡各为池中独立一条
- 每设备子槽数：该设备上同时允许几路并行压制
- 设备优先级顺序：占槽时从高到低尝试
- CPU 参与策略 1（normal）：CPU 逻辑设备与 GPU 一样按优先级排队
- CPU 参与策略 2（backup）：CPU 在池中，但只服务 `cpu_only` 任务

---

### 7. 洗版配置

洗版（upgrade）任务的配置。在桌面客户端的 **配置中心 → 任务调度与补源 → 洗版 Flow** 分区编辑。

| 字段名 | 类型 | 必填 | 默认值 | 说明 | 相关文档 |
|--------|------|------|--------|------|----------|
| `upgradeRetryInterval` | number | 否 | - | 洗版重试间隔（秒），用于 `waiting_media_source` 状态的重搜节奏 | `DESIGN_TASK_CENTER` §6.3 |
| `upgradeMaxRetries` | number | 否 | - | 洗版最大重试次数 | `DESIGN_TASK_CENTER` §6.3 |

---

### 8. 豆瓣集成

豆瓣个人评分抓取相关配置。在桌面客户端的 **配置中心** 相关分区编辑。

| 字段名 | 类型 | 必填 | 默认值 | 说明 | 相关文档 |
|--------|------|------|--------|------|----------|
| `douban.userId` | string | 否 | - | 豆瓣用户 ID | `DESIGN_LIBRARY_AND_QUEUE` §3.2 |
| `douban.cookieHeader` | string | 否 | - | 豆瓣会话 Cookie（主进程持久化到 `douban-session.json`） | `DESIGN_LIBRARY_AND_QUEUE` §3.2 |

**注意**：豆瓣会话由主进程写入应用 `userData` 下 `douban-session.json`，抓取结果写入 `localStorage` 键 `embyDesktopPlayerDoubanRatingEntriesV1`。

---

## 配置验证规则

### 必填字段验证

以下字段在保存配置时必须验证非空：
- Emby 连接：`baseUrl`、`apiKey`、`userId`、`enabledSectionIds`、`playerExePath`、`argsTemplate`
- 任务调度：`executionMode`、`deleteConcurrency`、`transcodeConcurrency`、`upgradeConcurrency`、`wallRatingAutoEnqueue`
- 转码：`transcodeTempRoot`、`transcodeEncodingDevices`、`transcodeCpuParticipationStrategy`

### 类型验证

- 数值字段（`markPlayedThresholdPercent`、`*Concurrency`、`*Slots`、`*Priority` 等）：必须为正整数
- 布尔字段（`wallRatingAutoEnqueue`、`transcodeReplaceConfirmRequired` 等）：必须为 `true` 或 `false`
- 枚举字段：
  - `executionMode`：只能是 `"manual"` 或 `"auto"`
  - `transcodeCpuParticipationStrategy`：只能是 `"normal"` 或 `"backup"`

### 业务逻辑验证

- 路径映射：`pathMapFrom` 和 `pathMapTo` 必须同时为空或同时非空
- 编码资源池：保存时须校验入池组合与 CPU 参与策略不自相矛盾（例如池内无任何可用 GPU 且 CPU 亦未入池）
- 并发数：`*Concurrency` 字段必须 >= 1

---

## 配置保存与反馈

配置保存的反馈通道、状态与 UI 槽位见 `[DESIGN_CONFIG_CENTER_SAVE_FEEDBACK.md](./DESIGN_CONFIG_CENTER_SAVE_FEEDBACK.md)`。

---

## 环境变量覆盖（开发用）

以下环境变量可在开发时覆盖配置（仅用于开发调试，不作为产品路径）：

| 环境变量 | 覆盖字段 | 说明 |
|----------|----------|------|
| `MEDIA_SERVICE_URL` / `CONTROL_PLANE_URL` | `shelfdeck.mediaService.baseUrl` | 媒体管理服务基址（同义变量） |
| `VITE_MEDIA_SERVICE_URL` / `VITE_CONTROL_PLANE_URL` | 同上 | Vite 渲染进程专用 |
| `MEDIA_SERVICE_API_KEY` / `CONTROL_PLANE_API_KEY` | `shelfdeck.mediaService.apiKey` | API Key（同义变量） |
| `VITE_MEDIA_SERVICE_API_KEY` / `VITE_CONTROL_PLANE_API_KEY` | 同上 | Vite 渲染进程专用 |

**优先级**：环境变量 > 小助手写入的持久化配置。详见 `[DESIGN_DESKTOP_BACKEND_ENDPOINT.md](./DESIGN_DESKTOP_BACKEND_ENDPOINT.md)` §3。

---

## 历史兼容性

以下名称为历史兼容保留，新代码应使用推荐名称：

| 历史名称 | 推荐名称 | 说明 |
|----------|----------|------|
| `CONTROL_PLANE_URL` | `MEDIA_SERVICE_URL` | 媒体管理服务基址 |
| `VITE_CONTROL_PLANE_URL` | `VITE_MEDIA_SERVICE_URL` | Vite 专用 |
| `CONTROL_PLANE_API_KEY` | `MEDIA_SERVICE_API_KEY` | API Key |
| `control-plane-state.json` | - | 媒体管理服务状态文件（历史文件名保留） |

---

## 追溯与关联文档

| 文档 | 关系 |
|------|------|
| `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)` | 文档治理与索引 |
| `[DESIGN_CONFIG_AND_PATHS.md](./DESIGN_CONFIG_AND_PATHS.md)` | 配置中心职责边界与索引（现改为引用本文） |
| `[DESIGN_FRONT_PLAYBACK.md](./DESIGN_FRONT_PLAYBACK.md)` | 前台播放闭环配置使用 |
| `[DESIGN_TASK_CENTER.md](./DESIGN_TASK_CENTER.md)` | 任务调度配置使用 |
| `[DESIGN_DESKTOP_BACKEND_ENDPOINT.md](./DESIGN_DESKTOP_BACKEND_ENDPOINT.md)` | 连接端点配置 |
| `[ARCH_SYSTEM_OVERVIEW.md](../architecture/ARCH_SYSTEM_OVERVIEW.md)` | 配置权威战略分工 |
| `[openapi.yaml](../api/openapi.yaml)` | REST API 契约 |
