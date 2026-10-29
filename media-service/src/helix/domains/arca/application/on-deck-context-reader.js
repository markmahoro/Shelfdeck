'use strict';

const path = require('node:path');
const {offloadProductKeys}=require('../../../contracts/offload-product-targets');
const {createInputSettlementAuthorizationStore}=require('../persistence/input-settlement-authorization-store');
const {createOnDeckSettlementApprovalStore}=require('../persistence/on-deck-settlement-approval-store');
const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createShelfQueryStore } = require('../persistence/shelf-query-store');
const { createHandoffBAcceptanceStore } = require('../persistence/handoff-b-acceptance-store');
const { createOnDeckStore } = require('../persistence/on-deck-store');
const { requiresInputSettlement } = require('../model/offload-settlement');
const {assertCustomAcceptanceHandoff}=require('../../../contracts/custom-acceptance-handoff');
const {verifyArcaCustomAcceptanceTarget,assertArcaCustomAcceptanceBasis}=require('../model/custom-acceptance-target');

function stable(schema, value) { return canonicalDigest({ schema, ...value }); }

function createSettlementPreparationReader(read) {
  const preparations = new WeakMap();
  return function readSettlement(onDeckRunId, dependencyRefs, materialKey, preparation = {}) {
    const { preparationScope, eventId = null } = preparation;
    if (!preparationScope) return read(onDeckRunId, dependencyRefs, materialKey);
    const key = canonicalDigest({ onDeckRunId, dependencyRefs, materialKey, eventId });
    const prior = preparations.get(preparationScope);
    if (prior?.key === key) return prior.context;
    // The opaque scope ends before dispatch or any asynchronous media effect.
    // Only a successful, fully checked Arca context can be shared inside it.
    const context = read(onDeckRunId, dependencyRefs, materialKey);
    preparations.set(preparationScope, { key, context });
    return context;
  };
}

function dependencyMap(dependencyRefs) {
  return new Map((dependencyRefs || []).map((item) => [item.objectType, item]));
}

function messageFromRefs(dependencyRefs) {
  const refs = dependencyMap(dependencyRefs);
  const offer = refs.get('handoff_b_offer');
  const packageRef = refs.get('on_deck_package');
  const shelf = refs.get('shelf');
  const run = refs.get('libra_run');
  const subject = refs.get('subject');
  const spec = refs.get('acceptance_spec');
  const relatedDisposition = refs.get('related_disposition_set');
  if (!offer || !packageRef || !shelf || !run || !subject || !spec ||
      !relatedDisposition) {
    throw new Error('Arca Handoff B Work is missing its immutable dependency references.');
  }
  const value = {
    messageKind: 'libra.product-offer.available@1',
    offerId: offer.objectId,
    onDeckPackageId: packageRef.objectId,
    packageRevision: packageRef.revision,
    packageDigest: packageRef.digest,
    shelfId: shelf.objectId,
    libraRunId: run.objectId,
    subjectId: subject.objectId,
    acceptanceSpecId: spec.objectId,
    relatedDispositionSetDigest: relatedDisposition.digest,
  };
  const messageId = stable('libra.product-offer-message-id@1', {
    offerId: value.offerId,
    packageDigest: value.packageDigest,
  });
  return Object.freeze({ ...value, messageId, dedupKey: messageId });
}

function assessAcceptedInventory(inventoryPort, onDeckRunId, responsibility, context) {
  return inventoryPort.assess({
    onDeckRunId,
    custodyId: responsibility.custodyId,
    shelf: context.shelf,
    onDeckProductPackage: context.packageValue,
    observedAtMs: 0,
    // After Handoff B Acceptance, Placement and per-member Settlement advance
    // the physical reality legitimately.  Later Event input projections must
    // therefore replay an exact final member when its approved source has
    // already been settled; initial Acceptance still assesses with replay off.
    replayCommitted: true,
  });
}

