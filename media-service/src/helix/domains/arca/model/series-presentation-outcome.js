'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const stable=(prefix,value)=>prefix+canonicalDigest(value).slice(0,40);
function seriesOutcome(ref,result,scope,execution,effectClass){
  const at=result.observedAtMs??result.committedAtMs,evidence={evidenceId:stable('arca-series-proof-',{ref,result}),evidenceKind:'series_presentation',
    producerRef:ref,basisDigest:scope.digest,payloadDigest:canonicalDigest(result),observedAtMs:at},base='helix://contracts/capabilities/'+ref.replace('@1','/v1/');
  const value={kind:'succeeded',resultSchemaRef:base+'result',result,evidenceSchemaRef:base+'evidence',evidence};
  if(effectClass)value.effectReceipt={schemaRef:'helix://contracts/types/EffectReceipt/v1',schemaVersion:1,effectReceiptId:stable('arca-series-effect-receipt-',{eventId:execution.eventId}),
    effectId:canonicalDigest([effectClass,execution.idempotencyKey]),effectClass,idempotencyKey:execution.idempotencyKey,
    commitMarker:stable('arca-series-effect-marker-',{eventId:execution.eventId}),externalReceiptRef:null,outputDigest:canonicalDigest(result),
    verificationEvidenceDigest:canonicalDigest(evidence),committedAtMs:at};
  return value;
}
module.exports=Object.freeze({seriesOutcome});
