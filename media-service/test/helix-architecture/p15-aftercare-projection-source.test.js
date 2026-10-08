'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  resolvePreparedOutput,
  createAftercareProjections,
} = require('../../src/helix/domains/arca/planning/aftercare-projections');
const { P } = require('../../src/helix/domains/arca/planning/aftercare-planners');
const { CAPABILITY_REFS:C } = require('../../src/helix/domains/arca/model/aftercare-contract');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const {
  projectActiveRepairProgress,
} = require('../../src/helix/domains/arca/application/aftercare-process-coordinator');

for (const projectionRef of [P.assessmentSet, P.commit]) {
  test(`assessment projection reads one consistent fresh context per call: ${projectionRef}`, () => {
    let reads = 0;
    const projections = createAftercareProjections({
      contextReader:{ read() { return { shelfEntryId:'entry', basis:{ digest:canonicalDigest(++reads) } }; } },
      materialControlProjectionPort:{ getMaterialControlProjections() { return []; } },
      controlScopeDigest:canonicalDigest,
      workResultReader:{ read(workId) {
        assert.equal(workId, 'assessment-work');
        return ['custody','presentation','conformance'].map(kind => ({
          outcomeKind:'succeeded', capabilityRef:C[kind],
          result:{ careBasisDigest:canonicalDigest(reads), evidenceKind:'arca_aftercare_' + kind, evidenceId:kind,
            schemaRef:'helix://test/' + kind, payloadDigest:canonicalDigest(kind) },
        }));
      } },
    });
    const projection = projections.find(item => item.projectionRef === projectionRef).projection;
    const command = { ownerScope:{ processId:'entry' },
      parameters:{ workId:'assessment-work', eventId:'event', deep:true } };
    const first = projection.project(command);
    assert.equal(reads, 1);
    const second = projection.project(command);
    assert.equal(reads, 2, 'a later projection must read fresh business facts');
    if (projectionRef === P.assessmentSet) {
      assert.equal(first.careBasisDigest, canonicalDigest(1));
      assert.equal(second.careBasisDigest, canonicalDigest(2));
    } else {
      assert.equal(first.eventFenceDigest, canonicalDigest({
        schema:'arca.aftercare-assessment-fence@1', eventId:'event', basis:canonicalDigest(1),
      }));
      assert.notEqual(first.eventFenceDigest, second.eventFenceDigest);
    }
  });
}

test('Aftercare media verification consumes its projected same-Work Result', () => {
  const projected = Object.freeze({
    schemaRef:'helix://contracts/types/WorkspaceMediaHandle/v1',
    workspaceMediaHandleId:'workspace-media-1',
  });
  const reader = Object.freeze({
    read() { throw new Error('same-Work projection must not query an undefined Work'); },
  });
  assert.equal(resolvePreparedOutput(projected, {}, reader), projected);
});

test('Aftercare commit-stage output resolves from its explicit preparation Work', () => {
  const artifact = Object.freeze({ artifactHandleId:'artifact-1' });
  const reader = Object.freeze({
    read(workId) {
      assert.equal(workId, 'prepare-work-1');
      return [{
        outcomeKind:'succeeded',
        capabilityRef:'arca.aftercare.text_artifact.render@1',
        result:{ artifactHandle:artifact },
      }];
    },
  });
  assert.equal(resolvePreparedOutput(null, {
    sourceWorkId:'prepare-work-1', outputKind:'nfo',
  }, reader), artifact);
});

test('Aftercare prepared output fails closed without either source authority', () => {
  assert.throws(() => resolvePreparedOutput(null, {}, { read() {} }),
    (error) => error?.code === 'ARCA_AFTERCARE_PREPARED_OUTPUT_SOURCE_MISSING');
});

