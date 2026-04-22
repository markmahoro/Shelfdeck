import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  appendFlowLog,
  canUserExecuteTask,
  canUserPauseTask,
  enqueueTask,
  formatFlowLogLine,
  formatFlowLogLineForUser,
  hasActiveTaskForItem,
  isTaskTerminal,
  loadTaskQueue,
  markWaitingMediaSourceRetryWithDelay,
  saveTaskQueue,
  taskOccupiesActiveSlot,
  taskStatusLabelZh,
  transcodeVolumeSummaryLine,
  type MediaTask,
} from './taskQueue';
import {
  advanceTaskQueue,
  applyControl,
  defaultSchedulerSettings,
  refreshWaitingTasks,
  waitingMediaDelayMs,
  type AdvanceTaskQueueOptions,
} from './taskScheduler';
import { pushEmbyClientToControlPlane } from './controlPlaneConfigSync';
import {
  describeTranscodePoolForUser,
  mergeProbeIntoPool,
  orderedInPoolCandidates,
  reorderEncodePoolEntries,
  sortEncodePoolEntriesForDisplay,
  suggestPoolPrioritiesFromProbeOrder,
  type TranscodeEncodePoolSettings,
} from './transcodePool';
import {
  buildTaskPreview,
  defaultMediaPolicy,
  effectiveRatingForPolicy,
  nextManualRefreshInfo,
  predictedSizeGbAtPolicyTarget,
  isDeleteTierRating,
  recommendedAction,
  type ManagedMediaItem,
  type MediaAction,
  type MediaPolicy,
  type MediaRating,
} from './mediaManager';
import { createDebugSeedTasks } from './debugSeed';
import { buildDoubanStarsByNormalizedTitle, movieDoubanStars, type DoubanRatingEntry } from './doubanUtils';
import { MediaLibraryManageRow } from './MediaLibraryManageRow';
import { checkMediaServiceHealth } from './mediaServiceHealth';
import { getRendererMediaServiceBaseUrl } from './cpBase';
import { apiClient, ApiConflictError } from './apiClient';

type ReplaceBackupRow = {
  taskId: string;
  itemName: string;
  targetPath: string;
  backupPath: string;
  backupBasename: string;
  size: number;
  closedAt: string;
};

function deriveReplaceBackupPath(targetPath: string): string {
  const bridge = window.embyApi?.transcodeDeriveReplaceBackupPath;
  if (bridge) return bridge(targetPath);
  const norm = targetPath.replace(/[/\\]+$/, '');
  const i = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
  const dir = i >= 0 ? norm.slice(0, i) : '';
  const base = i >= 0 ? norm.slice(i + 1) : norm;
  const sep = targetPath.includes('\\') && !targetPath.includes('/') ? '\\' : '/';
  return dir ? `${dir}${sep}${base}.etp.bak` : `${base}.etp.bak`;
}

function formatByteSizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(3)} GB`;
}

/** 将 ffmpeg/ffprobe 检验等场景下常见的系统报错改写成用户可读的说明 */
function humanizeTranscodeSetupErrorMessage(detail: string): string {
  const s = String(detail ?? '').trim();
  if (!s) return '';
  if (/\bEFTYPE\b/i.test(s)) {
    return '当前填写的 ffmpeg 或 ffprobe 无法按程序启动：路径可能不是可执行文件（在 Windows 上请选 .exe）、或是文件夹/损坏的安装。请核对路径，或清空该项改用已加入系统 PATH 的版本。';
  }
  return s;
}

/** 保存类操作失败：先说明未保存成功，再给出原因（与「保存成功」对用户二选一）。 */
function formatSaveConfigFailed(detail: string): string {
  const t = humanizeTranscodeSetupErrorMessage(detail).trim();
  return t ? `保存配置不成功。原因：${t}` : '保存配置不成功。';
}

function applyAdvanceWithFlowLog(
  prev: MediaTask[],
  settings: TaskSchedulerSettings,
  only?: AdvanceTaskQueueOptions,
): MediaTask[] {
  const next = advanceTaskQueue(prev, settings, only);
  const prevMap = new Map(prev.map((t) => [t.id, t]));
  return next.map((t) => {
    const old = prevMap.get(t.id);
    if (!old || old.status === t.status) return t;
    return appendFlowLog(
      t,
      'scheduler.tick',
      `调度推进：${taskStatusLabelZh(old.status)} → ${taskStatusLabelZh(t.status)}（排队或占槽）`,
    );
  });
}

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

async function hydrateLibraryManageFromStorage(cfg: EmbyConfig): Promise<{ items: UnplayedItem[]; savedAt: string | null }> {
  if (!hasConfigForLibraryFetch(cfg)) return { items: [], savedAt: null };
  const base = getRendererMediaServiceBaseUrl();
  if (!base) return { items: [], savedAt: null };

  try {
    const cache = await apiClient.getLibraryCache();
    const items = (cache.items as unknown[]).map(coerceUnplayedItem).filter((x): x is UnplayedItem => x != null);
    return { items, savedAt: cache.cachedAt };
  } catch (e) {
    console.warn('[library cache] load from backend failed', e);
    return { items: [], savedAt: null };
  }
}

async function saveLibraryManageCache(cfg: EmbyConfig, items: UnplayedItem[]): Promise<string | null> {
  if (!hasConfigForLibraryFetch(cfg)) return null;
  const base = getRendererMediaServiceBaseUrl();
  if (!base) return null;

  try {
    const result = await apiClient.setLibraryCache(items);
    return result.cachedAt;
  } catch (e) {
    console.warn('[library cache] save to backend failed', e);
    return null;
  }
}

const DOUBAN_ENTRIES_CACHE_KEY = 'embyDesktopPlayerDoubanRatingEntriesV1';
/** 无界面开关：距上次全量同步超过该间隔则本次自动全量拉取（仍与本地条目合并） */
const DOUBAN_LAST_FULL_SYNC_KEY = 'embyDesktopPlayerDoubanLastFullSyncAtMs';
const DOUBAN_FULL_SYNC_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;

async function loadDoubanRatingEntries(): Promise<DoubanRatingEntry[]> {
  const base = getRendererMediaServiceBaseUrl();
  if (!base) return [];

  try {
    const cache = await apiClient.getDoubanCache();
    const out: DoubanRatingEntry[] = [];
    for (const x of cache.entries) {
      if (!x || typeof x !== 'object') continue;
      const o = x as Record<string, unknown>;
      const title = typeof o.title === 'string' ? o.title.trim() : '';
      const subjectId = typeof o.subjectId === 'string' ? o.subjectId.trim() : '';
      const stars = typeof o.stars === 'number' ? o.stars : Number(o.stars);
      if (!title || !subjectId || !Number.isInteger(stars) || stars < 1 || stars > 5) continue;
      out.push({ title, stars: stars as MediaRating, subjectId });
    }
    return out;
  } catch (e) {
    console.warn('[douban cache] load from backend failed', e);
    return [];
  }
}

function saveDoubanRatingEntries(entries: DoubanRatingEntry[]) {
  console.warn('[douban cache] saveDoubanRatingEntries called but douban cache is now read-only from backend');
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

type ConfigSaveFeedback =
  | { kind: 'idle' }
  | { kind: 'success'; message: string; section: ConfigSection }
  | { kind: 'error'; message: string; section: ConfigSection };

type ConfigAsyncOp =
  | null
  | 'emby-save'
  | 'policy-save'
  | 'scheduler-task-save'
  | 'scheduler-flow-save'
  | 'douban-save'
  | 'transcode-probe'
  | 'encode-device-probe';

type ManageBitrateFilterKey = 'all' | 'transcode' | 'upgrade' | 'keep' | 'no_rating' | 'delete';
type ManageResolutionFilterKey = 'all' | '1080p' | '4K';
type ManageCodecFilterKey = 'all' | 'h264' | 'h265' | 'av1';
type ManageWatchedFilterKey = 'all' | 'watched' | 'unwatched';
type ManageBluRayFilterKey = 'all' | 'disc' | 'not_disc';

const MAIN_NAV: { id: MainNavPage; label: string }[] = [
  { id: 'wall', label: '海报墙' },
  { id: 'mediaManage', label: '媒体库管理' },
  { id: 'history', label: '播放记录' },
];

function TopNav({ page, setPage, onSettingsClick }: { page: AppPage; setPage: (p: AppPage) => void; onSettingsClick: () => void }) {
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
      <button
        type="button"
        className="navTab navTabIcon"
        onClick={onSettingsClick}
        title="设置"
        aria-label="打开设置"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/>
          <path fillRule="evenodd" d="M6.5 1.75a.25.25 0 0 1 .25-.25h2a.25.25 0 0 1 .25.25V3h-2.5V1.75zM13.25 6.5a.25.25 0 0 1-.175.232l-1.537.884a.25.25 0 0 1-.267.088l-.358-.179-.001-.001a.498.498 0 0 0-.608-.174l-.694.174a.25.25 0 0 1-.267-.088l-1.537-.884a.25.25 0 0 1-.093-.166l.001-.002L6.603 4.4a.498.498 0 0 0-.608.174l-.694-.174a.25.25 0 0 1 .089-.267l1.537-.884a.25.25 0 0 1 .267-.088l.358.179.001.001.001.002a.498.498 0 0 0 .174.608l-.174.694a.25.25 0 0 1-.088.267l-.884 1.537a.25.25 0 0 1-.166.093l-.002-.001-.002-.001a.498.498 0 0 0-.174-.608l.174-.694a.25.25 0 0 1 .088-.267l.884-1.537a.25.25 0 0 1 .232-.175h.633a.25.25 0 0 1 .25.25v2a.25.25 0 0 1-.25.25h-.633a.498.498 0 0 0-.608.174l-.174.694a.25.25 0 0 1-.267.088l-1.537.884a.25.25 0 0 1-.232.175H3.75a.25.25 0 0 1-.25-.25v-.633a.498.498 0 0 0-.174-.608l.174-.694a.25.25 0 0 1 .088-.267l.884-1.537a.25.25 0 0 1 .166-.093l.002.001.002.001a.498.498 0 0 0 .608-.174l.174-.694a.25.25 0 0 1 .267-.088l1.537-.884a.25.25 0 0 1 .175-.232V3.75a.25.25 0 0 1 .25-.25h.633a.498.498 0 0 0 .608-.174l.174-.694a.25.25 0 0 1 .267-.088l1.537-.884a.25.25 0 0 1 .232-.175h.633a.25.25 0 0 1 .25.25v2a.25.25 0 0 1-.25.25h-.633z"/>
        </svg>
      </button>
    </nav>
  );
}

function MediaServiceLinkIndicator({ mediaGate }: { mediaGate: 'unknown' | 'online' | 'offline' }) {
  const title =
    mediaGate === 'online'
      ? '媒体管理服务连接正常'
      : mediaGate === 'unknown'
        ? '正在检测媒体管理服务…请到任务栏 ShelfDeck 小助手检查连接或启动服务'
        : '无法连接媒体管理服务。请到任务栏 ShelfDeck 小助手填写或检查服务器地址，或启动本机服务';
  return (
    <span
      className={`mediaServiceLinkDot mediaServiceLinkDot--${mediaGate}`}
      title={title}
      role="img"
      aria-label={title}
    />
  );
}

function AppShell({
  page,
  setPage,
  sidebar,
  children,
  error,
  mediaGate,
  onSettingsClick,
}: {
  page: AppPage;
  setPage: (p: AppPage) => void;
  sidebar: ReactNode;
  children: ReactNode;
  error?: string | null;
  mediaGate: 'unknown' | 'online' | 'offline';
  onSettingsClick: () => void;
}) {
  const gateBlocking = mediaGate !== 'online';
  return (
    <div className="app appShell">
      <header className="appHeader">
        <div className="appHeaderLeft">
          <div className="appTitle">Emby Desktop Player</div>
        </div>
        <div className="appHeaderRight">
          <TopNav page={page} setPage={setPage} onSettingsClick={onSettingsClick} />
          <MediaServiceLinkIndicator mediaGate={mediaGate} />
        </div>
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
      {gateBlocking ? (
        <div
          className="mediaServiceGateOverlay"
          role="alertdialog"
          aria-live="polite"
          aria-busy={mediaGate === 'unknown'}
        >
          <div className="mediaServiceGateCard">
            {mediaGate === 'unknown' ? (
              <>
                <h2>正在连接媒体管理服务…</h2>
                <p className="hint" style={{ marginTop: 10, lineHeight: 1.5 }}>
                  请打开任务栏中的 ShelfDeck 小助手，在其中填写或检查媒体管理服务地址，或启动本机后端。连接成功后再回到此处配置 Emby、任务等。
                </p>
              </>
            ) : (
              <>
                <h2>媒体管理服务不可用</h2>
                <p style={{ marginTop: 8, lineHeight: 1.55 }}>
                  无法连接媒体管理服务。请打开任务栏中的 ShelfDeck 小助手，检查服务器地址是否正确，或在本机启动后端（若适用）；也可检查网络。
                </p>
                <p className="hint" style={{ marginTop: 10, lineHeight: 1.5 }}>
                  桌面端不提供媒体管理服务地址修改入口；窗口获得焦点时将自动重试连接。
                </p>
              </>
            )}
          </div>
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
  embyUserPassword: '',
  enabledSectionIds: [],
  playerExePath: '',
  argsTemplate: '"{path}" /new',
  pathMapFrom: '',
  pathMapTo: '',
  markPlayedThresholdPercent: 90,
  fallbackMinSeconds: 600,
  transcodeTempRoot: '',
  ffmpegPath: '',
  ffprobePath: '',
};

function normalizeConfig(raw: Partial<EmbyConfig>): EmbyConfig {
  return {
    baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : defaultConfig.baseUrl,
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : defaultConfig.apiKey,
    userId: typeof raw.userId === 'string' ? raw.userId : defaultConfig.userId,
    embyUserPassword:
      typeof raw.embyUserPassword === 'string' ? raw.embyUserPassword : defaultConfig.embyUserPassword,
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
    transcodeTempRoot:
      typeof raw.transcodeTempRoot === 'string' ? raw.transcodeTempRoot : defaultConfig.transcodeTempRoot,
    ffmpegPath: typeof raw.ffmpegPath === 'string' ? raw.ffmpegPath : defaultConfig.ffmpegPath,
    ffprobePath: typeof raw.ffprobePath === 'string' ? raw.ffprobePath : defaultConfig.ffprobePath,
  };
}

async function loadSavedConfig(): Promise<EmbyConfig> {
  const base = getRendererMediaServiceBaseUrl();
  if (!base) return defaultConfig;

  try {
    const config = await apiClient.getConfig();
    return normalizeConfig(config as Partial<EmbyConfig>);
  } catch (e) {
    console.warn('[config] load from backend failed', e);
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

/** 删除 Flow 调 Emby：仅需核心连接与用户，不要求已填播放器路径 */
function hasEmbyCoreForDeleteFlow(config: EmbyConfig, connected: boolean): boolean {
  return connected && !!config.baseUrl.trim() && !!config.apiKey.trim() && !!config.userId.trim();
}

function formatDeleteConfirmLines(item: Record<string, unknown>, deleteInfo: Record<string, unknown> | null): string[] {
  const lines: string[] = [];
  const name = item.Name ?? item.name;
  if (typeof name === 'string' && name.trim()) lines.push(`标题：${name.trim()}`);
  const typ = item.Type ?? item.type;
  if (typeof typ === 'string' && typ.trim()) lines.push(`类型：${typ.trim()}`);
  const path = item.Path ?? item.path;
  if (typeof path === 'string' && path.trim()) lines.push(`路径：${path.trim()}`);
  if (deleteInfo && typeof deleteInfo === 'object') {
    const paths = deleteInfo.Paths ?? deleteInfo.paths;
    if (Array.isArray(paths) && paths.length > 0) {
      const ps = paths.filter((p): p is string => typeof p === 'string').slice(0, 12);
      if (ps.length) lines.push(`Emby 返回的待删除路径（节选）：${ps.join('；')}`);
    }
  }
  if (lines.length === 0) lines.push('（服务器未返回详细路径，仍以 Emby 将删除该条目为准。）');
  lines.push('确认后将从 Emby 库与磁盘删除（以服务器行为为准），不可撤销。');
  return lines;
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

function normalizeTranscodeEncodePool(
  raw: Partial<TranscodeEncodePoolSettings> | undefined,
  fallback: TranscodeEncodePoolSettings,
): TranscodeEncodePoolSettings {
  if (!raw || typeof raw !== 'object') return { cpuParticipation: fallback.cpuParticipation, entries: [] };
  const cpu: 1 | 2 = raw.cpuParticipation === 2 ? 2 : 1;
  const entriesIn = Array.isArray(raw.entries) ? raw.entries : [];
  const entries = entriesIn
    .map((e, i) => ({
      stableKey: typeof e?.stableKey === 'string' ? e.stableKey : '',
      inPool: e?.inPool === true,
      maxSlots:
        typeof e?.maxSlots === 'number' && Number.isFinite(e.maxSlots) ? Math.max(1, Math.floor(e.maxSlots)) : 1,
      priority: typeof e?.priority === 'number' && Number.isFinite(e.priority) ? e.priority : i * 10,
    }))
    .filter((e) => e.stableKey.length > 0);
  return { cpuParticipation: cpu, entries };
}

function normalizeSchedulerSettings(raw: Partial<TaskSchedulerSettings>): TaskSchedulerSettings {
  const fallback = defaultSchedulerSettings();
  const poolRaw =
    raw.transcodeEncodePool && typeof raw.transcodeEncodePool === 'object'
      ? raw.transcodeEncodePool
      : fallback.transcodeEncodePool;
  return {
    deleteConcurrency:
      typeof raw.deleteConcurrency === 'number' && Number.isFinite(raw.deleteConcurrency)
        ? Math.max(1, Math.floor(raw.deleteConcurrency))
        : fallback.deleteConcurrency,
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
    transcodeAutoReplace:
      typeof raw.transcodeAutoReplace === 'boolean' ? raw.transcodeAutoReplace : fallback.transcodeAutoReplace,
    transcodeEncodePool: normalizeTranscodeEncodePool(
      poolRaw as Partial<TranscodeEncodePoolSettings>,
      fallback.transcodeEncodePool,
    ),
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
  const [config, setConfig] = useState<EmbyConfig>(defaultConfig);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [sections, setSections] = useState<EmbyMediaFolder[]>([]);
  const [users, setUsers] = useState<EmbyUser[]>([]);
  const [items, setItems] = useState<UnplayedItem[]>([]);
  /** 媒体库管理：已启用库内全部影片/剧集（含已观看），与海报墙未播放列表分离；启动时尽量从本地缓存恢复 */
  const [libraryManageItems, setLibraryManageItems] = useState<UnplayedItem[]>([]);
  /** 本地列表缓存写入时间（ISO）；仅「刷新媒体库列表」成功后会更新 */
  const [libraryManageCacheSavedAt, setLibraryManageCacheSavedAt] = useState<string | null>(null);

  // Load config and caches from backend on mount
  useEffect(() => {
    async function loadFromBackend() {
      const base = getRendererMediaServiceBaseUrl();
      if (!base) {
        setConfigLoaded(true);
        return;
      }

      try {
        const loadedConfig = await loadSavedConfig();
        setConfig(loadedConfig);

        const libraryCache = await hydrateLibraryManageFromStorage(loadedConfig);
        setLibraryManageItems(libraryCache.items);
        setLibraryManageCacheSavedAt(libraryCache.savedAt);

        const doubanEntries = await loadDoubanRatingEntries();
        setDoubanRatingEntries(doubanEntries);
      } catch (e) {
        console.error('[App] Failed to load from backend', e);
      } finally {
        setConfigLoaded(true);
      }
    }
    void loadFromBackend();
  }, []);
  const [playedItems, setPlayedItems] = useState<PlayedItem[]>([]);
  const [connected, setConnected] = useState(false);
  const [page, setPage] = useState<AppPage>('wall');
  const [showSettings, setShowSettings] = useState(false);
  const onSettingsClick = useCallback(() => setShowSettings(true), []);
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
  const [tasks, setTasks] = useState<MediaTask[]>([]);
  const [tasksHydrated, setTasksHydrated] = useState(false);
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
  const deleteFlowBusyRef = useRef<Set<string>>(new Set());
  const transcodeFlowBusyRef = useRef<Set<string>>(new Set());
  const taskQueueRemoteLoadOkRef = useRef(false);
  const [replaceBackupRows, setReplaceBackupRows] = useState<ReplaceBackupRow[]>([]);
  const [replaceBackupSelected, setReplaceBackupSelected] = useState<Set<string>>(() => new Set());
  const [replaceBackupRefreshKey, setReplaceBackupRefreshKey] = useState(0);
  const [tempResidueEntries, setTempResidueEntries] = useState<TranscodeOrphanEntry[]>([]);
  const [tempResiduePhase, setTempResiduePhase] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [tempResidueEmptyKind, setTempResidueEmptyKind] = useState<
    null | 'no_desktop' | 'no_temp_root' | 'empty' | 'scan_failed'
  >(null);
  const [tempResidueSelected, setTempResidueSelected] = useState<Set<string>>(() => new Set());
  const [configSaveFeedback, setConfigSaveFeedback] = useState<ConfigSaveFeedback>({ kind: 'idle' });
  const [configAsyncOp, setConfigAsyncOp] = useState<ConfigAsyncOp>(null);
  /** 「检验转码资源池」专用摘要，与持久化保存反馈（configSaveFeedback）分离 */
  const [transcodeProbeHint, setTranscodeProbeHint] = useState<string | null>(null);
  const configSaveSuccessTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const refreshLibraryManageListRef = useRef<((opts?: { quietIfIncomplete?: boolean }) => Promise<void>) | null>(null);
  const [taskFilter, setTaskFilter] = useState<'all' | MediaTask['status']>('all');
  const [showFlowLogTechnical, setShowFlowLogTechnical] = useState(false);
  const [batchRunSelectedIds, setBatchRunSelectedIds] = useState<Set<string>>(() => new Set());
  const [wallRatingItem, setWallRatingItem] = useState<UnplayedItem | null>(null);
  const [wallRatingChoice, setWallRatingChoice] = useState<MediaRating>(3);
  const [configSection, setConfigSection] = useState<ConfigSection>('emby');
  /** 媒体库多选区：获取列表前折叠，成功拉取后自动展开 */
  const [libraryPanelExpanded, setLibraryPanelExpanded] = useState(false);
  const [doubanRatingEntries, setDoubanRatingEntries] = useState<DoubanRatingEntry[]>([]);
  const [doubanCookieDraft, setDoubanCookieDraft] = useState('');
  const [doubanUserIdDraft, setDoubanUserIdDraft] = useState('');
  const [doubanSyncBusy, setDoubanSyncBusy] = useState(false);
  const [doubanFetchStatus, setDoubanFetchStatus] = useState<string | null>(null);
  const [mediaServiceReachable, setMediaServiceReachable] = useState<'unknown' | 'online' | 'offline'>('unknown');

  const clearConfigSaveSuccessTimer = useCallback(() => {
    if (configSaveSuccessTimerRef.current != null) {
      window.clearTimeout(configSaveSuccessTimerRef.current);
      configSaveSuccessTimerRef.current = null;
    }
  }, []);

  const scheduleConfigSuccessClear = useCallback(() => {
    clearConfigSaveSuccessTimer();
    configSaveSuccessTimerRef.current = window.setTimeout(() => {
      setConfigSaveFeedback((prev) => (prev.kind === 'success' ? { kind: 'idle' } : prev));
      configSaveSuccessTimerRef.current = null;
    }, 5000);
  }, [clearConfigSaveSuccessTimer]);

  useEffect(() => {
    clearConfigSaveSuccessTimer();
    setConfigSaveFeedback({ kind: 'idle' });
    if (configSection !== 'scheduler') {
      setTranscodeProbeHint(null);
    }
  }, [configSection, clearConfigSaveSuccessTimer]);

  useEffect(() => {
    return () => clearConfigSaveSuccessTimer();
  }, [clearConfigSaveSuccessTimer]);

  const probeMediaService = useCallback(async () => {
    const ok = await checkMediaServiceHealth();
    setMediaServiceReachable(ok ? 'online' : 'offline');
  }, []);

  useEffect(() => {
    void probeMediaService();
    const id = window.setInterval(() => void probeMediaService(), 12000);
    const onFocus = () => void probeMediaService();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [probeMediaService]);

  useEffect(() => {
    const w = window as Window & {
      shelfdeckMedia?: { onConnectionUpdated?: (cb: () => void) => () => void };
    };
    if (!w.shelfdeckMedia?.onConnectionUpdated) return undefined;
    const off = w.shelfdeckMedia.onConnectionUpdated(() => {
      void probeMediaService();
      void loadTaskQueue()
        .then((t) => {
          setTasks(t);
          taskQueueRemoteLoadOkRef.current = true;
        })
        .catch((e) => console.error('[taskQueue] reload after connection change', e));
    });
    return off;
  }, [probeMediaService]);

  const ensureMediaServiceOnlineForConfigSave = useCallback(
    (section: ConfigSection): boolean => {
      if (mediaServiceReachable === 'online') return true;
      setConfigSaveFeedback({
        kind: 'error',
        section,
        message: formatSaveConfigFailed(
          mediaServiceReachable === 'unknown'
            ? '正在检测媒体管理服务，请稍候再试。'
            : '无法连接媒体管理服务。请打开任务栏 ShelfDeck 小助手检查服务器地址或启动服务后再保存。',
        ),
      });
      return false;
    },
    [mediaServiceReachable],
  );

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
    void loadTaskQueue()
      .then((t) => {
        setTasks(t);
        taskQueueRemoteLoadOkRef.current = true;
        setTasksHydrated(true);
      })
      .catch((e) => {
        console.error('[taskQueue] loadTaskQueue failed', e);
        taskQueueRemoteLoadOkRef.current = false;
        setTasks([]);
        setTasksHydrated(true);
        setError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  useEffect(() => {
    pushEmbyClientToControlPlane(configRef.current);
  }, []);

  useEffect(() => {
    const cfg = configRef.current;
    if (!libraryManageCacheFingerprint) {
      setLibraryManageItems([]);
      setLibraryManageCacheSavedAt(null);
      return;
    }
    void (async () => {
      const { items, savedAt } = await hydrateLibraryManageFromStorage(cfg);
      setLibraryManageItems(items);
      setLibraryManageCacheSavedAt(savedAt);
    })();
  }, [libraryManageCacheFingerprint]);

  useEffect(() => {
    const off = window.embyApi?.onTranscodeProgress?.((payload) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === payload.taskId && t.actionType === 'transcode' && t.status === 'executing'
            ? { ...t, progress: Math.max(t.progress, payload.progress) }
            : t,
        ),
      );
    });
    return () => {
      off?.();
    };
  }, []);

  useEffect(() => {
    if (page !== 'taskCenter' && page !== 'config') {
      setTempResiduePhase('idle');
      return;
    }
    const root = config.transcodeTempRoot?.trim();
    const scanOrphans = window.embyApi?.transcodeScanOrphans;
    if (!scanOrphans) {
      setTempResidueEntries([]);
      setTempResidueEmptyKind('no_desktop');
      setTempResiduePhase('ready');
      return;
    }
    if (!root) {
      setTempResidueEntries([]);
      setTempResidueEmptyKind('no_temp_root');
      setTempResiduePhase('ready');
      return;
    }
    setTempResidueEmptyKind(null);
    setTempResiduePhase('loading');
    void (async () => {
      try {
        const r = await scanOrphans({ tempRoot: root });
        const entries = r.entries ?? [];
        setTempResidueEntries(entries);
        setTempResidueEmptyKind(entries.length === 0 ? 'empty' : null);
      } catch {
        setTempResidueEntries([]);
        setTempResidueEmptyKind('scan_failed');
      } finally {
        setTempResiduePhase('ready');
      }
    })();
  }, [page, config.transcodeTempRoot]);

  useEffect(() => {
    const ok = new Set(tempResidueEntries.map((e) => e.path));
    setTempResidueSelected((prev) => {
      const next = new Set([...prev].filter((p) => ok.has(p)));
      return next.size === prev.size && [...prev].every((p) => next.has(p)) ? prev : next;
    });
  }, [tempResidueEntries]);

  useEffect(() => {
    if (page !== 'taskCenter' && page !== 'config') return;
    if (!tasksHydrated) return;
    const statPaths = window.embyApi?.transcodeStatPaths;
    const candidates = tasks.filter(
      (t) =>
        t.actionType === 'transcode' &&
        t.status === 'done' &&
        Boolean(t.preReplaceHash) &&
        Boolean(t.transcodeTargetPath),
    );
    if (!statPaths || candidates.length === 0) {
      setReplaceBackupRows([]);
      return;
    }
    void (async () => {
      const pairs = candidates.map((t) => ({
        task: t,
        path: deriveReplaceBackupPath(String(t.transcodeTargetPath)),
      }));
      const paths = pairs.map((p) => p.path);
      try {
        const r = await statPaths({ paths });
        const entries = r.entries ?? [];
        const byPath = new Map(entries.map((e) => [e.path, e]));
        const rows: ReplaceBackupRow[] = [];
        for (const { task, path: bakPath } of pairs) {
          const st = byPath.get(bakPath);
          if (!st?.exists || !bakPath.endsWith('.etp.bak')) continue;
          if (deriveReplaceBackupPath(String(task.transcodeTargetPath)) !== bakPath) continue;
          rows.push({
            taskId: task.id,
            itemName: task.itemName,
            targetPath: String(task.transcodeTargetPath),
            backupPath: bakPath,
            backupBasename: bakPath.replace(/^.*[/\\]/, ''),
            size: typeof st.size === 'number' ? st.size : 0,
            closedAt: task.updatedAt,
          });
        }
        setReplaceBackupRows(rows);
      } catch {
        setReplaceBackupRows([]);
      }
    })();
  }, [page, tasks, tasksHydrated, replaceBackupRefreshKey]);

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
        const eff = effectiveRatingForPolicy(it);
        switch (manageBitrateFilter) {
          case 'transcode':
            return a === 'transcode';
          case 'upgrade':
            return a === 'upgrade';
          case 'keep':
            return a === 'keep' && eff != null && !isDeleteTierRating(eff);
          case 'no_rating':
            return eff == null;
          case 'delete':
            return isDeleteTierRating(eff);
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

  /** 电影：按策略目标码率（+ 音轨估算）预测转码后的体积总和，供侧栏与列表对照 */
  const moviePolicyTargetCapacity = useMemo(() => {
    let currentGb = 0;
    let predictedGb = 0;
    let movieCount = 0;
    for (const it of managedItems) {
      if (it.itemType !== 'Movie') continue;
      movieCount++;
      currentGb += it.sizeGb;
      predictedGb += predictedSizeGbAtPolicyTarget(it, mediaPolicy);
    }
    return {
      movieCount,
      currentGb,
      predictedGb,
      deltaGb: currentGb - predictedGb,
    };
  }, [managedItems, mediaPolicy]);

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

  async function batchRemoveSelected() {
    const ids = batchRunSelectedIds;
    if (ids.size === 0) return;
    const picked = tasks.filter((t) => ids.has(t.id));
    const needCleanup = picked.filter(
      (t) =>
        t.actionType === 'transcode' &&
        (t.status === 'executing' ||
          Boolean(t.transcodePartialPath) ||
          Boolean(t.transcodeTempDir)),
    );
    if (needCleanup.length > 0) {
      const ok = window.confirm(
        `所选 ${picked.length} 条中包含 ${needCleanup.length} 条转码任务仍有临时产物或正在执行。批量移除将尝试中止并清理临时文件，不会删除成片目录中的「替换前备份」（*.etp.bak）。是否继续？`,
      );
      if (!ok) return;
      try {
        for (const t of needCleanup) {
          await window.embyApi?.transcodeAbort?.({ taskId: t.id });
          const partial = t.transcodePartialPath;
          if (partial) await window.embyApi?.transcodeDeletePaths?.({ paths: [partial] });
          if (t.transcodeTempDir) {
            await window.embyApi?.transcodeCleanupTaskWorkdir?.({ tempDir: t.transcodeTempDir });
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
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
    const cfg = configRef.current;
    const embyOk = hasEmbyCoreForDeleteFlow(cfg, connected);

    if (!embyOk) {
      setTasks((prev) => {
        let changed = false;
        const next = prev.map((t) => {
          if (t.actionType !== 'delete' || t.status !== 'precheck') return t;
          const last = (t.flowLog ?? []).slice(-1)[0];
          if (last?.code === 'delete.blocked.no_emby' && Date.now() - new Date(last.ts).getTime() < 15000) return t;
          changed = true;
          return appendFlowLog(
            t,
            'delete.blocked.no_emby',
            '删除预检未启动：请先到配置中心完成 Emby 连接并点击「测试联通」，填写地址、API Key 与用户。',
            'warn',
          );
        });
        return changed ? next : prev;
      });
      return;
    }

    const runPrecheck = (task: MediaTask) => {
      if (deleteFlowBusyRef.current.has(task.id)) return;
      deleteFlowBusyRef.current.add(task.id);
      void (async () => {
        setTasks((prev) => {
          let changed = false;
          const next = prev.map((t) => {
            if (t.id === task.id && t.status === 'precheck') {
              changed = true;
              return appendFlowLog(t, 'delete.precheck.start', '开始删除预检：向 Emby 拉取条目信息与待删除路径。');
            }
            return t;
          });
          return changed ? next : prev;
        });
        try {
          const item = await window.embyApi.getLibraryItem({ config: cfg, itemId: task.itemId });
          const delInfo = await window.embyApi.getItemDeleteInfo({ config: cfg, itemId: task.itemId });
          const lines = formatDeleteConfirmLines(item, delInfo);
          const nowIso = new Date().toISOString();
          setTasks((prev) =>
            prev.map((t) => {
              if (t.id !== task.id || t.status !== 'precheck') return t;
              const logged = appendFlowLog(
                t,
                'delete.precheck.ok',
                '预检完成：已生成删除确认信息，请在任务中心点击「信息确认」。',
              );
              return {
                ...logged,
                status: 'awaiting_user_confirm',
                deleteConfirmLines: lines,
                progress: 25,
                updatedAt: nowIso,
              };
            }),
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const nowIso = new Date().toISOString();
          setTasks((prev) =>
            prev.map((t) => {
              if (t.id !== task.id || t.status !== 'precheck') return t;
              const logged = appendFlowLog(t, 'delete.precheck.error', msg, 'error');
              return { ...logged, status: 'failed_hard', progress: 0, updatedAt: nowIso };
            }),
          );
          setError(`删除预检失败：${msg}`);
        } finally {
          deleteFlowBusyRef.current.delete(task.id);
        }
      })();
    };

    const runDelete = (task: MediaTask) => {
      if (deleteFlowBusyRef.current.has(task.id)) return;
      deleteFlowBusyRef.current.add(task.id);
      void (async () => {
        setTasks((prev) => {
          let changed = false;
          const next = prev.map((t) => {
            if (t.id === task.id && t.status === 'executing') {
              changed = true;
              return appendFlowLog(
                t,
                'delete.api.start',
                '正在请求 Emby 删除该条目（若已填写「所选用户登录密码」，将用你的账号权限执行）。',
              );
            }
            return t;
          });
          return changed ? next : prev;
        });
        try {
          await window.embyApi.deleteLibraryItem({ config: cfg, itemId: task.itemId });
          const nowIso = new Date().toISOString();
          setTasks((prev) =>
            prev.map((t) => {
              if (t.id !== task.id || t.status !== 'executing') return t;
              const logged = appendFlowLog(t, 'delete.api.ok', '删除请求已返回，正在确认库中是否已移除该条目。');
              return { ...logged, status: 'verify', progress: 85, updatedAt: nowIso };
            }),
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const nowIso = new Date().toISOString();
          setTasks((prev) =>
            prev.map((t) => {
              if (t.id !== task.id || t.status !== 'executing') return t;
              const logged = appendFlowLog(t, 'delete.api.error', msg, 'error');
              return { ...logged, status: 'failed_hard', progress: 0, updatedAt: nowIso };
            }),
          );
          setError(`Emby 删除请求失败：${msg}`);
        } finally {
          deleteFlowBusyRef.current.delete(task.id);
        }
      })();
    };

    const runVerify = (task: MediaTask) => {
      if (deleteFlowBusyRef.current.has(task.id)) return;
      deleteFlowBusyRef.current.add(task.id);
      void (async () => {
        setTasks((prev) => {
          let changed = false;
          const next = prev.map((t) => {
            if (t.id === task.id && t.status === 'verify') {
              changed = true;
              return appendFlowLog(
                t,
                'delete.verify.start',
                '正在确认删除结果：多次检查该条目是否仍存在于媒体库（最多 12 次，每次间隔约 1.5 秒）。',
              );
            }
            return t;
          });
          return changed ? next : prev;
        });
        try {
          let gone = false;
          for (let i = 0; i < 12; i++) {
            const exists = await window.embyApi.libraryItemExists({ config: cfg, itemId: task.itemId });
            setTasks((prev) => {
              let changed = false;
              const next = prev.map((t) => {
                if (t.id === task.id && t.status === 'verify') {
                  changed = true;
                  return appendFlowLog(
                    t,
                    'delete.verify.poll',
                    `第 ${i + 1}/12 次检查：条目仍存在=${exists ? '是' : '否'}`,
                    exists ? 'warn' : 'info',
                  );
                }
                return t;
              });
              return changed ? next : prev;
            });
            if (!exists) {
              gone = true;
              break;
            }
            await new Promise((r) => setTimeout(r, 1500));
          }
          if (gone) {
            const nowIso = new Date().toISOString();
            setTasks((prev) =>
              prev.map((t) => {
                if (t.id !== task.id || t.status !== 'verify') return t;
                const logged = appendFlowLog(t, 'delete.verify.ok', '条目已从库中移除，任务完成。');
                return { ...logged, status: 'done', progress: 100, updatedAt: nowIso };
              }),
            );
            void refreshLibraryManageListRef.current?.({ quietIfIncomplete: true });
          } else {
            const nowIso = new Date().toISOString();
            setTasks((prev) =>
              prev.map((t) => {
                if (t.id !== task.id || t.status !== 'verify') return t;
                const logged = appendFlowLog(
                  t,
                  'delete.verify.timeout',
                  '多次检查后条目仍在库中，已标记为失败。',
                  'error',
                );
                return { ...logged, status: 'failed_hard', progress: 0, updatedAt: nowIso };
              }),
            );
            setError('删除后校验：条目仍存在，已标记失败（可检查 Emby 日志与权限）。');
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const nowIso = new Date().toISOString();
          setTasks((prev) =>
            prev.map((t) => {
              if (t.id !== task.id || t.status !== 'verify') return t;
              const logged = appendFlowLog(t, 'delete.verify.error', msg, 'error');
              return { ...logged, status: 'failed_hard', progress: 0, updatedAt: nowIso };
            }),
          );
          setError(`删除校验失败：${msg}`);
        } finally {
          deleteFlowBusyRef.current.delete(task.id);
        }
      })();
    };

    for (const task of tasks) {
      if (task.actionType !== 'delete') continue;
      if (task.status === 'precheck') runPrecheck(task);
      else if (task.status === 'executing') runDelete(task);
      else if (task.status === 'verify') runVerify(task);
    }
  }, [tasks, connected]);

  useEffect(() => {
    const cfg = configRef.current;
    const api = window.embyApi;
    if (!api?.transcodePrecheck || !api.transcodeStartEncode || !api.transcodeProbe || !api.transcodeReplace) {
      return;
    }

    if (!hasEmbyCoreForDeleteFlow(cfg, connected)) {
      setTasks((prev) => {
        let changed = false;
        const next = prev.map((t) => {
          if (t.actionType !== 'transcode' || t.status !== 'precheck') return t;
          const last = (t.flowLog ?? []).slice(-1)[0];
          if (last?.code === 'transcode.blocked.no_emby' && Date.now() - new Date(last.ts).getTime() < 15000) return t;
          changed = true;
          return appendFlowLog(
            t,
            'transcode.blocked.no_emby',
            '转码预检未启动：请先到配置中心完成 Emby 连接并点击「测试联通」，填写地址、API Key 与用户。',
            'warn',
          );
        });
        return changed ? next : prev;
      });
      return;
    }

    const runTcPrecheck = (task: MediaTask) => {
      if (transcodeFlowBusyRef.current.has(task.id)) return;
      transcodeFlowBusyRef.current.add(task.id);
      void (async () => {
        setTasks((prev) => {
          let changed = false;
          const next = prev.map((t) => {
            if (t.id === task.id && t.status === 'precheck') {
              changed = true;
              return appendFlowLog(t, 'transcode.precheck.start', '开始转码预检：检查临时目录、源文件路径、媒体信息与是否杜比视界片源。');
            }
            return t;
          });
          return changed ? next : prev;
        });
        try {
          const r = (await api.transcodePrecheck!({
            config: cfg,
            task: {
              id: task.id,
              itemId: task.itemId,
              transcodeDvAcknowledged: task.transcodeDvAcknowledged === true,
            },
          })) as Record<string, unknown>;
          const nowIso = new Date().toISOString();
          if (r.needsDvConfirm === true) {
            setTasks((prev) =>
              prev.map((t) => {
                if (t.id !== task.id || t.status !== 'precheck') return t;
                const logged = appendFlowLog(
                  t,
                  'transcode.precheck.dv_hold',
                  '识别为杜比视界片源：须在任务中心确认受控转码后方可继续压制。',
                  'warn',
                );
                return {
                  ...logged,
                  status: 'awaiting_user_confirm',
                  transcodeConfirmKind: 'dolby_vision' as const,
                  transcodeTempDir: String(r.tempDir ?? ''),
                  transcodePartialPath: String(r.partialPath ?? ''),
                  transcodeTargetPath: String(r.targetPath ?? ''),
                  transcodeOriginalSizeGb: typeof r.originalSizeGb === 'number' ? r.originalSizeGb : t.transcodeOriginalSizeGb,
                  transcodeDurationSec: typeof r.durationSec === 'number' ? r.durationSec : t.transcodeDurationSec,
                  transcodeIsDolbyVision: true,
                  progress: 12,
                  updatedAt: nowIso,
                };
              }),
            );
          } else {
            setTasks((prev) =>
              prev.map((t) => {
                if (t.id !== task.id || t.status !== 'precheck') return t;
                const logged = appendFlowLog(t, 'transcode.precheck.ok', '预检通过，开始转码压制。');
                return {
                  ...logged,
                  status: 'executing',
                  transcodeSubstage: 'encode' as const,
                  transcodeTempDir: String(r.tempDir ?? ''),
                  transcodePartialPath: String(r.partialPath ?? ''),
                  transcodeTargetPath: String(r.targetPath ?? ''),
                  transcodeOriginalSizeGb: typeof r.originalSizeGb === 'number' ? r.originalSizeGb : undefined,
                  transcodeDurationSec: typeof r.durationSec === 'number' ? r.durationSec : undefined,
                  transcodeIsDolbyVision: r.isDolbyVision === true,
                  progress: 15,
                  updatedAt: nowIso,
                };
              }),
            );
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const nowIso = new Date().toISOString();
          setTasks((prev) =>
            prev.map((t) => {
              if (t.id !== task.id || t.status !== 'precheck') return t;
              const logged = appendFlowLog(t, 'transcode.precheck.error', msg, 'error');
              return { ...logged, status: 'failed_hard', progress: 0, updatedAt: nowIso };
            }),
          );
          setError(`转码预检失败：${msg}`);
        } finally {
          transcodeFlowBusyRef.current.delete(task.id);
        }
      })();
    };

    const runTcEncode = (task: MediaTask) => {
      if (transcodeFlowBusyRef.current.has(task.id)) return;
      const partialPath = task.transcodePartialPath;
      const sourcePath = task.transcodeTargetPath;
      if (!partialPath || !sourcePath) return;
      transcodeFlowBusyRef.current.add(task.id);
      void (async () => {
        try {
          const cpuOnly = task.transcodeIsDolbyVision === true && task.transcodeDvAcknowledged === true;
          const gpuOk = !cpuOnly;
          const candidates = orderedInPoolCandidates(schedulerSettings.transcodeEncodePool, { cpuOnly, gpuOk });
          if (candidates.length === 0) {
            throw new Error(
              cpuOnly
                ? '编码资源池无可用 CPU 行：杜比视界受控转码需在配置中心勾选入池「cpu:libx265」一行。'
                : '编码资源池无可用设备行：请到配置中心 → 任务中心，入池至少一台 GPU 或调整 CPU 参与策略。',
            );
          }
          const orderedDeviceSlots = candidates.map((c) => ({ deviceId: c.stableKey, maxSlots: c.maxSlots }));
          await api.transcodeStartEncode!({
            config: cfg,
            taskId: task.id,
            sourcePath,
            partialPath,
            orderedDeviceSlots,
            isDolbyVision: task.transcodeIsDolbyVision === true,
            dvAcknowledged: task.transcodeDvAcknowledged === true,
            durationSec: task.transcodeDurationSec,
          });
          const nowIso = new Date().toISOString();
          setTasks((prev) =>
            prev.map((t) => {
              if (t.id !== task.id || t.status !== 'executing') return t;
              if ((t.transcodeSubstage ?? 'encode') !== 'encode') return t;
              if (t.pauseRequested) {
                return {
                  ...appendFlowLog(t, 'transcode.encode.pause_after_step', '压制已结束：检测到暂停请求，任务已暂停。'),
                  status: 'paused' as const,
                  pauseRequested: false,
                  progress: 0,
                  updatedAt: nowIso,
                };
              }
              const logged = appendFlowLog(t, 'transcode.encode.ok', '压制完成，开始校验输出文件。');
              return { ...logged, status: 'verify', progress: 88, updatedAt: nowIso };
            }),
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const nowIso = new Date().toISOString();
          try {
            if (task.transcodePartialPath) await api.transcodeDeletePaths?.({ paths: [task.transcodePartialPath] });
            if (task.transcodeTempDir) await api.transcodeCleanupTaskWorkdir?.({ tempDir: task.transcodeTempDir });
          } catch {
            /* ignore */
          }
          setTasks((prev) =>
            prev.map((t) => {
              if (t.id !== task.id) return t;
              const logged = appendFlowLog(t, 'transcode.encode.error', msg, 'error');
              return { ...logged, status: 'failed_hard', progress: 0, updatedAt: nowIso };
            }),
          );
          setError(`转码压制失败：${msg}`);
        } finally {
          transcodeFlowBusyRef.current.delete(task.id);
        }
      })();
    };

    const runTcVerify = (task: MediaTask) => {
      if (transcodeFlowBusyRef.current.has(task.id)) return;
      if (!task.transcodePartialPath) return;
      transcodeFlowBusyRef.current.add(task.id);
      void (async () => {
        try {
          const info = await api.transcodeProbe!({ config: cfg, filePath: task.transcodePartialPath! });
          const nowIso = new Date().toISOString();
          if (!info.videoCodec || info.durationSec <= 0) {
            throw new Error('校验失败：临时输出文件没有有效视频。');
          }
          setTasks((prev) => {
            const cur = prev.find((x) => x.id === task.id);
            if (!cur || cur.status !== 'verify') return prev;
            if (cur.pauseRequested) {
              return prev.map((x) =>
                x.id === task.id
                  ? {
                      ...appendFlowLog(x, 'transcode.verify.paused', '校验前已暂停任务。'),
                      status: 'paused' as const,
                      pauseRequested: false,
                      updatedAt: nowIso,
                    }
                  : x,
              );
            }
            const loggedOk = appendFlowLog(
              cur,
              'transcode.verify.partial_ok',
              `输出文件校验通过（视频编码 ${info.videoCodec}，时长约 ${info.durationSec.toFixed(1)} 秒）`,
            );
            if (schedulerSettings.transcodeAutoReplace) {
              return prev.map((x) =>
                x.id === task.id
                  ? {
                      ...loggedOk,
                      status: 'executing' as const,
                      transcodeSubstage: 'replace' as const,
                      progress: 94,
                      updatedAt: nowIso,
                    }
                  : x,
              );
            }
            return prev.map((x) =>
              x.id === task.id
                ? {
                    ...loggedOk,
                    status: 'awaiting_user_confirm' as const,
                    transcodeConfirmKind: 'replace' as const,
                    progress: 95,
                    updatedAt: nowIso,
                  }
                : x,
            );
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const nowIso = new Date().toISOString();
          try {
            if (task.transcodePartialPath) await api.transcodeDeletePaths?.({ paths: [task.transcodePartialPath] });
            if (task.transcodeTempDir) await api.transcodeCleanupTaskWorkdir?.({ tempDir: task.transcodeTempDir });
          } catch {
            /* ignore */
          }
          setTasks((prev) =>
            prev.map((t) => {
              if (t.id !== task.id) return t;
              const logged = appendFlowLog(t, 'transcode.verify.error', msg, 'error');
              return { ...logged, status: 'failed_hard', progress: 0, updatedAt: nowIso };
            }),
          );
          setError(`转码校验失败：${msg}`);
        } finally {
          transcodeFlowBusyRef.current.delete(task.id);
        }
      })();
    };

    const runTcReplace = (task: MediaTask) => {
      if (transcodeFlowBusyRef.current.has(task.id)) return;
      if (!task.transcodePartialPath || !task.transcodeTargetPath) return;
      transcodeFlowBusyRef.current.add(task.id);
      void (async () => {
        try {
          const rep = await api.transcodeReplace!({
            config: cfg,
            targetPath: task.transcodeTargetPath!,
            partialPath: task.transcodePartialPath!,
          });
          const nowIso = new Date().toISOString();
          const resultGb = rep.resultSizeBytes / (1024 * 1024 * 1024);
          setTasks((prev) =>
            prev.map((t) => {
              if (t.id !== task.id || t.status !== 'executing' || t.transcodeSubstage !== 'replace') return t;
              const logged = appendFlowLog(t, 'transcode.replace.ok', '已用新文件替换原成片，任务完成。');
              return {
                ...logged,
                status: 'done',
                progress: 100,
                preReplaceHash: rep.preReplaceHash || undefined,
                transcodeResultSizeGb: Number(resultGb.toFixed(4)),
                transcodeReplaceAttempt: 0,
                transcodeSubstage: undefined,
                updatedAt: nowIso,
              };
            }),
          );
          try {
            if (task.transcodeTempDir) await api.transcodeCleanupTaskWorkdir?.({ tempDir: task.transcodeTempDir });
          } catch {
            /* ignore */
          }
          void refreshLibraryManageListRef.current?.({ quietIfIncomplete: true });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const nowIso = new Date().toISOString();
          setTasks((prev) =>
            prev.map((t) => {
              if (t.id !== task.id) return t;
              const logged = appendFlowLog(
                t,
                'transcode.replace.error',
                `${msg}（替换步骤已在桌面端重试至多 3 次；若失败请检查临时目录中 .etp.new / .etp.bak 残留并谨慎清理）`,
                'error',
              );
              return {
                ...logged,
                status: 'failed_hard',
                progress: 0,
                transcodeReplaceAttempt: 3,
                updatedAt: nowIso,
              };
            }),
          );
          setError(`转码替换失败：${msg}`);
        } finally {
          transcodeFlowBusyRef.current.delete(task.id);
        }
      })();
    };

    for (const task of tasks) {
      if (task.actionType !== 'transcode') continue;
      if (task.status === 'precheck') runTcPrecheck(task);
      else if (task.status === 'executing' && (task.transcodeSubstage ?? 'encode') === 'encode') runTcEncode(task);
      else if (task.status === 'verify') runTcVerify(task);
      else if (task.status === 'executing' && task.transcodeSubstage === 'replace') runTcReplace(task);
    }
  }, [tasks, connected, schedulerSettings]);

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
        const itemType =
          item.itemType === 'Movie' || item.itemType === 'Episode' || item.itemType === 'Other' ? item.itemType : undefined;
        return {
          id: item.id,
          name: item.name,
          sectionId: item.sectionId,
          sectionName,
          itemType,
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
        applyAdvanceWithFlowLog(
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
    const ratingsPatch: Record<string, number> = {};
    manageSelectedIds.forEach((id) => { ratingsPatch[id] = rating as number; });
    void apiClient.patchItemRatings(ratingsPatch).catch((e) => console.error('[rating] sync failed', e));
    setManageRatingOverlay(false);
    clearManageSelection();
    setError(null);
  }

  const setSingleManagedRating = useCallback((it: ManagedMediaItem, rating: MediaRating | null) => {
    saveManagedItemMetaPatch({ [it.id]: { rating } });
    setManagedItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, rating } : x)));
    if (rating != null) {
      void apiClient.patchItemRatings({ [it.id]: rating as number }).catch((e) => console.error('[rating] sync failed', e));
    } else {
      void apiClient.patchItemRatings({ [it.id]: null }).catch((e) => console.error('[rating] sync failed', e));
    }
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
    void (async () => {
      try {
        const created = await apiClient.createTaskByIntent({
          itemId: item.id,
          actionType: action,
          runMode: schedulerSettings.runMode,
        });
        setTasks((prev) => [created, ...prev].slice(0, 300));
        const typeLabel = action === 'transcode' ? '码率压缩' : action === 'upgrade' ? '洗版' : '从 Emby 删除';
        setEnqueueHint(`已提交 1 条：${item.name}（${typeLabel}）。请到任务中心查看，筛选请选「全部」。`);
        window.setTimeout(() => setEnqueueHint(null), 5000);
      } catch (e) {
        if (e instanceof ApiConflictError) {
          setError(e.message);
        } else {
          console.error('[task] Failed to create task', e);
        }
      }
    })();
  }
  enqueueManagedActionRef.current = enqueueManagedAction;

  async function enqueueRecommendedBatch() {
    if (manageSelectedIds.size === 0) {
      setError('请先在列表中勾选要批量码率优化的条目。');
      return;
    }
    setError(null);
    const selected = managedItems.filter((it) => manageSelectedIds.has(it.id));
    let successes = 0;
    let discSkipped = 0;
    let conflictSkipped = 0;
    let noActionSkipped = 0;
    let failed = 0;

    for (const item of selected) {
      const act = recommendedAction(item, mediaPolicy);
      if (item.isBluRayDisc && (act === 'transcode' || act === 'upgrade')) {
        discSkipped++;
        continue;
      }
      if (act !== 'transcode' && act !== 'upgrade' && act !== 'delete') {
        noActionSkipped++;
        continue;
      }
      try {
        const created = await apiClient.createTaskByIntent({
          itemId: item.id,
          actionType: act,
          runMode: schedulerSettings.runMode,
        });
        setTasks((prev) => [created, ...prev].slice(0, 300));
        successes++;
      } catch (e) {
        if (e instanceof ApiConflictError) {
          conflictSkipped++;
        } else {
          failed++;
        }
      }
    }

    if (successes === 0) {
      const msg =
        conflictSkipped > 0
          ? `选中条目均无法入队（可能与进行中任务互斥，或未标注/已达标/无删除档等）。`
          : discSkipped > 0 && noActionSkipped === 0
            ? `选中条目中 ${discSkipped} 条为蓝光/原盘（.iso 或 BDMV），不支持压缩/洗版入队；其余无需排队。`
            : '选中条目中暂无需要排队的项（可能未标注星级、已达标、或无可执行动作）。';
      setError(msg);
      return;
    }
    const parts = [`已提交 ${successes} 条`];
    if (discSkipped > 0) parts.push(`跳过 ${discSkipped} 条（蓝光/原盘）`);
    if (noActionSkipped > 0) parts.push(`跳过 ${noActionSkipped} 条（未标注、已达标或删除档）`);
    if (conflictSkipped > 0) parts.push(`互斥跳过 ${conflictSkipped} 条`);
    if (failed > 0) parts.push(`失败 ${failed} 条`);
    parts.push('请到任务中心查看，筛选请选「全部」。');
    setEnqueueHint(parts.join('；'));
    window.setTimeout(() => setEnqueueHint(null), 8000);
    if (conflictSkipped > 0) {
      setError(`部分条目因互斥未入队（共 ${conflictSkipped} 条）。`);
    } else {
      setError(null);
    }
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
    setTasks((prev) => {
      let next = prev.map((t) => {
        if (!ids.has(t.id)) return t;
        if (t.status === 'pending_manual' || t.status === 'paused') {
          const u = appendFlowLog(
            { ...t, status: 'queued', pauseRequested: false, updatedAt: nowIso },
            'user.batch_execute',
            '批量执行：任务已进入排队。',
          );
          return u;
        }
        return t;
      });
      const only = schedulerSettings.runMode === 'manual' ? { onlyTaskIds: ids } : undefined;
      next = applyAdvanceWithFlowLog(next, schedulerSettings, only);
      return next;
    });
    setBatchRunning(true);
    if (window.embyApi.taskControl) {
      await window.embyApi.taskControl({ action: 'start', settings: schedulerSettings });
    }
  }

  async function markInterruptedAll() {
    setBatchRunning(false);
    if (window.embyApi.taskControl) {
      await window.embyApi.taskControl({ action: 'simulateExit' });
    }
    setTasks((prev) => applyControl(prev, 'simulateExit'));
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

  async function removeTask(taskId: string) {
    const target = tasks.find((x) => x.id === taskId);
    if (!target) return;
    const transcodeNeedsCleanup =
      target.actionType === 'transcode' &&
      (target.status === 'executing' ||
        Boolean(target.transcodePartialPath) ||
        Boolean(target.transcodeTempDir));
    if (transcodeNeedsCleanup) {
      const ok = window.confirm(
        '该转码任务在临时目录中仍有产物，或正在执行。移除将尝试中止转码并清理临时文件（partial、任务临时目录等），不会删除成片目录中的「替换前备份」（*.etp.bak）。是否继续？',
      );
      if (!ok) return;
      try {
        await window.embyApi?.transcodeAbort?.({ taskId });
        const partial = target.transcodePartialPath;
        if (partial) await window.embyApi?.transcodeDeletePaths?.({ paths: [partial] });
        if (target.transcodeTempDir) {
          await window.embyApi?.transcodeCleanupTaskWorkdir?.({ tempDir: target.transcodeTempDir });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    if (infoConfirmTaskId === taskId) setInfoConfirmTaskId(null);
    setBatchRunSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });
  }

  function toggleTempResiduePath(p: string) {
    setTempResidueSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  function toggleReplaceBackupPath(p: string) {
    setReplaceBackupSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function deleteSelectedTempResidue() {
    const paths = Array.from(tempResidueSelected);
    if (paths.length === 0) return;
    if (!window.embyApi?.transcodeDeletePaths) {
      setError('临时目录残留清理仅能在 Electron 桌面版执行。');
      return;
    }
    try {
      await window.embyApi.transcodeDeletePaths({ paths });
      setTempResidueSelected(new Set());
      const root = config.transcodeTempRoot?.trim();
      if (root && window.embyApi.transcodeScanOrphans) {
        const r = await window.embyApi.transcodeScanOrphans({ tempRoot: root });
        const entries = r.entries ?? [];
        setTempResidueEntries(entries);
        setTempResidueEmptyKind(entries.length === 0 ? 'empty' : null);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteSelectedReplaceBackups() {
    const api = window.embyApi;
    if (!api?.transcodeDeletePaths) {
      setError('删除替换前备份仅能在 Electron 桌面版执行。');
      return;
    }
    const paths = Array.from(replaceBackupSelected);
    if (paths.length === 0) return;
    const rows = replaceBackupRows.filter((r) => paths.includes(r.backupPath));
    if (rows.length !== paths.length) {
      setError('备份选择已过期，请刷新列表后重试。');
      return;
    }
    for (const r of rows) {
      if (!r.backupPath.endsWith('.etp.bak')) {
        setError('安全校验未通过：仅允许删除以 .etp.bak 结尾的备份文件。');
        return;
      }
      if (deriveReplaceBackupPath(r.targetPath) !== r.backupPath) {
        setError('安全校验未通过：备份路径与任务推导不一致。');
        return;
      }
    }
    const names = rows.map((r) => `「${r.itemName}」· ${r.backupBasename}`).join('\n');
    if (!window.confirm(`将永久删除以下替换前备份（不可恢复）：\n${names}\n\n是否继续？`)) return;
    try {
      await api.transcodeDeletePaths({ paths: rows.map((r) => r.backupPath) });
      setReplaceBackupSelected(new Set());
      setReplaceBackupRefreshKey((k) => k + 1);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteAllReplaceBackups() {
    const api = window.embyApi;
    if (!api?.transcodeDeletePaths) {
      setError('删除替换前备份仅能在 Electron 桌面版执行。');
      return;
    }
    const rows = replaceBackupRows;
    if (rows.length === 0) return;
    for (const r of rows) {
      if (!r.backupPath.endsWith('.etp.bak') || deriveReplaceBackupPath(r.targetPath) !== r.backupPath) {
        setError('安全校验未通过：列表含非法备份项，请刷新后重试。');
        return;
      }
    }
    const total = rows.reduce((s, r) => s + r.size, 0);
    const summary =
      rows.length <= 5
        ? rows.map((r) => `「${r.itemName}」· ${r.backupBasename}`).join('、')
        : `${rows
            .slice(0, 4)
            .map((r) => `「${r.itemName}」`)
            .join('、')} 等 ${rows.length} 条`;
    if (
      !window.confirm(
        `将删除当前列表中的全部 ${rows.length} 个替换前备份（合计约 ${formatByteSizeLabel(total)}）。\n${summary}\n\n是否继续？`,
      )
    )
      return;
    try {
      await api.transcodeDeletePaths({ paths: rows.map((r) => r.backupPath) });
      setReplaceBackupSelected(new Set());
      setReplaceBackupRefreshKey((k) => k + 1);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function approveQualityCandidate(taskId: string, candidateTitle: string) {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        const nowIso = new Date().toISOString();
        const logged = appendFlowLog(
          t,
          'upgrade.confirm.candidate',
          `已确认洗版候选并重新排队：${candidateTitle}`,
        );
        return {
          ...logged,
          status: 'queued',
          progress: 0,
          pauseRequested: false,
          updatedAt: nowIso,
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
    setEnqueueHint('已标记为暂无合格片源（洗版），进入等待重试节奏。');
    window.setTimeout(() => setEnqueueHint(null), 5000);
  }

  function confirmTranscodeDvTask(taskId: string) {
    const nowIso = new Date().toISOString();
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        if (t.actionType !== 'transcode' || t.transcodeConfirmKind !== 'dolby_vision') return t;
        const logged = appendFlowLog(
          t,
          'transcode.dv.user.confirm',
          '用户已确认杜比视界受控转码风险，重新进入预检',
        );
        return {
          ...logged,
          status: 'precheck',
          transcodeDvAcknowledged: true,
          transcodeConfirmKind: undefined,
          pauseRequested: false,
          progress: 5,
          updatedAt: nowIso,
        };
      }),
    );
    setInfoConfirmTaskId(null);
    setError(null);
  }

  function confirmTranscodeReplaceTask(taskId: string) {
    const nowIso = new Date().toISOString();
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        if (t.actionType !== 'transcode' || t.transcodeConfirmKind !== 'replace') return t;
        const logged = appendFlowLog(t, 'transcode.replace.user.confirm', '用户已确认替换成片，正在写入最终路径。');
        return {
          ...logged,
          status: 'executing',
          transcodeSubstage: 'replace',
          transcodeConfirmKind: undefined,
          pauseRequested: false,
          progress: Math.max(t.progress, 94),
          updatedAt: nowIso,
        };
      }),
    );
    setInfoConfirmTaskId(null);
    setError(null);
  }

  function confirmDeleteTaskExecute(taskId: string) {
    const nowIso = new Date().toISOString();
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        if (t.actionType !== 'delete' || t.status !== 'awaiting_user_confirm') return t;
        const logged = appendFlowLog(t, 'delete.user.confirm', '用户已确认删除信息，正在请求 Emby 删除。');
        return { ...logged, status: 'executing', progress: 55, pauseRequested: false, updatedAt: nowIso };
      }),
    );
    setInfoConfirmTaskId(null);
    setError(null);
  }

  function executeTaskRow(taskId: string) {
    const target = tasks.find((x) => x.id === taskId);
    if (!target || !canUserExecuteTask(target)) return;
    const nowIso = new Date().toISOString();
    setBatchRunning(true);
    setBatchRunSelectedIds((prev) => new Set(prev).add(taskId));
    setTasks((prev) => {
      const manualScope =
        schedulerSettings.runMode === 'manual'
          ? new Set<string>([...Array.from(batchRunSelectedIds), taskId])
          : undefined;
      let next = prev.map((t) => {
        if (t.id !== taskId) return t;
        if (!canUserExecuteTask(t)) return t;
        const u = appendFlowLog(
          { ...t, status: 'queued', pauseRequested: false, updatedAt: nowIso },
          'user.execute',
          '单条执行：已进入排队，并已纳入手动调度范围；将立即尝试调度推进。',
        );
        return u;
      });
      next = applyAdvanceWithFlowLog(next, schedulerSettings, manualScope ? { onlyTaskIds: manualScope } : undefined);
      const afterTask = next.find((x) => x.id === taskId);
      if (afterTask?.status === 'queued') {
        next = next.map((t) =>
          t.id === taskId
            ? appendFlowLog(
                t,
                'scheduler.queued',
                '仍在排队：当前并行任务槽可能已满，请稍候；或到配置中心检查删除、码率压缩与洗版的并发上限。',
                'warn',
              )
            : t,
        );
      }
      return next;
    });
  }

  function pauseTaskRow(taskId: string) {
    const target = tasks.find((x) => x.id === taskId);
    if (!target) return;
    if (target.status === 'pending_manual') {
      setError('任务尚未启动，无法暂停。');
      return;
    }
    if (!canUserPauseTask(target)) return;
    if (target.actionType === 'transcode' && target.status === 'executing') {
      const ok = window.confirm(
        '暂停将终止当前转码步骤（压制或替换）：进程会被结束，临时 partial 将删除，任务临时目录将清理。此操作仅处理临时目录内产物，不会删除成片目录中的「替换前备份」（*.etp.bak），原成片不会被替换。是否继续？',
      );
      if (!ok) return;
      setError(null);
      void (async () => {
        await window.embyApi?.transcodeAbort?.({ taskId });
        const partial = target.transcodePartialPath;
        if (partial) await window.embyApi?.transcodeDeletePaths?.({ paths: [partial] });
        if (target.transcodeTempDir) {
          await window.embyApi?.transcodeCleanupTaskWorkdir?.({ tempDir: target.transcodeTempDir });
        }
        const nowIso = new Date().toISOString();
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? appendFlowLog(
                  {
                    ...t,
                    status: 'paused',
                    pauseRequested: false,
                    progress: 0,
                    transcodeSubstage: undefined,
                    updatedAt: nowIso,
                  },
                  'transcode.user.pause_abort',
                  '用户确认暂停：已中止转码并清理本条临时目录中的产物。',
                )
              : t,
          ),
        );
      })();
      return;
    }
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
      itemType: item.itemType === 'Movie' || item.itemType === 'Episode' || item.itemType === 'Other' ? item.itemType : 'Movie',
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
      const action = recommendedAction(managed, mediaPolicy);
      if (managed.isBluRayDisc && (action === 'transcode' || action === 'upgrade')) {
        setEnqueueHint('已保存星级；该条目为蓝光/原盘，不支持压缩/洗版自动入队。');
        window.setTimeout(() => setEnqueueHint(null), 6000);
      } else {
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
            const created = appendFlowLog(
              enqueueTask(preview, schedulerSettings.runMode),
              'task.created',
              `海报墙打分自动入队；类型：${
                preview.actionType === 'transcode' ? '码率压缩' : preview.actionType === 'upgrade' ? '洗版' : '从 Emby 删除'
              }`,
            );
            void apiClient.createTask(created).catch((e) => console.error('[task] Failed to persist task to backend', e));
            setEnqueueHint(`已保存星级并自动入队：${item.name}。`);
            window.setTimeout(() => setEnqueueHint(null), 6000);
            return [created, ...prev].slice(0, 300);
          });
        }
      }
    } else {
      setEnqueueHint('已保存星级。可在配置中心开启「已观看并打完分后自动创建任务」。');
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

  async function saveConfig(next: EmbyConfig) {
    setConfig(next);
    const base = getRendererMediaServiceBaseUrl();
    if (base) {
      try {
        await apiClient.patchConfig(next as unknown as Record<string, unknown>);
      } catch (e) {
        console.error('[config] Failed to save to backend', e);
        throw e;
      }
    }
    pushEmbyClientToControlPlane(next);
  }

  async function saveEmbyPlayerPage() {
    if (!ensureMediaServiceOnlineForConfigSave('emby')) return;
    setConfigAsyncOp('emby-save');
    setTranscodeProbeHint(null);
    try {
      try {
        await saveConfig(config);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setConfigSaveFeedback({
          kind: 'error',
          message: formatSaveConfigFailed(`保存配置到媒体管理服务失败（${msg}）`),
          section: 'emby',
        });
        return;
      }
      setError(null);
      setConfigSaveFeedback({ kind: 'success', message: '保存配置成功。', section: 'emby' });
      scheduleConfigSuccessClear();
    } finally {
      setConfigAsyncOp(null);
    }
  }

  async function validateTranscodeToolsAction() {
    if (!ensureMediaServiceOnlineForConfigSave('scheduler')) return;
    setConfigAsyncOp('transcode-probe');
    try {
      if (!window.embyApi?.transcodeValidateTools) {
        setTranscodeProbeHint(null);
        setConfigSaveFeedback({
          kind: 'error',
          message: formatSaveConfigFailed('转码工具链检验仅能在 Electron 桌面版执行。'),
          section: 'scheduler',
        });
        return;
      }
      setTranscodeProbeHint(null);
      setError(null);
      try {
        const r = await window.embyApi.transcodeValidateTools({
          config,
          encodePool: schedulerSettings.transcodeEncodePool,
        });
        setConfigSaveFeedback({ kind: 'idle' });
        setTranscodeProbeHint(
          `检验通过：ffmpeg=${r.ffmpeg}；ffprobe=${r.ffprobe}；入池设备=${r.inPoolCount}；libplacebo=${r.libplacebo ? '可用' : '不可用（DV 路径需此滤镜）'}`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setConfigSaveFeedback({
          kind: 'error',
          message: formatSaveConfigFailed(msg),
          section: 'scheduler',
        });
      }
    } finally {
      setConfigAsyncOp(null);
    }
  }

  function saveMediaPolicyPage() {
    if (!ensureMediaServiceOnlineForConfigSave('policy')) return;
    setConfigAsyncOp('policy-save');
    try {
      try {
        localStorage.setItem(MEDIA_POLICY_KEY, JSON.stringify(mediaPolicy));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setConfigSaveFeedback({
          kind: 'error',
          message: formatSaveConfigFailed(`写入本机存储失败（${msg}）`),
          section: 'policy',
        });
        return;
      }
      setError(null);
      setConfigSaveFeedback({ kind: 'success', message: '保存配置成功。', section: 'policy' });
      scheduleConfigSuccessClear();
    } finally {
      setConfigAsyncOp(null);
    }
  }

  /** §7 任务中心：持久化调度 + 转码路径与资源池；有临时根时跑 §5.8 C11 */
  async function saveTaskCenterPage() {
    if (!ensureMediaServiceOnlineForConfigSave('scheduler')) return;
    setConfigAsyncOp('scheduler-task-save');
    try {
      const root = config.transcodeTempRoot?.trim();
      if (root && window.embyApi?.transcodeValidateTools) {
        try {
          await window.embyApi.transcodeValidateTools({
            config,
            encodePool: schedulerSettings.transcodeEncodePool,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setConfigSaveFeedback({ kind: 'error', message: formatSaveConfigFailed(msg), section: 'scheduler' });
          return;
        }
      }
      try {
        localStorage.setItem(TASK_SCHEDULER_SETTINGS_KEY, JSON.stringify(schedulerSettings));
        await saveConfig(config);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setConfigSaveFeedback({
          kind: 'error',
          message: formatSaveConfigFailed(`保存配置到媒体管理服务失败（${msg}）`),
          section: 'scheduler',
        });
        return;
      }
      setError(null);
      setConfigSaveFeedback({ kind: 'success', message: '保存配置成功。', section: 'scheduler' });
      scheduleConfigSuccessClear();
    } finally {
      setConfigAsyncOp(null);
    }
  }

  /** 仅合并写入转码 Flow 字段（§7.4）；磁盘上任务调度其它键保留为上次「保存任务中心」或默认值 */
  async function saveTranscodeFlowPage() {
    if (!ensureMediaServiceOnlineForConfigSave('scheduler')) return;
    setConfigAsyncOp('scheduler-flow-save');
    try {
      setTranscodeProbeHint(null);
      setError(null);
      if (!window.embyApi?.transcodeValidateTools) {
        setConfigSaveFeedback({
          kind: 'error',
          message: formatSaveConfigFailed('请在桌面版应用中使用本功能；当前环境无法完成检验，配置未写入。'),
          section: 'scheduler',
        });
        return;
      }
      try {
        await window.embyApi.transcodeValidateTools({
          config,
          encodePool: schedulerSettings.transcodeEncodePool,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setConfigSaveFeedback({ kind: 'error', message: formatSaveConfigFailed(msg), section: 'scheduler' });
        return;
      }

      const diskSchedRaw = localStorage.getItem(TASK_SCHEDULER_SETTINGS_KEY);
      const diskSched = diskSchedRaw
        ? normalizeSchedulerSettings(JSON.parse(diskSchedRaw) as Partial<TaskSchedulerSettings>)
        : defaultSchedulerSettings();
      const mergedSched: TaskSchedulerSettings = {
        ...diskSched,
        transcodeConcurrency: schedulerSettings.transcodeConcurrency,
        transcodeAutoReplace: schedulerSettings.transcodeAutoReplace,
        transcodeEncodePool: schedulerSettings.transcodeEncodePool,
      };

      const diskCfgRaw = localStorage.getItem(STORAGE_KEY);
      const diskCfg = diskCfgRaw ? normalizeConfig(JSON.parse(diskCfgRaw) as Partial<EmbyConfig>) : defaultConfig;
      const mergedCfg: EmbyConfig = {
        ...diskCfg,
        transcodeTempRoot: config.transcodeTempRoot,
        ffmpegPath: config.ffmpegPath,
        ffprobePath: config.ffprobePath,
      };
      try {
        localStorage.setItem(TASK_SCHEDULER_SETTINGS_KEY, JSON.stringify(mergedSched));
        await saveConfig(mergedCfg);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setConfigSaveFeedback({
          kind: 'error',
          message: formatSaveConfigFailed(`保存配置到媒体管理服务失败（${msg}）`),
          section: 'scheduler',
        });
        return;
      }

      setConfigSaveFeedback({ kind: 'success', message: '保存配置成功。', section: 'scheduler' });
      scheduleConfigSuccessClear();
    } finally {
      setConfigAsyncOp(null);
    }
  }

  async function saveDoubanSessionPage() {
    if (!ensureMediaServiceOnlineForConfigSave('douban')) return;
    if (!window.doubanApi) {
      setConfigSaveFeedback({
        kind: 'error',
        message: formatSaveConfigFailed('豆瓣会话仅能在 Electron 桌面版保存（浏览器调试无此能力）。'),
        section: 'douban',
      });
      return;
    }
    setConfigAsyncOp('douban-save');
    try {
      setError(null);
      try {
        await window.doubanApi.saveSession({
          cookieHeader: doubanCookieDraft.trim(),
          userId: doubanUserIdDraft.trim(),
        });
        setConfigSaveFeedback({
          kind: 'success',
          message: '已写入本机应用数据目录；若填写了 Cookie，请勿分享给他人。',
          section: 'douban',
        });
        scheduleConfigSuccessClear();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setConfigSaveFeedback({
          kind: 'error',
          message: formatSaveConfigFailed(msg),
          section: 'douban',
        });
      }
    } finally {
      setConfigAsyncOp(null);
    }
  }

  async function syncDoubanRatingsFromWeb() {
    const api = window.doubanApi;
    if (!api) {
      setError('豆瓣同步仅能在 Electron 桌面版使用。');
      return;
    }
    let thisSyncIsFull = false;
    try {
      const lastFullRaw = localStorage.getItem(DOUBAN_LAST_FULL_SYNC_KEY);
      const lastFullAt = lastFullRaw ? Number(lastFullRaw) : 0;
      thisSyncIsFull = !lastFullAt || Number.isNaN(lastFullAt) || Date.now() - lastFullAt > DOUBAN_FULL_SYNC_INTERVAL_MS;
    } catch {
      thisSyncIsFull = true;
    }

    setDoubanSyncBusy(true);
    setError(null);
    setDoubanFetchStatus(thisSyncIsFull ? '连接豆瓣（定期全量同步）…' : '连接豆瓣…');
    const unsub = api.onProgress((p) => {
      if (Array.isArray(p.allEntries)) {
        const normalized = wireToDoubanEntries(p.allEntries);
        saveDoubanRatingEntries(normalized);
        setDoubanRatingEntries(normalized);
      }
      if (!p.done) {
        setDoubanFetchStatus(
          `已合并 ${p.allEntries?.length ?? 0} 条评分 · 第 ${p.pageIndex + 1} 页（本页 ${p.pageSize} 条）`,
        );
      } else {
        if (!p.cancelled && thisSyncIsFull) {
          try {
            localStorage.setItem(DOUBAN_LAST_FULL_SYNC_KEY, String(Date.now()));
          } catch {
            // ignore
          }
        }
        setDoubanFetchStatus(
          p.cancelled
            ? `已停止 · 本地保留 ${p.allEntries?.length ?? 0} 条`
            : `已完成 · 共 ${p.allEntries?.length ?? 0} 条`,
        );
      }
    });
    try {
      const result = await api.fetchRatings({
        incremental: !thisSyncIsFull,
        existingEntries: doubanRatingEntries.map((e) => ({
          subjectId: e.subjectId,
          title: e.title,
          stars: e.stars,
        })),
      });
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
    void window.doubanApi?.stopFetch?.()?.catch(() => {});
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
      const at = await saveLibraryManageCache(config, list);
      if (at) setLibraryManageCacheSavedAt(at);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  refreshLibraryManageListRef.current = refreshLibraryManageList;

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
              ['scheduler', '任务中心'] as const,
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

    const schedulerSectionBusy =
      configAsyncOp === 'scheduler-task-save' ||
      configAsyncOp === 'scheduler-flow-save' ||
      configAsyncOp === 'transcode-probe' ||
      configAsyncOp === 'encode-device-probe';

    return (
      <AppShell page={page} setPage={setPage} sidebar={configSidebar} error={error} mediaGate={mediaServiceReachable} onSettingsClick={onSettingsClick}>
        <div className="panel">
          {configSaveFeedback.kind !== 'idle' && configSaveFeedback.section === configSection ? (
            <div
              role={configSaveFeedback.kind === 'error' ? 'alert' : 'status'}
              className={
                configSaveFeedback.kind === 'success'
                  ? 'configFeedback configFeedbackSuccess'
                  : 'configFeedback configFeedbackError'
              }
            >
              {configSaveFeedback.message}
            </div>
          ) : null}
          {configSection === 'scheduler' && transcodeProbeHint ? (
            <div role="status" className="configFeedback configFeedbackProbe">
              {transcodeProbeHint}
            </div>
          ) : null}
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
                  <div className="field" style={{ marginTop: 12 }}>
                    <div className="label">所选用户登录密码（可选，删除等媒体写操作用）</div>
                    <input
                      type="password"
                      autoComplete="off"
                      placeholder="与 Emby 网页登录相同；仅保存在本机，用于换取用户 AccessToken"
                      value={config.embyUserPassword}
                      onChange={(e) => setConfig({ ...config, embyUserPassword: e.target.value })}
                    />
                    <p className="hint" style={{ marginTop: 6 }}>
                      若删除接口报 Parameter &apos;user&apos; null：请填写此项。API Key 无法代替「以用户身份」删除。
                    </p>
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
                  <div className="label">播放器命令行参数</div>
                  <input
                    value={config.argsTemplate}
                    onChange={(e) => setConfig({ ...config, argsTemplate: e.target.value })}
                    placeholder='例如："{path}" /new'
                  />
                </div>
              </div>
              <div className="row">
                <div className="field">
                  <div className="label">视为已看完的最低进度（%）</div>
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
                <button
                  type="button"
                  className="primary"
                  disabled={configAsyncOp === 'emby-save'}
                  onClick={() => void saveEmbyPlayerPage()}
                >
                  {configAsyncOp === 'emby-save' ? '保存中…' : '保存本页（Emby / 播放器 / 阈值 / 路径映射）'}
                </button>
              </div>
            </>
          ) : null}

          {configSection === 'policy' ? (
            <>
              <h3>目标码率策略（H265 等效）</h3>
              <p className="hint">
                用于媒体库管理与任务预览。星级来源：已匹配豆瓣分的<strong>电影</strong>以<strong>豆瓣星级</strong>为准，否则以<strong>本地标注</strong>为准。<strong>1–2★</strong>删除档；<strong>3★</strong>仅当等价码率明显高于本档目标时可<strong>转码压缩</strong>，偏低不洗版；<strong>4★</strong>可转码，且当等价码率低于本档目标的
                <strong> 80% </strong>
                时可<strong>洗版</strong>（与 5★4K 共用该比例）；<strong>5★</strong>不压缩，其中<strong>1080p 一律建议洗版</strong>，<strong>4K</strong>则仅在低于该80% 阈值时洗版。列表中的<strong>目标码率 / 预测体积</strong>：5★ 且当前为 1080p 时按<strong>4K 档目标</strong>估算（洗版后预期）。编辑后请保存。
              </p>
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
                <button
                  type="button"
                  className="primary"
                  disabled={configAsyncOp === 'policy-save'}
                  onClick={() => saveMediaPolicyPage()}
                >
                  {configAsyncOp === 'policy-save' ? '保存中…' : '保存码率策略'}
                </button>
              </div>
            </>
          ) : null}

          {configSection === 'scheduler' ? (
            <>
              <h3>任务中心</h3>
              <p className="hint" style={{ lineHeight: 1.55 }}>
                在此配置任务调度、删除与洗版相关节奏、转码临时目录与编码资源池等。保存「任务中心」将写入本机任务调度数据，并同步 Emby
                配置中的转码路径字段。若填写了<strong>转码临时根</strong>，保存前会先进行工具链与资源池检验（也可单独点击「检验转码资源池」）。
              </p>

              <h3 className="configSubSectionTitle">任务调度</h3>
              <p className="hint">
                新任务加入队列后的执行方式，以及海报墙是否自动建任务。删除、码率压缩、洗版各自能同时进行几路及其它洗版选项，在下方对应小节中设置。
              </p>
              <div className="field" style={{ marginTop: 12 }}>
                <div className="label">新任务执行方式（二选一）</div>
                <div className="configRunModeGroup">
                  <label className="configRunModeOption">
                    <input
                      type="radio"
                      name="etp-scheduler-run-mode"
                      checked={schedulerSettings.runMode === 'scheduled'}
                      onChange={() =>
                        setSchedulerSettings((prev) => ({ ...prev, runMode: 'scheduled' }))
                      }
                    />
                    <span>新任务添加后自动执行</span>
                  </label>
                  <label className="configRunModeOption">
                    <input
                      type="radio"
                      name="etp-scheduler-run-mode"
                      checked={schedulerSettings.runMode === 'manual'}
                      onChange={() => setSchedulerSettings((prev) => ({ ...prev, runMode: 'manual' }))}
                    />
                    <span>新任务添加后手动执行</span>
                  </label>
                </div>
              </div>
              <label className="sectionItem" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
                <input
                  type="checkbox"
                  checked={schedulerSettings.wallRatingAutoEnqueue}
                  onChange={(e) =>
                    setSchedulerSettings((p) => ({ ...p, wallRatingAutoEnqueue: e.target.checked }))
                  }
                />
                <span>已观看并打完分后自动创建任务</span>
              </label>

              <h3 className="configSubSectionTitle" style={{ marginTop: 28 }}>
                删除相关
              </h3>
              <p className="hint">删除任务在任务中心完成信息确认与执行；本区预留与删除流程相关的扩展配置。</p>
              <div className="field" style={{ marginTop: 12 }}>
                <div className="label">同时进行的删除任务数</div>
                <input
                  type="number"
                  min={1}
                  value={schedulerSettings.deleteConcurrency}
                  onChange={(e) =>
                    setSchedulerSettings((prev) => ({
                      ...prev,
                      deleteConcurrency: Math.max(1, Number(e.target.value) || 1),
                    }))
                  }
                />
              </div>

              <h3 className="configSubSectionTitle" style={{ marginTop: 28 }}>
                转码与临时目录
              </h3>
              <p className="hint" style={{ lineHeight: 1.55 }}>
                临时目录、ffmpeg/ffprobe 路径，以及<strong>编码资源池</strong>（探测本机设备 → 入池、子槽上限、排序优先级、CPU 参与策略）。已不再使用与资源池冲突的全局「自动编码器」下拉。
              </p>
              <div className="field" style={{ marginTop: 12 }}>
                <div className="label" title="配置键 transcodeConcurrency">
                  同时进行的码率压缩任务数
                </div>
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
                <p className="hint" style={{ marginTop: 6 }}>
                  与下方<strong>编码资源池每设备子槽</strong>同时生效，取更紧的一层。
                </p>
              </div>
              <label className="sectionItem" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={schedulerSettings.transcodeAutoReplace}
                  onChange={(e) =>
                    setSchedulerSettings((p) => ({ ...p, transcodeAutoReplace: e.target.checked }))
                  }
                />
                <span>校验通过后自动替换成片（跳过替换前确认）</span>
              </label>
              <div className="field" style={{ marginTop: 12 }}>
                <div className="label">转码临时根目录</div>
                <input
                  value={config.transcodeTempRoot}
                  onChange={(e) => setConfig({ ...config, transcodeTempRoot: e.target.value })}
                  placeholder={'例如：D:\\\\Temp\\\\EmbyTranscode'}
                />
              </div>
              <div className="row">
                <div className="field">
                  <div className="label">ffmpeg 路径（可选）</div>
                  <input
                    value={config.ffmpegPath}
                    onChange={(e) => setConfig({ ...config, ffmpegPath: e.target.value })}
                    placeholder="留空：内置 / 环境变量 / PATH"
                  />
                </div>
                <div className="field">
                  <div className="label">ffprobe 路径（可选）</div>
                  <input
                    value={config.ffprobePath}
                    onChange={(e) => setConfig({ ...config, ffprobePath: e.target.value })}
                    placeholder="留空：内置 / 环境变量 / PATH"
                  />
                </div>
              </div>
              <div className="actions" style={{ marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
                <button
                  type="button"
                  disabled={schedulerSectionBusy}
                  onClick={() => {
                    void (async () => {
                      if (!ensureMediaServiceOnlineForConfigSave('scheduler')) return;
                      if (!window.embyApi?.transcodeProbeEncodeDevices) {
                        setConfigSaveFeedback({
                          kind: 'error',
                          message: formatSaveConfigFailed('编码设备探测仅支持 Electron 桌面版。'),
                          section: 'scheduler',
                        });
                        return;
                      }
                      setError(null);
                      setConfigAsyncOp('encode-device-probe');
                      try {
                        const r = await window.embyApi.transcodeProbeEncodeDevices({ config });
                        setSchedulerSettings((prev) => ({
                          ...prev,
                          transcodeEncodePool: mergeProbeIntoPool(r.devices, prev.transcodeEncodePool),
                        }));
                      } catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        setConfigSaveFeedback({
                          kind: 'error',
                          message: formatSaveConfigFailed(msg),
                          section: 'scheduler',
                        });
                      } finally {
                        setConfigAsyncOp(null);
                      }
                    })();
                  }}
                >
                  {configAsyncOp === 'encode-device-probe' ? '探测中…' : '刷新编码设备探测'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSchedulerSettings((p) => ({
                      ...p,
                      transcodeEncodePool: suggestPoolPrioritiesFromProbeOrder(p.transcodeEncodePool),
                    }))
                  }
                >
                  将优先级与当前顺序对齐（0,10,20…）
                </button>
              </div>
              <div className="field" style={{ marginTop: 16 }}>
                <div className="label">CPU 参与策略</div>
                <select
                  className="selectLike"
                  value={schedulerSettings.transcodeEncodePool.cpuParticipation}
                  onChange={(e) =>
                    setSchedulerSettings((p) => ({
                      ...p,
                      transcodeEncodePool: {
                        ...p.transcodeEncodePool,
                        cpuParticipation: Number(e.target.value) === 2 ? 2 : 1,
                      },
                    }))
                  }
                >
                  <option value={1}>策略 1：CPU 与 GPU 一样按优先级参与池</option>
                  <option value={2}>策略 2：CPU 仅服务「只能 CPU 压」的任务（如 DV 确认后）</option>
                </select>
              </div>
              <p className="hint" style={{ marginTop: 8 }}>
                设备表：勾选<strong>入池</strong>、设置<strong>子槽上限</strong>（该设备同时几路压制）。<strong>顺序</strong>：拖拽左侧手柄排序，<strong>越靠上越优先</strong>尝试占槽（保存后写入 priority 字段）。
              </p>
              <div style={{ overflowX: 'auto', marginTop: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, border: '1px solid rgba(255,255,255,0.12)' }}>
                  <thead>
                    <tr>
                      <th style={{ padding: 6, width: 40 }} aria-label="拖拽排序" />
                      <th style={{ padding: 6, width: 48 }}>顺序</th>
                      <th style={{ textAlign: 'left', padding: 6 }}>编码设备</th>
                      <th style={{ padding: 6 }}>入池</th>
                      <th style={{ padding: 6 }}>子槽</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedulerSettings.transcodeEncodePool.entries.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ padding: 12, opacity: 0.75 }}>
                          尚无探测结果。请点击「刷新编码设备探测」，或保存后于 Electron 中重试。
                        </td>
                      </tr>
                    ) : (
                      sortEncodePoolEntriesForDisplay(schedulerSettings.transcodeEncodePool.entries).map((row, displayIndex) => (
                        <tr
                          key={row.stableKey}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            const from = e.dataTransfer.getData('application/x-etp-pool-key');
                            if (!from || from === row.stableKey) return;
                            setSchedulerSettings((p) => ({
                              ...p,
                              transcodeEncodePool: {
                                ...p.transcodeEncodePool,
                                entries: reorderEncodePoolEntries(p.transcodeEncodePool.entries, from, row.stableKey),
                              },
                            }));
                          }}
                        >
                          <td
                            style={{ padding: 6, textAlign: 'center', cursor: 'grab', userSelect: 'none', opacity: 0.85 }}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData('application/x-etp-pool-key', row.stableKey);
                              e.dataTransfer.effectAllowed = 'move';
                            }}
                            title="拖拽以调整优先级（越靠上越优先）"
                          >
                            <span aria-hidden style={{ fontSize: 15, lineHeight: 1, opacity: 0.95 }}>
                              {'\u22EE'}
                              {'\u22EE'}
                            </span>
                          </td>
                          <td style={{ padding: 6, textAlign: 'center', opacity: 0.9 }}>{displayIndex + 1}</td>
                          <td style={{ padding: 6, fontFamily: 'monospace' }}>{row.stableKey}</td>
                          <td style={{ padding: 6, textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={row.inPool}
                              onChange={(e) =>
                                setSchedulerSettings((p) => ({
                                  ...p,
                                  transcodeEncodePool: {
                                    ...p.transcodeEncodePool,
                                    entries: p.transcodeEncodePool.entries.map((x) =>
                                      x.stableKey === row.stableKey ? { ...x, inPool: e.target.checked } : x,
                                    ),
                                  },
                                }))
                              }
                            />
                          </td>
                          <td style={{ padding: 6 }}>
                            <input
                              type="number"
                              min={1}
                              style={{ width: 64 }}
                              value={row.maxSlots}
                              onChange={(e) =>
                                setSchedulerSettings((p) => ({
                                  ...p,
                                  transcodeEncodePool: {
                                    ...p.transcodeEncodePool,
                                    entries: p.transcodeEncodePool.entries.map((x) =>
                                      x.stableKey === row.stableKey
                                        ? { ...x, maxSlots: Math.max(1, Number(e.target.value) || 1) }
                                        : x,
                                    ),
                                  },
                                }))
                              }
                            />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="actions" style={{ marginTop: 14 }}>
                <button
                  type="button"
                  className="primary"
                  disabled={schedulerSectionBusy}
                  onClick={() => void saveTranscodeFlowPage()}
                >
                  {configAsyncOp === 'scheduler-flow-save' ? '保存中…' : '保存转码相关配置'}
                </button>
              </div>
              <p className="hint" style={{ marginTop: 12, lineHeight: 1.55, whiteSpace: 'pre-line' }}>
                {describeTranscodePoolForUser(schedulerSettings.transcodeEncodePool)}
              </p>

              <h3 className="configSubSectionTitle" style={{ marginTop: 28 }}>
                洗版
              </h3>
              <p className="hint" style={{ lineHeight: 1.55 }}>
                洗版（更高质量片源）的并行上限与「等待片源」时的重试节奏见下列项。洗版不占用转码编码资源池。
              </p>
              <div className="field" style={{ marginTop: 12 }}>
                <div className="label">同时进行的洗版任务数</div>
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
              <div className="row" style={{ marginTop: 4 }}>
                <div className="field">
                  <div className="label">洗版 · 快速重搜次数</div>
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
              </div>
              <div className="row">
                <div className="field">
                  <div className="label">洗版 · 中速阶段上限次数</div>
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
              </div>
              <div className="row">
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

              <div className="actions" style={{ marginTop: 20 }}>
                <button
                  type="button"
                  className="primary"
                  disabled={schedulerSectionBusy}
                  onClick={() => void saveTaskCenterPage()}
                >
                  {configAsyncOp === 'scheduler-task-save' ? '保存中…' : '保存任务中心'}
                </button>
                <button type="button" disabled={schedulerSectionBusy} onClick={() => void validateTranscodeToolsAction()}>
                  {configAsyncOp === 'transcode-probe' ? '检验中…' : '检验转码资源池'}
                </button>
              </div>
            </>
          ) : null}

          {configSection === 'douban' ? (
            <>
              <h3>豆瓣个人评分同步（实验）</h3>
              <p className="hint" style={{ lineHeight: 1.55 }}>
                从豆瓣电影「看过」公开列表（仅电影、按时间排序）解析个人星标，写入本机后与媒体库中的<strong>电影</strong>片名匹配。同步与<strong>本地缓存合并</strong>；平时增量翻页，约每14 天自动全量一次。一般<strong>只需填写用户 ID</strong>即可；自动化访问可能违反豆瓣服务条款，请自担风险，翻页间隔约 0.8 秒。
              </p>
              <div className="field" style={{ marginTop: 16 }}>
                <div className="label">豆瓣用户 ID（电影「看过」页 URL 中 people/ 与 /collect 之间）</div>
                <input
                  value={doubanUserIdDraft}
                  onChange={(e) => setDoubanUserIdDraft(e.target.value)}
                  placeholder="多为纯数字，例如3235934；与浏览器地址栏一致"
                  autoComplete="off"
                />
              </div>
              <details style={{ marginTop: 14 }} className="doubanCookieOptional">
                <summary style={{ cursor: 'pointer', fontWeight: 600, userSelect: 'none' }}>
                  可选：Cookie（多数情况请留空）
                </summary>
                <p className="hint" style={{ marginTop: 10, lineHeight: 1.5 }}>
                  公开「看过」列表无需登录即可抓取。若同步条数明显偏少、频繁失败，或你的看过列表仅登录后可见，可粘贴浏览器里豆瓣域名的 Cookie；仍仅保存在本机应用数据目录。
                </p>
                <div className="field" style={{ marginTop: 8 }}>
                  <div className="label">Cookie字符串</div>
                  <textarea
                    value={doubanCookieDraft}
                    onChange={(e) => setDoubanCookieDraft(e.target.value)}
                    placeholder="留空即可；需要时再粘贴"
                    rows={4}
                    style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
                    autoComplete="off"
                  />
                </div>
              </details>
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  disabled={!window.doubanApi || configAsyncOp === 'douban-save'}
                  onClick={() => void saveDoubanSessionPage()}
                >
                  {configAsyncOp === 'douban-save' ? '保存中…' : '保存豆瓣会话到本机'}
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
      <AppShell page={page} setPage={setPage} sidebar={historySidebar} error={error} mediaGate={mediaServiceReachable} onSettingsClick={onSettingsClick}>
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
    let movieTargetCompareLine = '—';
    if (moviePolicyTargetCapacity.movieCount > 0) {
      const d = moviePolicyTargetCapacity.deltaGb;
      const deltaWord = d >= 0 ? '约省' : '约增';
      const deltaAbs = formatAggregateLibrarySizeGb(Math.abs(d));
      movieTargetCompareLine = `${formatAggregateLibrarySizeGb(moviePolicyTargetCapacity.currentGb)} → ${formatAggregateLibrarySizeGb(
        moviePolicyTargetCapacity.predictedGb,
      )}（${deltaWord} ${deltaAbs}）`;
    }
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
            <option value="delete">删除档（1–2 星）</option>
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
          在配置中心保存用户 ID 后同步。匹配到豆瓣分的电影，<strong>码率策略与列表「星级状态」优先用豆瓣星</strong>；无豆瓣分时用本地标注。仅<strong>电影</strong>行参与豆瓣匹配。
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
          title="对勾选条目按策略批量入队（含删除档、压缩、洗版）"
        >
          按策略批量入队
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
        <div className="sidebarField" style={{ marginTop: 10 }}>
          <div className="label">电影 · 按目标码率预测占用</div>
          <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {moviePolicyTargetCapacity.movieCount === 0
              ? '—'
              : formatAggregateLibrarySizeGb(moviePolicyTargetCapacity.predictedGb)}
          </div>
          <div className="label" style={{ marginTop: 8 }}>相对当前电影占用</div>
          <div style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', opacity: 0.92 }}>{movieTargetCompareLine}</div>
          <p className="sidebarHint" style={{ marginTop: 6, marginBottom: 0 }}>
            每条电影按侧栏策略<strong>目标视频码率</strong>加0.5 Mbps 音轨估算重算体积；无星级条目保持当前体积，1–2 星按删除档计0。
            剧集不在此汇总。容器开销未计，原盘多文件结构仅供参考。
          </p>
        </div>
        <p className="sidebarHint">
          列表覆盖<strong>已启用媒体库</strong>内的电影/剧集，<strong>含已观看</strong>；与海报墙「仅未播放」不同。展示数据来自本地缓存；与 Emby 对齐须主动点侧栏「刷新媒体库列表」（进入本页不会自动拉取）。
        </p>
        <p className="sidebarHint">
          目标码率梯度以配置中心<strong>媒体策略</strong>为准；星级取豆瓣优先、否则本地（见列表「星级状态」）。动作规则：1–2★删除档；3★仅压缩；4★可压缩或低于目标80%时洗版；5★不压缩、1080p 必洗版、4K 低于80% 时洗版。5★且当前为1080p 时，目标码率/预测体积按<strong>4K 档</strong>估算。
        </p>
      </>
    );

    return (
      <>
      <AppShell page={page} setPage={setPage} sidebar={mediaSidebar} error={error} mediaGate={mediaServiceReachable} onSettingsClick={onSettingsClick}>
        <div className="panel">
          <div className="hint">
            转码、洗版与删除任务在任务中心操作。当前任务池：共 {taskSummary.total} 条，排队 {taskSummary.queued}，执行中 {taskSummary.running}。
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
                  <div>预测体积</div>
                  <div>视频格式</div>
                  <div>星级状态</div>
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
            <div style={{ fontWeight: 800 }}>1–2 星 · 删除档说明</div>
            <p className="hint" style={{ marginTop: 10, lineHeight: 1.55 }}>
              产品定义：1–2 星表示计划从库中移除该片（低质片源不再保留）。删除走<strong>任务中心</strong>：预检 → <strong>信息确认</strong>（必须手动确认，自动模式也不会跳过）→ 调用 <strong>Emby</strong> 删除条目（库与磁盘以服务器行为为准）。
            </p>
            <p className="hint" style={{ lineHeight: 1.55 }}>
              请点击行内「加入删除任务」，在任务中心完成「信息确认」与执行；验收以 Emby 上该条目已不存在为准。
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
        <p className="sidebarHint">
          新任务执行方式、海报墙自动建任务在「配置中心 → 任务中心 → 任务调度」；洗版并行与重试节奏在「洗版」小节；删除与码率压缩并行在对应小节。
        </p>
        <p className="sidebarHint">
          <strong>新任务添加后手动执行</strong>：可勾选「参与手动批量」后点<strong>批量执行</strong>；也可对单条点<strong>执行</strong>（会自动纳入调度范围并尝试立即推进）。占槽中点<strong>暂停</strong>为软停（本步收尾后再暂停）。
        </p>
        <p className="sidebarHint">
          <strong>新任务添加后自动执行</strong>：新任务入队即为排队中；<strong>批量执行</strong>可对勾选条目做同上发令，并启动/保持调度计时。
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
        <button
          type="button"
          className="sidebarFullWidth"
          onClick={() => void batchRemoveSelected()}
          disabled={batchRunSelectedIds.size === 0}
        >
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
        <div className="sidebarDivider" />
        <div className="sidebarMuted">任务维护</div>
        <button type="button" className="sidebarFullWidth" onClick={() => clearAllPausedToQueued()} disabled={taskSummary.paused === 0}>
          恢复全部已暂停任务
        </button>
        <button type="button" className="sidebarFullWidth" onClick={() => refreshWaitingMediaSourceNow()}>
          立即重试等待片源
        </button>
        <div className="sidebarDivider" />
        <details className="sidebarAdvanced">
          <summary className="sidebarMuted">高级选项</summary>
          <button type="button" className="sidebarFullWidth" onClick={() => injectDebugSeedTasks()} style={{ marginTop: 8 }}>
            添加测试任务
          </button>
          <button type="button" className="sidebarFullWidth" onClick={() => void markInterruptedAll()}>
            模拟程序退出
          </button>
          <button type="button" className="sidebarFullWidth" onClick={() => void resumeInterrupted()}>
            恢复中断任务
          </button>
        </details>
      </>
    );

    return (
      <>
        <AppShell page={page} setPage={setPage} sidebar={taskSidebar} error={error} mediaGate={mediaServiceReachable} onSettingsClick={onSettingsClick}>
          <div className="panel">
            <h3>任务状态</h3>
            <p className="hint">
              共 {taskSummary.total} 条 · 待启动 {taskSummary.pendingManual} · 排队中 {taskSummary.queued} · 进行中 {taskSummary.running} ·
              等待媒体片源 {taskSummary.waitingMediaSource} · 已暂停 {taskSummary.paused} · 中断 {taskSummary.interrupted}
            </p>
            <h3 style={{ marginTop: 20 }}>任务操作与明细</h3>
            <p className="hint">
              每条任务下方展开<strong>执行日志</strong>，记录各步骤进度（含删除前检查、与 Emby 通信、删除结果确认等），保存在本机队列便于排查。
            </p>
            <label className="sectionItem hint" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={showFlowLogTechnical}
                onChange={(e) => setShowFlowLogTechnical(e.target.checked)}
              />
              <span>执行日志显示技术详情（含内部步骤代码）</span>
            </label>
            {enqueueHint ? (
              <div className="hint" style={{ marginTop: 8, color: '#86efac' }}>
                {enqueueHint}
              </div>
            ) : null}
            {filteredTasks.length === 0 ? (
              <div className="hint" style={{ marginTop: 12 }}>
                {tasks.length === 0
                  ? '暂无任务。可在「媒体库管理」或「海报墙」打分后自动创建任务。'
                  : `当前筛选条件下无任务。共 ${tasks.length} 条任务，可调整筛选条件查看。`}
              </div>
            ) : (
              <div className="historyList" style={{ marginTop: 12 }}>
                {filteredTasks.map((t) => {
                  const batchToggleable = isTaskBatchToggleable(t);
                  const statusZh = taskStatusLabelZh(t.status);
                  const transcodeVolLine = transcodeVolumeSummaryLine(t);
                  const isSelected = batchRunSelectedIds.has(t.id);
                  const badgeClass =
                    t.status === 'done' ? 'statusBadge--done'
                    : t.status === 'executing' || t.status === 'precheck' || t.status === 'verify' ? 'statusBadge--executing'
                    : t.status === 'queued' || t.status === 'pending_manual' ? 'statusBadge--queued'
                    : t.status === 'paused' || t.status === 'waiting_media_source' || t.status === 'awaiting_user_confirm' ? 'statusBadge--paused'
                    : t.status === 'failed_hard' ? 'statusBadge--failed_hard'
                    : 'statusBadge--interrupted';
                  return (
                    <div key={t.id} className={`historyItem${isSelected ? ' taskCardSelected' : ''}`}>
                      <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="checkbox"
                            disabled={!batchToggleable}
                            checked={isSelected}
                            onChange={() => toggleBatchRunSelect(t.id)}
                            title={batchToggleable ? '勾选后可批量执行' : '当前状态不可批量操作'}
                            style={{ cursor: batchToggleable ? 'pointer' : 'not-allowed' }}
                          />
                          <span>{t.itemName}</span>
                        </div>
                        <span className={`statusBadge ${badgeClass}`} title={statusZh}>
                          {statusZh}
                        </span>
                      </div>
                      <div className="hint" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span>
                          {t.actionType === 'transcode'
                            ? '码率压缩'
                            : t.actionType === 'upgrade'
                              ? '洗版'
                              : '从 Emby 删除'}
                        </span>
                        <span>·</span>
                        <span className="tabular-nums">进度 {t.progress}%</span>
                        {t.pauseRequested ? (
                          <>
                            <span>·</span>
                            <span style={{ color: '#fbbf24' }}>本步收尾后将暂停</span>
                          </>
                        ) : null}
                      </div>
                      {transcodeVolLine ? (
                        <div
                          className="hint tabular-nums"
                          style={{
                            color:
                              t.transcodeOriginalSizeGb != null &&
                              t.transcodeResultSizeGb != null &&
                              t.transcodeOriginalSizeGb > t.transcodeResultSizeGb
                                ? '#86efac'
                                : undefined,
                          }}
                        >
                          {transcodeVolLine}
                        </div>
                      ) : null}
                      <div className="hint tabular-nums">
                        {formatPlayedAt(t.updatedAt)}
                        {t.status === 'waiting_media_source' ? ` · ${nextManualRefreshInfo(t.retryCount, schedulerSettings)}` : ''}
                      </div>
                      <div className="historyRowActions" style={{ flexWrap: 'wrap', gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => executeTaskRow(t.id)}
                          disabled={!canUserExecuteTask(t)}
                          title={canUserExecuteTask(t) ? '立即执行此任务' : '当前状态不可执行'}
                        >
                          执行
                        </button>
                        <button
                          type="button"
                          onClick={() => pauseTaskRow(t.id)}
                          disabled={!canUserPauseTask(t)}
                          title={canUserPauseTask(t) ? '暂停任务（本步收尾后）' : '当前状态不可暂停'}
                        >
                          暂停
                        </button>
                        <button
                          type="button"
                          onClick={() => setInfoConfirmTaskId(t.id)}
                          disabled={t.status !== 'awaiting_user_confirm'}
                          title={t.status === 'awaiting_user_confirm' ? '确认任务信息' : '仅在待确认状态可用'}
                        >
                          信息确认
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeTask(t.id)}
                          title="从任务列表移除"
                        >
                          移除
                        </button>
                      </div>
                      <details className="taskFlowLogDetails" open={!isTaskTerminal(t)} style={{ gridColumn: '1 / -1' }}>
                        <summary>
                          执行日志 {t.flowLog?.length ? `（${t.flowLog.length} 条）` : '（尚无）'}
                        </summary>
                        <pre className="taskFlowLogPre">
                          {(t.flowLog ?? []).length === 0
                            ? '暂无日志；创建任务、点击执行或调度推进后将追加记录。'
                            : (t.flowLog ?? [])
                                .map((e) => (showFlowLogTechnical ? formatFlowLogLine(e) : formatFlowLogLineForUser(e)))
                                .join('\n')}
                        </pre>
                      </details>
                    </div>
                  );
                })}
              </div>
            )}
            <h3 style={{ marginTop: 24 }}>替换前备份</h3>
            <p className="hint" style={{ lineHeight: 1.55 }}>
              列出已结案且发生过覆盖式替换的转码任务在成片同目录下的 <code>*.etp.bak</code>（若文件仍存在）。删除前会校验路径与任务推导一致；不会动临时目录。
            </p>
            {replaceBackupRows.length === 0 ? (
              <p className="hint">当前没有可展示的替换前备份（无符合条件任务、备份已删除，或非桌面版无法探测）。</p>
            ) : (
              <>
                <div className="historyList" style={{ marginTop: 8 }}>
                  {replaceBackupRows.map((r) => (
                    <label key={r.backupPath} className="historyItem" style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={replaceBackupSelected.has(r.backupPath)}
                        onChange={() => toggleReplaceBackupPath(r.backupPath)}
                      />
                      <span className="hint" style={{ marginLeft: 8, wordBreak: 'break-all' }}>
                        <strong>{r.itemName}</strong> · {r.backupBasename}{' '}
                        <span className="tabular-nums">({formatByteSizeLabel(r.size)})</span> · 结案{' '}
                        {formatPlayedAt(r.closedAt)}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="actions" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="primary"
                    disabled={replaceBackupSelected.size === 0}
                    onClick={() => void deleteSelectedReplaceBackups()}
                  >
                    删除所选备份
                  </button>
                  <button type="button" onClick={() => void deleteAllReplaceBackups()}>
                    删除列表中全部备份
                  </button>
                </div>
              </>
            )}
            <h3 style={{ marginTop: 24 }}>临时目录残留</h3>
            <p className="hint" style={{ lineHeight: 1.55 }}>
              仅在转码临时根及 <code>etp-task-*</code> 子树下扫描约定后缀（如 <code>*.etp.partial</code>、<code>*.etp.new</code> 等），不包含成片目录下的备份文件。进入本页或配置页时自动刷新。
            </p>
            {tempResiduePhase === 'loading' ? (
              <p className="hint">正在扫描临时目录…</p>
            ) : tempResidueEmptyKind === 'no_desktop' ? (
              <p className="hint">当前环境非桌面版或未桥接控制面，无法扫描临时目录。</p>
            ) : tempResidueEmptyKind === 'no_temp_root' ? (
              <p className="hint">尚未在配置中填写转码临时根目录，无法扫描。</p>
            ) : tempResidueEmptyKind === 'scan_failed' ? (
              <p className="hint">扫描临时目录失败，请确认临时根路径有效且控制面可用。</p>
            ) : tempResidueEntries.length === 0 ? (
              <p className="hint">当前临时根下未发现约定后缀的残留文件。</p>
            ) : (
              <>
                <div className="historyList" style={{ marginTop: 8 }}>
                  {tempResidueEntries.map((o) => (
                    <label key={o.path} className="historyItem" style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={tempResidueSelected.has(o.path)}
                        onChange={() => toggleTempResiduePath(o.path)}
                      />
                      <span className="hint" style={{ marginLeft: 8, wordBreak: 'break-all' }}>
                        {o.path} <span className="tabular-nums">({(o.size / (1024 * 1024)).toFixed(2)} MB)</span>
                      </span>
                    </label>
                  ))}
                </div>
                <div className="actions" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="primary"
                    disabled={tempResidueSelected.size === 0}
                    onClick={() => void deleteSelectedTempResidue()}
                  >
                    删除所选残留文件
                  </button>
                </div>
              </>
            )}
            <h3 style={{ marginTop: 24 }}>全局说明</h3>
            <p className="hint">
              完整执行轨迹见上表各任务的「执行日志」。后续如需全局检索、导出或主进程落盘，可在现结构上扩展。
            </p>
          </div>
        </AppShell>
        {infoConfirmTaskId ? (
          <div className="overlay" role="dialog" aria-modal="true" aria-label="信息确认">
            <div className="overlayBox" style={{ maxWidth: 520 }}>
              {(() => {
                const confirmTask = tasks.find((x) => x.id === infoConfirmTaskId);
                if (confirmTask?.actionType === 'transcode' && confirmTask.transcodeConfirmKind === 'dolby_vision') {
                  return (
                    <>
                      <div style={{ fontWeight: 800 }}>转码 · 杜比视界确认</div>
                      <p className="hint" style={{ marginTop: 8, lineHeight: 1.55 }}>
                        条目「{confirmTask.itemName}」预检识别为<strong>杜比视界</strong>片源。继续转码时可能做色调映射再压成 x265，耗时与画质风险高于普通片源。请确认你已了解后再继续。
                      </p>
                      <details className="hint" style={{ marginTop: 8 }}>
                        <summary style={{ cursor: 'pointer', userSelect: 'none' }}>技术细节</summary>
                        <p style={{ marginTop: 8, lineHeight: 1.5 }}>
                          受控路径可能使用 libplacebo 等滤镜；需本机 FFmpeg 完整能力。
                        </p>
                      </details>
                      {confirmTask.transcodeTargetPath ? (
                        <p className="hint" style={{ marginTop: 8 }}>
                          目标成片路径（映射后）：{confirmTask.transcodeTargetPath}
                        </p>
                      ) : null}
                      <div className="actions" style={{ marginTop: 16 }}>
                        <button
                          type="button"
                          className="primary"
                          onClick={() => infoConfirmTaskId && confirmTranscodeDvTask(infoConfirmTaskId)}
                        >
                          确认并继续预检/压制
                        </button>
                        <button type="button" onClick={() => setInfoConfirmTaskId(null)}>
                          关闭（任务保持待确认）
                        </button>
                      </div>
                    </>
                  );
                }
                if (confirmTask?.actionType === 'transcode' && confirmTask.transcodeConfirmKind === 'replace') {
                  return (
                    <>
                      <div style={{ fontWeight: 800 }}>转码 · 替换前确认</div>
                      <p className="hint" style={{ marginTop: 8, lineHeight: 1.55 }}>
                        新输出已通过校验，即将用新成片<strong>替换</strong>原路径上的文件；若存在旧成片会先备份再替换。此操作无法由应用自动撤销。
                      </p>
                      <div className="hint" style={{ marginTop: 10, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                        {`目标成片：${confirmTask.transcodeTargetPath ?? '（未知）'}\n临时输出文件：${confirmTask.transcodePartialPath ?? '（未知）'}\n源体积：${
                          confirmTask.transcodeOriginalSizeGb != null ? `${confirmTask.transcodeOriginalSizeGb.toFixed(2)} GB` : '—'
                        }`}
                      </div>
                      <details className="hint" style={{ marginTop: 8 }}>
                        <summary style={{ cursor: 'pointer', userSelect: 'none' }}>技术细节（中间文件命名）</summary>
                        <p style={{ marginTop: 8, lineHeight: 1.5 }}>
                          替换过程可能使用 <code>.etp.new</code> 链与 <code>.etp.bak</code> 备份后缀。
                        </p>
                      </details>
                      <div className="actions" style={{ marginTop: 16 }}>
                        <button
                          type="button"
                          className="primary"
                          onClick={() => infoConfirmTaskId && confirmTranscodeReplaceTask(infoConfirmTaskId)}
                        >
                          确认替换
                        </button>
                        <button type="button" onClick={() => setInfoConfirmTaskId(null)}>
                          关闭
                        </button>
                      </div>
                    </>
                  );
                }
                if (confirmTask?.actionType === 'delete') {
                  return (
                    <>
                      <div style={{ fontWeight: 800 }}>删除 · 信息确认</div>
                      <p className="hint" style={{ marginTop: 8 }}>
                        将调用 Emby 删除条目「{confirmTask.itemName}」。请核对服务器返回的信息后确认。
                      </p>
                      <div
                        className="hint"
                        style={{ marginTop: 12, whiteSpace: 'pre-wrap', lineHeight: 1.5, maxHeight: 280, overflow: 'auto' }}
                      >
                        {(confirmTask.deleteConfirmLines ?? ['（预检信息暂缺，请关闭后检查任务状态）']).join('\n')}
                      </div>
                      <div className="actions" style={{ marginTop: 16 }}>
                        <button
                          type="button"
                          className="primary"
                          onClick={() => infoConfirmTaskId && confirmDeleteTaskExecute(infoConfirmTaskId)}
                        >
                          确认从 Emby 删除
                        </button>
                        <button type="button" onClick={() => setInfoConfirmTaskId(null)}>
                          关闭（任务保持待确认）
                        </button>
                      </div>
                    </>
                  );
                }
                return (
                  <>
                    <div style={{ fontWeight: 800 }}>洗版 · 信息确认</div>
                    <p className="hint" style={{ marginTop: 8 }}>
                      候选资源对比（模拟数据）。采用后任务重新排队；若无合格片源则进入等待重试。
                    </p>
                    {infoConfirmCandidates.length === 0 ? (
                      <p className="hint">暂无候选或任务已失效。</p>
                    ) : (
                      <div className="historyList" style={{ marginTop: 12 }}>
                        {infoConfirmCandidates.map((c) => (
                          <div key={c.id} className="historyItem">
                            <div style={{ fontWeight: 700 }}>{c.title}</div>
                            <div className="hint">
                              {c.codec.toUpperCase()} · {c.sizeGb.toFixed(1)} GB · 置信度 {c.confidence}%
                            </div>
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
                        暂无合格片源
                      </button>
                      <button type="button" onClick={() => setInfoConfirmTaskId(null)}>
                        关闭
                      </button>
                    </div>
                  </>
                );
              })()}
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
      <AppShell page={page} setPage={setPage} sidebar={wallSidebar} error={error} mediaGate={mediaServiceReachable} onSettingsClick={onSettingsClick}>
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
                同步为已在 Emby 标记已观看
              </button>
              <button onClick={() => setConfirm(null)}>取消</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
