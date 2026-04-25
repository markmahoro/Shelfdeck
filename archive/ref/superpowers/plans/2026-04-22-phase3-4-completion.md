# Phase 3 Gap + Phase 4 + 健康检查 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 Phase 3 Web 管理页完善（健康检查 API + ConfigPage 可编辑 + 构建）+ Phase 4 Desktop 瘦身（导航 + 浮动任务圆钮 + 齿轮设置面板）

**Architecture:**
- Service 层：扩展 `/v1/health` 返回四项检查 + `taskScheduler.isRunning()`；ConfigPage 四个 Tab 完整可编辑
- Desktop 层：App.tsx 改导航 + 新建 FloatingTaskButton + 新建 SettingsPanel（electron-store 持久化）
- Web 管理页构建到 `dist/admin/` 由 Fastify 托管

**Tech Stack:** Node.js/Fastify (service), React/Vite (web), Electron (desktop), electron-store (desktop 本地持久化)

---

## File Map

### Service Layer (media-service/src/)
- `app.js` — GET /v1/health 扩展，新增 emby 健康缓存
- `taskScheduler.js` — 导出 isRunning()

### Web Admin (media-service/web/src/)
- `pages/ConfigPage.tsx` — 四个 Tab 重写为可编辑
- `pages/DashboardPage.tsx` — health checks 适配
- `api/client.ts` — 新增 probeEncodeDevices / listUsers / listMediaFolders API 封装
- `types/index.ts` — HealthStatus 类型扩展

### Desktop (media-desktop/src/)
- `App.tsx` — 导航改造（3 tab + 齿轮）
- `FloatingTaskButton.tsx` — 新建，浮动任务圆钮
- `SettingsPanel.tsx` — 新建，齿轮设置面板
- `cpBase.ts` — electron-store 读写
- `electron/main.js` 或 `electron/preload.js` — electron-store IPC 暴露
- 待删除：`pages/ConfigCenterPage.tsx`（确认实际文件名）, `pages/TaskCenterPage.tsx`

---

## Phase 3 — Service 层

### Task 1: taskScheduler.isRunning()

**Files:**
- Modify: `media-service/src/taskScheduler.js:107-111`

- [ ] **Step 1: 检查当前导出**

```bash
node --check media-service/src/taskScheduler.js
```
确认无语法错误

- [ ] **Step 2: 在 module.exports 追加 isRunning**

在 `taskScheduler.js` 末尾 `module.exports = { startScheduler, stopScheduler, scheduleTasks };` 改为：

```js
function isRunning() {
  return isRunning;
}

module.exports = {
  startScheduler,
  stopScheduler,
  scheduleTasks,
  isRunning,
};
```

- [ ] **Step 3: 验证**

```bash
node -e "const ts = require('./media-service/src/taskScheduler'); console.log('isRunning:', typeof ts.isRunning)"
```
Expected: `isRunning: function`

- [ ] **Step 4: Commit**

```bash
git add media-service/src/taskScheduler.js
git commit -m "feat(scheduler): expose isRunning() method

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: GET /v1/health 扩展

**Files:**
- Modify: `media-service/src/app.js:51` — 改造现有 `/v1/health` 路由
- Modify: `media-service/src/app.js` — 新增 embyHealthCache 缓存

- [ ] **Step 1: 在 app.js 顶部（现有常量和 adminSessions 之间）添加 emby 健康缓存**

```js
// Emby 健康检查缓存（60s TTL）
const embyHealthCache = { ok: false, ts: 0 };
const EMBY_CACHE_TTL_MS = 60_000;

async function getEmbyHealth(embyConfig) {
  if (Date.now() - embyHealthCache.ts < EMBY_CACHE_TTL_MS) {
    return embyHealthCache;
  }
  try {
    await embyService.testConnection(embyConfig);
    embyHealthCache.ok = true;
    embyHealthCache.ts = Date.now();
  } catch {
    embyHealthCache.ok = false;
    embyHealthCache.ts = Date.now();
  }
  return embyHealthCache;
}
```

- [ ] **Step 2: 改造 GET /v1/health 路由（现有 `app.get('/v1/health')` 在第 51 行）**

将：
```js
app.get('/v1/health', async () => ({ status: 'ok', version: '0.1.0' }));
```
替换为：
```js
app.get('/v1/health', async (req, reply) => {
  const cfg = configStore.loadConfig();
  const embyConfig = cfg.embyClient || cfg;

  const serviceOk = serverReady;
  const configOk = !!(embyConfig.baseUrl && embyConfig.apiKey && embyConfig.userId);
  const embyHealth = await getEmbyHealth(embyConfig);
  const embyOk = embyHealth.ok;
  const schedulerOk = taskScheduler.isRunning();

  const checks = {
    service: serviceOk ? 'ok' : 'error',
    config: configOk ? 'ok' : 'error',
    emby: embyOk ? 'ok' : 'error',
    scheduler: schedulerOk ? 'ok' : 'error',
  };
  const okCount = Object.values(checks).filter(v => v === 'ok').length;
  const healthy = okCount >= 4 ? 'green' : okCount >= 2 ? 'yellow' : 'red';

  return { status: 'ok', version: '0.1.0', healthy, checks };
});
```

注：`serverReady` 需在 Fastify server listen 后设为 true。找到 `buildApp` 中 `app.listen` 的位置，在 `await app.listen()` 成功后添加 `serverReady = true`。

- [ ] **Step 3: 验证语法**

```bash
node --check media-service/src/app.js
```
Expected: 无输出（成功）

- [ ] **Step 4: 验证逻辑**

启动 service 后：
```bash
curl -s http://127.0.0.1:18080/v1/health | python3 -m json.tool
```
Expected: 包含 `healthy` 和 `checks` 字段

- [ ] **Step 5: Commit**

```bash
git add media-service/src/app.js
git commit -m "feat(health): extend GET /v1/health with four checks and aggregation

