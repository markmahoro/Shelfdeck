import { useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'embyDesktopPlayerConfigV1';
const LOCAL_MARKED_PLAYED_KEY = 'embyDesktopPlayerLocalMarkedPlayedV1';

type AppPage = 'config' | 'wall' | 'history';

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

function buildPosterUrl(config: EmbyConfig, item: UnplayedItem) {
  const tag = item.posterTag ? `&tag=${encodeURIComponent(item.posterTag)}` : '';
  return `${config.baseUrl.replace(/\/$/, '')}/Items/${encodeURIComponent(item.id)}/Images/Primary?width=220&api_key=${encodeURIComponent(
    config.apiKey,
  )}${tag}`;
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

  const enabledSet = useMemo(() => new Set(config.enabledSectionIds), [config.enabledSectionIds]);

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
    void refreshPlayedHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, historyDays, historyType, historySectionId]);

  useEffect(() => {
    if (page !== 'wall') return;
    const onKeyDown = (e: KeyboardEvent) => {
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
  }, [page, items, focusedIndex, confirm]);

  function saveConfig(next: EmbyConfig) {
    setConfig(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
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

  async function loadSections() {
    setLoading(true);
    setError(null);
    try {
      const list = await window.embyApi.getMediaFolders({ baseUrl: config.baseUrl.trim(), apiKey: config.apiKey.trim() });
      setSections(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function refreshUnplayed() {
    if (!isConfigReady(config, connected)) return;
    setLoading(true);
    setError(null);
    try {
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

  async function refreshPlayedHistory() {
    if (!isConfigReady(config, connected)) return;
    setLoading(true);
    setError(null);
    try {
      const data = await window.embyApi.getPlayedItems({
        config,
        days: historyDays,
        type: historyType,
        sectionId: historySectionId.trim() || undefined,
      });
      let merged = mergePlayedHistoryServerWithLocal(data);
      const sid = historySectionId.trim();
      if (sid) merged = merged.filter((x) => x.sectionId === sid);
      if (historyType !== 'all') merged = merged.filter((x) => x.type === historyType);
      setPlayedItems(merged);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function historyMarkWatched(it: PlayedItem) {
    if (!isConfigReady(config, connected)) return;
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
    if (!isConfigReady(config, connected)) return;
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
    return (
      <div className="app">
        <div className="topbar">
          <div style={{ fontWeight: 800 }}>Emby Desktop Player - 配置页</div>
          <button
            className="primary"
            disabled={!isConfigReady(config, connected)}
            onClick={async () => {
              setPage('wall');
              await refreshUnplayed();
            }}
          >
            进入未播放海报墙
          </button>
        </div>
        <div className="content">
          <div className="panel">
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
            <div className="row">
              <div className="field">
                <div className="label">播放器路径</div>
                <input value={config.playerExePath} onChange={(e) => setConfig({ ...config, playerExePath: e.target.value })} />
              </div>
              <div className="field">
                <div className="label">已播放阈值(%)</div>
                <input
                  type="number"
                  value={config.markPlayedThresholdPercent}
                  onChange={(e) => setConfig({ ...config, markPlayedThresholdPercent: Number(e.target.value) || 90 })}
                />
              </div>
            </div>
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
              <button className="primary" onClick={() => saveConfig(config)}>保存配置</button>
              <button onClick={() => void testConnection()}>{loading ? '处理中...' : '测试联通'}</button>
              <button onClick={() => void loadSections()} disabled={!connected}>获取媒体库列表</button>
              {!connected ? <span className="hint">没有可联通的配置，请先配置并测试联通</span> : null}
            </div>
            {users.length > 0 ? (
              <>
                <h3>选择用户</h3>
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
            ) : null}
            {sections.length > 0 ? (
              <>
                <h3>选择媒体库</h3>
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
              </>
            ) : null}
          </div>
        </div>
        {error ? <div className="hint" style={{ color: '#fca5a5', padding: 16 }}>{error}</div> : null}
      </div>
    );
  }

  if (page === 'history') {
    return (
      <div className="app">
        <div className="topbar">
          <div style={{ fontWeight: 800 }}>播放记录</div>
          <div className="actions">
            <button onClick={() => setPage('wall')}>返回海报墙</button>
            <select
              value={historyDays}
              onChange={(e) => setHistoryDays(Number(e.target.value) as 7 | 30 | 0)}
              className="selectLike"
            >
              <option value={7}>最近 7 天</option>
              <option value={30}>最近 30 天</option>
              <option value={0}>全部</option>
            </select>
            <select
              value={historyType}
              onChange={(e) => setHistoryType(e.target.value as 'all' | 'Movie' | 'Episode')}
              className="selectLike"
            >
              <option value="all">全部类型</option>
              <option value="Movie">电影</option>
              <option value="Episode">剧集</option>
            </select>
            <select
              value={historySectionId}
              onChange={(e) => setHistorySectionId(e.target.value)}
              className="selectLike"
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
            <button onClick={() => void refreshPlayedHistory()}>{loading ? '刷新中...' : '刷新记录'}</button>
          </div>
        </div>
        <div className="content">
          <div className="panel">
            {playedItems.length === 0 ? (
              <div className="hint">暂无播放记录</div>
            ) : (
              <div className="historyList">
                {playedItems.map((it) => (
                  <div key={it.id} className="historyItem">
                    <div style={{ fontWeight: 700 }}>{it.name}</div>
                    <div className="hint">{playedTypeLabel(it.type)}</div>
                    <div className="hint">{it.sectionName?.trim() ? it.sectionName : '—'}</div>
                    <div className="hint">
                      {it.type === 'Episode'
                        ? [it.seriesName, it.indexLabel].filter(Boolean).join(' · ') || '—'
                        : '—'}
                    </div>
                    <div className="hint tabular-nums">{formatPlayedAt(it.datePlayed)}</div>
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
                        disabled={loading || historyActionBusyId === it.id}
                        onClick={async () => {
                          const item = items.find((x) => x.id === it.id) ?? ({
                            id: it.id,
                            name: it.name,
                            sectionId: it.sectionId ?? config.enabledSectionIds[0] ?? '',
                          } as UnplayedItem);
                          await onPlay(item);
                        }}
                      >
                        重新播放
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {error ? <div className="hint" style={{ color: '#fca5a5', padding: 16 }}>{error}</div> : null}
      </div>
    );
  }

  return (
    <div className="app">
      <div className="topbar">
        <div style={{ fontWeight: 800 }}>未播放海报墙</div>
        <div className="actions">
          <button onClick={() => setPage('config')}>更改配置</button>
          <button onClick={() => setPage('history')}>播放记录</button>
          <button onClick={() => void refreshUnplayed()}>{loading ? '刷新中...' : '刷新未播放'}</button>
          {activeSession ? (
            <>
              <button className="primary" onClick={() => void onMarkWatchedRequest()}>已看完，标记已播放</button>
              <button onClick={() => onMarkUnwatched()}>未看完，稍后继续</button>
            </>
          ) : null}
        </div>
      </div>
      <div className="content">
        <div className="panel">
          <div className="hint">
            键盘：方向键移动焦点，Enter 播放，R 刷新，Esc 取消焦点
          </div>
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
      </div>
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
      {error ? <div className="hint" style={{ color: '#fca5a5', padding: 16 }}>{error}</div> : null}
    </div>
  );
}
