import type {
  EmbyServer,
  EmbyUser,
  MediaFolder,
  EmbyTestResult,
  SubLibrary,
  TranscodeConfig,
  EncodeDevice,
  DevicePool,
  TaskListResponse,
  MediaTask,
  HealthStatus,
  DoubanSession,
} from '../types';

function apiKey(): string {
  return localStorage.getItem('admin_api_key') || '';
}

async function get<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {};
  const key = apiKey();
  if (key) headers['x-api-key'] = key;
  const res = await fetch(path, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const key = apiKey();
  if (key) headers['x-api-key'] = key;
  const res = await fetch(path, { method: 'POST', headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = apiKey();
  if (key) headers['x-api-key'] = key;
  const res = await fetch(path, { method: 'PATCH', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

async function del<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {};
  const key = apiKey();
  if (key) headers['x-api-key'] = key;
  const res = await fetch(path, { method: 'DELETE', headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = apiKey();
  if (key) headers['x-api-key'] = key;
  const res = await fetch(path, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Emby ─────────────────────────────────────────────────────────────────────

export const emby = {
  getServers: () => get<{ servers: EmbyServer[] }>('/v1/admin/emby/servers'),

  testConnection: (body: { baseUrl: string; apiKey: string; userId: string }) =>
    post<EmbyTestResult>('/v1/admin/emby/test', body),

  getUsers: (embyServerId: string) =>
    get<{ users: EmbyUser[] }>(`/v1/admin/emby/users?embyServerId=${encodeURIComponent(embyServerId)}`),

  getMediaFolders: (embyServerId: string) =>
    get<{ folders: MediaFolder[] }>(`/v1/admin/emby/media-folders?embyServerId=${encodeURIComponent(embyServerId)}`),
};

// ── SubLibraries ─────────────────────────────────────────────────────────────

export const subLibraries = {
  list: () => get<{ subLibraries: SubLibrary[] }>('/v1/admin/sublibraries'),

  create: (body: {
    name: string;
    embyServerId: string;
    sectionId: string;
    source?: string;
    doubanEnabled?: boolean;
    mediaPolicy?: SubLibrary['mediaPolicy'];
  }) => post<SubLibrary>('/v1/admin/sublibraries', body),

  update: (uuid: string, body: Partial<SubLibrary>) =>
    patch<SubLibrary>(`/v1/admin/sublibraries/${uuid}`, body),

  remove: (uuid: string) =>
    del<{ ok: boolean; uuid: string }>(`/v1/admin/sublibraries/${uuid}`),
};

// ── Transcode ────────────────────────────────────────────────────────────────

export const transcode = {
  getConfig: () => get<TranscodeConfig>('/v1/admin/transcode/config'),

  patchConfig: (body: Partial<TranscodeConfig>) =>
    patch<TranscodeConfig>('/v1/admin/transcode/config', body),

  probeDevices: () =>
    get<{ devices: EncodeDevice[] }>('/v1/admin/transcode/probe-devices'),

  getDevicePool: () => get<DevicePool>('/v1/admin/transcode/device-pool'),
};

// ── Upgrade (MoviePilot) ─────────────────────────────────────────────────────

export interface UpgradeConfig {
  moviepilot: { baseUrl: string; apiKey: string; savePath: string; stagingPath: string };
  upgradeStagingLocalPath: string;
  upgradeRetryInterval: number;
  upgradeMaxRetries: number;
}

export const upgrade = {
  getConfig: () => get<UpgradeConfig>('/v1/admin/upgrade/config'),

  patchConfig: (body: Partial<UpgradeConfig>) =>
    patch<UpgradeConfig>('/v1/admin/upgrade/config', body),
};

// ── Tasks ────────────────────────────────────────────────────────────────────

export const tasks = {
  list: (params?: { status?: string; actionType?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.actionType) qs.set('actionType', params.actionType);
    const q = qs.toString();
    return get<TaskListResponse>(`/v1/admin/tasks${q ? `?${q}` : ''}`);
  },

  get: (id: string) => get<MediaTask>(`/v1/admin/tasks/${id}`),

  remove: (id: string) =>
    del<{ ok: boolean; id: string }>(`/v1/admin/tasks/${id}`),

  pause: (id: string) => post<{ id: string; status: string }>(`/v1/tasks/${id}/actions/pause`),

  execute: (id: string) => post<{ id: string; status: string }>(`/v1/tasks/${id}/actions/execute`),

  confirm: (id: string, confirmData?: Record<string, unknown>) =>
    patch<{ id: string; status: string }>(`/v1/tasks/${id}`, { confirmed: true, ...(confirmData ? { confirmData } : {}) }),
};

// ── Health ────────────────────────────────────────────────────────────────────

export const health = {
  check: () => get<HealthStatus>('/v1/admin/health'),
};

// ── Public health ─────────────────────────────────────────────────────────────

export const publicHealth = {
  check: () => get<{ status: 'green' | 'yellow' | 'red'; timestamp: string }>('/v1/health'),
};

// ── System Config ─────────────────────────────────────────────────────────────

export interface SystemConfig {
  executionMode: 'auto' | 'manual';
  deleteConcurrency: number;
  transcodeConcurrency: number;
  upgradeConcurrency: number;
  wallRatingAutoEnqueue: boolean;
  smartTaskMaxPerRun: number;
  smartTaskEnabledActions: string[];
  smartTaskPollIntervalMinutes: number;
  smartTaskLookbackDays: number;
  strategyPollIntervalMinutes: number;
}

export const systemConfig = {
  get: () => get<SystemConfig>('/v1/config'),

  patch: (body: Partial<SystemConfig>) =>
    patch<SystemConfig>('/v1/config', body),
};

// ── Douban ─────────────────────────────────────────────────────────────────────

export const douban = {
  getSession: () => get<DoubanSession>('/v1/integrations/douban/session'),

  saveSession: (body: DoubanSession) =>
    put<DoubanSession>('/v1/integrations/douban/session', body),

  fetchRatings: (subLibraryId: string) =>
    get<{ ok: boolean; message: string }>(`/v1/integrations/douban/fetch/ratings?subLibraryId=${encodeURIComponent(subLibraryId)}`),
};
