'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { validateTriageRuleSnapshot } = require('./procurement-run-contracts');

const PLAYABILITY_REASONS = Object.freeze(['probe_not_media', 'no_video_stream', 'non_positive_duration']);
const STRUCTURE_REASONS = Object.freeze([...PLAYABILITY_REASONS, 'content_profile_unresolved', 'conflicting_season_claim',
  'episode_claim_unresolved', 'disc_structure_incomplete', 'disc_multi_title_unsupported',
  'triage_unit_contract_too_large', 'structure_ambiguous']);
const CLAIM_KIND = Object.freeze({ movie:'movie_title', series:'series_season', jav:'jav_code', western_adult:'western_temporary' });

class ProcurementTriageError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'ProcurementTriageError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new ProcurementTriageError(code, message, details); }
function exact(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(value, key))) fail(code, 'Value does not match the closed Triage contract.');
}
function digest(value) { return canonicalDigest(value); }
function without(value, ...fields) { return Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key))); }
function compareUtf8(left, right) { return Buffer.compare(Buffer.from(left), Buffer.from(right)); }
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function text(value, field) { if (typeof value !== 'string' || !value) fail('P7_TRIAGE_TEXT_REQUIRED', field + ' is required.'); return value; }
function envelope(kind, producerRef, basis, observedAtMs) {
  return { schemaRef:'helix://contracts/types/' + kind + '/v1', schemaVersion:1, evidenceId:'', evidenceKind:kind,
    producerRef, basisDigest:digest(basis), payloadDigest:'', observedAtMs };
}

function validateBatch(batch) {
  exact(batch, ['procurementRunId','runBasisDigest','selectionDigest','batchOrdinal','members','batchDigest'], 'P7_TRIAGE_BATCH_SHAPE');
  if (!Number.isSafeInteger(batch.batchOrdinal) || batch.batchOrdinal < 0 || !Array.isArray(batch.members) ||
      batch.members.length < 1 || batch.members.length > 100 || batch.batchDigest !== digest(without(batch, 'batchDigest'))) {
    fail('P7_TRIAGE_BATCH_INVALID', 'Probe Batch bounds or digest is invalid.');
  }
  batch.members.forEach((member, index) => {
    exact(member, ['selectionOrdinal','materialKey','bindingRevision','admittedControlRevision','admittedControlProjectionDigest',
      'readHandle','mediaProbe','memberDigest'], 'P7_TRIAGE_BATCH_MEMBER_SHAPE');
    if (!Number.isSafeInteger(member.selectionOrdinal) || member.selectionOrdinal < 0 || index > 0 &&
        batch.members[index - 1].selectionOrdinal + 1 !== member.selectionOrdinal || member.memberDigest !== digest(without(member, 'memberDigest')) ||
        member.readHandle.identity.materialKey !== member.materialKey || member.readHandle.bindingRevision !== member.bindingRevision ||
        member.mediaProbe.sourceHandleDigest !== digest(member.readHandle)) fail('P7_TRIAGE_BATCH_MEMBER_INVALID', 'Probe member mapping or digest is invalid.');
  });
}

function inspectPlayability(batch, rule, options = {}) {
  validateTriageRuleSnapshot(rule); validateBatch(batch);
  const materialResults = batch.members.map((member) => {
    const probe = member.mediaProbe; const reasons = [];
    if (probe.resultKind !== 'probed') reasons.push('probe_not_media');
    else {
      if (!Array.isArray(probe.videoStreams) || probe.videoStreams.length < rule.rulePayload.playabilityRule.minimumVideoStreamCount) reasons.push('no_video_stream');
      if (!Number.isFinite(probe.durationMs) || probe.durationMs < rule.rulePayload.playabilityRule.minimumDurationMs) reasons.push('non_positive_duration');
    }
    const ordered = PLAYABILITY_REASONS.filter((reason) => reasons.includes(reason));
    const result = { selectionOrdinal:member.selectionOrdinal, materialKey:member.materialKey, bindingRevision:member.bindingRevision,
      probeEvidenceDigest:probe.payloadDigest, playable:ordered.length === 0, reasonCodes:ordered };
    return freeze({ ...result, resultDigest:digest(result) });
  });
  const value = { ...envelope('PlayabilityEvidence', 'procurement.triage.playability.inspect@1',
    { runBasisDigest:batch.runBasisDigest, batchDigest:batch.batchDigest, ruleAuthorityDigest:rule.authorityDigest }, options.observedAtMs || 0),
    procurementRunId:batch.procurementRunId, runBasisDigest:batch.runBasisDigest, selectionDigest:batch.selectionDigest,
    batchOrdinal:batch.batchOrdinal, materialResults, materialResultSetDigest:digest({ schema:'procurement.playability-result-set@1', items:materialResults }) };
  value.evidenceId = digest({ kind:'playability', procurementRunId:value.procurementRunId, batchOrdinal:value.batchOrdinal, basisDigest:value.basisDigest });
  value.payloadDigest = digest(without(value, 'payloadDigest'));
  return freeze(value);
}

