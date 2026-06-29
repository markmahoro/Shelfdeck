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

export type MediaType = 'movie' | 'tv' | 'adult';

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
  automationMode?: 'auto' | 'manual';
  approvalPolicy?: ApprovalPolicyConfig;
  scheduleMode?: 'full_auto' | 'custom' | 'full_manual';
  autoCreate?: boolean;
  autoExecute?: boolean;
  autoReplaceTranscode?: boolean;
  autoReplaceUpgrade?: boolean;
  smartSelectEnabled?: boolean;
  // Queue priority weight (lower = this library's tasks run first). Default 100.
  priorityWeight?: number;
  pathMapFrom?: string;
  pathMapTo?: string;
  mediaType?: string;
  adultRegion?: 'japanese_jav' | 'western_adult';
  scraperType?: 'shelfdeck_japanese_jav' | 'western_builtin';
  watchRoot?: string;
  japaneseJav?: Record<string, unknown>;
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
  transcodeCleanupOrphansOnStartup?: boolean;
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
  status?: 'idle' | 'busy' | 'error';
  activeSlots?: number;
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

export type ActionType = 'ingest' | 'delete' | 'transcode' | 'upgrade' | 'scrape';

export type ApprovalMode = 'auto' | 'confirm' | 'forceConfirm';
export type ApprovalPolicyConfig = Record<string, ApprovalMode>;

export interface TaskApproval {
  gateId: string;
  mode: ApprovalMode;
  title?: string;
  message?: string;
  options?: string[];
  payload?: Record<string, unknown>;
}

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
  adultMetadata?: Record<string, unknown>;
  taskSource?: 'manual' | 'auto' | string;
  transcodeTaskId?: string;
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
  taskBridge?: TaskBridge;
  flowPlan?: FlowPlan;
  source?: 'manual' | 'auto' | string;
  status: TaskStatus;
  progress: number;
  phase: string;
  resumePoint: string | null;
  approval?: TaskApproval | null;
  // Queue priority (lower = runs first globally). Absent on legacy tasks
  // (treated as 100 by the scheduler).
  priority?: number;
  priorityModelVersion?: string;
  priorityBreakdown?: {
    modelVersion?: string;
    lowerIsEarlier?: boolean;
    formula?: string;
    raw?: number;
    priority?: number;
    dimensions?: Array<{
      key: string;
      label?: string;
      value: number;
      [key: string]: unknown;
    }>;
  };
  createdAt: string;
  updatedAt: string;
  logs?: TaskLogEntry[];
  itemInfo?: TaskItemInfo;
  verifyResult?: VerifyResult;
  upgradePreview?: UpgradePreview;
  confirmData?: Record<string, unknown>;
  events?: TaskEvent[];
}

export interface TaskBridge {
  kind: 'metadata' | 'optimize' | 'archive' | string;
  from?: string;
  to?: string;
  reason?: string;
  actionType?: string;
  source?: string;
  itemId?: string;
  subLibraryId?: string;
}

export interface FlowStep {
  phase?: string;
  eventType?: string;
  resourceType?: string;
}

