'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createInboxCoordinator } = require('../../../foundation/persistence/outbox-inbox');
const { createMaterialControlProjectionPort } = require('../../../foundation/persistence/material-control');
const { createHandoffBAcceptanceStore } = require('../persistence/handoff-b-acceptance-store');
const { createOnDeckStore } = require('../persistence/on-deck-store');
const { emptyArcaMaterialEpisodeClaims, fromProductMember } = require('../model/material-episode-claims');
const { CAPABILITY_REFS:C } = require('../model/on-deck-contract');
const { buildAftercareInventoryRequest } = require('../model/aftercare-placement');

const BASE='helix://contracts/capabilities/';
function stable(prefix,value){return prefix+canonicalDigest(value).slice(0,40);}
function evidence(ref,result,at){return Object.freeze({evidenceId:stable('arca-evidence-',{ref,result}),evidenceKind:'arca_on_deck_execution',
  producerRef:ref,basisDigest:result.basisDigest||result.decisionDigest||canonicalDigest(result),payloadDigest:canonicalDigest(result),observedAtMs:at});}
function effectReceipt(context,effectClass,result,at){return Object.freeze({schemaRef:'helix://contracts/types/EffectReceipt/v1',schemaVersion:1,
  effectReceiptId:stable('arca-effect-receipt-',{eventId:context.eventId}),effectId:canonicalDigest([effectClass,context.idempotencyKey]),effectClass,
  idempotencyKey:context.idempotencyKey,commitMarker:stable('arca-effect-marker-',{eventId:context.eventId}),externalReceiptRef:null,
  outputDigest:canonicalDigest(result),verificationEvidenceDigest:canonicalDigest(result),committedAtMs:at});}
function outcome(ref,result,at,effectClass=null){const value={kind:'succeeded',resultSchemaRef:BASE+ref.replace('@1','/v1/result'),result,
  evidenceSchemaRef:BASE+ref.replace('@1','/v1/evidence'),evidence:evidence(ref,result,at)};
  return Object.freeze(effectClass?{...value,effectReceipt:effectReceipt(value.__context||{},effectClass,result,at)}:value);}
function committedOutcome(context,ref,result,at,effectClass){return Object.freeze({kind:'succeeded',resultSchemaRef:BASE+ref.replace('@1','/v1/result'),result,
  evidenceSchemaRef:BASE+ref.replace('@1','/v1/evidence'),evidence:evidence(ref,result,at),effectReceipt:effectReceipt(context,effectClass,result,at)});}
function requireNamed(context,names){for(const name of names)if(!Object.hasOwn(context?.namedInputs||{},name))throw new TypeError('Arca Capability input is absent: '+name);}
function check(ref,kind,input,passed,reason,at){const basisDigest=canonicalDigest({ref,kind,input}),result=Object.freeze({
  schemaRef:'helix://contracts/types/AcceptanceCheck/v1',schemaVersion:1,verificationId:stable('arca-acceptance-check-',{kind,basisDigest}),
  verificationKind:'shelf_acceptance',basisDigest,result:passed?'passed':'failed',reasonCodes:Object.freeze(passed?[]:[reason]),
  evidenceRefs:Object.freeze([basisDigest]),verifiedAtMs:at,acceptanceAttemptId:input.acceptanceAttemptId,checkKind:kind,
  standardRevision:input.standardRevision,packageDigest:input.packageDigest});return result;}
function context(options,execution,refs){
  if(execution.ownerScope.processType==='arca_shelf_entry')
    return options.aftercareContextReader.read(execution.ownerScope.processId);
  return execution.ownerScope.processType==='arca_ondeck_run'
    ? options.contextReader.readAccepted(execution.ownerScope.processId,refs)
    : options.contextReader.readOffer(refs);
}
function dependencyRefs(options,execution){const bindings=options.workResultReader.readBindings(execution.workId);
  const binding=bindings.flatMap((item)=>item.inputBindings?.bindings||[]).find((b)=>b.bindingKind==='projected_owner_facts'&&
    Array.isArray(b.parameters?.dependencyRefs));return binding?.parameters?.dependencyRefs||[];}
