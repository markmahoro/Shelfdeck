'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const CAPS=Object.freeze({files:'arca.series_root.files.relocate@1',commit:'arca.series_root.inventory.commit@1'});
const PROCESS='arca_series_root_relocation';
const REFERENCE='helix://contracts/domain-types/SeriesRootRelocationReference/v1';
const RESULT='helix://contracts/types/SeriesRootRelocationCommitted/v1';
const FILES='helix://contracts/types/SeriesRootRelocationFilesVerified/v1';
const PLANNER='helix://arca/planners/series-root-relocation/v1';
const OBJECTIVE='helix://arca/work/series_root_relocation/v1';
const marker=eventId=>'arca-series-root-marker-'+canonicalDigest(eventId).slice(0,40);
function reference(row){return {schemaRef:REFERENCE,schemaVersion:1,revision:1,digest:row.plan_digest,relocationId:row.relocation_id,scopeId:row.scope_id,planDigest:row.plan_digest};}
function outcome(ref,result,execution,effectClass){
  const at=result.observedAtMs??result.committedAtMs,base='helix://contracts/capabilities/'+ref.replace('@1','/v1/');
  const evidence={evidenceId:'arca-series-root-proof-'+canonicalDigest({ref,result}).slice(0,40),evidenceKind:'series_root_relocation',
    producerRef:ref,basisDigest:result.planDigest,payloadDigest:canonicalDigest(result),observedAtMs:at};
  return {kind:'succeeded',resultSchemaRef:base+'result',result,evidenceSchemaRef:base+'evidence',evidence,
    effectReceipt:{schemaRef:'helix://contracts/types/EffectReceipt/v1',schemaVersion:1,
      effectReceiptId:'arca-series-root-receipt-'+canonicalDigest(execution.eventId).slice(0,40),effectId:canonicalDigest([effectClass,execution.idempotencyKey]),
      effectClass,idempotencyKey:execution.idempotencyKey,commitMarker:marker(execution.eventId),externalReceiptRef:null,
      outputDigest:canonicalDigest(result),verificationEvidenceDigest:canonicalDigest(evidence),committedAtMs:at}};
}
module.exports=Object.freeze({CAPS,PROCESS,REFERENCE,RESULT,FILES,PLANNER,OBJECTIVE,marker,reference,outcome});
