'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const Database=require('better-sqlite3');
const {buildFormationProcessDetail,currentPlanSummary,projectPlans}=require('../src/helix/domains/libra/application/formation-process-projection');
const {createFormationProjectionSource}=require('../src/helix/domains/libra/application/formation-query');
const {createExecutionProgressProjectionReader}=require('../src/helix/foundation/execution/progress-projection-reader');
const {canonicalDigest,canonicalJson}=require('../src/helix/contracts/canonical-json');
const {openSqliteKernel}=require('../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot=path.resolve(__dirname,'../src/helix/foundation/persistence/generated');
const schemaDdl=fs.readFileSync(path.join(generatedRoot,'clean-schema.sql'),'utf8');
const schemaManifest=JSON.parse(fs.readFileSync(path.join(generatedRoot,'clean-schema.manifest.json'),'utf8'));
const hex='a'.repeat(64);

test('UAT-320 missing routing policy is actionable before a Decision or Run exists and clears after publication',()=>{
  const subject={subject_id:'series-subject',status:'active',structure_kind:'season',content_profile:'series',
    routing_anchor_intake_decision_id:'intake',current_identity_revision:null,created_at_ms:1};
  const rows={find_decisions:[{target_subject_id:subject.subject_id,intake_decision_id:'intake',
    source_field_id:'series-field',decided_at_ms:1,candidate_delivery_snapshot_json:canonicalJson({candidatePackage:{displayIdentity:'Season 2'}})}]};
  const calls=[];
  const unitOfWork={execute(participants){return Object.fromEntries(participants.map(participant=>[participant.participantId,
    participant.execute({repository:()=>({invoke(name,args){calls.push({name,args});return rows[name]||[];}})})]));}};
  const source=createFormationProjectionSource({schemaManifest,unitOfWork});
  const missing=source.buildBatch([subject],{includeProcessSummary:true})[0];
  assert.equal(missing.classification,'attention_required');
  assert.equal(missing.routingState,'unresolved');
  assert.equal(missing.unresolvedReasonCode,'routing_policy_unavailable');
  assert.equal(missing.routingConfigurationFieldId,'series-field');
  assert.equal(missing.currentRun,null);
  assert.equal(missing.routingDecisionHeadDigest,null);
  assert.equal(missing.nextAction.label,'尚未配置收藏去向');
  assert.equal(missing.currentPlan,undefined);
  assert.equal(calls.filter(call=>call.name==='find_field_routing_heads').length,1);
  assert.deepEqual(calls.find(call=>call.name==='find_field_routing_heads').args.values,['series-field']);
  assert.ok(calls.every(call=>call.name.startsWith('find_')),'Projection must only read');
  rows.find_field_routing_heads=[{field_id:'series-field',current_routing_policy_id:'policy'}];
  const ready=source.buildBatch([subject])[0];
  assert.equal(ready.classification,'in_progress');
  assert.equal(ready.routingState,'preparing');
  assert.equal(ready.routingConfigurationFieldId,null);
  assert.equal(ready.unresolvedReasonCode,null);
  assert.equal(ready.currentRun,null,'Reading readiness must not create a Run');
  rows.find_routing_decisions=[{subject_id:subject.subject_id,decision_revision:1,decision:'resolved',shelf_id:'shelf'}];
  rows.find_field_routing_heads=[];
  assert.equal(source.buildBatch([subject])[0].classification,'in_progress','Frozen Decision is not reinterpreted');
});

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
function businessStageStates(overrides={}) {
  return {materialPreparation:'completed',mediaOrganization:'in_progress',acceptanceShelving:'not_started',...overrides};
}

test('Formation list keeps the same current plan without fetching the completed Procurement history',()=>{
  const subject={subject_id:'subject-1',status:'active',structure_kind:'single',content_profile:'movie',routing_anchor_intake_decision_id:'intake-1',created_at_ms:1};
  const rows={find_decisions:[{target_subject_id:'subject-1',intake_decision_id:'intake-1',decided_at_ms:1,
    candidate_delivery_snapshot_json:canonicalJson({candidatePackage:{procurementRunId:'procurement-heavy',candidatePackageId:'candidate-1',structureEvidenceRef:{unitId:'unit-1'}}})}],
    find_runs:[{subject_id:'subject-1',libra_run_id:'run-1',state:'active',state_revision:1,created_at_ms:2}]};
  const unitOfWork={execute(participants){return Object.fromEntries(participants.map(participant=>[participant.participantId,
    participant.execute({repository:()=>({invoke:name=>rows[name]||[]})})]));}};
  const works=[work('procurement','procurement_run','procurement-heavy','candidate_assembly',[candidateEvent('candidate-plan','unit-1','candidate-1')]),
    work('libra','libra_run','run-1','workspace_media_production',[event('current-plan','transcode','libra.media.transcode@1','executing',2)])];
  const reads=[],source=createFormationProjectionSource({schemaManifest,unitOfWork,progressProjectionReader:{read(ids){reads.push([...ids]);return works.filter(item=>ids.includes(item.processId));}}});
  const full=source.buildBatch([subject],{includeProcessDetail:true})[0];
  assert.ok(reads.some(ids=>ids.includes('procurement-heavy')));
  reads.length=0;
  const listed=source.buildBatch([subject],{includeProcessSummary:true})[0];
  assert.ok(reads.every(ids=>!ids.includes('procurement-heavy')));
  assert.equal(reads.length,1);
  assert.ok(full.currentPlan);
  assert.deepEqual(listed.currentPlan,full.currentPlan);
  assert.deepEqual(listed.currentRun,full.currentRun);
  assert.equal(listed.processDetail,undefined);
  assert.equal(full.processDetail.stages[0].plans.length,1);
});

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

test('Formation process projection omits absent zero-valued media size facts',()=>{
  const plans=projectPlans([work('libra','libra_run','run-zero','workspace_media_production',[
    event('plan-zero','verify','libra.product_media.verify@1','succeeded',1,[],{
      result:{outcomeKind:'succeeded',result:{result:'passed',sizeBytes:0,
        spaceSummary:{actualSizeBytes:0,maxSizeBytes:0,withinLimit:true}}},
    }),
  ])]);
  assert.deepEqual(plans[0].nodes[0].results,[{label:'检查结果',value:'通过'}]);
});

test('Formation process projection keeps internal receipt enums behind stable user language',()=>{
  const receipts=[
    ['procurement.candidate.publish@1','procurement_candidate_published','待整理材料包已发布'],
    ['libra.intake.binding.resolve@1','libra_binding_draft_resolved','整理材料已确认'],
    ['libra.intake.accept.commit@1','handoff_a_accepted','媒体整理已正式接收'],
  ];
  for (const [capabilityRef,receiptKind,copy] of receipts) {
    const plans=projectPlans([work('libra','libra_intake','intake-user-copy',capabilityRef,[
      event('plan-user-copy','commit',capabilityRef,'succeeded',1,[],{
        result:{outcomeKind:'succeeded',result:{receiptKind}},
      }),
    ])]);
    assert.deepEqual(plans[0].nodes[0].results,[{label:'运行结果',value:copy}]);
    assert.equal(JSON.stringify(plans).includes(receiptKind),false);
    assert.equal(JSON.stringify(plans).includes(receiptKind.replaceAll('_',' ')),false);
  }
  const unknown=projectPlans([work('libra','libra_intake','intake-opaque','evidence',[
    event('plan-opaque','commit','libra.intake.accept.commit@1','succeeded',1,[],{
      result:{outcomeKind:'succeeded',result:{receiptKind:'internal_future_receipt'}},
    }),
  ])]);
  assert.deepEqual(unknown[0].nodes[0].results,[{label:'保存结果',value:'本步骤的实际运行结果已保存'}]);
  assert.equal(JSON.stringify(unknown).includes('internal future receipt'),false);
});

test('Formation process projection renders structured resolved identity as title and year',()=>{
  const resolved=projectPlans([work('libra','libra_run','identity-structured','product_identity',[
    event('plan-identity-structured','product_identity_resolution','libra.product_identity.resolve@1','succeeded',1,[],{
      result:{outcomeKind:'succeeded',result:{
        schemaRef:'helix://contracts/types/ResolvedProductIdentity/v1',
        displayIdentity:{recordKind:'display-identity',entries:[
          {key:'original_title',value:'RED 2'},{key:'title',value:'赤焰战场2'},{key:'year',value:'2013'},
        ]},
      }},
    }),
  ])]);
  assert.deepEqual(resolved[0].nodes[0].results,[{label:'获得的信息',value:'赤焰战场2（2013）'}]);
  assert.equal(JSON.stringify(resolved).includes('[object Object]'),false);

  const opaque=projectPlans([work('libra','libra_run','identity-opaque','product_identity',[
    event('plan-identity-opaque','product_identity_resolution','libra.product_identity.resolve@1','succeeded',1,[],{
      result:{outcomeKind:'succeeded',result:{displayIdentity:{unexpected:'opaque'},result:'resolved'}},
    }),
  ])]);
  assert.deepEqual(opaque[0].nodes[0].results,[{label:'运行结果',value:'已确认'}]);
  assert.equal(JSON.stringify(opaque).includes('[object Object]'),false);
});

test('Formation process projection distinguishes repeated Plan nodes without inventing media identity',()=>{
  const settlements=Array.from({length:5},(_value,index)=>event('plan-settlement',
    `input_settlement_${String(index).padStart(4,'0')}`,'arca.ondeck.input_settlement.delete@1','pending',1,[],{
      inputBindings:{bindings:[{bindingKind:'projected_owner_facts',parameters:{materialKey:`opaque-material-${index}`}}]},
    }));
  const plans=projectPlans([work('arca','arca_ondeck_run','on-deck-repeat','on_deck_execution',settlements)]);
  assert.deepEqual(plans[0].nodes.map((node)=>node.label),[
    '处理原有输入（第 1 项）','处理原有输入（第 2 项）','处理原有输入（第 3 项）',
    '处理原有输入（第 4 项）','处理原有输入（第 5 项）',
  ]);
  assert.equal(JSON.stringify(plans).includes('opaque-material-'),false);
});

test('Formation process projection explains persisted settlement action and failed Attempt evidence',()=>{
  const completed=event('plan-settlement-result','settled','arca.ondeck.input_settlement.delete@1','succeeded',1,[],{
    result:{outcomeKind:'succeeded',result:{postDeleteReality:{entries:[
      {key:'absent',value:true},{key:'disposition',value:'settled_to_final'},
      {key:'old_directory_disposition',value:'retained_directory'},
    ]}}},
  });
  const failed=event('plan-settlement-failed','failed','arca.ondeck.input_settlement.delete@1','failed',2,[],{
    failure:{outcomeKind:'failed',failureClass:'permanent',
      failureCode:'CLEAN_ARCA_SETTLEMENT_UNKNOWN_MEMBER',attemptOrdinal:1},
  });
  const completedNode=projectPlans([work('arca','arca_ondeck_run','on-deck-result','on_deck_execution',[completed])])[0].nodes[0];
  assert.equal(completedNode.label,'移除已完成替换的原有输入');
  assert.deepEqual(completedNode.results,[
    {label:'处理结果',value:'原有输入已移除，最终文件已确认'},
    {label:'原目录',value:'原目录保留，仅清理本次授权文件'},
  ]);
  const failedNode=projectPlans([work('arca','arca_ondeck_run','on-deck-failed','on_deck_execution',[failed])])[0].nodes[0];
  assert.equal(failedNode.description,'这一步没有完成：原文件所在目录中出现了本次计划没有包含的文件。');
  assert.deepEqual(failedNode.results,[
    {label:'失败原因',value:'原文件所在目录中出现了本次计划没有包含的文件'},
    {label:'失败代码',value:'CLEAN_ARCA_SETTLEMENT_UNKNOWN_MEMBER'},
  ]);
});

test('Formation process projection explains staged and final NFO semantic drift without inventing field differences',()=>{
  for (const [code,message] of [
    ['CLEAN_ARCA_STAGED_NFO_SEMANTIC_DRIFT','暂存位置中的 NFO 内容与本次已接受的媒体信息不一致'],
    ['CLEAN_ARCA_FINAL_NFO_SEMANTIC_DRIFT','正式位置中的 NFO 内容与本次已接受的媒体信息不一致'],
  ]) {
    const failed=event('plan-nfo-failed',code,'arca.inventory.final_product.verify@1','failed',1,[],{
      failure:{outcomeKind:'failed',failureClass:'permanent',failureCode:code,attemptOrdinal:1},
    });
    const node=projectPlans([work('arca','arca_ondeck_run','on-deck-nfo','on_deck_execution',[failed])])[0].nodes[0];
    assert.equal(node.description,'这一步没有完成：'+message+'。');
    assert.deepEqual(node.results,[
      {label:'失败原因',value:message},
      {label:'失败代码',value:code},
    ]);
    assert.equal(JSON.stringify(node).includes('director'),false);
    assert.equal(JSON.stringify(node).includes('plot'),false);
  }
});

test('Formation explains a known media tool failure without inventing a safety or identity diagnosis',()=>{
  const failed=event('plan-media-failed','assess','libra.media.transcode_input.verify@1','failed',1,[],{
    failure:{outcomeKind:'failed',failureClass:'permanent',failureCode:'LIBRA_MEDIA_FFMPEG_FAILED',attemptOrdinal:1},
  });
  const node=projectPlans([work('libra','libra_run','run-1','workspace_media_production',[failed])])[0].nodes[0];
  assert.ok(node.results.some(item=>item.label==='失败原因'&&item.value==='视频处理工具执行失败'));
  assert.doesNotMatch(node.description,/没有保存|安全|身份/);
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
    businessStageStates:businessStageStates(),
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
    label:'处理视频文件',state:'running',statusText:'等待处理资源',progress:null,
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
    businessStageStates:businessStageStates({acceptanceShelving:'in_progress'}),
    procurementScopes:[{processType:'procurement_run',processId:'proc-1',structureUnitId:'unit-1',candidatePackageId:'candidate-1'}],
    libraScopes:[{processType:'libra_routing',processId:'subject-1'}],
    arcaScopes:[{processType:'arca_acceptance',processId:'offer-1'}]});
  assert.equal(detail.contract,'formation_process_actual_plans@1');
  assert.deepEqual(detail.stages.map((stage)=>stage.plans.map((plan)=>plan.planId)),[['proc-plan'],['libra-plan'],['arca-plan']]);
  assert.ok(!JSON.stringify(detail).includes('wrong-plan'));
});