function episodeToken(name) {
  const patterns = [/(?:^|[ ._-])S(\d{1,2})E(\d{1,3})(?:E|-)?(\d{1,3})?(?=$|[ ._-])/i,
    /(?:^|[ ._-])(\d{1,2})x(\d{1,3})(?:-(\d{1,3}))?(?=$|[ ._-])/i,
    /(?:^|[ ._-])第(\d{1,3})集(?=$|[ ._-])/i];
  for (let index=0; index<patterns.length; index++) {
    const match = name.match(patterns[index]); if (!match) continue;
    const season = index === 2 ? null : Number(match[1]); const start = Number(index === 2 ? match[1] : match[2]);
    const end = Number(index === 2 ? match[1] : match[3] || match[2]);
    if (end < start || end - start + 1 > 32) return null;
    return { season, episodes:Array.from({ length:end-start+1 }, (_, offset) => start + offset) };
  }
  return null;
}
function javCode(name) { const match = name.match(/(?:^|[ ._-])([A-Za-z]{2,10})[-_ ]?(\d{2,6})(?=$|[ ._-])/); return match ? match[1].toUpperCase() + '-' + match[2] : null; }
function titleFrom(context, temporaryLabel) { return (context.parentSegments.at(-1) || context.baseName || temporaryLabel).trim() || temporaryLabel; }
function seriesTitleFrom(context, temporaryLabel) {
  const stem = context.baseName.replace(/\.[^.]+$/, '');
  const match = stem.match(/(?:^|[ ._-])(?:S\d{1,2}E\d{1,3}(?:E|-)?\d{0,3}|\d{1,2}x\d{1,3}(?:-\d{1,3})?)(?=$|[ ._-])/i);
  const title = (match ? stem.slice(0, match.index) : stem)
    .replace(/[ ._-]+$/g, '')
    .trim();
  return title || titleFrom(context, temporaryLabel);
}
function contextMap(input) { return new Map(input.materialFieldContext.memberContexts.map((item) => [item.materialKey, item])); }
function probeMap(input) { return new Map(input.probeBatches.flatMap((batch) => batch.members).map((item) => [item.materialKey, item])); }
function playableMap(input) { return new Map(input.playabilityPages.flatMap((page) => page.materialResults).map((item) => [item.materialKey, item])); }
function validateStructureInput(input) {
  exact(input, ['selectedFieldMaterialSet','probeBatches','playabilityPages','materialFieldContext','layoutEvidence','pageRequest','inputDigest'],
    'P7_TRIAGE_STRUCTURE_INPUT_SHAPE');
  const selection = input.selectedFieldMaterialSet;
  if (!Array.isArray(selection.members) || selection.members.length < 1 || selection.members.length > 1024 ||
      !Array.isArray(input.probeBatches) || !Array.isArray(input.playabilityPages) || !Array.isArray(input.layoutEvidence)) {
    fail('P7_TRIAGE_STRUCTURE_INPUT_BOUNDS', 'Structure input collections are invalid.');
  }
  input.probeBatches.forEach(validateBatch);
  const probeMembers = input.probeBatches.flatMap((batch) => batch.members);
  const playResults = input.playabilityPages.flatMap((page) => page.materialResults);
  const contexts = input.materialFieldContext.memberContexts;
  for (const [index, member] of selection.members.entries()) {
    if (!probeMembers[index] || probeMembers[index].selectionOrdinal !== index || probeMembers[index].materialKey !== member.materialKey ||
        !playResults[index] || playResults[index].selectionOrdinal !== index || playResults[index].materialKey !== member.materialKey ||
        !contexts[index] || contexts[index].selectionOrdinal !== index || contexts[index].materialKey !== member.materialKey) {
      fail('P7_TRIAGE_STRUCTURE_COVERAGE', 'Probe, Playability, and Context must cover Selection exactly once in ordinal order.');
    }
  }
  if (probeMembers.length !== selection.members.length || playResults.length !== selection.members.length || contexts.length !== selection.members.length ||
      input.probeBatches.some((batch) => batch.procurementRunId !== selection.procurementRunId || batch.selectionDigest !== selection.selectionDigest) ||
      input.playabilityPages.some((page) => page.procurementRunId !== selection.procurementRunId || page.selectionDigest !== selection.selectionDigest) ||
      input.materialFieldContext.contextDigest !== digest(without(input.materialFieldContext, 'contextDigest')) ||
      input.pageRequest.requestDigest !== digest(without(input.pageRequest, 'requestDigest'))) {
    fail('P7_TRIAGE_STRUCTURE_FENCE', 'Structure input fence or canonical digest is invalid.');
  }
  const basis = { schema:'procurement.triage-structure-input@1', selectionDigest:selection.selectionDigest,
    probeBatchDigests:input.probeBatches.map((item) => item.batchDigest),
    playabilityPayloadDigests:input.playabilityPages.map((item) => item.payloadDigest), contextDigest:input.materialFieldContext.contextDigest,
    layoutPayloadDigests:[...input.layoutEvidence].sort((a,b) => compareUtf8(a.evidenceId,b.evidenceId)).map((item) => item.payloadDigest),
    pageRequest:input.pageRequest };
  if (input.inputDigest !== digest(basis)) fail('P7_TRIAGE_STRUCTURE_INPUT_DIGEST', 'Structure input digest is invalid.');
}

