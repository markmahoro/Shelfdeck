'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { buildEpisodeMetadataScope } = require('../../../contracts/episode-metadata-scope');
const { metadataObservationLimit, metadataObservationSetByteLimit } = require('../../../contracts/metadata-observation-limits');
const { metadataSetRef, SET_LIMIT } = require('../../../contracts/episode-metadata-records');
const {assertActorSelection,selectedPerson,actorRelation}=require('./us-adult-actor-selection');

class ProductFactContractError extends Error {
  constructor(code, message) { super(message); this.name = 'ProductFactContractError'; this.code = code; }
}

const fail = (code, message) => { throw new ProductFactContractError(code, message); };
const DIGEST = /^[a-f0-9]{64}$/;
const text = (value, field) => {
  if (typeof value !== 'string' || value.length === 0) fail('P9_PRODUCT_FACT_VALUE', field + ' is required.');
  return value;
};
const digest = (value, field) => {
  if (!DIGEST.test(value || '')) fail('P9_PRODUCT_FACT_DIGEST', field + ' must be lowercase SHA-256.');
  return value;
};
const integer = (value, field, minimum = 0) => {
  if (!Number.isSafeInteger(value) || value < minimum) fail('P9_PRODUCT_FACT_INTEGER', field + ' is invalid.');
  return value;
};
const bytes = (value, maximum, code) => {
  if (Buffer.byteLength(canonicalJson(value), 'utf8') > maximum) fail(code, 'Canonical value exceeds ' + maximum + ' bytes.');
  return value;
};
const compare = (left, right) => Buffer.from(left).compare(Buffer.from(right));
const capabilityResultRef = (capabilityRef) => 'helix://contracts/capabilities/' + capabilityRef.replace('@1', '/v1/result');

function validateArtifactRequirement(value) {
  if (!value || typeof value.requirementPayload !== 'object' || value.requirementPayload === null ||
      Array.isArray(value.requirementPayload)) fail('P9_ARTIFACT_REQUIREMENT', 'Artifact Requirement payload is invalid.');
  const requirement = { requirementId:text(value.requirementId, 'requirementId'),
    revision:integer(value.revision, 'revision', 1), schemaRef:text(value.schemaRef, 'schemaRef'),
    artifactKind:text(value.artifactKind, 'artifactKind'), requirementPayload:value.requirementPayload,
    requirementDigest:digest(value.requirementDigest, 'requirementDigest') };
  const expectedDigest = canonicalDigest({ schema:'shared.artifact-requirement@1', revision:requirement.revision,
    schemaRef:requirement.schemaRef, artifactKind:requirement.artifactKind, requirementPayload:requirement.requirementPayload });
  const expectedId = canonicalDigest({ schema:'shared.artifact-requirement-id@1', requirementDigest:expectedDigest });
  if (requirement.requirementDigest !== expectedDigest || requirement.requirementId !== expectedId)
    fail('P9_ARTIFACT_REQUIREMENT_IDENTITY', 'Artifact Requirement identity is invalid.');
  return Object.freeze(bytes(requirement, 16 * 1024, 'P9_ARTIFACT_REQUIREMENT_SIZE'));
}

function artifactVerificationItem(handle, ordinal) {
  const item = { ordinal, artifactHandleId:text(handle?.artifactHandleId, 'artifactHandleId'),
    artifactKind:text(handle?.artifactKind, 'artifactKind'),
    artifactRevision:integer(handle?.referenceRevision, 'referenceRevision', 1),
    artifactDigest:digest(handle?.digestHex, 'digestHex') };
  item.referenceDigest = canonicalDigest(item);
  return Object.freeze(item);
}

function buildArtifactManifestVerification(value) {
  const requirement = validateArtifactRequirement(value?.requirement);
  const handles = [...(value?.artifactHandles || [])];
  if (!Array.isArray(value?.artifactHandles) || handles.length > 64 || handles.some((item) => item.artifactKind !== requirement.artifactKind))
    fail('P9_ARTIFACT_VERIFICATION_INPUT', 'Artifact verification requires 0..64 matching handles.');
  const verifiedArtifacts = handles.map(artifactVerificationItem);
  const sorted = [...verifiedArtifacts].sort((left, right) => compare(left.artifactKind, right.artifactKind) ||
    compare(left.artifactHandleId, right.artifactHandleId) || left.artifactRevision - right.artifactRevision);
  if (canonicalJson(verifiedArtifacts) !== canonicalJson(sorted) ||
      new Set(verifiedArtifacts.map((item) => item.artifactHandleId + '|' + item.artifactRevision)).size !== verifiedArtifacts.length)
    fail('P9_ARTIFACT_VERIFICATION_ORDER', 'Artifact verification handles must be unique and canonically sorted.');
  const manifestDigest = canonicalDigest({ schema:'shared.artifact-verification-input-manifest@1',
    requirementDigest:requirement.requirementDigest, items:verifiedArtifacts });
  const basisDigest = canonicalDigest({ schema:'shared.artifact-manifest-verification-basis@1', manifestDigest,
    requirementDigest:requirement.requirementDigest });
  const verification = { schemaRef:'helix://contracts/types/ArtifactManifestVerification/v1', schemaVersion:1,
    verificationId:canonicalDigest({ schema:'shared.artifact-manifest-verification-id@1', manifestDigest,
      requirementDigest:requirement.requirementDigest, basisDigest }), verificationKind:'artifact_manifest', basisDigest,
    result:handles.length ? 'passed' : 'failed', reasonCodes:handles.length ? [] : ['required_artifact_missing'],
    evidenceRefs:[], verifiedAtMs:integer(value?.verifiedAtMs, 'verifiedAtMs'),
    manifestDigest, contractRef:requirement.schemaRef, requirement, verifiedArtifacts,
    artifactDigests:verifiedArtifacts.map((item) => item.artifactDigest), verificationDigest:'' };
  verification.verificationDigest = canonicalDigest(Object.fromEntries(
    Object.entries(verification).filter(([key]) => key !== 'verificationDigest')));
  return Object.freeze(bytes(verification, 64 * 1024, 'P9_ARTIFACT_VERIFICATION_SIZE'));
}

function buildMetadataFetchIntent(value) {
  const common = {
    intentId: '', libraRunId: text(value?.libraRunId, 'libraRunId'),
    runExecutionBasisDigest: digest(value?.runExecutionBasisDigest, 'runExecutionBasisDigest'),
    sourceKind: value?.sourceKind, sourcePriority: integer(value?.sourcePriority, 'sourcePriority'),
    contentProfile: value?.contentProfile, resolvedIdentityDigest: digest(value?.resolvedIdentityDigest, 'resolvedIdentityDigest'),
    requestedFields: Array.isArray(value?.requestedFields) ? [...value.requestedFields] : null
  };
  if (!['movie', 'series', 'jav'].includes(common.contentProfile) ||
      !common.requestedFields || common.requestedFields.length > 256 ||
      common.requestedFields.some((item) => typeof item !== 'string' || !item || item.length > 128) ||
      new Set(common.requestedFields).size !== common.requestedFields.length ||
      canonicalJson(common.requestedFields) !== canonicalJson([...common.requestedFields].sort(compare))) {
    fail('P9_METADATA_INTENT_FIELDS', 'Metadata fields or content profile are invalid.');
  }
  if (common.sourceKind === 'related_nfo') {
    common.relatedReferenceId = text(value.relatedReferenceId, 'relatedReferenceId');
    common.relatedReferenceDigest = digest(value.relatedReferenceDigest, 'relatedReferenceDigest');
    common.expectedChecksum = digest(value.expectedChecksum, 'expectedChecksum');
    if (common.contentProfile === 'jav') fail('P9_METADATA_SOURCE_ORDER', 'JAV cannot use Related NFO in Beta.');
  } else if (common.sourceKind === 'provider') {
    common.providerKind = value.providerKind;
    const identity = value.resolvedProviderIdentity;
    const expectedProvider = common.contentProfile === 'jav' ? 'jav' : 'tmdb';
    const expectedNamespace = common.contentProfile === 'series'
      ? 'tmdb_series'
      : common.contentProfile === 'jav'
        ? 'jav_code'
        : 'tmdb_movie';
    if (!identity || typeof identity !== 'object' || Array.isArray(identity) ||
        canonicalJson(Object.keys(identity).sort()) !== canonicalJson([
          'identityAnchorDigest', 'namespace', 'provider', 'providerKey',
          'seasonNumber',
        ].sort()) ||
        identity.provider !== expectedProvider ||
        identity.namespace !== expectedNamespace ||
        typeof identity.providerKey !== 'string' || !identity.providerKey ||
        (expectedNamespace === 'tmdb_series'
          ? !Number.isSafeInteger(identity.seasonNumber) ||
            identity.seasonNumber < 1
          : identity.seasonNumber !== null) ||
        identity.identityAnchorDigest !== canonicalDigest({
          provider: identity.provider,
          namespace: identity.namespace,
          providerKey: identity.providerKey,
          seasonNumber: identity.seasonNumber,
        })) {
      fail('P9_METADATA_PROVIDER_IDENTITY',
        'Provider Metadata Intent requires the exact resolved Provider identity tuple.');
    }
    common.resolvedProviderIdentity = Object.freeze({ ...identity });
    common.integrationId = text(value.integrationId, 'integrationId');
    common.configRevision = integer(value.configRevision, 'configRevision', 1);
    if(common.contentProfile==='jav') {
      common.javSelectedSource=require('../../../contracts/jav-selected-source').assertJavSelectedSource(value.javSelectedSource);
      if(common.sourcePriority!==0||common.integrationId!==common.javSelectedSource.integrationId||common.configRevision!==common.javSelectedSource.configRevision||
          identity.providerKey!==common.javSelectedSource.queryAnchor.javCode)
        fail('P9_METADATA_SOURCE_ORDER','JAV Metadata Intent must conserve the selected site, config and canonical code.');
    }
    if (!['tmdb', 'jav'].includes(common.providerKind) ||
        (common.providerKind === 'tmdb') !== ['movie', 'series'].includes(common.contentProfile) ||
        (common.providerKind === 'jav') !== (common.contentProfile === 'jav')) {
      fail('P9_METADATA_SOURCE_ORDER', 'Provider does not match the content profile.');
    }
  } else fail('P9_METADATA_SOURCE_KIND', 'Metadata source kind is invalid.');
  if (value.episodeScope !== undefined) {
    if (common.contentProfile !== 'series') fail('P9_METADATA_EPISODE_SCOPE', 'Only Series metadata can carry Episode scope.');
    common.episodeScope = buildEpisodeMetadataScope(value.episodeScope);
    if (common.sourceKind === 'provider' && common.episodeScope.seasonNumber !== common.resolvedProviderIdentity.seasonNumber)
      fail('P9_METADATA_EPISODE_SCOPE', 'Episode scope must match the resolved Season.');
  }
  if (common.requestedFields.some(field => field.startsWith('episode_')) && !common.episodeScope)
    fail('P9_METADATA_EPISODE_SCOPE', 'Episode fields require an explicit Episode scope.');
  if (value.episodeMapping !== undefined) {
    if (!common.episodeScope || common.sourceKind !== 'provider' || common.providerKind !== 'tmdb')
      fail('P9_METADATA_EPISODE_MAPPING', 'A confirmed mapping requires a scoped Provider Episode request.');
    common.episodeMapping = require('../../../contracts/episode-metadata-query').buildEpisodeMetadataQuery(value.episodeMapping);
    if (common.episodeMapping.providerEpisode.providerKey !== common.resolvedProviderIdentity.providerKey)
      fail('P9_METADATA_EPISODE_MAPPING', 'Episode mapping belongs to another show.');
  }
  common.intentDigest = canonicalDigest(Object.fromEntries(Object.entries(common).filter(([key]) => key !== 'intentId')));
  common.intentId = canonicalDigest({ schema:'libra.metadata-fetch-intent-id@1', libraRunId:common.libraRunId,
    runExecutionBasisDigest:common.runExecutionBasisDigest, sourcePriority:common.sourcePriority, intentDigest:common.intentDigest });
  if (value.intentId !== undefined && value.intentId !== common.intentId ||
      value.intentDigest !== undefined && value.intentDigest !== common.intentDigest) {
    fail('P9_METADATA_INTENT_IDENTITY', 'Metadata Intent identity is invalid.');
  }
  return Object.freeze(bytes(common, 16 * 1024, 'P9_METADATA_INTENT_SIZE'));
}

