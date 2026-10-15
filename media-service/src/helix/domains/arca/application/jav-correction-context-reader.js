'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {buildJavCorrectionBasis}=require('../model/jav-identity-correction');
const {buildJavCorrectionScope,buildJavCorrectionScopeForRecovery}=require('../model/jav-correction-execution-contract');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
function createJavCorrectionContextReader(options) {
  const {correctionStore,contextReader,materialControlProjectionPort:controls,rootSnapshot}=options;
  function readContext(correctionId,recovery) {
    const record=correctionStore.get(correctionId);if(!record)return null;
    if(record.state!==(recovery?'attention_required':'active'))fail('ARCA_JAV_CORRECTION_SCOPE_STALE','Correction does not hold the required execution or recovery state.');
    const c=contextReader.read(record.shelfEntryId);
    if(!c||c.raw.correctionGate?.correction_id!==correctionId)fail('ARCA_JAV_CORRECTION_SCOPE_STALE','Correction no longer holds its Entry gate.');
    const keys=[...new Set(c.raw.materials.map(row=>row.material_key))].sort(),projections=[];
    for(let offset=0;offset<keys.length;offset+=500)projections.push(...controls.getMaterialControlProjections(keys.slice(offset,offset+500)));
    const basis=buildJavCorrectionBasis({raw:{...c.raw,correctionGate:null},controlProjections:projections,
      activeCases:contextReader.store.history(record.shelfEntryId).cases});
    if(basis.basisDigest!==record.proof.basis.basisDigest)fail('ARCA_JAV_CORRECTION_SCOPE_STALE','Current owned Entry Basis changed after correction admission.');
    return Object.freeze({record,context:c,scope:(recovery?buildJavCorrectionScopeForRecovery:buildJavCorrectionScope)(record,rootSnapshot.rootHandleRef)});
  }
  const read=correctionId=>readContext(correctionId,false);
  return Object.freeze({read,readForRecovery:correctionId=>readContext(correctionId,true),assertCurrent(record,scope){const actual=read(record.correctionId);
    if(!actual||actual.record.admissionDigest!==record.admissionDigest||canonicalDigest(actual.scope)!==canonicalDigest(scope))
      fail('ARCA_JAV_CORRECTION_SCOPE_STALE','Correction execution scope changed.');
    return actual;}});
}
module.exports=Object.freeze({createJavCorrectionContextReader});