test('Formation business stage does not complete merely because every currently existing Plan is terminal',()=>{
  const intake=work('libra','libra_intake','intake-preparing','acceptance',[
    event('intake-plan','accept','libra.intake.accept.commit@1','succeeded',1,[],{
      result:{outcomeKind:'succeeded',result:{receiptKind:'handoff_a_accepted'}},
    }),
  ]);
  intake.state='succeeded';
  const input={displayIdentity:'地狱为何恶劣 (2013)',works:[intake],
    procurementScopes:[],libraScopes:[{processType:'libra_intake',processId:'intake-preparing'}],arcaScopes:[]};
  const preparing=buildFormationProcessDetail({...input,businessStageStates:businessStageStates()});
  const organization=preparing.stages.find((stage)=>stage.key==='media_organization');
  assert.equal(organization.state,'running');
  assert.equal(organization.summary,'已有 1 个实际计划完成，等待本阶段继续推进');
  assert.equal(currentPlanSummary(preparing).state,'completed');
  assert.equal(currentPlanSummary(preparing).label,'接收整理材料');

  const accepted=buildFormationProcessDetail({...input,businessStageStates:businessStageStates({mediaOrganization:'completed'})});
  assert.equal(accepted.stages.find((stage)=>stage.key==='media_organization').state,'completed');
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
    businessStageStates:businessStageStates({mediaOrganization:'completed',acceptanceShelving:'in_progress'}),
    procurementScopes:[],libraScopes:[],arcaScopes:[{processType:'arca_ondeck_run',processId:'on-deck-1'}]});
  const shelving=detail.stages.find((stage)=>stage.key==='acceptance_shelving');
  assert.equal(shelving.state,'running');
  assert.equal(shelving.summary,'计划2正在进行');
  assert.deepEqual(shelving.plans.map((plan)=>plan.state),['attention','running']);
});

