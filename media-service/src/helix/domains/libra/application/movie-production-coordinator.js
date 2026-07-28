'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createWorkAdmission } = require('../../../foundation/execution/work-admission');
const {
  createCanonicalTransactionRegistry,
  createDomainCommitCoordinator,
  createDomainCommitRegistry,
} = require('../../../foundation/persistence/domain-commit-registry');
const { createSupportingResultStore } =
  require('../../../foundation/persistence/supporting-result-store');
const {
  createCapabilityContractValidator,
} = require('../../../foundation/capability/contract-validator');
const westernAnalysisPlanSchemaGraph = require(
  './western-analysis-plan-schema-graph'
);
const { projectMaterialControlRow } =
  require('../../../foundation/persistence/material-control');
const productFactCommitPlanBindingSchema = require(
  '../../../contracts/application-types/LibraProductFactCommitPlanBinding/v1/schema.json'
);
const westernAnalysisPhasePlanBindingSchema = require(
  '../../../contracts/application-types/LibraWesternAnalysisPhasePlanBinding/v1/schema.json'
);
const artifactHandleSchema = require(
  '../../../contracts/types/ArtifactHandle/v1/schema.json'
);
const faceClusterSetHandleSchema = require(
  '../../../contracts/types/FaceClusterSetHandle/v1/schema.json'
);
const faceEmbeddingSetHandleSchema = require(
  '../../../contracts/types/FaceEmbeddingSetHandle/v1/schema.json'
);
const frameArtifactSetSchema = require(
  '../../../contracts/types/FrameArtifactSet/v1/schema.json'
);
const personMatchEvidenceSchema = require(
  '../../../contracts/types/PersonMatchEvidence/v1/schema.json'
);
const westernAnalysisResultSchema = require(
  '../../../contracts/types/WesternAnalysisResult/v1/schema.json'
);
const domainFactTransaction =
  require('../../../contracts/transaction-contracts/helix.transaction.domain-fact-commit/v1/contract.json');
const {
  buildMediaRequirement,
  buildProductMediaCandidateInput,
  buildProductMediaVerification,
  buildProductOutputSelectionInput,
  selectProductOutput,
} = require('../model/media-production-contracts');
const {
  buildArtifactManifestVerification,
  buildMediaCastDraft,
  buildMetadataFetchIntent,
  buildMetadataObservationBasis,
  buildProductFactHandle,
  buildProductMetadataDraft,
  buildResolvedProductIdentity,
  buildWesternProductMetadataDraft,
  metadataSourceRef,
} = require('../model/product-fact-contracts');
const {
  buildProductConformanceFactSnapshot,
  buildProductConformanceInputSnapshot,
  evaluateProductConformance,
} = require('../model/product-conformance');
const {
  absentReferenceDigest,
  buildReferenceDecision,
  episodeScopeDigest,
} = require('../model/workspace-material-reference-contracts');
const {
  buildSpaceAdmissionRequest,
  buildWorkspaceAdmissionDecision,
  requiredFreeBytes,
  workspaceId,
} = require('../model/workspace-admission-contracts');
const {
  createDeliverablePromotionStore,
} = require('../persistence/deliverable-promotion-store');
const {
  createMovieProductionReader,
} = require('../persistence/movie-production-reader');
const {
  createProductDeliveryReader,
} = require('../persistence/product-delivery-reader');
const {
  createProductFactRegistrations,
} = require('../persistence/product-fact-store');
const {
  createWorkspaceAdmissionStore,
} = require('../persistence/workspace-admission-store');
const {
  createWorkspaceMaterialReferenceStore,
} = require('../persistence/workspace-material-reference-store');
const {
  onDeckProductPackageDigest,
} = require('../model/delivery-lifecycle-contracts');

const RESULT_SCHEMA = 'helix://contracts/types/OnDeckProductPackageCommitReceipt/v1';
const METADATA_SCHEMA = 'helix://contracts/types/MetadataObservation/v1';
const ARTIFACT_VERIFICATION_SCHEMA =
  'helix://contracts/types/ArtifactManifestVerification/v1';
const PRODUCT_FACT_PLAN_BINDING_SCHEMA =
  'helix://contracts/application-types/LibraProductFactCommitPlanBinding/v1';
const WESTERN_PHASE_PLAN_BINDING_SCHEMA =
  'helix://contracts/application-types/LibraWesternAnalysisPhasePlanBinding/v1';
const productFactPlanBindingValidator = createCapabilityContractValidator({
  schemas: [productFactCommitPlanBindingSchema],
});
const westernPhasePlanBindingValidator = createCapabilityContractValidator({
  schemas: westernAnalysisPlanSchemaGraph,
});
const westernResultValidator = createCapabilityContractValidator({
  schemas: [
    artifactHandleSchema,
    faceClusterSetHandleSchema,
    faceEmbeddingSetHandleSchema,
    frameArtifactSetSchema,
    personMatchEvidenceSchema,
    westernAnalysisResultSchema,
  ],
});

class MovieProductionCoordinatorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MovieProductionCoordinatorError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new MovieProductionCoordinatorError(code, message, details);
}

function stable(prefix, value) {
  return prefix + canonicalDigest(value);
}

function resultRef(chain) {
  return Object.freeze({
    workId: chain.workId,
    attemptId: chain.attemptId,
    planId: chain.planId,
    eventId: chain.eventId,
    resultId: chain.resultId,
    capabilityRef: chain.capabilityRef,
    resultSchemaRef: chain.resultSchemaRef,
    resultDigest: chain.resultDigest,
    inputBindingDigest: chain.inputBindingDigest,
  });
}

function westernPhasePlanBinding(run, phase, capabilityRef, capabilityInput,
  upstreamChains = []) {
  const value = {
    schemaRef: WESTERN_PHASE_PLAN_BINDING_SCHEMA,
    schemaVersion: 1,
    bindingKind: 'western_analysis_phase',
    libraRunId: run.libraRunId,
    runExecutionBasisDigest: run.executionBasisDigest,
    phase,
    capabilityRef,
    capabilityInput,
    upstreamResultRefs: Object.freeze(upstreamChains.map(resultRef)),
  };
  value.bindingDigest = canonicalDigest(value);
  westernPhasePlanBindingValidator.validate(
    WESTERN_PHASE_PLAN_BINDING_SCHEMA,
    value,
  );
  if (Buffer.byteLength(canonicalJson(value), 'utf8') > 16 * 1024) {
    fail('P14_WESTERN_PLAN_BINDING_TOO_LARGE',
      'Western phase Plan binding exceeds the frozen 16 KiB limit.');
  }
  return Object.freeze(value);
}

function scalarContract(value, digestField = 'digest') {
  return Object.freeze({
    ...value,
    [digestField]: canonicalDigest(value),
  });
}

function workspaceArtifactTarget(run, workspace, rootSnapshot, value) {
  const formalRootBasis = {
    workspaceRootId: rootSnapshot.rootId,
    rootRevision: rootSnapshot.configRevision,
    endpointId: rootSnapshot.endpointId,
    mountScopeId: rootSnapshot.mountScopeId,
    rootLocation: 'workspace-root://' + rootSnapshot.rootId,
    containmentDigest: canonicalDigest({
      schema: 'platform.workspace-root-containment@1',
      rootId: rootSnapshot.rootId,
      endpointId: rootSnapshot.endpointId,
      mountScopeId: rootSnapshot.mountScopeId,
      rootHandleRef: rootSnapshot.rootHandleRef,
    }),
    capacitySnapshotDigest: rootSnapshot.capabilityDigest,
  };
  const formalRootSnapshot = Object.freeze({
    ...formalRootBasis,
    snapshotDigest: canonicalDigest(formalRootBasis),
  });
  const targetId = canonicalDigest({
    schema: 'libra.workspace-artifact-output-target-id@1',
    workspaceId: workspace.workspaceId,
    targetRelativePath: value.targetRelativePath,
    outputKind: value.outputKind,
    sourceInputDigest: value.sourceInputDigest,
  });
  const effectScopeDigest = canonicalDigest({
    schema: 'libra.workspace-artifact-output-effect-scope@1',
    targetId,
    libraRunId: run.libraRunId,
    executionBasisDigest: run.executionBasisDigest,
    workspaceId: workspace.workspaceId,
    expectedWorkspaceRevision: workspace.currentRevision,
    expectedWorkspaceStateDigest: workspace.stateDigest,
    rootSnapshotDigest: formalRootSnapshot.snapshotDigest,
    workspaceScopeDigest: workspace.workspaceScopeDigest,
    outputKind: value.outputKind,
    sourceInputDigest: value.sourceInputDigest,
  });
  const basis = {
    targetId,
    libraRunId: run.libraRunId,
    executionBasisDigest: run.executionBasisDigest,
    workspaceId: workspace.workspaceId,
    expectedWorkspaceRevision: workspace.currentRevision,
    expectedWorkspaceStateDigest: workspace.stateDigest,
    rootSnapshot: formalRootSnapshot,
    workspaceScopeDigest: workspace.workspaceScopeDigest,
    targetRelativePath: value.targetRelativePath,
    outputKind: value.outputKind,
    sourceInputDigest: value.sourceInputDigest,
    effectScopeDigest,
  };
  return Object.freeze({ ...basis, targetDigest: canonicalDigest(basis) });
}

function westernAnalysisVariant(run, identityDigest, analysisChains) {
  const analysisResults = analysisChains.map((chain) => Object.freeze({
    eventId: chain.eventId,
    resultId: chain.resultId,
    resultDigest: chain.resultDigest,
    result: chain.result,
  })).sort((left, right) =>
    Buffer.compare(Buffer.from(left.eventId), Buffer.from(right.eventId)) ||
    Buffer.compare(Buffer.from(left.resultId), Buffer.from(right.resultId)));
  const variantDigest = canonicalDigest({
    libraRunId: run.libraRunId,
    runExecutionBasisDigest: run.executionBasisDigest,
    resolvedIdentityDigest: identityDigest,
    analysisResults,
  });
  return Object.freeze({
    variantId: canonicalDigest({
      schema: 'libra.western-analysis-variant-id@1',
      libraRunId: run.libraRunId,
      runExecutionBasisDigest: run.executionBasisDigest,
      resolvedIdentityDigest: identityDigest,
      variantDigest,
    }),
    libraRunId: run.libraRunId,
    runExecutionBasisDigest: run.executionBasisDigest,
    resolvedIdentityDigest: identityDigest,
    analysisResults: Object.freeze(analysisResults),
    variantDigest,
  });
}

function westernMetadataBasis(run, identityDigest, analysisChains,
  normalizeChain, variant) {
  const analysisRefs = analysisChains.map((chain) => Object.freeze({
    ...resultRef(chain),
    analysisArtifactHandleId:
      chain.result.resultArtifactHandle.artifactHandleId,
    analysisArtifactDigest: chain.result.resultArtifactHandle.digestHex,
    evidenceId: chain.result.evidenceId,
    evidenceDigest: chain.result.payloadDigest,
  }));
  const normalizeRef = Object.freeze({
    ...resultRef(normalizeChain),
    analysisVariantId: variant.variantId,
    productMetadataDraftDigest: normalizeChain.result.draftDigest,
  });
  const sourceItems = [
    ...analysisRefs.map((ref, ordinal) => ({
      ordinal,
      capabilityRef: ref.capabilityRef,
      resultSchemaRef: ref.resultSchemaRef,
      workId: ref.workId,
      attemptId: ref.attemptId,
      planId: ref.planId,
      eventId: ref.eventId,
      resultId: ref.resultId,
      resultDigest: ref.resultDigest,
      sourceRef: ref.analysisArtifactHandleId,
      sourceOrder: ordinal,
      evidenceId: ref.evidenceId,
      evidenceDigest: ref.evidenceDigest,
      inputBindingDigest: ref.inputBindingDigest,
    })),
    {
      ordinal: analysisRefs.length,
      capabilityRef: normalizeRef.capabilityRef,
      resultSchemaRef: normalizeRef.resultSchemaRef,
      workId: normalizeRef.workId,
      attemptId: normalizeRef.attemptId,
      planId: normalizeRef.planId,
      eventId: normalizeRef.eventId,
      resultId: normalizeRef.resultId,
      resultDigest: normalizeRef.resultDigest,
      sourceRef: variant.variantId,
      sourceOrder: analysisRefs.length,
      evidenceId: null,
      evidenceDigest: null,
      inputBindingDigest: normalizeRef.inputBindingDigest,
    },
  ];
  const sourceRefsDigest = canonicalDigest({
    schema: 'libra.western-product-metadata-source-refs@1',
    items: sourceItems,
  });
  const basis = {
    basisId: canonicalDigest({
      schema: 'libra.western-product-metadata-basis-id@1',
      libraRunId: run.libraRunId,
      runExecutionBasisDigest: run.executionBasisDigest,
      sourceRefsDigest,
    }),
    basisKind: 'western_analysis',
    libraRunId: run.libraRunId,
    runExecutionBasisDigest: run.executionBasisDigest,
    resolvedIdentityDigest: identityDigest,
    analysisVariantDigest: variant.variantDigest,
    analysisRefs: Object.freeze(analysisRefs),
    normalizeRef,
    sourceRefsDigest,
  };
  basis.basisDigest = canonicalDigest(basis);
  return Object.freeze({
    sourceBasisKind: 'western_analysis',
    westernBasis: Object.freeze(basis),
    sourceBasisDigest: basis.basisDigest,
  });
}

function westernMatchBasis(run, identityDigest, matchChain) {
  const matchRef = Object.freeze({
    workId: matchChain.workId,
    attemptId: matchChain.attemptId,
    planId: matchChain.planId,
    eventId: matchChain.eventId,
    resultId: matchChain.resultId,
    resultDigest: matchChain.resultDigest,
    inputBindingDigest: matchChain.inputBindingDigest,
    evidenceId: matchChain.result.evidenceId,
    evidenceDigest: matchChain.result.payloadDigest,
    personMatchEvidenceDigest: matchChain.result.payloadDigest,
  });
  const basis = {
    basisId: canonicalDigest({
      schema: 'libra.western-media-cast-basis-id@1',
      libraRunId: run.libraRunId,
      runExecutionBasisDigest: run.executionBasisDigest,
      matchResultId: matchRef.resultId,
      matchResultDigest: matchRef.resultDigest,
      referenceProjectionSetDigest:
        matchChain.result.referenceProjectionSetDigest,
    }),
    basisKind: 'western_match',
    libraRunId: run.libraRunId,
    runExecutionBasisDigest: run.executionBasisDigest,
    resolvedIdentityDigest: identityDigest,
    matchRef,
    referenceProjectionSetDigest:
      matchChain.result.referenceProjectionSetDigest,
    matchState: matchChain.result.matches.length
      ? 'matches_found'
      : 'no_matches',
  };
  basis.basisDigest = canonicalDigest(basis);
  return Object.freeze({
    sourceBasisKind: 'western_match',
    westernBasis: Object.freeze(basis),
    sourceBasisDigest: basis.basisDigest,
  });
}

