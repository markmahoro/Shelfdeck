'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalDigest, canonicalJson } = require('../../src/helix/contracts/canonical-json');
const { BETA_RECOMMENDED_RULES } = require('../../src/helix/domains/arca/model/rule-template-contracts');
const { describeCustomRequirement } = require('../../src/helix/contracts/custom-acceptance-requirements');
const { buildCustomTargetPreview, assertCustomTargetPreview, confirmCustomTarget, assertCustomTargetIntent } =
  require('../../src/helix/domains/libra/model/custom-target-records');
const hash = value => canonicalDigest(value);
function fixture(profile = 'movie') {
  const requirements = BETA_RECOMMENDED_RULES.profileRuleSets.find(row => row.contentProfile === profile)
    .decisionBranches.find(row => row.rating === 5).requirements;
  const basis = { subjectId: 'subject', libraRunId: 'old-run', runState: 'frozen', runStateRevision: 3,
    runStateDigest: hash('frozen'),runPackageRevisionHead:0,runExecutionBasisDigest: hash('basis'), baseAcceptanceSpecId: 'five-star-spec',
    runAcceptanceSpecId:'five-star-spec',runSpecRecordDigest:hash('record'),runSpecDigest:hash('five-star-semantics'),
    baseSpecRecordDigest: hash('record'), baseSpecDigest: hash('five-star-semantics'), decisionHeadDigest: hash('decision'),decisionHeadAcceptanceSpecId:'five-star-spec',
    shelfId: 'shelf', shelfStandardDigest: hash('standard'), shelfStandardRevision: 2, productScopeDigest: hash('scope'),
    materialSetDigest: hash('material'), identityDigest: hash('identity'),gapEvidenceSetDigest:hash('gaps'), customTargetRevision: 0, handoffState: 'no_offer',
    contentProfile: profile, structureKind: profile === 'series' ? 'season' : 'single' };
  const episodeScopes = profile === 'series' ? [{ episodeKey: 'E001', seasonNumber: 1, episodeNumber: 1 },
    { episodeKey: 'E002', seasonNumber: 1, episodeNumber: 2 }] : [];
  const proposal = (requirementCode, targetId, episodeScope) => ({
    change: describeCustomRequirement(requirements, { requirementCode, targetId, ...(episodeScope ? { episodeScope } : {}) }, episodeScopes),
    evidenceRefs: [{ resultId: 'actual-result-' + targetId, resultDigest: hash(targetId) }],
  });
  function preview(proposals = [proposal('minimum_raster_unmet', 'minimumRasterClass')], changedBasis = {}) {
    return buildCustomTargetPreview({ basis: { ...basis, ...changedBasis }, requirements, episodeScopes,
      proposals, actorId: 'admin', createdAtMs: 1000 });
  }
  function confirm(value, overrides = {}) {
    return confirmCustomTarget({ preview: value, expectedPreviewDigest: value.previewDigest, currentBasis: value.basis,
      selectedChangeDigests: value.proposals.map(item => item.changeDigest), acknowledged: true,
      actorId: 'admin', idempotencyKey: 'target-command', confirmedAtMs: 1100, ...overrides });
  }
  return { basis, requirements, episodeScopes, proposal, preview, confirm };
}

test('a custom target decision preserves the original five-star basis and explicitly requires new production', () => {
  const f = fixture(), original = canonicalJson(f.requirements), preview = f.preview([
    f.proposal('minimum_raster_unmet', 'minimumRasterClass'), f.proposal('primary_audio_unmet', 'acceptedPrimaryAudioClasses')]);
  const intent = f.confirm(preview);
  assert.equal(preview.outcome, 'requires_new_production');
  assert.equal(intent.basis.baseAcceptanceSpecId, 'five-star-spec');
  assert.equal(intent.target.requirements.mandatoryMedia.minimumRasterClass, 'none');
  assert.deepEqual(intent.target.requirements.mandatoryMedia.acceptedPrimaryAudioClasses, []);
  assert.equal(intent.target.requirements.space.maxSizeGiB, 50);
  assert.equal(intent.target.requirements.mandatoryMedia.videoCodec, 'hevc');
  assert.equal(intent.revision, 1);
  assert.equal(intent.libraRunId, 'old-run');
  assert.equal(intent.collectionId, undefined);
  assert.equal(canonicalJson(f.requirements), original);
  assert.equal(Object.isFrozen(intent.target.requirements.inventory), true);
  assert.deepEqual(assertCustomTargetPreview(preview), preview);
  assert.deepEqual(assertCustomTargetIntent(intent, preview), intent);
});