function metadataSourceRef(intent) {
  return intent.sourceKind === 'related_nfo' ? intent.relatedReferenceId :
    intent.providerKind + ':' + intent.integrationId + '@' + intent.configRevision;
}

function metadataObservationWorkIdempotencyKey(intent) {
  return canonicalDigest({ schema:'libra.metadata-observation-work@1', libraRunId:intent.libraRunId,
    runExecutionBasisDigest:intent.runExecutionBasisDigest, fetchIntentDigest:intent.intentDigest });
}

function buildMetadataObservation(value) {
  const intent = buildMetadataFetchIntent(value?.intent);
  const entries = [...(value?.descriptiveEntries || [])]
    .sort((left, right) => compare(left.key, right.key));
  const descriptiveFacts = { schemaRef:'helix://contracts/records/descriptive-facts/v1', schemaVersion:1,
    recordKind:'descriptive-facts', recordDigest:'', entries };
  descriptiveFacts.recordDigest = canonicalDigest(Object.fromEntries(Object.entries(descriptiveFacts)
    .filter(([key]) => key !== 'recordDigest')));
  const identities = [...(value?.providerIdentities || [])].sort((left, right) =>
    compare(canonicalJson(left), canonicalJson(right)));
  if (new Set(identities.map(canonicalJson)).size !== identities.length) {
    fail('P9_METADATA_OBSERVATION_IDENTITIES', 'Metadata Observation identities must be tuple-unique.');
  }
  const providerIdentitySet = { schemaRef:'helix://contracts/records/provider-identity-set/v1', schemaVersion:1,
    recordKind:'provider-identity-set', recordDigest:'', entries:identities };
  providerIdentitySet.recordDigest = canonicalDigest(Object.fromEntries(Object.entries(providerIdentitySet)
    .filter(([key]) => key !== 'recordDigest')));
  const result = { schemaRef:'helix://contracts/types/MetadataObservation/v1', schemaVersion:1,
    evidenceId:'', evidenceKind:'metadata_observation', producerRef:'libra.product_metadata.fetch@1',
    basisDigest:intent.intentDigest, payloadDigest:'', observedAtMs:integer(value?.observedAtMs, 'observedAtMs'),
    fetchIntentDigest:intent.intentDigest, sourceKind:intent.sourceKind, sourceRef:metadataSourceRef(intent),
    sourcePriority:intent.sourcePriority, identityDigest:intent.resolvedIdentityDigest, contentProfile:intent.contentProfile,
    sourceNfoSemantics:value?.sourceNfoSemantics || null,sourceNfoSnapshotDigest:value?.sourceNfoSnapshotDigest || null,
    descriptiveFacts:Object.freeze(descriptiveFacts), providerIdentitySet:Object.freeze(providerIdentitySet),
    peopleHints:Object.freeze([...(value?.peopleHints || [])].slice(0, 64)), artifactHints:Object.freeze([]) };
  if (intent.episodeScope) result.episodeScope = intent.episodeScope;
  if(value.seriesPresentationSource){
    const source=require('../../../contracts/series-presentation-basis').assertSource(value.seriesPresentationSource);
    if(intent.contentProfile!=='series'||intent.sourceKind!=='provider'||intent.episodeScope||
        source.providerKey!==intent.resolvedProviderIdentity.providerKey||
        source.seasonIdentityAnchorDigest!==intent.resolvedProviderIdentity.identityAnchorDigest||
        source.integrationId!==intent.integrationId||source.configRevision!==intent.configRevision)
      fail('P9_SERIES_PRESENTATION_SOURCE','Series presentation facts differ from the frozen Provider intent.');
    result.seriesPresentationSource=source;
    if(value.seriesQualifiedLocalSource){const local=require('../../../contracts/series-local-source').assertQualified(value.seriesQualifiedLocalSource);if(local.providerKey!==source.providerKey)fail('P9_SERIES_PRESENTATION_SOURCE','Local show source belongs to another show.');result.seriesQualifiedLocalSource=local;}
  }
  if(intent.contentProfile==='jav') {
    result.javSelectedSource=intent.javSelectedSource;
    if(!value.sourceIntegrationHandle || value.sourceIntegrationHandle.integrationType!=='jav_source')
      fail('P9_JAV_METADATA_SOURCE_HANDLE','JAV metadata requires the exact observed Integration Handle provenance.');
    result.sourceIntegrationHandle=value.sourceIntegrationHandle;
    result.sourceAuthorizedAtMs=integer(value.sourceAuthorizedAtMs,'sourceAuthorizedAtMs');
    if(result.sourceAuthorizedAtMs>result.observedAtMs||result.sourceIntegrationHandle.expiresAtMs<result.sourceAuthorizedAtMs)
      fail('P9_JAV_METADATA_SOURCE_AUTHORIZATION','JAV metadata requires its actual valid execution authorization point.');
  }
  result.evidenceId = canonicalDigest({ schema:'libra.metadata-observation-evidence-id@1',
    fetchIntentDigest:result.fetchIntentDigest, sourceNfoSemanticsDigest:result.sourceNfoSemantics?.recordDigest || null, descriptiveFactsDigest:descriptiveFacts.recordDigest,
    ...(result.seriesPresentationSource?{seriesPresentationSourceDigest:result.seriesPresentationSource.sourceDigest}:{}),
    ...(result.seriesQualifiedLocalSource?{seriesQualifiedLocalSourceDigest:result.seriesQualifiedLocalSource.qualificationDigest}:{}),
    providerIdentitySetDigest:providerIdentitySet.recordDigest });
  result.payloadDigest = canonicalDigest(Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'payloadDigest')));
  return Object.freeze(bytes(result, 64 * 1024, 'P9_METADATA_OBSERVATION_SIZE'));
}

function selectMetadataObservations(value) {
  const intents = (value?.intents || []).map(buildMetadataFetchIntent);
  if (intents.length < 1 || intents.length > metadataObservationLimit(intents[0].contentProfile)) {
    fail('P9_METADATA_SOURCE_CAPACITY', 'Metadata source count exceeds its profile capacity.');
  }
  if (intents.some((item, ordinal) => item.sourcePriority !== ordinal)) {
    fail('P9_METADATA_INTENT_ORDER', 'Metadata priorities must be unique and contiguous from zero.');
  }
  const byDigest = new Map(intents.map((item) => [item.intentDigest, item]));
  const selected = new Map();
  for (const candidate of value.results || []) {
    const intent = byDigest.get(candidate?.result?.fetchIntentDigest);
    if (!intent || candidate.ownerDomain !== 'libra' || candidate.processType !== 'libra_run' ||
        candidate.processId !== intent.libraRunId || candidate.workKind !== 'product_metadata_observation' ||
        candidate.workState !== 'succeeded' || candidate.capabilityRef !== 'libra.product_metadata.fetch@1' ||
        candidate.resultSchemaRef !== capabilityResultRef('libra.product_metadata.fetch@1') ||
        candidate.result?.schemaRef !== 'helix://contracts/types/MetadataObservation/v1' ||
        candidate.result?.schemaVersion !== 1 ||
        candidate.result.identityDigest !== intent.resolvedIdentityDigest || candidate.result.contentProfile !== intent.contentProfile ||
        candidate.result.sourceKind !== intent.sourceKind || candidate.result.sourceRef !== metadataSourceRef(intent) ||
        candidate.result.sourcePriority !== intent.sourcePriority ||
        canonicalJson(candidate.result.episodeScope || null) !== canonicalJson(intent.episodeScope || null) ||
        candidate.evidence?.payloadDigest !== candidate.result.payloadDigest ||
        canonicalDigest(candidate.evidence) !== candidate.evidenceDigest ||
        canonicalDigest(candidate.result) !== candidate.resultDigest ||
        candidate.inputBindingDigest !== canonicalDigest(candidate.planInputBindings || candidate.inputBindings || intent) ||
        (candidate.inputSnapshotDigest && candidate.resolvedInputs &&
          candidate.inputSnapshotDigest !== canonicalDigest(candidate.resolvedInputs)) ||
        ((candidate.resolvedInputs || candidate.inputBindings) &&
          canonicalJson((candidate.resolvedInputs || candidate.inputBindings).metadataFetchIntent ||
            (candidate.resolvedInputs || candidate.inputBindings)) !==
            canonicalJson(intent))) {
      fail('P9_METADATA_OBSERVATION_CHAIN', 'Observation is outside the exact Supporting Work chain.');
    }
    if (intent.sourceKind === 'provider' &&
        !(candidate.result.providerIdentitySet?.entries || []).some((item) =>
          canonicalJson(item) === canonicalJson(intent.resolvedProviderIdentity))) {
      fail('P9_METADATA_OBSERVATION_PROVIDER_IDENTITY',
        'Provider Metadata Observation does not conserve its exact Intent identity tuple.');
    }
    const prior = selected.get(intent.intentDigest);
    if (prior && prior.result.payloadDigest !== candidate.result.payloadDigest)
      fail('P9_METADATA_OBSERVATION_CONFLICT', 'Semantic replay changed payload digest.');
    if (!prior || compare(candidate.resultId, prior.resultId) < 0) selected.set(intent.intentDigest, candidate);
  }
  const items = [...selected.values()].sort((left, right) =>
    left.result.sourcePriority - right.result.sourcePriority || compare(left.result.evidenceId, right.result.evidenceId));
  return Object.freeze({ intents:Object.freeze(intents), items:Object.freeze(items) });
}

function buildMetadataObservationBasis(value) {
  const selected = selectMetadataObservations(value), observations = selected.items.map((item) => item.result);
  if (observations.length < 1) fail('P9_METADATA_OBSERVATION_EMPTY', 'At least one durable Observation is required.');
  const factKind = value?.factKind;
  if (!['media_cast', 'product_metadata', 'resolved_identity'].includes(factKind)) {
    fail('P9_PRODUCT_FACT_KIND', 'Product Fact kind is invalid.');
  }
  const expectedRevision = integer(value?.expectedRevision, 'expectedRevision');
  const productFactId = canonicalDigest({ schema:'libra.product-fact-id@1', libraRunId:selected.intents[0].libraRunId,
    factKind, factRevision:expectedRevision + 1 });
  const contentProfile = observations[0].contentProfile, resolvedIdentityDigest = observations[0].identityDigest;
  if (observations.some((item) => item.contentProfile !== contentProfile || item.identityDigest !== resolvedIdentityDigest))
    fail('P9_METADATA_OBSERVATION_SCOPE', 'Observation set spans multiple identities or profiles.');
  const identityItems = observations.map((item) => ({ fetchIntentDigest:item.fetchIntentDigest,
    evidenceId:item.evidenceId, observationDigest:item.payloadDigest }));
  const set = { setId:canonicalDigest({ schema:'libra.metadata-observation-set-id@1', contentProfile,
      resolvedIdentityDigest, identityItems }), contentProfile, resolvedIdentityDigest, observations,
    sourcePrecedence:observations.map((item) => ({ fetchIntentDigest:item.fetchIntentDigest, sourcePriority:item.sourcePriority })) };
  set.setDigest = canonicalDigest(set);
  const relationItems = selected.items.map((item, ordinal) => {
    const sourceReference = { schema:'libra.product-fact-source-ref@1', productFactId, ordinal,
      sourceBasisKind:'metadata_observation', workId:item.workId, attemptId:item.attemptId, planId:item.planId,
      eventId:item.eventId, resultId:item.resultId, capabilityRef:item.capabilityRef,
      resultSchemaRef:item.resultSchemaRef, resultDigest:item.resultDigest, sourceRef:item.result.sourceRef,
      sourceOrder:ordinal, evidenceId:item.result.evidenceId, evidenceDigest:item.evidence.payloadDigest,
      inputBindingDigest:item.inputBindingDigest };
    return { ordinal, workId:item.workId, attemptId:item.attemptId, planId:item.planId, eventId:item.eventId,
      resultId:item.resultId, fetchIntentDigest:item.result.fetchIntentDigest, sourceKind:item.result.sourceKind,
      sourceRef:item.result.sourceRef, sourcePriority:item.result.sourcePriority, evidenceId:item.result.evidenceId,
      observationDigest:item.result.payloadDigest, sourceReferenceDigest:canonicalDigest(sourceReference) };
  });
  const selection = { selectionId:canonicalDigest({ schema:'libra.metadata-observation-selection-id@1',
      libraRunId:selected.intents[0].libraRunId, runExecutionBasisDigest:selected.intents[0].runExecutionBasisDigest,
      setId:set.setId, setDigest:set.setDigest }), libraRunId:selected.intents[0].libraRunId,
    runExecutionBasisDigest:selected.intents[0].runExecutionBasisDigest, setId:set.setId, setDigest:set.setDigest,
    items:relationItems };
  selection.selectionDigest = canonicalDigest(selection);
  bytes(set, metadataObservationSetByteLimit(contentProfile), 'P9_METADATA_SET_SIZE');
  return Object.freeze({ sourceBasisKind:'metadata_observation', selection:Object.freeze(selection),
    observationSet:Object.freeze(set), sourceBasisDigest:selection.selectionDigest });
}