function bindingFromProduct(member,contentProfile){return Object.freeze({materialKey:member.materialKey,role:'product:'+member.role,
  episodeClaims:fromProductMember(member,contentProfile),endpointId:member.location.endpointId,location:member.workspaceMaterialHandle
    ?'workspace://'+member.workspaceMaterialHandle.workspaceId+'/'+member.workspaceMaterialHandle.relativePath:member.location.location});}
function bindingFromContext(member){return Object.freeze({materialKey:member.materialKey,role:'offload:'+member.contextRole,
  episodeClaims:emptyArcaMaterialEpisodeClaims(),endpointId:member.endpointId,location:member.location});}
function acceptanceAttemptId(c){return canonicalDigest({schema:'arca.acceptance-attempt-id@1',offerId:c.offer.offerId,onDeckPackageId:c.offer.onDeckPackageId,
  packageDigest:c.offer.packageDigest,standardRevision:c.shelf.currentStandardRevision,placementRevision:c.shelf.currentPlacementRevision});}

function createOnDeckCapabilityPorts(options){const now=options.now||Date.now,acceptance=createHandoffBAcceptanceStore(options),onDeck=createOnDeckStore(options),
  controls=createMaterialControlProjectionPort(options),inbox=createInboxCoordinator(options);
  function ctx(execution){return context(options,execution,dependencyRefs(options,execution));}
  function aftercareRequest(execution,c){
    if(execution.ownerScope.processType!=='arca_shelf_entry')return null;
    const care=options.aftercareContextReader.store.history(c.shelfEntryId).cases.find((item)=>item.state==='active');
    if(!care||care.careBasisDigest!==c.basis.digest)throw new Error('Aftercare Placement Case is absent or stale.');
    return buildAftercareInventoryRequest(c,options.inventoryPort,now(),care.aftercareCaseId);
  }
  function pure(ref,names,build){return Object.freeze({validateInputs(c){requireNamed(c,names);},execute(c){return outcome(ref,build(c.namedInputs,ctx(c),now()),now());},
    validateResult(_c,o){if(!o?.result)throw new TypeError(ref+' Result is absent.');}});}
  const ports={};
  ports[C.identity]=pure(C.identity,['packageIdentity','shelfStandard'],(n,c,at)=>check(C.identity,'identity',{
    acceptanceAttemptId:acceptanceAttemptId(c),standardRevision:c.shelf.currentStandardRevision,packageDigest:c.packageValue.packageDigest,
    packageIdentity:n.packageIdentity,shelfStandard:n.shelfStandard},Boolean(n.packageIdentity.resolvedIdentityDigest),'identity_requirement_unmet',at));
  ports[C.metadata]=pure(C.metadata,['productMetadataArtifact','metadataRequirement'],(n,c,at)=>check(C.metadata,'metadata',{
    acceptanceAttemptId:acceptanceAttemptId(c),standardRevision:c.shelf.currentStandardRevision,packageDigest:c.packageValue.packageDigest,
    productMetadataArtifact:n.productMetadataArtifact,metadataRequirement:n.metadataRequirement},
    n.productMetadataArtifact.metadataFactRefs.length>=3&&(c.packageValue.artifactManifest?.items||[]).some(i=>i.artifactKind==='nfo'),'metadata_requirement_unmet',at));
  ports[C.structure]=pure(C.structure,['productManifest','structureRequirement'],(n,c,at)=>check(C.structure,'structure',{
    acceptanceAttemptId:acceptanceAttemptId(c),standardRevision:c.shelf.currentStandardRevision,packageDigest:c.packageValue.packageDigest,
    productManifest:n.productManifest,structureRequirement:n.structureRequirement},n.productManifest.members.length>0,'structure_requirement_unmet',at));
  ports[C.mandatory]=pure(C.mandatory,['onDeckProductPackage','mandatoryRequirement'],(n,c,at)=>check(C.mandatory,'mandatory_media',{
    acceptanceAttemptId:acceptanceAttemptId(c),standardRevision:c.shelf.currentStandardRevision,packageDigest:c.packageValue.packageDigest,
    onDeckProductPackage:n.onDeckProductPackage,mandatoryRequirement:n.mandatoryRequirement},
    n.onDeckProductPackage.packageDigest===c.packageValue.packageDigest&&
      n.onDeckProductPackage.productionAttestation?.unmetRequirementCount===0,
    'mandatory_media_requirement_unmet',at));
  ports[C.space]=pure(C.space,['productManifest','spaceRequirement'],(n,c,at)=>check(C.space,'space',{
    acceptanceAttemptId:acceptanceAttemptId(c),standardRevision:c.shelf.currentStandardRevision,packageDigest:c.packageValue.packageDigest,
    productManifest:n.productManifest,spaceRequirement:n.spaceRequirement},n.spaceRequirement.requiredBytes>=0,'space_requirement_invalid',at));
  ports[C.feasibility]=pure(C.feasibility,['offLoadContext','placementPolicy','targetEndpoint'],(_n,c,at)=>options.inventoryPort.assess({
    onDeckRunId:stable('arca-ondeck-preview-',{offer:c.offer.offerId}),custodyId:stable('arca-custody-preview-',{offer:c.offer.offerId}),shelf:c.shelf,
    onDeckProductPackage:c.packageValue,observedAtMs:at,replayCommitted:false}));
  ports[C.accept]=Object.freeze({validateInputs(c){requireNamed(c,['acceptedPayload','responsibilityControlCommitHandle']);},execute(execution){const c=ctx(execution),
    assessmentWork=options.workResultReader.listWorks({ownerDomain:'arca',processType:'arca_acceptance',processId:c.offer.offerId,workKind:'acceptance_assessment'})[0];
    if(!assessmentWork)throw new Error('Arca Acceptance assessment Work is absent.');const values=options.workResultReader.read(assessmentWork.work_id)
      .filter(i=>i.outcomeKind==='succeeded').map(i=>i.result),checks=values.map(v=>v.schemaRef==='helix://contracts/types/AcceptanceCheck/v1'
        ?{kind:v.checkKind,outcome:v.result,evidenceDigest:canonicalDigest(v)}:{kind:'inventory_feasibility',outcome:v.availableBytes>=v.requiredBytes?'passed':'failed',evidenceDigest:v.payloadDigest})
      .sort((a,b)=>a.kind.localeCompare(b.kind));
    const assessmentId=canonicalDigest({schema:'arca.acceptance-attempt-id@1',offerId:c.offer.offerId,onDeckPackageId:c.offer.onDeckPackageId,
      packageDigest:c.offer.packageDigest,standardRevision:c.shelf.currentStandardRevision,placementRevision:c.shelf.currentPlacementRevision});
    const assessment=acceptance.readAssessment(assessmentId)||acceptance.recordAssessment({acceptanceAttemptId:assessmentId,offerId:c.offer.offerId,
      onDeckPackageId:c.offer.onDeckPackageId,packageDigest:c.offer.packageDigest,shelfId:c.shelf.shelfId,standardRevision:c.shelf.currentStandardRevision,
      placementRevision:c.shelf.currentPlacementRevision,checks});if(checks.some(x=>x.outcome!=='passed'))throw new Error('Arca Handoff B acceptance checks failed.');
    const responsibility=acceptance.deriveAcceptedResponsibility(assessment),feasibility=values.find(v=>v.schemaRef==='helix://contracts/types/InventoryFeasibilityEvidence/v1'),
      finalInventoryDecision=options.inventoryPort.prepare({onDeckRunId:responsibility.onDeckRunId,custodyId:responsibility.custodyId,shelf:c.shelf,
        onDeckProductPackage:c.packageValue,observedAtMs:now(),replayCommitted:false}),targetLocation=options.inventoryPort.resolveTargetLocation({
        shelf:c.shelf,onDeckProductPackage:c.packageValue}).targetDirectory;
    const controlled=[...c.packageValue.productMaterialManifest.members.filter(m=>m.controlOperation!=='assert_related_input'),
      ...c.packageValue.offloadContextManifest.members.filter(m=>m.contextRole!=='related_input')],byKey=new Map(controlled.map(m=>[m.materialKey,m])),
      keys=[...byKey.keys()].sort(),projections=controls.getMaterialControlProjections(keys),
      contentProfile=c.packageValue.productStructureSnapshot?.structureKind==='season'?'series':'movie';
    for(const p of projections){const member=byKey.get(p.materialKey),expectedRevision=member.committedControlRevision??member.admittedControlRevision,
      expectedDigest=member.committedControlProjectionDigest??member.admittedControlProjectionDigest;
      if(p.resultKind!=='available'||p.controlState!=='controlled'||p.ownerDomain!=='libra'||p.controlRevision!==expectedRevision||
          p.projectionDigest!==expectedDigest)throw new Error('Arca Handoff B Product Control fence is stale for '+p.materialKey);}
    const accepted=acceptance.readAccepted({acceptanceAttemptId:assessmentId,offerMessage:c.offer,libraRunId:c.offer.libraRunId,onDeckRunId:responsibility.onDeckRunId,
      finalInventoryDecision})||acceptance.accept({assessment,offerMessage:c.offer,libraRunId:c.offer.libraRunId,shelf:c.shelf,package:c.packageValue,
      onDeckRunId:responsibility.onDeckRunId,finalInventoryDecision,targetLocation,bindings:[
        ...c.packageValue.productMaterialManifest.members.map(m=>bindingFromProduct(m,contentProfile)),...c.packageValue.offloadContextManifest.members.map(bindingFromContext)]
        .sort((a,b)=>a.materialKey.localeCompare(b.materialKey)||a.role.localeCompare(b.role)),controlTransfers:projections.map(p=>({materialKey:p.materialKey,
          expectedRevision:p.controlRevision,expectedProjectionDigest:p.projectionDigest,fromScope:{ownerDomain:p.ownerDomain,scopeType:p.ownerScopeType,scopeId:p.ownerScopeId}}))});
    const consumed=inbox.consume({message:{messageId:c.offer.messageId,dedupKey:c.offer.dedupKey,consumerDomain:'arca'},resultDigest:accepted.receipt.receiptDigest,
      domainParticipant:acceptance.offerDeliveryParticipant({acceptanceDecisionId:accepted.decision.acceptanceDecisionId,offerId:c.offer.offerId,receiptDigest:accepted.receipt.receiptDigest})});
    inbox.acknowledge({messageId:c.offer.messageId,consumerDomain:'arca'});return committedOutcome(execution,C.accept,accepted.receipt,now(),'responsibility_control_commit');},
    validateResult(_c,o){if(o?.result?.receiptKind!=='handoff_b_accepted')throw new TypeError('Arca Acceptance Receipt is invalid.');}});
  ports[C.reject]=Object.freeze({validateInputs(c){requireNamed(c,['arcaAcceptanceRejectionDecision','domainFactCommitHandle']);},execute(execution){const c=ctx(execution),d=execution.namedInputs.arcaAcceptanceRejectionDecision,
    assessmentWork=options.workResultReader.listWorks({ownerDomain:'arca',processType:'arca_acceptance',processId:c.offer.offerId,workKind:'acceptance_assessment'})[0];
    if(!assessmentWork)throw new Error('Arca Acceptance assessment Work is absent.');const values=options.workResultReader.read(assessmentWork.work_id)
      .filter(i=>i.outcomeKind==='succeeded').map(i=>i.result),checks=values.map(v=>v.schemaRef==='helix://contracts/types/AcceptanceCheck/v1'
        ?{kind:v.checkKind,outcome:v.result,evidenceDigest:canonicalDigest(v)}:{kind:'inventory_feasibility',outcome:v.availableBytes>=v.requiredBytes?'passed':'failed',evidenceDigest:v.payloadDigest})
      .sort((a,b)=>a.kind.localeCompare(b.kind)),assessment=acceptance.readAssessment(acceptanceAttemptId(c))||acceptance.recordAssessment({acceptanceAttemptId:acceptanceAttemptId(c),
        offerId:c.offer.offerId,onDeckPackageId:c.offer.onDeckPackageId,packageDigest:c.offer.packageDigest,shelfId:c.shelf.shelfId,
        standardRevision:c.shelf.currentStandardRevision,placementRevision:c.shelf.currentPlacementRevision,checks});
    const rejected=acceptance.reject({assessment,decision:d,offerMessage:c.offer}),consumed=inbox.consume({message:{messageId:c.offer.messageId,dedupKey:c.offer.dedupKey,consumerDomain:'arca'},
      resultDigest:rejected.receipt.receiptDigest,domainParticipant:acceptance.offerDeliveryParticipant({acceptanceDecisionId:d.acceptanceDecisionId,
        offerId:c.offer.offerId,receiptDigest:rejected.receipt.receiptDigest})});inbox.acknowledge({messageId:c.offer.messageId,consumerDomain:'arca'});
    return committedOutcome(execution,C.reject,rejected.receipt,now(),'domain_fact_commit');},validateResult(_c,o){if(o?.result?.receiptKind!=='handoff_b_rejected')throw new TypeError('Arca Rejection Receipt is invalid.');}});
  ports[C.slot]=Object.freeze({validateInputs(c){requireNamed(c,['finalInventoryDecision','targetHandle']);},execute(execution){const c=ctx(execution),n=execution.namedInputs;
    const aftercare=aftercareRequest(execution,c);if(aftercare){
      if(n.finalInventoryDecision.decisionDigest!==aftercare.finalInventoryDecision.decisionDigest)
        throw new Error('Aftercare Final Inventory Decision is stale.');
      const result=options.inventoryPort.prepareSlot({...aftercare,targetCommitSlotHandle:n.targetHandle});
      return committedOutcome(execution,C.slot,result,now(),'material_commit');
    }
    onDeck.verifyAcceptedResponsibility({onDeckRunId:c.responsibility.onDeckRunId,custodyId:c.responsibility.custodyId,shelf:c.shelf,package:c.packageValue,
      finalInventoryDecision:c.finalInventoryDecision,targetLocation:c.targetLocation});onDeck.setOffloading(c.responsibility.onDeckRunId,c.finalInventoryDecision.decisionDigest);
    const result=options.inventoryPort.prepareSlot({onDeckRunId:c.responsibility.onDeckRunId,custodyId:c.responsibility.custodyId,shelf:c.shelf,
      onDeckProductPackage:c.packageValue,finalInventoryDecision:c.finalInventoryDecision,targetCommitSlotHandle:n.targetHandle,observedAtMs:now(),replayCommitted:false});
    return committedOutcome(execution,C.slot,result,now(),'material_commit');},validateResult(_c,o){if(!o?.result?.slotId)throw new TypeError('Target Commit Slot Handle is invalid.');}});
  ports[C.stage]=Object.freeze({validateInputs(c){requireNamed(c,['productMaterialHandleList','targetCommitSlotHandle']);},execute(execution){const c=ctx(execution),staged=options.inventoryPort.stage({
    ...(aftercareRequest(execution,c)||{
    onDeckRunId:c.responsibility.onDeckRunId,custodyId:c.responsibility.custodyId,shelf:c.shelf,onDeckProductPackage:c.packageValue,
    finalInventoryDecision:c.finalInventoryDecision,observedAtMs:now(),replayCommitted:false}),targetCommitSlotHandle:execution.namedInputs.targetCommitSlotHandle});
    return committedOutcome(execution,C.stage,staged,now(),'material_commit');},
    validateResult(_c,o){if(!o?.result?.manifestDigest)throw new TypeError('Staged Inventory Manifest is invalid.');}});
  ports[C.stagedVerify]=Object.freeze({validateInputs(c){requireNamed(c,['stagedManifest','finalInventoryDecision']);},execute(execution){
    const c=ctx(execution),n=execution.namedInputs,request=aftercareRequest(execution,c)||{onDeckRunId:c.responsibility.onDeckRunId,
      custodyId:c.responsibility.custodyId,shelf:c.shelf,onDeckProductPackage:c.packageValue,finalInventoryDecision:c.finalInventoryDecision,
      observedAtMs:now(),replayCommitted:false};
    return outcome(C.stagedVerify,options.inventoryPort.verifyStaged({...request,finalInventoryDecision:n.finalInventoryDecision,
      stagedInventoryManifest:n.stagedManifest}),now());},validateResult(_c,o){if(o?.result?.result!=='passed')throw new TypeError('Staged Inventory Verification is invalid.');}});
  ports[C.finalVerify]=pure(C.finalVerify,['finalBindings','productDispositionManifest'],(n,c,at)=>{const basisDigest=canonicalDigest(n),aftercare=Boolean(c.shelfEntryId),
    keys=(aftercare?c.raw.materials.map((item)=>item.material_key):c.packageValue.productMaterialManifest.members.map(m=>m.materialKey)).sort(),
    processId=aftercare?c.shelfEntryId:c.responsibility.onDeckRunId,productManifestDigest=aftercare?canonicalDigest(keys):c.packageValue.productMaterialManifest.manifestDigest,
    containment=aftercare?canonicalDigest({targetRoot:c.raw.shelf.target_root_location,placementRevision:c.basis.placementRevision}):canonicalDigest(c.shelf.target);
    return Object.freeze({schemaRef:'helix://contracts/types/FinalProductVerification/v1',schemaVersion:1,verificationId:stable('arca-final-verification-',{run:processId,basisDigest}),
      verificationKind:'final_product',basisDigest,result:'passed',reasonCodes:Object.freeze([]),evidenceRefs:Object.freeze([aftercare?c.basis.digest:c.packageValue.onDeckPackageId]),verifiedAtMs:at,
      finalBindingSetDigest:n.finalBindings.bindingSetDigest,productManifestDigest,
      relatedDispositionSetDigest:n.productDispositionManifest.relatedDispositionSetDigest,verifiedMaterialKeys:Object.freeze(keys),targetContainmentDigest:containment});});
  ports[C.placement]=Object.freeze({validateInputs(c){requireNamed(c,['verifiedStagedManifest','targetBindings']);},execute(execution){const c=ctx(execution),n=execution.namedInputs,
    aftercare=aftercareRequest(execution,c);if(aftercare){const body=options.inventoryPort.switchPlacement({...aftercare,
      stagedInventoryVerification:n.verifiedStagedManifest,targetBindings:n.targetBindings,
      replacedInputSetDigest:canonicalDigest(c.raw.materials.map((item)=>item.material_key).sort())});
      return committedOutcome(execution,C.placement,body,now(),'material_commit');}
    const body=options.inventoryPort.switchPlacement({onDeckRunId:c.responsibility.onDeckRunId,custodyId:c.responsibility.custodyId,shelf:c.shelf,
      onDeckProductPackage:c.packageValue,finalInventoryDecision:c.finalInventoryDecision,stagedInventoryVerification:n.verifiedStagedManifest,
      targetBindings:n.targetBindings,replacedInputSetDigest:canonicalDigest(c.packageValue.offloadContextManifest.members),observedAtMs:now(),replayCommitted:false});
    return committedOutcome(execution,C.placement,body,now(),'material_commit');},
    validateResult(_c,o){if(o?.result?.receiptKind!=='placement_switched')throw new TypeError('Placement Switch Receipt is invalid.');}});
  ports[C.settlement]=Object.freeze({validateInputs(c){requireNamed(c,['oldPrimaryStructuralExclusiveRelatedHandleList','inputSettlementApproval']);},execute(execution){const n=execution.namedInputs,m=n.oldPrimaryStructuralExclusiveRelatedHandleList.members[0],at=now(),c=ctx(execution),
    settled=options.inventoryPort.settleInput({materialHandle:m.materialHandle,approval:n.inputSettlementApproval,
      finalInventoryRequest:{onDeckRunId:c.responsibility.onDeckRunId,custodyId:c.responsibility.custodyId,shelf:c.shelf,
        onDeckProductPackage:c.packageValue,finalInventoryDecision:c.finalInventoryDecision,observedAtMs:at}}),
    base={schemaRef:'helix://contracts/types/SettlementDeletionEvidence/v1',schemaVersion:1,evidenceId:stable('arca-settlement-evidence-',{eventId:execution.eventId}),
      evidenceKind:'input_settlement',producerRef:C.settlement,basisDigest:n.oldPrimaryStructuralExclusiveRelatedHandleList.digest,observedAtMs:at,
      authorizationOrApprovalRef:n.inputSettlementApproval.approvalId,materialKey:m.materialKey,preDeleteIdentityDigest:settled.preDeleteIdentityDigest,
      postDeleteReality:null,
      effectReceiptId:stable('arca-effect-receipt-',{eventId:execution.eventId})};const result=Object.freeze({...base,payloadDigest:canonicalDigest(base)});
    const entries=Object.freeze([{key:'absent',value:settled.absent},{key:'disposition',value:settled.disposition||
      (settled.absent?'deleted':'retained_as_final')}]),postBase={schemaRef:'arca://types/PostDeleteReality/v1',schemaVersion:1,
      recordKind:'post-delete-reality',entries},postDeleteReality=Object.freeze({...postBase,recordDigest:canonicalDigest(postBase)}),
      completed=Object.freeze({...result,postDeleteReality,payloadDigest:canonicalDigest({...base,postDeleteReality})});
    return committedOutcome(execution,C.settlement,completed,at,'destructive_commit');},validateResult(_c,o){if(!o?.result?.materialKey)throw new TypeError('Settlement Evidence is invalid.');}});
  ports[C.fulfillment]=pure(C.fulfillment,['finalReality','finalInventoryDecision','shelfStandard'],(n,c,at)=>{
    const finalRealityDigest=n.finalReality.realityDigest,basisDigest=canonicalDigest({decision:n.finalInventoryDecision,finalRealityDigest,standard:n.shelfStandard});
    return Object.freeze({schemaRef:'helix://contracts/types/FulfillmentVerification/v1',schemaVersion:1,verificationId:stable('arca-fulfillment-',{run:c.responsibility.onDeckRunId,basisDigest}),
      verificationKind:'on_deck_fulfillment',basisDigest,result:'passed',reasonCodes:Object.freeze([]),evidenceRefs:Object.freeze([n.finalReality.objectId]),verifiedAtMs:at,
      finalInventoryDecisionDigest:n.finalInventoryDecision.decisionDigest,shelfStandardRevision:c.shelf.currentStandardRevision,finalRealityDigest});});
  ports[C.commit]=Object.freeze({validateInputs(c){requireNamed(c,['fulfillmentResult','responsibilityControlCommitHandle']);},execute(execution){const c=ctx(execution),fulfillment=execution.namedInputs.fulfillmentResult,
    staged=options.inventoryPort.readFinal({onDeckRunId:c.responsibility.onDeckRunId,custodyId:c.responsibility.custodyId,shelf:c.shelf,onDeckProductPackage:c.packageValue,
      finalInventoryDecision:c.finalInventoryDecision,observedAtMs:0,replayCommitted:true}),all=[...c.packageValue.productMaterialManifest.members,...c.packageValue.offloadContextManifest.members],keys=[...new Set(all.map(m=>m.materialKey))].sort(),
    custodyControls=controls.getMaterialControlProjections(keys),targetControls=controls.getMaterialControlProjections(staged.members.map(m=>m.materialKey).sort()),
    committed=onDeck.readCommitted({onDeckRunId:c.responsibility.onDeckRunId,custodyId:c.responsibility.custodyId,finalInventoryDecisionDigest:c.finalInventoryDecision.decisionDigest,
      onDeckPackageId:c.packageValue.onDeckPackageId,packageDigest:c.packageValue.packageDigest,shelfId:c.shelf.shelfId})||onDeck.commit({onDeckRunId:c.responsibility.onDeckRunId,
      custodyId:c.responsibility.custodyId,shelf:c.shelf,package:c.packageValue,finalInventoryDecision:c.finalInventoryDecision,staged,
      stagedVerification:options.workResultReader.read(execution.workId).find((item)=>item.capabilityRef===C.stagedVerify)?.result,
      fulfillmentVerification:fulfillment,
      fulfillmentVerificationDigest:canonicalDigest(fulfillment),custodyControls,targetControls});return committedOutcome(execution,C.commit,committed.result,now(),'responsibility_control_commit');},
    validateResult(_c,o){if(o?.result?.onDeckCommitReceipt?.receiptKind!=='on_deck_committed')throw new TypeError('On-deck Commit Result is invalid.');}});
  return Object.freeze(ports);
}

module.exports=Object.freeze({createOnDeckCapabilityPorts});
