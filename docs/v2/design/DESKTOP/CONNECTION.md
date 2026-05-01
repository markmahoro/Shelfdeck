# DESIGN_DESKTOP/CONNECTION — service 连接管理

> 状态：v4
> SSOT：本文是 desktop 连接 service 的地址解析、健康检查和连接门禁行为的唯一事实来源

---

## §1 职责边界

CONNECTION 模块负责 desktop 到 service 的连接生命周期管理：

- **地址解析**：多源优先级链确定 service 的 baseUrl 和 apiKey
- **健康检查**：轮询 `GET /v1/health` 判断 service 可达性
- **连接门禁**：service 不可达时拦截 UI 渲染，显示引导界面
- **变更通知**：连接地址变化时通知渲染进程刷新

CONNECTION **不负责**：
- 连接地址的持久化存储（由 SETTINGS 模块的 electron-store 管理）
- 具体的 REST 调用（由 API_CLIENT 模块负责）
- 重试策略（健康检查本身是定期轮询，自然实现重试）

---

## §2 架构

### 2.1 双端协作

连接管理跨主进程和渲染进程：

```
┌──────────────────────────────────────────────┐
│ 主进程 (electron/shelfdeckConnection.js)      │
│                                              │
│ - 读取连接文件（connection.json）[deprecated]   │
│ - 读取环境变量（MEDIA_SERVICE_URL 等）         │
│ - 读取 electron-store（desktop-settings）     │
│ - 解析优先级链：env > file > vite > default   │
│ - 通过 IPC 向渲染进程提供 getEffective()       │
│ - 监听连接文件变更 → 广播 cp:updated           │
│                                              │
│ 职责：连接地址的 SSOT 解析                      │
└──────────────────────────────────────────────┘
        │ contextBridge (preload.js)
        │ window.embyApi.getEffectiveConnection()
        │ window.embyApi.onConnectionUpdated()
        ▼
┌──────────────────────────────────────────────┐
│ 渲染进程 (src/connection/)                    │
│                                              │
│ - baseUrl.ts：封装 getEffectiveConnection()   │
│ - health.ts：定时轮询 GET /v1/health          │
│ - ConnectionGate.tsx：连接门禁 UI 组件         │
│                                              │
│ 职责：消费连接地址 + 健康检查 + UI 门禁         │
└──────────────────────────────────────────────┘
```

### 2.2 为什么主进程是地址解析的 SSOT

- 主进程可以访问 Node.js API（fs、path、os），读取连接文件和环境变量
- 渲染进程受 contextIsolation 保护，无法直接访问文件系统
- 统一在主进程解析，避免渲染进程各自实现解析逻辑

---

## §3 地址解析链

### 3.1 优先级

```
1. env (MEDIA_SERVICE_URL / CONTROL_PLANE_URL)
     ↓ 未设置
2. file (connection.json) [deprecated — 仍存在于代码中，计划移除]
     ↓ 未设置
3. Vite env (VITE_MEDIA_SERVICE_URL / VITE_CONTROL_PLANE_URL)
     ↓ 仅开发模式生效
4. default (http://127.0.0.1:18080)
```

> **注意**：`connection.json`（位于 `%APPDATA%/ShelfDeck/connection.json`）是旧 tray companion 写入的连接文件，已标记为 deprecated。当前 desktop 的持久化连接配置存储在 electron-store 中。但 `shelfdeckConnection.js` 的初始解析链仍包含 `connection.json` 作为第二优先级（向后兼容）。未来版本应移除此来源。

### 3.2 解析规则

| 来源 | 环境变量 / 存储键 | 说明 |
|------|-------------------|------|
| env | `MEDIA_SERVICE_URL` / `CONTROL_PLANE_URL` | 最高优先级；两个变量为同义词 |
| env | `MEDIA_SERVICE_API_KEY` / `CONTROL_PLANE_API_KEY` | API Key（与 URL 配对） |
| file [deprecated] | `%APPDATA%/ShelfDeck/connection.json` | 旧 tray companion 写入的连接文件 |
| vite | `VITE_MEDIA_SERVICE_URL` / `VITE_CONTROL_PLANE_URL` | Vite 环境变量（仅开发模式） |
| default | `http://127.0.0.1:18080` | 兜底值 |

