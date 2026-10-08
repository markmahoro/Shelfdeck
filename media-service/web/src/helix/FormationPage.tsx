import ManualIdentityDialog from './ManualIdentityDialog';
import {DefectAdmissionControl} from './DefectAdmissionControl';
import RunOutcomeDetail from './RunOutcomeDetail';
import {readWorkbenchPage,type WorkbenchCursor} from './workbench-pagination';
import { ProcessDialog, ProcessStages, progressDetail } from './ProcessStages';
import { useSearchParams } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdminApiError, helixAdminApi, type DefectAdmissionCandidate, type FormationRunHistory, type FormationSubject, type FormationSummary, type PerceptionSyncState, type Shelf } from './api';
import { Button, LoadingState, PageHeader } from './chrome';
import { Dialog } from '../components/ui';
import RatingControl from './RatingControl';
import { CareWorkRow, CareWorkDetail } from './CareWorkRow';
import type { CareWorkItem } from './api';
import { isUnauthorized, useSession } from './session';
import { networkErrorLabel } from './error-labels';
import { newOpaqueId } from './id';

const emptySummary: FormationSummary = { totalCount:0, inProgressCount:0, attentionRequiredCount:0, completedCount:0 };
type Filter = 'all'|'in_progress'|'attention_required'|'ended';
type LedgerRow = { kind:'formation'; item:FormationSubject } | { kind:'ended'; item:FormationRunHistory } | { kind:'care'; item:CareWorkItem };

function formatTime(value:number) { return value > 0 ? new Intl.DateTimeFormat('zh-CN', { dateStyle:'medium', timeStyle:'short' }).format(new Date(value)) : '—'; }
function currentProgressLabel(item:FormationSubject) { return item.currentPlan?.label || item.nextAction.label; }
function currentProgressDetail(item:FormationSubject) {
  if (!item.currentPlan) return null;
  const progress=item.currentPlan.progress ? progressDetail(item.currentPlan.progress) : '';
  return [item.currentPlan.statusText,progress].filter(Boolean).join(' · ') || null;
}
function statusLabel(item:FormationSubject) { return ({ in_progress:'整理中', attention_required:'需要处理', completed:'已完成整理' } as const)[item.classification]; }
function stageState(item:FormationSubject) { return item.classification === 'completed' ? 'completed' : item.classification === 'attention_required' ? 'attention' : 'pending'; }
function canExpedite(item:FormationSubject) { return item.currentRun?.state === 'active' && !item.handoffB; }
function canDiscardRejectedHandoff(item:FormationSubject) {
  return item.currentRun?.state === 'active'
    && item.classification === 'attention_required'
    && Boolean(item.handoffB)
    && !item.executorIssue?.canRetry
    && !item.productIdentityIssue;
}
function canChooseShelf(item:FormationSubject) { return item.routingState==='unresolved' && Number.isSafeInteger(item.routingDecisionHeadRevision) && Boolean(item.routingDecisionHeadDigest); }
function defectAdmissionCommitted(previous:FormationSubject,current:FormationSubject) {
  return previous.currentRun?.state==='frozen'
    && current.currentRun?.libraRunId===previous.currentRun.libraRunId
    && current.currentRun.state==='active'
    && current.currentRun.stateRevision>previous.currentRun.stateRevision;
}
function formatGiB(bytes:number) { return `${(Number(bytes)/1073741824).toFixed(1)} GiB`; }
function defectLabel(defect:DefectAdmissionCandidate['defects'][number], forecast:DefectAdmissionCandidate['sizeForecast']) {
  if(defect.defectCode==='artifacts_unavailable')return `缺少${(defect.artifactKindCodes||[]).map(kind=>({nfo:'资料文件',poster:'海报',fanart:'背景图'}[kind]||kind)).join('、')}`;
  if(defect.defectCode==='metadata_fields_unavailable') {
    const names:Record<string,string>={actor:'演员',director:'导演',plot:'简介',genre:'类型',title:'片名',year_or_release_date:'年份或上映日期',release_date:'上映日期',studio:'制作公司'};
    return `缺少${(defect.metadataFieldCodes||[]).map(code=>names[code]||code).join('、')}资料`;
  }
  if (defect.defectCode==='actor_unavailable') return '缺少演员资料';
  if (defect.defectCode==='media_requirements_unmet') return '原始媒体可用，但未达到本次媒体要求；本次处理失败原因仍保留';
  if (defect.defectCode==='size_cap_exceeded') {
    if (forecast?.maxSizeBytes && forecast.predictedBytes) {
      return `上限 ${formatGiB(forecast.maxSizeBytes)}，预计 ${formatGiB(forecast.predictedBytes)}，大约超出 ${formatGiB(forecast.overshootBytes)}。将保留无损音轨并转成 HEVC。`;
    }
    return '成品将超过本档体积上限。将保留无损音轨并转成 HEVC。';
  }
  return '外部寻源已耗尽，将保留原始媒体';
}
function shelfName(item:FormationSubject, shelves:Shelf[]) { return item.targetShelfName || shelves.find((shelf)=>shelf.shelfId===item.targetShelfId)?.name || '尚未选定'; }
function ratingText(item:FormationSubject, acquisitionIncomplete:boolean) {
  if (item.myRating) return `${item.myRating} 星 · ${item.myRatingSource === 'douban' ? '豆瓣' : 'ShelfDeck'}`;
  if (item.productIdentityIssue) return item.contentProfile === 'series' ? '剧集身份待确认' : '影片身份待确认';
  if (item.ratingState === 'pending') return '正在匹配豆瓣评分';
  if (item.ratingReasonCode === 'requested_fact_absent') return '豆瓣记录没有评分';
  if (item.ratingReasonCode === 'strongest_value_conflict') return '豆瓣评分记录有冲突';
  if (acquisitionIncomplete && item.ratingResolutionStatus === 'not_found') return '豆瓣同步未完成，暂不能确认';
  if (item.ratingResolutionStatus === 'not_found') return '豆瓣暂无匹配评分';
  return '正在匹配豆瓣评分';
}

