'use strict';

// Select only recorded execution nodes. Business stage labels and lifecycle
// conclusions remain owned by the caller.
function currentActionSummary(detail) {
  const stages=(detail?.stages||[]).filter(stage=>stage.plans?.length);
  const stage=[...stages].reverse().find(item=>item.state==='running')||stages.at(-1);
  if(!stage)return null;
  const plans=stage.plans,plan=[...plans].reverse().find(item=>item.state===stage.state)||plans.at(-1);
  if(!plan)return null;
  const node=plan.nodes.find(item=>item.state==='failed')||plan.nodes.find(item=>item.state==='running')||
    plan.nodes.find(item=>item.state==='pending')||plan.nodes.at(-1);
  if(!node)return null;
  return Object.freeze({stageKey:stage.key,planId:plan.planId,planNumber:plans.indexOf(plan)+1,title:plan.title,
    label:node.label,state:plan.state,statusText:node.statusText||null,progress:node.progress||null});
}
module.exports=Object.freeze({currentActionSummary});
