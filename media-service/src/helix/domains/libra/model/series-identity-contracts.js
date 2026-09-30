'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');

function positive(value) { return Number.isSafeInteger(value) && value > 0; }

function frozenSeriesSeasonNumber(snapshot) {
  const claim = snapshot?.candidateIdentityClaim;
  const season = claim?.seasonClaim;
  if (snapshot?.spec?.contentProfile !== 'series' || snapshot.spec.structureKind !== 'season' ||
      claim?.contentProfile !== 'series' || claim.claimKind !== 'series_season' ||
      season?.claimKind !== 'explicit_number' || !positive(season.seasonNumber) ||
      Object.keys(season).sort().join('|') !== 'claimDigest|claimKind|seasonNumber' ||
      season.claimDigest !== canonicalDigest({claimKind:'explicit_number',seasonNumber:season.seasonNumber})) {
    throw new TypeError('Series identity requires the exact frozen positive Season claim.');
  }
  return season.seasonNumber;
}

function buildProviderSeasonContinuityClaim(identity, evidenceDigest) {
  if (identity?.provider !== 'tmdb' || identity.namespace !== 'tmdb_series' ||
      typeof identity.providerKey !== 'string' || !/^[0-9]+$/.test(identity.providerKey) ||
      !positive(identity.seasonNumber) || !/^[a-f0-9]{64}$/.test(evidenceDigest || '')) {
    throw new TypeError('Series continuity requires a verified Provider Season tuple.');
  }
  const body = {claimKind:'provider_season_identity',claimNamespace:'tmdb',
    claimKey:'series:'+identity.providerKey+':season:'+identity.seasonNumber};
  return Object.freeze({...body,claimDigest:canonicalDigest({schema:'season-continuity-claim@1',...body}),evidenceDigest});
}

module.exports = Object.freeze({buildProviderSeasonContinuityClaim,frozenSeriesSeasonNumber});
