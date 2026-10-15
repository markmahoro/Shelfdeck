'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { buildEpisodeMetadataScope } = require('../../../contracts/episode-metadata-scope');
const {
  buildMetadataFetchIntent,
} = require('../model/product-fact-contracts');

const METADATA_RESULT =
  'helix://contracts/capabilities/libra.product_metadata.fetch/v1/result';

function stable(prefix, value) {
  return prefix + canonicalDigest(value).slice(0, 40);
}

function compare(left, right) {
  return Buffer.from(left).compare(Buffer.from(right));
}

function requiredMetadataFields(snapshot) {
  const waived=new Set((snapshot.run.authorizedDefectManifest?.defects||[]).flatMap(item=>item.metadataFieldCodes||[]));
  return Object.freeze([...snapshot.spec.requirements.metadata.requiredFieldCodes]
    .filter((item) => item !== 'actor'&&!waived.has(item))
    .sort(compare));
}

function requiredArtifactKinds(snapshot) {
  const waived=new Set((snapshot.run.authorizedDefectManifest?.defects||[]).flatMap(item=>item.artifactKindCodes||[]));
  return Object.freeze(require('../../../contracts/artifact-requirement-gaps').requiredArtifactKinds(snapshot.spec.requirements).filter(kind=>!waived.has(kind)));
}

function requiredMediaCastRoles(snapshot) {
  return Object.freeze(snapshot.spec.requirements.metadata.requiredFieldCodes
    .includes('actor') ? ['actor'] : []);
}

function nfoReferences(snapshot) {
  return Object.freeze(snapshot.relatedReferences
    .filter((item) => item.role === 'nfo')
    .sort((left, right) => compare(left.referenceId, right.referenceId)));
}

function observedFieldKeys(resultItems) {
  const keys = new Set();
  for (const item of [...resultItems].sort((left, right) =>
    Number(left.result.sourcePriority) - Number(right.result.sourcePriority))) {
    for (const entry of item.result.descriptiveFacts?.entries || []) {
      if (!keys.has(entry.key) && entry.value !== null && entry.value !== '') {
        keys.add(entry.key);
      }
    }
  }
  return keys;
}

function observedMediaCastRoles(resultItems) {
  const roles = new Set();
  for (const item of resultItems) {
    for (const hint of item.result.peopleHints || []) {
      if (typeof hint?.role === 'string' && hint.role &&
          typeof hint.displayName === 'string' && hint.displayName) {
        roles.add(hint.role);
      }
    }
  }
  return roles;
}

function metadataResultItems(options, libraRunId) {
  const works = options.workResultReader.listWorks({
    ownerDomain: 'libra',
    processType: 'libra_run',
    processId: libraRunId,
    workKind: 'product_metadata_observation',
  });
  const values = [];
  for (const work of works) {
    const results = options.workResultReader.read(work.work_id).filter((item) =>
      item.outcomeKind === 'succeeded' &&
      item.capabilityRef === 'libra.product_metadata.fetch@1');
    if (results.length === 0) continue;
    if (results.length !== 1) {
      throw new Error('Each terminal Product Metadata source Work must contain exactly one durable Observation.');
    }
    values.push(Object.freeze({ ...results[0], sourceWorkId:work.work_id }));
  }
  values.sort((left, right) =>
    Number(left.result.sourcePriority) - Number(right.result.sourcePriority) ||
    compare(left.result.evidenceId, right.result.evidenceId));
  for (let ordinal = 0; ordinal < values.length; ordinal += 1) {
    if (Number(values[ordinal].result.sourcePriority) !== ordinal) {
      throw new Error('Product Metadata source results are not contiguous from priority zero.');
    }
  }
  return Object.freeze(values);
}

function nfoSource(snapshot, identity, reference, sourcePriority,
  requestedFields, episodeScope) {
  return Object.freeze({
    kind: 'related_nfo',
    reference,
    intent: buildMetadataFetchIntent({
      libraRunId: snapshot.run.libraRunId,
      runExecutionBasisDigest: snapshot.run.executionBasisDigest,
      sourceKind: 'related_nfo',
      sourcePriority,
      contentProfile: snapshot.spec.contentProfile,
      resolvedIdentityDigest: identity.factValue.identityDigest,
      requestedFields,
      ...(episodeScope ? { episodeScope } : {}),
      relatedReferenceId: reference.referenceId,
      relatedReferenceDigest: reference.referenceDigest,
      expectedChecksum: reference.identity.contentFingerprint,
    }),
  });
}

