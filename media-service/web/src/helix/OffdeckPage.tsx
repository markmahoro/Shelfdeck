import { useCallback, useEffect, useRef, useState } from 'react';
import { helixAdminApi, type OffdeckEntry, type OffdeckCase, type OffdeckCandidate, type OffdeckDuplicateGroup, type OffdeckReview } from './api';
import { newOpaqueId } from './id';
import { Button, LoadingState, PageHeader } from './chrome';
import { caseStateLabels, labelOf, reviewStateLabels } from './labels';
import { isUnauthorized, useSession } from './session';
import './collection.css';

function formatGiB(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

export default function OffdeckPage() {
  const { expire } = useSession();
  const [candidates, setCandidates] = useState<OffdeckCandidate[]>([]);
  const [candidateCount,setCandidateCount] = useState(0);
  const [candidateCursor,setCandidateCursor] = useState<string|null>(null);
  const [groups, setGroups] = useState<OffdeckDuplicateGroup[]>([]);
  const [groupSelection, setGroupSelection] = useState<Record<string, string[]>>({});
  const [cases, setCases] = useState<OffdeckCase[]>([]);
  const [review, setReview] = useState<OffdeckReview | null>(null);
  const [currentCount, setCurrentCount] = useState(0);
  const [shelfNames,setShelfNames] = useState<Record<string,string>>({});
  const [caseCounts, setCaseCounts] = useState({active:0,completed:0});
  const [caseCursors, setCaseCursors] = useState<{active:string|null;completed:string|null}>({active:null,completed:null});
  const [searchHits, setSearchHits] = useState<OffdeckEntry[]>([]);
  const [searchCursor, setSearchCursor] = useState<string|null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchFailed,setSearchFailed] = useState(false);
  const [searchRetry,setSearchRetry] = useState(0);
  const searchGeneration = useRef(0);
  const [bulkSelection, setBulkSelection] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [titles, setTitles] = useState<Record<string, { title: string; occupancyBytes: number | null; shelfName: string }>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const fail = useCallback((cause: unknown, fallback: string) => {
    if (isUnauthorized(cause)) expire();
    else setError(cause instanceof Error ? cause.message : fallback);
  }, [expire]);

  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const [candidateResult, active, completed] = await Promise.all([
        helixAdminApi.getOffdeckWorkbench(),
        helixAdminApi.listOffdeckWorkCases('active'),
        helixAdminApi.listOffdeckWorkCases('completed'),
      ]);
      setCandidates(candidateResult.candidates);
      setCandidateCount(candidateResult.candidateCount);setCandidateCursor(candidateResult.nextCursor);
      setGroups(candidateResult.duplicateGroups);
      setCases([...active.items,...completed.items]);
      setCurrentCount(candidateResult.currentCount);
      setShelfNames(Object.fromEntries(candidateResult.shelves.map(shelf=>[shelf.shelfId,shelf.name])));
      setCaseCounts(active.counts);
      setCaseCursors({active:active.nextCursor,completed:completed.nextCursor});
      setBulkSelection([]);
      setTitles(Object.fromEntries([...candidateResult.entries, ...active.entries,...completed.entries].map((item) => [item.shelfEntryId, { title: item.displayIdentity, occupancyBytes: item.occupancyBytes ?? null, shelfName: item.shelfName }])));
      const id = new URLSearchParams(location.search).get('review');
      if (id) setReview(await helixAdminApi.getOffdeckReview(id));
      else setReview(null);
      setLoaded(true);
    } catch (cause) { fail(cause, '退出收藏读取失败。'); }
    finally { setBusy(false); }
  }, [fail]);
  useEffect(() => { void load(); }, [load]);
  const remember = useCallback((items:OffdeckEntry[]) => setTitles(current=>({...current,...Object.fromEntries(items.map(item=>[item.shelfEntryId,{title:item.displayIdentity,occupancyBytes:item.occupancyBytes??null,shelfName:item.shelfName}]))})),[]);
  useEffect(()=>{
    const generation=++searchGeneration.current;
    setSearchHits([]);setSearchCursor(null);setSearchFailed(false);
    if(!search.trim()){setSearchBusy(false);return;}
    setSearchBusy(true);setError('');
    const timer=window.setTimeout(()=>{
      void helixAdminApi.searchOffdeckEntries(search.trim()).then(result=>{
        if(generation!==searchGeneration.current)return;
        setSearchHits(result.items);setSearchCursor(result.nextCursor);remember(result.items);
      }).catch(cause=>{if(generation===searchGeneration.current){setSearchFailed(true);fail(cause,'收藏搜索失败。');}})
        .finally(()=>{if(generation===searchGeneration.current)setSearchBusy(false);});
    },250);
    return ()=>{window.clearTimeout(timer);searchGeneration.current++;};
  },[search,searchRetry,fail,remember]);
  const reviewEntryIds=review?.state!=='preparing'?JSON.stringify([...new Set(review?.scopes.map(scope=>scope.shelfEntryId)||[])].sort()):'[]';
  useEffect(()=>{
    let active=true;
    const ids=JSON.parse(reviewEntryIds) as string[];
    void (async()=>{try{for(let offset=0;offset<ids.length&&active;offset+=25){
      const result=await helixAdminApi.getOffdeckEntryDisplay(ids.slice(offset,offset+25));
      if(active)remember(result.items);
    }}catch(cause){if(active)fail(cause,'退出收藏名称读取失败。');}})();
    return ()=>{active=false;};
  },[reviewEntryIds,remember,fail]);
  async function moreSearch(){
    if(!searchCursor||searchBusy)return;
    const generation=searchGeneration.current;setSearchBusy(true);
    try{const result=await helixAdminApi.searchOffdeckEntries(search.trim(),searchCursor);
      if(generation!==searchGeneration.current)return;
      setSearchHits(current=>[...current,...result.items.filter(item=>!current.some(old=>old.shelfEntryId===item.shelfEntryId))]);setSearchCursor(result.nextCursor);remember(result.items);
    }catch(cause){if(generation===searchGeneration.current)fail(cause,'收藏搜索失败。');}
    finally{if(generation===searchGeneration.current)setSearchBusy(false);}
  }
  async function moreCases(classification:'active'|'completed'){
    const cursor=caseCursors[classification];if(!cursor)return;
    const result=await helixAdminApi.listOffdeckWorkCases(classification,cursor);
    setCases(current=>[...current,...result.items.filter(item=>!current.some(old=>old.offdeckCaseId===item.offdeckCaseId))]);
    setCaseCursors(current=>({...current,[classification]:result.nextCursor}));setCaseCounts(result.counts);remember(result.entries);
  }
  async function moreCandidates(){
    if(!candidateCursor)return;
    const result=await helixAdminApi.getOffdeckWorkbench(candidateCursor);
    setCandidates(current=>[...current,...result.candidates.filter(item=>!current.some(old=>old.candidate_id===item.candidate_id))]);
    setGroups(current=>[...current,...result.duplicateGroups.filter(item=>!current.some(old=>old.duplicate_group_id===item.duplicate_group_id))]);
    setCandidateCount(result.candidateCount);setCandidateCursor(result.nextCursor);remember(result.entries);
  }
  useEffect(() => {
    if (!review || review.state !== 'preparing') return;
    let active = true;
    let timer: number;
    const refresh = async () => {
      try {
        const progress = await helixAdminApi.getOffdeckReviewProgress(review.reviewId);
        if (!active) return;
        if (progress.state === 'preparing') {
          timer = window.setTimeout(() => void refresh(), 3000);
        } else {
          const next = await helixAdminApi.getOffdeckReview(review.reviewId);
          if (active) setReview(next);
        }
      } catch (cause) {
        if (active) {
          fail(cause, '退出范围准备失败。');
          timer = window.setTimeout(() => void refresh(), 3000);
        }
      }
    };
    timer = window.setTimeout(() => void refresh(), 3000);
    return () => { active = false; window.clearTimeout(timer); };
  }, [fail, review]);

  async function action(run: () => Promise<unknown>, refreshLists = false) {
    setBusy(true); setError('');
    try { await run(); if (refreshLists) await load(); }
    catch (cause) { fail(cause, '操作未完成。'); }
    finally { setBusy(false); }
  }
  function toggleMember(groupId: string, shelfEntryId: string) {
    setGroupSelection((current) => {
      const selected = new Set(current[groupId] || []);
      selected.has(shelfEntryId) ? selected.delete(shelfEntryId) : selected.add(shelfEntryId);
      return { ...current, [groupId]: [...selected].sort() };
    });
  }
  function toggleBulkEntry(shelfEntryId: string) {
    setBulkSelection((current) => {
      const selected = new Set(current);
      selected.has(shelfEntryId) ? selected.delete(shelfEntryId) : selected.add(shelfEntryId);
      return [...selected].sort();
    });
  }
  function titleOf(id: string | null) {
    if (!id) return '未命名收藏';
    return titles[id]?.title || '未命名收藏';
  }
  function sizeOf(id: string | null) {
    if (!id) return null;
    return titles[id]?.occupancyBytes ?? null;
  }
  async function openCandidate(item: OffdeckCandidate) {
    let body: Record<string, unknown>;
    if (item.candidate_kind === 'entry') body = { originKind: 'candidate', originRef: item.candidate_id, idempotencyKey: `offdeck-candidate:${item.candidate_id}` };
    else {
      const selected = groupSelection[item.duplicate_group_id || ''] || [];
      if (selected.length === 0) throw new Error('请先选择重复组中需要退出的收藏。');
      body = { shelfEntryIds: selected, originKind: 'duplicate_group', originRef: item.duplicate_group_id, idempotencyKey: `offdeck-duplicate:${item.duplicate_group_id}:${selected.join(',')}` };
    }
    const value = await helixAdminApi.createOffdeckReview({ ...body, actorId: 'admin' });
    setReview(value);
    history.replaceState(null, '', `/offdeck?review=${encodeURIComponent(value.reviewId)}`);
  }
  async function openBulkReview() {
    const shelfEntryIds = [...new Set(bulkSelection)].sort();
    if (shelfEntryIds.length === 0) throw new Error('请先选择需要退出的收藏。');
    const idempotencyKey = `offdeck-batch:${shelfEntryIds.join(',')}:${newOpaqueId()}`;
    const value = await helixAdminApi.createOffdeckReview({ shelfEntryIds, actorId: 'admin', idempotencyKey });
    setReview(value);
    history.replaceState(null, '', `/offdeck?review=${encodeURIComponent(value.reviewId)}`);
  }
  async function closeReview() {
    history.replaceState(null, '', '/offdeck');
    setReview(null);
  }
  async function cancelReview() {
    if (!review) return;
    await helixAdminApi.cancelOffdeckReview(review.reviewId);
    history.replaceState(null, '', '/offdeck');
    setReview(null);
  }

  const openCandidates = candidates.filter((item) => item.state === 'open');
  const activeCases = cases.filter((item) => item.state !== 'completed');
  const completedCases = cases.filter((item) => item.state === 'completed')
    .sort((left, right) => Number(right.terminalAtMs) - Number(left.terminalAtMs));
  const needle = search.trim().toLowerCase();
  const selectedEntries = bulkSelection.slice(0,25).map(id=>({shelfEntryId:id,displayIdentity:titleOf(id),shelfName:titles[id]?.shelfName||'',occupancyBytes:sizeOf(id)}));
  const reviewScopes = review?.scopes.filter((scope) => scope.state !== 'stale') || [];
  const staleScopes = review?.scopes.filter((scope) => scope.state === 'stale') || [];
  const scopeMaterials = reviewScopes.flatMap((scope) => scope.materials);
  const primaryRoles = new Set(['primary_payload', 'structural_dependency']);
  const cancelledReview = review?.state === 'cancelled';
  const reviewEntries = review?.selection?.entryCount ?? reviewScopes.length;
  const reviewPrimary = review?.selection?.primaryCount ?? scopeMaterials.filter((material) => primaryRoles.has(material.role)).length;
  const reviewRelated = scopeMaterials.filter((material) => !primaryRoles.has(material.role)).length;
  const reviewBytes = review?.selection?.totalBytes ?? reviewScopes.reduce((sum, scope) => sum + scope.totalBytes, 0);
  const nextReviewAction = review?.state === 'open' ? '核对将删除的文件'
    : review?.state === 'awaiting_escalation' ? '再次确认大批量'
    : review?.state === 'selection_confirmed' ? '确认删除'
    : review?.state === 'preparing' ? '正在准备将删除的文件'
    : null;

  if (!loaded && busy) return <LoadingState>正在读取退出收藏…</LoadingState>;
  return <section className="source-page offdeck-page">
    <PageHeader title="退出收藏" actions={<Button type="button" onClick={() => void load()} disabled={busy}>刷新</Button>} />
    {error && <p className="form-error" role="alert">{error}</p>}
    <section className="offdeck-task">
      <div className="source-card-heading"><div><h2>系统建议退出</h2></div><span>{candidateCount > 0 ? `${candidateCount} 项` : '暂无'}</span></div>
      {openCandidates.length === 0 ? null : <div className="offdeck-suggest">{openCandidates.map((item) => {
        const group = item.candidate_kind === 'duplicate_group' ? groups.find((value) => value.duplicate_group_id === item.duplicate_group_id) : null;
        const size = sizeOf(item.shelf_entry_id);
        return <article key={item.candidate_id}>
          <strong>{item.candidate_kind === 'entry' ? titleOf(item.shelf_entry_id) : '重复收藏'}</strong>
          <small>{item.candidate_kind === 'entry' ? `规则建议退出${size ? ` · ${formatGiB(size)}` : ''}` : `${group?.members.length || 0} 个重复项`}</small>
          {group && <fieldset><legend>选择需要退出的成员</legend>{group.members.map((member) => <label key={member.shelf_entry_id}><input type="checkbox" checked={(groupSelection[group.duplicate_group_id] || []).includes(member.shelf_entry_id)} onChange={() => toggleMember(group.duplicate_group_id, member.shelf_entry_id)} />{titleOf(member.shelf_entry_id)}</label>)}</fieldset>}
          <div className="button-row">
            <Button variant="primary" type="button" onClick={() => void action(() => openCandidate(item))}>退出这部</Button>
            <Button type="button" onClick={() => void action(() => item.candidate_kind === 'entry' ? helixAdminApi.suppressOffdeckCandidate(item.candidate_id) : helixAdminApi.whitelistOffdeckDuplicate(item.duplicate_group_id!), true)}>先留着</Button>
          </div>
        </article>;
      })}</div>}
      {candidateCursor&&<Button type="button" disabled={busy} onClick={()=>void action(moreCandidates)}>更多退出建议</Button>}
    </section>
    <section className="offdeck-task offdeck-bulk-task">
      <div className="source-card-heading"><div><h2>手动退出</h2></div><span>当前收藏 {currentCount} 部</span></div>
      {currentCount === 0 ? <div className="source-empty"><strong>当前没有可退出的收藏</strong></div> : <>
        <div className="offdeck-bulk-toolbar">
          <label className="offdeck-search"><span className="sr-only">搜索收藏后退出</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索片名后选择" /></label>
          <div><strong>已选择 {bulkSelection.length} 部</strong></div>
          <div className="button-row">
            <Button type="button" disabled={busy} onClick={() => void action(async()=>{const result=await helixAdminApi.selectAllOffdeckEntries();setBulkSelection(result.shelfEntryIds);setCurrentCount(result.shelfEntryIds.length);const preview=await helixAdminApi.searchOffdeckEntries('');remember(preview.items);})}>全选当前收藏</Button>
            <Button type="button" onClick={() => setBulkSelection([])} disabled={busy || bulkSelection.length === 0}>清空选择</Button>
          </div>
        </div>
        {needle ? <fieldset className="offdeck-bulk-list">
          <legend>搜索结果</legend>
          {searchFailed&&<div className="button-row" style={{gridColumn:'1 / -1'}}><Button type="button" disabled={searchBusy} onClick={()=>setSearchRetry(current=>current+1)}>重新搜索</Button></div>}
          {searchHits.length === 0 ? <p>{searchBusy?'正在搜索…':'没有匹配的收藏。'}</p> : searchHits.map((item) => <label key={item.shelfEntryId}>
            <input type="checkbox" checked={bulkSelection.includes(item.shelfEntryId)} onChange={() => toggleBulkEntry(item.shelfEntryId)} />
            <span><strong>{item.displayIdentity}</strong><small>{item.shelfName} · {formatGiB(item.occupancyBytes)}</small></span>
          </label>)}
          {searchCursor&&<Button type="button" disabled={searchBusy} onClick={()=>void moreSearch()}>更多搜索结果</Button>}
        </fieldset> : selectedEntries.length > 0 ? <fieldset className="offdeck-bulk-list">
          <legend>已选择{bulkSelection.length>25?'（前 25 部）':''}</legend>
          {selectedEntries.map((item) => <label key={item.shelfEntryId}>
            <input type="checkbox" checked onChange={() => toggleBulkEntry(item.shelfEntryId)} />
            <span><strong>{item.displayIdentity}</strong><small>{item.shelfName} · {formatGiB(item.occupancyBytes??0)}</small></span>
          </label>)}
        </fieldset> : null}
        <div className="button-row offdeck-bulk-action">
          <Button variant="primary" type="button" onClick={() => void action(openBulkReview)} disabled={busy || bulkSelection.length === 0}>确认退出</Button>
        </div>
      </>}
    </section>
    <section className="offdeck-task">
      <div className="source-card-heading"><div><h2>正在退出</h2></div><span>{caseCounts.active > 0 ? `${caseCounts.active} 部` : '暂无'}</span></div>
      {activeCases.length === 0 ? null : activeCases.map((item) => <article className="source-row" key={item.offdeckCaseId}>
        <div>
          <strong>{titleOf(item.shelfEntryId)}</strong>
          <small className="ui-state" data-state={item.state}>{labelOf(caseStateLabels, item.state)}</small>
          {item.blockedReason && <p>暂停原因：{item.blockedReason}{item.retryAtMs ? ` · ${new Date(item.retryAtMs).toLocaleString()} 后自动恢复` : ''}</p>}
        </div>
        {item.state === 'awaiting_reauthorization' && <Button variant="primary" type="button" onClick={() => void action(async () => {
          const value = await helixAdminApi.createOffdeckReview({ caseId: item.offdeckCaseId, originKind: 'reauthorization', originRef: item.offdeckCaseId, actorId: 'admin', idempotencyKey: `offdeck-reauthorize:${item.offdeckCaseId}:${item.recoveryRevision}` });
          setReview(value); history.replaceState(null, '', `/offdeck?review=${encodeURIComponent(value.reviewId)}`);
        })}>重新授权</Button>}
      </article>)}
      {caseCursors.active&&<Button type="button" disabled={busy} onClick={()=>void action(()=>moreCases('active'))}>更多正在退出</Button>}
    </section>
    <section className="offdeck-task offdeck-history-task">
      <div className="source-card-heading"><div><h2>已退出记录</h2></div><span>{caseCounts.completed > 0 ? `${caseCounts.completed} 条` : '暂无'}</span></div>
      {completedCases.length === 0 ? null : <div className="offdeck-history-list" role="list">{completedCases.map((item) => {
        return <article className="source-row" role="listitem" key={item.offdeckCaseId}>
          <div><strong>{titleOf(item.shelfEntryId)}</strong><small>{titles[item.shelfEntryId]?.shelfName || '原收藏架'} · 已完成退出</small></div>
          <time dateTime={item.terminalAtMs ? new Date(item.terminalAtMs).toISOString() : undefined}>{item.terminalAtMs ? new Date(item.terminalAtMs).toLocaleString() : '完成时间未记录'}</time>
        </article>;
      })}</div>}
      {caseCursors.completed&&<Button type="button" disabled={busy} onClick={()=>void action(()=>moreCases('completed'))}>更多已退出记录</Button>}
    </section>
    {review && <div className="collection-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !['preparing', 'open', 'selection_confirmed', 'awaiting_escalation'].includes(review.state)) void closeReview(); }}>
      <section className="collection-dialog offdeck-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="offdeck-confirm-title">
        <button className="collection-dialog-close" type="button" onClick={() => void closeReview()} aria-label="关闭">×</button>
        <div className="collection-dialog-copy">
          <h2 id="offdeck-confirm-title">{cancelledReview?'已取消的退出审阅':review.state==='awaiting_escalation'?'再次核对大批量退出':'将删除的文件'}</h2>
          <p className="collection-dialog-meta">{labelOf(reviewStateLabels, review.state)}</p>
          {review.state === 'awaiting_escalation' && <p className="form-error" role="alert">这次数量或体积较大，请再次核对后再确认删除。没有授权不会删除文件。</p>}
          {review.state === 'selection_confirmed' && <p className="form-error" role="alert">确认后将删除下列文件，不能反悔。</p>}
          {cancelledReview && <p>本次退出已取消，不会依据这次审阅删除文件。</p>}
          {review.state!=='preparing'&&!cancelledReview&&<section className="offdeck-review-summary" aria-label="本次退出范围">
            <p><strong>{reviewEntries} 部收藏 · {reviewPrimary} 个主视频或光盘结构文件 · {reviewRelated} 个附属文件</strong></p>
            <p>文件总空间：{formatGiB(reviewBytes)}{review.selection?` · 占全部当前收藏 ${(review.selection.deckCoverageRatio*100).toFixed(1)}%`:''}</p>
            {review.selection && (review.selection.shelfCoverageRatios ? Object.entries(review.selection.shelfCoverageRatios).map(([shelfId, ratio]) => <p key={shelfId}>收藏架覆盖率：{shelfNames[shelfId] || '原收藏架'} {(ratio * 100).toFixed(1)}%（确认选择时）</p>) : <p>此历史审阅未保存收藏架覆盖率，不能由当前收藏数量还原。</p>)}
            <p>最终授权后将执行删除，不能撤销。仍被其他收藏引用的共享附属文件会保留，实际释放空间可能较小。</p>
          </section>}
          {staleScopes.length > 0 && <p role="status">{staleScopes.length} 部范围已排除或失效，不会按本次范围删除。</p>}
          {reviewScopes.map((scope) => <article className="offdeck-scope" key={scope.destructionScopeId}>
            <strong>{titleOf(scope.shelfEntryId)}</strong>
            <small>收藏架：{titles[scope.shelfEntryId]?.shelfName||'暂时无法读取'}</small>
            <small>{scope.memberCount} 个文件 · {formatGiB(scope.totalBytes)}</small>
            {scope.materials.map((material) => <p key={material.materialKey}>{material.role === 'primary_payload' ? '主视频' : material.role === 'structural_dependency' ? '光盘结构文件' : '附属文件'} · {material.location}{material.deleteCondition==='release_related_then_delete_if_unreferenced'?' · 仍被引用时保留':''}</p>)}
          </article>)}
          <div className="button-row">
            {review.state === 'open' && <Button variant="primary" type="button" onClick={() => void action(async () => setReview(await helixAdminApi.confirmOffdeckSelection(review.reviewId, { actorId: 'admin' })))}>核对将删除的文件</Button>}
            {review.state === 'awaiting_escalation' && <Button variant="danger" type="button" onClick={() => void action(async () => setReview(await helixAdminApi.confirmOffdeckHighVolume(review.reviewId, { actorId: 'admin' })))}>再次确认大批量</Button>}
            {review.state === 'selection_confirmed' && <Button variant="danger" type="button" onClick={() => void action(() => helixAdminApi.authorizeOffdeck(review.reviewId), true)}>确认删除</Button>}
            {['preparing', 'open', 'selection_confirmed', 'awaiting_escalation'].includes(review.state) && <Button type="button" onClick={() => void action(cancelReview, true)}>取消这次退出</Button>}
          </div>
          {nextReviewAction && review.state === 'preparing' && <p>{nextReviewAction}</p>}
        </div>
      </section>
    </div>}
  </section>;
}
