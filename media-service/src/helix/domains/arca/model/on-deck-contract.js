'use strict';

const CAPABILITY_REFS = Object.freeze({
  identity:'arca.acceptance.identity.verify@1', metadata:'arca.acceptance.metadata.verify@1',
  structure:'arca.acceptance.structure.verify@1', mandatory:'arca.acceptance.mandatory_media.verify@1',
  space:'arca.acceptance.space.verify@1', feasibility:'arca.acceptance.inventory_feasibility.observe@1',
  accept:'arca.acceptance.accept.commit@1', reject:'arca.acceptance.rejection.commit@1',
  slot:'arca.inventory.target_slot.prepare@1', stage:'arca.inventory.product.stage@1',
  stagedVerify:'arca.inventory.staged.verify@1', finalVerify:'arca.inventory.final_product.verify@1',
  placement:'arca.inventory.placement.switch@1', settlement:'arca.ondeck.input_settlement.delete@1',
  fulfillment:'arca.ondeck.fulfillment.verify@1', commit:'arca.ondeck.commit@1',
});

module.exports=Object.freeze({CAPABILITY_REFS});
