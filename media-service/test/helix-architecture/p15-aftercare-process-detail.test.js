'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {projectAftercareProcess}=require('../../src/helix/domains/arca/application/aftercare-process-projection');

test('maintenance details distinguish external waits and terminated work from tasks that have not started',()=>{
  const work={workId:'repair',workKind:'care_repair_prepare',state:'running',createdAtMs:1,
    plans:[{planId:'plan',createdAtMs:1,edges:[]}],events:[{eventId:'fetch',nodeId:'fetch',planId:'plan',
      state:'waiting_for_external',capabilityRef:'arca.aftercare.binary.acquire@1'}]};
  let stage=projectAftercareProcess([work],10).stages[0];
  assert.equal(stage.plans[0].nodes[0].state,'running');
  assert.equal(stage.plans[0].nodes[0].statusText,'等待外部结果');
  work.state='cancelled';work.events[0].state='cancelled';
  stage=projectAftercareProcess([work],10).stages[0];
  assert.equal(stage.state,'cancelled');
  assert.equal(stage.summary,'已终止');
  assert.equal(stage.plans[0].state,'cancelled');
  assert.equal(stage.plans[0].nodes[0].state,'cancelled');
});

test('maintenance details preserve real plan dependencies, resource waits, and verification results',()=>{
  const detail=projectAftercareProcess([{workId:'repair-1',workKind:'care_repair_prepare',state:'running',createdAtMs:1,
    plans:[{planId:'plan-1',state:'committed',createdAtMs:1,edges:[{fromNodeId:'encode',toNodeId:'verify'}]}],
    events:[{eventId:'verify-event',nodeId:'verify',planId:'plan-1',state:'blocked',capabilityRef:'arca.aftercare.media.verify@1'},
      {eventId:'encode-event',nodeId:'encode',planId:'plan-1',state:'waiting_for_resource',capabilityRef:'arca.aftercare.media.transcode@1'}],
  }],1000);
  assert.equal(detail.contract,'aftercare_process_actual_plans@1');
  const plan=detail.stages[0].plans[0];
  assert.equal(plan.state,'running');
  assert.deepEqual(plan.nodes.map(node=>node.nodeId),['encode','verify']);
  assert.equal(plan.nodes[0].statusText,'等待资源');
  assert.equal(plan.nodes[0].progress,null);
  assert.equal(plan.nodes[1].state,'pending');
  assert.deepEqual(plan.nodes[1].results,[]);
  assert.deepEqual(projectAftercareProcess([],1000).stages,[]);
});

test('maintenance process details never present stale encode progress as current or skip the final verification',()=>{
  const work={workId:'repair',workKind:'care_repair_prepare',state:'running',createdAtMs:1,
    plans:[{planId:'plan',createdAtMs:1,edges:[]}],events:[{
      eventId:'encode',nodeId:'encode',planId:'plan',state:'executing',capabilityRef:'arca.aftercare.media.transcode@1',
      progress:{mode:'determinate',currentValue:80,totalValue:100,sampledAtMs:1},
    }]};
  let node=projectAftercareProcess([work],130000).stages[0].plans[0].nodes[0];
  assert.equal(node.progress,null);
  assert.equal(node.statusText,'等待进度更新');
  work.events=[{eventId:'verify',nodeId:'verify',planId:'plan',state:'succeeded',capabilityRef:'arca.aftercare.media.verify@1',
    result:{result:{result:'failed'},resultDigest:'evidence'}}];
  node=projectAftercareProcess([work],130000).stages[0].plans[0].nodes[0];
  assert.deepEqual(node.results,[{label:'验证结论',value:'未通过'}]);
});


test('UAT-212 maintenance summary selects the actual current action and keeps its status and progress',()=>{
  const progress={mode:'determinate',currentValue:25,totalValue:100,unit:'percent',sampledAtMs:10};
  const work={workId:'current',workKind:'care_repair_prepare',state:'running',createdAtMs:2,
    plans:[{planId:'plan',createdAtMs:2,edges:[]}],events:[{eventId:'encode',nodeId:'encode',planId:'plan',
      state:'executing',capabilityRef:'arca.aftercare.media.transcode@1',progress}]};
  const detail=projectAftercareProcess([work],20);
  assert.equal(detail.currentAction.label,detail.stages[0].plans[0].nodes[0].label);
  assert.equal(detail.currentAction.statusText,'正在执行');
  assert.deepEqual(detail.currentAction.progress,progress);
  assert.equal(projectAftercareProcess([work],130000).currentAction.progress,null);
});
