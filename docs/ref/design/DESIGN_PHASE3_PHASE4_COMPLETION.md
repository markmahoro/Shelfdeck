# DESIGN_PHASE3_PHASE4_COMPLETION — Phase 3 Gap + Phase 4 + 健康检查

> **状态**：设计中
> **关联**：architecture rethink / `PRJ_MANAGEMENT.md` / `DESIGN_SERVICE_HEALTH_CHECK.md`（健康检查已有设计文档）

---

## 1. 背景与目标

Phase 1（配置拆分 + 意图式任务 API）和 Phase 2（Service 端执行引擎）已完成。Phase 3（Web 管理页 + 托盘外壳）骨架已搭好但有关键 Gap。Phase 4（Desktop 瘦身）未开始。

本次实施目标：
- 完善 Phase 3 Web 管理页（健康检查 API + ConfigPage 可编辑 + 构建输出）
- 完成 Phase 4 Desktop 瘦身（导航改造 + 浮动任务圆钮 + 齿轮设置面板）
- 补全健康检查 API（`GET /v1/health` 扩展）

---

## 2. 实施范围

| 范围 | 内容 |
|------|------|
| Phase 3 Gap | 健康检查 API + ConfigPage 可编辑 + dist/admin 构建 |
| Phase 4 | Desktop 导航 + 浮动任务圆钮 + 齿轮设置面板 |
| 健康检查 | GET /v1/health 扩展 + taskScheduler.isRunning() |

---

## 3. Service 层改动

### 3.1 `GET /v1/health` 扩展

**响应格式：**
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

**4 项检查逻辑：**

| 检查项 | ok 条件 | 实现位置 |
|--------|---------|---------|
| service | Fastify server 已 listen | `app.js` 内部标志 `serverReady` |
| config | embyClient.baseUrl + apiKey + userId 均非空 | `app.js` `/v1/health` 处理器 |
| emby | embyService.testConnection() 返回 connected | `app.js`，结果缓存 60s |
| scheduler | taskScheduler.isRunning() === true | `app.js` 调用 taskScheduler |

**聚合算法：**
```js
okCount = [service, config, emby, scheduler].filter(x => x === 'ok').length
healthy = okCount >= 4 ? 'green' : okCount >= 2 ? 'yellow' : 'red'
```

**Emby 健康缓存：**
```js
// app.js 内
let embyHealthCache = { ok: false, ts: 0 };
const CACHE_TTL_MS = 60_000;
async function getEmbyHealth() {
  if (Date.now() - embyHealthCache.ts < CACHE_TTL_MS) return embyHealthCache;
  try {
    const result = await embyService.testConnection(embyConfig);
    embyHealthCache = { ok: true, ts: Date.now() };
  } catch {
    embyHealthCache = { ok: false, ts: Date.now() };
  }
  return embyHealthCache;
}
```

### 3.2 `taskScheduler.isRunning()`

在 `taskScheduler.js` 导出中新增：
```js
function isRunning() {
  return isRunning;
}
module.exports = { ..., isRunning };
```

### 3.3 app.js 健康检查路由

`GET /v1/health` 路由改造为：
```js
app.get('/v1/health', async (req, reply) => {
  const cfg = configStore.loadConfig();
  const embyConfig = cfg.embyClient || cfg;

  // service: serverReady 标志（listen 后设 true）
  const serviceOk = serverReady;

  // config: embyClient 三字段非空
  const configOk = !!(embyConfig.baseUrl && embyConfig.apiKey && embyConfig.userId);

  // emby: 带缓存的 testConnection
  const embyHealth = await getEmbyHealth(embyConfig);
  const embyOk = embyHealth.ok;

  // scheduler
  const schedulerOk = taskScheduler.isRunning();

  const checks = { service: serviceOk, config: configOk, emby: embyOk, scheduler: schedulerOk };
  const okCount = Object.values(checks).filter(Boolean).length;
  const healthy = okCount >= 4 ? 'green' : okCount >= 2 ? 'yellow' : 'red';

  return { status: 'ok', version: '0.1.0', healthy, checks };
});
```

---

## 4. Service Web 管理页 — ConfigPage 四个 Tab

### 4.1 Emby Tab

