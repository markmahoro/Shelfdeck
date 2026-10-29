'use strict';
const {canonicalDigest,canonicalJson}=require('./canonical-json');
const body=Object.freeze({schema:'shared.buffalo-representative-policy@1',contextMarginRatio:0.25,minimumFaceSize:40,
  maximumOtherFaceCentres:0,encoding:'png',maximumOutputBytes:10485760}),value=Object.freeze({...body,policyDigest:canonicalDigest(body)});
function representativeImagePolicy(){return value;}
function assertRepresentativeImagePolicy(policy){
  if(canonicalJson(policy)!==canonicalJson(value))throw Object.assign(new TypeError('Representative rendering differs from its frozen policy.'),{code:'BUFFALO_REPRESENTATIVE_POLICY_INVALID'});
  return policy;
}
function representativeImagePolicySchema(){return {type:'object',additionalProperties:false,properties:Object.fromEntries(Object.entries(value).map(([key,item])=>[key,{const:item}])),required:Object.keys(value)};}
module.exports=Object.freeze({representativeImagePolicy,assertRepresentativeImagePolicy,representativeImagePolicySchema});
