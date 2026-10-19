'use strict';
const {createReferenceAuditSource}=require('../../../foundation/persistence/reference-audit-source');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {POLICY}=require('../../../contracts/people-artifact-reclamation');
function createPeopleArtifactAuditSource(options){
  const source=createReferenceAuditSource({...options,owner:'people',sourceId:'people_current',
    points:[{table:'people_reference_assets',column:'artifact_handle_id'},{table:'people_reference_faces',column:'embedding_handle_id'}],
    epochs:[{table:'people_reference_assets',columns:['created_reference_revision','released_reference_revision']},
      {table:'people_reference_faces',columns:['created_reference_revision','released_reference_revision']},{table:'people_image_operations',columns:['created_at_ms','updated_at_ms']}],
    extraStatements:{operations:{kind:'select-summary',tableId:'people_image_operations',keyColumns:['person_id'],summaries:[{operator:'count',output:'rows'},{operator:'max',column:'updated_at_ms',output:'last_activity'}]},
      pending_operations:{kind:'select-summary',tableId:'people_image_operations',keyColumns:['person_id','state'],summaries:[{operator:'count',output:'rows'}]}},
    pointGuard(repo,artifactHandle,atMs){const operation=repo.invoke('operations',{person_id:artifactHandle.ownerScope.scopeId});
      return operation.rows===0n||repo.invoke('pending_operations',{person_id:artifactHandle.ownerScope.scopeId,state:'preparing'}).rows>0n||
        operation.last_activity!==null&&BigInt(atMs)-operation.last_activity<BigInt(POLICY.technicalAgeMs);}
  });
  const definition=createRepositoryDefinition({repositoryId:'people_reference_artifact_aliases',owner:'people',schemaManifest:options.schemaManifest,readOnly:true,statements:{
    assets:{kind:'select-in',tableId:'people_reference_assets',keyColumn:'reference_asset_id',columns:['reference_asset_id','artifact_handle_id'],maxItems:500},
    faces:{kind:'select-in',tableId:'people_reference_faces',keyColumn:'reference_asset_id',columns:['reference_asset_id','embedding_handle_id'],maxItems:500}
  }});
  function resolvesReferenceAssets(ids,handle){if(!Array.isArray(ids)||ids.length>4096||ids.some(id=>typeof id!=='string'||!id||id.length>256))throw new TypeError('Asset reference lookup exceeds its explicit bound.');
    return options.unitOfWork.execute([{participantId:'people_reference_artifact_aliases',owner:'people',readOnly:true,repositories:[definition],execute(tx){
      const repo=tx.repository(definition.repositoryId),face=handle.artifactKind==='reference-embedding';
      for(let index=0;index<ids.length;index+=500)if(repo.invoke(face?'faces':'assets',{values:ids.slice(index,index+500)}).some(row=>(face?row.embedding_handle_id:row.artifact_handle_id)===handle.artifactHandleId))return true;
      return false;
    }}]).people_reference_artifact_aliases;
  }
  return Object.freeze({...source,resolvesReferenceAssets});
}
module.exports=Object.freeze({createPeopleArtifactAuditSource});
