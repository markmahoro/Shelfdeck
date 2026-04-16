export {};

declare global {
  type EmbyMediaFolder = { id: string; name: string };
  type EmbyUser = { id: string; name: string };
  type UnplayedItem = {
    id: string;
    name: string;
    posterTag?: string;
    runTimeTicks?: number;
    sectionId: string;
  };
  type PlayedItem = {
    id: string;
    name: string;
    seriesName?: string;
    indexLabel?: string;
    sectionId?: string;
    sectionName?: string;
    datePlayed?: string;
    type: 'Movie' | 'Episode' | 'Other' | 'Unknown';
  };

  type EmbyConfig = {
    baseUrl: string;
    apiKey: string;
    userId: string;
    enabledSectionIds: string[];
    playerExePath: string;
    argsTemplate: string;
    pathMapFrom: string;
    pathMapTo: string;
    markPlayedThresholdPercent: number;
    fallbackMinSeconds: number;
  };

  type LaunchResult = {
    sessionStartedAtMs: number;
    runtimeSeconds?: number;
    debug?: {
      originalPath?: string;
      mappedPath?: string;
      resolvedArgs?: string;
      args?: string[];
    };
  };

  interface Window {
    embyApi: {
      testConnection: (config: { baseUrl: string; apiKey: string }) => Promise<{ serverName?: string; version?: string }>;
      getUsers: (config: { baseUrl: string; apiKey: string }) => Promise<EmbyUser[]>;
      getMediaFolders: (config: { baseUrl: string; apiKey: string }) => Promise<EmbyMediaFolder[]>;
      getUnplayedItems: (args: { config: EmbyConfig; sectionId: string }) => Promise<UnplayedItem[]>;
      getPlayedItems: (args: { config: EmbyConfig; days?: 7 | 30 | 0; sectionId?: string; type?: 'all' | 'Movie' | 'Episode' }) => Promise<PlayedItem[]>;
      launchPlayer: (args: { config: EmbyConfig; item: UnplayedItem }) => Promise<LaunchResult>;
      markPlayed: (args: { config: EmbyConfig; itemId: string }) => Promise<void>;
      markUnplayed: (args: { config: EmbyConfig; itemId: string }) => Promise<void>;
    };
  }
}