- Add embyHealthCache with 60s TTL
- Return { healthy, checks } structure
- Aggregate: green >= 4 ok, yellow >= 2 ok, else red

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: HealthStatus 类型扩展

**Files:**
- Modify: `media-service/web/src/types/index.ts`

- [ ] **Step 1: 替换 HealthStatus 接口**

将：
```ts
export interface HealthStatus {
  status: 'ok' | 'degraded' | 'unhealthy';
  version?: string;
}
```
替换为：
```ts
export interface HealthCheckResult {
  service: 'ok' | 'error';
  config: 'ok' | 'error';
  emby: 'ok' | 'error';
  scheduler: 'ok' | 'error';
}

export interface HealthStatus {
  status: 'ok';
  version: string;
  healthy: 'green' | 'yellow' | 'red';
  checks: HealthCheckResult;
}
```

- [ ] **Step 2: Commit**

```bash
git add media-service/web/src/types/index.ts
git commit -m "types: extend HealthStatus with healthy and checks fields

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: DashboardPage 适配 health checks

**Files:**
- Modify: `media-service/web/src/pages/DashboardPage.tsx:66-93`

- [ ] **Step 1: 更新 STATUS_COLOR 映射**

将：
```ts
const STATUS_COLOR: Record<string, string> = {
  ok: '#27ae60',
  degraded: '#f39c12',
  unhealthy: '#e53',
};
```
替换为：
```ts
const HEALTHY_COLOR: Record<string, string> = {
  green: '#27ae60',
  yellow: '#f39c12',
  red: '#e53',
};
```

- [ ] **Step 2: 更新 healthData 显示逻辑**

将 `healthData?.status` 相关逻辑替换为使用 `healthy` 字段：

```tsx
const healthColor = HEALTHY_COLOR[healthData?.healthy ?? 'red'];
const healthLabel =
  healthData?.healthy === 'green' ? '正常' :
  healthData?.healthy === 'yellow' ? '降级' : '异常';
```

- [ ] **Step 3: Commit**

```bash
git add media-service/web/src/pages/DashboardPage.tsx
git commit -m "feat(admin): use healthy/checks from extended GET /v1/health

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: ConfigPage API 封装扩展

**Files:**
- Modify: `media-service/web/src/api/client.ts`

- [ ] **Step 1: 添加 listUsers 和 listMediaFolders 到 emby client**

在 emby 对象末尾添加：

```ts
listUsers: (body: { baseUrl: string; apiKey: string }) =>
  fetch('/v1/emby/actions/list-users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-session': sessionStorage.getItem('admin_session') || '',
    },
    body: JSON.stringify(body),
  }).then((r) => r.json() as Promise<Array<{ id: string; name: string }>>),

listMediaFolders: (body: { baseUrl: string; apiKey: string }) =>
  fetch('/v1/emby/actions/list-media-folders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-session': sessionStorage.getItem('admin_session') || '',
    },
    body: JSON.stringify(body),
  }).then((r) => r.json() as Promise<Array<{ id: string; name: string }>>),
```

- [ ] **Step 2: 添加 probeEncodeDevices 到 health client**

在 `transcodeService` 相关调用区域添加：

```ts
export const transcode = {
  probeEncodeDevices: (body: { config: { ffmpegPath: string; ffprobePath: string } }) =>
    fetch('/v1/transcode/actions/probe-encode-devices', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-session': sessionStorage.getItem('admin_session') || '',
      },
      body: JSON.stringify(body),
    }).then((r) => r.json()),
};
```

- [ ] **Step 3: Commit**

