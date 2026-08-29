import { useCallback, useEffect, useRef, useState } from 'react';
import { helixAdminApi, type CareDetail, type CollectionEntry, type HealthState } from './api';
import { newOpaqueId } from './id';
import { Button, LoadingState, PageHeader } from './chrome';
import { healthLabels } from './labels';
import RatingControl from './RatingControl';
import { isUnauthorized, useSession } from './session';
import './collection.css';

const healthFilters: [HealthState | 'all', string][] = [['all', '全部'], ['healthy', '健康'], ['observing', '观察中'], ['repairing', '修复中'], ['attention_required', '需要处理'], ['never_assessed', '尚未检查']];
const dimensionLabels = { custody: '保管', presentation: '呈现', conformance: '合规' };
const careStageLabels: Record<string, string> = { preparing: '正在准备修复', preparing_media: '正在处理媒体', verifying_media: '正在验证媒体', committing_inventory: '正在更新收藏', reassessing: '正在复核结果', waiting_for_recovery: '等待自动恢复' };
const terminalReasonLabels: Record<string, string> = {
  care_basis_changed: '收藏依据已变化，本次修复已停止', modification_fenced: '条目正在执行其他变更，本次修复已停止',
  provider_artifact_not_available: '所需资料暂时无法取得', media_verification_failed: '处理后的媒体未通过复核',
  repair_preparation_exhausted: '材料准备多次失败', repair_commit_exhausted: '收藏更新多次失败',
  settlement_or_commit_failed: '收藏更新或原材料收尾失败', reassessment_exhausted: '结果复核多次失败',
  reassessment_not_healthy: '修复完成后仍未达到收藏要求', case_closure_exhausted: '修复结果未能完成登记',
};

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
  const [collectionMode, setCollectionMode] = useState<'current' | 'history'>('current');
  const closeButton = useRef<HTMLButtonElement>(null);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await helixAdminApi.listCollection({
        shelfId,
        status: collectionMode,
        health: collectionMode === 'current' ? healthFilter : undefined,
      });
      setItems(result.items);
      setShelves(result.shelves || []);
      setSummary(result.summary || { currentCount: result.items.filter((item) => item.status === 'active').length, historyCount: result.items.filter((item) => item.status !== 'active').length });
    }
    catch (cause) { if (isUnauthorized(cause)) expire(); else setError(cause instanceof Error ? cause.message : '收藏读取失败。'); }
    finally { setLoading(false); }
  }, [expire, shelfId, collectionMode, healthFilter]);
  useEffect(() => { void load(); }, [load]);
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
  const filtered = items;
  const selectedShelf = shelves.find((item) => item.shelfId === shelfId);
  const currentCount = selectedShelf ? selectedShelf.currentCount : summary.currentCount;
  const historyCount = selectedShelf ? selectedShelf.historyCount : summary.historyCount;
  const latestTerminalCase = care?.history.cases.filter((item) => item.careBasisDigest === care.basis.careBasisDigest && ['invalidated', 'unresolved'].includes(item.state) && item.terminalAtMs != null)
    .sort((left, right) => Number(right.terminalAtMs) - Number(left.terminalAtMs))[0] || null;
  const currentFindings = care ? Object.values(care.health.dimensions || {}).flatMap((dimension) => dimension.findings || []) : [];
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
      else setError(cause instanceof Error ? cause.message : '退出审阅未能建立。');
      setExiting(false);
    }
  }
  if (!items.length && loading && !error) return <LoadingState>正在读取我的收藏…</LoadingState>;
  return <section className="source-page collection-page">
    <PageHeader title="我的收藏" description="只显示已经上架的电影。" actions={<Button type="button" onClick={() => void load()} disabled={loading}>{loading ? '刷新中…' : '刷新'}</Button>} />
    {error && <p className="form-error" role="alert">{error}</p>}
    <nav className="health-filters" aria-label="收藏架">
      <button type="button" aria-pressed={!shelfId} onClick={() => setShelfId(undefined)}>全部<span>{collectionMode === 'current' ? summary.currentCount : summary.historyCount}</span></button>
      {shelves.map((shelf) => <button type="button" key={shelf.shelfId} aria-pressed={shelfId === shelf.shelfId} onClick={() => setShelfId(shelf.shelfId)}>{shelf.name}<span>{collectionMode === 'current' ? shelf.currentCount : shelf.historyCount}</span></button>)}
    </nav>
    <nav className="health-filters" aria-label="收藏范围">
      <button type="button" aria-pressed={collectionMode === 'current'} onClick={() => setCollectionMode('current')}>当前收藏<span>{currentCount}</span></button>
      <button type="button" aria-pressed={collectionMode === 'history'} onClick={() => setCollectionMode('history')}>历史<span>{historyCount}</span></button>
    </nav>
    {collectionMode === 'current' && <nav className="health-filters" aria-label="收藏健康筛选">{healthFilters.map(([state, label]) => <button type="button" key={state} aria-pressed={healthFilter === state} onClick={() => setHealthFilter(state)}>{label}</button>)}</nav>}
    <section className="collection-library" aria-labelledby="collection-heading">
      <div className="collection-library-heading"><div><h2 id="collection-heading">收藏条目</h2></div><span>{filtered.length} 部</span></div>
      {filtered.length === 0 ? <div className="source-empty"><strong>{items.length === 0 ? '还没有正式上架的电影' : '当前筛选没有收藏'}</strong><p>{items.length === 0 ? '只有收藏架验收并提交之后才会出现在这里。媒体整理工作区里的条目还不算上架。' : '试试其他健康筛选。'}</p></div> : <div className="poster-wall">{filtered.map((item) => <button className="poster-tile" key={item.shelfEntryId} onClick={() => setSelected(item)} aria-label={`查看 ${item.displayIdentity} 详情，收藏健康：${healthLabels[item.health.state]}`}>
        <span className="poster-frame">{item.hasPoster ? <img src={helixAdminApi.collectionPosterUrl(item.shelfEntryId)} alt="" loading="lazy" /> : <span className="poster-fallback" aria-hidden="true"><b>{item.displayIdentity.slice(0, 2)}</b><small>ShelfDeck</small></span>}<span className={`health-seal ${item.health.state}`} title={healthLabels[item.health.state]} aria-hidden="true">{healthLabels[item.health.state].slice(0, 1)}</span></span>
        <span className="poster-caption"><strong>{item.displayIdentity}</strong><small>{item.year || '年份未知'} · {item.shelfName}</small>{item.defectAdmission&&<small>瑕疵入库 · {item.defectAdmission.defects.some((defect)=>defect.defectCode==='size_cap_exceeded')?'体积超过档位上限':`${item.defectAdmission.defectCount}项`}</small>}</span>
      </button>)}</div>}
    </section>
    {selected && <div className="collection-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
      <section className="collection-dialog" role="dialog" aria-modal="true" aria-labelledby="collection-dialog-title">
        <button ref={closeButton} className="collection-dialog-close" onClick={() => setSelected(null)} aria-label="关闭详情">×</button>
        <div className="collection-dialog-poster">{selected.hasPoster ? <img src={helixAdminApi.collectionPosterUrl(selected.shelfEntryId)} alt={`${selected.displayIdentity} 海报`} /> : <span className="poster-fallback"><b>{selected.displayIdentity.slice(0, 2)}</b><small>ShelfDeck</small></span>}</div>
        <div className="collection-dialog-copy">
          <p className="eyebrow">{selected.shelfName}</p>
          <h2 id="collection-dialog-title">{selected.displayIdentity}</h2>
          <p className="collection-dialog-meta">{selected.year || '年份未知'} · {selected.genres.length ? selected.genres.join(' / ') : '类型未记录'}</p>
          <p className="collection-dialog-overview">{selected.overview || '暂无剧情简介。'}</p>
          {selected.defectAdmission&&<p className="form-notice">瑕疵入库 · {selected.defectAdmission.defects.map((defect)=>defect.defectCode==='size_cap_exceeded'?'体积超过档位上限':defect.defectCode==='actor_unavailable'?'演员资料缺失':'寻源耗尽保留原片').join('、')}</p>}
          {selected.people.length > 0 && <dl className="collection-people"><dt>演职人员</dt><dd>{selected.people.slice(0, 12).map((person) => person.displayName).join('、')}</dd></dl>}
          <dl className="collection-facts">
            <div><dt>收藏架</dt><dd>{selected.shelfName}</dd></div>
            <div><dt>占用空间</dt><dd>{formatBytes(selected.occupancyBytes)}</dd></div>
            <div><dt>主视频</dt><dd>{selected.primaryVideoBytes == null ? '—' : `${formatBytes(selected.primaryVideoBytes)}${selected.primaryContainer ? ` · ${selected.primaryContainer}` : ''}`}</dd></div>
            {(selected.videoCodec || selected.videoRaster) && <div><dt>编码与清晰度</dt><dd>{[selected.videoCodec, selected.videoRaster].filter(Boolean).join(' · ')}</dd></div>}
            <div><dt>海报 / NFO</dt><dd>{selected.hasPoster ? '有海报' : '无海报'} · {selected.hasNfo ? '有 NFO' : '无 NFO'}</dd></div>
            <div><dt>资料来源</dt><dd>{selected.provider === 'tmdb' ? 'TMDB' : selected.provider}</dd></div>
            <div><dt>状态</dt><dd>{selected.status === 'active' ? '当前收藏' : '历史收藏'}</dd></div>
          </dl>
          <div className="collection-rating"><span>我的评分</span><RatingControl targetType="shelf_entry" targetId={selected.shelfEntryId} label={selected.displayIdentity} /></div>
          <section className="collection-health" aria-labelledby="collection-health-heading">
            <div className="collection-health-heading"><div><h3 id="collection-health-heading">收藏健康 · {healthLabels[care?.health.state || selected.health.state]}</h3></div>
              <Button type="button" onClick={() => void checkHealth()} disabled={checking}>{checking ? '已开始检查…' : '立即检查健康'}</Button>
            </div>
            {!care ? <p className="health-loading">正在读取健康详情…</p> : <>
              <div className="health-dimensions">{(['custody', 'presentation', 'conformance'] as const).map((kind) => <article key={kind}><strong>{dimensionLabels[kind]}</strong><span>{healthLabels[care.health.dimensions?.[kind]?.state || 'never_assessed']}</span><small>{care.health.dimensions?.[kind]?.assessedAtMs ? new Date(care.health.dimensions[kind].assessedAtMs!).toLocaleString() : '尚未检查'}</small></article>)}</div>
               {care.activeCaseProgress && <div className="health-case-progress"><div><strong>自动修复进行中</strong><span>{care.activeCaseProgress.progressPercent == null ? (careStageLabels[care.activeCaseProgress.stage] || '处理中') : `${care.activeCaseProgress.progressPercent}%`}</span></div>{care.activeCaseProgress.progressPercent != null && <progress max="100" value={care.activeCaseProgress.progressPercent} aria-label={`自动修复进度 ${care.activeCaseProgress.progressPercent}%`} />}</div>}
               {!care.activeCaseProgress && latestTerminalCase?.terminalReasonCode && <div className="health-findings"><strong>最近一次自动修复未完成</strong><p>{terminalReasonLabels[latestTerminalCase.terminalReasonCode] || `原因：${latestTerminalCase.terminalReasonCode}`}</p></div>}
              {currentFindings.length > 0 && <div className="health-findings"><strong>当前发现</strong>{currentFindings.map((item) => <p key={item.findingId}>{item.findingKind}</p>)}</div>}
              <details><summary>技术标识</summary><p className="health-basis">条目 {selected.shelfEntryId}</p></details>
            </>}
          </section>
          <div className="collection-exit">
            <Button variant="danger" type="button" onClick={() => void exitCollection()} disabled={exiting}>{exiting ? '正在建立审阅…' : '退出收藏'}</Button>
            <small>这一步只建立可取消的审阅，不会立即删除文件。</small>
          </div>
        </div>
      </section>
    </div>}
  </section>;
}
