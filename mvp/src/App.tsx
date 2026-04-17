import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
  estimateEquivalentBitrate,
  nextManualRefreshInfo,
  recommendedAction,
  targetBitrateFor,
  type ManagedMediaItem,
  type MediaAction,
  type MediaPolicy,
  type MediaRating,
} from './mediaManager';
import { createDebugSeedTasks } from './debugSeed';

const STORAGE_KEY = 'embyDesktopPlayerConfigV1';
const LOCAL_MARKED_PLAYED_KEY = 'embyDesktopPlayerLocalMarkedPlayedV1';
const TASK_SCHEDULER_SETTINGS_KEY = 'embyDesktopPlayerTaskSchedulerSettingsV1';
const MEDIA_POLICY_KEY = 'embyDesktopPlayerMediaPolicyV1';
const MANAGED_ITEM_META_KEY = 'embyDesktopPlayerManagedItemMetaV1';

type ManagedItemMeta = { rating?: MediaRating | null; watched?: boolean };

type AppPage = 'config' | 'wall' | 'history' | 'mediaManage' | 'taskCenter';

type MainNavPage = AppPage;

type ConfigSection = 'emby' | 'policy' | 'scheduler';

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

function formatRatingDisplay(rating: MediaRating | null) {
  if (rating == null) return '未标注';
  return `${rating} 星`;
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

/** 含播放器路径；用于海报墙播放、任务等。 */
function hasConfigForLibraryFetch(config: EmbyConfig): boolean {
  return hasEmbyCoreConfig(config) && !!config.playerExePath.trim();
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
  const [infoConfirmTaskId, setInfoConfirmTaskId] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<'all' | MediaTask['status']>('all');
  const [batchRunSelectedIds, setBatchRunSelectedIds] = useState<Set<string>>(() => new Set());
  const [wallRatingItem, setWallRatingItem] = useState<UnplayedItem | null>(null);
  const [wallRatingChoice, setWallRatingChoice] = useState<MediaRating>(3);
  const [configSection, setConfigSection] = useState<ConfigSection>('emby');
  /** 媒体库多选区：获取列表前折叠，成功拉取后自动展开 */
  const [libraryPanelExpanded, setLibraryPanelExpanded] = useState(false);

  const enabledSet = useMemo(() => new Set(config.enabledSectionIds), [config.enabledSectionIds]);
  const sectionNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sections) map.set(s.id, s.name);
    return map;
  }, [sections]);
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
    if (items.length === 0) return;
    setManagedItems((prev) => {
      const existing = new Map(prev.map((x) => [x.id, x]));
      const meta = loadManagedItemMeta();
      const next = items.map((item, idx) => {
        const old = existing.get(item.id);
        if (old) return old;
        const saved = meta[item.id];
        const inPlayedHistory = playedItems.some((p) => p.id === item.id);
        const durationSec = Math.max(3600, Math.round((item.runTimeTicks ?? 36_000_000_000) / 10_000_000));
        const sizeGb = Number((3.5 + (idx % 7) * 1.9 + (durationSec / 3600) * 1.8).toFixed(1));
        const resolution = idx % 3 === 0 ? '4K' : '1080p';
        const codec = idx % 4 === 0 ? 'h264' : idx % 4 === 1 ? 'h265' : 'av1';
        const sectionName = sectionNameMap.get(item.sectionId);
        const rating = saved && 'rating' in saved ? saved.rating ?? null : null;
        const watched = saved && typeof saved.watched === 'boolean' ? saved.watched : inPlayedHistory;
        return {
          id: item.id,
          name: item.name,
          sectionId: item.sectionId,
          sectionName,
          resolution,
          codec,
          durationSec,
          sizeGb,
          rating,
          watched,
        } satisfies ManagedMediaItem;
      });
      return next;
    });
  }, [items, playedItems, sectionNameMap]);

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

  function toggleManageSelect(itemId: string) {
    setManageSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function selectAllManaged() {
    setManageSelectedIds(new Set(managedItems.map((x) => x.id)));
  }

  function clearManageSelection() {
    setManageSelectedIds(new Set());
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

  function setSingleManagedRating(it: ManagedMediaItem, rating: MediaRating | null) {
    saveManagedItemMetaPatch({ [it.id]: { rating } });
    setManagedItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, rating } : x)));
    setError(null);
  }

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
        void refreshPlayedHistory();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    saveManagedItemMetaPatch({ [it.id]: { watched } });
    setManagedItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, watched } : x)));
  }

  function enqueueManagedAction(item: ManagedMediaItem, action: MediaAction) {
    const preview = buildTaskPreview(item, action);
    if (!preview) return;
    setError(null);
    setTasks((prev) => {
      if (hasActiveTaskForItem(prev, preview.itemId)) {
        setError(`无法添加任务：「${item.name}」已有进行中的任务（同视频互斥）。`);
        return prev;
      }
      const created = enqueueTask(preview, schedulerSettings.runMode);
      setEnqueueHint(
        `已提交 1 条：${item.name}（${preview.actionType === 'transcode' ? '码率压缩' : '洗版优化'}）。请到任务中心查看，筛选请选「全部」。`,
      );
      window.setTimeout(() => setEnqueueHint(null), 5000);
      return [created, ...prev].slice(0, 300);
    });
  }

  function enqueueRecommendedBatch() {
    if (manageSelectedIds.size === 0) {
      setError('请先在列表中勾选要批量码率优化的条目。');
      return;
    }
    setError(null);
    setTasks((prev) => {
      const creations: MediaTask[] = [];
      const blocked: string[] = [];
      for (const item of managedItems) {
        if (!manageSelectedIds.has(item.id)) continue;
        const action = recommendedAction(item, mediaPolicy);
        const preview = buildTaskPreview(item, action);
        if (!preview) continue;
        if (hasActiveTaskForItem(prev, preview.itemId) || creations.some((c) => c.itemId === preview.itemId)) {
          blocked.push(item.name);
          continue;
        }
        creations.push(enqueueTask(preview, schedulerSettings.runMode));
      }
      if (blocked.length > 0) {
        setError(`部分条目已有进行中任务，已跳过：${blocked.slice(0, 5).join('、')}${blocked.length > 5 ? '…' : ''}`);
      }
      if (creations.length === 0) {
        setError(
          blocked.length > 0
            ? `选中条目均无法入队（可能未标注星级、已达标、为删除档，或均与进行中任务冲突）。`
            : '选中条目中暂无需要排队的项（可能未标注星级、已达标或为删除档）。',
        );
        return prev;
      }
      setEnqueueHint(`已按策略提交 ${creations.length} 条码率优化任务。请到任务中心查看，筛选请选「全部」。`);
      window.setTimeout(() => setEnqueueHint(null), 6000);
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
    const managed: ManagedMediaItem = {
      id: item.id,
      name: item.name,
      sectionId: item.sectionId,
      sectionName: sectionNameMap.get(item.sectionId),
      resolution: '1080p',
      codec: 'h264',
      durationSec,
      sizeGb: 9.6,
      rating,
      watched: true,
    };
    saveManagedItemMetaPatch({ [item.id]: { rating, watched: true } });
    setManagedItems((prev) => {
      const rest = prev.filter((x) => x.id !== item.id);
      return [managed, ...rest];
    });
    if (schedulerSettings.wallRatingAutoEnqueue) {
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
    } else {
      setEnqueueHint('已保存星级。可在配置中心开启「观看后打分自动入队」以自动创建任务。');
      window.setTimeout(() => setEnqueueHint(null), 6000);
    }
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

  /** 进入海报墙 / 媒体库管理时自动拉未播放列表（替代已移除的「进入未播放海报墙」里顺带触发的 refresh）。 */
  useEffect(() => {
    if (page !== 'wall' && page !== 'mediaManage') return;
    if (!hasConfigForLibraryFetch(config)) return;
    void refreshUnplayed({ quietIfIncomplete: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, config.baseUrl, config.apiKey, config.userId, config.playerExePath, config.enabledSectionIds.join(',')]);

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
        setError(
          '请先完成并保存本页：Base URL、API Key、选择用户、勾选至少一个媒体库、填写播放器路径。保存后进入海报墙会自动拉取未播放列表。',
        );
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
        <div className="sidebarHeading">媒体库管理 · 批量</div>
        <p className="sidebarHint">以下操作仅对列表中勾选的条目生效。码率策略与任务调度在「配置中心」。</p>
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
      </>
    );

    return (
      <>
      <AppShell page={page} setPage={setPage} sidebar={mediaSidebar} error={error}>
        <div className="panel">
          <div className="hint">当前任务池：共 {taskSummary.total} 条，排队 {taskSummary.queued}，执行中 {taskSummary.running}。</div>
          {enqueueHint ? (
            <div className="hint" style={{ marginTop: 8, color: '#86efac' }}>
              {enqueueHint}
            </div>
          ) : null}
          {managedItems.length === 0 ? (
            <div className="hint" style={{ marginTop: 12 }}>暂无可管理条目。先到海报墙刷新未播放列表后再回来。</div>
          ) : (
            <>
              <div className="mediaManageTable">
                <div className="mediaManageGrid mediaManageHead" aria-hidden>
                  <div>条目</div>
                  <div>当前码率</div>
                  <div>目标码率</div>
                  <div>视频格式</div>
                  <div>星级</div>
                  <div>播放</div>
                  <div>操作</div>
                </div>
                {managedItems.map((it) => {
                  const target = targetBitrateFor(it, mediaPolicy);
                  const eq = estimateEquivalentBitrate(it);
                  const action = recommendedAction(it, mediaPolicy);
                  const targetHint =
                    it.rating == null ? '—' : it.rating === 1 ? '删除档' : target ? `${target.toFixed(1)} Mbps` : '—';
                  const formatLabel = `${it.resolution} · ${it.codec.toUpperCase()}`;
                  return (
                    <div key={it.id} className="mediaManageGrid mediaManageRow">
                      <div className="mediaManageTitleCell">
                        <input
                          type="checkbox"
                          checked={manageSelectedIds.has(it.id)}
                          onChange={() => toggleManageSelect(it.id)}
                          title="勾选后可参与左侧批量操作"
                        />
                        <span className="mediaManageTitle">{it.name}</span>
                      </div>
                      <div className="tabular-nums">{eq.toFixed(1)} Mbps</div>
                      <div className="tabular-nums">{targetHint}</div>
                      <div>{formatLabel}</div>
                      <div>{formatRatingDisplay(it.rating)}</div>
                      <div>{it.watched ? '已观看' : '未观看'}</div>
                      <div className="mediaManageRowActions">
                        <div className="mediaManageActionGroup">
                          <span className="mediaManageActionLabel">观看</span>
                          <div className="mediaManageActionBtns">
                            <button type="button" disabled={it.watched} onClick={() => void setManagedWatchState(it, true)}>
                              已看
                            </button>
                            <button type="button" disabled={!it.watched} onClick={() => void setManagedWatchState(it, false)}>
                              未看
                            </button>
                          </div>
                        </div>
                        <div className="mediaManageActionGroup">
                          <span className="mediaManageActionLabel">星级</span>
                          <select
                            className="selectLike mediaManageSelect"
                            value={it.rating == null ? '' : String(it.rating)}
                            onChange={(e) => {
                              const v = e.target.value;
                              setSingleManagedRating(it, v === '' ? null : (Number(v) as MediaRating));
                            }}
                          >
                            <option value="">未标注</option>
                            {([1, 2, 3, 4, 5] as const).map((s) => (
                              <option key={s} value={s}>
                                {s} 星
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="mediaManageActionGroup">
                          <span className="mediaManageActionLabel">码率优化</span>
                          {it.rating == null ? (
                            <span className="hint">需标注星级</span>
                          ) : action === 'delete' ? (
                            <span className="hint">策略：待删除</span>
                          ) : action === 'keep' ? (
                            <span className="hint">已达标</span>
                          ) : action === 'transcode' ? (
                            <button type="button" onClick={() => enqueueManagedAction(it, action)}>
                              码率压缩
                            </button>
                          ) : (
                            <button type="button" onClick={() => enqueueManagedAction(it, action)}>
                              洗版优化
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
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
