import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { helixAdminApi, type CareDetail, type CollectionEntry, type HealthState } from './api';
import { newOpaqueId } from './id';
import { Button, LoadingState, PageHeader } from './chrome';
import { healthLabels } from './labels';
import RatingControl from './RatingControl';
import CollectionDefects from './CollectionDefects';
import { isUnauthorized, useSession } from './session';
import './collection.css';

const healthFilters: [HealthState | 'all', string][] = [['all', '全部'], ['healthy', '健康'], ['unhealthy', '不健康'], ['observing', '暂无法判断'], ['repairing', '维护中'], ['attention_required', '需要处理'], ['never_assessed', '尚未检查']];
const foldedHealthLabels = { healthy: '健康', repairing: '维护中', unhealthy: '不健康', unknown: '健康状态未知' } as const;
const careStageLabels: Record<string, string> = { queued: '等待改善席位', preparing: '正在准备修复', preparing_media: '正在处理媒体', verifying_media: '正在验证媒体', committing_inventory: '正在更新收藏', reassessing: '正在复核结果', waiting_for_recovery: '等待自动恢复' };
const repairSubjectLabels: Record<string, string> = {
  nfo_missing: '说明书', nfo_corrupt: '说明书', nfo_update_required: '说明书',
  poster_missing: '海报', poster_corrupt: '海报', artifact_missing: '缺失资料',
  video_codec_unmet: '视频编码', container_unmet: '封装格式', file_extension_unmet: '文件格式',
  max_size_exceeded: '体积', placement_unmet: '收藏位置',
};

function foldedHealth(state: HealthState | undefined) {
  if (state === 'healthy') return 'healthy';
  if (state === 'repairing') return 'repairing';
  if (!state || state === 'never_assessed' || state === 'observing') return 'unknown';
  return 'unhealthy';
}

function repairCopy(progress: CareDetail['activeCaseProgress']) {
  if (!progress) return '正在自动修复';
  const subjects = [...new Set((progress.goals || []).flatMap((goal) => {
    const token = String(goal).split(/[/:]/).find((part) => repairSubjectLabels[part]);
    return token ? [repairSubjectLabels[token]] : [];
  }))];
  const stage = careStageLabels[progress.stage] || '正在自动修复';
  return subjects.length ? `${stage}：${subjects.join('、')}` : stage;
}

