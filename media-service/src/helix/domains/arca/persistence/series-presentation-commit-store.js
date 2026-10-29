'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {createMaterialControlParticipant,createMaterialControlAdmissionReadParticipant,controlScopeDigest}=require('../../../foundation/persistence/material-control');
const {CAPS,buildSharedManifest}=require('../model/series-presentation');
const {seriesOutcome}=require('../model/series-presentation-outcome');
const {readControlProjections}=require('./read-control-projections');
const transaction=require('../../../contracts/transaction-contracts/helix.transaction.series-presentation-commit/v1/contract.json').contract;
const SCHEMA='helix://contracts/types/SeriesPresentationReady/v1';
const stable=(prefix,value)=>prefix+canonicalDigest(value).slice(0,40);
const fail=message=>{throw Object.assign(new Error(message),{code:'ARCA_SERIES_COMMIT_INTEGRITY'});};
function createSeriesPresentationCommitStore(options){
  const store=options.seriesStore,foundation=createRepositoryDefinition({repositoryId:'arca_series_commit_foundation',owner:'execution-foundation',schemaManifest:options.schemaManifest,statements:{
    work:{kind:'select-one',tableId:'fx_supporting_works',columns:['owner_domain','process_type','process_id','state','basis_digest'],keyColumns:['work_id']},
    event:{kind:'select-one',tableId:'fx_workflow_events',columns:['work_id','capability_ref','state'],keyColumns:['event_id']},
    attempt:{kind:'select-one',tableId:'fx_event_attempts',columns:['event_id','state'],keyColumns:['event_attempt_id']},
    result:{kind:'select-one',tableId:'fx_event_result_bindings',columns:['result_id','event_id','outcome_kind','result_schema_ref','result_json','result_digest','evidence_schema_ref','evidence_json','evidence_digest','effect_receipt_id','committed_at_ms'],keyColumns:['event_id'],safeIntegers:true},
    marker:{kind:'select-one',tableId:'fx_commit_markers',columns:['commit_marker','effect_id','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms'],keyColumns:['commit_marker'],safeIntegers:true},
    insert_result:{kind:'insert',tableId:'fx_event_result_bindings',columns:['result_id','event_id','outcome_kind','result_schema_ref','result_json','result_digest','evidence_schema_ref','evidence_json','evidence_digest','effect_receipt_id','committed_at_ms']},
    insert_marker:{kind:'insert',tableId:'fx_commit_markers',columns:['commit_marker','effect_id','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms']},
  }});
  const participant=(id,execute)=>({participantId:id,owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[foundation],execute:c=>execute(c.repository(foundation.repositoryId),c)});
  function executionFence(r,execution,scope,active){
    const work=r.invoke('work',{work_id:execution.workId}),event=r.invoke('event',{event_id:execution.eventId}),attempt=r.invoke('attempt',{event_attempt_id:execution.eventAttemptId});
    if(execution.capabilityRef!==CAPS.commit||execution.ownerScope?.domain!=='arca'||execution.ownerScope.processType!=='arca_series_presentation'||execution.ownerScope.processId!==scope.objectId||
        work?.owner_domain!=='arca'||work.process_type!=='arca_series_presentation'||work.process_id!==scope.objectId||work.basis_digest!==scope.digest||
        event?.work_id!==execution.workId||event.capability_ref!==CAPS.commit||attempt?.event_id!==execution.eventId||
        active&&(work.state!=='running'||event.state!=='executing'||attempt.state!=='executing'))fail('Shared commit lost its executing Work, Event or Attempt.');
  }
  function readEvent(execution){
    const scope=execution.namedInputs?.seriesPresentationScope;if(!scope)return null;
    const replay=options.unitOfWork.execute([participant('arca_series_commit_replay',r=>{
      const row=r.invoke('result',{event_id:execution.eventId});if(!row)return null;
      if(row.result_schema_ref!==SCHEMA||row.outcome_kind!=='succeeded')fail('Shared commit Event already has another result.');
      const result=JSON.parse(row.result_json);options.contractValidator.validate(SCHEMA,result);executionFence(r,execution,scope,false);
      const outcome=seriesOutcome(CAPS.commit,result,scope,execution,'responsibility_control_commit'),marker=r.invoke('marker',{commit_marker:outcome.effectReceipt.commitMarker});
      if(result.scopeId!==scope.scopeId||result.buildId!==scope.objectId||result.scopeDigest!==scope.digest||result.commitMarker!==outcome.effectReceipt.commitMarker||
          row.result_digest!==canonicalDigest(result)||row.result_json!==canonicalJson(result)||row.evidence_json!==canonicalJson(outcome.evidence)||
          row.evidence_digest!==canonicalDigest(outcome.evidence)||row.evidence_schema_ref!==outcome.evidenceSchemaRef||row.effect_receipt_id!==outcome.effectReceipt.effectReceiptId||
          marker?.effect_id!==outcome.effectReceipt.effectId||marker.scope_type!=='series_presentation'||marker.scope_id!==scope.scopeId||marker.owner_domain!=='arca'||
          marker.result_id!==row.result_id||marker.result_digest!==row.result_digest||marker.commit_digest!==canonicalDigest(outcome.evidence)||Number(marker.committed_at_ms)!==result.committedAtMs)
        fail('Shared Ready lacks its exact atomic Result and marker.');
      return outcome;
    })]).arca_series_commit_replay;
    if(replay){const stored=store.manifest(replay.result.scopeId,replay.result.sharedVersion);
      if(!stored||stored.value.buildId!==scope.objectId||stored.value.digest!==replay.result.manifestDigest||stored.verificationDigest!==replay.result.verificationDigest)fail('Ready replay lacks its immutable shared Inventory version.');}
    return replay;
  }
  function commit(execution,{scope,manifest,verificationDigest}){
    const prior=readEvent(execution);if(prior)return prior;
    if(buildSharedManifest(scope,manifest.members).digest!==manifest.digest||!/^[a-f0-9]{64}$/.test(verificationDigest))fail('Shared commit lacks complete frozen verification.');
    const marker=stable('arca-series-effect-marker-',{eventId:execution.eventId}),keys=[...new Set([...manifest.members,...scope.existingMembers].map(member=>member.physicalIdentity.materialKey))].sort(),projections=readControlProjections(options.materialControlProjectionPort,keys);
    let atomic;
    const refs=options.workResultReader.read(execution.workId).filter(row=>row.outcomeKind==='succeeded'&&[CAPS.source,CAPS.assets,CAPS.publish].includes(row.capabilityRef));
    const readers=[participant('arca_series_commit_fence',r=>{
      executionFence(r,execution,scope,true);
      const published=execution.namedInputs.seriesPresentationFilesPublished;
      if(!published||canonicalJson(published.manifest)!==canonicalJson(manifest))fail('Shared commit changed its exact published result.');
      if(refs.length!==3||new Set(refs.map(ref=>ref.capabilityRef)).size!==3)fail('Shared commit requires its complete successful source, assets and publication.');
      for(const ref of refs){const row=r.invoke('result',{event_id:ref.eventId}),event=r.invoke('event',{event_id:ref.eventId});
        if(event?.work_id!==execution.workId||event.state!=='succeeded'||event.capability_ref!==ref.capabilityRef||row?.outcome_kind!=='succeeded'||
            row.result_digest!==canonicalDigest(ref.result)||row.result_json!==canonicalJson(ref.result)||ref.result.scopeDigest!==scope.digest)
          fail('Shared commit predecessor Result changed.');}
      if(!refs.some(ref=>ref.capabilityRef===CAPS.publish&&canonicalJson(ref.result)===canonicalJson(published)))fail('Shared published input is not the successful predecessor.');
    }),store.scopeParticipant(scope),createMaterialControlAdmissionReadParticipant({...options,boundBusinessOwner:'arca',participantId:'arca_series_control_read',materialKeys:keys,
      accept:items=>{if(canonicalJson(items)!==canonicalJson(projections))fail('Shared Control changed before its atomic CAS.');}})];
    const prepare={participantId:'arca_series_commit_controls',owner:'arca',repositories:[],execute(){
      const owner={ownerDomain:'arca',scopeType:'series_presentation',scopeId:scope.scopeId};
      const changes=manifest.members.map(member=>{const projection=projections.find(row=>row.materialKey===member.physicalIdentity.materialKey);
        if(!projection||projection.resultKind!=='available')fail('Shared Control projection is unavailable.');
        const controlled=projection.controlState==='controlled';
        if(controlled&&(projection.ownerDomain!=='arca'||projection.ownerScopeType!==owner.scopeType||projection.ownerScopeId!==owner.scopeId))fail('Shared material is controlled by another responsibility.');
        return {identity:member.physicalIdentity,expectedRevision:projection.controlRevision||0,expectedProjectionDigest:projection.projectionDigest,
          action:controlled?'assert_same_field':'acquire',...(controlled?{fromScope:owner}:{toScope:owner})};});
      for(const prior of scope.existingMembers.filter(member=>!manifest.members.some(item=>item.physicalIdentity.materialKey===member.physicalIdentity.materialKey))){
        const projection=projections.find(row=>row.materialKey===prior.physicalIdentity.materialKey);
        if(projection?.controlState!=='controlled'||projection.ownerDomain!=='arca'||projection.ownerScopeType!==owner.scopeType||projection.ownerScopeId!==owner.scopeId)
          fail('Retired shared identity no longer belongs to its exact responsibility.');
        changes.push({identity:prior.physicalIdentity,action:'release',fromScope:owner,expectedRevision:projection.controlRevision,expectedProjectionDigest:projection.projectionDigest});
      }
      const digest=controlScopeDigest(changes),handle={schemaRef:'helix://contracts/types/ResponsibilityControlCommitHandle/v1',schemaVersion:1,
        handleId:stable('arca-series-control-',{eventId:execution.eventId}),operationKind:'replace_control_set',ownerDomain:'arca',processType:'arca_series_presentation',processId:scope.objectId,
        basisRef:{objectType:'series_presentation_build',objectId:scope.objectId,revision:scope.revision,digest:scope.digest},basisDigest:scope.digest,
        canonicalFactSetDigest:manifest.digest,bindingSetDigest:verificationDigest,controlScopeDigest:digest,
        expectedControlRevisions:changes.map(item=>({materialKey:item.identity.materialKey,revision:item.expectedRevision})),
        receiptContract:{receiptSchemaRef:SCHEMA,controlRevisionSetSchemaRef:'arca.series-presentation-control-set@1'},eventFenceDigest:canonicalDigest({workId:execution.workId,eventId:execution.eventId})};
      return {handle,changes};
    }};
    const controls=prepare.execute();
    const control=createMaterialControlParticipant({...options,participantId:'arca_series_control',...controls,
      authorizedScopeDigest:controls.handle.controlScopeDigest,commitMarker:marker});
    const write=store.versionParticipant(scope,manifest,verificationDigest);
    const result=participant('arca_series_commit_result',(r,c)=>{
      const payload={scopeId:scope.scopeId,buildId:scope.objectId,scopeDigest:scope.digest,sharedVersion:manifest.revision,manifestDigest:manifest.digest,verificationDigest},
        value={schemaRef:SCHEMA,schemaVersion:1,factId:stable('arca-series-ready-',{eventId:execution.eventId}),ownerDomain:'arca',aggregateType:'series_presentation',aggregateId:scope.scopeId,
          revision:manifest.revision,factSchemaRef:SCHEMA,factDigest:canonicalDigest(payload),commitMarker:marker,committedAtMs:c.commitTimeMs,...payload};
      options.contractValidator.validate(SCHEMA,value);atomic=seriesOutcome(CAPS.commit,value,scope,execution,'responsibility_control_commit');
      const resultId=stable('arca-series-result-',{eventId:execution.eventId}),digest=canonicalDigest(value);
      r.invoke('insert_result',{result_id:resultId,event_id:execution.eventId,outcome_kind:'succeeded',result_schema_ref:SCHEMA,result_json:canonicalJson(value),result_digest:digest,
        evidence_schema_ref:atomic.evidenceSchemaRef,evidence_json:canonicalJson(atomic.evidence),evidence_digest:canonicalDigest(atomic.evidence),effect_receipt_id:atomic.effectReceipt.effectReceiptId,committed_at_ms:c.commitTimeMs});
      r.invoke('insert_marker',{commit_marker:marker,effect_id:atomic.effectReceipt.effectId,owner_domain:'arca',scope_type:'series_presentation',scope_id:scope.scopeId,
        commit_digest:canonicalDigest(atomic.evidence),result_id:resultId,result_schema_ref:SCHEMA,result_digest:digest,committed_at_ms:c.commitTimeMs});
    });
    const participants=[...readers,control,write,result],declared=new Set([...transaction.readTables,...transaction.writeTables]);
    if(participants.some(p=>p.repositories.some(repo=>repo.tableIds.some(table=>!declared.has(table)))))fail('Shared commit escaped its canonical transaction.');
    options.unitOfWork.execute(participants);return atomic;
  }
  return Object.freeze({readEvent,commit});
}
module.exports=Object.freeze({createSeriesPresentationCommitStore});
