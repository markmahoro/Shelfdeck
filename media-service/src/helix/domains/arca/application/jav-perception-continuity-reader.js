'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {CONTINUITY_SCHEMA,ORIGIN_SCHEMA,assertSubjectOrigin,assertJavPerceptionContinuity}=require('../../../contracts/jav-perception-continuity');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {createJavCorrectionCommitStore}=require('../persistence/jav-correction-commit-store');
const fail=()=>{throw Object.assign(new Error('The corrected Entry has no exact accepted Subject continuity proof.'),{code:'ARCA_JAV_PERCEPTION_CONTINUITY_UNAVAILABLE'});};
function createJavPerceptionContinuityReader(options){
  const commitStore=createJavCorrectionCommitStore(options),repository=createRepositoryDefinition({repositoryId:'arca_jav_perception_origin',owner:'arca',readOnly:true,
    schemaManifest:options.schemaManifest,statements:{
      latest:{kind:'select-filtered-page',tableId:'arca_jav_identity_corrections',columns:['correction_id','shelf_entry_id','state','committed_context_digest'],
        fixedKeyColumns:['shelf_entry_id','state'],orderBy:[{column:'terminal_at_ms',direction:'desc'},{column:'correction_id',direction:'desc'}],maxItems:1},
      inventory:{kind:'select-one',tableId:'arca_inventory_representations',columns:['source_package_id'],keyColumns:['shelf_entry_id','revision']},
      commit:require('../persistence/inventory-context-statements').find_ondeck_commit,
      run:{kind:'select-one',tableId:'arca_ondeck_runs',columns:['custody_id','state'],keyColumns:['on_deck_run_id']},
      custody:{kind:'select-one',tableId:'arca_ondeck_custodies',columns:['on_deck_package_id','package_digest'],keyColumns:['custody_id']},
    }});
  return Object.freeze({read(item){
    if(item?.identityKind!=='jav_code'||item.provider!=='jav')return null;
    const source=options.unitOfWork.execute([{participantId:'arca_jav_perception_origin_read',owner:'arca',repositories:[repository],execute(c){
      const repo=c.repository(repository.repositoryId),correction=repo.invoke('latest',{shelf_entry_id:item.shelfEntryId,state:'committed',offset:0,limit:1})[0];
      if(!correction)return null;
      const original=repo.invoke('commit',{shelf_entry_id:item.shelfEntryId}),run=original&&repo.invoke('run',{on_deck_run_id:original.on_deck_run_id}),
        custody=run&&repo.invoke('custody',{custody_id:run.custody_id}),inventory=repo.invoke('inventory',{shelf_entry_id:item.shelfEntryId,revision:item.currentInventoryRevision});
      if(!original||run?.state!=='committed'||!custody||inventory?.source_package_id!==custody.on_deck_package_id)fail();
      return {correction,original,custody};
    }}]).arca_jav_perception_origin_read;
    if(!source)return null;
    const committed=commitStore.readCommitted(source.correction.correction_id),context=committed?.committedContext,receipt=committed?.commit.result;
    if(!context||context.contextDigest!==source.correction.committed_context_digest||receipt.shelfEntryId!==item.shelfEntryId||
        receipt.newCanonicalIdentityRevision!==item.canonicalIdentityRevision||receipt.canonicalIdentityDigest!==item.identityDigest||
        context.filePlan.shelfEntryId!==item.shelfEntryId||typeof options.readAcceptedSubjectOrigin!=='function')fail();
    const originalOnDeckCommitDigest=canonicalDigest(Object.fromEntries(Object.entries(source.original).map(([key,value])=>[key,typeof value==='bigint'?String(value):value])));
    if(originalOnDeckCommitDigest!==receipt.originalCommitDigest)fail();
    const origin=options.readAcceptedSubjectOrigin({onDeckPackageId:source.custody.on_deck_package_id,expectedPackageDigest:source.custody.package_digest});
    options.contractValidator.validate(ORIGIN_SCHEMA,origin);assertSubjectOrigin(origin);
    if(origin.shelfId!==item.shelfId||origin.onDeckPackageId!==source.custody.on_deck_package_id||origin.packageDigest!==source.custody.package_digest)fail();
    const body={schemaRef:CONTINUITY_SCHEMA,schemaVersion:1,shelfEntryId:item.shelfEntryId,shelfId:item.shelfId,canonicalIdentityRevision:item.canonicalIdentityRevision,
      canonicalIdentityDigest:item.identityDigest,correctionId:source.correction.correction_id,committedContextDigest:context.contextDigest,
      identityCommitReceiptDigest:context.receiptDigest,originalOnDeckCommitDigest,acceptedSubjectOrigin:origin},value={...body,continuityDigest:canonicalDigest(body)};
    options.contractValidator.validate(CONTINUITY_SCHEMA,value);assertJavPerceptionContinuity(value);return Object.freeze(value);
  }});
}
module.exports=Object.freeze({createJavPerceptionContinuityReader});
