'use strict';

const columns=['correction_id','shelf_entry_id','state','state_revision','terminal_at_ms','cleanup_state'];
const statements=Object.freeze({
  list_jav_correction_gates:{kind:'select-all',tableId:'arca_jav_identity_corrections',columns,keyColumns:['shelf_entry_id'],safeIntegers:true},
  find_jav_correction_gates:{kind:'select-in',tableId:'arca_jav_identity_corrections',columns,keyColumn:'shelf_entry_id',maxItems:500,safeIntegers:true},
  page_jav_correction_shelf_entries:{kind:'select-range',tableId:'arca_shelf_entries',columns:['shelf_entry_id'],keyColumn:'shelf_entry_id',fixedKeyColumns:['shelf_id'],maxItems:500},
});
const pendingJavCorrection=rows=>rows.find(row=>row.terminal_at_ms===null&&['admitted','active','attention_required'].includes(row.state)||
  row.state==='committed'&&row.cleanup_state!=='completed')||null;
function currentJavCorrectionGate(repo,shelfEntryId) {
  return pendingJavCorrection(repo.invoke('list_jav_correction_gates',{shelf_entry_id:shelfEntryId}));
}
function assertNoJavCorrection(repo,shelfEntryId) {
  if(currentJavCorrectionGate(repo,shelfEntryId))throw Object.assign(new Error('An identity correction is pending for this Shelf Entry.'),
    {code:'ARCA_JAV_CORRECTION_BUSY',details:{shelfEntryId}});
}
function assertNoShelfJavCorrections(repo,shelfId) {
  let cursor='';
  for(;;) {
    const entries=repo.invoke('page_jav_correction_shelf_entries',{shelf_id:shelfId,rangeStart:'',rangeEnd:'\uffff',cursor,limit:500});
    if(!entries.length)return;
    const row=pendingJavCorrection(repo.invoke('find_jav_correction_gates',{values:entries.map(entry=>entry.shelf_entry_id)}));
    if(row)throw Object.assign(new Error('A Shelf Entry identity correction must finish before this Shelf operation.'),
      {code:'ARCA_JAV_CORRECTION_BUSY',details:{shelfId,shelfEntryId:row.shelf_entry_id}});
    const next=entries.at(-1).shelf_entry_id;
    if(next<=cursor)throw Object.assign(new Error('Shelf correction gate pagination did not advance.'),{code:'ARCA_JAV_CORRECTION_GATE_INVALID'});
    cursor=next;
  }
}
module.exports=Object.freeze({statements,pendingJavCorrection,currentJavCorrectionGate,assertNoJavCorrection,assertNoShelfJavCorrections});