```bash
git add media-service/web/src/api/client.ts
git commit -m "api: add listUsers, listMediaFolders, probeEncodeDevices

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: ConfigPage Emby Tab（完整可编辑流程）

**Files:**
- Modify: `media-service/web/src/pages/ConfigPage.tsx` — 整个文件重写

- [ ] **Step 1: 完全重写 ConfigPage.tsx**

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { config, emby } from '../api/client';
import type { ServiceConfig } from '../types';

type Tab = 'emby' | 'transcode' | 'scheduler' | 'policy';

// ... 复用现有样式常量 ...

export default function ConfigPage() {
  const [tab, setTab] = useState<Tab>('emby');
  const qc = useQueryClient();

  const { data: cfg } = useQuery<ServiceConfig>({
    queryKey: ['config'],
    queryFn: config.get,
  });

  const embyCfg = cfg?.embyClient;
  const enabledSections: string[] = cfg?.enabledSectionIds || [];

  // Emby tab state
  const [baseUrl, setBaseUrl] = useState(embyCfg?.baseUrl || cfg?.baseUrl || '');
  const [apiKey, setApiKey] = useState(embyCfg?.apiKey || cfg?.apiKey || '');
  const [userId, setUserId] = useState(embyCfg?.userId || cfg?.userId || '');
  const [embyUserPassword, setEmbyUserPassword] = useState(embyCfg?.embyUserPassword || '');
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([]);
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedSections, setSelectedSections] = useState<string[]>(enabledSections);
  const [testMsg, setTestMsg] = useState('');
  const [testLoading, setTestLoading] = useState(false);

  const saveMutation = useMutation({
    mutationFn: (patch: Partial<ServiceConfig>) => config.patch(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  });

  const handleFetchUsers = async () => {
    if (!baseUrl || !apiKey) return;
    setTestLoading(true);
    try {
      const list = await emby.listUsers({ baseUrl, apiKey });
      setUsers(list);
    } catch (e: any) {
      setTestMsg('获取用户列表失败: ' + e.message);
    } finally {
      setTestLoading(false);
    }
  };

  const handleFetchFolders = async () => {
    if (!baseUrl || !apiKey) return;
    setTestLoading(true);
    try {
      const list = await emby.listMediaFolders({ baseUrl, apiKey });
      setFolders(list);
    } catch (e: any) {
      setTestMsg('获取媒体库失败: ' + e.message);
    } finally {
      setTestLoading(false);
    }
  };

  const handleTest = async () => {
    if (!baseUrl || !apiKey) return;
    setTestLoading(true);
    try {
      const res = await emby.testConnection({ baseUrl, apiKey, userId });
      setTestMsg(res.ok ? '连接成功' : (res.message || '连接失败'));
    } catch (e: any) {
      setTestMsg('连接失败: ' + e.message);
    } finally {
      setTestLoading(false);
    }
  };

  const handleSave = () => {
    saveMutation.mutate({
      embyClient: { baseUrl, apiKey, userId, embyUserPassword },
      enabledSectionIds: selectedSections,
    });
  };

  const saveOk = saveMutation.isSuccess;
  if (saveOk) setTimeout(() => saveMutation.reset(), 2000);

  // ... render ...
}
```

完整 Emby Tab JSX（在 `tab === 'emby'` 条件分支）：

```tsx
{tab === 'emby' && (
  <div style={CARD}>
    <h3 style={SECTION_TITLE}>Emby 连接配置</h3>
    <div style={FORM_GRID}>
      <label style={LABEL}>Emby 地址</label>
      <input style={INPUT} value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="http://emby.example.com:8096" />
      <label style={LABEL}>API Key</label>
      <input style={INPUT} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="xxxxxxxxxxxx" />
      <label style={LABEL}>用户密码（可选）</label>
      <input style={INPUT} type="password" value={embyUserPassword} onChange={e => setEmbyUserPassword(e.target.value)} placeholder="用于获取用户令牌" />
    </div>
    <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
      <button style={BTN_OUTLINE} onClick={handleFetchUsers} disabled={testLoading}>
        {testLoading ? '加载中...' : '获取用户列表'}
      </button>
      <button style={BTN_OUTLINE} onClick={handleFetchFolders} disabled={testLoading}>
        获取媒体库
      </button>
    </div>

    {users.length > 0 && (
      <div style={{ marginBottom: '16px' }}>
        <label style={LABEL}>选择用户</label>
        <select style={INPUT} value={userId} onChange={e => setUserId(e.target.value)}>
          <option value="">-- 请选择 --</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>
    )}

    {folders.length > 0 && (
      <div style={{ marginBottom: '16px' }}>
        <label style={LABEL}>选择媒体库（可多选）</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {folders.map(f => (
            <label key={f.id} style={{ display: 'flex', gap: '8px', fontSize: '14px' }}>
              <input
                type="checkbox"
                checked={selectedSections.includes(f.id)}
                onChange={e => {
                  if (e.target.checked) {
                    setSelectedSections(prev => [...prev, f.id]);
                  } else {
                    setSelectedSections(prev => prev.filter(id => id !== f.id));
                  }
                }}
              />
              {f.name}
            </label>
          ))}
        </div>
      </div>
    )}

    <div style={{ display: 'flex', gap: '8px' }}>
      <button style={BTN_OUTLINE} onClick={handleTest} disabled={testLoading || !baseUrl || !apiKey}>
        {testLoading ? '测试中...' : '测试连接'}
      </button>
      <button style={BTN_PRIMARY} onClick={handleSave} disabled={saveMutation.isPending}>
        {saveMutation.isPending ? '保存中...' : '保存'}
      </button>
    </div>
    {testMsg && <div style={{ marginTop: '12px', color: testMsg.includes('成功') ? '#27ae60' : '#e53', fontSize: '13px' }}>{testMsg}</div>}
    {saveOk && <div style={{ marginTop: '12px', color: '#27ae60', fontSize: '13px' }}>保存成功</div>}
  </div>
)}
```