test('confirmation fences every original Run, decision, Shelf, material, identity and target revision', () => {
  const f = fixture(), preview = f.preview();
  for (const field of ['runStateDigest', 'runExecutionBasisDigest', 'runSpecRecordDigest','runSpecDigest','baseSpecRecordDigest', 'baseSpecDigest', 'decisionHeadDigest',
    'shelfStandardDigest', 'productScopeDigest', 'materialSetDigest', 'identityDigest','gapEvidenceSetDigest'])
    assert.throws(() => f.confirm(preview, { currentBasis: { ...f.basis, [field]: hash('changed-' + field) } }),
      { code: 'LIBRA_CUSTOM_TARGET_PREVIEW_STALE' }, field);
  for (const field of ['runStateRevision', 'runPackageRevisionHead','shelfStandardRevision', 'customTargetRevision'])
    assert.throws(() => f.confirm(preview, { currentBasis: { ...f.basis, [field]: f.basis[field] + 1 } }),
      { code: 'LIBRA_CUSTOM_TARGET_PREVIEW_STALE' }, field);
  for(const field of ['runAcceptanceSpecId','baseAcceptanceSpecId','decisionHeadAcceptanceSpecId'])
    assert.throws(()=>f.confirm(preview,{currentBasis:{...f.basis,[field]:'changed-spec'}}),{code:'LIBRA_CUSTOM_TARGET_PREVIEW_STALE'},field);
  for (const overrides of [{ actorId: 'another-admin' }, { acknowledged: false }])
    assert.throws(() => f.confirm(preview, overrides), { code: 'LIBRA_CUSTOM_TARGET_CONFIRMATION_REQUIRED' });
  assert.throws(() => f.confirm(preview, { expectedPreviewDigest: hash('different-preview') }), { code: 'LIBRA_CUSTOM_TARGET_PREVIEW_STALE' });
});

test('Arca Accepted and committed responsibility cannot become a Libra target replacement', () => {
  const f = fixture();
  assert.throws(() => f.preview(undefined, { handoffState: 'accepted' }), { code: 'LIBRA_CUSTOM_TARGET_ARCA_RESPONSIBILITY' });
  for (const runState of ['completed', 'discarded', 'superseded'])
    assert.throws(() => f.preview(undefined, { runState }), { code: 'LIBRA_CUSTOM_TARGET_SCOPE' });
  const offered = f.preview(undefined, { handoffState: 'not_accepted' });
  assert.equal(f.confirm(offered).basis.handoffState, 'not_accepted');
  // A still-unaccepted Offer must be invalidated by the Owner's admission transaction,
  // rather than interpreting this pure intent as a handoff cancellation receipt.
  assert.equal(f.confirm(offered).offerInvalidated, undefined);
});

test('one local Episode exception does not remove the requirement from any sibling', () => {
  const f = fixture('series'), preview = f.preview([f.proposal('metadata_field_unmet', 'episode_plot', f.episodeScopes[0])]), intent = f.confirm(preview);
  assert.ok(intent.target.requirements.metadata.requiredFieldCodes.includes('episode_plot'));
  assert.deepEqual(intent.target.episodeMetadataOverrides.map(row => row.episodeScope), [f.episodeScopes[0]]);
  assert.equal(intent.target.episodeMetadataOverrides[0].requiredFieldCodes.includes('episode_plot'), false);
});

test('only the exact shown choices are confirmable and replay identity never hides a changed request', () => {
  const f = fixture(), preview = f.preview([f.proposal('minimum_raster_unmet', 'minimumRasterClass'),
    f.proposal('primary_audio_unmet', 'acceptedPrimaryAudioClasses')]), first = f.confirm(preview);
  assert.deepEqual(first, f.confirm(preview, { selectedChangeDigests: [...first.selectedChangeDigests].reverse() }));
  const subset = f.confirm(preview, { selectedChangeDigests: first.selectedChangeDigests.slice(0, 1) });
  assert.equal(first.intentId, subset.intentId);
  assert.notEqual(first.requestDigest, subset.requestDigest);
  assert.notEqual(first.intentDigest, subset.intentDigest);
  // Persistence must reject this same-key/different-request pair, never call it a replay.
  for (const selectedChangeDigests of [[], [hash('unshown')], [first.selectedChangeDigests[0], first.selectedChangeDigests[0]]])
    assert.throws(() => f.confirm(preview, { selectedChangeDigests }), { code: 'LIBRA_CUSTOM_TARGET_SELECTION' });
});

test('evidence, proposals and complete record closure cannot be changed after confirmation', () => {
  const f = fixture(), proposal = f.proposal('minimum_raster_unmet', 'minimumRasterClass'), preview = f.preview();
  assert.throws(() => f.preview([{ ...proposal, evidenceRefs: [] }]), { code: 'LIBRA_CUSTOM_TARGET_EVIDENCE' });
  assert.throws(() => f.preview([proposal, { ...proposal, evidenceRefs: [{ resultId: 'another', resultDigest: hash('another') }] }]),
    { code: 'LIBRA_CUSTOM_TARGET_DUPLICATE_CHANGE' });
  const intent = f.confirm(preview), tampered = JSON.parse(canonicalJson(intent));
  tampered.target.requirements.space.maxSizeGiB = null;
  tampered.intentDigest = hash(Object.fromEntries(Object.entries(tampered).filter(([key]) => key !== 'intentDigest')));
  assert.throws(() => assertCustomTargetIntent(tampered, preview), { code: 'LIBRA_CUSTOM_TARGET_RECORD_INVALID' });
  assert.throws(() => assertCustomTargetPreview({ ...preview, finished: true }), { code: 'LIBRA_CUSTOM_TARGET_RECORD_INVALID' });
});
