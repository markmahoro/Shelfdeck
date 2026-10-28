'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { buildEpisodeMetadataScope } = require('../../../contracts/episode-metadata-scope');
const { describeCustomRequirement, applyCustomRequirementChanges } = require('../../../contracts/custom-acceptance-requirements');
const { validateRequirements } = require('./acceptance-spec-contracts');

const PREVIEW_SCHEMA = 'libra.custom-target-preview@1';
const INTENT_SCHEMA = 'libra.custom-target-intent@1';
const DIGEST = /^[a-f0-9]{64}$/;
const BASIS_KEYS = ['subjectId', 'libraRunId', 'runState', 'runStateRevision', 'runStateDigest', 'runExecutionBasisDigest',
  'runAcceptanceSpecId', 'runSpecRecordDigest', 'runSpecDigest', 'baseAcceptanceSpecId', 'baseSpecRecordDigest', 'baseSpecDigest',
  'decisionHeadDigest', 'decisionHeadAcceptanceSpecId', 'shelfId', 'shelfStandardDigest',
  'shelfStandardRevision', 'productScopeDigest', 'materialSetDigest', 'identityDigest', 'customTargetRevision', 'handoffState',
  'contentProfile', 'structureKind'];
const compare = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort()))
    fail('LIBRA_CUSTOM_TARGET_SHAPE', 'Custom target input must match its closed contract.');
}
function text(value, maximum = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum)
    fail('LIBRA_CUSTOM_TARGET_VALUE', 'Custom target identity is empty or exceeds its bound.');
  return value;
}
function digest(value) {
  if (typeof value !== 'string' || !DIGEST.test(value)) fail('LIBRA_CUSTOM_TARGET_DIGEST', 'Custom target evidence requires SHA-256.');
  return value;
}
function integer(value, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail('LIBRA_CUSTOM_TARGET_VALUE', 'Custom target revision or timestamp is invalid.');
  return value;
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function copy(value) { return JSON.parse(canonicalJson(value)); }
function limited(value) {
  if (Buffer.byteLength(canonicalJson(value)) > 65536) fail('LIBRA_CUSTOM_TARGET_LIMIT', 'Custom target record exceeds 64 KiB.');
  return freeze(value);
}
function validateBasis(input) {
  exact(input, BASIS_KEYS);
  for (const key of ['subjectId', 'libraRunId', 'runAcceptanceSpecId', 'baseAcceptanceSpecId', 'decisionHeadAcceptanceSpecId', 'shelfId']) text(input[key]);
  for (const key of BASIS_KEYS.filter(key => key.endsWith('Digest'))) digest(input[key]);
  integer(input.runStateRevision, 1); integer(input.shelfStandardRevision, 1); integer(input.customTargetRevision);
  integer(input.customTargetRevision + 1, 1);
  if (!['active', 'suspended', 'frozen'].includes(input.runState) ||
      !['movie', 'series', 'jav', 'western_adult'].includes(input.contentProfile) ||
      (input.contentProfile === 'series' ? input.structureKind !== 'season' : input.structureKind !== 'single'))
    fail('LIBRA_CUSTOM_TARGET_SCOPE', 'Custom target requires a current uncommitted Run and exact product profile.');
  if (!['no_offer', 'not_accepted', 'accepted'].includes(input.handoffState))
    fail('LIBRA_CUSTOM_TARGET_HANDOFF', 'Custom target requires explicit Handoff responsibility.');
  return copy(input);
}
function scopeList(values, basis) {
  if (!Array.isArray(values) || values.length > 1024 || (basis.structureKind === 'single' && values.length) ||
      (basis.structureKind === 'season' && !values.length))
    fail('LIBRA_CUSTOM_TARGET_SCOPE', 'Custom target Episode scopes must cover the frozen product.');
  const result = values.map(buildEpisodeMetadataScope).sort((a, b) => compare(a.episodeKey, b.episodeKey));
  if (new Set(result.map(item => item.episodeKey)).size !== result.length ||
      new Set(result.map(item => item.seasonNumber + '/' + item.episodeNumber)).size !== result.length)
    fail('LIBRA_CUSTOM_TARGET_SCOPE', 'Custom target cannot duplicate local Episode identity.');
  return result;
}
function evidence(values) {
  if (!Array.isArray(values) || !values.length || values.length > 16)
    fail('LIBRA_CUSTOM_TARGET_EVIDENCE', 'Each proposed change requires bounded exact evidence references.');
  const result = values.map(value => {
    exact(value, ['resultId', 'resultDigest']);
    return { resultId: text(value.resultId), resultDigest: digest(value.resultDigest) };
  }).sort((a, b) => compare(a.resultId, b.resultId));
  if (new Set(result.map(item => item.resultId)).size !== result.length)
    fail('LIBRA_CUSTOM_TARGET_EVIDENCE', 'Custom target cannot duplicate or contradict one Result reference.');
  return result;
}
function buildCustomTargetPreview({ basis, requirements, episodeScopes = [], proposals, actorId, createdAtMs }) {
  basis = validateBasis(basis);
  if (basis.handoffState === 'accepted')
    fail('LIBRA_CUSTOM_TARGET_ARCA_RESPONSIBILITY', 'Arca owns this accepted product; Libra cannot replace its target.');
  const baseRequirements = copy(validateRequirements(requirements, basis.contentProfile, basis.structureKind));
  const scopes = scopeList(episodeScopes, basis);
  if (!Array.isArray(proposals) || !proposals.length || proposals.length > 256)
    fail('LIBRA_CUSTOM_TARGET_LIMIT', 'Custom target preview requires 1..256 evidenced proposals.');
  const choices = proposals.map(proposal => {
    exact(proposal, ['change', 'evidenceRefs']);
    const change = describeCustomRequirement(baseRequirements, proposal.change, scopes);
    if (canonicalJson(change) !== canonicalJson(proposal.change))
      fail('LIBRA_CUSTOM_TARGET_REQUIREMENT_STALE', 'Custom target proposal differs from the frozen base requirement.');
    const body = { change, evidenceRefs: evidence(proposal.evidenceRefs) };
    return { ...body, changeDigest: canonicalDigest(body) };
  }).sort((a, b) => compare(a.changeDigest, b.changeDigest));
  // One requirement cannot be presented as two independently selectable facts.
  if (new Set(choices.map(item => canonicalJson(item.change))).size !== choices.length)
    fail('LIBRA_CUSTOM_TARGET_DUPLICATE_CHANGE', 'Custom target preview contains duplicate requirement choices.');
  const body = { schemaRef: PREVIEW_SCHEMA, basis, baseRequirements, episodeScopes: scopes, proposals: choices,
    actorId: text(actorId), createdAtMs: integer(createdAtMs), outcome: 'requires_new_production' };
  return limited({ ...body, previewDigest: canonicalDigest(body) });
}
function assertCustomTargetPreview(value) {
  const checked = buildCustomTargetPreview({ ...value, requirements: value?.baseRequirements,
    proposals: value?.proposals?.map(({ change, evidenceRefs }) => ({ change, evidenceRefs })) });
  if (canonicalJson(checked) !== canonicalJson(value)) fail('LIBRA_CUSTOM_TARGET_RECORD_INVALID', 'Custom target preview integrity failed.');
  return checked;
}
function confirmCustomTarget({ preview, expectedPreviewDigest, currentBasis, selectedChangeDigests, acknowledged,
  actorId, idempotencyKey, confirmedAtMs }) {
  preview = assertCustomTargetPreview(preview);
  if (preview.previewDigest !== expectedPreviewDigest || canonicalJson(validateBasis(currentBasis)) !== canonicalJson(preview.basis))
    fail('LIBRA_CUSTOM_TARGET_PREVIEW_STALE', 'Custom target facts changed; request a fresh preview.');
  if (actorId !== preview.actorId || acknowledged !== true)
    fail('LIBRA_CUSTOM_TARGET_CONFIRMATION_REQUIRED', 'The preview actor must explicitly confirm the exact target changes.');
  if (!Array.isArray(selectedChangeDigests) || !selectedChangeDigests.length || selectedChangeDigests.length > 256 ||
      new Set(selectedChangeDigests).size !== selectedChangeDigests.length)
    fail('LIBRA_CUSTOM_TARGET_SELECTION', 'Select a non-empty unique subset of the exact preview choices.');
  const selected = selectedChangeDigests.map(digest).sort(compare), byDigest = new Map(preview.proposals.map(item => [item.changeDigest, item]));
  if (selected.some(key => !byDigest.has(key))) fail('LIBRA_CUSTOM_TARGET_SELECTION', 'A selected change was not shown in the frozen preview.');
  const target = applyCustomRequirementChanges({ requirements: preview.baseRequirements, episodeScopes: preview.episodeScopes,
    changes: selected.map(key => byDigest.get(key).change) });
  const request = { subjectId: preview.basis.subjectId, libraRunId: preview.basis.libraRunId,
    previewDigest: preview.previewDigest, selectedChangeDigests: selected, acknowledged: true },
    requestDigest = canonicalDigest(request), key = text(idempotencyKey, 128), actor = text(actorId),
    intentId = canonicalDigest({ schema: 'libra.custom-target-command-id@1', subjectId: request.subjectId, actorId: actor, idempotencyKey: key }),
    body = { schemaRef: INTENT_SCHEMA, intentId, subjectId: request.subjectId, libraRunId: request.libraRunId,
      revision: preview.basis.customTargetRevision + 1, basis: preview.basis, previewDigest: preview.previewDigest,
      selectedChangeDigests: selected, target, actorId: actor, idempotencyKey: key, requestDigest,
      acknowledged: true, confirmedAtMs: integer(confirmedAtMs) };
  // A confirmation is a durable target intent, never a production or collection receipt.
  return limited({ ...body, intentDigest: canonicalDigest(body) });
}
function assertCustomTargetIntent(value, preview) {
  const checked = confirmCustomTarget({ preview, expectedPreviewDigest: value?.previewDigest, currentBasis: value?.basis,
    selectedChangeDigests: value?.selectedChangeDigests, acknowledged: value?.acknowledged,
    actorId: value?.actorId, idempotencyKey: value?.idempotencyKey, confirmedAtMs: value?.confirmedAtMs });
  if (canonicalJson(checked) !== canonicalJson(value)) fail('LIBRA_CUSTOM_TARGET_RECORD_INVALID', 'Custom target intent integrity failed.');
  return checked;
}

module.exports = Object.freeze({ PREVIEW_SCHEMA, INTENT_SCHEMA, validateBasis, buildCustomTargetPreview,
  assertCustomTargetPreview, confirmCustomTarget, assertCustomTargetIntent });
