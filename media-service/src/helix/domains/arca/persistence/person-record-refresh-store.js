'use strict';
const {inventoryContentProfile}=require('../model/product-content-profile');
const {evidenceInventoryRevision}=require('./person-evidence-origin');
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {createCommandCommitCoordinator}=require('../../../foundation/persistence/commit-foundation');
const {appendInventoryRevision}=require('./inventory-revision-writer');
const {assertPersonRecordObservation,personProofBatchFits}=require('../model/person-record-observation');
const {assertNoJavCorrection}=require('./jav-correction-gate');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const COMMAND='arca.inventory.person-records.refresh@1',RECEIPT='helix://arca/receipts/InventoryRecordRefreshReceipt/v1';
function createPersonRecordRefreshStore(options,repository) {
  const coordinator=createCommandCommitCoordinator(options);
  return Object.freeze({commit(request) {
    const {shelfEntryId,expectedInventoryRevision,observations}=request;
    if(!Number.isSafeInteger(expectedInventoryRevision)||expectedInventoryRevision<1||!Array.isArray(observations)||
      !observations.length||observations.length>64||new Set(observations.map(item=>item.relationId)).size!==observations.length)
      fail('ARCA_PERSON_RECORD_INPUT_INVALID','Person record refresh requires a bounded exact relation set.');
    if(!personProofBatchFits(observations))fail('ARCA_PERSON_RECORD_PROOF_BUDGET','Person proof batch exceeds the receipt budget.');
    const observationDigest=canonicalDigest(observations),identity={shelfEntryId,expectedInventoryRevision,observationDigest},
      key=canonicalDigest(identity),requestDigest=canonicalDigest({...identity,expectedInventoryDigest:request.expectedInventoryDigest,
        standardRevision:request.standardRevision,placementRevision:request.placementRevision,canonicalIdentityRevision:request.canonicalIdentityRevision});
    const result=coordinator.execute({command:{commandReceiptId:'arca-person-record-'+key,ownerDomain:'arca',commandContract:COMMAND,
      callerScope:'health_reconciliation',idempotencyKey:key,requestDigest,targetType:'shelf_entry',targetId:shelfEntryId},
      domainParticipant:{participantId:'arca_person_record_refresh',owner:'arca',repositories:[repository],execute(context) {
        const repo=context.repository(repository.repositoryId),entry=repo.invoke('find_entry',{shelf_entry_id:shelfEntryId}),
          shelf=entry&&repo.invoke('find_shelf',{shelf_id:entry.shelf_id});
        assertNoJavCorrection(repo,shelfEntryId);
        const profile=entry && inventoryContentProfile(repo.invoke('find_identity',{shelf_entry_id:shelfEntryId,revision:entry.canonical_identity_revision}),entry.structure_kind);
        if(profile==='western_adult')fail('ARCA_USER_ACTOR_REFRESH_REQUIRED','US Adult actor refresh requires a user Aftercare Intent.');
        const libraryKind=profile==='jav'?'jav':'normal';
        if(!entry||entry.status!=='active'||!shelf||shelf.status!=='active'||Number(entry.current_inventory_revision)!==expectedInventoryRevision||
          Number(entry.canonical_identity_revision)!==request.canonicalIdentityRevision||Number(shelf.current_standard_revision)!==request.standardRevision||
          Number(shelf.current_placement_revision)!==request.placementRevision)fail('ARCA_PERSON_RECORD_STALE','Person record Basis changed.');
        if(repo.invoke('list_cases',{shelf_entry_id:shelfEntryId}).some(row=>row.state==='active')||
          repo.invoke('list_reservations',{shelf_entry_id:shelfEntryId}).some(row=>row.state==='active'))
          fail('ARCA_PERSON_RECORD_FENCED','Active physical processing prevents relation refresh.');
        const inventory=repo.invoke('find_inventory',{shelf_entry_id:shelfEntryId,revision:expectedInventoryRevision});
        if(!inventory||inventory.representation_digest!==request.expectedInventoryDigest)fail('ARCA_PERSON_RECORD_STALE','Inventory digest changed.');
        const scope={shelf_entry_id:shelfEntryId,inventory_revision:expectedInventoryRevision},rows=repo.invoke('list_people',scope),
          byId=new Map(observations.map(item=>[item.relationId,item]));
        if(observations.some(item=>!rows.some(row=>row.relation_id===item.relationId)))fail('ARCA_PERSON_RECORD_UNKNOWN','Unknown relation cannot be introduced.');
        const people=rows.map(row=>{
          const observation=byId.get(row.relation_id);if(!observation)return row;
          assertPersonRecordObservation({...row,evidence_inventory_revision:evidenceInventoryRevision(repo,row)},observation,libraryKind);
          return {...row,person_id:observation.proof.personId,relation_digest:canonicalDigest({schema:'arca.person-record-revision@1',
            previousRelationDigest:row.relation_digest,personId:observation.proof.personId,proofDigest:observation.proof.proofDigest})};
        });
        const next=expectedInventoryRevision+1;
        appendInventoryRevision(repo,{shelfEntryId,people,materials:repo.invoke('list_materials',scope).sort((a,b)=>Number(a.ordinal)-Number(b.ordinal)),
          related:repo.invoke('list_related',scope),facts:repo.invoke('list_facts',scope),representationDigest:canonicalDigest({
            schema:'arca.person-record-inventory@1',previousDigest:inventory.representation_digest,observationDigest})},inventory,expectedInventoryRevision,next,context.commitTimeMs);
        return Object.freeze({schemaRef:RECEIPT,shelfEntryId,previousInventoryRevision:expectedInventoryRevision,newInventoryRevision:next,
          observationDigest,changedBindingCount:0,changedRelationCount:observations.length,controlChangeDigest:null,
          personProofs:observations,committedAtMs:context.commitTimeMs});
      }},commitMarker:{commitMarker:'arca-person-record-'+key,scopeType:'shelf_entry',scopeId:shelfEntryId,commitDigest:requestDigest},
      auditRecords:[{auditId:'arca-person-record-audit-'+key,actorType:'system',action:'refresh_inventory_person_records',
        scopeType:'shelf_entry',scopeId:shelfEntryId,evidenceDigest:observationDigest}],resultEnvelope:receipt=>({resultSchemaRef:RECEIPT,resultRef:receipt})});
    return Object.freeze({replayed:result.replayed,receipt:result.receipt.resultRef});
  }});
}
module.exports=Object.freeze({createPersonRecordRefreshStore});
