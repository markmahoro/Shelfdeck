'use strict';
const fs=require('node:fs'),path=require('node:path');
const {readBoundedFileSnapshotSync}=require('./helix/integrations/bounded-material-fingerprint');
const {assertSelection}=require('./helix/contracts/us-adult-actor-selection');
const {canonicalJson}=require('./helix/contracts/canonical-json');
const {createUsAdultInventoryWorkspace}=require('./helix/integrations/us-adult-inventory-workspace');
const {createUsAdultInventoryAnalysis}=require('./helix/integrations/us-adult-inventory-analysis');
const {createUsAdultInventoryEngine}=require('./helix/integrations/us-adult-inventory-engine');
const {createUsAdultInventoryFiles}=require('./helix/integrations/us-adult-inventory-files');
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
    preparation=createUsAdultInventoryAnalysis({...options,engine,workspace,context:execution}),
    files=createUsAdultInventoryFiles({resolveWorkspaceMaterial:(caseId,intentDigest,handle)=>{
      if(caseId!==aftercareCaseId||intentDigest!==intent.intentDigest)throw new Error('Actor file source crossed its exact Case and Intent.');
      workspace.read({intent,aftercareCaseId,context:execution,handle});
      return {location:path.join(options.aftercareWorkspaceRoot,aftercareCaseId,...handle.relativePath.split('/'))};
    }});
  return Object.freeze({prepare:request=>{
    if(request.intent.intentDigest!==intent.intentDigest||request.aftercareCaseId!==aftercareCaseId)throw new Error('Actor preparation request crossed its Root adapter scope.');
    return preparation.prepare(request);
  },read:preparation.read,files,
  readMember:handle=>workspace.read({intent,aftercareCaseId,context:execution,handle}),
  readJson:handle=>workspace.readJson({intent,aftercareCaseId,context:execution,handle}),
  writeMember:(kind,bytes)=>workspace.write({intent,aftercareCaseId,context:execution,kind,bytes,recoveryDecision:context.recoveryDecision}),
  resolveMember:handle=>{workspace.read({intent,aftercareCaseId,context:execution,handle});return {location:path.join(options.aftercareWorkspaceRoot,aftercareCaseId,...handle.relativePath.split('/'))};},
  readNfo:source=>{
    execution.assertExecutionActive();if(!source)return null;
    const relative=path.relative(source.rootLocation,source.location);if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('Actor NFO escaped its owned target.');
    let current=source.rootLocation;for(const part of [null,...relative.split(path.sep)]){if(part!==null)current=path.join(current,part);const stat=fs.lstatSync(current);
      if(stat.isSymbolicLink()||(current===source.location?!stat.isFile():!stat.isDirectory()))throw new Error('Actor NFO traverses a linked target.');}
    const observed=readBoundedFileSnapshotSync(source.location,256*1024,{requireStableSnapshot:true}),identity=source.physicalIdentity;
    if(String(observed.stat.ino)!==identity.inode||Number(observed.stat.size)!==identity.sizeBytes||observed.fingerprintAlgorithm!==identity.fingerprintAlgorithm||
        observed.fingerprintVersion!==identity.fingerprintVersion||observed.contentFingerprint!==identity.contentFingerprint)
      throw Object.assign(new Error('Actor NFO changed from its exact Inventory binding.'),{code:'ARCA_US_ADULT_FILE_CHANGED'});
    execution.assertExecutionActive();return observed.bytes;
  },async renderPoster({selection,sourceResult}){
    assertSelection(selection,{shelfEntryId:intent.shelfEntryId,aftercareCaseId,validator:options.contractValidator});
    if(selection.sourceResultRef.resultDigest!==require('./helix/contracts/canonical-json').canonicalDigest(sourceResult))throw new Error('Actor poster source Result changed.');
    const prepared=preparation.read({intent,aftercareCaseId,result:sourceResult,includeFrames:true});
    return engine.renderPoster({...prepared,personSnapshot:selection.personSnapshot,referenceAssetId:selection.referenceAssetId,originalName:selection.originalName});
  },async matchPage({intent:requested,aftercareCaseId:caseId,sourceResult,page}){
    if(requested.intentDigest!==intent.intentDigest||caseId!==aftercareCaseId)throw new Error('Actor matching request crossed its Root adapter scope.');
    const prepared=preparation.read({intent,aftercareCaseId,result:sourceResult});
    return engine.matchPage({analysis:prepared.analysis,personReferenceProjections:page.items.map(person=>person.referenceProjection)});
  }});
}
module.exports=Object.freeze({createCleanUsAdultInventoryAnalysisPort});
