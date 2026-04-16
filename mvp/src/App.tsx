import { useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'embyDesktopPlayerConfigV1';

type AppPage = 'config' | 'wall';

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

function loadSavedConfig(): EmbyConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultConfig;
    return { ...defaultConfig, ...(JSON.parse(raw) as Partial<EmbyConfig>) };
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

  return (
    <div className="app">
      <div className="topbar">
        <div style={{ fontWeight: 800 }}>未播放海报墙</div>
        <div className="actions">
          <button onClick={() => setPage('config')}>更改配置</button>
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
          {items.length === 0 ? (
            <div className="hint">暂无未播放条目</div>
          ) : (
            <div className="grid">
              {items.map((item) => (
                <div key={`${item.sectionId}:${item.id}`} className="card">
                  <button onClick={() => void onPlay(item)}>
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
                  await window.embyApi.markPlayed({ config, itemId: confirm.item.id });
                  setConfirm(null);
                  setActiveSession(null);
                  await refreshUnplayed();
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