function exactResultChain(chain, ref, options) {
  const result=chain?.result,inputBindings=chain?.inputBindings;
  if(!chain||!result||chain.workId!==ref.workId||chain.attemptId!==ref.attemptId||chain.planId!==ref.planId||
      chain.eventId!==ref.eventId||chain.resultId!==ref.resultId||chain.ownerDomain!=='libra'||
      chain.processType!=='libra_run'||chain.processId!==options.libraRunId||!['running','succeeded'].includes(chain.workState)||
      !['running','succeeded'].includes(chain.attemptState)||chain.planState!=='planned'||chain.eventState!=='succeeded'||
      chain.eventOwnerDomain!=='libra'||chain.attemptWorkId!==chain.workId||chain.planAttemptId!==chain.attemptId||
      chain.eventWorkId!==chain.workId||chain.eventAttemptId!==chain.attemptId||chain.eventPlanId!==chain.planId||
      chain.eventResultId!==chain.resultId||chain.nodeCapabilityRef!==chain.capabilityRef||
      chain.capabilityRef!==options.capabilityRef||chain.resultSchemaRef!==options.resultContractRef||
      result.schemaRef!==options.typedResultSchemaRef||canonicalDigest(result)!==chain.resultDigest||
      chain.resultDigest!==ref.resultDigest||canonicalDigest(inputBindings)!==chain.inputBindingDigest||
      chain.inputBindingDigest!==ref.inputBindingDigest)
    fail('P9_PRODUCT_FACT_SOURCE_CHAIN','Source reference is outside its exact Work to Result chain.');
  return {result,inputBindings};
}

function sourceReference(productFactId,ordinal,kind,chain,sourceRef,evidenceId,evidenceDigest){
  const reference={productFactId,ordinal,sourceBasisKind:kind,workId:chain.workId,attemptId:chain.attemptId,
    planId:chain.planId,eventId:chain.eventId,resultId:chain.resultId,capabilityRef:chain.capabilityRef,
    resultSchemaRef:chain.resultSchemaRef,resultDigest:chain.resultDigest,sourceRef,sourceOrder:ordinal,
    evidenceId,evidenceDigest,inputBindingDigest:chain.inputBindingDigest};
  reference.referenceDigest=canonicalDigest({schema:'libra.product-fact-source-ref@1',...reference});
  return Object.freeze(reference);
}

function validateWesternAnalysisVariantValue(variant){
  if(!variant||!Array.isArray(variant.analysisResults)||variant.analysisResults.length<1||variant.analysisResults.length>16)
    fail('P9_WESTERN_ANALYSIS_VARIANT','Western Analysis Variant is invalid.');
  const sorted=[...variant.analysisResults].sort((left,right)=>compare(left.eventId,right.eventId)||compare(left.resultId,right.resultId));
  if(canonicalJson(sorted)!==canonicalJson(variant.analysisResults)||new Set(sorted.map((item)=>item.eventId+'|'+item.resultId)).size!==sorted.length)
    fail('P9_WESTERN_ANALYSIS_VARIANT_ORDER','Western Analysis Results are not uniquely and canonically ordered.');
  for(const item of variant.analysisResults){
    const result=item.result,internalDigest=result&&canonicalDigest(Object.fromEntries(Object.entries(result).filter(([key])=>key!=='resultDigest')));
    if(!result||result.schemaRef!=='helix://contracts/types/WesternAnalysisResult/v1'||result.schemaVersion!==1||
        result.resultDigest!==internalDigest||item.resultDigest!==canonicalDigest(result))
      fail('P9_WESTERN_ANALYSIS_RESULT','Western Analysis Result digest continuity is invalid.');
  }
  const variantDigest=canonicalDigest({libraRunId:variant.libraRunId,runExecutionBasisDigest:variant.runExecutionBasisDigest,
    resolvedIdentityDigest:variant.resolvedIdentityDigest,analysisResults:variant.analysisResults});
  const variantId=canonicalDigest({schema:'libra.western-analysis-variant-id@1',libraRunId:variant.libraRunId,
    runExecutionBasisDigest:variant.runExecutionBasisDigest,resolvedIdentityDigest:variant.resolvedIdentityDigest,variantDigest});
  if(variant.variantDigest!==variantDigest||variant.variantId!==variantId)
    fail('P9_WESTERN_ANALYSIS_VARIANT_DIGEST','Western Analysis Variant identity is invalid.');
  return Object.freeze(bytes(variant,256*1024,'P9_WESTERN_ANALYSIS_VARIANT_SIZE'));
}

function validateWesternAnalysisVariant(variant,basis,chains){
  validateWesternAnalysisVariantValue(variant);
  if(variant.libraRunId!==basis.libraRunId||variant.runExecutionBasisDigest!==basis.runExecutionBasisDigest||
      variant.resolvedIdentityDigest!==basis.resolvedIdentityDigest||variant.variantDigest!==basis.analysisVariantDigest||
      variant.analysisResults.length!==basis.analysisRefs.length)
    fail('P9_WESTERN_ANALYSIS_VARIANT','Western Analysis Variant does not match its Basis.');
  variant.analysisResults.forEach((item,index)=>{
    const ref=basis.analysisRefs[index],chain=chains.get(ref.resultId);
    const {result}=exactResultChain(chain,ref,{libraRunId:basis.libraRunId,
      capabilityRef:'libra.western.analysis.observe@1',
      resultContractRef:capabilityResultRef('libra.western.analysis.observe@1'),
      typedResultSchemaRef:'helix://contracts/types/WesternAnalysisResult/v1'});
    if(item.eventId!==ref.eventId||item.resultId!==ref.resultId||item.resultDigest!==ref.resultDigest||
        canonicalJson(item.result)!==canonicalJson(result)||
        result.resultArtifactHandle?.artifactHandleId!==ref.analysisArtifactHandleId||
        result.resultArtifactHandle?.digestHex!==ref.analysisArtifactDigest||
        result.evidenceId!==ref.evidenceId||
        result.payloadDigest!==ref.evidenceDigest||chain.evidence?.payloadDigest!==ref.evidenceDigest)
      fail('P9_WESTERN_ANALYSIS_RESULT','Western Analysis Result continuity is invalid.');
  });
}

