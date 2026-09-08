'use strict';
const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
function acceptedRating(context){if(Number.isInteger(context.raw.perceptionRating?.rating))return context.raw.perceptionRating.rating;for(const fact of context.raw.facts){if(fact.fact_kind!=='decision_fact')continue;const value=fact.value||{};
  for(const key of ['rating','normalizedRating','ratingValue','stars'])if(Number.isInteger(value[key])&&value[key]>=1&&value[key]<=5)return value[key];}return null;}
function effectiveRequirements(context){const profiles=context.raw.standard.value?.profileRuleSets||[],profile=profiles.find((item)=>item.contentProfile===(context.raw.entry.structure_kind==='season'?'series':'movie'))||profiles[0];if(!profile)return null;const rating=acceptedRating(context);if(rating===null)return profile.baseRequirements;const branch=(profile.decisionBranches||[]).find((item)=>item.predicate?.rating===rating||item.rating===rating||item.decisionValue===rating);return branch?.requirements||branch?.resultRequirements||profile.baseRequirements;}

function careFindingCodes(requirement) {
  return (requirement?.typedParameters || []).filter(item =>
    !/^(target|basis|source)\./.test(item.parameter)).map(item => String(item.value));
}
function freezeCareObjective(context) {
  const requirements = effectiveRequirements(context);
  if (!requirements) throw Object.assign(new Error('Maintenance has no effective requirements.'), {code:'ARCA_CARE_OBJECTIVE_MISSING'});
  const value = canonicalJson(requirements);
  if (Buffer.byteLength(value, 'utf8') > 16384) throw Object.assign(new Error('Maintenance objective exceeds its snapshot budget.'), {code:'ARCA_CARE_OBJECTIVE_TOO_LARGE'});
  const primaryBytes = context.raw.materials.filter(item => item.role === 'primary_payload')
    .reduce((total,item) => total + Number(item.size_bytes), 0);
  if (!Number.isSafeInteger(primaryBytes) || primaryBytes < 1) throw Object.assign(new Error('Maintenance primary size is unavailable.'), {code:'ARCA_CARE_OBJECTIVE_SOURCE_INVALID'});
  const parameters = {
    'target.requirements':value,
    'basis.requirementsDigest':canonicalDigest(requirements),
    'basis.inventoryRevision':context.basis.inventoryRevision,
    'basis.standardRevision':context.basis.standardRevision,
    'basis.placementRevision':context.basis.placementRevision,
    'basis.decisionFactSetDigest':context.basis.decisionFactSetDigest,
    'source.primaryBytes':primaryBytes,
  };
  return Object.freeze(Object.entries(parameters).map(([parameter,value]) => Object.freeze({parameter,
    valueType:typeof value === 'number' ? 'integer' : 'string', value, valueDigest:canonicalDigest(value)})));
}
function readCareObjective(requirement) {
  const parameter = requirement?.typedParameters?.find(item => item.parameter === 'target.requirements');
  if (!parameter) return null;
  if (parameter.valueDigest !== canonicalDigest(parameter.value)) throw new Error('Maintenance objective digest is invalid.');
  const value = JSON.parse(parameter.value);
  const digest = requirement.typedParameters.find(item => item.parameter === 'basis.requirementsDigest');
  if (digest?.value !== canonicalDigest(value)) throw new Error('Maintenance requirements digest is invalid.');
  return Object.freeze({requirements:value,requirementsDigest:digest.value});
}
module.exports = Object.freeze({acceptedRating,effectiveRequirements,careFindingCodes,freezeCareObjective,readCareObjective});
