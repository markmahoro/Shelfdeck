'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {OFFSETS,buildStrategyAvailability,validateStrategyAvailability}=require('../../src/helix/domains/libra/model/strategy-availability');
const request={libraRunId:'run',executionBasisDigest:canonicalDigest('basis'),strategyKind:'moviepilot',
  reasonCode:'moviepilot_integration_unavailable',conditionDigest:canonicalDigest('configuration')};
test('missing integration has one persisted finite budget and never fabricates an exhausted attempt',()=>{
  let previous=buildStrategyAvailability({...request,now:100});validateStrategyAvailability(previous);
  assert.equal(buildStrategyAvailability({...request,previous,now:60099}),null);
  for(const offset of OFFSETS){previous=buildStrategyAvailability({...request,previous,now:100+offset});
    assert.equal(validateStrategyAvailability(previous).kind,'strategy');assert.equal(previous.blockedWorks,undefined);}
  assert.equal(previous.status,'unavailable');assert.equal(previous.checkOrdinal,5);
  assert.throws(()=>validateStrategyAvailability({...previous,checkedAtMs:101}),{code:'LIBRA_STRATEGY_EVIDENCE_INVALID'});
});
test('a relevant configuration change starts one fresh wait budget',()=>{
  const previous=buildStrategyAvailability({...request,now:100});
  const next=buildStrategyAvailability({...request,conditionDigest:canonicalDigest('changed'),previous,now:200});
  assert.equal(next.checkOrdinal,0);assert.equal(next.startedAtMs,200);assert.notEqual(next.availabilityId,previous.availabilityId);
});