function buildProductFactSourceRefs(value) {
  const basis=value?.sourceBasis, chains=new Map((value?.foundationChains || []).map((item)=>[item.resultId,item]));
  if (!basis) fail('P9_PRODUCT_FACT_SOURCE_BASIS','Product Fact Source Basis is required.');
  if(basis.sourceBasisKind==='us_adult_actor'){
    const selection=assertActorSelection(basis.actorSelection),relations=value.mediaCastDraft?.relations||[],expected=actorRelation(selection),
      {relationDigest,...actual}=relations[0]||{};
    if(basis.sourceBasisDigest!==selection.selectionDigest||relations.length!==1||canonicalJson(actual)!==canonicalJson(expected)||
      relationDigest!==canonicalDigest(expected))fail('P9_US_ACTOR_SOURCE','The Media-Cast must exactly explain the selected US actor.');
    if(selection.selectionOrigin==='user_choice')return Object.freeze([]);
    const winner=selection.matchCompletion.winner,ref=winner.matchResultRef,chain=chains.get(ref.resultId),
      {result}=exactResultChain(chain,ref,{libraRunId:selection.libraRunId,capabilityRef:'shared.face.reference.match@1',
        resultContractRef:capabilityResultRef('shared.face.reference.match@1'),typedResultSchemaRef:'helix://contracts/types/PersonMatchEvidence/v1'});
    if(canonicalJson(result)!==canonicalJson(winner.personMatchEvidence)||chain.evidence?.payloadDigest!==canonicalDigest(result))
      fail('P9_US_ACTOR_SOURCE','US actor match differs from its immutable completion and formal Event Result.');
    return Object.freeze([sourceReference(text(value.productFactId,'productFactId'),0,'us_adult_actor',chain,selection.selectionId,result.evidenceId,result.payloadDigest)]);
  }
  if(basis.sourceBasisKind==='decision_evidence'){
    const ref=basis.resolutionRef,chain=ref&&chains.get(ref.resultId),productFactId=text(value?.productFactId,'productFactId');
    if(!ref||basis.libraRunId===undefined||basis.decisionEvidenceId===undefined||
        basis.sourceBasisDigest!==value.resolvedProductIdentity?.basisDigest)
      fail('P9_PRODUCT_FACT_SOURCE_BASIS','Resolved Identity Decision Evidence basis is invalid.');
    const {result}=exactResultChain(chain,ref,{libraRunId:basis.libraRunId,
      capabilityRef:'libra.product_identity.evidence.observe@1',
      resultContractRef:capabilityResultRef('libra.product_identity.evidence.observe@1'),
      typedResultSchemaRef:'helix://contracts/types/ProductIdentityEvidenceObservation/v1'});
    const providerIdentity=result.verifiedIdentity;
    const identities=value.resolvedProductIdentity?.providerIdentities||[];
    if(providerIdentity?.namespace==='internal_identity'){
      const binding=chain.inputBindings?.bindings?.find(item=>item.portName==='productIdentityEvidenceIntent'),intent=binding?.parameters?.usAdultIntent,
        display=new Map((value.resolvedProductIdentity.displayIdentity?.entries||[]).map(item=>[item.key,item.value]));
      if(!intent||binding.bindingKind!=='projected_owner_facts'||binding.ownerDomain!=='libra'||binding.processType!=='libra_run'||
        binding.processId!==basis.libraRunId||binding.projectionRef!=='helix://libra/input-projections/ProductIdentityEvidenceIntent/v1'||
        intent.libraRunId!==basis.libraRunId||intent.subjectId!==result.subjectId||intent.contentProfile!=='western_adult'||intent.sourceKind!=='internal_source'||
        display.get('title')!==providerIdentity.displayTitle||display.get('internal_identity')!==providerIdentity.providerKey||
        display.get('original_file_name')!==intent.originalName.originalFileName||display.get('original_file_name_digest')!==intent.originalName.provenanceDigest||
        canonicalJson(result)!==canonicalJson(require('./us-adult-identity-evidence').usAdultIdentityObservation(intent)))
        fail('P9_RESOLVED_IDENTITY_SOURCE_CHAIN','US Adult identity does not conserve its frozen internal source and original filename.');
    }
    if(providerIdentity?.namespace==='jav_code') {
      const binding=chain.inputBindings?.bindings?.find(item=>item.portName==='productIdentityEvidenceIntent'),intent=binding?.parameters?.javIntent;
      const display=new Map((value.resolvedProductIdentity.displayIdentity?.entries||[]).map(item=>[item.key,item.value]));
      if(!intent || binding.bindingKind!=='projected_owner_facts' || binding.ownerDomain!=='libra' ||
          binding.processType!=='libra_run' || binding.processId!==basis.libraRunId ||
          binding.projectionRef!=='helix://libra/input-projections/ProductIdentityEvidenceIntent/v1' ||
          intent.intentId!==result.intentId || display.get('title')!==providerIdentity.displayTitle ||
          display.get('jav_code')!==providerIdentity.providerKey ||
          canonicalJson(result)!==canonicalJson(require('./jav-product-identity').javIdentityObservation(intent,result.qualificationObservation)))
        fail('P9_RESOLVED_IDENTITY_SOURCE_CHAIN','JAV identity does not conserve its exact qualified source and immutable intent.');
    }
    if(providerIdentity?.namespace==='tmdb_series') {
      const binding=chain.inputBindings?.bindings?.find(item=>item.portName==='productIdentityEvidenceIntent');
      const claim=value.resolvedProductIdentity.exactSeasonContinuityClaims?.find(item=>item.claimKind==='provider_season_identity');
      const display=new Map((value.resolvedProductIdentity.displayIdentity?.entries||[]).map(item=>[item.key,item.value]));
      if(!binding||binding.bindingKind!=='projected_owner_facts'||binding.ownerDomain!=='libra'||
          binding.processType!=='libra_run'||binding.processId!==basis.libraRunId||
          binding.projectionRef!=='helix://libra/input-projections/ProductIdentityEvidenceIntent/v1'||
          binding.parameters?.sourceKind!==result.sourceKind||binding.parameters?.seasonNumber!==providerIdentity.seasonNumber||
          display.get('title')!==providerIdentity.displayTitle||display.get('tmdb_series_id')!==providerIdentity.providerKey||
          display.get('season_number')!==providerIdentity.seasonNumber||
          value.resolvedProductIdentity.exactSeasonContinuityClaims.length!==1||
          result.observationDigest!==canonicalDigest(Object.fromEntries(Object.entries(result).filter(([key])=>key!=='observationDigest')))||
          providerIdentity.identityDigest!==canonicalDigest(Object.fromEntries(Object.entries(providerIdentity).filter(([key])=>key!=='identityDigest')))||
          claim?.evidenceDigest!==result.observationDigest)
        fail('P9_RESOLVED_IDENTITY_SOURCE_CHAIN','Series identity does not conserve its exact frozen Provider intent and Evidence.');
    }
    if(result.subjectId!==value.resolvedProductIdentity.subjectId||result.result!=='resolved'||!providerIdentity||
        identities.length!==1||identities[0].provider!==providerIdentity.provider||
        identities[0].namespace!==providerIdentity.namespace||identities[0].providerKey!==providerIdentity.providerKey||
        (providerIdentity.namespace==='tmdb_series'&&(result.sourceKind==='related_nfo'||
          identities[0].seasonNumber!==providerIdentity.seasonNumber||
          result.libraRunId!==basis.libraRunId))||
        result.observationId!==ref.observationId||chain.evidence?.evidenceId!==ref.evidenceId||
        chain.evidence?.payloadDigest!==ref.evidenceDigest||ref.decisionEvidenceId!==basis.decisionEvidenceId||
        ref.decisionEvidenceDigest!==basis.decisionEvidenceDigest)
      fail('P9_RESOLVED_IDENTITY_SOURCE_CHAIN','Resolved Identity is outside its exact Work to Result chain.');
    const reference={productFactId,ordinal:0,sourceBasisKind:'decision_evidence',workId:chain.workId,
      attemptId:chain.attemptId,planId:chain.planId,eventId:chain.eventId,resultId:chain.resultId,
      capabilityRef:chain.capabilityRef,resultSchemaRef:chain.resultSchemaRef,resultDigest:chain.resultDigest,
      sourceRef:basis.decisionEvidenceId,sourceOrder:0,evidenceId:chain.evidence.evidenceId,evidenceDigest:chain.evidence.payloadDigest,
      inputBindingDigest:chain.inputBindingDigest};
    reference.referenceDigest=canonicalDigest({schema:'libra.product-fact-source-ref@1',...reference});
    if(ref.sourceReferenceDigest!==reference.referenceDigest)
      fail('P9_PRODUCT_FACT_SOURCE_DIGEST','Resolved Identity source reference digest does not match its frozen basis.');
    return Object.freeze([Object.freeze(reference)]);
  }
  if(basis.sourceBasisKind==='metadata_observation'){
    const productFactId=text(value?.productFactId,'productFactId');
    if(!Array.isArray(basis.selection?.items)||basis.selection.items.length<1||
        basis.selection.items.length>metadataObservationLimit(basis.observationSet?.contentProfile))
      fail('P9_PRODUCT_FACT_SOURCE_BASIS','A bounded Metadata Observation basis is required.');
    return Object.freeze(basis.selection.items.map((selection,ordinal)=>{
    const chain=chains.get(selection.resultId),result=chain?.result,inputBindings=chain?.inputBindings;
    if (!chain || !result || selection.ordinal !== ordinal || chain.workId !== selection.workId ||
        chain.attemptId !== selection.attemptId || chain.planId !== selection.planId || chain.eventId !== selection.eventId ||
        chain.ownerDomain !== 'libra' || chain.processType !== 'libra_run' || chain.processId !== basis.selection.libraRunId ||
        chain.workState !== 'succeeded' || chain.attemptState !== 'succeeded' || chain.planState !== 'planned' ||
        chain.eventState !== 'succeeded' || chain.eventOwnerDomain !== 'libra' || chain.attemptWorkId !== chain.workId ||
        chain.planAttemptId !== chain.attemptId || chain.nodeCapabilityRef !== chain.capabilityRef ||
        chain.eventWorkId !== chain.workId || chain.eventAttemptId !== chain.attemptId || chain.eventPlanId !== chain.planId ||
        chain.eventResultId !== chain.resultId || chain.capabilityRef !== 'libra.product_metadata.fetch@1' ||
        chain.resultSchemaRef !== capabilityResultRef('libra.product_metadata.fetch@1') ||
        result.schemaRef !== 'helix://contracts/types/MetadataObservation/v1' ||
        canonicalDigest(result) !== chain.resultDigest || canonicalDigest(inputBindings) !== chain.inputBindingDigest ||
        result.fetchIntentDigest !== selection.fetchIntentDigest || result.sourceKind !== selection.sourceKind ||
        result.sourceRef !== selection.sourceRef || result.sourcePriority !== selection.sourcePriority ||
        result.evidenceId !== selection.evidenceId || result.payloadDigest !== selection.observationDigest ||
        chain.evidence?.payloadDigest !== result.payloadDigest)
      fail('P9_PRODUCT_FACT_SOURCE_CHAIN', 'Source reference is outside its exact Work to Result chain.');
    const reference={productFactId,ordinal,sourceBasisKind:'metadata_observation',workId:chain.workId,
      attemptId:chain.attemptId,planId:chain.planId,eventId:chain.eventId,resultId:chain.resultId,
      capabilityRef:chain.capabilityRef,resultSchemaRef:chain.resultSchemaRef,resultDigest:chain.resultDigest,
      sourceRef:result.sourceRef,sourceOrder:ordinal,evidenceId:result.evidenceId,evidenceDigest:result.payloadDigest,
      inputBindingDigest:chain.inputBindingDigest};
    reference.referenceDigest=canonicalDigest({schema:'libra.product-fact-source-ref@1',...reference});
    if(reference.referenceDigest!==selection.sourceReferenceDigest)
      fail('P9_PRODUCT_FACT_SOURCE_DIGEST','Source reference digest does not match the frozen Selection.');
    return Object.freeze(reference);
    }));
  }
  const productFactId=text(value?.productFactId,'productFactId');
  if(basis.sourceBasisKind==='western_analysis'){
    const western=basis.westernBasis;
    if(!western||western.basisKind!=='western_analysis'||basis.sourceBasisDigest!==western.basisDigest||
        !Array.isArray(western.analysisRefs)||western.analysisRefs.length<1||western.analysisRefs.length>16||!western.normalizeRef)
      fail('P9_PRODUCT_FACT_SOURCE_BASIS','Western Product Metadata basis is invalid.');
    const normalizeChain=chains.get(western.normalizeRef.resultId),
      variant=normalizeChain?.inputBindings?.bindings?.find(item=>item.portName==='westernAnalysisVariant'&&item.bindingKind==='literal')?.value ||
        normalizeChain?.inputBindings?.westernAnalysisVariant || normalizeChain?.inputBindings?.capabilityInput?.westernAnalysisVariant;
    validateWesternAnalysisVariant(variant,western,chains);
    const refs=western.analysisRefs.map((ref,ordinal)=>{
      const chain=chains.get(ref.resultId);
      return sourceReference(productFactId,ordinal,'western_analysis',chain,ref.analysisArtifactHandleId,ref.evidenceId,ref.evidenceDigest);
    });
    const normalize=western.normalizeRef,{result}=exactResultChain(normalizeChain,normalize,{libraRunId:western.libraRunId,
      capabilityRef:'libra.western.metadata.normalize@1',
      resultContractRef:capabilityResultRef('libra.western.metadata.normalize@1'),
      typedResultSchemaRef:'helix://contracts/types/ProductMetadataDraft/v1'});
    if(normalize.analysisVariantId!==variant.variantId||normalize.productMetadataDraftDigest!==result.draftDigest||
        canonicalJson(result)!==canonicalJson(value.productMetadataDraft))
      fail('P9_WESTERN_NORMALIZE_RESULT','Western Normalize input or Result does not match the Commit Draft.');
    refs.push(sourceReference(productFactId,refs.length,'western_analysis',normalizeChain,variant.variantId,null,null));
    const canonicalSourceRefs=refs.map(({ordinal,capabilityRef,resultSchemaRef,workId,attemptId,planId,eventId,resultId,
      resultDigest,sourceRef,sourceOrder,evidenceId,evidenceDigest,inputBindingDigest})=>({ordinal,capabilityRef,resultSchemaRef,
      workId,attemptId,planId,eventId,resultId,resultDigest,sourceRef,sourceOrder,evidenceId,evidenceDigest,inputBindingDigest}));
    const sourceRefsDigest=canonicalDigest({schema:'libra.western-product-metadata-source-refs@1',items:canonicalSourceRefs});
    const basisId=canonicalDigest({schema:'libra.western-product-metadata-basis-id@1',libraRunId:western.libraRunId,
      runExecutionBasisDigest:western.runExecutionBasisDigest,sourceRefsDigest});
    const basisDigest=canonicalDigest(Object.fromEntries(Object.entries(western).filter(([key])=>key!=='basisDigest')));
    if(western.sourceRefsDigest!==sourceRefsDigest||western.basisId!==basisId||western.basisDigest!==basisDigest)
      fail('P9_WESTERN_METADATA_BASIS_DIGEST','Western Product Metadata basis identity is invalid.');
    return Object.freeze(refs);
  }
  if(basis.sourceBasisKind==='western_match'){
    const western=basis.westernBasis,ref=western?.matchRef,chain=ref&&chains.get(ref.resultId);
    if(!western||western.basisKind!=='western_match'||basis.sourceBasisDigest!==western.basisDigest||!ref)
      fail('P9_PRODUCT_FACT_SOURCE_BASIS','Western Media Cast basis is invalid.');
    const {result}=exactResultChain(chain,ref,{libraRunId:western.libraRunId,
      capabilityRef:'shared.face.reference.match@1',
      resultContractRef:capabilityResultRef('shared.face.reference.match@1'),
      typedResultSchemaRef:'helix://contracts/types/PersonMatchEvidence/v1'});
    const matchState=result.matches?.length?'matches_found':'no_matches';
    const relations=value.mediaCastDraft?.relations||[];
    const allMatchesExplained=(result.matches||[]).every((match)=>relations.some((relation)=>relation.personId===match.personId&&
      relation.confidenceClass===match.confidenceClass&&relation.originEvidenceDigest===match.evidenceDigest));
    if(result.evidenceId!==ref.evidenceId||result.payloadDigest!==ref.evidenceDigest||chain.evidence?.payloadDigest!==ref.evidenceDigest||
        result.payloadDigest!==ref.personMatchEvidenceDigest||
        result.referenceProjectionSetDigest!==western.referenceProjectionSetDigest||
        western.matchState!==matchState||
        (matchState==='no_matches'&&relations.length!==0)||(matchState==='matches_found'&&(!relations.length||!allMatchesExplained)))
      fail('P9_WESTERN_MATCH_RESULT','Western match Evidence does not explain the Media Cast Draft.');
    const basisId=canonicalDigest({schema:'libra.western-media-cast-basis-id@1',libraRunId:western.libraRunId,
      runExecutionBasisDigest:western.runExecutionBasisDigest,matchResultId:ref.resultId,matchResultDigest:ref.resultDigest,
      referenceProjectionSetDigest:western.referenceProjectionSetDigest});
    const basisDigest=canonicalDigest(Object.fromEntries(Object.entries(western).filter(([key])=>key!=='basisDigest')));
    if(western.basisId!==basisId||western.basisDigest!==basisDigest)
      fail('P9_WESTERN_MATCH_BASIS_DIGEST','Western Media Cast basis identity is invalid.');
    return Object.freeze([sourceReference(productFactId,0,'western_match',chain,result.evidenceId,result.evidenceId,result.payloadDigest)]);
  }
  fail('P9_PRODUCT_FACT_SOURCE_BASIS','Product Fact Source Basis kind is invalid.');
}

