/**
 * [SETTINGS] desktop 本地设置数据模型与 IPC 桥接。
 *
 * 持久化通过 electron-store（主进程），渲染进程通过 window.embyApi 间接读写。
 */

export interface DesktopSettings {
  serviceUrl: string;
  serviceApiKey: string;
  playerExePath: string;
  localPathMapFrom: string;
  localPathMapTo: string;
}

declare global {
  interface Window {
    embyApi?: {
      getSettings: () => Promise<DesktopSettings>;
      saveSetting: (key: string, value: string) => Promise<{ ok: boolean; error?: string }>;
      launchPath: (args: unknown) => Promise<unknown>;
      markPlayed: (args: unknown) => Promise<void>;
      markUnplayed: (args: unknown) => Promise<void>;
      getPlayedItems: (args: unknown) => Promise<unknown[]>;
      getUnplayedItems: (args: unknown) => Promise<unknown[]>;
      getEffectiveConnection: () => { baseUrl: string; apiKey: string; source?: string };
      onConnectionUpdated: (cb: () => void) => () => void;
      [key: string]: unknown;
    };
  }
}

const STORE_KEYS = {
  serviceUrl: 'shelfdeck.mediaService.baseUrl',
  serviceApiKey: 'shelfdeck.mediaService.apiKey',
  playerExePath: 'shelfdeck.playerExePath',
  localPathMapFrom: 'shelfdeck.localPathMapFrom',
  localPathMapTo: 'shelfdeck.localPathMapTo',
} as const;

export async function getSettings(): Promise<DesktopSettings> {
  if (!window.embyApi?.getSettings) {
    return { serviceUrl: 'http://127.0.0.1:18080', serviceApiKey: '', playerExePath: '', localPathMapFrom: '', localPathMapTo: '' };
  }
  return window.embyApi.getSettings();
}

export async function saveSetting(key: keyof typeof STORE_KEYS, value: string): Promise<{ ok: boolean; error?: string }> {
  if (!window.embyApi?.saveSetting) return { ok: false, error: '设置通道不可用' };
  return window.embyApi.saveSetting(STORE_KEYS[key], value);
}

export { STORE_KEYS };
