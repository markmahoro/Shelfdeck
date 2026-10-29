'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {canonicalJson}=require('../../../src/helix/contracts/canonical-json');
const {createGeneration,MEMBER_NAMES}=require('../../../src/helix/contracts/face-catalogue-generation');
const {verifyCatalogueGenerationFiles}=require('../../../src/helix/integrations/face-catalogue-verification');
async function main(){
  // Expected release declarations come from the previously verified Phase 1 evidence, never newly hashed data files.
  const expected=JSON.parse(fs.readFileSync('/inputs/database-manifest.json','utf8')),root='/catalogue',raw=fs.readFileSync(path.join(root,'manifest.json'));
  assert.equal(canonicalJson(JSON.parse(raw)),canonicalJson(expected));
  const generation=createGeneration({datasetVersion:expected.version,manifestDigest:crypto.createHash('sha256').update(raw).digest('hex'),
    members:MEMBER_NAMES.map(name=>({name,bytes:fs.statSync(path.join(root,name)).size,sha256:expected.checksums[name].replace(/^sha256:/,'')}))}),began=performance.now(),
    verification=await verifyCatalogueGenerationFiles({root,generation,deadlineAtMs:Date.now()+120000});
  fs.writeFileSync('/output/catalogue-generation-report.json',JSON.stringify({generation,verification,elapsedMs:performance.now()-began}));
  console.log(JSON.stringify({passed:true,generationDigest:generation.generationDigest,members:verification.verifiedMembers.length,totalBytes:verification.totalBytes,elapsedMs:performance.now()-began}));
}
main().catch(error=>{console.error(JSON.stringify({failed:true,code:error.code||error.name,message:String(error.message).slice(0,512)}));process.exitCode=1;});
