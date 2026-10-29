'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
// A new identity observation has new evidence even when it confirms the same
// exact show and local Season. Preserve the original evidence digest separately;
// only this Owner-defined identity scope may establish mapping applicability.
function episodeMetadataIdentityScope(value) {
  if(!value||typeof value.subjectId!=='string'||!value.subjectId||value.structureKind!=='season'||
      value.contentProfile!=='series'||value.identityKind!=='tmdb_series_season'||
      !/^[a-f0-9]{64}$/.test(value.providerIdentitySetDigest||''))
    throw Object.assign(new Error('Episode mapping requires an exact Series identity scope.'),{code:'LIBRA_EPISODE_MAPPING_IDENTITY'});
  return canonicalDigest({schema:'libra.episode-metadata-identity-scope@1',subjectId:value.subjectId,
    structureKind:value.structureKind,contentProfile:value.contentProfile,identityKind:value.identityKind,
    providerIdentitySetDigest:value.providerIdentitySetDigest});
}
module.exports={episodeMetadataIdentityScope};