function boundedSettlementContext(context, responsibility, verified, materialKey) {
  const finalInventoryDecision = responsibility.finalInventoryDecision;
  const sources=(context.packageValue.offloadContextManifest?.members||[])
    .filter(item=>item.materialKey===materialKey&&requiresInputSettlement(item));
  if(sources.length!==1)throw new Error('Settlement Material is outside the accepted Off-load Context or ambiguous.');
  const source=sources[0],keys=offloadProductKeys(source),productMembers=[],finalMembers=[];
  for(const key of keys){
    const products=context.packageValue.productMaterialManifest.members.filter(item=>item.materialKey===key);
    const finals=finalInventoryDecision.members.filter(item=>item.sourceMaterialKey===key);
    if(products.length!==1||finals.length!==1)
      throw new Error('Settlement source-to-final mapping is missing or ambiguous in the accepted Final Inventory Decision.');
    productMembers.push(products[0]);finalMembers.push(finals[0]);
  }
  const managedLocations = Object.freeze([
    ...(context.packageValue.offloadContextManifest?.members || [])
      .map((item) => item.location),
    ...finalInventoryDecision.members.map((item) => item.targetLocation),
  ].filter(Boolean));
  const packageValue = Object.freeze({
    ...context.packageValue,
    productMaterialManifest:Object.freeze({
      ...context.packageValue.productMaterialManifest,
      members:Object.freeze(productMembers),
    }),
    offloadContextManifest:Object.freeze({
      ...context.packageValue.offloadContextManifest,
      members:Object.freeze([source]),
    }),
  });
  return Object.freeze({
    ...context,
    responsibility:Object.freeze({
      onDeckRunId:responsibility.onDeckRunId,
      custodyId:responsibility.custodyId,
      acceptanceDecisionId:responsibility.acceptanceDecisionId,
    }),
    verified,
    packageValue,
    finalInventoryDecisionRef:Object.freeze({
      objectId:finalInventoryDecision.objectId,
      revision:finalInventoryDecision.revision,
      decisionDigest:finalInventoryDecision.decisionDigest,
    }),
    ...(keys.length===1?{settlementFinalMember:finalMembers[0]}:{settlementFinalMembers:Object.freeze(finalMembers)}),
    settlementManagedLocations:managedLocations,
  });
}

function acceptedRunBasis(current, onDeckRunId, acceptance, shelves, { boundedSettlement = false } = {}) {
  const recorded = acceptance.readRunResponsibility(onDeckRunId);
  if (!recorded || recorded.onDeckRunId !== onDeckRunId ||
      recorded.offerId !== current.offer.offerId ||
      recorded.onDeckPackageId !== current.offer.onDeckPackageId ||
      recorded.packageDigest !== current.offer.packageDigest ||
      recorded.shelfId !== current.shelf.shelfId) {
    throw new Error('Arca On-deck Run identity is unavailable or stale.');
  }
  const shelf = shelves.getShelfAtBasis(recorded.shelfId, recorded);
  let context = Object.freeze({ ...current, shelf });
  const assessmentId = stable('arca.acceptance-attempt-id@1', {
    offerId: current.offer.offerId,
    onDeckPackageId: current.offer.onDeckPackageId,
    packageDigest: current.offer.packageDigest,
    standardRevision: recorded.standardRevision,
    placementRevision: recorded.placementRevision,
  });
  if (assessmentId !== recorded.acceptanceAttemptId ||
      shelf.currentStandardRevision !== recorded.standardRevision ||
      shelf.currentPlacementRevision !== recorded.placementRevision) {
    throw new Error('Arca On-deck Run frozen Acceptance Basis is inconsistent.');
  }
  const requirement = current.packageValue.productionProvenance?.acceptanceRequirementSnapshot;
  if (!requirement || requirement.shelfStandardRevision !== recorded.standardRevision ||
      requirement.shelfStandardDigest !== shelf.standard.digest) {
    throw new Error('Accepted Package requirements do not match the frozen Shelf Standard.');
  }
  if (boundedSettlement) return Object.freeze({ context, recorded });
  const assessment = acceptance.readAssessment(assessmentId);
  if (!assessment || assessment.attemptState !== 'accepted') {
    throw new Error('Arca Acceptance has not established On-deck responsibility.');
  }
  const responsibility = acceptance.deriveAcceptedResponsibility(assessment);
  const accepted = acceptance.readAccepted({
    acceptanceAttemptId:assessmentId, offerMessage:current.offer,
    libraRunId:current.offer.libraRunId, onDeckRunId,
  });
  if (!accepted || responsibility.onDeckRunId !== onDeckRunId ||
      responsibility.custodyId !== recorded.custodyId ||
      accepted.finalInventoryDecision.decisionDigest !== recorded.finalInventoryDecision.decisionDigest) {
    throw new Error('Arca On-deck Run accepted history is unavailable or stale.');
  }
  if (requirement.customAcceptanceHandoff) {
    assertArcaCustomAcceptanceBasis({packageValue:current.packageValue,shelf,basis:accepted.decision.customAcceptanceBasis});
    context=Object.freeze({...context,customAcceptanceBasis:accepted.decision.customAcceptanceBasis});
  } else if(accepted.decision.customAcceptanceBasis) {
    throw new Error('Accepted custom target basis has no matching Handoff reference.');
  }
  return Object.freeze({ context, assessment, responsibility, accepted, recorded });
}

