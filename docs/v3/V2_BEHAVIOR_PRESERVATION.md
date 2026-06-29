# ShelfDeck v3 V2 Behavior Preservation

本文用于规避 v3 service 优先重构升级时遗漏 v2 生产细节。

v3 可以重写架构，但不能在未识别、未记录、未确认的情况下丢失 v2 已经依赖的行为。尤其是 FFmpeg 命令、外部 API 调用、文件移动规则、任务状态机、配置默认值和部署脚本。

## 1. 原则

在重构前，先做 v2 behavior inventory。

对每个关键行为，v3 agent 必须回答：

- v2 当前行为是什么。
- 行为入口在哪个文件。
- 生产是否依赖它。
- v3 是保留、替换、删除还是迁移。
- 如果替换，兼容风险和验证方式是什么。

不要只读架构文档推断行为。必须读 v2 代码、测试、生产配置和必要的 NAS 运行状态。

## 2. 必须盘点的高风险细节

### FFmpeg / FFprobe

必须逐项记录：

- `media-service/src/services/transcodeService.js` 中所有 `ffmpeg` / `ffprobe` 参数构造。
- `buildEncodeArgs`、设备选择、NVENC/QSV/CPU 回退、Dolby Vision tonemap、音轨/字幕/容器处理。
- `remuxDiscToMkv`、`extractPreviewClip`、`probeSummary`、`replaceWithRetries`、orphan cleanup。
- `media-service/src/transcodeFlowExecutor.js` 中 precheck、执行、verify、replace、pause/cancel 对 partial 文件的处理。
- `media-service/src/adultLibraryService.js` 中成人库 ffprobe 探测、封面裁切、截图/图片生成相关命令。
- `media-service/src/services/westernAdultLocalAiService.js` 中欧美成人本地 AI 抽帧和 ffprobe 调用。
- `media-worker/src` 中 worker 侧 FFmpeg job API、上传、状态、输出下载和配置默认值。

建议在 v3 开工时输出一份 `FFMPEG_BEHAVIOR_INVENTORY.md`，包含命令模板、输入、输出、错误处理、超时、清理规则和验证方式。

### 外部系统

必须盘点：

- Emby：同步、watch state、rating、delete、path/reference、section/library 相关 API。
- Douban：评分抓取、匹配、会话/失败处理。
- MoviePilot：搜索、添加下载、等待 scraping/transfer、staging path 映射、取消/清理。
- Worker：远程转码、健康、能力、job 生命周期。
- 成人 scraper：日本 JAV 内置 scraper、欧美成人本地 AI、People/reference face。

### 文件系统行为

必须盘点：

- 成人库 `watchRoot`、`scraped/` 归拢目录、`.shelfdeck.json` marker。
- JAV 和欧美成人成功刮削后的目录命名、视频移动、NFO/封面/fanart 写入。
- delete flow 对文件、目录、watchRoot、scraped root 的安全边界。
- transcode/upgrade replace 的临时文件、partial 文件、staging folder、回滚和清理行为。

### Task / Flow / Approval

必须盘点：

- v2 task statuses、terminal statuses、resumePoint、phase、progress、logs。
- approval gates：delete、transcode、upgrade、scrape 的所有确认点。
- manual/auto execution mode、sub-library scheduleMode/automationMode。
- retry、pause、resume、cancel、interrupted、startup reconciliation。
- `TaskAdmission` 的去重、元数据前置条件、cooldown、queue limit、allow-list。

### Data / Projection

必须盘点：

- `library.db` schema、重要索引、`payload_json` 字段含义。
- `tasks.db` schema、轻量列表查询、active/terminal task 查询、space stats 查询。
- `config.json` 默认值、迁移逻辑、隐藏/废弃字段。
- `nodes.json`、`people.json` 的生产语义。
- Admin Web 依赖的字段和任何后端投影字段。

### Deployment

必须盘点：

- `docs/v2/PRODUCTION_DEPLOYMENT.md`。
- `scripts/build-image.sh`。
- `scripts/upload-nas-image.js`。
- `scripts/deploy-nas.js`。
- `tools/nas-ssh-config.js`。
- `tools/ssh-exec.js`。
- Docker image、container name、volume、port、health check。

## 3. 建议的重构防漏机制

v3 agent 应先生成以下文档或等价输出：

- `V2_ARCHITECTURE_INVENTORY.md`：v2 真实模块图和调用关系。
- `V2_DATA_INVENTORY.md`：v2 数据结构和字段含义。
- `V2_BEHAVIOR_INVENTORY.md`：关键行为清单。
- `FFMPEG_BEHAVIOR_INVENTORY.md`：FFmpeg/FFprobe 命令清单。
- `EXTERNAL_API_INVENTORY.md`：Emby、Douban、MoviePilot、worker API 清单。
- `ADMIN_WEB_FIELD_INVENTORY.md`：Admin Web 页面、字段、动作入口和用户语义。
- `MIGRATION_RISK_REGISTER.md`：每个行为的保留/替换/删除/迁移决策。

这些 inventory 可以是临时工作文档，也可以整理进最终 v3 文档。关键是：没有 inventory，不要直接开始大规模重写。

## 4. Characterization Tests

对难以从代码 review 保证的行为，应先写 characterization tests。

优先覆盖：

- FFmpeg 参数构造。
- transcode precheck/verify/replace。
- adult scrape 成功和失败路径。
- delete 安全边界。
- MoviePilot path mapping 和等待逻辑。
- TaskAdmission 的准入/拒绝原因。
- Admin Web 列表接口的字段语义。

这些测试的目的不是证明 v2 完美，而是把 v2 生产依赖行为冻住，避免 v3 重构时无意破坏。

## 5. 用户确认点

如果 v3 agent 发现某个 v2 行为很复杂或不合理，不能直接删除。

必须先向用户说明：

- 这个行为当前在哪里。
- 为什么 v3 想删除或替换它。
- 删除后用户体验或生产数据会受到什么影响。
- 有没有迁移或兼容方案。

用户确认后再改。