test('Formation current Plan follows a completed successor while preserving an earlier failed Plan',()=>{
  const failed=work('arca','arca_ondeck_run','on-deck-completed','on_deck_execution',[
    event('arca-plan-failed','slot-failed','arca.inventory.product.stage@1','failed',10),
  ]);
  failed.workId='work-on-deck-failed'; failed.state='failed'; failed.createdAtMs=10;
  const succeeded=work('arca','arca_ondeck_run','on-deck-completed','on_deck_execution',[
    event('arca-plan-succeeded','commit','arca.ondeck.commit@1','succeeded',20,[],{
      result:{outcomeKind:'succeeded',result:{result:'succeeded'}},
    }),
  ]);
  succeeded.workId='work-on-deck-succeeded'; succeeded.state='succeeded'; succeeded.createdAtMs=20;
  const detail=buildFormationProcessDetail({displayIdentity:'完成示例',works:[failed,succeeded],
    businessStageStates:businessStageStates({mediaOrganization:'completed',acceptanceShelving:'completed'}),
    procurementScopes:[],libraScopes:[],arcaScopes:[{processType:'arca_ondeck_run',processId:'on-deck-completed'}]});
  const shelving=detail.stages.find((stage)=>stage.key==='acceptance_shelving');
  assert.equal(shelving.state,'completed');
  assert.deepEqual(shelving.plans.map((plan)=>plan.state),['attention','completed']);
  assert.deepEqual(currentPlanSummary(detail),{
    stageKey:'acceptance_shelving',planId:'arca-plan-succeeded',planNumber:2,title:'将媒体写入收藏架',
    label:'完成上架',state:'completed',statusText:'已完成',progress:null,
  });
});

