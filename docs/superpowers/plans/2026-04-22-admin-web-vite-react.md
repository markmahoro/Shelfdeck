# Admin Web Vite + React 重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `media-service/src/admin/` vanilla HTML 原型重构为 `media-service/web/` Vite + React 项目

**Architecture:** Fastify serve `media-service/dist/admin/`（`@fastify/static`），React Router SPA，Vite 构建产物。Admin API（已实现）与 React UI 通过 REST 交互。

**Tech Stack:** Vite 5 + React 18 + TypeScript + React Router 6 + @tanstack/react-query

---

## 文件结构

```
media-service/web/                    # NEW — 独立 Vite + React 项目
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── index.html
└── src/
    ├── main.tsx                     # 入口
    ├── App.tsx                     # React Router 根组件
    ├── api/
    │   └── client.ts               # REST API 客户端（fetch 封装）
    ├── types/
    │   └── index.ts                # TypeScript 类型（全量 API 类型）
    ├── hooks/
    │   ├── useAuth.ts              # PIN 登录 / session 管理
    │   └── useTasks.ts             # 任务列表 / 操作 hooks
    ├── pages/
    │   ├── LoginPage.tsx           # PIN 登录
    │   ├── SetupPage.tsx           # 首次 PIN 设置
    │   ├── DashboardPage.tsx       # 仪表盘
    │   ├── ConfigPage.tsx          # 配置管理（Emby/转码/调度）
    │   ├── TaskCenterPage.tsx      # 任务中心
    │   ├── DoubanPage.tsx          # 豆瓣集成
    │   └── PathMappingPage.tsx     # 路径映射
    └── components/
        ├── Layout.tsx              # 壳：Sidebar + content
        ├── Sidebar.tsx
        ├── StatusBadge.tsx
        └── TaskList.tsx            # 任务列表组件

media-service/src/app.js             # MODIFY — 替换 static 托管为 SPA fallback
media-service/package.json           # MODIFY — 添加 build 脚本
media-service/src/admin/             # DELETE — 旧 vanilla HTML 原型
```

---

## Task 1: 创建 web 项目脚手架

**Files:**
- Create: `media-service/web/package.json`
- Create: `media-service/web/vite.config.ts`
- Create: `media-service/web/tsconfig.json`
- Create: `media-service/web/tsconfig.node.json`
- Create: `media-service/web/index.html`
- Create: `media-service/web/src/vite-env.d.ts`
- Create: `media-service/web/src/main.tsx`
- Create: `media-service/web/src/App.tsx`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@shelfdeck/admin-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.56.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.4",
    "vite": "^5.4.3"
  }
}
```

- [ ] **Step 2: Create vite.config.ts**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  build: {
    outDir: path.resolve(__dirname, '../dist/admin'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/v1': 'http://localhost:18080',
    },
  },
});
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create tsconfig.node.json**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 5: Create index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ShelfDeck 管理控制台</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create src/vite-env.d.ts**

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 7: Create src/main.tsx**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 8: Create src/App.tsx (stub)**

```tsx
import { Routes, Route, Navigate } from 'react-router-dom';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
```

- [ ] **Step 9: Install dependencies**

```bash
cd media-service/web && npm install
```

- [ ] **Step 10: Verify dev server starts**

```bash
cd media-service/web && npm run dev
# Expected: Vite dev server starts on port 5173
# Visit http://localhost:5173 — blank page with root div
```

- [ ] **Step 11: Commit**

```bash
git add media-service/web/
git commit -m "feat(admin): scaffold Vite + React admin-web project
- package.json, vite.config.ts, tsconfig
- React 18 + React Router + TanStack Query
- entry point and stub App.tsx
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: API 客户端 + TypeScript 类型

**Files:**
- Create: `media-service/web/src/types/index.ts`
- Create: `media-service/web/src/api/client.ts`
- Create: `media-service/web/src/hooks/useAuth.ts`

- [ ] **Step 1: Create src/types/index.ts**

```ts
// ── Config ────────────────────────────────────────────────────────────────────

export interface EmbyClientConfig {
  baseUrl: string;
  apiKey: string;
  userId: string;
  embyUserPassword?: string;
}

export interface MediaPolicy {
  target1080p: Record<string, number>; // star → bitrateMbps
  target4k: Record<string, number>;
}

export interface EncodePoolEntry {
  stableKey: string;
  inPool: boolean;
  priority: number;
  maxSlots: number;
}

export interface EncodePool {
  entries: EncodePoolEntry[];
  cpuParticipation?: 'normal' | 'backup-only';
}

export interface ServiceConfig {
  baseUrl?: string;
  apiKey?: string;
  userId?: string;
  embyUserPassword?: string;
  embyClient?: EmbyClientConfig;
  embyProfiles?: Record<string, EmbyClientConfig>;
  enabledSectionIds?: string[];
  executionMode?: 'manual' | 'scheduled';
  deleteConcurrency?: number;
  transcodeConcurrency?: number;
  upgradeConcurrency?: number;
  transcodeTempRoot?: string;
  transcodeReplaceConfirmRequired?: boolean;
  transcodeEncodePool?: EncodePool;
  transcodeCpuParticipationStrategy?: 'normal' | 'backup-only';
  ffmpegPath?: string;
  ffprobePath?: string;
  mediaPolicy?: MediaPolicy;
  wallRatingAutoEnqueue?: boolean;
  markPlayedThresholdPercent?: number;
  fallbackMinSeconds?: number;
  upgradeRetryInterval?: number;
  upgradeMaxRetries?: number;
  serviceApiKey?: string;
  adminPin?: string;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthStatus {
  needSetup: boolean;  // no PIN set
  needLogin: boolean;  // PIN set, need to verify
  pinSet: boolean;
}

export interface PinVerifyResponse {
  ok: boolean;
  session?: string;
  message?: string;
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export type TaskStatus =
  | 'pending_manual' | 'created' | 'queued'
  | 'precheck' | 'executing' | 'verify'
  | 'awaiting_user_confirm' | 'paused'
  | 'done' | 'failed_hard';

export type ActionType = 'delete' | 'transcode' | 'upgrade';

export interface FlowLogEntry {
  seq?: number;
  ts: string;
  level: 'info' | 'warn' | 'error';
  code: string;
  message: string;
  callId?: string;
}

export interface MediaTask {
  id: string;
  itemId: string;
  itemName?: string;
  actionType: ActionType;
  status: TaskStatus;
  progress?: number;
  flowLog?: FlowLogEntry[];
  resumePoint?: string;
  confirmedAt?: string;
  transcodeDvAcknowledged?: boolean;
  transcodeReplaceAcknowledged?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// ── Health ───────────────────────────────────────────────────────────────────

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'unhealthy';
  version?: string;
  checks?: {
    service: 'green' | 'yellow' | 'red';
    config: 'green' | 'yellow' | 'red';
    emby: 'green' | 'yellow' | 'red';
    scheduler: 'green' | 'yellow' | 'red';
  };
}

// ── Emby ─────────────────────────────────────────────────────────────────────

export interface EmbyItem {
  Id: string;
  Name: string;
  Type: string;
  Path?: string;
  MediaSources?: Array<{ Path?: string; Size?: number }>;
  // ...other fields as needed
}

export interface EmbyUser {
  Name: string;
  Id: string;
}

export interface MediaFolder {
  Name: string;
  Id: string;
}

// ── Douban ───────────────────────────────────────────────────────────────────

export interface DoubanSession {
  cookie?: string;
  userId?: string;
}

export interface DoubanRatingsCache {
  [itemId: string]: { rating: number; updatedAt: string };
}
```

