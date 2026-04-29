/**
 * [CONNECTION] service 连接地址解析（渲染进程侧 / 测试环境通用）。
 *
 * 消费预加载中暴露的 window.embyApi，不直接读 electron-store 或环境变量。
 * 测试环境中 window 不存在时降级到 Vite env / 默认值。
 */

/** Safe window access for environments where window may not exist (vitest/Node). */
function getWindowEmbyApi(): { getEffectiveConnection?: () => { baseUrl: string; apiKey?: string } } | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as Window & {
    embyApi?: { getEffectiveConnection: () => { baseUrl: string; apiKey?: string } };
  };
  return w.embyApi;
}

export function getBaseUrl(): string {
  const api = getWindowEmbyApi();
  if (api?.getEffectiveConnection) {
    const b = api.getEffectiveConnection().baseUrl;
    if (b && typeof b === 'string') return b.replace(/\/$/, '');
  }
  const v = import.meta.env.VITE_MEDIA_SERVICE_URL || import.meta.env.VITE_CONTROL_PLANE_URL;
  return typeof v === 'string' && v.trim() ? v.trim().replace(/\/$/, '') : 'http://127.0.0.1:18080';
}

export function getApiKey(): string {
  const api = getWindowEmbyApi();
  if (api?.getEffectiveConnection) return api.getEffectiveConnection().apiKey || '';
  const k = import.meta.env.VITE_MEDIA_SERVICE_API_KEY || import.meta.env.VITE_CONTROL_PLANE_API_KEY;
  return typeof k === 'string' ? k : '';
}