**配置流程：**
1. 输入 `baseUrl` + `apiKey`
2. 「获取用户列表」按钮 → 调用 `GET /v1/emby/actions/list-users` → 显示用户下拉框
3. 选择用户 → `userId` 填充（存 UUID）
4. 「获取媒体库」按钮 → 调用 `GET /v1/emby/actions/list-media-folders` → 显示 checkbox 列表
5. 选择媒体库 → `enabledSectionIds` 填充（存 ID 数组）
6. 可选填 `embyUserPassword`（用于换取 userToken）
7. 「测试连接」按钮 → 调用 `POST /v1/emby/actions/test-connection` → 显示成功/失败
8. 「保存」按钮 → `PATCH /v1/config` { embyClient, enabledSectionIds }

**EmbyClient 对象结构：**
```json
{
  "embyClient": {
    "baseUrl": "http://emby.example.com:8096",
    "apiKey": "xxx",
    "userId": "user-uuid",
    "embyUserPassword": ""
  },
  "enabledSectionIds": ["lib-id-1", "lib-id-2"]
}
```

### 4.2 Transcode Tab

**字段：** ffmpegPath, ffprobePath, transcodeTempRoot, transcodeReplaceConfirmRequired(checkbox), transcodeCpuParticipationStrategy(select: normal/backup-only)

**设备池配置流程：**
1. 填 ffmpegPath + ffprobePath
2. 「探测设备」按钮 → 调用 `POST /v1/transcode/actions/probe-encode-devices` → 返回设备列表
3. 设备列表显示：label + stableKey + inPool(checkbox) + maxSlots(number)
4. 用户勾选入池设备 + 设置并发数
5. 保存 → `PATCH /v1/config` { transcodeEncodePool: { entries, cpuParticipation } }

**transcodeEncodePool 结构：**
```json
{
  "transcodeEncodePool": {
    "entries": [
      { "stableKey": "cpu:libx265", "label": "CPU · libx265", "inPool": true, "priority": 1, "maxSlots": 2 },
      { "stableKey": "nvenc:0", "label": "NVIDIA NVENC（CUDA 0）", "inPool": true, "priority": 0, "maxSlots": 1 }
    ],
    "cpuParticipation": "normal"
  }
}
```

### 4.3 Scheduler Tab

**字段：**
- executionMode: select (manual / scheduled)
- deleteConcurrency: number (1-10)
- transcodeConcurrency: number (1-10)
- upgradeConcurrency: number (1-10)

保存 → `PATCH /v1/config` { executionMode, deleteConcurrency, transcodeConcurrency, upgradeConcurrency }

### 4.4 码率策略 Tab（新增）

**结构：**
```json
{
  "mediaPolicy": {
    "target1080p": { "3": 4, "4": 7, "5": 12 },
    "target4k": { "3": 10, "4": 16, "5": 25 }
  }
}
```

**UI：** 两个阶梯表，星级 3/4/5 各一个 GB 输入框，保存到 mediaPolicy

---

## 5. Desktop 导航改造

### 5.1 顶部导航

```
[海报墙]  [媒体库管理]  [播放记录]    ⚙
```

**移除：** 配置中心 tab、任务中心 tab

### 5.2 移除的页面文件

待删除：
- `media-desktop/src/pages/ConfigCenterPage.tsx`（或相关配置中心组件）
- `media-desktop/src/pages/TaskCenterPage.tsx`（相关任务中心组件）

### 5.3 保留的页面

- 海报墙
- 媒体库管理
- 播放记录

---

## 6. Desktop 浮动任务圆钮

### 6.1 位置与形态

**位置：** 右下角固定 `position: fixed; bottom: 24px; right: 24px; z-index: 9999`

**收起状态：** 小圆钮（40x40px），有任务时显示数字角标 `[●3]`

**展开状态（点击）：** 弹出面板（约 320px 宽，屏幕下半 1/3 高）

### 6.2 展开面板内容

```
━━━━━━━━━━━━━━━ 进行中 ━━━━━━━━━━━━━━━
🎬 文件名.mkv  转码中  45%
📺 文件名2.mkv  删除中  --

━━━━━━━━━━━━━━━ 最近完成 ━━━━━━━━━━━━━━
✅ 文件名3.mkv  已完成
❌ 文件名4.mkv  失败

在浏览器中查看完整任务中心 →（链接到 service web 管理页）
```