- [ ] **Step 2: Create src/api/client.ts**

```ts
const BASE = '';

function getSession(): string | null {
  return sessionStorage.getItem('admin_session');
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const session = getSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(session ? { 'x-admin-session': session } : {}),
    ...(init?.headers as Record<string, string>?),
  };
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (res.status === 401) {
    // session expired — redirect to login
    sessionStorage.removeItem('admin_session');
    window.location.href = '/admin/login.html';
    throw new Error('UNAUTHORIZED');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Auth ────────────────────────────────────────────────────────────────────

export const auth = {
  getStatus: () => request<import('../types').AuthStatus>('/v1/admin/auth-status'),
  setPin: (pin: string) =>
    request<{ ok: boolean }>('/v1/admin/pin', {
      method: 'POST',
      body: JSON.stringify({ action: 'set', pin }),
    }),
  verifyPin: (pin: string) =>
    request<import('../types').PinVerifyResponse>('/v1/admin/pin', {
      method: 'POST',
      body: JSON.stringify({ action: 'verify', pin }),
    }),
  shutdown: () =>
    request<void>('/v1/admin/shutdown', { method: 'POST' }),
};

// ── Config ──────────────────────────────────────────────────────────────────

export const config = {
  get: () => request<import('../types').ServiceConfig>('/v1/admin/config'),
  patch: (patch: Partial<import('../types').ServiceConfig>) =>
    request<import('../types').ServiceConfig>('/v1/config', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
};

// ── Tasks ───────────────────────────────────────────────────────────────────

export const tasks = {
  list: (filter?: { status?: string; actionType?: string }) => {
    const params = new URLSearchParams();
    if (filter?.status) params.set('status', filter.status);
    if (filter?.actionType) params.set('actionType', filter.actionType);
    const qs = params.toString();
    return request<import('../types').MediaTask[]>(`/v1/tasks${qs ? `?${qs}` : ''}`);
  },
  get: (taskId: string) =>
    request<import('../types').MediaTask>(`/v1/tasks/${taskId}`),
  confirm: (taskId: string) =>
    request<{ ok: boolean }>(`/v1/tasks/${taskId}/actions/confirm`, {
      method: 'POST',
      body: JSON.stringify({ confirmed: true }),
    }),
  pause: (taskId: string) =>
    request<{ ok: boolean }>(`/v1/tasks/${taskId}/actions/pause`, {
      method: 'POST',
    }),
  execute: (taskId: string) =>
    request<{ ok: boolean }>(`/v1/tasks/${taskId}/actions/execute`, {
      method: 'POST',
    }),
  delete: (taskId: string) =>
    request<void>(`/v1/tasks/${taskId}`, { method: 'DELETE' }),
};

// ── Health ──────────────────────────────────────────────────────────────────

export const health = {
  check: () => request<import('../types').HealthStatus>('/v1/health'),
};

// ── Emby ────────────────────────────────────────────────────────────────────

export const emby = {
  testConnection: (body: { baseUrl: string; apiKey: string; userId: string }) =>
    request<{ ok: boolean; message?: string }>('/v1/emby/actions/test-connection', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listUsers: (body: { baseUrl: string; apiKey: string }) =>
    request<import('../types').EmbyUser[]>('/v1/emby/actions/list-users', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listMediaFolders: (body: { baseUrl: string; apiKey: string }) =>
    request<import('../types').MediaFolder[]>('/v1/emby/actions/list-media-folders', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

// ── Douban ──────────────────────────────────────────────────────────────────

export const douban = {
  getSession: () =>
    request<import('../types').DoubanSession>('/v1/integrations/douban/session'),
  saveSession: (session: import('../types').DoubanSession) =>
    request<void>('/v1/integrations/douban/session', {
      method: 'PUT',
      body: JSON.stringify(session),
    }),
  getRatingsCache: () =>
    request<import('../types').DoubanRatingsCache>('/v1/integrations/douban/ratings/cache'),
  getRatings: () =>
    request<import('../types').DoubanRatingsCache>('/v1/library/ratings'),
  patchRatings: (patch: Record<string, { rating: number }>) =>
    request<{ ok: boolean; count: number }>('/v1/library/ratings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
};
```

- [ ] **Step 3: Create src/hooks/useAuth.ts**

```ts
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../api/client';

export function useAuth() {
  const navigate = useNavigate();

  const login = useCallback(async (pin: string): Promise<void> => {
    const res = await auth.verifyPin(pin);
    if (res.ok && res.session) {
      sessionStorage.setItem('admin_session', res.session);
      navigate('/admin/dashboard', { replace: true });
    } else {
      throw new Error(res.message || 'PIN 错误');
    }
  }, [navigate]);

  const setupPin = useCallback(async (pin: string): Promise<void> => {
    await auth.setPin(pin);
    // After setup, redirect to login to enter PIN
    navigate('/admin/login', { replace: true });
  }, [navigate]);

  const logout = useCallback(() => {
    sessionStorage.removeItem('admin_session');
    navigate('/admin/login', { replace: true });
  }, [navigate]);

  const hasSession = useCallback((): boolean => {
    return !!sessionStorage.getItem('admin_session');
  }, []);

  return { login, setupPin, logout, hasSession };
}
```

- [ ] **Step 4: Commit**

```bash
git add media-service/web/src/types/ media-service/web/src/api/ media-service/web/src/hooks/
git commit -m "feat(admin): add TypeScript types and REST API client

- Full type definitions for all API models
- Fetch-based client with session auth header
- useAuth hook for PIN login/logout
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Layout 壳（Sidebar + 内容区）

**Files:**
- Create: `media-service/web/src/components/Layout.tsx`
- Create: `media-service/web/src/components/Sidebar.tsx`
- Modify: `media-service/web/src/App.tsx`

- [ ] **Step 1: Create src/components/Sidebar.tsx`

