'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { openSqliteKernel } = require('../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../src/helix/foundation/persistence/sqlite-unit-of-work');
const {
  actionLabel,
  buildFormationProjectionRow,
  classifyFormation,
  createFormationProjectionSource,
  createFormationQuery,
  extractAcquisitionSelection,
  extractProductIdentityIssue,
  frozenRunLabel,
  nextAction,
  organizingSteps,
  organizingWorks,
  projectionItem,
  shelvingSteps,
} = require('../src/helix/domains/libra/application/formation-query');
const { createFormationProjectionStore } = require('../src/helix/domains/libra/persistence/formation-projection-store');
const { formationProjectionDigest } = require('../src/helix/domains/libra/model/formation-projection-contract');
const { createFormationProjectionHost } = require('../src/helix/domains/libra/application/formation-projection-host');
const { plannedExecutionDeviceClass, projectedProgress } = require('../src/helix/foundation/execution/progress-projection-reader');
const { canonicalDigest, canonicalJson } = require('../src/helix/contracts/canonical-json');

const generatedRoot=path.resolve(__dirname,'../src/helix/foundation/persistence/generated');
const schemaDdl=fs.readFileSync(path.join(generatedRoot,'clean-schema.sql'),'utf8');
const schemaManifest=JSON.parse(fs.readFileSync(path.join(generatedRoot,'clean-schema.manifest.json'),'utf8'));
const hex=(value)=>String(value).padStart(64,'0').slice(-64);
function item(index,classification='in_progress',attention=false){return Object.freeze({
  formationViewId:`subject-${String(index).padStart(3,'0')}`,subjectId:`subject-${String(index).padStart(3,'0')}`,
  displayIdentity:`影片 ${index}`,contentProfile:'movie',structureKind:'single',status:'active',classification,
  myRating:index%5+1,myRatingSource:'douban',myRatingRevision:null,productIdentityIssue:attention?Object.freeze({result:'ambiguous',reasonCode:'multiple_matches',candidateSetDigest:hex(700+index),candidates:[]}):null,acceptanceRecovery:null,arcaStatus:classification==='completed'?Object.freeze({stage:'completed',completedAtMs:2500+index,shelfEntryId:`entry-${index}`}):null,
  targetShelfId:'shelf-1',targetShelfName:'movie test',routingState:'resolved',unresolvedReasonCode:null,routingPolicyMode:'direct',routingPolicyRevision:1,
  routingDecisionRevision:1,routingDecisionDigest:hex(100+index),routingDecisionHeadRevision:1,routingDecisionHeadDigest:hex(200+index),
  acceptanceSpecId:`spec-${index}`,acceptanceSpecRevision:1,acceptanceSpecDigest:hex(300+index),acceptanceSpecPublishedAtMs:1000+index,
  primaryMaterialCount:1,addedAtMs:1000+index,organizingRequirement:'保持原媒体并完成资料',organizingAction:'验证整理结果',
  organizingSteps:Object.freeze([{key:'verify',label:'验证整理结果',state:'done',progress:null}]),
  nextAction:Object.freeze({label:classification==='completed'?'已进入收藏架':'继续整理媒体',state:classification==='completed'?'completed':'pending',progress:null}),
  currentRun:Object.freeze({libraRunId:`run-${index}`,state:'active',stateRevision:1,stateDigest:hex(400+index),priorityClass:'normal',packageRevisionHead:classification==='completed'?1:0,currentIdentityRevision:1}),
  handoffB:classification==='completed'?Object.freeze({onDeckPackageId:`package-${index}`,offerId:`offer-${index}`,packageRevision:1,packageDigest:hex(500+index),state:'published',publishedAtMs:2000+index}):null,
  completedAtMs:classification==='completed'?2500+index:null,
});}

test('Formation extracts Product Identity issues from the business result contract',()=>{
  const conflicting={
    result:'conflicting',reasonCode:'provider_identity_conflicting',evidenceDigest:hex(900),
    candidates:[{candidateIdentityKey:'tmdb:movie:915935',title:'Anatomy of a Fall',year:2023}],
  };
  const works=[{events:[{
    capabilityRef:'libra.product_identity.evidence.observe@1',
    result:{
      resultSchemaRef:'helix://contracts/capabilities/libra.product_identity.evidence.observe/v1/result',
      committedAtMs:200,
      result:{schemaRef:'helix://contracts/types/ProductIdentityEvidenceObservation/v1',...conflicting},
    },
  }]}];
  assert.deepEqual(extractProductIdentityIssue(works),{
    result:'conflicting',reasonCode:'provider_identity_conflicting',candidateSetDigest:hex(900),
    candidates:conflicting.candidates,
  });
  assert.equal(extractProductIdentityIssue([{events:[{
    capabilityRef:'libra.product_identity.evidence.observe@1',
    result:{committedAtMs:300,result:{schemaRef:'helix://contracts/types/ProductIdentityEvidenceObservation/v1',result:'resolved'}},
  }]}]),null);
  assert.equal(extractProductIdentityIssue(works,{created_at_ms:200}),null,
    'A later or concurrent Product Identity selection intent retires the stale observation issue.');
  assert.equal(extractProductIdentityIssue(works,{created_at_ms:201}),null);
  assert.deepEqual(extractProductIdentityIssue(works,{created_at_ms:199}),{
    result:'conflicting',reasonCode:'provider_identity_conflicting',candidateSetDigest:hex(900),
    candidates:conflicting.candidates,
  });
});

test('one overview reads shared counts and active Owner facts once and refreshes the next request',()=>{
  const initial=[item(0),item(1,'attention_required'),item(2,'completed')];
  const rows=initial.map(value=>buildFormationProjectionRow(value,1000));
  const current=new Map(initial.map(value=>[value.subjectId,value]));
  let countReads=0,historyReads=0;const ownerReads=[];
  const store={
    counts(){countReads++;return ['in_progress','attention_required','completed'].map(group_value=>({group_value,row_count:1}));},
    listActiveScan(offset,limit){return rows.filter(row=>row.classification!=='completed').slice(offset,offset+limit);},
    listCompleted(offset,limit){return rows.filter(row=>row.classification==='completed').slice(offset,offset+limit);},
  };
  const query=createFormationQuery({store,historyStore:{count(){historyReads++;return 7;}},
    readPipelineSubjectIds:()=>new Set(initial.map(value=>value.subjectId)),
    detailSource:{getMany(ids){ownerReads.push([...ids]);return ids.map(id=>current.get(id));}},now:()=>2000});
  const first=query.overview();
  assert.deepEqual(first.summary,{totalCount:3,inProgressCount:1,attentionRequiredCount:1,completedCount:1,endedCount:7});
  assert.equal(first.attentionItems[0].subjectId,initial[1].subjectId);
  assert.equal(first.completedItems[0].subjectId,initial[2].subjectId);
  assert.equal(countReads,1,'Four overview sections share one grouped-count read.');
  assert.equal(historyReads,1);
  assert.equal(ownerReads.filter(ids=>ids.includes(initial[0].subjectId)).length,1,
    'The completed section must not rebuild the active population for its summary.');
  current.set(initial[0].subjectId,{...initial[0],classification:'attention_required',
    nextAction:{label:'Action required',state:'attention_required',progress:null}});
  const second=query.overview();
  assert.equal(second.summary.inProgressCount,0);
  assert.equal(second.summary.attentionRequiredCount,2);
  assert.equal(second.attentionItems.length,2);
  assert.equal(countReads,2,'A later request reads fresh Owner facts rather than a persistent cache.');
  assert.equal(historyReads,2);
});

test('Formation explains Handoff B rejection without prescribing discard and repeat',()=>{
  assert.equal(frozenRunLabel([], { blockedWorks:[{ failureCode:'handoff_b_rejected' }] }),
    '收藏架验收未通过，本次整理未完成，请查看具体原因');
  assert.equal(nextAction([], 'attention_required', null, 'frozen', null, null, null, null, false,
    { blockedWorks:[{ failureCode:'handoff_b_rejected' }] }).label,
    '收藏架验收未通过，本次整理未完成，请查看具体原因');
});

