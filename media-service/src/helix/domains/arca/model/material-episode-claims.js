'use strict';

const {
  canonicalDigest,
  canonicalJson,
} = require('../../../contracts/canonical-json');

const SCHEMA_REF =
  'helix://contracts/application-types/ArcaMaterialEpisodeClaims/v1';
const MAX_CANONICAL_BYTES = 16 * 1024;

class ArcaMaterialEpisodeClaimsError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ArcaMaterialEpisodeClaimsError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ArcaMaterialEpisodeClaimsError(code, message, details);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function hasExactKeys(value, expected) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key));
}

function isDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function buildArcaMaterialEpisodeClaims(value, constraints = {}) {
  if (!hasExactKeys(value, ['items', 'episodeClaimSetDigest']) ||
      !isDigest(value.episodeClaimSetDigest)) {
    fail('ARCA_EPISODE_CLAIMS_SHAPE',
      'Arca Material Episode Claims must match the exact closed schema.');
  }
  const items = value?.items;
  if (!Array.isArray(items) || items.length > 32) {
    fail('ARCA_EPISODE_CLAIMS_CARDINALITY',
      'Arca Material Episode Claims must contain at most 32 items.');
  }
  if (constraints.requireNonEmpty && items.length < 1) {
    fail('ARCA_EPISODE_CLAIMS_PRIMARY_REQUIRED',
      'A Series primary Product member requires Episode Claims.');
  }
  if (constraints.requireEmpty && items.length !== 0) {
    fail('ARCA_EPISODE_CLAIMS_ROLE',
      'A non-primary or single Product member requires an empty Episode Claim set.');
  }
  const normalized = items.map((item) => {
    if (!hasExactKeys(item, [
      'episodeKey',
      'seasonClaimDigest',
      'claimDigest',
    ]) ||
        typeof item.episodeKey !== 'string' ||
        [...item.episodeKey].length < 1 ||
        [...item.episodeKey].length > 256 ||
        !isDigest(item.seasonClaimDigest) ||
        !isDigest(item.claimDigest)) {
      fail('ARCA_EPISODE_CLAIM_SHAPE',
        'Arca Material Episode Claim identity is invalid.');
    }
    const claim = Object.freeze({
      episodeKey: item.episodeKey,
      seasonClaimDigest: item.seasonClaimDigest,
      claimDigest: canonicalDigest({
        schema: 'libra.production-material-episode-claim@1',
        episodeKey: item.episodeKey,
        seasonClaimDigest: item.seasonClaimDigest,
      }),
    });
    if (claim.claimDigest !== item.claimDigest) {
      fail('ARCA_EPISODE_CLAIM_DIGEST',
        'Arca Material Episode Claim digest is invalid.');
    }
    return claim;
  });
  const sorted = [...normalized].sort((left, right) =>
    compareUtf8(left.episodeKey, right.episodeKey));
  if (canonicalJson(sorted) !== canonicalJson(normalized) ||
      new Set(sorted.map((item) => item.episodeKey)).size !== sorted.length) {
    fail('ARCA_EPISODE_CLAIMS_ORDER',
      'Arca Material Episode Claims must be unique and UTF-8 ordered.');
  }
  const episodeClaimSetDigest = canonicalDigest({
    schema: 'libra.production-material-episode-claims@1',
    items: sorted,
  });
  if (value.episodeClaimSetDigest !== episodeClaimSetDigest) {
    fail('ARCA_EPISODE_CLAIM_SET_DIGEST',
      'Arca Material Episode Claim set digest is invalid.');
  }
  const result = Object.freeze({
    items: Object.freeze(sorted),
    episodeClaimSetDigest,
  });
  if (Buffer.byteLength(canonicalJson(result), 'utf8') >
      MAX_CANONICAL_BYTES) {
    fail('ARCA_EPISODE_CLAIMS_BYTES',
      'Arca Material Episode Claims exceed 16 KiB.');
  }
  return result;
}

function fromProductMember(member, contentProfile) {
  const value = {
    items: member?.episodeClaims || [],
    episodeClaimSetDigest: member?.episodeClaimSetDigest,
  };
  return buildArcaMaterialEpisodeClaims(value, {
    requireNonEmpty:
      contentProfile === 'series' && member?.role === 'primary_payload',
    requireEmpty:
      member?.role !== 'primary_payload' || contentProfile !== 'series',
  });
}

function emptyArcaMaterialEpisodeClaims() {
  const items = [];
  return buildArcaMaterialEpisodeClaims({
    items,
    episodeClaimSetDigest: canonicalDigest({
      schema: 'libra.production-material-episode-claims@1',
      items,
    }),
  }, { requireEmpty: true });
}

function parseArcaMaterialEpisodeClaims(row) {
  if (row?.episode_claims_schema_ref !== SCHEMA_REF ||
      typeof row.episode_claims_json !== 'string') {
    fail('ARCA_EPISODE_CLAIMS_PERSISTENCE',
      'Arca Material Episode Claims persistence identity is invalid.');
  }
  let value;
  try {
    value = JSON.parse(row.episode_claims_json);
  } catch {
    fail('ARCA_EPISODE_CLAIMS_PERSISTENCE',
      'Arca Material Episode Claims JSON is invalid.');
  }
  if (canonicalJson(value) !== row.episode_claims_json ||
      value.episodeClaimSetDigest !== row.episode_claim_set_digest) {
    fail('ARCA_EPISODE_CLAIMS_PERSISTENCE',
      'Arca Material Episode Claims persistence digest is invalid.');
  }
  return buildArcaMaterialEpisodeClaims(value);
}

module.exports = Object.freeze({
  ArcaMaterialEpisodeClaimsError,
  MAX_CANONICAL_BYTES,
  SCHEMA_REF,
  buildArcaMaterialEpisodeClaims,
  emptyArcaMaterialEpisodeClaims,
  fromProductMember,
  parseArcaMaterialEpisodeClaims,
});
