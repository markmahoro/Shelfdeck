'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const CAPABILITY='arca.jav_correction.inventory.commit@1',SCHEMA='helix://contracts/types/JavCorrectionCommitReceipt/v1';
const text=()=>({type:'string',minLength:1,maxLength:256}),digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'}),revision=()=>({type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER});
function javCorrectionCommitReceiptSchema() {
  const properties={schemaRef:{const:SCHEMA},schemaVersion:{const:1},receiptId:text(),receiptKind:{const:'jav_identity_correction_committed'},ownerDomain:{const:'arca'},
    scopeType:{const:'jav_identity_correction'},scopeId:text(),scopeDigest:digest(),effectReceiptRef:text(),committedAtMs:{type:'integer',minimum:0},
    correctionId:text(),shelfEntryId:text(),previousCanonicalIdentityRevision:revision(),newCanonicalIdentityRevision:revision(),
    previousInventoryRevision:revision(),newInventoryRevision:revision(),canonicalIdentityDigest:digest(),canonicalIdentityKey:digest(),inventoryDigest:digest(),
    verificationDigest:digest(),controlChangeDigest:digest(),changeDigest:digest(),originalCommitDigest:digest()};
  return {$schema:'https://json-schema.org/draft/2020-12/schema',$id:SCHEMA,title:'JavCorrectionCommitReceipt@1',
    'x-helix-ssotRefs':['8.6.19'],'x-helix-envelopeRef':'helix://contracts/types/ReceiptEnvelope/v1','x-helix-maxCanonicalBytes':16384,
    type:'object',additionalProperties:false,properties,required:Object.keys(properties)};
}
function correctionCommitWorkId(scope,filePlanDigest,record=null) {
  const base='arca-jav-correction-commit-work-'+canonicalDigest({correctionId:scope.correctionId,scopeDigest:scope.digest,filePlanDigest}).slice(0,40);
  return record?require('./jav-correction-recovery').recoveryWorkId(record,'jav_correction_commit',base):base;
}
module.exports=Object.freeze({CAPABILITY,SCHEMA,javCorrectionCommitReceiptSchema,correctionCommitWorkId});
