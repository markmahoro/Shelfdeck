/**
 * 渲染进程与 preload 中 effectiveBaseUrl 对齐（DESIGN_DESKTOP_BACKEND_ENDPOINT）。
 * fetch 类路径不走 preload 时使用。
 */

export function getRendererMediaServiceBaseUrl(): string | undefined {
  const w = window as Window & {
    shelfdeckMedia?: { getEffective: () => { baseUrl: string; apiKey?: string } };
  };
  if (w.shelfdeckMedia?.getEffective) {
    const b = w.shelfdeckMedia.getEffective().baseUrl;
    if (b && typeof b === 'string') return b.replace(/\/$/, '');
  }
  const v = import.meta.env.VITE_MEDIA_SERVICE_URL || import.meta.env.VITE_CONTROL_PLANE_URL;
  return typeof v === 'string' && v.trim() ? v.replace(/\/$/, '') : undefined;
}

export function getRendererMediaServiceApiKey(): string {
  const w = window as Window & {
    shelfdeckMedia?: { getEffective: () => { baseUrl: string; apiKey?: string } };
  };
  if (w.shelfdeckMedia?.getEffective) {
    return w.shelfdeckMedia.getEffective().apiKey || '';
  }
  const k = import.meta.env.VITE_MEDIA_SERVICE_API_KEY || import.meta.env.VITE_CONTROL_PLANE_API_KEY;
  return typeof k === 'string' ? k : '';
}