test('Formation current Plan keeps an unresolved failed Work as attention when no successor exists',()=>{
  const failed=work('arca','arca_ondeck_run','on-deck-attention','on_deck_execution',[
    event('arca-plan-attention','stage','arca.inventory.product.stage@1','failed',10),
  ]);
  failed.workId='work-on-deck-attention'; failed.state='failed'; failed.createdAtMs=10;
  const detail=buildFormationProcessDetail({displayIdentity:'待处理示例',works:[failed],
    businessStageStates:businessStageStates({mediaOrganization:'completed',acceptanceShelving:'attention'}),
    procurementScopes:[],libraScopes:[],arcaScopes:[{processType:'arca_ondeck_run',processId:'on-deck-attention'}]});
  const shelving=detail.stages.find((stage)=>stage.key==='acceptance_shelving');
  assert.equal(shelving.state,'attention');
  assert.deepEqual(currentPlanSummary(detail),{
    stageKey:'acceptance_shelving',planId:'arca-plan-attention',planNumber:1,title:'将媒体写入收藏架',
    label:'写入媒体产品',state:'attention',statusText:'执行失败',progress:null,
  });
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
    businessStageStates:businessStageStates(),
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
    businessStageStates:businessStageStates(),
    procurementScopes:[{processType:'procurement_run',processId:'run-single',candidatePackageId:'candidate-single'}],
    libraScopes:[],arcaScopes:[]});
  const byUnit=buildFormationProcessDetail({displayIdentity:'示例',works:[workItem],
    businessStageStates:businessStageStates(),
    procurementScopes:[{processType:'procurement_run',processId:'run-single',structureUnitId:'unit-single'}],
    libraScopes:[],arcaScopes:[]});
  assert.deepEqual(byPackage.stages[0].plans.map((plan)=>plan.planId),['single-field-plan']);
  assert.deepEqual(byUnit.stages[0].plans.map((plan)=>plan.planId),['single-field-plan']);
});

