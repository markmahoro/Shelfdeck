'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');

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
  if (handles.length < 1 || handles.length > 64 || handles.some((item) => item.artifactKind !== requirement.artifactKind))
    fail('P9_ARTIFACT_VERIFICATION_INPUT', 'Artifact verification requires 1..64 matching handles.');
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
    result:'passed', reasonCodes:[], evidenceRefs:[], verifiedAtMs:integer(value?.verifiedAtMs, 'verifiedAtMs'),
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
    common.integrationId = text(value.integrationId, 'integrationId');
    common.configRevision = integer(value.configRevision, 'configRevision', 1);
    if (!['tmdb', 'jav'].includes(common.providerKind) ||
        (common.providerKind === 'tmdb') !== ['movie', 'series'].includes(common.contentProfile) ||
        (common.providerKind === 'jav') !== (common.contentProfile === 'jav')) {
      fail('P9_METADATA_SOURCE_ORDER', 'Provider does not match the content profile.');
    }
  } else fail('P9_METADATA_SOURCE_KIND', 'Metadata source kind is invalid.');
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

function selectMetadataObservations(value) {
  const intents = (value?.intents || []).map(buildMetadataFetchIntent);
  if (intents.length < 1 || intents.length > 16 || intents.some((item, ordinal) => item.sourcePriority !== ordinal)) {
    fail('P9_METADATA_INTENT_ORDER', 'Metadata priorities must be unique and contiguous from zero.');
  }
  const byDigest = new Map(intents.map((item) => [item.intentDigest, item]));
  const selected = new Map();
  for (const candidate of value.results || []) {
    const intent = byDigest.get(candidate?.result?.fetchIntentDigest);
    if (!intent || candidate.ownerDomain !== 'libra' || candidate.processType !== 'libra_run' ||
        candidate.processId !== intent.libraRunId || candidate.workKind !== 'product_metadata_observation' ||
        candidate.workState !== 'succeeded' || candidate.capabilityRef !== 'libra.product_metadata.fetch@1' ||
        candidate.resultSchemaRef !== 'helix://contracts/types/MetadataObservation/v1' ||
        candidate.result?.schemaRef !== candidate.resultSchemaRef || candidate.result?.schemaVersion !== 1 ||
        candidate.result.identityDigest !== intent.resolvedIdentityDigest || candidate.result.contentProfile !== intent.contentProfile ||
        candidate.result.sourceKind !== intent.sourceKind || candidate.result.sourceRef !== metadataSourceRef(intent) ||
        candidate.result.sourcePriority !== intent.sourcePriority || candidate.result.payloadDigest !== candidate.evidenceDigest ||
        canonicalDigest(candidate.result) !== candidate.resultDigest || candidate.inputBindingDigest !== canonicalDigest(intent)) {
      fail('P9_METADATA_OBSERVATION_CHAIN', 'Observation is outside the exact Supporting Work chain.');
    }
    const prior = selected.get(intent.intentDigest);
    if (prior && prior.evidenceDigest !== candidate.evidenceDigest) fail('P9_METADATA_OBSERVATION_CONFLICT', 'Semantic replay changed payload digest.');
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
  if (!['media_cast', 'product_metadata'].includes(factKind)) fail('P9_PRODUCT_FACT_KIND', 'Product Fact kind is invalid.');
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
      sourceOrder:ordinal, evidenceId:item.result.evidenceId, evidenceDigest:item.evidenceDigest,
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
  bytes(set, 512 * 1024, 'P9_METADATA_SET_SIZE');
  return Object.freeze({ sourceBasisKind:'metadata_observation', productFactId, selection:Object.freeze(selection),
    observationSet:Object.freeze(set), sourceBasisDigest:selection.selectionDigest });
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
  if (required.length > 256 || required.some((item) => typeof item !== 'string' || !item)) fail('P9_METADATA_REQUIREMENTS', 'Required fields are invalid.');
  const winners = new Map(), provenance = [];
  for (const observation of basis.observationSet.observations) {
    for (const entry of descriptiveEntries(observation)) {
      if (!winners.has(entry.key) && entry.value !== null && entry.value !== '') {
        winners.set(entry.key, entry.value);
        provenance.push({ fieldPath:entry.key, sourceKind:observation.sourceKind, sourceRef:observation.sourceRef,
          evidenceDigest:observation.payloadDigest });
      }
    }
  }
  const missingFields = required.filter((field) => !winners.has(field));
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
    providerIdentities:[...(value.providerIdentities || [])], mediaCastDraftRef:value.mediaCastDraftRef || null,
    artifactRequirements };
  draft.descriptiveFacts.recordDigest = canonicalDigest(Object.fromEntries(Object.entries(draft.descriptiveFacts).filter(([key]) => key !== 'recordDigest')));
  draft.draftId = canonicalDigest({ schema:'libra.product-metadata-draft-id@1', resolvedIdentityDigest:draft.resolvedIdentityDigest,
    sourceBasisDigest:basis.sourceBasisDigest, descriptiveFactsDigest:draft.descriptiveFacts.recordDigest });
  draft.draftDigest = canonicalDigest(Object.fromEntries(Object.entries(draft).filter(([key]) => key !== 'draftDigest')));
  return Object.freeze({ ready:true, draft:Object.freeze(bytes(draft, 64 * 1024, 'P9_METADATA_DRAFT_SIZE')) });
}

