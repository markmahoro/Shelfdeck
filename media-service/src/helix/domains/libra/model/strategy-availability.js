'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const SCHEMA_REF='helix://contracts/application-types/LibraStrategyAvailability/v1';
const OFFSETS=Object.freeze([60000,300000,900000,1800000,3600000]);
const REASONS=Object.freeze({moviepilot:['moviepilot_integration_unavailable'],tmdb:['product_metadata_integration_unavailable','product_metadata_provider_identity_absent']});
function buildStrategyAvailability({libraRunId,executionBasisDigest,strategyKind,reasonCode,conditionDigest,previous,now}) {
  if(!REASONS[strategyKind]?.includes(reasonCode)||!Number.isSafeInteger(now)||now<0)throw new TypeError('Strategy availability requires an exact unavailable path and valid time.');
  const same=previous?.strategyKind===strategyKind&&previous.conditionDigest===conditionDigest&&previous.executionBasisDigest===executionBasisDigest;
  const startedAtMs=same?previous.startedAtMs:now,ordinal=same?previous.checkOrdinal+1:0;
  if(same && now<startedAtMs+OFFSETS[previous.checkOrdinal])return null;
  if(ordinal>5)throw new TypeError('Unavailable strategy has already reached its finite deadline.');
  const value={schemaRef:SCHEMA_REF,libraRunId,executionBasisDigest,strategyKind,reasonCode,conditionDigest,startedAtMs,
    checkedAtMs:now,checkOrdinal:ordinal,status:ordinal===5?'unavailable':'waiting',policyRef:'libra.strategy-availability.beta@1'};
  value.availabilityId=canonicalDigest(value);value.evidenceDigest=canonicalDigest(value);return Object.freeze(value);
}
function validateStrategyAvailability(value) {
  const {availabilityId,evidenceDigest,...body}=value||{};
  if(value?.schemaRef!==SCHEMA_REF||!REASONS[value.strategyKind]?.includes(value.reasonCode)||
      value.policyRef!=='libra.strategy-availability.beta@1'||!Number.isSafeInteger(value.checkOrdinal)||value.checkOrdinal<0||value.checkOrdinal>5||
      value.status!==(value.checkOrdinal===5?'unavailable':'waiting')||!Number.isSafeInteger(value.startedAtMs)||value.startedAtMs<0||
      !Number.isSafeInteger(value.checkedAtMs)||value.checkedAtMs<value.startedAtMs+(value.checkOrdinal?OFFSETS[value.checkOrdinal-1]:0)||
      !/^[a-f0-9]{64}$/.test(value.conditionDigest||'')||!/^[a-f0-9]{64}$/.test(value.executionBasisDigest||'')||
      availabilityId!==canonicalDigest(body)||evidenceDigest!==canonicalDigest({...body,availabilityId}))
    throw Object.assign(new Error('Strategy availability evidence is invalid or premature.'),{code:'LIBRA_STRATEGY_EVIDENCE_INVALID'});
  return {kind:'strategy',schemaRef:SCHEMA_REF,evidenceId:availabilityId,evidenceDigest};
}
module.exports=Object.freeze({SCHEMA_REF,OFFSETS,buildStrategyAvailability,validateStrategyAvailability});
