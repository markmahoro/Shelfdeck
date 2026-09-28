'use strict';
const {canonicalDigest}=require('./canonical-json');
const digest={type:'string',pattern:'^[a-f0-9]{64}$'};
const fields={editionKind:{const:'restored_4k'},libraRunId:{type:'string',minLength:1,maxLength:256},candidateDigest:digest,
  identityVerificationDigest:digest,packageVerificationDigest:digest,claimDigest:digest,
  sourceHandleDigest:digest,productContentFingerprint:digest,evidenceDigest:digest};
const editionEvidenceSchema=Object.freeze({type:'object',additionalProperties:false,properties:fields,required:Object.keys(fields)});
function validEditionEvidence(value,fingerprint){
  if(!value||value.editionKind!=='restored_4k'||typeof value.libraRunId!=='string')return false;
  const {evidenceDigest,...body}=value;
  return Object.keys(fields).length===Object.keys(value).length&&Object.keys(fields).every(key=>
    key==='editionKind'||key==='libraRunId'||/^[a-f0-9]{64}$/.test(value[key]||''))&&
    evidenceDigest===canonicalDigest(body)&&(!fingerprint||value.productContentFingerprint===fingerprint);
}
function bindEditionEvidence(value,handle,runId){
  if(!validEditionEvidence(value)||value.libraRunId!==runId)throw new Error('Media edition provenance is invalid.');
  const {evidenceDigest,...body}=value;
  body.productContentFingerprint=(handle.physicalIdentity||handle.identity).contentFingerprint;
  return Object.freeze({...body,evidenceDigest:canonicalDigest(body)});
}
module.exports=Object.freeze({editionEvidenceSchema,validEditionEvidence,bindEditionEvidence});