test('Formation frontend renders backend Plans without an organizingSteps Plan fallback',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../web/src/helix/FormationPage.tsx'),'utf8');
  const processDetail=source.slice(source.indexOf('function ProcessDetail'),source.indexOf('export default function FormationPage'));
  const mediaRow=source.slice(source.indexOf('function MediaRow'));
  const shared=fs.readFileSync(path.resolve(__dirname,'../web/src/helix/ProcessStages.tsx'),'utf8');
  assert.match(processDetail,/ProcessStages stages=\{detail.stages\}/);
  assert.match(shared,/stages\.map/);
  assert.doesNotMatch(processDetail,/organizingSteps|mediaOrganization\.steps|ChecklistSteps/);
  assert.match(processDetail,/detail\?\.contract==='formation_process_actual_plans@1'/);
  assert.match(processDetail,/整理计划暂不可用/);
  assert.match(mediaRow,/currentProgressLabel\(item\)/);
  assert.match(source,/progressDetail\(item\.currentPlan\.progress\)/);
  assert.match(shared,/MiB\/s/);
  assert.match(shared,/预计 \$\{minutes\} 分钟/);
  assert.doesNotMatch(mediaRow,/organizingSteps/);
});

test('Formation download Plan uses real external progress and user-facing zero-speed copy',()=>{
  const download=work('libra','libra_run','run-download','workspace_media_production',[
    event('plan-download','observe','libra.external_material.acquire.observe@1','waiting_for_external',1,[],{
      progress:{mode:'determinate',currentValue:0,totalValue:100,unit:'percent',rate:0,etaMs:null,bucket:'download-0'},
    }),
  ]);
  const plan=projectPlans([download])[0];
  assert.equal(plan.title,'下载外部媒体');
  assert.equal(plan.nodes[0].label,'下载媒体文件');
  assert.equal(plan.nodes[0].statusText,'等待下载数据');
  assert.equal(plan.nodes[0].description,'下载任务已经提交，正在等待来源提供数据。');
  assert.equal(plan.nodes[0].progress.currentValue,0);
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

test('execution progress reader reads exact Work and current progress heads alongside the latest failed Attempt',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'formation-failure-reader-')),databasePath=path.join(root,'shelfdeck.db');
  const sqlTrace=[];
  function TracedDatabase(filename){return new Database(filename,{verbose:sql=>sqlTrace.push(sql)});}
  const kernel=openSqliteKernel({Database:TracedDatabase,databasePath,schemaDdl,schemaManifest,now:()=>100});
  try {
    const inputBindings=canonicalJson({schemaRef:'helix://foundation/types/EventInputBindingSet/v1',bindings:[]});
    const parameters=canonicalJson({});
    kernel.runPrimitive(({prepare})=>{
      prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,definition_schema_ref,definition_json,definition_digest,state,idempotency_key,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run('work-failed','arca','arca_ondeck_run','on-deck-failed','on_deck_execution',hex,'normal','work','{}',hex,'failed','key-failed',10,20);
      prepare('INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,basis_digest,state,started_at_ms,finished_at_ms,failure_code) VALUES(?,?,?,?,?,?,?,?)')
        .run('attempt-failed','work-failed',1,hex,'failed',10,20,'CLEAN_ARCA_SETTLEMENT_UNKNOWN_MEMBER');
      prepare('INSERT INTO fx_workflow_plans(plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)')
        .run('plan-failed','attempt-failed','planner',1,hex,hex,hex,'planned',11);
      prepare('INSERT INTO fx_plan_nodes(plan_id,node_id,capability_ref,contract_version,input_bindings_json,parameters_json) VALUES(?,?,?,?,?,?)')
        .run('plan-failed','settlement','arca.ondeck.input_settlement.delete@1',1,inputBindings,parameters);
      prepare('INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run('event-failed','plan-failed','settlement','work-failed','attempt-failed','arca','arca.ondeck.input_settlement.delete@1',1,'failed','normal');
      prepare('INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,state,outcome_kind,failure_class,failure_code,evidence_digest,started_at_ms,finished_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run('event-attempt-old','event-failed',1,'completed','failed','transient','OLD_FAILURE',canonicalDigest({failureCode:'OLD_FAILURE'}),12,13);
      prepare('INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,state,outcome_kind,failure_class,failure_code,evidence_digest,started_at_ms,finished_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run('event-attempt-latest','event-failed',2,'completed','failed','permanent','CLEAN_ARCA_SETTLEMENT_UNKNOWN_MEMBER',canonicalDigest({failureCode:'CLEAN_ARCA_SETTLEMENT_UNKNOWN_MEMBER'}),14,15);
      const sample=prepare('INSERT INTO fx_event_progress(event_id,event_attempt_id,revision,mode,current_value,total_value,unit,sampled_at_ms) VALUES(?,?,?,?,?,?,?,?)');
      for(let revision=1;revision<=5000;revision++)sample.run('event-failed','event-attempt-latest',revision,'determinate',revision,10000,'microseconds',revision);
      prepare('UPDATE fx_workflow_events SET current_progress_revision=? WHERE event_id=?').run(5000,'event-failed');
    });
    const reader=createExecutionProgressProjectionReader({schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel})});
    sqlTrace.length=0;
    assert.deepEqual(reader.read(['on-deck-failed'],{includePlans:true,workIds:[]}),[]);
    const rows=reader.read(['on-deck-failed'],{includePlans:true,workIds:['work-failed']});
    assert.equal(rows[0].events[0].progress.currentValue,5000);
    const samples=sqlTrace.filter(sql=>/^SELECT/i.test(sql)&&sql.includes('FROM "fx_event_progress"'));
    assert.equal(samples.length,1);assert.match(samples[0],/"revision"=5000/);
    assert.match(samples[0],/"event_id" IN/);
    assert.deepEqual(rows[0].events[0].failure,{
      outcomeKind:'failed',failureClass:'permanent',failureCode:'CLEAN_ARCA_SETTLEMENT_UNKNOWN_MEMBER',attemptOrdinal:2,
    });
    const projected=projectPlans(rows)[0].nodes[0];
    assert.equal(projected.description,'这一步没有完成：原文件所在目录中出现了本次计划没有包含的文件。');
    assert.deepEqual(projected.results.slice(-2),[
      {label:'失败原因',value:'原文件所在目录中出现了本次计划没有包含的文件'},
      {label:'失败代码',value:'CLEAN_ARCA_SETTLEMENT_UNKNOWN_MEMBER'},
    ]);
  } finally { kernel.close(); fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50}); }
});


