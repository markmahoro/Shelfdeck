'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {CAPS}=require('../model/series-presentation');
const {seriesOutcome}=require('../model/series-presentation-outcome');
const {registryColumns,materialColumns,artifactColumns}=require('./series-presentation-workspace-store');
const transaction=require('../../../contracts/transaction-contracts/helix.transaction.series-presentation-workspace-reclaim/v1/contract.json').contract;
const SCHEMA='helix://contracts/types/SeriesPresentationWorkspaceReclaimed/v1';
const stable=(prefix,value)=>prefix+canonicalDigest(value).slice(0,40);
const fail=message=>{throw Object.assign(new Error(message),{code:'ARCA_SERIES_WORKSPACE_RECLAIM_FENCE'});};
function createSeriesWorkspaceReclaimStore(options){
  const repo=createRepositoryDefinition({repositoryId:'arca_series_reclamation',owner:'execution-foundation',schemaManifest:options.schemaManifest,statements:{
    registry:{kind:'select-one',tableId:'fx_workspace_registry',columns:registryColumns,keyColumns:['workspace_id'],safeIntegers:true},
    materials:{kind:'select-all',tableId:'fx_workspace_materials',columns:materialColumns,keyColumns:['workspace_id'],safeIntegers:true},
    artifact:{kind:'select-one',tableId:'fx_artifact_registry',columns:artifactColumns,keyColumns:['artifact_handle_id'],safeIntegers:true},
    reclaim_material:{kind:'update',tableId:'fx_workspace_materials',setColumns:['state','reclaimed_effect_id','reclaimed_effect_receipt_digest','reclaimed_at_ms'],keyColumns:['workspace_id','material_handle_id'],compareColumns:[{column:'state',parameter:'expected_state'},{column:'handle_digest',parameter:'expected_digest'}]},
    reclaim_artifact:{kind:'update',tableId:'fx_artifact_registry',setColumns:['state','reference_revision'],keyColumns:['artifact_handle_id'],compareColumns:[{column:'state',parameter:'expected_state'},{column:'reference_revision',parameter:'expected_revision'}]},
    reclaim_registry:{kind:'update',tableId:'fx_workspace_registry',setColumns:['state','reclaimed_at_ms'],keyColumns:['workspace_id'],compareColumns:[{column:'state',parameter:'expected_state'}]},
    work:{kind:'select-one',tableId:'fx_supporting_works',columns:['owner_domain','process_type','process_id','state','basis_digest'],keyColumns:['work_id']},
    event:{kind:'select-one',tableId:'fx_workflow_events',columns:['work_id','capability_ref','state'],keyColumns:['event_id']},
    attempt:{kind:'select-one',tableId:'fx_event_attempts',columns:['event_id','state'],keyColumns:['event_attempt_id']},
    result:{kind:'select-one',tableId:'fx_event_result_bindings',columns:['result_id','result_schema_ref','result_json','result_digest','evidence_schema_ref','evidence_json','evidence_digest','effect_receipt_id'],keyColumns:['event_id']},
    retirement:{kind:'select-one',tableId:'fx_command_receipts',columns:['result_ref_json','result_digest'],keyColumns:['owner_domain','command_contract','idempotency_key']},
    marker:{kind:'select-one',tableId:'fx_commit_markers',columns:['effect_id','scope_id','commit_digest','result_id','result_digest'],keyColumns:['commit_marker']},
    insert_result:{kind:'insert',tableId:'fx_event_result_bindings',columns:['result_id','event_id','outcome_kind','result_schema_ref','result_json','result_digest','evidence_schema_ref','evidence_json','evidence_digest','effect_receipt_id','committed_at_ms']},
    insert_marker:{kind:'insert',tableId:'fx_commit_markers',columns:['commit_marker','effect_id','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms']},
  }});
  const participant=(id,execute)=>({participantId:id,owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[repo],execute:c=>execute(c.repository(repo.repositoryId),c)});
  function readEvent(execution,scope){return options.unitOfWork.execute([participant('arca_series_reclaimed_read',r=>{
    const row=r.invoke('result',{event_id:execution.eventId});if(!row)return null;
    if(row.result_schema_ref!==SCHEMA)fail('Reclamation Event has another Result.');const result=JSON.parse(row.result_json);
    options.contractValidator.validate(SCHEMA,result);const value=seriesOutcome(CAPS.reclaim,result,scope,execution,'workspace_write'),marker=r.invoke('marker',{commit_marker:value.effectReceipt.commitMarker});
    if(result.scopeDigest!==scope.digest||row.result_digest!==canonicalDigest(result)||row.evidence_json!==canonicalJson(value.evidence)||row.evidence_digest!==canonicalDigest(value.evidence)||
        row.effect_receipt_id!==value.effectReceipt.effectReceiptId||marker?.effect_id!==value.effectReceipt.effectId||marker.result_id!==row.result_id||marker.result_digest!==row.result_digest)
      fail('Reclamation Result lacks its exact atomic marker.');return value;
  })]).arca_series_reclaimed_read;}
  function commit(execution,scope,basis,verifyAbsence){
    const prior=readEvent(execution,scope);if(prior){verifyAbsence();return prior;}
    const {prepared,ready}=basis,artifacts=basis.registeredArtifacts,handles=artifacts.map(item=>item.workspaceMaterialHandle),handleSetDigest=canonicalDigest(handles),workspaceId=scope.objectId+'-assets',refs=[...options.readReferences(scope),...(ready?options.readReferences(options.seriesStore.build(ready.buildId)):[])];let outcome;
    const writer=participant('arca_series_reclaimed_commit',(r,c)=>{
      const work=r.invoke('work',{work_id:execution.workId}),event=r.invoke('event',{event_id:execution.eventId}),attempt=r.invoke('attempt',{event_attempt_id:execution.eventAttemptId}),registry=r.invoke('registry',{workspace_id:workspaceId});
      if(execution.ownerScope?.domain!=='arca'||execution.ownerScope.processType!=='arca_series_presentation'||execution.ownerScope.processId!==scope.objectId||
          work?.owner_domain!=='arca'||work.process_type!=='arca_series_presentation'||work.process_id!==scope.objectId||work.state!=='running'||work.basis_digest!==scope.digest||
          event?.work_id!==execution.workId||event.capability_ref!==CAPS.reclaim||event.state!=='executing'||attempt?.event_id!==execution.eventId||attempt.state!=='executing'||
          (registry?(!['active','reclaimed'].includes(registry.state)||registry.owner_domain!=='arca'||registry.process_id!==scope.objectId||registry.root_handle_ref!==options.rootSnapshot.rootHandleRef):handles.length>0))
        fail('Reclamation execution or Workspace changed.');
      const rows=r.invoke('materials',{workspace_id:workspaceId});
      if(rows.length!==handles.length||rows.some(row=>row.state!=='active'||!handles.some(handle=>handle.handleId===row.material_handle_id&&canonicalJson(handle)===row.handle_json&&canonicalDigest(handle)===row.handle_digest)))
        fail('Reclamation registry differs from the successful Assets Result.');
      for(const ref of refs){const saved=r.invoke('result',{event_id:ref.eventId});if(saved?.result_digest!==canonicalDigest(ref.result)||saved.result_json!==canonicalJson(ref.result))fail('Reclamation source Result changed.');}
      if(ready&&!refs.some(ref=>ref.result.schemaRef===ready.schemaRef&&canonicalJson(ref.result)===canonicalJson(ready))||prepared&&!refs.some(ref=>canonicalJson(ref.result)===canonicalJson(prepared))||basis.sourceObserved&&!refs.some(ref=>canonicalJson(ref.result)===canonicalJson(basis.sourceObserved)))fail('Reclamation lacks its exact actual successful source Results.');
      if(basis.kind==='retired'){const saved=r.invoke('retirement',{owner_domain:'arca',command_contract:'arca.series-presentation.retained-retirement@1',idempotency_key:scope.objectId});if(saved?.result_digest!==canonicalDigest(basis.retirementReceipt)||saved.result_ref_json!==canonicalJson(basis.retirementReceipt))fail('Reclamation lacks the atomic retained-root retirement.');}
      verifyAbsence();const at=c.commitTimeMs,result={schemaRef:SCHEMA,schemaVersion:1,receiptId:stable('arca-series-reclaimed-',{eventId:execution.eventId}),receiptKind:'series_workspace_reclaimed',
        ownerDomain:'arca',scopeType:'series_presentation_build',scopeId:scope.objectId,scopeDigest:scope.digest,effectReceiptRef:stable('arca-series-effect-receipt-',{eventId:execution.eventId}),committedAtMs:at,
        buildId:scope.objectId,reclamationBasisDigest:basis.digest,handleSetDigest,reclaimedCount:handles.length,reclaimedBytes:handles.reduce((sum,row)=>sum+row.sizeBytes,0)};
      options.contractValidator.validate(SCHEMA,result);outcome=seriesOutcome(CAPS.reclaim,result,scope,execution,'workspace_write');
      for(const item of artifacts){const handle=item.workspaceMaterialHandle,artifact=item.artifactHandle,registered=r.invoke('artifact',{artifact_handle_id:artifact.artifactHandleId});
        if(registered?.state!=='active'||registered.digest_hex!==artifact.digestHex||registered.owner_scope_id!==scope.objectId)fail('Reclamation Artifact changed.');
        if(r.invoke('reclaim_material',{workspace_id:workspaceId,material_handle_id:handle.handleId,expected_state:'active',expected_digest:canonicalDigest(handle),state:'reclaimed',
            reclaimed_effect_id:outcome.effectReceipt.effectId,reclaimed_effect_receipt_digest:canonicalDigest(result),reclaimed_at_ms:at}).changes!==1)fail('Reclamation Material CAS failed.');
        if(r.invoke('reclaim_artifact',{artifact_handle_id:artifact.artifactHandleId,expected_state:'active',expected_revision:artifact.referenceRevision,state:'deleted',reference_revision:artifact.referenceRevision+1}).changes!==1)fail('Reclamation Artifact CAS failed.');
      }
      if(registry?.state==='active'&&r.invoke('reclaim_registry',{workspace_id:workspaceId,expected_state:'active',state:'reclaimed',reclaimed_at_ms:at}).changes!==1)fail('Reclamation Workspace CAS failed.');
      const resultId=stable('arca-series-reclaim-result-',{eventId:execution.eventId}),digest=canonicalDigest(result);
      r.invoke('insert_result',{result_id:resultId,event_id:execution.eventId,outcome_kind:'succeeded',result_schema_ref:SCHEMA,result_json:canonicalJson(result),result_digest:digest,
        evidence_schema_ref:outcome.evidenceSchemaRef,evidence_json:canonicalJson(outcome.evidence),evidence_digest:canonicalDigest(outcome.evidence),effect_receipt_id:outcome.effectReceipt.effectReceiptId,committed_at_ms:at});
      r.invoke('insert_marker',{commit_marker:outcome.effectReceipt.commitMarker,effect_id:outcome.effectReceipt.effectId,owner_domain:'arca',scope_type:'series_presentation_build',scope_id:scope.objectId,
        commit_digest:canonicalDigest(outcome.evidence),result_id:resultId,result_schema_ref:SCHEMA,result_digest:digest,committed_at_ms:at});
    });
    const participants=[options.seriesStore.reclamationScopeParticipant(scope,basis),options.seriesWorkspaceStore.rootParticipant(),writer],declared=new Set([...transaction.readTables,...transaction.writeTables]);
    if(participants.some(p=>p.repositories.some(repository=>repository.tableIds.some(table=>!declared.has(table)))))fail('Reclamation escaped its canonical transaction.');
    options.unitOfWork.execute(participants);return outcome;
  }
  return Object.freeze({readEvent,commit});
}
module.exports=Object.freeze({createSeriesWorkspaceReclaimStore});
