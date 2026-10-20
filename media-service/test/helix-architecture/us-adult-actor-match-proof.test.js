'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./fixtures/us-adult-actor-match-context');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
test('Arca chooses the highest actor across every frozen page and resolves equal scores in stable Person order',t=>{
  const x=fixture(t),highest=x.complete([0.8,0.96,0.9]),tie=x.complete([0.96,0.96,0.96]);
  assert.equal(highest.winner.personSnapshot.personId,'actor-b');assert.equal(highest.winner.pageOrdinal,1);assert.equal(highest.completedPageCount,3);
  assert.equal(tie.winner.personSnapshot.personId,'actor-a');assert.equal(x.complete([null,null,null]).winner,null);
});
test('Arca cannot report no match from only the first page or a duplicate page',t=>{
  const x=fixture(t),records=x.records([null,null,null]);
  assert.throws(()=>x.workModel.completeMatching({...x.request,records:records.slice(0,1)}),{code:'ARCA_US_ADULT_MATCH_PROOF_INVALID'});
  assert.throws(()=>x.workModel.completeMatching({...x.request,records:[records[0],records[0],records[2]]}),{code:'ARCA_US_ADULT_MATCH_PROOF_INVALID'});
  assert.throws(()=>x.workModel.completeMatching({...x.request,pages:x.request.pages.slice(0,1),records:records.slice(0,1)}));
});
test('even rehashed Result envelopes cannot substitute the Actor revision, source or actual Owner input page',t=>{
  const x=fixture(t);
  for(const mutate of [r=>{r.result.matches[0].personRevision++;const {matchDigest,...body}=r.result.matches[0];r.result.matches[0].matchDigest=D(body);},
    r=>{r.result.sourceResultDigest=D('another source');},r=>{r.inputBindings.bindings[3].parameters.pageOrdinal=2;}]){
    const records=structuredClone(x.records([0.9,0.8,0.8])),record=records[0];mutate(record);
    const {schemaRef,schemaVersion,evidenceId,evidenceKind,producerRef,basisDigest,payloadDigest,observedAtMs,...payload}=record.result;
    record.result.payloadDigest=D(payload);record.result.evidenceId='arca-us-match-'+record.result.payloadDigest;
    record.resultDigest=D(record.result);record.inputBindingDigest=D(record.inputBindings);
    assert.throws(()=>x.workModel.completeMatching({...x.request,records}),error=>['ARCA_US_ADULT_MATCH_PROOF_INVALID','ARCA_US_ADULT_PAGE_MATCH_INVALID'].includes(error.code));
  }
});