- [ ] **Step 2: Commit**

```bash
git add media-service/web/src/pages/ConfigPage.tsx
git commit -m "feat(admin): implement editable Emby tab with user/media-folder selection

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: ConfigPage Transcode Tab（设备池）

**Files:**
- Modify: `media-service/web/src/pages/ConfigPage.tsx` — 添加 Transcode Tab

- [ ] **Step 1: 添加 Transcode Tab state 和 handlers**

在组件内添加：
```tsx
const [ffmpegPath, setFfmpegPath] = useState(cfg?.ffmpegPath || 'ffmpeg');
const [ffprobePath, setFfprobePath] = useState(cfg?.ffprobePath || 'ffprobe');
const [transcodeTempRoot, setTranscodeTempRoot] = useState(cfg?.transcodeTempRoot || '');
const [transcodeReplaceConfirmRequired, setTranscodeReplaceConfirmRequired] = useState(!!cfg?.transcodeReplaceConfirmRequired);
const [transcodeCpuParticipationStrategy, setTranscodeCpuParticipationStrategy] = useState(cfg?.transcodeCpuParticipationStrategy || 'normal');
const [probeResult, setProbeResult] = useState<any>(null);
const [poolEntries, setPoolEntries] = useState<Array<any>>([]);
const [probeLoading, setProbeLoading] = useState(false);

const handleProbeDevices = async () => {
  if (!ffmpegPath) return;
  setProbeLoading(true);
  try {
    const res = await transcode.probeEncodeDevices({ config: { ffmpegPath, ffprobePath } });
    setProbeResult(res);
    const existing = cfg?.transcodeEncodePool?.entries || [];
    setPoolEntries(res.devices.map((d: any) => {
      const prev = existing.find((e: any) => e.stableKey === d.stableKey);
      return { ...d, inPool: prev?.inPool ?? false, priority: prev?.priority ?? 0, maxSlots: prev?.maxSlots ?? 1 };
    }));
  } catch (e: any) {
    setTestMsg('探测失败: ' + e.message);
  } finally {
    setProbeLoading(false);
  }
};

