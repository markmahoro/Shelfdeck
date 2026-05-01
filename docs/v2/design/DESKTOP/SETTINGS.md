# DESIGN_DESKTOP/SETTINGS — 配置持久化

> 状态：v4
> SSOT：本文是 desktop 本地设置的数据模型、存储方式和 IPC 桥接的唯一事实来源

---

## §1 职责边界

SETTINGS 模块负责 desktop 本地配置的持久化和读写：

- **存储**：使用 electron-store 在主进程持久化本地设置
- **数据模型**：定义 desktop 本地设置的类型和默认值
- **IPC 桥接**：通过 contextBridge 暴露安全的读写接口到渲染进程
- **设置 UI**：提供设置面板组件供用户编辑

SETTINGS **不负责**：
- service 端配置（由 service ConfigStore 管理，desktop 通过 `PATCH /v1/config` 读写）
- 连接地址解析（由 CONNECTION 模块从 electron-store 读取后解析）
- 媒体库缓存、任务队列等业务数据（由 service 持有）

### 与 service 配置的区分

| 配置域 | 存储位置 | 管理方 | 示例 |
|--------|----------|--------|------|
| **desktop 本地设置** | electron-store (本地) | SETTINGS 模块 | serviceUrl, playerExePath, pathMappings, subLibraryPathMaps |
| **service 配置** | data/config.json (服务端) | service ConfigStore | Emby server, mediaPolicy, scheduler settings |

---

## §2 数据模型

### 2.1 设置项

```typescript
type SubLibraryPathMap = Record<string, { from: string; to: string }>;

interface DesktopSettings {
  /** service HTTP 地址（默认 http://127.0.0.1:18080） */
  serviceUrl: string;

  /** service API Key（可选，用于认证） */
  serviceApiKey: string;

  /** 外部播放器可执行文件路径（PotPlayer） */
  playerExePath: string;

  /** 本地路径映射：源路径前缀 */
  localPathMapFrom: string;

  /** 本地路径映射：目标路径前缀 */
  localPathMapTo: string;

  /** 按媒体库的路径映射（key = subLibrary uuid） */
  subLibraryPathMaps: SubLibraryPathMap;
}
```

`subLibraryPathMaps` 是 v4 新增字段。每个 subLibrary（由 uuid 标识）可配置独立的路径映射 `{ from, to }`，用于处理多个 Emby 服务器/媒体库的路径转换。

### 2.2 默认值

| 键 | 默认值 | 说明 |
|----|--------|------|
| `serviceUrl` | `http://127.0.0.1:18080` | 本地 service 默认端口 |
| `serviceApiKey` | `""` | 无认证时不填 |
| `playerExePath` | `""` | 空表示使用系统默认播放器 |
| `localPathMapFrom` | `""` | 空表示不做映射（全局） |
| `localPathMapTo` | `""` | 空表示不做映射（全局） |
| `subLibraryPathMaps` | `{}` | 空对象表示无媒体库级映射 |

### 2.3 electron-store 键

| 存储键 | 类型 | 对应设置字段 |
|--------|------|-------------|
| `shelfdeck.mediaService.baseUrl` | string | serviceUrl |
| `shelfdeck.mediaService.apiKey` | string | serviceApiKey |
| `shelfdeck.playerExePath` | string | playerExePath |
| `shelfdeck.localPathMapFrom` | string | localPathMapFrom |
| `shelfdeck.localPathMapTo` | string | localPathMapTo |
| `shelfdeck.subLibraryPathMaps` | object | subLibraryPathMaps |

> 历史兼容：v1 使用 `embyDesktopPlayerConfigV1` 等 localStorage 键；v2 迁移到 electron-store，使用带命名空间的键。

---

## §3 存储层

### 3.1 electron-store 配置

```javascript
// electron/main.js
const Store = require('electron-store');
const store = new Store({ name: 'desktop-settings' });
```

