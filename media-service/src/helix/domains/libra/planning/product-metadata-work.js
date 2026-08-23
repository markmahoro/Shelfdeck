'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
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
  return Object.freeze([...snapshot.spec.requirements.metadata.requiredFieldCodes]
    .filter((item) => item !== 'actor')
    .sort(compare));
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
  requestedFields) {
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
      relatedReferenceId: reference.referenceId,
      relatedReferenceDigest: reference.referenceDigest,
      expectedChecksum: reference.identity.contentFingerprint,
    }),
  });
}

function providerSource(options, snapshot, identity, sourcePriority,
  requestedFields) {
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
    providerKind: providerIdentity.provider,
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
  const requiredFields = requiredMetadataFields(snapshot);
  const results = metadataResultItems(options, snapshot.run.libraRunId);
  const observed = observedFieldKeys(results);
  const missingFields = requiredFields.filter((field) => !observed.has(field));
  if (results.length > 0 && missingFields.length === 0) {
    return Object.freeze({ kind:'ready', requiredFields, missingFields,
      results });
  }
  const references = nfoReferences(snapshot);
  const usedNfoRefs = new Set(results
    .filter((item) => item.result.sourceKind === 'related_nfo')
    .map((item) => item.result.sourceRef));
  const nextReference = references.find((item) => !usedNfoRefs.has(item.referenceId));
  if (nextReference) {
    const source = nfoSource(snapshot, identity, nextReference,
      results.length, missingFields);
    return Object.freeze({ kind:'source', source, requiredFields,
      missingFields, results });
  }
  if (results.some((item) => item.result.sourceKind === 'provider')) {
    return Object.freeze({ kind:'unresolved',
      reasonCode:'product_metadata_required_fields_missing', requiredFields,
      missingFields, results });
  }
  const source = providerSource(options, snapshot, identity, results.length,
    missingFields);
  if (source.kind === 'unavailable') {
    return Object.freeze({ ...source, requiredFields, missingFields, results });
  }
  return Object.freeze({ kind:'source', source, requiredFields,
    missingFields, results });
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
  requiredMetadataFields,
});
