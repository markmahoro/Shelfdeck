'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {buildEpisodeMetadataScope}=require('../../../contracts/episode-metadata-scope');
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

module.exports={seriesMetadataScopes};