function SeriesDelivery({item}:{item:FormationSubject}) {
  const scope=item.seriesDelivery;
  if(!scope)return null;
  const episodes=scope.episodeKeys.map(key=>'E'+String(Number(key.slice(1))).padStart(2,'0')).join('、');
  return <small>第 {scope.seasonNumber} 季 · 本批 {scope.episodeKeys.length} 集（{episodes}）· {scope.physicalFileCount} 个文件</small>;
}

function ProcessDetail({ item, loading=false, error='' }:{ item:FormationSubject; loading?:boolean; error?:string }) {
  const detail=item.processDetail;
  const failureNotes=[...new Map((item.failureDiagnostics||[]).map(f=>{
    const d=f.diagnostics;
    return [JSON.stringify([d?.sourceDirectory,d?.unknownNames,d?.truncated,d?.unknownMemberCount,Boolean(d?.field),d?.networkCode,Boolean(d?.timeout),f.diagnosticsUnavailable]),f];
  })).values()];
  return <article className="formation-process-card" aria-label={`${item.displayIdentity}的媒体整理过程`}>
    <header className="formation-process-head"><div><span className="formation-process-eyebrow">媒体整理过程</span><h3>{item.displayIdentity}</h3><SeriesDelivery item={item} /><p>{currentProgressLabel(item)}</p></div><span className="formation-process-status" data-state={stageState(item)}>{statusLabel(item)}</span></header>
    {failureNotes.map(f=><section key={f.eventId} role="note">
      {(f.diagnosticsUnavailable||!f.diagnostics||!f.diagnostics.sourceDirectory&&!f.diagnostics.unknownNames?.length&&!f.diagnostics.field&&!f.diagnostics.networkCode&&!f.diagnostics.timeout)&&<p>具体失败原因暂不可用</p>}
      {f.diagnostics?.sourceDirectory&&<p>{f.diagnostics.sourceDirectory}</p>}
      {Boolean(f.diagnostics?.unknownNames?.length)&&<><p>目录中存在未确认文件</p><ul>{f.diagnostics?.unknownNames?.map((name,index)=><li key={index}>{name}</li>)}</ul></>}
      {f.diagnostics?.truncated&&<p>共 {f.diagnostics.unknownMemberCount} 项，以上为部分列表。</p>}
      {f.diagnostics?.field&&<p>处理依据存在冲突</p>}
      {f.diagnostics?.networkCode&&!f.diagnostics.timeout&&<p>{networkErrorLabel(f.diagnostics.networkCode)}</p>}
      {f.diagnostics?.timeout&&<p>请求超时</p>}
    </section>)}
    <dl className="formation-process-facts"><div><dt>目标收藏架</dt><dd>{item.targetShelfName || '尚未选定'}</dd></div><div><dt>收藏要求</dt><dd>{item.organizingRequirement}</dd></div><div><dt>当前进展</dt><dd>{currentProgressLabel(item)}</dd></div></dl>
    {loading?<p role="status">正在读取整理计划…</p>:error?<p role="alert">{error}</p>:detail?.contract==='formation_process_actual_plans@1'?<ProcessStages stages={detail.stages} />:<div className="formation-process-unavailable"><strong>暂时无法读取真实计划</strong><p>当前没有可供展示的计划记录。页面不会根据状态推测或补造计划。</p></div>}
  </article>;
}