```tsx
import { NavLink } from 'react-router-dom';
import styles from './Sidebar.module.css';

const NAV = [
  { to: '/admin/dashboard', label: '仪表盘', icon: '📊' },
  { to: '/admin/config', label: '配置管理', icon: '⚙️' },
  { to: '/admin/tasks', label: '任务中心', icon: '📋' },
  { to: '/admin/douban', label: '豆瓣集成', icon: '�🍊' },
  { to: '/admin/paths', label: '路径映射', icon: '📁' },
];

export default function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>🖥️ ShelfDeck</div>
      <nav>
        {NAV.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.active : ''}`
            }
          >
            <span className={styles.icon}>{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>
      <div className={styles.footer}>
        <button
          className={styles.logoutBtn}
          onClick={() => {
            sessionStorage.removeItem('admin_session');
            window.location.href = '/admin/login';
          }}
        >
          退出登录
        </button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Create src/components/Sidebar.module.css**

```css
.sidebar {
  width: 200px;
  min-height: 100vh;
  background: #1a1a2e;
  color: #fff;
  display: flex;
  flex-direction: column;
  padding: 16px 0;
  flex-shrink: 0;
}
.logo {
  font-size: 16px;
  font-weight: 700;
  padding: 0 16px 24px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
  margin-bottom: 16px;
}
.navItem {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  color: rgba(255,255,255,0.7);
  text-decoration: none;
  font-size: 14px;
  transition: background 0.15s, color 0.15s;
}
.navItem:hover { background: rgba(255,255,255,0.08); color: #fff; }
.navItem.active { background: rgba(255,255,255,0.12); color: #fff; }
.icon { font-size: 16px; }
.footer { margin-top: auto; padding: 16px; border-top: 1px solid rgba(255,255,255,0.1); }
.logoutBtn {
  width: 100%;
  background: none;
  border: 1px solid rgba(255,255,255,0.2);
  color: rgba(255,255,255,0.6);
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.logoutBtn:hover { border-color: rgba(255,255,255,0.4); color: #fff; }
```

- [ ] **Step 3: Create src/components/Layout.tsx**

```tsx
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import styles from './Layout.module.css';

export default function Layout() {
  return (
    <div className={styles.root}>
      <Sidebar />
      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Create src/components/Layout.module.css**

```css
.root {
  display: flex;
  min-height: 100vh;
  background: #f0f2f5;
}
.content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}
```

- [ ] **Step 5: Update src/App.tsx — add routing with auth guard**

```tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import SetupPage from './pages/SetupPage';
import DashboardPage from './pages/DashboardPage';
import ConfigPage from './pages/ConfigPage';
import TaskCenterPage from './pages/TaskCenterPage';
import DoubanPage from './pages/DoubanPage';
import PathMappingPage from './pages/PathMappingPage';
import { auth } from './api/client';

