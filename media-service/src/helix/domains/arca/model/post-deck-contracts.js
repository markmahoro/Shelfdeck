'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
class ArcaPostDeckError extends Error{constructor(code,message){super(message);this.name='ArcaPostDeckError';this.code=code;}}
const fail=(code,message)=>{throw new ArcaPostDeckError(code,message);};
const clone=(value)=>JSON.parse(canonicalJson(value));
const freeze=(value)=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

function createAftercareCase(value){
  const entry=value?.shelfEntry,deck=value?.deckFact,observations=clone(value?.observations||[]);
  if(!entry||entry.state!=='active'||deck?.shelfEntryId!==entry.shelfEntryId||deck.state!=='on_deck'||!observations.length)fail('P11_AFTERCARE_BASIS','Aftercare requires an active Entry, Deck Fact and explicit observations.');
  if(observations.some((item)=>item.shelfEntryId!==entry.shelfEntryId))fail('P11_AFTERCARE_SCOPE','Aftercare observations cross a Shelf Entry.');
  const basisDigest=canonicalDigest({schema:'arca.aftercare-case-basis@1',entryRevision:entry.revision,deckFactDigest:deck.deckFactDigest,observations});
  const aftercareCaseId=canonicalDigest({schema:'arca.aftercare-case-id@1',shelfEntryId:entry.shelfEntryId,basisDigest});
  return freeze({aftercareCaseId,shelfEntryId:entry.shelfEntryId,expectedEntryRevision:entry.revision,expectedDeckFactDigest:deck.deckFactDigest,basisDigest,state:'open',revision:1});
}

function commitAftercareInventory(value){
  const c=value?.aftercareCase,assessment=value?.assessment,change=value?.verifiedChange,entry=value?.currentEntry;
  if(!c||c.state!=='open'||entry?.shelfEntryId!==c.shelfEntryId||entry.revision!==c.expectedEntryRevision||assessment?.aftercareCaseId!==c.aftercareCaseId)fail('P11_AFTERCARE_STALE','Aftercare case or Entry fence is stale.');
  if(assessment.outcome!=='change_required'||change?.verificationOutcome!=='passed'||change.shelfEntryId!==c.shelfEntryId||change.canonicalIdentityDigest!==entry.canonicalIdentityDigest)fail('P11_AFTERCARE_CHANGE','Only a verified same-identity change may update Inventory.');
  const revision=entry.revision+1,inventoryCommit={inventoryCommitId:canonicalDigest({schema:'arca.aftercare-inventory-commit-id@1',aftercareCaseId:c.aftercareCaseId,changeDigest:change.changeDigest}),shelfEntryId:c.shelfEntryId,revision,changeDigest:change.changeDigest};
  const deckFact={deckFactId:canonicalDigest({schema:'arca.deck-fact-id@1',shelfEntryId:c.shelfEntryId,revision}),shelfEntryId:c.shelfEntryId,revision,state:'on_deck',inventoryDigest:change.inventoryDigest};deckFact.deckFactDigest=canonicalDigest(deckFact);
  return freeze({inventoryCommit,entry:{...clone(entry),revision},deckFact,closedCase:{...clone(c),state:'completed',revision:c.revision+1}});
}

function buildOffDeckReviewScope(value){
  const policy=value?.policy,entries=clone(value?.activeEntries||[]).sort((a,b)=>a.shelfEntryId.localeCompare(b.shelfEntryId));
  if(!policy||!entries.length||entries.some((item)=>item.state!=='active'||item.shelfId!==value.shelfId))fail('P11_OFFDECK_SCOPE','Review Scope requires active Entries from one Shelf.');
  const members=entries.map((entry)=>({shelfEntryId:entry.shelfEntryId,entryRevision:entry.revision,deckFactDigest:entry.deckFactDigest,duplicateGroupId:entry.duplicateGroupId||null,suppressed:entry.suppressed===true,whitelisted:entry.whitelisted===true}));
  const scopeDigest=canonicalDigest({schema:'arca.offdeck-review-scope@1',shelfId:value.shelfId,policyRevision:policy.revision,policyDigest:policy.digest,members});
  return freeze({reviewScopeId:canonicalDigest({schema:'arca.offdeck-review-scope-id@1',scopeDigest}),shelfId:value.shelfId,policyRevision:policy.revision,policyDigest:policy.digest,members,scopeDigest,state:'reviewed'});
}

