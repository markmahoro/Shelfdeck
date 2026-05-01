# DESIGN_SERVICE/CONFIG — 配置与路径映射

> 状态：v4 定稿
> SSOT：配置字段定义以本文为准

---

## §1 配置模块职责边界

ConfigStore 持有所有 service 侧配置的单一来源。FlowExecutor 通过 `configStore.loadConfig()` 获取配置，不直接持有配置状态。

**配置分类**：

| 类别 | 所属 Flow/模块 |
|---|---|
| 任务调度 | TaskScheduler |
| 智能入队 | SmartTaskEngine |
| 策略计算 | StrategyEngine |
| 转码执行 | TranscodeFlowExecutor / TranscodeService |
| 升级洗版 | UpgradeFlowExecutor |
| Emby 连接 | EmbyService |
| 豆瓣集成 | DoubanService |
| 服务认证 | API 层 |

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
| `executionMode` | `auto` \| `manual` | `auto` | 兼容保留。调度决策已迁移到 per-subLibrary `scheduleMode.autoExecute` |
| `deleteConcurrency` | number | 1 | delete flow 最大并发数 |
| `transcodeConcurrency` | number | 1 | transcode flow 最大并发数 |
| `upgradeConcurrency` | number | 1 | upgrade flow 最大并发数 |
| `wallRatingAutoEnqueue` | boolean | `false` | 兼容保留。自动入队已迁移到 per-subLibrary `scheduleMode.autoCreate` |

### 3.2 智能入队（SmartTaskEngine）

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `smartTaskPollIntervalMinutes` | number | 10 | 轮询间隔（分钟） |
| `smartTaskMaxPerRun` | number | 10 | 每次最多创建任务数 |
| `smartTaskMaxQueueSize` | number | 50 | 最大队列容量（预留，当前代码未读取） |
| `smartTaskEnabledActions` | string[] | `["transcode", "upgrade"]` | 允许自动入队的 action 类型（默认排除 delete） |
| `smartTaskLookbackDays` | number | 30 | 首次/恢复运行的回看天数 |

### 3.3 策略计算（StrategyEngine）

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `strategyPollIntervalMinutes` | number | 30 | 策略计算间隔（分钟） |
| `ruleTemplates` | array | `[defaultTemplate]` | 规则模板列表，每个子库通过 `ruleTemplateId` 引用 |

`ruleTemplates` 数组元素结构：

| 子字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 模板唯一标识（`"default"` 为内置默认模板） |
| `name` | string | 模板名称 |
| `description` | string | 模板描述 |
| `rules` | array | 规则列表（见 `STRATEGY_ENGINE.md` §2.1） |

> `mediaPolicy` 字段已完全废弃。v2→v3 迁移时删除，由 `ruleTemplates` 替代。详见 §7 配置版本迁移。

### 3.4 转码执行（TranscodeFlowExecutor / TranscodeService）

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `transcodeTempRoot` | string | `""` | 转码临时根目录（必填） |
| `transcodeReplaceConfirmRequired` | boolean | `false` | 兼容保留。替换确认已迁移到 per-subLibrary `scheduleMode.autoReplaceTranscode` |
| `ffmpegPath` | string | `"ffmpeg"` | FFmpeg 可执行文件路径 |
| `ffprobePath` | string | `"ffprobe"` | ffprobe 可执行文件路径 |

#### 3.4.1 设备池（transcodeEncodingDevices）

类型：数组，每个设备对象包含：

| 子字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `stableKey` | string | - | 设备稳定标识（如 `nvenc:0`、`cpu:libx265`），来自 `probeEncodeDevices()` 探测结果 |
| `inPool` | boolean | `false` | 是否入池 |
| `priority` | number | 100 | 优先级（数值越小越优先） |
| `maxSlots` | number | 1 | 该设备的并发槽位数 |
| `encoder` | string | `"hevc_nvenc"` | 编码器名称 |

#### 3.4.2 CPU 策略

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `transcodeCpuParticipationStrategy` | `normal` \| `backup_only` | `normal` | `normal`：CPU 参与分配；`backup_only`：仅 GPU，CPU 不参与 |

### 3.5 升级洗版（UpgradeFlowExecutor）

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `moviepilot.baseUrl` | string | `""` | MoviePilot 服务地址（如 `http://192.168.1.100:3000`） |
| `moviepilot.apiKey` | string | `""` | MoviePilot API Key |
| `moviepilot.savePath` | string | `""` | MoviePilot 容器内下载目录 |
| `moviepilot.stagingPath` | string | `""` | MoviePilot 容器内 staging 目录 |
| `upgradeStagingLocalPath` | string | `""` | ShelfDeck 视角的 staging 路径（Docker 路径映射后的本地路径） |
| `upgradeReplaceConfirmRequired` | boolean | `false` | 兼容保留。替换确认已迁移到 per-subLibrary `scheduleMode.autoReplaceUpgrade` |
| `upgradeScrapingSettleSeconds` | number | 1800 | transfer 后等待 MoviePilot 刮削元数据的静置时间（秒），默认 30 分钟 |
| `upgradeRetryInterval` | number | 3600000 | `waiting_media_source` 状态重搜间隔（ms），默认 1 小时 |
| `upgradeMaxRetries` | number | 3 | 最大重试次数 |

### 3.6 Emby 服务器配置（EmbyService）

#### 3.6.1 服务器注册表

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

#### 3.6.2 子库配置

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `subLibraries` | array | `[]` | 子库列表 |