### 3.3 API Key 的处理

API Key 始终跟随 baseUrl 来源：
- 如果 baseUrl 来自 env，apiKey 也优先从 env 取
- 如果 baseUrl 来自 file [deprecated]，apiKey 优先从 file 取（但 env 中的 API Key 可覆盖 file 中的值）
- 如果 baseUrl 来自 default，apiKey 为空

**运行时更新**：当用户在 SettingsPanel 中修改 service 地址并保存时，数据写入 electron-store，触发 `cp:updated` 广播。此时 preload.js 通过 `connection:get` IPC 从 electron-store 重新读取连接信息。

### 3.4 接口

```typescript
// 主进程侧 (shelfdeckConnection.js)
function resolveEffectiveConnection(env?): {
  baseUrl: string
  apiKey: string
  source: 'env' | 'file' | 'vite' | 'default'
}

// 渲染进程侧 — 通过 window.embyApi 获取
window.embyApi.getEffectiveConnection(): {
  baseUrl: string
  apiKey: string
  source?: string
}

// 渲染进程封装 (src/connection/baseUrl.ts)
function getBaseUrl(): string     // 已 strip 尾部斜杠
function getApiKey(): string      // 可能为空字符串

// 变更订阅
window.embyApi.onConnectionUpdated(cb: () => void): () => void  // 返回取消订阅函数
```

---

## §4 健康检查

### 4.1 检查端点

```
GET /v1/health
  → 200 { status: "green" | "yellow" | "red" }
  → 非 200 或网络错误 → unhealthy
```

健康判断：HTTP 200 且 `body.status === 'green' || body.status === 'yellow'` 为 healthy；其他为 unhealthy。

### 4.2 检查策略

| 参数 | 值 | 说明 |
|------|-----|------|
| 间隔 | 5s | 与 service 调度间隔一致 |
| 超时 | 3s | HTTP 请求超时（通过 http.request timeout） |
| 初始状态 | checking → unhealthy | 首次检查完成前显示"正在连接..." |

### 4.3 接口

```typescript
// preload.js 暴露: window.mediaService.checkHealth()
// 使用 Node http 模块（绕过浏览器 CORS）

// src/connection/health.ts
function checkHealth(): Promise<boolean>
```

### 4.4 实现要点

- 渲染进程使用 `window.mediaService.checkHealth()`（通过 preload 桥接，使用 Node.js `http` 模块，绕过浏览器 CORS 限制）
- 降级方案：渲染进程直接 `fetch()`（Vite 开发模式下 preload 不可用时）
- 不做退避（exponential backoff）：固定 5s 间隔足够；service 恢复后最多 5s 即可检测到

---

## §5 连接门禁

### 5.1 门禁逻辑

```
ConnectionGate 组件（内部管理健康轮询）
    │
    ├── checking ──→ 显示"正在连接媒体管理服务..."
    │
    ├── healthy ──→ 渲染 children（正常页面）
    │
    └── unhealthy ──→ 显示引导界面：
          ├── "媒体管理服务未连接" 标题
          ├── "无法连接媒体管理服务。请确认服务已启动，或手动配置服务地址。"
          └── "打开设置" 按钮 → 打开 SettingsPanel
```

### 5.2 组件接口

```typescript
// src/connection/ConnectionGate.tsx
function ConnectionGate({
  children,
  onSettingsOpen,
}: {
  children: ReactNode;
  onSettingsOpen: () => void;
}): JSX.Element
```

**注意**：ConnectionGate 不接收 `healthy` prop。它内部通过 `useEffect` + `setInterval(checkHealth, 5000)` 自行管理健康状态。这是 v4 的关键变化：健康检查不再从 App 组件传入。

### 5.3 引导界面内容