test('Formation explains a frozen external search that found no requirement-eligible candidate',()=>{
  const works=[{events:[{
    capabilityRef:'libra.external_material.candidate.select@1',
    result:{committedAtMs:200,result:{
      schemaRef:'helix://contracts/types/SelectedCandidate/v1',
      result:'not_selected',
      selectionReasonCode:'no_requirement_eligible_candidate',
    }},
  }]}];
  assert.equal(frozenRunLabel(works),'没有符合整理要求的外部候选，本次整理未完成，请查看可用操作');
  assert.equal(nextAction(works,'attention_required',null,'frozen',null,null,null).label,
    '没有符合整理要求的外部候选，本次整理未完成，请查看可用操作');
  assert.equal(frozenRunLabel([{events:[{
    capabilityRef:'libra.external_material.candidate.select@1',
    result:{committedAtMs:200,result:{
      schemaRef:'helix://contracts/types/SelectedCandidate/v1',
      result:'not_selected',
      selectionReasonCode:'no_available_candidate',
    }},
  }]}]),'没有找到可获取的外部候选，本次整理未完成，请查看可用操作');
});

test('Formation exposes only a proven compliant MoviePilot selection',()=>{
  const selection={schemaRef:'helix://contracts/types/SelectedCandidate/v1',result:'selected',
    selectionReasonCode:'selected_compliant_claims',selectedCandidate:{requirementAssessment:'compliant'}};
  assert.deepEqual(extractAcquisitionSelection([{events:[{
    capabilityRef:'libra.external_material.candidate.select@1',result:{committedAtMs:200,result:selection},
  }]}]),{requirementAssessment:'compliant',selectionReasonCode:'selected_compliant_claims'});
});

test('Formation gives a frozen Run precedence over an earlier Product Identity issue',()=>{
  const frozenItem={...item(98,'attention_required',true),currentRun:{...item(98).currentRun,state:'frozen'},nextAction:{label:'本次整理未完成，请查看原因和可用操作',state:'frozen',progress:null}};
  const row=buildFormationProjectionRow(frozenItem,5000);
  assert.equal(row.attention_state,'frozen');
  assert.equal(row.next_action_state,'frozen');
  assert.equal(row.next_action_label,'本次整理未完成，请查看原因和可用操作');
});

test('completed-run remux work becomes the organizing action instead of an empty placeholder',()=>{
  const remuxWorks=[{state:'succeeded',events:[{capabilityRef:'libra.media.remux@1',state:'succeeded'}]}];
  const transcodeWorks=[{state:'succeeded',events:[{capabilityRef:'libra.media.transcode@1',state:'succeeded'}]}];
  const acquireWorks=[{state:'succeeded',events:[{capabilityRef:'libra.external_material.candidate.select@1',state:'succeeded'}]}];
  const adoptWorks=[{state:'succeeded',events:[{capabilityRef:'libra.product.conformance.verify@1',state:'succeeded'}]}];
  assert.match(actionLabel(remuxWorks),/封装整理/);
  assert.match(actionLabel(transcodeWorks),/转码/);
  assert.match(actionLabel(acquireWorks),/外部寻源/);
  assert.match(actionLabel(adoptWorks),/验证整理结果/);
  assert.equal(actionLabel([]),'正在评估整理方案');
  const completedRun={libra_run_id:'run-done',state:'completed'};
  const liveRun={libra_run_id:'run-live',state:'active'};
  const progressByRun=new Map([['run-done',remuxWorks],['run-live',[]]]);
  assert.match(actionLabel(organizingWorks(null,completedRun,progressByRun)),/封装整理/);
  assert.equal(actionLabel(organizingWorks(liveRun,completedRun,progressByRun)),'正在评估整理方案');
});

test('Formation organizingSteps use closed user language and persist GPU transcode intent',()=>{
  const gpuWorks=[{state:'executing',events:[{
    capabilityRef:'libra.media.transcode@1',state:'executing',
    progress:{mode:'determinate',currentValue:34,totalValue:100,unit:'percent',rate:null,etaMs:null,bucket:'transcode'},
    result:{result:{deviceSnapshot:{deviceId:'nvenc-0'}}},
  }]}];
  const spec={spec_json:JSON.stringify({requirements:{mandatoryMedia:{videoCodec:'hevc',minimumRasterClass:'4k'},space:{maxSizeGiB:20}}})};
  const steps=organizingSteps(gpuWorks,spec);
  const transcode=steps.find((item)=>item.key==='transcode');
  assert.equal(transcode.label,'GPU转码 · HEVC · 4k · 不超过 20 GiB');
  assert.equal(transcode.state,'running');
  assert.equal(transcode.progress.currentValue,34);
  assert.ok(steps.some((item)=>item.key==='identity' && item.state==='pending'));
  assert.ok(steps.some((item)=>item.key==='transcode'));
  const nvencWorks=[{state:'executing',events:[{
    capabilityRef:'libra.media.transcode@1',state:'executing',
    result:{result:{executionDeviceRef:{deviceId:'local-nvidia-nvenc-0',deviceClass:'nvidia_nvenc'}}},
  }]}];
  assert.equal(organizingSteps(nvencWorks,spec).find((item)=>item.key==='transcode').label,'GPU转码 · HEVC · 4k · 不超过 20 GiB');
  const waitingGpuWorks=[{state:'running',events:[{
    capabilityRef:'libra.media.transcode@1',state:'waiting_resource',executionDeviceClass:'nvidia_nvenc',result:null,
  }]}];
  const waitingSteps=organizingSteps(waitingGpuWorks,spec);
  assert.deepEqual(waitingSteps.find((item)=>item.key==='transcode'),{
    key:'transcode',label:'等待转码资源 · GPU转码 · HEVC · 4k · 不超过 20 GiB',state:'running',progress:null,
  });
  assert.equal(waitingSteps.find((item)=>item.key==='verify').state,'pending');
  const directSourceVerify=[{state:'succeeded',events:[{
    capabilityRef:'libra.product_media.verify@1',state:'succeeded',result:{result:{verificationKind:'direct_source'}},
  }]}];
  assert.equal(organizingSteps(directSourceVerify,spec).find((item)=>item.key==='verify').state,'pending');
  const finalConformance=[...directSourceVerify,{state:'succeeded',events:[{
    capabilityRef:'libra.product.conformance.verify@1',state:'succeeded',
  }]}];
  assert.equal(organizingSteps(finalConformance,spec).find((item)=>item.key==='verify').state,'done');
  assert.deepEqual(organizingSteps([]),[{key:'assessing',label:'正在评估整理方案',state:'pending',progress:null}]);
  assert.deepEqual(organizingSteps([],spec,{latestRunState:'discarded'}),
    [{key:'reintake',label:'等待重新入库',state:'pending',progress:null}]);
  assert.equal(actionLabel([],spec,{latestRunState:'discarded'}),'等待重新入库');
  assert.equal(nextAction([],'in_progress',null,null,null,null,null,'discarded').label,'等待重新入库');
  const nfoWorks=[{state:'succeeded',events:[{capabilityRef:'libra.product_sidecar.render@1',state:'succeeded',
    result:{result:{provenanceRef:{objectType:'related_nfo_update'}}}}]}];
  assert.equal(organizingSteps(nfoWorks).find((item)=>item.key==='nfo').label,'更新 NFO');
  const historicalNfoWorks=[{state:'succeeded',events:[{capabilityRef:'libra.product_sidecar.render@1',state:'succeeded',
    result:{result:{artifactKind:'nfo'}}}]}];
  assert.equal(organizingSteps(historicalNfoWorks).find((item)=>item.key==='nfo').label,'生成整理后的 NFO（历史记录未区分更新或重建）');
  const row=buildFormationProjectionRow({...item(1,'in_progress'),organizingAction:actionLabel(gpuWorks,spec),organizingSteps:steps},4000);
  const persisted=JSON.parse(row.organizing_action);
  const persistedTranscode=persisted.find((item)=>item.key==='transcode');
  assert.equal(persistedTranscode.label,'GPU转码 · HEVC · 4k · 不超过 20 GiB');
  const projected=projectionItem(row);
  const projectedTranscode=projected.organizingSteps.find((item)=>item.key==='transcode');
  assert.equal(projectedTranscode.label,'GPU转码 · HEVC · 4k · 不超过 20 GiB');
  assert.equal(projectedTranscode.progress.currentValue,34);
  assert.match(projected.organizingAction,/GPU转码 · HEVC · 4k · 不超过 20 GiB/);
  const legacy=projectionItem({...row,organizing_action:'封装整理'});
  assert.equal(legacy.organizingAction,'封装整理');
  assert.equal(legacy.organizingSteps[0].key,'legacy');
  assert.equal(legacy.organizingSteps[0].label,'封装整理');
});

