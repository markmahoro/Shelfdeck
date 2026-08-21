'use strict';

const {
  canonicalDigest,
  canonicalJson,
} = require('../../../contracts/canonical-json');
const {
  createInboxCoordinator,
} = require('../../../foundation/persistence/outbox-inbox');
const {
  createMaterialControlProjectionPort,
} = require('../../../foundation/persistence/material-control');
const {
  createShelfQueryStore,
} = require('../persistence/shelf-query-store');
const {
  createHandoffBAcceptanceStore,
} = require('../persistence/handoff-b-acceptance-store');
const {
  createOnDeckStore,
} = require('../persistence/on-deck-store');
const {
  emptyArcaMaterialEpisodeClaims,
  fromProductMember,
} = require('../model/material-episode-claims');

class MovieOnDeckCoordinatorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MovieOnDeckCoordinatorError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new MovieOnDeckCoordinatorError(code, message, details);
}

function stable(schema, value) {
  return canonicalDigest({ schema, ...value });
}

function exactOffer(message) {
  const keys = [
    'acceptanceSpecId', 'dedupKey', 'libraRunId', 'messageId',
    'messageKind', 'offerId', 'onDeckPackageId', 'packageDigest',
    'packageRevision', 'shelfId', 'subjectId',
  ].sort();
  if (!message || canonicalJson(Object.keys(message).sort()) !==
      canonicalJson(keys) ||
      message.messageKind !== 'libra.product-offer.available@1' ||
      message.messageId !== message.dedupKey ||
      !Number.isSafeInteger(message.packageRevision) ||
      message.packageRevision < 1 ||
      !/^[0-9a-f]{64}$/.test(message.packageDigest || '') ||
      message.messageId !== stable('libra.product-offer-message-id@1', {
        offerId: message.offerId,
        packageDigest: message.packageDigest,
      })) {
    fail('P14_HANDOFF_B_OFFER_INVALID',
      'Arca accepts only the exact official Handoff B Offer message.');
  }
  return Object.freeze({ ...message });
}

function acceptanceCheck(input) {
  const base = {
    schemaRef: 'helix://contracts/types/AcceptanceCheck/v1',
    schemaVersion: 1,
    verificationId: stable('arca.acceptance-check-id@1', {
      acceptanceAttemptId: input.acceptanceAttemptId,
      checkKind: input.checkKind,
      basisDigest: input.basisDigest,
    }),
    verificationKind: 'shelf_acceptance',
    basisDigest: input.basisDigest,
    result: input.passed ? 'passed' : 'failed',
    reasonCodes: input.passed ? [] : [input.reasonCode],
    evidenceRefs: input.evidenceRefs,
    verifiedAtMs: input.verifiedAtMs,
    acceptanceAttemptId: input.acceptanceAttemptId,
    checkKind: input.checkKind,
    standardRevision: input.standardRevision,
    packageDigest: input.packageDigest,
  };
  return Object.freeze({
    ...base,
    evidenceDigest: canonicalDigest(base),
  });
}

function bindingFromProduct(member, contentProfile) {
  return Object.freeze({
    materialKey: member.materialKey,
    role: 'product:' + member.role,
    physicalIdentity: member.physicalIdentity,
    episodeClaims: fromProductMember(member, contentProfile),
    endpointId: member.location.endpointId,
    location: member.workspaceMaterialHandle
      ? 'workspace://' + member.workspaceMaterialHandle.workspaceId + '/' +
        member.workspaceMaterialHandle.relativePath
      : member.location.location,
  });
}

function bindingFromContext(member) {
  return Object.freeze({
    materialKey: member.materialKey,
    role: 'offload:' + member.contextRole,
    physicalIdentity: member.physicalIdentity,
    episodeClaims: emptyArcaMaterialEpisodeClaims(),
    endpointId: member.endpointId,
    location: member.location,
  });
}

