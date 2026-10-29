'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { buildEpisodeMetadataScope } = require('../../../contracts/episode-metadata-scope');
const { buildProviderEpisodeReference } = require('../../../contracts/provider-episode-reference');
const SCHEMA = 'libra.episode-metadata-mapping@1';
const DIGEST = /^[a-f0-9]{64}$/;
function fail(code, details) { throw Object.assign(new TypeError(code), { code, ...(details ? { details } : {}) }); }
function exact(value, fields) {
  if (!value || Array.isArray(value) || typeof value !== 'object' ||
      canonicalJson(Object.keys(value).sort()) !== canonicalJson([...fields].sort())) fail('LIBRA_EPISODE_MAPPING_SHAPE');
}

function buildEpisodeMetadataMapping(value) {
  exact(value, ['schemaRef', 'subjectId', 'identityDigest', 'identityScopeDigest', 'materialSetDigest', 'providerKey',
    'revision', 'actorId', 'confirmedAtMs', 'entries']);
  if (value.schemaRef !== SCHEMA || typeof value.subjectId !== 'string' || !value.subjectId ||
      !DIGEST.test(value.identityDigest) || !DIGEST.test(value.identityScopeDigest) || !DIGEST.test(value.materialSetDigest) ||
      typeof value.providerKey !== 'string' || !/^[1-9][0-9]{0,14}$/.test(value.providerKey) ||
      !Number.isSafeInteger(value.revision) || value.revision < 1 ||
      typeof value.actorId !== 'string' || !value.actorId ||
      !Number.isSafeInteger(value.confirmedAtMs) || value.confirmedAtMs < 0 ||
      !Array.isArray(value.entries) || !value.entries.length || value.entries.length > 256)
    fail('LIBRA_EPISODE_MAPPING_INVALID');
  const locals = new Set(), providers = new Set(), providerIds = new Set(), materials = new Set();
  const entries = value.entries.map(entry => {
    exact(entry, ['localScope', 'materialKey', 'providerEpisode', 'evidenceDigest']);
    const localScope = buildEpisodeMetadataScope(entry.localScope);
    const providerEpisode = buildProviderEpisodeReference(entry.providerEpisode);
    if (typeof entry.materialKey !== 'string' || !entry.materialKey || !DIGEST.test(entry.evidenceDigest) ||
        providerEpisode.providerKey !== value.providerKey) fail('LIBRA_EPISODE_MAPPING_IDENTITY');
    const localKey = canonicalJson(localScope), providerKey = canonicalJson([
      providerEpisode.providerKey, providerEpisode.seasonNumber, providerEpisode.episodeNumber]);
    if (locals.has(localKey) || providers.has(providerKey) || providerIds.has(providerEpisode.episodeId))
      fail('LIBRA_EPISODE_MAPPING_DUPLICATE');
    if (materials.has(entry.materialKey)) fail('LIBRA_EPISODE_MAPPING_MULTIPART_UNSUPPORTED');
    materials.add(entry.materialKey);
    locals.add(localKey); providers.add(providerKey); providerIds.add(providerEpisode.episodeId);
    return Object.freeze({ localScope, materialKey: entry.materialKey, providerEpisode, evidenceDigest: entry.evidenceDigest });
  }).sort((a, b) => a.localScope.seasonNumber - b.localScope.seasonNumber ||
    a.localScope.episodeNumber - b.localScope.episodeNumber);
  const body = { ...value, entries: Object.freeze(entries) };
  return Object.freeze({ ...body, mappingDigest: canonicalDigest(body) });
}

function assertEpisodeMetadataMapping(record, basis) {
  const { mappingDigest, ...body } = record || {};
  const mapping = buildEpisodeMetadataMapping(body);
  if (mapping.mappingDigest !== mappingDigest) fail('LIBRA_EPISODE_MAPPING_DIGEST');
  if (mapping.subjectId !== basis.subjectId || mapping.identityScopeDigest !== basis.identityScopeDigest ||
      mapping.materialSetDigest !== basis.materialSetDigest || mapping.providerKey !== basis.providerKey)
    fail('LIBRA_EPISODE_MAPPING_STALE', { changed: ['subjectId','identityScopeDigest','materialSetDigest','providerKey'].filter(key=>mapping[key]!==basis[key]) });
  for (const entry of mapping.entries) {
    if (!basis.members.some(member => member.materialKey === entry.materialKey &&
        canonicalJson(member.localScope) === canonicalJson(entry.localScope)))
      fail('LIBRA_EPISODE_MAPPING_MATERIAL');
    if (!basis.evidence.some(e => e.evidenceDigest === entry.evidenceDigest &&
        canonicalJson(e.providerEpisode) === canonicalJson(entry.providerEpisode)))
      fail('LIBRA_EPISODE_MAPPING_EVIDENCE');
  }
  return mapping;
}

// The fetched identity is checked before local numbering is projected. Plot and
// title always originate from the explicitly confirmed Provider Episode.
function projectMappedEpisode(entry, observation) {
  const provider = buildProviderEpisodeReference(observation.providerEpisode);
  if (canonicalJson(provider) !== canonicalJson(entry.providerEpisode)) fail('LIBRA_EPISODE_MAPPING_RESPONSE');
  const local = buildEpisodeMetadataScope(entry.localScope);
  if (!Array.isArray(observation.descriptiveEntries)) fail('LIBRA_EPISODE_MAPPING_RESPONSE');
  const fields = new Map();
  for (const field of observation.descriptiveEntries) {
    if (!field || typeof field.key !== 'string' || fields.has(field.key)) fail('LIBRA_EPISODE_MAPPING_RESPONSE');
    fields.set(field.key, field.value);
  }
  if (fields.get('season_number') !== provider.seasonNumber || fields.get('episode_number') !== provider.episodeNumber)
    fail('LIBRA_EPISODE_MAPPING_RESPONSE');
  fields.set('season_number', local.seasonNumber);
  fields.set('episode_number', local.episodeNumber);
  return Object.freeze([...fields].sort(([a], [b]) => Buffer.from(a).compare(Buffer.from(b)))
    .map(([key, value]) => Object.freeze({ key, value })));
}

module.exports = Object.freeze({ SCHEMA, buildEpisodeMetadataMapping, assertEpisodeMetadataMapping, projectMappedEpisode });