test('Formation presents a failed direct-input verification as a completed branch while transcode waits',()=>{
  const works=[
    {workId:'libra-workspace-media-source_observation-work-1',state:'succeeded',createdAtMs:10,events:[{
      capabilityRef:'shared.material.media.probe@1',state:'succeeded',result:{outcomeKind:'succeeded',result:{result:'observed'}},
    }]},
    {workId:'libra-workspace-media-direct_assessment-work-1',state:'succeeded',createdAtMs:20,events:[{
      capabilityRef:'libra.product_media.verify@1',state:'succeeded',
      result:{outcomeKind:'succeeded',result:{candidateKind:'direct_input',result:'failed',reasonCodes:['max_size_exceeded']}},
    }]},
    {workId:'libra-workspace-media-transcode_1_selection-work-1',state:'running',createdAtMs:30,events:[{
      capabilityRef:'shared.material.media.probe@1',state:'succeeded',result:{outcomeKind:'succeeded',result:{result:'observed'}},
    },{
      capabilityRef:'libra.media.transcode@1',state:'waiting_resource',executionDeviceClass:'intel_qsv',result:null,
    }]},
  ];
  const steps=organizingSteps(works);
  assert.equal(steps.find((item)=>item.key==='source_probe').state,'done');
  assert.equal(steps.find((item)=>item.key==='direct_verify').state,'done');
  assert.equal(steps.find((item)=>item.key==='direct_verify').label,'原片超出体积上限，转入转码');
  assert.equal(steps.filter((item)=>item.key==='source_probe').length,1,
    'The output probe inside Transcode selection must not replace the source observation.');
  assert.equal(nextAction(works,'in_progress',null,'active',null,null,null,'active').label,
    '等待转码资源 · GPU转码');
});

test('execution progress derives the Transcode device class from immutable planned inputs',()=>{
  const inputBindings={schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings:[
    {bindingKind:'literal',portName:'encodeIntent',value:{deviceClass:'nvidia_nvenc'}},
    {bindingKind:'literal',portName:'mediaExecutionDeviceSnapshot',value:{deviceClass:'nvidia_nvenc'}},
  ]};
  const node={capability_ref:'libra.media.transcode@1',input_bindings_json:canonicalJson(inputBindings)};
  assert.equal(plannedExecutionDeviceClass(node),'nvidia_nvenc');
  assert.equal(plannedExecutionDeviceClass({...node,capability_ref:'libra.product_media.verify@1'}),null);
  assert.throws(()=>plannedExecutionDeviceClass({...node,input_bindings_json:canonicalJson({...inputBindings,bindings:[
    inputBindings.bindings[0],
    {bindingKind:'literal',portName:'mediaExecutionDeviceSnapshot',value:{deviceClass:'software_cpu'}},
  ]})}),/single valid device class/);
});

test('execution progress converts SQLite safe integers before Formation JSON projection',()=>{
  const progress=projectedProgress({mode:'determinate',current_value:34n,total_value:100n,unit:'percent',rate:2.5,
    eta_ms:12000n,progress_bucket:'percent-34',sampled_at_ms:1000n});
  assert.deepEqual(progress,{mode:'determinate',currentValue:34,totalValue:100,unit:'percent',rate:2.5,
    etaMs:12000,bucket:'percent-34',sampledAtMs:1000});
  assert.doesNotThrow(()=>canonicalJson(progress));
});

test('Formation projection uses one digest contract for new writes and fails closed on persisted drift',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-formation-projection-digest-')),databasePath=path.join(root,'shelfdeck.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>100});
  try{
    kernel.runPrimitive(({prepare})=>{const insert=prepare(`INSERT INTO libra_subjects(subject_id,structure_kind,content_profile,routing_anchor_intake_decision_id,status,intake_revision,current_identity_revision,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?)`);
      insert.run('subject-000','single','movie',null,'active',1,null,1000,1000);
      insert.run('subject-001','single','movie',null,'active',1,null,1001,1001);});
    const store=createFormationProjectionStore({schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel})});
    const row=buildFormationProjectionRow(item(0,'in_progress'),3000);
    assert.equal(row.projection_digest,formationProjectionDigest(row));
    assert.throws(()=>store.upsert({...buildFormationProjectionRow(item(1,'in_progress'),3001),projection_digest:hex(999)}),
      (error)=>error.code==='FORMATION_PROJECTION_WRITE_DIGEST_INVALID');
    store.upsert(row);
    kernel.runPrimitive(({prepare})=>prepare('UPDATE libra_formation_projections SET display_identity=? WHERE subject_id=?')
      .run('drifted display value','subject-000'));
    assert.throws(()=>store.upsert(row),(error)=>error.code==='FORMATION_PROJECTION_DIGEST_INVALID');
    const persisted=store.find('subject-000');
    assert.equal(persisted.display_identity,'drifted display value');
    assert.notEqual(persisted.projection_digest,formationProjectionDigest(persisted));
  }finally{kernel.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
});

test('Formation three-state classification requires Arca commit and keeps an active Run in progress between stages',()=>{
  const historicalSuccess=[{state:'succeeded',events:[{state:'succeeded'}]}];
  assert.equal(classifyFormation({run:{state:'frozen'},works:historicalSuccess,issue:null,recovery:null,arcaStatus:null,productPackage:null}),'attention_required');
  assert.equal(classifyFormation({run:{state:'active'},works:[{state:'running',events:[{state:'executing'}]}],issue:null,recovery:null,arcaStatus:null,productPackage:null}),'in_progress');
  assert.equal(classifyFormation({run:{state:'active'},works:[{state:'succeeded',events:[{state:'failed'},{state:'succeeded'}]}],issue:null,recovery:null,arcaStatus:null,productPackage:null}),'in_progress');
  assert.equal(classifyFormation({run:null,works:[],issue:null,recovery:null,arcaStatus:null,productPackage:null}),'in_progress');
  assert.equal(classifyFormation({run:null,works:[],issue:null,recovery:null,arcaStatus:null,productPackage:{offerId:'offer'}}),'in_progress');
  assert.equal(classifyFormation({run:null,works:[],issue:null,recovery:null,arcaStatus:{stage:'completed'},productPackage:{offerId:'offer'}}),'completed');
});

test('a current successor Work stays in progress while an earlier strategy Work remains failed',()=>{
  const failed={workId:'failed-work',workKind:'workspace_media_production',state:'failed',createdAtMs:10,events:[{
    eventId:'failed-event',capabilityRef:'libra.media.transcode@1',state:'succeeded',progress:null,
    result:{outcomeKind:'succeeded',committedAtMs:20,result:{resultKind:'not_available'}},
  }]};
  const running={workId:'running-work',workKind:'workspace_media_production',state:'running',createdAtMs:30,events:[{
    eventId:'running-event',capabilityRef:'libra.media.transcode@1',state:'executing',progress:{mode:'determinate',currentValue:25,totalValue:100,unit:'percent',rate:1,etaMs:1000,bucket:'percent-25'},result:null,
  }]};
  const works=[failed,running];
  assert.equal(classifyFormation({run:{state:'active'},works,issue:null,recovery:null,arcaStatus:null,productPackage:null}),'in_progress');
  assert.equal(nextAction(works,'in_progress',null,'active',null,null,null,null).label,'转码');
  assert.equal(nextAction(works,'in_progress',null,'active',null,null,null,null).state,'executing');
  const successorSteps=organizingSteps(works);
  assert.equal(successorSteps.find((item)=>item.key==='transcode').state,'running');
  assert.equal(successorSteps.find((item)=>item.key==='verify').state,'pending');
});

test('a passed successor media verification suppresses an obsolete direct-candidate failure during the promotion gap',()=>{
  const rejectedDirect={workId:'direct-work',workKind:'workspace_media_production',state:'succeeded',createdAtMs:10,events:[{
    eventId:'direct-verify',capabilityRef:'libra.product_media.verify@1',state:'succeeded',progress:null,
    result:{outcomeKind:'succeeded',committedAtMs:20,result:{result:'failed',reasonCodes:['video_codec_unmet']}},
  }]};
  const acceptedTranscode={workId:'transcode-work',workKind:'workspace_media_production',state:'succeeded',createdAtMs:30,events:[{
    eventId:'transcode-verify',capabilityRef:'libra.product_media.verify@1',state:'succeeded',progress:null,
    result:{outcomeKind:'succeeded',committedAtMs:40,result:{result:'passed',reasonCodes:[]}},
  }]};
  const works=[rejectedDirect,acceptedTranscode];
  assert.equal(classifyFormation({run:{state:'active'},works,issue:null,recovery:null,arcaStatus:null,productPackage:null}),'in_progress');
  assert.deepEqual(nextAction(works,'in_progress',null,'active',null,null,null,null),{
    label:'准备下一项整理工作',state:'pending',progress:null,
  });
});

