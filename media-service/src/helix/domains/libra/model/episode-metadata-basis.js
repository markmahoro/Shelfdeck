'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { seriesMetadataScopes } = require('./series-metadata-scopes');
const { episodeMetadataIdentityScope } = require('./episode-metadata-identity-scope');
function fail(code) { throw Object.assign(new Error(code), { code }); }

// Metadata coordinates cannot change the identity or delivery scope of the
// local Season. This stable material basis can survive an explicit replacement
// Run, but any change of physical identity or local Episode invalidates it.
function buildEpisodeMetadataBasis(snapshot, identity) {
  if (!snapshot || snapshot.spec?.contentProfile !== 'series' || !identity?.factValue ||
      identity.factValue.subjectId !== snapshot.run.subjectId || identity.factValue.contentProfile !== 'series' ||
      identity.factValue.structureKind !== 'season') fail('LIBRA_EPISODE_MAPPING_IDENTITY');
  const providers = identity.factValue.providerIdentities.filter(item => item.provider === 'tmdb' && item.namespace === 'tmdb_series');
  if (providers.length !== 1) fail('LIBRA_EPISODE_MAPPING_IDENTITY');
  const members = seriesMetadataScopes(snapshot, identity).map(localScope => {
    const matched = snapshot.members.filter(member => member.role === 'primary_payload' &&
      member.episodeClaims?.some(claim => claim.episodeKey === localScope.episodeKey));
    if (matched.length !== 1 || matched[0].episodeClaims.length !== 1) fail('LIBRA_EPISODE_MAPPING_MULTIPART_UNSUPPORTED');
    const member = matched[0];
    return Object.freeze({ materialKey: member.materialKey, localScope,
      title: String(member.location || '').split(/[\\/]/).pop(), airDate: '' });
  });
  if (new Set(members.map(member => member.materialKey)).size !== members.length) fail('LIBRA_EPISODE_MAPPING_MULTIPART_UNSUPPORTED');
  const materialSetDigest = canonicalDigest({ schema: 'libra.episode-metadata-material-set@1',
    members: members.map(({ materialKey, localScope }) => ({ materialKey, localScope })) });
  return Object.freeze({ subjectId: snapshot.run.subjectId, libraRunId: snapshot.run.libraRunId,
    runStateRevision: snapshot.run.stateRevision, runExecutionBasisDigest: snapshot.run.executionBasisDigest,
    identityDigest: identity.factValue.identityDigest, identityScopeDigest: episodeMetadataIdentityScope(identity.factValue), materialSetDigest, providerKey: providers[0].providerKey,
    members: Object.freeze(members) });
}

module.exports = Object.freeze({ buildEpisodeMetadataBasis });