test('Waiting and ready actions never describe execution before resources or approval are available',()=>{
  for (const capability of ['libra.media.transcode@1','libra.transcode.input.verify@1']) {
    for (const [state,description] of [
      ['waiting_for_resource','正在等待可用的处理资源，资源可用后继续这一步。'],
      ['waiting_for_approval','正在等待确认，确认后继续这一步。'],
      ['waiting_for_external','正在等待外部服务返回结果。'],
      ['ready','前置条件已满足，正在等待执行这一步。'],
    ]) {
      const node=projectPlans([work('libra','libra_run','run-wait','workspace_media_production',[
        event('plan-wait','action',capability,state,1),
      ])])[0].nodes[0];
      assert.equal(node.description,description,capability+':'+state);
    }
  }
});

test('list Result scope preserves the current action and headers while leaving full payloads to detail',()=>{
  const settlement='arca.ondeck.input_settlement.delete@1',metadata='libra.product_metadata.fetch@1';
  const payloads=[{event_id:'event-metadata',value:{plot:'x'.repeat(65536)}},
    {event_id:'event-settlement',value:{postDeleteReality:{entries:[{key:'disposition',value:'retained_as_final'}]}}}];
  const results=payloads.map(({event_id,value})=>({event_id,outcome_kind:'succeeded',result_schema_ref:'result',
    result_json:canonicalJson(value),result_digest:canonicalDigest(value),committed_at_ms:20}));
  const events=[metadata,settlement].map((capability_ref,index)=>({event_id:payloads[index].event_id,
    plan_id:'plan',node_id:index===0?'metadata':'settlement',work_id:'work',capability_ref,state:'succeeded'}));
  const rows={works:[{work_id:'work',owner_domain:'arca',process_type:'arca_ondeck_run',process_id:'run',
    work_kind:'on_deck_execution',state:'succeeded',created_at_ms:1,updated_at_ms:20}],
    attempts:[{attempt_id:'attempt',work_id:'work',ordinal:1}],events,plans:[{plan_id:'plan',attempt_id:'attempt',
      planner_ref:'planner',planner_version:1,state:'planned',created_at_ms:2}],
    nodes:events.map(event=>({...event,input_bindings_json:'{"bindings":[]}',parameters_json:'{}'})),
    edges:[{plan_id:'plan',from_node_id:'metadata',to_node_id:'settlement',dependency_kind:'success'}]};
  const reads=[];
  const unitOfWork={execute(parts){return Object.fromEntries(parts.map(part=>[part.participantId,part.execute({repository:()=>({invoke(name,parameters){
    reads.push({name,values:parameters.values});
    if(name==='results')return results.filter(row=>parameters.values.includes(row.event_id));
    if(name==='result_headers')return results.map(({result_json,...header})=>header);
    return rows[name]||[];
  }})})]));}};
  const reader=createExecutionProgressProjectionReader({schemaManifest,unitOfWork});
  const full=reader.read(['run'],{includePlans:true});reads.length=0;
  const listed=reader.read(['run'],{includePlans:true,resultCapabilityRefs:[settlement]});
  assert.deepEqual(reads.filter(read=>read.name==='results').map(read=>read.values),[['event-settlement']]);
  assert.equal(listed[0].events[0].result.result,null);
  assert.equal(listed[0].events[0].result.resultDigest,full[0].events[0].result.resultDigest);
  const detail=works=>buildFormationProcessDetail({displayIdentity:'Example',works,
    businessStageStates:businessStageStates({mediaOrganization:'completed',acceptanceShelving:'completed'}),
    procurementScopes:[],libraScopes:[],arcaScopes:[{processType:'arca_ondeck_run',processId:'run'}]});
  assert.deepEqual(currentPlanSummary(detail(listed)),currentPlanSummary(detail(full)));
  assert.equal(currentPlanSummary(detail(listed)).label,'保留原有输入作为最终文件');
  results[1].result_digest=hex;
  assert.throws(()=>reader.read(['run'],{includePlans:true,resultCapabilityRefs:[settlement]}),{code:'EXECUTION_PROGRESS_RESULT_INVALID'});
  assert.throws(()=>reader.read(['run'],{includePlans:true}),{code:'EXECUTION_PROGRESS_RESULT_INVALID'});
  assert.throws(()=>reader.read(['run'],{resultCapabilityRefs:'invalid'}),TypeError);
});