const handleSaveTranscode = () => {
  const entries = poolEntries.filter(e => e.inPool).map((e, i) => ({
    stableKey: e.stableKey,
    label: e.label,
    inPool: true,
    priority: e.priority ?? i,
    maxSlots: e.maxSlots ?? 1,
  }));
  saveMutation.mutate({
    ffmpegPath,
    ffprobePath,
    transcodeTempRoot,
    transcodeReplaceConfirmRequired,
    transcodeCpuParticipationStrategy,
    transcodeEncodePool: { entries, cpuParticipation: transcodeCpuParticipationStrategy },
  });
};
```

- [ ] **Step 2: 添加 Transcode Tab JSX**

```tsx
{tab === 'transcode' && (
  <div style={CARD}>
    <h3 style={SECTION_TITLE}>转码设置</h3>
    <div style={FORM_GRID}>
      <label style={LABEL}>FFmpeg 路径</label>
      <input style={INPUT} value={ffmpegPath} onChange={e => setFfmpegPath(e.target.value)} placeholder="ffmpeg" />
      <label style={LABEL}>FFprobe 路径</label>
      <input style={INPUT} value={ffprobePath} onChange={e => setFfprobePath(e.target.value)} placeholder="ffprobe" />
      <label style={LABEL}>临时目录</label>
      <input style={INPUT} value={transcodeTempRoot} onChange={e => setTranscodeTempRoot(e.target.value)} placeholder="D:\\transcode_temp" />
      <label style={LABEL}>CPU 参与策略</label>
      <select style={INPUT} value={transcodeCpuParticipationStrategy} onChange={e => setTranscodeCpuParticipationStrategy(e.target.value)}>
        <option value="normal">normal</option>
        <option value="backup-only">backup-only</option>
      </select>
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input type="checkbox" checked={transcodeReplaceConfirmRequired} onChange={e => setTranscodeReplaceConfirmRequired(e.target.checked)} />
        替换前需用户确认
      </label>
    </div>

    <button style={{ ...BTN_OUTLINE, marginBottom: '16px' }} onClick={handleProbeDevices} disabled={probeLoading || !ffmpegPath}>
      {probeLoading ? '探测中...' : '探测设备'}
    </button>

    {poolEntries.length > 0 && (
      <div style={{ marginBottom: '16px' }}>
        <label style={LABEL}>编码设备池</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {poolEntries.map((entry, i) => (
            <div key={entry.stableKey} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 80px 80px 40px', gap: '8px', alignItems: 'center', background: '#f9fafb', padding: '8px', borderRadius: '6px' }}>
              <input type="checkbox" checked={entry.inPool} onChange={e => {
                const updated = [...poolEntries];
                updated[i] = { ...updated[i], inPool: e.target.checked };
                setPoolEntries(updated);
              }} />
              <span style={{ fontSize: '14px' }}>{entry.label || entry.stableKey}</span>
              <input type="number" min={1} max={10} value={entry.maxSlots} onChange={e => {
                const updated = [...poolEntries];
                updated[i] = { ...updated[i], maxSlots: parseInt(e.target.value) || 1 };
                setPoolEntries(updated);
              }} style={{ ...INPUT, width: '70px' }} />
              <select value={entry.priority} onChange={e => {
                const updated = [...poolEntries];
                updated[i] = { ...updated[i], priority: parseInt(e.target.value) };
                setPoolEntries(updated);
              }} style={{ ...INPUT, width: '80px' }}>
                {[...Array(poolEntries.filter(e => e.inPool).length + 1).keys()].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e53' }} onClick={() => {
                const updated = [...poolEntries];
                updated[i] = { ...updated[i], inPool: false };
                setPoolEntries(updated);
              }}>×</button>
            </div>
          ))}
        </div>
      </div>
    )}

    <button style={BTN_PRIMARY} onClick={handleSaveTranscode} disabled={saveMutation.isPending}>
      {saveMutation.isPending ? '保存中...' : '保存'}
    </button>
    {saveOk && <span style={{ marginLeft: '12px', color: '#27ae60', fontSize: '13px' }}>保存成功</span>}
  </div>
)}
```

- [ ] **Step 2: Commit**

```bash
git add media-service/web/src/pages/ConfigPage.tsx
git commit -m "feat(admin): implement editable Transcode tab with device pool probing

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: ConfigPage Scheduler Tab + 码率策略 Tab

**Files:**
- Modify: `media-service/web/src/pages/ConfigPage.tsx` — 添加两个新 Tab

- [ ] **Step 1: 添加 Scheduler Tab JSX**

```tsx
{tab === 'scheduler' && (
  <div style={CARD}>
    <h3 style={SECTION_TITLE}>调度设置</h3>
    <div style={FORM_GRID}>
      <label style={LABEL}>执行模式</label>
      <select style={INPUT} value={cfg?.executionMode || 'manual'} onChange={e => saveMutation.mutate({ executionMode: e.target.value })}>
        <option value="manual">手动</option>
        <option value="scheduled">自动调度</option>
      </select>
      <label style={LABEL}>删除并发数</label>
      <input style={INPUT} type="number" min={1} max={10} value={cfg?.deleteConcurrency ?? 1} onChange={e => saveMutation.mutate({ deleteConcurrency: parseInt(e.target.value) || 1 })} />
      <label style={LABEL}>转码并发数</label>
      <input style={INPUT} type="number" min={1} max={10} value={cfg?.transcodeConcurrency ?? 1} onChange={e => saveMutation.mutate({ transcodeConcurrency: parseInt(e.target.value) || 1 })} />
      <label style={LABEL}>升级并发数</label>
      <input style={INPUT} type="number" min={1} max={10} value={cfg?.upgradeConcurrency ?? 1} onChange={e => saveMutation.mutate({ upgradeConcurrency: parseInt(e.target.value) || 1 })} />
    </div>
    {saveOk && <span style={{ color: '#27ae60', fontSize: '13px' }}>保存成功</span>}
  </div>
)}
```

- [ ] **Step 2: 添加码率策略 Tab JSX**