export interface FlowPlan {
  version?: string;
  bridgeKind?: string;
  direction?: string;
  operationKind?: string;
  executor?: string;
  primaryResourceType?: string;
  actionType?: string;
  source?: string;
  resourceTypes?: string[];
  steps?: FlowStep[];
  plannedAt?: string;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  itemId?: string;
  actionType?: string;
  eventType: string;
  eventStatus: string;
  phase?: string | null;
  resumePoint?: string | null;
  resourceType?: string | null;
  resourceKey?: string;
  resourceLabel?: string;
  bridgeKind?: string;
  flowDirection?: string;
  operationKind?: string;
  createdAt: string;
  payload?: Record<string, unknown>;
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

// ── Resource View ────────────────────────────────────────────────────────────

export type ResourceTaskState = 'running' | 'waiting' | 'blocked';
export type RuntimeEventState = 'running' | 'recent' | 'failed';

export interface ResourceTask {
  taskId: string;
  itemId: string;
  itemName?: string;
  actionType: ActionType;
  source?: 'manual' | 'auto' | string;
  status: TaskStatus;
  phase?: string;
  resumePoint?: string | null;
  priority?: number;
  progress?: number;
  createdAt: string;
  updatedAt: string;
  nodeId?: string | null;
  bridgeKind?: string;
  flowDirection?: string;
  operationKind?: string;
  currentEventType?: string;
  currentEventPhase?: string;
  resourceState: ResourceTaskState;
  resourceType: string;
  resourceKey: string;
  resourceLabel: string;
}

export interface RuntimeResourceEvent {
  eventId: string;
  eventType: string;
  eventStatus: string;
  component: string;
  resourceType: string;
  resourceKey: string;
  resourceLabel: string;
  taskId?: string;
  itemId?: string;
  itemName?: string;
  subLibraryId?: string;
  source?: string;
  startedAt: string;
  endedAt?: string | null;
  durationMs?: number | null;
  eventState: RuntimeEventState;
  payload?: Record<string, unknown>;
}

export interface ResourceBucket {
  resourceType: string;
  resourceKey: string;
  resourceLabel: string;
  configuredSlots: number;
  running: number;
  waiting: number;
  blocked: number;
  tasks: ResourceTask[];
  events?: RuntimeResourceEvent[];
  eventRunning?: number;
  eventRecent?: number;
  eventFailed?: number;
  deviceSlotUsage?: Record<string, unknown>;
}

export interface DiagnosticLogEntry {
  id: string;
  logId: string;
  kind: 'diagnostic_log';
  category: string;
  scope: string;
  operation: string;
  component: string;
  resourceType: string;
  resourceKey: string;
  status: 'done' | 'slow' | 'failed' | string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  payload?: Record<string, unknown>;
}

export interface StorageMetricFile {
  name: string;
  path: string;
  exists: boolean;
  sizeBytes: number;
  mtime?: string | null;
}

export interface StorageMetric {
  kind: 'metric';
  category: 'storage' | string;
  store: string;
  resourceType: string;
  resourceKey: string;
  generatedAt: string;
  dbSizeBytes: number;
  walSizeBytes: number;
  totalSizeBytes: number;
  files: StorageMetricFile[];
}

export interface BackgroundIoOperation {
  operationId: string;
  operation: string;
  component: string;
  lockKey: string;
  resourceType: string;
  resourceKey: string;
  source: string;
  status: string;
  startedAt: string;
  endedAt?: string | null;
  durationMs: number;
  payload?: Record<string, unknown>;
}

export interface BackgroundIoState {
  kind: 'metric';
  category: 'background_io';
  generatedAt: string;
  active: BackgroundIoOperation[];
  recent: BackgroundIoOperation[];
  summary: {
    activeCount: number;
    runningHeavyIo: boolean;
    skippedCount: number;
    completedCount: number;
    failedCount: number;
  };
}

export interface ResourceView {
  summary: {
    totalTasks: number;
    totalEvents?: number;
    runningEvents?: number;
    recentEvents?: number;
    byResourceType: Record<string, number>;
    byState: Record<ResourceTaskState, number>;
    byEventStatus?: Record<string, number>;
    generatedAt: string;
  };
  resources: ResourceBucket[];
  diagnostics?: {
    logs: DiagnosticLogEntry[];
    dependencies?: Array<Record<string, unknown>>;
    failedEvents?: TaskEvent[];
    bottlenecks?: Array<{
      resourceType: string;
      resourceKey: string;
      resourceLabel: string;
      configuredSlots: number;
      running: number;
      waiting: number;
      blocked: number;
    }>;
    summary: {
      totalLogs: number;
      slowLogs: number;
      failedLogs: number;
      byStatus: Record<string, number>;
      byCategory: Record<string, number>;
      generatedAt: string;
    };
    metrics?: {
      storage?: StorageMetric[];
    };
    backgroundIo?: BackgroundIoState;
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
