# DESIGN_SERVICE/CONFIG — 配置与路径映射

> 状态：v2 重写中
> SSOT：配置字段定义以本文为准
> 参考：`ref/design/DESIGN_CONFIG_AND_PATHS.md` · `ref/design/DESIGN_CONFIG_FIELDS_REFERENCE.md`

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

### 3.2 转码执行（TranscodeFlowExecutor / TranscodeService）

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `transcodeTempRoot` | string | `""` | 转码临时根目录（必填） |
| `transcodeReplaceConfirmRequired` | boolean | `false` | 是否需要替换前确认 |
| `ffmpegPath` | string | `"ffmpeg"` | FFmpeg 可执行文件路径 |
| `ffprobePath` | string | `"ffprobe"` | ffprobe 可执行文件路径 |

#### 3.2.1 设备池（transcodeEncodingDevices）

类型：数组，每个设备对象包含：

| 子字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `stableKey` | string | - | 设备稳定标识（如 `gpu:0:nvenc`、`cpu:0`） |
| `inPool` | boolean | `false` | 是否入池 |
| `priority` | number | 100 | 优先级（数值越小越优先） |
| `maxSlots` | number | 1 | 该设备的并发槽位数（GPU 有效） |
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

### 3.4 Emby 连接（EmbyService）

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `embyClient.baseUrl` | string | `""` | Emby 服务器地址（如 `http://192.168.1.100:8096`） |
| `embyClient.apiKey` | string | `""` | Emby API Key |
| `embyClient.userId` | string | `""` | Emby 用户 ID |
| `embyClient.embyUserPassword` | string | `""` | Emby 用户密码（用于删除操作鉴权） |

### 3.5 豆瓣集成（DoubanService）

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `douban.userId` | string | `""` | 豆瓣"看过"页用户 ID |
| `douban.cookieHeader` | string | `""` | 豆瓣登录 Cookie |

### 3.6 媒体库策略（MediaLibraryService）

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

- `SERVICE/TASK_SCHEDULER.md` — executionMode、concurrency 字段语义
- `SERVICE/TRANSCODE.md` — 设备池、CPU 策略字段语义
- `SERVICE/TRANSCODE_FLOW.md` — replaceConfirmRequired 行为
- `SERVICE/UPGRADE_FLOW.md` — MoviePilot 路径映射字段语义
- `SERVICE/MEDIA_LIBRARY.md` — mediaPolicy 字段语义