test('Aftercare multi-NFO preparation resolves the exact Event and refuses ambiguous or foreign outputs',()=>{
  const rows=[1,2,3].map(number=>({eventId:'render-'+number,outcomeKind:'succeeded',capabilityRef:C.textRender,
    result:{artifactHandleId:'episode-'+number}}));
  rows.push({eventId:'poster',outcomeKind:'succeeded',capabilityRef:C.binaryAcquire,
    result:{resultKind:'acquired',artifactHandle:{artifactHandleId:'poster'}}});
  const reader={read:workId=>workId==='prepare'?rows:[]};
  for(const number of [1,2,3])assert.equal(resolvePreparedOutput(null,
    {sourceWorkId:'prepare',outputKind:'nfo',sourceEventId:'render-'+number},reader).artifactHandleId,'episode-'+number);
  for(const parameters of [
    {sourceWorkId:'prepare',outputKind:'nfo'},
    {sourceWorkId:'foreign',outputKind:'nfo',sourceEventId:'render-3'},
    {sourceWorkId:'prepare',outputKind:'nfo',sourceEventId:'missing'},
    {sourceWorkId:'prepare',outputKind:'nfo',sourceEventId:'poster'},
  ])assert.throws(()=>resolvePreparedOutput(null,parameters,reader),/absent or ambiguous/);
  rows.push({...rows[2]});
  assert.throws(()=>resolvePreparedOutput(null,{sourceWorkId:'prepare',outputKind:'nfo',sourceEventId:'render-3'},reader),/ambiguous/);
});

test('Aftercare commit Planner binds each NFO to its own prepared Event Result',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const {createCareRepairCommitPlanner}=require('../../src/helix/domains/arca/planning/aftercare-planners');
  const {validateWorkflowPlan}=require('../../src/helix/foundation/execution/workflow-plan');
  const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
  const refs=[C.artifactMaterialize,C.inventoryCommit,C.settlement];
  const manifests=new Map(refs.map(ref=>[ref,JSON.parse(fs.readFileSync(path.join(__dirname,
    '../../src/helix/contracts/capabilities',...ref.replace('@1','').split('.'),'v1/manifest.json'),'utf8'))]));
  const registry={snapshot:refs.map(capabilityRef=>({capabilityRef,contractVersion:1})),
    resolve:capabilityRef=>({manifest:manifests.get(capabilityRef)})};
  const policyRegistry={digest:canonicalDigest('policy'),bindingFor:()=>({retryPolicyRef:'retry@1',timeoutPolicyRef:'timeout@1'})};
  const rows=[1,2,3].map(number=>({eventId:'render-'+number,outcomeKind:'succeeded',capabilityRef:C.textRender,
    result:{artifactHandleId:'episode-'+number}})),reader={read:()=>rows};
  const plan=createCareRepairCommitPlanner({registry,policyRegistry,workResultReader:reader,
    contextReader:{read:()=>({raw:{materials:[{role:'metadata_sidecar'}]}})}}).plan({
      workAttemptId:'commit-attempt',workId:'commit',ownerDomain:'arca',processType:'arca_shelf_entry',processId:'entry',
      executionBasisDigest:canonicalDigest('basis'),dependencyRefs:[{objectType:'repair_prepare_work',objectId:'prepare'}]});
  const schemas=refs.flatMap(ref=>['parameters','resource-demand','fence'].map(kind=>JSON.parse(fs.readFileSync(path.join(__dirname,
    '../../src/helix/contracts/capabilities',...ref.replace('@1','').split('.'),'v1',kind+'.schema.json'),'utf8'))));
  validateWorkflowPlan(plan,{registry,policyRegistry,contractValidator:createCapabilityContractValidator({schemas})});
  const materializers=plan.nodes.filter(node=>node.capabilityRef===C.artifactMaterialize);
  assert.equal(materializers.length,3);
  for(const [index,node] of materializers.entries()) {
    const parameters=node.inputBindings.bindings.find(binding=>binding.portName==='verifiedArtifactOrWorkspaceMediaHandle').parameters;
    assert.equal(parameters.sourceEventId,'render-'+(index+1));
    assert.equal(resolvePreparedOutput(null,parameters,reader).artifactHandleId,'episode-'+(index+1));
  }
  assert.deepEqual(plan.nodes.find(node=>node.capabilityRef===C.inventoryCommit).dependsOn.map(item=>item.eventId),materializers.map(node=>node.eventId));
});

