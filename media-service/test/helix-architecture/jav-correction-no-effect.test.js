'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {buildJavCorrectionScope,javCorrectionAssetsWorkId,SOURCE_CAPABILITY,CAPABILITY}=require('../../src/helix/domains/arca/model/jav-correction-execution-contract');
const {buildJavCorrectionNoEffectObservation}=require('../../src/helix/domains/arca/model/jav-correction-no-effect');
const {createJavCorrectionNoEffectReader}=require('../../src/helix/domains/arca/persistence/jav-correction-no-effect-reader');
const {buildJavCorrectionCancellationReceipt,SCHEMA}=require('../../src/helix/domains/arca/model/jav-correction-cancellation');
const digest=value=>canonicalDigest({value}),clone=value=>JSON.parse(JSON.stringify(value));
function fixture(){
  const active={state:'active',stateRevision:2,correctionId:'correction',shelfEntryId:'entry',admissionDigest:digest('admission'),
    proof:{basis:{basisDigest:digest('basis')},proposal:{proposalDigest:digest('proposal')}}},root=digest('root'),scope=buildJavCorrectionScope(active,root),workId=javCorrectionAssetsWorkId(scope),
    definition={workId,ownerDomain:'arca',processType:'arca_jav_identity_correction',processId:'correction',workKind:'jav_correction_assets',
      executionBasisDigest:scope.digest,dependencyRefs:[{ownerDomain:'arca',objectType:'jav_identity_correction',objectId:'correction',revision:2,digest:active.admissionDigest}]},
    binding={portName:'javCorrectionScope',bindingKind:'projected_owner_facts',ownerDomain:'arca',processType:definition.processType,processId:'correction',
      projectionRef:'helix://arca/jav-correction-projections/Scope/v1',parameters:{expectedScopeDigest:scope.digest}},
    record={...active,state:'attention_required',stateRevision:3,terminalAtMs:null,terminalEvidenceDigest:null},
    snapshot={workspaceRootHandleRef:root,
      works:[{work_id:workId,owner_domain:'arca',process_type:definition.processType,process_id:'correction',work_kind:'jav_correction_assets',basis_digest:scope.digest,
        definition_schema_ref:'helix://foundation/types/SupportingWorkDefinition/v1',definition_json:canonicalJson(definition),definition_digest:canonicalDigest(definition),state:'failed'}],
      attempts:[{attempt_id:'work-attempt',work_id:workId,ordinal:1,basis_digest:scope.digest,state:'failed',failure_code:'source_unavailable'}],
      plans:[{plan_id:'plan',attempt_id:'work-attempt',planner_ref:'helix://arca/planners/jav-correction-assets/v1',planner_version:1,basis_digest:scope.digest,graph_digest:digest('plan'),state:'planned'}],
      nodes:[{plan_id:'plan',node_id:'source',capability_ref:SOURCE_CAPABILITY,effect_class:'pure_observation',input_bindings_json:canonicalJson({bindings:[binding]})},
        {plan_id:'plan',node_id:'assets',capability_ref:CAPABILITY,effect_class:'workspace_write',input_bindings_json:canonicalJson({bindings:[binding,
          {bindingKind:'projected_event_result',eventId:'source-event'}]})}],
      edges:[{plan_id:'plan',from_node_id:'source',to_node_id:'assets',dependency_kind:'success'}],
      events:[{event_id:'source-event',plan_id:'plan',node_id:'source',work_id:workId,attempt_id:'work-attempt',owner_domain:'arca',capability_ref:SOURCE_CAPABILITY,state:'failed',result_id:null},
        {event_id:'assets-event',plan_id:'plan',node_id:'assets',work_id:workId,attempt_id:'work-attempt',owner_domain:'arca',capability_ref:CAPABILITY,state:'cancelled',result_id:null}],
      eventAttempts:[{event_attempt_id:'source-attempt',event_id:'source-event',ordinal:1,state:'completed',outcome_kind:'failed',failure_code:'SOURCE_UNAVAILABLE'}],
      effects:[],results:[],registries:[],materials:[],artifacts:[]};
  return {record,currentBasisDigest:record.proof.basis.basisDigest,snapshot};
}
const rejected=input=>assert.throws(()=>buildJavCorrectionNoEffectObservation(input),{code:'ARCA_JAV_CORRECTION_NO_EFFECT_UNPROVEN'});
test('cancellation Receipt binds the current admission and exact no-effect digest under its closed nominal schema',()=>{
  const input=fixture(),observation=buildJavCorrectionNoEffectObservation(input),receipt=buildJavCorrectionCancellationReceipt(input.record,observation,100),
    validator=require('../../src/helix/foundation/capability/contract-validator').createCapabilityContractValidator({schemas:[
      require('../../scripts/helix-architecture/arca-application-schema-builder').buildArcaApplicationSchemas().ArcaJavCorrectionCancellationReceipt]});
  validator.validate(SCHEMA,receipt);const {receiptDigest,...body}=receipt;assert.equal(receiptDigest,canonicalDigest(body));
  for(const observationChange of [{observationDigest:digest('tampered')},{correctionId:'other'},{schema:'foreign'},{expectedStateRevision:2}])
    assert.throws(()=>buildJavCorrectionCancellationReceipt(input.record,{...observation,...observationChange},100),{code:'ARCA_JAV_CORRECTION_CANCEL_STALE'});
  assert.throws(()=>validator.validate(SCHEMA,{...receipt,ignoredExtra:'not allowed'}),{code:'P4_CAPABILITY_SCHEMA_REJECTED'});
});
test('source-only failure observation preserves actual active scope and is not a terminal cancellation',()=>{
  const input=fixture(),before=clone(input),result=buildJavCorrectionNoEffectObservation(input),{observationDigest,...body}=result;
  assert.equal(observationDigest,canonicalDigest(body));assert.equal(result.expectedStateRevision,3);
  assert.equal(result.scopeDigest,input.snapshot.works[0].basis_digest);assert.equal(result.failures[0].failureCode,'SOURCE_UNAVAILABLE');
  assert.equal(result.state,undefined);assert.deepEqual(input,before);
  input.snapshot.eventAttempts.push({...input.snapshot.eventAttempts[0],event_attempt_id:'retry',ordinal:2});
  assert.equal(buildJavCorrectionNoEffectObservation(input).failures.length,2);
});
test('repeated source-only failures remain cancellable only through the complete immutable recovery lineage',()=>{
  const input=fixture();input.record.updatedAtMs=10;input.record.cleanupState=null;
  const old=input.snapshot,original=old.works[0],reality={schema:'arca.jav-correction-recovery-reality@1',correctionId:input.record.correctionId,
    phase:'jav_correction_assets',observedAtMs:10,classification:'matching',files:[],directories:[]},
    observation={schema:'arca.jav-correction-recovery-observation@1',correctionId:input.record.correctionId,admissionDigest:input.record.admissionDigest,stateRevision:3,updatedAtMs:10,
      previousIntentDigest:null,scopeDigest:original.basis_digest,executionRevision:2,filePlanDigest:null,sourceResultReference:null,realityClassification:'matching',realityDigest:canonicalDigest(reality),realityObservation:reality,executionSnapshot:{},
      failedWork:{ownerDomain:'arca',processType:'arca_jav_identity_correction',processId:input.record.correctionId,state:'failed',hasUnresolvedEffects:false,
        workKind:'jav_correction_assets',baseWorkId:original.work_id,workId:original.work_id,definitionDigest:original.definition_digest,executionEvidenceDigest:digest('execution'),basisDigest:original.basis_digest}},
    receipt=require('../../src/helix/domains/arca/model/jav-correction-recovery').buildJavCorrectionRecoveryReceipt({record:input.record,
      command:{shelfEntryId:input.record.shelfEntryId,correctionId:input.record.correctionId,actorId:'admin',idempotencyKey:'recover',expectedStateRevision:3,
        expectedAdmissionDigest:input.record.admissionDigest,expectedCleanupState:null,expectedRecoveryIntentDigest:null},
      observation:{...observation,observationDigest:canonicalDigest(observation)},admittedAtMs:11}),
    workId=receipt.workLineage[0].workId,second=clone(old),definition=JSON.parse(second.works[0].definition_json);
  definition.workId=workId;definition.dependencyRefs[0].revision=4;definition.dependencyRefs.push({ownerDomain:'arca',objectType:'jav_correction_recovery_intent',objectId:receipt.recoveryId,revision:4,digest:receipt.receiptDigest});
  Object.assign(second.works[0],{work_id:workId,definition_json:canonicalJson(definition),definition_digest:canonicalDigest(definition)});
  Object.assign(second.attempts[0],{attempt_id:'second-work-attempt',work_id:workId});second.plans[0].attempt_id='second-work-attempt';second.plans[0].plan_id='second-plan';
  for(const node of second.nodes){node.plan_id='second-plan';if(node.capability_ref===CAPABILITY){const value=JSON.parse(node.input_bindings_json);value.bindings[1].eventId='second-source-event';node.input_bindings_json=canonicalJson(value);}}
  second.edges[0].plan_id='second-plan';for(const event of second.events){event.work_id=workId;event.plan_id='second-plan';event.attempt_id='second-work-attempt';event.event_id='second-'+event.event_id;}
  Object.assign(second.eventAttempts[0],{event_attempt_id:'second-source-attempt',event_id:'second-source-event'});
  for(const key of ['works','attempts','plans','nodes','edges','events','eventAttempts'])old[key].push(...second[key]);
  input.record.stateRevision=5;input.record.recoveryIntent=receipt;input.recoveryHistory=[receipt];
  const result=buildJavCorrectionNoEffectObservation(input);assert.equal(result.workId,workId);assert.equal(result.failures.length,2);
  assert.deepEqual(result.sourceFailureHistory.map(item=>item.admissionRevision),[2,4]);assert.equal(result.failures[0].workId,original.work_id);
  const cancelled=buildJavCorrectionCancellationReceipt(input.record,result,20);assert.equal(cancelled.stateRevision,6);assert.equal(cancelled.failedSourceAttemptsDigest,canonicalDigest(result.failures));
  rejected({...input,recoveryHistory:[]});rejected({...input,recoveryHistory:[receipt,receipt]});
  const extra=clone(input);extra.snapshot.works.push({...original,work_id:'not-authorized'});rejected(extra);
  const orphan=clone(input);orphan.snapshot.eventAttempts.push({...orphan.snapshot.eventAttempts[0],event_attempt_id:'unknown',event_id:'unknown'});rejected(orphan);
  const output=clone(input);output.snapshot.materials.push({material_handle_id:'written'});rejected(output);
});
test('any file attempt, Effect, output registration or extra Work prevents no-effect eligibility',()=>{
  for(const key of ['effects','results','registries','materials','artifacts']){const input=fixture();input.snapshot[key].push({state:'failed'});rejected(input);}
  const assetsAttempt=fixture();assetsAttempt.snapshot.eventAttempts.push({...assetsAttempt.snapshot.eventAttempts[0],event_attempt_id:'assets-attempt',event_id:'assets-event',ordinal:1});rejected(assetsAttempt);
  for(const state of ['pending','ready','executing','succeeded','skipped']){const input=fixture();input.snapshot.events[1].state=state;rejected(input);}
  const extra=fixture();extra.snapshot.works.push({...extra.snapshot.works[0],work_id:'late-stage'});rejected(extra);
});
test('stale Entry, admission, scope, current state and foreign or incomplete execution proof are rejected',()=>{
  const mutations=[x=>x.currentBasisDigest=digest('changed'),x=>x.record.state='active',x=>x.record.terminalAtMs=1,x=>x.record.terminalEvidenceDigest=digest('terminal'),
    x=>x.record.admissionDigest=digest('other'),x=>x.snapshot.workspaceRootHandleRef=digest('other-root'),x=>x.snapshot.works[0].state='running',
    x=>x.snapshot.works[0].definition_digest=digest('tampered'),x=>x.snapshot.events[0].owner_domain='libra',x=>x.snapshot.events[0].attempt_id='other-attempt',
    x=>x.snapshot.events[0].result_id='hidden-result',x=>x.snapshot.nodes[0].effect_class='workspace_write',x=>x.snapshot.nodes[0].input_bindings_json='{',
    x=>x.snapshot.edges[0].dependency_kind='terminal',x=>x.snapshot.eventAttempts[0].state='executing',x=>x.snapshot.eventAttempts[0].outcome_kind='succeeded',
    x=>x.snapshot.eventAttempts[0].ordinal=2,x=>x.snapshot.plans[0].state='contract_unplannable',x=>x.snapshot.attempts.push({...x.snapshot.attempts[0]}),
    x=>x.snapshot.eventAttempts=[],x=>x.snapshot.events.pop()];
  for(const mutate of mutations){const input=fixture();mutate(input);rejected(input);}
});
test('owner-bound observation participant reads every negative evidence set with explicit bounds',()=>{
  const input=fixture(),schemaManifest=require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),calls=[],
    reader=createJavCorrectionNoEffectReader({schemaManifest,rootSnapshot:{rootHandleRef:input.snapshot.workspaceRootHandleRef}}),
    participant=reader.participant({record:input.record,currentBasisDigest:input.currentBasisDigest}),map={event_attempts:'eventAttempts'},
    repo={invoke(name,parameters){calls.push({name,parameters});assert.equal(parameters.limit,65);assert.equal(parameters.offset,0);
      return input.snapshot[map[name]||name].filter(row=>Object.entries(parameters).every(([key,value])=>
        ['offset','limit'].includes(key)||!Object.hasOwn(row,key)||row[key]===value));}};
  assert.equal(participant.owner,'execution-foundation');assert.equal(participant.boundBusinessOwner,'arca');assert.equal(participant.repositories[0].readOnly,true);
  assert.equal(participant.execute({repository:()=>repo}).correctionId,'correction');
  assert.deepEqual(calls.find(item=>item.name==='works').parameters,{owner_domain:'arca',process_type:'arca_jav_identity_correction',process_id:'correction',offset:0,limit:65});
  assert.ok(['effects','registries','materials','artifacts','results'].every(name=>calls.some(item=>item.name===name)));
  input.snapshot.attempts[0].ordinal=1n;input.snapshot.plans[0].planner_version=1n;input.snapshot.eventAttempts[0].ordinal=1n;
  assert.equal(participant.execute({repository:()=>repo}).failures[0].ordinal,1);
  input.snapshot.attempts[0].ordinal=BigInt(Number.MAX_SAFE_INTEGER)+1n;
  assert.throws(()=>participant.execute({repository:()=>repo}),{code:'ARCA_JAV_CORRECTION_NO_EFFECT_UNPROVEN'});
  input.snapshot.attempts[0].ordinal=1n;
  input.snapshot.works=Array.from({length:65},()=>input.snapshot.works[0]);
  assert.throws(()=>participant.execute({repository:()=>repo}),{code:'ARCA_JAV_CORRECTION_NO_EFFECT_UNPROVEN'});
});
