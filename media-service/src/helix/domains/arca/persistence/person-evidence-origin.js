'use strict';

// An unrelated Inventory revision does not create new cast identity evidence.
// Reuse only the earliest row with this exact Entry, relation and relation digest.
const statement=Object.freeze({kind:'select-filtered-page',tableId:'arca_inventory_person_relations',
  columns:['inventory_revision'],fixedKeyColumns:['shelf_entry_id','relation_id','relation_digest'],
  orderBy:[{column:'inventory_revision',direction:'asc'}],maxItems:1,safeIntegers:true});
function evidenceInventoryRevision(repo,row){
  const origin=repo.invoke('find_person_evidence_origin',{shelf_entry_id:row.shelf_entry_id,
    relation_id:row.relation_id,relation_digest:row.relation_digest,offset:0,limit:1})[0];
  if(!origin)throw Object.assign(new Error('The current cast relation has no exact origin row.'),{code:'ARCA_PERSON_EVIDENCE_ORIGIN_MISSING'});
  return Number(origin.inventory_revision);
}
module.exports=Object.freeze({statement,evidenceInventoryRevision});