function relatedFor(context, layoutEvidence, primaryMaterialKey) {
  const primaryStem = context.baseName.replace(/\.[^.]+$/, '').toLowerCase(); const results = [];
  const refs = new Set(context.layoutEvidenceRefs.map((item) => item.evidenceId + '\0' + item.payloadDigest + '\0' + item.boundedScopeDigest));
  for (const evidence of layoutEvidence) {
    if (!refs.has(evidence.evidenceId + '\0' + evidence.payloadDigest + '\0' + evidence.boundedScopeDigest)) continue;
    for (const entry of evidence.entries || []) {
      if (entry.entryKind !== 'file' || !entry.identity || entry.checksumAlgorithm !== 'sha256' || !entry.checksumHex) continue;
      if (entry.identity.materialKey === primaryMaterialKey) continue;
      const lower = entry.baseName.toLowerCase(); const stem = lower.replace(/\.[^.]+$/, ''); const extension = (entry.extension || '').toLowerCase();
      const standard = /^(movie|tvshow)\.nfo$/.test(lower) || /^(poster|fanart)\./.test(lower);
      if (stem !== primaryStem && !standard) continue;
      const role = extension === '.nfo' ? 'nfo' : /\.(jpg|jpeg|png|webp)$/.test(extension) && stem === 'poster' ? 'poster'
        : /\.(jpg|jpeg|png|webp)$/.test(extension) && stem === 'fanart' ? 'fanart'
        : /\.(srt|ass|ssa|vtt)$/.test(extension) ? 'subtitle' : /\.(aac|ac3|dts|flac|mka)$/.test(extension) ? 'external_audio'
        : /\.(chapters|xml)$/.test(extension) ? 'chapter' : 'sidecar';
      const referenceId = digest({ schema:'procurement.related-material-reference-id@1', primaryMaterialKey, role,
        relatedMaterialKey:entry.identity.materialKey, endpointId:entry.endpointId, location:entry.location });
      const base = { referenceId,
        primaryMaterialKey, role, identity:entry.identity, endpointId:entry.endpointId, location:entry.location,
        checksumAlgorithm:'sha256', checksumHex:entry.checksumHex,
        associationEvidenceDigest:digest({ contextDigest:context.contextDigest || digest(context), layoutPayloadDigest:evidence.payloadDigest, entryDigest:entry.entryDigest }) };
      results.push({ ...base, referenceDigest:digest(base) });
    }
  }
  return results.sort((a,b) => compareUtf8(a.referenceId,b.referenceId));
}