- "媒体管理服务未连接" 标题
- 说明文字："无法连接媒体管理服务。请确认服务已启动，或手动配置服务地址。"
- "打开设置" 按钮 → 打开 SettingsPanel
- 连接中状态："正在连接媒体管理服务..."

> v2 文档中"请确保 ShelfDeck 小助手（托盘）正在运行"的文案已被移除。tray 目前已嵌入 service 进程，不再作为独立进程存在。引导文案聚焦于"确认服务已启动"。

---

## §6 变更通知

### 6.1 触发条件

- 用户在设置面板中修改 service URL 或 API Key → electron-store 更新 → 主进程广播 `cp:updated`
- `connection.json` 文件变更 [deprecated] → 主进程 fs.watch 检测到变更 → 200ms 防抖后广播 `cp:updated`

### 6.2 通知链路

```
store.set() (或 connection.json 变更 [deprecated])
    │
    ▼
主进程 → broadcastConnectionUpdated()
    │
    ▼
webContents.send('cp:updated')
    │
    ▼
preload.js → ipcRenderer.on('cp:updated') → refreshEffectiveCp()
    │ 调用 connection:get IPC → 从 electron-store 读取最新连接信息
    │
    ▼
更新 effectiveCp 对象（baseUrl, apiKey, source）
    │
    ▼
回调渲染进程 listener → ConnectionGate 重新检查健康状态
```

**关键细节**：`cp:updated` 触发后，preload.js 的 `refreshEffectiveCp()` 通过 `connection:get` IPC 从 electron-store 读取连接信息（不再从 `connection.json` 或环境变量重新解析）。这意味着用户通过 SettingsPanel 保存的连接地址会立即生效，而 env 和 file 来源仅在初始启动时参与解析。

### 6.3 防抖

主进程对连接文件变更加 200ms 防抖（避免编辑器连续写入触发多次通知）。

---

## §7 断线重连

### 7.1 策略

不实现主动重连（desktop 不是长连接客户端）。连接恢复依赖健康检查轮询：

```
unhealthy 状态
    │ 每 5s 检查一次
    │ service 恢复
    ▼
下次健康检查返回 healthy
    │
    ▼
ConnectionGate 自动切换为正常页面
```

### 7.2 已加载数据的处理

连接断开时，已加载的媒体库列表、任务列表等数据保留在 React state 中。重连后自动恢复轮询即可刷新数据。

### 7.3 轮询恢复

连接恢复后，以下轮询自动恢复：
- App 全局任务轮询（400ms）
- FloatingTaskButton 独立任务轮询（400ms）
- 健康检查轮询（始终运行，ConnectionGate 内部）

---

## §8 与 SETTINGS 模块的关系

- SETTINGS 模块负责**持久化** service 地址（electron-store 写入）
- CONNECTION 模块负责**解析** service 地址（从 store 读取 + env 覆盖）
- CONNECTION 的解析链包含 electron-store（通过 `connection:get` IPC），依赖 SETTINGS 模块的存储
- SETTINGS 模块的 SettingsPanel 修改地址后，CONNECTION 模块通过 `cp:updated` 事件感知变更

```
用户修改地址
    │
    ▼
SETTINGS: window.embyApi.saveSetting('shelfdeck.mediaService.baseUrl', newUrl)
    │ store.set()
    ▼
主进程: broadcastConnectionUpdated()
    │ webContents.send('cp:updated')
    ▼
CONNECTION: preload refreshEffectiveCp() → 从 electron-store 重新读取 → 回调渲染进程
    │
    ▼
ConnectionGate 触发健康检查
```

---

## 关联文档

- `DESKTOP.md` — 瘦客户端总览（§3 子模块架构、§6 通信矩阵）
- `DESKTOP/SETTINGS.md` — 配置持久化（electron-store 管理 serviceUrl/apiKey）
- `DESKTOP/API_CLIENT.md` — API 客户端层（消费 baseUrl + apiKey）
- `DESKTOP/UI.md` — UI 组件（ConnectionGate 组件规范）
