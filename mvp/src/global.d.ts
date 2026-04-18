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

  type TranscodeEncoderPreference = 'auto' | 'cpu' | 'nvenc' | 'qsv' | 'amf';

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
    /** 压制编码器偏好（auto 时主进程探测） */
    transcodeEncoder: TranscodeEncoderPreference;
    /**
     * NVENC 等：CUDA 设备序号（映射为进程级 CUDA_VISIBLE_DEVICES）；-1 表示不指定。
     * libplacebo / Vulkan 设备精细绑定见 TASK_CENTER §2.4.7，首版仅 NVENC 路径生效。
     */
    transcodeGpuDeviceIndex: number;
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
    /**
     * 转码编码资源池（§2.4.1 / §2.4.10）：同时处于「压制」阶段的 FFmpeg 进程上限；
     * 可与 transcodeConcurrency（逻辑占槽）分别配置，例如并发 2 路任务但仅 1 路开压。
     */
    transcodeEncodePoolSlots: number;
  };

  type TranscodeValidateToolsResult = {
    ffmpeg: string;
    ffprobe: string;
    resolvedEncoder: string;
    libplacebo: boolean;
  };

  type TranscodeOrphanEntry = { path: string; size: number };

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
      /** 治理：删除 Flow（Emby Items API） */
      getLibraryItem: (args: { config: EmbyConfig; itemId: string }) => Promise<Record<string, unknown>>;
      getItemDeleteInfo: (args: { config: EmbyConfig; itemId: string }) => Promise<Record<string, unknown> | null>;
      deleteLibraryItem: (args: { config: EmbyConfig; itemId: string }) => Promise<void>;
      libraryItemExists: (args: { config: EmbyConfig; itemId: string }) => Promise<boolean>;
      taskControl?: (args: { action: TaskControlAction; settings?: TaskSchedulerSettings }) => Promise<void>;
      transcodeValidateTools?: (args: {
        config: EmbyConfig;
        encoderPreference?: TranscodeEncoderPreference;
      }) => Promise<TranscodeValidateToolsResult>;
      transcodePrecheck?: (args: {
        config: EmbyConfig;
        task: { id: string; itemId: string; transcodeDvAcknowledged?: boolean };
      }) => Promise<Record<string, unknown>>;
      transcodeStartEncode?: (args: {
        config: EmbyConfig;
        taskId: string;
        sourcePath: string;
        partialPath: string;
        encoderPreference: TranscodeEncoderPreference;
        isDolbyVision: boolean;
        dvAcknowledged: boolean;
        durationSec?: number;
        /** §2.4.10 编码资源池 Gate：同时压制进程上限 */
        encodePoolMax?: number;
      }) => Promise<{ ok: boolean; encoderUsed?: string }>;
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
  }
}
