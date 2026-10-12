'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {projectPlans,currentPlanSummary}=require('../src/helix/domains/libra/application/formation-process-projection');

function projected(capabilityRef,state) {
  const plan={planId:'plan',plannerRef:'planner',plannerVersion:1,state:'planned',createdAtMs:1,edges:[]};
  return projectPlans([{workId:'work',workKind:'on_deck_execution',ownerDomain:'arca',processType:'arca_ondeck_run',
    processId:'run',plans:[plan],events:[{eventId:'event',nodeId:'node',planId:'plan',plan,capabilityRef,state,
      progress:null,result:null,inputBindings:{bindings:[]},parameters:{}}]}])[0];
}

test('UAT-289 exposes the exact settlement permission wait and its configuration destination',()=>{
  const plan=projected('arca.ondeck.input_settlement.delete@1','waiting_for_external');
  const node=plan.nodes[0];
  assert.equal(node.state,'running');
  assert.equal(node.statusText,'等待自动清理授权');
  assert.equal(node.description,'');
  assert.equal(node.configurationTarget,'input_settlement_authorization');
  assert.equal(currentPlanSummary({stages:[{key:'acceptance_shelving',state:'running',plans:[plan]}]}).configurationTarget,
    'input_settlement_authorization');
});

test('UAT-289 does not invent authorization waits for Providers or executing/completed settlement',()=>{
  const provider=projected('libra.external_material.stability.observe@1','waiting_for_external').nodes[0];
  assert.equal(provider.statusText,'等待外部服务');
  assert.equal(provider.configurationTarget,undefined);
  for(const state of ['ready','executing','succeeded','failed','pending']) {
    const node=projected('arca.ondeck.input_settlement.delete@1',state).nodes[0];
    assert.notEqual(node.statusText,'等待自动清理授权');
    assert.equal(node.configurationTarget,undefined);
  }
});