function descriptiveEntries(observation) {
  const record = observation?.descriptiveFacts;
  if (!record || !Array.isArray(record.entries)) fail('P9_METADATA_FACTS', 'Observation descriptive facts are invalid.');
  return record.entries;
}

function buildProductMetadataDraft(value) {
  const basis = value?.sourceBasis;
  if (!basis || basis.sourceBasisKind !== 'metadata_observation') fail('P9_METADATA_DRAFT_BASIS', 'Observation basis is required.');
  const required = [...(value.requiredFields || [])];
  const jav=basis.observationSet.contentProfile==='jav';
  if(jav && (basis.observationSet.observations.length!==1 || basis.observationSet.observations[0].sourceKind!=='provider'))
    fail('P9_JAV_METADATA_SINGLE_SOURCE','JAV metadata cannot combine different source observations.');
  if(value.episodeScopes!==undefined&&!Array.isArray(value.episodeScopes))
    fail('P9_METADATA_EPISODE_SCOPE','Season Draft requires a typed Episode scope array.');
  const episodeScopes = value.episodeScopes === undefined ? null : value.episodeScopes.map(buildEpisodeMetadataScope);
  if (episodeScopes && (!episodeScopes.length || episodeScopes.length > 256 || value.episodeScope ||
      basis.observationSet.contentProfile !== 'series' ||
      new Set(episodeScopes.map(scope => scope.episodeKey)).size !== episodeScopes.length ||
      canonicalJson(episodeScopes) !== canonicalJson([...episodeScopes].sort((a,b)=>compare(a.episodeKey,b.episodeKey)))))
    fail('P9_METADATA_EPISODE_SCOPE', 'Season Draft requires a unique frozen ordered Episode scope.');
  if (required.length > 256 || required.some((item) => typeof item !== 'string' || !item)) fail('P9_METADATA_REQUIREMENTS', 'Required fields are invalid.');
  const episodeScope = value.episodeScope === undefined ? null : buildEpisodeMetadataScope(value.episodeScope);
  const winners = new Map(), provenance = [];
  for (const observation of basis.observationSet.observations) {
    if (observation.episodeScope && (!episodeScope ||
        canonicalJson(observation.episodeScope) !== canonicalJson(episodeScope))) continue;
    for (const entry of descriptiveEntries(observation)) {
      if (episodeScope && !observation.episodeScope && !required.includes(entry.key)) continue;
      if (observation.contentProfile === 'series' && entry.key.startsWith('episode_') && !observation.episodeScope) continue;
      if (episodeScope && entry.key === 'season_number' && !observation.episodeScope) continue;
      if (!winners.has(entry.key) && entry.value !== null && entry.value !== '') {
        winners.set(entry.key, entry.value);
        provenance.push({ fieldPath:entry.key, sourceKind:observation.sourceKind, sourceRef:observation.sourceRef,
          evidenceDigest:observation.payloadDigest });
      }
    }
  }
  const missingFields = required.filter((field) => (!episodeScopes || !field.startsWith('episode_')) && !winners.has(field));
  if (missingFields.length) return Object.freeze({ ready:false, missingFields:Object.freeze(missingFields) });
  const artifactRequirements = (value.artifactRequirements || []).map(validateArtifactRequirement);
  const sortedRequirements = [...artifactRequirements].sort((left, right) => compare(left.artifactKind, right.artifactKind) ||
    compare(left.requirementId, right.requirementId) || left.revision - right.revision);
  if (artifactRequirements.length > 256 || canonicalJson(artifactRequirements) !== canonicalJson(sortedRequirements) ||
      new Set(artifactRequirements.map((item) => item.artifactKind + '|' + item.requirementId + '|' + item.revision)).size !== artifactRequirements.length)
    fail('P9_ARTIFACT_REQUIREMENT_ORDER', 'Artifact Requirements must be unique and canonically sorted.');
  const draft = { schemaRef:'helix://contracts/types/ProductMetadataDraft/v1', schemaVersion:1,
    draftId:'', draftKind:'product_metadata', basisDigest:basis.sourceBasisDigest, draftDigest:'', producedAtMs:integer(value.producedAtMs, 'producedAtMs'),
    resolvedIdentityDigest:basis.observationSet.resolvedIdentityDigest, sourceBasisKind:'metadata_observation',
    metadataObservationSetDigest:basis.observationSet.setDigest, westernAnalysisVariantDigest:null,
    fieldProvenance:provenance, descriptiveFacts:{ schemaRef:'helix://contracts/records/descriptive-facts/v1', schemaVersion:1,
      recordKind:'descriptive-facts', recordDigest:'', entries:[...winners].map(([key, itemValue]) => ({ key, value:itemValue })).sort((a,b)=>compare(a.key,b.key)) },
    providerIdentities:[...(value.providerIdentities || [])], artifactRequirements };
  if(jav)draft.javSelectedSource=require('../../../contracts/jav-selected-source').assertJavSelectedSource(basis.observationSet.observations[0].javSelectedSource);
  if(basis.observationSet.contentProfile==='series'&&!episodeScope){
    const source=basis.observationSet.observations.find(item=>item.seriesPresentationSource&&!item.episodeScope);
    if(source)draft.seriesPresentationBasis=require('../../../contracts/series-presentation-basis').buildSeriesPresentationBasis(source);
  }
  if (episodeScope) {
    const numbers = new Map(draft.descriptiveFacts.entries.map(item => [item.key, item.value]));
    if (numbers.get('season_number') !== episodeScope.seasonNumber || numbers.get('episode_number') !== episodeScope.episodeNumber)
      fail('P9_METADATA_EPISODE_SCOPE', 'Episode Draft must conserve its exact observed Season/Episode numbers.');
    draft.episodeScope = episodeScope;
  }
  if (episodeScopes) {
    const episodeMetadata=[];
    for (const scope of episodeScopes) {
      const projected=buildProductMetadataDraft({ ...value, episodeScopes:undefined, episodeScope:scope,
        requiredFields:[...new Set(['season_number','episode_number','series_title',...required.filter(field=>field.startsWith('episode_'))])].sort(compare) });
      if(!projected.ready)return Object.freeze({ready:false,missingFields:projected.missingFields,episodeKey:scope.episodeKey});
      episodeMetadata.push(Object.freeze({episodeScope:scope,descriptiveFacts:projected.draft.descriptiveFacts,
        fieldProvenance:projected.draft.fieldProvenance}));
    }
    draft.episodeMetadata=Object.freeze(episodeMetadata);
  }
  draft.descriptiveFacts.recordDigest = canonicalDigest(Object.fromEntries(Object.entries(draft.descriptiveFacts).filter(([key]) => key !== 'recordDigest')));
  draft.draftId = canonicalDigest({ schema:'libra.product-metadata-draft-id@1', resolvedIdentityDigest:draft.resolvedIdentityDigest,
    sourceBasisDigest:basis.sourceBasisDigest, descriptiveFactsDigest:draft.descriptiveFacts.recordDigest });
  draft.draftDigest = canonicalDigest(Object.fromEntries(Object.entries(draft).filter(([key]) => key !== 'draftDigest')));
  if (draft.episodeMetadata) metadataSetRef(draft.episodeMetadata);
  return Object.freeze({ ready:true, draft:Object.freeze(bytes(draft, draft.episodeMetadata ? SET_LIMIT : 64 * 1024, 'P9_METADATA_DRAFT_SIZE')) });
}

function buildWesternProductMetadataDraft(value) {
  const variant=validateWesternAnalysisVariantValue(value?.analysisVariant),required=[...(value?.requiredFields||[])];
  const entries=[...(value?.descriptiveFacts||[])].map((item)=>({key:text(item?.key,'key'),value:item?.value}));
  const sortedEntries=[...entries].sort((left,right)=>compare(left.key,right.key));
  if(required.length>256||required.some((item)=>typeof item!=='string'||!item)||entries.length>256||
      canonicalJson(entries)!==canonicalJson(sortedEntries)||new Set(entries.map((item)=>item.key)).size!==entries.length)
    fail('P9_WESTERN_METADATA_FIELDS','Western metadata fields are invalid.');
  const missingFields=required.filter((field)=>!entries.some((item)=>item.key===field&&item.value!==null&&item.value!==''));
  if(missingFields.length)return Object.freeze({ready:false,missingFields:Object.freeze(missingFields.sort(compare))});
  const sourceEvidence=new Set(variant.analysisResults.map((item)=>
    item.result.resultArtifactHandle.artifactHandleId+'|'+item.result.payloadDigest));
  const fieldProvenance=[...(value?.fieldProvenance||[])].map((item)=>({fieldPath:text(item?.fieldPath,'fieldPath'),
    sourceKind:item?.sourceKind,sourceRef:text(item?.sourceRef,'sourceRef'),evidenceDigest:digest(item?.evidenceDigest,'evidenceDigest')}));
  const sortedProvenance=[...fieldProvenance].sort((left,right)=>compare(left.fieldPath,right.fieldPath)||compare(left.sourceRef,right.sourceRef));
  if(fieldProvenance.length!==entries.length||canonicalJson(fieldProvenance)!==canonicalJson(sortedProvenance)||
      new Set(fieldProvenance.map((item)=>item.fieldPath)).size!==fieldProvenance.length||
      fieldProvenance.some((item)=>item.sourceKind!=='western_analysis'||!sourceEvidence.has(item.sourceRef+'|'+item.evidenceDigest)||
        !entries.some((entry)=>entry.key===item.fieldPath)))
    fail('P9_WESTERN_METADATA_PROVENANCE','Western metadata fields lack exact Analysis provenance.');
  if((value?.providerIdentities||[]).length!==0)
    fail('P9_WESTERN_METADATA_PROVIDER','Western metadata cannot invent Provider identities.');
  const artifactRequirements=(value?.artifactRequirements||[]).map(validateArtifactRequirement),sortedRequirements=[...artifactRequirements]
    .sort((left,right)=>compare(left.artifactKind,right.artifactKind)||compare(left.requirementId,right.requirementId)||left.revision-right.revision);
  if(artifactRequirements.length>256||canonicalJson(artifactRequirements)!==canonicalJson(sortedRequirements)||
      new Set(artifactRequirements.map((item)=>item.artifactKind+'|'+item.requirementId+'|'+item.revision)).size!==artifactRequirements.length)
    fail('P9_ARTIFACT_REQUIREMENT_ORDER','Artifact Requirements must be unique and canonically sorted.');
  const descriptiveFacts={schemaRef:'helix://contracts/records/descriptive-facts/v1',schemaVersion:1,
    recordKind:'descriptive-facts',recordDigest:'',entries};
  descriptiveFacts.recordDigest=canonicalDigest(Object.fromEntries(Object.entries(descriptiveFacts).filter(([key])=>key!=='recordDigest')));
  const draft={schemaRef:'helix://contracts/types/ProductMetadataDraft/v1',schemaVersion:1,draftId:'',draftKind:'product_metadata',
    basisDigest:variant.variantDigest,draftDigest:'',producedAtMs:integer(value?.producedAtMs,'producedAtMs'),
    resolvedIdentityDigest:variant.resolvedIdentityDigest,sourceBasisKind:'western_analysis',metadataObservationSetDigest:null,
    westernAnalysisVariantDigest:variant.variantDigest,fieldProvenance,descriptiveFacts,providerIdentities:[],artifactRequirements};
  draft.draftId=canonicalDigest({schema:'libra.product-metadata-draft-id@1',resolvedIdentityDigest:draft.resolvedIdentityDigest,
    sourceBasisDigest:variant.variantDigest,descriptiveFactsDigest:descriptiveFacts.recordDigest});
  draft.draftDigest=canonicalDigest(Object.fromEntries(Object.entries(draft).filter(([key])=>key!=='draftDigest')));
  return Object.freeze({ready:true,draft:Object.freeze(bytes(draft,64*1024,'P9_METADATA_DRAFT_SIZE'))});
}

