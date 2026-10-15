'use strict';

const {SCHEMA,buildJavCorrectionDirectoryScope}=require('../model/jav-correction-directory-scope');
function createJavCorrectionDirectoryPreparation(options){
  return Object.freeze({prepare(correctionId,additionalScanRoots=[]){
    const record=options.correctionStore.get(correctionId);
    if(!record||record.state!=='committed'||record.cleanupState!=='completed')throw Object.assign(new Error('Directory preparation requires completed correction cleanup.'),{code:'ARCA_JAV_CORRECTION_DIRECTORY_NOT_READY'});
    // This Owner reader verifies actual Work/Event/Effect/Result and historical commit evidence.
    const cleanupReceipt=options.cleanupStore.read(correctionId),base=options.readProtection(record.shelfEntryId);
    if(!Array.isArray(additionalScanRoots))throw new TypeError('Additional directory protection roots must be an array.');
    const protection={...base,scanRoots:[...base.scanRoots,...additionalScanRoots]};
    const value=buildJavCorrectionDirectoryScope({record,cleanupReceipt,protection});options.contractValidator.validate(SCHEMA,value);return value;
  }});
}
module.exports=Object.freeze({createJavCorrectionDirectoryPreparation});
