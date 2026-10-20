'use strict';
const {inventoryContentProfile}=require('../model/product-content-profile');
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {personRecordQuery,personProofBatchFits}=require('../model/person-record-observation');
function createInventoryPersonRecordRefresh(options) {
  return Object.freeze({refresh(c) {
    const profile=inventoryContentProfile(c.raw.identity,c.raw.entry.structure_kind);
    if(profile==='western_adult')return Object.freeze({kind:'records_unchanged'});
    const libraryKind=profile==='jav'?'jav':'normal';
    if(c.raw.reservations.some(row=>row.state==='active'))return Object.freeze({kind:'records_deferred',reasonCode:'active_modification'});
    const rows=c.raw.people||[];
    if(rows.length>4096)return Object.freeze({kind:'records_deferred',reasonCode:'relation_scope_too_large'});
    const observations=[];
    for(const row of rows) {
      const proof=options.resolveMediaCastReference(personRecordQuery(row,libraryKind));
      if(proof.kind!=='resolved')continue;
      const observation={relationId:row.relation_id,previousRelationDigest:row.relation_digest,proof};
      if(!personProofBatchFits([...observations,observation])) {
        if(!observations.length)return Object.freeze({kind:'records_deferred',reasonCode:'person_proof_too_large'});
        break;
      }
      observations.push(observation);
      if(observations.length===64)break;
    }
    if(!observations.length)return Object.freeze({kind:'records_unchanged'});
    observations.sort((a,b)=>a.relationId.localeCompare(b.relationId));
    // Query the formal People projection before entering Arca's transaction.
    // Arca never joins or writes a People Repository; immutable proof revisions
    // are retained in its receipt and future Merge changes reconcile separately.
    for(const observation of observations) {
      const row=rows.find(item=>item.relation_id===observation.relationId);
      if(canonicalDigest(options.resolveMediaCastReference(personRecordQuery(row,libraryKind)))!==canonicalDigest(observation.proof))
        return Object.freeze({kind:'records_deferred',reasonCode:'person_projection_changed'});
    }
    const result=options.contextReader.store.refreshInventoryPersonRecords({shelfEntryId:c.shelfEntryId,
      expectedInventoryRevision:Number(c.raw.entry.current_inventory_revision),expectedInventoryDigest:c.raw.inventory.representation_digest,
      standardRevision:Number(c.raw.shelf.current_standard_revision),placementRevision:Number(c.raw.shelf.current_placement_revision),
      canonicalIdentityRevision:Number(c.raw.entry.canonical_identity_revision),observations});
    return Object.freeze({kind:'inventory_records_refreshed',...result});
  }});
}
module.exports=Object.freeze({createInventoryPersonRecordRefresh});