- 存储文件路径（Windows）：`%APPDATA%/ShelfDeck/desktop-settings.json`
- 加密：不加密（settings 不含敏感凭证；apiKey 是 service 端认证 token，非用户密码）
- 存取方式：仅主进程通过 `store.get(key)` / `store.set(key, value)` 读写

### 3.2 为什么不用 localStorage

| | localStorage | electron-store |
|---|---|---|
| 存储位置 | 渲染进程（浏览器 profile） | 主进程（文件系统） |
| 持久性 | 清除浏览器数据时丢失 | 独立文件，不受影响 |
| 多窗口共享 | 需 manual sync | 文件系统自然共享 |
| 安全性 | 渲染进程直接访问 | 仅主进程访问，渲染进程通过 IPC |

---

## §4 IPC 桥接

### 4.1 IPC handler（主进程）

```javascript
// electron/main.js

// 读取全部设置
ipcMain.handle('settings:get', () => ({
  serviceUrl: store.get('shelfdeck.mediaService.baseUrl', 'http://127.0.0.1:18080'),
  serviceApiKey: store.get('shelfdeck.mediaService.apiKey', ''),
  playerExePath: store.get('shelfdeck.playerExePath', ''),
  localPathMapFrom: store.get('shelfdeck.localPathMapFrom', ''),
  localPathMapTo: store.get('shelfdeck.localPathMapTo', ''),
  subLibraryPathMaps: store.get('shelfdeck.subLibraryPathMaps', {}),
}));

// 设置单个键
ipcMain.handle('settings:set', (event, key, value) => {
  if (value == null) {
    store.delete(key);
    broadcastConnectionUpdated();
    return { ok: true };
  }
  try {
    store.set(key, value);
    // 连接相关设置变更时广播
    if (key === 'shelfdeck.mediaService.baseUrl' || key === 'shelfdeck.mediaService.apiKey') {
      broadcastConnectionUpdated();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// 读取单个键
ipcMain.handle('settings:getKey', (event, key) => store.get(key));
```

### 4.2 contextBridge 暴露（preload.js）

设置读写通过 `window.embyApi` 暴露：

```javascript
// preload.js — embyApi 对象中

getSettings: () => ipcRenderer.invoke('settings:get'),
saveSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
```

> **不再使用** `window.shelfdeckSettings`。v4 中所有设置操作统一通过 `window.embyApi.getSettings()` 和 `window.embyApi.saveSetting(key, value)` 进行。

### 4.3 渲染进程封装

```typescript
// src/settings/store.ts

export async function getSettings(): Promise<DesktopSettings>
export async function saveSetting(key: keyof typeof STORE_KEYS, value: string): Promise<{ ok: boolean; error?: string }>
export async function saveSubLibraryPathMaps(maps: SubLibraryPathMap): Promise<{ ok: boolean; error?: string }>

const STORE_KEYS = {
  serviceUrl: 'shelfdeck.mediaService.baseUrl',
  serviceApiKey: 'shelfdeck.mediaService.apiKey',
  playerExePath: 'shelfdeck.playerExePath',
  localPathMapFrom: 'shelfdeck.localPathMapFrom',
  localPathMapTo: 'shelfdeck.localPathMapTo',
  subLibraryPathMaps: 'shelfdeck.subLibraryPathMaps',
} as const;
```

### 4.4 安全约束

- 渲染进程不能直接访问文件系统（contextIsolation: true, nodeIntegration: false）
- 所有读写通过 IPC invoke 到主进程，主进程执行实际的 store 操作
- preload 只暴露 `getSettings` 和 `saveSetting` 两个方法，不暴露 store 对象本身
- 键名通过 `STORE_KEYS` 常量约束类型安全

---

## §5 设置面板 UI

### 5.1 组件接口

```typescript
// src/settings/SettingsPanel.tsx
function SettingsPanel({
  onClose,
  subLibraries,
}: {
  onClose: () => void;
  subLibraries: SubLibraryInfo[];
}): JSX.Element
```