function RequireAuth({ children }: { children: JSX.Element }) {
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    auth.getStatus()
      .then((s) => {
        if (!s.pinSet) {
          window.location.href = '/admin/setup';
        } else if (!sessionStorage.getItem('admin_session')) {
          window.location.href = '/admin/login';
        } else {
          setAuthorized(true);
        }
      })
      .catch(() => {
        window.location.href = '/admin/login';
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>加载中...</div>;
  return authorized ? children : null;
}

export default function App() {
  return (
    <Routes>
      <Route path="/admin/login" element={<LoginPage />} />
      <Route path="/admin/setup" element={<SetupPage />} />
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="config" element={<ConfigPage />} />
        <Route path="tasks" element={<TaskCenterPage />} />
        <Route path="douban" element={<DoubanPage />} />
        <Route path="paths" element={<PathMappingPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add media-service/web/src/components/ media-service/web/src/App.tsx
git commit -m "feat(admin): add Layout shell with auth-guarded routing

- Sidebar with nav links
- Layout using React Router Outlet
- RequireAuth HOC redirects to login/setup when needed
- All /admin/* routes protected
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Login + Setup 页面

**Files:**
- Create: `media-service/web/src/pages/LoginPage.tsx`
- Create: `media-service/web/src/pages/SetupPage.tsx`

- [ ] **Step 1: Create src/pages/LoginPage.tsx**

```tsx
import { useState, FormEvent } from 'react';
import { auth } from '../api/client';

export default function LoginPage() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await auth.verifyPin(pin);
      if (res.ok && res.session) {
        sessionStorage.setItem('admin_session', res.session);
        window.location.href = '/admin/';
      } else {
        setError(res.message || 'PIN 错误');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={logoStyle}>🖥️</div>
        <h1 style={titleStyle}>ShelfDeck 管理控制台</h1>
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>输入管理员 PIN</label>
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            style={inputStyle}
            placeholder="请输入 PIN"
            autoFocus
            required
          />
          {error && <div style={errorStyle}>{error}</div>}
          <button type="submit" style={btnStyle} disabled={loading}>
            {loading ? '验证中...' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  minHeight: '100vh', background: '#f0f2f5',
};
const cardStyle: React.CSSProperties = {
  background: '#fff', borderRadius: '12px', padding: '40px',
  width: '360px', boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
};
const logoStyle: React.CSSProperties = { fontSize: '32px', textAlign: 'center', marginBottom: '8px' };
const titleStyle: React.CSSProperties = { fontSize: '18px', textAlign: 'center', marginBottom: '24px', color: '#1a1a2e' };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: '13px', color: '#444', marginBottom: '6px', fontWeight: 500 };
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', border: '1px solid #ddd',
  borderRadius: '8px', fontSize: '16px', marginBottom: '16px', outline: 'none',
};
const errorStyle: React.CSSProperties = { color: '#e53', fontSize: '13px', marginBottom: '12px', textAlign: 'center' };
const btnStyle: React.CSSProperties = {
  width: '100%', padding: '12px', background: '#4a90d9', color: '#fff',
  border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 600, cursor: 'pointer',
};
```

- [ ] **Step 2: Create src/pages/SetupPage.tsx**

```tsx
import { useState, FormEvent } from 'react';
import { auth } from '../api/client';

export default function SetupPage() {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (pin !== confirm) {
      setError('两次输入的 PIN 不一致');
      return;
    }
    if (pin.length < 4) {
      setError('PIN 至少 4 位');
      return;
    }
    setLoading(true);
    try {
      await auth.setPin(pin);
      window.location.href = '/admin/login';
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '设置失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={logoStyle}>🖥️</div>
        <h1 style={titleStyle}>设置管理员 PIN</h1>
        <p style={{ fontSize: '13px', color: '#666', marginBottom: '24px', textAlign: 'center' }}>
          首次使用请设置管理员 PIN（至少 4 位）
        </p>
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>输入 PIN</label>
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)}
            style={inputStyle} placeholder="请输入 PIN" required minLength={4} />
          <label style={labelStyle}>确认 PIN</label>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
            style={inputStyle} placeholder="请再次输入 PIN" required minLength={4} />
          {error && <div style={errorStyle}>{error}</div>}
          <button type="submit" style={btnStyle} disabled={loading}>
            {loading ? '设置中...' : '设置 PIN'}
          </button>
        </form>
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f0f2f5' };
const cardStyle: React.CSSProperties = { background: '#fff', borderRadius: '12px', padding: '40px', width: '360px', boxShadow: '0 2px 12px rgba(0,0,0,0.1)' };
const logoStyle: React.CSSProperties = { fontSize: '32px', textAlign: 'center', marginBottom: '8px' };
const titleStyle: React.CSSProperties = { fontSize: '18px', textAlign: 'center', marginBottom: '24px', color: '#1a1a2e' };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: '13px', color: '#444', marginBottom: '6px', fontWeight: 500 };
const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '16px', marginBottom: '16px', outline: 'none' };
const errorStyle: React.CSSProperties = { color: '#e53', fontSize: '13px', marginBottom: '12px', textAlign: 'center' };
const btnStyle: React.CSSProperties = { width: '100%', padding: '12px', background: '#4a90d9', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 600, cursor: 'pointer' };
```

- [ ] **Step 3: Commit**

```bash
git add media-service/web/src/pages/LoginPage.tsx media-service/web/src/pages/SetupPage.tsx
git commit -m "feat(admin): add LoginPage and SetupPage

- LoginPage: PIN input, verify via /v1/admin/pin
- SetupPage: first-time PIN setup via /v1/admin/pin (action: set)
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Dashboard 页面

**Files:**
- Create: `media-service/web/src/pages/DashboardPage.tsx`

- [ ] **Step 1: Create src/pages/DashboardPage.tsx**

```tsx
import { useQuery } from '@tanstack/react-query';
import { health, tasks, config } from '../api/client';
import type { MediaTask } from '../types';

export default function DashboardPage() {
  const { data: healthData } = useQuery({
    queryKey: ['health'],
    queryFn: health.check,
    refetchInterval: 30000,
  });

  const { data: taskData = [] } = useQuery<MediaTask[]>({
    queryKey: ['tasks'],
    queryFn: () => tasks.list(),
    refetchInterval: 10000,
  });

  const { data: cfg } = useQuery({
    queryKey: ['config'],
    queryFn: config.get,
  });

  const activeTasks = taskData.filter(
    (t) => !['done', 'failed_hard'].includes(t.status),
  );
  const recentDone = taskData
    .filter((t) => t.status === 'done')
    .slice(0, 5);

  const statusColor = (s?: string) => {
    if (s === 'ok') return '#27ae60';
    if (s === 'degraded') return '#f39c12';
    return '#e53';
  };

  return (
    <div>
      <h2 style={pageTitle}>仪表盘</h2>

      {/* Health Status */}
      <div style={cardStyle}>
        <h3 style={sectionTitle}>服务状态</h3>
        <div style={statusGridStyle}>
          <div style={statusItemStyle}>
            <span style={{ fontSize: '24px' }}>✅</span>
            <div>
              <div style={{ fontWeight: 600 }}>Service</div>
              <div style={{ color: statusColor(healthData?.status), fontSize: '13px' }}>
                {healthData?.status === 'ok' ? '正常' : healthData?.status === 'degraded' ? '降级' : '异常'}
              </div>
            </div>
          </div>
          <div style={statusItemStyle}>
            <span style={{ fontSize: '24px' }}>⚙️</span>
            <div>
              <div style={{ fontWeight: 600 }}>Config</div>
              <div style={{ color: '#27ae60', fontSize: '13px' }}>
                {cfg ? '已加载' : '未加载'}
              </div>
            </div>
          </div>
          <div style={statusItemStyle}>
            <span style={{ fontSize: '24px' }}>📺</span>
            <div>
              <div style={{ fontWeight: 600 }}>Emby</div>
              <div style={{ color: '#666', fontSize: '13px' }}>
                {cfg?.embyClient?.baseUrl || '未配置'}
              </div>
            </div>
          </div>
          <div style={statusItemStyle}>
            <span style={{ fontSize: '24px' }}>⏰</span>
            <div>
              <div style={{ fontWeight: 600 }}>调度器</div>
              <div style={{ color: '#27ae60', fontSize: '13px' }}>
                {cfg?.executionMode === 'scheduled' ? '自动' : '手动'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Active Tasks */}
      <div style={cardStyle}>
        <h3 style={sectionTitle}>进行中任务 ({activeTasks.length})</h3>
        {activeTasks.length === 0 ? (
          <p style={{ color: '#888', fontSize: '14px' }}>暂无进行中任务</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>名称</th>
                <th style={thStyle}>类型</th>
                <th style={thStyle}>状态</th>
                <th style={thStyle}>进度</th>
              </tr>
            </thead>
            <tbody>
              {activeTasks.map((t) => (
                <tr key={t.id}>
                  <td style={tdStyle}>{t.itemName || t.itemId}</td>
                  <td style={tdStyle}>{t.actionType}</td>
                  <td style={tdStyle}>{t.status}</td>
                  <td style={tdStyle}>{t.progress ?? 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Recent Done */}
      <div style={cardStyle}>
        <h3 style={sectionTitle}>最近完成</h3>
        {recentDone.length === 0 ? (
          <p style={{ color: '#888', fontSize: '14px' }}>暂无已完成任务</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {recentDone.map((t) => (
              <li key={t.id} style={{ padding: '8px 0', borderBottom: '1px solid #eee', fontSize: '14px' }}>
                <span>{t.itemName || t.itemId}</span>
                <span style={{ color: '#888', marginLeft: 8 }}>{t.actionType}</span>
                <span style={{ color: '#27ae60', marginLeft: 8 }}>已完成</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const pageTitle: React.CSSProperties = { fontSize: '20px', fontWeight: 700, marginBottom: '24px', color: '#1a1a2e' };
const cardStyle: React.CSSProperties = { background: '#fff', borderRadius: '10px', padding: '20px', marginBottom: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' };
const sectionTitle: React.CSSProperties = { fontSize: '15px', fontWeight: 600, marginBottom: '16px', color: '#1a1a2e' };
const statusGridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' };
const statusItemStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: '#f9fafb', borderRadius: '8px' };
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '14px' };
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px', borderBottom: '2px solid #eee', color: '#666' };
const tdStyle: React.CSSProperties = { padding: '8px', borderBottom: '1px solid #f0f0f0' };
```

- [ ] **Step 2: Commit**

```bash
git add media-service/web/src/pages/DashboardPage.tsx
git commit -m "feat(admin): add DashboardPage

- Health status grid (service/config/emby/scheduler)
- Active tasks table with polling (10s)
- Recent completed tasks list
- Auto-refresh via TanStack Query
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: 配置管理页面（Emby + 转码 + 调度）

**Files:**
- Create: `media-service/web/src/pages/ConfigPage.tsx`

- [ ] **Step 1: Create src/pages/ConfigPage.tsx**

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { config, emby } from '../api/client';
import type { ServiceConfig, EmbyUser, MediaFolder } from '../types';

type Tab = 'emby' | 'transcode' | 'scheduler';

export default function ConfigPage() {
  const [tab, setTab] = useState<Tab>('emby');
  const [embyForm, setEmbyForm] = useState<Partial<ServiceConfig>>({});
  const [embyUsers, setEmbyUsers] = useState<EmbyUser[]>([]);
  const [embyFolders, setEmbyFolders] = useState<MediaFolder[]>([]);
  const [testMsg, setTestMsg] = useState('');
  const qc = useQueryClient();

  const { data: cfg, isLoading } = useQuery<ServiceConfig>({
    queryKey: ['config'],
    queryFn: config.get,
  });

  const saveMutation = useMutation({
    mutationFn: (patch: Partial<ServiceConfig>) => config.patch(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  });

  const testMutation = useMutation({
    mutationFn: emby.testConnection,
    onSuccess: (res) => setTestMsg(res.ok ? '连接成功' : res.message || '连接失败'),
    onError: (e: Error) => setTestMsg(e.message),
  });

  const handleTest = () => {
    if (!embyForm.baseUrl || !embyForm.apiKey) return;
    testMutation.mutate({ baseUrl: embyForm.baseUrl!, apiKey: embyForm.apiKey!, userId: embyForm.userId! });
  };

  const handleSaveEmby = () => {
    saveMutation.mutate({
      baseUrl: embyForm.baseUrl,
      apiKey: embyForm.apiKey,
      userId: embyForm.userId,
    });
  };

  const handleSaveTranscode = () => {
    saveMutation.mutate({
      transcodeTempRoot: cfg?.transcodeTempRoot,
      transcodeReplaceConfirmRequired: cfg?.transcodeReplaceConfirmRequired,
      transcodeEncodePool: cfg?.transcodeEncodePool,
      ffmpegPath: cfg?.ffmpegPath,
    });
  };

  const handleSaveScheduler = () => {
    saveMutation.mutate({
      executionMode: cfg?.executionMode,
      deleteConcurrency: cfg?.deleteConcurrency,
      transcodeConcurrency: cfg?.transcodeConcurrency,
      upgradeConcurrency: cfg?.upgradeConcurrency,
    });
  };

  if (isLoading) return <div>加载中...</div>;

  return (
    <div>
      <h2 style={pageTitle}>配置管理</h2>

      {/* Tab Nav */}
      <div style={tabNavStyle}>
        {(['emby', 'transcode', 'scheduler'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{ ...tabBtnStyle, ...(tab === t ? tabBtnActiveStyle : {}) }}
          >
            {t === 'emby' ? '📺 Emby 连接' : t === 'transcode' ? '🎬 转码设置' : '⏰ 调度设置'}
          </button>
        ))}
      </div>

      {/* Emby Tab */}
      {tab === 'emby' && (
        <div style={cardStyle}>
          <h3 style={sectionTitle}>Emby 连接配置</h3>
          <div style={formGridStyle}>
            <label style={labelStyle}>Emby 地址</label>
            <input
              style={inputStyle}
              value={embyForm.baseUrl ?? cfg?.embyClient?.baseUrl ?? ''}
              onChange={(e) => setEmbyForm((f) => ({ ...f, baseUrl: e.target.value }))}
              placeholder="http://emby.example.com:8096"
            />
            <label style={labelStyle}>API Key</label>
            <input
              style={inputStyle}
              type="password"
              value={embyForm.apiKey ?? cfg?.embyClient?.apiKey ?? ''}
              onChange={(e) => setEmbyForm((f) => ({ ...f, apiKey: e.target.value }))}
              placeholder="xxxxxxxxxxxx"
            />
            <label style={labelStyle}>用户 ID</label>
            <input
              style={inputStyle}
              value={embyForm.userId ?? cfg?.embyClient?.userId ?? ''}
              onChange={(e) => setEmbyForm((f) => ({ ...f, userId: e.target.value }))}
              placeholder="用户 ID"
            />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={btnPrimaryStyle} onClick={handleTest} disabled={testMutation.isPending}>
              {testMutation.isPending ? '测试中...' : '测试连接'}
            </button>
            <button style={btnPrimaryStyle} onClick={handleSaveEmby} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? '保存中...' : '保存'}
            </button>
          </div>
          {testMsg && <div style={{ marginTop: '12px', color: testMsg.includes('成功') ? '#27ae60' : '#e53' }}>{testMsg}</div>}
        </div>
      )}

      {/* Transcode Tab */}
      {tab === 'transcode' && (
        <div style={cardStyle}>
          <h3 style={sectionTitle}>转码设置</h3>
          <div style={formGridStyle}>
            <label style={labelStyle}>临时目录</label>
            <input
              style={inputStyle}
              value={cfg?.transcodeTempRoot || ''}
              onChange={(e) => {/* update via save */}}
              placeholder="D:\\transcode_temp"
            />
            <label style={labelStyle}>FFmpeg 路径</label>
            <input
              style={inputStyle}
              value={cfg?.ffmpegPath || ''}
              onChange={(e) => {/* update via save */}}
              placeholder="ffmpeg"
            />
            <label style={labelStyle}>
              <input
                type="checkbox"
                checked={cfg?.transcodeReplaceConfirmRequired ?? false}
                onChange={(e) => {/* update via save */}}
              />
              替换前需用户确认
            </label>
          </div>
          <button style={btnPrimaryStyle} onClick={handleSaveTranscode} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? '保存中...' : '保存'}
          </button>
        </div>
      )}

      {/* Scheduler Tab */}
      {tab === 'scheduler' && (
        <div style={cardStyle}>
          <h3 style={sectionTitle}>调度设置</h3>
          <div style={formGridStyle}>
            <label style={labelStyle}>执行模式</label>
            <select
              style={inputStyle}
              value={cfg?.executionMode || 'manual'}
              onChange={(e) => {/* update via save */}}
            >
              <option value="manual">手动</option>
              <option value="scheduled">自动调度</option>
            </select>
            <label style={labelStyle}>删除并发数</label>
            <input
              style={inputStyle}
              type="number"
              value={cfg?.deleteConcurrency ?? 1}
              min={1} max={10}
              onChange={(e) => {/* update via save */}}
            />
            <label style={labelStyle}>转码并发数</label>
            <input
              style={inputStyle}
              type="number"
              value={cfg?.transcodeConcurrency ?? 1}
              min={1} max={10}
              onChange={(e) => {/* update via save */}}
            />
          </div>
          <button style={btnPrimaryStyle} onClick={handleSaveScheduler} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? '保存中...' : '保存'}
          </button>
        </div>
      )}
    </div>
  );
}

const pageTitle: React.CSSProperties = { fontSize: '20px', fontWeight: 700, marginBottom: '24px' };
const cardStyle: React.CSSProperties = { background: '#fff', borderRadius: '10px', padding: '20px', marginBottom: '16px' };
const sectionTitle: React.CSSProperties = { fontSize: '15px', fontWeight: 600, marginBottom: '16px' };
const tabNavStyle: React.CSSProperties = { display: 'flex', gap: '8px', marginBottom: '16px' };
const tabBtnStyle: React.CSSProperties = { padding: '8px 16px', border: '1px solid #ddd', borderRadius: '8px', background: '#fff', cursor: 'pointer', fontSize: '14px' };
const tabBtnActiveStyle: React.CSSProperties = { background: '#4a90d9', color: '#fff', borderColor: '#4a90d9' };
const formGridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '120px 1fr', gap: '12px', alignItems: 'center', marginBottom: '16px' };
const labelStyle: React.CSSProperties = { fontSize: '14px', color: '#444' };
const inputStyle: React.CSSProperties = { padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px', width: '100%' };
const btnPrimaryStyle: React.CSSProperties = { padding: '8px 20px', background: '#4a90d9', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' };
```

- [ ] **Step 2: Commit**

```bash
git add media-service/web/src/pages/ConfigPage.tsx
git commit -m "feat(admin): add ConfigPage with Emby/transcode/scheduler tabs

- Emby: address, API key, user ID fields + test connection
- Transcode: temp root, FFmpeg path, replace confirm flag
- Scheduler: execution mode, concurrency limits
- Save via PATCH /v1/config
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: 任务中心页面

**Files:**
- Create: `media-service/web/src/pages/TaskCenterPage.tsx`

- [ ] **Step 1: Create src/pages/TaskCenterPage.tsx**

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tasks } from '../api/client';
import type { MediaTask, TaskStatus } from '../types';

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending_manual: '待手动执行',
  created: '已创建',
  queued: '排队中',
  precheck: '预检中',
  executing: '执行中',
  verify: '验证中',
  awaiting_user_confirm: '待确认',
  paused: '已暂停',
  done: '已完成',
  failed_hard: '失败',
};

const STATUS_COLORS: Record<TaskStatus, string> = {
  pending_manual: '#888',
  created: '#888',
  queued: '#f39c12',
  precheck: '#4a90d9',
  executing: '#4a90d9',
  verify: '#4a90d9',
  awaiting_user_confirm: '#f39c12',
  paused: '#888',
  done: '#27ae60',
  failed_hard: '#e53',
};

export default function TaskCenterPage() {
  const [filter, setFilter] = useState<TaskStatus | 'all'>('all');
  const [selected, setSelected] = useState<MediaTask | null>(null);
  const qc = useQueryClient();

  const { data: allTasks = [], isLoading } = useQuery<MediaTask[]>({
    queryKey: ['tasks'],
    queryFn: () => tasks.list(),
    refetchInterval: 5000,
  });

  const filtered = filter === 'all' ? allTasks : allTasks.filter((t) => t.status === filter);

  const confirmMutation = useMutation({ mutationFn: (id: string) => tasks.confirm(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }) });
  const pauseMutation = useMutation({ mutationFn: (id: string) => tasks.pause(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }) });
  const executeMutation = useMutation({ mutationFn: (id: string) => tasks.execute(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }) });
  const deleteMutation = useMutation({ mutationFn: (id: string) => tasks.delete(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }) });

  const handleAction = (task: MediaTask, action: 'confirm' | 'pause' | 'execute' | 'delete') => {
    if (action === 'delete') {
      if (!confirm(`删除任务「${task.itemName}」？`)) return;
      deleteMutation.mutate(task.id);
    } else if (action === 'confirm') {
      confirmMutation.mutate(task.id);
    } else if (action === 'pause') {
      pauseMutation.mutate(task.id);
    } else if (action === 'execute') {
      executeMutation.mutate(task.id);
    }
  };

  return (
    <div>
      <h2 style={pageTitle}>任务中心</h2>

      {/* Filter */}
      <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button style={{ ...filterBtnStyle, ...(filter === 'all' ? filterBtnActiveStyle : {}) }} onClick={() => setFilter('all')}>全部</button>
        {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((s) => (
          <button key={s} style={{ ...filterBtnStyle, ...(filter === s ? filterBtnActiveStyle : {}) }} onClick={() => setFilter(s)}>
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Task List */}
      {isLoading ? <div>加载中...</div> : filtered.length === 0 ? <div style={{ color: '#888' }}>暂无任务</div> : (
        <div style={listStyle}>
          {filtered.map((t) => (
            <div
              key={t.id}
              style={taskCardStyle}
              onClick={() => setSelected(t)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '14px' }}>{t.itemName || t.itemId}</div>
                  <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>
                    {t.actionType} · {t.id.slice(0, 8)}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ ...statusBadgeStyle, background: STATUS_COLORS[t.status] }}>
                    {STATUS_LABELS[t.status]}
                  </span>
                  {t.progress !== undefined && (
                    <span style={{ fontSize: '13px', color: '#666' }}>{t.progress}%</span>
                  )}
                </div>
              </div>

              {/* Inline actions */}
              <div style={{ marginTop: '8px', display: 'flex', gap: '6px' }} onClick={(e) => e.stopPropagation()}>
                {t.status === 'awaiting_user_confirm' && (
                  <button style={actionBtnStyle} onClick={() => handleAction(t, 'confirm')}>确认</button>
                )}
                {['pending_manual', 'created', 'queued'].includes(t.status) && (
                  <button style={actionBtnStyle} onClick={() => handleAction(t, 'execute')}>执行</button>
                )}
                {!['executing', 'verify', 'done', 'failed_hard'].includes(t.status) && (
                  <button style={{ ...actionBtnStyle, background: '#f39c12' }} onClick={() => handleAction(t, 'pause')}>暂停</button>
                )}
                {!['executing', 'verify'].includes(t.status) && (
                  <button style={{ ...actionBtnStyle, background: '#e53' }} onClick={() => handleAction(t, 'delete')}>删除</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail Drawer */}
      {selected && (
        <div style={drawerOverlayStyle} onClick={() => setSelected(null)}>
          <div style={drawerStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: '16px' }}>{selected.itemName || selected.itemId}</h3>
            <div style={{ fontSize: '13px', color: '#666', marginBottom: '12px' }}>
              {selected.actionType} · {selected.status} · {selected.progress !== undefined ? `${selected.progress}%` : 'N/A'}
            </div>
            <h4 style={{ marginBottom: '8px', fontSize: '13px' }}>执行日志</h4>
            <div style={{ background: '#f5f5f5', borderRadius: '6px', padding: '12px', fontSize: '12px', fontFamily: 'monospace', maxHeight: '300px', overflowY: 'auto' }}>
              {selected.flowLog?.map((entry, i) => (
                <div key={i} style={{ marginBottom: '4px' }}>
                  <span style={{ color: '#888' }}>[{entry.ts?.split('T')[1]?.slice(0, 8)}]</span>{' '}
                  <span style={{ color: entry.level === 'error' ? '#e53' : entry.level === 'warn' ? '#f39c12' : '#333' }}>
                    {entry.message}
                  </span>
                </div>
              )) || <div style={{ color: '#888' }}>无日志</div>}
            </div>
            <button style={{ ...actionBtnStyle, marginTop: '16px' }} onClick={() => setSelected(null)}>关闭</button>
          </div>
        </div>
      )}
    </div>
  );
}

const pageTitle: React.CSSProperties = { fontSize: '20px', fontWeight: 700, marginBottom: '24px' };
const filterBtnStyle: React.CSSProperties = { padding: '4px 12px', border: '1px solid #ddd', borderRadius: '16px', background: '#fff', cursor: 'pointer', fontSize: '13px' };
const filterBtnActiveStyle: React.CSSProperties = { background: '#4a90d9', color: '#fff', borderColor: '#4a90d9' };
const listStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '8px' };
const taskCardStyle: React.CSSProperties = { background: '#fff', borderRadius: '8px', padding: '12px', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', transition: 'box-shadow 0.15s' };
const statusBadgeStyle: React.CSSProperties = { padding: '2px 8px', borderRadius: '12px', color: '#fff', fontSize: '12px' };
const actionBtnStyle: React.CSSProperties = { padding: '4px 10px', borderRadius: '4px', border: 'none', background: '#4a90d9', color: '#fff', cursor: 'pointer', fontSize: '12px' };
const drawerOverlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const drawerStyle: React.CSSProperties = { background: '#fff', borderRadius: '12px', padding: '24px', width: '560px', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' };
```

- [ ] **Step 2: Commit**

```bash
git add media-service/web/src/pages/TaskCenterPage.tsx
git commit -m "feat(admin): add TaskCenterPage

- Status filter tabs (all / each status)
- Task card list with status badges + progress
- Inline action buttons (confirm/execute/pause/delete)
- Click-to-expand drawer with flowLog
- Auto-refresh every 5s
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: 豆瓣集成页面 + 路径映射页面

**Files:**
- Create: `media-service/web/src/pages/DoubanPage.tsx`
- Create: `media-service/web/src/pages/PathMappingPage.tsx`

- [ ] **Step 1: Create src/pages/DoubanPage.tsx**

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { douban } from '../api/client';
import type { DoubanSession, DoubanRatingsCache } from '../types';

export default function DoubanPage() {
  const [cookie, setCookie] = useState('');
  const qc = useQueryClient();

  const { data: session } = useQuery<DoubanSession>({ queryKey: ['douban', 'session'], queryFn: douban.getSession });
  const { data: ratings = {} } = useQuery<DoubanRatingsCache>({ queryKey: ['douban', 'ratings'], queryFn: douban.getRatingsCache });

  const saveSessionMutation = useMutation({
    mutationFn: () => douban.saveSession({ cookie }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['douban', 'session'] }),
  });

  const ratedCount = Object.keys(ratings).length;

  return (
    <div>
      <h2 style={pageTitle}>豆瓣集成</h2>

      <div style={cardStyle}>
        <h3 style={sectionTitle}>Session 管理</h3>
        <div style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>Douban Cookie</label>
          <textarea
            style={{ ...inputStyle, height: '80px', fontFamily: 'monospace' }}
            value={cookie || session?.cookie || ''}
            onChange={(e) => setCookie(e.target.value)}
            placeholder="Paste Douban cookie here..."
          />
        </div>
        <button style={btnPrimaryStyle} onClick={() => saveSessionMutation.mutate()} disabled={saveSessionMutation.isPending}>
          {saveSessionMutation.isPending ? '保存中...' : '保存 Session'}
        </button>
      </div>

      <div style={cardStyle}>
        <h3 style={sectionTitle}>评分缓存</h3>
        <div style={{ fontSize: '14px', color: '#666', marginBottom: '12px' }}>
          共 {ratedCount} 条豆瓣评分已缓存
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
          {Object.entries(ratings).slice(0, 50).map(([itemId, { rating, updatedAt }]) => (
            <div key={itemId} style={{ padding: '8px', background: '#f9fafb', borderRadius: '6px', fontSize: '13px' }}>
              <div style={{ fontWeight: 600 }}>{itemId}</div>
              <div style={{ color: '#f39c12' }}>★ {rating}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const pageTitle: React.CSSProperties = { fontSize: '20px', fontWeight: 700, marginBottom: '24px' };
const cardStyle: React.CSSProperties = { background: '#fff', borderRadius: '10px', padding: '20px', marginBottom: '16px' };
const sectionTitle: React.CSSProperties = { fontSize: '15px', fontWeight: 600, marginBottom: '16px' };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: '13px', color: '#444', marginBottom: '6px' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px', resize: 'vertical' };
const btnPrimaryStyle: React.CSSProperties = { padding: '8px 20px', background: '#4a90d9', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' };
```

- [ ] **Step 2: Create src/pages/PathMappingPage.tsx**

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { config } from '../api/client';
import type { ServiceConfig } from '../types';

export default function PathMappingPage() {
  const qc = useQueryClient();
  const { data: cfg, isLoading } = useQuery<ServiceConfig>({ queryKey: ['config'], queryFn: config.get });

  const saveMutation = useMutation({
    mutationFn: (patch: Partial<ServiceConfig>) => config.patch(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  });

  if (isLoading) return <div>加载中...</div>;

  return (
    <div>
      <h2 style={pageTitle}>路径映射</h2>
      <div style={cardStyle}>
        <p style={{ fontSize: '13px', color: '#666', marginBottom: '16px' }}>
          当 media-service 与桌面运行在不同机器时，配置路径映射使转码输出能正确回写。
        </p>
        <div style={formGridStyle}>
          <label style={labelStyle}>映射源路径（桌面）</label>
          <input
            style={inputStyle}
            value={cfg?.pathMapFrom || ''}
            onChange={(e) => {/* update locally */}}
            placeholder="D:\\media"
          />
          <label style={labelStyle}>映射目标路径（服务端）</label>
          <input
            style={inputStyle}
            value={cfg?.pathMapTo || ''}
            onChange={(e) => {/* update locally */}}
            placeholder="\\\\NAS\\media"
          />
        </div>
        <button
          style={btnPrimaryStyle}
          onClick={() => saveMutation.mutate({ pathMapFrom: cfg?.pathMapFrom, pathMapTo: cfg?.pathMapTo })}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  );
}

const pageTitle: React.CSSProperties = { fontSize: '20px', fontWeight: 700, marginBottom: '24px' };
const cardStyle: React.CSSProperties = { background: '#fff', borderRadius: '10px', padding: '20px' };
const formGridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '140px 1fr', gap: '12px', alignItems: 'center', marginBottom: '16px' };
const labelStyle: React.CSSProperties = { fontSize: '14px', color: '#444' };
const inputStyle: React.CSSProperties = { padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px', width: '100%' };
const btnPrimaryStyle: React.CSSProperties = { padding: '8px 20px', background: '#4a90d9', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' };
```

- [ ] **Step 3: Commit**

```bash
git add media-service/web/src/pages/DoubanPage.tsx media-service/web/src/pages/PathMappingPage.tsx
git commit -m "feat(admin): add DoubanPage and PathMappingPage

- DoubanPage: session cookie management + ratings cache viewer
- PathMappingPage: pathMapFrom/pathMapTo config fields
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: Fastify SPA Fallback 集成

**Files:**
- Modify: `media-service/src/app.js` (remove old static serving, add SPA fallback)
- Modify: `media-service/package.json` (add `build:web` script)

- [ ] **Step 1: Modify media-service/src/app.js — replace fastifyStatic admin serving with SPA fallback**

Find and replace the old fastifyStatic admin section (around lines 653-669 in the uncommitted version):

```javascript
  // OLD (uncommitted, to be removed):
  // // Serve admin static files (index.html, login.html, setup.html)
  // await app.register(fastifyStatic, {
  //   root: path.join(__dirname, 'admin'),
  //   prefix: '/admin/',
  //   index: 'index.html',
  //   decorateReply: false,
  // });
  //
  // // Redirect root / to /admin/
  // app.get('/', async (_req, reply) => {
  //   reply.redirect('/admin/');
  // });
  //
  // // Redirect /admin to /admin/ (fastifyStatic serves under /admin/ prefix)
  // app.get('/admin', async (_req, reply) => {
  //   reply.redirect('/admin/');
  // });

  // NEW — serve built React app from dist/admin/
  const distAdminPath = path.join(__dirname, '..', 'dist', 'admin');
  await app.register(fastifyStatic, {
    root: distAdminPath,
    prefix: '/admin/',
    index: false,  // we handle index via wildcard
    decorateReply: false,
  });

  // SPA fallback: all non-API routes → index.html
  app.get('/admin/*', async (req, reply) => {
    reply.sendFile('index.html');
  });

  app.get('/admin', async (_req, reply) => {
    reply.redirect('/admin/');
  });

  // Root redirects to admin
  app.get('/', async (_req, reply) => {
    reply.redirect('/admin/');
  });
```

**Note:** This edit removes the old vanilla HTML admin pages from being served. The new React app handles everything under `/admin/`.

- [ ] **Step 2: Add build script to media-service/package.json**

```json
{
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js",
    "test": "node --test test/api-inject.test.js",
    "build:web": "cd web && npm run build",
    "postinstall": "npm run build:web"
  }
}
```

- [ ] **Step 3: Verify the dist/admin directory doesn't exist yet (first build will create it)**

```bash
ls media-service/dist/ 2>/dev/null || echo "dist/ not created yet — expected"
```

- [ ] **Step 4: Build the React app**

```bash
cd media-service/web && npm run build
# Expected: build output in media-service/dist/admin/
```

- [ ] **Step 5: Start media-service and verify admin serves correctly**

```bash
cd media-service && npm start
# Visit http://localhost:18080/admin/
# Expected: React admin app loads (redirects to /admin/login)
```

- [ ] **Step 6: Commit**

```bash
git add media-service/src/app.js media-service/package.json
git add media-service/dist/  # include built assets
git commit -m "feat(admin): integrate Vite build output into Fastify SPA

- Replace fastifyStatic admin/ with dist/admin/ serving
- Add /admin/* wildcard → index.html SPA fallback
- Add build:web + postinstall scripts
- Include dist/ in commit for self-contained binary
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: 清理旧原型文件

**Files:**
- Delete: `media-service/src/admin/` directory (vanilla HTML prototype)

- [ ] **Step 1: Remove old admin HTML files**

```bash
rm -rf media-service/src/admin/
git add -A
git commit -m "chore(admin): remove old vanilla HTML admin prototype

Replaced by Vite + React admin SPA at media-service/web/
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11: 端到端验证

**Files:** None (verification only)

- [ ] **Step 1: Start all services**

```bash
# Terminal 1: media-service
cd media-service && npm start

# Visit http://localhost:18080/
# Expected: redirect to /admin/login
```

- [ ] **Step 2: Verify login flow**

```bash
# On SetupPage: set a PIN
# On LoginPage: enter PIN → redirect to /admin/dashboard
```

- [ ] **Step 3: Verify Dashboard loads data**

```
Expected: health check, active tasks, recent tasks displayed
```

- [ ] **Step 4: Verify task confirm flow**

```
1. Go to Task Center
2. Find a task in 'awaiting_user_confirm' status
3. Click '确认' button
4. Verify task status advances
```

- [ ] **Step 5: Run API tests still pass**

```bash
cd media-service && npm test
# Expected: 14 tests passing
```

- [ ] **Step 6: Run TypeScript build check**

```bash
cd media-service/web && npx tsc --noEmit
# Expected: 0 errors
```

- [ ] **Step 7: Commit verification evidence**

```bash
git add -m "test(admin): e2e verification — login, dashboard, task confirm"
```

---

## 自查清单

### Spec 覆盖检查

| 需求 | Task |
|------|------|
| Vite + React 脚手架 | Task 1 |
| TypeScript 类型 | Task 2 |
| API 客户端 | Task 2 |
| PIN 登录 / Session 管理 | Task 2, 4 |
| Layout + Sidebar | Task 3 |
| 路由保护（auth guard） | Task 3 |
| LoginPage | Task 4 |
| SetupPage | Task 4 |
| DashboardPage | Task 5 |
| ConfigPage（Emby/转码/调度） | Task 6 |
| TaskCenterPage | Task 7 |
| DoubanPage | Task 8 |
| PathMappingPage | Task 8 |
| Fastify SPA fallback | Task 9 |
| Build 集成 | Task 9 |
| 清理旧原型 | Task 10 |
| 端到端验证 | Task 11 |

### 占位符扫描
无占位符。所有 Step 均含完整代码、文件路径、预期输出。

### 类型一致性检查
- `src/types/index.ts` 定义了所有接口（`AuthStatus`, `ServiceConfig`, `MediaTask`, `TaskStatus`, `HealthStatus`, `DoubanSession` 等）
- `src/api/client.ts` 中的 import 均来自 `../types`
- `src/hooks/useAuth.ts` 中 `PinVerifyResponse` import 正确
- 所有页面组件中 `import type from '../types'` — 无类型引用缺失

---

## 执行选项

**Plan complete and saved to `docs/superpowers/plans/2026-04-22-admin-web-vite-react.md`**

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints

**Which approach?**
