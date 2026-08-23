import { FormEvent, useCallback, useEffect, useState } from 'react';
import { helixAdminApi, type IntegrationState, type PerceptionRecord, type PerceptionSyncState } from './api';
import AutomaticOperationPanel from './AutomaticOperationPanel';
import { Button, LoadingState, PageHeader } from './chrome';
import { labelOf, recordKindLabels, resolutionLabels } from './labels';
import { isUnauthorized, useSession } from './session';

function integrationStateLabel(value:IntegrationState|null) {
  if (!value || value.configRevision === 0) return '未配置';
  if (value.validation?.status === 'failed') return '已配置 · 最近验证失败';
  if (value.configured && (value.validation?.status === 'passed' || value.lastTestSummary)) return '当前可用';
  if (value.configured) return '已配置 · 尚未验证';
  return '已配置 · 当前停用';
}

function time(value: number) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
function stars(value: number | null) {
  return value === null ? '—' : '★'.repeat(value) + '☆'.repeat(5 - value);
}

export default function SettingsPage() {
  const { expire } = useSession();
  const [tab, setTab] = useState<'integrations' | 'automation' | 'ratings'>('integrations');
  const [integration, setIntegration] = useState<IntegrationState | null>(null);
  const [tmdb, setTmdb] = useState<IntegrationState | null>(null);
  const [moviePilot, setMoviePilot] = useState<IntegrationState | null>(null);
  const [records, setRecords] = useState<PerceptionRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [userId, setUserId] = useState('');
  const [cookie, setCookie] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [tmdbCredentialKind, setTmdbCredentialKind] = useState<'api_key' | 'access_token'>('access_token');
  const [tmdbCredential, setTmdbCredential] = useState('');
  const [tmdbLanguage, setTmdbLanguage] = useState('zh-CN');
  const [moviePilotEndpoint, setMoviePilotEndpoint] = useState('');
  const [moviePilotKey, setMoviePilotKey] = useState('');
  const [providerRequestRoot, setProviderRequestRoot] = useState('');
  const [providerOrganizedRoot, setProviderOrganizedRoot] = useState('');
  const [visibleLandingRoot, setVisibleLandingRoot] = useState('');
  const [maxDownloadAttempts, setMaxDownloadAttempts] = useState(3);
  const [ratingFilter, setRatingFilter] = useState('');
  const [targetFilter, setTargetFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [ratingsLoaded, setRatingsLoaded] = useState(false);
  const [syncState, setSyncState] = useState<PerceptionSyncState | null>(null);

  const fail = useCallback((cause: unknown, fallback: string) => {
    if (isUnauthorized(cause)) expire();
    else setError(cause instanceof Error ? cause.message : fallback);
  }, [expire]);

  const loadSyncState = useCallback(async () => {
    try {
      const state = await helixAdminApi.getPerceptionSyncState();
      setSyncState(state);
    } catch (cause) { fail(cause, '同步进度读取失败。'); }
  }, [fail]);

  const loadIntegrations = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [configured, configuredTmdb, configuredMoviePilot] = await Promise.all([
        helixAdminApi.getIntegration('douban'),
        helixAdminApi.getIntegration('tmdb'),
        helixAdminApi.getIntegration('moviepilot'),
      ]);
      setIntegration(configured);
      setTmdb(configuredTmdb);
      setTmdbLanguage(configuredTmdb.settings?.language || 'zh-CN');
      setMoviePilot(configuredMoviePilot);
      setMaxDownloadAttempts(configuredMoviePilot.settings?.maxDownloadAttempts || 3);
      if (configured?.configured) await helixAdminApi.getPerceptionSyncState().then(setSyncState);
    } catch (cause) { fail(cause, '设置读取失败。'); }
    finally { setLoading(false); }
  }, [fail]);

  const loadRatings = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const log = await helixAdminApi.listPerceptionRecords({
        limit: 100, sourceKind: sourceFilter, resolutionStatus: statusFilter,
        rating: ratingFilter ? Number(ratingFilter) : undefined, targetType: targetFilter,
      });
      setRecords(log.items); setNextCursor(log.nextCursor); setRatingsLoaded(true);
    } catch (cause) { fail(cause, '评分日志读取失败。'); }
    finally { setLoading(false); }
  }, [fail, ratingFilter, sourceFilter, statusFilter, targetFilter]);

  useEffect(() => { void loadIntegrations(); }, [loadIntegrations]);
  useEffect(() => { if (tab === 'ratings') void loadRatings(); }, [tab, loadRatings]);
  useEffect(() => {
    if (!syncState || syncState.activeCount < 1) return undefined;
    const timer = window.setInterval(() => { void loadSyncState(); }, 3000);
    return () => window.clearInterval(timer);
  }, [syncState, loadSyncState]);

  async function connect(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError(''); setNotice('');
    try {
      const proof = await helixAdminApi.testIntegration('douban', { kind: 'douban', idempotencyKey: `douban-test:${crypto.randomUUID()}`, endpoint: 'https://movie.douban.com', credential: { kind: 'cookie', value: cookie }, settings: { userId }, timeoutMs: 20_000 });
      await helixAdminApi.configureIntegration('douban', { kind: 'douban', idempotencyKey: `douban-configure:${proof.connectionProofId}`, expectedConfigRevision: integration?.configRevision || 0, connectionProofId: proof.connectionProofId });
      setCookie(''); setNotice('豆瓣连接已通过真实页面验证并保存。'); await loadIntegrations();
    } catch (cause) { fail(cause, '豆瓣连接失败。'); }
    finally { setLoading(false); }
  }
  async function sync() {
    setLoading(true); setError(''); setNotice('');
    try {
      await helixAdminApi.syncDouban();
      setNotice('正在从豆瓣拉取收藏评分。');
      await loadSyncState();
    } catch (cause) { fail(cause, '豆瓣同步未启动。'); }
    finally { setLoading(false); }
  }
  async function disconnect() {
    if (!integration) return; setLoading(true);
    try {
      await helixAdminApi.disconnectIntegration('douban', { kind: 'douban', idempotencyKey: `douban-disconnect:${integration.configRevision}`, expectedConfigRevision: integration.configRevision });
      setNotice('豆瓣连接已断开，历史评分仍保留。'); await loadIntegrations();
    } catch (cause) { fail(cause, '断开失败。'); }
    finally { setLoading(false); }
  }
  async function connectTmdb(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError(''); setNotice('');
    try {
      const proof = await helixAdminApi.testIntegration('tmdb', { kind: 'tmdb', idempotencyKey: `tmdb-test:${crypto.randomUUID()}`, endpoint: 'https://api.themoviedb.org/3', credential: { kind: tmdbCredentialKind, value: tmdbCredential }, settings: { language: tmdbLanguage }, timeoutMs: 20_000 });
      await helixAdminApi.configureIntegration('tmdb', { kind: 'tmdb', idempotencyKey: `tmdb-configure:${proof.connectionProofId}`, expectedConfigRevision: tmdb?.configRevision || 0, connectionProofId: proof.connectionProofId });
      setTmdbCredential(''); setNotice('TMDB 已验证并保存。'); await loadIntegrations();
    } catch (cause) { fail(cause, 'TMDB 连接失败。'); }
    finally { setLoading(false); }
  }
  async function disconnectTmdb() {
    if (!tmdb) return; setLoading(true);
    try {
      await helixAdminApi.disconnectIntegration('tmdb', { kind: 'tmdb', idempotencyKey: `tmdb-disconnect:${tmdb.configRevision}`, expectedConfigRevision: tmdb.configRevision });
      setNotice('TMDB 已断开。'); await loadIntegrations();
    } catch (cause) { fail(cause, '断开失败。'); }
    finally { setLoading(false); }
  }
  async function updateTmdbLanguage() {
    if (!tmdb) return; setLoading(true); setError('');
    try {
      await helixAdminApi.configureIntegration('tmdb', { kind: 'tmdb', idempotencyKey: `tmdb-settings:${tmdb.configRevision}:${tmdbLanguage}`, expectedConfigRevision: tmdb.configRevision, settings: { language: tmdbLanguage } });
      setNotice('TMDB 首选语言已更新。'); await loadIntegrations();
    } catch (cause) { fail(cause, 'TMDB 语言更新失败。'); }
    finally { setLoading(false); }
  }
  async function connectMoviePilot(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError(''); setNotice('');
    try {
      const proof = await helixAdminApi.testIntegration('moviepilot', { kind: 'moviepilot', idempotencyKey: `moviepilot-test:${crypto.randomUUID()}`, endpoint: moviePilotEndpoint, credential: { kind: 'api_key', value: moviePilotKey }, settings: { providerRequestSaveRoot: providerRequestRoot, providerOrganizedRoot, shelfDeckVisibleRoot: visibleLandingRoot, maxDownloadAttempts }, timeoutMs: 20_000 });
      await helixAdminApi.configureIntegration('moviepilot', { kind: 'moviepilot', idempotencyKey: `moviepilot-configure:${proof.connectionProofId}`, expectedConfigRevision: moviePilot?.configRevision || 0, connectionProofId: proof.connectionProofId });
      setMoviePilotKey(''); setNotice('MoviePilot 已验证并保存。'); await loadIntegrations();
    } catch (cause) { fail(cause, 'MoviePilot 连接失败。'); }
    finally { setLoading(false); }
  }
  async function disconnectMoviePilot() {
    if (!moviePilot) return; setLoading(true);
    try {
      await helixAdminApi.disconnectIntegration('moviepilot', { kind: 'moviepilot', idempotencyKey: `moviepilot-disconnect:${moviePilot.configRevision}`, expectedConfigRevision: moviePilot.configRevision });
      setNotice('MoviePilot 已断开；已下载文件未被删除。'); await loadIntegrations();
    } catch (cause) { fail(cause, '断开失败。'); }
    finally { setLoading(false); }
  }
  async function updateMoviePilotAttempts() {
    if (!moviePilot) return; setLoading(true); setError('');
    try {
      await helixAdminApi.configureIntegration('moviepilot', { kind: 'moviepilot', idempotencyKey: `moviepilot-settings:${moviePilot.configRevision}:${maxDownloadAttempts}`, expectedConfigRevision: moviePilot.configRevision, settings: { maxDownloadAttempts } });
      setNotice('下载尝试上限已更新。'); await loadIntegrations();
    } catch (cause) { fail(cause, '尝试上限更新失败。'); }
    finally { setLoading(false); }
  }
  async function loadMore() {
    if (!nextCursor) return;
    const result = await helixAdminApi.listPerceptionRecords({ cursor: nextCursor, limit: 100, sourceKind: sourceFilter, resolutionStatus: statusFilter, rating: ratingFilter ? Number(ratingFilter) : undefined, targetType: targetFilter });
    setRecords((current) => [...current, ...result.items]); setNextCursor(result.nextCursor);
  }

  if (!integration && !tmdb && !moviePilot && loading && !error) return <LoadingState>正在读取系统设置…</LoadingState>;
  return <section className="source-page settings-page">
    <PageHeader title="系统设置" description="管理连接、自动运营与评分日志。" />
    <div className="settings-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab === 'integrations'} onClick={() => setTab('integrations')}>连接</button>
      <button type="button" role="tab" aria-selected={tab === 'automation'} onClick={() => setTab('automation')}>自动运营</button>
      <button type="button" role="tab" aria-selected={tab === 'ratings'} onClick={() => setTab('ratings')}>评分日志</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="form-notice" role="status">{notice}</p>}
    {tab === 'automation' ? <div className="settings-stack"><AutomaticOperationPanel /></div> : tab === 'integrations' ? <div className="settings-stack">
      <section className="settings-card" aria-labelledby="douban-title">
        <header className="settings-card-head"><div><h2 id="douban-title">豆瓣</h2><p>同步收藏评分</p></div><span className={`integration-state ${integration?.configured ? 'active' : ''}`}>{integrationStateLabel(integration)}</span></header>
        <div className="settings-card-body">
          {integration?.configured ? <>
            <dl className="settings-facts"><div><dt>账号</dt><dd>{integration.lastTestSummary?.identityProviderKey || '已验证'}</dd></div></dl>
            <small>{syncState?.completionState==='incomplete'
              ? `上次同步未完成，已保存 ${syncState.recordCount} 条评分；再次同步会从上次成功位置继续。`
              : syncState?.activeCount
                ? `正在从豆瓣拉取收藏评分，已保存 ${syncState.recordCount} 条。`
                : syncState?.completionState==='complete'
                  ? `最近一次同步已完整结束，共保存 ${syncState.recordCount} 条评分。`
                  : '同步会去豆瓣拉收藏；系统也会按天自动再拉一轮。'}</small>
            <div className="settings-card-actions"><Button variant="primary" type="button" onClick={() => void sync()} disabled={loading || (syncState?.activeCount || 0) > 0}>{syncState?.activeCount ? '正在同步…' : '同步'}</Button><Button variant="danger" type="button" onClick={() => void disconnect()} disabled={loading}>断开</Button></div>
          </> : <form className="source-form" onSubmit={connect}>
            <div className="source-form-grid">
              <label><span>豆瓣用户 ID</span><input value={userId} onChange={(event) => setUserId(event.target.value)} required /></label>
              <label className="wide"><span>Cookie</span><textarea value={cookie} onChange={(event) => setCookie(event.target.value)} rows={4} required /><small>仅写入本机密钥库，不进入日志。</small></label>
            </div>
            <div className="settings-card-actions"><Button variant="primary" disabled={loading || !userId || cookie.length < 8}>{loading ? '正在验证…' : '测试并连接'}</Button></div>
          </form>}
        </div>
      </section>
      <section className="settings-card" aria-labelledby="tmdb-title">
        <header className="settings-card-head"><div><h2 id="tmdb-title">TMDB</h2><p>电影身份、资料与海报</p></div><span className={`integration-state ${tmdb?.configured ? 'active' : ''}`}>{integrationStateLabel(tmdb)}</span></header>
        <div className="settings-card-body">
          {tmdb?.configured ? <>
            <label className="settings-inline-field"><span>首选语言</span><select value={tmdbLanguage} onChange={(event) => setTmdbLanguage(event.target.value)}><option value="zh-CN">简体中文</option><option value="zh-TW">繁体中文</option><option value="en-US">English</option></select></label>
            <div className="settings-card-actions"><Button variant="primary" type="button" onClick={() => void updateTmdbLanguage()} disabled={loading || tmdbLanguage === (tmdb.settings?.language || 'zh-CN')}>保存语言</Button><Button variant="danger" type="button" onClick={() => void disconnectTmdb()} disabled={loading}>断开</Button></div>
          </> : <form className="source-form" onSubmit={connectTmdb}>
            <div className="source-form-grid">
              <label><span>首选语言</span><select value={tmdbLanguage} onChange={(event) => setTmdbLanguage(event.target.value)}><option value="zh-CN">简体中文</option><option value="zh-TW">繁体中文</option><option value="en-US">English</option></select></label>
              <label><span>凭据类型</span><select value={tmdbCredentialKind} onChange={(event) => setTmdbCredentialKind(event.target.value as 'api_key' | 'access_token')}><option value="access_token">Read Access Token</option><option value="api_key">API Key</option></select></label>
              <label className="wide"><span>{tmdbCredentialKind === 'access_token' ? 'Read Access Token' : 'API Key'}</span><input type="password" value={tmdbCredential} onChange={(event) => setTmdbCredential(event.target.value)} required /></label>
            </div>
            <div className="settings-card-actions"><Button variant="primary" disabled={loading || tmdbCredential.length < 8}>{loading ? '正在验证…' : '测试并连接'}</Button></div>
          </form>}
        </div>
      </section>
      <section className="settings-card" aria-labelledby="moviepilot-title">
        <header className="settings-card-head"><div><h2 id="moviepilot-title">MoviePilot</h2><p>按整理要求寻找外部片源</p></div><span className={`integration-state ${moviePilot?.configured ? 'active' : ''}`}>{integrationStateLabel(moviePilot)}</span></header>
        <div className="settings-card-body">
          {moviePilot?.configured && moviePilot.landingBinding ? <>
            <dl className="settings-facts">
              <div><dt>下载目录</dt><dd>{moviePilot.landingBinding.providerRequestSaveRoot}</dd></div>
              <div><dt>整理目录</dt><dd>{moviePilot.landingBinding.providerOrganizedRoot}</dd></div>
              <div><dt>可见目录</dt><dd>{moviePilot.landingBinding.shelfDeckVisibleRoot}</dd></div>
            </dl>
            <label className="settings-inline-field"><span>下载尝试上限</span><input type="number" min={1} max={5} value={maxDownloadAttempts} onChange={(event) => setMaxDownloadAttempts(Number(event.target.value))} /></label>
            <div className="settings-card-actions"><Button variant="primary" type="button" onClick={() => void updateMoviePilotAttempts()} disabled={loading || maxDownloadAttempts < 1 || maxDownloadAttempts > 5 || maxDownloadAttempts === (moviePilot.settings?.maxDownloadAttempts || 3)}>保存上限</Button><Button variant="danger" type="button" onClick={() => void disconnectMoviePilot()} disabled={loading}>断开</Button></div>
          </> : <form className="source-form" onSubmit={connectMoviePilot}>
            <div className="source-form-grid">
              <label><span>服务地址</span><input value={moviePilotEndpoint} onChange={(event) => setMoviePilotEndpoint(event.target.value)} placeholder="http://nas:3000" required /></label>
              <label><span>API Key</span><input type="password" value={moviePilotKey} onChange={(event) => setMoviePilotKey(event.target.value)} required /></label>
              <label className="wide"><span>MoviePilot 下载目录</span><input value={providerRequestRoot} onChange={(event) => setProviderRequestRoot(event.target.value)} required /></label>
              <label className="wide"><span>MoviePilot 整理目录</span><input value={providerOrganizedRoot} onChange={(event) => setProviderOrganizedRoot(event.target.value)} required /></label>
              <label className="wide"><span>ShelfDeck 可见目录</span><input value={visibleLandingRoot} onChange={(event) => setVisibleLandingRoot(event.target.value)} required /><small>必须是同一整理目录的只读视图。</small></label>
              <label><span>下载尝试上限</span><input type="number" min={1} max={5} value={maxDownloadAttempts} onChange={(event) => setMaxDownloadAttempts(Number(event.target.value))} /></label>
            </div>
            <div className="settings-card-actions"><Button variant="primary" disabled={loading || moviePilotKey.length < 8 || !moviePilotEndpoint || !providerRequestRoot || !providerOrganizedRoot || !visibleLandingRoot || maxDownloadAttempts < 1 || maxDownloadAttempts > 5}>{loading ? '正在验证…' : '测试并连接'}</Button></div>
          </form>}
        </div>
      </section>
    </div> : <section className="settings-card rating-log" aria-labelledby="rating-log-title">
      <header className="settings-card-head"><div><h2 id="rating-log-title">评分日志</h2><p>只读取已经落下的记录，不会去豆瓣同步。</p></div><div className="settings-card-actions"><Button type="button" onClick={() => void loadRatings()} disabled={loading}>刷新日志</Button></div></header>
      <div className="settings-card-body">
      <div className="log-filters">
        <label><span>来源</span><select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="">全部</option><option value="douban">豆瓣</option><option value="shelfdeck_direct">ShelfDeck</option></select></label>
        <label><span>星级</span><select value={ratingFilter} onChange={(event) => setRatingFilter(event.target.value)}><option value="">全部</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}星</option>)}</select></label>
        <label><span>状态</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">全部</option><option value="matched">已匹配</option><option value="unmatched">未匹配</option><option value="ambiguous">有歧义</option><option value="superseded">已更正</option></select></label>
        <label><span>目标</span><select value={targetFilter} onChange={(event) => setTargetFilter(event.target.value)}><option value="">全部</option><option value="subject">整理中的媒体</option><option value="shelf_entry">收藏条目</option></select></label>
      </div>
      {records.length === 0 ? <div className="source-empty"><strong>{ratingsLoaded || loading ? '还没有评分记录' : '正在读取评分日志…'}</strong><p>请在媒体整理工作区或我的收藏中评分。</p></div> : <div className="formation-table-wrap"><table className="formation-table"><thead><tr><th>标题</th><th>评分</th><th>来源</th><th>状态</th><th>目标</th><th>记录时间</th></tr></thead><tbody>{records.map((record) => <tr key={record.perceptionId}><td><strong>{record.observedTitle}</strong><small>{labelOf(recordKindLabels, record.recordKind)}</small></td><td className="rating-text">{stars(record.rating)}</td><td>{record.sourceKind === 'douban' ? '豆瓣' : 'ShelfDeck'}</td><td>{labelOf(resolutionLabels, record.resolutionStatus)}</td><td>{record.targetType === 'subject' ? '整理中的媒体' : record.targetType === 'shelf_entry' ? '收藏条目' : '未匹配'}</td><td>{time(record.committedAtMs)}</td></tr>)}</tbody></table></div>}
      {nextCursor && <Button type="button" onClick={() => void loadMore()}>加载更多</Button>}
      </div>
    </section>}
  </section>;
}
