'use strict';

const EFFECTS=Object.freeze({
  'arca.offdeck.duplicate.detect@1':'pure_observation',
  'arca.offdeck.duplicate_group.commit@1':'domain_fact_commit',
  'arca.offdeck.review_candidate.commit@1':'domain_fact_commit',
  'arca.offdeck.destruction_scope.verify@1':'pure_observation',
  'arca.offdeck.primary_material.delete@1':'destructive_commit',
  'arca.offdeck.related_reference.release@1':'domain_fact_commit',
  'arca.offdeck.unreferenced_related.delete@1':'destructive_commit',
  'arca.offdeck.deletion.verify@1':'pure_observation',
  'arca.offdeck.terminal.commit@1':'responsibility_control_commit',
});
function createOffdeckCapabilityRegistrations(options){return Object.freeze(options.enabledCapabilityRefs.map((capabilityRef)=>{const manifest=options.manifests[capabilityRef],port=options.ports[capabilityRef];if(!manifest||manifest.ownerScope!=='arca'||manifest.effectClass!==EFFECTS[capabilityRef]||!port)throw new TypeError('Arca Off-deck Capability binding is invalid: '+capabilityRef);return Object.freeze({manifest,executor:Object.freeze({version:1,execute:(context)=>port.execute(context)}),semanticValidator:Object.freeze({ref:manifest.semanticValidatorRef,validateInputs:(context)=>port.validateInputs(context),validateResult:(context,outcome)=>port.validateResult(context,outcome)})});}));}
module.exports=Object.freeze({EFFECTS,createOffdeckCapabilityRegistrations});
