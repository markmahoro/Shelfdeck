import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { FormationSubject } from './api';

export function ProcessDialog({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) {
  const titleId=useId(),closeRef=useRef<HTMLButtonElement>(null),close=useRef(onClose);
  close.current=onClose;
  useEffect(()=>{
    const trigger=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape')close.current();};
    document.body.classList.add('formation-process-modal-open');document.addEventListener('keydown',key);closeRef.current?.focus();
    return()=>{document.body.classList.remove('formation-process-modal-open');document.removeEventListener('keydown',key);trigger?.focus();};
  },[]);
  return <div className="formation-process-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="formation-process-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button ref={closeRef} className="formation-process-dialog-close" type="button" aria-label="关闭媒体整理过程卡片" onClick={onClose}>×</button>
      <h2 id={titleId} className="formation-process-dialog-title">{title}</h2>{children}
    </section>
  </div>;
}

function progressText(progress:NonNullable<FormationSubject['organizingSteps'][number]['progress']>) {
  if(progress.mode!=='determinate'||!progress.totalValue)return '';
  const percent=Math.max(0,Math.min(100,Math.round(((progress.currentValue||0)/progress.totalValue)*100)));
  return ['percent','microseconds'].includes(progress.unit||'')?`${percent}%`:`${progress.currentValue||0}/${progress.totalValue} ${progress.unit||''}`;
}
function progressRate(progress:NonNullable<FormationSubject['organizingSteps'][number]['progress']>) {
  const rate=progress.rate;
  if(rate===null||!Number.isFinite(rate)||rate<0)return '';
  if(progress.unit==='microseconds')return `${rate.toFixed(2)} 倍速`;
  if(progress.unit==='percent')return '';
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
export function progressDetail(progress:NonNullable<FormationSubject['organizingSteps'][number]['progress']>) {
  return [progressText(progress),progressRate(progress),progressEta(progress)].filter(Boolean).join(' · ');
}
function StageState({ state }:{ state:'completed'|'running'|'attention'|'pending'|'cancelled' }) {
  return <span className="formation-stub-stage-state" data-state={state}>{state==='completed'?'已完成':state==='running'?'进行中':state==='attention'?'需要处理':state==='cancelled'?'已终止':'尚未开始'}</span>;
}
export type ProcessStage=Omit<NonNullable<FormationSubject['processDetail']>['stages'][number],'key'>&{key:string};
type ProcessPlan=ProcessStage['plans'][number];
type ProcessNode=ProcessPlan['nodes'][number];
function processPlanState(state:ProcessPlan['state']) { return state==='completed'?'已完成':state==='running'?'进行中':state==='attention'?'需要处理':state==='cancelled'?'已终止':'等待中'; }
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
export function ProcessStages({ stages }:{ stages:ProcessStage[] }) { return <div className="formation-process-stages">{stages.map((stage,index)=><ProcessStageView key={stage.key} stage={stage} index={index} />)}</div>; }