```tsx
{tab === 'policy' && (
  <div style={CARD}>
    <h3 style={SECTION_TITLE}>码率策略</h3>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '16px' }}>
      <div>
        <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>1080p 目标文件大小（GB）</h4>
        {['3', '4', '5'].map(star => (
          <div key={star} style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
            <label style={{ fontSize: '14px' }}>★ {star} 星</label>
            <input
              style={INPUT}
              type="number"
              min={0.5}
              step={0.5}
              value={cfg?.mediaPolicy?.target1080p?.[star] ?? ''}
              onChange={e => {
                const val = parseFloat(e.target.value);
                const new1080 = { ...(cfg?.mediaPolicy?.target1080p || {}), [star]: val };
                saveMutation.mutate({ mediaPolicy: { ...(cfg?.mediaPolicy || {}), target1080p: new1080 } });
              }}
            />
          </div>
        ))}
      </div>
      <div>
        <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>4K 目标文件大小（GB）</h4>
        {['3', '4', '5'].map(star => (
          <div key={star} style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
            <label style={{ fontSize: '14px' }}>★ {star} 星</label>
            <input
              style={INPUT}
              type="number"
              min={0.5}
              step={0.5}
              value={cfg?.mediaPolicy?.target4k?.[star] ?? ''}
              onChange={e => {
                const val = parseFloat(e.target.value);
                const new4k = { ...(cfg?.mediaPolicy?.target4k || {}), [star]: val };
                saveMutation.mutate({ mediaPolicy: { ...(cfg?.mediaPolicy || {}), target4k: new4k } });
              }}
            />
          </div>
        ))}
      </div>
    </div>
    {saveOk && <span style={{ color: '#27ae60', fontSize: '13px' }}>保存成功</span>}
  </div>
)}
```

- [ ] **Step 3: 在 tab nav 中添加 Scheduler 和 Policy 按钮**

在 TAB_NAV 区域添加：
```tsx
{(['emby', 'transcode', 'scheduler', 'policy'] as Tab[]).map(t => (
  <button key={t} style={tab === t ? TAB_BTN_ACTIVE : TAB_BTN} onClick={() => setTab(t)}>
    {t === 'emby' ? '📺 Emby 连接' : t === 'transcode' ? '🎬 转码设置' : t === 'scheduler' ? '⏰ 调度设置' : '📊 码率策略'}
  </button>
))}
```

- [ ] **Step 4: Commit**

```bash
git add media-service/web/src/pages/ConfigPage.tsx
git commit -m "feat(admin): add Scheduler tab and 码率策略 tab to ConfigPage

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 9: 构建 dist/admin

**Files:**
- Modify: `media-service/package.json` — 添加 build 脚本（如需要）

- [ ] **Step 1: 确认 web 构建脚本存在**

检查 `media-service/web/package.json` 有 `"build": "tsc && vite build"`

- [ ] **Step 2: 构建**

```bash
cd media-service/web && npm run build
```

- [ ] **Step 3: 确认输出存在**

```bash
ls media-service/dist/admin/
```
Expected: 包含 index.html 和 assets/

- [ ] **Step 4: Commit**

```bash
git add media-service/dist/
git commit -m "build(admin): generate dist/admin from web Vite project

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 4 — Desktop 端

### Task 10: Desktop App.tsx 导航改造

**Files:**
- Modify: `media-desktop/src/App.tsx` — 导航部分改造

- [ ] **Step 1: 确认当前导航结构**

搜索 App.tsx 中现有的 tab 导航相关代码（搜索 `tab` 或 `navigate`）

- [ ] **Step 2: 改造为 3 tab + 齿轮图标**

将现有 5 tab 导航改为：
```tsx
<div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #eee', padding: '0 16px' }}>
  {['poster', 'library', 'records'].map(tab => (
    <button
      key={tab}
      style={{
        padding: '12px 16px',
        background: 'none',
        border: 'none',
        borderBottom: activeTab === tab ? '2px solid #4a90d9' : '2px solid transparent',
        cursor: 'pointer',
        color: activeTab === tab ? '#4a90d9' : '#666',
        fontWeight: 600,
      }}
      onClick={() => setActiveTab(tab)}
    >
      {tab === 'poster' ? '海报墙' : tab === 'library' ? '媒体库管理' : '播放记录'}
    </button>
  ))}
  <div style={{ marginLeft: 'auto' }}>
    <button onClick={() => setShowSettings(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px' }}>⚙</button>
  </div>
</div>
```

- [ ] **Step 3: 确认 Gear 和 FloatingTaskButton 挂载点存在**

在 App return JSX 中，确保 gear button 和 `<FloatingTaskButton />` 在根级别（不在某个 tab 内）

- [ ] **Step 4: Commit**

```bash
git add media-desktop/src/App.tsx
git commit -m "feat(desktop): reduce navigation to 3 tabs + gear icon

Removes config center and task center tabs.
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 11: FloatingTaskButton 组件

**Files:**
- Create: `media-desktop/src/components/FloatingTaskButton.tsx`

- [ ] **Step 1: 创建组件**

```tsx
import { useState, useEffect } from 'react';
import { tasks } from '../apiClient';

const BTN: React.CSSProperties = {
  position: 'fixed',
  bottom: '24px',
  right: '24px',
  width: '48px',
  height: '48px',
  borderRadius: '50%',
  background: '#4a90d9',
  border: 'none',
  cursor: 'pointer',
  fontSize: '18px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
  zIndex: 9999,
};

