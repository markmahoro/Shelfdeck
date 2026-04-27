// ── Emby ──────────────────────────────────────────────────────────────────────

export interface EmbyServer {
  uuid: string;
  serverName: string;
  baseUrl: string;
  apiKey: string;
  userId: string;
  embyUserPassword: string;
}

export interface EmbyUser {
  id: string;
  name: string;
}

export interface MediaFolder {
  id: string;
  name: string;
}

export interface EmbyTestResult {
  ok: boolean;
  message?: string;
  serverInfo?: { serverName: string; version: string };
  embyServerId?: string;
}

// ── SubLibrary ────────────────────────────────────────────────────────────────

export interface MediaPolicy {
  target1080p: Record<string, number>;
  target4k: Record<string, number>;
}

export interface SubLibrary {
  uuid: string;
  name: string;
  embyServerId: string;
  sectionId: string;
  source: string;
  doubanEnabled: boolean;
  enabled: boolean;
  lastRefreshedAt: string | null;
  doubanSyncedAt: string | null;
  mediaPolicy: MediaPolicy;
}

// ── Transcode ─────────────────────────────────────────────────────────────────

export interface TranscodeConfig {
  transcodeTempRoot: string;
  transcodeReplaceConfirmRequired: boolean;
  ffmpegPath: string;
  ffprobePath: string;
  transcodeEncodingDevices: DevicePoolEntry[];
  transcodeMaxCpuSlots: number;
  transcodeCpuParticipationStrategy: 'normal' | 'backup_only';
}

export interface EncodeDevice {
  stableKey: string;
  label: string;
  backend: string;
  gpuIndex: number;
}

export interface DevicePoolEntry {
  stableKey: string;
  inPool: boolean;
  priority: number;
  maxSlots: number;
  encoder: string;
  status: 'idle' | 'busy' | 'error';
  activeSlots: number;
}

export interface DevicePool {
  devices: DevicePoolEntry[];
  summary: {
    totalDevices: number;
    idleDevices: number;
    totalAvailableSlots: number;
    usedSlots: number;
  };
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export type TaskStatus =
  | 'created' | 'pending_manual' | 'queued' | 'executing'
  | 'awaiting_user_confirm' | 'pausing' | 'paused' | 'interrupted'
  | 'done' | 'failed_hard';

export type ActionType = 'delete' | 'transcode' | 'upgrade';

export interface TaskLogEntry {
  seq?: number;
  ts: string;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

export interface TaskItemInfo {
  name?: string;
  title?: string;
  path?: string;
  size?: number;
  resolution?: string;
  bitrate?: number;
  tmdbId?: number;
  mpTmdbId?: number;
  baselineTransferId?: number;
  originalSizeBytes?: number;
  originalVideoCodec?: string;
  originalWidth?: number;
  originalHeight?: number;
  originalAudioCodec?: string;
  originalBitrate?: number;
  sourcePath?: string;
  partialPath?: string;
  tempDir?: string;
  stagingFolder?: string;
  stagingMediaPath?: string;
  isDolbyVision?: boolean;
  durationSec?: number;
  searchCandidates?: Record<string, unknown>[];
  searchCandidatesSimplified?: UpgradeCandidate[];
}

export interface UpgradeCandidate {
  title: string;
  site: string;
  size: number;
  seeders: number;
  resolution: string;
  codec: string;
  edition: string;
  index: number;
}

export interface UpgradePreview {
  oldFile: {
    name: string;
    size: number;
    resolution: string;
    bitrate: number;
  };
  newFile: {
    name: string;
    size: number;
  };
  tmdbVerified: boolean;
  tmdbId: number | null;
}

export interface VerifyResult {
  sizeBytes: number;
  videoCodec: string;
  width: number;
  height: number;
  bitrate: number;
  durationSec: number;
  previewPath: string | null;
}

export interface MediaTask {
  id: string;
  itemId: string;
  actionType: ActionType;
  status: TaskStatus;
  progress: number;
  phase: string;
  resumePoint: string | null;
  createdAt: string;
  updatedAt: string;
  logs?: TaskLogEntry[];
  itemInfo?: TaskItemInfo;
  verifyResult?: VerifyResult;
  upgradePreview?: UpgradePreview;
  confirmData?: Record<string, unknown>;
}

export interface TaskListResponse {
  tasks: MediaTask[];
  summary: {
    total: number;
    byStatus: Record<string, number>;
  };
}

// ── Health ────────────────────────────────────────────────────────────────────

export interface HealthCheckItem {
  status: 'green' | 'yellow' | 'red';
  message?: string;
  uptime?: number;
  runningTasks?: number;
}

export interface HealthStatus {
  status: 'green' | 'yellow' | 'red';
  checks: {
    service: HealthCheckItem;
    config: HealthCheckItem;
    emby: HealthCheckItem;
    scheduler: HealthCheckItem;
  };
  timestamp: string;
}

// ── Douban ─────────────────────────────────────────────────────────────────────

export interface DoubanSession {
  cookieHeader: string;
  userId: string;
  interestsRssUrl: string;
}

// ── Upgrade (MoviePilot) ──────────────────────────────────────────────────────

export interface MoviePilotConfig {
  baseUrl: string;
  apiKey: string;
  savePath: string;
  stagingPath: string;
}

export interface UpgradeConfig {
  moviepilot: MoviePilotConfig;
  upgradeStagingLocalPath: string;
  upgradeRetryInterval: number;
  upgradeMaxRetries: number;
}
