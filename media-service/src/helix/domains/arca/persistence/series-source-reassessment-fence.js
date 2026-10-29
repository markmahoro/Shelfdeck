'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
function createSeriesSourceReassessmentFence(options,buildId,emptyWorkspaceProof=null){
  const repo=createRepositoryDefinition({repositoryId:'arca_series_source_reassessment',owner:'execution-foundation',schemaManifest:options.schemaManifest,statements:{
    works:{kind:'select-all',tableId:'fx_supporting_works',columns:['work_id','state','owner_domain','process_type','process_id'],keyColumns:['owner_domain','process_type','process_id']},
    events:{kind:'select-all',tableId:'fx_workflow_events',columns:['event_id','capability_ref','state'],keyColumns:['work_id']},
    attempts:{kind:'select-all',tableId:'fx_event_attempts',columns:['event_attempt_id','state','outcome_kind'],keyColumns:['event_id']},
    effects:{kind:'select-all',tableId:'fx_effect_journal',columns:['state'],keyColumns:['event_attempt_id']},
    registry:{kind:'select-one',tableId:'fx_workspace_registry',columns:['workspace_id','owner_domain','process_type','process_id','root_handle_ref','state'],keyColumns:['workspace_id']},
    materials:{kind:'select-all',tableId:'fx_workspace_materials',columns:['material_handle_id','handle_digest','state'],keyColumns:['workspace_id']},
    artifacts:{kind:'select-all',tableId:'fx_artifact_registry',columns:['artifact_handle_id','digest_hex','state'],keyColumns:['owner_domain','owner_scope_type','owner_scope_id']},
    reclaim_empty:{kind:'update',tableId:'fx_workspace_registry',setColumns:['state','reclaimed_at_ms'],keyColumns:['workspace_id'],compareColumns:[{column:'state',parameter:'expected_state'}]},
  }});
  return {proofDigest:canonicalDigest({schema:'arca.series-source-reassessment@1',buildId,absenceDigest:emptyWorkspaceProof?.absenceDigest||null}),participantId:'arca_series_source_reassessment_fence',owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[repo],execute(c){
    const r=c.repository(repo.repositoryId),works=r.invoke('works',{owner_domain:'arca',process_type:'arca_series_presentation',process_id:buildId});
    if(!works.length||works.some(row=>!['failed','cancelled'].includes(row.state)))throw Object.assign(new Error('Source reassessment requires terminal preparation attempts.'),{code:'ARCA_SERIES_SOURCE_REASSESSMENT_UNSAFE'});
    for(const work of works)for(const event of r.invoke('events',{work_id:work.work_id})){
      const attempts=r.invoke('attempts',{event_id:event.event_id});
      if(event.capability_ref!=='arca.series_presentation.source.observe@1'&&attempts.length){
        if(!emptyWorkspaceProof||event.capability_ref!=='arca.series_presentation.assets.prepare@1'||attempts.some(attempt=>attempt.state!=='completed'||!['failed','cancelled'].includes(attempt.outcome_kind)||r.invoke('effects',{event_attempt_id:attempt.event_attempt_id}).some(effect=>effect.state!=='failed')))
          throw Object.assign(new Error('A build with possible physical Effects must recover its frozen source.'),{code:'ARCA_SERIES_SOURCE_REASSESSMENT_UNSAFE'});
      }
    }
    if(emptyWorkspaceProof){const registry=r.invoke('registry',{workspace_id:emptyWorkspaceProof.workspaceId});
      const materials=r.invoke('materials',{workspace_id:emptyWorkspaceProof.workspaceId}),artifacts=r.invoke('artifacts',{owner_domain:'arca',owner_scope_type:'series_presentation',owner_scope_id:buildId}),expected=emptyWorkspaceProof.registeredArtifacts||[];
      if(registry&&(registry.owner_domain!=='arca'||registry.process_type!=='series_presentation'||registry.process_id!==buildId||registry.root_handle_ref!==emptyWorkspaceProof.rootHandleRef||registry.state!=='active')||
        materials.length!==expected.length||artifacts.length!==expected.length||materials.some(row=>row.state!=='active'||!expected.some(item=>item.workspaceMaterialHandle.handleId===row.material_handle_id&&canonicalDigest(item.workspaceMaterialHandle)===row.handle_digest))||artifacts.some(row=>row.state!=='active'||!expected.some(item=>item.artifactHandle.artifactHandleId===row.artifact_handle_id&&item.artifactHandle.digestHex===row.digest_hex))||emptyWorkspaceProof.verifyAbsence()!==emptyWorkspaceProof.absenceDigest)
        throw Object.assign(new Error('Empty Workspace proof changed before Source reassessment.'),{code:'ARCA_SERIES_SOURCE_REASSESSMENT_UNSAFE'});
      if(registry&&!emptyWorkspaceProof.readOnly&&!emptyWorkspaceProof.retainWorkspace&&r.invoke('reclaim_empty',{workspace_id:registry.workspace_id,expected_state:'active',state:'reclaimed',reclaimed_at_ms:c.commitTimeMs}).changes!==1)throw new Error('Empty Workspace changed concurrently.');
    }
    return true;
  }};
}
module.exports=Object.freeze({createSeriesSourceReassessmentFence});
