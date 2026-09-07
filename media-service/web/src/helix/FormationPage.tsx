import RecyclePanel from './RecyclePanel';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { helixAdminApi, type DefectAdmissionCandidate, type FormationRunHistory, type FormationSubject, type FormationSummary, type PerceptionSyncState, type Shelf } from './api';
import { Button, LoadingState, PageHeader } from './chrome';
import { Dialog } from '../components/ui';
import RatingControl from './RatingControl';
import { CareWorkRow, CareWorkDetail } from './CareWorkRow';
import type { CareWorkItem } from './api';
import { isUnauthorized, useSession } from './session';

const emptySummary: FormationSummary = { totalCount:0, inProgressCount:0, attentionRequiredCount:0, completedCount:0 };
type Filter = 'all'|'in_progress'|'attention_required'|'completed'|'ended';
type LedgerRow = { kind:'formation'; item:FormationSubject } | { kind:'ended'; item:FormationRunHistory } | { kind:'care'; item:CareWorkItem };

function formatTime(value:number) { return value > 0 ? new Intl.DateTimeFormat('zh-CN', { dateStyle:'medium', timeStyle:'short' }).format(new Date(value)) : '—'; }
function progressText(progress:NonNullable<FormationSubject['organizingSteps'][number]['progress']>) {
  if(progress.mode!=='determinate'||!progress.totalValue)return '';
  const percent=Math.max(0,Math.min(100,Math.round(((progress.currentValue||0)/progress.totalValue)*100)));
  return progress.unit==='percent'?`${percent}%`:`${progress.currentValue||0}/${progress.totalValue} ${progress.unit||''}`;
}
function progressRate(progress:NonNullable<FormationSubject['organizingSteps'][number]['progress']>) {
  const rate=progress.rate;
  if(rate===null||!Number.isFinite(rate)||rate<0)return '';
  const units=['B/s','KiB/s','MiB/s','GiB/s']; let value=rate,index=0;
  while(value>=1024&&index<units.length-1){value/=1024;index+=1;}
  return `${value.toFixed(index===0?0:value>=10?1:2)} ${units[index]}`;
}
function progressEta(progress:NonNullable<FormationSubject['organizingSteps'][number]['progress']>) {
  const milliseconds=progress.etaMs;
  if(milliseconds===null||!Number.isFinite(milliseconds)||milliseconds<0)return '';
  const minutes=Math.ceil(milliseconds/60_000);
  if(minutes<60)return `预计 ${minutes} 分钟`;
  const hours=Math.floor(minutes/60),remaining=minutes%60;
  return `预计 ${hours} 小时${remaining?` ${remaining} 分钟`:''}`;
}
function progressDetail(progress:NonNullable<FormationSubject['organizingSteps'][number]['progress']>) {
  return [progressText(progress),progressRate(progress),progressEta(progress)].filter(Boolean).join(' · ');
}
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
  if (defect.defectCode==='actor_unavailable') return '演员资料确实无法取得';
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
  if (item.productIdentityIssue) return '影片身份待确认';
  if (item.ratingState === 'pending') return '正在匹配豆瓣评分';
  if (item.ratingReasonCode === 'requested_fact_absent') return '豆瓣记录没有评分';
  if (item.ratingReasonCode === 'strongest_value_conflict') return '豆瓣评分记录有冲突';
  if (acquisitionIncomplete && item.ratingResolutionStatus === 'not_found') return '豆瓣同步未完成，暂不能确认';
  if (item.ratingResolutionStatus === 'not_found') return '豆瓣暂无匹配评分';
  return '正在匹配豆瓣评分';
}