function buildMediaCastDraft(value) {
  const basis = value?.sourceBasis, subjectId = text(value?.subjectId, 'subjectId');
  if (!basis || !['metadata_observation', 'western_match','us_adult_actor'].includes(basis.sourceBasisKind))
    fail('P9_MEDIA_CAST_BASIS', 'Media Cast requires a closed Source Basis.');
  const projection = new Map((value.personProjection?.items || []).map((item) => [item.personId, item]));
  const relations = (value.relations || []).map((item) => {
    const relation = { relationId:text(item?.relationId, 'relationId'), personId:item?.personId || null,
      displayName:text(item?.displayName, 'displayName'), displayNameNormalized:text(item?.displayNameNormalized, 'displayNameNormalized'),
      role:text(item?.role, 'role'), source:text(item?.source, 'source'), providerIdentities:[...(item?.providerIdentities || [])],
      originEvidenceDigest:digest(item?.originEvidenceDigest, 'originEvidenceDigest'),
      confidenceClass:text(item?.confidenceClass, 'confidenceClass') };
    if (relation.personId !== null) {
      const person = projection.get(relation.personId);
      if (!person || !DIGEST.test(person.projectionDigest || '')) fail('P9_MEDIA_CAST_PERSON_PROJECTION', 'Person relation lacks a formal Projection.');
    }
    relation.relationDigest = canonicalDigest(relation);
    return Object.freeze(relation);
  });
  const sorted = [...relations].sort((left, right) => compare(left.role, right.role) ||
    compare(left.displayNameNormalized, right.displayNameNormalized) || compare(left.relationId, right.relationId));
  if (new Set(sorted.map((item) => item.relationId)).size !== sorted.length || canonicalJson(relations) !== canonicalJson(sorted))
    fail('P9_MEDIA_CAST_RELATIONS', 'Media Cast relations must be unique and canonically sorted.');
  if (basis.observationSet?.contentProfile === 'jav' && !sorted.some(item => item.role === 'actor'))
    fail('P9_JAV_ACTOR_REQUIRED', 'JAV Media Cast requires a real or reserved unknown actor.');
  if (basis.sourceBasisKind === 'western_match') {
    if (basis.westernBasis?.matchState === 'no_matches' && relations.length !== 0 ||
        basis.westernBasis?.matchState === 'matches_found' && relations.length === 0) {
      fail('P9_MEDIA_CAST_MATCH_CONTINUITY', 'Western match state and relations disagree.');
    }
  }
  if(basis.sourceBasisKind==='us_adult_actor'){
    const selection=assertActorSelection(basis.actorSelection),person=selectedPerson(selection),expected=actorRelation(selection),
      {relationDigest,...actual}=sorted[0]||{};
    if(selection.subjectId!==subjectId||basis.sourceBasisDigest!==selection.selectionDigest||sorted.length!==1||
      canonicalJson(actual)!==canonicalJson(expected)||canonicalJson(projection.get(person.personId))!==canonicalJson(person.referenceProjection))
      fail('P9_US_ACTOR_REQUIRED','US Media-Cast requires exactly its selected actor, reference version and explicit origin.');
  }
  const draft = { schemaRef:'helix://contracts/types/MediaCastDraft/v1', schemaVersion:1, draftId:'',
    draftKind:'media_cast', basisDigest:basis.sourceBasisDigest, draftDigest:'', producedAtMs:integer(value.producedAtMs, 'producedAtMs'),
    subjectId, sourceBasisKind:basis.sourceBasisKind,
    metadataObservationSetDigest:basis.sourceBasisKind === 'metadata_observation' ? basis.observationSet.setDigest : null,
    westernMatchBasisDigest:basis.sourceBasisKind === 'western_match' ? basis.westernBasis.basisDigest : null,
    ...(basis.sourceBasisKind==='us_adult_actor'?{usAdultActorBasisDigest:basis.sourceBasisDigest}:{}),relations:sorted };
  draft.draftId = canonicalDigest({ schema:'libra.media-cast-draft-id@1', subjectId,
    sourceBasisKind:draft.sourceBasisKind, sourceBasisDigest:basis.sourceBasisDigest,
    relationsDigest:canonicalDigest({ schema:'libra.media-cast-relations@1', relations:sorted }) });
  draft.draftDigest = canonicalDigest(Object.fromEntries(Object.entries(draft).filter(([key]) => key !== 'draftDigest')));
  return Object.freeze(bytes(draft, 64 * 1024, 'P9_MEDIA_CAST_DRAFT_SIZE'));
}

function selectSeriesMediaCastObservation(observations) {
  const candidates = observations.filter((item) => item.episodeScope && item.peopleHints?.length);
  for (const item of candidates) buildEpisodeMetadataScope(item.episodeScope);
  candidates.sort((left, right) => left.episodeScope.episodeNumber - right.episodeScope.episodeNumber ||
    left.sourcePriority - right.sourcePriority || compare(left.evidenceId, right.evidenceId));
  return candidates[0] || null;
}

function buildMetadataMediaCastRelations(value) {
  const subjectId = text(value?.subjectId, 'subjectId');
  let observations = value?.sourceBasis?.observationSet?.observations;
  if (!Array.isArray(observations)) {
    fail('P9_MEDIA_CAST_BASIS',
      'Metadata Media Cast relations require a closed Observation Set.');
  }
  if (value.sourceBasis.observationSet.contentProfile === 'series') {
    // A Season cast is represented by one Episode source, not a union of all Episodes.
    const selected = selectSeriesMediaCastObservation(observations);
    observations = selected ? [selected] : [];
  }
  const relations = [];
  const claimedProviderIdentities = new Set();
  const claimedRelations = new Set();
  for (const observation of observations) {
    for (const hint of observation.peopleHints || []) {
      const identityKeys = (hint.providerIdentities || [])
        .filter((identity) => identity &&
          typeof identity.provider === 'string' && identity.provider &&
          typeof identity.namespace === 'string' && identity.namespace &&
          typeof identity.providerKey === 'string' && identity.providerKey)
        .map((identity) => canonicalJson({
          provider: identity.provider,
          namespace: identity.namespace,
          providerKey: identity.providerKey,
        }));
      if (identityKeys.some((key) => claimedProviderIdentities.has(key))) {
        continue;
      }
      const seed = {
        subjectId,
        role: hint.role,
        displayName: hint.displayName,
        providerIdentities: hint.providerIdentities || [],
        originEvidenceDigest: observation.payloadDigest,
      };
      const relationId = 'libra-media-cast-relation-' +
        canonicalDigest(seed).slice(0, 40);
      // Repeated source assertions are one relation, without merging unknown people across observations.
      if(claimedRelations.has(relationId))continue;
      claimedRelations.add(relationId);
      relations.push(Object.freeze({
        relationId,
        personId: null,
        displayName: hint.displayName,
        displayNameNormalized: hint.displayName.normalize('NFKC').toLowerCase(),
        role: hint.role,
        source: observation.sourceRef,
        providerIdentities: Object.freeze([...(hint.providerIdentities || [])]),
        originEvidenceDigest: observation.payloadDigest,
        confidenceClass: 'provider_asserted',
      }));
      for (const key of identityKeys) claimedProviderIdentities.add(key);
    }
  }
  if (value.sourceBasis.observationSet.contentProfile === 'jav' && !relations.some(item => item.role === 'actor')) {
    const { JAV_UNKNOWN_ACTOR_ID, JAV_UNKNOWN_ACTOR_NAME } = require('../../../contracts/jav-actor-policy');
    const originEvidenceDigest = canonicalDigest({ schema: 'libra.jav-unknown-actor@1', subjectId, sourceBasisDigest: value.sourceBasis.sourceBasisDigest });
    relations.push(Object.freeze({ relationId: 'libra-media-cast-relation-' + originEvidenceDigest.slice(0, 40),
      personId: JAV_UNKNOWN_ACTOR_ID, displayName: JAV_UNKNOWN_ACTOR_NAME, displayNameNormalized: JAV_UNKNOWN_ACTOR_NAME,
      role: 'actor', source: 'system:jav-unknown-actor@1', providerIdentities: Object.freeze([]), originEvidenceDigest,
      confidenceClass: 'system_unknown_actor' }));
  }
  return Object.freeze(relations.sort((left, right) =>
    compare(left.role, right.role) ||
    compare(left.displayNameNormalized, right.displayNameNormalized) ||
    compare(left.relationId, right.relationId)));
}

