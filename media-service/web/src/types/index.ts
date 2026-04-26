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
  | 'awaiting_user_confirm' | 'paused' | 'interrupted'
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
  path?: string;
  resolution?: string;
  bitrate?: number;
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
