# DATA_MODEL_INDEX — 核心数据模型索引

> **SSOT 路径**：`[DATA_MODEL_INDEX.md](./DATA_MODEL_INDEX.md)` · 文档索引 `[DOC_GOVERNANCE.md](../DOC_GOVERNANCE.md)`

本文档提供核心数据结构定义的索引，帮助开发者快速定位各数据模型的权威定义位置。

---

## 1. 任务相关数据模型

### 1.1 任务记录（Task Record）

**定义位置**：`[DESIGN_TASK_CENTER.md](./DESIGN_TASK_CENTER.md)` **§3.4**

**核心字段**：
- `taskId`：任务唯一标识
- `actionType`：任务类型（`delete` / `transcode` / `upgrade`）
- `status`：任务状态（见 §3.5.3）
- `embyItemId`：关联的 Emby 媒体条目 ID
- `createdAt` / `updatedAt`：时间戳
- `flowLog`：Flow 执行日志

**相关文档**：
- 状态枚举：`[DESIGN_TASK_CENTER.md](./DESIGN_TASK_CENTER.md)` **§3.5.3**
- 任务 Flow 步骤：`[DESIGN_TASK_CENTER.md](./DESIGN_TASK_CENTER.md)` **§4–§6**

### 1.2 转码任务专有字段

**定义位置**：`[DESIGN_TASK_CENTER.md](./DESIGN_TASK_CENTER.md)` **§5**

**核心字段**：
- `resolvedDeviceId`：分配的编码设备 ID（§5.1.2）
- `pre_replace_hash`：替换前旧文件 hash（§5.4）
- `tempWorkdir`：临时工作目录路径
- `targetPath`：目标成片路径

### 1.3 洗版任务专有字段

**定义位置**：`[DESIGN_TASK_CENTER.md](./DESIGN_TASK_CENTER.md)` **§6**

**核心字段**：
- `waiting_media_source`：等待媒体源状态标记
- `lastSearchAt` / `nextSearchAt`：搜索时间戳
- `searchAttempt`：搜索尝试次数
- `bestCandidateScore`：最佳候选评分

---

## 2. 媒体库相关数据模型

### 2.1 媒体库条目（ManagedMediaItem）

**定义位置**：`[DESIGN_LIBRARY_AND_QUEUE.md](./DESIGN_LIBRARY_AND_QUEUE.md)` **§1**

**核心字段**：
- `embyItemId`：Emby 条目 ID
- `title`：标题
- `isDiscLike`：是否原盘类资源（§4.0）
- `currentEquivalentBitrate`：当前等效码率
- `targetBitrate`：目标码率
- `predictedSize`：预测体积
- `starRating`：星级评分
- `isPlayed`：是否已观看

**缓存位置**：`localStorage` 键 `embyDesktopPlayerLibraryManageCacheV1`

### 2.2 重温队列条目（RevisitQueueItem）

**定义位置**：`[ARCH_SYSTEM_OVERVIEW.md](../architecture/ARCH_SYSTEM_OVERVIEW.md)` **§5**

**核心字段**：
- `embyItemId`：关联的 Emby 条目 ID
- `source`：来源（如 `wechat` / `manual`）
- `addedAt` / `updatedAt`：时间戳
- `userId`：用户 ID

---

## 3. 配置相关数据模型

### 3.1 编码资源池（Encode Pool）

**定义位置**：`[DESIGN_TASK_CENTER.md](./DESIGN_TASK_CENTER.md)` **§5.1**、**§7.4**

**核心字段**：
- `deviceId`：设备唯一标识
- `deviceType`：设备类型（`nvenc` / `qsv` / `amf` / `cpu`）
- `concurrency`：设备子槽上限
- `priority`：优先级（数值越小越优先）
- `enabled`：是否启用

**相关配置**：
- CPU 参与策略：§5.1.2
- 设备探测：§5.1.0

### 3.2 路径映射（Path Mapping）

**定义位置**：`[DESIGN_CONFIG_FIELDS_REFERENCE.md](./DESIGN_CONFIG_FIELDS_REFERENCE.md)` **§3**

**核心字段**：
- `embyPath`：Emby 服务端路径
- `localPath`：本机路径
- `direction`：映射方向（`emby_to_local` / `local_to_emby`）

**相关文档**：
- 实施细节：`[API_README.md](../api/API_README.md)` **路径映射与配置**
- 战略原则：`[ARCH_SYSTEM_OVERVIEW.md](../architecture/ARCH_SYSTEM_OVERVIEW.md)` **§3.4**

### 3.3 任务调度配置

**定义位置**：`[DESIGN_TASK_CENTER.md](./DESIGN_TASK_CENTER.md)` **§7.2**

**核心字段**：
- `runMode`：执行模式（`auto` / `manual`）
- `deleteConcurrency`：删除类并发上限
- `transcodeConcurrency`：转码类并发上限
- `upgradeConcurrency`：洗版类并发上限

---

## 4. 外部集成数据模型

### 4.1 豆瓣评分缓存

**定义位置**：`[DESIGN_LIBRARY_AND_QUEUE.md](./DESIGN_LIBRARY_AND_QUEUE.md)` **§5**

**核心字段**：
- `doubanId`：豆瓣条目 ID
- `rating`：个人评分（1-5 星）
- `title`：标题
- `matchedEmbyItemId`：匹配的 Emby 条目 ID
- `fetchedAt`：抓取时间

### 4.2 MoviePilot 候选资源

**定义位置**：`[ARCH_INTEGRATIONS.md](../architecture/ARCH_INTEGRATIONS.md)`、`[DESIGN_TASK_CENTER.md](./DESIGN_TASK_CENTER.md)` **§6**

**核心字段**：
- `candidateId`：候选资源 ID
- `estimatedBitrate`：估算码率
- `size`：文件大小
- `score`：评分/排序依据

---

## 5. API 数据模型

### 5.1 REST 请求/响应 Schema

**定义位置**：`[openapi.yaml](../api/openapi.yaml)`

**主要 Schema**：
- `TaskRecord`：任务记录
- `LibraryItem`：媒体库条目
- `RevisitQueueItem`：重温队列条目
- `EncodeDevice`：编码设备
- `PathMapping`：路径映射
- `ErrorResponse`：错误响应

**相关文档**：`[API_README.md](../api/API_README.md)`

---

## 6. 使用指南

### 6.1 查找数据模型定义

1. 在本索引中查找相关数据模型
2. 跳转到指定文档的对应章节
3. 查看完整字段定义与业务约束

### 6.2 跨模块数据一致性

- **任务与媒体库**：通过 `embyItemId` 关联
- **配置与任务**：任务执行时快照配置，避免运行中配置漂移
- **缓存与真相**：前端缓存应定期与后端同步，以后端为 SSOT

### 6.3 数据模型扩展原则

- 新增字段应在对应 SSOT 文档中明确定义
- 跨模块共享字段应在本索引中交叉引用
- 数据库 schema 应与文档定义保持一致

---

## 7. 待补充数据模型

以下数据模型定义分散或不完整，待后续版本补充：

- **日志记录结构**：任务日志、审计日志的统一格式
- **错误码枚举**：完整的错误码定义与分类（部分见 DESIGN_TASK_CENTER §17）
- **事件模型**：IPC 事件、WebSocket 事件的 payload 结构
- **会话模型**：用户会话、Emby 会话的完整定义

---

**维护说明**：本索引应随数据模型定义的变更同步更新。新增核心数据结构时，应在本索引中添加对应条目。