test('a final product conformance failure remains an explicit Formation attention state',()=>{
  const conformanceFailure={workId:'conformance-work',workKind:'product_conformance',state:'succeeded',createdAtMs:50,events:[{
    eventId:'conformance-verify',capabilityRef:'libra.product.conformance.verify@1',state:'succeeded',progress:null,
    result:{outcomeKind:'succeeded',committedAtMs:60,result:{result:'failed',unmetRequirementCodes:['metadata_field_unmet']}},
  }]};
  const works=[conformanceFailure];
  assert.equal(classifyFormation({run:{state:'active'},works,issue:null,recovery:null,arcaStatus:null,productPackage:null}),'attention_required');
  assert.deepEqual(nextAction(works,'attention_required',null,'active',null,null,null,null),{
    label:'媒体产品验收未通过：缺少要求的资料',state:'blocked',progress:null,
  });
});

test('durable Formation projection pages active rows in stable Subject intake order',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-formation-projection-')),databasePath=path.join(root,'shelfdeck.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>100});
  try{
    kernel.runPrimitive(({prepare})=>{
      prepare('CREATE TEMP TABLE formation_projection_update_probe(update_count INTEGER NOT NULL)').run();
      prepare('INSERT INTO formation_projection_update_probe(update_count) VALUES(0)').run();
      prepare('CREATE TEMP TRIGGER formation_projection_update_probe_trigger AFTER UPDATE ON main.libra_formation_projections BEGIN UPDATE formation_projection_update_probe SET update_count=update_count+1; END').run();
    });
    kernel.runPrimitive(({prepare})=>{const insert=prepare(`INSERT INTO libra_subjects(subject_id,structure_kind,content_profile,routing_anchor_intake_decision_id,status,intake_revision,current_identity_revision,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?)`);
      for(let index=0;index<31;index+=1)insert.run(`subject-${String(index).padStart(3,'0')}`,'single','movie',null,'active',1,null,1000+index,1000+index);});
    const unitOfWork=createSqliteUnitOfWork({kernel}),store=createFormationProjectionStore({schemaManifest,unitOfWork});
    for(let index=0;index<31;index+=1)store.upsert(buildFormationProjectionRow(item(index,index===30?'completed':index===29?'attention_required':'in_progress',index===29),3000+index));
    const unchanged=store.upsert(buildFormationProjectionRow(item(0),3000));assert.equal(unchanged.kind,'no_op');assert.equal(unchanged.revision,1);
    assert.equal(kernel.runPrimitive(({prepare})=>prepare('SELECT update_count FROM formation_projection_update_probe').get().update_count),0);
    const query=createFormationQuery({store,now:()=>4000,state:()=>({status:'ready',asOfMs:3999})}),active=query.list({section:'active',limit:25});
    assert.equal(active.items.length,25);assert.deepEqual(active.items.slice(0,3).map((row)=>row.subjectId),['subject-029','subject-028','subject-027']);assert.ok(active.nextCursor);
    assert.deepEqual(active.summary,{totalCount:31,inProgressCount:29,attentionRequiredCount:1,completedCount:1,endedCount:0});assert.deepEqual(active.projection,{status:'ready',asOfMs:3999});
    const remainder=query.list({section:'active',limit:25,cursor:active.nextCursor});assert.equal(remainder.items.length,5);
    const completed=query.list({section:'completed',limit:25});assert.equal(completed.items.length,1);assert.equal(completed.items[0].subjectId,'subject-030');
    const byTitle=query.list({section:'active',q:'影片 0'});
    assert.equal(byTitle.items.length,1);assert.equal(byTitle.items[0].subjectId,'subject-000');
    assert.notEqual(active.items.some((row)=>row.subjectId==='subject-000'),true);
    const byBucket=query.list({section:'active',classification:'attention_required'});
    assert.equal(byBucket.items.length,1);assert.equal(byBucket.items[0].subjectId,'subject-029');
    assert.deepEqual(byBucket.summary,active.summary);
    store.upsert(buildFormationProjectionRow(item(5,'attention_required',true),9000));
    const afterStatusChange=query.list({section:'active',limit:25});
    assert.deepEqual(afterStatusChange.items.slice(0,3).map((row)=>row.subjectId),['subject-029','subject-028','subject-027']);
    assert.ok(afterStatusChange.items.findIndex((row)=>row.subjectId==='subject-005')
      > afterStatusChange.items.findIndex((row)=>row.subjectId==='subject-006'));

    const itemWithOffer={...item(5),handoffB:Object.freeze({onDeckPackageId:'package-5',offerId:'offer-5',packageRevision:1,packageDigest:hex(505),state:'published',publishedAtMs:2005})};
    store.upsert(buildFormationProjectionRow(itemWithOffer,10000));
    const attentionQuery=createFormationQuery({
      store,now:()=>11000,state:()=>({status:'ready',asOfMs:10999}),
      listAcceptanceAttention:()=>[{offerId:'offer-5'}],
      readAcceptanceRecovery:()=>({recoveryState:'attention_required',failurePhase:'commit',errorCode:'TEST_FAILURE',terminalAttemptCount:1,ownerDomain:'arca',recoveryGeneration:1,automaticRecoveryUsed:false,offerId:'offer-5'}),
    });
    const attentionFirstPage=attentionQuery.list({section:'active',limit:25});
    assert.deepEqual(attentionFirstPage.items.slice(0,3).map((row)=>row.subjectId),['subject-029','subject-028','subject-027']);
    const issueIndex=attentionFirstPage.items.findIndex((row)=>row.subjectId==='subject-005');
    assert.ok(issueIndex>attentionFirstPage.items.findIndex((row)=>row.subjectId==='subject-006'));
    assert.equal(attentionFirstPage.items[issueIndex].classification,'attention_required');
    const attentionSecondPage=attentionQuery.list({section:'active',limit:25,cursor:attentionFirstPage.nextCursor});
    assert.deepEqual(attentionSecondPage.items.map((row)=>row.subjectId),['subject-004','subject-003','subject-002','subject-001','subject-000']);
    assert.equal(new Set([...attentionFirstPage.items,...attentionSecondPage.items].map((row)=>row.subjectId)).size,30);
    const endedQuery=createFormationQuery({store,historyStore:{listDiscarded:()=>[{historyId:'discard-1',libraRunId:'old-run',subjectId:'subject-000',outcome:'user_abandoned',label:'已结束 · 用户放弃',endedAtMs:5000,stateRevision:3,stateDigest:hex(900),evidenceDigest:hex(901)}]},now:()=>5001,state:()=>({status:'ready',asOfMs:5000})});
    const ended=endedQuery.list({section:'ended',limit:25});assert.equal(ended.items.length,1);assert.equal(ended.items[0].displayIdentity,'影片 0');assert.equal(ended.items[0].label,'已结束 · 用户放弃');
  }finally{kernel.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
});

