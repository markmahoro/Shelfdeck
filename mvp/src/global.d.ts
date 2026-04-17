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
    /** 来自 Emby MediaSources（或调试桩）；用于治理页码率估算 */
    durationSec?: number;
    sizeGb?: number;
    resolution?: '1080p' | '4K';
    codec?: 'h264' | 'h265' | 'av1';
    /** Emby UserData.Played；治理列表已看状态以服务器为准时的来源 */
    embyPlayed?: boolean;
    /** Emby Item.Type：电影 / 剧集单集 / 其它 */
    itemType?: 'Movie' | 'Episode' | 'Other';
    /** ISO / BDMV 等原盘（Path 与类型推断） */
    isBluRayDisc?: boolean;
  };
  type PlayedItem = {
    id: string;
    name: string;
    posterTag?: string;
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

  type TaskRunMode = 'manual' | 'scheduled';
  type TaskControlAction = 'start' | 'pause' | 'simulateExit' | 'resumeInterrupted';
  type TaskSchedulerSettings = {
    transcodeConcurrency: number;
    upgradeConcurrency: number;
    runMode: TaskRunMode;
    waitingFastRetryCount: number;
    waitingFastIntervalHours: number;
    waitingMidRetryCount: number;
    waitingMidIntervalDays: number;
    waitingSlowIntervalDays: number;
    /** 海报墙：观看确认并打完分后是否按策略自动入队（§4.4） */
    wallRatingAutoEnqueue: boolean;
  };

  type DoubanRatingEntryWire = { title: string; stars: number; subjectId: string };

  type DoubanFetchProgressPayload = {
    pageIndex: number;
    start: number;
    pageSize: number;
    allEntries: DoubanRatingEntryWire[];
    done: boolean;
    cancelled: boolean;
  };

  interface Window {
    embyApi: {
      testConnection: (config: { baseUrl: string; apiKey: string }) => Promise<{ serverName?: string; version?: string }>;
      getUsers: (config: { baseUrl: string; apiKey: string }) => Promise<EmbyUser[]>;
      getMediaFolders: (config: { baseUrl: string; apiKey: string }) => Promise<EmbyMediaFolder[]>;
      getUnplayedItems: (args: { config: EmbyConfig; sectionId: string }) => Promise<UnplayedItem[]>;
      /** 已启用库内全部影片/剧集（含已观看），媒体库管理专用 */
      getLibraryItemsForManage: (args: { config: EmbyConfig }) => Promise<UnplayedItem[]>;
      getPlayedItems: (args: { config: EmbyConfig; days?: 7 | 30 | 0; sectionId?: string; type?: 'all' | 'Movie' | 'Episode' }) => Promise<PlayedItem[]>;
      launchPlayer: (args: { config: EmbyConfig; item: UnplayedItem }) => Promise<LaunchResult>;
      markPlayed: (args: { config: EmbyConfig; itemId: string }) => Promise<void>;
      markUnplayed: (args: { config: EmbyConfig; itemId: string }) => Promise<void>;
      taskControl?: (args: { action: TaskControlAction; settings?: TaskSchedulerSettings }) => Promise<void>;
    };
    doubanApi?: {
      saveSession: (payload: { cookieHeader: string; userId: string; interestsRssUrl?: string }) => Promise<{
        cookieHeader: string;
        userId: string;
        interestsRssUrl?: string;
      }>;
      getSession: () => Promise<{
        cookieHeader: string;
        userId: string;
        interestsRssUrl?: string;
      } | null>;
      stopFetch: () => Promise<void>;
      fetchRatings: (opts?: {
        /** 默认 true：与 existingEntries 合并，遇整页 subjectId 均已缓存则提前结束 */
        incremental?: boolean;
        existingEntries?: DoubanRatingEntryWire[];
      }) => Promise<{ entries: DoubanRatingEntryWire[]; cancelled: boolean }>;
      onProgress: (listener: (payload: DoubanFetchProgressPayload) => void) => () => void;
    };
  }
}