### 6.3 数据来源

轮询 `GET /v1/tasks`，筛选 `status !== 'done' && status !== 'failed_hard'` 为进行中，取 `done` 排序后最近 3 条为最近完成。

### 6.4 实现位置

新建 `FloatingTaskButton.tsx`，放在 `App.tsx` 根级别，作为全局浮层。

---

## 7. Desktop 齿轮设置面板

### 7.1 触发方式

点击右上角 ⚙ 图标打开面板，点击外部或 X 按钮关闭。

### 7.2 面板内容

| 字段 | 类型 | 默认值 |
|------|------|--------|
| serviceUrl | text | http://127.0.0.1:18080 |
| serviceApiKey | password | （空） |
| playerExePath | text | （空） |
| localPathMapFrom | text | （空） |
| localPathMapTo | text | （空） |

### 7.3 持久化

**electron-store**，存在 Windows `%APPDATA%` 或 macOS `~/Library/Application Support`。

配置 key：`desktopSettings`

### 7.4 实现位置

新建 `SettingsPanel.tsx`，放在 `App.tsx` 根级别，gear 图标放在顶部导航右侧。

---

## 8. Desktop 任务发起

### 8.1 发起方式

海报墙和媒体库管理页面点击「转码」「删除」等按钮时：
- 调用 `POST /v1/tasks` { itemId, actionType, runMode }
- runMode 由当前 executionMode 决定（manual: `pending_manual`，scheduled: `queued`）

### 8.2 错误处理

蓝光拒绝 → 409 `BLURAY_DISC_REJECTED` → 弹窗提示
互斥冲突 → 409 `ITEM_TASK_CONFLICT` → 弹窗提示
其他错误 → 显示 service 返回的 message

### 8.3 前端不做预校验

蓝光检查、互斥检查均由 service 端完成，前端只发意图。

---

## 9. 实施顺序

```
Phase 3 Gap:
  1. taskScheduler.isRunning()              — taskScheduler.js
  2. GET /v1/health 扩展                   — app.js
  3. Dashboard 适配 health checks          — DashboardPage.tsx
  4. ConfigPage Emby Tab（完整流程）       — ConfigPage.tsx
  5. ConfigPage Transcode Tab（设备池）     — ConfigPage.tsx
  6. ConfigPage Scheduler Tab              — ConfigPage.tsx
  7. ConfigPage 码率策略 Tab（新增）       — ConfigPage.tsx
  8. 构建 dist/admin                      — cd media-service/web && npm run build

Phase 4:
  9. App.tsx 导航改造（3 tab + 齿轮）      — App.tsx
  10. 浮动任务圆钮组件                     — FloatingTaskButton.tsx
  11. 齿轮设置面板组件                     — SettingsPanel.tsx + electron-store
  12. 移除配置中心/任务中心页面            — 删除文件
  13. 废弃 connection.json，切换到 electron-store — desktop 连接逻辑
```

---

## 10. 检验标准

- [ ] `GET /v1/health` 返回 `{ healthy, checks }` 结构
- [ ] 4 项全 ok 时 `healthy === 'green'`
- [ ] Emby 不通但 config + scheduler ok 时 `healthy === 'yellow'`
- [ ] config 未填或 scheduler 停时 `healthy === 'red'`
- [ ] Emby 连通性结果缓存 60s
- [ ] ConfigPage Emby Tab 可完整配置（地址 → 用户列表 → 媒体库 → 测试 → 保存）
- [ ] ConfigPage Transcode Tab 可探测设备并配置入池
- [ ] ConfigPage Scheduler Tab 可保存调度设置
- [ ] ConfigPage 码率策略 Tab 可编辑 mediaPolicy
- [ ] web 管理页构建到 dist/admin，Fastify 可托管
- [ ] Desktop 导航变为 3 tab + 齿轮
- [ ] 浮动任务圆钮显示进行中任务数和最近完成
- [ ] 齿轮设置面板可编辑并持久化 serviceUrl / playerExePath / localPathMap
- [ ] Desktop 任务发起走意图式 API，service 409 时展示错误
