'use strict';

const {canonicalDigest}=require('../../../contracts/canonical-json');
const {createCommandCommitCoordinator}=require('../../../foundation/persistence/commit-foundation');
const {appendInventoryRevision}=require('./inventory-revision-writer');
const {isAftercareArtifactMaterial}=require('../model/aftercare-contract');

const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const COMMAND='arca.inventory.records.refresh@1';
const RECEIPT='helix://arca/receipts/InventoryRecordRefreshReceipt/v1';

function createInventoryRecordRefreshStore(options,repository){
  const coordinator=createCommandCommitCoordinator(options);
  return Object.freeze({commit(request){
    const {shelfEntryId,expectedInventoryRevision,observationDigest,observations}=request;
    if(!Number.isSafeInteger(expectedInventoryRevision)||expectedInventoryRevision<1||!Array.isArray(observations)||
      !observations.length||observations.length>256||new Set(observations.map(item=>item.ordinal)).size!==observations.length||
      canonicalDigest(observations)!==observationDigest||typeof request.validateObservation!=='function'||!request.controlParticipant)
      fail('ARCA_RECORD_REFRESH_INVALID','Inventory record refresh requires exact bounded observations and Control authority.');
    const identity={shelfEntryId,expectedInventoryRevision,observationDigest},key=canonicalDigest(identity),
      requestDigest=canonicalDigest({...identity,expectedInventoryDigest:request.expectedInventoryDigest,
        standardRevision:request.standardRevision,placementRevision:request.placementRevision,
        canonicalIdentityRevision:request.canonicalIdentityRevision});
    const result=coordinator.execute({
      command:{commandReceiptId:'arca-record-refresh-'+key,ownerDomain:'arca',commandContract:COMMAND,
        callerScope:'health_reconciliation',idempotencyKey:key,requestDigest,targetType:'shelf_entry',targetId:shelfEntryId},
      controlParticipant:request.controlParticipant,
      domainParticipant:{participantId:'arca_inventory_record_refresh',owner:'arca',repositories:[repository],execute(context){
        const repo=context.repository(repository.repositoryId),entry=repo.invoke('find_entry',{shelf_entry_id:shelfEntryId}),
          shelf=entry&&repo.invoke('find_shelf',{shelf_id:entry.shelf_id});
        if(!entry||entry.status!=='active'||!shelf||shelf.status!=='active'||
          Number(entry.current_inventory_revision)!==expectedInventoryRevision||
          Number(entry.canonical_identity_revision)!==request.canonicalIdentityRevision||
          Number(shelf.current_standard_revision)!==request.standardRevision||Number(shelf.current_placement_revision)!==request.placementRevision)
          fail('ARCA_RECORD_REFRESH_STALE','Inventory record refresh Basis changed.');
        if(repo.invoke('list_cases',{shelf_entry_id:shelfEntryId}).some(item=>item.state==='active')||
          repo.invoke('list_reservations',{shelf_entry_id:shelfEntryId}).some(item=>item.state==='active'))
          fail('ARCA_RECORD_REFRESH_FENCED','Active processing or Off-deck prevents record refresh.');
        const inventory=repo.invoke('find_inventory',{shelf_entry_id:shelfEntryId,revision:expectedInventoryRevision});
        if(!inventory||inventory.representation_digest!==request.expectedInventoryDigest)
          fail('ARCA_RECORD_REFRESH_STALE','Inventory record snapshot changed.');
        const scope={shelf_entry_id:shelfEntryId,inventory_revision:expectedInventoryRevision},
          oldMaterials=repo.invoke('list_materials',scope).sort((a,b)=>Number(a.ordinal)-Number(b.ordinal)),
          byOrdinal=new Map(observations.map(item=>[item.ordinal,item]));
        if(observations.some(item=>!oldMaterials.some(row=>Number(row.ordinal)===item.ordinal)))
          fail('ARCA_RECORD_REFRESH_UNKNOWN_MEMBER','Record refresh cannot introduce an unknown member.');
        const materials=oldMaterials.map(row=>{
          const observation=byOrdinal.get(Number(row.ordinal));if(!observation)return row;
          if(row.role==='primary_payload'||!isAftercareArtifactMaterial(row,'nfo')||observation.previousMaterialKey!==row.material_key||
            observation.endpointId!==row.endpoint_id||observation.location!==row.location||
            observation.identity.mountScopeId!==row.mount_scope_id||observation.identity.materialKey===row.material_key)
            fail('ARCA_RECORD_REFRESH_MEMBER_INVALID','Only changed, known NFO bindings may be refreshed.');
          request.validateObservation(observation);
          const physical=observation.identity;
          return {...row,material_key:physical.materialKey,inode:physical.inode,size_bytes:physical.sizeBytes,
            fingerprint_algorithm:physical.fingerprintAlgorithm,fingerprint_version:String(physical.fingerprintVersion),
            content_fingerprint:physical.contentFingerprint,digest_hex:observation.digestHex,binding_revision:Number(row.binding_revision)+1};
        });
        const next=expectedInventoryRevision+1,value={shelfEntryId,materials,
          related:repo.invoke('list_related',scope),facts:repo.invoke('list_facts',scope),people:repo.invoke('list_people',scope),
          representationDigest:canonicalDigest({schema:'arca.inventory-record-refresh@1',previousDigest:inventory.representation_digest,observationDigest})};
        appendInventoryRevision(repo,value,inventory,expectedInventoryRevision,next,context.commitTimeMs);
        return Object.freeze({schemaRef:RECEIPT,shelfEntryId,previousInventoryRevision:expectedInventoryRevision,newInventoryRevision:next,
          observationDigest,changedBindingCount:observations.length,controlChangeDigest:request.controlChangeDigest,committedAtMs:context.commitTimeMs});
      }},
      commitMarker:{commitMarker:'arca-record-refresh-'+key,scopeType:'shelf_entry',scopeId:shelfEntryId,commitDigest:requestDigest},
      auditRecords:[{auditId:'arca-record-refresh-audit-'+key,actorType:'system',action:'refresh_inventory_records',
        scopeType:'shelf_entry',scopeId:shelfEntryId,evidenceDigest:observationDigest}],
      resultEnvelope:receipt=>({resultSchemaRef:RECEIPT,resultRef:receipt}),
    });
    return Object.freeze({replayed:result.replayed,receipt:result.receipt.resultRef});
  }});
}
module.exports=Object.freeze({createInventoryRecordRefreshStore});
