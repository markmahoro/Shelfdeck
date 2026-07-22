'use strict';
const CAPABILITIES=Object.freeze([
  'arca.acceptance.identity.verify@1','arca.acceptance.metadata.verify@1','arca.acceptance.structure.verify@1','arca.acceptance.mandatory_media.verify@1','arca.acceptance.space.verify@1','arca.acceptance.inventory_feasibility.observe@1','arca.acceptance.accept.commit@1','arca.acceptance.rejection.commit@1',
  'arca.inventory.target_slot.prepare@1','arca.inventory.product.stage@1','arca.inventory.staged.verify@1','arca.inventory.final_primary.verify@1','arca.inventory.placement.switch@1','arca.ondeck.fulfillment.verify@1','arca.ondeck.commit@1','arca.ondeck.input_settlement.delete@1'
]);
const registrations=()=>CAPABILITIES.map((capabilityRef)=>Object.freeze({capabilityRef,ownerScope:'arca',inputMode:'typed_only',storeAccess:'owner_repository_only'}));
module.exports=Object.freeze({CAPABILITIES,registrations});