test('progress batches keep Work and Plan associations with linear event membership reads',()=>{
  const rows={works:[],attempts:[],plans:[],nodes:[],events:[],edges:[]};
  let membershipReads=0;
  for(let index=0;index<128;index++){
    const workId='work-'+index,attemptId='attempt-'+index,planId='plan-'+index;
    rows.works.push({work_id:workId,owner_domain:'libra',process_type:'libra_run',process_id:'run',
      work_kind:'source_media_observation',state:'running',created_at_ms:1,updated_at_ms:2});
    rows.attempts.push({attempt_id:attemptId,work_id:workId});
    rows.plans.push({plan_id:planId,attempt_id:attemptId,planner_ref:'planner',planner_version:1,state:'planned',created_at_ms:index});
    rows.edges.push({plan_id:planId,from_node_id:'probe',to_node_id:'verify',dependency_kind:'success'});
    for(const nodeId of ['probe','verify']){
      rows.nodes.push({plan_id:planId,node_id:nodeId,capability_ref:'shared.material.media.probe@1',
        input_bindings_json:canonicalJson({bindings:[]}),parameters_json:canonicalJson({index})});
      rows.events.push({event_id:planId+'-'+nodeId,plan_id:planId,node_id:nodeId,
        get work_id(){membershipReads++;return workId;},capability_ref:'shared.material.media.probe@1',state:'ready'});
    }
  }
  const unitOfWork={execute(parts){return Object.fromEntries(parts.map(part=>[part.participantId,
    part.execute({repository:()=>({invoke:name=>rows[name]||[]})})]));}};
  const reader=createExecutionProgressProjectionReader({schemaManifest,unitOfWork});
  const projected=reader.read(['run'],{includePlans:true});
  assert.equal(projected.length,128);
  for(let index=0;index<128;index++){
    const item=projected[index];
    assert.equal(item.workId,'work-'+index);
    assert.deepEqual(item.plans.map(plan=>plan.planId),['plan-'+index]);
    assert.deepEqual(item.events.map(event=>event.eventId),['plan-'+index+'-probe','plan-'+index+'-verify']);
    assert.equal(item.events[0].parameters.index,index);
    assert.deepEqual(item.plans[0].edges,[{fromNodeId:'probe',toNodeId:'verify',dependencyKind:'success'}]);
  }
  assert.ok(membershipReads<=rows.events.length*2,'Each event must not be rescanned for every Work.');
  rows.nodes.pop();
  assert.throws(()=>reader.read(['run'],{includePlans:true}),{code:'EXECUTION_PROGRESS_PLAN_INVALID'});
});