function providerSource(options, snapshot, identity, sourcePriority,
  requestedFields, episodeScope) {
  const providerIdentity = identity.factValue.providerIdentities[0];
  if (!providerIdentity) {
    return Object.freeze({ kind:'unavailable',
      reasonCode:'product_metadata_provider_identity_absent' });
  }
  const seed = {
    libraRunId: snapshot.run.libraRunId,
    runExecutionBasisDigest: snapshot.run.executionBasisDigest,
    sourceKind: 'provider',
    sourcePriority,
    contentProfile: snapshot.spec.contentProfile,
    resolvedIdentityDigest: identity.factValue.identityDigest,
    resolvedProviderIdentity: providerIdentity,
    requestedFields,
    ...(episodeScope ? { episodeScope } : {}),
    providerKind: providerIdentity.provider,
    ...(snapshot.spec.contentProfile==='jav'?{javSelectedSource:require('../../../contracts/jav-selected-source').buildJavSelectedSource(identity.factValue.javSourceQualification)}:{}),
  };
  let handle;
  try {
    // This is the creation boundary for a new immutable source Work. Ask
    // Platform for the current handle first, then freeze its exact revision
    // into the Fetch Intent.
    handle = options.productProductionPort.resolveCurrentIntegrationHandle({
        sourceKind: 'provider',
        providerKind: providerIdentity.provider,
        operationId: 'libra.product_metadata.fetch@1',
        ...(seed.javSelectedSource?{javSelectedSource:seed.javSelectedSource}:{}),
      });
  } catch (error) {
    if (error?.code !== 'CLEAN_PRODUCT_INTEGRATION_UNAVAILABLE') throw error;
    return Object.freeze({ kind:'unavailable',
      reasonCode:'product_metadata_integration_unavailable' });
  }
  return Object.freeze({
    kind: 'provider',
    intent: buildMetadataFetchIntent({
      ...seed,
      integrationId: handle.integrationId,
      configRevision: handle.configRevision,
    }),
  });
}

function nextMetadataStage(options, snapshot, identity) {
  const waivedFields=new Set((snapshot.run.authorizedDefectManifest?.defects || []).flatMap(item=>item.metadataFieldCodes||
    (item.defectCode==='actor_unavailable'?['actor']:[])));
  if(snapshot.run.secondaryTarget)waivedFields.add('actor');
  const requiredFields = Object.freeze(requiredMetadataFields(snapshot).filter(field=>!waivedFields.has(field)));
  const requiredCastRoles = Object.freeze(requiredMediaCastRoles(snapshot)
    .filter((role) => !waivedFields.has(role)));
  const results = metadataResultItems(options, snapshot.run.libraRunId);
  const series = snapshot.spec.contentProfile === 'series';
  const scopes = series ? seriesMetadataScopes(snapshot, identity) : [];
  const globalRequiredFields = requiredFields.filter(field => !series || !field.startsWith('episode_'));
  const globalResults = results.filter(item => !item.result.episodeScope);
  const globalStage = metadataScopeStage(options, snapshot, identity, results, globalResults,
    globalRequiredFields, requiredCastRoles);
  if (globalStage.kind !== 'ready') return globalStage;
  for (const episodeScope of scopes) {
    const scopedResults = results.filter(item => item.result.episodeScope &&
      canonicalDigest(item.result.episodeScope) === canonicalDigest(episodeScope));
    const episodeRequiredFields = [...new Set(['episode_number', 'season_number',
      ...requiredFields.filter(field => field.startsWith('episode_'))])].sort(compare);
    const stage = metadataScopeStage(options, snapshot, identity, results, scopedResults,
      episodeRequiredFields, [], episodeScope);
    if (stage.kind !== 'ready') return stage;
  }
  return Object.freeze({ kind:'ready', requiredFields, missingFields:[], requiredCastRoles, missingCastRoles:[], results });
}

function seriesMetadataScopes(snapshot, identity) {
  const provider = identity.factValue.providerIdentities.find(item => item.namespace === 'tmdb_series');
  if (!provider) throw new Error('Series metadata requires the resolved Season identity.');
  const keys = snapshot.spec.productScope.episodeKeys;
  const claims = snapshot.episodeClaims.map(item => item.episodeKey);
  if (!keys.length || canonicalDigest(keys) !== canonicalDigest(claims))
    throw new Error('Series metadata delivery scope differs from the frozen Run manifest.');
  return Object.freeze(keys.map(episodeKey => buildEpisodeMetadataScope({ episodeKey,
    seasonNumber:provider.seasonNumber, episodeNumber:Number(episodeKey.slice(1)) })));
}