function unitFor(member, context, profileName, mediaTypeName, season, episodes, relatedReferences) {
  const seasonClaim = profileName === 'series' ? (season === null
    ? { claimKind:'provisional_group', provisionalGroupKey:digest({ schema:'procurement.provisional-season-group@1', fieldId:context.fieldId,
      parentSegments:context.parentSegments }), claimDigest:'' }
    : { claimKind:'explicit_number', seasonNumber:season, claimDigest:'' }) : null;
  if (seasonClaim) seasonClaim.claimDigest = digest(without(seasonClaim, 'claimDigest'));
  const hints = [{ hintKind:'filename_title', hintValue:context.baseName, evidenceDigest:digest({ materialKey:member.materialKey, baseName:context.baseName }) }];
  const metadata = { claimedTitle:profileName === 'series'
      ? seriesTitleFrom(context, member.materialKey.slice(0, 12))
      : titleFrom(context, member.materialKey.slice(0, 12)), ...(seasonClaim ? { seasonClaim } : {}),
    ...(profileName === 'jav' ? { javCode:javCode(context.baseName) } : {}), contentProfileHint:profileName, sourceHints:hints };
  metadata.metadataDigest = digest(metadata);
  const claims = episodes.map((episode) => ({ episodeKey:'E' + String(episode).padStart(3,'0'),
    seasonClaimDigest:seasonClaim && seasonClaim.claimDigest || digest({ profile:profileName }), claimDigest:'' })).map((claim) =>
    ({ ...claim, claimDigest:digest(without(claim, 'claimDigest')) }));
  const unitMember = { materialKey:member.materialKey, bindingRevision:member.bindingRevision,
    admittedControlRevision:member.admittedControlRevision, admittedControlProjectionDigest:member.admittedControlProjectionDigest,
    role:'primary_payload', episodeClaims:claims };
  unitMember.memberClaimDigest = digest(unitMember);
  const value = { unitId:'', mediaType:mediaTypeName, contentProfile:profileName, structureKind:profileName === 'series' ? 'season' : 'single',
    displayIdentity:profileName === 'jav' ? metadata.javCode : metadata.claimedTitle, identityMetadata:metadata,
    seasonContinuityClaims:[], seasonContinuityClaimSetDigest:digest({ schema:'season-continuity-claim-set@1', items:[] }),
    members:[unitMember], relatedReferences, unitDigest:'' };
  value.unitId = digest({ schema:'procurement.triage-unit-id@1', mediaType:value.mediaType, contentProfile:value.contentProfile,
    structureKind:value.structureKind, members:value.members.map(({ materialKey, role, episodeClaims }) => ({ materialKey, role, episodeClaims })) });
  value.unitDigest = digest(without(value, 'unitDigest'));
  return value;
}

function mergeSeriesUnits(groups, unassigned) {
  const merged = [];
  for (const group of groups.values()) {
    const episodeOwners = new Map();
    let duplicate = false;
    for (const unit of group) {
      for (const member of unit.members) {
        for (const claim of member.episodeClaims) {
          if (episodeOwners.has(claim.episodeKey)) duplicate = true;
          episodeOwners.set(claim.episodeKey, member.materialKey);
        }
      }
    }
    if (duplicate) {
      for (const unit of group) {
        for (const member of unit.members) unassigned.push({
          materialKey:member.materialKey,
          reasonCode:'structure_ambiguous',
          evidenceDigest:digest({ schema:'procurement.series-episode-overlap@1',
            materialKey:member.materialKey, episodeClaims:member.episodeClaims }),
        });
      }
      continue;
    }
    const members = group.flatMap((unit) => unit.members)
      .sort((a,b) => compareUtf8(a.materialKey,b.materialKey));
    const relatedReferences = group.flatMap((unit) => unit.relatedReferences)
      .sort((a,b) => compareUtf8(a.referenceId,b.referenceId));
    const first = [...group].sort((a,b) => compareUtf8(a.unitId,b.unitId))[0];
    const sourceHints = group.flatMap((unit) => unit.identityMetadata.sourceHints)
      .sort((a,b) => compareUtf8(a.evidenceDigest,b.evidenceDigest));
    const identityMetadata = {
      claimedTitle:first.identityMetadata.claimedTitle,
      seasonClaim:first.identityMetadata.seasonClaim,
      contentProfileHint:'series',
      sourceHints,
    };
    identityMetadata.metadataDigest = digest(identityMetadata);
    const value = {
      unitId:'',
      mediaType:'group',
      contentProfile:'series',
      structureKind:'season',
      displayIdentity:identityMetadata.claimedTitle,
      identityMetadata,
      // A filename/path grouping is valid Triage evidence inside this Candidate,
      // but SSOT forbids upgrading it into an exact cross-Candidate continuity claim.
      seasonContinuityClaims:[],
      seasonContinuityClaimSetDigest:digest({ schema:'season-continuity-claim-set@1', items:[] }),
      members,
      relatedReferences,
      unitDigest:'',
    };
    value.unitId = digest({ schema:'procurement.triage-unit-id@1', mediaType:value.mediaType,
      contentProfile:value.contentProfile, structureKind:value.structureKind,
      members:value.members.map(({ materialKey, role, episodeClaims }) => ({ materialKey, role, episodeClaims })) });
    value.unitDigest = digest(without(value, 'unitDigest'));
    merged.push(value);
  }
  return merged;
}