function createOnDeckContextReader(options) {
  if (!options?.productDeliveryPort || typeof options.productDeliveryPort.readPackage !== 'function') {
    throw new TypeError('Arca On-deck Context requires the formal Libra Product Delivery port.');
  }
  if (!options.inventoryPort || typeof options.inventoryPort.assess !== 'function') {
    throw new TypeError('Arca On-deck Context requires the bounded Inventory port.');
  }
  const settlementAuthorizations=createInputSettlementAuthorizationStore(options);
  const settlementApprovals=createOnDeckSettlementApprovalStore(options);
  const shelves = createShelfQueryStore(options);
  const acceptance = createHandoffBAcceptanceStore(options);
  const onDeck = createOnDeckStore(options);

  function readOfferDelivery(dependencyRefs) {
    const offer = messageFromRefs(dependencyRefs);
    const delivery = options.productDeliveryPort.readPackage({
      queryContract: 'libra.product-delivery@1',
      readPurpose: 'acceptance_fence',
      offerId: offer.offerId,
      onDeckPackageId: offer.onDeckPackageId,
      expectedPackageRevision: offer.packageRevision,
      expectedPackageDigest: offer.packageDigest,
    });
    if (!delivery || delivery.resultKind !== 'found') {
      const error = new Error('Handoff B Product Delivery is unavailable.');
      error.code = delivery?.reasonCode || 'ARCA_PRODUCT_DELIVERY_UNAVAILABLE';
      throw error;
    }
    const packageValue = delivery.onDeckProductPackage;
    return Object.freeze({ offer, packageValue, deliveryFence:delivery.deliveryFence });
  }
  function readOffer(dependencyRefs, { allowDeregistering = false, acceptedResponsibility = false, readFence = null } = {}) {
    const fence=readFence||(typeof options.unitOfWork?.captureReadFence==='function'?options.unitOfWork.captureReadFence():null);
    const {offer,packageValue,deliveryFence}=readOfferDelivery(dependencyRefs);
    const shelf = shelves.getShelf(offer.shelfId);
    if (!shelf || (shelf.status !== 'active' && !(allowDeregistering && shelf.status === 'deregistering'))) {
      const error = new Error('Handoff B target Shelf is unavailable.');
      error.code = 'ARCA_TARGET_SHELF_UNAVAILABLE';
      throw error;
    }
    const handoff=packageValue.productionProvenance?.acceptanceRequirementSnapshot?.customAcceptanceHandoff;
    if(handoff&&!acceptedResponsibility){
      assertCustomAcceptanceHandoff(handoff);
      if(typeof options.readLibraCustomTargetConfirmation!=='function')
        throw Object.assign(new Error('Custom Acceptance confirmation reader is unavailable.'),{code:'ARCA_CUSTOM_TARGET_EVIDENCE_UNAVAILABLE'});
      if(!fence)throw Object.assign(new Error('Custom Acceptance requires a read fence.'),{code:'ARCA_CUSTOM_TARGET_FENCE_INVALID'});
      const ref=handoff.customTargetRef;
      const confirmation=options.readLibraCustomTargetConfirmation({subjectId:handoff.subjectId,productScopeDigest:handoff.productScopeDigest,
        acceptanceSpecId:handoff.customSpec.acceptanceSpecId,acceptanceSpecRecordDigest:handoff.customSpec.recordDigest,
        intentId:ref.intentId,intentDigest:ref.intentDigest,previewDigest:ref.previewDigest},{readFence:fence});
      if(confirmation?.readFence!==fence)throw Object.assign(new Error('Custom Acceptance evidence is not bound to the read fence.'),
        {code:'ARCA_CUSTOM_TARGET_FENCE_INVALID'});
      const customAcceptanceBasis=verifyArcaCustomAcceptanceTarget({packageValue,shelf,confirmation});
      return Object.freeze({offer,packageValue,shelf,deliveryFence,customAcceptanceBasis,customTargetConfirmation:confirmation});
    }
    return Object.freeze({ offer, packageValue, shelf, deliveryFence });
  }

  function readAccepted(onDeckRunId, dependencyRefs) {
    // A new Acceptance may only target an active Shelf.  An already Accepted
    // On-deck Run, however, owns an immutable responsibility fence and must be
    // allowed to finish while Shelf Deregistration drains that responsibility.
    const current = readOffer(dependencyRefs, { allowDeregistering: true, acceptedResponsibility:true });
    const { context, assessment, responsibility, accepted } =
      acceptedRunBasis(current, onDeckRunId, acceptance, shelves);
    const finalMember = accepted.finalInventoryDecision.members?.[0];
    if (!finalMember?.targetLocation) {
      throw new Error('Arca On-deck Final Inventory Decision is empty.');
    }
    const targetLocation = path.dirname(path.resolve(finalMember.targetLocation));
    const verified = onDeck.verifyAcceptedResponsibility({
      onDeckRunId,
      custodyId: responsibility.custodyId,
      shelf: context.shelf,
      package: context.packageValue,
      finalInventoryDecision: accepted.finalInventoryDecision,
      targetLocation,
    });
    const feasibility = assessAcceptedInventory(
      options.inventoryPort,
      onDeckRunId,
      responsibility,
      context,
    );
    return Object.freeze({ ...context, assessment, responsibility, accepted, verified,
      feasibility, targetLocation,
      finalInventoryDecision: accepted.finalInventoryDecision });
  }

  function readSettlement(onDeckRunId, dependencyRefs, materialKey) {
    const current = readOffer(dependencyRefs, { allowDeregistering:true, acceptedResponsibility:true });
    const { context, recorded:responsibility } =
      acceptedRunBasis(current, onDeckRunId, acceptance, shelves, { boundedSettlement:true });
    const firstFinalMember = responsibility.finalInventoryDecision.members?.[0];
    if (!firstFinalMember?.targetLocation) {
      throw new Error('Arca On-deck settlement Final Inventory Decision is empty.');
    }
    const targetLocation = path.dirname(path.resolve(firstFinalMember.targetLocation));
    const verified = onDeck.verifyAcceptedResponsibility({
      onDeckRunId,
      custodyId:responsibility.custodyId,
      shelf:context.shelf,
      package:context.packageValue,
      finalInventoryDecision:responsibility.finalInventoryDecision,
      targetLocation,
    });
    return boundedSettlementContext(context, responsibility, verified, materialKey);
  }

  return Object.freeze({ messageFromRefs, readOfferDelivery, readOffer, readAccepted,
    readSettlement:createSettlementPreparationReader(readSettlement),
    acceptance, onDeck, settlementAuthorizations, settlementApprovals });
}

module.exports = Object.freeze({
  assessAcceptedInventory,
  acceptedRunBasis,
  boundedSettlementContext,
  createOnDeckContextReader,
  createSettlementPreparationReader,
  messageFromRefs,
});