function authorizeOffDeckBatch(value){
  const scope=value?.reviewScope,authorization=value?.authorization;
  if(!scope||scope.state!=='reviewed'||authorization?.decision!=='authorize_off_deck'||authorization.reviewScopeId!==scope.reviewScopeId||authorization.scopeDigest!==scope.scopeDigest)fail('P11_OFFDECK_AUTH','Off-deck requires explicit authorization for the exact immutable Review Scope.');
  const eligible=scope.members.filter((item)=>!item.suppressed&&!item.whitelisted);
  if(!eligible.length)fail('P11_OFFDECK_EMPTY','Authorization contains no eligible Entry.');
  const batchId=canonicalDigest({schema:'arca.offdeck-batch-id@1',authorizationId:authorization.authorizationId,scopeDigest:scope.scopeDigest});
  return freeze({batchId,authorizationId:authorization.authorizationId,reviewScopeId:scope.reviewScopeId,scopeDigest:scope.scopeDigest,state:'authorized',entries:eligible.map((item)=>({shelfEntryId:item.shelfEntryId,expectedEntryRevision:item.entryRevision,expectedDeckFactDigest:item.deckFactDigest,state:'authorized'}))});
}

function commitOffDeckEntry(value){
  const batch=value?.batch,item=value?.entryAuthorization,entry=value?.currentEntry,evidence=value?.destructionEvidence;
  if(!batch||batch.state!=='authorized'||item?.state!=='authorized'||entry?.shelfEntryId!==item.shelfEntryId||entry.revision!==item.expectedEntryRevision||entry.deckFactDigest!==item.expectedDeckFactDigest)fail('P11_OFFDECK_STALE','Off-deck Entry fence is stale.');
  if(evidence?.shelfEntryId!==entry.shelfEntryId||evidence.outcome!=='verified_deleted'||!Array.isArray(evidence.deletedPrimaryMaterialIds)||!evidence.deletedPrimaryMaterialIds.length)fail('P11_OFFDECK_EVIDENCE','Primary material deletion requires exact verified Evidence.');
  const terminal={shelfEntryId:entry.shelfEntryId,state:'off_deck',revision:entry.revision+1,destructionEvidenceDigest:evidence.evidenceDigest};
  return freeze({terminal,deckFact:{shelfEntryId:entry.shelfEntryId,state:'ended',reason:'off_deck'},releasedRelatedReferences:clone(value.relatedReferences||[]).map((item)=>({...item,state:'released'})),receipt:{receiptId:canonicalDigest({schema:'arca.offdeck-terminal-receipt@1',batchId:batch.batchId,shelfEntryId:entry.shelfEntryId,evidenceDigest:evidence.evidenceDigest}),batchId:batch.batchId,shelfEntryId:entry.shelfEntryId,outcome:'off_deck'}});
}

function commitShelfDeregistration(value){
  const shelf=value?.shelf,authorization=value?.authorization,entries=clone(value?.activeEntries||[]),controls=clone(value?.currentControls||[]);
  if(!shelf||shelf.state!=='active'||authorization?.decision!=='deregister_shelf'||authorization.shelfId!==shelf.shelfId)fail('P11_DEREG_AUTH','Shelf Deregistration requires explicit exact-Shelf authorization.');
  if(entries.some((item)=>item.shelfId!==shelf.shelfId||item.state!=='active')||controls.some((item)=>item.shelfId!==shelf.shelfId||item.ownerDomain!=='arca'))fail('P11_DEREG_SCOPE','Deregistration release scope is not exact.');
  if(value.deletionIntent||value.deletionEvidence||value.moveIntent||value.renameIntent)fail('P11_DEREG_DESTRUCTIVE','Shelf Deregistration is strictly non-destructive.');
  const releaseManifest={shelfId:shelf.shelfId,entries:entries.map((item)=>({shelfEntryId:item.shelfEntryId,expectedRevision:item.revision,deckFactDigest:item.deckFactDigest})),controls:controls.map((item)=>({materialKey:item.materialKey,expectedRevision:item.revision,expectedDigest:item.digest}))};releaseManifest.releaseManifestDigest=canonicalDigest(releaseManifest);
  const deregistrationId=canonicalDigest({schema:'arca.shelf-deregistration-id@1',authorizationId:authorization.authorizationId,releaseManifestDigest:releaseManifest.releaseManifestDigest});
  return freeze({deregistration:{deregistrationId,shelfId:shelf.shelfId,state:'committed'},releaseManifest,shelf:{...clone(shelf),state:'deregistered',revision:shelf.revision+1},entries:entries.map((item)=>({...item,state:'ended',revision:item.revision+1})),deckFacts:entries.map((item)=>({shelfEntryId:item.shelfEntryId,state:'ended',reason:'shelf_deregistered'})),releasedControls:controls.map((item)=>({...item,ownerDomain:null,revision:item.revision+1})),receipt:{receiptId:canonicalDigest({schema:'arca.shelf-deregistration-receipt@1',deregistrationId}),deregistrationId,outcome:'deregistered',destructiveEffects:0}});
}

module.exports=Object.freeze({ArcaPostDeckError,createAftercareCase,commitAftercareInventory,buildOffDeckReviewScope,authorizeOffDeckBatch,commitOffDeckEntry,commitShelfDeregistration});

