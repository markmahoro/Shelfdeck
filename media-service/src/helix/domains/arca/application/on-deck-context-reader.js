'use strict';

const path = require('node:path');
const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createShelfQueryStore } = require('../persistence/shelf-query-store');
const { createHandoffBAcceptanceStore } = require('../persistence/handoff-b-acceptance-store');
const { createOnDeckStore } = require('../persistence/on-deck-store');
const { requiresInputSettlement } = require('../model/offload-settlement');

function stable(schema, value) { return canonicalDigest({ schema, ...value }); }

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
  const source = (context.packageValue.offloadContextManifest?.members || [])
    .find((item) => item.materialKey === materialKey && requiresInputSettlement(item));
  if (!source || !source.finalProductMaterialKey) {
    throw new Error('Settlement Material is outside the accepted Off-load Context.');
  }
  const productMember = context.packageValue.productMaterialManifest.members
    .find((item) => item.materialKey === source.finalProductMaterialKey);
  const finalMember = finalInventoryDecision.members
    .find((item) => item.sourceMaterialKey === source.finalProductMaterialKey);
  if (!productMember || !finalMember) {
    throw new Error('Settlement source-to-final mapping is absent from the accepted Final Inventory Decision.');
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
      members:Object.freeze([productMember]),
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
    settlementFinalMember:finalMember,
    settlementManagedLocations:managedLocations,
  });
}

function createOnDeckContextReader(options) {
  if (!options?.productDeliveryPort || typeof options.productDeliveryPort.readPackage !== 'function') {
    throw new TypeError('Arca On-deck Context requires the formal Libra Product Delivery port.');
  }
  if (!options.inventoryPort || typeof options.inventoryPort.assess !== 'function') {
    throw new TypeError('Arca On-deck Context requires the bounded Inventory port.');
  }
  const shelves = createShelfQueryStore(options);
  const acceptance = createHandoffBAcceptanceStore(options);
  const onDeck = createOnDeckStore(options);

  function readOffer(dependencyRefs, { allowDeregistering = false } = {}) {
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
    const shelf = shelves.getShelf(offer.shelfId);
    if (!shelf || (shelf.status !== 'active' && !(allowDeregistering && shelf.status === 'deregistering'))) {
      const error = new Error('Handoff B target Shelf is unavailable.');
      error.code = 'ARCA_TARGET_SHELF_UNAVAILABLE';
      throw error;
    }
    return Object.freeze({ offer, packageValue, shelf, deliveryFence: delivery.deliveryFence });
  }

  function readAccepted(onDeckRunId, dependencyRefs) {
    // A new Acceptance may only target an active Shelf.  An already Accepted
    // On-deck Run, however, owns an immutable responsibility fence and must be
    // allowed to finish while Shelf Deregistration drains that responsibility.
    const context = readOffer(dependencyRefs, { allowDeregistering: true });
    const assessmentId = stable('arca.acceptance-attempt-id@1', {
      offerId: context.offer.offerId,
      onDeckPackageId: context.offer.onDeckPackageId,
      packageDigest: context.offer.packageDigest,
      standardRevision: context.shelf.currentStandardRevision,
      placementRevision: context.shelf.currentPlacementRevision,
    });
    const assessment = acceptance.readAssessment(assessmentId);
    if (!assessment || assessment.attemptState !== 'accepted') {
      throw new Error('Arca Acceptance has not established On-deck responsibility.');
    }
    const responsibility = acceptance.deriveAcceptedResponsibility(assessment);
    const accepted = acceptance.readAccepted({
      acceptanceAttemptId: assessmentId,
      offerMessage: context.offer,
      libraRunId: context.offer.libraRunId,
      onDeckRunId,
    });
    if (!accepted || responsibility.onDeckRunId !== onDeckRunId) {
      throw new Error('Arca On-deck Run identity is unavailable or stale.');
    }
    const feasibility = assessAcceptedInventory(
      options.inventoryPort,
      onDeckRunId,
      responsibility,
      context,
    );
    const targetLocation = options.inventoryPort.resolveTargetLocation({
      shelf: context.shelf,
      onDeckProductPackage: context.packageValue,
    }).targetDirectory;
    const verified = onDeck.verifyAcceptedResponsibility({
      onDeckRunId,
      custodyId: responsibility.custodyId,
      shelf: context.shelf,
      package: context.packageValue,
      finalInventoryDecision: accepted.finalInventoryDecision,
      targetLocation,
    });
    return Object.freeze({ ...context, assessment, responsibility, accepted, verified,
      feasibility, targetLocation,
      finalInventoryDecision: accepted.finalInventoryDecision });
  }

  function readSettlement(onDeckRunId, dependencyRefs, materialKey) {
    const context = readOffer(dependencyRefs, { allowDeregistering:true });
    const responsibility = acceptance.readRunResponsibility(onDeckRunId);
    if (!responsibility || responsibility.onDeckRunId !== onDeckRunId ||
        responsibility.offerId !== context.offer.offerId ||
        responsibility.onDeckPackageId !== context.offer.onDeckPackageId ||
        responsibility.packageDigest !== context.offer.packageDigest ||
        responsibility.shelfId !== context.shelf.shelfId ||
        responsibility.standardRevision !== context.shelf.currentStandardRevision ||
        responsibility.placementRevision !== context.shelf.currentPlacementRevision) {
      throw new Error('Arca On-deck settlement responsibility is unavailable or stale.');
    }
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

  return Object.freeze({ messageFromRefs, readOffer, readAccepted, readSettlement, acceptance, onDeck });
}

module.exports = Object.freeze({
  assessAcceptedInventory,
  boundedSettlementContext,
  createOnDeckContextReader,
  messageFromRefs,
});
