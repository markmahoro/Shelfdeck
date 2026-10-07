'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');

function explicitSeriesContinuityClaims({materialKey,context,seasonNumber}) {
  if(!Number.isSafeInteger(seasonNumber)||seasonNumber<1)return Object.freeze([]);
  const location=context.fieldRelativeLocation||[...(context.parentSegments||[]),context.baseName||''].join('/');
  const matches=[...location.matchAll(/\{tmdb-series-([^{}]*)\}/gi)];
  if(matches.length!==(location.match(/\{tmdb-series-/gi)||[]).length||matches.some(match=>!/^\d{1,16}$/.test(match[1])))return Object.freeze([]);
  const ids=[...new Set(matches.map(match=>BigInt(match[1]).toString()))];
  if(ids.length!==1||ids[0]==='0'||BigInt(ids[0])>BigInt(Number.MAX_SAFE_INTEGER))return Object.freeze([]);
  const claim={claimKind:'provider_season_identity',claimNamespace:'tmdb',claimKey:'series:'+ids[0]+':season:'+seasonNumber};
  return Object.freeze([Object.freeze({...claim,claimDigest:canonicalDigest({schema:'season-continuity-claim@1',...claim}),
    evidenceDigest:canonicalDigest({schema:'procurement.explicit-series-marker@1',materialKey,location,seasonNumber})})]);
}

function mergeExplicitSeriesContinuityClaims(units) {
  // Every physical member must explicitly agree. Missing or conflicting markers never inherit an anchor.
  if(!units.length||units.some(unit=>unit.seasonContinuityClaims.length!==1))return Object.freeze([]);
  const claims=units.map(unit=>unit.seasonContinuityClaims[0]);
  if(new Set(claims.map(claim=>claim.claimDigest)).size!==1)return Object.freeze([]);
  return Object.freeze([Object.freeze({...claims[0],evidenceDigest:canonicalDigest({schema:'procurement.explicit-series-marker-set@1',
    evidenceDigests:claims.map(claim=>claim.evidenceDigest).sort()})})]);
}
module.exports=Object.freeze({explicitSeriesContinuityClaims,mergeExplicitSeriesContinuityClaims});
