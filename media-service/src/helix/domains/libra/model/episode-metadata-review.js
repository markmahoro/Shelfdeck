'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { buildEpisodeMetadataScope } = require('../../../contracts/episode-metadata-scope');
const { buildProviderEpisodeReference } = require('../../../contracts/provider-episode-reference');
const { SCHEMA, buildEpisodeMetadataMapping, assertEpisodeMetadataMapping } = require('./episode-metadata-mapping');
const SHA = /^[a-f0-9]{64}$/;
function fail(code) { throw Object.assign(new TypeError(code), { code }); }
function text(value, max, empty = false) { return typeof value === 'string' && value.length <= max && (empty || value.length > 0); }
function date(value) {
  return value === '' || typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00.000Z')) && new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10) === value;
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort()))
    fail('LIBRA_EPISODE_REVIEW_SHAPE');
}

function buildProviderEpisodeEvidence(value) {
  exact(value, ['integrationId', 'configRevision', 'language', 'providerEpisode', 'title', 'airDate', 'plot', 'observedAtMs']);
  if (!text(value.integrationId, 256) || !Number.isSafeInteger(value.configRevision) || value.configRevision < 1 ||
      !text(value.language, 32) || !text(value.title, 1024) || !text(value.plot, 16384, true) ||
      !date(value.airDate) ||
      !Number.isSafeInteger(value.observedAtMs) || value.observedAtMs < 0) fail('LIBRA_EPISODE_REVIEW_EVIDENCE');
  const body = { ...value, providerEpisode: buildProviderEpisodeReference(value.providerEpisode) };
  return Object.freeze({ ...body, evidenceDigest: canonicalDigest(body) });
}

function buildEpisodeMetadataReview(value) {
  exact(value, ['subjectId', 'libraRunId', 'runStateRevision', 'runExecutionBasisDigest', 'identityDigest', 'identityScopeDigest', 'materialSetDigest',
    'providerKey', 'expectedMappingRevision', 'members', 'evidence']);
  if (!text(value.subjectId, 256) || !text(value.libraRunId, 256) || !/^[1-9][0-9]{0,14}$/.test(value.providerKey || '') ||
      ![value.runExecutionBasisDigest, value.identityDigest, value.identityScopeDigest, value.materialSetDigest].every(v => SHA.test(v)) ||
      !Number.isSafeInteger(value.runStateRevision) || value.runStateRevision < 1 ||
      !Number.isSafeInteger(value.expectedMappingRevision) || value.expectedMappingRevision < 0 ||
      !Array.isArray(value.members) || !value.members.length || value.members.length > 256 ||
      !Array.isArray(value.evidence) || value.evidence.length > 1024) fail('LIBRA_EPISODE_REVIEW_INVALID');
  const locals = new Set(), materials = new Set();
  const members = value.members.map(member => {
    exact(member, ['materialKey', 'localScope', 'title', 'airDate']);
    const localScope = buildEpisodeMetadataScope(member.localScope), key = canonicalJson(localScope);
    if (!text(member.materialKey, 256) || !text(member.title, 1024, true) || !date(member.airDate)) fail('LIBRA_EPISODE_REVIEW_MATERIAL');
    if (locals.has(key) || materials.has(member.materialKey)) fail('LIBRA_EPISODE_MAPPING_MULTIPART_UNSUPPORTED');
    locals.add(key); materials.add(member.materialKey);
    return Object.freeze({ ...member, localScope });
  }).sort((a,b) => a.localScope.seasonNumber - b.localScope.seasonNumber || a.localScope.episodeNumber - b.localScope.episodeNumber);
  const seen = new Set();
  const evidence = value.evidence.map(record => {
    const { evidenceDigest, ...body } = record, checked = buildProviderEpisodeEvidence(body);
    if (checked.evidenceDigest !== evidenceDigest || checked.providerEpisode.providerKey !== value.providerKey || seen.has(evidenceDigest))
      fail('LIBRA_EPISODE_REVIEW_EVIDENCE');
    seen.add(evidenceDigest); return checked;
  }).sort((a,b) => a.evidenceDigest.localeCompare(b.evidenceDigest));
  const body = { schemaRef: 'libra.episode-metadata-review@1', ...value, members: Object.freeze(members), evidence: Object.freeze(evidence) };
  if (Buffer.byteLength(canonicalJson(body), 'utf8') > 2 * 1024 * 1024) fail('LIBRA_EPISODE_REVIEW_TOO_LARGE');
  return Object.freeze({ ...body, reviewDigest: canonicalDigest(body) });
}

function confirmEpisodeMetadataReview({ review, reviewDigest, choices, actorId, confirmedAtMs }) {
  const { schemaRef, reviewDigest: savedDigest, ...value } = review || {};
  const checked = buildEpisodeMetadataReview(value);
  if (schemaRef !== checked.schemaRef || reviewDigest !== savedDigest || checked.reviewDigest !== savedDigest)
    fail('LIBRA_EPISODE_REVIEW_STALE');
  if (!Array.isArray(choices) || !choices.length || choices.length > checked.members.length) fail('LIBRA_EPISODE_REVIEW_SELECTION_REQUIRED');
  const entries = choices.map(choice => {
    exact(choice, ['materialKey', 'localScope', 'evidenceDigest']);
    const localScope = buildEpisodeMetadataScope(choice.localScope);
    const material = checked.members.find(member => member.materialKey === choice.materialKey && canonicalJson(member.localScope) === canonicalJson(localScope));
    const observation = checked.evidence.find(evidence => evidence.evidenceDigest === choice.evidenceDigest);
    if (!material || !observation) fail('LIBRA_EPISODE_REVIEW_SELECTION_STALE');
    return { materialKey: material.materialKey, localScope, evidenceDigest: observation.evidenceDigest, providerEpisode: observation.providerEpisode };
  });
  // Neither count, title similarity nor a presumed cross-season offset chooses
  // an Episode. Each selected pair is supplied by the confirmed user command.
  return assertEpisodeMetadataMapping(buildEpisodeMetadataMapping({ schemaRef: SCHEMA, subjectId: checked.subjectId,
    identityDigest: checked.identityDigest, identityScopeDigest: checked.identityScopeDigest, materialSetDigest: checked.materialSetDigest, providerKey: checked.providerKey,
    revision: checked.expectedMappingRevision + 1, actorId, confirmedAtMs, entries }), checked);
}

module.exports = Object.freeze({ buildProviderEpisodeEvidence, buildEpisodeMetadataReview, confirmEpisodeMetadataReview });