function createMovieOnDeckCoordinator(options) {
  if (!options?.schemaManifest || !options.unitOfWork ||
      !options.productDeliveryPort ||
      typeof options.productDeliveryPort.readPackage !== 'function' ||
      !options.inventoryPort ||
      typeof options.inventoryPort.assess !== 'function' ||
      typeof options.inventoryPort.prepare !== 'function' ||
      typeof options.inventoryPort.materialize !== 'function') {
    fail('P14_MOVIE_ONDECK_DEPENDENCIES',
      'Movie On-deck requires formal Product Delivery and Arca Inventory ports.');
  }
  const shelves = createShelfQueryStore(options);
  const controls = createMaterialControlProjectionPort(options);
  const acceptance = createHandoffBAcceptanceStore(options);
  const onDeck = createOnDeckStore(options);
  const inbox = createInboxCoordinator(options);
  const observedAtMs = (packageValue) =>
    Number.isSafeInteger(packageValue.publishedAtMs)
      ? packageValue.publishedAtMs
      : 0;

  function acceptProductOffer(inputMessage) {
    const offer = exactOffer(inputMessage);
    const delivery = options.productDeliveryPort.readPackage({
      queryContract: 'libra.product-delivery@1',
      readPurpose: 'historical',
      offerId: offer.offerId,
      onDeckPackageId: offer.onDeckPackageId,
      expectedPackageRevision: offer.packageRevision,
      expectedPackageDigest: offer.packageDigest,
    });
    if (!delivery || delivery.resultKind !== 'found') {
      fail('P14_HANDOFF_B_DELIVERY_INELIGIBLE',
        'Product Delivery is absent for Handoff B.', {
          reasonCode: delivery?.reasonCode || 'delivery_unavailable',
        });
    }
    const packageValue = delivery.onDeckProductPackage;
    if (packageValue.onDeckPackageId !== offer.onDeckPackageId ||
        packageValue.packageDigest !== offer.packageDigest ||
        packageValue.packageRevision !== offer.packageRevision ||
        packageValue.libraRunId !== offer.libraRunId ||
        packageValue.subjectId !== offer.subjectId ||
        packageValue.shelfId !== offer.shelfId ||
        packageValue.acceptanceSpecRef.id !== offer.acceptanceSpecId) {
      fail('P14_HANDOFF_B_DELIVERY_MISMATCH',
        'Product Delivery does not conserve the official Offer identity.');
    }
    const shelf = shelves.getShelf(offer.shelfId);
    if (!shelf || shelf.status !== 'active') {
      fail('P14_HANDOFF_B_SHELF_INACTIVE',
        'Handoff B target Shelf is unavailable or inactive.');
    }
    const attemptId = stable('arca.acceptance-attempt-id@1', {
      offerId: offer.offerId,
      onDeckPackageId: offer.onDeckPackageId,
      packageDigest: offer.packageDigest,
      standardRevision: shelf.currentStandardRevision,
      placementRevision: shelf.currentPlacementRevision,
    });
    const historicalResponsibility =
      acceptance.deriveAcceptedResponsibility({
        acceptanceAttemptId: attemptId,
        offerId: offer.offerId,
        onDeckPackageId: offer.onDeckPackageId,
        packageDigest: offer.packageDigest,
        shelfId: shelf.shelfId,
        standardRevision: shelf.currentStandardRevision,
        placementRevision: shelf.currentPlacementRevision,
        checks: [],
      });
    const committedHistory = onDeck.readCommittedByPackage({
      onDeckPackageId: offer.onDeckPackageId,
      packageDigest: offer.packageDigest,
      shelfId: shelf.shelfId,
      custodyId: historicalResponsibility.custodyId,
    });
    const replayCommittedInventory = Boolean(committedHistory);
    const at = observedAtMs(packageValue);
    const feasibility = options.inventoryPort.assess({
      onDeckRunId: stable('arca.on-deck-run-preview@1', {
        offerId: offer.offerId,
      }),
      custodyId: stable('arca.on-deck-custody-preview@1', {
        offerId: offer.offerId,
      }),
      shelf,
      onDeckProductPackage: packageValue,
      observedAtMs: at,
      replayCommitted: replayCommittedInventory,
    });
    const factKinds = new Set(
      packageValue.productFactManifest.items.map((item) => item.factKind),
    );
    const identityPassed =
      packageValue.resolvedIdentitySnapshot?.factValue
        ?.resolvedProductIdentity?.identityDigest ||
      packageValue.resolvedIdentitySnapshot?.factValue?.identityDigest;
    const structureKind =
      packageValue.productStructureSnapshot?.structureKind;
    const scopeKind = packageValue.productMaterialManifest.scopeKind;
    const structurePassed =
      (structureKind === 'single' && scopeKind === 'single') ||
      (structureKind === 'season' && scopeKind === 'episode_delivery');
    const contentProfile = structureKind === 'season' ? 'series' : 'movie';
    const metadataPassed = factKinds.has('product_metadata') &&
      packageValue.artifactManifest.items.some((item) =>
        item.artifactKind === 'nfo');
    const mandatoryPassed =
      packageValue.productionAttestation?.unmetRequirementCount === 0 &&
      packageValue.productionAttestation?.productConformanceEvidenceDigest;
    const spacePassed = feasibility.availableBytes >= feasibility.requiredBytes;
    const checkInputs = [
      {
        checkKind: 'identity',
        passed: Boolean(identityPassed),
        reasonCode: 'identity_requirement_unmet',
        evidenceRefs: [
          packageValue.resolvedIdentitySnapshot?.productFactId ||
          packageValue.resolvedIdentitySnapshot?.factId,
        ].filter(Boolean),
        evidence: packageValue.resolvedIdentitySnapshot,
      },
      {
        checkKind: 'structure',
        passed: structurePassed,
        reasonCode: 'structure_requirement_unmet',
        evidenceRefs: [packageValue.productStructureSnapshot
          ?.productStructureId].filter(Boolean),
        evidence: packageValue.productStructureSnapshot,
      },
      {
        checkKind: 'metadata',
        passed: metadataPassed,
        reasonCode: 'metadata_requirement_unmet',
        evidenceRefs: [packageValue.productFactManifest.manifestId],
        evidence: packageValue.productFactManifest,
      },
      {
        checkKind: 'mandatory_media',
        passed: Boolean(mandatoryPassed),
        reasonCode: 'mandatory_media_requirement_unmet',
        evidenceRefs: [packageValue.productionAttestation?.attestationId]
          .filter(Boolean),
        evidence: packageValue.productionAttestation,
      },
      {
        checkKind: 'space',
        passed: spacePassed,
        reasonCode: 'space_requirement_unmet',
        evidenceRefs: [feasibility.evidenceId],
        evidence: feasibility,
      },
    ];
    const checks = checkInputs.map((item) => acceptanceCheck({
      acceptanceAttemptId: attemptId,
      checkKind: item.checkKind,
      standardRevision: shelf.currentStandardRevision,
      packageDigest: packageValue.packageDigest,
      verifiedAtMs: at,
      passed: item.passed,
      reasonCode: item.reasonCode,
      evidenceRefs: item.evidenceRefs,
      basisDigest: canonicalDigest({
        schema: 'arca.acceptance-check-basis@1',
        acceptanceAttemptId: attemptId,
        checkKind: item.checkKind,
        standardRevision: shelf.currentStandardRevision,
        placementRevision: shelf.currentPlacementRevision,
        packageDigest: packageValue.packageDigest,
        evidence: item.evidence,
      }),
    }));
    if (checks.some((item) => item.result !== 'passed') ||
        feasibility.outcome !== 'passed') {
      fail('P14_HANDOFF_B_ACCEPTANCE_REJECTED',
        'Product Package does not satisfy the current Shelf acceptance basis.',
        {
          reasons: checks.filter((item) => item.result !== 'passed')
            .flatMap((item) => item.reasonCodes),
        });
    }
    const persistedChecks = [
      ...checks.map((item) => Object.freeze({
        kind: item.checkKind,
        outcome: item.result,
        evidenceDigest: item.evidenceDigest,
      })),
      Object.freeze({
        kind: 'inventory_feasibility',
        outcome: feasibility.outcome,
        evidenceDigest: feasibility.payloadDigest,
      }),
    ].sort((left, right) =>
      Buffer.compare(Buffer.from(left.kind), Buffer.from(right.kind)));
    const assessment = acceptance.readAssessment(attemptId) ||
      acceptance.recordAssessment({
        acceptanceAttemptId: attemptId,
        offerId: offer.offerId,
        onDeckPackageId: offer.onDeckPackageId,
        packageDigest: offer.packageDigest,
        shelfId: offer.shelfId,
        standardRevision: shelf.currentStandardRevision,
        placementRevision: shelf.currentPlacementRevision,
        checks: persistedChecks,
      });
    const productMembers =
      packageValue.productMaterialManifest.members;
    const offloadMembers =
      packageValue.offloadContextManifest.members;
    const byKey = new Map();
    for (const member of [...productMembers, ...offloadMembers]) {
      if (!byKey.has(member.materialKey)) byKey.set(member.materialKey, member);
    }
    const keys = [...byKey.keys()].sort((left, right) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right)));
    const responsibility =
      acceptance.deriveAcceptedResponsibility(assessment);
    const onDeckRunId = responsibility.onDeckRunId;
    const finalInventoryDecision = options.inventoryPort.prepare({
      onDeckRunId,
      custodyId: responsibility.custodyId,
      shelf,
      onDeckProductPackage: packageValue,
      observedAtMs: at,
      replayCommitted: replayCommittedInventory,
    });
    let accepted = acceptance.readAccepted({
      acceptanceAttemptId: attemptId,
      offerMessage: offer,
      libraRunId: offer.libraRunId,
      onDeckRunId,
      finalInventoryDecision,
    });
    if (!accepted) {
      const acceptanceFence = options.productDeliveryPort.readPackage({
        queryContract: 'libra.product-delivery@1',
        readPurpose: 'acceptance_fence',
        offerId: offer.offerId,
        onDeckPackageId: offer.onDeckPackageId,
        expectedPackageRevision: offer.packageRevision,
        expectedPackageDigest: offer.packageDigest,
      });
      if (!acceptanceFence ||
          acceptanceFence.resultKind !== 'found' ||
          acceptanceFence.deliveryFence?.eligibility !== 'eligible') {
        fail('P14_HANDOFF_B_DELIVERY_INELIGIBLE',
          'Product Delivery is no longer eligible for first Handoff B acceptance.', {
            reasonCode:
              acceptanceFence?.deliveryFence?.reasonCode ||
              acceptanceFence?.reasonCode || 'delivery_unavailable',
          });
      }
      const projections = controls.getMaterialControlProjections(keys);
      for (const projection of projections) {
        const member = byKey.get(projection.materialKey);
        const expectedRevision = member.committedControlRevision ??
          member.admittedControlRevision;
        const expectedDigest = member.committedControlProjectionDigest ??
          member.admittedControlProjectionDigest;
        if (projection.resultKind !== 'available' ||
            projection.controlState !== 'controlled' ||
            projection.ownerDomain !== 'libra' ||
            projection.controlRevision !== expectedRevision ||
            projection.projectionDigest !== expectedDigest) {
          fail('P14_HANDOFF_B_CONTROL_FENCE',
            'Product Delivery Control no longer matches the immutable Package.', {
              materialKey: projection.materialKey,
            });
        }
      }
      accepted = acceptance.accept({
        assessment,
        offerMessage: offer,
        libraRunId: offer.libraRunId,
        shelf,
        package: packageValue,
        onDeckRunId,
        finalInventoryDecision,
        targetLocation: feasibility.targetLocation,
        bindings: [
          ...productMembers.map((member) =>
            bindingFromProduct(member, contentProfile)),
          ...offloadMembers.map(bindingFromContext),
        ].sort((left, right) =>
          Buffer.compare(Buffer.from(left.materialKey),
            Buffer.from(right.materialKey)) ||
          Buffer.compare(Buffer.from(left.role), Buffer.from(right.role))),
        controlTransfers: projections.map((projection) => Object.freeze({
          materialKey: projection.materialKey,
          expectedRevision: projection.controlRevision,
          expectedProjectionDigest: projection.projectionDigest,
          fromScope: Object.freeze({
            ownerDomain: projection.ownerDomain,
            scopeType: projection.ownerScopeType,
            scopeId: projection.ownerScopeId,
          }),
        })),
      });
    }
    const consumed = inbox.consume({
      message: Object.freeze({
        messageId: offer.messageId,
        dedupKey: offer.dedupKey,
        consumerDomain: 'arca',
      }),
      resultDigest: accepted.receipt.receiptDigest,
      domainParticipant: acceptance.offerDeliveryParticipant({
        acceptanceDecisionId:
          accepted.decision.acceptanceDecisionId,
        offerId: offer.offerId,
        receiptDigest: accepted.receipt.receiptDigest,
      }),
    });
    const acknowledgement = inbox.acknowledge({
      messageId: offer.messageId,
      consumerDomain: 'arca',
    });
    if (typeof options.afterHandoffBAccepted === 'function') {
      options.afterHandoffBAccepted(Object.freeze({
        offerId: offer.offerId,
        acceptanceDecisionId: accepted.decision.acceptanceDecisionId,
        custodyId: accepted.custody.custodyId,
      }));
    }
    const prepared = onDeck.verifyAcceptedResponsibility({
      onDeckRunId,
      custodyId: accepted.custody.custodyId,
      shelf,
      package: packageValue,
      finalInventoryDecision,
      targetLocation: feasibility.targetLocation,
    });
    onDeck.setOffloading(onDeckRunId,
      finalInventoryDecision.decisionDigest);
    const staged = options.inventoryPort.materialize({
      onDeckRunId,
      custodyId: accepted.custody.custodyId,
      shelf,
      onDeckProductPackage: packageValue,
      finalInventoryDecision,
      observedAtMs: at,
      replayCommitted: replayCommittedInventory,
    });
    const stagedBasis = {
      schema: 'arca.staged-inventory-verification-basis@1',
      stagedInventoryManifestDigest: staged.manifest.manifestDigest,
      finalInventoryDecisionDigest: finalInventoryDecision.decisionDigest,
      members: staged.members.map((item) => ({
        sourceMaterialKey: item.sourceMaterialKey,
        materialKey: item.materialKey,
        episodeClaims: item.episodeClaims,
        outputDigest: item.outputDigest,
      })),
    };
    const stagedVerificationBase = {
      schemaRef:
        'helix://contracts/types/StagedInventoryVerification/v1',
      schemaVersion: 1,
      verificationId: stable('arca.staged-inventory-verification-id@1', {
        onDeckRunId,
        basisDigest: canonicalDigest(stagedBasis),
      }),
      verificationKind: 'staged_inventory',
      basisDigest: canonicalDigest(stagedBasis),
      result: 'passed',
      reasonCodes: [],
      evidenceRefs: staged.members.map((item) => item.effectId),
      verifiedAtMs: at,
      stagedInventoryManifestDigest: staged.manifest.manifestDigest,
      finalInventoryDecisionDigest: finalInventoryDecision.decisionDigest,
    };
    const stagedVerification = Object.freeze(stagedVerificationBase);
    const finalRealityDigest = canonicalDigest({
      schema: 'arca.final-inventory-reality@1',
      onDeckRunId,
      shelfId: shelf.shelfId,
      standardRevision: shelf.currentStandardRevision,
      placementRevision: shelf.currentPlacementRevision,
      stagedInventoryManifestDigest: staged.manifest.manifestDigest,
      members: staged.members,
    });
    const fulfillmentBasis = canonicalDigest({
      schema: 'arca.fulfillment-verification-basis@1',
      finalInventoryDecisionDigest: finalInventoryDecision.decisionDigest,
      stagedVerification: stagedVerification,
      shelfStandardRevision: shelf.currentStandardRevision,
      finalRealityDigest,
    });
    const fulfillmentBase = {
      schemaRef: 'helix://contracts/types/FulfillmentVerification/v1',
      schemaVersion: 1,
      verificationId: stable('arca.fulfillment-verification-id@1', {
        onDeckRunId,
        fulfillmentBasis,
      }),
      verificationKind: 'on_deck_fulfillment',
      basisDigest: fulfillmentBasis,
      result: 'passed',
      reasonCodes: [],
      evidenceRefs: [
        stagedVerification.verificationId,
        finalInventoryDecision.objectId,
      ],
      verifiedAtMs: at,
      finalInventoryDecisionDigest: finalInventoryDecision.decisionDigest,
      shelfStandardRevision: shelf.currentStandardRevision,
      finalRealityDigest,
    };
    const fulfillmentVerification =
      Object.freeze(fulfillmentBase);
    const fulfillmentVerificationDigest =
      canonicalDigest(fulfillmentVerification);
    let committed = onDeck.readCommitted({
      onDeckRunId,
      custodyId: accepted.custody.custodyId,
      finalInventoryDecisionDigest: finalInventoryDecision.decisionDigest,
      onDeckPackageId: packageValue.onDeckPackageId,
      packageDigest: packageValue.packageDigest,
      shelfId: shelf.shelfId,
    });
    if (!committed) {
      const custodyControls = controls.getMaterialControlProjections(keys);
      const targetKeys = staged.members.map((item) => item.materialKey)
        .sort((left, right) =>
          Buffer.compare(Buffer.from(left), Buffer.from(right)));
      const targetControls =
        controls.getMaterialControlProjections(targetKeys);
      committed = onDeck.commit({
        onDeckRunId,
        custodyId: accepted.custody.custodyId,
        shelf,
        package: packageValue,
        finalInventoryDecision,
        staged,
        stagedVerification,
        fulfillmentVerification,
        fulfillmentVerificationDigest,
        custodyControls,
        targetControls,
      });
    }
    if (typeof options.afterOnDeckCommit === 'function') {
      options.afterOnDeckCommit(Object.freeze({
        onDeckRunId,
        shelfEntryId:
          committed.result.onDeckCommitReceipt.shelfEntryId,
      }));
    }
    onDeck.finalize(onDeckRunId,
      finalInventoryDecision.decisionDigest);
    return Object.freeze({
      stage: 'movie_on_deck_committed',
      replayed: accepted.replayed && prepared.replayed &&
        committed.replayed,
      offerId: offer.offerId,
      onDeckPackageId: offer.onDeckPackageId,
      packageDigest: offer.packageDigest,
      handoffB: Object.freeze({
        replayed: accepted.replayed,
        acceptanceDecisionId:
          accepted.decision.acceptanceDecisionId,
        custodyId: accepted.custody.custodyId,
        receipt: accepted.receipt,
        acceptedMessage: accepted.acceptedMessage,
        offerDelivery: Object.freeze({
          replayed: consumed.replayed,
          acknowledgement,
        }),
      }),
      onDeck: Object.freeze({
        onDeckRunId,
        finalInventoryDecision,
        stagedInventoryManifest: staged.manifest,
        stagedVerification,
        fulfillmentVerification,
        result: committed.result,
      }),
    });
  }

  return Object.freeze({ acceptProductOffer });
}

module.exports = Object.freeze({
  MovieOnDeckCoordinatorError,
  createMovieOnDeckCoordinator,
});
