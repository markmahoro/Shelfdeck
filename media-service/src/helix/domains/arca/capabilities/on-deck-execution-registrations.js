'use strict';

const EFFECTS=Object.freeze({
  'arca.acceptance.identity.verify@1':'pure_observation','arca.acceptance.metadata.verify@1':'pure_observation',
  'arca.acceptance.structure.verify@1':'pure_observation','arca.acceptance.mandatory_media.verify@1':'pure_observation',
  'arca.acceptance.space.verify@1':'pure_observation','arca.acceptance.inventory_feasibility.observe@1':'pure_observation',
  'arca.acceptance.accept.commit@1':'responsibility_control_commit','arca.acceptance.rejection.commit@1':'domain_fact_commit',
  'arca.inventory.target_slot.prepare@1':'material_commit','arca.inventory.product.stage@1':'material_commit',
  'arca.inventory.staged.verify@1':'pure_observation','arca.inventory.final_product.verify@1':'pure_observation',
  'arca.inventory.placement.switch@1':'material_commit','arca.ondeck.input_settlement.delete@1':'destructive_commit',
  'arca.ondeck.fulfillment.verify@1':'pure_observation','arca.ondeck.commit@1':'responsibility_control_commit',
});
function createOnDeckCapabilityRegistrations(options){return Object.freeze(options.enabledCapabilityRefs.map((capabilityRef)=>{
  const manifest=options.manifests[capabilityRef],port=options.ports[capabilityRef];
  if(!manifest||manifest.ownerScope!=='arca'||manifest.effectClass!==EFFECTS[capabilityRef]||!port)
    throw new TypeError('Arca On-deck Capability binding is invalid: '+capabilityRef);
  return Object.freeze({manifest,executor:Object.freeze({version:1,execute:(context)=>port.execute(context)}),semanticValidator:Object.freeze({
    ref:manifest.semanticValidatorRef,validateInputs:(context)=>port.validateInputs(context),validateResult:(context,outcome)=>port.validateResult(context,outcome)})});
}));}
module.exports=Object.freeze({EFFECTS,createOnDeckCapabilityRegistrations});