const PANEL: React.CSSProperties = {
  position: 'fixed',
  bottom: '80px',
  right: '24px',
  width: '320px',
  background: '#fff',
  borderRadius: '12px',
  boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
  padding: '16px',
  zIndex: 9999,
};

const SECTION: React.CSSProperties = {
  marginBottom: '12px',
};

const SECTION_TITLE: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: '#888',
  marginBottom: '8px',
  textTransform: 'uppercase',
};

export default function FloatingTaskButton() {
  const [open, setOpen] = useState(false);
  const [activeTasks, setActiveTasks] = useState<any[]>([]);
  const [recentDone, setRecentDone] = useState<any[]>([]);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const all = await tasks.list();
        setActiveTasks(all.filter((t: any) => !['done', 'failed_hard'].includes(t.status)));
        setRecentDone(
          all
            .filter((t: any) => t.status === 'done')
            .sort((a: any, b: any) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
            .slice(0, 3)
        );
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  if (activeTasks.length === 0) return null;

  return (
    <>
      <button style={BTN} onClick={() => setOpen(!open)}>
        {activeTasks.length}
      </button>
      {open && (
        <div style={PANEL}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ fontWeight: 600 }}>任务状态</span>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px' }}>×</button>
          </div>

          <div style={SECTION}>
            <div style={SECTION_TITLE}>进行中</div>
            {activeTasks.slice(0, 5).map(t => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                <span>{t.itemName || t.itemId}</span>
                <span style={{ color: '#4a90d9' }}>{t.progress ?? 0}%</span>
              </div>
            ))}
          </div>

          <div style={SECTION}>
            <div style={SECTION_TITLE}>最近完成</div>
            {recentDone.map(t => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                <span>{t.itemName || t.itemId}</span>
                <span style={{ color: '#27ae60' }}>✅</span>
              </div>
            ))}
          </div>

          <a
            href="http://127.0.0.1:18080/admin"
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '13px', color: '#4a90d9', textDecoration: 'none' }}
          >
            在浏览器中查看完整任务中心 →
          </a>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add media-desktop/src/components/FloatingTaskButton.tsx
git commit -m "feat(desktop): add floating task button component

Shows active task count badge, expands to panel with in-progress and recent tasks.
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 12: SettingsPanel + electron-store

**Files:**
- Create: `media-desktop/src/components/SettingsPanel.tsx`
- Modify: `media-desktop/electron/main.js` — 添加 IPC handler
- Modify: `media-desktop/electron/preload.js` — 暴露 electron-store API

- [ ] **Step 1: 检查 desktop 是否已安装 electron-store**

```bash
grep electron-store media-desktop/package.json
```
如果没有，添加到 dependencies：
```bash
cd media-desktop && npm install electron-store
```

- [ ] **Step 2: 在 main.js 添加 electron-store IPC handler**

在 main.js 中（在现有 ipcMain handlers 附近）添加：
```js
const Store = require('electron-store');
const store = new Store({ name: 'desktop-settings' });

// Get settings
ipcMain.handle('settings:get', () => store.store);

// Set setting
ipcMain.handle('settings:set', (event, key, value) => {
  store.set(key, value);
  return true;
});

// Get single key
ipcMain.handle('settings:getKey', (event, key) => store.get(key));
```

- [ ] **Step 3: 在 preload.js 暴露 settings API**

在 preload.js 中添加：
```js
contextBridge.exposeInMainWorld('shelfdeckSettings', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  getKey: (key) => ipcRenderer.invoke('settings:getKey', key),
});
```

- [ ] **Step 4: 创建 SettingsPanel.tsx**

