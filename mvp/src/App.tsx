import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  canUserExecuteTask,
  canUserPauseTask,
  enqueueTask,
  hasActiveTaskForItem,
  isTaskTerminal,
  loadTaskQueue,
  markWaitingMediaSourceRetryWithDelay,
  saveTaskQueue,
  taskOccupiesActiveSlot,
  taskStatusLabelZh,
  type MediaTask,
} from './taskQueue';
import {
  advanceTaskQueue,
  applyControl,
  defaultSchedulerSettings,
  refreshWaitingTasks,
  waitingMediaDelayMs,
} from './taskScheduler';
import {
  buildTaskPreview,
  defaultMediaPolicy,
  nextManualRefreshInfo,
  recommendedAction,
  type ManagedMediaItem,
  type MediaAction,
  type MediaPolicy,
  type MediaRating,
} from './mediaManager';
import { createDebugSeedTasks } from './debugSeed';
import { buildDoubanStarsByNormalizedTitle, movieDoubanStars, type DoubanRatingEntry } from './doubanUtils';
import { MediaLibraryManageRow } from './MediaLibraryManageRow';

const STORAGE_KEY = 'embyDesktopPlayerConfigV1';
const LOCAL_MARKED_PLAYED_KEY = 'embyDesktopPlayerLocalMarkedPlayedV1';
const TASK_SCHEDULER_SETTINGS_KEY = 'embyDesktopPlayerTaskSchedulerSettingsV1';
const MEDIA_POLICY_KEY = 'embyDesktopPlayerMediaPolicyV1';
const MANAGED_ITEM_META_KEY = 'embyDesktopPlayerManagedItemMetaV1';
/** 媒体库管理：最近一次从 Emby 拉取的全量列表（结构化 JSON） */
const LIBRARY_MANAGE_CACHE_KEY = 'embyDesktopPlayerLibraryManageCacheV1';

type LibraryManageCacheV1 = {
  version: 1;
  /** 与当前 Emby 用户、Base URL、已勾选媒体库列表绑定；任一变化则弃用缓存 */
  fingerprint: string;
  savedAt: string;
  items: UnplayedItem[];
};

function libraryManageFingerprint(cfg: EmbyConfig): string {
  const base = cfg.baseUrl.trim().replace(/\/+$/, '');
  const u = cfg.userId.trim();
  const s = [...cfg.enabledSectionIds].map((x) => String(x).trim()).filter(Boolean).sort();
  return JSON.stringify({ b: base, u, s });
}

function coerceUnplayedItem(x: unknown): UnplayedItem | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  const name = typeof o.name === 'string' ? o.name : '';
  const sectionId = typeof o.sectionId === 'string' ? o.sectionId.trim() : '';
  if (!id || !sectionId) return null;
  const out: UnplayedItem = { id, name: name.trim() || id, sectionId };
  if (typeof o.posterTag === 'string' && o.posterTag) out.posterTag = o.posterTag;
  if (typeof o.runTimeTicks === 'number' && o.runTimeTicks > 0) out.runTimeTicks = o.runTimeTicks;
  if (typeof o.durationSec === 'number' && o.durationSec > 0) out.durationSec = o.durationSec;
  if (typeof o.sizeGb === 'number' && o.sizeGb > 0) out.sizeGb = o.sizeGb;
  if (o.resolution === '1080p' || o.resolution === '4K') out.resolution = o.resolution;
  if (o.codec === 'h264' || o.codec === 'h265' || o.codec === 'av1') out.codec = o.codec;
  if (typeof o.embyPlayed === 'boolean') out.embyPlayed = o.embyPlayed;
  if (o.itemType === 'Movie' || o.itemType === 'Episode' || o.itemType === 'Other') out.itemType = o.itemType;
  if (typeof o.isBluRayDisc === 'boolean') out.isBluRayDisc = o.isBluRayDisc;
  return out;
}

