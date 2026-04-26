# DESIGN_DESKTOP/CONNECTION — service 连接管理

> 状态：v2 编写中
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
│ - 读取连接文件（tray 写入的 connection.json）   │
│ - 读取环境变量（MEDIA_SERVICE_URL 等）         │
│ - 解析优先级链：env > store > file > default  │
│ - 通过 IPC 向渲染进程提供 getEffective()       │
│ - 监听连接文件变更 → 广播 cp:updated           │
│                                              │
│ 职责：连接地址的 SSOT 解析                      │
└──────────────────────────────────────────────┘
        │ contextBridge (preload.js)
        │ window.shelfdeckMedia.getEffective()
        │ window.shelfdeckMedia.onConnectionUpdated()
        ▼
┌──────────────────────────────────────────────┐
│ 渲染进程 (src/connection/)                    │
│                                              │
│ - baseUrl.ts：封装 getEffective() 为同步读    │
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
2. electron-store (shelfdeck.mediaService.baseUrl)
     ↓ 未设置
3. Vite env (VITE_MEDIA_SERVICE_URL / VITE_CONTROL_PLANE_URL)
     ↓ 仅开发模式生效
4. default (http://127.0.0.1:18080)
```

### 3.2 解析规则

| 来源 | 环境变量 / 存储键 | 说明 |
|------|-------------------|------|
| env | `MEDIA_SERVICE_URL` / `CONTROL_PLANE_URL` | 最高优先级；两个变量为同义词 |
| env | `MEDIA_SERVICE_API_KEY` / `CONTROL_PLANE_API_KEY` | API Key（与 URL 配对） |
| store | `shelfdeck.mediaService.baseUrl` | electron-store 持久化（用户通过设置面板配置） |
| store | `shelfdeck.mediaService.apiKey` | electron-store 持久化 |
| vite | `VITE_MEDIA_SERVICE_URL` / `VITE_CONTROL_PLANE_URL` | Vite 环境变量（仅开发模式） |
| default | `http://127.0.0.1:18080` | 兜底值 |

### 3.3 API Key 的处理

API Key 始终跟随 baseUrl 来源：
- 如果 baseUrl 来自 env，apiKey 也优先从 env 取
- 如果 baseUrl 来自 store，apiKey 优先从 store 取
- env 中的 API Key 可以覆盖 store 中的值

### 3.4 接口

```typescript
// 主进程侧 (shelfdeckConnection.js)
function resolveEffectiveConnection(env?): {
  baseUrl: string
  apiKey: string
  source: 'env' | 'file' | 'vite' | 'default'
}

// 渲染进程侧 (src/connection/baseUrl.ts)
// 通过 preload 暴露的 window.shelfdeckMedia 获取
function getBaseUrl(): string     // 已 strip 尾部斜杠
function getApiKey(): string      // 可能为空字符串

// 变更订阅
function onConnectionUpdated(cb: () => void): () => void  // 返回取消订阅函数
```

---

## §4 健康检查

### 4.1 检查端点

```
GET /v1/health
  → 200 { status: "ok" | "yellow" | "red" }
  → 非 200 或网络错误 → unhealthy
```

健康判断：HTTP 200 且 `body.status === 'ok'` 为 healthy；其他为 unhealthy。

### 4.2 检查策略

| 参数 | 值 | 说明 |
|------|-----|------|
| 间隔 | 5s | 与 service 调度间隔一致 |
| 超时 | 3s | fetch 超时（通过 AbortController） |
| 初始状态 | unhealthy | 首次检查完成前假设不可达 |

### 4.3 接口

```typescript
// src/connection/health.ts
function checkHealth(): Promise<boolean>
```

### 4.4 实现要点

- 渲染进程优先使用 `window.mediaService.checkHealth()`（通过 preload 桥接，可复用 HTTP 连接）
- 降级方案：渲染进程直接 `fetch()`（Vite 开发模式下 preload 不可用时）
- 不做退避（exponential backoff）：固定 5s 间隔足够；service 恢复后最多 5s 即可检测到

---

## §5 连接门禁

### 5.1 门禁逻辑

```
ConnectionGate 组件
    │
    ├── healthy ──→ 渲染 children（正常页面）
    │
    └── unhealthy ──→ 显示引导界面：
          ├── service 未运行提示
          ├── "启动 ShelfDeck 小助手" 引导
          └── 手动配置连接地址入口
```

### 5.2 组件接口

```typescript
// src/connection/ConnectionGate.tsx
function ConnectionGate({ children }: { children: ReactNode }): JSX.Element
```

### 5.3 引导界面内容

- 图标 + "媒体管理服务未连接" 标题
- 说明文字："请确保 ShelfDeck 小助手（托盘）正在运行，或手动配置服务地址"
- "打开设置" 按钮 → 打开 SettingsPanel
- 健康状态指示器（检查中 / 已连接 / 未连接）

---

## §6 变更通知

### 6.1 触发条件

- 用户在设置面板中修改 service URL 或 API Key → electron-store 更新
- tray 写入新的 connection.json → 主进程 fs.watch 检测到变更
- 环境变量变化（进程启动后不变，仅在启动时生效）

### 6.2 通知链路

```
store.set() 或 connection.json 变更
    │
    ▼
主进程 → broadcastConnectionUpdated()
    │
    ▼
webContents.send('cp:updated')
    │
    ▼
preload.js → ipcRenderer.on('cp:updated') → 回调渲染进程 listener
    │
    ▼
ConnectionGate 重新检查健康状态
```

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
- 任务进度轮询（如果任务中心页正在展示）
- 健康检查轮询（始终运行）

---

## §8 与 SETTINGS 模块的关系

- SETTINGS 模块负责**持久化** service 地址（electron-store 写入）
- CONNECTION 模块负责**解析** service 地址（从 store 读取 + env 覆盖）
- CONNECTION 的解析链包含 electron-store，所以依赖 SETTINGS 模块的存储
- SETTINGS 模块的 SettingsPanel 修改地址后，CONNECTION 模块通过 `cp:updated` 事件感知变更

```
用户修改地址
    │
    ▼
SETTINGS: shelfdeckSettings.set('serviceUrl', newUrl)
    │ store.set()
    ▼
主进程: broadcastConnectionUpdated()
    │ webContents.send('cp:updated')
    ▼
CONNECTION: 重新解析 baseUrl → 触发健康检查
```

---

## 关联文档

- `DESKTOP.md` — 瘦客户端总览（§3 子模块架构、§6 通信矩阵）
- `DESKTOP/SETTINGS.md` — 配置持久化（electron-store 管理 serviceUrl/apiKey）
- `DESKTOP/API_CLIENT.md` — API 客户端层（消费 baseUrl + apiKey）
- `DESKTOP/UI.md` — UI 组件（ConnectionGate 组件规范）
