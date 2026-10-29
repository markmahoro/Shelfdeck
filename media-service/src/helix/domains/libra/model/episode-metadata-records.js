'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { buildEpisodeMetadataReview, confirmEpisodeMetadataReview } = require('./episode-metadata-review');
const REVIEW_SCHEMA = 'libra.episode-metadata-review-record@1';
const MAPPING_SCHEMA = 'libra.episode-metadata-mapping-record@1';
function fail() { throw Object.assign(new Error('Episode metadata record is invalid.'), { code: 'LIBRA_EPISODE_MAPPING_RECORD_INVALID' }); }
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function commandId(kind, libraRunId, actorId, idempotencyKey) {
  return canonicalDigest({ schema: 'libra.episode-metadata-command-id@1', kind, libraRunId, actorId, idempotencyKey });
}
function base(kind, review, actorId, idempotencyKey, requestDigest) {
  if (typeof actorId !== 'string' || !actorId || actorId.length > 256 || typeof idempotencyKey !== 'string' ||
      !idempotencyKey || idempotencyKey.length > 128 || !/^[a-f0-9]{64}$/.test(requestDigest)) fail();
  return { schemaRef: kind === 'review' ? REVIEW_SCHEMA : MAPPING_SCHEMA,
    recordId: commandId(kind, review.libraRunId, actorId, idempotencyKey), libraRunId: review.libraRunId,
    subjectId: review.subjectId, actorId, idempotencyKey, requestDigest };
}
function buildReviewRecord({ review, actorId, idempotencyKey, requestDigest }) {
  const { schemaRef, reviewDigest, ...input } = review || {}, checked = buildEpisodeMetadataReview(input);
  if (schemaRef !== checked.schemaRef || reviewDigest !== checked.reviewDigest) fail();
  const body = { ...base('review', checked, actorId, idempotencyKey, requestDigest), review: checked };
  return freeze({ ...body, recordDigest: canonicalDigest(body) });
}
function buildMappingRecord({ reviewRecord, choices, actorId, idempotencyKey, requestDigest, confirmedAtMs }) {
  const review = reviewRecord.review;
  const mapping = confirmEpisodeMetadataReview({ review, reviewDigest: review.reviewDigest, choices, actorId, confirmedAtMs });
  const body = { ...base('mapping', review, actorId, idempotencyKey, requestDigest), reviewId: reviewRecord.recordId,
    mapping, choices: JSON.parse(canonicalJson(choices)) };
  if (Buffer.byteLength(canonicalJson(body), 'utf8') > 1024 * 1024) fail();
  return freeze({ ...body, recordDigest: canonicalDigest(body) });
}
function assertReviewRecord(value) {
  const checked = buildReviewRecord(value || {});
  if (canonicalJson(checked) !== canonicalJson(value)) fail();
  return checked;
}
function assertMappingRecord(value, reviewRecord) {
  const checked = buildMappingRecord({ ...value, reviewRecord, confirmedAtMs: value?.mapping?.confirmedAtMs });
  if (canonicalJson(checked) !== canonicalJson(value)) fail();
  return checked;
}

module.exports = Object.freeze({ REVIEW_SCHEMA, MAPPING_SCHEMA, commandId, buildReviewRecord, buildMappingRecord, assertReviewRecord, assertMappingRecord });
