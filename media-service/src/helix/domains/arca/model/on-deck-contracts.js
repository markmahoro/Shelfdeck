'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
class ArcaOnDeckError extends Error{constructor(code,message){super(message);this.name='ArcaOnDeckError';this.code=code;}}
const fail=(code,message)=>{throw new ArcaOnDeckError(code,message);};
const clone=(value)=>JSON.parse(canonicalJson(value));
const freeze=(value)=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const without=(value,key)=>Object.fromEntries(Object.entries(value).filter(([name])=>name!==key));

function verifyAcceptance(value){
  const checks=clone(value?.checks||[]),offer=value?.offer,standard=value?.shelfStandard,placement=value?.placement;
  if(!offer||!standard||!placement||offer.shelfId!==standard.shelfId||offer.shelfId!==placement.shelfId)fail('P10_ACCEPTANCE_SCOPE','Offer, Standard and Placement must name one Shelf.');
  const required=['identity','metadata','structure','mandatory_media','space','inventory_feasibility'];
  if(required.some((kind)=>!checks.some((item)=>item.kind===kind))||new Set(checks.map((item)=>item.kind)).size!==checks.length)fail('P10_ACCEPTANCE_CHECK_SET','Acceptance check set is incomplete or duplicated.');
  if(checks.some((item)=>item.offerId!==offer.offerId||item.packageDigest!==offer.packageDigest||item.standardRevision!==standard.revision||item.standardDigest!==standard.digest))fail('P10_ACCEPTANCE_STALE','Acceptance evidence is stale or crosses an Offer.');
  const failed=checks.filter((item)=>item.outcome!=='passed').sort((a,b)=>a.kind.localeCompare(b.kind));
  const basisDigest=canonicalDigest({schema:'arca.acceptance-basis@1',offerId:offer.offerId,packageDigest:offer.packageDigest,shelfStandard:standard,placement,checks});
  return freeze({outcome:failed.length?'rejected':'accepted',offerId:offer.offerId,packageId:offer.packageId,packageDigest:offer.packageDigest,shelfId:offer.shelfId,basisDigest,failed});
}

function buildHandoffBCommit(value){
  const verification=verifyAcceptance(value),decisionId=canonicalDigest({schema:'arca.handoff-b-decision-id@1',offerId:verification.offerId,basisDigest:verification.basisDigest});
  if(verification.outcome==='rejected'){
    const rejection={handoffKind:'libra_to_arca',decisionId,offerId:verification.offerId,deliverableId:verification.packageId,packageDigest:verification.packageDigest,
      reasons:verification.failed.map((item)=>({code:item.reasonCode,evidenceDigest:item.evidenceDigest})),basisDigest:verification.basisDigest,decidedAtMs:value.committedAtMs};
    rejection.rejectionDigest=canonicalDigest(rejection);
    return freeze({kind:'rejected',decision:{decisionId,state:'rejected',basisDigest:verification.basisDigest},rejection,
      receipt:{receiptId:canonicalDigest({schema:'arca.handoff-b-rejected-receipt@1',decisionId}),decisionId,outcome:'rejected'},
      outbox:{messageId:canonicalDigest({schema:'arca.product-rejected-message@1',decisionId}),schemaRef:'ArcaProductRejectedMessage@1',rejectionDigest:rejection.rejectionDigest}});
  }
  const controls=clone(value.materialControls||[]);
  if(!controls.length||controls.some((item)=>item.ownerDomain!=='libra'||item.ownerScopeId!==verification.packageId||item.expectedRevision!==item.currentRevision||item.expectedDigest!==item.currentDigest))fail('P10_CONTROL_CAS','Accepted Handoff requires exact Libra package Control fences.');
  const custodyId=canonicalDigest({schema:'arca.ondeck-custody-id@1',offerId:verification.offerId,packageDigest:verification.packageDigest});
  const transferredControls=controls.map((item)=>({...item,ownerDomain:'arca',ownerScopeType:'on_deck_custody',ownerScopeId:custodyId,committedRevision:item.currentRevision+1}));
  return freeze({kind:'accepted',decision:{decisionId,state:'accepted',basisDigest:verification.basisDigest},custody:{custodyId,shelfId:verification.shelfId,packageId:verification.packageId,packageDigest:verification.packageDigest,state:'accepted_not_owned'},
    bindings:controls.map((item)=>({bindingId:canonicalDigest({schema:'arca.material-binding-id@1',custodyId,materialKey:item.materialKey}),custodyId,materialKey:item.materialKey})),transferredControls,
    receipt:{receiptId:canonicalDigest({schema:'arca.handoff-b-accepted-receipt@1',decisionId}),decisionId,outcome:'accepted',custodyId},
    outbox:{messageId:canonicalDigest({schema:'arca.product-accepted-message@1',decisionId}),schemaRef:'ArcaProductAcceptedMessage@1',custodyId}});
}

