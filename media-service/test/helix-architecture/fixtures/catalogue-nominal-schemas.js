'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createCapabilityContractValidator}=require('../../../src/helix/foundation/capability/contract-validator');
const proposed=require('../../../src/helix/contracts/us-adult-catalogue-work-types');
const {canonicalDigest}=require('../../../src/helix/contracts/canonical-json');
function createValidator({includeProposed=false}={}){
  const root=path.resolve(__dirname,'../../../src/helix/contracts'),schemas=[];
  function collect(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const file=path.join(directory,entry.name);if(entry.isDirectory())collect(file);else if(entry.name==='schema.json')schemas.push(JSON.parse(fs.readFileSync(file)));
  }}
  collect(path.join(root,'types'));collect(path.join(root,'domain-types'));
  for(const ref of [proposed.FRAME,proposed.EMBED,proposed.CLUSTER])schemas.push(JSON.parse(fs.readFileSync(path.join(root,'capabilities',ref.replaceAll('.','/').replace('@1','/v1/result.schema.json')))));
  // These are explicit proposed contracts. Existing production schemas are not
  // weakened or overwritten to make an unregistered Capability pass.
  if(includeProposed)for(const schema of [proposed.completedBatchSetSchema(),proposed.observationHandleSchema()]){
    const existing=schemas.find(value=>value.$id===schema.$id);
    if(existing&&canonicalDigest(existing)!==canonicalDigest(schema))throw Error('The materialized catalogue contract differs from its reviewed schema function.');
    if(!existing)schemas.push(schema);
  }
  return createCapabilityContractValidator({schemas});
}
module.exports=Object.freeze({createValidator});
