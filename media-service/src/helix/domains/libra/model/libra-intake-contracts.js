'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');

const CONTINUITY_HEAD_ID = 'active_subject_continuity';
const CLAIM_KINDS = new Set(['provider_season_identity', 'triage_grouping_lineage']);
const PROVENANCE_KINDS = new Set(['candidate', 'resolved_identity']);

class LibraIntakeContractError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'LibraIntakeContractError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new LibraIntakeContractError(code, message, details); }
function utf8Compare(left, right) { return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')); }
function exact(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(value, key))) fail(code, 'Value does not match its closed Libra Intake contract.');
}
function text(value, field) { if (typeof value !== 'string' || value.length === 0) fail('P8_INTAKE_TEXT', 'Text is required.', { field }); return value; }

function continuityHeadDigest(revision) {
  if (!Number.isSafeInteger(revision) || revision < 0) fail('P8_CONTINUITY_HEAD_REVISION', 'Continuity head revision must be non-negative.');
  return canonicalDigest({ schema:'libra.subject-continuity-head@1', headId:CONTINUITY_HEAD_ID, currentRevision:revision });
}

function normalizeClaim(claim) {
  exact(claim, ['claimKind','claimNamespace','claimKey','claimDigest','provenanceKind','provenanceRef'], 'P8_CONTINUITY_CLAIM_SHAPE');
  if (!CLAIM_KINDS.has(claim.claimKind) || !PROVENANCE_KINDS.has(claim.provenanceKind)) {
    fail('P8_CONTINUITY_CLAIM_KIND', 'Continuity claim kind or provenance is not registered.');
  }
  for (const field of ['claimNamespace','claimKey','claimDigest','provenanceRef']) text(claim[field], field);
  return Object.freeze({ ...claim });
}

function subjectContinuitySetDigest(subjectId, claims) {
  text(subjectId, 'subjectId');
  if (!Array.isArray(claims)) fail('P8_CONTINUITY_CLAIMS', 'Continuity claims must be an array.');
  const items = claims.map(normalizeClaim).sort((left, right) =>
    utf8Compare([left.claimKind,left.claimNamespace,left.claimKey,left.provenanceKind,left.provenanceRef].join('\0'),
      [right.claimKind,right.claimNamespace,right.claimKey,right.provenanceKind,right.provenanceRef].join('\0')));
  return canonicalDigest({ schema:'libra.subject-continuity-set@1', subjectId, items });
}

function subjectEpisodeScopeDigest(subjectId, episodeKeys) {
  text(subjectId, 'subjectId');
  if (!Array.isArray(episodeKeys)) fail('P8_EPISODE_SCOPE', 'Episode scope must be an array.');
  const normalized = [...new Set(episodeKeys.map((value) => text(value, 'episodeKey')))].sort(utf8Compare);
  if (normalized.length !== episodeKeys.length) fail('P8_EPISODE_SCOPE_DUPLICATE', 'Episode scope cannot contain duplicates.');
  return canonicalDigest({ schema:'libra.subject-episode-scope@1', subjectId, episodeKeys:normalized });
}

module.exports = Object.freeze({ CLAIM_KINDS, CONTINUITY_HEAD_ID, LibraIntakeContractError, PROVENANCE_KINDS,
  continuityHeadDigest, normalizeClaim, subjectContinuitySetDigest, subjectEpisodeScopeDigest, utf8Compare });