test('Formation active list and summary overlay current Arca truth before filtering',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-formation-current-truth-')),databasePath=path.join(root,'shelfdeck.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>100});
  try{
    kernel.runPrimitive(({prepare})=>{const insert=prepare(`INSERT INTO libra_subjects(subject_id,structure_kind,content_profile,routing_anchor_intake_decision_id,status,intake_revision,current_identity_revision,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?)`);
      insert.run('subject-000','single','movie',null,'active',1,null,1000,1000);
      insert.run('subject-001','single','movie',null,'active',1,null,1001,1001);});
    const unitOfWork=createSqliteUnitOfWork({kernel}),store=createFormationProjectionStore({schemaManifest,unitOfWork});
    store.upsert(buildFormationProjectionRow(item(0,'in_progress'),3000));
    store.upsert(buildFormationProjectionRow(item(1,'in_progress'),3001));
    const freshAttention=Object.freeze({...item(0,'attention_required'),arcaStatus:Object.freeze({
      stage:'attention_required',reasonCode:'P4_EVENT_INPUT_PREPARATION_FAILED',onDeckRunId:'ondeck-0',
    }),nextAction:Object.freeze({label:'收藏架接纳或上架需要处理',state:'attention_required',progress:null})});
    const summaryReads=[];
    const query=createFormationQuery({store,readPipelineSubjectIds:()=>new Set(['subject-000','subject-001']),
      detailSource:{
        getMany:()=>{throw new Error('List must not hydrate current facts twice.');},
        getManyWithProcessSummary:(ids)=>{summaryReads.push(ids);return ids.map((id)=>Object.freeze({...((id==='subject-000')?freshAttention:item(1,'in_progress')),subjectId:id,currentPlan:Object.freeze({
          stageKey:'media_organization',planId:`plan-${id}`,planNumber:14,title:'处理媒体文件',
          label:'计划14 处理媒体文件',state:id==='subject-000'?'attention':'running',
          statusText:id==='subject-000'?'执行失败':'等待处理资源',progress:null,
        })}));},
      },
      now:()=>4000,state:()=>({status:'ready',asOfMs:3999})});
    const active=query.list({section:'active'});
    assert.equal(active.items.find((row)=>row.subjectId==='subject-000').classification,'attention_required');
    assert.equal(active.items.find((row)=>row.subjectId==='subject-000').currentPlan.statusText,'执行失败');
    assert.equal(active.items.find((row)=>row.subjectId==='subject-001').currentPlan.label,'计划14 处理媒体文件');
    assert.deepEqual(summaryReads[0],active.items.map((row)=>row.subjectId));
    assert.deepEqual(active.summary,{totalCount:2,inProgressCount:1,attentionRequiredCount:1,completedCount:0,endedCount:0});
    assert.deepEqual(query.list({section:'active',classification:'attention_required'}).items.map((row)=>row.subjectId),['subject-000']);
  }finally{kernel.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
});

test('Formation position timestamp remains the Subject creation time when mutable facts change',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-formation-created-at-')),databasePath=path.join(root,'shelfdeck.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>100});
  try{
    kernel.runPrimitive(({prepare})=>prepare(`INSERT INTO libra_subjects(subject_id,structure_kind,content_profile,routing_anchor_intake_decision_id,status,intake_revision,current_identity_revision,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run('subject-stable','single','movie',null,'active',1,null,1000,9000));
    const unitOfWork=createSqliteUnitOfWork({kernel});
    const source=createFormationProjectionSource({schemaManifest,unitOfWork});
    const first=source.buildBatch([source.readSubject('subject-stable')])[0];
    assert.equal(first.addedAtMs,1000);
    kernel.runPrimitive(({prepare})=>prepare('UPDATE libra_subjects SET intake_revision=?,updated_at_ms=? WHERE subject_id=?').run(2,12000,'subject-stable'));
    const changed=source.buildBatch([source.readSubject('subject-stable')])[0];
    assert.equal(changed.addedAtMs,1000);
  }finally{kernel.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
});

test('UAT-320 current Owner readiness updates stale list, attention filter and summary without a Run',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-routing-readiness-'));
  const kernel=openSqliteKernel({Database,databasePath:path.join(root,'shelfdeck.db'),schemaDdl,schemaManifest,now:()=>100});
  try {
    kernel.runPrimitive(({prepare})=>prepare(`INSERT INTO libra_subjects(subject_id,structure_kind,content_profile,routing_anchor_intake_decision_id,status,intake_revision,current_identity_revision,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run('subject-000','single','movie',null,'active',1,null,1000,1000));
    const store=createFormationProjectionStore({schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel})});
    const stale={...item(0),currentRun:null,routingState:'preparing',targetShelfId:null,targetShelfName:null};
    store.upsert(buildFormationProjectionRow(stale,1001));
    let current={...stale,classification:'attention_required',routingState:'unresolved',
      unresolvedReasonCode:'routing_policy_unavailable',routingConfigurationFieldId:'field-1',
      nextAction:{label:'尚未配置收藏去向',state:'attention_required',progress:null}};
    const query=createFormationQuery({store,readPipelineSubjectIds:()=>new Set(['subject-000']),
      detailSource:{getMany:()=>[current]},now:()=>2000});
    const attention=query.list({section:'active',classification:'attention_required'});
    assert.equal(attention.items.length,1);
    assert.equal(attention.items[0].routingConfigurationFieldId,'field-1');
    assert.equal(attention.items[0].currentRun,null);
    assert.equal(attention.summary.attentionRequiredCount,1);
    assert.equal(attention.summary.inProgressCount,0);
    current={...stale,routingConfigurationFieldId:null};
    assert.equal(query.list({classification:'attention_required'}).items.length,0);
    assert.equal(query.list().summary.attentionRequiredCount,0);
    assert.equal(query.list().summary.inProgressCount,1);
  } finally {kernel.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
});

