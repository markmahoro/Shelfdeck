'use strict';
const fs=require('node:fs'),path=require('node:path');
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),phase=process.argv[3],
  {createUsAdultInventoryFiles}=require('../../../src/helix/integrations/us-adult-inventory-files');
if(!['publish','retire'].includes(phase))throw new Error('Unknown isolated crash phase.');
const mutation=phase==='publish'?'linkSync':'unlinkSync',original=fs[mutation],
  crashLocation=phase==='publish'?input.plan.members[0].targetLocation:input.plan.members[0].retainedLocation;
fs[mutation]=function(...args){const result=original.apply(fs,args),location=args[phase==='publish'?1:0];
  if(path.resolve(location)===path.resolve(crashLocation))process.exit(73);return result;};
const io=createUsAdultInventoryFiles({resolveWorkspaceMaterial:(caseId,intentDigest,handle)=>{
  if(caseId!==input.plan.aftercareCaseId||intentDigest!==input.plan.intentDigest)throw new Error('Foreign isolated workspace.');return {location:handle.location};
}});
io[phase](input.plan,input.manifest,{shouldContinue:()=>true,inventoryCommitted:phase==='retire',recoveryDecision:'continue_forward'})
  .then(()=>{process.exitCode=1;}).catch(error=>{process.stderr.write(error.stack);process.exitCode=1;});
