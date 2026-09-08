import { Link } from 'react-router-dom';
import type { CareWorkItem } from './api';
import { Button } from './chrome';
import { ProcessStages, progressDetail } from './ProcessStages';

const goals:Record<string,string>={nfo_missing:'补齐NFO',nfo_corrupt:'修复NFO',nfo_identity_changed:'同步NFO记录（历史任务）',nfo_update_required:'更新资料',poster_missing:'补齐海报',poster_corrupt:'修复海报',
  video_codec_unmet:'调整视频编码',container_unmet:'调整封装',file_extension_unmet:'调整文件格式',max_size_exceeded:'调整影片体积',placement_unmet:'整理收藏位置',settlement_gap:'清理旧文件'};
const stages:Record<string,string>={queued:'等待维护席位',preparing:'准备维护',waiting_for_resource:'等待处理资源',preparing_media:'处理媒体',awaiting_media_progress:'处理媒体，等待进度更新',verifying_media:'验证结果',committing_inventory:'更新收藏',reassessing:'复核结果',waiting_for_recovery:'等待自动恢复'};
export function careGoal(item:CareWorkItem){return [...new Set(item.goals.map((goal)=>goal.split(/[/:]/).map((part)=>goals[part]).find(Boolean)||'满足收藏要求'))].join('、');}
export function careStage(item:CareWorkItem){return item.state==='resolved'?'维护完成':item.state==='unresolved'?'已结束 · 未解决':item.state==='invalidated'?'已结束，要求已变化':item.progress?.currentAction?.label||stages[item.progress?.stage||item.state]||'正在维护';}
const reasons:Record<string,string>={external_writer_conflict:'文件变化与本次处理依据冲突，维护已停止。',
  reassessment_exhausted:'结果复核多次未通过，本次维护已停止。',repair_commit_exhausted:'更新收藏记录多次失败，本次维护已停止。',
  settlement_or_commit_failed:'旧文件收尾或收藏提交失败，本次维护已停止。',
  reassessed_healthy:'维护目标已完成，结束时复核通过。',queued_basis_changed:'执行前要求已变化。'};
const triggers:Record<string,string>={max_size_exceeded:'建单时影片体积超过当时适用的收藏上限。',
  video_codec_unmet:'建单时视频编码不满足收藏要求。',container_unmet:'建单时封装不满足收藏要求。',
  file_extension_unmet:'建单时文件格式不满足收藏要求。',placement_unmet:'建单时收藏位置不满足当时规则。',
  nfo_update_required:'当时的资料检查要求更新NFO。',nfo_identity_changed:'当时检测到NFO文件记录变化。',
  nfo_missing:'当时缺少必需的NFO文件。',nfo_corrupt:'当时NFO文件未通过检查。',
  poster_missing:'当时缺少必需的海报。',poster_corrupt:'当时海报未通过检查。',settlement_gap:'当时有旧文件收尾尚未完成。'};
