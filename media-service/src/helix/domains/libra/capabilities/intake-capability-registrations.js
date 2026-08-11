'use strict';

const EFFECTS=Object.freeze({
  'libra.intake.candidate.verify@1':'pure_observation',
  'libra.intake.material.verify@1':'pure_observation',
  'libra.intake.binding.resolve@1':'pure_observation',
  'libra.intake.accept.commit@1':'responsibility_control_commit',
  'libra.intake.rejection.commit@1':'domain_fact_commit'
});
function createIntakeCapabilityRegistrations(options){return Object.freeze(options.enabledCapabilityRefs.map((capabilityRef)=>{
  const manifest=options.manifests[capabilityRef],port=options.ports[capabilityRef];
  if(!manifest||manifest.ownerScope!=='libra'||manifest.effectClass!==EFFECTS[capabilityRef]||!port)throw new TypeError('Libra Intake Capability binding is invalid: '+capabilityRef);
  return Object.freeze({manifest,executor:Object.freeze({version:1,execute:(context)=>port.execute(context)}),semanticValidator:Object.freeze({
    ref:manifest.semanticValidatorRef,validateInputs:(context)=>port.validateInputs(context),validateResult:(context,outcome)=>port.validateResult(context,outcome)})});
}));}
module.exports=Object.freeze({EFFECTS,createIntakeCapabilityRegistrations});
