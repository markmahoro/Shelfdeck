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
  collectionType?: string;
}

export type MediaType = 'movie' | 'tv';

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
  mediaPolicy?: MediaPolicy;
  ruleTemplateId?: string;
  upgradeSmartSelect: UpgradeSmartSelect;
  scheduleMode?: 'full_auto' | 'custom' | 'full_manual';
  autoCreate?: boolean;
  autoExecute?: boolean;
  autoReplaceTranscode?: boolean;
  autoReplaceUpgrade?: boolean;
  smartSelectEnabled?: boolean;
  pathMapFrom?: string;
  pathMapTo?: string;
  mediaType?: string;
}

// ── Rule Template ──────────────────────────────────────────────────────────────

export interface RuleCondition {
  field: string;
  op: '>' | '>=' | '<' | '<=' | '=' | 'in' | 'not in' | 'overlap';
  value: number | string | boolean | null | (number | string)[];
}

export interface RuleGroup {
  connector: 'and' | 'or';
  conditions: RuleCondition[];
}

export interface Rule {
  priority: number;
  groupsConnector: 'and' | 'or';
  groups: RuleGroup[];
  action: 'keep' | 'delete' | 'transcode' | 'upgrade';
  actionParams: {
    targetBitrate?: number;
    targetCodec?: string;
    maxSizeGB?: number;
    seedPreferences?: {
      codecPreference?: string[];
      resolutionPreference?: string[];
      audioPreference?: string[];
      sitePreference?: string[];
      preferCNSub?: boolean;
    };
  };
  reason: string;
}

export interface RuleTemplateTag {
  type: 'default' | 'user';
  version?: number;
}

export interface RuleTemplate {
  id: string;
  name: string;
  description: string;
  rules: Rule[];
  tag?: RuleTemplateTag;
}

// ── Transcode ─────────────────────────────────────────────────────────────────

export interface UpgradeSmartSelect {
  enabled: boolean;
  codecPreference: string[];
  resolutionPreference: string[];
  audioPreference: string[];
  sitePreference: string[];
  preferCNSub: boolean;
  maxSizeGB?: { target1080p?: Record<string,number>; target4k?: Record<string,number> } | number;
}

export interface TranscodeConfig {
  transcodeTempRoot: string;
  transcodeReplaceConfirmRequired: boolean;
  ffmpegPath: string;
  ffprobePath: string;
  transcodeEncodingDevices: DevicePoolEntry[];
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
  remote?: boolean;
  deviceId?: string;
  nodeId?: string;
  nodeName?: string;
  nodeStatus?: string;
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
  type?: string;
  seriesName?: string;
  seasonNumber?: number;
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
  bytesSaved?: number;
  tmdbVerified: boolean;
  tmdbId: number | null;
}

export interface VerifyResult {
  sizeBytes: number;
  videoCodec: string;
  audioCodec?: string;
  width: number;
  height: number;
  bitrate: number;
  durationSec: number;
  previewPath: string | null;
  bytesSaved?: number;
}

export interface SpaceStatsGroup {
  expectedSavingsBytes: number;
  realizedSavingsBytes: number;
  itemCount: number;
}

export interface SpaceStatsUpgradeGroup {
  expectedIncreaseBytes: number;
  realizedIncreaseBytes: number;
  itemCount: number;
}

export interface SpaceStatsSubLibrary {
  uuid: string;
  name: string;
  itemCount: number;
  currentBytes: number;
  expectedBytes: number;
  transcode: SpaceStatsGroup;
  upgrade: SpaceStatsUpgradeGroup;
  delete: SpaceStatsGroup;
}

export interface SpaceStats {
  currentTotalBytes: number;
  expectedTotalBytes: number;
  reclaimableBytes: number;
  realizedReclaimedBytes: number;
  transcode: SpaceStatsGroup;
  upgrade: SpaceStatsUpgradeGroup;
  delete: SpaceStatsGroup;
  subLibraries: SpaceStatsSubLibrary[];
}

export interface MediaTask {
  id: string;
  itemId: string;
  itemName?: string;
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
  page: number;
  pageSize: number;
  total: number;
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

// ── Nodes ──────────────────────────────────────────────────────────────────────

export interface NodeDevice {
  stableKey: string;
  label: string;
  backend: string;
  gpuIndex: number;
}

export interface NodeInfo {
  id: string;
  name: string;
  address: string;
  apiKey: string;
  status: 'online' | 'offline';
  capabilities: { devices: NodeDevice[] };
  activeJobCount: number;
  consecutiveFailures: number;
  lastSeenAt: string;
  createdAt: string;
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
  upgradeReplaceConfirmRequired: boolean;
}