function metadataScopeStage(options, snapshot, identity, allResults, results, requiredFields,
  requiredCastRoles, episodeScope) {
  const observed = observedFieldKeys(results);
  const observedCastRoles = observedMediaCastRoles(results);
  const missingFields = requiredFields.filter((field) => !observed.has(field));
  const missingCastRoles = requiredCastRoles.filter((role) =>
    !observedCastRoles.has(role));
  if (results.length > 0 && missingFields.length === 0 &&
      missingCastRoles.length === 0) {
    return Object.freeze({ kind:'ready', requiredFields, missingFields,
      requiredCastRoles, missingCastRoles, results });
  }
  const references = (snapshot.spec.contentProfile==='jav'?[]:nfoReferences(snapshot)).filter(reference => !episodeScope ||
    snapshot.members.some(member => member.materialKey === reference.primaryMaterialKey &&
      member.episodeClaims?.some(claim => claim.episodeKey === episodeScope.episodeKey)));
  const usedNfoRefs = new Set(results
    .filter((item) => item.result.sourceKind === 'related_nfo')
    .map((item) => item.result.sourceRef));
  const nextReference = references.find((item) => !usedNfoRefs.has(item.referenceId));
  if (nextReference) {
    const source = nfoSource(snapshot, identity, nextReference,
      allResults.length, missingFields, episodeScope);
    return Object.freeze({ kind:'source', source, requiredFields,
      missingFields, requiredCastRoles, missingCastRoles, results });
  }
  if (results.some((item) => item.result.sourceKind === 'provider')) {
    return Object.freeze({ kind:'unresolved',
      reasonCode:missingFields.length > 0
        ? 'product_metadata_required_fields_missing'
        : 'product_metadata_required_cast_missing',
      requiredFields, missingFields, requiredCastRoles, missingCastRoles,
      results });
  }
  const source = providerSource(options, snapshot, identity, allResults.length,
    missingFields, episodeScope);
  if (source.kind === 'unavailable') {
    return Object.freeze({ ...source, requiredFields, missingFields,
      requiredCastRoles, missingCastRoles, results });
  }
  return Object.freeze({ kind:'source', source, requiredFields,
    missingFields, requiredCastRoles, missingCastRoles, results });
}

function metadataObservationWork(snapshot, source) {
  if (!source?.intent) {
    throw new TypeError('Product Metadata source Work requires one frozen Fetch Intent.');
  }
  const basis = {
    libraRunId: snapshot.run.libraRunId,
    executionBasisDigest: snapshot.run.executionBasisDigest,
    fetchIntentDigest: source.intent.intentDigest,
  };
  return Object.freeze({
    schemaRef: 'helix://foundation/types/SupportingWorkDefinition/v1',
    schemaVersion: 1,
    workId: stable('libra-product-metadata-work-', basis),
    ownerDomain: 'libra',
    processType: 'libra_run',
    processId: snapshot.run.libraRunId,
    workKind: 'product_metadata_observation',
    workObjectiveTypeRef:
      'helix://libra/work/product-metadata-source-observation/v1',
    workObjectiveVersion: 1,
    executionBasisId: stable('libra-product-metadata-basis-', basis),
    executionBasisDigest: snapshot.run.executionBasisDigest,
    dependencyRefs: Object.freeze([]),
    priorityClass: snapshot.run.priorityClass === 'expedited'
      ? 'expedited_formation' : 'normal_foreground',
    priorityRevision: snapshot.run.priorityRevision || 1,
    capabilityCatalogScope: 'libra',
    workspaceMaterialScope: Object.freeze([]),
    idempotencyKey: stable('libra-product-metadata-key-', basis),
    concurrencyScope: snapshot.run.libraRunId + '/product-metadata',
    outputContractRef: METADATA_RESULT,
  });
}

module.exports = Object.freeze({
  METADATA_RESULT,
  metadataObservationWork,
  metadataResultItems,
  nextMetadataStage,
  nfoReferences,
  requiredMediaCastRoles,
  requiredMetadataFields,
  requiredArtifactKinds,
  observedFieldKeys,
  observedMediaCastRoles,
  seriesMetadataScopes,
});
