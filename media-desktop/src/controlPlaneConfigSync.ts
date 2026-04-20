/** 将当前 Emby / 路径相关快照同步到媒体管理服务，供 OpenAPI 风格 GET `/v1/library/items/...` 使用（MCP / 工具同源）。 */

import { getRendererMediaServiceApiKey, getRendererMediaServiceBaseUrl } from './cpBase';

export function pushEmbyClientToControlPlane(cfg: EmbyConfig): void {
  const base = getRendererMediaServiceBaseUrl();
  if (!base) return;
  const url = `${String(base).replace(/\/$/, '')}/v1/config`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const k = getRendererMediaServiceApiKey();
  if (k) headers['X-API-Key'] = k;
  const embyClient = {
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    userId: cfg.userId,
    embyUserPassword: cfg.embyUserPassword,
    enabledSectionIds: cfg.enabledSectionIds,
    playerExePath: cfg.playerExePath,
    argsTemplate: cfg.argsTemplate,
    pathMapFrom: cfg.pathMapFrom,
    pathMapTo: cfg.pathMapTo,
    markPlayedThresholdPercent: cfg.markPlayedThresholdPercent,
    fallbackMinSeconds: cfg.fallbackMinSeconds,
    transcodeTempRoot: cfg.transcodeTempRoot,
    ffmpegPath: cfg.ffmpegPath,
    ffprobePath: cfg.ffprobePath,
  };
  void fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ embyClient }),
  }).catch(() => {
    /* 媒体管理服务未启动时不阻断 UI */
  });
}