function inspectStructure(input, rule, options = {}) {
  validateTriageRuleSnapshot(rule); validateStructureInput(input);
  const selection = input.selectedFieldMaterialSet; const contexts = contextMap(input); const probes = probeMap(input); const playable = playableMap(input);
  const units = []; const unassigned = []; const seriesGroups = new Map();
  for (const selected of selection.members) {
    const context = contexts.get(selected.materialKey); const probe = probes.get(selected.materialKey); const play = playable.get(selected.materialKey);
    if (!context || !probe || !play || probe.bindingRevision !== selected.bindingRevision) fail('P7_TRIAGE_STRUCTURE_MAPPING', 'Structure input does not exactly cover Selection.');
    if (!play.playable) { unassigned.push({ materialKey:selected.materialKey, reasonCode:play.reasonCodes[0], evidenceDigest:play.resultDigest }); continue; }
    if (probe.mediaProbe.discTopology && probe.mediaProbe.discTopology.titleCount !== 1) {
      unassigned.push({ materialKey:selected.materialKey, reasonCode:'disc_multi_title_unsupported', evidenceDigest:probe.mediaProbe.payloadDigest }); continue;
    }
    const token = episodeToken(context.baseName); const hint = input.materialFieldContext.contentProfileHint;
    const profileName = hint === 'mixed' ? (token ? 'series' : javCode(context.baseName) ? 'jav' : 'movie') : hint;
    if (!CLAIM_KIND[profileName] || profileName === 'series' && !token) {
      unassigned.push({ materialKey:selected.materialKey, reasonCode:profileName === 'series' ? 'episode_claim_unresolved' : 'content_profile_unresolved',
        evidenceDigest:digest({ materialKey:selected.materialKey, contextDigest:input.materialFieldContext.contextDigest }) }); continue;
    }
    const related = relatedFor({ ...context, contextDigest:input.materialFieldContext.contextDigest }, input.layoutEvidence, selected.materialKey);
    const unit = unitFor(probe, { ...context, fieldId:input.materialFieldContext.fieldId }, profileName,
      profileName === 'series' ? 'group' : 'single', token && token.season, token ? token.episodes : [], related);
    if (profileName !== 'series') {
      units.push(unit);
      continue;
    }
    const groupKey = digest({
      schema:'procurement.series-candidate-group@1',
      claimedTitle:unit.identityMetadata.claimedTitle,
      seasonClaimDigest:unit.identityMetadata.seasonClaim.claimDigest,
    });
    if (!seriesGroups.has(groupKey)) seriesGroups.set(groupKey, []);
    seriesGroups.get(groupKey).push(unit);
  }
  units.push(...mergeSeriesUnits(seriesGroups, unassigned));
  units.sort((a,b) => compareUtf8(a.unitId,b.unitId)); unassigned.sort((a,b) => compareUtf8(a.materialKey,b.materialKey));
  const offset = input.pageRequest.cursorIn ? Number(input.pageRequest.cursorIn.split(':')[1]) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0) fail('P7_TRIAGE_STRUCTURE_CURSOR', 'Structure cursor is invalid.');
  const pageUnits = units.slice(offset, offset + input.pageRequest.maxUnits); const next = offset + pageUnits.length;
  const terminal = next >= units.length; const pageUnassigned = terminal ? unassigned : [];
  const value = { ...envelope('TriageStructureEvidence', 'procurement.triage.structure.inspect@1',
    { inputDigest:input.inputDigest, ruleAuthorityDigest:rule.authorityDigest }, options.observedAtMs || 0),
    procurementRunId:selection.procurementRunId, runBasisDigest:input.probeBatches[0].runBasisDigest, selectionDigest:selection.selectionDigest,
    triageRuleAuthorityDigest:rule.authorityDigest, materialFieldContextDigest:input.materialFieldContext.contextDigest,
    pageRequestDigest:input.pageRequest.requestDigest, pageOrdinal:input.pageRequest.pageOrdinal, cursorIn:input.pageRequest.cursorIn,
    cursorOut:terminal ? null : 'offset:' + next, resultKind:units.length ? 'resolved' : 'not_ready', units:pageUnits,
    unassignedMaterials:pageUnassigned, unitSetDigest:digest({ schema:'procurement.triage-unit-set-page@1', items:pageUnits }),
    unassignedSetDigest:digest({ schema:'procurement.triage-unassigned-set-page@1', items:pageUnassigned }) };
  value.evidenceId = digest({ kind:'triage-structure', procurementRunId:value.procurementRunId, pageOrdinal:value.pageOrdinal, basisDigest:value.basisDigest });
  value.payloadDigest = digest(without(value, 'payloadDigest'));
  if (Buffer.byteLength(canonicalJson(value)) > 65536) fail('P7_TRIAGE_STRUCTURE_PAGE_TOO_LARGE', 'Structure page exceeds 64 KiB.');
  return freeze(value);
}