function validateVerifiedArtifactManifest(value, context) {
  if (!value || value.libraRunId === undefined || !Array.isArray(value.items) || value.items.length > 256)
    fail('P9_ARTIFACT_MANIFEST', 'Verified Artifact Manifest is invalid.');
  const snapshots = new Map((context?.artifactSnapshots || []).map((item) =>
    [item.artifactHandleId + '|' + item.referenceRevision, item]));
  const requirements = new Map((context?.artifactRequirements || []).map(validateArtifactRequirement).map((item) =>
    [item.requirementId + '|' + item.revision + '|' + item.schemaRef + '|' + item.requirementDigest, item]));
  const bindings = new Map((context?.verificationBindings || []).map((item) => [item.resultId, item]));
  const items = value.items.map((item, ordinal) => {
    if (item.ordinal !== ordinal) fail('P9_ARTIFACT_MANIFEST_ORDER', 'Artifact ordinals must be contiguous from zero.');
    const snapshot = snapshots.get(item.artifactHandleId + '|' + item.artifactRevision);
    if (!snapshot || snapshot.state !== 'active' || snapshot.artifactKind !== item.artifactKind ||
        snapshot.digestHex !== item.artifactDigest) {
      fail('P9_ARTIFACT_HANDLE_MISMATCH', 'Artifact item does not match the immutable Registry Handle.');
    }
    const requirement = requirements.get(item.requirementId + '|' + item.requirementRevision + '|' +
      item.requirementSchemaRef + '|' + item.requirementDigest);
    if (!requirement || requirement.artifactKind !== item.artifactKind)
      fail('P9_ARTIFACT_REQUIREMENT_MISMATCH', 'Artifact item does not match a Draft Requirement.');
    const ref = item.verificationResultRef, binding = bindings.get(ref?.resultId), result = binding?.result;
    const capabilityInput = binding?.inputBindings?.capabilityInput ||
      binding?.inputBindings;
    const {state:_artifactState,...artifactInputHandle}=snapshot||{};
    const exactRuntimeInput={artifactHandleList:[artifactInputHandle],artifactRequirement:requirement};
    const runtimeInputMatches=typeof binding?.inputSnapshotDigest==='string'
      ?binding.inputSnapshotDigest===canonicalDigest(exactRuntimeInput)
      :canonicalJson(capabilityInput?.artifactRequirement)===canonicalJson(requirement)&&
        canonicalJson(capabilityInput?.artifactHandleList)===canonicalJson([artifactInputHandle]);
    if (!binding || !result || ref.workId !== binding.workId || ref.attemptId !== binding.attemptId ||
        ref.planId !== binding.planId || ref.eventId !== binding.eventId ||
        binding.ownerDomain !== 'libra' || binding.processType !== 'libra_run' || binding.processId !== value.libraRunId ||
        binding.workState !== 'succeeded' || binding.attemptState !== 'succeeded' || binding.planState !== 'planned' ||
        binding.eventState !== 'succeeded' || binding.eventOwnerDomain !== 'libra' ||
        binding.attemptWorkId !== binding.workId || binding.planAttemptId !== binding.attemptId ||
        binding.eventWorkId !== binding.workId || binding.eventAttemptId !== binding.attemptId ||
        binding.eventPlanId !== binding.planId || binding.eventResultId !== binding.resultId ||
        binding.nodeCapabilityRef !== binding.capabilityRef ||
        ref.capabilityRef !== 'shared.artifact.manifest.verify@1' || ref.capabilityRef !== binding.capabilityRef ||
        ref.resultSchemaRef !== 'helix://contracts/types/ArtifactManifestVerification/v1' ||
        binding.resultSchemaRef !== capabilityResultRef('shared.artifact.manifest.verify@1') || ref.resultDigest !== binding.resultDigest ||
        ref.inputBindingDigest !== binding.inputBindingDigest || canonicalDigest(result) !== ref.resultDigest ||
        canonicalDigest(binding.inputBindings) !== ref.inputBindingDigest ||
        !runtimeInputMatches ||
        result.result !== 'passed' || result.verificationId !== item.verificationEvidenceId ||
        result.verificationDigest !== item.verificationEvidenceDigest ||
        result.requirement?.requirementDigest !== requirement.requirementDigest ||
        result.verificationDigest !== canonicalDigest(Object.fromEntries(
          Object.entries(result).filter(([key]) => key !== 'verificationDigest'))))
      fail('P9_ARTIFACT_VERIFICATION_CHAIN', 'Artifact item does not match its explicit verification Result chain.');
    const verified = (result.verifiedArtifacts || []).find((candidate) => candidate.artifactHandleId === item.artifactHandleId &&
      candidate.artifactRevision === item.artifactRevision);
    const inputHandle = (typeof binding?.inputSnapshotDigest==='string'?exactRuntimeInput.artifactHandleList:
      capabilityInput?.artifactHandleList || []).find((candidate) =>
      candidate.artifactHandleId === item.artifactHandleId && candidate.referenceRevision === item.artifactRevision);
    if (!verified || !inputHandle || verified.artifactKind !== item.artifactKind || verified.artifactDigest !== item.artifactDigest ||
        verified.referenceDigest !== canonicalDigest(Object.fromEntries(
          Object.entries(verified).filter(([key]) => key !== 'referenceDigest'))) ||
        inputHandle.artifactKind !== item.artifactKind || inputHandle.digestHex !== item.artifactDigest)
      fail('P9_ARTIFACT_VERIFICATION_ITEM', 'Artifact item is absent from the explicit verification input or Result.');
    const canonical = { ordinal, artifactHandleId:text(item.artifactHandleId, 'artifactHandleId'),
      artifactKind:text(item.artifactKind, 'artifactKind'), artifactRevision:integer(item.artifactRevision, 'artifactRevision', 1),
      artifactDigest:digest(item.artifactDigest, 'artifactDigest'), requirementId:text(item.requirementId, 'requirementId'),
      requirementRevision:integer(item.requirementRevision, 'requirementRevision', 1),
      requirementSchemaRef:text(item.requirementSchemaRef, 'requirementSchemaRef'),
      requirementDigest:digest(item.requirementDigest, 'requirementDigest'),
      verificationEvidenceId:text(item.verificationEvidenceId, 'verificationEvidenceId'),
      verificationEvidenceDigest:digest(item.verificationEvidenceDigest, 'verificationEvidenceDigest'),
      verificationResultRef:{ workId:ref.workId, attemptId:ref.attemptId, planId:ref.planId, eventId:ref.eventId,
        resultId:ref.resultId, capabilityRef:ref.capabilityRef, resultSchemaRef:ref.resultSchemaRef,
        resultDigest:ref.resultDigest, inputBindingDigest:ref.inputBindingDigest } };
    canonical.referenceDigest = canonicalDigest(canonical);
    if (item.referenceDigest !== canonical.referenceDigest) fail('P9_ARTIFACT_REFERENCE_DIGEST', 'Artifact reference digest is invalid.');
    return Object.freeze(canonical);
  });
  const sorted = [...items].sort((left, right) => compare(left.artifactKind, right.artifactKind) ||
    compare(left.artifactHandleId, right.artifactHandleId) || left.artifactRevision - right.artifactRevision);
  if (canonicalJson(items) !== canonicalJson(sorted)) fail('P9_ARTIFACT_MANIFEST_ORDER', 'Artifact items are not canonically sorted.');
  const artifactSetDigest = canonicalDigest({ schema:'libra.verified-artifact-set@1', items });
  const manifestId = canonicalDigest({ schema:'libra.verified-artifact-manifest-id@1', libraRunId:value.libraRunId, artifactSetDigest });
  const manifest = { manifestId, libraRunId:text(value.libraRunId, 'libraRunId'), items, artifactSetDigest };
  manifest.manifestDigest = canonicalDigest(manifest);
  if (value.manifestId !== manifestId || value.artifactSetDigest !== artifactSetDigest || value.manifestDigest !== manifest.manifestDigest)
    fail('P9_ARTIFACT_MANIFEST_DIGEST', 'Artifact Manifest identity or digest is invalid.');
  return Object.freeze(bytes(manifest, 256 * 1024, 'P9_ARTIFACT_MANIFEST_SIZE'));
}

function buildProductFactHandle(value) {
  const factKind = value?.factKind;
  if (!['media_cast', 'product_metadata', 'resolved_identity'].includes(factKind)) {
    fail('P9_PRODUCT_FACT_KIND', 'Product Fact kind is invalid.');
  }
  const libraRunId = text(value.libraRunId, 'libraRunId'), expectedRevision = integer(value.expectedRevision, 'expectedRevision');
  const payloadDigest = digest(value.payloadDigest, 'payloadDigest'), eventFenceDigest = digest(value.eventFenceDigest, 'eventFenceDigest');
  const aggregateType = 'libra_product_fact';
  const aggregateId = canonicalDigest({ schema:'libra.product-fact-aggregate-id@1', libraRunId, factKind });
  const resultType = factKind === 'media_cast'
    ? 'MediaCastFact'
    : factKind === 'product_metadata'
      ? 'ProductMetadataFact'
      : 'ResolvedProductIdentity';
  const resultSchemaRef = 'helix://contracts/types/' + resultType + '/v1';
  const commitIdempotencyKey = canonicalDigest({ schema:'libra.product-fact-commit-key@1', aggregateId,
    expectedRevision, payloadDigest, eventFenceDigest });
  const handle = { schemaRef:'helix://contracts/types/DomainFactCommitHandle/v1', schemaVersion:1, handleId:'', ownerDomain:'libra',
    aggregateType, aggregateId, factType:factKind, factSchemaRef:resultSchemaRef, expectedRevision, payloadDigest,
    resultSchemaRef, eventFenceDigest, commitIdempotencyKey };
  handle.handleId = canonicalDigest({ schema:'libra.product-fact-commit-handle-id@1', aggregateId, factKind,
    expectedRevision, payloadDigest, resultSchemaRef, eventFenceDigest });
  return Object.freeze(handle);
}

function buildResolvedProductIdentity(value) {
  const providerIdentities = [...(value?.providerIdentities || [])].map((item) => {
    const result = {
      provider: text(item?.provider, 'provider'),
      namespace: text(item?.namespace, 'namespace'),
      providerKey: text(item?.providerKey, 'providerKey'),
      seasonNumber: item?.seasonNumber ?? null,
    };
    result.identityAnchorDigest = canonicalDigest(result);
    return Object.freeze(result);
  }).sort((left, right) => compare(left.provider, right.provider) ||
    compare(left.namespace, right.namespace) ||
    compare(left.providerKey, right.providerKey));
  if (providerIdentities.length < 1 || providerIdentities.length > 16 ||
      new Set(providerIdentities.map((item) =>
        item.provider + '|' + item.namespace + '|' + item.providerKey + '|' +
        String(item.seasonNumber))).size !== providerIdentities.length) {
    fail('P9_RESOLVED_IDENTITY_PROVIDERS',
      'Resolved provider identities must be unique and canonically sorted.');
  }
  const exactSeasonContinuityClaims = Object.freeze([
    ...(value.exactSeasonContinuityClaims || []),
  ]);
  if(value.contentProfile==='series'||value.identityKind==='tmdb_series_season') {
    const anchors=providerIdentities.filter(item=>item.provider==='tmdb'&&item.namespace==='tmdb_series');
    const anchor=anchors[0],claims=exactSeasonContinuityClaims.filter(item=>item.claimKind==='provider_season_identity');
    if(value.contentProfile!=='series'||value.structureKind!=='season'||value.identityKind!=='tmdb_series_season'||
        anchors.length!==1||!/^\d+$/.test(anchor.providerKey)||!Number.isSafeInteger(anchor.seasonNumber)||anchor.seasonNumber<1||
        claims.length!==1||claims[0].claimNamespace!=='tmdb'||claims[0].claimKey!=='series:'+anchor.providerKey+':season:'+anchor.seasonNumber||
        claims[0].claimDigest!==canonicalDigest({schema:'season-continuity-claim@1',claimKind:claims[0].claimKind,
          claimNamespace:claims[0].claimNamespace,claimKey:claims[0].claimKey})||!DIGEST.test(claims[0].evidenceDigest||''))
      fail('P9_RESOLVED_IDENTITY_SEASON','Series identity and its exact Provider Season continuity claim disagree.');
  } else if(exactSeasonContinuityClaims.length)fail('P9_RESOLVED_IDENTITY_SEASON','Only Series may publish Season continuity claims.');
  const displayEntries = [...(value?.displayEntries || [])]
    .map((item) => ({ key:text(item?.key, 'displayIdentity.key'), value:item?.value }))
    .sort((left, right) => compare(left.key, right.key));
  const displayIdentity = {
    schemaRef: 'helix://contracts/records/display-identity/v1',
    schemaVersion: 1,
    recordKind: 'display-identity',
    recordDigest: '',
    entries: displayEntries,
  };
  displayIdentity.recordDigest = canonicalDigest(Object.fromEntries(
    Object.entries(displayIdentity).filter(([key]) => key !== 'recordDigest'),
  ));
  const result = {
    schemaRef: 'helix://contracts/types/ResolvedProductIdentity/v1',
    schemaVersion: 1,
    evidenceId: '',
    evidenceKind: 'resolved_product_identity',
    producerRef: text(value?.producerRef, 'producerRef'),
    basisDigest: digest(value?.basisDigest, 'basisDigest'),
    payloadDigest: '',
    observedAtMs: integer(value?.observedAtMs, 'observedAtMs'),
    subjectId: text(value?.subjectId, 'subjectId'),
    structureKind: value?.structureKind,
    contentProfile: value?.contentProfile,
    identityKind: value?.identityKind,
    providerIdentities: Object.freeze(providerIdentities),
    providerIdentitySetDigest: canonicalDigest({
      schema: 'libra.resolved-provider-identity-set@1',
      items: providerIdentities,
    }),
    exactSeasonContinuityClaims,
    exactSeasonContinuitySetDigest: canonicalDigest({
      schema: 'libra.resolved-season-continuity-set@1',
      items: exactSeasonContinuityClaims,
    }),
    displayIdentity: Object.freeze(displayIdentity),
    identityDigest: '',
    ...(value?.contentProfile==='jav'?{javSelectionFence:value.javSelectionFence,javSourceQualification:value.javSourceQualification}:{}),
  };
  if (!['single', 'season'].includes(result.structureKind) ||
      !['movie', 'series', 'jav', 'western_adult'].includes(result.contentProfile) ||
      !['tmdb_movie', 'tmdb_series_season', 'jav_code', 'internal_identity']
        .includes(result.identityKind)) {
    fail('P9_RESOLVED_IDENTITY_KIND',
      'Resolved Product Identity kind conflicts with the supported Product profile.');
  }
  result.identityDigest = canonicalDigest({
    schema: 'libra.resolved-product-identity@1',
    subjectId: result.subjectId,
    structureKind: result.structureKind,
    contentProfile: result.contentProfile,
    identityKind: result.identityKind,
    providerIdentities: result.providerIdentities,
    providerIdentitySetDigest: result.providerIdentitySetDigest,
    exactSeasonContinuityClaims: result.exactSeasonContinuityClaims,
    exactSeasonContinuitySetDigest: result.exactSeasonContinuitySetDigest,
    displayIdentity: result.displayIdentity,
  });
  result.evidenceId = canonicalDigest({
    schema: 'libra.resolved-product-identity-evidence-id@1',
    subjectId: result.subjectId,
    basisDigest: result.basisDigest,
    identityDigest: result.identityDigest,
    ...(result.contentProfile==='jav'?{javSelectionFence:result.javSelectionFence,javSourceQualification:result.javSourceQualification}:{}),
  });
  result.payloadDigest = canonicalDigest({
    schema: 'libra.resolved-product-identity-evidence@1',
    evidenceId: result.evidenceId,
    basisDigest: result.basisDigest,
    identityDigest: result.identityDigest,
  });
  return Object.freeze(bytes(result, 64 * 1024, 'P9_RESOLVED_IDENTITY_SIZE'));
}

