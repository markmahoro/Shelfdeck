'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createJavCorrectionAdmin}=require('../../src/helix/domains/arca/application/jav-correction-admin');
const error=code=>Object.assign(new Error(code),{code}),digest='1'.repeat(64),receiptDigest='2'.repeat(64);
const body=()=>({expectedStateRevision:3,expectedAdmissionDigest:digest,expectedCleanupState:null,expectedRecoveryIntentDigest:null,idempotencyKey:'recover'});
const record=()=>({correctionId:'correction',shelfEntryId:'entry',state:'attention_required',stateRevision:3,admissionDigest:digest,cleanupState:null,recoveryIntent:null});
const receipt=()=>({correctionId:'correction',shelfEntryId:'entry',mode:'continue_correction',acceptedStateRevision:4,admissionDigest:digest,receiptDigest,admittedAtMs:100});
test('recovery uses server actor and exact path scope, prepares only a new Intent and exposes the admitted same-task state',async()=>{
  const preparation={observation:'server-only'},calls=[],admin=createJavCorrectionAdmin({correction:{correctionStore:{get:()=>record(),admitRecovery(command,proof){
    calls.push({command,proof});if(!proof)throw error('ARCA_JAV_CORRECTION_RECOVERY_PREPARATION_REQUIRED');return {receipt:{resultRef:receipt()},replayed:false};}},
    recoveryPreparation:{async prepare(entry,id){assert.equal(entry,'entry');assert.equal(id,'correction');return preparation;}}}}),
    result=await admin.recover('entry','correction',body(),'session-actor');
  assert.equal(calls.length,2);assert.equal(calls[0].proof,null);assert.equal(calls[1].proof,preparation);
  assert.deepEqual(calls[1].command,{...body(),shelfEntryId:'entry',correctionId:'correction',actorId:'session-actor'});
  assert.deepEqual(result,{correctionId:'correction',shelfEntryId:'entry',state:'active',stateRevision:4,admissionDigest:digest,cleanupState:null,
    recoveryIntentDigest:receiptDigest,updatedAtMs:100,replayed:false});
});
test('exact recovery replay precedes all current-state reads and file preparation',async()=>{
  const admin=createJavCorrectionAdmin({correction:{correctionStore:{get(){assert.fail('Replay must not reread current state.');},admitRecovery(_command,proof){assert.equal(proof,null);return {receipt:{resultRef:receipt()},replayed:true};}},
    recoveryPreparation:{prepare(){assert.fail('Replay must not inspect files.');}}}});
  assert.equal((await admin.recover('entry','correction',body(),'admin')).replayed,true);
});
test('recovery rejects forged scope, stale state and changed command before scene work',async()=>{
  let prepared=0;const admin=createJavCorrectionAdmin({correction:{correctionStore:{get:()=>({...record(),stateRevision:5}),admitRecovery(){throw error('ARCA_JAV_CORRECTION_RECOVERY_PREPARATION_REQUIRED');}},
    recoveryPreparation:{prepare(){prepared++;}}}});
  await assert.rejects(admin.recover('entry','correction',{...body(),actorId:'spoofed'},'admin'),{code:'ARCA_JAV_CORRECTION_INPUT_INVALID'});
  await assert.rejects(admin.recover('entry','correction',body(),'admin'),{code:'ARCA_JAV_CORRECTION_RECOVERY_STALE'});
  await assert.rejects(admin.recover('other-entry','correction',body(),'admin'),{code:'ARCA_JAV_CORRECTION_NOT_FOUND'});assert.equal(prepared,0);
  const conflict=createJavCorrectionAdmin({correction:{correctionStore:{admitRecovery(){throw error('P3_COMMAND_IDEMPOTENCY_CONFLICT');}}}});
  await assert.rejects(conflict.recover('entry','correction',body(),'admin'),{code:'ARCA_JAV_CORRECTION_COMMAND_CONFLICT'});
});
test('scene conflict and state changes during preparation preserve rejection instead of returning admission',async()=>{
  for(const phase of ['scene','commit']){
    let calls=0;const admin=createJavCorrectionAdmin({correction:{correctionStore:{get:()=>record(),admitRecovery(){calls++;
      if(calls===1)throw error('ARCA_JAV_CORRECTION_RECOVERY_PREPARATION_REQUIRED');throw error('ARCA_JAV_CORRECTION_RECOVERY_STALE');}},
      recoveryPreparation:{async prepare(){if(phase==='scene')throw error('ARCA_JAV_CORRECTION_RECOVERY_SCENE_INVALID');return {};}}}});
    await assert.rejects(admin.recover('entry','correction',body(),'admin'),{code:phase==='scene'?'ARCA_JAV_CORRECTION_RECOVERY_SCENE_INVALID':'ARCA_JAV_CORRECTION_RECOVERY_STALE'});
    assert.equal(calls,phase==='scene'?1:2);
  }
});
