import type { CareWorkItem } from './api';
import { Button } from './chrome';
import { ProcessStages } from './ProcessStages';

const goals:Record<string,string>={nfo_missing:'补齐NFO',nfo_corrupt:'修复NFO',nfo_identity_changed:'同步NFO记录（历史任务）',nfo_update_required:'更新资料',poster_missing:'补齐海报',poster_corrupt:'修复海报',
  video_codec_unmet:'调整视频编码',container_unmet:'调整封装',file_extension_unmet:'调整文件格式',max_size_exceeded:'调整影片体积',placement_unmet:'整理收藏位置',settlement_gap:'清理旧文件'};
const stages:Record<string,string>={queued:'等待维护席位',preparing:'准备维护',waiting_for_resource:'等待处理资源',preparing_media:'处理媒体',awaiting_media_progress:'处理媒体，等待进度更新',verifying_media:'验证结果',committing_inventory:'更新收藏',reassessing:'复核结果',waiting_for_recovery:'等待自动恢复'};
export function careGoal(item:CareWorkItem){return [...new Set(item.goals.map((goal)=>goal.split(/[/:]/).map((part)=>goals[part]).find(Boolean)||'满足收藏要求'))].join('、');}
export function careStage(item:CareWorkItem){return item.state==='resolved'?'维护完成':item.state==='unresolved'?'需要处理':item.state==='invalidated'?'已结束，要求已变化':stages[item.progress?.stage||item.state]||'正在维护';}
export function CareWorkRow({item,onOpen}:{item:CareWorkItem;onOpen:(item:CareWorkItem)=>void}){
  return <tr className="formation-stub-media-row"><td><strong>{item.displayIdentity}</strong><small>上架后维护</small></td><td>—</td><td>{item.targetShelfName||'—'}</td><td>{careGoal(item)}</td><td><strong className="formation-stub-current">{careStage(item)}</strong>{item.progress?.progressPercent!=null&&<small>{item.progress.progressPercent}%</small>}</td><td><Button type="button" onClick={()=>onOpen(item)}>查看过程</Button></td><td>—</td><td>—</td><td>维护任务</td></tr>;
}
export function CareWorkDetail({item}:{item:CareWorkItem}){
  const progress=item.progress?.progress;
  return <article className="formation-process-card"><header className="formation-process-head"><div><span className="formation-process-eyebrow">上架后维护</span><h3>{item.displayIdentity}</h3><p>{careStage(item)}</p></div></header>
    <dl className="formation-process-facts"><div><dt>目标收藏架</dt><dd>{item.targetShelfName||'—'}</dd></div><div><dt>维护目标</dt><dd>{careGoal(item)}</dd></div><div><dt>当前进展</dt><dd>{careStage(item)}</dd></div></dl>
    {progress?.mode==='determinate'&&progress.totalValue>0&&<div className="formation-stub-progress"><progress aria-label="维护进度" max={progress.totalValue} value={progress.currentValue}/><small>{item.progress?.progressPercent}%</small></div>}
    {item.processDetail?.contract==='aftercare_process_actual_plans@1'?<ProcessStages stages={item.processDetail.stages}/>:<p>维护计划尚未读取成功；页面会继续刷新。</p>}
    {item.reasonCode&&<details><summary>查看处理依据</summary><p>{item.reasonCode}</p></details>}
  </article>;
}