function StageState({ state }:{ state:'completed'|'running'|'attention'|'pending' }) {
  return <span className="formation-stub-stage-state" data-state={state}>{state==='completed'?'已完成':state==='running'?'进行中':state==='attention'?'需要处理':'尚未开始'}</span>;
}
function mergeById<T>(previous:T[], fresh:T[], idOf:(item:T)=>string): T[] {
  const incoming = new Map(fresh.map((item)=>[idOf(item), item]));
  const seen = new Set<string>();
  const merged = previous.map((item)=>{
    const id = idOf(item);
    const next = incoming.get(id);
    if (!next) return item;
    seen.add(id);
    return next;
  });
  return [...fresh.filter((item)=>!seen.has(idOf(item))), ...merged];
}
type FormationFilters = {
  classification?:'in_progress'|'attention_required';
  shelfId?:string; needsUserAction?:boolean; expedited?:boolean; q?:string;
};
async function remainingFormation(first:{items:FormationSubject[];summary:FormationSummary;nextCursor:string|null}, section:'active'|'completed', filters?:FormationFilters, live=()=>true) {
  const items = [...first.items];
  let cursor = first.nextCursor, summary = first.summary;
  const seen = new Set<string>();
  while (cursor && live()) {
    if (seen.has(cursor) || seen.size >= 399) throw new Error('媒体整理分页游标异常，已停止读取。');
    seen.add(cursor);
    const page = await helixAdminApi.listFormation(section, cursor, filters);
    items.push(...page.items);
    summary = page.summary;
    cursor = page.nextCursor;
  }
  return { items, summary };
}
async function remainingHistory(first:{items:FormationRunHistory[];nextCursor:string|null}, live=()=>true) {
  const items = [...first.items];
  let cursor = first.nextCursor;
  const seen = new Set<string>();
  while (cursor && live()) {
    if (seen.has(cursor) || seen.size >= 399) throw new Error('整理历史分页游标异常，已停止读取。');
    seen.add(cursor);
    const page = await helixAdminApi.listFormationHistory(cursor);
    items.push(...page.items);
    cursor = page.nextCursor;
  }
  return items;
}

