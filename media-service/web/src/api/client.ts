import type {
  AuthStatus,
  PinVerifyResponse,
  ServiceConfig,
  MediaTask,
  HealthStatus,
  EmbyUser,
  MediaFolder,
  DoubanSession,
  DoubanRatingsCache,
} from '../types';

// ── Auth ─────────────────────────────────────────────────────────────────────

async function pinAction(action: 'set' | 'verify', pin: string): Promise<PinVerifyResponse> {
  const res = await fetch('/v1/admin/pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, pin }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `HTTP ${res.status}`);
  }
  return res.json();
}

export const auth = {
  getStatus: () =>
    fetch('/v1/admin/auth-status')
      .then((r) => r.json() as Promise<AuthStatus>),

  setPin: (pin: string) => pinAction('set', pin),

  verifyPin: (pin: string) => pinAction('verify', pin),

  shutdown: () =>
    fetch('/v1/admin/shutdown', {
      method: 'POST',
      headers: { 'x-admin-session': sessionStorage.getItem('admin_session') || '' },
    }).then((r) => {
      if (!r.ok && r.status !== 204) {
        throw new Error(`HTTP ${r.status}`);
      }
    }),
};

// ── Config ───────────────────────────────────────────────────────────────────

export const config = {
  get: () =>
    fetch('/v1/admin/config', {
      headers: { 'x-admin-session': sessionStorage.getItem('admin_session') || '' },
    }).then((r) => r.json() as Promise<ServiceConfig>),

  patch: (patch: Partial<ServiceConfig>) =>
    fetch('/v1/config', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-session': sessionStorage.getItem('admin_session') || '',
      },
      body: JSON.stringify(patch),
    }).then((r) => r.json() as Promise<ServiceConfig>),
};

// ── Tasks ────────────────────────────────────────────────────────────────────

export const tasks = {
  list: (filter?: { status?: string; actionType?: string }): Promise<MediaTask[]> => {
    const params = new URLSearchParams();
    if (filter?.status) params.set('status', filter.status);
    if (filter?.actionType) params.set('actionType', filter.actionType);
    const qs = params.toString();
    return fetch(`/v1/tasks${qs ? `?${qs}` : ''}`, {
      headers: { 'x-admin-session': sessionStorage.getItem('admin_session') || '' },
    }).then((r) => r.json() as Promise<MediaTask[]>);
  },

  get: (taskId: string): Promise<MediaTask> =>
    fetch(`/v1/tasks/${taskId}`, {
      headers: { 'x-admin-session': sessionStorage.getItem('admin_session') || '' },
    }).then((r) => r.json() as Promise<MediaTask>),

  confirm: (taskId: string) =>
    fetch(`/v1/tasks/${taskId}/actions/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-session': sessionStorage.getItem('admin_session') || '',
      },
      body: JSON.stringify({ confirmed: true }),
    }).then((r) => r.json() as Promise<{ ok: boolean }>),

  pause: (taskId: string) =>
    fetch(`/v1/tasks/${taskId}/actions/pause`, {
      method: 'POST',
      headers: { 'x-admin-session': sessionStorage.getItem('admin_session') || '' },
    }).then((r) => r.json() as Promise<{ ok: boolean }>),

  execute: (taskId: string) =>
    fetch(`/v1/tasks/${taskId}/actions/execute`, {
      method: 'POST',
      headers: { 'x-admin-session': sessionStorage.getItem('admin_session') || '' },
    }).then((r) => r.json() as Promise<{ ok: boolean }>),

  delete: (taskId: string) =>
    fetch(`/v1/tasks/${taskId}`, {
      method: 'DELETE',
      headers: { 'x-admin-session': sessionStorage.getItem('admin_session') || '' },
    }).then((r) => {
      if (r.status !== 204 && !r.ok) {
        throw new Error(`HTTP ${r.status}`);
      }
    }),
};

// ── Health ──────────────────────────────────────────────────────────────────

export const health = {
  check: () =>
    fetch('/v1/health').then((r) => r.json() as Promise<HealthStatus>),
};

// ── Emby ─────────────────────────────────────────────────────────────────────

export const emby = {
  testConnection: (body: { baseUrl: string; apiKey: string; userId: string }) =>
    fetch('/v1/emby/actions/test-connection', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-session': sessionStorage.getItem('admin_session') || '',
      },
      body: JSON.stringify(body),
    }).then((r) => r.json() as Promise<{ ok: boolean; message?: string }>),

  listUsers: (body: { baseUrl: string; apiKey: string }) =>
    fetch('/v1/emby/actions/list-users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-session': sessionStorage.getItem('admin_session') || '',
      },
      body: JSON.stringify(body),
    }).then((r) => r.json() as Promise<EmbyUser[]>),

  listMediaFolders: (body: { baseUrl: string; apiKey: string }) =>
    fetch('/v1/emby/actions/list-media-folders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-session': sessionStorage.getItem('admin_session') || '',
      },
      body: JSON.stringify(body),
    }).then((r) => r.json() as Promise<MediaFolder[]>),
};

// ── Douban ───────────────────────────────────────────────────────────────────

export const douban = {
  getSession: () =>
    fetch('/v1/integrations/douban/session').then((r) => r.json() as Promise<DoubanSession>),

  saveSession: (session: DoubanSession) =>
    fetch('/v1/integrations/douban/session', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-session': sessionStorage.getItem('admin_session') || '',
      },
      body: JSON.stringify(session),
    }),

  getRatingsCache: () =>
    fetch('/v1/integrations/douban/ratings/cache').then((r) => r.json() as Promise<DoubanRatingsCache>),

  getRatings: () =>
    fetch('/v1/library/ratings').then((r) => r.json() as Promise<DoubanRatingsCache>),

  patchRatings: (patch: Record<string, { rating: number }>) =>
    fetch('/v1/library/ratings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-session': sessionStorage.getItem('admin_session') || '',
      },
      body: JSON.stringify(patch),
    }).then((r) => r.json() as Promise<{ ok: boolean; count: number }>),
};
