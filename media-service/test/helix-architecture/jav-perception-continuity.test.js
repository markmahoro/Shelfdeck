'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {ORIGIN_SCHEMA,CONTINUITY_SCHEMA}=require('../../src/helix/contracts/jav-perception-continuity');
const {queryFor}=require('../../src/helix/domains/perception/application/perception-process-services');
const {buildRuleSnapshot}=require('../../src/helix/domains/perception/application/perception-resolution-application');
const {resolvePerception}=require('../../src/helix/domains/perception/model/perception-resolution-resolver');
function target(){const originBody={schemaRef:ORIGIN_SCHEMA,schemaVersion:1,onDeckPackageId:'package',packageRevision:1,packageDigest:canonicalDigest('package'),
  subjectId:'accepted-subject',libraRunId:'run',shelfId:'shelf'},origin={...originBody,originDigest:canonicalDigest(originBody)},
  body={schemaRef:CONTINUITY_SCHEMA,schemaVersion:1,shelfEntryId:'entry',shelfId:'shelf',canonicalIdentityRevision:2,canonicalIdentityDigest:canonicalDigest('new identity'),
    correctionId:'correction',committedContextDigest:canonicalDigest('context'),identityCommitReceiptDigest:canonicalDigest('receipt'),originalOnDeckCommitDigest:canonicalDigest('original'),acceptedSubjectOrigin:origin};
  return {targetType:'shelf_entry',targetId:'entry',targetRevision:2,title:'Same title',year:null,providerIdentity:'jav:IPX-178',canonicalIdentityDigest:body.canonicalIdentityDigest,
    javPerceptionContinuity:{...body,continuityDigest:canonicalDigest(body)}};
}
function record(id,sourceKind,kind,value,rating,extra=[]){return {perceptionId:id,recordKind:'observation',sourceKind,sourceRecordKey:id,sourceRecordRevision:1,
  recordDigest:canonicalDigest(id),facts:{rating},observedTitle:'Same title',observedAtMs:1,provenanceRef:id,provenanceDigest:canonicalDigest(id+' provenance'),
  identityAnchors:[{anchorKind:kind,anchorValue:value,confidenceClass:kind==='provider_identity'?'strong':'exact',evidenceDigest:canonicalDigest(id+' anchor')},...extra]};}
function inputs(records,relations=[]){const query=queryFor(target()),body={queryInputDigest:query.queryInputDigest,records,relations};
  return {query,recordSet:{...body,recordSetDigest:canonicalDigest(body)},ruleSnapshot:buildRuleSnapshot()};}