type ProcessStage=NonNullable<FormationSubject['processDetail']>['stages'][number];
type ProcessPlan=ProcessStage['plans'][number];
type ProcessNode=ProcessPlan['nodes'][number];
function processPlanState(state:ProcessPlan['state']) { return state==='completed'?'已完成':state==='running'?'进行中':state==='attention'?'需要处理':'等待中'; }
function processNodeState(state:ProcessNode['state']) { return state==='completed'?'已完成':state==='running'?'进行中':state==='failed'?'失败':state==='cancelled'?'未执行':state==='skipped'?'无需执行':'等待中'; }
function ProcessNodeRow({node}:{node:ProcessNode}) {
  const mark=node.state==='completed'?'✓':node.state==='failed'?'×':node.state==='running'?'●':'○';
  return <li className="formation-plan-node" data-state={node.state}><span className="formation-plan-node-mark" aria-hidden="true">{mark}</span><div className="formation-plan-node-main"><strong>{node.label}</strong><p>{node.description}</p>
    {node.results.length>0&&<dl className="formation-plan-results">{node.results.map((fact)=><div key={`${fact.label}:${fact.value}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}
    {node.progress?.mode==='determinate'&&node.progress.totalValue?<div className="formation-stub-progress"><progress max={node.progress.totalValue} value={node.progress.currentValue||0} aria-label={`${node.label}进度`} /><small>{progressDetail(node.progress)}</small></div>:null}
    {node.technicalDetail&&<details className="formation-transcode-detail"><summary>查看处理详情</summary><div className="formation-transcode-detail-body"><p>{node.technicalDetail.summary}</p>{node.technicalDetail.fields.length>0&&<dl className="formation-transcode-grid">{node.technicalDetail.fields.map((fact)=><div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}{node.technicalDetail.parameters.length>0&&<details className="formation-transcode-parameters"><summary>查看执行参数</summary><dl>{node.technicalDetail.parameters.map((fact)=><div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl></details>}</div></details>}
  </div><span className="formation-plan-node-state">{node.statusText || processNodeState(node.state)}</span></li>;
}
function ProcessPlanView({plan,index}:{plan:ProcessPlan;index:number}) {
  return <details className="formation-actual-plan" data-state={plan.state} open={plan.state==='running'||plan.state==='attention'}><summary><span className="formation-actual-plan-label">计划{index+1}</span><strong>{plan.title}</strong><span className="formation-actual-plan-status">{processPlanState(plan.state)}</span><span className="formation-actual-plan-chevron" aria-hidden="true">›</span></summary><div className="formation-actual-plan-body">{plan.nodes.length?<ol>{plan.nodes.map((node)=><ProcessNodeRow key={node.nodeId} node={node} />)}</ol>:<p className="formation-plan-no-nodes">本次真实计划没有需要执行的步骤。</p>}</div></details>;
}
function ProcessStageView({stage,index}:{stage:ProcessStage;index:number}) {
  const open=stage.state==='running'||stage.state==='attention';
  return <details className="formation-process-stage" data-state={stage.state} open={open}><summary><span className="formation-stage-index" aria-hidden="true">{stage.state==='completed'?'✓':index+1}</span><span><strong>{stage.label}</strong><small>{stage.summary}</small></span><StageState state={stage.state} /></summary><div className="formation-stage-body"><p className="formation-stage-description">{stage.description}</p>{stage.plans.length?<div className="formation-actual-plans">{stage.plans.map((plan,planIndex)=><ProcessPlanView key={plan.planId} plan={plan} index={planIndex} />)}</div>:<div className="formation-empty-stage"><strong>{stage.summary}</strong><p>这里只展示已经由系统形成并保存的真实计划，不预先展示尚未发生的工作。</p></div>}</div></details>;
}
function ProcessDetail({ item }:{ item:FormationSubject }) {
  const detail=item.processDetail;
  return <article className="formation-process-card" aria-label={`${item.displayIdentity}的媒体整理过程`}>
    <header className="formation-process-head"><div><span className="formation-process-eyebrow">媒体整理过程</span><h3>{item.displayIdentity}</h3><p>{currentProgressLabel(item)}</p></div><span className="formation-process-status" data-state={stageState(item)}>{statusLabel(item)}</span></header>
    {item.failureDiagnostics?.map(f=><section key={f.eventId} role="note">
      <strong>{f.code}</strong>
      {f.diagnosticsUnavailable&&<p>该次失败的详细证据不可用；需要新的执行观察。</p>}
      {f.diagnostics?.sourceDirectory&&<p>{f.diagnostics.sourceDirectory}</p>}
      {Boolean(f.diagnostics?.unknownNames?.length)&&<ul>{f.diagnostics?.unknownNames?.map((name,index)=><li key={index}>{name}</li>)}</ul>}
      {f.diagnostics?.truncated&&<p>共 {f.diagnostics.unknownMemberCount} 项，以上为部分列表。</p>}
      {f.diagnostics?.field&&<p>冲突字段：{f.diagnostics.field}</p>}
      {f.diagnostics?.reasonCode&&<p>原因：{f.diagnostics.reasonCode}</p>}
      {f.diagnostics?.networkCode&&<p>网络原因：{f.diagnostics.networkCode}</p>}
      {f.diagnostics?.timeout&&<p>请求超时</p>}
    </section>)}
    <dl className="formation-process-facts"><div><dt>目标收藏架</dt><dd>{item.targetShelfName || '尚未选定'}</dd></div><div><dt>收藏要求</dt><dd>{item.organizingRequirement}</dd></div><div><dt>当前进展</dt><dd>{currentProgressLabel(item)}</dd></div></dl>
    {detail?.contract==='formation_process_actual_plans@1'?<div className="formation-process-stages">{detail.stages.map((stage,index)=><ProcessStageView key={stage.key} stage={stage} index={index} />)}</div>:<div className="formation-process-unavailable"><strong>暂时无法读取真实计划</strong><p>当前没有可供展示的计划记录。页面不会根据状态推测或补造计划。</p></div>}
  </article>;
}

export default function FormationPage() {
  const { expire }=useSession();
  const [active,setActive]=useState<FormationSubject[]>([]),[completed,setCompleted]=useState<FormationSubject[]>([]),[ended,setEnded]=useState<FormationRunHistory[]>([]),[summary,setSummary]=useState(emptySummary),[shelves,setShelves]=useState<Shelf[]>([]);
  const [perceptionSync,setPerceptionSync]=useState<PerceptionSyncState|null>(null);
  const [filter,setFilter]=useState<Filter>('all'),[q,setQ]=useState(''),[shelfFilter,setShelfFilter]=useState(''),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [selected,setSelected]=useState<FormationSubject|null>(null),closeRef=useRef<HTMLButtonElement>(null),triggerRef=useRef<HTMLButtonElement|null>(null),loadGeneration=useRef(0);
  const [defectDialog,setDefectDialog]=useState<{item:FormationSubject;candidate:DefectAdmissionCandidate}|null>(null);
  const [careItems,setCareItems]=useState<CareWorkItem[]>([]),[careCursor,setCareCursor]=useState<string|null>(null),[selectedCare,setSelectedCare]=useState<CareWorkItem|null>(null);
  const [careCounts,setCareCounts]=useState<Record<string,number>>({});
  const careLoading=useRef(false),careExpanded=useRef(false),carePageCount=useRef(1),selectedCareId=useRef<string|null>(null);
  selectedCareId.current=selectedCare?.aftercareCaseId||null;
  const loadCare=useCallback(async(cursor?:string)=>{
    if(careLoading.current)return;careLoading.current=true;
    try{
      let result=await helixAdminApi.listCareWork(cursor);const items=[...result.items];
      if(cursor){careExpanded.current=true;carePageCount.current+=1;setCareItems(current=>mergeById(current,items,item=>item.aftercareCaseId));}
      else{
        for(let page=1;page<carePageCount.current&&result.nextCursor;page++){
          result=await helixAdminApi.listCareWork(result.nextCursor);items.push(...result.items);
        }
        setCareItems(items);
      }
      setCareCursor(result.nextCursor);setCareCounts(result.counts);
      const selectedId=selectedCareId.current;
      if(selectedId){
        const selected=items.find(item=>item.aftercareCaseId===selectedId)||
          (await helixAdminApi.listCareWork(undefined,selectedId)).items[0];
        setSelectedCare(current=>current?.aftercareCaseId===selectedId?selected||null:current);
      }
    }
    catch(cause){if(isUnauthorized(cause))expire();else setError(cause instanceof Error?cause.message:'上架后改善读取失败。');}
    finally{careLoading.current=false;}
  },[expire]);
  useEffect(()=>{void loadCare();const timer=window.setInterval(()=>{if(!document.hidden)void loadCare();},10_000);return()=>window.clearInterval(timer);},[loadCare]);
  const [pageCursors,setPageCursors]=useState<{active:string|null;completed:string|null;ended:string|null}>({active:null,completed:null,ended:null});
  const [loadingMore,setLoadingMore]=useState(false);
  const foregroundBusy=useRef(false),backgroundBusy=useRef(false);
  const loadMore=async()=>{
    if(loadingMore)return;setLoadingMore(true);
    try{
      const [a,c,e]=await Promise.all([
        pageCursors.active?helixAdminApi.listFormation('active',pageCursors.active):null,
        pageCursors.completed?helixAdminApi.listFormation('completed',pageCursors.completed):null,
        pageCursors.ended?helixAdminApi.listFormationHistory(pageCursors.ended):null,
      ]);
      if(a){setActive(current=>mergeById(current,a.items,item=>item.subjectId));setSummary(a.summary);}
      if(c)setCompleted(current=>mergeById(current,c.items,item=>item.subjectId));
      if(e)setEnded(current=>mergeById(current,e.items,item=>item.historyId));
      setPageCursors({active:a?.nextCursor||null,completed:c?.nextCursor||null,ended:e?.nextCursor||null});
    }catch(cause){if(isUnauthorized(cause))expire();else setError(cause instanceof Error?cause.message:'更多记录读取失败。');}
    finally{setLoadingMore(false);}
  };
  const [discardDialog,setDiscardDialog]=useState<FormationSubject|null>(null);
  const load=useCallback(async(background=false)=>{
    if(background){
      if(backgroundBusy.current||foregroundBusy.current||document.hidden)return;
      backgroundBusy.current=true;
      try{
        const [firstActive,firstCompleted,firstEnded,sync]=await Promise.all([
          helixAdminApi.listFormation('active'),
          helixAdminApi.listFormation('completed'),
          helixAdminApi.listFormationHistory(),
          helixAdminApi.getPerceptionSyncState().catch(()=>null),
        ]);
        setActive((current)=>mergeById(current,firstActive.items,(item)=>item.subjectId));
        setCompleted((current)=>mergeById(current,firstCompleted.items,(item)=>item.subjectId));
        setEnded((current)=>mergeById(current,firstEnded.items,(item)=>item.historyId));
        setSummary(firstActive.summary);
        if(sync)setPerceptionSync(sync);
      }catch(cause){if(isUnauthorized(cause))expire();}finally{backgroundBusy.current=false;}
      return;
    }
    if(foregroundBusy.current)return;foregroundBusy.current=true;
    const generation=loadGeneration.current+1;loadGeneration.current=generation;
    const live=()=>generation===loadGeneration.current;
    setLoading(true);setError('');
    try{
      const firstActive=await helixAdminApi.listFormation('active');
      if(!live())return;
      setActive(firstActive.items);setSummary(firstActive.summary);setLoading(false);
      setPageCursors(current=>({...current,active:firstActive.nextCursor}));
      // Paint current work before historical rows and ancillary configuration.
      // These reads must not contend with the primary request or gate its UI.
      const [firstCompleted,firstEnded,shelvesPage,sync]=await Promise.all([
        helixAdminApi.listFormation('completed'),
        helixAdminApi.listFormationHistory(),
        helixAdminApi.listShelves(),
        helixAdminApi.getPerceptionSyncState().catch(()=>null),
      ]);
      if(!live())return;
      setCompleted(firstCompleted.items);setEnded(firstEnded.items);
      setShelves(shelvesPage.items.filter((item)=>item.status==='active'));
      if(sync)setPerceptionSync(sync);
      setLoading(false);
      setPageCursors({active:firstActive.nextCursor,completed:firstCompleted.nextCursor,ended:firstEnded.nextCursor});
    }catch(cause){if(isUnauthorized(cause))expire();else setError(cause instanceof Error?cause.message:'媒体整理工作区读取失败。');}
    finally{foregroundBusy.current=false;if(live())setLoading(false);}
  },[expire]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{if(!active.some((item)=>item.classification==='in_progress'))return;const timer=window.setInterval(()=>{void load(true);},10_000);return()=>window.clearInterval(timer);},[active,load]);
  useEffect(()=>{
    const classification = filter==='in_progress'||filter==='attention_required' ? filter : null;
    if(!classification)return;
    let cancelled=false;
    void (async()=>{
      try{
        const first=await helixAdminApi.listFormation('active',undefined,{classification});
        if(cancelled)return;
        setActive((current)=>mergeById(current,first.items,(item)=>item.subjectId));
        setSummary(first.summary);
        if(!first.nextCursor)return;
        const rest=await remainingFormation(first,'active',{classification},()=>!cancelled);
        if(cancelled)return;
        setActive((current)=>mergeById(current,rest.items,(item)=>item.subjectId));
        setSummary(rest.summary);
      }catch(cause){if(isUnauthorized(cause))expire();}
    })();
    return()=>{cancelled=true;};
  },[expire,filter]);
  useEffect(()=>{
    if(!q.trim()&&!shelfFilter)return;
    let cancelled=false;
    const timer=window.setTimeout(()=>{void(async()=>{
      try{
        const [a,c,e]=await Promise.all([helixAdminApi.listFormation('active'),helixAdminApi.listFormation('completed'),helixAdminApi.listFormationHistory()]);
        if(cancelled)return;
        const [allA,allC,allE]=await Promise.all([remainingFormation(a,'active',undefined,()=>!cancelled),remainingFormation(c,'completed',undefined,()=>!cancelled),remainingHistory(e,()=>!cancelled)]);
        if(cancelled)return;
        setActive(allA.items);setCompleted(allC.items);setEnded(allE);setPageCursors({active:null,completed:null,ended:null});
      }catch(cause){if(isUnauthorized(cause))expire();}
    })();},350);
    return()=>{cancelled=true;window.clearTimeout(timer);};
  },[q,shelfFilter,expire]);
  useEffect(()=>{
    if(!q.trim()&&!shelfFilter&&filter==='all')return;
    let cancelled=false;
    const timer=window.setTimeout(()=>{void(async()=>{
      try{
        let cursor:string|undefined;const seen=new Set<string>();const items:CareWorkItem[]=[];
        do{
          const page=await helixAdminApi.listCareWork(cursor);if(cancelled)return;
          items.push(...page.items);setCareCounts(page.counts);
          cursor=page.nextCursor||undefined;
          if(cursor&&(seen.has(cursor)||seen.size>=399))throw new Error('改善记录分页游标异常，已停止读取。');
          if(cursor)seen.add(cursor);
        }while(cursor&&!cancelled);
        if(!cancelled){setCareItems(items);careExpanded.current=true;carePageCount.current=Math.max(1,Math.ceil(items.length/25));setCareCursor(null);}
      }catch(cause){if(isUnauthorized(cause))expire();else if(!cancelled)setError(cause instanceof Error?cause.message:'改善记录筛选失败。');}
    })();},350);
    return()=>{cancelled=true;window.clearTimeout(timer);};
  },[q,shelfFilter,filter,expire]);
  const rows=useMemo<LedgerRow[]>(()=>[...careItems.map((item)=>({kind:'care' as const,item})),...active.map((item)=>({kind:'formation' as const,item})),...completed.map((item)=>({kind:'formation' as const,item})),...ended.map((item)=>({kind:'ended' as const,item}))].filter((row)=>{
    if(q.trim()&&!row.item.displayIdentity.toLowerCase().includes(q.trim().toLowerCase()))return false;
    if(row.kind!=='ended'&&shelfFilter&&row.item.targetShelfId!==shelfFilter)return false;
    if(filter==='all')return true;if(row.kind==='care')return row.item.classification===filter||(filter==='in_progress'&&row.item.classification==='queued');if(filter==='ended')return row.kind==='ended';return row.kind==='formation'&&row.item.classification===filter;
  }),[active,completed,ended,careItems,filter,q,shelfFilter]);
  const close=()=>{setSelected(null);window.setTimeout(()=>triggerRef.current?.focus(),0);};
  useEffect(()=>{if(!selected)return;const key=(event:KeyboardEvent)=>{if(event.key==='Escape')close();};document.body.classList.add('formation-process-modal-open');document.addEventListener('keydown',key);closeRef.current?.focus();return()=>{document.body.classList.remove('formation-process-modal-open');document.removeEventListener('keydown',key);};},[selected]);
  const open=async(item:FormationSubject,button:HTMLButtonElement)=>{triggerRef.current=button;setLoading(true);try{setSelected(await helixAdminApi.getFormation(item.formationViewId));}catch(cause){setError(cause instanceof Error?cause.message:'上架过程详情读取失败。');}finally{setLoading(false);}};
  const action=async(item:FormationSubject,kind:'expedite'|'discard'|'admitDefects'|'retry'|'chooseShelf'|'chooseIdentity',value?:boolean|string)=>{
    if(kind==='discard'){setDiscardDialog(item);return;}
    setLoading(true);setError('');
    try{
      if(kind==='expedite')await helixAdminApi.setRunExpedited(item,Boolean(value));
      else if(kind==='admitDefects'){
        const candidate=await helixAdminApi.previewDefectAdmission(item);
        setLoading(false);
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
  const counts:Record<Filter,number>={all:summary.totalCount+ended.length+Object.values(careCounts).reduce((a,b)=>a+b,0),in_progress:summary.inProgressCount+(careCounts.in_progress||0)+(careCounts.queued||0),attention_required:summary.attentionRequiredCount+(careCounts.attention_required||0),completed:summary.completedCount+(careCounts.completed||0),ended:ended.length+(careCounts.ended||0)};
  return <section className="source-page workbench formation-page"><PageHeader title="媒体整理工作区" actions={<Button type="button" onClick={()=>void load()} disabled={loading}>{loading?'正在刷新…':'刷新'}</Button>} />
    {error&&<p className="form-error" role="alert">{error}</p>}
    {notice&&<p className="form-notice" role="status">{notice}</p>}
    {perceptionSync?.completionState==='incomplete'&&<p className="form-notice" role="status">豆瓣评分同步尚未完整结束，已保存 {perceptionSync.recordCount} 条；再次同步会从上次成功位置继续。列表中的“暂不能确认”不是影片匹配失败。</p>}
    <section className="formation-ledger"><div className="formation-toolbar">
      <div className="formation-chips" role="group" aria-label="媒体整理状态">{([{id:'all',label:'全部'},{id:'in_progress',label:'整理中'},{id:'attention_required',label:'需要处理'},{id:'completed',label:'已完成'},{id:'ended',label:'已结束'}] as Array<{id:Filter;label:string}>).map((entry)=><Button key={entry.id} type="button" aria-pressed={filter===entry.id} onClick={()=>setFilter(entry.id)}>{entry.label} {counts[entry.id]}</Button>)}</div>
      <div className="formation-secondary"><label>片名<input type="search" aria-label="按片名筛选" value={q} placeholder="搜索片名" onChange={(event)=>setQ(event.target.value)} /></label><label>目标收藏架<select aria-label="按目标收藏架筛选" value={shelfFilter} onChange={(event)=>setShelfFilter(event.target.value)}><option value="">全部收藏架</option>{shelves.map((shelf)=><option key={shelf.shelfId} value={shelf.shelfId}>{shelf.name}</option>)}</select></label></div>
    </div>
      <div className="formation-table-wrap"><table className="formation-table formation-stub-table"><thead><tr><th>媒体名称</th><th>评分</th><th>目标收藏架</th><th>整理要求</th><th>当前进展</th><th>详情</th><th>用户操作</th><th>加急</th></tr></thead><tbody>{rows.length===0?<tr className="formation-stub-media-row"><td colSpan={8}><div className="source-empty"><strong>{summary.totalCount===0?'还没有进入整理的电影':'当前筛选没有条目'}</strong><p>{summary.totalCount===0?'Libra 接收媒体包后，条目会从“整理中”开始出现在这里；仍在等待接收的媒体包请到“文件来源”查看。':'试试其他状态或筛选。'}</p></div></td></tr>:rows.map((row)=>row.kind==='care'?<CareWorkRow key={row.item.aftercareCaseId} item={row.item} onOpen={setSelectedCare}/>:row.kind==='ended'?<tr key={row.item.historyId} className="formation-stub-media-row"><td><strong>{row.item.displayIdentity}</strong><small>已结束</small></td><td>—</td><td>—</td><td>—</td><td><strong className="formation-stub-current">{row.item.label}</strong><small>{formatTime(row.item.endedAtMs)}</small></td><td>—</td><td>—</td><td><button type="button" className="formation-expedite-toggle" disabled>加急</button></td></tr>:<MediaRow key={row.item.subjectId} item={row.item} shelves={shelves} loading={loading} acquisitionIncomplete={perceptionSync?.completionState==='incomplete'} onOpen={open} onAction={action} />)}</tbody></table></div>
    </section>
    {Object.values(pageCursors).some(Boolean)&&<Button type="button" disabled={loadingMore} onClick={()=>void loadMore()}>{loadingMore?'正在读取…':'加载更多整理记录'}</Button>}
    <RecyclePanel/>
    {careCursor&&<Button type="button" onClick={()=>void loadCare(careCursor)}>加载更多改善记录</Button>}
    <Dialog open={!!selectedCare} title={selectedCare?selectedCare.displayIdentity+'的媒体整理过程':''} onClose={()=>setSelectedCare(null)}>{selectedCare&&<CareWorkDetail item={selectedCare}/>}</Dialog>
    {selected&&<div className="formation-process-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)close();}}><section className="formation-process-dialog" role="dialog" aria-modal="true" aria-labelledby="formation-process-dialog-title"><button ref={closeRef} className="formation-process-dialog-close" type="button" aria-label="关闭媒体整理过程卡片" onClick={close}>×</button><h2 id="formation-process-dialog-title" className="formation-process-dialog-title">{selected.displayIdentity}的媒体整理过程</h2><ProcessDetail item={selected} /></section></div>}
    <Dialog open={!!discardDialog} title="确认放弃整理" onClose={()=>setDiscardDialog(null)} actions={<>
      <Button type="button" disabled={loading} onClick={()=>setDiscardDialog(null)}>取消</Button>
      <Button type="button" variant="danger" disabled={loading} onClick={()=>{void (async()=>{
        if(!discardDialog)return;
        setLoading(true);setError('');
        try{
          await helixAdminApi.discardRun(discardDialog);
          setDiscardDialog(null);
          await load();
        }catch(cause){setError(cause instanceof Error?cause.message:'操作失败。');setLoading(false);}
      })();}}>确认放弃</Button>
    </>}>
      {discardDialog&&<div className="stack">
        <p>{discardDialog.displayIdentity}</p>
        <p>本次整理将结束，已产生的临时文件会被清理，原始媒体不会被删除。之后系统仍可能重新发现该媒体并开始新的整理。</p>
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
        <p>这些已列明瑕疵入库后不会由售后继续补齐；其他新问题仍会正常检查。</p>
      </div>}
    </Dialog>
  </section>;
}

function MediaRow({item,shelves,loading,acquisitionIncomplete,onOpen,onAction}:{item:FormationSubject;shelves:Shelf[];loading:boolean;acquisitionIncomplete:boolean;onOpen:(item:FormationSubject,button:HTMLButtonElement)=>void;onAction:(item:FormationSubject,kind:'expedite'|'discard'|'admitDefects'|'retry'|'chooseShelf'|'chooseIdentity',value?:boolean|string)=>void}) {
  const expedited=item.currentRun?.priorityClass==='expedited',reason=currentProgressLabel(item),progressDetail=currentProgressDetail(item);
  const [shelfId,setShelfId]=useState(''),[identityId,setIdentityId]=useState(''),[defectEligible,setDefectEligible]=useState(false);
  useEffect(()=>{
    let cancelled=false;
    setDefectEligible(false);
    if(item.currentRun?.state!=='frozen'||item.productIdentityIssue)return()=>{cancelled=true;};
    void helixAdminApi.previewDefectAdmission(item).then(()=>{if(!cancelled)setDefectEligible(true);}).catch(()=>{if(!cancelled)setDefectEligible(false);});
    return()=>{cancelled=true;};
  },[item.currentRun?.libraRunId,item.currentRun?.stateRevision,item.currentRun?.stateDigest,item.productIdentityIssue]);
  const actionControl=item.executorIssue?.canRetry?<Button type="button" disabled={loading} onClick={()=>void onAction(item,'retry')}>{item.executorIssue.phase==='on_deck_execution'?'重试上架':'重试验收'}</Button>:item.currentRun?.state==='frozen'&&!item.productIdentityIssue?<div className="formation-inline-action">{defectEligible&&<Button type="button" disabled={loading} onClick={()=>void onAction(item,'admitDefects')}>接受瑕疵</Button>}<Button type="button" variant="text" disabled={loading} onClick={()=>void onAction(item,'discard')}>放弃整理</Button></div>:canDiscardRejectedHandoff(item)?<Button type="button" variant="text" disabled={loading} onClick={()=>void onAction(item,'discard')}>放弃整理</Button>:item.productIdentityIssue?<div className="formation-inline-action"><select aria-label={`为${item.displayIdentity}选择影片身份`} value={identityId} onChange={(event)=>setIdentityId(event.target.value)}><option value="">选择影片身份</option>{item.productIdentityIssue.candidates.map((candidate)=><option key={candidate.providerKey} value={candidate.providerKey.replace(/^tmdb:movie:/,'')}>{candidate.displayTitle}{candidate.releaseYear?` (${candidate.releaseYear})`:''}</option>)}</select><Button type="button" disabled={loading||!identityId} onClick={()=>void onAction(item,'chooseIdentity',identityId)}>确认</Button><Button type="button" variant="text" disabled={loading} onClick={()=>void onAction(item,'discard')}>放弃整理</Button></div>:canChooseShelf(item)?<div className="formation-inline-action"><select aria-label={`为${item.displayIdentity}选择收藏架`} value={shelfId} onChange={(event)=>setShelfId(event.target.value)}><option value="">选择收藏架</option>{shelves.map((shelf)=><option key={shelf.shelfId} value={shelf.shelfId}>{shelf.name}</option>)}</select><Button type="button" disabled={loading||!shelfId} onClick={()=>void onAction(item,'chooseShelf',shelfId)}>确认</Button></div>:<span className="formation-stub-empty">—</span>;
  return <tr className="formation-stub-media-row" data-classification={item.classification} data-expedited={expedited||undefined}><td><strong>{item.displayIdentity}</strong><small>{statusLabel(item)} · {formatTime(item.addedAtMs)}</small></td><td><span className="formation-stub-rating">{ratingText(item,acquisitionIncomplete)}</span>{item.myRatingSource!=='douban'&&<RatingControl targetType="subject" targetId={item.subjectId} label={item.displayIdentity} initialRating={item.myRating} initialSource={item.myRatingSource} initialRevision={item.myRatingRevision} />}</td><td>{shelfName(item,shelves)}</td><td>{item.organizingRequirement}</td><td><strong className="formation-stub-current" data-state={item.classification}>{reason}</strong>{progressDetail&&<small>{progressDetail}</small>}</td><td><Button type="button" variant="text" aria-haspopup="dialog" onClick={(event)=>void onOpen(item,event.currentTarget)}>查看过程</Button></td><td>{actionControl}</td><td><button type="button" className="formation-expedite-toggle" aria-label={canExpedite(item)?(expedited?`取消加急 ${item.displayIdentity}`:`加急 ${item.displayIdentity}`):`${item.displayIdentity}无需加急`} aria-pressed={canExpedite(item)?expedited:undefined} disabled={loading||!canExpedite(item)} onClick={()=>void onAction(item,'expedite',!expedited)}>{expedited?'已加急':'加急'}</button></td></tr>;
}
