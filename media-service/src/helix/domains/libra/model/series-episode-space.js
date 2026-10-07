'use strict';

function gcd(left, right) {
  while (right) [left, right] = [right, left % right];
  return left;
}

// The caller supplies the complete final Primary set, never a Season byte total.
// Keep fractional bytes exact so multiple parts cannot pass by rounding down.
function evaluateSeriesEpisodeSpace({members, episodeKeys, maxSizeBytes}) {
  if (!Array.isArray(members) || !members.length || members.length > 1024 ||
      !Array.isArray(episodeKeys) || !episodeKeys.length || episodeKeys.length > 1024 ||
      episodeKeys.some(key => typeof key !== 'string' || !key) ||
      new Set(episodeKeys).size !== episodeKeys.length ||
      (maxSizeBytes !== null && (!Number.isSafeInteger(maxSizeBytes) || maxSizeBytes < 1))) {
    throw new TypeError('Series space evaluation requires a bounded exact Episode scope and byte limit.');
  }
  const totals = new Map(episodeKeys.map(key => [key, {numerator:0n,denominator:1n,covered:false}]));
  const materials = new Set();
  for (const member of members) {
    const claims = member.episodeClaims;
    if (typeof member.materialKey !== 'string' || !member.materialKey || materials.has(member.materialKey) ||
        member.role !== 'primary_payload' || !Number.isSafeInteger(member.sizeBytes) || member.sizeBytes < 0 ||
        !Array.isArray(claims) || !claims.length || claims.length > 32 ||
        new Set(claims.map(claim => claim.episodeKey)).size !== claims.length ||
        claims.some(claim => !totals.has(claim.episodeKey))) {
      throw new TypeError('Series space members must be unique physical Primaries with complete in-scope Episode claims.');
    }
    materials.add(member.materialKey);
    for (const claim of claims) {
      const total = totals.get(claim.episodeKey), divisor = BigInt(claims.length);
      const numerator = total.numerator * divisor + BigInt(member.sizeBytes) * total.denominator;
      const denominator = total.denominator * divisor, factor = gcd(numerator, denominator);
      total.numerator = numerator / factor;
      total.denominator = denominator / factor;
      total.covered = true;
    }
  }
  if ([...totals.values()].some(total => !total.covered)) throw new TypeError('Series space evaluation is missing a Delivery Episode.');
  return Object.freeze([...totals].sort(([a],[b]) => Buffer.from(a).compare(Buffer.from(b))).map(([episodeKey,total]) =>
    Object.freeze({episodeKey,allocatedBytes:Object.freeze({numerator:total.numerator.toString(),denominator:total.denominator.toString()}),
      maxSizeBytes,withinLimit:maxSizeBytes === null || total.numerator <= BigInt(maxSizeBytes) * total.denominator})));
}

module.exports = Object.freeze({evaluateSeriesEpisodeSpace});
