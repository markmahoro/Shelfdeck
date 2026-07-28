'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { buildMetadataFetchIntent } = require('../model/product-fact-contracts');

class ProductMetadataPlannerError extends Error {
  constructor(code, message) { super(message); this.name = 'ProductMetadataPlannerError'; this.code = code; }
}
const fail = (code, message) => { throw new ProductMetadataPlannerError(code, message); };

function observedFields(observations) {
  const fields = new Set();
  for (const observation of observations || []) {
    for (const entry of observation?.descriptiveFacts?.entries || []) {
      if (typeof entry.key === 'string' && entry.key && entry.value !== null && entry.value !== '') fields.add(entry.key);
    }
  }
  return fields;
}

function planMetadataGap(value) {
  const profile = value?.contentProfile, requiredFields = [...(value?.requiredFields || [])];
  if (!['movie', 'series', 'jav', 'western_adult'].includes(profile) || requiredFields.length > 256 ||
      requiredFields.some((field) => typeof field !== 'string' || !field) || new Set(requiredFields).size !== requiredFields.length) {
    fail('P9_METADATA_PLAN_INPUT', 'Metadata planning input is invalid.');
  }
  const observations = [...(value.observations || [])];
  if (observations.length > 16 || observations.some((item, ordinal) => !item || item.sourcePriority !== ordinal ||
      item.contentProfile !== profile || item.identityDigest !== value.resolvedIdentityDigest ||
      !['related_nfo', 'provider'].includes(item.sourceKind))) {
    fail('P9_METADATA_PLAN_OBSERVATION_SCOPE', 'Metadata observations must be a bounded contiguous set for the exact profile and identity.');
  }
  const present = observedFields(observations),
    missingFields = requiredFields.filter((field) => !present.has(field));
  if (profile === 'western_adult') {
    if (observations.length !== 0) fail('P9_METADATA_PLAN_WESTERN_OBSERVATION', 'Western metadata cannot consume Provider Observations.');
    return Object.freeze({ planKind:'western_analysis', missingFields:Object.freeze(missingFields), nextIntent:null,
      planDigest:canonicalDigest({ schema:'libra.metadata-gap-plan@1', contentProfile:profile, missingFields, planKind:'western_analysis' }) });
  }
  if (missingFields.length === 0) {
    return Object.freeze({ planKind:'draft_ready', missingFields:Object.freeze([]), nextIntent:null,
      planDigest:canonicalDigest({ schema:'libra.metadata-gap-plan@1', contentProfile:profile, missingFields:[], planKind:'draft_ready' }) });
  }
  const seenKinds = new Set(observations.map((item) => item.sourceKind === 'provider' ?
    'provider:' + item.sourceRef.split(':', 1)[0] : item.sourceKind));
  let source;
  if (['movie', 'series'].includes(profile) && value.relatedNfo && !seenKinds.has('related_nfo')) {
    source = { sourceKind:'related_nfo', relatedReferenceId:value.relatedNfo.referenceId,
      relatedReferenceDigest:value.relatedNfo.referenceDigest, expectedChecksum:value.relatedNfo.expectedChecksum };
  } else if (['movie', 'series'].includes(profile) && !seenKinds.has('provider:tmdb')) {
    if (!value.provider || value.provider.providerKind !== 'tmdb') fail('P9_METADATA_PLAN_SOURCE_UNAVAILABLE', 'TMDB source is unavailable.');
    source = { sourceKind:'provider', providerKind:'tmdb', integrationId:value.provider.integrationId,
      configRevision:value.provider.configRevision, resolvedProviderIdentity:value.resolvedProviderIdentity };
  } else if (profile === 'jav' && !seenKinds.has('provider:jav')) {
    if (!value.provider || value.provider.providerKind !== 'jav') fail('P9_METADATA_PLAN_SOURCE_UNAVAILABLE', 'JAV source is unavailable.');
    source = { sourceKind:'provider', providerKind:'jav', integrationId:value.provider.integrationId,
      configRevision:value.provider.configRevision, resolvedProviderIdentity:value.resolvedProviderIdentity };
  } else {
    return Object.freeze({ planKind:'gap_unresolved', missingFields:Object.freeze(missingFields), nextIntent:null,
      planDigest:canonicalDigest({ schema:'libra.metadata-gap-plan@1', contentProfile:profile, missingFields, planKind:'gap_unresolved' }) });
  }
  const nextIntent = buildMetadataFetchIntent({ libraRunId:value.libraRunId,
    runExecutionBasisDigest:value.runExecutionBasisDigest, sourcePriority:observations.length,
    contentProfile:profile, resolvedIdentityDigest:value.resolvedIdentityDigest, requestedFields:missingFields.sort(), ...source });
  return Object.freeze({ planKind:'fetch_source', missingFields:Object.freeze(missingFields), nextIntent,
    planDigest:canonicalDigest({ schema:'libra.metadata-gap-plan@1', contentProfile:profile, missingFields,
      planKind:'fetch_source', nextIntentDigest:nextIntent.intentDigest }) });
}

module.exports = Object.freeze({ ProductMetadataPlannerError, observedFields, planMetadataGap });