function resolveIdentity(input, rule, options = {}) {
  validateTriageRuleSnapshot(rule); const unit = input.unit; const metadata = unit.identityMetadata;
  const payload = { claimKind:CLAIM_KIND[unit.contentProfile], mediaType:unit.mediaType, contentProfile:unit.contentProfile,
    claimedTitle:metadata.claimedTitle, displayIdentity:unit.displayIdentity,
    ...(metadata.claimedYear ? { claimedYear:metadata.claimedYear } : {}), ...(metadata.seasonClaim ? { seasonClaim:metadata.seasonClaim } : {}),
    ...(metadata.javCode ? { javCode:metadata.javCode } : {}), identityMetadataDigest:metadata.metadataDigest,
    structureUnitDigest:unit.unitDigest, sourceHints:metadata.sourceHints };
  const base = { schemaRef:'helix://contracts/types/IdentityClaim/v1', schemaVersion:1, draftId:digest({ kind:'identity-claim', unitId:unit.unitId }),
    draftKind:'procurement_identity_claim', basisDigest:input.inputDigest, draftDigest:'', producedAtMs:options.producedAtMs || 0, ...payload, claimDigest:'' };
  base.claimDigest = digest(payload); base.draftDigest = base.claimDigest;
  return freeze(base);
}

function buildPrimaryManifestDraft(input, rule, options = {}) {
  validateTriageRuleSnapshot(rule); const members = [...input.unit.members].sort((a,b) => compareUtf8(a.materialKey,b.materialKey)).map((member, ordinal) => ({
    ordinal, materialKey:member.materialKey, role:member.role,
    physicalIdentity:input.selectedFieldMaterialSet.members.find((item)=>item.materialKey===member.materialKey).physicalIdentity,
    sizeBytes:input.selectedFieldMaterialSet.members.find((item)=>item.materialKey===member.materialKey).sizeBytes,
    bindingRevision:member.bindingRevision,
    admittedControlRevision:member.admittedControlRevision, admittedControlProjectionDigest:member.admittedControlProjectionDigest,
    episodeClaims:member.episodeClaims
  }));
  const membersDigest = digest({ schema:'procurement.primary-input-manifest-members@1', items:members });
  const payload = { preallocatedManifestId:input.preallocatedManifestId, procurementRunId:input.procurementRunId,
    runBasisDigest:input.runBasisDigest, structureEvidencePayloadDigest:input.structureEvidencePayloadDigest, unitId:input.unit.unitId,
    structureKind:input.unit.structureKind, memberCount:members.length, membersDigest, memberSourceDigest:input.unit.unitDigest };
  const value = { schemaRef:'helix://contracts/types/PrimaryInputManifestDraft/v1', schemaVersion:1,
    draftId:digest({ kind:'primary-manifest-draft', manifestId:input.preallocatedManifestId }), draftKind:'procurement_primary_input_manifest',
    basisDigest:input.inputDigest, draftDigest:'', producedAtMs:options.producedAtMs || 0, ...payload, manifestDraftDigest:'' };
  value.manifestDraftDigest = digest(payload); value.draftDigest = value.manifestDraftDigest;
  return freeze(value);
}

module.exports = Object.freeze({ CLAIM_KIND, PLAYABILITY_REASONS, STRUCTURE_REASONS, ProcurementTriageError,
  buildPrimaryManifestDraft, inspectPlayability, inspectStructure, resolveIdentity });