test('Formation detail source uses business boundaries while Routing is still preparing',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-formation-stage-boundary-')),databasePath=path.join(root,'shelfdeck.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>100});
  try{
    kernel.runPrimitive(({prepare})=>prepare(`INSERT INTO libra_subjects(subject_id,structure_kind,content_profile,routing_anchor_intake_decision_id,status,intake_revision,current_identity_revision,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run('subject-preparing','single','movie',null,'active',1,null,1000,1000));
    const plan={planId:'plan-routing-complete',plannerRef:'planner',plannerVersion:1,state:'planned',createdAtMs:10,edges:[]};
    const progressProjectionReader={read:(_ids,options)=>options?.includePlans?[{
      workId:'work-routing-complete',ownerDomain:'libra',processType:'libra_routing',processId:'subject-preparing',
      workKind:'routing_basis',state:'succeeded',createdAtMs:10,plans:[plan],events:[{
        eventId:'event-routing-complete',planId:plan.planId,nodeId:'basis',capabilityRef:'libra.decision_basis.commit@1',
        state:'succeeded',progress:null,result:{outcomeKind:'succeeded',result:{result:'resolved'}},
        inputBindings:{bindings:[]},parameters:{},plan,
      }],
    }]:[]};
    const source=createFormationProjectionSource({schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel}),progressProjectionReader});
    const item=source.get('subject-preparing'),organization=item.processDetail.stages.find((stage)=>stage.key==='media_organization');
    assert.equal(item.routingState,'preparing');
    assert.equal(item.acceptanceSpecId,null);
    assert.equal(item.currentRun,null);
    assert.equal(organization.state,'running');
    assert.equal(organization.summary,'已有 1 个实际计划完成，等待本阶段继续推进');
    assert.equal(item.currentPlan.label,'保存本次整理决定');
    assert.equal(item.currentPlan.state,'completed');
    assert.equal(item.currentPlan.planId,plan.planId);
  }finally{kernel.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
});

test('Formation bounds Subject batches and expanded historical Run revisions without dropping active pages', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-formation-bounds-'));
  const kernel=openSqliteKernel({Database,databasePath:path.join(root,'shelfdeck.db'),schemaDdl,schemaManifest,now:()=>100});
  try {
    const subjects=Array.from({length:205},(_,index)=>item(index).subjectId);
    kernel.runPrimitive(({prepare})=>{
      const subject=prepare('INSERT INTO libra_subjects(subject_id,structure_kind,content_profile,status,intake_revision,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?)');
      const run=prepare('INSERT INTO libra_runs(libra_run_id,subject_id,admission_revision,execution_basis_record_json,state,state_revision,state_digest,priority_class,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)');
      subjects.forEach((id,index)=>{
        subject.run(id,'single','movie','active',1,1000+index,1000+index);
        run.run('run-'+index,id,1,'{}','active',1,hex(index+400),'normal',1000+index);
      });
      for(let index=0;index<3;index+=1)run.run('old-run-'+index,subjects[0],index+2,'{}','discarded',1,hex(index+900),'normal',index);
    });
    const unitOfWork=createSqliteUnitOfWork({kernel});
    const progressReads=[];
    const source=createFormationProjectionSource({schemaManifest,unitOfWork,
      progressProjectionReader:{read(ids){progressReads.push(...ids);return [];}}});
    // A 100-Subject page expands to 103 Run IDs through immutable history.
    assert.deepEqual(source.getManyWithProcessSummary(subjects.slice(0,100)).map(row=>row.subjectId),subjects.slice(0,100));
    assert.deepEqual(source.getMany(subjects).map(row=>row.subjectId),subjects);
    assert.deepEqual(source.getManyWithProcessSummary([]),[]);
    assert.ok(progressReads.includes('run-0'));
    assert.ok(progressReads.every(id=>!id.startsWith('old-run-')),
      'Current Formation must not load unused historical execution graphs.');
    const store=createFormationProjectionStore({schemaManifest,unitOfWork});
    subjects.forEach((id,index)=>store.upsert(buildFormationProjectionRow(item(index),3000+index)));
    const query=createFormationQuery({store,detailSource:source,readPipelineSubjectIds:()=>new Set(subjects),now:()=>4000});
    const seen=[];
    let cursor=null;
    do {
      const page=query.list({limit:25,cursor});
      assert.equal(page.summary.inProgressCount,205);
      assert.ok(page.items.every(row=>row.currentRun?.state==='active'));
      seen.push(...page.items.map(row=>row.subjectId));
      cursor=page.nextCursor;
    } while(cursor);
    assert.deepEqual(seen,subjects.slice().reverse());
    assert.equal(new Set(seen).size,205);
  } finally { kernel.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50}); }
});

test('Formation never asks Perception to rate a cancelled Subject',()=>{
  const activeId='subject-active',cancelledId='subject-cancelled';
  const subject=(id,status)=>({subject_id:id,structure_kind:'single',content_profile:'movie',routing_anchor_intake_decision_id:'intake-'+id,
    status,intake_revision:1,current_identity_revision:null,created_at_ms:100,updated_at_ms:100});
  const snapshot=JSON.stringify({candidatePackage:{displayIdentity:'已取消影片'}});
  const rows={
    subjects:[subject(activeId,'active'),subject(cancelledId,'abandoned')],
    decisions:[activeId,cancelledId].map((id)=>({intake_decision_id:'intake-'+id,target_subject_id:id,source_field_id:'field-1',
      candidate_delivery_snapshot_json:snapshot,decided_at_ms:100})),
    routingDecisions:[activeId,cancelledId].map((id)=>({subject_id:id,decision_revision:1,decision:'resolved',shelf_id:'shelf-1',
      unresolved_reason_code:null,routing_policy_id:'policy-1',routing_policy_revision:1,decision_digest:hex(11)})),
    routingPolicies:[{routing_policy_id:'policy-1',revision:1,mode:'direct'}],
    fieldRoutingHeads:[{field_id:'field-1',current_routing_policy_id:'policy-1'}],
    runs:[{libra_run_id:'run-active',subject_id:activeId,state:'active',state_revision:1,state_digest:hex(12),priority_class:'normal',package_revision_head:0,created_at_ms:100},
      {libra_run_id:'run-cancelled',subject_id:cancelledId,state:'discarded',state_revision:3,state_digest:hex(13),priority_class:'normal',package_revision_head:0,created_at_ms:100}],
    runRevisions:[{libra_run_id:'run-active',state_revision:1,transition_evidence_json:'{}'}],
    cancellations:[{subject_id:cancelledId,state:'completed'}],
  };
  const statementKeys={find_decisions:['decisions','target_subject_id'],find_bindings:['bindings','subject_id'],
    find_identities:['identities','subject_id'],find_routing_decisions:['routingDecisions','subject_id'],
    find_routing_policies:['routingPolicies','routing_policy_id'],find_field_routing_heads:['fieldRoutingHeads','field_id'],
    find_decision_heads:['decisionHeads','subject_id'],find_acceptance_specs:['specs','subject_id'],
    find_runs:['runs','subject_id'],find_run_revisions:['runRevisions','libra_run_id'],find_packages:['packages','libra_run_id'],
    find_identity_intents:['identityIntents','libra_run_id'],find_us_completions:['usCompletions','libra_run_id'],
    find_us_actor_choices:['usChoices','subject_id'],find_cancellations:['cancellations','subject_id']};
  const repo={invoke(statement,params={}){
    if(statement==='find_subject')return rows.subjects.find((row)=>row.subject_id===params.subject_id)||null;
    const [key,keyColumn]=statementKeys[statement]||[];
    if(!key)throw new Error('Unexpected formation statement '+statement);
    const values=new Set(params.values||[]);
    return (rows[key]||[]).filter((row)=>values.has(row[keyColumn]));
  }};
  const ratingCalls=[];
  const source=createFormationProjectionSource({schemaManifest,
    unitOfWork:{execute(participants){return Object.fromEntries(participants.map((participant)=>
      [participant.participantId,participant.execute({repository:()=>repo})]));}},
    readPerceptionRatings(subjectIds){
      ratingCalls.push(...subjectIds);
      // The routing context reader rejects a cancelled Subject with this exact guard.
      if(subjectIds.includes(cancelledId))throw new Error('Routing requires an active accepted Subject.');
      return new Map(subjectIds.map((id)=>[id,{state:'ready',rating:4,sourceKind:'douban',expectedRevision:0}]));
    }});
  assert.doesNotThrow(()=>source.buildBatch([rows.subjects[1]]),'the projection host must keep sweeping after a cancellation');
  const cancelled=source.get(cancelledId);
  assert.equal(cancelled.status,'abandoned');
  assert.equal(cancelled.myRating,null);
  const active=source.get(activeId);
  assert.equal(active.myRating,4);
  assert.deepEqual(ratingCalls,[activeId]);
});

test('Formation keeps accepted active Subjects visible even without a pipeline token or Run',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-formation-admission-')),databasePath=path.join(root,'shelfdeck.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>100});
  try{
    kernel.runPrimitive(({prepare})=>{const insert=prepare(`INSERT INTO libra_subjects(subject_id,structure_kind,content_profile,routing_anchor_intake_decision_id,status,intake_revision,current_identity_revision,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?)`);
      insert.run('subject-000','single','movie',null,'active',1,null,1000,1000);
      insert.run('subject-001','single','movie',null,'active',1,null,1001,1001);});
    const unitOfWork=createSqliteUnitOfWork({kernel}),store=createFormationProjectionStore({schemaManifest,unitOfWork});
    store.upsert(buildFormationProjectionRow({...item(0,'in_progress'),currentRun:null},3000));
    store.upsert(buildFormationProjectionRow({...item(1,'in_progress'),currentRun:null},3001));
    const query=createFormationQuery({store,readPipelineSubjectIds:()=>new Set(['subject-001']),now:()=>4000,state:()=>({status:'ready',asOfMs:3999})});
    const active=query.list({section:'active',limit:25});
    assert.deepEqual(active.items.map((row)=>row.subjectId),['subject-001','subject-000']);
    assert.deepEqual(active.summary,{totalCount:2,inProgressCount:2,attentionRequiredCount:0,completedCount:0,endedCount:0});
  }finally{kernel.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
});

test('Formation query filters shelf, expedite, and needs-user-action on the projection',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-formation-filter-')),databasePath=path.join(root,'shelfdeck.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>100});
  try{
    kernel.runPrimitive(({prepare})=>{const insert=prepare(`INSERT INTO libra_subjects(subject_id,structure_kind,content_profile,routing_anchor_intake_decision_id,status,intake_revision,current_identity_revision,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?)`);
      for(let index=0;index<7;index+=1)insert.run(`subject-${String(index).padStart(3,'0')}`,'single','movie',null,'active',1,null,1000+index,1000+index);});
    const unitOfWork=createSqliteUnitOfWork({kernel}),store=createFormationProjectionStore({schemaManifest,unitOfWork});
    for(let index=0;index<4;index+=1)store.upsert(buildFormationProjectionRow(item(index,'in_progress'),3000+index));
    store.upsert(buildFormationProjectionRow({...item(4,'in_progress'),displayIdentity:'加急片',currentRun:{...item(4).currentRun,priorityClass:'expedited'}},4000));
    store.upsert(buildFormationProjectionRow({...item(5,'attention_required'),displayIdentity:'未分架片',targetShelfId:null,targetShelfName:null,routingState:'unresolved'},4001));
    store.upsert(buildFormationProjectionRow(item(6,'attention_required',true),4002));
    const query=createFormationQuery({store,now:()=>5000,state:()=>({status:'ready',asOfMs:4999})});
    const expedited=query.list({section:'active',expedited:'1'});
    assert.equal(expedited.items.length,1);assert.equal(expedited.items[0].displayIdentity,'加急片');
    const unset=query.list({section:'active',shelfId:'unset'});
    assert.equal(unset.items.length,1);assert.equal(unset.items[0].displayIdentity,'未分架片');
    const mine=query.list({section:'active',needsUserAction:'1'});
    assert.deepEqual(mine.items.map((row)=>row.displayIdentity).sort(),['未分架片','影片 6'].sort());
    const shelf=query.list({section:'active',shelfId:'shelf-1',classification:'in_progress'});
    assert.equal(shelf.items.length,5);
    assert.ok(shelf.items.every((row)=>row.targetShelfId==='shelf-1' && row.classification==='in_progress'));
    assert.equal(shelf.summary.inProgressCount,5);
  }finally{kernel.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
});

test('Formation shows blocked transcode assessment without inventing remux from spec',()=>{
  const works=[{workId:'libra-workspace-media-transcode_1_assessment-work-abc',workKind:'workspace_media_production',
    state:'blocked',createdAtMs:10,events:[]}];
  const spec={spec_json:JSON.stringify({requirements:{mandatoryMedia:{videoCodec:'hevc',minimumRasterClass:'none'},space:{maxSizeGiB:14}}})};
  const steps=organizingSteps(works,spec);
  assert.equal(steps.find((item)=>item.key==='transcode').state,'blocked');
  assert.equal(steps.some((item)=>item.key==='remux'),false);
  assert.equal(nextAction(works,'in_progress',null,'active',null,null,null,'active',false,null,spec).label,
    '需要转码，编码设备未就绪');
});

test('Formation does not forecast remux or external sourcing before durable Work events exist',()=>{
  const works=[{workId:'identity-work',workKind:'product_identity',state:'succeeded',createdAtMs:1,
    events:[{capabilityRef:'libra.product_identity.resolve@1',state:'succeeded',progress:null,result:null}]}];
  const spec={spec_json:JSON.stringify({requirements:{mandatoryMedia:{videoCodec:'hevc',minimumRasterClass:'4k'}}})};
  const steps=organizingSteps(works,spec);
  assert.equal(steps.some((item)=>item.key==='remux'),false);
  assert.equal(steps.some((item)=>item.key==='acquire'),false);
  assert.equal(steps.some((item)=>item.key==='transcode'),false);
});

test('Formation shelves as a checklist and names the write step while On-deck is staging',()=>{
  const pkg={offerId:'offer-1'};
  const seeded=shelvingSteps(null,null,null,[]);
  assert.deepEqual(seeded.map((item)=>item.key),['accept','write','finish']);
  assert.ok(seeded.every((item)=>item.state==='pending'));
  const waiting=shelvingSteps(pkg,null,null,[]);
  assert.equal(waiting.find((item)=>item.key==='accept').state,'running');
  assert.equal(waiting.find((item)=>item.key==='write').state,'pending');
  assert.equal(nextAction([],'in_progress',null,null,null,null,pkg,'completed').label,'等待收藏架验收');
  const writing=shelvingSteps(pkg,{stage:'in_progress',onDeckRunId:'ondeck-1'},null,[{
    workId:'on-deck-work',workKind:'on_deck_execution',state:'running',createdAtMs:10,events:[{
      capabilityRef:'arca.inventory.product.stage@1',state:'executing',progress:{mode:'determinate',currentValue:40,totalValue:100,unit:'percent',rate:null,etaMs:null,bucket:'percent-40'},
    }],
  }]);
  assert.equal(writing.find((item)=>item.key==='accept').state,'done');
  assert.equal(writing.find((item)=>item.key==='write').state,'running');
  assert.equal(writing.find((item)=>item.key==='write').progress.currentValue,40);
  assert.equal(nextAction([],'in_progress',null,null,null,{stage:'in_progress',onDeckRunId:'ondeck-1'},pkg,'completed',false,null,null,[{
    workId:'on-deck-work',workKind:'on_deck_execution',state:'running',createdAtMs:10,events:[{
      capabilityRef:'arca.inventory.product.stage@1',state:'executing',progress:{mode:'determinate',currentValue:40,totalValue:100,unit:'percent',rate:null,etaMs:null,bucket:'percent-40'},
    }],
  }]).label,'正在写入收藏架');
  const done=shelvingSteps(pkg,{stage:'completed',onDeckRunId:'ondeck-1'},null,[]);
  assert.ok(done.every((item)=>item.state==='done'));
});

test('Formation cannot hide an active Subject just because its last Run was discarded',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-formation-abandon-')),databasePath=path.join(root,'shelfdeck.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>100});
  try{
    kernel.runPrimitive(({prepare})=>{const insert=prepare(`INSERT INTO libra_subjects(subject_id,structure_kind,content_profile,routing_anchor_intake_decision_id,status,intake_revision,current_identity_revision,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?)`);
      insert.run('subject-000','single','movie',null,'active',1,null,1000,1000);
      insert.run('subject-001','single','movie',null,'active',1,null,1001,1001);});
    const unitOfWork=createSqliteUnitOfWork({kernel}),store=createFormationProjectionStore({schemaManifest,unitOfWork});
    store.upsert(buildFormationProjectionRow({
      ...item(0,'in_progress'), currentRun:null,
      nextAction:Object.freeze({label:'等待重新入库',state:'pending',progress:null}),
      organizingAction:'等待重新入库',
      organizingSteps:Object.freeze([{key:'reintake',label:'等待重新入库',state:'pending',progress:null}]),
    },3000));
    store.upsert(buildFormationProjectionRow(item(1,'in_progress'),3001));
    const query=createFormationQuery({store,now:()=>4000,state:()=>({status:'ready',asOfMs:3999})});
    const active=query.list({section:'active'});
    assert.deepEqual(active.items.map((row)=>row.subjectId),['subject-001','subject-000']);
    assert.equal(active.summary.inProgressCount,2);
    assert.equal(active.summary.totalCount,2);
  }finally{kernel.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
});

test('formally ended Subjects leave active pages and counts while their system discard history remains accessible', () => {
  const rows = [3, 2, 1, 0].map((index) => buildFormationProjectionRow(item(index), 3000+index));
  const history = [{subjectId:'subject-003',libraRunId:'run-3',outcome:'system_discarded'}];
  const store = {
    listActive:(offset, limit) => rows.slice(offset, offset+limit),
    listCompleted:() => [],
    counts:() => [{group_value:'in_progress',row_count:4}],
    find:(id) => rows.find((row) => row.subject_id === id),
  };
  const detailSource = {getMany:(ids) => ids.map((id) => {
    const index = Number(id.slice(-3));
    return index >= 2 ? {...item(index), status:'ended', currentRun:null, handoffB:null,
      nextAction:{label:'等待重新入库',state:'pending',progress:null}} : item(index);
  })};
  let planReads = 0;
  detailSource.getManyWithProcessSummary = (ids) => {
    planReads += 1;
    return detailSource.getMany(ids).map((value) => ({...value, currentPlan:null}));
  };
  for (const readPipelineSubjectIds of [undefined, () => new Set(rows.map((row) => row.subject_id))]) {
    const query = createFormationQuery({store, detailSource, readPipelineSubjectIds,
      historyStore:{count:() => 1,listDiscarded:() => history},now:() => 4000});
    const first = query.list({limit:1});
    assert.deepEqual(first.items.map((row) => row.subjectId), ['subject-001']);
    assert.deepEqual(first.summary, {totalCount:2,inProgressCount:2,attentionRequiredCount:0,completedCount:0,endedCount:1});
    assert.ok(first.nextCursor);
    const second = query.list({limit:1,cursor:first.nextCursor});
    assert.deepEqual(second.items.map((row) => row.subjectId), ['subject-000']);
    assert.equal(second.nextCursor, null);
    assert.equal(query.list({q:'影片 3'}).items.length, 0);
    const beforeSummary = planReads;
    const ended = query.list({section:'ended'});
    assert.deepEqual(ended.summary, first.summary);
    assert.deepEqual(query.list({section:'completed'}).summary, first.summary);
    assert.equal(planReads, beforeSummary, 'Counts must not load full process Plans.');
    assert.equal(ended.items[0].libraRunId, 'run-3');
    assert.equal(ended.items[0].displayIdentity, '影片 3');
  }
});

test('exact Formation wake drains more than one bounded batch without waiting for fallback',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-formation-projection-host-')),databasePath=path.join(root,'shelfdeck.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>100});
  const unitOfWork=createSqliteUnitOfWork({kernel}),ids=Array.from({length:101},(_,index)=>`subject-${String(index).padStart(3,'0')}`),processed=[],batchSizes=[],fallbackLimits=[];
  const source={
    readPage:(_cursor,limit)=>{fallbackLimits.push(limit);return [];},
    readSubject:(subjectId)=>ids.includes(subjectId)?{subject_id:subjectId}:null,
    buildBatch:(subjects)=>{batchSizes.push(subjects.length);return subjects.map(({subject_id:subjectId})=>({
      formationViewId:subjectId,subjectId,displayIdentity:subjectId,contentProfile:'movie',structureKind:'single',status:'active',classification:'in_progress',
      myRating:null,myRatingSource:null,myRatingRevision:null,productIdentityIssue:null,targetShelfId:null,targetShelfName:null,
      routingState:'preparing',unresolvedReasonCode:null,routingPolicyMode:null,routingPolicyRevision:null,routingDecisionRevision:null,
      routingDecisionDigest:null,routingDecisionHeadRevision:null,routingDecisionHeadDigest:null,acceptanceSpecId:null,
      acceptanceSpecRevision:null,acceptanceSpecDigest:null,primaryMaterialCount:0,
      addedAtMs:0,organizingRequirement:'保持原媒体并完成资料',organizingAction:'正在评估整理方案',
      organizingSteps:[{key:'assessing',label:'正在评估整理方案',state:'pending',progress:null}],
      nextAction:{label:'等待处理',state:'pending',progress:null},currentRun:null,handoffB:null,acceptanceRecovery:null,arcaStatus:null,completedAtMs:null,
    }));},
  };
  const store={upsert:(row)=>{processed.push(row.subject_id);return {kind:'inserted',revision:1};}},errors=[];
  const host=createFormationProjectionHost({schemaManifest,unitOfWork,source,store,now:()=>100,onError:(error)=>errors.push(error)});
  try{
    await host.start();
    ids.forEach((subjectId)=>host.enqueue(subjectId));
    const deadline=Date.now()+2000;
    while(processed.length<ids.length&&Date.now()<deadline)await new Promise((resolve)=>setTimeout(resolve,5));
    assert.equal(processed.length,ids.length,errors.map((error)=>`${error.code||error.name}: ${error.message} ${JSON.stringify(error.details||{})}`).join('\n'));
    assert.equal(new Set(processed).size,ids.length);
    assert.deepEqual(batchSizes.sort((left,right)=>left-right),[1,100]);
    assert.ok(fallbackLimits.length>0&&fallbackLimits.every((limit)=>limit===4));
    assert.equal(host.state().queued,0);
  }finally{await host.stop();kernel.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
});

test('Formation projection freshness recovers after a transient rebuild failure',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-formation-projection-recovery-')),databasePath=path.join(root,'shelfdeck.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>100});
  const unitOfWork=createSqliteUnitOfWork({kernel});let failNext=false,writes=0;const errors=[];
  const source={readPage:()=>[],readSubject:()=>({subject_id:'subject-recovery'}),buildBatch:()=>{
    if(failNext){failNext=false;throw Object.assign(new Error('transient projection input'),{code:'TRANSIENT_PROJECTION_INPUT'});}
    return [item(1,'in_progress')];
  }};
  const host=createFormationProjectionHost({schemaManifest,unitOfWork,source,store:{upsert:()=>{writes+=1;return {kind:'inserted'};}},
    now:()=>100,onError:(error)=>errors.push(error)});
  try{
    await host.start();
    const readyDeadline=Date.now()+1000;while(host.state().status!=='ready'&&Date.now()<readyDeadline)await new Promise((resolve)=>setTimeout(resolve,5));
    failNext=true;host.enqueue('subject-recovery');
    const failedDeadline=Date.now()+1000;while(errors.length<1&&Date.now()<failedDeadline)await new Promise((resolve)=>setTimeout(resolve,5));
    assert.equal(host.state().status,'stale');
    host.enqueue('subject-recovery');
    const recoveredDeadline=Date.now()+1000;while(writes<1&&Date.now()<recoveredDeadline)await new Promise((resolve)=>setTimeout(resolve,5));
    assert.equal(host.state().status,'ready');
  }finally{await host.stop();kernel.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
});


test('UAT-251 current provider failure takes precedence over an old empty search result', () => {
  const works = [{ events: [{ capabilityRef: 'libra.external_material.candidate.select@1',
    result: { committedAtMs: 200, result: { schemaRef: 'helix://contracts/types/SelectedCandidate/v1',
      result: 'not_selected', selectionReasonCode: 'no_available_candidate' } } }] }];
  const terminal = { blockedWorks: [{ failureCode: 'P5_PROVIDER_RESPONSE_INVALID' }] };
  assert.equal(frozenRunLabel(works, terminal), '外部资源查询结果校验失败，本次整理未完成，请查看具体原因');
  assert.doesNotMatch(frozenRunLabel(works, terminal), /没有找到|采购|冻结/);
  assert.equal(frozenRunLabel([]), '本次整理未完成，请查看原因和可用操作');
});


test('UAT-125 queued Formation startup and wake callbacks cannot read after shutdown',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-projection-stop-'));
  const kernel=openSqliteKernel({Database,databasePath:path.join(root,'shelfdeck.db'),schemaDdl,schemaManifest,now:()=>100});
  const errors=[];let reads=0;
  const host=createFormationProjectionHost({schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel}),
    source:{readPage:()=>{reads++;return [];},readSubject:()=>{reads++;return null;},buildBatch:()=>[]},
    store:{upsert:()=>{throw new Error('No projection write expected');}},onError:error=>errors.push(error)});
  try{
    await host.start();host.enqueue('queued-subject');host.wake();
    await host.stop();kernel.close();
    await new Promise(resolve=>setImmediate(resolve));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(reads,0);assert.deepEqual(errors,[]);
  }finally{await host.stop();kernel.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
});

test('Formation shows the active external download after terminal DV strategy rejection', () => {
  const works = [
    {workId:'libra-workspace-media-transcode_3_assessment-work-dv',state:'succeeded',createdAtMs:10,events:[
      {eventId:'assessment',capabilityRef:'libra.transcode.input.verify@1',state:'succeeded',result:{outcomeKind:'succeeded',result:{
        result:'failed',disposition:'strategy_rejected',reasonCodes:['dolby_vision_base_layer_unsupported']}}}]},
    {workId:'libra-workspace-media-transcode_4_assessment-work-exhausted',state:'blocked',createdAtMs:11,events:[]},
    {workId:'external-search',state:'succeeded',createdAtMs:12,events:[
      {capabilityRef:'libra.external_material.candidate.select@1',state:'succeeded',result:{outcomeKind:'succeeded',result:{
        schemaRef:'helix://contracts/types/SelectedCandidate/v1',result:'selected',requirementDisposition:'compliant',candidateId:'candidate-1'}}}]},
    {workId:'external-download',state:'running',createdAtMs:13,events:[
      {eventId:'request',capabilityRef:'libra.external_material.acquire.request@1',state:'succeeded'},
      {eventId:'resolve',capabilityRef:'libra.external_material.output.resolve@1',state:'pending'},
      {eventId:'observe',capabilityRef:'libra.external_material.acquire.observe@1',state:'waiting_for_external'}]},
  ];
  const action = nextAction(works,'in_progress',null,'active',null,null,null,'active');
  assert.equal(action.state,'waiting_for_external'); assert.match(action.label,/外部源/); assert.doesNotMatch(action.label,/设备未就绪/);
  const steps=organizingSteps(works);
  assert.equal(steps.find(item=>item.key==='transcode').state,'done');
  assert.equal(steps.find(item=>item.key==='transcode').label,'本地转码不可用，转入外部寻源');
  assert.equal(steps.find(item=>item.key==='acquire').state,'running');
});


test('UAT-273 successful identity observation with unresolved business outcome is not a completed step',()=>{
  for(const result of ['not_found','ambiguous','conflicting']) {
    const works=[{workId:'identity',createdAtMs:1,events:[{eventId:'identity-event',capabilityRef:'libra.product_identity.evidence.observe@1',state:'succeeded',result:{outcomeKind:'succeeded',committedAtMs:2,result:{result}}}]}];
    assert.equal(organizingSteps(works).find(step=>step.key==='identity').state,'blocked');
  }
});
