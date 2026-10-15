'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {statements,assertNoJavCorrection,assertNoShelfJavCorrections}=require('../../src/helix/domains/arca/persistence/jav-correction-gate');
const {createAftercareProcessCoordinator}=require('../../src/helix/domains/arca/application/aftercare-process-coordinator');
const schemaManifest=require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
test('every nonterminal correction holds its Entry gate and completed cleanup or cancellation releases it',()=>{
  for(const state of ['admitted','active','attention_required','committed','cancelled']) {
    const repo={invoke(name,input){assert.equal(name,'list_jav_correction_gates');assert.equal(input.shelf_entry_id,'entry');
      return [{state,cleanup_state:state==='committed'?'completed':null,correction_id:'correction',shelf_entry_id:'entry',terminal_at_ms:['committed','cancelled'].includes(state)?1:null}];}};
    if(['admitted','active','attention_required'].includes(state))assert.throws(()=>assertNoJavCorrection(repo,'entry'),{code:'ARCA_JAV_CORRECTION_BUSY'});
    else assert.doesNotThrow(()=>assertNoJavCorrection(repo,'entry'));
  }
});
test('committed identity keeps its Entry and Shelf gate throughout cleanup, including missing observations',()=>{
  for(const cleanup_state of ['pending','active','attention_required',null,undefined]){
    const row={state:'committed',cleanup_state,terminal_at_ms:1,correction_id:'correction',shelf_entry_id:'entry'},repo={invoke(name){
      if(name==='page_jav_correction_shelf_entries')return [{shelf_entry_id:'entry'}];return [row];}};
    assert.throws(()=>assertNoJavCorrection(repo,'entry'),{code:'ARCA_JAV_CORRECTION_BUSY'});
    assert.throws(()=>assertNoShelfJavCorrections(repo,'shelf'),{code:'ARCA_JAV_CORRECTION_BUSY'});
  }
});
test('Shelf correction fence uses bounded pages, scopes queries to that Shelf and detects pending corrections after the first page',()=>{
  const calls=[],repo={invoke(name,input){calls.push({name,input});if(name==='page_jav_correction_shelf_entries'){
    assert.equal(input.shelf_id,'shelf');return input.cursor?[{shelf_entry_id:'entry-z'}]:Array.from({length:500},(_,i)=>({shelf_entry_id:'entry-'+String(i).padStart(4,'0')}));}
    assert.equal(name,'find_jav_correction_gates');assert.ok(input.values.length<=500);
    return input.values.includes('entry-z')?[{state:'active',terminal_at_ms:null,shelf_entry_id:'entry-z'}]:[];}};
  assert.throws(()=>assertNoShelfJavCorrections(repo,'shelf'),{code:'ARCA_JAV_CORRECTION_BUSY'});
  assert.equal(calls.filter(call=>call.name==='page_jav_correction_shelf_entries').length,2);
  assert.equal(statements.find_jav_correction_gates.maxItems,500);
});
test('Aftercare defers before history, record refresh, assessment or new Work when its Entry correction is pending',()=>{
  const forbidden=()=>{throw new Error('Pending correction must prevent ordinary maintenance.');},
    coordinator=createAftercareProcessCoordinator({schemaManifest,unitOfWork:{execute:forbidden},contextReader:{read:()=>({raw:{correctionGate:{correction_id:'correction'}}}),store:{history:forbidden}},
      refreshPersonRecords:forbidden,refreshInventoryRecords:forbidden,workResultReader:{status:forbidden}});
  assert.deepEqual(coordinator.reconcile('entry'),{kind:'identity_correction_pending',shelfEntryId:'entry',correctionId:'correction'});
});