function productFactEnvelope(value, factKind, factDigest) {
  const libraRunId = text(value?.libraRunId, 'libraRunId');
  const revision = integer(value?.expectedRevision, 'expectedRevision') + 1;
  const aggregateId = canonicalDigest({ schema:'libra.product-fact-aggregate-id@1', libraRunId, factKind });
  const factId = canonicalDigest({ schema:'libra.product-fact-id@1', libraRunId, factKind, factRevision:revision });
  return { factId, ownerDomain:'libra', aggregateType:'libra_product_fact', aggregateId, revision,
    factSchemaRef:factKind === 'media_cast' ? 'helix://contracts/types/MediaCastFact/v1' :
      'helix://contracts/types/ProductMetadataFact/v1', factDigest,
    commitMarker:text(value?.commitMarker, 'commitMarker'), committedAtMs:integer(value?.committedAtMs, 'committedAtMs') };
}

function buildMediaCastFact(value) {
  const draft = value?.mediaCastDraft, basis = value?.sourceBasis;
  if (!draft || draft.schemaRef !== 'helix://contracts/types/MediaCastDraft/v1' || !basis ||
      draft.subjectId !== value.subjectId || draft.sourceBasisKind !== basis.sourceBasisKind ||
      draft.basisDigest !== basis.sourceBasisDigest||draft.draftDigest!==canonicalDigest(Object.fromEntries(
        Object.entries(draft).filter(([key])=>key!=='draftDigest'))))
    fail('P9_MEDIA_CAST_FACT_INPUT', 'Media Cast Draft and Source Basis disagree.');
  const relations = [...draft.relations], relationsDigest = canonicalDigest({ schema:'libra.media-cast-relations@1', relations });
  if (basis.observationSet?.contentProfile === 'jav' && !relations.some(item => item.role === 'actor'))
    fail('P9_JAV_ACTOR_REQUIRED', 'JAV Media Cast cannot publish an empty actor result.');
  if(basis.sourceBasisKind==='us_adult_actor'){
    const expected=actorRelation(assertActorSelection(basis.actorSelection)),{relationDigest,...actual}=relations[0]||{};
    if(draft.usAdultActorBasisDigest!==basis.sourceBasisDigest||relations.length!==1||canonicalJson(actual)!==canonicalJson(expected)||
      relationDigest!==canonicalDigest(expected))fail('P9_US_ACTOR_REQUIRED','A US Media-Cast Fact cannot omit or replace its confirmed actor.');
  }
  const body = { subjectId:text(value.subjectId, 'subjectId'), sourceBasisKind:basis.sourceBasisKind,
    sourceBasisDigest:digest(basis.sourceBasisDigest, 'sourceBasisDigest'), relations, relationsDigest, relationCount:relations.length };
  const factDigest = canonicalDigest({ schema:'libra.media-cast-fact@1', ...body });
  return Object.freeze(bytes({ schemaRef:'helix://contracts/types/MediaCastFact/v1', schemaVersion:1,
    ...productFactEnvelope(value, 'media_cast', factDigest), ...body }, 64 * 1024, 'P9_MEDIA_CAST_FACT_SIZE'));
}

function buildProductMetadataFact(value) {
  const draft = value?.productMetadataDraft, basis = value?.sourceBasis, manifest = value?.verifiedArtifactManifest;
  if (draft?.episodeScope) fail('P9_METADATA_EPISODE_FACT_SCOPE', 'A scoped Episode Draft cannot be committed as a flat Season Fact.');
  if (!draft || draft.schemaRef !== 'helix://contracts/types/ProductMetadataDraft/v1' || !basis || !manifest ||
      manifest.libraRunId !== value.libraRunId || draft.sourceBasisKind !== basis.sourceBasisKind ||
      draft.draftDigest!==canonicalDigest(Object.fromEntries(Object.entries(draft).filter(([key])=>key!=='draftDigest')))||
      draft.descriptiveFacts?.recordDigest!==canonicalDigest(Object.fromEntries(
        Object.entries(draft.descriptiveFacts||{}).filter(([key])=>key!=='recordDigest')))||
      (basis.sourceBasisKind === 'metadata_observation' && (draft.basisDigest!==basis.sourceBasisDigest||
        draft.metadataObservationSetDigest !== basis.observationSet?.setDigest ||
        draft.westernAnalysisVariantDigest !== null)) ||
      (basis.sourceBasisKind === 'western_analysis' && (draft.basisDigest!==basis.westernBasis?.analysisVariantDigest||
        draft.resolvedIdentityDigest!==basis.westernBasis?.resolvedIdentityDigest||draft.providerIdentities?.length!==0||
        draft.westernAnalysisVariantDigest !== basis.westernBasis?.analysisVariantDigest ||draft.metadataObservationSetDigest !== null))) {
    fail('P9_PRODUCT_METADATA_FACT_INPUT', 'Metadata Draft, Source Basis, or Artifact Manifest disagree.');
  }
  const mediaCastFactRef = value.mediaCastFactRef || null;
  if (mediaCastFactRef !== null && (!text(mediaCastFactRef.productFactId, 'productFactId') ||
      !Number.isSafeInteger(mediaCastFactRef.factRevision) || mediaCastFactRef.factRevision < 1 ||
      !DIGEST.test(mediaCastFactRef.factDigest || ''))) fail('P9_PRODUCT_METADATA_CAST_REF', 'Media Cast Fact reference is invalid.');
  const body = { subjectId:text(value.subjectId, 'subjectId'), resolvedIdentityDigest:digest(draft.resolvedIdentityDigest, 'resolvedIdentityDigest'),
    sourceBasisKind:basis.sourceBasisKind, sourceBasisDigest:digest(basis.sourceBasisDigest, 'sourceBasisDigest'),
    metadataObservationSetDigest:draft.metadataObservationSetDigest, westernAnalysisVariantDigest:draft.westernAnalysisVariantDigest,
    fieldProvenance:[...draft.fieldProvenance], descriptiveFacts:draft.descriptiveFacts,
    providerIdentities:[...draft.providerIdentities], mediaCastFactRef,
    verifiedArtifactManifestDigest:digest(manifest.manifestDigest, 'verifiedArtifactManifestDigest') };
  if(draft.javSelectedSource)body.javSelectedSource=require('../../../contracts/jav-selected-source').assertJavSelectedSource(draft.javSelectedSource);
  if(draft.seriesPresentationBasis)body.seriesPresentationBasis=require('../../../contracts/series-presentation-basis').assertSeriesPresentationBasis(
    draft.seriesPresentationBasis,draft.providerIdentities.find(item=>item.namespace==='tmdb_series'));
  if(draft.episodeMetadata){
    if(basis.sourceBasisKind!=='metadata_observation'||basis.observationSet.contentProfile!=='series')
      fail('P9_METADATA_EPISODE_FACT_SCOPE','Episode Metadata requires a Series Observation basis.');
    validateEpisodeMetadata(draft.episodeMetadata,draft.providerIdentities);
    body.episodeMetadata=draft.episodeMetadata;
  }
  body.productMetadataDigest = canonicalDigest({ schema:'libra.product-metadata@1', ...body });
  return Object.freeze(bytes({ schemaRef:'helix://contracts/types/ProductMetadataFact/v1', schemaVersion:1,
    ...productFactEnvelope(value, 'product_metadata', body.productMetadataDigest), ...body },
  body.episodeMetadata ? SET_LIMIT : 64 * 1024, 'P9_PRODUCT_METADATA_FACT_SIZE'));
}

function validateEpisodeMetadata(items, identities) {
  if(!Array.isArray(items)||!items.length||items.length>256)
    fail('P9_METADATA_EPISODE_FACT_SCOPE','Episode Metadata must contain 1..256 scoped records.');
  const season=identities.find(item=>item.namespace==='tmdb_series')?.seasonNumber;
  let previous='';
  for(const item of items){
    const scope=buildEpisodeMetadataScope(item.episodeScope),record=item.descriptiveFacts;
    if(scope.seasonNumber!==season||(previous&&compare(previous,scope.episodeKey)>=0)||!record||
        record.recordDigest!==canonicalDigest(Object.fromEntries(Object.entries(record).filter(([key])=>key!=='recordDigest'))))
      fail('P9_METADATA_EPISODE_FACT_SCOPE','Episode Metadata identity, ordering or record digest is invalid.');
    const values=new Map(record.entries.map(entry=>[entry.key,entry.value]));
    if(values.get('season_number')!==scope.seasonNumber||values.get('episode_number')!==scope.episodeNumber)
      fail('P9_METADATA_EPISODE_FACT_SCOPE','Episode Metadata numbers do not conserve scope.');
    previous=scope.episodeKey;
  }
  return items;
}

function buildProductFactEvidence(value) {
  return canonicalDigest({ schema:'libra.product-fact-evidence@1', libraRunId:text(value?.libraRunId, 'libraRunId'),
    factKind:text(value?.factKind, 'factKind'), factRevision:integer(value?.factRevision, 'factRevision', 1),
    sourceBasisKind:text(value?.sourceBasisKind, 'sourceBasisKind'), sourceBasisDigest:digest(value?.sourceBasisDigest, 'sourceBasisDigest'),
    commitPayloadDigest:digest(value?.commitPayloadDigest, 'commitPayloadDigest'),
    eventFenceDigest:digest(value?.eventFenceDigest, 'eventFenceDigest') });
}

module.exports = Object.freeze({ ProductFactContractError, buildArtifactManifestVerification, buildMediaCastDraft, buildMetadataMediaCastRelations, selectSeriesMediaCastObservation, buildMediaCastFact, buildMetadataFetchIntent,
  buildMetadataObservation, buildMetadataObservationBasis, buildProductFactHandle, buildProductFactSourceRefs, buildProductMetadataDraft, metadataObservationWorkIdempotencyKey,
  buildProductMetadataFact, buildProductFactEvidence, buildResolvedProductIdentity, buildWesternProductMetadataDraft, metadataSourceRef, selectMetadataObservations,
  validateArtifactRequirement, validateVerifiedArtifactManifest, validateEpisodeMetadata });
