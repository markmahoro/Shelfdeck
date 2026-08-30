'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const Database=require('better-sqlite3');
const {buildFormationProcessDetail,projectPlans}=require('../src/helix/domains/libra/application/formation-process-projection');
const {createExecutionProgressProjectionReader}=require('../src/helix/foundation/execution/progress-projection-reader');
const {openSqliteKernel}=require('../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot=path.resolve(__dirname,'../src/helix/foundation/persistence/generated');
const schemaDdl=fs.readFileSync(path.join(generatedRoot,'clean-schema.sql'),'utf8');
const schemaManifest=JSON.parse(fs.readFileSync(path.join(generatedRoot,'clean-schema.manifest.json'),'utf8'));
const hex='a'.repeat(64);

function event(planId,nodeId,capabilityRef,state,createdAtMs,edges=[],extra={}) {
  return {eventId:`event-${nodeId}`,planId,nodeId,capabilityRef,state,progress:null,result:null,inputBindings:{bindings:[]},parameters:{},
    plan:{planId,plannerRef:'planner',plannerVersion:1,state:'planned',createdAtMs,edges},...extra};
}
function work(ownerDomain,processType,processId,workKind,events) {
  return {workId:`work-${processId}-${workKind}`,ownerDomain,processType,processId,workKind,state:'running',createdAtMs:1,events};
}

test('Formation process projection preserves durable Plan boundaries and dependency order',()=>{
  const edges=[{fromNodeId:'first',toNodeId:'second',dependencyKind:'success'}];
  const works=[work('libra','libra_run','run-1','workspace_media_production',[
    event('plan-b','second','libra.product_output.select@1','pending',20,edges),
    event('plan-b','first','libra.media.transcode@1','executing',20,edges),
  ]),work('libra','libra_run','run-1','source_media_observation',[
    event('plan-a','probe','shared.material.media.probe@1','succeeded',10,[],{result:{outcomeKind:'succeeded',result:{result:'passed'}}}),
  ])];
  const plans=projectPlans(works);
  assert.deepEqual(plans.map((plan)=>plan.planId),['plan-a','plan-b']);
  assert.deepEqual(plans[1].nodes.map((node)=>node.nodeId),['first','second']);
  assert.equal(plans[1].state,'running');
});

test('Formation process card receives only actual Plans from exact domain process scopes',()=>{
  const works=[
    work('procurement','procurement_run','proc-1','evidence_assessment',[event('proc-plan','inspect','procurement.triage.structure.inspect@1','succeeded',1)]),
    work('procurement','procurement_run','another-run','candidate_assembly',[event('wrong-plan','publish','procurement.candidate.publish@1','succeeded',2)]),
    work('libra','libra_routing','subject-1','routing_basis',[event('libra-plan','route','libra.decision_basis.commit@1','succeeded',3)]),
    work('arca','arca_acceptance','offer-1','acceptance_assessment',[event('arca-plan','identity','arca.acceptance.identity.verify@1','pending',4)]),
  ];
  const detail=buildFormationProcessDetail({displayIdentity:'示例电影',targetShelfName:'电影',works,
    procurementScopes:[{processType:'procurement_run',processId:'proc-1'}],
    libraScopes:[{processType:'libra_routing',processId:'subject-1'}],
    arcaScopes:[{processType:'arca_acceptance',processId:'offer-1'}]});
  assert.equal(detail.contract,'formation_process_actual_plans@1');
  assert.deepEqual(detail.stages.map((stage)=>stage.plans.map((plan)=>plan.planId)),[['proc-plan'],['libra-plan'],['arca-plan']]);
  assert.ok(!JSON.stringify(detail).includes('wrong-plan'));
});

test('Formation frontend renders backend Plans without an organizingSteps Plan fallback',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../web/src/helix/FormationPage.tsx'),'utf8');
  const processDetail=source.slice(source.indexOf('function ProcessDetail'),source.indexOf('export default function FormationPage'));
  assert.match(processDetail,/detail\.stages\.map/);
  assert.doesNotMatch(processDetail,/organizingSteps|mediaOrganization\.steps|ChecklistSteps/);
  assert.match(processDetail,/页面不会根据状态推测或补造计划/);
});

test('execution progress reader exposes persisted Plan envelopes, including an empty no-effect Plan',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'formation-plan-reader-')),databasePath=path.join(root,'shelfdeck.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>100});
  try {
    kernel.runPrimitive(({prepare})=>{
      prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,definition_schema_ref,definition_json,definition_digest,state,idempotency_key,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run('work-1','libra','libra_run','run-1','source_media_observation',hex,'normal','work','{}',hex,'succeeded','key-1',10,20);
      prepare('INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,basis_digest,state,started_at_ms,finished_at_ms,failure_code) VALUES(?,?,?,?,?,?,?,?)')
        .run('attempt-1','work-1',1,hex,'succeeded',10,20,null);
      prepare('INSERT INTO fx_workflow_plans(plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)')
        .run('plan-empty','attempt-1','planner',1,hex,hex,hex,'no_effect_required',11);
    });
    const reader=createExecutionProgressProjectionReader({schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel})});
    const rows=reader.read(['run-1'],{includePlans:true});
    assert.equal(rows.length,1);
    assert.deepEqual(rows[0].plans,[{planId:'plan-empty',plannerRef:'planner',plannerVersion:1,state:'no_effect_required',createdAtMs:11,edges:[]}]);
    assert.deepEqual(rows[0].events,[]);
    assert.equal(projectPlans(rows)[0].state,'completed');
    const lightweight=reader.read(['run-1']);
    assert.equal(Object.hasOwn(lightweight[0],'plans'),false);
  } finally { kernel.close(); fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50}); }
});