function productFactPlanBinding(run, factKind, payload, payloadDigest,
  sourceBasis, sourceChains) {
  const chainsByResultId = new Map(sourceChains.map((chain) =>
    [chain.resultId, chain]));
  const sourceItems = sourceBasis.sourceBasisKind === 'metadata_observation'
    ? sourceBasis.selection?.items || []
    : sourceBasis.sourceBasisKind === 'western_analysis'
      ? [
        ...(sourceBasis.westernBasis?.analysisRefs || []),
        sourceBasis.westernBasis?.normalizeRef,
      ].filter(Boolean)
      : sourceBasis.westernBasis?.matchRef
        ? [sourceBasis.westernBasis.matchRef]
        : [];
  const sourceResultRefs = sourceItems.map((item) => {
    const chain = chainsByResultId.get(item.resultId);
    if (!chain || chain.workId !== item.workId ||
        chain.attemptId !== item.attemptId ||
        chain.planId !== item.planId ||
        chain.eventId !== item.eventId) {
      fail('P14_PRODUCT_FACT_PLAN_SOURCE_DRIFT',
        'Product Fact Plan source does not match the selected durable Result.');
    }
    return Object.freeze({
      workId: chain.workId,
      attemptId: chain.attemptId,
      planId: chain.planId,
      eventId: chain.eventId,
      resultId: chain.resultId,
      capabilityRef: chain.capabilityRef,
      resultSchemaRef: chain.resultSchemaRef,
      resultDigest: chain.resultDigest,
      evidenceDigest: chain.evidenceDigest,
      inputBindingDigest: chain.inputBindingDigest,
    });
  });
  const artifactRefs = (payload.verifiedArtifactManifest?.items || [])
    .map((item) => Object.freeze({
      artifactHandleId: item.artifactHandleId,
      artifactRevision: item.artifactRevision,
      artifactDigest: item.artifactDigest,
      verificationResultId: item.verificationResultRef.resultId,
      verificationResultDigest: item.verificationResultRef.resultDigest,
    }))
    .sort((left, right) => Buffer.compare(
      Buffer.from(left.artifactHandleId),
      Buffer.from(right.artifactHandleId),
    ) || left.artifactRevision - right.artifactRevision);
  const value = {
    schemaRef: PRODUCT_FACT_PLAN_BINDING_SCHEMA,
    schemaVersion: 1,
    bindingKind: 'product_fact_commit',
    libraRunId: run.libraRunId,
    runExecutionBasisDigest: run.executionBasisDigest,
    factKind,
    expectedFactRevision: 0,
    payloadDigest,
    sourceBasisKind: sourceBasis.sourceBasisKind,
    sourceBasisId:
      sourceBasis.selection?.selectionId || sourceBasis.westernBasis?.basisId,
    sourceBasisDigest: sourceBasis.sourceBasisDigest,
    sourceResultRefs,
    artifactRefs,
    mediaCastFactRef: payload.mediaCastFactRef || null,
  };
  value.bindingDigest = canonicalDigest(value);
  productFactPlanBindingValidator.validate(
    PRODUCT_FACT_PLAN_BINDING_SCHEMA,
    value,
  );
  if (Buffer.byteLength(canonicalJson(value), 'utf8') > 16 * 1024) {
    fail('P14_PRODUCT_FACT_PLAN_BINDING_TOO_LARGE',
      'Product Fact Plan binding exceeds the frozen node limit.');
  }
  return Object.freeze(value);
}

function productOfferMessage(value) {
  const messageId = canonicalDigest({
    schema: 'libra.product-offer-message-id@1',
    offerId: value.offerId,
    packageDigest: value.packageDigest,
  });
  return Object.freeze({
    messageKind: 'libra.product-offer.available@1',
    messageId,
    offerId: value.offerId,
    onDeckPackageId: value.onDeckPackageId,
    packageRevision: value.packageRevision,
    packageDigest: value.packageDigest,
    libraRunId: value.libraRunId,
    subjectId: value.subjectId,
    shelfId: value.shelfId,
    acceptanceSpecId: value.acceptanceSpecId,
    dedupKey: messageId,
  });
}

function episodeClaimSetDigest(claims) {
  return canonicalDigest({
    schema: 'libra.production-material-episode-claims@1',
    items: claims,
  });
}

function complete(value, field) {
  const result = { ...value };
  result[field] = canonicalDigest(result);
  return Object.freeze(result);
}

function mediaProbeEvidence(raw, handle, observedAtMs) {
  const videoStreams = [...(raw.videoStreams || [])].map((item) => {
    const codedWidth = item.codedWidth || item.width || 0;
    const codedHeight = item.codedHeight || item.height || 0;
    const displayWidth = item.displayWidth || codedWidth;
    const displayHeight = item.displayHeight || codedHeight;
    return Object.freeze({
      streamIndex: item.streamIndex,
      dispositionDefault: item.dispositionDefault === true,
      codec: item.codec,
      codedWidth,
      codedHeight,
      sampleAspectRatio: item.sampleAspectRatio || '1:1',
      rotation: item.rotation || 0,
      displayWidth,
      displayHeight,
      longEdge: Math.max(displayWidth, displayHeight),
      shortEdge: Math.min(displayWidth, displayHeight),
    });
  }).sort((left, right) => left.streamIndex - right.streamIndex);
  const audioStreams = [...(raw.audioStreams || [])].map((item) => Object.freeze({
    streamIndex: item.streamIndex,
    dispositionDefault: item.dispositionDefault === true,
    codec: item.codec,
    profile: item.profile || null,
    channels: item.channels || 0,
    channelLayout: item.channelLayout || null,
    formatTags: Object.freeze([...(item.formatTags || [])]),
    normalizedAudioClass: item.normalizedAudioClass || 'other',
  })).sort((left, right) => left.streamIndex - right.streamIndex);
  const subtitleStreams = [...(raw.subtitleStreams || [])].map((item) =>
    Object.freeze({ streamIndex:item.streamIndex, codec:item.codec }))
    .sort((left, right) => left.streamIndex - right.streamIndex);
  const basis = {
    schemaRef: 'helix://contracts/types/MediaProbeEvidence/v1',
    schemaVersion: 1,
    evidenceId: stable('movie-media-probe-', {
      handleId: handle.handleId,
      sourceHandleDigest: canonicalDigest(handle),
    }),
    evidenceKind: 'media_probe',
    producerRef: 'shared.material.media.probe@1',
    basisDigest: canonicalDigest({
      schema: 'libra.movie-media-probe-basis@1',
      sourceHandleDigest: canonicalDigest(handle),
    }),
    payloadDigest: '',
    observedAtMs,
    sourceHandleDigest: canonicalDigest(handle),
    resultKind: raw.resultKind,
    sizeBytes: handle.expectedSizeBytes,
    videoStreams: Object.freeze(videoStreams),
    audioStreams: Object.freeze(audioStreams),
    subtitleStreams: Object.freeze(subtitleStreams),
  };
  if (raw.resultKind === 'probed') {
    basis.container = raw.container || 'matroska';
    basis.durationMs = raw.durationMs;
    basis.discTopology = raw.discTopology || null;
  } else {
    basis.reasonCode = 'probe_not_media';
  }
  basis.payloadDigest = canonicalDigest(Object.fromEntries(
    Object.entries(basis).filter(([key]) => key !== 'payloadDigest'),
  ));
  return Object.freeze(basis);
}

function providerIdentity(value) {
  const identity = {
    provider: value.provider,
    namespace: value.namespace,
    providerKey: value.providerKey,
    seasonNumber: value.seasonNumber ?? null,
  };
  identity.identityAnchorDigest = canonicalDigest(identity);
  return Object.freeze(identity);
}

function validateMetadataObservationResult(result) {
  const identitySet = result.providerIdentitySet;
  const expectedRecordDigest = canonicalDigest(Object.fromEntries(
    Object.entries(identitySet).filter(([key]) => key !== 'recordDigest'),
  ));
  if (identitySet.recordDigest !== expectedRecordDigest) {
    fail('P14_MOVIE_METADATA_IDENTITY_SET_DIGEST',
      'Metadata Observation Provider identity set digest is invalid.');
  }
  const identityKeys = identitySet.entries.map(canonicalJson);
  const sortedIdentityKeys = [...identityKeys].sort((left, right) =>
    Buffer.compare(Buffer.from(left), Buffer.from(right)));
  if (canonicalJson(identityKeys) !== canonicalJson(sortedIdentityKeys) ||
      new Set(identityKeys).size !== identityKeys.length) {
    fail('P14_MOVIE_METADATA_IDENTITY_SET_ORDER',
      'Metadata Observation Provider identities are not canonical and unique.');
  }
  return result;
}

function metadataObservation(intent, values, observedAtMs) {
  const entries = [...values.entries]
    .sort((left, right) => Buffer.compare(Buffer.from(left.key), Buffer.from(right.key)));
  const descriptiveFacts = {
    schemaRef: 'helix://contracts/records/descriptive-facts/v1',
    schemaVersion: 1,
    recordKind: 'descriptive-facts',
    recordDigest: '',
    entries,
  };
  descriptiveFacts.recordDigest = canonicalDigest(Object.fromEntries(
    Object.entries(descriptiveFacts).filter(([key]) => key !== 'recordDigest'),
  ));
  const identities = [...(values.providerIdentities || [])].sort((left, right) =>
    Buffer.compare(Buffer.from(canonicalJson(left)), Buffer.from(canonicalJson(right))));
  const identityKeys = identities.map(canonicalJson);
  if (new Set(identityKeys).size !== identityKeys.length) {
    fail('P14_MOVIE_METADATA_IDENTITY_DUPLICATE',
      'Metadata Observation Provider identities must be tuple-unique.');
  }
  if ((values.artifactHints || []).length !== 0) {
    fail('P14_MOVIE_METADATA_ARTIFACT_HINT_UNSUPPORTED',
      'Metadata Observation cannot synthesize Artifact availability hints.');
  }
  const providerIdentitySet = {
    schemaRef: 'helix://contracts/records/provider-identity-set/v1',
    schemaVersion: 1,
    recordKind: 'provider-identity-set',
    recordDigest: '',
    entries: identities,
  };
  providerIdentitySet.recordDigest = canonicalDigest(Object.fromEntries(
    Object.entries(providerIdentitySet).filter(([key]) => key !== 'recordDigest'),
  ));
  const result = {
    schemaRef: METADATA_SCHEMA,
    schemaVersion: 1,
    evidenceId: stable('movie-metadata-observation-', {
      intentDigest: intent.intentDigest,
      descriptiveFactsDigest: descriptiveFacts.recordDigest,
      providerIdentitySetDigest: providerIdentitySet.recordDigest,
    }),
    evidenceKind: 'metadata_observation',
    producerRef: 'libra.product_metadata.fetch@1',
    basisDigest: intent.intentDigest,
    payloadDigest: '',
    observedAtMs,
    fetchIntentDigest: intent.intentDigest,
    sourceKind: intent.sourceKind,
    sourceRef: metadataSourceRef(intent),
    sourcePriority: intent.sourcePriority,
    identityDigest: intent.resolvedIdentityDigest,
    contentProfile: intent.contentProfile,
    descriptiveFacts: Object.freeze(descriptiveFacts),
    providerIdentitySet: Object.freeze(providerIdentitySet),
    peopleHints: Object.freeze([...(values.peopleHints || [])]),
    artifactHints: Object.freeze([]),
  };
  result.payloadDigest = canonicalDigest(Object.fromEntries(
    Object.entries(result).filter(([key]) => key !== 'payloadDigest'),
  ));
  validateMetadataObservationResult(result);
  return Object.freeze(result);
}

function workDefinition(run, value) {
  return Object.freeze({
    schemaRef: 'helix://foundation/types/SupportingWorkDefinition/v1',
    schemaVersion: 1,
    workId: value.workId,
    ownerDomain: 'libra',
    processType: 'libra_run',
    processId: run.libraRunId,
    workKind: value.workKind,
    workObjectiveTypeRef: value.objectiveRef,
    workObjectiveVersion: 1,
    executionBasisId: stable('movie-production-work-basis-', {
      workId: value.workId,
    }),
    executionBasisDigest: value.basisDigest,
    dependencyRefs: Object.freeze([]),
    priorityClass: 'normal_foreground',
    priorityRevision: 1,
    capabilityCatalogScope: 'libra',
    workspaceMaterialScope: Object.freeze([]),
    idempotencyKey: stable('movie-production-work-key-', {
      workId: value.workId,
      basisDigest: value.basisDigest,
    }),
    concurrencyScope: run.libraRunId + '/' + value.workKind + '/' + value.workId,
    outputContractRef: value.resultSchemaRef,
  });
}

function capabilityStep(value) {
  const demand = Object.freeze({ resourceKinds:Object.freeze(value.resourceKinds || ['disk_io']) });
  return Object.freeze({
    nodeId: value.nodeId,
    eventId: value.eventId,
    capabilityRef: value.capabilityRef,
    effectClass: value.effectClass,
    inputSchemaRef: value.inputSchemaRef,
    input: value.input,
    parametersSchemaRef: value.parametersSchemaRef,
    parameters: Object.freeze({ ...(value.parameters || {}) }),
    fenceSchemaRef: value.fenceSchemaRef,
    fenceBasis: Object.freeze({
      basisDigest: value.basisDigest,
      eventFenceDigest: value.eventFenceDigest,
    }),
    resourceDemandSchemaRef: value.resourceDemandSchemaRef,
    resourceDemand: Object.freeze({
      ...demand,
      demandDigest: canonicalDigest(demand),
    }),
  });
}

function artifactRequirement(kind) {
  const mediaType = kind === 'nfo' ? 'application/xml' : 'image/jpeg';
  const value = {
    requirementId: '',
    revision: 1,
    schemaRef: kind === 'nfo'
      ? 'shelfdeck.product-artifact.nfo-renderable@1'
      : 'shelfdeck.product-artifact.image-decodable@1',
    artifactKind: kind,
    requirementPayload: Object.freeze({ mediaType }),
    requirementDigest: '',
  };
  value.requirementDigest = canonicalDigest({
    schema: 'shared.artifact-requirement@1',
    revision: value.revision,
    schemaRef: value.schemaRef,
    artifactKind: value.artifactKind,
    requirementPayload: value.requirementPayload,
  });
  value.requirementId = canonicalDigest({
    schema: 'shared.artifact-requirement-id@1',
    requirementDigest: value.requirementDigest,
  });
  return Object.freeze(value);
}

function artifactVerificationSnapshot(runId, role, material, artifact, requirement, verification) {
  const value = {
    verificationKind: 'artifact',
    materialRole: role,
    libraRunId: runId,
    workspaceMaterialHandleId: material.handleId,
    workspaceMaterialHandleDigest: canonicalDigest(material),
    workspaceMaterialFenceDigest: material.fenceDigest,
    schemaRef: 'ArtifactManifestVerification@1',
    verificationId: verification.verificationId,
    verificationValue: verification,
    verificationDigest: canonicalDigest(verification),
    artifactHandle: artifact,
    artifactRequirement: requirement,
  };
  value.snapshotDigest = canonicalDigest(value);
  return Object.freeze(value);
}

