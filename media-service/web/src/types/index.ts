// ── Emby ──────────────────────────────────────────────────────────────────────

export interface EmbyServer {
  uuid: string;
  serverName: string;
  baseUrl: string;
  username: string;
  userId: string;
  credentialConfigured: boolean;
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
  serverInfo?: { serverName: string; version: string };
  users: EmbyUser[];
  suggestedUserId?: string;
}

// ── SubLibrary ────────────────────────────────────────────────────────────────

export interface MediaPolicy {
  target1080p: Record<string, number>;
  target4k: Record<string, number>;
}

export type MetadataGateNode = string | { all?: MetadataGateNode[]; any?: MetadataGateNode[] };

export interface MetadataGateConfig {
  all?: MetadataGateNode[];
  any?: MetadataGateNode[];
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
  metadataGate?: MetadataGateConfig | null;
  upgradeSmartSelect: UpgradeSmartSelect;
  libraryAutomationMode: 'auto' | 'manual';
  maintenanceAutomationMode: 'auto' | 'manual';
  approvalPolicy?: ApprovalPolicyConfig;
  // Queue priority weight (lower = this library's tasks run first). Default 100.
  priorityWeight?: number;
  mediaType?: string;
  adultRegion?: 'japanese_jav' | 'western_adult';
  scraperType?: 'shelfdeck_japanese_jav' | 'western_builtin';
  watchRoot?: string;
  japaneseJav?: Record<string, unknown>;
  allowedCapabilities?: { metadata: string[]; optimize: string[] };
  capabilityParameters?: Record<string, { kinds?: string[] }>;
  capabilityPolicyRevision?: string;
  maintenanceSummary?: {
    total: number;
    basedataPassed: number;
    metadataPassed: number;
    optimizePassed: number;
    maintenanceComplete: number;
    directionCounts: Record<'none' | 'transcode' | 'upgrade' | 'undetermined' | 'blocked', number>;
  };
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
  targetMediaFacts?: {
    qualityTier?: string;
    minResolution?: string;
    targetBitrate?: number;
    targetBitrateByBucket?: Record<string, number>;
    targetCodec?: string;
    preferredAudioCodecs?: string[];
    maxSizeGB?: number;
    seedPreferences?: {
      codecPreference?: string[];
      resolutionPreference?: string[];
      audioPreference?: string[];
      sitePreference?: string[];
      preferCNSub?: boolean;
    };
    [key: string]: unknown;
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
  label?: string;
  backend?: string;
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

export interface TaskControlAction {
  enabled: boolean;
  reason: string;
  effect: string;
  label?: string;
  endpoint?: string;
  method?: string;
  destructive?: boolean;
  retryCount?: number;
  maxRetryCount?: number;
  [key: string]: unknown;
}

export interface TaskControlState {
  state: string;
  requiresUserAction: boolean;
  phase: string;
  primaryAction: string;
  actions: { confirm: TaskControlAction };
  confirmation: {
    required: boolean;
    gateId: string;
    message: string;
    options: unknown[];
    effect: string;
  };
  recovery: {
    state: string;
    reason: string;
    nextAction: string;
    effect?: string;
    retryCount?: number;
    maxRetryCount?: number;
  };
  latestEvent?: TaskEvent | null;
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
  optimize: SpaceStatsGroup;
}

export interface SpaceStats {
  currentTotalBytes: number;
  expectedTotalBytes: number;
  reclaimableBytes: number;
  realizedReclaimedBytes: number;
  optimize: SpaceStatsGroup;
  subLibraries: SpaceStatsSubLibrary[];
}

export interface DashboardCountSignal {
  level: 'green' | 'yellow' | 'red';
  code: string;
  label: string;
  count: number;
  detail?: string;
}

export interface DashboardEventEntry {
  id: string;
  kind: 'activity' | 'task_event';
  source: string;
  sourceLabel: string;
  ts: string;
  severity: 'neutral' | 'green' | 'yellow' | 'red';
  message: string;
  detail?: Record<string, unknown>;
  taskId?: string;
  itemId?: string;
  eventType?: string;
  eventStatus?: string;
  resourceType?: string;
  resourceKey?: string;
  resourceLabel?: string;
}

export interface DashboardStatusGroup {
  status: 'green' | 'yellow' | 'red';
  generatedAt?: string | null;
  checks: {
    key: string;
    label: string;
    status: 'green' | 'yellow' | 'red';
    message?: string;
  }[];
}

export interface DashboardHealthSummary {
  status: 'green' | 'yellow' | 'red';
  generatedAt: string;
  serviceAvailability?: DashboardStatusGroup;
  externalIntegrations?: DashboardStatusGroup;
  businessStatus?: {
    status: 'green' | 'yellow' | 'red';
    signals: DashboardCountSignal[];
  };
  media: {
    totalItems: number;
    maintenanceCompleteItems?: number;
    offboardingCandidateItems?: number;
    closedItems: number;
    openItems: number;
    metadataIncompleteItems: number;
    pendingOptimizationItems: number;
    byLifecycleStage: Record<string, number>;
    byMetadataStatus: Record<string, number>;
    byRecommendedTargetGate: Record<string, number>;
    bySource: Record<string, number>;
    pendingBridges: Record<string, number>;
    topMetadataMissingReasons: { reason: string; count: number }[];
    bySubLibrary: {
      subLibraryId: string;
      totalItems: number;
      closedItems: number;
      openItems: number;
      metadataIncompleteItems: number;
      pendingOptimizationItems: number;
      byLifecycleStage?: Record<string, number>;
    }[];
  };
  tasks: {
    totalTasks: number;
    activeTasks: number;
    awaitingConfirmationTasks: number;
    failedTasks: number;
    doneTasks: number;
    byStatus: Record<string, number>;
    activeByBridgeKind: Record<string, number>;
    activeByFlowKind?: Record<string, number>;
    activeBySource: Record<string, number>;
    failedByFlowKind?: Record<string, number>;
    recentFailureEvents: unknown[];
    attention?: Record<string, TaskAttentionQueue>;
    primaryAttention?: TaskAttentionQueue | null;
  };
  automation: {
    enabledTaskTargets: string[];
    allowedOptimizeFlows: string[];
  };
  events?: {
    latestAt: string | null;
    bySource: Record<string, number>;
    recent: DashboardEventEntry[];
  };
  diagnostics: {
    signals: DashboardCountSignal[];
    storage?: StorageMetric[];
  };
}

export interface MediaTask {
  id: string;
  itemId: string;
  itemName?: string;
  taskTarget?: TaskTarget;
  workflowSummary?: { planId: string; schemaVersion: string; classification: string; targetGate: string; eventCount: number } | null;
  currentEvent?: { eventId: string; capability: string; status: string; resourceKey?: string } | null;
  eventProgress?: { completed: number; total: number } | null;
  requestedIntent?: RequestedIntent;
  source?: 'manual' | 'auto' | string;
  status: TaskStatus;
  progress: number;
  phase: string;
  retryCount?: number;
  approval?: TaskApproval | null;
  // Task-local priority inside the same MediaItem priority class.
  priority?: number;
  maintenanceRun?: { runId: string; itemId: string; status: string; initiatedBy: string } | null;
  maintenancePrioritySnapshot?: { class: 'normal' | 'expedited'; revision: number; reason?: string; runId?: string };
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
  controlState?: TaskControlState;
}

export interface RequestedIntent {
  targetGate?: string;
  flowPreference?: Record<string, unknown>;
  intentMode?: string;
  [key: string]: unknown;
}

export interface TaskTarget {
  object?: {
    type?: string;
    itemId?: string;
    subLibraryId?: string;
    [key: string]: unknown;
  };
  targetGate?: string;
  gateObjective?: GateObjective;
  source?: string;
  [key: string]: unknown;
}

export interface GateObjective {
  kind?: string;
  description?: string;
  source?: string;
  reason?: string;
  acceptableFlows?: string[];
  destructive?: boolean;
  targetBitrate?: number | string;
  targetCodec?: string;
  equivalentBitrate?: number | string;
  maxSizeGB?: number | string;
  seedPreferences?: Record<string, unknown>;
  metadataKind?: string;
  repairMode?: string;
  [key: string]: unknown;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  itemId?: string;
  eventType: string;
  eventStatus: string;
  phase?: string | null;
  resourceType?: string | null;
  resourceKey?: string;
  resourceLabel?: string;
  createdAt: string;
  payload?: Record<string, unknown>;
}

export interface ResourceFailureEvent extends TaskEvent {
  task?: {
    id: string;
    itemId: string;
    itemName?: string;
    status: string;
    phase?: string;
    retryCount?: number;
  } | null;
  resourceContext?: {
    resourceType: string;
    resourceKey: string;
    resourceLabel: string;
  };
  recovery?: TaskControlState['recovery'];
  controlState?: TaskControlState | null;
  diagnosticSummary?: {
    logId: string;
    scope: string;
    operation: string;
    component: string;
    status: string;
    resourceType: string;
    resourceKey: string;
    endedAt: string;
    error?: unknown;
  } | null;
}

export interface TaskAttentionQueue {
  key: string;
  label: string;
  hint: string;
  count: number;
}

export interface TaskListResponse {
  tasks: MediaTask[];
  summary: {
    total: number;
    byStatus: Record<string, number>;
    attention?: Record<string, TaskAttentionQueue>;
  };
  page: number;
  pageSize: number;
  total: number;
  attention?: string;
}

// ── Resource View ────────────────────────────────────────────────────────────

export type ResourceTaskState = 'running' | 'waiting' | 'blocked';
export type RuntimeEventState = 'running' | 'recent' | 'failed';

export interface ResourceTask {
  taskId: string;
  itemId: string;
  itemName?: string;
  taskTarget?: TaskTarget | null;
  source?: 'manual' | 'auto' | string;
  status: TaskStatus;
  phase?: string;
  priority?: number;
  progress?: number;
  createdAt: string;
  updatedAt: string;
  nodeId?: string | null;
  workflowClassification?: string;
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

export interface ResourceView {
  detail?: 'summary' | 'full' | string;
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
  governor?: {
    generatedAt: string;
    resources: Array<{ resourceKey: string; capacity: number; active: number; waiting: number }>;
  };
  diagnostics?: {
    logs: DiagnosticLogEntry[];
    dependencies?: Array<Record<string, unknown>>;
    failedEvents?: ResourceFailureEvent[];
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
