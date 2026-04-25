# DESIGN_SERVICE/CONFIG — 配置与路径映射

> 状态：v2 定稿
> SSOT：配置字段定义以本文为准

---

## §1 配置模块职责边界

ConfigStore 持有所有 service 侧配置的单一来源。FlowExecutor 通过 `configStore.loadConfig()` 获取配置，不直接持有配置状态。

**配置分类**：

| 类别 | 所属 Flow/模块 |
|---|---|
| 任务调度 | TaskScheduler |
| 转码执行 | TranscodeFlowExecutor / TranscodeService |
| 升级洗版 | UpgradeFlowExecutor |
| Emby 连接 | EmbyService |
| 豆瓣集成 | DoubanService |
| 媒体库策略 | MediaLibraryService |

---

## §2 路径映射约定

### 2.1 已有映射

| 映射 | 说明 |
|---|---|
| `pathMapFrom` | Emby 服务端路径前缀 |
| `pathMapTo` | 本地/客户端可访问路径前缀 |

### 2.2 新增映射（UpgradeFlow）

| 映射 | 说明 |
|---|---|
| `upgradeStagingLocalPath` | ShelfDeck 视角的 staging 路径（MoviePilot Docker 容器内 staging 目录映射到宿主机路径） |

---

## §3 配置字段定义

### 3.1 任务调度（TaskScheduler）

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `executionMode` | `auto` \| `manual` | `auto` | `auto`：任务创建后直接入调度；`manual`：需用户调用 execute 才入调度 |
| `deleteConcurrency` | number | 1 | delete flow 最大并发数 |
| `transcodeConcurrency` | number | 1 | transcode flow 最大并发数 |
| `upgradeConcurrency` | number | 1 | upgrade flow 最大并发数 |
| `wallRatingAutoEnqueue` | boolean | `false` | 用户评分变更后是否自动入队转码任务 |

### 3.2 转码执行（TranscodeFlowExecutor / TranscodeService）

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `transcodeTempRoot` | string | `""` | 转码临时根目录（必填） |
| `transcodeReplaceConfirmRequired` | boolean | `false` | 是否需要替换前确认（true 时在 replace 阶段停泊等待用户 confirm，见 TRANSCODE_FLOW.md §3） |
| `ffmpegPath` | string | `"ffmpeg"` | FFmpeg 可执行文件路径 |
| `ffprobePath` | string | `"ffprobe"` | ffprobe 可执行文件路径 |

#### 3.2.1 设备池（transcodeEncodingDevices）

类型：数组，每个设备对象包含：

| 子字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `stableKey` | string | - | 设备稳定标识（如 `nvenc:0`、`cpu:libx265`），来自 `probeEncodeDevices()` 探测结果 |
| `inPool` | boolean | `false` | 是否入池 |
| `priority` | number | 100 | 优先级（数值越小越优先） |
| `maxSlots` | number | 1 | 该设备的并发槽位数 |
| `encoder` | string | `"hevc_nvenc"` | 编码器名称 |

#### 3.2.2 CPU 策略

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `transcodeMaxCpuSlots` | number | 1 | CPU 最大并发槽位数 |
| `transcodeCpuParticipationStrategy` | `normal` \| `backup_only` | `normal` | `normal`：CPU 参与分配；`backup_only`：仅 GPU，CPU 不参与 |

### 3.3 升级洗版（UpgradeFlowExecutor）

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `moviepilot.baseUrl` | string | `""` | MoviePilot 服务地址（如 `http://192.168.1.100:3000`） |
| `moviepilot.apiKey` | string | `""` | MoviePilot API Key |
| `moviepilotSavePath` | string | `""` | MoviePilot 容器内下载目录 |
| `moviepilotStagingPath` | string | `""` | MoviePilot 容器内 staging 目录 |
| `upgradeStagingLocalPath` | string | `""` | ShelfDeck 视角的 staging 路径（Docker 路径映射后的本地路径） |
| `upgradeRetryInterval` | number | 3600000 | `waiting_media_source` 状态重搜间隔（ms），默认 1 小时 |
| `upgradeMaxRetries` | number | 3 | 最大重试次数 |

### 3.4 Emby 服务器配置（EmbyService）

> v2 新增：支持多 Emby 服务器实例，替代原有的单一 `embyClient`。

#### 3.4.1 服务器注册表

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `embyServers` | object | `{}` | Emby 服务器 map，key 为内部 uuid |

