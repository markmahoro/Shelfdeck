/**
 * [CONNECTION] service 健康检查（3s 超时）。
 */

import { getBaseUrl, getApiKey } from './baseUrl';

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function checkHealth(): Promise<boolean> {
  // 优先使用 preload 桥接
  if (typeof window !== 'undefined' && window.mediaService?.checkHealth) {
    try {
      const r = await withTimeout(window.mediaService.checkHealth(), 3000, null);
      if (!r) return false;
      const st = typeof r === 'object' && 'status' in r ? (r as { status?: string }).status : undefined;
      return st === 'green' || st === 'yellow';
    } catch {
      return false;
    }
  }

  // 降级：渲染进程直接 fetch
  const base = getBaseUrl();
  const apiKey = getApiKey();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const headers: Record<string, string> = {};
    if (apiKey) headers['X-API-Key'] = apiKey;
    const res = await fetch(`${base}/v1/health`, { headers, method: 'GET', signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const j = (await res.json().catch(() => null)) as { status?: string } | null;
    return j?.status === 'green' || j?.status === 'yellow';
  } catch {
    return false;
  }
}