export default function FormationPage() {
  const { expire }=useSession();
  const [searchParams]=useSearchParams(),linkedCaseId=searchParams.get('aftercareCaseId');
  const [active,setActive]=useState<FormationSubject[]>([]),[completed,setCompleted]=useState<FormationSubject[]>([]),[ended,setEnded]=useState<FormationRunHistory[]>([]),[summary,setSummary]=useState(emptySummary),[shelves,setShelves]=useState<Shelf[]>([]);
  const [perceptionSync,setPerceptionSync]=useState<PerceptionSyncState|null>(null);
  const [filter,setFilter]=useState<Filter>('all'),[q,setQ]=useState(''),[shelfFilter,setShelfFilter]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [selected,setSelected]=useState<FormationSubject|null>(null),triggerRef=useRef<HTMLButtonElement|null>(null),loadGeneration=useRef(0);
  const [detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState(''),detailGeneration=useRef(0);
  const [identityDialog,setIdentityDialog]=useState<{item:FormationSubject;trigger:HTMLButtonElement}|null>(null);
  const [defectDialog,setDefectDialog]=useState<{item:FormationSubject;candidate:DefectAdmissionCandidate}|null>(null);
  const [careItems,setCareItems]=useState<CareWorkItem[]>([]),[selectedCare,setSelectedCare]=useState<CareWorkItem|null>(null);
  const [careCounts,setCareCounts]=useState<Record<string,number>>({});
  const [careDetailError,setCareDetailError]=useState('');
  const selectedCareId=useRef<string|null>(null);
  const [pageRows,setPageRows]=useState<LedgerRow[]>([]),[pageIndex,setPageIndex]=useState(0),[hasNext,setHasNext]=useState(false),[pageLoading,setPageLoading]=useState(false);
  const positions=useRef<Array<WorkbenchCursor|undefined>>([undefined]),currentPage=useRef(0);
  selectedCareId.current=selectedCare?.aftercareCaseId||null;
  useEffect(()=>{
    if(!linkedCaseId)return;
    let cancelled=false;
    void helixAdminApi.listCareWork(undefined,linkedCaseId).then(result=>{
      if(cancelled)return;
      if(result.items[0])setSelectedCare(result.items[0]);else setError('当前没有可展示的维护任务。');
    }).catch(cause=>{if(!cancelled){if(isUnauthorized(cause))expire();else setError('维护过程读取失败。');}});
    return()=>{cancelled=true;};
  },[linkedCaseId,expire]);
  useEffect(()=>{
    setCareDetailError('');
    const caseId=selectedCare?.aftercareCaseId;if(!caseId||selectedCare.processDetail)return;
    let cancelled=false;
    void helixAdminApi.listCareWork(undefined,caseId).then(result=>{
      if(!cancelled)setSelectedCare(current=>current?.aftercareCaseId===caseId?result.items[0]||null:current);
    }).catch(cause=>{if(!cancelled){if(isUnauthorized(cause))expire();else setCareDetailError('维护过程读取失败，请重新打开详情。');}});
    return()=>{cancelled=true;};
  },[selectedCare?.aftercareCaseId,expire]);
  const [discardDialog,setDiscardDialog]=useState<{item:FormationSubject;idempotencyKey:string}|null>(null);
  const [discardBusy,setDiscardBusy]=useState(false),[discardNeedsRefresh,setDiscardNeedsRefresh]=useState(false);
  const [discardError,setDiscardError]=useState(''),[discardNotice,setDiscardNotice]=useState('');
  const [selectedEnded,setSelectedEnded]=useState<FormationRunHistory|null>(null);
  const load=useCallback(async(background=false,targetPage=currentPage.current)=>{
    const generation=++loadGeneration.current,live=()=>generation===loadGeneration.current;
    if(!background){setLoading(true);setPageLoading(true);setError('');}
    const filters={q:q.trim(),shelfId:shelfFilter},empty={items:[],nextCursor:null};
    const applyRows=(items:LedgerRow[])=>{
      if(!live())return;
      setPageRows(items);setLoading(false);
      setActive(items.flatMap(row=>row.kind==='formation'&&row.item.classification!=='completed'?[row.item]:[]));
      setCompleted(items.flatMap(row=>row.kind==='formation'&&row.item.classification==='completed'?[row.item]:[]));
      setEnded(items.flatMap(row=>row.kind==='ended'?[row.item]:[]));
      setCareItems(items.flatMap(row=>row.kind==='care'?[row.item]:[]));
    };
    try{
      const readers:Array<(cursor?:string)=>Promise<{items:LedgerRow[];nextCursor:string|null}>>=[
        async cursor=>{
          if(filter==='ended')return empty;
          const result=await helixAdminApi.listFormation('active',cursor,{...filters,...(filter==='all'?{}:{classification:filter})});
          if(live())setSummary(result.summary);
          return {...result,items:result.items.map(item=>({kind:'formation' as const,item}))};
        },
        async cursor=>{
          if(filter!=='all'&&filter!=='ended')return empty;
          const result=await helixAdminApi.listFormation('completed',cursor,filters);if(live())setSummary(result.summary);
          return {...result,items:result.items.map(item=>({kind:'formation' as const,item}))};
        },
        async cursor=>{
          if(filter!=='all'&&filter!=='ended')return empty;
          const result=await helixAdminApi.listFormationHistory(cursor,filters);
          return {...result,items:result.items.map(item=>({kind:'ended' as const,item}))};
        },
        async cursor=>{
          const result=await helixAdminApi.listCareWork(cursor,undefined,{...filters,
            ...(filter==='all'?{}:{classification:filter==='ended'?'terminal':filter})});
          if(live())setCareCounts(result.counts);
          return {...result,items:result.items.map(item=>({kind:'care' as const,item}))};
        },
      ];
      const rank=(row:LedgerRow)=>row.kind==='ended'||['completed','ended'].includes(row.item.classification)?1:0;
      const timestamp=(row:LedgerRow)=>row.kind==='ended'?row.item.endedAtMs:row.kind==='care'?row.item.terminalAtMs||row.item.createdAtMs:row.item.completedAtMs||row.item.addedAtMs;
      const id=(row:LedgerRow)=>row.kind==='ended'?row.item.historyId:row.kind==='care'?row.item.aftercareCaseId:row.item.subjectId;
      const result=await readWorkbenchPage(readers,positions.current[targetPage],(a,b)=>rank(a)-rank(b)||timestamp(b)-timestamp(a)||id(a).localeCompare(id(b)),
        !background&&targetPage===0?applyRows:undefined);
      if(!live())return;
      applyRows(result.items);currentPage.current=targetPage;setPageIndex(targetPage);setHasNext(Boolean(result.nextCursor));
      positions.current=positions.current.slice(0,targetPage+1);
      if(result.nextCursor)positions.current.push(result.nextCursor);
      if(selectedCareId.current){const id=selectedCareId.current,result=await helixAdminApi.listCareWork(undefined,id);
        if(live())setSelectedCare(current=>current?.aftercareCaseId===id?result.items[0]||null:current);}
    }catch(cause){if(live()){if(isUnauthorized(cause))expire();else setError(cause instanceof Error?cause.message:'媒体整理读取失败。');}}
    finally{if(live()){setLoading(false);setPageLoading(false);}}
  },[expire,filter,q,shelfFilter]);
  useEffect(()=>{
    loadGeneration.current++;positions.current=[undefined];currentPage.current=0;setPageIndex(0);setHasNext(false);
    const timer=q.trim()?window.setTimeout(()=>void load(false,0),350):null;
    if(timer===null)void load(false,0);
    return()=>{loadGeneration.current++;if(timer!==null)window.clearTimeout(timer);};
  },[load]);
  useEffect(()=>{
    void helixAdminApi.listShelves().then(result=>setShelves(result.items.filter(item=>item.status==='active'))).catch(()=>{});
    void helixAdminApi.getPerceptionSyncState().then(setPerceptionSync).catch(()=>{});
  },[]);
  useEffect(()=>{const timer=window.setInterval(()=>{if(!document.hidden&&!pageLoading)void load(true);},10000);
    return()=>window.clearInterval(timer);},[load,pageLoading]);
  const rows=useMemo(()=>pageRows.filter(row=>{
    if(q.trim()&&!row.item.displayIdentity.toLowerCase().includes(q.trim().toLowerCase()))return false;
    if(row.kind!=='ended'&&shelfFilter&&row.item.targetShelfId!==shelfFilter)return false;
    if(filter==='all')return true;
    if(filter==='ended')return row.kind==='ended'||row.item.classification==='completed'||row.item.classification==='ended';
    return row.kind!=='ended'&&row.item.classification===filter;
  }),[pageRows,q,shelfFilter,filter]);
  const close=()=>{detailGeneration.current+=1;setSelected(null);setDetailLoading(false);window.setTimeout(()=>triggerRef.current?.focus(),0);};
  const open=async(item:FormationSubject,button:HTMLButtonElement)=>{
    triggerRef.current=button;const generation=++detailGeneration.current;
    setSelected(item);setDetailLoading(true);setDetailError('');
    try{const detail=await helixAdminApi.getFormation(item.formationViewId);if(generation===detailGeneration.current)setSelected(detail);}
    catch(cause){if(generation===detailGeneration.current){if(isUnauthorized(cause))expire();else setDetailError('整理过程读取失败，请关闭后重试。');}}
    finally{if(generation===detailGeneration.current)setDetailLoading(false);}
  };
  const action=async(item:FormationSubject,kind:'expedite'|'discard'|'admitDefects'|'retry'|'chooseShelf'|'chooseIdentity',value?:boolean|string)=>{
    if(kind==='discard'){setDiscardError('');setDiscardNotice('');setDiscardNeedsRefresh(false);setDiscardDialog({item,idempotencyKey:`discard:${item.currentRun?.libraRunId||item.subjectId}:${item.currentRun?.stateRevision||0}:${newOpaqueId()}`});return;}
    setLoading(true);setError('');
    try{
      if(kind==='expedite')await helixAdminApi.setRunExpedited(item,Boolean(value));
      else if(kind==='admitDefects'){
        const candidate=await helixAdminApi.previewDefectAdmission(item);
        setLoading(false);
        if(candidate.eligibility!=='eligible'){setError(candidate.message);return;}
        setDefectDialog({item,candidate});
        return;
      }
      else if(kind==='retry')await helixAdminApi.retryAcceptance(item);
      else if(kind==='chooseShelf')await helixAdminApi.chooseShelf(item,String(value));
      else await helixAdminApi.chooseProductIdentity(item,String(value));
      await load();
    }catch(cause){setError(cause instanceof Error?cause.message:'操作失败。');setLoading(false);}
  };
  if(!active.length&&!completed.length&&!ended.length&&!careItems.length&&loading&&!error)return <LoadingState>正在读取媒体整理工作区…</LoadingState>;
  const counts:Record<Filter,number>={all:summary.totalCount+(summary.endedCount||0)+Object.values(careCounts).reduce((a,b)=>a+b,0),in_progress:summary.inProgressCount+(careCounts.in_progress||0)+(careCounts.queued||0),attention_required:summary.attentionRequiredCount+(careCounts.attention_required||0),ended:summary.completedCount+(careCounts.completed||0)+(summary.endedCount||0)+(careCounts.ended||0)};
  return <section className="source-page workbench formation-page"><PageHeader title="媒体整理工作区" actions={<Button type="button" onClick={()=>void load()} disabled={loading}>{loading?'正在刷新…':'刷新'}</Button>} />
    {error&&<p className="form-error" role="alert">{error}</p>}
    {notice&&<p className="form-notice" role="status">{notice}</p>}
    {perceptionSync?.completionState==='incomplete'&&<p className="form-notice" role="status">豆瓣评分同步尚未完整结束，已保存 {perceptionSync.recordCount} 条；再次同步会从上次成功位置继续。列表中的“暂不能确认”不是影片匹配失败。</p>}
    <section className="formation-ledger"><div className="formation-toolbar">
      <div className="formation-chips" role="group" aria-label="媒体整理状态">{([{id:'all',label:'全部'},{id:'in_progress',label:'整理中'},{id:'attention_required',label:'需要处理'},{id:'ended',label:'已结束'}] as Array<{id:Filter;label:string}>).map((entry)=><Button key={entry.id} type="button" aria-pressed={filter===entry.id} onClick={()=>setFilter(entry.id)}>{entry.label} {counts[entry.id]}</Button>)}</div>
      <div className="formation-secondary"><label>片名<input type="search" aria-label="按片名筛选" value={q} placeholder="搜索片名" onChange={(event)=>setQ(event.target.value)} /></label><label>目标收藏架<select aria-label="按目标收藏架筛选" value={shelfFilter} onChange={(event)=>setShelfFilter(event.target.value)}><option value="">全部收藏架</option>{shelves.map((shelf)=><option key={shelf.shelfId} value={shelf.shelfId}>{shelf.name}</option>)}</select></label></div>
    </div>
      <div className="formation-table-wrap"><table className="formation-table formation-stub-table"><thead><tr><th>媒体名称</th><th>评分</th><th>目标收藏架</th><th>整理要求</th><th>当前进展</th><th>详情</th><th>用户操作</th><th>加急</th><th>任务类型</th></tr></thead><tbody>{rows.length===0?<tr className="formation-stub-media-row"><td colSpan={9}><div className="source-empty"><strong>{summary.totalCount===0?'还没有进入整理的媒体':'当前筛选没有条目'}</strong><p>{summary.totalCount===0?'开始整理后，媒体会出现在这里；仍在准备或等待的材料请到“文件来源”查看。':'试试其他状态或筛选。'}</p></div></td></tr>:rows.map((row)=>row.kind==='care'?<CareWorkRow key={row.item.aftercareCaseId} item={row.item} onOpen={setSelectedCare}/>:row.kind==='ended'?<tr key={row.item.historyId} className="formation-stub-media-row"><td><strong>{row.item.displayIdentity}</strong><small>已结束</small></td><td>—</td><td>—</td><td>—</td><td><strong className="formation-stub-current">{row.item.label}</strong><small>{formatTime(row.item.endedAtMs)}</small></td><td>{row.item.outcome==='unable_to_on_deck'?<Button type="button" variant="text" aria-haspopup="dialog" onClick={()=>setSelectedEnded(row.item)}>查看过程</Button>:'—'}</td><td>—</td><td><button type="button" className="formation-expedite-toggle" disabled>加急</button></td><td>上架任务</td></tr>:<MediaRow key={row.item.subjectId} item={row.item} shelves={shelves} loading={loading} acquisitionIncomplete={perceptionSync?.completionState==='incomplete'} onOpen={open} onAction={action} onManualIdentity={(item,trigger)=>setIdentityDialog({item,trigger})} />)}</tbody></table></div>
    </section>
    <nav className="pagination-controls" aria-label="媒体整理分页">
      <Button type="button" disabled={pageLoading||pageIndex===0} onClick={()=>void load(false,pageIndex-1)}>上一页</Button>
      {positions.current.map((_,index)=><Button key={index} type="button" disabled={pageLoading} aria-current={index===pageIndex?'page':undefined} onClick={()=>void load(false,index)}>{index+1}</Button>)}
      <span>第 {pageIndex+1} 页</span>
      <Button type="button" disabled={pageLoading||!hasNext} onClick={()=>void load(false,pageIndex+1)}>下一页</Button>
    </nav>
    {selectedCare&&<ProcessDialog title={selectedCare.displayIdentity+'的媒体整理过程'} onClose={()=>setSelectedCare(null)}><CareWorkDetail item={selectedCare} error={careDetailError}/></ProcessDialog>}
    {selectedEnded&&<ProcessDialog title={selectedEnded.displayIdentity+'的媒体整理过程'} onClose={()=>setSelectedEnded(null)}><RunOutcomeDetail key={selectedEnded.libraRunId} item={selectedEnded} onChanged={()=>void load(true)}/></ProcessDialog>}
    {selected&&<ProcessDialog title={selected.displayIdentity+'的媒体整理过程'} onClose={close}><ProcessDetail item={selected} loading={detailLoading} error={detailError}/></ProcessDialog>}
    {identityDialog&&<ManualIdentityDialog item={identityDialog.item} onClose={()=>{identityDialog.trigger.focus();setIdentityDialog(null);}}
      onSelected={()=>{identityDialog.trigger.focus();setIdentityDialog(null);setNotice(identityDialog.item.contentProfile === 'series' ? '已提交剧集身份，正在核验。' : '已提交影片身份，正在核验。');void load();}} onRefresh={()=>void load()} onUnauthorized={expire}/>}
    <Dialog open={!!discardDialog} title="确认放弃整理" onClose={()=>{if(!discardBusy){setDiscardDialog(null);if(discardNeedsRefresh)void load();}}} actions={<>
      <Button type="button" disabled={discardBusy} onClick={()=>{setDiscardDialog(null);if(discardNeedsRefresh)void load();}}>取消</Button>
      <Button type="button" variant="danger" disabled={discardBusy||discardNeedsRefresh} onClick={()=>{void (async()=>{
        if(!discardDialog)return;
        setDiscardBusy(true);setDiscardError('');setDiscardNotice('');
        try{
          const result=await helixAdminApi.discardRun(discardDialog.item,discardDialog.idempotencyKey);
          if(result.resultKind==='discarded'){
            setDiscardDialog(null);setNotice('本次整理已结束。');
            await load();
          }else if(result.resultKind==='closure_pending'){
            setDiscardNotice('正在结束当前处理，请稍后重试。');
          }else if(result.resultKind==='invalid_state'){
            setDiscardNeedsRefresh(true);
            setDiscardError('这次整理当前不能结束。请关闭窗口并刷新列表后重试。');
          }else if(result.resultKind==='stale'){
            setDiscardNeedsRefresh(true);
            setDiscardError('整理状态已变化，请关闭窗口并刷新列表后重试。');
          }else{
            setDiscardNeedsRefresh(true);
            setDiscardError('当前状态无法安全结束，请关闭窗口并刷新列表后重试。');
          }
        }catch(cause){
          if(isUnauthorized(cause)){expire();setDiscardError('登录已失效，请重新登录后操作。');}
          else if(cause instanceof AdminApiError&&cause.status>=400&&cause.status<500){
            setDiscardNeedsRefresh(true);setDiscardError('当前状态不支持此操作，请关闭窗口并刷新列表后重试。');
          }else setDiscardError('暂未确认本次整理是否结束，请重试确认。');
        }
        finally{setDiscardBusy(false);}
      })();}}>确认放弃</Button>
    </>}>
      {discardDialog&&<div className="stack">
        <p>{discardDialog.item.displayIdentity}</p>
        <p>本次整理将结束，已产生的临时文件会被清理，原始媒体不会被删除。相同条件下不会自动再次整理。</p>
        {discardError&&<p className="form-error" role="alert">{discardError}</p>}
        {discardNotice&&<p className="form-notice" role="status">{discardNotice}</p>}
      </div>}
    </Dialog>
    <Dialog open={!!defectDialog} title="确认接受瑕疵入库" onClose={()=>setDefectDialog(null)} actions={<>
      <Button type="button" disabled={loading} onClick={()=>setDefectDialog(null)}>取消</Button>
      <Button type="button" variant="primary" disabled={loading} onClick={()=>{void (async()=>{
        if(!defectDialog)return;
        const pending=defectDialog;
        setLoading(true);setError('');setNotice('');
        try{
          await helixAdminApi.admitWithDefects(pending.item,pending.candidate);
          setDefectDialog(null);
          await load();
        }catch(cause){
          let committed=false;
          try{
            const current=await helixAdminApi.getFormation(pending.item.formationViewId);
            committed=defectAdmissionCommitted(pending.item,current);
          }catch(readCause){if(isUnauthorized(readCause))expire();}
          if(committed){
            setDefectDialog(null);
            setNotice('瑕疵已接受，系统正在继续整理；页面已按实际状态更新。');
            await load();
          }else{
            setError(cause instanceof Error?cause.message:'操作失败。');
            setLoading(false);
          }
        }
      })();}}>确认接受</Button>
    </>}>
      {defectDialog&&<div className="stack">
        <p>{defectDialog.item.displayIdentity}</p>
        <ol>{defectDialog.candidate.defects.map((defect,index)=><li key={defect.defectCode}>{index+1}. {defectLabel(defect,defectDialog.candidate.sizeForecast)}</li>)}</ol>
        <p>本次按列明瑕疵继续上架，并保留瑕疵记录；上架仍须通过文件安全检查。</p>
      </div>}
    </Dialog>
  </section>;
}

function MediaRow({item,shelves,loading,acquisitionIncomplete,onOpen,onAction,onManualIdentity}:{item:FormationSubject;shelves:Shelf[];loading:boolean;acquisitionIncomplete:boolean;onOpen:(item:FormationSubject,button:HTMLButtonElement)=>void;onManualIdentity:(item:FormationSubject,button:HTMLButtonElement)=>void;onAction:(item:FormationSubject,kind:'expedite'|'discard'|'admitDefects'|'retry'|'chooseShelf'|'chooseIdentity',value?:boolean|string)=>void}) {
  const expedited=item.currentRun?.priorityClass==='expedited',reason=currentProgressLabel(item),progressDetail=currentProgressDetail(item);
  const [shelfId,setShelfId]=useState(''),[identityId,setIdentityId]=useState('');
  const actionControl=item.executorIssue?.canRetry?<Button type="button" disabled={loading} onClick={()=>void onAction(item,'retry')}>{item.executorIssue.phase==='on_deck_execution'?'重试上架':'重试验收'}</Button>:item.currentRun?.state==='frozen'&&!item.productIdentityIssue?<div className="formation-inline-action"><DefectAdmissionControl item={item} disabled={loading} onAdmit={()=>void onAction(item,'admitDefects')} /><Button type="button" variant="text" disabled={loading} onClick={()=>void onAction(item,'discard')}>放弃整理</Button></div>:canDiscardRejectedHandoff(item)?<Button type="button" variant="text" disabled={loading} onClick={()=>void onAction(item,'discard')}>放弃整理</Button>:item.productIdentityIssue?<div className="formation-inline-action">{item.productIdentityIssue.candidates.length>0&&<><select aria-label={`为${item.displayIdentity}选择${item.contentProfile === 'series' ? '剧集身份' : '影片身份'}`} value={identityId} onChange={(event)=>setIdentityId(event.target.value)}><option value="">{item.contentProfile === 'series' ? '选择剧集身份' : '选择影片身份'}</option>{item.productIdentityIssue.candidates.map((candidate)=><option key={candidate.providerKey} value={candidate.providerKey.replace(/^tmdb:(?:movie|series):/,'')}>{candidate.displayTitle}{candidate.releaseYear?` (${candidate.releaseYear})`:''}</option>)}</select><Button type="button" disabled={loading||!identityId} onClick={()=>void onAction(item,'chooseIdentity',identityId)}>确认</Button></>}<Button type="button" variant="text" className="identity-picker-trigger" aria-haspopup="dialog" disabled={loading} onClick={event=>onManualIdentity(item,event.currentTarget)}>{item.contentProfile === 'series' ? '手动选取剧集身份' : '手动选取影片身份'}</Button><Button type="button" variant="text" disabled={loading} onClick={()=>void onAction(item,'discard')}>放弃整理</Button></div>:canChooseShelf(item)?<div className="formation-inline-action"><select aria-label={`为${item.displayIdentity}选择收藏架`} value={shelfId} onChange={(event)=>setShelfId(event.target.value)}><option value="">选择收藏架</option>{shelves.map((shelf)=><option key={shelf.shelfId} value={shelf.shelfId}>{shelf.name}</option>)}</select><Button type="button" disabled={loading||!shelfId} onClick={()=>void onAction(item,'chooseShelf',shelfId)}>确认</Button></div>:item.currentRun?.state==='active'&&!item.handoffB?<Button type="button" variant="text" disabled={loading} onClick={()=>void onAction(item,'discard')}>放弃整理</Button>:<span className="formation-stub-empty">—</span>;
  return <tr className="formation-stub-media-row" data-classification={item.classification} data-expedited={expedited||undefined}><td><strong>{item.displayIdentity}</strong><SeriesDelivery item={item} /><small>{statusLabel(item)} · {formatTime(item.addedAtMs)}</small></td><td><span className="formation-stub-rating">{ratingText(item,acquisitionIncomplete)}</span>{item.myRatingSource!=='douban'&&<RatingControl targetType="subject" targetId={item.subjectId} label={item.displayIdentity} initialRating={item.myRating} initialSource={item.myRatingSource} initialRevision={item.myRatingRevision} />}</td><td>{shelfName(item,shelves)}</td><td>{item.organizingRequirement}</td><td><strong className="formation-stub-current" data-state={item.classification}>{reason}</strong>{progressDetail&&<small>{progressDetail}</small>}</td><td><Button type="button" variant="text" aria-haspopup="dialog" onClick={(event)=>void onOpen(item,event.currentTarget)}>查看过程</Button></td><td>{actionControl}</td><td><button type="button" className="formation-expedite-toggle" aria-label={canExpedite(item)?(expedited?`取消加急 ${item.displayIdentity}`:`加急 ${item.displayIdentity}`):`${item.displayIdentity}无需加急`} aria-pressed={canExpedite(item)?expedited:undefined} disabled={loading||!canExpedite(item)} onClick={()=>void onAction(item,'expedite',!expedited)}>{expedited?'已加急':'加急'}</button></td><td>上架任务</td></tr>;
}
