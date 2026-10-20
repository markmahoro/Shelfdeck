'use strict';
const {canonicalDigest, canonicalJson} = require('../../../contracts/canonical-json');
const POLICY = 'us-adult-actor-refresh@1';
const EFFECT_SCHEMA = 'helix://arca/aftercare-objectives/UsAdultActorRefresh/v1';
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function fail(code, message) { throw Object.assign(new TypeError(message), {code}); }
function immutable(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
}

function requirement(intent) {
  if (!hex(intent?.intentId) || !hex(intent.intentDigest) || !hex(intent.careBasisDigest)) {
    fail('ARCA_US_ADULT_REFRESH_REQUIREMENT_INVALID', 'Actor refresh objective requires its exact immutable Intent and Care Basis.');
  }
  const requiredEffects = [{ objectId:intent.intentId, revision:1, schemaRef:EFFECT_SCHEMA,
    digest:canonicalDigest({ intentId:intent.intentId, intentDigest:intent.intentDigest }), objectKind:'required-effect' }];
  const parameters = { 'source.triggerKind':'user_actor_refresh', 'target.actorRefreshIntentId':intent.intentId,
    'target.actorRefreshIntentDigest':intent.intentDigest };
  const body = { schemaRef:'helix://contracts/domain-types/CareRequirement/v1', schemaVersion:1,
    requirementId:'actor-refresh-'+intent.intentId, revision:1, careBasisDigest:intent.careBasisDigest,
    requiredEffects, acceptanceDigest:canonicalDigest({ schema:EFFECT_SCHEMA, policy:POLICY }),
    typedParameters:Object.entries(parameters).map(([parameter, value]) => ({ parameter, valueType:'string', value, valueDigest:canonicalDigest(value) })) };
  return immutable({ ...body, digest:canonicalDigest(body) });
}
function readRequirement(value) {
  const markers = value?.typedParameters?.filter(item => item.parameter === 'source.triggerKind') || [];
  if (!markers.some(item => item.value === 'user_actor_refresh')) return null;
  if (markers.length !== 1) fail('ARCA_US_ADULT_REFRESH_REQUIREMENT_INVALID', 'Actor refresh trigger must be unique.');
  const { digest, ...body } = value, parameters = value.typedParameters,
    intent = parameters.find(item => item.parameter === 'target.actorRefreshIntentId')?.value,
    intentDigest = parameters.find(item => item.parameter === 'target.actorRefreshIntentDigest')?.value;
  if (!hex(intent) || !hex(intentDigest) || !hex(value.careBasisDigest)) fail('ARCA_US_ADULT_REFRESH_REQUIREMENT_INVALID', 'Actor refresh objective references are incomplete.');
  const expected = requirement({ intentId:intent, intentDigest, careBasisDigest:value.careBasisDigest });
  if (!hex(intent) || !hex(intentDigest) || digest !== canonicalDigest(body) || canonicalJson(value) !== canonicalJson(expected)) {
    fail('ARCA_US_ADULT_REFRESH_REQUIREMENT_INVALID', 'Actor refresh requires its exact user Intent objective, not a health Finding.');
  }
  return Object.freeze({ intentId:intent, intentDigest });
}

module.exports = Object.freeze({POLICY, requirement, readRequirement});
