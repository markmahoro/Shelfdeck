import type {
  EmbyServer,
  MediaFolder,
  EmbyTestResult,
  SubLibrary,
  TranscodeConfig,
  EncodeDevice,
  DevicePool,
  TaskListResponse,
  MediaTask,
  ResourceView,
  HealthStatus,
  DoubanSession,
  SpaceStats,
  DashboardHealthSummary,
  RuleTemplate,
  ApprovalPolicyConfig,
} from '../types';

function apiKey(): string {
  return localStorage.getItem('admin_api_key') || '';
}

async function get<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {};
  const key = apiKey();
  if (key) headers['x-api-key'] = key;
  const res = await fetch(path, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const key = apiKey();
  if (key) headers['x-api-key'] = key;
  const res = await fetch(path, { method: 'POST', headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = apiKey();
  if (key) headers['x-api-key'] = key;
  const res = await fetch(path, { method: 'PATCH', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

async function del<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {};
  const key = apiKey();
  if (key) headers['x-api-key'] = key;
  const res = await fetch(path, { method: 'DELETE', headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = apiKey();
  if (key) headers['x-api-key'] = key;
  const res = await fetch(path, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Emby ─────────────────────────────────────────────────────────────────────

export const emby = {
  getServers: () => get<{ servers: EmbyServer[] }>('/v1/admin/emby/servers'),

  testConnection: (body: { baseUrl: string; apiKey?: string; username?: string; password?: string; userId?: string }) =>
    post<EmbyTestResult>('/v1/admin/emby/test', body),

  getMediaFolders: (embyServerId: string) =>
    get<{ folders: MediaFolder[] }>(`/v1/admin/emby/media-folders?embyServerId=${encodeURIComponent(embyServerId)}`),
};

// ── SubLibraries ─────────────────────────────────────────────────────────────

export const subLibraries = {
  list: () => get<{ subLibraries: SubLibrary[] }>('/v1/admin/sublibraries'),

  create: (body: {
    name: string;
    embyServerId: string;
    sectionId: string;
    source?: string;
    doubanEnabled?: boolean;
    ruleTemplateId?: string;
    metadataGate?: SubLibrary['metadataGate'];
    upgradeSmartSelect?: SubLibrary['upgradeSmartSelect'];
    pathMapFrom?: string;
    pathMapTo?: string;
    mediaType?: string;
    adultRegion?: string;
    scraperType?: string;
    watchRoot?: string;
    japaneseJav?: Record<string, unknown>;
  }) => post<SubLibrary>('/v1/admin/sublibraries', body),

  update: (uuid: string, body: Partial<SubLibrary>) =>
    patch<SubLibrary>(`/v1/admin/sublibraries/${uuid}`, body),

  remove: (uuid: string) =>
    del<{ ok: boolean; uuid: string }>(`/v1/admin/sublibraries/${uuid}`),

  offboard: (uuid: string, body: { idempotencyKey: string; reason?: string }) =>
    post<{ ok: boolean; uuid: string; cleanupMode: 'retain_source'; result: Record<string, unknown> }>(
      `/v1/admin/sublibraries/${uuid}/actions/offboard`,
      { ...body, cleanupMode: 'retain_source' },
    ),

};

// ── Adult Libraries ─────────────────────────────────────────────────────────

export interface AdultLibraryConfig {
  settleSeconds: number;
  videoExtensions: string[];
  japaneseJav: Record<string, unknown>;
  western?: Record<string, unknown>;
}

export interface AdultPerson {
  personId: string;
  name: string;
  aliases?: string[];
  canonicalCode?: string;
  adultRegion?: string;
  referenceFaceCount?: number;
  referenceFaces?: Array<{
    faceId?: string;
    sampleImageBase64?: string;
    confidence?: number;
  }>;
  dismissed?: boolean;
}

export interface AdultImageCandidate {
  source: string;
  sourceId: string;
  title: string;
  pageUrl: string;
  imageUrl: string;
  originalUrl?: string;
  width?: number;
  height?: number;
  license?: string;
  rankScore?: number;
  qualityReasons?: string[];
}

export interface AdultImageSearchError {
  source: string;
  message: string;
}

export interface AdultImageSearchResult {
  query: string;
  candidates: AdultImageCandidate[];
  errors?: AdultImageSearchError[];
  proxyUsed?: boolean;
  message?: string;
  sources?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
}

export const adult = {
  getConfig: () => get<AdultLibraryConfig>('/v1/admin/adult/config'),
  patchConfig: (body: Partial<AdultLibraryConfig>) =>
    patch<AdultLibraryConfig>('/v1/admin/adult/config', body),
  listPeople: () =>
    get<{ people: AdultPerson[] }>('/v1/admin/adult/people?adultRegion=western_adult'),
  referenceImageUrl: (personId: string, options?: { thumbnail?: boolean }) =>
    `/v1/admin/adult/people/${encodeURIComponent(personId)}/reference-image${options?.thumbnail ? '?thumbnail=1' : ''}`,
  searchPersonImages: (name: string) =>
    get<AdultImageSearchResult>(
      `/v1/admin/adult/people/search-images?name=${encodeURIComponent(name)}`,
    ),
  createPersonFromImage: (body: {
    name: string;
    aliases?: string[];
    imageUrl?: string;
    imageBase64?: string;
    personId?: string;
    replaceReference?: boolean;
  }) =>
    post<AdultPerson & { referenceFaceQuality?: Record<string, unknown> }>('/v1/admin/adult/people/from-image', body),
  createPersonFromFace: (body: { itemId: string; clusterId?: string; name: string; aliases?: string[] }) =>
    post<AdultPerson>('/v1/admin/adult/people/from-face', body),
  updatePerson: (personId: string, body: Partial<AdultPerson>) =>
    patch<AdultPerson>(`/v1/admin/adult/people/${encodeURIComponent(personId)}`, body),
  deletePerson: (personId: string) =>
    del<{ ok: boolean; personId: string }>(`/v1/admin/adult/people/${encodeURIComponent(personId)}`),
  rescrapeItem: (itemId: string, adultId?: string) =>
    post<{ ok: boolean; taskId: string; task?: MediaTask; taskBridge?: MediaTask['taskBridge']; flowPlan?: MediaTask['flowPlan']; requestedIntent?: MediaTask['requestedIntent']; controlState?: MediaTask['controlState'] }>(
      `/v1/admin/adult/items/${encodeURIComponent(itemId)}/actions/rescrape`,
      adultId ? { adultId } : undefined,
    ),
};

// ── Rule Templates ────────────────────────────────────────────────────────────

export const ruleTemplates = {
  list: () => get<{ ruleTemplates: RuleTemplate[] }>('/v1/admin/rule-templates'),

  get: (id: string) => get<RuleTemplate>(`/v1/admin/rule-templates/${encodeURIComponent(id)}`),

  create: (body: { id: string; name: string; description?: string; rules?: RuleTemplate['rules'] }) =>
    post<RuleTemplate>('/v1/admin/rule-templates', body),

  update: (id: string, body: { name?: string; description?: string; rules?: RuleTemplate['rules'] }) =>
    put<RuleTemplate>(`/v1/admin/rule-templates/${encodeURIComponent(id)}`, body),

  remove: (id: string) =>
    del<{ ok: boolean; id: string }>(`/v1/admin/rule-templates/${encodeURIComponent(id)}`),
};

// ── Transcode ────────────────────────────────────────────────────────────────

export const transcode = {
  getConfig: () => get<TranscodeConfig>('/v1/admin/transcode/config'),

  patchConfig: (body: Partial<TranscodeConfig>) =>
    patch<TranscodeConfig>('/v1/admin/transcode/config', body),

  probeDevices: () =>
    get<{ devices: EncodeDevice[] }>('/v1/admin/transcode/probe-devices'),

  getDevicePool: () => get<DevicePool>('/v1/admin/transcode/device-pool'),
};

// ── Upgrade (MoviePilot) ─────────────────────────────────────────────────────

export interface UpgradeConfig {
  moviepilot: { baseUrl: string; apiKey: string; savePath: string };
  upgradeStagingLocalPath: string;
  upgradeReplaceConfirmRequired?: boolean;
  upgradeRetryInterval?: number;
  upgradeMaxRetries?: number;
}

export interface MpDirectory {
  name: string;
  download_path: string;
  library_path: string;
  media_type: string;
  storage: string;
  transfer_type: string;
}

export const upgrade = {
  getConfig: () => get<UpgradeConfig>('/v1/admin/upgrade/config'),

  patchConfig: (body: Partial<UpgradeConfig>) =>
    patch<UpgradeConfig>('/v1/admin/upgrade/config', body),

  getDirectories: () => get<MpDirectory[]>('/v1/admin/upgrade/directories'),
};

// ── Tasks ────────────────────────────────────────────────────────────────────

export const tasks = {
  list: (params?: { status?: string; statuses?: string[]; attention?: string; targetGate?: string; q?: string; page?: number; pageSize?: number; includeAttentionSummary?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.statuses?.length) qs.set('statuses', params.statuses.join(','));
    if (params?.attention) qs.set('attention', params.attention);
    if (params?.targetGate) qs.set('targetGate', params.targetGate);
    if (params?.q) qs.set('q', params.q);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.includeAttentionSummary === false) qs.set('includeAttentionSummary', '0');
    const q = qs.toString();
    return get<TaskListResponse>(`/v1/admin/tasks${q ? `?${q}` : ''}`);
  },

  get: (id: string) => get<MediaTask>(`/v1/admin/tasks/${id}?includeEvents=1`),

  // Update global queue priority (lower = runs first). Only allowed on queued/created/
  // pending_manual/interrupted/paused tasks; the server returns 409 otherwise.
  updatePriority: (id: string, priority: number) =>
    patch<MediaTask>(`/v1/admin/tasks/${id}`, { priority }),

  remove: (id: string) =>
    del<{ ok: boolean; id: string }>(`/v1/admin/tasks/${id}`),

  pause: (id: string) => post<{ id: string; status: string }>(`/v1/tasks/${id}/actions/pause`),

  execute: (id: string) => post<{ id: string; status: string }>(`/v1/tasks/${id}/actions/execute`),

  retry: (id: string) => post<{ id: string; status: string }>(`/v1/tasks/${id}/actions/retry`),

  confirm: (id: string, confirmData?: Record<string, unknown>) =>
    patch<{ id: string; status: string }>(`/v1/tasks/${id}`, { confirmed: true, ...(confirmData ? { confirmData } : {}) }),

  report: (id: string) => get<TaskReport>(`/v1/tasks/${id}/report`),
};

// ── Resources ────────────────────────────────────────────────────────────────

export const resources = {
  get: (params?: { detail?: 'summary' | 'full' }) => {
    const qs = new URLSearchParams();
    if (params?.detail) qs.set('detail', params.detail);
    const q = qs.toString();
    return get<ResourceView>(`/v1/admin/resources${q ? `?${q}` : ''}`);
  },
};

export interface TaskReport {
  taskId: string;
  itemId?: string;
  itemName: string;
  flowKind?: string;
  elapsedSec: number | null;
  encoder: string | null;
  original?: {
    sizeBytes: number;
    videoCodec: string;
    bitrate: number;
    width?: number;
    height?: number;
    resolution?: string;
    audioCodec?: string;
  };
  output?: {
    sizeBytes: number;
    videoCodec: string;
    bitrate: number;
    width?: number;
    height?: number;
  };
  bytesSaved?: number;
  bytesFreed?: number;
  delete?: {
    targetPath?: string;
    targetKind?: string;
  };
  tmdbVerified?: boolean;
  scrape?: {
    adultId?: string;
    title?: string;
    source?: string;
    sourceUrl?: string;
    scrapeStatus?: string;
    posterPath?: string;
    fanartPath?: string;
    nfoPath?: string;
    fileNfoPath?: string;
    markerPath?: string;
    organized?: boolean;
    originalFolder?: string;
    mediaPath?: string;
    actors?: string[];
    protagonist?: { personId?: string; name?: string; adultId?: string } | null;
    faceClusters?: Array<Record<string, unknown>>;
    unknownFaces?: Array<Record<string, unknown>>;
    actorConfidence?: Record<string, number>;
  };
  assets?: Record<string, boolean>;
  scrapeVerification?: {
    ok: boolean;
    checkedAt?: string;
    source?: 'completion_snapshot' | 'current_filesystem' | string;
    checks?: Record<string, boolean>;
    failures?: Array<{ code?: string; message?: string } | string>;
    warnings?: Array<{ code?: string; message?: string } | string>;
  };
  currentScrapeVerification?: {
    ok: boolean;
    checkedAt?: string;
    source?: 'current_filesystem' | string;
    checks?: Record<string, boolean>;
    failures?: Array<{ code?: string; message?: string } | string>;
    warnings?: Array<{ code?: string; message?: string } | string>;
  };
}

// ── Health ────────────────────────────────────────────────────────────────────

export const health = {
  check: () => get<HealthStatus>('/v1/admin/health'),
};

// ── System Info ──────────────────────────────────────────────────────────────

export interface SystemInfo {
  platform: string;
}

export const system = {
  getInfo: () => get<SystemInfo>('/v1/admin/system/info'),
};

// ── Public health ─────────────────────────────────────────────────────────────

export const publicHealth = {
  check: () => get<{ status: 'green' | 'yellow' | 'red'; timestamp: string }>('/v1/health'),
};

// ── System Config ─────────────────────────────────────────────────────────────

export interface SystemConfig {
  executionMode: 'auto' | 'manual';
  ingestConcurrency: number;
  deleteConcurrency: number;
  transcodeConcurrency: number;
  upgradeConcurrency: number;
  scrapeConcurrency: number;
  resourceCapacity?: Record<string, number>;
  wallRatingAutoEnqueue: boolean;
  smartTaskMaxPerRun: number;
  automaticTaskTargets?: string[];
  optimizeAllowedFlowKinds?: string[];
  smartTaskPollIntervalMinutes: number;
  smartTaskLookbackDays: number;
  smartTaskMaxQueueSize: number;
  smartTaskDeferWhenActiveBacklog?: boolean;
  smartTaskResourceQueueMultiplier?: number;
  smartTaskMaxQueuedByResource?: Record<string, number>;
  strategyPollIntervalMinutes: number;
  smartSelectMode?: 'auto' | 'manual' | 'per_library';
  // Queue priority policy (PriorityEngine). Lower number = runs first.
  taskPriority?: {
    manualTaskPriority: number;
    autoTaskPriorityBase: number;
    targetGateWeights?: Partial<Record<'ingest' | 'metadata' | 'optimize' | 'archive' | 'delete', number>>;
    optimizeOperationHints?: Partial<Record<'transcode' | 'upgrade', number>>;
    rulesByTargetGate?: Partial<Record<'ingest' | 'metadata' | 'optimize' | 'archive' | 'delete', PriorityRule[]>>;
  };
  approvalPolicy?: ApprovalPolicyConfig;
  taskAdmission?: {
    defaultCooldownHours?: number;
    defaultMaxQueued?: number;
    cooldownHoursByTargetGate?: Partial<Record<'ingest' | 'metadata' | 'optimize' | 'archive' | 'delete', number>>;
    maxQueuedByTargetGate?: Partial<Record<'ingest' | 'metadata' | 'optimize' | 'archive' | 'delete', number>>;
    automaticAttemptLimitsByTargetGate?: Partial<Record<'ingest' | 'metadata' | 'optimize' | 'archive' | 'delete', number>>;
    mediaFreezeHoursByCompletedTargetGate?: Partial<Record<'ingest' | 'metadata' | 'optimize' | 'archive' | 'delete', number>>;
  };
  deleteGatePolicy?: {
    enabled?: boolean;
    rules?: Array<{
      id?: string;
      name?: string;
      enabled?: boolean;
      archivedForDays?: number;
      minArchivedDays?: number;
      ratingLte?: number;
      maxRating?: number;
      ratingGte?: number;
      minRating?: number;
      subLibraryId?: string;
      mediaType?: string;
    }>;
  };
}

// Advanced overlay rule. match is AND-combined; adjust contributes a delta.
export interface PriorityRule {
  match: {
    subLibraryId?: string;
    type?: string;
    isDiscLike?: boolean;
    isDolbyVision?: boolean;
    resolution?: string;
    retryCount?: number | { gte?: number; lte?: number; gt?: number; lt?: number };
  };
  adjust: { op: 'subtract' | 'add'; value: number };
}

export const systemConfig = {
  get: () => get<SystemConfig>('/v1/config'),

  patch: (body: Partial<SystemConfig>) =>
    patch<SystemConfig>('/v1/config', body),
};

// ── Delete Candidates ────────────────────────────────────────────────────────

export interface DeleteCandidate {
  itemId: string;
  itemName: string;
  subLibraryId: string;
  candidateStatus: 'pending_review' | 'confirmed' | 'kept_archived' | 'snoozed' | 'suppressed' | 'deleted';
  eligibilityReason: string;
  matchedRule?: {
    ruleId: string;
    ruleName: string;
    archivedForDays: number;
    rating: number | null;
    archivedAt: string;
  } | null;
  archivedAt: string;
  eligibleAt: string;
  decision?: string;
  decisionAt?: string;
  snoozedUntil?: string;
  taskId?: string;
  updatedAt?: string;
}

export const deleteCandidates = {
  list: (includeDecided = false) =>
    get<{ candidates: DeleteCandidate[]; total: number }>(`/v1/admin/delete-candidates${includeDecided ? '?includeDecided=1' : ''}`),
  confirmDelete: (itemId: string) =>
    post(`/v1/admin/delete-candidates/${encodeURIComponent(itemId)}/actions/confirm-delete`, {}),
  keepArchived: (itemId: string) =>
    post(`/v1/admin/delete-candidates/${encodeURIComponent(itemId)}/actions/keep-archived`, {}),
  snooze: (itemId: string, days = 30) =>
    post(`/v1/admin/delete-candidates/${encodeURIComponent(itemId)}/actions/snooze`, { days }),
  suppress: (itemId: string) =>
    post(`/v1/admin/delete-candidates/${encodeURIComponent(itemId)}/actions/suppress`, {}),
};

export type HelixCleanupMode = 'retain_source' | 'detach_source' | 'delete_source';

export const helixLibrary = {
  onboard: (body: { itemId?: string; idempotencyKey: string; sourceReference: Record<string, unknown> }) =>
    post('/v1/admin/library/actions/onboard', body),
  offboard: (itemId: string, body: {
    idempotencyKey: string;
    cleanupMode: HelixCleanupMode;
    reason?: string;
    destructiveAuthorization?: boolean;
  }) => post(`/v1/admin/library/items/${encodeURIComponent(itemId)}/actions/offboard`, body),
};

// ── Activity Log ─────────────────────────────────────────────────────────────────

export interface ActivityEntry {
  ts: string;
  source: string;
  message: string;
  detail?: Record<string, unknown>;
}

export const activityLog = {
  getRecent: (limit?: number) =>
    get<{ entries: ActivityEntry[] }>(`/v1/activity-log?limit=${limit || 20}`),
};

// ── Douban ─────────────────────────────────────────────────────────────────────

export const douban = {
  getSession: () => get<DoubanSession>('/v1/integrations/douban/session'),

  saveSession: (body: DoubanSession) =>
    put<DoubanSession>('/v1/integrations/douban/session', body),

  fetchRatings: (subLibraryId: string) =>
    get<{ ok: boolean; message: string }>(`/v1/integrations/douban/fetch/ratings?subLibraryId=${encodeURIComponent(subLibraryId)}`),
};

// ── Space Stats ──────────────────────────────────────────────────────────────

export const spaceStats = {
  get: () => get<SpaceStats>('/v1/space-stats'),
};

export const dashboardHealth = {
  get: () => get<DashboardHealthSummary>('/v1/admin/dashboard/health'),
};

// ── Nodes ──────────────────────────────────────────────────────────────────────

export interface NodeInfo {
  id: string;
  name: string;
  address: string;
  apiKey: string;
  status: 'online' | 'offline';
  capabilities: { devices: { stableKey: string; label: string; backend: string; gpuIndex: number }[] };
  activeJobCount: number;
  consecutiveFailures: number;
  lastSeenAt: string;
  createdAt: string;
}

export const nodes = {
  list: () => get<{ nodes: NodeInfo[] }>('/v1/admin/nodes'),

  get: (id: string) => get<NodeInfo>(`/v1/admin/nodes/${encodeURIComponent(id)}`),

  create: (body: { name: string; address: string; apiKey: string }) =>
    post<NodeInfo>('/v1/admin/nodes', body),

  remove: (id: string, force?: boolean) =>
    del<{ ok: boolean }>(`/v1/admin/nodes/${encodeURIComponent(id)}${force ? '?force=true' : ''}`),

  update: (id: string, body: { name?: string; apiKey?: string }) =>
    patch<NodeInfo>(`/v1/admin/nodes/${encodeURIComponent(id)}`, body),

  probe: (id: string) =>
    post<{ ok: boolean; capabilities: { devices: { stableKey: string; label: string; backend: string; gpuIndex: number }[] } }>(`/v1/admin/nodes/${encodeURIComponent(id)}/actions/probe`),

  patchDevice: (nodeId: string, stableKey: string, inPool: boolean, extra?: { priority?: number; maxSlots?: number }) =>
    patch<{ ok: boolean; capabilities: { devices: { stableKey: string; inPool: boolean; priority?: number; maxSlots?: number }[] } }>(`/v1/admin/nodes/${encodeURIComponent(nodeId)}/devices`, { stableKey, inPool, ...(extra || {}) }),
};

// ── MoviePilot ────────────────────────────────────────────────────────────────

export interface MpSite {
  id: number;
  name: string;
  domain: string;
  url: string;
  is_active: boolean;
}

export const moviepilot = {
  getSites: () => get<MpSite[]>('/v1/admin/moviepilot/sites'),
};

// ── ApiConflictError ──────────────────────────────────────────────────────────

export class ApiConflictError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiConflictError';
  }
}

// ── Library (desktop-compatible) ──────────────────────────────────────────────

export interface SubLibraryInfo {
  uuid: string;
  name: string;
  enabled: boolean;
  mediaType?: string;
  source?: string;
  adultRegion?: string | null;
  scraperType?: string | null;
  watchRoot?: string;
}

export const libraryApi = {
  getStatus: () =>
    get<{ subLibraries: SubLibraryInfo[] }>('/v1/library/status'),

  getCache: (options?: {
    subLibraryId?: string;
    limit?: number;
    offset?: number;
    search?: string;
    resolution?: string;
    codec?: string;
    watched?: string;
    bluRay?: string;
    douban?: string;
    userRating?: string;
    task?: string;
    metadata?: string;
    scrape?: string;
    lifecycle?: string;
    projection?: 'summary' | 'manage' | 'full' | 'compat';
  }) => {
    const q = new URLSearchParams();
    if (options?.subLibraryId) q.set('subLibraryId', options.subLibraryId);
    if (options?.limit) q.set('limit', String(options.limit));
    if (options?.offset) q.set('offset', String(options.offset));
    if (options?.projection) q.set('projection', options.projection);
    for (const key of ['search', 'resolution', 'codec', 'watched', 'bluRay', 'douban', 'userRating', 'task', 'metadata', 'scrape', 'lifecycle'] as const) {
      const value = options?.[key];
      if (value && value !== 'all') q.set(key, value);
    }
    const params = q.toString() ? `?${q.toString()}` : '';
    return get<{ items: unknown[]; total: number }>(`/v1/library${params}`);
  },

  markPlayed: (itemId: string, subLibraryId?: string) =>
    post<{ ok: boolean }>('/v1/library/actions/mark-played', { itemId, subLibraryId: subLibraryId || undefined }),

  markUnplayed: (itemId: string, subLibraryId?: string) =>
    post<{ ok: boolean }>('/v1/library/actions/mark-unplayed', { itemId, subLibraryId: subLibraryId || undefined }),

  patchRatings: (itemId: string, userRating: number | null) =>
    patch<{ ok: boolean }>('/v1/library/ratings', { itemId, userRating }),

  recomputeOptimizeTargets: () =>
    post<{ ok: boolean; changed: number }>('/v1/library/actions/recompute-optimize-targets'),

  recomputeStrategy: () =>
    post<{ ok: boolean; changed: number }>('/v1/library/actions/recompute-strategy'),
};

export const taskApi = {
  getTasks: async (options?: { activeOnly?: boolean }) => {
    const params = options?.activeOnly ? '?activeOnly=1' : '';
    const data = await get<{ tasks: MediaTask[] } | MediaTask[]>(`/v1/tasks${params}`);
    return Array.isArray(data) ? data : data.tasks ?? [];
  },

  createByIntent: async (body: { itemId: string; targetGate?: string; gateObjective?: Record<string, unknown>; flowPreference?: Record<string, unknown> }): Promise<MediaTask> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const key = apiKey();
    if (key) headers['x-api-key'] = key;
    const r = await fetch('/v1/tasks', { method: 'POST', headers, body: JSON.stringify(body) });
    if (r.status === 409) {
      const b = await r.json().catch(() => ({}));
      throw new ApiConflictError(b.error?.code || b.code || 'CONFLICT', b.error?.message || b.message || 'Conflict', b);
    }
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      throw new Error(b.error?.message || `HTTP ${r.status}`);
    }
    return r.json();
  },
};
