'use strict';
const {CAPABILITY,SOURCE_CAPABILITY,STAGE_CAPABILITY,PUBLISH_CAPABILITY,VERIFY_CAPABILITY}=require('../model/jav-correction-execution-contract');
const {CAPABILITY:COMMIT_CAPABILITY}=require('../model/jav-correction-commit-contract');
const {CAPABILITY:RETIREMENT_CAPABILITY}=require('../model/jav-correction-retirement-contract');
const {CAPABILITY:RECLAIM_CAPABILITY}=require('../model/jav-correction-workspace-reclaim-contract');
const EFFECTS=Object.freeze({[CAPABILITY]:'workspace_write',[SOURCE_CAPABILITY]:'pure_observation',[STAGE_CAPABILITY]:'material_commit',[PUBLISH_CAPABILITY]:'material_commit',[VERIFY_CAPABILITY]:'domain_fact_commit',[COMMIT_CAPABILITY]:'responsibility_control_commit',[RETIREMENT_CAPABILITY]:'material_commit',[RECLAIM_CAPABILITY]:'workspace_write'});
function createJavCorrectionExecutionRegistrations(options) {
  return Object.freeze(options.enabledCapabilityRefs.map(capabilityRef=>{
    const manifest=options.manifests[capabilityRef],port=options.ports[capabilityRef];
    if(!port||!manifest||manifest.ownerScope!=='arca'||manifest.effectClass!==EFFECTS[capabilityRef])throw new TypeError('Correction leaf registration is incompatible with its exact catalog contract.');
    return Object.freeze({manifest,executor:Object.freeze({version:1,execute:context=>port.execute(context)}),
      semanticValidator:Object.freeze({ref:manifest.semanticValidatorRef,validateInputs:context=>port.validateInputs(context),validateResult:(context,result)=>port.validateResult(context,result)})});
  }));
}
module.exports=Object.freeze({EFFECTS,createJavCorrectionExecutionRegistrations});
