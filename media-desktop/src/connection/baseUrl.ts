/**
 * [CONNECTION] service 连接地址解析（渲染进程侧）。
 *
 * 消费预加载中暴露的 window.shelfdeckMedia，不直接读 electron-store 或环境变量。
 */

export function getBaseUrl(): string {
  const w = window as Window & {
    shelfdeckMedia?: { getEffective: () => { baseUrl: string; apiKey?: string } };
  };
  if (w.shelfdeckMedia?.getEffective) {
    const b = w.shelfdeckMedia.getEffective().baseUrl;
    if (b && typeof b === 'string') return b.replace(/\/$/, '');
  }
  const v = import.meta.env.VITE_MEDIA_SERVICE_URL || import.meta.env.VITE_CONTROL_PLANE_URL;
  return typeof v === 'string' && v.trim() ? v.trim().replace(/\/$/, '') : 'http://127.0.0.1:18080';
}

export function getApiKey(): string {
  const w = window as Window & {
    shelfdeckMedia?: { getEffective: () => { baseUrl: string; apiKey?: string } };
  };
  if (w.shelfdeckMedia?.getEffective) return w.shelfdeckMedia.getEffective().apiKey || '';
  const k = import.meta.env.VITE_MEDIA_SERVICE_API_KEY || import.meta.env.VITE_CONTROL_PLANE_API_KEY;
  return typeof k === 'string' ? k : '';
}
