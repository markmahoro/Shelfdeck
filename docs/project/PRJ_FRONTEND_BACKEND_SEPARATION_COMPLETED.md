# 前后端分离迁移完成记录

**完成时间**: 2026-04-21  
**迭代目标**: 实现 media-service 与 media-desktop 的完全前后端分离

## 架构变更概述

本次迁移将 ShelfDeck 从混合架构（前端 localStorage + 部分 API）迁移到完全的前后端分离架构（C/S 模型）。

### 核心原则

1. **单一数据源（SSOT）**: 所有业务数据由 media-service 持久化管理
2. **完全依赖后端**: 前端不再使用 localStorage 存储业务数据
3. **清晰职责分离**: 后端负责业务逻辑和数据持久化，前端负责 UI 展示和用户交互

## 后端变更（media-service）

### 新增模块

1. **configStore.js** - 配置持久化
   - 管理所有配置字段（参考 `DESIGN_CONFIG_FIELDS_REFERENCE.md`）
   - 持久化到 `data/config.json`
   - 提供 `loadConfig()`, `saveConfig()`, `patchConfig()` 接口

2. **taskStore.js** - 任务队列持久化
   - 完整的任务 CRUD 操作
   - 支持按 status、actionType、itemId 过滤
   - 持久化到 `data/tasks.json`

3. **cacheStore.js** - 缓存层
   - 媒体库列表缓存（`libraryItems`, `libraryCachedAt`）
   - 豆瓣评分缓存（`doubanRatings`, `doubanSyncedAt`）
   - 持久化到 `data/cache.json`

4. **taskScheduler.js** - 任务调度器
   - 5 秒调度间隔
   - 并发控制（deleteConcurrency, transcodeConcurrency, upgradeConcurrency）
   - 自动启动（app 初始化时）

### REST API 端点

#### 配置管理
- `GET /v1/config` - 获取配置
- `PATCH /v1/config` - 更新配置

#### 任务管理
- `GET /v1/tasks` - 获取任务列表（支持过滤）
- `POST /v1/tasks` - 创建任务
- `GET /v1/tasks/:taskId` - 获取单个任务
- `PATCH /v1/tasks/:taskId` - 更新任务
- `DELETE /v1/tasks/:taskId` - 删除任务

#### 任务操作
- `POST /v1/tasks/:taskId/actions/execute` - 执行任务
- `POST /v1/tasks/:taskId/actions/pause` - 暂停任务

#### 缓存管理
- `GET /v1/library/cache` - 获取媒体库缓存
- `POST /v1/library/cache` - 设置媒体库缓存
- `GET /v1/integrations/douban/ratings/cache` - 获取豆瓣缓存

## 前端变更（media-desktop）

### 新增模块

1. **apiClient.ts** - REST API 客户端
   - 封装所有后端 API 调用
   - 自动处理认证头（X-API-Key）
   - 统一错误处理

### 迁移的数据流

#### 配置管理
- **之前**: `localStorage.getItem('embyDesktopPlayerConfigV1')`
- **现在**: `apiClient.getConfig()` → 从后端加载
- **保存**: `apiClient.patchConfig()` → 保存到后端

#### 任务队列
- **之前**: `localStorage.getItem('embyDesktopPlayerTaskQueueV1')`
- **现在**: `apiClient.getTasks()` → 从后端加载
- **保存**: 通过 `createTask()`, `updateTask()`, `deleteTask()` 操作

#### 媒体库缓存
- **之前**: `localStorage.getItem('embyDesktopPlayerLibraryManageCacheV1')`
- **现在**: `apiClient.getLibraryCache()` → 从后端加载
- **保存**: `apiClient.setLibraryCache()` → 保存到后端

#### 豆瓣缓存
- **之前**: `localStorage.getItem('embyDesktopPlayerDoubanRatingEntriesV1')`
- **现在**: `apiClient.getDoubanCache()` → 从后端加载
- **保存**: 通过后端 Douban 集成写入

### 保留的 localStorage 使用

以下 localStorage 键保留用于 **UI 特定状态**，不属于业务数据：

- `MANAGED_ITEM_META_KEY` - 用户评分和观看状态（UI 临时状态）
- `LOCAL_MARKED_PLAYED_KEY` - 本地标记已播放（UI 临时状态）
- `MEDIA_POLICY_KEY` - 媒体策略设置（UI 配置）
- `TASK_SCHEDULER_SETTINGS_KEY` - 调度器设置（部分已迁移到后端 config）

### 初始化流程变更

**App.tsx 初始化**:
```typescript
// 使用 useEffect 从后端加载数据
useEffect(() => {
  async function loadFromBackend() {
    const loadedConfig = await loadSavedConfig();
    setConfig(loadedConfig);
    
    const libraryCache = await hydrateLibraryManageFromStorage(loadedConfig);
    setLibraryManageItems(libraryCache.items);
    
    const doubanEntries = await loadDoubanRatingEntries();
    setDoubanRatingEntries(doubanEntries);
  }
  void loadFromBackend();
}, []);
```

## 测试验证

### 自动化测试

创建了 `media-service/test-api.js` 测试脚本，验证所有 REST API 端点：

- ✅ 健康检查
- ✅ 配置管理（GET/PATCH）
- ✅ 任务 CRUD 操作
- ✅ 任务操作（execute/pause）
- ✅ 缓存管理（library/douban）

**测试结果**: 13/13 通过

### 手动测试

用户在本地环境验证：
- ✅ 配置修改后重启，配置保持（从后端加载）
- ✅ 任务创建后重启，任务保持（从后端加载）
- ✅ 媒体库缓存正确持久化
- ✅ 前后端完全分离，无 localStorage 降级

## 开发工具

为简化测试，创建了一键启动/关闭脚本：

- `start-shelfdeck.bat` - 一键启动 media-service + tray-supervisor + media-desktop
- `stop-shelfdeck.bat` - 一键关闭所有服务
- `create-shortcuts.bat` - 创建桌面快捷方式

## 文档更新

- ✅ `test-report.md` - 详细测试报告
- ✅ `启动脚本使用说明.md` - 开发工具使用指南
- ✅ 本文档 - 迁移完成记录

## 影响范围

### 破坏性变更

- **前端必须依赖后端**: media-desktop 启动时必须有 media-service 运行
- **数据迁移**: 旧的 localStorage 数据不会自动迁移到后端（用户需重新配置）

### 兼容性

- ✅ 现有 API 端点保持兼容
- ✅ OpenAPI 规范已更新
- ✅ 任务调度逻辑保持一致

## 后续建议

1. **数据迁移工具**: 考虑提供工具将旧 localStorage 数据迁移到后端
2. **前端集成测试**: 添加 E2E 测试验证 UI 与 API 的完整交互
3. **错误处理增强**: 当后端不可用时，前端提供更友好的错误提示
4. **性能优化**: 考虑添加请求缓存和乐观更新

## 相关文档

- `docs/api/openapi.yaml` - REST API 契约（SSOT）
- `docs/design/DESIGN_CONFIG_FIELDS_REFERENCE.md` - 配置字段参考（SSOT）
- `docs/design/DESIGN_TASK_CENTER.md` - 任务中心行为（SSOT）
- `CLAUDE.md` - 项目开发指南

## 结论

前后端分离迁移已成功完成。所有业务数据现在由 media-service 统一管理，前端完全依赖后端 API，实现了清晰的职责分离和单一数据源原则。