function buildMediaCastDraft(value) {
  const basis = value?.sourceBasis, subjectId = text(value?.subjectId, 'subjectId');
  if (!basis || !['metadata_observation', 'western_match'].includes(basis.sourceBasisKind))
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
  if (basis.sourceBasisKind === 'western_match') {
    if (basis.westernBasis?.matchState === 'no_matches' && relations.length !== 0 ||
        basis.westernBasis?.matchState === 'matches_found' && relations.length === 0) {
      fail('P9_MEDIA_CAST_MATCH_CONTINUITY', 'Western match state and relations disagree.');
    }
  }
  const draft = { schemaRef:'helix://contracts/types/MediaCastDraft/v1', schemaVersion:1, draftId:'',
    draftKind:'media_cast', basisDigest:basis.sourceBasisDigest, draftDigest:'', producedAtMs:integer(value.producedAtMs, 'producedAtMs'),
    subjectId, sourceBasisKind:basis.sourceBasisKind,
    metadataObservationSetDigest:basis.sourceBasisKind === 'metadata_observation' ? basis.observationSet.setDigest : null,
    westernMatchBasisDigest:basis.sourceBasisKind === 'western_match' ? basis.westernBasis.basisDigest : null,
    relations:sorted };
  draft.draftId = canonicalDigest({ schema:'libra.media-cast-draft-id@1', subjectId,
    sourceBasisKind:draft.sourceBasisKind, sourceBasisDigest:basis.sourceBasisDigest,
    relationsDigest:canonicalDigest({ schema:'libra.media-cast-relations@1', relations:sorted }) });
  draft.draftDigest = canonicalDigest(Object.fromEntries(Object.entries(draft).filter(([key]) => key !== 'draftDigest')));
  return Object.freeze(bytes(draft, 64 * 1024, 'P9_MEDIA_CAST_DRAFT_SIZE'));
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
    if (!binding || !result || ref.workId !== binding.workId || ref.attemptId !== binding.attemptId ||
        ref.planId !== binding.planId || ref.eventId !== binding.eventId ||
        ref.capabilityRef !== 'shared.artifact.manifest.verify@1' || ref.capabilityRef !== binding.capabilityRef ||
        ref.resultSchemaRef !== 'helix://contracts/types/ArtifactManifestVerification/v1' ||
        ref.resultSchemaRef !== binding.resultSchemaRef || ref.resultDigest !== binding.resultDigest ||
        ref.inputBindingDigest !== binding.inputBindingDigest || canonicalDigest(result) !== ref.resultDigest ||
        canonicalDigest(binding.inputBindings) !== ref.inputBindingDigest ||
        canonicalJson(binding.inputBindings?.artifactRequirement) !== canonicalJson(requirement) ||
        result.result !== 'passed' || result.verificationId !== item.verificationEvidenceId ||
        result.verificationDigest !== item.verificationEvidenceDigest ||
        result.requirement?.requirementDigest !== requirement.requirementDigest ||
        result.verificationDigest !== canonicalDigest(Object.fromEntries(
          Object.entries(result).filter(([key]) => key !== 'verificationDigest'))))
      fail('P9_ARTIFACT_VERIFICATION_CHAIN', 'Artifact item does not match its explicit verification Result chain.');
    const verified = (result.verifiedArtifacts || []).find((candidate) => candidate.artifactHandleId === item.artifactHandleId &&
      candidate.artifactRevision === item.artifactRevision);
    const inputHandle = (binding.inputBindings.artifactHandleList || []).find((candidate) =>
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
  if (!['media_cast', 'product_metadata'].includes(factKind)) fail('P9_PRODUCT_FACT_KIND', 'Product Fact kind is invalid.');
  const libraRunId = text(value.libraRunId, 'libraRunId'), expectedRevision = integer(value.expectedRevision, 'expectedRevision');
  const payloadDigest = digest(value.payloadDigest, 'payloadDigest'), eventFenceDigest = digest(value.eventFenceDigest, 'eventFenceDigest');
  const aggregateType = 'libra_product_fact';
  const aggregateId = canonicalDigest({ schema:'libra.product-fact-aggregate-id@1', libraRunId, factKind });
  const resultType = factKind === 'media_cast' ? 'MediaCastFact' : 'ProductMetadataFact';
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
      draft.basisDigest !== basis.sourceBasisDigest) fail('P9_MEDIA_CAST_FACT_INPUT', 'Media Cast Draft and Source Basis disagree.');
  const relations = [...draft.relations], relationsDigest = canonicalDigest({ schema:'libra.media-cast-relations@1', relations });
  const body = { subjectId:text(value.subjectId, 'subjectId'), sourceBasisKind:basis.sourceBasisKind,
    sourceBasisDigest:digest(basis.sourceBasisDigest, 'sourceBasisDigest'), relations, relationsDigest, relationCount:relations.length };
  const factDigest = canonicalDigest({ schema:'libra.media-cast-fact@1', ...body });
  return Object.freeze(bytes({ schemaRef:'helix://contracts/types/MediaCastFact/v1', schemaVersion:1,
    ...productFactEnvelope(value, 'media_cast', factDigest), ...body }, 64 * 1024, 'P9_MEDIA_CAST_FACT_SIZE'));
}

