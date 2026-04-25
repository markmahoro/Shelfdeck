# DESIGN_SERVICE_HEALTH_CHECK — 服务健康检查（Phase 4）

> **状态**：Phase 4 待办
> **关联**：`DESK_TASK_CENTER.md`（调度层）· `DESIGN_TRAY_MEDIA_SERVICE_SUPERVISOR.md`（托盘指示灯）· `DESIGN_DESKTOP_BACKEND_ENDPOINT.md`（连接模型）

---

## 1. 背景与目标

当前 `GET /v1/health` 仅返回 `{ status: 'ok', version }`，只证明进程存活，不反映下游依赖和调度器状态。Tray 托盘灯和 admin 管理页 badge 都轮询此接口，呈现的状态是**虚假的**。

目标：提供用户视角的聚合健康状态，供 Tray 指示灯、admin badge、desktop 门禁直接使用。

---

## 2. 健康检查清单

每项检查结果为 `ok` 或 `error`。

| 序号 | 检查项 | 检查内容 | ok 条件 |
|------|--------|---------|---------|
| 1 | `service` | 服务进程运行中，已监听端口 | Fastify server 已 listen |
| 2 | `config` | Emby 配置完整性 | `baseUrl` + `apiKey` + `userId` 均非空 |
| 3 | `emby` | Emby 服务器可达 | `embyService.testConnection()` 返回 connected（结果缓存 60s） |
| 4 | `scheduler` | 任务调度器在运行 | `taskScheduler.isRunning()` 返回 true |

---

## 3. 聚合状态定义（3级）

| 聚合状态 | 用户能做什么 | 条件 |
|---------|------------|------|
| **green** | 全部正常 | 4项全部 `ok` |
| **yellow** | 可添加任务，执行可能受影响 | 2~3项 `ok` |
| **red** | 无法添加任务 | 0~1项 `ok` |

### 聚合算法

```
okCount = [service, config, emby, scheduler].filter(x => x === 'ok').length

if okCount >= 4: healthy = 'green'
elif okCount >= 2: healthy = 'yellow'
else: healthy = 'red'
```

---

## 4. API 响应格式

### `GET /v1/health`

```json
{
  "status": "ok",
  "version": "0.1.0",
  "healthy": "green",
  "checks": {
    "service": "ok",
    "config": "ok",
    "emby": "ok",
    "scheduler": "ok"
  }
}
```

### `healthy` 字段含义

| 值 | 含义 | Tray 灯色 |
|----|------|---------|
| `green` | 全部正常 | 绿 |
| `yellow` | 部分降级：config 正常 + scheduler 正常，但 emby 不通 | 黄 |
| `red` | 服务不可用：service 挂了 或 config 未填 或 scheduler 停了 | 红 |

### 降级行为说明

| 场景 | 添加任务 | 执行转码 |
|------|---------|---------|
| green | ✓ 可添加 | ✓ 可执行 |
| yellow（emby 不通） | ✓ 可添加（乐观接单） | ✗ 执行会失败，等 Emby 恢复 |
| red | ✗ 无法添加 | ✗ — |

---

## 5. 实现要点

### 5.1 Emby 连通性缓存

`testConnection()` 结果在内存缓存 60s，避免健康检查高频请求 Emby。

```js
// 在 app.js 或 embyService 中
let embyHealthCache = { ok: false, serverName: '', ts: 0 };
const CACHE_TTL_MS = 60_000;

async function getEmbyHealth() {
  if (Date.now() - embyHealthCache.ts < CACHE_TTL_MS) return embyHealthCache;
  try {
    const result = await embyService.testConnection(config);
    embyHealthCache = { ok: true, serverName: result.serverName || '', ts: Date.now() };
  } catch {
    embyHealthCache = { ok: false, serverName: '', ts: Date.now() };
  }
  return embyHealthCache;
}
```

### 5.2 scheduler.isRunning()

`taskScheduler` 模块暴露 `isRunning()` 方法，返回定时器是否活跃。

### 5.3 现有调用方

| 调用方 | 用途 |
|--------|------|
| Tray supervisor | 托盘指示灯颜色 |
| Desktop health check | 媒体服务可达门禁 |
| Admin 页面 | 右上角 badge |

以上三方均使用 `healthy` 字段即可，无需感知具体检查项细节。

---

## 6. 与现有接口的关系

| 接口 | 变化 |
|------|------|
| `GET /v1/health` | 扩展响应结构，增加 `healthy` + `checks` |
| `GET /v1/admin/auth-status` | 不变 |
| `GET /v1/config` | 不变（desktop 仍需全量配置） |

---

## 7. 检验标准

- [ ] `GET /v1/health` 返回 `{ healthy, checks }` 结构
- [ ] 4项全 ok 时 `healthy === 'green'`
- [ ] Emby 不通但 config + scheduler ok 时 `healthy === 'yellow'`
- [ ] config 未填或 scheduler 停时 `healthy === 'red'`
- [ ] Tray 托盘灯正确反映 `healthy` 值
- [ ] Admin 页面 badge 正确反映 `healthy` 值
- [ ] Emby 连通性结果缓存 60s，避免频繁请求 Emby