const resolve=value=>resolvePerception(value,{draftId:'draft',producedAtMs:1});
test('current corrected Entry direct input wins before its proved accepted Subject and fresh shared identity',()=>{
  const value=inputs([record('entry-rating','shelfdeck_direct','shelf_entry_id','entry',5),record('subject-rating','shelfdeck_direct','subject_id','accepted-subject',4),
    record('shared','douban','provider_identity','jav:IPX-178',2)]),before=canonicalDigest(value),result=resolve(value);
  assert.equal(result.winningPerceptionId,'entry-rating');assert.equal(result.resolvedValue.value,5);assert.equal(canonicalDigest(value),before);
});
test('accepted Subject input is reused without rewriting while other Entry and Subject inputs stay isolated',()=>{
  const value=inputs([record('accepted','shelfdeck_direct','subject_id','accepted-subject',4),record('other-entry','shelfdeck_direct','shelf_entry_id','other-entry',1,
    [{anchorKind:'provider_identity',anchorValue:'jav:IPX-178',confidenceClass:'strong',evidenceDigest:canonicalDigest('other provider')}]),
    record('other-subject','shelfdeck_direct','subject_id','other-subject',2),record('new-shared','douban','provider_identity','jav:IPX-178',3)]),result=resolve(value);
  assert.equal(result.winningPerceptionId,'accepted');assert.equal(result.resolvedValue.value,4);assert.deepEqual(result.duplicateRelationDrafts,[]);
});
test('old shared identity and pure title similarity cannot become a corrected film rating',()=>{
  const title={anchorKind:'title',anchorValue:'same title',confidenceClass:'medium',evidenceDigest:canonicalDigest('title')},
    result=resolve(inputs([record('old-shared','douban','provider_identity','jav:IPX-177',5,[title]),record('title-only','douban','title','same title',4)]));
  assert.equal(result.resultKind,'not_found');assert.equal(result.reasonCode,'no_matching_record');
});
test('when scoped direct records are retracted, only fresh current-identity shared records resolve',()=>{
  const value=inputs([record('accepted','shelfdeck_direct','subject_id','accepted-subject',4),record('new-shared','douban','provider_identity','jav:IPX-178',3)],
    [{relationKind:'retracts',sourcePerceptionId:'retraction',targetPerceptionId:'accepted',relationId:'relation',ruleRevision:4,evidenceDigest:canonicalDigest('retract')}]),result=resolve(value);
  assert.equal(result.winningPerceptionId,'new-shared');assert.equal(result.resolvedValue.value,3);
});
test('conflicting active direct values on the same Entry fail closed and never select a shared replacement',()=>{
  const result=resolve(inputs([record('entry-a','shelfdeck_direct','shelf_entry_id','entry',4),record('entry-b','shelfdeck_direct','shelf_entry_id','entry',5),
    record('shared','douban','provider_identity','jav:IPX-178',2)]));assert.equal(result.resultKind,'not_found');assert.equal(result.reasonCode,'strongest_value_conflict');
});
test('missing requested fact on another direct record does not hide the accepted Subject fact',()=>{
  const watched=record('watched','shelfdeck_direct','shelf_entry_id','entry',undefined);watched.facts={watchedState:true};
  const result=resolve(inputs([watched,record('accepted','shelfdeck_direct','subject_id','accepted-subject',4)]));assert.equal(result.winningPerceptionId,'accepted');
});
test('foreign target, broken origin digest and undeclared policy are rejected before resolution',()=>{
  const foreign=target();foreign.targetId='other-entry';assert.throws(()=>queryFor(foreign),{code:'JAV_PERCEPTION_CONTINUITY_INVALID'});
  const broken=target();broken.javPerceptionContinuity.acceptedSubjectOrigin.subjectId='other-subject';assert.throws(()=>queryFor(broken),{code:'JAV_PERCEPTION_ORIGIN_INVALID'});
  const value=inputs([]);value.ruleSnapshot={...value.ruleSnapshot};delete value.ruleSnapshot.directTargetPolicyRef;
  const {ruleDigest,...body}=value.ruleSnapshot;value.ruleSnapshot={...body,ruleDigest:canonicalDigest(body)};
  assert.throws(()=>resolve(value),{code:'P6_PERCEPTION_DIRECT_SCOPE_INVALID'});
});
test('the same scoped policy resolves watched facts and keeps an unrelated direct target isolated',()=>{
  const accepted=record('accepted-watch','shelfdeck_direct','subject_id','accepted-subject',undefined);accepted.facts={watchedState:true};
  const other=record('other-watch','shelfdeck_direct','shelf_entry_id','other-entry',undefined);other.facts={watchedState:false};
  const value=inputs([accepted,other]),{queryInputDigest,...queryBody}=value.query;
  queryBody.queryContract='perception.watched.resolve@1';queryBody.factKind='watched';value.query={...queryBody,queryInputDigest:canonicalDigest(queryBody)};
  const {recordSetDigest,...setBody}=value.recordSet;setBody.queryInputDigest=value.query.queryInputDigest;value.recordSet={...setBody,recordSetDigest:canonicalDigest(setBody)};
  assert.equal(resolve(value).resolvedValue.value,true);
});