function buildProductMetadataFact(value) {
  const draft = value?.productMetadataDraft, basis = value?.sourceBasis, manifest = value?.verifiedArtifactManifest;
  if (!draft || draft.schemaRef !== 'helix://contracts/types/ProductMetadataDraft/v1' || !basis || !manifest ||
      manifest.libraRunId !== value.libraRunId || draft.sourceBasisKind !== basis.sourceBasisKind ||
      (basis.sourceBasisKind === 'metadata_observation' && (draft.metadataObservationSetDigest !== basis.observationSet?.setDigest ||
        draft.westernAnalysisVariantDigest !== null)) ||
      (basis.sourceBasisKind === 'western_analysis' && (draft.westernAnalysisVariantDigest !== basis.westernBasis?.analysisVariantDigest ||
        draft.metadataObservationSetDigest !== null))) {
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
  body.productMetadataDigest = canonicalDigest({ schema:'libra.product-metadata@1', ...body });
  return Object.freeze(bytes({ schemaRef:'helix://contracts/types/ProductMetadataFact/v1', schemaVersion:1,
    ...productFactEnvelope(value, 'product_metadata', body.productMetadataDigest), ...body },
  64 * 1024, 'P9_PRODUCT_METADATA_FACT_SIZE'));
}

function buildProductFactEvidence(value) {
  return canonicalDigest({ schema:'libra.product-fact-evidence@1', libraRunId:text(value?.libraRunId, 'libraRunId'),
    factKind:text(value?.factKind, 'factKind'), factRevision:integer(value?.factRevision, 'factRevision', 1),
    sourceBasisKind:text(value?.sourceBasisKind, 'sourceBasisKind'), sourceBasisDigest:digest(value?.sourceBasisDigest, 'sourceBasisDigest'),
    commitPayloadDigest:digest(value?.commitPayloadDigest, 'commitPayloadDigest'),
    eventFenceDigest:digest(value?.eventFenceDigest, 'eventFenceDigest') });
}

module.exports = Object.freeze({ ProductFactContractError, buildArtifactManifestVerification, buildMediaCastDraft, buildMediaCastFact, buildMetadataFetchIntent,
  buildMetadataObservationBasis, buildProductFactHandle, buildProductMetadataDraft, metadataObservationWorkIdempotencyKey,
  buildProductMetadataFact, buildProductFactEvidence, metadataSourceRef, selectMetadataObservations,
  validateArtifactRequirement, validateVerifiedArtifactManifest });