**embyServers 子字段**：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `embyServers["<uuid>"].serverName` | string | `""` | Emby 服务器名称（来自 `GET /System/Info` 的 `ServerName`） |
| `embyServers["<uuid>"].baseUrl` | string | `""` | Emby 服务器地址（如 `http://192.168.1.100:8096`） |
| `embyServers["<uuid>"].apiKey` | string | `""` | Emby API Key |
| `embyServers["<uuid>"].userId` | string | `""` | Emby 用户 ID（来自用户列表选择） |
| `embyServers["<uuid>"].embyUserPassword` | string | `""` | Emby 用户密码（用于删除操作鉴权） |

#### 3.4.2 子库配置

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `subLibraries` | array | `[]` | 子库列表 |

**subLibraries 子字段**：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `subLibraries[<n>].uuid` | string | — | 子库唯一标识（内部 uuid） |
| `subLibraries[<n>].name` | string | `""` | 子库显示名称（用户自定义，默认用 Emby serverName） |
| `subLibraries[<n>].embyServerId` | string | `""` | 关联的 Emby 服务器 uuid |
| `subLibraries[<n>].sectionId` | string | `""` | Emby 媒体文件夹 ID（单选，对应 `Library/MediaFolders` 返回的 `Id`） |
| `subLibraries[<n>].source` | string | `"emby"` | 数据来源：`emby`（`local` 暂不支持） |
| `subLibraries[<n>].doubanEnabled` | boolean | `false` | 是否启用该子库的豆瓣评分同步 |
| `subLibraries[<n>].enabled` | boolean | `true` | 是否启用该子库（暂停/恢复同步） |
| `subLibraries[<n>].lastRefreshedAt` | string | null | 最近一次 Emby 拉取时间（ISO 8601） |
| `subLibraries[<n>].doubanSyncedAt` | string | null | 最近一次豆瓣同步时间（ISO 8601） |
| `subLibraries[<n>].mediaPolicy` | object | 见下文 | 该子库独立的码率策略（替代全局 mediaPolicy） |

**subLibraries[].mediaPolicy 默认值**：
```json
{
  "target1080p": { "2": 2, "3": 4, "4": 7, "5": 12 },
  "target4k": { "2": 5, "3": 10, "4": 16, "5": 25 }
}
```

> `embyServerId` 必须对应 `embyServers` 中已注册的服务器 uuid。

### 3.5 豆瓣集成（DoubanService）

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `douban.userId` | string | `""` | 豆瓣"看过"页用户 ID |
| `douban.cookieHeader` | string | `""` | 豆瓣登录 Cookie |

### 3.6 媒体库策略（MediaLibraryService）

> **已废弃**：码率策略已迁移至子库级（`subLibraries[].mediaPolicy`）。
> 全局 `mediaPolicy` 仅作兼容保留，新建子库时应使用子库级策略。

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `mediaPolicy.target1080p` | object | 见下文 | 1080p 各星级目标码率（Mbps） |
| `mediaPolicy.target4k` | object | 见下文 | 4K 各星级目标码率（Mbps） |

**target1080p 默认值**：`{ "2": 2, "3": 4, "4": 7, "5": 12 }`

**target4k 默认值**：`{ "2": 5, "3": 10, "4": 16, "5": 25 }`

---

## §4 配置持久化

- 存储位置：`data/config.json`
- 写入方式：通过 `PATCH /v1/config` API 更新，由 ConfigStore 持久化
- 读取方式：各模块通过 `configStore.loadConfig()` 获取

---

## §5 与 desktop 的配置交互

**原则**：service 配置集中在 service 端，desktop 只读。

| 配置项 | 存储位置 | 管理方 |
|---|---|---|
| TaskScheduler 配置 | service | service Web 管理页 |
| 转码执行配置 | service | service Web 管理页 |
| 升级洗版配置 | service | service Web 管理页 |
| Emby 连接配置 | service | service Web 管理页 |
| 豆瓣集成配置 | service | service Web 管理页 |
| 媒体库策略配置 | service | service Web 管理页 |
| desktop 本地配置（service 地址等） | desktop | desktop 设置面板 |

---

## §6 关联文档

- `SERVICE/TASK_SCHEDULER.md` — executionMode、concurrency、wallRatingAutoEnqueue 字段语义
- `SERVICE/TRANSCODE.md` — 设备池、CPU 策略字段语义
- `SERVICE/TRANSCODE_FLOW.md` — replaceConfirmRequired 行为、replace 阶段停泊语义
- `SERVICE/UPGRADE_FLOW.md` — MoviePilot 路径映射字段语义、waiting_media_source 停泊与重搜机制
- `SERVICE/MEDIA_LIBRARY.md` — 媒体库表结构与子库链路
- `SERVICE/ADMIN_WEB/API.md` — 各配置域对应的 Admin API 端点