function readLibraryManageCacheBlob(): LibraryManageCacheV1 | null {
  try {
    const raw = localStorage.getItem(LIBRARY_MANAGE_CACHE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<LibraryManageCacheV1>;
    if (!p || p.version !== 1 || typeof p.fingerprint !== 'string' || typeof p.savedAt !== 'string' || !Array.isArray(p.items)) {
      return null;
    }
    return p as LibraryManageCacheV1;
  } catch {
    return null;
  }
}

function hydrateLibraryManageFromStorage(cfg: EmbyConfig): { items: UnplayedItem[]; savedAt: string | null } {
  if (!hasConfigForLibraryFetch(cfg)) return { items: [], savedAt: null };
  const blob = readLibraryManageCacheBlob();
  const fp = libraryManageFingerprint(cfg);
  if (!blob || blob.fingerprint !== fp) return { items: [], savedAt: null };
  const items = blob.items.map(coerceUnplayedItem).filter((x): x is UnplayedItem => x != null);
  return { items, savedAt: blob.savedAt };
}

function saveLibraryManageCache(cfg: EmbyConfig, items: UnplayedItem[]): string | null {
  if (!hasConfigForLibraryFetch(cfg)) return null;
  const savedAt = new Date().toISOString();
  const blob: LibraryManageCacheV1 = {
    version: 1,
    fingerprint: libraryManageFingerprint(cfg),
    savedAt,
    items,
  };
  try {
    localStorage.setItem(LIBRARY_MANAGE_CACHE_KEY, JSON.stringify(blob));
  } catch (e) {
    console.warn('[library cache] save failed', e);
    return null;
  }
  return savedAt;
}

const DOUBAN_ENTRIES_CACHE_KEY = 'embyDesktopPlayerDoubanRatingEntriesV1';

function loadDoubanRatingEntries(): DoubanRatingEntry[] {
  try {
    const raw = localStorage.getItem(DOUBAN_ENTRIES_CACHE_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw) as { entries?: unknown };
    if (!p || !Array.isArray(p.entries)) return [];
    const out: DoubanRatingEntry[] = [];
    for (const x of p.entries) {
      if (!x || typeof x !== 'object') continue;
      const o = x as Record<string, unknown>;
      const title = typeof o.title === 'string' ? o.title.trim() : '';
      const subjectId = typeof o.subjectId === 'string' ? o.subjectId.trim() : '';
      const stars = typeof o.stars === 'number' ? o.stars : Number(o.stars);
      if (!title || !subjectId || !Number.isInteger(stars) || stars < 1 || stars > 5) continue;
      out.push({ title, stars: stars as MediaRating, subjectId });
    }
    return out;
  } catch {
    return [];
  }
}

function saveDoubanRatingEntries(entries: DoubanRatingEntry[]) {
  localStorage.setItem(DOUBAN_ENTRIES_CACHE_KEY, JSON.stringify({ syncedAt: new Date().toISOString(), entries }));
}

function wireToDoubanEntries(raw: DoubanRatingEntryWire[]): DoubanRatingEntry[] {
  const out: DoubanRatingEntry[] = [];
  for (const o of raw) {
    const title = typeof o.title === 'string' ? o.title.trim() : '';
    const subjectId = typeof o.subjectId === 'string' ? o.subjectId.trim() : '';
    const stars = typeof o.stars === 'number' ? o.stars : Number(o.stars);
    if (!title || !subjectId || !Number.isInteger(stars) || stars < 1 || stars > 5) continue;
    out.push({ title, stars: stars as MediaRating, subjectId });
  }
  return out;
}

type ManagedItemMeta = {
  rating?: MediaRating | null;
  watched?: boolean;
};

type AppPage = 'config' | 'wall' | 'history' | 'mediaManage' | 'taskCenter';

type MainNavPage = AppPage;

type ConfigSection = 'emby' | 'policy' | 'scheduler' | 'douban';

type ManageBitrateFilterKey = 'all' | 'transcode' | 'upgrade' | 'keep' | 'no_rating' | 'delete';
type ManageResolutionFilterKey = 'all' | '1080p' | '4K';
type ManageCodecFilterKey = 'all' | 'h264' | 'h265' | 'av1';
type ManageWatchedFilterKey = 'all' | 'watched' | 'unwatched';
type ManageBluRayFilterKey = 'all' | 'disc' | 'not_disc';

const MAIN_NAV: { id: MainNavPage; label: string }[] = [
  { id: 'config', label: '配置中心' },
  { id: 'wall', label: '海报墙' },
  { id: 'mediaManage', label: '媒体库管理' },
  { id: 'taskCenter', label: '任务中心' },
  { id: 'history', label: '播放记录' },
];

function TopNav({ page, setPage }: { page: AppPage; setPage: (p: AppPage) => void }) {
  return (
    <nav className="topNav" aria-label="主导航">
      {MAIN_NAV.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className={`navTab${page === id ? ' navTabActive' : ''}`}
          onClick={() => setPage(id)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

function AppShell({
  page,
  setPage,
  sidebar,
  children,
  error,
}: {
  page: AppPage;
  setPage: (p: AppPage) => void;
  sidebar: ReactNode;
  children: ReactNode;
  error?: string | null;
}) {
  return (
    <div className="app appShell">
      <header className="appHeader">
        <div className="appHeaderLeft">
          <div className="appTitle">Emby Desktop Player</div>
        </div>
        <TopNav page={page} setPage={setPage} />
      </header>
      <div className="appBody">
        <aside className="pageSidebar">{sidebar}</aside>
        <main className="pageMain">
          <div className="content pageMainInner">{children}</div>
        </main>
      </div>
      {error ? (
        <div className="appErrorBanner" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function loadManagedItemMeta(): Record<string, ManagedItemMeta> {
  try {
    const raw = localStorage.getItem(MANAGED_ITEM_META_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Record<string, ManagedItemMeta>;
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

function saveManagedItemMetaPatch(patch: Record<string, Partial<ManagedItemMeta>>) {
  const prev = loadManagedItemMeta();
  for (const [id, delta] of Object.entries(patch)) {
    prev[id] = { ...prev[id], ...delta };
  }
   localStorage.setItem(MANAGED_ITEM_META_KEY, JSON.stringify(prev));
}

const defaultConfig: EmbyConfig = {
  baseUrl: 'http://localhost:8096/emby',
  apiKey: '',
  userId: '',
  enabledSectionIds: [],
  playerExePath: '',
  argsTemplate: '"{path}" /new',
  pathMapFrom: '',
  pathMapTo: '',
  markPlayedThresholdPercent: 90,
  fallbackMinSeconds: 600,
};

function normalizeConfig(raw: Partial<EmbyConfig>): EmbyConfig {
  return {
    baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : defaultConfig.baseUrl,
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : defaultConfig.apiKey,
    userId: typeof raw.userId === 'string' ? raw.userId : defaultConfig.userId,
    enabledSectionIds: Array.isArray(raw.enabledSectionIds)
      ? raw.enabledSectionIds.filter((x): x is string => typeof x === 'string')
      : defaultConfig.enabledSectionIds,
    playerExePath: typeof raw.playerExePath === 'string' ? raw.playerExePath : defaultConfig.playerExePath,
    argsTemplate: typeof raw.argsTemplate === 'string' ? raw.argsTemplate : defaultConfig.argsTemplate,
    pathMapFrom: typeof raw.pathMapFrom === 'string' ? raw.pathMapFrom : defaultConfig.pathMapFrom,
    pathMapTo: typeof raw.pathMapTo === 'string' ? raw.pathMapTo : defaultConfig.pathMapTo,
    markPlayedThresholdPercent:
      typeof raw.markPlayedThresholdPercent === 'number' && Number.isFinite(raw.markPlayedThresholdPercent)
        ? raw.markPlayedThresholdPercent
        : defaultConfig.markPlayedThresholdPercent,
    fallbackMinSeconds:
      typeof raw.fallbackMinSeconds === 'number' && Number.isFinite(raw.fallbackMinSeconds)
        ? raw.fallbackMinSeconds
        : defaultConfig.fallbackMinSeconds,
  };
}

function loadSavedConfig(): EmbyConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultConfig;
    return normalizeConfig(JSON.parse(raw) as Partial<EmbyConfig>);
  } catch {
    return defaultConfig;
  }
}

function isConfigReady(config: EmbyConfig, connected: boolean) {
  return (
    connected &&
    !!config.baseUrl.trim() &&
    !!config.apiKey.trim() &&
    !!config.userId.trim() &&
    !!config.playerExePath.trim() &&
    config.enabledSectionIds.length > 0
  );
}

/** 拉取 Emby 列表（未播放 / 已播放等）所需的最低配置，不要求已填播放器路径。 */
function hasEmbyCoreConfig(config: EmbyConfig): boolean {
  return (
    !!config.baseUrl.trim() &&
    !!config.apiKey.trim() &&
    !!config.userId.trim() &&
    config.enabledSectionIds.length > 0
  );
}

/** 拉取未播放列表：仅需 Emby 核心配置（不要求已填播放器路径）。 */
function hasConfigForLibraryFetch(config: EmbyConfig): boolean {
  return hasEmbyCoreConfig(config);
}

/** 治理列表：各条目 sizeGb 累加后的展示（刷新媒体库列表时重算） */
function formatAggregateLibrarySizeGb(totalGb: number): string {
  if (!Number.isFinite(totalGb) || totalGb <= 0) return '0 GB';
  if (totalGb >= 1024) return `${(totalGb / 1024).toFixed(2)} TB（约 ${totalGb.toFixed(0)} GB）`;
  return `${totalGb.toFixed(1)} GB`;
}

function formatPlayedAt(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function playedTypeLabel(t: PlayedItem['type']) {
  if (t === 'Movie') return '电影';
  if (t === 'Episode') return '剧集';
  if (t === 'Other') return '其他';
  return '未知';
}

function playedTimeMs(iso?: string) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function loadLocalMarkedPlayed(): PlayedItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_MARKED_PLAYED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is PlayedItem =>
        !!x &&
        typeof x === 'object' &&
        typeof (x as PlayedItem).id === 'string' &&
        typeof (x as PlayedItem).name === 'string',
    );
  } catch {
    return [];
  }
}

function saveLocalMarkedPlayed(entry: PlayedItem) {
  try {
    const prev = loadLocalMarkedPlayed();
    const next = [entry, ...prev.filter((x) => x.id !== entry.id)].slice(0, 80);
    localStorage.setItem(LOCAL_MARKED_PLAYED_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function removeLocalMarkedPlayed(itemId: string) {
  try {
    const prev = loadLocalMarkedPlayed();
    const next = prev.filter((x) => x.id !== itemId);
    localStorage.setItem(LOCAL_MARKED_PLAYED_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function mergePlayedHistoryServerWithLocal(server: PlayedItem[]): PlayedItem[] {
  const local = loadLocalMarkedPlayed();
  const byId = new Map<string, PlayedItem>();
  for (const x of server) byId.set(x.id, x);
  for (const x of local) {
    const prev = byId.get(x.id);
    if (!prev) {
      byId.set(x.id, x);
      continue;
    }
    if (playedTimeMs(x.datePlayed) >= playedTimeMs(prev.datePlayed)) {
      byId.set(x.id, { ...prev, ...x, datePlayed: x.datePlayed || prev.datePlayed });
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => playedTimeMs(b.datePlayed) - playedTimeMs(a.datePlayed))
    .slice(0, 300);
}

function buildPosterUrl(config: EmbyConfig, item: { id: string; posterTag?: string }, width = 220) {
  const tag = item.posterTag ? `&tag=${encodeURIComponent(item.posterTag)}` : '';
  return `${config.baseUrl.replace(/\/$/, '')}/Items/${encodeURIComponent(item.id)}/Images/Primary?width=${width}&api_key=${encodeURIComponent(
    config.apiKey,
  )}${tag}`;
}

function normalizeSchedulerSettings(raw: Partial<TaskSchedulerSettings>): TaskSchedulerSettings {
  const fallback = defaultSchedulerSettings();
  return {
    transcodeConcurrency:
      typeof raw.transcodeConcurrency === 'number' && Number.isFinite(raw.transcodeConcurrency)
        ? Math.max(1, Math.floor(raw.transcodeConcurrency))
        : fallback.transcodeConcurrency,
    upgradeConcurrency:
      typeof raw.upgradeConcurrency === 'number' && Number.isFinite(raw.upgradeConcurrency)
        ? Math.max(1, Math.floor(raw.upgradeConcurrency))
        : fallback.upgradeConcurrency,
    runMode: raw.runMode === 'scheduled' ? 'scheduled' : 'manual',
    wallRatingAutoEnqueue:
      typeof raw.wallRatingAutoEnqueue === 'boolean' ? raw.wallRatingAutoEnqueue : fallback.wallRatingAutoEnqueue,
    waitingFastRetryCount:
      typeof raw.waitingFastRetryCount === 'number' && Number.isFinite(raw.waitingFastRetryCount)
        ? Math.max(1, Math.floor(raw.waitingFastRetryCount))
        : fallback.waitingFastRetryCount,
    waitingFastIntervalHours:
      typeof raw.waitingFastIntervalHours === 'number' && Number.isFinite(raw.waitingFastIntervalHours)
        ? Math.max(1, Math.floor(raw.waitingFastIntervalHours))
        : fallback.waitingFastIntervalHours,
    waitingMidRetryCount:
      typeof raw.waitingMidRetryCount === 'number' && Number.isFinite(raw.waitingMidRetryCount)
        ? Math.max(2, Math.floor(raw.waitingMidRetryCount))
        : fallback.waitingMidRetryCount,
    waitingMidIntervalDays:
      typeof raw.waitingMidIntervalDays === 'number' && Number.isFinite(raw.waitingMidIntervalDays)
        ? Math.max(1, Math.floor(raw.waitingMidIntervalDays))
        : fallback.waitingMidIntervalDays,
    waitingSlowIntervalDays:
      typeof raw.waitingSlowIntervalDays === 'number' && Number.isFinite(raw.waitingSlowIntervalDays)
        ? Math.max(1, Math.floor(raw.waitingSlowIntervalDays))
        : fallback.waitingSlowIntervalDays,
  };
}

function loadSchedulerSettings(): TaskSchedulerSettings {
  try {
    const raw = localStorage.getItem(TASK_SCHEDULER_SETTINGS_KEY);
    if (!raw) return defaultSchedulerSettings();
    return normalizeSchedulerSettings(JSON.parse(raw) as Partial<TaskSchedulerSettings>);
  } catch {
    return defaultSchedulerSettings();
  }
}

function normalizeMediaPolicy(raw: Partial<MediaPolicy>): MediaPolicy {
  const fallback = defaultMediaPolicy;
  const read = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0.5, v) : d);
  return {
    target1080p: {
      2: read(raw.target1080p?.[2], fallback.target1080p[2]),
      3: read(raw.target1080p?.[3], fallback.target1080p[3]),
      4: read(raw.target1080p?.[4], fallback.target1080p[4]),
      5: read(raw.target1080p?.[5], fallback.target1080p[5]),
    },
    target4k: {
      2: read(raw.target4k?.[2], fallback.target4k[2]),
      3: read(raw.target4k?.[3], fallback.target4k[3]),
      4: read(raw.target4k?.[4], fallback.target4k[4]),
      5: read(raw.target4k?.[5], fallback.target4k[5]),
    },
  };
}

function loadMediaPolicy(): MediaPolicy {
  try {
    const raw = localStorage.getItem(MEDIA_POLICY_KEY);
    if (!raw) return defaultMediaPolicy;
    return normalizeMediaPolicy(JSON.parse(raw) as Partial<MediaPolicy>);
  } catch {
    return defaultMediaPolicy;
  }
}

export default function App() {
  const [config, setConfig] = useState<EmbyConfig>(() => loadSavedConfig());
  const [sections, setSections] = useState<EmbyMediaFolder[]>([]);
  const [users, setUsers] = useState<EmbyUser[]>([]);
  const [items, setItems] = useState<UnplayedItem[]>([]);
  /** 媒体库管理：已启用库内全部影片/剧集（含已观看），与海报墙未播放列表分离；启动时尽量从本地缓存恢复 */
  const [libraryManageItems, setLibraryManageItems] = useState<UnplayedItem[]>(() => {
    return hydrateLibraryManageFromStorage(loadSavedConfig()).items;
  });
  /** 本地列表缓存写入时间（ISO）；仅「刷新媒体库列表」成功后会更新 */
  const [libraryManageCacheSavedAt, setLibraryManageCacheSavedAt] = useState<string | null>(() => {
    return hydrateLibraryManageFromStorage(loadSavedConfig()).savedAt;
  });
  const [playedItems, setPlayedItems] = useState<PlayedItem[]>([]);
  const [connected, setConnected] = useState(false);
  const [page, setPage] = useState<AppPage>('config');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeSession, setActiveSession] = useState<{
    item: UnplayedItem;
    startedAtMs: number;
    runtimeSeconds?: number;
  } | null>(null);
  const [confirm, setConfirm] = useState<{
    item: UnplayedItem;
    completionPercent: number;
    belowThreshold: boolean;
    elapsedMinutes: number;
    runtimeMinutes?: number;
  } | null>(null);
  const [historyDays, setHistoryDays] = useState<7 | 30 | 0>(30);
  const [historyType, setHistoryType] = useState<'all' | 'Movie' | 'Episode'>('all');
  const [historySectionId, setHistorySectionId] = useState('');
  const [historyActionBusyId, setHistoryActionBusyId] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [tasks, setTasks] = useState<MediaTask[]>(() => loadTaskQueue());
  const [batchRunning, setBatchRunning] = useState(false);
  const [schedulerSettings, setSchedulerSettings] = useState<TaskSchedulerSettings>(() => loadSchedulerSettings());
  const [mediaPolicy, setMediaPolicy] = useState<MediaPolicy>(() => loadMediaPolicy());
  const [managedItems, setManagedItems] = useState<ManagedMediaItem[]>([]);
  const [manageSelectedIds, setManageSelectedIds] = useState<Set<string>>(() => new Set());
  const [manageRatingOverlay, setManageRatingOverlay] = useState(false);
  const [managePendingRating, setManagePendingRating] = useState<MediaRating | null>(3);
  const [enqueueHint, setEnqueueHint] = useState<string | null>(null);
  const [manageDeleteExplainOpen, setManageDeleteExplainOpen] = useState(false);
  const [manageSearchQuery, setManageSearchQuery] = useState('');
  const [manageBitrateFilter, setManageBitrateFilter] = useState<ManageBitrateFilterKey>('all');
  const [manageResolutionFilter, setManageResolutionFilter] = useState<ManageResolutionFilterKey>('all');
  const [manageCodecFilter, setManageCodecFilter] = useState<ManageCodecFilterKey>('all');
  const [manageWatchedFilter, setManageWatchedFilter] = useState<ManageWatchedFilterKey>('all');
  const [manageBluRayFilter, setManageBluRayFilter] = useState<ManageBluRayFilterKey>('all');
  const [manageHighlightId, setManageHighlightId] = useState<string | null>(null);
  const mediaManageTableRef = useRef<HTMLDivElement | null>(null);
  const setManagedWatchStateRef = useRef<(it: ManagedMediaItem, watched: boolean) => Promise<void>>(async () => {});
  const enqueueManagedActionRef = useRef<(item: ManagedMediaItem, action: MediaAction) => void>(() => {});
  const [infoConfirmTaskId, setInfoConfirmTaskId] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<'all' | MediaTask['status']>('all');
  const [batchRunSelectedIds, setBatchRunSelectedIds] = useState<Set<string>>(() => new Set());
  const [wallRatingItem, setWallRatingItem] = useState<UnplayedItem | null>(null);
  const [wallRatingChoice, setWallRatingChoice] = useState<MediaRating>(3);
  const [configSection, setConfigSection] = useState<ConfigSection>('emby');
  /** 媒体库多选区：获取列表前折叠，成功拉取后自动展开 */
  const [libraryPanelExpanded, setLibraryPanelExpanded] = useState(false);
  const [doubanRatingEntries, setDoubanRatingEntries] = useState<DoubanRatingEntry[]>(() => loadDoubanRatingEntries());
  const [doubanCookieDraft, setDoubanCookieDraft] = useState('');
  const [doubanUserIdDraft, setDoubanUserIdDraft] = useState('');
  const [doubanSettingsHint, setDoubanSettingsHint] = useState<string | null>(null);
  const [doubanSyncBusy, setDoubanSyncBusy] = useState(false);
  const [doubanFetchStatus, setDoubanFetchStatus] = useState<string | null>(null);

  const enabledSet = useMemo(() => new Set(config.enabledSectionIds), [config.enabledSectionIds]);
  const doubanStarsByNormTitle = useMemo(
    () => buildDoubanStarsByNormalizedTitle(doubanRatingEntries),
    [doubanRatingEntries],
  );
  const libraryManageCacheFingerprint = useMemo(
    () => (hasConfigForLibraryFetch(config) ? libraryManageFingerprint(config) : ''),
    [config.baseUrl, config.userId, config.enabledSectionIds],
  );
  const sectionNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sections) map.set(s.id, s.name);
    return map;
  }, [sections]);

  const configRef = useRef(config);
  configRef.current = config;
  useEffect(() => {
    const cfg = configRef.current;
    if (!libraryManageCacheFingerprint) {
      setLibraryManageItems([]);
      setLibraryManageCacheSavedAt(null);
      return;
    }
    const { items, savedAt } = hydrateLibraryManageFromStorage(cfg);
    setLibraryManageItems(items);
    setLibraryManageCacheSavedAt(savedAt);
  }, [libraryManageCacheFingerprint]);
  const taskSummary = useMemo(() => {
    const byStatus = new Map<string, number>();
    for (const t of tasks) byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);
    return {
      total: tasks.length,
      queued: byStatus.get('queued') ?? 0,
      pendingManual: byStatus.get('pending_manual') ?? 0,
      running: (byStatus.get('precheck') ?? 0) + (byStatus.get('executing') ?? 0) + (byStatus.get('verify') ?? 0),
      waitingMediaSource: byStatus.get('waiting_media_source') ?? 0,
      interrupted: byStatus.get('interrupted') ?? 0,
      paused: byStatus.get('paused') ?? 0,
    };
  }, [tasks]);
  const filteredTasks = useMemo(
    () => (taskFilter === 'all' ? tasks : tasks.filter((t) => t.status === taskFilter)),
    [tasks, taskFilter],
  );

  /** 媒体库行展示：每条视频至多一条未结案任务（互斥） */
  const activeTaskByItemId = useMemo(() => {
    const m = new Map<string, MediaTask>();
    for (const t of tasks) {
      if (isTaskTerminal(t)) continue;
      if (!m.has(t.itemId)) m.set(t.itemId, t);
    }
    return m;
  }, [tasks]);

  const managedItemsFiltered = useMemo(() => {
    let list = managedItems;
    const q = manageSearchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((it) => it.name.toLowerCase().includes(q));
    }
    if (manageBitrateFilter !== 'all') {
      list = list.filter((it) => {
        const a = recommendedAction(it, mediaPolicy);
        switch (manageBitrateFilter) {
          case 'transcode':
            return a === 'transcode';
          case 'upgrade':
            return a === 'upgrade';
          case 'keep':
            return a === 'keep' && it.rating != null && it.rating !== 1;
          case 'no_rating':
            return it.rating == null;
          case 'delete':
            return it.rating === 1;
          default:
            return true;
        }
      });
    }
    if (manageResolutionFilter !== 'all') {
      list = list.filter((it) => it.resolution === manageResolutionFilter);
    }
    if (manageCodecFilter !== 'all') {
      list = list.filter((it) => it.codec === manageCodecFilter);
    }
    if (manageWatchedFilter === 'watched') {
      list = list.filter((it) => it.watched);
    } else if (manageWatchedFilter === 'unwatched') {
      list = list.filter((it) => !it.watched);
    }
    if (manageBluRayFilter === 'disc') {
      list = list.filter((it) => it.isBluRayDisc);
    } else if (manageBluRayFilter === 'not_disc') {
      list = list.filter((it) => !it.isBluRayDisc);
    }
    return list;
  }, [
    managedItems,
    manageSearchQuery,
    manageBitrateFilter,
    manageResolutionFilter,
    manageCodecFilter,
    manageWatchedFilter,
    manageBluRayFilter,
    mediaPolicy,
  ]);

  /** 已启用媒体库全量列表体积总和（与「刷新媒体库列表」数据源一致） */
  const libraryManageCapacity = useMemo(() => {
    let totalGb = 0;
    let movieCount = 0;
    let episodeCount = 0;
    for (const it of libraryManageItems) {
      const g = it.sizeGb;
      if (typeof g === 'number' && Number.isFinite(g) && g > 0) totalGb += g;
      if (it.itemType === 'Movie') movieCount++;
      else if (it.itemType === 'Episode') episodeCount++;
    }
    const count = libraryManageItems.length;
    const otherCount = Math.max(0, count - movieCount - episodeCount);
    return { totalGb, count, movieCount, episodeCount, otherCount };
  }, [libraryManageItems]);

  /** 豆瓣匹配进度：分子为电影行中匹配到 1～5 星的数量，分母同侧栏「总电影数」 */
  const doubanMovieMatchStats = useMemo(() => {
    let matched = 0;
    const total = libraryManageCapacity.movieCount;
    for (const it of libraryManageItems) {
      if (it.itemType !== 'Movie') continue;
      if (movieDoubanStars(it.name, it.itemType, doubanStarsByNormTitle) != null) matched += 1;
    }
    return { matched, total };
  }, [libraryManageItems, libraryManageCapacity.movieCount, doubanStarsByNormTitle]);

  const isTaskBatchToggleable = (t: MediaTask) => !isTaskTerminal(t);

  function toggleBatchRunSelect(taskId: string) {
    setBatchRunSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  function selectAllBatchInCurrentFilter() {
    setBatchRunSelectedIds(new Set(filteredTasks.filter(isTaskBatchToggleable).map((t) => t.id)));
  }

  function clearBatchRunSelection() {
    setBatchRunSelectedIds(new Set());
  }

  /** §9 软停：占槽则标记 pauseRequested，否则立即 paused */
  function applyPauseTransition(t: MediaTask, nowIso: string): MediaTask {
    if (isTaskTerminal(t) || t.status === 'paused') return t;
    if (taskOccupiesActiveSlot(t)) return { ...t, pauseRequested: true, updatedAt: nowIso };
    return { ...t, status: 'paused', pauseRequested: false, updatedAt: nowIso };
  }

  function batchRemoveSelected() {
    const ids = batchRunSelectedIds;
    if (ids.size === 0) return;
    setTasks((prev) => prev.filter((t) => !ids.has(t.id)));
    if (infoConfirmTaskId && ids.has(infoConfirmTaskId)) setInfoConfirmTaskId(null);
    setBatchRunSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  function batchPauseSelected() {
    const ids = batchRunSelectedIds;
    if (ids.size === 0) return;
    let skippedPending = false;
    const nowIso = new Date().toISOString();
    setTasks((prev) =>
      prev.map((t) => {
        if (!ids.has(t.id)) return t;
        if (t.status === 'pending_manual') {
          skippedPending = true;
          return t;
        }
        if (!canUserPauseTask(t)) return t;
        return applyPauseTransition(t, nowIso);
      }),
    );
    if (skippedPending) setError('部分任务尚未启动，已跳过暂停。');
    else setError(null);
  }

  function clearAllPausedToQueued() {
    const nowIso = new Date().toISOString();
    setTasks((prev) =>
      prev.map((t) =>
        t.status === 'paused' ? { ...t, status: 'queued', pauseRequested: false, updatedAt: nowIso } : t,
      ),
    );
  }

  const infoConfirmCandidates = useMemo(() => {
    if (!infoConfirmTaskId) return [];
    const base = tasks.find((t) => t.id === infoConfirmTaskId);
    if (!base) return [];
    const seed = Math.abs(base.itemId.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0));
    return [
      { id: `${base.itemId}:a`, title: `${base.itemName} 4K REMUX`, codec: 'h265', sizeGb: 52.6, confidence: 92 },
      { id: `${base.itemId}:b`, title: `${base.itemName} 4K WEB-DL`, codec: 'h265', sizeGb: 24.4, confidence: 81 },
      { id: `${base.itemId}:c`, title: `${base.itemName} 1080p BluRay`, codec: 'h264', sizeGb: 15.3, confidence: 76 },
    ].map((x, i) => ({ ...x, rank: i + 1, score: Math.max(50, x.confidence - (seed % (8 + i))) }));
  }, [infoConfirmTaskId, tasks]);

  useEffect(() => {
    saveTaskQueue(tasks);
  }, [tasks]);

  useEffect(() => {
    const meta = loadManagedItemMeta();
    if (libraryManageItems.length === 0) {
      setManagedItems([]);
      return;
    }
    setManagedItems((prev) => {
      const existing = new Map(prev.map((x) => [x.id, x]));
      return libraryManageItems.map((item, idx) => {
        const old = existing.get(item.id);
        const saved = meta[item.id];
        const inPlayedHistory = playedItems.some((p) => p.id === item.id);
        const durationSec =
          typeof item.durationSec === 'number' && item.durationSec > 0
            ? item.durationSec
            : Math.max(3600, Math.round((item.runTimeTicks ?? 36_000_000_000) / 10_000_000));
        const sizeGb =
          typeof item.sizeGb === 'number' && item.sizeGb > 0
            ? item.sizeGb
            : Number((3.5 + (idx % 7) * 1.9 + (durationSec / 3600) * 1.8).toFixed(1));
        const resolution: ManagedMediaItem['resolution'] =
          item.resolution === '4K' || item.resolution === '1080p' ? item.resolution : idx % 3 === 0 ? '4K' : '1080p';
        const codec: ManagedMediaItem['codec'] =
          item.codec === 'h264' || item.codec === 'h265' || item.codec === 'av1'
            ? item.codec
            : idx % 4 === 0
              ? 'h264'
              : idx % 4 === 1
                ? 'h265'
                : 'av1';
        const sectionName = sectionNameMap.get(item.sectionId);
        const rating = old ? old.rating : saved && 'rating' in saved ? saved.rating ?? null : null;
        const watched =
          old
            ? old.watched
            : saved && typeof saved.watched === 'boolean'
              ? saved.watched
              : typeof item.embyPlayed === 'boolean'
                ? item.embyPlayed
                : inPlayedHistory;
        const isBluRayDisc = item.isBluRayDisc === true;
        const doubanStars = movieDoubanStars(item.name, item.itemType, doubanStarsByNormTitle);
        return {
          id: item.id,
          name: item.name,
          sectionId: item.sectionId,
          sectionName,
          resolution,
          codec,
          durationSec,
          sizeGb,
          isBluRayDisc,
          rating,
          doubanStars,
          watched,
        } satisfies ManagedMediaItem;
      });
    });
  }, [libraryManageItems, playedItems, sectionNameMap, doubanStarsByNormTitle]);

  useEffect(() => {
    if (!batchRunning) return;
    const timer = window.setInterval(() => {
      setTasks((prev) =>
        advanceTaskQueue(
          prev,
          schedulerSettings,
          schedulerSettings.runMode === 'manual' ? { onlyTaskIds: batchRunSelectedIds } : undefined,
        ),
      );
    }, 1500);
    return () => window.clearInterval(timer);
  }, [batchRunning, schedulerSettings, batchRunSelectedIds]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTasks((prev) => refreshWaitingTasks(prev, Date.now(), schedulerSettings));
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, [schedulerSettings]);

  useEffect(() => {
    if (schedulerSettings.runMode !== 'scheduled') return;
    const hasRunnable = tasks.some(
      (t) => t.status === 'queued' || t.status === 'precheck' || t.status === 'executing' || t.status === 'verify' || t.status === 'resume_pending',
    );
    if (!hasRunnable) {
      if (batchRunning) setBatchRunning(false);
      return;
    }
    if (!batchRunning) setBatchRunning(true);
  }, [schedulerSettings.runMode, tasks, batchRunning]);

  const toggleManageSelect = useCallback((itemId: string) => {
    setManageSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  function selectAllManaged() {
    setManageSelectedIds(new Set(managedItemsFiltered.map((x) => x.id)));
  }

  function clearManageSelection() {
    setManageSelectedIds(new Set());
  }

  function resetManageFilters() {
    setManageSearchQuery('');
    setManageBitrateFilter('all');
    setManageResolutionFilter('all');
    setManageCodecFilter('all');
    setManageWatchedFilter('all');
    setManageBluRayFilter('all');
    setError(null);
  }

  function locateFirstManageHit() {
    if (managedItemsFiltered.length === 0) {
      setError('当前搜索与筛选条件下没有可定位的条目。');
      return;
    }
    setError(null);
    const id = managedItemsFiltered[0].id;
    setManageHighlightId(id);
    window.requestAnimationFrame(() => {
      const root = mediaManageTableRef.current;
      const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id.replace(/["\\]/g, '');
      const el = root?.querySelector<HTMLElement>(`[data-manage-item-id="${escaped}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    window.setTimeout(() => setManageHighlightId(null), 2600);
  }

  function applyRatingToSelection(rating: MediaRating | null) {
    if (manageSelectedIds.size === 0) {
      setError('请先勾选要标注的条目。');
      return;
    }
    const patch: Record<string, Partial<ManagedItemMeta>> = {};
    manageSelectedIds.forEach((id) => {
      patch[id] = { rating };
    });
    saveManagedItemMetaPatch(patch);
    setManagedItems((prev) => prev.map((x) => (manageSelectedIds.has(x.id) ? { ...x, rating } : x)));
    setManageRatingOverlay(false);
    clearManageSelection();
    setError(null);
  }

  const setSingleManagedRating = useCallback((it: ManagedMediaItem, rating: MediaRating | null) => {
    saveManagedItemMetaPatch({ [it.id]: { rating } });
    setManagedItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, rating } : x)));
    setError(null);
  }, []);

  const onWatchChangeStable = useCallback((it: ManagedMediaItem, watched: boolean) => {
    void setManagedWatchStateRef.current(it, watched);
  }, []);

  const onEnqueueStable = useCallback((item: ManagedMediaItem, action: MediaAction) => {
    enqueueManagedActionRef.current(item, action);
  }, []);

  const onOpenDeleteExplainStable = useCallback(() => {
    setManageDeleteExplainOpen(true);
  }, []);

  async function batchApplyWatchToSelection(watched: boolean) {
    if (manageSelectedIds.size === 0) {
      setError('请先勾选要批量标注观看状态的条目。');
      return;
    }
    setError(null);
    const targets = managedItems.filter((x) => manageSelectedIds.has(x.id) && x.watched !== watched);
    if (targets.length === 0) {
      setEnqueueHint(`所选条目已全部为「${watched ? '已观看' : '未观看'}」。`);
      window.setTimeout(() => setEnqueueHint(null), 4000);
      return;
    }
    for (const it of targets) {
      await setManagedWatchState(it, watched);
    }
  }

  async function setManagedWatchState(it: ManagedMediaItem, watched: boolean) {
    setError(null);
    if (isConfigReady(config, connected)) {
      try {
        if (watched) {
          await window.embyApi.markPlayed({ config, itemId: it.id });
          const sectionName = it.sectionName ?? sections.find((s) => s.id === it.sectionId)?.name;
          saveLocalMarkedPlayed({
            id: it.id,
            name: it.name,
            type: 'Movie',
            sectionId: it.sectionId,
            sectionName,
            datePlayed: new Date().toISOString(),
          });
        } else {
          await window.embyApi.markUnplayed({ config, itemId: it.id });
          removeLocalMarkedPlayed(it.id);
        }
        await refreshUnplayed();
        void refreshLibraryManageList({ quietIfIncomplete: true });
        void refreshPlayedHistory();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    saveManagedItemMetaPatch({ [it.id]: { watched } });
    setManagedItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, watched } : x)));
  }
  setManagedWatchStateRef.current = setManagedWatchState;

  function enqueueManagedAction(item: ManagedMediaItem, action: MediaAction) {
    if (item.isBluRayDisc && (action === 'transcode' || action === 'upgrade')) {
      setError(
        `「${item.name}」识别为蓝光/原盘（.iso 或含 BDMV 目录），不支持码率优化或洗版入队。请先提取或转封装为普通视频文件后再操作。`,
      );
      return;
    }
    const preview = buildTaskPreview(item, action);
    if (!preview) return;
    setTasks((prev) => {
      if (hasActiveTaskForItem(prev, preview.itemId)) {
        window.setTimeout(() => {
          setError(`无法添加任务：「${item.name}」已有进行中的任务（同视频互斥）。`);
        }, 0);
        return prev;
      }
      const created = enqueueTask(preview, schedulerSettings.runMode);
      window.setTimeout(() => {
        setError(null);
        setEnqueueHint(
          `已提交 1 条：${item.name}（${preview.actionType === 'transcode' ? '码率压缩' : '洗版优化'}）。请到任务中心查看，筛选请选「全部」。`,
        );
        window.setTimeout(() => setEnqueueHint(null), 5000);
      }, 0);
      return [created, ...prev].slice(0, 300);
    });
  }
  enqueueManagedActionRef.current = enqueueManagedAction;

  function enqueueRecommendedBatch() {
    if (manageSelectedIds.size === 0) {
      setError('请先在列表中勾选要批量码率优化的条目。');
      return;
    }
    setError(null);
    setTasks((prev) => {
      const creations: MediaTask[] = [];
      let blocked = 0;
      let skipped = 0;
      let discSkipped = 0;
      for (const item of managedItems) {
        if (!manageSelectedIds.has(item.id)) continue;
        if (item.isBluRayDisc) {
          discSkipped++;
          continue;
        }
        const action = recommendedAction(item, mediaPolicy);
        if (action !== 'transcode' && action !== 'upgrade') {
          skipped++;
          continue;
        }
        const preview = buildTaskPreview(item, action);
        if (!preview) {
          skipped++;
          continue;
        }
        if (hasActiveTaskForItem(prev, preview.itemId) || creations.some((c) => c.itemId === preview.itemId)) {
          blocked++;
          continue;
        }
        creations.push(enqueueTask(preview, schedulerSettings.runMode));
      }

      window.setTimeout(() => {
        if (creations.length === 0) {
          setError(
            blocked > 0
              ? '选中条目均无法入队（可能与进行中任务互斥，或未标注/已达标/删除档）。'
              : discSkipped > 0 && skipped === 0 && blocked === 0
                ? `选中条目中 ${discSkipped} 条为蓝光/原盘（.iso 或 BDMV），不支持入队；其余无需排队。`
                : '选中条目中暂无需要排队的项（可能未标注星级、已达标、为删除档或为蓝光/原盘）。',
          );
          return;
        }
        const msg = [
          `已提交 ${creations.length} 条`,
          discSkipped > 0 ? `跳过 ${discSkipped} 条（蓝光/原盘）` : '',
          skipped > 0 ? `跳过 ${skipped} 条（未标注、已达标或删除档）` : '',
          blocked > 0 ? `互斥跳过 ${blocked} 条` : '',
          '请到任务中心查看，筛选请选「全部」。',
        ]
          .filter(Boolean)
          .join('；');
        setEnqueueHint(msg);
        window.setTimeout(() => setEnqueueHint(null), 8000);
        if (blocked > 0) {
          setError(`部分条目因互斥未入队（共 ${blocked} 条）。`);
        } else {
          setError(null);
        }
      }, 0);

      if (creations.length === 0) return prev;
      return [...creations, ...prev].slice(0, 300);
    });
  }

  function refreshWaitingMediaSourceNow() {
    setTasks((prev) => refreshWaitingTasks(prev, Date.now(), schedulerSettings));
  }

  async function runBatchExecute() {
    if (schedulerSettings.runMode === 'manual' && batchRunSelectedIds.size === 0) {
      setError('手动模式请先勾选要执行的条目。');
      return;
    }
    setError(null);
    const ids = batchRunSelectedIds;
    const nowIso = new Date().toISOString();
    setTasks((prev) =>
      prev.map((t) => {
        if (!ids.has(t.id)) return t;
        if (t.status === 'pending_manual' || t.status === 'paused') {
          return { ...t, status: 'queued', pauseRequested: false, updatedAt: nowIso };
        }
        return t;
      }),
    );
    setBatchRunning(true);
    if (window.embyApi.taskControl) {
      await window.embyApi.taskControl({ action: 'start', settings: schedulerSettings });
    }
  }

  async function markInterruptedAll() {
    setBatchRunning(false);
    setTasks((prev) => applyControl(prev, 'simulateExit'));
    if (window.embyApi.taskControl) {
      await window.embyApi.taskControl({ action: 'simulateExit' });
    }
  }

  async function resumeInterrupted() {
    setTasks((prev) => applyControl(prev, 'resumeInterrupted'));
    if (window.embyApi.taskControl) {
      await window.embyApi.taskControl({ action: 'resumeInterrupted' });
    }
  }

  function injectDebugSeedTasks() {
    const seed = createDebugSeedTasks();
    setTasks((prev) => {
      const rest = prev.filter((t) => !t.id.startsWith('debug-seed:'));
      return [...seed, ...rest].slice(0, 300);
    });
    setError(null);
    setEnqueueHint('已注入模拟任务（id 以 debug-seed: 开头），已持久化到本地队列；筛选请选「全部」查看各状态。');
    window.setTimeout(() => setEnqueueHint(null), 6000);
  }

  function removeTask(taskId: string) {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    if (infoConfirmTaskId === taskId) setInfoConfirmTaskId(null);
    setBatchRunSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
  }

  function approveQualityCandidate(taskId: string, candidateTitle: string) {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        return {
          ...t,
          status: 'queued',
          progress: 0,
          pauseRequested: false,
          updatedAt: new Date().toISOString(),
          retryCount: t.retryCount + 1,
        };
      }),
    );
    setInfoConfirmTaskId(null);
    setError(`已确认候选资源：${candidateTitle}，任务已重新排队。`);
  }

  function rejectCandidateNoMediaSource(taskId: string) {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        return markWaitingMediaSourceRetryWithDelay(t, waitingMediaDelayMs(t.retryCount, schedulerSettings));
      }),
    );
    setInfoConfirmTaskId(null);
    setError(null);
    setEnqueueHint('已标记为暂无合格媒体片源，进入等待重试节奏。');
    window.setTimeout(() => setEnqueueHint(null), 5000);
  }

  function executeTaskRow(taskId: string) {
    const nowIso = new Date().toISOString();
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        if (!canUserExecuteTask(t)) return t;
        return { ...t, status: 'queued', pauseRequested: false, updatedAt: nowIso };
      }),
    );
  }

  function pauseTaskRow(taskId: string) {
    const target = tasks.find((x) => x.id === taskId);
    if (!target) return;
    if (target.status === 'pending_manual') {
      setError('任务尚未启动，无法暂停。');
      return;
    }
    if (!canUserPauseTask(target)) return;
    setError(null);
    const nowIso = new Date().toISOString();
    setTasks((prev) => prev.map((t) => (t.id === taskId ? applyPauseTransition(t, nowIso) : t)));
  }

  function submitWallRatingAfterWatch() {
    if (!wallRatingItem) return;
    const item = wallRatingItem;
    const rating = wallRatingChoice;
    const durationSec = Math.max(3600, Math.round((item.runTimeTicks ?? 36_000_000_000) / 10_000_000));
    const doubanStars = movieDoubanStars(item.name, item.itemType ?? 'Movie', doubanStarsByNormTitle);
    const managed: ManagedMediaItem = {
      id: item.id,
      name: item.name,
      sectionId: item.sectionId,
      sectionName: sectionNameMap.get(item.sectionId),
      resolution: '1080p',
      codec: 'h264',
      durationSec,
      sizeGb: 9.6,
      isBluRayDisc: item.isBluRayDisc === true,
      rating,
      doubanStars,
      watched: true,
    };
    saveManagedItemMetaPatch({ [item.id]: { rating, watched: true } });
    setManagedItems((prev) => {
      const rest = prev.filter((x) => x.id !== item.id);
      return [managed, ...rest];
    });
    if (schedulerSettings.wallRatingAutoEnqueue) {
      if (managed.isBluRayDisc) {
        setEnqueueHint('已保存星级；该条目为蓝光/原盘，不支持自动入队。');
        window.setTimeout(() => setEnqueueHint(null), 6000);
      } else {
        const action = recommendedAction(managed, mediaPolicy);
        const preview = buildTaskPreview(managed, action);
        if (!preview) {
          setEnqueueHint('已保存星级；当前策略下无需自动入队。');
          window.setTimeout(() => setEnqueueHint(null), 5000);
        } else {
          setTasks((prev) => {
            if (hasActiveTaskForItem(prev, preview.itemId)) {
              setEnqueueHint('已保存星级；该条目已有进行中任务，未重复入队。');
              window.setTimeout(() => setEnqueueHint(null), 5000);
              return prev;
            }
            const created = enqueueTask(preview, schedulerSettings.runMode);
            setEnqueueHint(`已保存星级并自动入队：${item.name}。`);
            window.setTimeout(() => setEnqueueHint(null), 6000);
            return [created, ...prev].slice(0, 300);
          });
        }
      }
    } else {
      setEnqueueHint('已保存星级。可在配置中心开启「观看后打分自动入队」以自动创建任务。');
      window.setTimeout(() => setEnqueueHint(null), 6000);
    }
    void refreshLibraryManageList({ quietIfIncomplete: true });
    setWallRatingItem(null);
  }

  async function autoEnterWallIfAvailable() {
    if (!config.baseUrl.trim() || !config.apiKey.trim()) return;
    try {
      const info = await window.embyApi.testConnection({ baseUrl: config.baseUrl, apiKey: config.apiKey });
      if (!info) return;
      setConnected(true);
      if (config.userId && config.enabledSectionIds.length > 0) {
        setPage('wall');
        await refreshUnplayed();
      }
    } catch {
      setConnected(false);
    }
  }

  useEffect(() => {
    void autoEnterWallIfAvailable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (page !== 'history') return;
    if (sections.length > 0 || !config.baseUrl.trim() || !config.apiKey.trim()) return;
    void window.embyApi
      .getMediaFolders({ baseUrl: config.baseUrl.trim(), apiKey: config.apiKey.trim() })
      .then(setSections)
      .catch(() => {});
  }, [page, sections.length, config.baseUrl, config.apiKey]);

  useEffect(() => {
    if (page !== 'history') return;
    void refreshPlayedHistory({ quietIfIncomplete: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, historyDays, historyType, historySectionId]);

  /** 进入海报墙时自动拉未播放列表 */
  useEffect(() => {
    if (page !== 'wall') return;
    if (!hasConfigForLibraryFetch(config)) return;
    void refreshUnplayed({ quietIfIncomplete: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, config.baseUrl, config.apiKey, config.userId, config.enabledSectionIds.join(',')]);

  /** 媒体库管理：不在进入页面时自动请求 Emby（大库切换页会卡）；依赖本地缓存 + 用户手动「刷新媒体库列表」。 */

  useEffect(() => {
    if (page !== 'wall') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (wallRatingItem) {
        if (e.key === 'Escape') setWallRatingItem(null);
        return;
      }
      if (confirm) {
        if (e.key === 'Escape') setConfirm(null);
        return;
      }
      if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        void refreshUnplayed();
        return;
      }
      if (e.key === 'Escape') {
        setFocusedIndex(-1);
        return;
      }
      if (items.length === 0) return;
      const current = focusedIndex >= 0 ? focusedIndex : 0;
      const cols = Math.max(1, Math.floor(window.innerWidth / 220));
      let next = current;
      if (e.key === 'ArrowRight') next = Math.min(items.length - 1, current + 1);
      if (e.key === 'ArrowLeft') next = Math.max(0, current - 1);
      if (e.key === 'ArrowDown') next = Math.min(items.length - 1, current + cols);
      if (e.key === 'ArrowUp') next = Math.max(0, current - cols);
      if (next !== current || focusedIndex === -1) {
        e.preventDefault();
        setFocusedIndex(next);
        return;
      }
      if (e.key === 'Enter' && items[current]) {
        e.preventDefault();
        void onPlay(items[current]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [page, items, focusedIndex, confirm, wallRatingItem]);

  function saveConfig(next: EmbyConfig) {
    setConfig(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function saveEmbyPlayerPage() {
    saveConfig(config);
    setError(null);
  }

  function saveMediaPolicyPage() {
    localStorage.setItem(MEDIA_POLICY_KEY, JSON.stringify(mediaPolicy));
    setError(null);
  }

  function saveSchedulerPage() {
    localStorage.setItem(TASK_SCHEDULER_SETTINGS_KEY, JSON.stringify(schedulerSettings));
    setError(null);
  }

  async function saveDoubanSessionPage() {
    if (!window.doubanApi) {
      setError('豆瓣会话仅能在 Electron 桌面版保存（浏览器调试无此能力）。');
      return;
    }
    setError(null);
    setDoubanSettingsHint(null);
    try {
      await window.doubanApi.saveSession({
        cookieHeader: doubanCookieDraft.trim(),
        userId: doubanUserIdDraft.trim(),
      });
      setDoubanSettingsHint('已写入本机应用数据目录；请勿将 Cookie 分享给他人。');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function syncDoubanRatingsFromWeb() {
    const api = window.doubanApi;
    if (!api) {
      setError('豆瓣同步仅能在 Electron 桌面版使用。');
      return;
    }
    setDoubanSyncBusy(true);
    setError(null);
    setDoubanFetchStatus('连接豆瓣…');
    const unsub = api.onProgress((p) => {
      if (Array.isArray(p.allEntries)) {
        const normalized = wireToDoubanEntries(p.allEntries);
        saveDoubanRatingEntries(normalized);
        setDoubanRatingEntries(normalized);
      }
      if (!p.done) {
        setDoubanFetchStatus(`已抓取 ${p.allEntries?.length ?? 0} 条评分 · 第 ${p.pageIndex + 1} 批（本批 ${p.pageSize} 条）`);
      } else {
        setDoubanFetchStatus(
          p.cancelled
            ? `已停止 · 本地保留 ${p.allEntries?.length ?? 0} 条`
            : `已完成 · 共 ${p.allEntries?.length ?? 0} 条`,
        );
      }
    });
    try {
      const result = await api.fetchRatings();
      if (result?.entries?.length) {
        const normalized = wireToDoubanEntries(result.entries);
        saveDoubanRatingEntries(normalized);
        setDoubanRatingEntries(normalized);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      unsub();
      setDoubanSyncBusy(false);
      window.setTimeout(() => setDoubanFetchStatus(null), 8000);
    }
  }

  function stopDoubanSync() {
    void window.doubanApi?.stopFetch();
  }

  useEffect(() => {
    if (configSection !== 'douban') return;
    const api = window.doubanApi;
    if (!api) return;
    void (async () => {
      try {
        const s = await api.getSession();
        if (s) {
          setDoubanCookieDraft(s.cookieHeader);
          setDoubanUserIdDraft(s.userId);
        }
      } catch {
        // ignore
      }
    })();
  }, [configSection]);

  async function testConnection() {
    if (!config.baseUrl.trim()) {
      setError('请先填写 Emby Base URL。');
      return;
    }
    if (!config.apiKey.trim()) {
      setError('请先填写 API Key。');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await window.embyApi.testConnection({ baseUrl: config.baseUrl.trim(), apiKey: config.apiKey.trim() });
      setConnected(true);
      const list = await window.embyApi.getUsers({ baseUrl: config.baseUrl.trim(), apiKey: config.apiKey.trim() });
      setUsers(list);
    } catch (e) {
      setConnected(false);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

   async function loadUsersAndMediaFolders() {
    if (!config.baseUrl.trim()) {
      setError('请先填写 Emby Base URL。');
      return;
    }
    if (!config.apiKey.trim()) {
      setError('请先填写 API Key。');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await window.embyApi.testConnection({ baseUrl: config.baseUrl.trim(), apiKey: config.apiKey.trim() });
      setConnected(true);
      const baseUrl = config.baseUrl.trim();
      const apiKey = config.apiKey.trim();
      const [userList, folderList] = await Promise.all([
        window.embyApi.getUsers({ baseUrl, apiKey }),
        window.embyApi.getMediaFolders({ baseUrl, apiKey }),
      ]);
      setUsers(userList);
      setSections(folderList);
      setLibraryPanelExpanded(folderList.length > 0);
    } catch (e) {
      setConnected(false);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  /** 拉列表前若尚未标记联通，自动试连（不必先手动点「测试联通」）。 */
  async function ensureConnectedForFetch(): Promise<boolean> {
    if (connected) return true;
    if (!config.baseUrl.trim() || !config.apiKey.trim()) return false;
    try {
      await window.embyApi.testConnection({ baseUrl: config.baseUrl.trim(), apiKey: config.apiKey.trim() });
      setConnected(true);
      return true;
    } catch {
      setConnected(false);
      return false;
    }
  }

  async function refreshUnplayed(options?: { quietIfIncomplete?: boolean }) {
    if (!hasConfigForLibraryFetch(config)) {
      if (!options?.quietIfIncomplete) {
        setError('请先完成并保存：Base URL、API Key、选择用户，并勾选至少一个媒体库，再刷新列表。');
      }
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ok = await ensureConnectedForFetch();
      if (!ok) {
        setError('无法联通 Emby，请检查 Base URL / API Key，或在配置页点击「测试联通」。');
        return;
      }
      const all = await Promise.all(
        config.enabledSectionIds.map((sectionId) => window.embyApi.getUnplayedItems({ config, sectionId })),
      );
      setItems(all.flat());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function refreshLibraryManageList(options?: { quietIfIncomplete?: boolean }) {
    if (!hasConfigForLibraryFetch(config)) {
      if (!options?.quietIfIncomplete) {
        setError('请先完成并保存：Base URL、API Key、选择用户，并勾选至少一个媒体库，再刷新列表。');
      }
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ok = await ensureConnectedForFetch();
      if (!ok) {
        setError('无法联通 Emby，请检查 Base URL / API Key，或在配置页点击「测试联通」。');
        return;
      }
      const list = await window.embyApi.getLibraryItemsForManage({ config });
      setLibraryManageItems(list);
      const at = saveLibraryManageCache(config, list);
      if (at) setLibraryManageCacheSavedAt(at);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function refreshPlayedHistory(options?: { quietIfIncomplete?: boolean }) {
    if (!hasEmbyCoreConfig(config)) {
      if (!options?.quietIfIncomplete) {
        setError('请先完成并保存：Emby Base URL、API Key、用户，并勾选至少一个媒体库，再刷新播放记录。');
      }
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ok = await ensureConnectedForFetch();
      if (!ok) {
        setError('无法联通 Emby，请检查 Base URL / API Key，或在配置页点击「测试联通」。');
        return;
      }
      const data = await window.embyApi.getPlayedItems({
        config,
        days: historyDays,
        type: historyType,
        sectionId: historySectionId.trim() || undefined,
      });
      let merged = mergePlayedHistoryServerWithLocal(data);
      /** 不在此按 sectionId 再滤：Emby 返回的 ParentId 常为季/子文件夹，与库根 id 不一致，会误杀全部记录。 */
      if (historyType !== 'all') merged = merged.filter((x) => x.type === historyType);
      setPlayedItems(merged);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function historyMarkWatched(it: PlayedItem) {
    if (!hasEmbyCoreConfig(config)) return;
    setHistoryActionBusyId(it.id);
    setError(null);
    try {
      await window.embyApi.markPlayed({ config, itemId: it.id });
      const sectionName = it.sectionName ?? sections.find((s) => s.id === it.sectionId)?.name;
      saveLocalMarkedPlayed({
        ...it,
        datePlayed: new Date().toISOString(),
        sectionName: sectionName ?? it.sectionName,
      });
      await refreshPlayedHistory();
      void refreshLibraryManageList({ quietIfIncomplete: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setHistoryActionBusyId(null);
    }
  }

  async function historyMarkUnwatched(it: PlayedItem) {
    if (!hasEmbyCoreConfig(config)) return;
    setHistoryActionBusyId(it.id);
    setError(null);
    try {
      await window.embyApi.markUnplayed({ config, itemId: it.id });
      removeLocalMarkedPlayed(it.id);
      await refreshPlayedHistory();
      void refreshLibraryManageList({ quietIfIncomplete: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setHistoryActionBusyId(null);
    }
  }

  async function onPlay(item: UnplayedItem) {
    try {
      const result = await window.embyApi.launchPlayer({ config, item });
      setActiveSession({ item, startedAtMs: result.sessionStartedAtMs, runtimeSeconds: result.runtimeSeconds });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function computeSessionStats(session: { startedAtMs: number; runtimeSeconds?: number }) {
    const elapsed = Math.max(0, Math.round((Date.now() - session.startedAtMs) / 1000));
    const elapsedMinutes = Math.max(1, Math.round(elapsed / 60));
    if (session.runtimeSeconds && session.runtimeSeconds > 0) {
      return {
        completionPercent: Math.min(100, (elapsed / session.runtimeSeconds) * 100),
        elapsedMinutes,
        runtimeMinutes: Math.max(1, Math.round(session.runtimeSeconds / 60)),
      };
    }
    return {
      completionPercent: elapsed >= config.fallbackMinSeconds ? 100 : 0,
      elapsedMinutes,
      runtimeMinutes: undefined,
    };
  }

  async function onMarkWatchedRequest() {
    if (!activeSession) return;
    const stats = computeSessionStats(activeSession);
    const completionPercent = stats.completionPercent;
    const belowThreshold = completionPercent < config.markPlayedThresholdPercent;
    setConfirm({
      item: activeSession.item,
      completionPercent,
      belowThreshold,
      elapsedMinutes: stats.elapsedMinutes,
      runtimeMinutes: stats.runtimeMinutes,
    });
  }

  function onMarkUnwatched() {
    setActiveSession(null);
    setConfirm(null);
    setError('已保留为未看完，未执行回写。');
  }

  function addLocalPlayedHistory(item: UnplayedItem) {
    const nowIso = new Date().toISOString();
    const sectionName = sections.find((s) => s.id === item.sectionId)?.name;
    const optimistic: PlayedItem = {
      id: item.id,
      name: item.name,
      sectionId: item.sectionId,
      sectionName,
      datePlayed: nowIso,
      type: 'Movie',
    };
    saveLocalMarkedPlayed(optimistic);
    setPlayedItems((prev) => {
      const withoutDup = prev.filter((x) => x.id !== optimistic.id);
      return [optimistic, ...withoutDup].slice(0, 300);
    });
  }

  if (page === 'config') {
    const configSidebar = (
      <>
        <div className="sidebarHeading">配置分区</div>
        <div className="sidebarNavStack">
          {(
            [
              ['emby', 'Emby 与播放器'] as const,
              ['policy', '码率策略'] as const,
              ['scheduler', '任务调度与补源'] as const,
              ['douban', '豆瓣个人评分（实验）'] as const,
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`sidebarNavBtn${configSection === id ? ' sidebarNavBtnActive' : ''}`}
              onClick={() => setConfigSection(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="sidebarHint">
          各分区需在页面内点击对应「保存」后写入本地存储。进入海报墙请使用顶部导航。Emby 页请先填写 URL 与 API Key，再点击「获取媒体库及用户列表」。
        </p>
      </>
    );

    return (
      <AppShell page={page} setPage={setPage} sidebar={configSidebar} error={error}>
        <div className="panel">
          {configSection === 'emby' ? (
            <>
              <h3>Emby 服务器</h3>
              <p className="hint">流程：填写 URL 与 API Key → 获取用户与媒体库列表 → 选择用户 → 展开并勾选媒体库。</p>
              <div className="row">
                <div className="field">
                  <div className="label">Emby Base URL</div>
                  <input value={config.baseUrl} onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })} />
                </div>
                <div className="field">
                  <div className="label">API Key</div>
                  <input value={config.apiKey} onChange={(e) => setConfig({ ...config, apiKey: e.target.value })} />
                </div>
              </div>
              <div className="actions">
                <button type="button" className="primary" onClick={() => void loadUsersAndMediaFolders()} disabled={loading}>
                  {loading ? '获取中...' : '获取媒体库及用户列表'}
                </button>
              </div>

              {users.length > 0 ? (
                <>
                  <h3 className="configSubSectionTitle">选择用户</h3>
                  <p className="hint">请先在上方列表中选择当前要使用的 Emby 用户，再展开下方选择媒体库。</p>
                  <div className="sectionList">
                    {users.map((u) => (
                      <label key={u.id} className="sectionItem">
                        <input
                          type="radio"
                          checked={config.userId === u.id}
                          onChange={() => setConfig({ ...config, userId: u.id })}
                        />
                        <span>{u.name}</span>
                        <span style={{ marginLeft: 'auto', opacity: 0.6 }}>{u.id}</span>
                      </label>
                    ))}
                  </div>
                </>
              ) : (
                <p className="hint" style={{ marginTop: 12 }}>
                  尚未加载用户列表。请填写 URL 与 API Key 后点击「获取媒体库及用户列表」。
                </p>
              )}

              <details
                className="configFoldable"
                open={libraryPanelExpanded}
                onToggle={(e) => setLibraryPanelExpanded((e.target as HTMLDetailsElement).open)}
              >
                <summary>
                  选择媒体库
                  {sections.length > 0 ? `（${sections.length} 个，已选 ${config.enabledSectionIds.length}）` : '（请先获取列表）'}
                </summary>
                <div style={{ marginTop: 12 }}>
                  {sections.length > 0 ? (
                    <div className="sectionList">
                      {sections.map((s) => (
                        <label key={s.id} className="sectionItem">
                          <input
                            type="checkbox"
                            checked={enabledSet.has(s.id)}
                            onChange={(e) => {
                              const next = new Set(config.enabledSectionIds);
                              if (e.target.checked) next.add(s.id);
                              else next.delete(s.id);
                              setConfig({ ...config, enabledSectionIds: Array.from(next) });
                            }}
                          />
                          <span>{s.name}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="hint">获取用户与媒体库成功后，将在此列出可选媒体库。</p>
                  )}
                </div>
              </details>

              <h3 className="configSubSectionTitle">播放器与播放阈值</h3>
              <div className="row">
                <div className="field">
                  <div className="label">播放器路径</div>
                  <input
                    value={config.playerExePath}
                    onChange={(e) => setConfig({ ...config, playerExePath: e.target.value })}
                  />
                </div>
                <div className="field">
                  <div className="label">启动参数模板</div>
                  <input
                    value={config.argsTemplate}
                    onChange={(e) => setConfig({ ...config, argsTemplate: e.target.value })}
                    placeholder='例如："{path}" /new'
                  />
                </div>
              </div>
              <div className="row">
                <div className="field">
                  <div className="label">已播放阈值(%)</div>
                  <input
                    type="number"
                    value={config.markPlayedThresholdPercent}
                    onChange={(e) =>
                      setConfig({ ...config, markPlayedThresholdPercent: Number(e.target.value) || 90 })
                    }
                  />
                </div>
                <div className="field">
                  <div className="label">无片长时视为已看完(秒)</div>
                  <input
                    type="number"
                    min={0}
                    value={config.fallbackMinSeconds}
                    onChange={(e) =>
                      setConfig({ ...config, fallbackMinSeconds: Math.max(0, Number(e.target.value) || 0) })
                    }
                  />
                </div>
              </div>

              <h3 className="configSubSectionTitle">路径映射</h3>
              <p className="hint">可选。将 Emby 返回的路径前缀替换为本地可播放路径。</p>
              <div className="row">
                <div className="field">
                  <div className="label">路径映射 From（可选）</div>
                  <input
                    value={config.pathMapFrom}
                    onChange={(e) => setConfig({ ...config, pathMapFrom: e.target.value })}
                    placeholder={'例如：D:\\Media 或 /mnt/media'}
                  />
                </div>
                <div className="field">
                  <div className="label">路径映射 To（可选）</div>
                  <input
                    value={config.pathMapTo}
                    onChange={(e) => setConfig({ ...config, pathMapTo: e.target.value })}
                    placeholder={'例如：\\\\192.168.12.45\\Media'}
                  />
                </div>
              </div>

              <div className="actions">
                <button type="button" className="primary" onClick={() => saveEmbyPlayerPage()}>
                  保存本页（Emby / 播放器 / 阈值 / 路径映射）
                </button>
              </div>
            </>
          ) : null}

          {configSection === 'policy' ? (
            <>
              <h3>目标码率策略（H265 等效）</h3>
              <p className="hint">用于媒体库管理与任务预览；编辑后请点击下方保存写入本地。</p>
              <h4 style={{ marginTop: 16, marginBottom: 8 }}>1080p</h4>
              <div className="row">
                {([2, 3] as const).map((r) => (
                  <div className="field" key={`1080-${r}`}>
                    <div className="label">{r} 星 (Mbps)</div>
                    <input
                      type="number"
                      value={mediaPolicy.target1080p[r]}
                      onChange={(e) =>
                        setMediaPolicy((p) => ({
                          ...p,
                          target1080p: { ...p.target1080p, [r]: Number(e.target.value) || p.target1080p[r] },
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
              <div className="row">
                {([4, 5] as const).map((r) => (
                  <div className="field" key={`1080-${r}`}>
                    <div className="label">{r} 星 (Mbps)</div>
                    <input
                      type="number"
                      value={mediaPolicy.target1080p[r]}
                      onChange={(e) =>
                        setMediaPolicy((p) => ({
                          ...p,
                          target1080p: { ...p.target1080p, [r]: Number(e.target.value) || p.target1080p[r] },
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
              <h4 style={{ marginTop: 16, marginBottom: 8 }}>4K</h4>
              <div className="row">
                {([2, 3] as const).map((r) => (
                  <div className="field" key={`4k-${r}`}>
                    <div className="label">{r} 星 (Mbps)</div>
                    <input
                      type="number"
                      value={mediaPolicy.target4k[r]}
                      onChange={(e) =>
                        setMediaPolicy((p) => ({
                          ...p,
                          target4k: { ...p.target4k, [r]: Number(e.target.value) || p.target4k[r] },
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
              <div className="row">
                {([4, 5] as const).map((r) => (
                  <div className="field" key={`4k-${r}`}>
                    <div className="label">{r} 星 (Mbps)</div>
                    <input
                      type="number"
                      value={mediaPolicy.target4k[r]}
                      onChange={(e) =>
                        setMediaPolicy((p) => ({
                          ...p,
                          target4k: { ...p.target4k, [r]: Number(e.target.value) || p.target4k[r] },
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
              <div className="actions">
                <button type="button" className="primary" onClick={() => saveMediaPolicyPage()}>
                  保存码率策略
                </button>
              </div>
            </>
          ) : null}

          {configSection === 'scheduler' ? (
            <>
              <h3>任务调度与补源刷新</h3>
              <p className="hint">与任务模拟、waiting_media_source 重试节奏一致；编辑后请点击下方保存写入本地。</p>
              <div className="row" style={{ marginTop: 12 }}>
                <div className="field">
                  <div className="label">执行模式</div>
                  <select
                    value={schedulerSettings.runMode}
                    onChange={(e) =>
                      setSchedulerSettings((prev) => ({
                        ...prev,
                        runMode: e.target.value === 'scheduled' ? 'scheduled' : 'manual',
                      }))
                    }
                    className="selectLike"
                  >
                    <option value="manual">手动（新任务待启动）</option>
                    <option value="scheduled">自动（新任务排队中）</option>
                  </select>
                </div>
                <label className="sectionItem" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                  <input
                    type="checkbox"
                    checked={schedulerSettings.wallRatingAutoEnqueue}
                    onChange={(e) =>
                      setSchedulerSettings((p) => ({ ...p, wallRatingAutoEnqueue: e.target.checked }))
                    }
                  />
                  <span>海报墙：已观看并打完分后自动按策略入队</span>
                </label>
                <div className="field">
                  <div className="label">压缩并发</div>
                  <input
                    type="number"
                    min={1}
                    value={schedulerSettings.transcodeConcurrency}
                    onChange={(e) =>
                      setSchedulerSettings((prev) => ({
                        ...prev,
                        transcodeConcurrency: Math.max(1, Number(e.target.value) || 1),
                      }))
                    }
                  />
                </div>
              </div>
              <div className="row">
                <div className="field">
                  <div className="label">补源并发</div>
                  <input
                    type="number"
                    min={1}
                    value={schedulerSettings.upgradeConcurrency}
                    onChange={(e) =>
                      setSchedulerSettings((prev) => ({
                        ...prev,
                        upgradeConcurrency: Math.max(1, Number(e.target.value) || 1),
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <div className="label">补源快速重搜次数</div>
                  <input
                    type="number"
                    min={1}
                    value={schedulerSettings.waitingFastRetryCount}
                    onChange={(e) =>
                      setSchedulerSettings((prev) => ({
                        ...prev,
                        waitingFastRetryCount: Math.max(1, Number(e.target.value) || 1),
                      }))
                    }
                  />
                </div>
              </div>
              <div className="row">
                <div className="field">
                  <div className="label">快速重搜间隔(小时)</div>
                  <input
                    type="number"
                    min={1}
                    value={schedulerSettings.waitingFastIntervalHours}
                    onChange={(e) =>
                      setSchedulerSettings((prev) => ({
                        ...prev,
                        waitingFastIntervalHours: Math.max(1, Number(e.target.value) || 1),
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <div className="label">补源中速上限次数</div>
                  <input
                    type="number"
                    min={2}
                    value={schedulerSettings.waitingMidRetryCount}
                    onChange={(e) =>
                      setSchedulerSettings((prev) => ({
                        ...prev,
                        waitingMidRetryCount: Math.max(
                          prev.waitingFastRetryCount + 1,
                          Number(e.target.value) || prev.waitingFastRetryCount + 1,
                        ),
                      }))
                    }
                  />
                </div>
              </div>
              <div className="row">
                <div className="field">
                  <div className="label">中速间隔(天)</div>
                  <input
                    type="number"
                    min={1}
                    value={schedulerSettings.waitingMidIntervalDays}
                    onChange={(e) =>
                      setSchedulerSettings((prev) => ({
                        ...prev,
                        waitingMidIntervalDays: Math.max(1, Number(e.target.value) || 1),
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <div className="label">慢速间隔(天)</div>
                  <input
                    type="number"
                    min={1}
                    value={schedulerSettings.waitingSlowIntervalDays}
                    onChange={(e) =>
                      setSchedulerSettings((prev) => ({
                        ...prev,
                        waitingSlowIntervalDays: Math.max(1, Number(e.target.value) || 1),
                      }))
                    }
                  />
                </div>
              </div>
              <div className="actions">
                <button type="button" className="primary" onClick={() => saveSchedulerPage()}>
                  保存任务调度设置
                </button>
              </div>
            </>
          ) : null}

          {configSection === 'douban' ? (
            <>
              <h3>豆瓣个人评分同步（实验）</h3>
              <p className="hint" style={{ lineHeight: 1.55 }}>
                从豆瓣电影「我看过的评分」列表抓取<strong>你本人账号</strong>的打分，写入本机后与媒体库列表中的<strong>电影</strong>片名匹配（剔除标点后严格相等）。自动化访问可能违反豆瓣服务条款，请自担风险并控制频率；翻页间隔约 1.2 秒。Cookie 仅保存在本机应用数据目录。
              </p>
              {doubanSettingsHint ? (
                <p className="hint" style={{ color: '#86efac' }}>
                  {doubanSettingsHint}
                </p>
              ) : null}
              <div className="field" style={{ marginTop: 16 }}>
                <div className="label">豆瓣用户 ID（电影「看过」页 URL 中 people/ 与 /collect 之间）</div>
                <input
                  value={doubanUserIdDraft}
                  onChange={(e) => setDoubanUserIdDraft(e.target.value)}
                  placeholder="多为纯数字，例如3235934；与浏览器地址栏一致"
                  autoComplete="off"
                />
              </div>
              <div className="field" style={{ marginTop: 12 }}>
                <div className="label">Cookie（整段请求头内容）</div>
                <textarea
                  value={doubanCookieDraft}
                  onChange={(e) => setDoubanCookieDraft(e.target.value)}
                  placeholder="从浏览器复制的 Cookie 字符串"
                  rows={5}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
                  autoComplete="off"
                />
              </div>
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  disabled={!window.doubanApi}
                  onClick={() => void saveDoubanSessionPage()}
                >
                  保存豆瓣会话到本机
                </button>
              </div>
              {!window.doubanApi ? (
                <p className="hint">当前为浏览器预览模式，无法保存会话；请运行 Electron 桌面版。</p>
              ) : null}
            </>
          ) : null}
        </div>
      </AppShell>
    );
  }

  if (page === 'history') {
    const historySidebar = (
      <>
        <div className="sidebarHeading">播放记录</div>
        <p className="sidebarHint">筛选与时间范围应用于下方列表。</p>
        <div className="sidebarField">
          <div className="label">时间范围</div>
          <select
            value={historyDays}
            onChange={(e) => setHistoryDays(Number(e.target.value) as 7 | 30 | 0)}
            className="selectLike sidebarFullWidth"
          >
            <option value={7}>最近 7 天</option>
            <option value={30}>最近 30 天</option>
            <option value={0}>全部</option>
          </select>
        </div>
        <div className="sidebarField">
          <div className="label">类型</div>
          <select
            value={historyType}
            onChange={(e) => setHistoryType(e.target.value as 'all' | 'Movie' | 'Episode')}
            className="selectLike sidebarFullWidth"
          >
            <option value="all">全部类型</option>
            <option value="Movie">电影</option>
            <option value="Episode">剧集</option>
          </select>
        </div>
        <div className="sidebarField">
          <div className="label">媒体库</div>
          <select
            value={historySectionId}
            onChange={(e) => setHistorySectionId(e.target.value)}
            className="selectLike sidebarFullWidth"
            title="按已配置的媒体库筛选"
          >
            <option value="">全部媒体库</option>
            {sections
              .filter((s) => enabledSet.has(s.id))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </div>
        <button type="button" className="primary sidebarFullWidth" onClick={() => void refreshPlayedHistory()}>
          {loading ? '刷新中...' : '刷新记录'}
        </button>
      </>
    );

    const canReplay = !!config.playerExePath.trim();

    return (
      <AppShell page={page} setPage={setPage} sidebar={historySidebar} error={error}>
        <div className="panel">
          <div className="hint" style={{ marginBottom: 8 }}>
            展示当前 Emby 用户在已选媒体库中的已播放影片/剧集；可与服务器同步观看状态。「重新播放」需配置播放器路径。
          </div>
          {playedItems.length === 0 ? (
            <div className="hint">暂无播放记录。请确认已保存 Emby 配置并勾选媒体库，或调整左侧时间范围后刷新。</div>
          ) : (
            <div className="historyList">
              {playedItems.map((it) => {
                const sectionLabel =
                  it.sectionName?.trim() ||
                  (it.sectionId ? sectionNameMap.get(it.sectionId) : undefined) ||
                  '—';
                const episodeLine =
                  it.type === 'Episode'
                    ? [it.seriesName, it.indexLabel].filter(Boolean).join(' · ') || null
                    : null;
                return (
                  <div key={it.id} className="historyItem">
                    <img
                      className="historyPoster"
                      src={buildPosterUrl(config, it, 120)}
                      alt=""
                      loading="lazy"
                    />
                    <div className="historyItemBody">
                      <div className="historyItemTitle">{it.name}</div>
                      <div className="historyItemMeta">
                        <span>{playedTypeLabel(it.type)}</span>
                        <span className="historyMetaSep">·</span>
                        <span title="媒体库">{sectionLabel}</span>
                        {episodeLine ? (
                          <>
                            <span className="historyMetaSep">·</span>
                            <span>{episodeLine}</span>
                          </>
                        ) : null}
                        <span className="historyMetaSep">·</span>
                        <span className="tabular-nums">{formatPlayedAt(it.datePlayed)}</span>
                      </div>
                    </div>
                    <div className="historyRowActions">
                      <button
                        type="button"
                        disabled={loading || historyActionBusyId === it.id}
                        onClick={() => void historyMarkWatched(it)}
                      >
                        标记为已观看
                      </button>
                      <button
                        type="button"
                        disabled={loading || historyActionBusyId === it.id}
                        onClick={() => void historyMarkUnwatched(it)}
                      >
                        标记为未观看
                      </button>
                      <button
                        type="button"
                        disabled={loading || historyActionBusyId === it.id || !canReplay}
                        title={canReplay ? undefined : '请先在配置中心填写第三方播放器可执行文件路径'}
                        onClick={async () => {
                          const item =
                            items.find((x) => x.id === it.id) ??
                            ({
                              id: it.id,
                              name: it.name,
                              posterTag: it.posterTag,
                              sectionId: it.sectionId ?? config.enabledSectionIds[0] ?? '',
                            } as UnplayedItem);
                          await onPlay(item);
                        }}
                      >
                        重新播放
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </AppShell>
    );
  }

  if (page === 'mediaManage') {
    const mediaSidebar = (
      <>
        <div className="sidebarHeading">媒体库管理</div>
        <div className="sidebarMuted">搜索与筛选</div>
        <div className="sidebarField">
          <div className="label">片名关键字</div>
          <input
            value={manageSearchQuery}
            onChange={(e) => setManageSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                locateFirstManageHit();
              }
            }}
            placeholder="支持部分匹配"
            aria-label="按片名搜索"
          />
        </div>
        <button type="button" className="sidebarFullWidth" onClick={() => locateFirstManageHit()}>
          定位到首条结果
        </button>
        <div className="sidebarField">
          <div className="label">码率相对目标</div>
          <select
            className="selectLike sidebarFullWidth"
            value={manageBitrateFilter}
            onChange={(e) => setManageBitrateFilter(e.target.value as ManageBitrateFilterKey)}
            aria-label="按码率策略筛选"
          >
            <option value="all">全部</option>
            <option value="transcode">偏高 · 需压缩</option>
            <option value="upgrade">偏低 · 需洗版</option>
            <option value="keep">已达标（已标星级）</option>
            <option value="no_rating">未标注星级</option>
            <option value="delete">删除档（1 星）</option>
          </select>
        </div>
        <div className="sidebarField">
          <div className="label">分辨率</div>
          <select
            className="selectLike sidebarFullWidth"
            value={manageResolutionFilter}
            onChange={(e) => setManageResolutionFilter(e.target.value as ManageResolutionFilterKey)}
          >
            <option value="all">全部</option>
            <option value="1080p">1080p</option>
            <option value="4K">4K</option>
          </select>
        </div>
        <div className="sidebarField">
          <div className="label">视频编码</div>
          <select
            className="selectLike sidebarFullWidth"
            value={manageCodecFilter}
            onChange={(e) => setManageCodecFilter(e.target.value as ManageCodecFilterKey)}
          >
            <option value="all">全部</option>
            <option value="h264">H.264</option>
            <option value="h265">H.265 / HEVC</option>
            <option value="av1">AV1</option>
          </select>
        </div>
        <div className="sidebarField">
          <div className="label">播放记录</div>
          <select
            className="selectLike sidebarFullWidth"
            value={manageWatchedFilter}
            onChange={(e) => setManageWatchedFilter(e.target.value as ManageWatchedFilterKey)}
          >
            <option value="all">全部</option>
            <option value="watched">已观看</option>
            <option value="unwatched">未观看</option>
          </select>
        </div>
        <div className="sidebarField">
          <div className="label">蓝光原盘</div>
          <select
            className="selectLike sidebarFullWidth"
            value={manageBluRayFilter}
            onChange={(e) => setManageBluRayFilter(e.target.value as ManageBluRayFilterKey)}
            aria-label="按是否为蓝光原盘筛选"
          >
            <option value="all">全部</option>
            <option value="disc">仅原盘（ISO / BDMV）</option>
            <option value="not_disc">非原盘</option>
          </select>
        </div>
        <button type="button" className="sidebarFullWidth" onClick={() => resetManageFilters()}>
          重置搜索与筛选
        </button>
        <p className="sidebarHint">列表随输入实时过滤；「定位」滚动到当前结果第一项并短暂高亮。</p>
        <div className="sidebarDivider" />
        <div className="sidebarMuted">豆瓣评分（实验）</div>
        <p className="sidebarHint">
          在配置中心保存 Cookie 与用户 ID 后同步。豆瓣标题多为「中文 / 英文 / 别名」，已按斜杠分段分别匹配；剔除标点后<strong>严格相等</strong>。仅统计<strong>电影</strong>行。
        </p>
        <div className="sidebarStat" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {libraryManageCapacity.movieCount === 0
            ? '— / —（请先刷新媒体库列表）'
            : `${doubanMovieMatchStats.matched} / ${doubanMovieMatchStats.total}（已匹配电影 / 总电影数）`}
        </div>
        {doubanFetchStatus ? (
          <p className="sidebarHint" style={{ marginTop: 6, marginBottom: 0, color: '#93c5fd' }}>
            {doubanFetchStatus}
          </p>
        ) : null}
        <div className="sidebarButtonRow" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="sidebarFullWidth"
            style={{ flex: 1 }}
            disabled={doubanSyncBusy || !window.doubanApi}
            onClick={() => void syncDoubanRatingsFromWeb()}
          >
            {doubanSyncBusy ? '同步中…' : '同步豆瓣评分'}
          </button>
        </div>
        <button
          type="button"
          className="sidebarFullWidth"
          disabled={!doubanSyncBusy || !window.doubanApi}
          onClick={() => stopDoubanSync()}
        >
          停止抓取
        </button>
        <div className="sidebarDivider" />
        <div className="sidebarMuted">批量操作</div>
        <p className="sidebarHint">以下仅对列表中勾选的条目生效。码率策略与任务调度在「配置中心」。</p>
        <div className="sidebarStat">已选 {manageSelectedIds.size} 条</div>
        <div className="sidebarButtonRow">
          <button type="button" onClick={() => selectAllManaged()}>
            全选
          </button>
          <button type="button" onClick={() => clearManageSelection()} disabled={manageSelectedIds.size === 0}>
            取消选择
          </button>
        </div>
        <div className="sidebarDivider" />
        <button
          type="button"
          className="sidebarFullWidth"
          disabled={manageSelectedIds.size === 0}
          onClick={() => {
            setManagePendingRating(3);
            setManageRatingOverlay(true);
          }}
        >
          批量标注星级
        </button>
        <button
          type="button"
          className="sidebarFullWidth"
          disabled={manageSelectedIds.size === 0}
          onClick={() => void batchApplyWatchToSelection(true)}
        >
          批量标为已观看
        </button>
        <button
          type="button"
          className="sidebarFullWidth"
          disabled={manageSelectedIds.size === 0}
          onClick={() => void batchApplyWatchToSelection(false)}
        >
          批量标为未观看
        </button>
        <button
          type="button"
          className="primary sidebarFullWidth"
          disabled={manageSelectedIds.size === 0}
          onClick={() => enqueueRecommendedBatch()}
          title="对勾选条目按策略批量提交码率优化（仅包含需码率压缩或洗版优化的项）"
        >
          批量码率优化
        </button>
        <div className="sidebarDivider" />
        <button
          type="button"
          className="sidebarFullWidth"
          disabled={loading || !hasConfigForLibraryFetch(config)}
          onClick={() => void refreshLibraryManageList()}
        >
          {loading ? '刷新中…' : '刷新媒体库列表'}
        </button>
        <p className="sidebarHint" style={{ marginTop: 8, marginBottom: 0 }}>
          {libraryManageCacheSavedAt
            ? `本地列表已缓存（${formatPlayedAt(libraryManageCacheSavedAt)}）。重启或从其它页进入本页不会自动请求 Emby；需与服务器一致时请点上方「刷新媒体库列表」。`
            : '尚无本地列表缓存：请点击「刷新媒体库列表」从 Emby 拉取并写入本机（结构化 JSON，存于浏览器 localStorage）。'}
        </p>
        <div className="sidebarField" style={{ marginTop: 10 }}>
          <div className="label">当前媒体库容量（估算）</div>
          <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {libraryManageCapacity.count === 0 ? '—' : formatAggregateLibrarySizeGb(libraryManageCapacity.totalGb)}
          </div>
          <div className="label" style={{ marginTop: 12 }}>总电影数</div>
          <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {libraryManageCapacity.count === 0 ? '—' : libraryManageCapacity.movieCount}
          </div>
          <p className="sidebarHint" style={{ marginTop: 6, marginBottom: 0 }}>
            {libraryManageCapacity.count === 0
              ? '刷新列表后，将汇总已启用库内全部条目的文件体积与类型。'
              : `共 ${libraryManageCapacity.count} 条（电影 ${libraryManageCapacity.movieCount}，剧集单集 ${libraryManageCapacity.episodeCount}${
                  libraryManageCapacity.otherCount > 0 ? `，其它 ${libraryManageCapacity.otherCount}` : ''
                }）；与上方刷新同步更新。`}
          </p>
        </div>
        <p className="sidebarHint">
          列表覆盖<strong>已启用媒体库</strong>内的电影/剧集，<strong>含已观看</strong>；与海报墙「仅未播放」不同。展示数据来自本地缓存；与 Emby 对齐须主动点侧栏「刷新媒体库列表」（进入本页不会自动拉取）。
        </p>
        <p className="sidebarHint">目标码率梯度以配置中心<strong>媒体策略</strong>为准；单条目策略覆盖本版未实现。</p>
      </>
    );

    return (
      <>
      <AppShell page={page} setPage={setPage} sidebar={mediaSidebar} error={error}>
        <div className="panel">
          <div className="hint">
            执行转码/洗版在任务中心操作。当前任务池：共 {taskSummary.total} 条，排队 {taskSummary.queued}，执行中 {taskSummary.running}。
            {managedItems.length > 0 ? (
              <>
                {' '}
                列表显示 {managedItemsFiltered.length} / {managedItems.length} 条（受侧栏搜索与筛选影响）。
              </>
            ) : null}
          </div>
          {enqueueHint ? (
            <div className="hint" style={{ marginTop: 8, color: '#86efac' }}>
              {enqueueHint}
            </div>
          ) : null}
          {managedItems.length === 0 ? (
            <div className="hint" style={{ marginTop: 12 }}>
              暂无可管理条目。请在配置中心勾选媒体库并保存，再点侧栏「刷新媒体库列表」。
            </div>
          ) : managedItemsFiltered.length === 0 ? (
            <div className="hint" style={{ marginTop: 12 }}>
              当前搜索与筛选条件下没有条目。请调整侧栏条件或点击「重置搜索与筛选」。
            </div>
          ) : (
            <>
              <div className="mediaManageTable" ref={mediaManageTableRef}>
                <div className="mediaManageGrid mediaManageHead" aria-hidden>
                  <div>条目</div>
                  <div>体积</div>
                  <div>原盘</div>
                  <div>当前码率</div>
                  <div>目标码率</div>
                  <div>视频格式</div>
                  <div>星级</div>
                  <div>豆瓣</div>
                  <div>播放</div>
                  <div>任务</div>
                  <div>操作</div>
                </div>
                {managedItemsFiltered.map((it) => (
                  <MediaLibraryManageRow
                    key={it.id}
                    item={it}
                    isSelected={manageSelectedIds.has(it.id)}
                    isHighlighted={manageHighlightId === it.id}
                    mediaPolicy={mediaPolicy}
                    rowTask={activeTaskByItemId.get(it.id)}
                    onToggleSelect={toggleManageSelect}
                    onWatchChange={onWatchChangeStable}
                    onRatingChange={setSingleManagedRating}
                    onEnqueue={onEnqueueStable}
                    onOpenDeleteExplain={onOpenDeleteExplainStable}
                  />
                ))}
              </div>
            </>
            )}
        </div>
      </AppShell>
      {manageRatingOverlay ? (
        <div className="overlay">
          <div className="overlayBox">
            <div style={{ fontWeight: 800 }}>批量标注星级</div>
            <div className="hint" style={{ marginTop: 8 }}>
              将应用到已勾选 {manageSelectedIds.size} 条；未勾选条目不会变更。
            </div>
            <div className="actions" style={{ marginTop: 12, flexWrap: 'wrap' }}>
              {([1, 2, 3, 4, 5] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={managePendingRating === s ? 'primary' : ''}
                  onClick={() => setManagePendingRating(s)}
                >
                  {s} 星
                </button>
              ))}
            </div>
            <div className="actions">
              <button type="button" onClick={() => applyRatingToSelection(null)}>
                清除标注
              </button>
              <button
                type="button"
                className="primary"
                disabled={managePendingRating == null}
                onClick={() => applyRatingToSelection(managePendingRating as MediaRating)}
              >
                确定
              </button>
              <button
                type="button"
                onClick={() => {
                  setManageRatingOverlay(false);
                }}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {manageDeleteExplainOpen ? (
        <div className="overlay">
          <div className="overlayBox">
            <div style={{ fontWeight: 800 }}>1 星 · 删除档说明</div>
            <p className="hint" style={{ marginTop: 10, lineHeight: 1.55 }}>
              产品定义：1 星表示计划从库中移除该片，正式流程将包含<strong>回收站/二次确认</strong>等受控删除步骤，且不会在未确认时自动物理删文件。
            </p>
            <p className="hint" style={{ lineHeight: 1.55 }}>
              <strong>当前 MVP</strong>仅将条目标为「删除档」策略，<strong>不会</strong>入队转码/洗版，也<strong>不会</strong>调用删除接口；后续版本再接入完整删除与审计。
            </p>
            <div className="actions" style={{ marginTop: 14 }}>
              <button type="button" className="primary" onClick={() => setManageDeleteExplainOpen(false)}>
                已知悉
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
    );
  }

  if (page === 'taskCenter') {
    const taskSidebar = (
      <>
        <div className="sidebarHeading">任务中心</div>
        <p className="sidebarHint">执行模式、并发、补源节奏与海报墙自动入队在「配置中心 → 任务调度与补源」。</p>
        <p className="sidebarHint">
          <strong>手动模式</strong>：先勾选「参与手动批量」；点侧栏<strong>批量执行</strong>将对勾选中的<strong>待启动 / 已暂停</strong>发令（→排队中）并启动调度计时；占槽中点<strong>暂停</strong>为软停（本步收尾后再暂停）。
        </p>
        <p className="sidebarHint">
          <strong>自动模式</strong>：新任务入队即为排队中；<strong>批量执行</strong>可对勾选条目做同上发令，并启动/保持调度计时。
        </p>
        <div className="sidebarStat">
          批量勾选 {batchRunSelectedIds.size} · 已暂停 {taskSummary.paused}
        </div>
        <button type="button" className="sidebarFullWidth" onClick={() => selectAllBatchInCurrentFilter()}>
          全选可勾选（当前筛选）
        </button>
        <button type="button" className="sidebarFullWidth" onClick={() => clearBatchRunSelection()}>
          取消全选
        </button>
        <button type="button" className="sidebarFullWidth" onClick={() => batchRemoveSelected()} disabled={batchRunSelectedIds.size === 0}>
          批量移除
        </button>
        <button type="button" className="sidebarFullWidth" onClick={() => batchPauseSelected()} disabled={batchRunSelectedIds.size === 0}>
          批量暂停
        </button>
        <button
          type="button"
          className="primary sidebarFullWidth"
          onClick={() => void runBatchExecute()}
          disabled={
            batchRunning || (schedulerSettings.runMode === 'manual' && batchRunSelectedIds.size === 0)
          }
        >
          {batchRunning ? '调度运行中…' : '批量执行'}
        </button>
        <div className="sidebarDivider" />
        <div className="sidebarMuted">辅助（非 §11.2 必选）</div>
        <button type="button" className="sidebarFullWidth" onClick={() => clearAllPausedToQueued()} disabled={taskSummary.paused === 0}>
          全部已暂停 → 排队中
        </button>
        <button type="button" className="sidebarFullWidth" onClick={() => refreshWaitingMediaSourceNow()}>
          刷新等待媒体片源（到期回排队）
        </button>
        <div className="sidebarDivider" />
        <div className="sidebarMuted">开发用 / 模拟</div>
        <button type="button" className="primary sidebarFullWidth" onClick={() => injectDebugSeedTasks()}>
          注入模拟任务
        </button>
        <button type="button" className="sidebarFullWidth" onClick={() => void markInterruptedAll()}>
          模拟显式退出
        </button>
        <button type="button" className="sidebarFullWidth" onClick={() => void resumeInterrupted()}>
          恢复中断任务
        </button>
        <div className="sidebarDivider" />
        <div className="sidebarField">
          <div className="label">按状态筛选</div>
          <select
            value={taskFilter}
            onChange={(e) => setTaskFilter(e.target.value as 'all' | MediaTask['status'])}
            className="selectLike sidebarFullWidth"
          >
            <option value="all">全部</option>
            {(
              [
                'pending_manual',
                'queued',
                'precheck',
                'executing',
                'verify',
                'awaiting_user_confirm',
                'waiting_media_source',
                'paused',
                'interrupted',
                'resume_pending',
                'done',
                'failed_hard',
              ] as const
            ).map((s) => (
              <option key={s} value={s}>
                {taskStatusLabelZh(s)}
              </option>
            ))}
          </select>
        </div>
      </>
    );

    return (
      <>
        <AppShell page={page} setPage={setPage} sidebar={taskSidebar} error={error}>
          <div className="panel">
            <h3>任务状态</h3>
            <p className="hint">
              共 {taskSummary.total} 条 · 待启动 {taskSummary.pendingManual} · 排队中 {taskSummary.queued} · 进行中 {taskSummary.running} ·
              等待媒体片源 {taskSummary.waitingMediaSource} · 已暂停 {taskSummary.paused} · 中断 {taskSummary.interrupted}
            </p>
            <h3 style={{ marginTop: 20 }}>任务操作与明细</h3>
            <p className="hint">
              勾选后可侧栏批量移除 / 暂停 / 执行（与单条同语义，见 SSOT §8–§11）。单条：移除、暂停、执行、信息确认（待信息确认时）。
            </p>
            {enqueueHint ? (
              <div className="hint" style={{ marginTop: 8, color: '#86efac' }}>
                {enqueueHint}
              </div>
            ) : null}
            {filteredTasks.length === 0 ? (
              <div className="hint" style={{ marginTop: 12 }}>
                {tasks.length === 0
                  ? '暂无任务。请在媒体库管理或海报墙（打分自动入队）创建。'
                  : `当前筛选下无任务；全部 ${tasks.length} 条。`}
              </div>
            ) : (
              <div className="historyList" style={{ marginTop: 12 }}>
                {filteredTasks.map((t) => {
                  const batchToggleable = isTaskBatchToggleable(t);
                  const statusZh = taskStatusLabelZh(t.status);
                  return (
                    <div key={t.id} className="historyItem">
                      <div style={{ fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <span>{t.itemName}</span>
                        <label
                          className="hint"
                          style={{
                            display: 'inline-flex',
                            gap: 6,
                            alignItems: 'center',
                            cursor: batchToggleable ? 'pointer' : 'default',
                            opacity: batchToggleable ? 1 : 0.45,
                          }}
                        >
                          <input
                            type="checkbox"
                            disabled={!batchToggleable}
                            checked={batchRunSelectedIds.has(t.id)}
                            onChange={() => toggleBatchRunSelect(t.id)}
                          />
                          参与手动批量
                        </label>
                      </div>
                      <div className="hint">{t.actionType === 'transcode' ? '码率压缩' : '洗版优化'}</div>
                      <div className="hint">
                        {statusZh} <span style={{ opacity: 0.65 }}>({t.status})</span>
                        {t.pauseRequested ? (
                          <span style={{ color: '#fbbf24' }}> · 本步收尾后将暂停</span>
                        ) : null}
                      </div>
                      <div className="hint tabular-nums">进度 {t.progress}%</div>
                      <div className="hint tabular-nums">
                        {formatPlayedAt(t.updatedAt)}
                        {t.status === 'waiting_media_source' ? ` · ${nextManualRefreshInfo(t.retryCount, schedulerSettings)}` : ''}
                      </div>
                      <div className="historyRowActions" style={{ flexWrap: 'wrap', gap: 8 }}>
                        <button type="button" onClick={() => removeTask(t.id)}>
                          移除
                        </button>
                        <button type="button" onClick={() => pauseTaskRow(t.id)} disabled={!canUserPauseTask(t)}>
                          暂停
                        </button>
                        <button type="button" onClick={() => executeTaskRow(t.id)} disabled={!canUserExecuteTask(t)}>
                          执行
                        </button>
                        <button
                          type="button"
                          onClick={() => setInfoConfirmTaskId(t.id)}
                          disabled={t.status !== 'awaiting_user_confirm'}
                        >
                          信息确认
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <h3 style={{ marginTop: 24 }}>任务日志</h3>
            <p className="hint">首版占位：后续接入执行日志与检索。</p>
          </div>
        </AppShell>
        {infoConfirmTaskId ? (
          <div className="overlay" role="dialog" aria-modal="true" aria-label="信息确认">
            <div className="overlayBox" style={{ maxWidth: 520 }}>
              <div style={{ fontWeight: 800 }}>补源 · 信息确认</div>
              <p className="hint" style={{ marginTop: 8 }}>
                候选资源对比（模拟数据）。采用后任务重新排队；若无合格媒体片源则进入等待重试。
              </p>
              {infoConfirmCandidates.length === 0 ? (
                <p className="hint">暂无候选或任务已失效。</p>
              ) : (
                <div className="historyList" style={{ marginTop: 12 }}>
                  {infoConfirmCandidates.map((c) => (
                    <div key={c.id} className="historyItem">
                      <div style={{ fontWeight: 700 }}>{c.title}</div>
                      <div className="hint">{c.codec.toUpperCase()} · {c.sizeGb.toFixed(1)} GB · 置信度 {c.confidence}%</div>
                      <div className="historyRowActions">
                        <button
                          type="button"
                          className="primary"
                          onClick={() => infoConfirmTaskId && approveQualityCandidate(infoConfirmTaskId, c.title)}
                        >
                          采用并排队
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="actions" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  onClick={() => infoConfirmTaskId && rejectCandidateNoMediaSource(infoConfirmTaskId)}
                >
                  暂无合格媒体片源
                </button>
                <button type="button" onClick={() => setInfoConfirmTaskId(null)}>
                  关闭
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  const wallSidebar = (
    <>
      <div className="sidebarHeading">海报墙</div>
      <button type="button" className="primary sidebarFullWidth" onClick={() => void refreshUnplayed()}>
        {loading ? '刷新中...' : '刷新未播放'}
      </button>
      {activeSession ? (
        <>
          <div className="sidebarDivider" />
          <div className="sidebarMuted">当前播放会话</div>
          <button type="button" className="sidebarFullWidth" onClick={() => void onMarkWatchedRequest()}>
            已看完，标记已播放
          </button>
          <button type="button" className="sidebarFullWidth" onClick={() => onMarkUnwatched()}>
            未看完，稍后继续
          </button>
        </>
      ) : null}
    </>
  );

  return (
    <>
      <AppShell page={page} setPage={setPage} sidebar={wallSidebar} error={error}>
        <div className="panel">
          <div className="hint">键盘：方向键移动焦点，Enter 播放，R 刷新，Esc 取消焦点</div>
          {items.length === 0 ? (
            <div className="hint">暂无未播放条目</div>
          ) : (
            <div className="grid">
              {items.map((item, idx) => (
                <div key={`${item.sectionId}:${item.id}`} className="card">
                  <button
                    className={focusedIndex === idx ? 'focused' : ''}
                    onFocus={() => setFocusedIndex(idx)}
                    onClick={() => void onPlay(item)}
                  >
                    <img className="poster" src={buildPosterUrl(config, item)} alt={item.name} />
                    <div className="cardTitle">{item.name}</div>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </AppShell>
      {wallRatingItem ? (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="观看后打分">
          <div className="overlayBox">
            <div style={{ fontWeight: 800 }}>为「{wallRatingItem.name}」标注星级</div>
            <p className="hint" style={{ marginTop: 8 }}>
              完成后将写入本地星级；若已在配置中心开启「观看后打分自动入队」，将按策略创建任务（同视频互斥）。
            </p>
            <div className="actions" style={{ marginTop: 12, flexWrap: 'wrap' }}>
              {([1, 2, 3, 4, 5] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={wallRatingChoice === s ? 'primary' : ''}
                  onClick={() => setWallRatingChoice(s)}
                >
                  {s} 星
                </button>
              ))}
            </div>
            <div className="actions">
              <button type="button" className="primary" onClick={() => submitWallRatingAfterWatch()}>
                确定
              </button>
              <button type="button" onClick={() => setWallRatingItem(null)}>
                跳过
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {confirm ? (
        <div className="overlay">
          <div className="overlayBox">
            <div style={{ fontWeight: 800 }}>确认已播放</div>
            <div className="hint" style={{ marginTop: 8 }}>
              当前会话估算完成度 {confirm.completionPercent.toFixed(0)}%
              {confirm.belowThreshold ? `，低于阈值 ${config.markPlayedThresholdPercent}%` : `，达到阈值 ${config.markPlayedThresholdPercent}%`}
              {`；本次观影约 ${confirm.elapsedMinutes} 分钟`}
              {confirm.runtimeMinutes ? ` / 片长约 ${confirm.runtimeMinutes} 分钟` : ''}
            </div>
            <div className="actions">
              <button
                className="primary"
                onClick={async () => {
                  try {
                    setError(null);
                    const playedItem = confirm.item;
                    await window.embyApi.markPlayed({ config, itemId: playedItem.id });
                    addLocalPlayedHistory(playedItem);
                    setConfirm(null);
                    setActiveSession(null);
                    await refreshUnplayed();
                    void refreshLibraryManageList({ quietIfIncomplete: true });
                    void refreshPlayedHistory();
                    setWallRatingChoice(3);
                    setWallRatingItem(playedItem);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                确认回写
              </button>
              <button onClick={() => setConfirm(null)}>取消</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