**subLibraries 子字段**：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `subLibraries[<n>].uuid` | string | — | 子库唯一标识（内部 uuid） |
| `subLibraries[<n>].name` | string | `""` | 子库显示名称（用户自定义，默认用 Emby serverName） |
| `subLibraries[<n>].embyServerId` | string | `""` | 关联的 Emby 服务器 uuid |
| `subLibraries[<n>].sectionId` | string | `""` | Emby 媒体文件夹 ID（对应 `Library/MediaFolders` 返回的 `Id`） |
| `subLibraries[<n>].source` | string | `"emby"` | 数据来源：`emby`（`local` 暂不支持） |
| `subLibraries[<n>].doubanEnabled` | boolean | `false` | 是否启用该子库的豆瓣评分同步 |
| `subLibraries[<n>].enabled` | boolean | `true` | 是否启用该子库（暂停/恢复同步） |
| `subLibraries[<n>].lastRefreshedAt` | string | null | 最近一次 Emby 拉取时间（ISO 8601） |
| `subLibraries[<n>].doubanSyncedAt` | string | null | 最近一次豆瓣同步时间（ISO 8601） |
| `subLibraries[<n>].ruleTemplateId` | string | `"default"` | 绑定的规则模板 ID（替代旧 `mediaPolicy`） |
| `subLibraries[<n>].scheduleMode` | string | `"custom"` | 调度模式：`full_auto` / `full_manual` / `custom` |
| `subLibraries[<n>].autoCreate` | boolean | — | custom 模式：是否允许自动创建任务 |
| `subLibraries[<n>].autoExecute` | boolean | — | custom 模式：是否自动入队执行 |
| `subLibraries[<n>].autoReplaceTranscode` | boolean | — | custom 模式：转码后是否自动替换 |
| `subLibraries[<n>].autoReplaceUpgrade` | boolean | — | custom 模式：洗版后是否自动替换 |
| `subLibraries[<n>].smartSelectEnabled` | boolean | — | custom 模式：是否启用智能选种 |
| `subLibraries[<n>].upgradeSmartSelect` | object | — | 洗版智能选种配置（种子尺寸、优先级等） |

> `mediaPolicy` 字段已从子库中移除。v2→v3 迁移时，子库的 `mediaPolicy` 被提取到 `ruleTemplates`，子库改为通过 `ruleTemplateId` 引用。

### 3.7 豆瓣集成（DoubanService）

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `douban.userId` | string | `""` | 豆瓣"看过"页用户 ID |
| `douban.cookieHeader` | string | `""` | 豆瓣登录 Cookie |

### 3.8 服务认证

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `apiKey` | string | `""` | 服务 API Key，用于 desktop/外部调用认证。空字符串表示未设置 |

---

## §4 配置持久化

- 存储位置：`data/config.json`
- 写入方式：通过 `PATCH /v1/config` API 更新，由 ConfigStore 持久化
- 读取方式：各模块通过 `configStore.loadConfig()` 获取
- 写入时 merge 默认值：`{ ...getDefaultConfig(), ...config }`

---

## §5 与 desktop 的配置交互

**原则**：service 配置集中在 service 端，desktop 只读。

| 配置项 | 存储位置 | 管理方 |
|---|---|---|
| TaskScheduler 配置 | service | service Web 管理页 |
| 智能入队配置 | service | service Web 管理页 |
| 策略计算配置 | service | service Web 管理页 |
| 转码执行配置 | service | service Web 管理页 |
| 升级洗版配置 | service | service Web 管理页 |
| Emby 连接配置 | service | service Web 管理页 |
| 豆瓣集成配置 | service | service Web 管理页 |
| 规则模板 | service | service Web 管理页 |
| desktop 本地配置（service 地址等） | desktop | desktop 设置面板 |

---

## §6 per-subLibrary 调度配置解析

通过 `configStore.resolveSubLibSchedule(itemInfo, config)` 解析子库调度行为：

| scheduleMode | 行为 |
|---|---|
| `full_auto` | autoCreate/autoExecute/autoReplaceTranscode/autoReplaceUpgrade/smartSelectEnabled 全为 true |
| `full_manual` | 全为 false |
| `custom` | 按子库各字段逐一取值 |

---

## §7 配置版本迁移

ConfigStore 在 `loadConfig()` 时自动检测并迁移旧版配置：

| 版本 | 检测条件 | 迁移内容 |
|---|---|---|
| v1 → v2 | 存在 `baseUrl` 但无 `embyServers` | 单 Emby 配置 → embyServers map |
| v2 → v3 | 存在 `mediaPolicy` 但无 `ruleTemplates` | mediaPolicy → ruleTemplates（buildDefaultTemplate），子库 mediaPolicy → ruleTemplateId |
| v3 → v4 | 子库缺少 `scheduleMode` | 全局 executionMode/confirm 设置 → per-subLibrary scheduleMode |
| v4 rule | 规则含 `innerConnector` | 重新生成默认模板到新 groups/groupsConnector 格式 |

每次迁移前自动备份为 `config.json.v<N>.backup`。

---

## §8 关联文档

- `SERVICE/TASK_SCHEDULER.md` — 调度行为（per-subLibrary scheduleMode）
- `SERVICE/SMART_TASK_ENGINE.md` — 智能入队参数语义
- `SERVICE/STRATEGY_ENGINE.md` — 规则模板字段语义
- `SERVICE/TRANSCODE.md` — 设备池、CPU 策略字段语义
- `SERVICE/TRANSCODE_FLOW.md` — replace 阶段行为
- `SERVICE/UPGRADE_FLOW.md` — MoviePilot 路径映射字段语义
- `SERVICE/MEDIA_LIBRARY.md` — 媒体库表结构与子库链路
- `SERVICE/ADMIN_WEB/API.md` — 各配置域对应的 Admin API 端点
