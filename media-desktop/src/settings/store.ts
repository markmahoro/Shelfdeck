/**
 * [SETTINGS] desktop 本地设置数据模型与 IPC 桥接。
 *
 * 所有持久化通过 electron-store（主进程），渲染进程通过 window.shelfdeckSettings 间接读写。
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
    shelfdeckSettings?: {
      get: () => Promise<DesktopSettings>;
      set: (key: string, value: unknown) => Promise<boolean>;
      getKey: (key: string) => Promise<unknown>;
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
  if (!window.shelfdeckSettings) {
    return { serviceUrl: 'http://127.0.0.1:18080', serviceApiKey: '', playerExePath: '', localPathMapFrom: '', localPathMapTo: '' };
  }
  return window.shelfdeckSettings.get();
}

export async function saveSetting(key: keyof typeof STORE_KEYS, value: string): Promise<boolean> {
  if (!window.shelfdeckSettings) return false;
  return window.shelfdeckSettings.set(STORE_KEYS[key], value);
}

export { STORE_KEYS };
