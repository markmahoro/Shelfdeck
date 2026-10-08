'use strict';
const fs=require('node:fs'),path=require('node:path');
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),mode=process.argv[3];
const service=path.resolve(__dirname,'../..');
const req=name=>require(path.join(service,name));
const {createAftercareCapabilityPorts}=req('src/helix/domains/arca/capabilities/aftercare-capability-ports');
const {CAPABILITY_REFS:C}=req('src/helix/domains/arca/model/aftercare-contract');
const {computeBoundedMaterialFingerprintSync}=req('src/helix/integrations/bounded-material-fingerprint');
const rename=fs.promises.rename;
if(mode==='crash')fs.promises.rename=async(from,to)=>{
  await rename(from,to);
  if(path.resolve(to)===path.resolve(input.crashLocation))process.exit(73);
};
const store={history:()=>input.history,aftercareWorkspaceRootSnapshot:input.workspaceRootSnapshot,
  aftercareWorkspaceLocation:(_caseId,relative)=>path.join(input.workspaceRoot,relative)};
const ports=createAftercareCapabilityPorts({now:()=>1000,
  schemaManifest:req('src/helix/foundation/persistence/generated/clean-schema.manifest.json'),
  unitOfWork:{execute(){throw new Error('Fixture materialization must not write Owner facts.');}},
  computeBoundedMaterialFingerprintSync,contextReader:{read:()=>input.context,store},
  workResultReader:{read:workId=>workId==='work'?input.rows:workId==='prepare'?input.preparedRows:[]}});
ports[C.artifactMaterialize].execute({...input.execution,...(mode==='crash'?{}:{recoveryDecision:'continue_forward'})})
  .then(result=>process.stdout.write(JSON.stringify(result)))
  .catch(error=>{process.stdout.write(JSON.stringify({error:error.code||error.message}));process.exitCode=1;});
