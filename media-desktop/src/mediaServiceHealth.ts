/**
 * 媒体管理服务可达性：与 electron/preload 中 effectiveBaseUrl、Vite 环境变量同构。
 */

import { getRendererMediaServiceApiKey, getRendererMediaServiceBaseUrl } from './cpBase';

function devBaseUrl(): string {
  return getRendererMediaServiceBaseUrl() || 'http://127.0.0.1:18080';
}

function devApiKey(): string {
  return getRendererMediaServiceApiKey();
}

/**
 * @returns 若 `GET /v1/health` 返回 200 且 body 含 `status === 'ok'` 则为 true。
 */
export async function checkMediaServiceHealth(): Promise<boolean> {
  if (typeof window !== 'undefined' && window.mediaService?.checkHealth) {
    try {
      const r = await window.mediaService.checkHealth();
      const st = r && typeof r === 'object' && 'status' in r ? (r as { status?: string }).status : undefined;
      return st === 'ok';
    } catch {
      return false;
    }
  }

  const base = devBaseUrl();
  const apiKey = devApiKey();
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers['X-API-Key'] = apiKey;
    const res = await fetch(`${base}/v1/health`, { headers, method: 'GET' });
    if (!res.ok) return false;
    const j = (await res.json().catch(() => null)) as { status?: string } | null;
    return j?.status === 'ok';
  } catch {
    return false;
  }
}
