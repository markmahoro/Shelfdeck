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

  type TranscodeEncodeBackend = 'nvenc' | 'qsv' | 'amf' | 'cpu';

  type TranscodeProbeDeviceRow = {
    stableKey: string;
    label: string;
    backend: TranscodeEncodeBackend;
    gpuIndex: number;
  };

  type TranscodeEncodePoolEntry = {
    stableKey: string;
    inPool: boolean;
    maxSlots: number;
    priority: number;
  };

  /** §5.1 / §7.4 */
  type TranscodeEncodePoolSettings = {
    cpuParticipation: 1 | 2;
    entries: TranscodeEncodePoolEntry[];
  };

  type EmbyConfig = {
    baseUrl: string;
    apiKey: string;
    userId: string;
    /** 所选 Emby 用户登录密码（仅本地存储）；用于删除等媒体写操作换取用户 AccessToken，避免 API Key 下 Parameter user null */
    embyUserPassword: string;
    enabledSectionIds: string[];
    playerExePath: string;
    argsTemplate: string;
    pathMapFrom: string;
    pathMapTo: string;
    markPlayedThresholdPercent: number;
    fallbackMinSeconds: number;
    /** 转码临时根目录（每任务子目录）；必填方可执行真实转码 */
    transcodeTempRoot: string;
    /** 可选：ffmpeg 可执行文件绝对路径 */
    ffmpegPath: string;
    /** 可选：ffprobe 可执行文件绝对路径 */
    ffprobePath: string;
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
    deleteConcurrency: number;
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
    /** 转码：校验通过后不经「替换前确认」直接执行 replace */
    transcodeAutoReplace: boolean;
    /** §5.1 编码资源池（每设备子槽 + CPU 参与策略） */
    transcodeEncodePool: TranscodeEncodePoolSettings;
  };

  type TranscodeValidateToolsResult = {
    ffmpeg: string;
    ffprobe: string;
    libplacebo: boolean;
    inPoolCount: number;
  };

  type TranscodeOrphanEntry = { path: string; size: number };

  type TranscodeStatPathEntry = { path: string; exists: boolean; size: number };

  type TranscodeReplaceResult = {
    preReplaceHash: string;
    resultSizeBytes: number;
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
    electronAPI?: { isElectron: true };
    embyApi?: {
      getSettings: () => Promise<{ serviceUrl: string; serviceApiKey: string; playerExePath: string; localPathMapFrom: string; localPathMapTo: string; subLibraryPathMaps: Record<string, { from: string; to: string }> }>;
      saveSetting: (key: string, value: unknown) => Promise<{ ok: boolean; error?: string }>;
      getEffectiveConnection: () => { baseUrl: string; apiKey: string; source?: string };
      onConnectionUpdated: (listener: () => void) => () => void;
      testConnection: (config: { baseUrl: string; apiKey: string }) => Promise<{ serverName?: string; version?: string }>;
      getUsers: (config: { baseUrl: string; apiKey: string }) => Promise<EmbyUser[]>;
      getMediaFolders: (config: { baseUrl: string; apiKey: string }) => Promise<EmbyMediaFolder[]>;
      getUnplayedItems: (args: { config: EmbyConfig; sectionId: string }) => Promise<UnplayedItem[]>;
      /** 已启用库内全部影片/剧集（含已观看），媒体库管理专用 */
      getLibraryItemsForManage: (args: { config: EmbyConfig }) => Promise<UnplayedItem[]>;
      getPlayedItems: (args: unknown) => Promise<unknown[]>;
      launchPlayer: (args: { config: EmbyConfig; item: UnplayedItem }) => Promise<LaunchResult>;
      launchPath: (args: { path: string; config: { playerExePath?: string; pathMapFrom?: string; pathMapTo?: string; argsTemplate?: string } }) => Promise<{ sessionStartedAtMs: number }>;
      markPlayed: (args: { config: EmbyConfig; itemId: string }) => Promise<void>;
      markUnplayed: (args: { config: EmbyConfig; itemId: string }) => Promise<void>;
      /** 治理：删除 Flow（Emby Items API） */
      getLibraryItem: (args: { config: EmbyConfig; itemId: string }) => Promise<Record<string, unknown>>;
      getItemDeleteInfo: (args: { config: EmbyConfig; itemId: string }) => Promise<Record<string, unknown> | null>;
      deleteLibraryItem: (args: { config: EmbyConfig; itemId: string }) => Promise<void>;
      libraryItemExists: (args: { config: EmbyConfig; itemId: string }) => Promise<boolean>;
      taskControl?: (args: { action: TaskControlAction; settings?: TaskSchedulerSettings }) => Promise<void>;
      transcodeValidateTools?: (args: {
        config: EmbyConfig;
        encodePool: TranscodeEncodePoolSettings;
      }) => Promise<TranscodeValidateToolsResult>;
      transcodeProbeEncodeDevices?: (args: { config: EmbyConfig }) => Promise<{ devices: TranscodeProbeDeviceRow[] }>;
      transcodePrecheck?: (args: {
        config: EmbyConfig;
        task: { id: string; itemId: string; transcodeDvAcknowledged?: boolean };
      }) => Promise<Record<string, unknown>>;
      transcodeStartEncode?: (args: {
        config: EmbyConfig;
        taskId: string;
        sourcePath: string;
        partialPath: string;
        /** §5.1.2 按优先级排序的占槽候选 */
        orderedDeviceSlots: { deviceId: string; maxSlots: number }[];
        isDolbyVision: boolean;
        dvAcknowledged: boolean;
        durationSec?: number;
      }) => Promise<{ ok: boolean; encoderUsed?: string; resolvedDeviceId?: string }>;
      transcodeAbort?: (args: { taskId: string }) => Promise<{ ok: boolean }>;
      transcodeProbe?: (args: { config: EmbyConfig; filePath: string }) => Promise<{
        durationSec: number;
        videoCodec: string;
        width: number;
        height: number;
      }>;
      transcodeReplace?: (args: {
        config: EmbyConfig;
        targetPath: string;
        partialPath: string;
      }) => Promise<TranscodeReplaceResult>;
      transcodeCleanupTaskWorkdir?: (args: { tempDir: string }) => Promise<{ ok: boolean }>;
      transcodeScanOrphans?: (args: { tempRoot: string }) => Promise<{ entries: TranscodeOrphanEntry[] }>;
      transcodeStatPaths?: (args: { paths: string[] }) => Promise<{ entries: TranscodeStatPathEntry[] }>;
      transcodeDeriveReplaceBackupPath?: (targetPath: string) => string;
      transcodeDeletePaths?: (args: { paths: string[] }) => Promise<{ ok: boolean }>;
      onTranscodeProgress?: (listener: (payload: { taskId: string; progress: number; line?: string }) => void) => () => void;
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
    mediaService?: {
      checkHealth: () => Promise<{ status?: string; version?: string } | null>;
    };
    shelfdeckMedia?: {
      getEffective: () => { baseUrl: string; apiKey: string; source?: string };
      onConnectionUpdated: (cb: () => void) => () => void;
    };
  }
}
