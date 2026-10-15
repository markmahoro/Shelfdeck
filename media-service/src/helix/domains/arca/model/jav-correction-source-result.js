'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {assertJavCorrectionRecoveryReceipt}=require('./jav-correction-recovery');
const {SOURCE_CAPABILITY,SOURCE_SCHEMA,javCorrectionAssetsWorkId,assertJavCorrectionVerifiedSource,assertJavCorrectionHistoricalSource}=require('./jav-correction-execution-contract');
const RECOVERY_SOURCE_PROJECTION='helix://arca/jav-correction-projections/RecoveryVerifiedSource/v1';
const fail=()=>{throw Object.assign(new Error('Correction requires the exact immutable successful Source Event.'),{code:'ARCA_JAV_CORRECTION_SOURCE_RESULT_UNPROVEN'});};
function isPinnedJavCorrectionSource(record,reference){
  if(!record.recoveryIntent)return false;
  const receipt=assertJavCorrectionRecoveryReceipt(record.recoveryIntent,record),pin=receipt.sourceResultReference;
  return Boolean(pin&&reference.capabilityRef===SOURCE_CAPABILITY&&pin.workId===reference.workId&&pin.eventId===reference.eventId&&pin.resultDigest===reference.resultDigest);
}
function readJavCorrectionSourceResult({record,scope,workResultReader,contractValidator}){
  const pin=record.recoveryIntent?.sourceResultReference,workId=pin?.workId||javCorrectionAssetsWorkId(scope,record),work=workResultReader.status(workId),
    rows=workResultReader.read(workId).filter(row=>row.capabilityRef===SOURCE_CAPABILITY&&row.state==='succeeded'&&row.outcomeKind==='succeeded'&&(!pin||row.eventId===pin.eventId));
  if(work?.owner_domain!=='arca'||work.process_type!=='arca_jav_identity_correction'||work.process_id!==record.correctionId||work.basis_digest!==scope.digest||rows.length!==1)fail();
  const row=rows[0],reference={workId,eventId:row.eventId,capabilityRef:SOURCE_CAPABILITY,resultDigest:row.resultDigest};
  if(row.resultDigest!==canonicalDigest(row.result)||pin&&!isPinnedJavCorrectionSource(record,reference)||
      work.state!=='succeeded'&&!(work.state==='failed'&&isPinnedJavCorrectionSource(record,reference)))fail();
  if(row.resultSchemaRef!=='helix://contracts/capabilities/arca.jav_correction.source.verify/v1/result')fail();
  contractValidator.validate(SOURCE_SCHEMA,row.result);
  (record.state==='attention_required'?assertJavCorrectionHistoricalSource:assertJavCorrectionVerifiedSource)(record,scope,row.result);
  return Object.freeze({...row,workId,reference});
}
module.exports=Object.freeze({RECOVERY_SOURCE_PROJECTION,isPinnedJavCorrectionSource,readJavCorrectionSourceResult});
