'use strict';
const EFFECTS=Object.freeze({
  'arca.aftercare.custody.observe@1':'pure_observation','arca.aftercare.presentation.observe@1':'pure_observation',
  'arca.aftercare.conformance.observe@1':'pure_observation','arca.aftercare.assessment.commit@1':'domain_fact_commit',
  'arca.aftercare.text_artifact.render@1':'workspace_write','arca.aftercare.binary_artifact.acquire@1':'workspace_write',
  'arca.aftercare.artifact.materialize@1':'material_commit','arca.aftercare.media.remux@1':'workspace_write',
  'arca.aftercare.media.transcode@1':'workspace_write','arca.aftercare.media.verify@1':'pure_observation',
  'arca.aftercare.input_settlement.delete@1':'destructive_commit','arca.aftercare.inventory.commit@1':'responsibility_control_commit',
  'arca.aftercare.case.commit@1':'domain_fact_commit','arca.aftercare.workspace.reclaim@1':'workspace_write',
});
function createAftercareCapabilityRegistrations(options){return Object.freeze(options.enabledCapabilityRefs.map((capabilityRef)=>{const manifest=options.manifests[capabilityRef],port=options.ports[capabilityRef];
  if(!manifest||manifest.ownerScope!=='arca'||manifest.effectClass!==EFFECTS[capabilityRef]||!port)throw new TypeError('Arca Aftercare Capability binding is invalid: '+capabilityRef);
  return Object.freeze({manifest,executor:Object.freeze({version:1,execute:(context)=>port.execute(context)}),semanticValidator:Object.freeze({ref:manifest.semanticValidatorRef,validateInputs:(context)=>port.validateInputs(context),validateResult:(context,outcome)=>port.validateResult(context,outcome)})});}));}
module.exports=Object.freeze({EFFECTS,createAftercareCapabilityRegistrations});