test('Aftercare progress is scoped to the current preparation Work and clamps executing media below terminal', () => {
  const progress = projectActiveRepairProgress([
    { workId:'orphan-work', events:[{
      capabilityRef:'arca.aftercare.media.transcode@1', state:'executing',
      progress:{ mode:'determinate', currentValue:100, totalValue:100 },
    }] },
    { workId:'current-work', events:[{
      capabilityRef:'arca.aftercare.media.transcode@1', state:'executing',
      progress:{ mode:'determinate', currentValue:42, totalValue:100, sampledAtMs:Date.now() },
    }] },
  ], 'current-work');
  assert.equal(progress.stage, 'preparing_media');
  assert.equal(progress.progressPercent, 42);

  const terminalSample = projectActiveRepairProgress([{
    workId:'current-work', events:[{
      capabilityRef:'arca.aftercare.media.transcode@1', state:'executing',
      progress:{ mode:'determinate', currentValue:100, totalValue:100, sampledAtMs:Date.now() },
    }],
  }], 'current-work');
  assert.equal(terminalSample.progressPercent, 99);
});

test('Aftercare media success advances to verification without presenting a whole-Case percentage', () => {
  const progress = projectActiveRepairProgress([{
    workId:'current-work', events:[
      { capabilityRef:'arca.aftercare.media.transcode@1', state:'succeeded', progress:null },
      { capabilityRef:'arca.aftercare.media.verify@1', state:'executing', progress:null },
    ],
  }], 'current-work');
  assert.deepEqual(progress, {
    stage:'verifying_media', progressPercent:null, progress:null,
  });
});

test('Aftercare exposes resource waiting and does not present stale progress as live', () => {
  const project=(state,progress)=>projectActiveRepairProgress([{workId:'work',events:[
    {capabilityRef:'arca.aftercare.media.transcode@1',state,progress},
  ]}],'work',200000);
  assert.equal(project('waiting_for_resource',null).stage,'waiting_for_resource');
  assert.deepEqual(project('executing',{mode:'determinate',currentValue:42,totalValue:100,sampledAtMs:1}),
    {stage:'awaiting_media_progress',progressPercent:null,progress:null});
  assert.equal(project('executing',{mode:'determinate',currentValue:43,totalValue:100,sampledAtMs:199999}).progressPercent,43);
});

for(const projectionRef of [P.assessmentSet,P.commit]) {
 test('old professional evidence cannot be relabeled with a new Basis: '+projectionRef,()=>{
  const projections=createAftercareProjections({contextReader:{read:()=>({shelfEntryId:'entry',basis:{digest:canonicalDigest('new')}})},
   materialControlProjectionPort:{getMaterialControlProjections:()=>[]},controlScopeDigest:canonicalDigest,
   workResultReader:{read:()=>['custody','presentation','conformance'].map(kind=>({outcomeKind:'succeeded',capabilityRef:C[kind],
    result:{careBasisDigest:canonicalDigest('old'),evidenceKind:'arca_aftercare_'+kind,evidenceId:kind,payloadDigest:canonicalDigest(kind)}}))}});
  assert.throws(()=>projections.find(x=>x.projectionRef===projectionRef).projection.project({ownerScope:{processId:'entry'},parameters:{workId:'work',eventId:'event',deep:true}}),e=>e.code==='P4_EXECUTION_INPUT_BASIS_SUPERSEDED'&&require('../../src/helix/foundation/execution/execution-input-readiness').isExecutionInputSuperseded(e));
 });
}
