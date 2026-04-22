// ── Config ────────────────────────────────────────────────────────────────────

export interface EmbyClientConfig {
  baseUrl: string;
  apiKey: string;
  userId: string;
  embyUserPassword?: string;
}

export interface MediaPolicy {
  target1080p: Record<string, number>;
  target4k: Record<string, number>;
}

export interface EncodePoolEntry {
  stableKey: string;
  inPool: boolean;
  priority: number;
  maxSlots: number;
}

export interface EncodePool {
  entries: EncodePoolEntry[];
  cpuParticipation?: 'normal' | 'backup-only';
}

export interface ServiceConfig {
  baseUrl?: string;
  apiKey?: string;
  userId?: string;
  embyUserPassword?: string;
  embyClient?: EmbyClientConfig;
  embyProfiles?: Record<string, EmbyClientConfig>;
  enabledSectionIds?: string[];
  executionMode?: 'manual' | 'scheduled';
  deleteConcurrency?: number;
  transcodeConcurrency?: number;
  upgradeConcurrency?: number;
  transcodeTempRoot?: string;
  transcodeReplaceConfirmRequired?: boolean;
  transcodeEncodePool?: EncodePool;
  transcodeCpuParticipationStrategy?: 'normal' | 'backup-only';
  ffmpegPath?: string;
  ffprobePath?: string;
  mediaPolicy?: MediaPolicy;
  wallRatingAutoEnqueue?: boolean;
  markPlayedThresholdPercent?: number;
  fallbackMinSeconds?: number;
  upgradeRetryInterval?: number;
  upgradeMaxRetries?: number;
  serviceApiKey?: string;
  adminPin?: string;
  pathMapFrom?: string;
  pathMapTo?: string;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthStatus {
  needSetup: boolean;
  needLogin: boolean;
  pinSet: boolean;
}

export interface PinVerifyResponse {
  ok: boolean;
  session?: string;
  message?: string;
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export type TaskStatus =
  | 'pending_manual' | 'created' | 'queued'
  | 'precheck' | 'executing' | 'verify'
  | 'awaiting_user_confirm' | 'paused'
  | 'done' | 'failed_hard';

export type ActionType = 'delete' | 'transcode' | 'upgrade';

export interface FlowLogEntry {
  seq?: number;
  ts: string;
  level: 'info' | 'warn' | 'error';
  code: string;
  message: string;
  callId?: string;
}

export interface MediaTask {
  id: string;
  itemId: string;
  itemName?: string;
  actionType: ActionType;
  status: TaskStatus;
  progress?: number;
  flowLog?: FlowLogEntry[];
  resumePoint?: string;
  confirmedAt?: string;
  transcodeDvAcknowledged?: boolean;
  transcodeReplaceAcknowledged?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// ── Health ───────────────────────────────────────────────────────────────────

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'unhealthy';
  version?: string;
}

// ── Emby ─────────────────────────────────────────────────────────────────────

export interface EmbyItem {
  Id: string;
  Name: string;
  Type: string;
  Path?: string;
  MediaSources?: Array<{ Path?: string; Size?: number }>;
}

export interface EmbyUser {
  Name: string;
  Id: string;
}

export interface MediaFolder {
  Name: string;
  Id: string;
}

// ── Douban ───────────────────────────────────────────────────────────────────

export interface DoubanSession {
  cookie?: string;
  userId?: string;
}

export interface DoubanRatingsCache {
  [itemId: string]: { rating: number; updatedAt: string };
}