function triggerText(item:CareWorkItem){return [...new Set(item.goals.map(goal=>goal.split(/[/:]/).map(part=>triggers[part]).find(Boolean)||'建单时发现收藏要求未满足，具体依据见处理步骤。'))].join(' ');}
function actionDetail(item:CareWorkItem){const action=item.progress?.currentAction;return action?[action.statusText,action.progress?progressDetail(action.progress):null].filter(Boolean).join(' · '):null;}
function reasonText(item:CareWorkItem){return item.reasonCode?(reasons[item.reasonCode]||'本次处理已结束，具体原因见处理步骤与技术信息。'):null;}
function time(value:number|null){return value?new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium',timeStyle:'short'}).format(value):'—';}
function bytes(value:number){return `${(value/1073741824).toFixed(2)} GiB`;}
function currentHealthText(item:CareWorkItem){const health=item.currentHealth;
  if(!health)return '暂时无法读取当前收藏状态';
  if(health.maintenanceState==='active')return health.maintenanceCaseId===item.aftercareCaseId?'本次维护进行中':'正在进行新的维护';
  if(health.healthState==='healthy')return '当前收藏健康';
  if(health.healthState==='unhealthy')return health.maintenanceState==='queued'?'当前仍有问题，等待维护':'当前仍有问题，请查看我的收藏中的健康依据';
  return '当前健康状态尚不能确定';
}
export function CareWorkRow({item,onOpen}:{item:CareWorkItem;onOpen:(item:CareWorkItem)=>void}){
  return <tr className="formation-stub-media-row"><td><strong>{item.displayIdentity}</strong><small>上架后维护 · {time(item.createdAtMs)}</small></td><td>—</td><td>{item.targetShelfName||'—'}</td><td>{careGoal(item)}<small>{triggerText(item)}</small></td><td><strong className="formation-stub-current">{careStage(item)}</strong>{actionDetail(item)&&<small>{actionDetail(item)}</small>}{reasonText(item)&&<small>{reasonText(item)}</small>}{item.currentHealth!==undefined&&<small>{currentHealthText(item)}</small>}{item.terminalAtMs&&<small>{time(item.terminalAtMs)}</small>}{!item.progress?.currentAction && item.progress?.progressPercent!=null&&<small>{item.progress.progressPercent}%</small>}</td><td><Button type="button" variant="text" onClick={()=>onOpen(item)}>查看过程</Button></td><td><Link to="/collection">收藏健康</Link></td><td>—</td><td>维护任务</td></tr>;
}
export function CareWorkDetail({item,error=''}:{item:CareWorkItem;error?:string}){
  const progress=item.progress?.progress;
  return <article className="formation-process-card"><header className="formation-process-head"><div><span className="formation-process-eyebrow">上架后维护</span><h3>{item.displayIdentity}</h3><p>{careStage(item)}</p></div></header>
    <dl className="formation-process-facts"><div><dt>目标收藏架</dt><dd>{item.targetShelfName||'—'}</dd></div><div><dt>维护目标</dt><dd>{careGoal(item)}</dd></div><div><dt>当前进展</dt><dd>{careStage(item)}{actionDetail(item)&&<small> · {actionDetail(item)}</small>}</dd></div></dl>
    <section className="formation-stage-body" aria-label="维护原因与结果">
      <p><strong>当时为什么处理：</strong>{triggerText(item)}</p>
      {item.caseEvidence?.originalPrimaryBytes!=null&&<p>建单时正片 {bytes(item.caseEvidence.originalPrimaryBytes)}{item.caseEvidence.currentPrimaryBytes!=null?`；当前记录正片 ${bytes(item.caseEvidence.currentPrimaryBytes)}`:''}。</p>}
      {item.caseEvidence?.objective ? <p>当时目标：{[
        item.caseEvidence.objective.requirements.space?.maxSizeBytes != null ? `体积不超过 ${bytes(item.caseEvidence.objective.requirements.space.maxSizeBytes)}` : null,
        item.caseEvidence.objective.requirements.mandatoryMedia?.videoCodec ? `视频编码 ${item.caseEvidence.objective.requirements.mandatoryMedia.videoCodec}` : null,
        item.caseEvidence.objective.requirements.mandatoryMedia?.container ? `封装 ${item.caseEvidence.objective.requirements.mandatoryMedia.container}` : null,
      ].filter(Boolean).join('；') || '按创建时保存的收藏要求处理'}。</p> : <p>未记录当时具体目标；当前收藏要求不代表当时目标。</p>}
      {item.goals.some(goal=>goal.split(/[/:]/).includes('placement_unmet'))&&(item.caseEvidence?.objective?.placement?<>
        <p style={{overflowWrap:'anywhere'}}>当时收藏根目录：{item.caseEvidence.objective.placement.target.rootLocation}</p>
        {item.caseEvidence.objective.placement.policy.folderTemplate&&<p style={{overflowWrap:'anywhere'}}>当时文件夹规则：{item.caseEvidence.objective.placement.policy.folderTemplate}</p>}
        {item.caseEvidence.objective.placement.policy.primaryTemplate&&<p style={{overflowWrap:'anywhere'}}>当时影片命名规则：{item.caseEvidence.objective.placement.policy.primaryTemplate}</p>}
      </>:<p>未记录当时收藏路径与命名规则；不使用当前配置倒推。</p>)}
      {!item.caseEvidence?.objective && item.goals.some(goal=>goal.split(/[/:]/).includes('max_size_exceeded'))&&<p>建单记录未保存具体体积上限；这里不使用当前规则倒推历史上限。</p>}
      <p><strong>{['resolved','unresolved','invalidated'].includes(item.state)?'本次结果：':'本次状态：'}</strong>{reasonText(item)||careStage(item)}</p>
      <p>开始于 {time(item.createdAtMs)}{item.terminalAtMs?`；结束于 ${time(item.terminalAtMs)}`:''}</p>
      {item.currentHealth!==undefined&&<p><strong>{currentHealthText(item)}</strong>。历史维护结果保留；当前是否需要处理以收藏的最新检查为准。</p>}
      {item.currentHealth?.healthState==='unhealthy'&&<div><p>当前问题仍保留在“我的收藏”的健康状态中；本条历史任务已停止，不会继续执行。</p>
        <ul>{Object.entries(item.currentHealth.dimensions||{}).flatMap(([dimension,value])=>value.findings.map(finding=><li key={finding.findingId}>{({custody:'文件保管',presentation:'资料完整性',conformance:'收藏要求'} as Record<string,string>)[dimension]}：{finding.findingKind.split(/[/:]/).map(part=>({max_size_exceeded:'影片体积超过当前收藏上限',video_codec_unmet:'视频编码不满足当前要求',old_binding_identity_changed:'原位置文件与旧材料记录不一致',nfo_missing:'缺少必需的NFO',poster_missing:'缺少必需的海报'} as Record<string,string>)[part]).find(Boolean)||'检查发现问题，需查看当前健康依据'}<details><summary>检查代码</summary>{finding.findingKind}</details></li>))}</ul>
        <Link to="/collection">查看我的收藏</Link></div>}
    </section>
    {progress?.mode==='determinate'&&progress.totalValue>0&&<div className="formation-stub-progress"><progress aria-label="维护进度" max={progress.totalValue} value={progress.currentValue}/><small>{item.progress?.progressPercent}%</small></div>}
    {item.processDetail?.contract==='aftercare_process_actual_plans@1'?<ProcessStages stages={item.processDetail.stages}/>:error?<p role="alert">{error}</p>:<p role="status">正在读取维护计划…</p>}
    {item.reasonCode&&<details><summary>技术信息</summary><p>{item.reasonCode}</p></details>}
  </article>;
}