test('Formation Series delivery follows the selected frozen Run instead of the routing anchor',()=>{
  const subject={subject_id:'subject-series',status:'active',structure_kind:'season',content_profile:'series',routing_anchor_intake_decision_id:'old-intake',created_at_ms:1};
  const rows={find_runs:[{subject_id:subject.subject_id,libra_run_id:'old-run',state:'completed',created_at_ms:1},
    {subject_id:subject.subject_id,libra_run_id:'append-run',state:'active',created_at_ms:2}]};
  const unitOfWork={execute(participants){return Object.fromEntries(participants.map(p=>[p.participantId,
    p.execute({repository:()=>({invoke:name=>rows[name]||[]})})]));}};
  rows.find_decision_heads=[{subject_id:subject.subject_id,current_acceptance_spec_id:'spec'}];
  const specContract={contentProfile:'series',requirements:{space:{maxSizeGiB:0.75}}};
  rows.find_acceptance_specs=[{subject_id:subject.subject_id,acceptance_spec_id:'spec',spec_json:JSON.stringify(specContract)}];
  const reads=[];
  const season={claimKind:'explicit_number',seasonNumber:2};
  const snapshot={spec:{contentProfile:'series',structureKind:'season'},candidateIdentityClaim:{contentProfile:'series',claimKind:'series_season',seasonClaim:{...season,claimDigest:canonicalDigest(season)}},
    episodeClaims:[{episodeKey:'E003'},{episodeKey:'E005'}],members:[{role:'primary_payload'},{role:'primary_payload'},{role:'structural_dependency'}]};
  const source=createFormationProjectionSource({schemaManifest,unitOfWork,movieProductionReader:{readRunSnapshot(id){reads.push(id);return snapshot;}}});
  const item=source.buildBatch([subject],{includeProcessSummary:true})[0];
  assert.deepEqual(item.seriesDelivery,{libraRunId:'append-run',seasonNumber:2,episodeKeys:['E003','E005'],physicalFileCount:2});
  assert.deepEqual(reads,['append-run']);
  assert.equal(item.organizingRequirement,'每集不超过 0.75 GiB');
  specContract.contentProfile='movie';rows.find_acceptance_specs[0].spec_json=JSON.stringify(specContract);
  assert.equal(source.buildBatch([subject])[0].organizingRequirement,'不超过 0.75 GiB');
  rows.find_runs[1].state='completed';
  assert.deepEqual(source.buildBatch([subject],{includeProcessDetail:true})[0].seriesDelivery,item.seriesDelivery);
  snapshot.candidateIdentityClaim.seasonClaim.seasonNumber=3;
  assert.throws(()=>source.buildBatch([subject],{includeProcessDetail:true}),/exact frozen/);
  assert.equal(source.buildBatch([{...subject,content_profile:'movie'}],{includeProcessDetail:true})[0].seriesDelivery,null);
});