```tsx
import { useState, useEffect } from 'react';

interface Settings {
  serviceUrl: string;
  serviceApiKey: string;
  playerExePath: string;
  localPathMapFrom: string;
  localPathMapTo: string;
}

const OVERLAY: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000,
};

const PANEL: React.CSSProperties = {
  background: '#fff',
  borderRadius: '12px',
  padding: '24px',
  width: '400px',
  maxHeight: '80vh',
  overflowY: 'auto',
};

const INPUT: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid #ddd',
  borderRadius: '6px',
  fontSize: '14px',
  width: '100%',
  boxSizing: 'border-box',
};

const LABEL: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  color: '#666',
  marginBottom: '4px',
  marginTop: '12px',
};

const BTN: React.CSSProperties = {
  padding: '8px 20px',
  background: '#4a90d9',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '14px',
  marginTop: '16px',
};

declare global {
  interface Window {
    shelfdeckSettings?: {
      get: () => Promise<Settings>;
      set: (key: string, value: any) => Promise<boolean>;
      getKey: (key: string) => Promise<any>;
    };
  }
}

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<Settings>({
    serviceUrl: 'http://127.0.0.1:18080',
    serviceApiKey: '',
    playerExePath: '',
    localPathMapFrom: '',
    localPathMapTo: '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (window.shelfdeckSettings) {
      window.shelfdeckSettings.get().then(s => setSettings(s));
    }
  }, []);

  const handleSave = async () => {
    setSaving(true);
    if (window.shelfdeckSettings) {
      for (const [k, v] of Object.entries(settings)) {
        await window.shelfdeckSettings.set(k, v);
      }
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={PANEL} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0 }}>设置</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px' }}>×</button>
        </div>

        <label style={LABEL}>媒体服务地址</label>
        <input style={INPUT} value={settings.serviceUrl} onChange={e => setSettings(s => ({ ...s, serviceUrl: e.target.value }))} />

        <label style={LABEL}>服务 API Key</label>
        <input style={INPUT} type="password" value={settings.serviceApiKey} onChange={e => setSettings(s => ({ ...s, serviceApiKey: e.target.value }))} />

        <label style={LABEL}>播放器路径（PotPlayer）</label>
        <input style={INPUT} value={settings.playerExePath} onChange={e => setSettings(s => ({ ...s, playerExePath: e.target.value }))} />

        <label style={LABEL}>本地路径映射（源）</label>
        <input style={INPUT} value={settings.localPathMapFrom} onChange={e => setSettings(s => ({ ...s, localPathMapFrom: e.target.value }))} placeholder="D:\\media" />

        <label style={LABEL}>本地路径映射（目标）</label>
        <input style={INPUT} value={settings.localPathMapTo} onChange={e => setSettings(s => ({ ...s, localPathMapTo: e.target.value }))} placeholder="\\\\NAS\\media" />

        <button style={BTN} onClick={handleSave} disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </button>
        {saved && <span style={{ marginLeft: '12px', color: '#27ae60', fontSize: '13px' }}>已保存</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add media-desktop/src/components/SettingsPanel.tsx media-desktop/electron/main.js media-desktop/electron/preload.js
git commit -m "feat(desktop): add SettingsPanel with electron-store persistence

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 13: 移除配置中心/任务中心页面

**Files:**
- Delete: `media-desktop/src/pages/ConfigCenterPage.tsx`（确认实际文件名）
- Delete: `media-desktop/src/pages/TaskCenterPage.tsx`（确认实际文件名）

- [ ] **Step 1: 确认要删除的文件名**

```bash
ls media-desktop/src/pages/
```

- [ ] **Step 2: 删除文件**

```bash
rm -f media-desktop/src/pages/ConfigCenterPage.tsx media-desktop/src/pages/TaskCenterPage.tsx
```

- [ ] **Step 3: 从 App.tsx import 中移除**

搜索 App.tsx 中对这两个文件的 import 并删除

- [ ] **Step 4: Commit**

```bash
git add media-desktop/src/
git commit -m "chore(desktop): remove ConfigCenter and TaskCenter pages

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 14: 废弃 connection.json，切换到 electron-store

**Files:**
- Modify: `media-desktop/electron/shelfdeckConnection.js` — 改用 electron-store
- Modify: `media-desktop/electron/preload.js` — 暴露 getEffective API 从 electron-store 读

- [ ] **Step 1: 在 main.js 添加 connection 相关 IPC**

```js
ipcMain.handle('connection:get', () => {
  return {
    baseUrl: store.get('shelfdeck.mediaService.baseUrl', 'http://127.0.0.1:18080'),
    apiKey: store.get('shelfdeck.mediaService.apiKey', ''),
  };
});

ipcMain.handle('connection:set', (event, baseUrl, apiKey) => {
  store.set('shelfdeck.mediaService.baseUrl', baseUrl);
  store.set('shelfdeck.mediaService.apiKey', apiKey);
  return true;
});
```

- [ ] **Step 2: 在 preload.js 暴露 connection API**

```js
contextBridge.exposeInMainWorld('shelfdeckMedia', {
  getEffective: () => ipcRenderer.invoke('connection:get'),
});
```

- [ ] **Step 3: Commit**

```bash
git add media-desktop/electron/main.js media-desktop/electron/preload.js media-desktop/electron/shelfdeckConnection.js
git commit -m "refactor(desktop): migrate connection.json to electron-store

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 验证步骤

完成所有任务后执行：

```bash
# 1. Service health check
curl -s http://127.0.0.1:18080/v1/health | python3 -m json.tool
# 预期: 包含 healthy + checks 字段

# 2. Service tests
cd media-service && npm test

# 3. Web admin builds
cd media-service/web && npm run build
# 预期: dist/admin/ 包含 index.html

# 4. Desktop builds (type check)
cd media-desktop && npx tsc --noEmit
# 预期: 无错误
```