function stageInventory(value){
  const custody=value?.custody,slot=value?.targetSlot,manifest=value?.productMaterialManifest;
  if(!custody||custody.state!=='accepted_not_owned'||slot?.shelfId!==custody.shelfId||manifest?.manifestRole!=='product_delivery')fail('P10_STAGE_INPUT','Staging requires accepted custody, exact Shelf slot and product delivery manifest.');
  const members=clone(manifest.members||[]);
  if(!members.length||members.some((item)=>!item.committedControlRevision||!item.committedControlProjectionDigest))fail('P10_STAGE_CONTROL','Every staged member requires committed Product Control evidence.');
  const stageId=canonicalDigest({schema:'arca.inventory-stage-id@1',custodyId:custody.custodyId,slotDigest:slot.slotDigest,manifestDigest:manifest.manifestDigest});
  return freeze({stageId,custodyId:custody.custodyId,shelfId:custody.shelfId,slot:clone(slot),members,state:'staged',stageDigest:canonicalDigest({stageId,custodyId:custody.custodyId,slot,members})});
}

function buildOnDeckCommit(value){
  const stage=value?.stagedInventory,verification=value?.stagedVerification,finalDecision=value?.finalInventoryDecision;
  if(!stage||stage.state!=='staged'||verification?.stageId!==stage.stageId||verification.outcome!=='passed'||finalDecision?.stageId!==stage.stageId||finalDecision.outcome!=='commit')fail('P10_ONDECK_INPUT','On-deck Commit requires the exact passed stage and final decision.');
  if(verification.stageDigest!==stage.stageDigest||finalDecision.verificationDigest!==verification.verificationDigest)fail('P10_ONDECK_CONTINUITY','On-deck verification continuity is invalid.');
  const entryId=value.existingShelfEntry?.shelfEntryId||canonicalDigest({schema:'arca.shelf-entry-id@1',shelfId:stage.shelfId,canonicalIdentityDigest:finalDecision.canonicalIdentityDigest});
  if(value.existingShelfEntry&&value.existingShelfEntry.canonicalIdentityDigest!==finalDecision.canonicalIdentityDigest)fail('P10_ENTRY_IDENTITY','Existing Shelf Entry identity does not match.');
  const revision=(value.existingShelfEntry?.revision||0)+1;
  const inventory=stage.members.map((item)=>({inventoryMaterialId:canonicalDigest({schema:'arca.inventory-material-id@1',entryId,materialKey:item.materialKey}),entryId,materialKey:item.materialKey,physicalIdentity:item.physicalIdentity}));
  const entry={shelfEntryId:entryId,shelfId:stage.shelfId,revision,canonicalIdentityDigest:finalDecision.canonicalIdentityDigest,state:'active'};
  const deckFact={deckFactId:canonicalDigest({schema:'arca.deck-fact-id@1',entryId,revision}),shelfEntryId:entryId,revision,inventoryDigest:canonicalDigest(inventory),state:'on_deck'};deckFact.deckFactDigest=canonicalDigest(deckFact);
  const offloadCompletion={packageId:value.packageId,packageDigest:value.packageDigest,completedAtMs:value.committedAtMs};offloadCompletion.completionDigest=canonicalDigest(offloadCompletion);
  return freeze({entry,inventory,canonicalIdentity:{shelfEntryId:entryId,identityDigest:finalDecision.canonicalIdentityDigest},deckFact,
    custody:{...clone(value.custody),state:'owned',shelfEntryId:entryId},settlementApproval:{custodyId:value.custody.custodyId,approved:true},offloadCompletion,
    receipt:{receiptId:canonicalDigest({schema:'arca.ondeck-commit-receipt@1',stageId:stage.stageId,deckFactDigest:deckFact.deckFactDigest}),stageId:stage.stageId,shelfEntryId:entryId,deckFactDigest:deckFact.deckFactDigest}});
}

module.exports=Object.freeze({ArcaOnDeckError,verifyAcceptance,buildHandoffBCommit,stageInventory,buildOnDeckCommit});

