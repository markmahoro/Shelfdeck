'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const Database=require('better-sqlite3');
const {buildFormationProcessDetail,currentPlanSummary,projectPlans}=require('../src/helix/domains/libra/application/formation-process-projection');
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
function candidateEvent(planId,unitId,candidatePackageId,createdAtMs=1) {
  return event(planId,'publication','procurement.candidate.publish@1','succeeded',createdAtMs,[],{
    inputBindings:{bindings:[{bindingKind:'projected_owner_facts',parameters:{unitId}}]},
    result:{outcomeKind:'succeeded',result:{candidatePackageId}},
  });
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

test('Formation process projection treats a completed compliance check as completed and names each media Plan by its work',()=>{
  const earlier=Array.from({length:10},(_value,index)=>{
    const item=work('libra','libra_run','run-1','product_identity',[
      event(`plan-${index+1}`,'identity','libra.product_identity.resolve@1','succeeded',index+1,[],{
        result:{outcomeKind:'succeeded',result:{result:'resolved'}},
      }),
    ]);
    item.workId=`work-${index+1}`; item.state='succeeded'; return item;
  });
  const media=[
    work('libra','libra_run','run-1','workspace_media_production',[
      event('plan-11','probe','shared.material.media.probe@1','succeeded',11,[],{
        result:{outcomeKind:'succeeded',result:{resultKind:'probed',sizeBytes:10773491271}},
      }),
    ]),
    work('libra','libra_run','run-1','workspace_media_production',[
      event('plan-12','verify','libra.product_media.verify@1','succeeded',12,[],{
        result:{outcomeKind:'succeeded',result:{result:'failed',reasonCodes:['max_size_exceeded'],
          spaceSummary:{actualSizeBytes:10773491271,maxSizeBytes:8589934592,withinLimit:false}}},
      }),
      event('plan-12','select','libra.product_output.select@1','succeeded',12,[],{
        result:{outcomeKind:'succeeded',result:{result:'not_selected'}},
      }),
    ]),
    work('libra','libra_run','run-1','workspace_media_production',[
      event('plan-13','verify-input','libra.transcode.input.verify@1','succeeded',13,[],{
        result:{outcomeKind:'succeeded',result:{result:'passed'}},
      }),
    ]),
    work('libra','libra_run','run-1','workspace_media_production',[
      event('plan-14','transcode','libra.media.transcode@1','waiting_for_resource',14),
      event('plan-14','probe-output','shared.material.media.probe@1','pending',14),
      event('plan-14','verify-output','libra.product_media.verify@1','pending',14),
      event('plan-14','select-output','libra.product_output.select@1','pending',14),
    ]),
  ];
  media.forEach((item,index)=>{item.workId=`media-work-${index+11}`;item.state=index===3?'running':'succeeded';});
  const detail=buildFormationProcessDetail({displayIdentity:'冰血暴 (1996)',works:[...earlier,...media],
    procurementScopes:[],libraScopes:[{processType:'libra_run',processId:'run-1'}],arcaScopes:[]});
  const plans=detail.stages[1].plans;
  assert.deepEqual(plans.slice(10).map((plan)=>plan.title),[
    '读取原始媒体信息','判断原片是否可以直接使用','确认视频处理方式','处理媒体文件',
  ]);
  assert.equal(plans[11].state,'completed');
  assert.ok(plans[11].nodes.every((node)=>node.state==='completed'));
  assert.deepEqual(plans[11].nodes.find((node)=>node.nodeId==='verify').results.slice(0,4),[
    {label:'检查结果',value:'未通过'},
    {label:'文件大小',value:'10.0 GiB'},
    {label:'收藏上限',value:'8.00 GiB'},
    {label:'核对说明',value:'文件超过收藏架允许的大小'},
  ]);
  assert.deepEqual(currentPlanSummary(detail),{
    stageKey:'media_organization',planId:'plan-14',planNumber:14,title:'处理媒体文件',
    label:'计划14 处理媒体文件',state:'running',statusText:'等待处理资源',progress:null,
  });
});

test('Formation process card receives only actual Plans from exact domain process scopes',()=>{
  const works=[
    work('procurement','procurement_run','proc-1','candidate_assembly',[candidateEvent('proc-plan','unit-1','candidate-1',1)]),
    work('procurement','procurement_run','another-run','candidate_assembly',[event('wrong-plan','publish','procurement.candidate.publish@1','succeeded',2)]),
    work('libra','libra_routing','subject-1','routing_basis',[event('libra-plan','route','libra.decision_basis.commit@1','succeeded',3)]),
    work('arca','arca_acceptance','offer-1','acceptance_assessment',[event('arca-plan','identity','arca.acceptance.identity.verify@1','pending',4)]),
  ];
  const detail=buildFormationProcessDetail({displayIdentity:'示例电影',targetShelfName:'电影',works,
    procurementScopes:[{processType:'procurement_run',processId:'proc-1',structureUnitId:'unit-1',candidatePackageId:'candidate-1'}],
    libraScopes:[{processType:'libra_routing',processId:'subject-1'}],
    arcaScopes:[{processType:'arca_acceptance',processId:'offer-1'}]});
  assert.equal(detail.contract,'formation_process_actual_plans@1');
  assert.deepEqual(detail.stages.map((stage)=>stage.plans.map((plan)=>plan.planId)),[['proc-plan'],['libra-plan'],['arca-plan']]);
  assert.ok(!JSON.stringify(detail).includes('wrong-plan'));
});

test('Formation process stage follows the active successor instead of an earlier failed Work',()=>{
  const failed=work('arca','arca_ondeck_run','on-deck-1','on_deck_execution',[
    event('arca-plan-1','slot-old','arca.inventory.target_slot.prepare@1','failed',10),
  ]);
  failed.workId='work-on-deck-old'; failed.state='failed'; failed.createdAtMs=10;
  const running=work('arca','arca_ondeck_run','on-deck-1','on_deck_execution',[
    event('arca-plan-2','slot-current','arca.inventory.target_slot.prepare@1','executing',20),
  ]);
  running.workId='work-on-deck-current'; running.state='running'; running.createdAtMs=20;
  const detail=buildFormationProcessDetail({displayIdentity:'罪人 (2025)',works:[failed,running],
    procurementScopes:[],libraScopes:[],arcaScopes:[{processType:'arca_ondeck_run',processId:'on-deck-1'}]});
  const shelving=detail.stages.find((stage)=>stage.key==='acceptance_shelving');
  assert.equal(shelving.state,'running');
  assert.equal(shelving.summary,'计划2正在进行');
  assert.deepEqual(shelving.plans.map((plan)=>plan.state),['attention','running']);
});

test('Formation process card excludes hundreds of Field-wide Plans outside the accepted Candidate binding',()=>{
  const runId='procurement-run-shared',unitId='a'.repeat(64),candidatePackageId='candidate-package-subject';
  const works=Array.from({length:1000},(_value,index)=>work('procurement','procurement_run',runId,
    'candidate_assembly',[candidateEvent(`unrelated-plan-${index}`,String(index).padStart(64,'0'),`candidate-${index}`,index+1)]));
  works.push(work('procurement','procurement_run',runId,'candidate_assembly',[
    candidateEvent('subject-plan',unitId,candidatePackageId,2000),
  ]));
  works.push(work('procurement','procurement_run',runId,'candidate_assembly',[
    candidateEvent('package-only-match','b'.repeat(64),candidatePackageId,2001),
  ]));
  works.push(work('procurement','procurement_run',runId,'candidate_assembly',[
    candidateEvent('unit-only-match',unitId,'another-candidate-package',2002),
  ]));
  const splitPackage=candidateEvent('cross-event-match','c'.repeat(64),candidatePackageId,2003);
  const splitUnit=event('cross-event-match','identity','procurement.triage.identity_claim.resolve@1','succeeded',2003,[],{
    inputBindings:{bindings:[{bindingKind:'projected_owner_facts',parameters:{unitId}}]},
  });
  works.push(work('procurement','procurement_run',runId,'candidate_assembly',[splitPackage,splitUnit]));
  works.push(work('procurement','procurement_run',runId,'evidence_assessment',[
    event('field-evidence-plan','probe','shared.material.media.probe@1','succeeded',0),
  ]));
  const detail=buildFormationProcessDetail({displayIdentity:'罪人 (2025)',works,
    procurementScopes:[{processType:'procurement_run',processId:runId,structureUnitId:unitId,candidatePackageId}],
    libraScopes:[],arcaScopes:[]});
  assert.deepEqual(detail.stages[0].plans.map((plan)=>plan.planId),['subject-plan']);
  assert.ok(Buffer.byteLength(JSON.stringify(detail))<10_000);
  assert.ok(!JSON.stringify(detail).includes('field-evidence-plan'));
  assert.ok(!JSON.stringify(detail).includes('unrelated-plan-'));
  assert.ok(!JSON.stringify(detail).includes('package-only-match'));
  assert.ok(!JSON.stringify(detail).includes('unit-only-match'));
  assert.ok(!JSON.stringify(detail).includes('cross-event-match'));
});

test('Formation Candidate scope keeps strict single-field matching on the publish Event',()=>{
  const workItem=work('procurement','procurement_run','run-single','candidate_assembly',[
    candidateEvent('single-field-plan','unit-single','candidate-single',1),
  ]);
  const byPackage=buildFormationProcessDetail({displayIdentity:'示例',works:[workItem],
    procurementScopes:[{processType:'procurement_run',processId:'run-single',candidatePackageId:'candidate-single'}],
    libraScopes:[],arcaScopes:[]});
  const byUnit=buildFormationProcessDetail({displayIdentity:'示例',works:[workItem],
    procurementScopes:[{processType:'procurement_run',processId:'run-single',structureUnitId:'unit-single'}],
    libraScopes:[],arcaScopes:[]});
  assert.deepEqual(byPackage.stages[0].plans.map((plan)=>plan.planId),['single-field-plan']);
  assert.deepEqual(byUnit.stages[0].plans.map((plan)=>plan.planId),['single-field-plan']);
});

test('Formation frontend renders backend Plans without an organizingSteps Plan fallback',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../web/src/helix/FormationPage.tsx'),'utf8');
  const processDetail=source.slice(source.indexOf('function ProcessDetail'),source.indexOf('export default function FormationPage'));
  const mediaRow=source.slice(source.indexOf('function MediaRow'));
  assert.match(processDetail,/detail\.stages\.map/);
  assert.doesNotMatch(processDetail,/organizingSteps|mediaOrganization\.steps|ChecklistSteps/);
  assert.match(processDetail,/页面不会根据状态推测或补造计划/);
  assert.match(mediaRow,/currentProgressLabel\(item\)/);
  assert.doesNotMatch(mediaRow,/organizingSteps/);
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