`subLibraries` prop 用于渲染"媒体库目录映射"动态表单区域（每个启用的 subLibrary 显示一行路径映射输入）。

### 5.2 表单项

| 标签 | 字段 | 类型 | 说明 |
|------|------|------|------|
| 媒体服务地址 | serviceUrl | text input | 默认 http://127.0.0.1:18080 |
| 服务 API Key | serviceApiKey | password input | 掩码显示 |
| 播放器路径（PotPlayer） | playerExePath | text input | 可执行文件路径 |
| **媒体库目录映射** | subLibraryPathMaps | 动态表单区域 | 每个 subLibrary 一组 { 源路径（NAS）, 目标路径（本地） } |

媒体库目录映射是 v4 新增的动态表单区域，仅在有 subLibrary 时显示。每个 subLibrary 显示为一个卡片：
- 标题：subLibrary 名称
- 源路径（NAS）：text input，如 `/volume1/Media`
- 目标路径（本地）：text input，如 `Z:\`

### 5.3 交互行为

```
用户点击设置齿轮 → 打开 SettingsPanel（覆盖层）
用户修改字段 → 本地 state 更新（不立即保存）
用户点击"保存" → 逐个调用 window.embyApi.saveSetting(key, value)
    → 成功 → 显示"已保存"（2s 后消失）
    → 失败 → 显示错误提示
用户点击 × 或遮罩 → 关闭面板（未保存的修改丢失）
```

保存顺序：
1. 逐个保存 `serviceUrl`, `serviceApiKey`, `playerExePath`（通过 `saveSetting`）
2. 批量保存 `subLibraryPathMaps`（通过 `saveSubLibraryPathMaps`）
3. 任一失败则显示错误提示（第一个错误），但不阻止其他项的保存

### 5.4 保存后的副作用

修改 `serviceUrl` 或 `serviceApiKey` 后：
1. electron-store 更新（主进程 `store.set`）
2. 主进程检测到连接相关键变更 → `broadcastConnectionUpdated()`
3. 发送 `cp:updated` 事件到渲染进程
4. preload.js `refreshEffectiveCp()` → 通过 `connection:get` IPC 从 electron-store 重新读取
5. CONNECTION 模块的 `effectiveCp` 对象更新
6. ConnectionGate 重新检查健康状态

---

## §6 本地播放路径映射

### 6.1 用途

当 desktop 和 Emby server 不在同一台机器时，媒体文件路径可能需要映射：

**全局映射**（`localPathMapFrom` / `localPathMapTo`）：
```
Emby 返回的路径：/media/movies/foo.mkv
本地实际路径：  D:\NAS\media\movies\foo.mkv

localPathMapFrom: /media
localPathMapTo:   D:\NAS\media
```

**媒体库级映射**（`subLibraryPathMaps`）：
```
SubLibrary "电影" (uuid: abc) 在 NAS-A 上，路径 /volume1/Movies → Z:\Movies
SubLibrary "剧集" (uuid: def) 在 NAS-B 上，路径 /volume2/TV    → X:\TV
```

媒体库级映射优先于全局映射。当 `subLibraryPathMaps[uuid]` 存在时，使用该映射；否则回退到全局映射。

### 6.2 映射逻辑

```typescript
function applyPathMapping(originalPath: string, from: string, to: string): string {
  if (!from || !to) return originalPath;
  return originalPath.replace(from, to);
}
```

映射由 preload.js 侧（`emby:launchPlayer` handler）执行，渲染进程不直接操作文件路径。

---

## 关联文档

- `DESKTOP.md` — 瘦客户端总览（§5 数据持有权）
- `DESKTOP/CONNECTION.md` — 连接管理（从 electron-store 读取 serviceUrl）
- `DESKTOP/UI.md` — UI 组件（SettingsPanel 组件规范）