function verifiedArtifactItem(ordinal, artifact, requirement, verification, chain) {
  const resultRef = {
    workId: chain.workId,
    attemptId: chain.attemptId,
    planId: chain.planId,
    eventId: chain.eventId,
    resultId: chain.resultId,
    capabilityRef: chain.capabilityRef,
    resultSchemaRef: ARTIFACT_VERIFICATION_SCHEMA,
    resultDigest: canonicalDigest(verification),
    inputBindingDigest: chain.inputBindingDigest,
  };
  const value = {
    ordinal,
    artifactHandleId: artifact.artifactHandleId,
    artifactKind: artifact.artifactKind,
    artifactRevision: artifact.referenceRevision,
    artifactDigest: artifact.digestHex,
    requirementId: requirement.requirementId,
    requirementRevision: requirement.revision,
    requirementSchemaRef: requirement.schemaRef,
    requirementDigest: requirement.requirementDigest,
    verificationEvidenceId: verification.verificationId,
    verificationEvidenceDigest: verification.verificationDigest,
    verificationResultRef: resultRef,
  };
  value.referenceDigest = canonicalDigest(value);
  return Object.freeze(value);
}

function createMovieProductionCoordinator(options) {
  if (!options?.schemaManifest || !options.unitOfWork || !options.workRuntime ||
      !options.productionPort || !options.workspaceProductPort) {
    fail('P14_MOVIE_PRODUCTION_DEPENDENCIES',
      'Movie production requires clean persistence, ports, and Work runtime.');
  }
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const reader = createMovieProductionReader(options);
  const workspaceAdmission = createWorkspaceAdmissionStore(options);
  const referenceStore = createWorkspaceMaterialReferenceStore(options);
  const resultStore = createSupportingResultStore(options);
  const promotionStore = createDeliverablePromotionStore(options);
  const deliveryReader = createProductDeliveryReader(options);
  const factCoordinator = createDomainCommitCoordinator({
    schemaManifest: options.schemaManifest,
    unitOfWork: options.unitOfWork,
    registry: createDomainCommitRegistry({
      registrations: createProductFactRegistrations({
        schemaManifest: options.schemaManifest,
      }),
    }),
    transactionRegistry: createCanonicalTransactionRegistry({
      contracts: [domainFactTransaction],
    }),
  });

  function admitWork(run, definition) {
    const result = createWorkAdmission({
      schemaManifest: options.schemaManifest,
      unitOfWork: options.unitOfWork,
      eligibilityProvider: {
        check(request) {
          return Object.freeze({
            eligible: request.ownerDomain === 'libra' &&
              request.processType === 'libra_run' &&
              request.processId === run.libraRunId &&
              request.executionBasisDigest === definition.executionBasisDigest,
            basisDigest: definition.executionBasisDigest,
            reasonCode: 'P14_MOVIE_PRODUCTION_BASIS_STALE',
          });
        },
      },
      limits: Object.freeze({
        globalOpenWorks: 1000,
        ownerOpenWorks: 500,
        openEvents: 100000,
      }),
    }).submit(definition);
    if (result.kind !== 'admitted') {
      fail('P14_MOVIE_PRODUCTION_WORK_DEFERRED',
        'Movie production Supporting Work cannot be admitted.', { result });
    }
  }

  async function runResultCapability(run, value) {
    const validateResult = (result) => {
      if (westernResultValidator.has(value.resultSchemaRef)) {
        westernResultValidator.validate(value.resultSchemaRef, result);
      }
      return result;
    };
    const planInput = value.planInput || value.input;
    const basisDigest = canonicalDigest({
      schema: 'libra.movie-production-capability-basis@1',
      runExecutionBasisDigest: run.executionBasisDigest,
      capabilityRef: value.capabilityRef,
      input: planInput,
    });
    const workId = stable('movie-production-work-', {
      libraRunId: run.libraRunId,
      capabilityRef: value.capabilityRef,
      basisDigest,
    });
    const eventId = stable('movie-production-event-', { workId, basisDigest });
    const eventFenceDigest = canonicalDigest({
      schema: 'libra.movie-production-event-fence@1',
      workId,
      eventId,
      basisDigest,
    });
    const definition = workDefinition(run, {
      workId,
      workKind: value.workKind,
      objectiveRef: value.objectiveRef,
      basisDigest,
      resultSchemaRef: value.resultSchemaRef,
    });
    admitWork(run, definition);
    const step = capabilityStep({
      nodeId: value.nodeId,
      eventId,
      capabilityRef: value.capabilityRef,
      effectClass: value.effectClass,
      inputSchemaRef: value.inputSchemaRef,
      input: planInput,
      parametersSchemaRef: value.parametersSchemaRef,
      fenceSchemaRef: value.fenceSchemaRef,
      basisDigest,
      eventFenceDigest,
      resourceDemandSchemaRef: value.resourceDemandSchemaRef,
      resourceKinds: value.resourceKinds,
    });
    const activation = options.workRuntime.activate({
      workId,
      ownerDomain: 'libra',
      basisDigest,
      plannerRef: 'libra.movie-product-planner@1',
      catalogDigest: canonicalDigest({
        schema: 'libra.movie-product-catalog@1',
        capabilities: [value.capabilityRef],
      }),
      steps: Object.freeze([step]),
    });
    const event = options.workRuntime.beginEvent(eventId);
    const resultId = stable('movie-production-result-', {
      eventId,
      resultSchemaRef: value.resultSchemaRef,
    });
    if (event.state === 'succeeded') {
      const stored = resultStore.readEventResult(eventId);
      if (!stored || stored.resultSchemaRef !== value.resultSchemaRef) {
        fail('P14_MOVIE_PRODUCTION_RESULT_REPLAY',
          'Succeeded Supporting Work lacks its exact typed Result.');
      }
      if (stored.resultSchemaRef === METADATA_SCHEMA) {
        validateMetadataObservationResult(stored.result);
      }
      validateResult(stored.result);
      options.workRuntime.complete(workId);
      return Object.freeze({
        ownerDomain: 'libra',
        processType: 'libra_run',
        processId: run.libraRunId,
        workKind: value.workKind,
        workState: 'succeeded',
        capabilityRef: value.capabilityRef,
        resultSchemaRef: stored.resultSchemaRef,
        result: stored.result,
        resultId: stored.resultId,
        resultDigest: stored.resultDigest,
        evidenceDigest: stored.evidenceDigest,
        inputBindings: planInput,
        inputBindingDigest: canonicalDigest(planInput),
        workId,
        attemptId: workId + ':attempt:1',
        planId: workId + ':plan:1',
        planRevision: Number(activation.snapshot.plan.planner_version),
        planDigest: activation.snapshot.plan.graph_digest,
        eventId,
        replayed: true,
      });
    }
    const committed = resultStore.recoverCommittedEventResult({
      eventId,
      resultId,
      ownerDomain: 'libra',
      capabilityRef: value.capabilityRef,
      resultSchemaRef: value.resultSchemaRef,
    });
    if (committed) {
      validateResult(committed.result);
      options.workRuntime.completeEvent(eventId, resultId);
      options.workRuntime.complete(workId);
      return Object.freeze({
        ownerDomain: 'libra',
        processType: 'libra_run',
        processId: run.libraRunId,
        workKind: value.workKind,
        workState: 'succeeded',
        capabilityRef: value.capabilityRef,
        resultSchemaRef: committed.resultSchemaRef,
        result: committed.result,
        resultId,
        resultDigest: committed.resultDigest,
        evidenceDigest: committed.evidenceDigest,
        inputBindings: planInput,
        inputBindingDigest: canonicalDigest(planInput),
        workId,
        attemptId: workId + ':attempt:1',
        planId: workId + ':plan:1',
        planRevision: Number(activation.snapshot.plan.planner_version),
        planDigest: activation.snapshot.plan.graph_digest,
        eventId,
        replayed: true,
        recoveredCommittedResult: true,
      });
    }
    const result = typeof value.execute === 'function'
      ? await value.execute()
      : value.result;
    if (!result || typeof result !== 'object') {
      fail('P14_MOVIE_PRODUCTION_RESULT_INVALID',
        'Capability execution did not produce its typed Result.');
    }
    if (value.resultSchemaRef === METADATA_SCHEMA) {
      validateMetadataObservationResult(result);
    }
    validateResult(result);
    const evidenceDigest = typeof value.evidenceDigest === 'function'
      ? value.evidenceDigest(result)
      : value.evidenceDigest || canonicalDigest(result);
    resultStore.commit({
      resultId,
      eventId,
      ownerDomain: 'libra',
      capabilityRef: value.capabilityRef,
      resultSchemaRef: value.resultSchemaRef,
      result,
      evidenceSchemaRef: value.resultSchemaRef,
      evidence: result,
      evidenceDigest,
    });
    if (typeof options.afterCapabilityResultCommit === 'function') {
      options.afterCapabilityResultCommit(Object.freeze({
        capabilityRef: value.capabilityRef,
        eventId,
        resultId,
        resultDigest: canonicalDigest(result),
      }));
    }
    if (event.state !== 'succeeded') options.workRuntime.completeEvent(eventId, resultId);
    options.workRuntime.complete(workId);
    return Object.freeze({
      ownerDomain: 'libra',
      processType: 'libra_run',
      processId: run.libraRunId,
      workKind: value.workKind,
      workState: 'succeeded',
      capabilityRef: value.capabilityRef,
      resultSchemaRef: value.resultSchemaRef,
      result,
      resultId,
      resultDigest: canonicalDigest(result),
      evidenceDigest,
      inputBindings: planInput,
      inputBindingDigest: canonicalDigest(planInput),
      workId,
      attemptId: workId + ':attempt:1',
      planId: workId + ':plan:1',
      planRevision: Number(activation.snapshot.plan.planner_version),
      planDigest: activation.snapshot.plan.graph_digest,
      eventId,
    });
  }

  function commitFact(run, factKind, sourceBasis, payloadValue, sourceChains) {
    const existing = reader.readFact(run.libraRunId, factKind, 1);
    if (existing) return existing;
    const payload = Object.freeze({ ...payloadValue, sourceBasis });
    const payloadDigest = canonicalDigest(payload);
    const planBinding = productFactPlanBinding(
      run,
      factKind,
      payload,
      payloadDigest,
      sourceBasis,
      sourceChains,
    );
    const basisDigest = canonicalDigest({
      schema: 'libra.movie-product-fact-work@1',
      libraRunId: run.libraRunId,
      factKind,
      payloadDigest,
    });
    const workId = stable('movie-product-fact-work-', {
      libraRunId: run.libraRunId,
      factKind,
      payloadDigest,
    });
    const eventId = stable('movie-product-fact-event-', { workId, basisDigest });
    const eventFenceDigest = canonicalDigest({
      schema: 'libra.movie-product-fact-event-fence@1',
      libraRunId: run.libraRunId,
      factKind,
      eventId,
      payloadDigest,
    });
    const definition = workDefinition(run, {
      workId,
      workKind: 'product_fact',
      objectiveRef: 'helix://libra/work/ProductFactCommit/v1',
      basisDigest,
      resultSchemaRef: factKind === 'resolved_identity'
        ? 'helix://contracts/types/ResolvedProductIdentity/v1'
        : factKind === 'media_cast'
          ? 'helix://contracts/types/MediaCastFact/v1'
          : 'helix://contracts/types/ProductMetadataFact/v1',
    });
    admitWork(run, definition);
    const handle = buildProductFactHandle({
      libraRunId: run.libraRunId,
      factKind,
      expectedRevision: 0,
      payloadDigest,
      eventFenceDigest,
    });
    const step = capabilityStep({
      nodeId: 'product-fact-commit',
      eventId,
      capabilityRef: 'libra.product_fact.commit@1',
      effectClass: 'domain_fact_commit',
      inputSchemaRef: PRODUCT_FACT_PLAN_BINDING_SCHEMA,
      input: planBinding,
      parametersSchemaRef: 'helix://contracts/capabilities/libra.product_fact.commit/v1/parameters',
      fenceSchemaRef: 'helix://contracts/capabilities/libra.product_fact.commit/v1/fence',
      basisDigest,
      eventFenceDigest,
      resourceDemandSchemaRef:
        'helix://contracts/capabilities/libra.product_fact.commit/v1/resource-demand',
    });
    options.workRuntime.activate({
      workId,
      ownerDomain: 'libra',
      basisDigest,
      plannerRef: 'libra.movie-product-planner@1',
      catalogDigest: canonicalDigest({
        schema: 'libra.movie-product-catalog@1',
        capabilities: ['libra.product_fact.commit@1'],
      }),
      steps: Object.freeze([step]),
    });
    const event = options.workRuntime.beginEvent(eventId);
    const marker = stable('movie-product-fact-marker-', {
      libraRunId: run.libraRunId,
      factKind,
      payloadDigest,
    });
    const resultId = stable('movie-product-fact-result-', {
      libraRunId: run.libraRunId,
      factKind,
      payloadDigest,
    });
    const evidence = {
      schemaRef: 'helix://contracts/types/LibraProductFactEvidence/v1',
      schemaVersion: 1,
      evidenceId: stable('movie-product-fact-evidence-', {
        libraRunId: run.libraRunId,
        factKind,
        payloadDigest,
      }),
      evidenceDigest: canonicalDigest({
        schema: 'libra.movie-product-fact-evidence@1',
        libraRunId: run.libraRunId,
        factKind,
        payloadDigest,
      }),
    };
    factCoordinator.execute({
      transactionId: 'helix.transaction.domain-fact-commit',
      handle,
      payload,
      supportingWorkId: workId,
      outboxMessages: [],
      commitMarker: {
        commitMarker: marker,
        commitDigest: canonicalDigest({
          schema: 'libra.movie-product-fact-commit@1',
          handleId: handle.handleId,
          payloadDigest,
        }),
      },
      resultBinding: {
        resultId,
        eventId,
        evidenceSchemaRef: evidence.schemaRef,
        evidence,
      },
    });
    if (event.state !== 'succeeded') options.workRuntime.completeEvent(eventId, resultId);
    options.workRuntime.complete(workId);
    const fact = reader.readFact(run.libraRunId, factKind, 1);
    if (!fact) fail('P14_MOVIE_PRODUCT_FACT_MISSING',
      'Committed Product Fact cannot be read from its exact Owner row.');
    return fact;
  }

  function ensureWorkspace(snapshot) {
    const id = workspaceId(snapshot.run.libraRunId);
    let workspace = reader.readWorkspace(id);
    if (workspace) return workspace;
    const root = options.workspaceProductPort.rootSnapshot();
    const inputPrimaryTotalBytes = snapshot.members.reduce(
      (total, member) => total + member.sizeBytes,
      0,
    );
    const request = buildSpaceAdmissionRequest({
      workspaceId: id,
      libraRunId: snapshot.run.libraRunId,
      executionBasisDigest: snapshot.run.executionBasisDigest,
      rootId: root.rootId,
      rootSnapshotDigest: root.snapshotDigest,
      inputPrimaryTotalBytes,
      requiredFreeBytes: requiredFreeBytes(inputPrimaryTotalBytes),
    });
    const observedAtMs = now();
    const evidence = options.workspaceProductPort.observeSpace({
      ...request,
      requiredBytes: request.requiredFreeBytes,
      observedAtMs,
    });
    const decision = buildWorkspaceAdmissionDecision({
      libraRunRef: {
        libraRunId: snapshot.run.libraRunId,
        stateRevision: snapshot.run.stateRevision,
        stateDigest: snapshot.run.stateDigest,
        executionBasisDigest: snapshot.run.executionBasisDigest,
      },
      workspaceId: id,
      platformWorkspaceRootSnapshot: root,
      spaceAdmissionEvidence: evidence,
    });
    workspaceAdmission.admit({
      decision,
      commitMarker: stable('movie-workspace-admission-marker-', {
        workspaceId: id,
        decisionDigest: decision.decisionDigest,
      }),
      resultId: stable('movie-workspace-admission-result-', {
        workspaceId: id,
        decisionDigest: decision.decisionDigest,
      }),
    });
    workspace = reader.readWorkspace(id);
    if (!workspace) fail('P14_MOVIE_WORKSPACE_MISSING',
      'Admitted Workspace cannot be reconstructed.');
    return workspace;
  }

  function stageArtifact(
    run,
    workspace,
    materialized,
    role,
    requirement,
    verification,
  ) {
    const episodeClaims = Object.freeze([]);
    let current = reader.readWorkspace(workspace.workspaceId);
    let reference = current.references.find((item) =>
      item.workspaceMaterialHandle.handleId ===
        materialized.workspaceMaterialHandle.handleId);
    if (!reference) {
      const attach = buildReferenceDecision({
        operation: 'attach_working',
        libraRunId: run.libraRunId,
        workspaceId: current.workspaceId,
        expectedWorkspaceRevision: current.currentRevision,
        expectedWorkspaceStateDigest: current.stateDigest,
        expectedReference: {
          state: 'absent',
          revision: 0,
          digest: absentReferenceDigest(
            current.workspaceId,
            materialized.workspaceMaterialHandle.handleId,
          ),
        },
        workspaceMaterialHandle: materialized.workspaceMaterialHandle,
        episodeClaims,
        episodeScopeDigest: episodeScopeDigest(episodeClaims),
        productVerificationRef: null,
      });
      referenceStore.commit({
        decision: attach,
        commitMarker: stable('movie-workspace-reference-marker-', {
          operation: attach.operation,
          decisionDigest: attach.decisionDigest,
        }),
        resultId: stable('movie-workspace-reference-result-', {
          operation: attach.operation,
          decisionDigest: attach.decisionDigest,
        }),
      });
      current = reader.readWorkspace(workspace.workspaceId);
      reference = current.references.find((item) =>
        item.workspaceMaterialHandle.handleId ===
          materialized.workspaceMaterialHandle.handleId);
    }
    if (reference.state === 'working') {
      const snapshot = artifactVerificationSnapshot(
        run.libraRunId,
        role,
        materialized.workspaceMaterialHandle,
        materialized.artifactHandle,
        requirement,
        verification,
      );
      const promote = buildReferenceDecision({
        operation: 'promote_to_product_staging',
        libraRunId: run.libraRunId,
        workspaceId: current.workspaceId,
        expectedWorkspaceRevision: current.currentRevision,
        expectedWorkspaceStateDigest: current.stateDigest,
        expectedReference: {
          state: 'present',
          revision: reference.referenceRevision,
          digest: reference.referenceDigest,
        },
        workspaceMaterialHandle: materialized.workspaceMaterialHandle,
        episodeClaims,
        episodeScopeDigest: episodeScopeDigest(episodeClaims),
        productVerificationRef: snapshot,
      });
      referenceStore.commit({
        decision: promote,
        commitMarker: stable('movie-workspace-reference-marker-', {
          operation: promote.operation,
          decisionDigest: promote.decisionDigest,
        }),
        resultId: stable('movie-workspace-reference-result-', {
          operation: promote.operation,
          decisionDigest: promote.decisionDigest,
        }),
      });
      current = reader.readWorkspace(workspace.workspaceId);
      reference = current.references.find((item) =>
        item.workspaceMaterialHandle.handleId ===
          materialized.workspaceMaterialHandle.handleId);
    }
    if (!reference || reference.state !== 'product_staging' ||
        reference.productVerificationRef?.materialRole !== role) {
      fail('P14_MOVIE_ARTIFACT_NOT_STAGED',
        'Workspace Artifact did not reach exact Product Staging.', {
          role,
          referenceId: reference?.referenceId || null,
          referenceState: reference?.state || null,
          verificationKind:
            reference?.productVerificationRef?.verificationKind || null,
          verificationMaterialRole:
            reference?.productVerificationRef?.materialRole || null,
        });
    }
    return Object.freeze({ workspace:current, reference });
  }

  function ensureWorkingArtifact(run, workspace, artifactHandle) {
    const materialized =
      options.workspaceProductPort.readMaterializedArtifact(artifactHandle);
    let current = reader.readWorkspace(workspace.workspaceId);
    let reference = current.references.find((item) =>
      item.workspaceMaterialHandle.handleId ===
        materialized.workspaceMaterialHandle.handleId);
    if (!reference) {
      const episodeClaims = Object.freeze([]);
      const attach = buildReferenceDecision({
        operation: 'attach_working',
        libraRunId: run.libraRunId,
        workspaceId: current.workspaceId,
        expectedWorkspaceRevision: current.currentRevision,
        expectedWorkspaceStateDigest: current.stateDigest,
        expectedReference: {
          state: 'absent',
          revision: 0,
          digest: absentReferenceDigest(
            current.workspaceId,
            materialized.workspaceMaterialHandle.handleId,
          ),
        },
        workspaceMaterialHandle: materialized.workspaceMaterialHandle,
        episodeClaims,
        episodeScopeDigest: episodeScopeDigest(episodeClaims),
        productVerificationRef: null,
      });
      referenceStore.commit({
        decision: attach,
        commitMarker: stable('western-workspace-reference-marker-', {
          operation: attach.operation,
          decisionDigest: attach.decisionDigest,
        }),
        resultId: stable('western-workspace-reference-result-', {
          operation: attach.operation,
          decisionDigest: attach.decisionDigest,
        }),
      });
      current = reader.readWorkspace(workspace.workspaceId);
      reference = current.references.find((item) =>
        item.workspaceMaterialHandle.handleId ===
          materialized.workspaceMaterialHandle.handleId);
    }
    if (!reference || !['working', 'product_staging'].includes(reference.state)) {
      fail('P14_WESTERN_WORKSPACE_REFERENCE_INVALID',
        'Western Artifact does not have one exact Workspace reference.');
    }
    return Object.freeze({ workspace:current, reference, materialized });
  }

  async function prepareWesternProduct(snapshot, mediaProducts,
    productionTimeMs) {
    if (!options.westernAnalysisPort ||
        typeof options.westernAnalysisPort.configuration !== 'function' ||
        !options.personReferenceProjectionFacade ||
        typeof options.personReferenceProjectionFacade
          .listPersonReferenceProjections !== 'function') {
      return Object.freeze({
        ready: false,
        stage: 'western_analysis_unavailable',
        reasonCode: 'service_local_analysis_not_configured',
      });
    }
    const run = snapshot.run;
    const libraRunId = run.libraRunId;
    const workspace = ensureWorkspace(snapshot);
    const workspacePhaseRevision = (revision, phase) => {
      const historical = reader.readWorkspaceRevision(
        workspace.workspaceId,
        revision,
      );
      if (!historical ||
          historical.libraRunId !== libraRunId ||
          historical.state !== 'active' ||
          historical.workspaceScopeDigest !==
            workspace.workspaceScopeDigest ||
          historical.rootSnapshotDigest !== workspace.rootSnapshotDigest) {
        fail('P14_WESTERN_WORKSPACE_PHASE_REVISION',
          'Western phase cannot reconstruct its exact Workspace fence.', {
            phase,
            workspaceId: workspace.workspaceId,
            expectedRevision: revision,
          });
      }
      return historical;
    };
    const source = mediaProducts[0].readHandle;
    const configuration = options.westernAnalysisPort.configuration();
    const durationMs = mediaProducts[0].probe.durationMs;
    const maxFrames = Math.max(1, Math.min(
      1024,
      Math.ceil(durationMs / 10_000),
    ));
    const intervalMs = Math.max(
      1,
      Math.min(86_400_000, Math.ceil(durationMs / maxFrames)),
    );
    const samplingBasis = {
      contractId: canonicalDigest({
        schema: 'libra.western-sampling-plan-id@1',
        libraRunId,
        runExecutionBasisDigest: run.executionBasisDigest,
        sourceMaterialDigest: canonicalDigest(source),
        intervalMs,
        maxFrames,
      }),
      revision: 1,
      schemaRef: 'helix://contracts/domain-types/SamplingPlan/v1',
      intervalMs,
      maxFrames,
      frameProfileDigest: canonicalDigest({
        schema: 'libra.western-frame-profile@1',
        pixelFormat: 'rgb24',
        maxLongEdge: 1280,
        outputKind: 'western_frame_set',
      }),
      typedParameters: Object.freeze([]),
    };
    const samplingPlan = scalarContract(samplingBasis);
    const phase = async (value) => {
      const planInput = westernPhasePlanBinding(
        run,
        value.phase,
        value.capabilityRef,
        value.capabilityInput,
        value.upstreamChains,
      );
      return runResultCapability(run, {
        workKind: 'western_' + value.phase,
        objectiveRef: 'helix://libra/work/WesternAnalysis/' +
          value.phase + '/v1',
        nodeId: 'western-' + value.phase.replaceAll('_', '-'),
        capabilityRef: value.capabilityRef,
        effectClass: value.effectClass,
        inputSchemaRef: WESTERN_PHASE_PLAN_BINDING_SCHEMA,
        input: value.capabilityInput,
        planInput,
        parametersSchemaRef:
          'helix://contracts/capabilities/' +
          value.capabilityRef.replaceAll('.', '/').replace('@1', '/v1') +
          '/parameters',
        fenceSchemaRef:
          'helix://contracts/capabilities/' +
          value.capabilityRef.replaceAll('.', '/').replace('@1', '/v1') +
          '/fence',
        resourceDemandSchemaRef:
          'helix://contracts/capabilities/' +
          value.capabilityRef.replaceAll('.', '/').replace('@1', '/v1') +
          '/resource-demand',
        resourceKinds: value.resourceKinds,
        resultSchemaRef: value.resultSchemaRef,
        execute: value.execute,
        evidenceDigest: value.evidenceDigest,
      });
    };

    let currentWorkspace = reader.readWorkspace(workspace.workspaceId);
    const rootSnapshot = options.workspaceProductPort.rootSnapshot();
    const frameSourceDigest = canonicalDigest({
      sourceHandle: source,
      samplingPlan,
    });
    const frameTarget = workspaceArtifactTarget(
      run,
      workspacePhaseRevision(1, 'frames'),
      rootSnapshot,
      {
        targetRelativePath: 'analysis/frames/' +
          frameSourceDigest + '.json',
        outputKind: 'frame_set',
        sourceInputDigest: frameSourceDigest,
      },
    );
    const frameInput = Object.freeze({
      physicalMaterialReadHandleOrWorkspaceMaterialHandle: source,
      samplingPlan,
      workspaceArtifactOutputTarget: frameTarget,
    });
    const frameChain = await phase({
      phase: 'frames',
      capabilityRef: 'libra.media.frames.extract@1',
      effectClass: 'workspace_write',
      capabilityInput: frameInput,
      upstreamChains: [],
      resourceKinds: ['disk_io', 'compute'],
      resultSchemaRef: 'helix://contracts/types/FrameArtifactSet/v1',
      execute: () => options.westernAnalysisPort.extractFrames({
        sourceHandle: source,
        samplingPlan,
        outputTarget: frameTarget,
      }),
    });
    currentWorkspace = ensureWorkingArtifact(
      run,
      currentWorkspace,
      frameChain.result.frameSetArtifactHandle,
    ).workspace;

    const embeddingInput = Object.freeze({
      artifactHandleList: Object.freeze([
        frameChain.result.frameSetArtifactHandle,
      ]),
      faceModelRef: configuration.faceModelRef,
    });
    const embeddingChain = await phase({
      phase: 'embedding',
      capabilityRef: 'shared.face.embedding.compute@1',
      effectClass: 'workspace_write',
      capabilityInput: embeddingInput,
      upstreamChains: [frameChain],
      resourceKinds: ['compute', 'disk_io'],
      resultSchemaRef:
        'helix://contracts/types/FaceEmbeddingSetHandle/v1',
      execute: () => options.westernAnalysisPort.computeEmbeddings({
        frameArtifactSet: frameChain.result,
        faceModelRef: configuration.faceModelRef,
      }),
    });
    currentWorkspace = ensureWorkingArtifact(
      run,
      currentWorkspace,
      embeddingChain.result.artifactHandle,
    ).workspace;

    const clusterInput = Object.freeze({
      faceEmbeddingSetHandle: embeddingChain.result,
      clusterParameters: configuration.clusterParameters,
    });
    const clusterChain = await phase({
      phase: 'cluster',
      capabilityRef: 'shared.face.cluster.compute@1',
      effectClass: 'workspace_write',
      capabilityInput: clusterInput,
      upstreamChains: [embeddingChain],
      resourceKinds: ['compute', 'disk_io'],
      resultSchemaRef:
        'helix://contracts/types/FaceClusterSetHandle/v1',
      execute: () => options.westernAnalysisPort.computeClusters(
        clusterInput,
      ),
    });
    currentWorkspace = ensureWorkingArtifact(
      run,
      currentWorkspace,
      clusterChain.result.artifactHandle,
    ).workspace;

    const outputContractDigest = canonicalDigest({
      schemaRef: 'helix://contracts/types/WesternAnalysisResult/v1',
      schemaVersion: 1,
    });
    const analysisSpecBasis = {
      specId: canonicalDigest({
        schema: 'libra.western-analysis-spec-id@1',
        libraRunId,
        runExecutionBasisDigest: run.executionBasisDigest,
        sourceMaterialDigest: canonicalDigest(source),
        frameArtifactSetDigest: frameChain.result.manifestDigest,
        faceModelRefDigest: configuration.faceModelRef.digest,
        clusterParameterDigest: configuration.clusterParameters.digest,
        analysisVariantRef: 'shelfdeck.western-analysis@1',
        outputContractDigest,
      }),
      revision: 1,
      schemaRef: 'helix://contracts/domain-types/AnalysisSpec/v1',
      libraRunId,
      runExecutionBasisDigest: run.executionBasisDigest,
      contentProfile: 'western_adult',
      sourceMaterialDigest: canonicalDigest(source),
      frameArtifactSetDigest: frameChain.result.manifestDigest,
      faceModelRefDigest: configuration.faceModelRef.digest,
      clusterParameterDigest: configuration.clusterParameters.digest,
      analysisVariantRef: 'shelfdeck.western-analysis@1',
      outputContractRef:
        'helix://contracts/types/WesternAnalysisResult/v1',
      outputContractDigest,
      typedParameters: Object.freeze([]),
    };
    const analysisSpec = scalarContract(analysisSpecBasis, 'specDigest');
    const analysisSourceDigest = canonicalDigest({
      frameArtifactSet: frameChain.result,
      faceEmbeddingSetHandle: embeddingChain.result,
      faceClusterSetHandle: clusterChain.result,
      analysisSpec,
    });
    const analysisTarget = workspaceArtifactTarget(
      run,
      workspacePhaseRevision(4, 'analysis_request'),
      rootSnapshot,
      {
        targetRelativePath: 'analysis/results/' +
          analysisSourceDigest + '.json',
        outputKind: 'western_analysis',
        sourceInputDigest: analysisSourceDigest,
      },
    );
    const requestInput = Object.freeze({
      frameArtifactSet: frameChain.result,
      faceEmbeddingSetHandle: embeddingChain.result,
      faceClusterSetHandle: clusterChain.result,
      analysisSpec,
      workspaceArtifactOutputTarget: analysisTarget,
    });
    const analysisRequestChain = await phase({
      phase: 'analysis_request',
      capabilityRef: 'libra.western.analysis.request@1',
      effectClass: 'workspace_write',
      capabilityInput: requestInput,
      upstreamChains: [frameChain, embeddingChain, clusterChain],
      resourceKinds: ['compute', 'disk_io'],
      resultSchemaRef: 'helix://contracts/types/ArtifactHandle/v1',
      execute: () => options.westernAnalysisPort.requestAnalysis({
        frameArtifactSet: frameChain.result,
        faceEmbeddingSetHandle: embeddingChain.result,
        faceClusterSetHandle: clusterChain.result,
        analysisSpec,
        outputTarget: analysisTarget,
      }),
    });
    currentWorkspace = ensureWorkingArtifact(
      run,
      currentWorkspace,
      analysisRequestChain.result,
    ).workspace;

    const observeInput = Object.freeze({
      frameArtifactSet: frameChain.result,
      faceEmbeddingSetHandle: embeddingChain.result,
      faceClusterSetHandle: clusterChain.result,
      analysisSpec,
      artifactHandle: analysisRequestChain.result,
    });
    const analysisChain = await phase({
      phase: 'analysis_observe',
      capabilityRef: 'libra.western.analysis.observe@1',
      effectClass: 'pure_observation',
      capabilityInput: observeInput,
      upstreamChains: [
        frameChain,
        embeddingChain,
        clusterChain,
        analysisRequestChain,
      ],
      resourceKinds: ['disk_io'],
      resultSchemaRef:
        'helix://contracts/types/WesternAnalysisResult/v1',
      execute: () => options.westernAnalysisPort.observeAnalysis(
        observeInput,
      ),
      evidenceDigest: (result) => result.payloadDigest,
    });

    const projections = await options.personReferenceProjectionFacade
      .listPersonReferenceProjections(Object.freeze({ limit:256 }));
    const projectionList = Object.freeze([...(projections || [])].sort(
      (left, right) =>
        Buffer.compare(Buffer.from(left.personId), Buffer.from(right.personId)),
    ));
    const matchInput = Object.freeze({
      faceClusterSetHandle: clusterChain.result,
      personReferenceProjectionList: projectionList,
    });
    const matchChain = await phase({
      phase: 'reference_match',
      capabilityRef: 'shared.face.reference.match@1',
      effectClass: 'pure_observation',
      capabilityInput: matchInput,
      upstreamChains: [clusterChain],
      resourceKinds: ['compute'],
      resultSchemaRef:
        'helix://contracts/types/PersonMatchEvidence/v1',
      execute: () => options.westernAnalysisPort.matchReferences(matchInput),
      evidenceDigest: (result) => result.payloadDigest,
    });

    const analysisPayload =
      options.westernAnalysisPort.readAnalysisPayload(
        analysisChain.result,
      );
    const internalIdentity = providerIdentity({
      provider: 'internal',
      namespace: 'internal_identity',
      providerKey: analysisPayload.identityAnchor,
      seasonNumber: null,
    });
    const preliminaryIdentity = buildResolvedProductIdentity({
      producerRef: 'libra.western.analysis.observe@1',
      basisDigest: analysisChain.result.payloadDigest,
      observedAtMs: productionTimeMs,
      subjectId: run.subjectId,
      structureKind: snapshot.spec.structureKind,
      contentProfile: 'western_adult',
      identityKind: 'internal_identity',
      providerIdentities: [internalIdentity],
      exactSeasonContinuityClaims: [],
      displayEntries: [{
        key: 'internal_identity',
        value: analysisPayload.identityAnchor,
      }],
    });
    const variant = westernAnalysisVariant(
      run,
      preliminaryIdentity.identityDigest,
      [analysisChain],
    );
    const requirements = snapshot.spec.requirements.metadata
      .requiredArtifactKinds.map(artifactRequirement);
    const requestedFields = [...snapshot.spec.requirements.metadata
      .requiredFieldCodes].sort((left, right) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right)));
    const fieldProvenance = analysisPayload.descriptiveFacts.map((item) => ({
      fieldPath: item.key,
      sourceKind: 'western_analysis',
      sourceRef:
        analysisChain.result.resultArtifactHandle.artifactHandleId,
      evidenceDigest: analysisChain.result.payloadDigest,
    })).sort((left, right) =>
      Buffer.compare(Buffer.from(left.fieldPath), Buffer.from(right.fieldPath)));
    const normalizeInput = Object.freeze({
      westernAnalysisVariant: variant,
    });
    const normalizeChain = await phase({
      phase: 'metadata_normalize',
      capabilityRef: 'libra.western.metadata.normalize@1',
      effectClass: 'pure_observation',
      capabilityInput: normalizeInput,
      upstreamChains: [analysisChain],
      resourceKinds: ['compute'],
      resultSchemaRef:
        'helix://contracts/types/ProductMetadataDraft/v1',
      execute() {
        const result = buildWesternProductMetadataDraft({
          analysisVariant: variant,
          requiredFields: requestedFields,
          producedAtMs: productionTimeMs,
          descriptiveFacts: analysisPayload.descriptiveFacts,
          fieldProvenance,
          providerIdentities: [],
          artifactRequirements: requirements,
        });
        if (!result.ready) {
          fail('P14_WESTERN_METADATA_UNRESOLVED',
            'Western Analysis did not satisfy Product Metadata requirements.',
            { missingFields:result.missingFields });
        }
        return result.draft;
      },
    });
    const metadataBasis = westernMetadataBasis(
      run,
      preliminaryIdentity.identityDigest,
      [analysisChain],
      normalizeChain,
      variant,
    );
    const resolvedIdentity = buildResolvedProductIdentity({
      producerRef: 'libra.western.analysis.observe@1',
      basisDigest: metadataBasis.sourceBasisDigest,
      observedAtMs: productionTimeMs,
      subjectId: run.subjectId,
      structureKind: snapshot.spec.structureKind,
      contentProfile: 'western_adult',
      identityKind: 'internal_identity',
      providerIdentities: [internalIdentity],
      exactSeasonContinuityClaims: [],
      displayEntries: [{
        key: 'internal_identity',
        value: analysisPayload.identityAnchor,
      }],
    });
    const sourceChains = [analysisChain, normalizeChain];
    const identityFact = commitFact(
      run,
      'resolved_identity',
      metadataBasis,
      {
        schema: 'libra.resolved-product-identity-commit-payload@1',
        resolvedProductIdentity: resolvedIdentity,
        productMetadataDraft: normalizeChain.result,
      },
      sourceChains,
    );

    const castBasis = westernMatchBasis(
      run,
      resolvedIdentity.identityDigest,
      matchChain,
    );
    const relations = matchChain.result.matches.map((item) => ({
      relationId: stable('western-cast-relation-', {
        subjectId: run.subjectId,
        clusterId: item.clusterId,
        personId: item.personId,
      }),
      personId: item.personId,
      displayName: item.personId,
      displayNameNormalized: item.personId.normalize('NFKC').toLowerCase(),
      role: 'actor',
      source: 'face_reference_match',
      providerIdentities: [],
      originEvidenceDigest: item.evidenceDigest,
      confidenceClass: item.confidenceClass,
      relationDigest: '',
    })).map((item) => Object.freeze({
      ...item,
      relationDigest: canonicalDigest(Object.fromEntries(
        Object.entries(item).filter(([key]) => key !== 'relationDigest'),
      )),
    })).sort((left, right) =>
      Buffer.compare(Buffer.from(left.role), Buffer.from(right.role)) ||
      Buffer.compare(
        Buffer.from(left.displayNameNormalized),
        Buffer.from(right.displayNameNormalized),
      ) ||
      Buffer.compare(Buffer.from(left.relationId), Buffer.from(right.relationId)));
    const castResolveInput = Object.freeze({
      libraMediaCastSourceBasisMetadataObservationOrWesternMatch: castBasis,
      personReferenceProjectionList: projectionList,
    });
    const castDraftChain = await phase({
      phase: 'media_cast_resolve',
      capabilityRef: 'libra.media_cast.resolve@1',
      effectClass: 'pure_observation',
      capabilityInput: castResolveInput,
      upstreamChains: [matchChain],
      resourceKinds: ['compute'],
      resultSchemaRef:
        'helix://contracts/types/MediaCastDraft/v1',
      execute: () => buildMediaCastDraft({
        subjectId: run.subjectId,
        sourceBasis: castBasis,
        relations,
        personProjection: Object.freeze({
          items: projectionList,
        }),
        producedAtMs: productionTimeMs,
      }),
    });
    const castFact = commitFact(run, 'media_cast', castBasis, {
      schema: 'libra.media-cast-fact-commit-payload@1',
      mediaCastDraft: castDraftChain.result,
    }, [matchChain]);

    const materials = [];
    const artifactChains = [];
    for (const [ordinal, kind] of snapshot.spec.requirements.metadata
      .requiredArtifactKinds.entries()) {
      const requirement = requirements.find((item) =>
        item.artifactKind === kind);
      const role = kind === 'nfo' ? 'metadata_sidecar' : kind;
      let artifactChain;
      if (kind === 'nfo') {
        const relativePath = 'product/movie.nfo';
        const sidecarBasis = {
          schemaRef:
            'helix://contracts/domain-types/SidecarProfile/v1',
          schemaVersion: 1,
          profileId: 'helix-sidecar-western-adult-nfo',
          revision: 1,
          format: 'nfo_xml',
          fileNamePolicyDigest: canonicalDigest({
            schema: 'libra.product-sidecar-filename-policy@1',
            contentProfile: 'western_adult',
            relativePath,
          }),
          contentSchemaRef:
            'helix://contracts/records/descriptive-facts/v1',
          typedParameters: Object.freeze([]),
        };
        const sidecarProfile = Object.freeze({
          ...sidecarBasis,
          digest: canonicalDigest(sidecarBasis),
        });
        const capabilityInput = Object.freeze({
          productMetadataDraft: normalizeChain.result,
          sidecarProfile,
        });
        artifactChain = await phase({
          phase: 'sidecar_render',
          capabilityRef: 'libra.product_sidecar.render@1',
          effectClass: 'workspace_write',
          capabilityInput,
          upstreamChains: [normalizeChain],
          resourceKinds: ['disk_io'],
          resultSchemaRef: 'helix://contracts/types/ArtifactHandle/v1',
          execute: () => options.productionPort.renderProductSidecar({
            ...capabilityInput,
            libraRunId,
            workspaceId: workspace.workspaceId,
            relativePath,
            contentProfile: 'western_adult',
          }),
        });
      } else if (kind === 'poster') {
        const capabilityInput = Object.freeze({
          personMatchEvidence: matchChain.result,
          frameArtifactSet: frameChain.result,
        });
        artifactChain = await phase({
          phase: 'poster_render',
          capabilityRef: 'libra.western.poster.render@1',
          effectClass: 'workspace_write',
          capabilityInput,
          upstreamChains: [frameChain, matchChain],
          resourceKinds: ['compute', 'disk_io'],
          resultSchemaRef: 'helix://contracts/types/ArtifactHandle/v1',
          execute: () => options.westernAnalysisPort.renderPoster({
            ...capabilityInput,
            relativePath: 'product/poster.jpg',
          }),
        });
      } else {
        fail('P14_WESTERN_ARTIFACT_KIND_UNSUPPORTED',
          'Western Product requested an unsupported Artifact kind.', {
            artifactKind: kind,
          });
      }
      const materialized =
        options.workspaceProductPort.readMaterializedArtifact(
          artifactChain.result,
        );
      const verification = buildArtifactManifestVerification({
        requirement,
        artifactHandles: [materialized.artifactHandle],
        verifiedAtMs: productionTimeMs,
      });
      const verificationInput = Object.freeze({
        artifactHandleList: Object.freeze([materialized.artifactHandle]),
        artifactRequirement: requirement,
      });
      const verificationChain = await phase({
        phase: 'artifact_verify_' + kind,
        capabilityRef: 'shared.artifact.manifest.verify@1',
        effectClass: 'pure_observation',
        capabilityInput: verificationInput,
        upstreamChains: [artifactChain],
        resourceKinds: ['disk_io'],
        resultSchemaRef: ARTIFACT_VERIFICATION_SCHEMA,
        execute: () => verification,
        evidenceDigest: verification.verificationDigest,
      });
      const staged = stageArtifact(
        run,
        workspace,
        materialized,
        role,
        requirement,
        verification,
      );
      materials.push(Object.freeze({
        ordinal,
        kind,
        role,
        requirement,
        materialized,
        verification,
        reference: staged.reference,
      }));
      artifactChains.push(verificationChain);
    }
    const verifiedItems = materials.map((item, ordinal) =>
      verifiedArtifactItem(
        ordinal,
        item.materialized.artifactHandle,
        item.requirement,
        item.verification,
        artifactChains[ordinal],
      ));
    const artifactSetDigest = canonicalDigest({
      schema: 'libra.verified-artifact-set@1',
      items: verifiedItems,
    });
    const verifiedArtifactManifest = {
      manifestId: canonicalDigest({
        schema: 'libra.verified-artifact-manifest-id@1',
        libraRunId,
        artifactSetDigest,
      }),
      libraRunId,
      items: verifiedItems,
      artifactSetDigest,
    };
    verifiedArtifactManifest.manifestDigest =
      canonicalDigest(verifiedArtifactManifest);
    const metadataFact = commitFact(run, 'product_metadata', metadataBasis, {
      schema: 'libra.product-metadata-fact-commit-payload@1',
      productMetadataDraft: normalizeChain.result,
      verifiedArtifactManifest,
      mediaCastFactRef: {
        productFactId: castFact.productFactId,
        factRevision: castFact.factRevision,
        factDigest: castFact.factDigest,
      },
    }, sourceChains);
    return Object.freeze({
      ready: true,
      identityFact,
      workspace,
      materials: Object.freeze(materials),
      artifactChains: Object.freeze(artifactChains),
      verifiedItems: Object.freeze(verifiedItems),
      verifiedArtifactManifest: Object.freeze(verifiedArtifactManifest),
      castFact,
      metadataFact,
      results: Object.freeze([
        frameChain,
        embeddingChain,
        clusterChain,
        analysisRequestChain,
        analysisChain,
        matchChain,
        normalizeChain,
        castDraftChain,
      ]),
    });
  }

  async function advance(libraRunId) {
    const snapshot = reader.readRun(libraRunId);
    const productionTimeMs = snapshot.run.createdAtMs;
    const contentProfile = snapshot.spec.contentProfile;
    const structureKind = snapshot.spec.structureKind;
    const isSeries = contentProfile === 'series';
    const isJav = contentProfile === 'jav';
    const isWestern = contentProfile === 'western_adult';
    const productEpisodeClaims = snapshot.episodeClaims;
    if (snapshot.run.packageRevisionHead > 0) {
      const published = reader.readPublishedDeliveryRef(
        libraRunId,
        snapshot.run.packageRevisionHead,
      );
      if (!published) {
        fail('P14_MOVIE_PACKAGE_REPLAY_MISSING',
          'Run Package head does not resolve to its exact immutable Product Delivery.');
      }
      const delivery = deliveryReader.readPackage({
        queryContract: 'libra.product-delivery@1',
        readPurpose: 'historical',
        offerId: published.offerId,
        onDeckPackageId: published.onDeckPackageId,
        expectedPackageRevision: published.packageRevision,
        expectedPackageDigest: published.packageDigest,
      });
      if (delivery.resultKind !== 'found') {
        fail('P14_MOVIE_PACKAGE_REPLAY_MISSING',
          'Immutable Product Delivery cannot be reconstructed on replay.');
      }
      return Object.freeze({
        stage: 'handoff_b_offer_open',
        replayed: true,
        contentProfile:
          delivery.onDeckProductPackage.productStructureSnapshot.contentProfile,
        libraRunId,
        workspaceId: null,
        targetShelfId: published.shelfId,
        acceptanceSpecId: published.acceptanceSpecId,
        onDeckPackageId: published.onDeckPackageId,
        packageRevision: published.packageRevision,
        packageDigest: published.packageDigest,
        offerId: published.offerId,
        offerMessage: productOfferMessage({
          ...published,
          subjectId:
            delivery.onDeckProductPackage.subjectId,
        }),
        productDelivery: delivery,
      });
    }
    const nfoReferences = snapshot.relatedReferences
      .filter((item) => item.role === 'nfo');
    if (!isJav && !isWestern && !nfoReferences.length) {
      return Object.freeze({
        stage: 'product_metadata_unresolved',
        libraRunId,
        reasonCode: 'related_nfo_unavailable',
      });
    }
    const mediaRequirement = buildMediaRequirement(snapshot.spec);
    const mediaProducts = [];
    for (const member of snapshot.members) {
      const readHandle = options.productionPort.issuePhysicalReadHandle({
        libraRunId,
        runExecutionBasisDigest: snapshot.run.executionBasisDigest,
        runCreatedAtMs: snapshot.run.createdAtMs,
        physicalIdentity: member.physicalIdentity,
        sizeBytes: member.sizeBytes,
        endpointId: member.endpointId,
        location: member.location,
        bindingRevision: member.bindingRevision,
        mountScopeRevision: 1,
      });
      const probe = mediaProbeEvidence(
        await options.productionPort.probe(readHandle),
        readHandle,
        productionTimeMs,
      );
      const mediaInput = buildProductMediaCandidateInput({
        candidateNodeId: snapshot.members.length === 1
          ? 'direct-original'
          : 'direct-original-' + member.ordinal,
        libraRunId,
        mediaRequirement,
        candidateKind: 'direct_input',
        sourceMaterialHandle: readHandle,
        sourceProbeEvidence: probe,
      });
      const verification = buildProductMediaVerification({
        input: mediaInput,
        verifiedAtMs: productionTimeMs,
      });
      const selectionInput = buildProductOutputSelectionInput({
        libraRunId,
        acceptanceSpecId: snapshot.spec.acceptanceSpecId,
        acceptanceSpecRecordDigest: snapshot.spec.recordDigest,
        mediaRequirementDigest: mediaRequirement.requirementDigest,
        rankedCandidates: [{
          rank: 1,
          candidateId: mediaInput.candidateId,
          candidateNodeId: mediaInput.candidateNodeId,
        }],
        candidates: [verification],
      });
      const selected = selectProductOutput({
        input: selectionInput,
        producedAtMs: productionTimeMs,
      });
      mediaProducts.push(Object.freeze({
        member,
        readHandle,
        probe,
        verification,
        selected,
      }));
    }
    const unresolvedMedia = mediaProducts.find((item) =>
      item.selected.result !== 'selected');
    if (unresolvedMedia) {
      return Object.freeze({
        stage: 'product_media_unresolved',
        libraRunId,
        materialKey: unresolvedMedia.member.materialKey,
        reasonCodes: unresolvedMedia.verification.reasonCodes,
      });
    }
    let identityFact;
    let workspace;
    let materials;
    let artifactChains;
    let verifiedItems;
    let verifiedArtifactManifest;
    let castFact;
    let metadataFact;
    let results;
    if (isWestern) {
      const western = await prepareWesternProduct(
        snapshot,
        mediaProducts,
        productionTimeMs,
      );
      if (!western.ready) {
        return Object.freeze({
          ...western,
          libraRunId,
        });
      }
      ({
        identityFact,
        workspace,
        materials,
        artifactChains,
        verifiedItems,
        verifiedArtifactManifest,
        castFact,
        metadataFact,
        results,
      } = western);
    } else {
    const relatedNfos = isJav
      ? []
      : nfoReferences.map((reference) => Object.freeze({
        reference,
        value: options.productionPort.readRelatedNfo({
          primaryMaterialKey: reference.primaryMaterialKey,
          reference,
        }),
      }));
    const title = relatedNfos.flatMap((item) => item.value.entries)
      .find((item) => ['series_title', 'title'].includes(item.key))?.value;
    const javCode = isJav ? snapshot.candidateIdentityClaim?.javCode : null;
    if (isJav &&
        (snapshot.candidateIdentityClaim?.claimKind !== 'jav_code' ||
          typeof javCode !== 'string' || !javCode)) {
      return Object.freeze({
        stage: 'product_identity_unresolved',
        libraRunId,
        reasonCode: 'jav_provider_query_evidence_unavailable',
      });
    }
    if (!isJav && !title) {
      return Object.freeze({
        stage: 'product_identity_unresolved',
        libraRunId,
        reasonCode: 'title_identity_evidence_unavailable',
      });
    }
    const providerSearch = await options.productionPort.searchProviderIdentity({
      operationId: 'shared.integration.search@1',
      contentProfile,
      ...(isJav ? { javCode } : { title }),
      candidateDeliverySnapshotDigest:
        snapshot.members[0].originCandidateDeliveryRef
          .candidateDeliverySnapshotDigest,
    });
    const identity = buildResolvedProductIdentity({
      producerRef: 'shared.integration.search@1',
      basisDigest: canonicalDigest({
        schema: 'libra.product-provider-identity-basis@1',
        contentProfile,
        ...(isJav ? { javCode } : { title }),
        candidateDeliverySnapshotDigest:
          snapshot.members[0].originCandidateDeliveryRef
            .candidateDeliverySnapshotDigest,
        provider: providerSearch.provider,
        namespace: providerSearch.namespace,
        providerKey: providerSearch.providerKey,
        seasonNumber: providerSearch.seasonNumber,
      }),
      observedAtMs: productionTimeMs,
      subjectId: snapshot.run.subjectId,
      structureKind,
      contentProfile,
      identityKind: isSeries
        ? 'tmdb_series_season'
        : isJav
          ? 'jav_code'
          : 'tmdb_movie',
      providerIdentities: [providerSearch],
      exactSeasonContinuityClaims: [],
      displayEntries: [isJav
        ? { key:'jav_code', value:providerSearch.providerKey }
        : { key:'title', value:title }],
    });
    const requestedFields = [...snapshot.spec.requirements.metadata.requiredFieldCodes]
      .filter((item) => item !== 'actor')
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    const nfoSources = await Promise.all(relatedNfos.map(async (item, ordinal) => {
      const intent = buildMetadataFetchIntent({
        libraRunId,
        runExecutionBasisDigest: snapshot.run.executionBasisDigest,
        sourceKind: 'related_nfo',
        sourcePriority: ordinal,
        contentProfile,
        resolvedIdentityDigest: identity.identityDigest,
        requestedFields,
        relatedReferenceId: item.reference.referenceId,
        relatedReferenceDigest: item.reference.referenceDigest,
        expectedChecksum: item.reference.checksumHex,
      });
      const observation = metadataObservation(intent, {
        entries: item.value.entries,
        providerIdentities: [],
        peopleHints: [],
        artifactHints: [],
      }, productionTimeMs);
      const chain = await runResultCapability(snapshot.run, {
        workKind: 'product_metadata_observation',
        objectiveRef: 'helix://libra/work/ProductMetadataObservation/v1',
        nodeId: 'related-nfo-metadata-fetch-' + ordinal,
        capabilityRef: 'libra.product_metadata.fetch@1',
        effectClass: 'pure_observation',
        inputSchemaRef:
          'helix://contracts/capabilities/libra.product_metadata.fetch/v1/inputs',
        input: intent,
        parametersSchemaRef:
          'helix://contracts/capabilities/libra.product_metadata.fetch/v1/parameters',
        fenceSchemaRef:
          'helix://contracts/capabilities/libra.product_metadata.fetch/v1/fence',
        resourceDemandSchemaRef:
          'helix://contracts/capabilities/libra.product_metadata.fetch/v1/resource-demand',
        resultSchemaRef: METADATA_SCHEMA,
        result: observation,
        evidenceDigest: observation.payloadDigest,
      });
      return Object.freeze({ intent, observation, chain });
    }));
    const resolvedProviderIdentity = providerIdentity(providerSearch);
    const providerIntent = buildMetadataFetchIntent({
      libraRunId,
      runExecutionBasisDigest: snapshot.run.executionBasisDigest,
      sourceKind: 'provider',
      sourcePriority: nfoSources.length,
      contentProfile,
      resolvedIdentityDigest: identity.identityDigest,
      resolvedProviderIdentity,
      requestedFields,
      providerKind: isJav ? 'jav' : 'tmdb',
      integrationId: providerSearch.integrationId ||
        (isJav ? 'jav-main' : 'tmdb-main'),
      configRevision: providerSearch.configRevision || 1,
    });
    const metadataIntegrationHandle =
      options.productionPort.resolveIntegrationHandle({
        intent: providerIntent,
        operationId: 'libra.product_metadata.fetch@1',
      });
    const metadataCapabilityInput = Object.freeze({
      metadataFetchIntent: providerIntent,
      physicalMaterialReadHandleOrIntegrationHandle:
        metadataIntegrationHandle,
    });
    const providerChain = await runResultCapability(snapshot.run, {
      workKind: 'product_metadata_observation',
      objectiveRef: 'helix://libra/work/ProductMetadataObservation/v1',
      nodeId: 'provider-metadata-fetch',
      capabilityRef: 'libra.product_metadata.fetch@1',
      effectClass: 'pure_observation',
      inputSchemaRef:
        'helix://contracts/capabilities/libra.product_metadata.fetch/v1/inputs',
      input: metadataCapabilityInput,
      parametersSchemaRef:
        'helix://contracts/capabilities/libra.product_metadata.fetch/v1/parameters',
      fenceSchemaRef:
        'helix://contracts/capabilities/libra.product_metadata.fetch/v1/fence',
      resourceDemandSchemaRef:
        'helix://contracts/capabilities/libra.product_metadata.fetch/v1/resource-demand',
      resultSchemaRef: METADATA_SCHEMA,
      async execute() {
        const provider = await options.productionPort.fetchProvider(
          providerIntent,
          metadataIntegrationHandle,
        );
        return metadataObservation(providerIntent, {
          entries: provider.descriptiveEntries,
          providerIdentities: provider.providerIdentities,
          peopleHints: provider.peopleHints,
          artifactHints: [],
        }, productionTimeMs);
      },
      evidenceDigest: (result) => result.payloadDigest,
    });
    const providerObservation = providerChain.result;
    results = [...nfoSources.map((item) => item.chain), providerChain];
    const identityBasis = buildMetadataObservationBasis({
      intents: [...nfoSources.map((item) => item.intent), providerIntent],
      results,
      factKind: 'resolved_identity',
      expectedRevision: 0,
    });
    identityFact = commitFact(
      snapshot.run,
      'resolved_identity',
      identityBasis,
      {
        schema: 'libra.resolved-product-identity-commit-payload@1',
        resolvedProductIdentity: Object.freeze({
          ...identity,
          basisDigest: identityBasis.sourceBasisDigest,
          evidenceId: stable('movie-resolved-identity-evidence-', {
            subjectId: identity.subjectId,
            basisDigest: identityBasis.sourceBasisDigest,
            identityDigest: identity.identityDigest,
          }),
          payloadDigest: canonicalDigest({
            schema: 'libra.resolved-product-identity-evidence@1',
            subjectId: identity.subjectId,
            basisDigest: identityBasis.sourceBasisDigest,
            identityDigest: identity.identityDigest,
          }),
        }),
      },
      results,
    );
    workspace = ensureWorkspace(snapshot);
    const metadataBasis = buildMetadataObservationBasis({
      intents: [...nfoSources.map((item) => item.intent), providerIntent],
      results,
      factKind: 'product_metadata',
      expectedRevision: 0,
    });
    const requirements = snapshot.spec.requirements.metadata
      .requiredArtifactKinds.map(artifactRequirement);
    const metadataDraftResult = buildProductMetadataDraft({
      sourceBasis: metadataBasis,
      requiredFields: requestedFields,
      producedAtMs: productionTimeMs,
      providerIdentities: [resolvedProviderIdentity],
      artifactRequirements: requirements,
    });
    if (!metadataDraftResult.ready) {
      return Object.freeze({
        stage: 'product_metadata_unresolved',
        libraRunId,
        missingFields: metadataDraftResult.missingFields,
      });
    }
    materials = [];
    artifactChains = [];
    for (const [ordinal, kind] of snapshot.spec.requirements.metadata
      .requiredArtifactKinds.entries()) {
      const role = kind === 'nfo' ? 'metadata_sidecar' : kind;
      const requirement = requirements.find((item) => item.artifactKind === kind);
      const relativePath = 'product/' + (kind === 'nfo'
        ? (isSeries ? 'season.nfo' : 'movie.nfo')
        : kind + '.jpg');
      let artifactChain;
      if (kind === 'nfo') {
        const sidecarBasis = {
          schemaRef:
            'helix://contracts/domain-types/SidecarProfile/v1',
          schemaVersion: 1,
          profileId: 'helix-sidecar-' +
            (isSeries ? 'series-nfo' : contentProfile + '-nfo'),
          revision: 1,
          format: 'nfo_xml',
          fileNamePolicyDigest: canonicalDigest({
            schema: 'libra.product-sidecar-filename-policy@1',
            contentProfile,
            relativePath,
          }),
          contentSchemaRef:
            'helix://contracts/records/descriptive-facts/v1',
          typedParameters: Object.freeze([]),
        };
        const sidecarProfile = Object.freeze({
          ...sidecarBasis,
          digest: canonicalDigest(sidecarBasis),
        });
        const inputBindings = Object.freeze({
          productMetadataDraft: metadataDraftResult.draft,
          sidecarProfile,
        });
        artifactChain = await runResultCapability(snapshot.run, {
          workKind: 'product_sidecar_render',
          objectiveRef: 'helix://libra/work/ProductSidecarRender/v1',
          nodeId: 'render-' + kind,
          capabilityRef: 'libra.product_sidecar.render@1',
          effectClass: 'workspace_write',
          inputSchemaRef:
            'helix://contracts/capabilities/libra.product_sidecar.render/v1/inputs',
          input: inputBindings,
          parametersSchemaRef:
            'helix://contracts/capabilities/libra.product_sidecar.render/v1/parameters',
          fenceSchemaRef:
            'helix://contracts/capabilities/libra.product_sidecar.render/v1/fence',
          resourceDemandSchemaRef:
            'helix://contracts/capabilities/libra.product_sidecar.render/v1/resource-demand',
          resultSchemaRef:
            'helix://contracts/types/ArtifactHandle/v1',
          execute: () => options.productionPort.renderProductSidecar({
            ...inputBindings,
            libraRunId,
            workspaceId: workspace.workspaceId,
            relativePath,
            contentProfile,
          }),
        });
      } else {
        const artifactIntegrationHandle =
          options.productionPort.resolveIntegrationHandle({
            intent: providerIntent,
            operationId: 'libra.product_artifact.acquire@1',
            artifactKind: kind,
          });
        const inputBindings = Object.freeze({
          productMetadataDraft: metadataDraftResult.draft,
          integrationHandle: artifactIntegrationHandle,
        });
        artifactChain = await runResultCapability(snapshot.run, {
          workKind: 'product_artifact_acquisition',
          objectiveRef:
            'helix://libra/work/ProductArtifactAcquisition/v1',
          nodeId: 'acquire-' + kind,
          capabilityRef: 'libra.product_artifact.acquire@1',
          effectClass: 'workspace_write',
          inputSchemaRef:
            'helix://contracts/capabilities/libra.product_artifact.acquire/v1/inputs',
          input: inputBindings,
          parameters: Object.freeze({ artifactKind:kind }),
          parametersSchemaRef:
            'helix://contracts/capabilities/libra.product_artifact.acquire/v1/parameters',
          fenceSchemaRef:
            'helix://contracts/capabilities/libra.product_artifact.acquire/v1/fence',
          resourceDemandSchemaRef:
            'helix://contracts/capabilities/libra.product_artifact.acquire/v1/resource-demand',
          resourceKinds: ['disk_io', 'network'],
          resultSchemaRef:
            'helix://contracts/types/ArtifactAcquisitionResult/v1',
          execute: () => options.productionPort.acquireProviderArtifact({
            ...inputBindings,
            artifactKind: kind,
            libraRunId,
            workspaceId: workspace.workspaceId,
            relativePath,
            integrationId: providerIntent.integrationId,
            configRevision: providerIntent.configRevision,
            metadataObservationId: providerObservation.evidenceId,
            metadataObservationDigest:
              providerObservation.payloadDigest,
          }),
          evidenceDigest: (result) => result.evidence.payloadDigest,
        });
        if (artifactChain.result.resultKind !== 'acquired') {
          return Object.freeze({
            stage: 'product_artifact_unresolved',
            libraRunId,
            artifactKind: kind,
            reasonCode: artifactChain.result.reasonCode,
          });
        }
      }
      const artifactHandle = kind === 'nfo'
        ? artifactChain.result
        : artifactChain.result.artifactHandle;
      const materialized =
        options.workspaceProductPort.readMaterializedArtifact(
          artifactHandle,
        );
      const verification = buildArtifactManifestVerification({
        requirement,
        artifactHandles: [materialized.artifactHandle],
        verifiedAtMs: productionTimeMs,
      });
      const inputBindings = Object.freeze({
        artifactHandleList: Object.freeze([materialized.artifactHandle]),
        artifactRequirement: requirement,
      });
      const chain = await runResultCapability(snapshot.run, {
        workKind: 'artifact_verification',
        objectiveRef: 'helix://libra/work/ArtifactVerification/v1',
        nodeId: 'verify-' + kind,
        capabilityRef: 'shared.artifact.manifest.verify@1',
        effectClass: 'pure_observation',
        inputSchemaRef:
          'helix://contracts/capabilities/shared.artifact.manifest.verify/v1/inputs',
        input: inputBindings,
        parametersSchemaRef:
          'helix://contracts/capabilities/shared.artifact.manifest.verify/v1/parameters',
        fenceSchemaRef:
          'helix://contracts/capabilities/shared.artifact.manifest.verify/v1/fence',
        resourceDemandSchemaRef:
          'helix://contracts/capabilities/shared.artifact.manifest.verify/v1/resource-demand',
        resultSchemaRef: ARTIFACT_VERIFICATION_SCHEMA,
        result: verification,
        evidenceDigest: verification.verificationDigest,
      });
      const staged = stageArtifact(
        snapshot.run,
        workspace,
        materialized,
        role,
        requirement,
        verification,
      );
      materials.push(Object.freeze({
        ordinal,
        kind,
        role,
        requirement,
        materialized,
        verification,
        reference: staged.reference,
      }));
      artifactChains.push(chain);
    }
    verifiedItems = materials.map((item, ordinal) =>
      verifiedArtifactItem(
        ordinal,
        item.materialized.artifactHandle,
        item.requirement,
        item.verification,
        artifactChains[ordinal],
      ));
    const artifactSetDigest = canonicalDigest({
      schema: 'libra.verified-artifact-set@1',
      items: verifiedItems,
    });
    verifiedArtifactManifest = {
      manifestId: canonicalDigest({
        schema: 'libra.verified-artifact-manifest-id@1',
        libraRunId,
        artifactSetDigest,
      }),
      libraRunId,
      items: verifiedItems,
      artifactSetDigest,
    };
    verifiedArtifactManifest.manifestDigest =
      canonicalDigest(verifiedArtifactManifest);
    const castBasis = buildMetadataObservationBasis({
      intents: [...nfoSources.map((item) => item.intent), providerIntent],
      results,
      factKind: 'media_cast',
      expectedRevision: 0,
    });
    const relations = providerObservation.peopleHints.map((item) => ({
      relationId: stable('movie-cast-relation-', {
        subjectId: snapshot.run.subjectId,
        role: item.role,
        displayName: item.displayName,
        providerIdentities: item.providerIdentities || [],
      }),
      personId: null,
      displayName: item.displayName,
      displayNameNormalized: item.displayName.normalize('NFKC').toLowerCase(),
      role: item.role,
      source: providerSearch.provider,
      providerIdentities: item.providerIdentities || [],
      originEvidenceDigest: providerObservation.payloadDigest,
      confidenceClass: 'provider_asserted',
    })).sort((left, right) => Buffer.compare(Buffer.from(left.role), Buffer.from(right.role)) ||
      Buffer.compare(Buffer.from(left.displayNameNormalized), Buffer.from(right.displayNameNormalized)) ||
      Buffer.compare(Buffer.from(left.relationId), Buffer.from(right.relationId)));
    const castDraft = buildMediaCastDraft({
      subjectId: snapshot.run.subjectId,
      sourceBasis: castBasis,
      relations,
      producedAtMs: productionTimeMs,
    });
    castFact = commitFact(snapshot.run, 'media_cast', castBasis, {
      schema: 'libra.media-cast-fact-commit-payload@1',
      mediaCastDraft: castDraft,
    }, results);
    metadataFact = commitFact(snapshot.run, 'product_metadata', metadataBasis, {
      schema: 'libra.product-metadata-fact-commit-payload@1',
      productMetadataDraft: metadataDraftResult.draft,
      verifiedArtifactManifest,
      mediaCastFactRef: {
        productFactId: castFact.productFactId,
        factRevision: castFact.factRevision,
        factDigest: castFact.factDigest,
      },
    }, results);
    }
    if (typeof options.afterProductFactsCommit === 'function') {
      options.afterProductFactsCommit(Object.freeze({
        libraRunId,
        identityFact,
        castFact,
        metadataFact,
      }));
    }
    const facts = [castFact, metadataFact, identityFact]
      .map((item) => buildProductConformanceFactSnapshot(item))
      .sort((left, right) => Buffer.compare(Buffer.from(left.factKind), Buffer.from(right.factKind)));
    const packageRevision = snapshot.run.packageRevisionHead + 1;
    const onDeckPackageId = canonicalDigest({
      schema: 'libra.on-deck-package-id@1',
      libraRunId,
      packageRevision,
    });
    const primaryMembers = snapshot.members.map((member) => {
      const value = {
        ordinal: 0,
        materialKey: member.materialKey,
        role: 'primary_payload',
        physicalIdentity: member.physicalIdentity,
        sizeBytes: member.sizeBytes,
        location: {
          locationKind: 'domain_binding',
          endpointId: member.endpointId,
          location: member.location,
          rootHandleRef: null,
          relativePath: null,
        },
        bindingKind: 'libra_material_binding',
        bindingRevision: member.bindingRevision,
        bindingEvidenceDigest: member.bindingEvidenceDigest,
        originCandidateDeliveryRef: member.originCandidateDeliveryRef,
        workspaceReferenceId: null,
        workspaceMaterialHandle: null,
        admittedControlRevision: member.admittedControlRevision,
        admittedControlProjectionDigest:
          member.admittedControlProjectionDigest,
        outputRequirementDigest: member.outputRequirementDigest,
        episodeClaims: member.episodeClaims,
        episodeClaimSetDigest: member.episodeClaimSetDigest,
        controlOperation: 'assert_existing_input',
        expectedControlRevision: member.admittedControlRevision,
        expectedControlProjectionDigest:
          member.admittedControlProjectionDigest,
        committedControlRevision: member.admittedControlRevision,
        committedControlProjectionDigest:
          member.admittedControlProjectionDigest,
      };
      value.memberDigest = canonicalDigest(value);
      return value;
    });
    const productMembers = [...primaryMembers, ...materials.map((item) => {
      const handle = item.materialized.workspaceMaterialHandle;
      const value = {
        ordinal: 0,
        materialKey: handle.materialKey,
        role: item.role,
        physicalIdentity: {
          schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v1',
          schemaVersion: 1,
          materialKey: handle.materialKey,
          ...handle.physicalIdentity,
        },
        sizeBytes: handle.sizeBytes,
        location: {
          locationKind: 'workspace_handle',
          endpointId: handle.endpointId,
          location: null,
          rootHandleRef: handle.rootHandleRef,
          relativePath: handle.relativePath,
        },
        bindingKind: 'workspace_material_reference',
        bindingRevision: item.reference.referenceRevision,
        bindingEvidenceDigest: item.reference.referenceDigest,
        originCandidateDeliveryRef: null,
        workspaceReferenceId: item.reference.referenceId,
        workspaceMaterialHandle: handle,
        admittedControlRevision: null,
        admittedControlProjectionDigest: null,
        outputRequirementDigest: item.requirement.requirementDigest,
        episodeClaims: item.reference.episodeClaims,
        episodeClaimSetDigest:
          episodeClaimSetDigest(item.reference.episodeClaims),
        controlOperation: 'acquire_workspace_product',
        expectedControlRevision: null,
        expectedControlProjectionDigest: null,
        committedControlRevision: 1,
        committedControlProjectionDigest: projectMaterialControlRow(
          handle.materialKey,
          {
            control_revision: 1,
            state: 'controlled',
            owner_domain: 'libra',
            owner_scope_type: 'on_deck_package',
            owner_scope_id: onDeckPackageId,
          },
        ).projectionDigest,
      };
      return value;
    })].sort((left, right) => Buffer.compare(Buffer.from(left.materialKey), Buffer.from(right.materialKey)));
    productMembers.forEach((item, ordinal) => {
      item.ordinal = ordinal;
      item.memberDigest = canonicalDigest(Object.fromEntries(
        Object.entries(item).filter(([key]) => key !== 'memberDigest'),
      ));
    });
    const productMaterialManifest = {
      manifestId: canonicalDigest({
        schema: 'libra.production-material-manifest-id@1',
        manifestRole: 'product_delivery',
        libraRunId,
        manifestRevision: packageRevision,
      }),
      manifestRole: 'product_delivery',
      manifestRevision: packageRevision,
      libraRunId,
      scopeKind: isSeries ? 'episode_delivery' : 'single',
      members: productMembers,
      memberSetDigest: canonicalDigest({
        schema: 'libra.production-material-members@1',
        items: productMembers,
      }),
      episodeScopeDigest: episodeScopeDigest(productEpisodeClaims),
    };
    productMaterialManifest.manifestDigest =
      canonicalDigest(productMaterialManifest);
    const artifactItems = materials.map((item) => {
      const artifact = item.materialized.artifactHandle;
      const value = {
        artifactHandleId: artifact.artifactHandleId,
        artifactKind: artifact.artifactKind,
        artifactRevision: artifact.referenceRevision,
        artifactDigest: artifact.digestHex,
        requirementDigest: item.requirement.requirementDigest,
        materializationState: 'included_product',
      };
      value.referenceDigest = canonicalDigest(value);
      return value;
    }).sort((left, right) =>
      Buffer.compare(Buffer.from(left.artifactKind), Buffer.from(right.artifactKind)) ||
      Buffer.compare(Buffer.from(left.artifactHandleId), Buffer.from(right.artifactHandleId)) ||
      left.artifactRevision - right.artifactRevision);
    const artifactManifest = {
      manifestId: canonicalDigest({
        schema: 'libra.product-submanifest-id@1',
        manifestKind: 'artifact',
        libraRunId,
        packageRevision,
      }),
      manifestRevision: packageRevision,
      libraRunId,
      items: artifactItems,
      artifactSetDigest: canonicalDigest({
        schema: 'libra.product-artifact-set@1',
        items: artifactItems,
      }),
    };
    artifactManifest.manifestDigest = canonicalDigest(artifactManifest);
    const productStructure = complete({
      structureKind,
      contentProfile,
      productScopeDigest: snapshot.spec.productScope.scopeDigest,
      episodeScopeDigest: episodeScopeDigest(productEpisodeClaims),
      primaryMaterialCount: snapshot.members.length,
      structuralDependencyCount: 0,
    }, 'productStructureDigest');
    const inventory = {
      productStructureSnapshot: productStructure,
      productMaterialManifest,
      artifactManifest,
    };
    inventory.inventoryDigest = canonicalDigest(inventory);
    const artifactVerificationSnapshots = materials.map((item, ordinal) => ({
      ordinal,
      verifiedManifestItem: verifiedItems[ordinal],
      artifactManifestItem: artifactItems.find((candidate) =>
        candidate.artifactHandleId ===
          item.materialized.artifactHandle.artifactHandleId),
      verificationResultRef: verifiedItems[ordinal].verificationResultRef,
      verificationValue: item.verification,
      snapshotDigest: '',
    })).map((item) => Object.freeze({
      ...item,
      snapshotDigest: canonicalDigest(Object.fromEntries(
        Object.entries(item).filter(([key]) => key !== 'snapshotDigest'),
      )),
    }));
    const conformanceInput = buildProductConformanceInputSnapshot({
      libraRunId,
      runExecutionBasisDigest: snapshot.run.executionBasisDigest,
      acceptanceSpecId: snapshot.spec.acceptanceSpecId,
      acceptanceSpecRecordDigest: snapshot.spec.recordDigest,
      acceptanceSpec: snapshot.spec,
      resolvedIdentitySnapshot: facts.find((item) =>
        item.factKind === 'resolved_identity'),
      productFactSnapshots: facts,
      verifiedArtifactManifest,
      artifactVerificationSnapshots,
      inventorySnapshot: inventory,
      selectedProducts: mediaProducts.map((item) => ({
        selectedProduct: item.selected,
        verification: item.verification,
        workspaceHandleDigest: null,
      })).sort((left, right) =>
        Buffer.compare(
          Buffer.from(left.selectedProduct.selectedHandleId),
          Buffer.from(right.selectedProduct.selectedHandleId),
        ) || Buffer.compare(
          Buffer.from(left.selectedProduct.selectedVerificationId),
          Buffer.from(right.selectedProduct.selectedVerificationId),
        )),
    });
    const conformance = evaluateProductConformance({
      input: conformanceInput,
      verifiedAtMs: productionTimeMs,
    });
    if (conformance.result !== 'passed') {
      return Object.freeze({
        stage: 'product_conformance_failed',
        libraRunId,
        conformance,
      });
    }
    const factItems = facts.map((item) => {
      const reference = {
        productFactId: item.productFactId,
        factKind: item.factKind,
        factRevision: item.factRevision,
        schemaRef: item.schemaRef,
        factValue: item.factValue,
        factDigest: item.factDigest,
        evidenceDigest: item.evidenceDigest,
      };
      reference.referenceDigest = canonicalDigest(reference);
      return reference;
    }).sort((left, right) =>
      Buffer.compare(Buffer.from(left.factKind), Buffer.from(right.factKind)) ||
      Buffer.compare(Buffer.from(left.productFactId), Buffer.from(right.productFactId)) ||
      left.factRevision - right.factRevision);
    const productFactManifest = {
      manifestId: canonicalDigest({
        schema: 'libra.product-submanifest-id@1',
        manifestKind: 'product_fact',
        libraRunId,
        packageRevision,
      }),
      manifestRevision: packageRevision,
      libraRunId,
      items: factItems,
      factSetDigest: canonicalDigest({
        schema: 'libra.product-fact-set@1',
        items: factItems,
      }),
    };
    productFactManifest.manifestDigest =
      canonicalDigest(productFactManifest);
    const offloadMembers = snapshot.members.map((member, ordinal) => {
      const value = {
        ordinal,
        materialKey: member.materialKey,
        contextRole: 'original_input',
        physicalIdentity: member.physicalIdentity,
        endpointId: member.endpointId,
        location: member.location,
        bindingRevision: member.bindingRevision,
        bindingEvidenceDigest: member.bindingEvidenceDigest,
        admittedControlRevision: member.admittedControlRevision,
        admittedControlProjectionDigest:
          member.admittedControlProjectionDigest,
        settlementExpectation: 'retain',
      };
      value.memberDigest = canonicalDigest(value);
      return value;
    }).sort((left, right) =>
      Buffer.compare(Buffer.from(left.materialKey), Buffer.from(right.materialKey)))
      .map((member, ordinal) => {
        const value = { ...member, ordinal };
        value.memberDigest = canonicalDigest(Object.fromEntries(
          Object.entries(value).filter(([key]) => key !== 'memberDigest'),
        ));
        return value;
      });
    const offloadContextManifest = {
      manifestId: canonicalDigest({
        schema: 'libra.product-submanifest-id@1',
        manifestKind: 'offload_context',
        libraRunId,
        packageRevision,
      }),
      manifestRevision: packageRevision,
      libraRunId,
      members: offloadMembers,
      memberSetDigest: canonicalDigest({
        schema: 'libra.offload-context-members@1',
        items: offloadMembers,
      }),
    };
    offloadContextManifest.manifestDigest =
      canonicalDigest(offloadContextManifest);
    const stagingReferences = reader.readWorkspace(workspace.workspaceId)
      .references.filter((item) => item.state === 'product_staging')
      .sort((left, right) => Buffer.compare(
        Buffer.from(left.referenceId),
        Buffer.from(right.referenceId),
      ));
    const provenance = {
      libraRunId,
      runExecutionBasisDigest: snapshot.run.executionBasisDigest,
      acceptanceSpecRecordDigest: snapshot.spec.recordDigest,
      workflowPlanRefs: results.concat(artifactChains).map((item) => ({
        planId: item.planId,
        planRevision: item.planRevision,
        planDigest: item.planDigest,
      })).sort((left, right) =>
        Buffer.compare(Buffer.from(left.planId), Buffer.from(right.planId))),
      productVerificationRefs: mediaProducts.map((item) => ({
        verificationId: item.verification.verificationId,
        verificationDigest: canonicalDigest(item.verification),
      })).sort((left, right) =>
        Buffer.compare(Buffer.from(left.verificationId), Buffer.from(right.verificationId))),
      externalRealityObservationRefs: mediaProducts.map((item) => ({
        evidenceId: item.probe.evidenceId,
        evidenceDigest: item.probe.payloadDigest,
      })).sort((left, right) =>
        Buffer.compare(Buffer.from(left.evidenceId), Buffer.from(right.evidenceId))),
    };
    provenance.provenanceDigest = canonicalDigest(provenance);
    const attestation = {
      attestationId: canonicalDigest({
        schema: 'libra.production-attestation-id@1',
        libraRunId,
        onDeckPackageId,
        productConformanceEvidenceId: conformance.verificationId,
        productConformanceEvidenceDigest: canonicalDigest(conformance),
      }),
      libraRunId,
      onDeckPackageId,
      acceptanceSpecId: snapshot.spec.acceptanceSpecId,
      acceptanceSpecRecordDigest: snapshot.spec.recordDigest,
      productConformanceEvidenceId: conformance.verificationId,
      productConformanceEvidenceDigest: canonicalDigest(conformance),
      evaluatedRequirementSetDigest: conformance.evaluatedRequirementSetDigest,
      productSnapshotDigest: conformance.productSnapshotDigest,
      unmetRequirementCount: conformance.unmetRequirementCodes.length,
      attestedAtMs: productionTimeMs,
      attestationDigest: '',
    };
    attestation.attestationDigest = canonicalDigest(Object.fromEntries(
      Object.entries(attestation).filter(([key]) => key !== 'attestationDigest'),
    ));
    const controlItems = productMembers.map((item) =>
      item.controlOperation === 'assert_existing_input'
        ? Object.freeze({
          controlOperation: item.controlOperation,
          materialKey: item.materialKey,
          expectedControlRevision: item.expectedControlRevision,
          expectedControlProjectionDigest: item.expectedControlProjectionDigest,
          ownerDomain: 'libra',
          ownerScopeType: 'subject',
          ownerScopeId: snapshot.run.subjectId,
        })
        : Object.freeze({
          controlOperation: item.controlOperation,
          materialKey: item.materialKey,
          expectedControlState: 'absent',
          toOwnerDomain: 'libra',
          toOwnerScopeType: 'on_deck_package',
          toOwnerScopeId: onDeckPackageId,
        }));
    const controlCommitScope = {
      items: controlItems,
      controlScopeDigest: canonicalDigest({
        schema: 'libra.product-control-commit-scope@1',
        libraRunId,
        onDeckPackageId,
        items: controlItems,
      }),
    };
    const currentWorkspace = reader.readWorkspace(workspace.workspaceId);
    const decision = {
      decisionId: '',
      libraRunRef: {
        libraRunId,
        stateRevision: snapshot.run.stateRevision,
        stateDigest: snapshot.run.stateDigest,
        executionBasisDigest: snapshot.run.executionBasisDigest,
        runScopeDigest: snapshot.run.runScopeDigest,
        expectedPackageRevisionHead: snapshot.run.packageRevisionHead,
      },
      runMaterialManifestRef: {
        manifestId: snapshot.run.runMaterialManifestId,
        manifestDigest: snapshot.run.runMaterialManifestDigest,
      },
      workspaceRef: {
        workspaceId: currentWorkspace.workspaceId,
        libraRunId,
        workspaceRevision: currentWorkspace.currentRevision,
        workspaceStateDigest: currentWorkspace.stateDigest,
      },
      productStagingReferences: stagingReferences,
      acceptanceSpecRef: {
        acceptanceSpecId: snapshot.spec.acceptanceSpecId,
        recordDigest: snapshot.spec.recordDigest,
      },
      resolvedIdentitySnapshot: facts.find((item) =>
        item.factKind === 'resolved_identity'),
      productStructureSnapshot: productStructure,
      productFactManifest,
      artifactManifest,
      mediaCastSnapshot: {
        mediaCastFactId: castFact.productFactId,
        mediaCastFactRevision: castFact.factRevision,
        schemaRef: castFact.schemaRef,
        factValue: castFact.factValue,
        factDigest: castFact.factDigest,
        evidenceDigest: castFact.evidenceDigest,
        relations: castFact.factValue.relations,
        relationsDigest: castFact.factValue.relationsDigest,
      },
      productMaterialManifest,
      offloadContextManifest,
      productionProvenance: provenance,
      productionAttestation: attestation,
      controlCommitScope,
      onDeckPackageId,
      packageRevision,
      packageDigest: '',
      offerId: '',
      decisionDigest: '',
    };
    decision.packageDigest = onDeckProductPackageDigest(
      decision,
      snapshot.run.subjectId,
      snapshot.spec.targetShelfId || snapshot.spec.shelfId,
    );
    decision.offerId = canonicalDigest({
      schema: 'libra.product-offer-id@1',
      onDeckPackageId,
      packageDigest: decision.packageDigest,
    });
    decision.decisionId = canonicalDigest({
      schema: 'libra.deliverable-promotion-decision-id@1',
      libraRunId,
      packageRevision: decision.packageRevision,
      packageDigest: decision.packageDigest,
      controlScopeDigest: controlCommitScope.controlScopeDigest,
    });
    decision.decisionDigest = canonicalDigest(Object.fromEntries(
      Object.entries(decision).filter(([key]) => key !== 'decisionDigest'),
    ));
    const controlHandle = {
      schemaRef: 'helix://contracts/types/ResponsibilityControlCommitHandle/v1',
      schemaVersion: 1,
      handleId: stable('movie-promotion-control-', {
        libraRunId,
        decisionDigest: decision.decisionDigest,
      }),
      ownerDomain: 'libra',
      processType: 'libra_run',
      processId: libraRunId,
      operationKind: 'replace_control_set',
      basisRef: {
        objectType: 'deliverable_promotion',
        objectId: decision.decisionId,
        revision: decision.packageRevision,
        digest: decision.decisionDigest,
      },
      basisDigest: decision.decisionDigest,
      canonicalFactSetDigest: productFactManifest.factSetDigest,
      bindingSetDigest: productMaterialManifest.memberSetDigest,
      controlScopeDigest: controlCommitScope.controlScopeDigest,
      expectedControlRevisions: controlItems.map((item) => ({
        materialKey: item.materialKey,
        revision: item.controlOperation === 'assert_existing_input'
          ? item.expectedControlRevision
          : 0,
      })),
      receiptContract: RESULT_SCHEMA,
      eventFenceDigest: canonicalDigest({
        schema: 'libra.movie-promotion-event-fence@1',
        libraRunId,
        decisionDigest: decision.decisionDigest,
      }),
    };
    const published = promotionStore.publish({
      transactionId: 'helix.transaction.libra-deliverable-promotion',
      decision,
      controlCommitHandle: controlHandle,
      commitMarker: stable('movie-promotion-marker-', {
        libraRunId,
        decisionDigest: decision.decisionDigest,
      }),
      resultId: stable('movie-promotion-result-', {
        libraRunId,
        decisionDigest: decision.decisionDigest,
      }),
    });
    if (typeof options.afterPackageCommit === 'function') {
      options.afterPackageCommit(Object.freeze({
        libraRunId,
        onDeckPackageId,
        offerId: decision.offerId,
      }));
    }
    const delivery = deliveryReader.readPackage({
      queryContract: 'libra.product-delivery@1',
      readPurpose: 'historical',
      offerId: decision.offerId,
      onDeckPackageId,
      expectedPackageRevision: decision.packageRevision,
      expectedPackageDigest: decision.packageDigest,
    });
    if (delivery.resultKind !== 'found') {
      fail('P14_MOVIE_PRODUCT_DELIVERY_MISSING',
        'Published Product Delivery cannot be reconstructed.');
    }
    return Object.freeze({
      stage: 'handoff_b_offer_open',
      replayed: published.replayed,
      contentProfile,
      libraRunId,
      workspaceId: workspace.workspaceId,
      targetShelfId: snapshot.spec.targetShelfId || snapshot.spec.shelfId,
      acceptanceSpecId: snapshot.spec.acceptanceSpecId,
      onDeckPackageId,
      packageRevision: decision.packageRevision,
      packageDigest: decision.packageDigest,
      offerId: decision.offerId,
      offerMessage: productOfferMessage({
        offerId: decision.offerId,
        onDeckPackageId,
        packageRevision: decision.packageRevision,
        packageDigest: decision.packageDigest,
        libraRunId,
        subjectId: snapshot.run.subjectId,
        shelfId: snapshot.spec.targetShelfId || snapshot.spec.shelfId,
        acceptanceSpecId: snapshot.spec.acceptanceSpecId,
      }),
      productDelivery: delivery,
      conformance,
    });
  }

  return Object.freeze({ advance });
}

module.exports = Object.freeze({
  MovieProductionCoordinatorError,
  createMovieProductionCoordinator,
});
