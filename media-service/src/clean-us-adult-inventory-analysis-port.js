'use strict';
const {canonicalJson}=require('./helix/contracts/canonical-json');
const {createUsAdultInventoryWorkspace}=require('./helix/integrations/us-adult-inventory-workspace');
const {createUsAdultInventoryAnalysis}=require('./helix/integrations/us-adult-inventory-analysis');
const {createUsAdultInventoryEngine}=require('./helix/integrations/us-adult-inventory-engine');
function createCleanUsAdultInventoryAnalysisPort(options){
  const {context,intent,aftercareCaseId,workspaceRegistry,assertAuthority}=options||{};
  if(typeof assertAuthority!=='function'||!workspaceRegistry?.rootSnapshot||typeof workspaceRegistry.listHandles!=='function')
    throw new TypeError('Inventory analysis requires a bounded Owner Workspace registry and current source authority.');
  const execution={...context,assertExecutionActive(){context.assertExecutionActive();if(assertAuthority()!==true)
    throw Object.assign(new Error('Actor refresh lost its current Inventory source authority.'),{code:'ARCA_US_ADULT_SOURCE_AUTHORITY_LOST'});}},
    workspace=createUsAdultInventoryWorkspace({rootSnapshot:{...workspaceRegistry.rootSnapshot,resolvedRoot:options.aftercareWorkspaceRoot},
      ensureWorkspace:workspaceRegistry.ensureWorkspace,registerMaterial:workspaceRegistry.registerMaterial,
      assertRegistered:handle=>workspaceRegistry.listHandles(aftercareCaseId).some(value=>canonicalJson(value)===canonicalJson(handle))}),
    engine=createUsAdultInventoryEngine({...options,context:execution}),
    preparation=createUsAdultInventoryAnalysis({...options,engine,workspace,context:execution});
  return Object.freeze({prepare:request=>{
    if(request.intent.intentDigest!==intent.intentDigest||request.aftercareCaseId!==aftercareCaseId)throw new Error('Actor preparation request crossed its Root adapter scope.');
    return preparation.prepare(request);
  },read:preparation.read});
}
module.exports=Object.freeze({createCleanUsAdultInventoryAnalysisPort});
