import type {
  EmbyServer,
  MediaFolder,
  EmbyTestResult,
  SubLibrary,
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
} from "../types";

function apiKey(): string {
  return localStorage.getItem("admin_api_key") || "";
}

async function get<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {};
  const key = apiKey();
  if (key) headers["x-api-key"] = key;
  const res = await fetch(path, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

async function getText(path: string): Promise<string> {
  const headers: Record<string, string> = {};
  const key = apiKey();
  if (key) headers["x-api-key"] = key;
  const res = await fetch(path, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const key = apiKey();
  if (key) headers["x-api-key"] = key;
  const res = await fetch(path, {
    method: "POST",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const key = apiKey();
  if (key) headers["x-api-key"] = key;
  const res = await fetch(path, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

async function del<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {};
  const key = apiKey();
  if (key) headers["x-api-key"] = key;
  const res = await fetch(path, { method: "DELETE", headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const key = apiKey();
  if (key) headers["x-api-key"] = key;
  const res = await fetch(path, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Emby ─────────────────────────────────────────────────────────────────────

export const emby = {
  getServers: () => get<{ servers: EmbyServer[] }>("/v1/admin/emby/servers"),

  testConnection: (body: {
    baseUrl: string;
    apiKey?: string;
    username?: string;
    password?: string;
    userId?: string;
  }) => post<EmbyTestResult>("/v1/admin/emby/test", body),

  getMediaFolders: (embyServerId: string) =>
    get<{ folders: MediaFolder[] }>(
      `/v1/admin/emby/media-folders?embyServerId=${encodeURIComponent(embyServerId)}`,
    ),
};

// ── SubLibraries ─────────────────────────────────────────────────────────────

export const subLibraries = {
  list: () => get<{ subLibraries: SubLibrary[] }>("/v1/admin/sublibraries"),

  create: (body: {
    name: string;
    embyServerId: string;
    sectionId: string;
    source?: string;
    doubanEnabled?: boolean;
    ruleTemplateId?: string;
    metadataGate?: SubLibrary["metadataGate"];
    upgradeSmartSelect?: SubLibrary["upgradeSmartSelect"];
    pathMapFrom?: string;
    pathMapTo?: string;
    mediaType?: string;
    adultRegion?: string;
    scraperType?: string;
    watchRoot?: string;
    japaneseJav?: Record<string, unknown>;
    libraryAutomationMode?: "auto" | "manual";
    maintenanceAutomationMode?: "auto" | "manual";
  }) => post<SubLibrary>("/v1/admin/sublibraries", body),

  update: (uuid: string, body: Partial<SubLibrary>) =>
    patch<SubLibrary>(`/v1/admin/sublibraries/${uuid}`, body),

  remove: (uuid: string) =>
    del<{ ok: boolean; uuid: string }>(`/v1/admin/sublibraries/${uuid}`),

  offboard: (uuid: string, body: { idempotencyKey: string; reason?: string }) =>
    post<{
      ok: boolean;
      uuid: string;
      cleanupMode: "retain_source";
      result: Record<string, unknown>;
    }>(`/v1/admin/sublibraries/${uuid}/actions/offboard`, {
      ...body,
      cleanupMode: "retain_source",
    }),

  observe: (uuid: string) =>
    post<{ workId: string }>(`/v1/admin/sublibraries/${uuid}/actions/observe`, {
      idempotencyKey: `admin-observe:${uuid}:${Date.now()}`,
    }),
};

// ── Adult Libraries ─────────────────────────────────────────────────────────

export interface AdultLibraryConfig {
  settleSeconds: number;
  videoExtensions: string[];
  japaneseJav: Record<string, unknown>;
  western?: Record<string, unknown>;
}

export const adult = {
  getConfig: () => get<AdultLibraryConfig>("/v1/admin/adult/config"),
  patchConfig: (body: Partial<AdultLibraryConfig>) =>
    patch<AdultLibraryConfig>("/v1/admin/adult/config", body),
  rescrapeItem: (itemId: string, adultId?: string) =>
    post<{
      ok: boolean;
      affected: number;
      projection?: Record<string, unknown>;
    }>(`/v1/admin/adult/items/${encodeURIComponent(itemId)}/actions/rescrape`, {
      idempotencyKey: `adult-rescrape:${itemId}:${Date.now()}`,
      ...(adultId ? { adultId } : {}),
    }),
};

// ── Rule Templates ────────────────────────────────────────────────────────────

export const ruleTemplates = {
  list: () =>
    get<{ ruleTemplates: RuleTemplate[] }>("/v1/admin/rule-templates"),

  get: (id: string) =>
    get<RuleTemplate>(`/v1/admin/rule-templates/${encodeURIComponent(id)}`),

  create: (body: {
    id: string;
    name: string;
    description?: string;
    rules?: RuleTemplate["rules"];
  }) => post<RuleTemplate>("/v1/admin/rule-templates", body),

  update: (
    id: string,
    body: {
      name?: string;
      description?: string;
      rules?: RuleTemplate["rules"];
    },
  ) =>
    put<RuleTemplate>(
      `/v1/admin/rule-templates/${encodeURIComponent(id)}`,
      body,
    ),

  remove: (id: string) =>
    del<{ ok: boolean; id: string }>(
      `/v1/admin/rule-templates/${encodeURIComponent(id)}`,
    ),
};

// ── Transcode ────────────────────────────────────────────────────────────────

export const transcode = {
  probeDevices: () =>
    get<{ devices: EncodeDevice[] }>("/v1/admin/transcode/probe-devices"),

  getDevicePool: () => get<DevicePool>("/v1/admin/transcode/device-pool"),
};

// ── Upgrade (MoviePilot) ─────────────────────────────────────────────────────

export interface UpgradeConfig {
  moviepilot: { baseUrl: string; apiKey: string; savePath: string };
  upgradeStagingLocalPath: string;
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
  getConfig: () => get<UpgradeConfig>("/v1/admin/upgrade/config"),

  patchConfig: (body: Partial<UpgradeConfig>) =>
    patch<UpgradeConfig>("/v1/admin/upgrade/config", body),

  getDirectories: () => get<MpDirectory[]>("/v1/admin/upgrade/directories"),
};

// ── Tasks ────────────────────────────────────────────────────────────────────

export const tasks = {
  list: (params?: {
    status?: string;
    statuses?: string[];
    attention?: string;
    targetGate?: string;
    q?: string;
    page?: number;
    pageSize?: number;
    includeAttentionSummary?: boolean;
  }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.statuses?.length) qs.set("statuses", params.statuses.join(","));
    if (params?.attention) qs.set("attention", params.attention);
    if (params?.targetGate) qs.set("targetGate", params.targetGate);
    if (params?.q) qs.set("q", params.q);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.pageSize) qs.set("pageSize", String(params.pageSize));
    if (params?.includeAttentionSummary === false)
      qs.set("includeAttentionSummary", "0");
    const q = qs.toString();
    return get<TaskListResponse>(`/v1/admin/tasks${q ? `?${q}` : ""}`);
  },

  get: (id: string) => get<MediaTask>(`/v1/admin/tasks/${id}?includeEvents=1`),

  confirm: (id: string, confirmData?: Record<string, unknown>) =>
    post<{ id: string; status: string }>(
      `/v1/tasks/${id}/actions/confirm`,
      confirmData ? { confirmData } : {},
    ),

  report: (id: string) => get<TaskReport>(`/v1/tasks/${id}/report`),
};

// ── Resources ────────────────────────────────────────────────────────────────

export const resources = {
  get: (params?: { detail?: "summary" | "full" }) => {
    const qs = new URLSearchParams();
    if (params?.detail) qs.set("detail", params.detail);
    const q = qs.toString();
    return get<ResourceView>(`/v1/admin/resources${q ? `?${q}` : ""}`);
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
    source?: "completion_snapshot" | "current_filesystem" | string;
    checks?: Record<string, boolean>;
    failures?: Array<{ code?: string; message?: string } | string>;
    warnings?: Array<{ code?: string; message?: string } | string>;
  };
  currentScrapeVerification?: {
    ok: boolean;
    checkedAt?: string;
    source?: "current_filesystem" | string;
    checks?: Record<string, boolean>;
    failures?: Array<{ code?: string; message?: string } | string>;
    warnings?: Array<{ code?: string; message?: string } | string>;
  };
}

// ── Health ────────────────────────────────────────────────────────────────────

export const health = {
  check: () => get<HealthStatus>("/v1/admin/health"),
};

// ── System Info ──────────────────────────────────────────────────────────────

export interface SystemInfo {
  platform: string;
}

export const system = {
  getInfo: () => get<SystemInfo>("/v1/admin/system/info"),
};

// ── Public health ─────────────────────────────────────────────────────────────

export const publicHealth = {
  check: () =>
    get<{ status: "green" | "yellow" | "red"; timestamp: string }>(
      "/v1/health",
    ),
};

// ── System Config ─────────────────────────────────────────────────────────────

export interface ResourceSettings {
  resourceLimits: {
    embyApiPerServer: number;
    filesystemPerVolume: number;
    localFfmpeg: number;
    workerPerNode: number;
  };
  workspace: { transcodeTempRoot: string; upgradeStagingLocalPath: string };
  compute: {
    transcodeEncodingDevices: EncodeDevice[];
    transcodeCpuParticipationStrategy: string;
  };
  internal: {
    resources: Array<{
      resourceKey: string;
      capacity: number;
      active: number;
      waiting: number;
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
    retryCount?:
      number | { gte?: number; lte?: number; gt?: number; lt?: number };
  };
  adjust: { op: "subtract" | "add"; value: number };
}

export const adminSettings = {
  getResources: () => get<ResourceSettings>("/v1/admin/settings/resources"),
  patchResources: (body: Partial<ResourceSettings>) =>
    patch<ResourceSettings>("/v1/admin/settings/resources", body),
  getSecurity: () =>
    get<{
      apiKeyConfigured: boolean;
      apiKey: string;
      environmentManaged: boolean;
    }>("/v1/admin/settings/security"),
  patchSecurity: (body: { apiKey: string }) =>
    patch<{ apiKeyConfigured: boolean; restartRequired: boolean }>(
      "/v1/admin/settings/security",
      body,
    ),
  getMaintenancePolicy: () =>
    get<{
      optimizeFlowPolicy: { allowedFlowKinds: string[] };
      approvalPolicy: ApprovalPolicyConfig;
    }>("/v1/admin/policies/maintenance"),
  patchMaintenancePolicy: (body: {
    optimizeFlowPolicy?: { allowedFlowKinds: string[] };
    approvalPolicy?: ApprovalPolicyConfig;
  }) => patch("/v1/admin/policies/maintenance", body),
  getLog: (lines = 300) => getText(`/v1/admin/log?lines=${lines}`),
};
export const automation = {
  get: () =>
    get<{
      libraryAutomation: { works?: Array<Record<string, unknown>> };
      maintenanceAutomation: Record<string, unknown>;
      resources: Record<string, unknown>;
    }>("/v1/admin/automation"),
};

// ── Cleanup Recommendations ──────────────────────────────────────────────────

export interface CleanupRecommendation {
  itemId: string;
  itemName: string;
  subLibraryId: string;
  membership: string;
  phase: string;
  recommendation: {
    reason?: string;
    cleanupMode?: HelixCleanupMode;
    [key: string]: unknown;
  };
}

export const cleanupRecommendations = {
  list: () =>
    get<{ candidates: CleanupRecommendation[]; total: number }>(
      "/v1/admin/cleanup-recommendations",
    ),
};

export interface PersonSummary {
  personId: string;
  name: string;
  aliases: string[];
  providerIds: Record<string, string>;
  contentKinds: string[];
  preference: -2 | -1 | 0 | 1 | 2;
  preferenceRevision: number;
  referenceFaceCount: number;
  relatedMediaCount: number;
  referenceFaces?: Array<{ artifactId: string; faceId: string }>;
}

export const people = {
  list: (
    params: {
      search?: string;
      contentKind?: string;
      preference?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return get<{ people: PersonSummary[]; total: number }>(
      `/v1/admin/people${query.size ? `?${query}` : ""}`,
    );
  },
  get: (personId: string) =>
    get<PersonSummary>(`/v1/admin/people/${encodeURIComponent(personId)}`),
  create: (body: {
    name: string;
    aliases?: string[];
    preference?: number;
    contentKinds?: string[];
  }) => post<PersonSummary>("/v1/admin/people", body),
  update: (
    personId: string,
    body: Partial<Pick<PersonSummary, "name" | "aliases" | "preference">>,
  ) =>
    patch<PersonSummary>(
      `/v1/admin/people/${encodeURIComponent(personId)}`,
      body,
    ),
  relatedMedia: (personId: string) =>
    get<{ items: unknown[] }>(
      `/v1/admin/people/${encodeURIComponent(personId)}/media`,
    ),
  mergeCandidates: () =>
    get<{
      candidates: Array<{
        candidateId: string;
        left: PersonSummary;
        right: PersonSummary;
        reason: string;
      }>;
    }>("/v1/admin/people/merge-candidates"),
  merge: (body: {
    targetPersonId: string;
    sourcePersonId: string;
    preference?: number;
  }) => post("/v1/admin/people/actions/merge", body),
  addReferenceImage: (body: {
    personId?: string;
    name: string;
    aliases?: string[];
    imageBase64?: string;
    imageUrl?: string;
    replaceReference?: boolean;
  }) => post<PersonSummary>("/v1/admin/people/from-image", body),
  deleteReferenceFace: (personId: string, artifactId: string) =>
    del<{ ok: boolean; artifactId: string }>(
      `/v1/admin/people/${encodeURIComponent(personId)}/reference-faces/${encodeURIComponent(artifactId)}`,
    ),
  searchImages: (name: string) =>
    get<{ candidates: Array<{ url: string; thumbnailUrl?: string }> }>(
      `/v1/admin/people/search-images?name=${encodeURIComponent(name)}`,
    ),
  referenceImageUrl: (personId: string, thumbnail = true) =>
    `/v1/admin/people/${encodeURIComponent(personId)}/reference-image${thumbnail ? "?thumbnail=1" : ""}`,
};

export type HelixCleanupMode =
  "retain_source" | "detach_source" | "delete_source";

export const helixLibrary = {
  onboard: (body: {
    itemId?: string;
    idempotencyKey: string;
    sourceReference: Record<string, unknown>;
  }) => post("/v1/admin/library/actions/onboard", body),
  offboard: (
    itemId: string,
    body: {
      idempotencyKey: string;
      cleanupMode: HelixCleanupMode;
      reason?: string;
      destructiveAuthorization?: boolean;
    },
  ) =>
    post(
      `/v1/admin/library/items/${encodeURIComponent(itemId)}/actions/offboard`,
      body,
    ),
  startMaintenance: (itemId: string) =>
    post(
      `/v1/admin/library/items/${encodeURIComponent(itemId)}/actions/start-maintenance`,
      {
        idempotencyKey: `start-maintenance:${itemId}:${Date.now()}`,
      },
    ),
  prioritizeMaintenance: (itemId: string) =>
    post(
      `/v1/admin/library/items/${encodeURIComponent(itemId)}/actions/prioritize-maintenance`,
      {
        idempotencyKey: `prioritize-maintenance:${itemId}:${Date.now()}`,
      },
    ),
  cancelMaintenancePriority: (itemId: string) =>
    post(
      `/v1/admin/library/items/${encodeURIComponent(itemId)}/actions/cancel-maintenance-priority`,
      {
        idempotencyKey: `cancel-maintenance-priority:${itemId}:${Date.now()}`,
      },
    ),
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
  getSession: () => get<DoubanSession>("/v1/integrations/douban/session"),

  saveSession: (body: DoubanSession) =>
    put<DoubanSession>("/v1/integrations/douban/session", body),

  fetchRatings: (subLibraryId: string) =>
    get<{ ok: boolean; message: string }>(
      `/v1/integrations/douban/fetch/ratings?subLibraryId=${encodeURIComponent(subLibraryId)}`,
    ),
};

// ── Space Stats ──────────────────────────────────────────────────────────────

export const spaceStats = {
  get: () => get<SpaceStats>("/v1/space-stats"),
};

export const dashboardHealth = {
  get: () => get<DashboardHealthSummary>("/v1/admin/dashboard/health"),
};

// ── Nodes ──────────────────────────────────────────────────────────────────────

export interface NodeInfo {
  id: string;
  name: string;
  address: string;
  apiKey: string;
  status: "online" | "offline";
  capabilities: {
    devices: {
      stableKey: string;
      label: string;
      backend: string;
      gpuIndex: number;
    }[];
  };
  activeJobCount: number;
  consecutiveFailures: number;
  lastSeenAt: string;
  createdAt: string;
}

export const nodes = {
  list: () => get<{ nodes: NodeInfo[] }>("/v1/admin/nodes"),

  get: (id: string) =>
    get<NodeInfo>(`/v1/admin/nodes/${encodeURIComponent(id)}`),

  create: (body: { name: string; address: string; apiKey: string }) =>
    post<NodeInfo>("/v1/admin/nodes", body),

  remove: (id: string, force?: boolean) =>
    del<{ ok: boolean }>(
      `/v1/admin/nodes/${encodeURIComponent(id)}${force ? "?force=true" : ""}`,
    ),

  update: (id: string, body: { name?: string; apiKey?: string }) =>
    patch<NodeInfo>(`/v1/admin/nodes/${encodeURIComponent(id)}`, body),

  probe: (id: string) =>
    post<{
      ok: boolean;
      capabilities: {
        devices: {
          stableKey: string;
          label: string;
          backend: string;
          gpuIndex: number;
        }[];
      };
    }>(`/v1/admin/nodes/${encodeURIComponent(id)}/actions/probe`),

  patchDevice: (
    nodeId: string,
    stableKey: string,
    inPool: boolean,
    extra?: { priority?: number; maxSlots?: number },
  ) =>
    patch<{
      ok: boolean;
      capabilities: {
        devices: {
          stableKey: string;
          inPool: boolean;
          priority?: number;
          maxSlots?: number;
        }[];
      };
    }>(`/v1/admin/nodes/${encodeURIComponent(nodeId)}/devices`, {
      stableKey,
      inPool,
      ...(extra || {}),
    }),
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
  getSites: () => get<MpSite[]>("/v1/admin/moviepilot/sites"),
};

// ── ApiConflictError ──────────────────────────────────────────────────────────

export class ApiConflictError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiConflictError";
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
    get<{ subLibraries: SubLibraryInfo[] }>("/v1/library/status"),

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
    projection?: "summary" | "manage" | "full" | "compat";
  }) => {
    const q = new URLSearchParams();
    if (options?.subLibraryId) q.set("subLibraryId", options.subLibraryId);
    if (options?.limit) q.set("limit", String(options.limit));
    if (options?.offset) q.set("offset", String(options.offset));
    if (options?.projection) q.set("projection", options.projection);
    for (const key of [
      "search",
      "resolution",
      "codec",
      "watched",
      "bluRay",
      "douban",
      "userRating",
      "task",
      "metadata",
      "scrape",
      "lifecycle",
    ] as const) {
      const value = options?.[key];
      if (value && value !== "all") q.set(key, value);
    }
    const params = q.toString() ? `?${q.toString()}` : "";
    return get<{ items: unknown[]; total: number }>(`/v1/library${params}`);
  },

  markPlayed: (itemId: string, subLibraryId?: string) =>
    post<{ ok: boolean }>("/v1/library/actions/mark-played", {
      itemId,
      subLibraryId: subLibraryId || undefined,
    }),

  markUnplayed: (itemId: string, subLibraryId?: string) =>
    post<{ ok: boolean }>("/v1/library/actions/mark-unplayed", {
      itemId,
      subLibraryId: subLibraryId || undefined,
    }),

  patchRatings: (itemId: string, userRating: number | null) =>
    patch<{ ok: boolean }>("/v1/library/ratings", { itemId, userRating }),

  recomputeOptimizeTargets: () =>
    post<{ ok: boolean; changed: number }>(
      "/v1/library/actions/recompute-optimize-targets",
    ),

  recomputeStrategy: () =>
    post<{ ok: boolean; changed: number }>(
      "/v1/library/actions/recompute-strategy",
    ),
};