function formatBytes(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1).replace(/\.0$/, '')} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1).replace(/\.0$/, '')} MB`;
  return `${value} B`;
}

export default function CollectionPage() {
  const { expire } = useSession();
  const [items, setItems] = useState<CollectionEntry[]>([]);
  const [shelves, setShelves] = useState<Array<{ shelfId: string; name: string; currentCount: number; historyCount: number }>>([]);
  const [summary, setSummary] = useState({ currentCount: 0, historyCount: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<CollectionEntry | null>(null);
  const [care, setCare] = useState<CareDetail | null>(null);
  const [healthFilter, setHealthFilter] = useState<HealthState | 'all'>('all');
  const [checking, setChecking] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [shelfId, setShelfId] = useState<string | undefined>(undefined);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'title' | 'recent' | 'year_desc'>('recent');
  const [resultCount, setResultCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const pageCursors = useRef<Array<string | undefined>>([undefined]);
  const currentPage = useRef(0);
  const loadVersion = useRef(0);
  const closeButton = useRef<HTMLButtonElement>(null);
  const load = useCallback(async (cursor?: string, targetPage = currentPage.current) => {
    const requestCursor = targetPage === 0 ? undefined : cursor ?? pageCursors.current[targetPage];
    const version = ++loadVersion.current;
    setLoading(true); setError('');
    try {
      const result = await helixAdminApi.listCollection({
        shelfId,
        status: 'current',
        health: healthFilter,
        q: search || undefined,
        sort,
        cursor: requestCursor,
        limit: 48,
      });
      if (version !== loadVersion.current) return;
      setItems(result.items);
      currentPage.current = targetPage;
      setPageIndex(targetPage);
      pageCursors.current = pageCursors.current.slice(0, targetPage + 1);
      pageCursors.current[targetPage] = requestCursor;
      if (result.nextCursor) pageCursors.current[targetPage + 1] = result.nextCursor;
      setShelves(result.shelves || []);
      setSummary(result.summary || { currentCount: result.items.filter((item) => item.status === 'active').length, historyCount: result.items.filter((item) => item.status !== 'active').length });
      setResultCount(result.resultCount ?? result.items.length);
      setNextCursor(result.nextCursor || null);
    }
    catch (cause) {
      if (version !== loadVersion.current) return;
      if (isUnauthorized(cause)) expire(); else setError(cause instanceof Error ? cause.message : '收藏读取失败。');
    }
    finally { if (version === loadVersion.current) setLoading(false); }
  }, [expire, shelfId, healthFilter, search, sort]);
  useEffect(() => { currentPage.current = 0; pageCursors.current = [undefined]; setPageIndex(0); void load(undefined, 0); }, [load]);
  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelected(null); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    closeButton.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('modal-open'); previous?.focus(); };
  }, [selected]);
  useEffect(() => {
    setCare(null);
    if (!selected) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      let nextDelayMs = 15_000;
      try {
        const next = await helixAdminApi.getCare(selected.shelfEntryId);
        if (!cancelled) {
          setCare(next);
          nextDelayMs = next.activeCaseProgress ? 2_000 : 15_000;
        }
      } catch (cause) {
        if (cancelled) return;
        if (isUnauthorized(cause)) expire();
        else setError(cause instanceof Error ? cause.message : '健康详情读取失败。');
      } finally {
        if (!cancelled) timer = setTimeout(() => void refresh(), nextDelayMs);
      }
    };
    void refresh();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [expire, selected]);
  const selectedShelf = shelves.find((item) => item.shelfId === shelfId);
  async function checkHealth() {
    if (!selected) return;
    setChecking(true); setError('');
    try { await helixAdminApi.checkCare(selected.shelfEntryId); setCare(await helixAdminApi.getCare(selected.shelfEntryId)); await load(); }
    catch (cause) { if (isUnauthorized(cause)) expire(); else setError(cause instanceof Error ? cause.message : '健康检查未能开始。'); }
    finally { setChecking(false); }
  }
  async function exitCollection() {
    if (!selected) return;
    setExiting(true); setError('');
    try {
      const review = await helixAdminApi.createOffdeckReview({ shelfEntryId: selected.shelfEntryId, originKind: 'direct_intent', originRef: selected.shelfEntryId, actorId: 'admin', idempotencyKey: `offdeck-direct:${selected.shelfEntryId}:${newOpaqueId()}` });
      window.location.assign(`/offdeck?review=${encodeURIComponent(review.reviewId)}`);
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else setError(cause instanceof Error ? cause.message : '未能开始退出收藏。');
      setExiting(false);
    }
  }
  return <section className="source-page collection-page">
    <PageHeader title="我的收藏" actions={<Button type="button" onClick={() => void load()} disabled={loading}>{loading ? '刷新中…' : '刷新'}</Button>} />
    {error && <p className="form-error" role="alert">{error}</p>}
    <section className="collection-shelf-stage" aria-labelledby="collection-shelf-name">
      <div className="collection-shelf-primary">
        <label><span id="collection-shelf-name">收藏架</span><select aria-label="收藏架" value={shelfId || ''} onChange={(event) => setShelfId(event.target.value || undefined)}>
          <option value="">全部收藏</option>
          {shelves.map((shelf) => <option key={shelf.shelfId} value={shelf.shelfId}>{shelf.name}</option>)}
        </select></label>
        <div><strong>{selectedShelf?.currentCount ?? summary.currentCount} 条收藏</strong></div>
      </div>
      <div className="collection-tools">
        <form className="collection-search" role="search" onSubmit={(event) => { event.preventDefault(); const value = searchDraft.trim(); if (value === search) void load(); else setSearch(value); }}>
          <input aria-label="搜索收藏" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="搜索片名或年份" />
          <Button type="submit">搜索</Button>
        </form>
        <label className="collection-sort"><span>排序</span><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="recent">最近上架</option><option value="title">片名</option><option value="year_desc">年份（新到旧）</option></select></label>
        <details className="collection-filter"><summary>筛选{healthFilter === 'all' ? '' : ` · ${healthLabels[healthFilter]}`}</summary><nav aria-label="收藏健康筛选">{healthFilters.map(([state, label]) => <button type="button" key={state} aria-pressed={healthFilter === state} onClick={() => setHealthFilter(state)}>{label}</button>)}</nav></details>
      </div>
    </section>
    <section className="collection-library" aria-label="收藏列表">
      {loading && items.length === 0 ? <LoadingState>正在打开收藏架…</LoadingState> : items.length === 0 ? <div className="source-empty"><strong>{summary.currentCount === 0 ? '还没有正式上架的收藏' : '没有找到符合条件的收藏'}</strong></div> : <div className="poster-wall">{items.map((item) => <button className="poster-tile" key={item.shelfEntryId} onClick={() => setSelected(item)} aria-label={`查看 ${item.displayIdentity} 详情，收藏健康：${healthLabels[item.health.state]}`}>
        <span className="poster-frame">{item.hasPoster ? <img src={helixAdminApi.collectionPosterUrl(item.shelfEntryId, item.currentInventoryRevision, 'wall')} alt="" loading="lazy" decoding="async" /> : <span className="poster-fallback" aria-hidden="true"><b>{item.displayIdentity.slice(0, 2)}</b><small>ShelfDeck</small></span>}{<span className={`health-seal ${item.health.state}`} title={healthLabels[item.health.state]} aria-hidden="true">{item.health.state === 'attention_required' ? '需处理' : healthLabels[item.health.state]}</span>}</span>
        <span className="poster-caption"><strong>{item.displayIdentity}</strong><small>{item.series ? `第 ${item.series.seasonNumber} 季 · ${item.series.episodeCount} 集 · ` : ''}{item.year || '年份未知'} · {item.shelfName}</small>{item.defectAdmission&&<small>瑕疵入库 · {item.defectAdmission.defects.some((defect)=>defect.defectCode==='size_cap_exceeded')?'体积超过档位上限':`${item.defectAdmission.defectCount}项`}</small>}</span>
      </button>)}</div>}
      <nav className="collection-more" aria-label="收藏分页">
        <Button type="button" disabled={loading || pageIndex === 0} onClick={() => void load(pageCursors.current[pageIndex - 1], pageIndex - 1)}>上一页</Button>
        {pageCursors.current.map((cursor, index) => <Button key={index} type="button" aria-label={`第${index + 1}页`} aria-current={index === pageIndex ? 'page' : undefined} disabled={loading || index === pageIndex} onClick={() => void load(cursor, index)}>{index + 1}</Button>)}
        <span>第 {pageIndex + 1} 页 · 共 {resultCount} 条</span>
        <Button type="button" disabled={loading || !nextCursor} onClick={() => nextCursor && void load(nextCursor, pageIndex + 1)}>下一页</Button>
      </nav>
    </section>
    {selected && <div className="collection-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
      <section className="collection-dialog" role="dialog" aria-modal="true" aria-labelledby="collection-dialog-title">
        <button ref={closeButton} className="collection-dialog-close" onClick={() => setSelected(null)} aria-label="关闭详情">×</button>
        <div className="collection-dialog-poster">{selected.hasPoster ? <img src={helixAdminApi.collectionPosterUrl(selected.shelfEntryId, selected.currentInventoryRevision, 'detail')} alt={`${selected.displayIdentity} 海报`} /> : <span className="poster-fallback"><b>{selected.displayIdentity.slice(0, 2)}</b><small>ShelfDeck</small></span>}</div>
        <div className="collection-dialog-copy">
          <h2 id="collection-dialog-title">{selected.displayIdentity}</h2>
          <p className="collection-dialog-meta">{selected.year || '年份未知'} · {selected.genres.length ? selected.genres.join(' / ') : '类型未记录'}</p>
          <p className="collection-dialog-overview">{selected.overview || '暂无剧情简介。'}</p>

          {selected.people.length > 0 && <dl className="collection-people"><dt>演职人员</dt><dd>{selected.people.slice(0, 12).map((person) => person.displayName).join('、')}</dd></dl>}
          <dl className="collection-facts">
            <div><dt>收藏架</dt><dd>{selected.shelfName}</dd></div>
            <div><dt>占用空间</dt><dd>{formatBytes(selected.occupancyBytes)}</dd></div>
            <div><dt>{selected.series ? '全部视频文件' : '主视频'}</dt><dd>{selected.primaryVideoBytes == null ? '—' : `${formatBytes(selected.primaryVideoBytes)}${selected.primaryContainer ? ` · ${selected.primaryContainer}` : ''}`}</dd></div>
            {(selected.videoCodec || selected.videoRaster) && <div><dt>编码与清晰度</dt><dd>{[selected.videoCodec, selected.videoRaster].filter(Boolean).join(' · ')}</dd></div>}
            <div><dt>海报 / NFO</dt><dd>{selected.hasPoster ? '有海报' : '无海报'} · {selected.hasNfo ? '有 NFO' : '无 NFO'}</dd></div>
            <div><dt>资料来源</dt><dd>{selected.provider === 'tmdb' ? 'TMDB' : selected.provider}</dd></div>
            <div><dt>状态</dt><dd>已上架</dd></div>
          </dl>
          {selected.series && <section className="collection-episodes" aria-label="已收藏剧集">
            <h3>第 {selected.series.seasonNumber} 季 · 已收藏 {selected.series.episodeCount} 集</h3>
            <p>{selected.series.physicalFileCount} 个视频文件</p>
            <ul>{selected.series.episodes.map(episode => <li key={episode.episodeKey}>
              <strong>第 {episode.episodeNumber} 集{episode.title ? ` · ${episode.title}` : ''}</strong>
              <ul>{episode.files.map(file => <li key={file.materialKey}>{file.name} · {formatBytes(file.sizeBytes)}{file.coveredEpisodeCount > 1 ? ` · 共用文件（${file.coveredEpisodeCount} 集）` : ''}</li>)}</ul>
            </li>)}</ul>
          </section>}
          <div className="collection-rating"><span>我的评分</span><RatingControl targetType="shelf_entry" targetId={selected.shelfEntryId} label={selected.displayIdentity} /></div>
          <section className="collection-health" aria-labelledby="collection-health-heading">
            <div className="collection-health-heading"><div><h3 id="collection-health-heading">收藏健康</h3></div>
              <Button type="button" onClick={() => void checkHealth()} disabled={checking}>{checking ? '已开始检查…' : '立即检查健康'}</Button>
            </div>
            {!care ? <p className="health-loading">正在读取健康详情…</p> : (() => {
              const lamp = foldedHealth(care.health.state);
              return <>
                <p className={`health-lamp ${lamp}`}>
                  <span className="health-lamp-copy">
                    <strong>{foldedHealthLabels[lamp]}</strong>
                    {lamp === 'repairing' && <small>{repairCopy(care.activeCaseProgress)}</small>}
                    {care.health.maintenanceState==='active'&&care.health.maintenanceCaseId&&
                      <Link to={`/formation?aftercareCaseId=${encodeURIComponent(care.health.maintenanceCaseId)}`}>查看维护任务</Link>}
                  </span>
                </p>
                {lamp === 'repairing' && care.activeCaseProgress?.progressPercent != null &&
                  <progress className="health-repair-progress" max="100" value={care.activeCaseProgress.progressPercent} aria-label={`自动修复进度 ${care.activeCaseProgress.progressPercent}%`} />}
              </>;
            })()}
          </section>
          <CollectionDefects shelfEntryId={selected.shelfEntryId} revision={`${care?.basis.careBasisDigest || selected.currentInventoryRevision}:${care?.health.updatedAtMs || 0}`} onChanged={()=>void load()} />
          <div className="collection-exit">
            <Button variant="danger" type="button" onClick={() => void exitCollection()} disabled={exiting}>{exiting ? '正在准备退出…' : '退出收藏'}</Button>
          </div>
        </div>
      </section>
    </div>}
  </section>;
}
