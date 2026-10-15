'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {buildJavCorrectionRecoveryReceipt,assertJavCorrectionRecoveryReceipt,recoveryWorkId}=require('../../src/helix/domains/arca/model/jav-correction-recovery');
const d=value=>canonicalDigest({value});
function fixture(){
  const record={correctionId:'correction',shelfEntryId:'entry',admissionDigest:d('admission'),state:'attention_required',cleanupState:null,stateRevision:3,updatedAtMs:100,recoveryIntent:null},
    command={actorId:'admin',correctionId:record.correctionId,shelfEntryId:record.shelfEntryId,idempotencyKey:'recover-1',expectedStateRevision:3,
      expectedAdmissionDigest:record.admissionDigest,expectedCleanupState:null,expectedRecoveryIntentDigest:null},
    body={schema:'arca.jav-correction-recovery-observation@1',correctionId:record.correctionId,admissionDigest:record.admissionDigest,stateRevision:3,updatedAtMs:100,
      previousIntentDigest:null,scopeDigest:d('scope'),executionRevision:2,filePlanDigest:d('plan'),sourceResultReference:null,realityClassification:'matching',realityDigest:d('reality'),
      failedWork:{ownerDomain:'arca',processType:'arca_jav_identity_correction',processId:record.correctionId,state:'failed',hasUnresolvedEffects:false,
        workKind:'jav_correction_publish',baseWorkId:'original-publication',workId:'original-publication',definitionDigest:d('definition'),executionEvidenceDigest:d('execution'),basisDigest:d('scope')}};
  body.executionSnapshot={works:[],attempts:[],plans:[],nodes:[],events:[],eventAttempts:[],effects:[],results:[],registries:[],materials:[],artifacts:[]};
  body.realityObservation={schema:'arca.jav-correction-recovery-reality@1',correctionId:record.correctionId,phase:body.failedWork.workKind,observedAtMs:100,classification:'matching',files:[],directories:[]};
  body.realityDigest=canonicalDigest(body.realityObservation);
  return {record,command,observation:{...body,observationDigest:canonicalDigest(body)},admittedAtMs:101};
}
function resign(value){const {observationDigest,...body}=value;body.realityObservation={...body.realityObservation,phase:body.failedWork.workKind};body.realityDigest=canonicalDigest(body.realityObservation);return {...body,observationDigest:canonicalDigest(body)};}
test('explicit recovery retains the same business correction and creates a new execution identity without rewriting failure evidence',()=>{
  const input=fixture(),before=canonicalDigest(input),receipt=buildJavCorrectionRecoveryReceipt(input);
  assert.equal(canonicalDigest(input),before);assert.equal(receipt.correctionId,input.record.correctionId);assert.equal(receipt.mode,'continue_correction');
  assert.equal(receipt.acceptedStateRevision,4);assert.equal(receipt.executionRevision,2);assert.equal(receipt.filePlanDigest,input.observation.filePlanDigest);
  assert.equal(receipt.failedExecutionEvidenceDigest,input.observation.failedWork.executionEvidenceDigest);assert.equal(receipt.workLineage[0].previousWorkId,'original-publication');
  assert.notEqual(receipt.workLineage[0].workId,'original-publication');const active={...input.record,state:'active',stateRevision:4,recoveryIntent:receipt};
  assert.equal(assertJavCorrectionRecoveryReceipt(receipt,active),receipt);assert.equal(recoveryWorkId(active,'jav_correction_publish','original-publication'),receipt.workLineage[0].workId);
  assert.equal(recoveryWorkId(active,'jav_correction_files','original-staging'),'original-staging');
  assert.throws(()=>recoveryWorkId(active,'jav_correction_publish','another-scope'),{code:'ARCA_JAV_CORRECTION_RECOVERY_UNPROVEN'});
});
test('a later recovery chains the actual failed replacement and preserves the original scope and base Work',()=>{
  const input=fixture(),first=buildJavCorrectionRecoveryReceipt(input);
  input.record={...input.record,stateRevision:5,updatedAtMs:200,recoveryIntent:first};input.command={...input.command,expectedStateRevision:5,expectedRecoveryIntentDigest:first.receiptDigest,idempotencyKey:'recover-2'};
  input.observation=resign({...input.observation,stateRevision:5,updatedAtMs:200,previousIntentDigest:first.receiptDigest,
    failedWork:{...input.observation.failedWork,workId:first.workLineage[0].workId}});input.admittedAtMs=201;
  const second=buildJavCorrectionRecoveryReceipt(input);assert.equal(second.previousIntentDigest,first.receiptDigest);assert.equal(second.workLineage.length,1);
  assert.equal(second.workLineage[0].previousWorkId,first.workLineage[0].workId);assert.equal(second.workLineage[0].baseWorkId,'original-publication');
  assert.notEqual(second.workLineage[0].workId,first.workLineage[0].workId);assert.equal(second.executionRevision,first.executionRevision);
  input.observation=resign({...input.observation,failedWork:{...input.observation.failedWork,workId:'original-publication'}});
  assert.throws(()=>buildJavCorrectionRecoveryReceipt(input),{code:'ARCA_JAV_CORRECTION_RECOVERY_UNPROVEN'});
});
test('committed cleanup recovery retains committed state revision and cannot restart pre-commit production',()=>{
  const input=fixture();input.record={...input.record,state:'committed',cleanupState:'attention_required'};input.command.expectedCleanupState='attention_required';
  input.observation=resign({...input.observation,failedWork:{...input.observation.failedWork,workKind:'jav_correction_formal_retirement'}});
  const receipt=buildJavCorrectionRecoveryReceipt(input);assert.equal(receipt.mode,'continue_cleanup');assert.equal(receipt.acceptedStateRevision,3);
  input.observation=resign({...input.observation,failedWork:{...input.observation.failedWork,workKind:'jav_correction_assets'}});
  assert.throws(()=>buildJavCorrectionRecoveryReceipt(input),{code:'ARCA_JAV_CORRECTION_RECOVERY_UNPROVEN'});
});
test('recovery rejects stale commands, unresolved execution, foreign scopes, unknown conflicts and altered proofs',()=>{
  const cases=[input=>{input.command.expectedStateRevision--;},input=>{input.command.expectedAdmissionDigest=d('different');},
    input=>{input.observation=resign({...input.observation,realityClassification:'conflict'});},
    input=>{input.observation=resign({...input.observation,realityObservation:{...input.observation.realityObservation,classification:'conflict'}});},
    input=>{input.observation=resign({...input.observation,failedWork:{...input.observation.failedWork,hasUnresolvedEffects:true}});},
    input=>{input.observation=resign({...input.observation,failedWork:{...input.observation.failedWork,state:'running'}});},
    input=>{input.observation=resign({...input.observation,failedWork:{...input.observation.failedWork,processId:'foreign'}});},
    input=>{input.observation.scopeDigest=d('tampered');},input=>{input.record.state='cancelled';},
    input=>{input.command.expectedRecoveryIntentDigest=d('unknown');},input=>{input.observation=resign({...input.observation,filePlanDigest:'invalid'});}];
  for(const change of cases){const input=fixture();change(input);assert.throws(()=>buildJavCorrectionRecoveryReceipt(input),{code:'ARCA_JAV_CORRECTION_RECOVERY_UNPROVEN'});}
});
