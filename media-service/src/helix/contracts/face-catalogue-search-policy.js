'use strict';
const {canonicalDigest,canonicalJson}=require('./canonical-json');
const body=Object.freeze({schema:'shared.face-catalogue-search-policy@1',queryCount:100,maximumResults:5,maximumDistance:0.6,
  poseAdjustment:'sense2_side_yaw@1',linkCollapse:'sense2_explicit_uid_links_no_endpoint@1'}),value=Object.freeze({...body,policyDigest:canonicalDigest(body)});
function catalogueSearchPolicy(){return value;}
function assertCatalogueSearchPolicy(policy){
  if(canonicalJson(policy)!==canonicalJson(value))throw Object.assign(new TypeError('Catalogue retrieval differs from the qualified Sense policy.'),{code:'FACE_CATALOGUE_SEARCH_POLICY_INVALID'});
  return policy;
}
function catalogueSearchPolicySchema(){return {type:'object',additionalProperties:false,properties:Object.fromEntries(Object.entries(value).map(([key,item])=>[key,{const:item}])),required:Object.keys(value)};}
module.exports=Object.freeze({catalogueSearchPolicy,assertCatalogueSearchPolicy,catalogueSearchPolicySchema});
