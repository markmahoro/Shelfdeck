'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { validateTriageRuleSnapshot } = require('./procurement-run-contracts');
const {
  createProfileHintSnapshot,
} = require('./field-profile-hint-contracts');

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
function titleFrom(context, temporaryLabel) { return (context.directoryTitle || context.parentSegments.at(-1) || context.baseName || temporaryLabel).trim() || temporaryLabel; }
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
function bdmvRootForLocation(location) {
  const parts = String(location || '').replace(/\\/g, '/').split('/');
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    if (parts[index].toUpperCase() === 'BDMV') return parts.slice(0, index + 1).join('/');
  }
  return null;
}
function relativeToBdmvRoot(location, root) {
  const normalized = String(location || '').replace(/\\/g, '/');
  return normalized.startsWith(root + '/') ? normalized.slice(root.length + 1) : null;
}
function bdmvInternalEntry(entry) {
  const relative = String(entry.relativeLocation || '').replace(/\\/g, '/').toUpperCase();
  const baseName = String(entry.baseName || '').toUpperCase();
  return /^(PLAYLIST|STREAM|CLIPINF)\//.test(relative) || /^(INDEX|MOVIEOBJECT)\.BDMV$/.test(baseName) ||
    /\.(MPLS|CLPI|M2TS|BDMV)$/.test(baseName);
}
function validateStructureInput(input) {
  exact(input, ['selectedFieldMaterialSet','probeBatches','playabilityPages','materialFieldContext','layoutEvidence','pageRequest','inputDigest'],
    'P7_TRIAGE_STRUCTURE_INPUT_SHAPE');
  const selection = input.selectedFieldMaterialSet;
  if (!Array.isArray(selection.members) || selection.members.length < 1 || selection.members.length > 256 ||
      !Array.isArray(input.probeBatches) || !Array.isArray(input.playabilityPages) || !Array.isArray(input.layoutEvidence)) {
    fail('P7_TRIAGE_STRUCTURE_INPUT_BOUNDS', 'Structure input collections are invalid.');
  }
  input.probeBatches.forEach(validateBatch);
  const probeMembers = input.probeBatches.flatMap((batch) => batch.members);
  const playResults = input.playabilityPages.flatMap((page) => page.materialResults);
  const contexts = input.materialFieldContext.memberContexts;
  const profileHintSnapshot = createProfileHintSnapshot(
    input.materialFieldContext.profileHintSnapshot,
  );
  if (profileHintSnapshot.fieldId !== input.materialFieldContext.fieldId) {
    fail('PBF22_TRIAGE_PROFILE_HINT_FIELD_MISMATCH', 'Triage Profile Hint belongs to another Field.');
  }
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

function layoutEvidenceRefKey(evidence) {
  return evidence.evidenceId + '\0' + evidence.payloadDigest + '\0' + evidence.boundedScopeDigest;
}

function normalizedLocation(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function layoutEvidenceForContext(context, layoutEvidence) {
  const refs = new Set((context.layoutEvidenceRefs || []).map(layoutEvidenceRefKey));
  const fieldLocation = String(context.fieldRelativeLocation || '').replace(/\\/g, '/');
  const bdmvRoot = bdmvRootForLocation(fieldLocation);
  const separator = fieldLocation.lastIndexOf('/');
  const expectedDirectory = normalizedLocation(bdmvRoot || (separator >= 0 ? fieldLocation.slice(0, separator) : '.'));
  return layoutEvidence.filter((evidence) => {
    if (refs.has(layoutEvidenceRefKey(evidence))) return true;
    const directory = (evidence.entries || []).find((entry) => entry.entryKind === 'directory' && entry.relativeLocation === '.');
    return directory && normalizedLocation(directory.location) === expectedDirectory;
  });
}

function relatedFor(context, layoutEvidence, primaryMaterialKey) {
  const primaryStems = new Set([context.baseName.replace(/\.[^.]+$/, '').toLowerCase(),
    context.directoryTitle && String(context.directoryTitle).replace(/\.[^.]+$/, '').toLowerCase()].filter(Boolean)); const results = [];
  const resultByReferenceId = new Map();
  for (const evidence of layoutEvidenceForContext(context, layoutEvidence)) {
    for (const entry of evidence.entries || []) {
      if (entry.entryKind !== 'file' || !entry.identity || entry.identity.fingerprintAlgorithm !== 'middle-256k-sha256') continue;
      if (bdmvRootForLocation(context.fieldRelativeLocation) && bdmvInternalEntry(entry)) continue;
      if (entry.identity.materialKey === primaryMaterialKey) continue;
      const lower = entry.baseName.toLowerCase(); const stem = lower.replace(/\.[^.]+$/, ''); const extension = (entry.extension || '').toLowerCase();
      const image = /\.(jpg|jpeg|png|webp)$/.test(extension);
      const standard = /^(movie|tvshow)\.nfo$/.test(lower) ||
        /^(poster|fanart|background|backdrop)\.(jpg|jpeg|png|webp)$/.test(lower) ||
        /^season0*\d+-(poster|fanart|background|backdrop)\.(jpg|jpeg|png|webp)$/.test(lower);
      const stemMatches = [...primaryStems].some((primaryStem) => stem === primaryStem || stem.startsWith(primaryStem + '.') ||
        stem.startsWith(primaryStem + '-') || stem.startsWith(primaryStem + '_'));
      const sidecar = /\.(srt|ass|ssa|vtt|aac|ac3|dts|flac|mka|chapters|xml)$/.test(lower);
      if (!stemMatches && !standard) continue;
      const chapter = extension === '.chapters' || extension === '.xml' && /(?:^|[-_. ])chapters$/.test(stem);
      const role = extension === '.nfo' ? 'nfo' : image && /(?:^|[-_. ])poster$/.test(stem) ? 'poster'
        : image && /(?:^|[-_. ])(?:fanart|background|backdrop)$/.test(stem) ? 'fanart'
        : /\.(srt|ass|ssa|vtt)$/.test(extension) ? 'subtitle' : /\.(aac|ac3|dts|flac|mka)$/.test(extension) ? 'external_audio'
        : chapter ? 'chapter' : 'sidecar';
      const referenceId = digest({ schema:'procurement.related-material-reference-id@1', primaryMaterialKey, role,
        relatedMaterialKey:entry.identity.materialKey, endpointId:entry.endpointId, location:entry.location });
      const base = { referenceId,
        primaryMaterialKey, role, identity:entry.identity, endpointId:entry.endpointId, location:entry.location,
        fingerprintAlgorithm:entry.identity.fingerprintAlgorithm,fingerprintVersion:entry.identity.fingerprintVersion,
        contentFingerprint:entry.identity.contentFingerprint,
        associationEvidenceDigest:digest({ contextDigest:context.contextDigest || digest(context), layoutPayloadDigest:evidence.payloadDigest, entryDigest:entry.entryDigest }) };
      const reference = { ...base, referenceDigest:digest(base) };
      resultByReferenceId.set(referenceId, reference);
    }
  }
  results.push(...resultByReferenceId.values());
  return results.sort((a,b) => compareUtf8(a.referenceId,b.referenceId));
}

function directoryTitleFor(context, layoutEvidence) {
  const candidates = [];
  for (const evidence of layoutEvidenceForContext(context, layoutEvidence)) {
    const directory = (evidence.entries || []).find((entry) => entry.entryKind === 'directory' && entry.relativeLocation === '.');
    if (directory?.baseName?.trim() && directory.baseName.toUpperCase() !== 'BDMV') candidates.push(directory.baseName.trim());
  }
  if (candidates.length) return candidates.at(-1);
  const parts = String(context.fieldRelativeLocation || '').replace(/\\/g, '/').split('/');
  const bdmvIndex = parts.map((part) => part.toUpperCase()).lastIndexOf('BDMV');
  return bdmvIndex > 0 ? parts[bdmvIndex - 1] || null : null;
}

function unitFor(
  member,
  context,
  profileName,
  mediaTypeName,
  season,
  episodes,
  relatedReferences,
  profileHintSnapshot,
) {
  const seasonClaim = profileName === 'series' ? (season === null
    ? { claimKind:'provisional_group', provisionalGroupKey:digest({ schema:'procurement.provisional-season-group@1', fieldId:context.fieldId,
      parentSegments:context.parentSegments }), claimDigest:'' }
    : { claimKind:'explicit_number', seasonNumber:season, claimDigest:'' }) : null;
  if (seasonClaim) seasonClaim.claimDigest = digest(without(seasonClaim, 'claimDigest'));
  const normalizedJavCode = profileName === 'jav'
    ? javCode(context.baseName) : null;
  const hints = [{
    hintKind:'field_content_profile_hint',
    hintValue:profileHintSnapshot.contentProfileHint,
    evidenceDigest:profileHintSnapshot.hintDigest,
  }, {
    hintKind:'filename_title',
    hintValue:context.baseName,
    evidenceDigest:digest({
      materialKey:member.materialKey,
      baseName:context.baseName,
    }),
  }];
  if (context.directoryTitle) {
    hints.push({
      hintKind:'directory_title',
      hintValue:context.directoryTitle,
      evidenceDigest:digest({
        materialKey:member.materialKey,
        directoryTitle:context.directoryTitle,
        layoutEvidenceRefs:context.layoutEvidenceRefs,
      }),
    });
  }
  if (normalizedJavCode) {
    hints.push({
      hintKind:'jav_code',
      hintValue:normalizedJavCode,
      evidenceDigest:digest({
        schema:'procurement.jav-code-hint@1',
        materialKey:member.materialKey,
        baseName:context.baseName,
        javCode:normalizedJavCode,
      }),
    });
  }
  hints.sort((left, right) =>
    compareUtf8(left.hintKind, right.hintKind) ||
    compareUtf8(left.hintValue, right.hintValue) ||
    compareUtf8(left.evidenceDigest, right.evidenceDigest));
  const metadata = { claimedTitle:profileName === 'series'
      ? seriesTitleFrom(context, member.materialKey.slice(0, 12))
      : titleFrom(context, member.materialKey.slice(0, 12)), ...(seasonClaim ? { seasonClaim } : {}),
    ...(normalizedJavCode ? { javCode:normalizedJavCode } : {}),
    contentProfileHint:profileHintSnapshot.contentProfileHint, sourceHints:hints };
  metadata.metadataDigest = digest(metadata);
  const claims = episodes.map((episode) => ({ episodeKey:'E' + String(episode).padStart(3,'0'),
    seasonClaimDigest:seasonClaim && seasonClaim.claimDigest || digest({ profile:profileName }), claimDigest:'' })).map((claim) =>
    ({ ...claim, claimDigest:digest(without(claim, 'claimDigest')) }));
  const unitMember = { materialKey:member.materialKey, bindingRevision:member.bindingRevision,
    admittedControlRevision:member.admittedControlRevision, admittedControlProjectionDigest:member.admittedControlProjectionDigest,
    role:'primary_payload', episodeClaims:claims };
  unitMember.memberClaimDigest = digest(unitMember);
  const value = { unitId:'', mediaType:mediaTypeName, contentProfile:profileName, structureKind:profileName === 'series' ? 'season' : 'single',
    displayIdentity:profileName === 'jav'
      ? normalizedJavCode || metadata.claimedTitle
      : metadata.claimedTitle, identityMetadata:metadata,
    seasonContinuityClaims:[], seasonContinuityClaimSetDigest:digest({ schema:'season-continuity-claim-set@1', items:[] }),
    members:[unitMember], relatedReferences, unitDigest:'' };
  value.unitId = digest({ schema:'procurement.triage-unit-id@1', mediaType:value.mediaType, contentProfile:value.contentProfile,
    structureKind:value.structureKind, members:value.members.map(({ materialKey, role, episodeClaims }) => ({ materialKey, role, episodeClaims })) });
  value.unitDigest = digest(without(value, 'unitDigest'));
  return value;
}

function bdmvUnitFor(group, topology, contexts, probes, layoutEvidence, fieldContext, profileHintSnapshot) {
  const root = bdmvRootForLocation(contexts[0].fieldRelativeLocation);
  const byRelative = new Map(group.map((item) => [relativeToBdmvRoot(contexts.find((context) => context.materialKey === item.materialKey).fieldRelativeLocation, root).toUpperCase(), item]));
  const topologyMembers = topology.members.map((member) => ({ ...member, key: String(member.relativeLocation).replace(/\\/g, '/').toUpperCase() }));
  const selectedMembers = [];
  for (const topologyMember of topologyMembers) {
    const probe = byRelative.get(topologyMember.key);
    if (!probe) return { kind:'incomplete' };
    selectedMembers.push({ probe, role:topologyMember.role });
  }
  const primary = selectedMembers.filter((item) => item.role === 'primary_payload');
  if (primary.length < 1) return { kind:'incomplete' };
  const primaryProbe = primary[0].probe;
  const primaryContext = contexts.find((context) => context.materialKey === primaryProbe.materialKey);
  const directoryTitle = directoryTitleFor(primaryContext, layoutEvidence);
  const related = relatedFor({ ...primaryContext, directoryTitle, contextDigest:fieldContext.contextDigest }, layoutEvidence, primaryProbe.materialKey);
  const seed = unitFor(primaryProbe, { ...primaryContext, directoryTitle, fieldId:fieldContext.fieldId }, 'movie', 'single', null, [], related,
    profileHintSnapshot);
  const members = selectedMembers.map(({ probe, role }) => ({
    materialKey:probe.materialKey,
    bindingRevision:probe.bindingRevision,
    admittedControlRevision:probe.admittedControlRevision,
    admittedControlProjectionDigest:probe.admittedControlProjectionDigest,
    role,
    episodeClaims:[],
  })).sort((left, right) => compareUtf8(left.materialKey, right.materialKey));
  for (const member of members) member.memberClaimDigest = digest(member);
  const value = { ...seed, members, relatedReferences:related };
  value.unitId = digest({ schema:'procurement.triage-unit-id@1', mediaType:value.mediaType, contentProfile:value.contentProfile,
    structureKind:value.structureKind, members:value.members.map(({ materialKey, role, episodeClaims }) => ({ materialKey, role, episodeClaims })) });
  value.unitDigest = digest(without(value, 'unitDigest'));
  return { kind:'resolved', unit:value, selectedKeys:new Set(topologyMembers.map((member) => member.key)) };
}

function conserveUnitBound(unit, unassigned) {
  if (Buffer.byteLength(canonicalJson(unit), 'utf8') <= 65536) return true;
  for (const member of unit.members) {
    unassigned.push({
      materialKey:member.materialKey,
      reasonCode:'triage_unit_contract_too_large',
      evidenceDigest:digest({
        schema:'procurement.triage-unit-contract-too-large@1',
        unitId:unit.unitId,
        unitDigest:unit.unitDigest,
        materialKey:member.materialKey,
      }),
    });
  }
  return false;
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
      .filter((hint, index, all) =>
        hint.hintKind !== 'field_content_profile_hint' ||
        index === all.findIndex((candidate) =>
          candidate.hintKind === 'field_content_profile_hint'))
      .sort((a,b) =>
        compareUtf8(a.hintKind,b.hintKind) ||
        compareUtf8(a.hintValue,b.hintValue) ||
        compareUtf8(a.evidenceDigest,b.evidenceDigest));
    const identityMetadata = {
      claimedTitle:first.identityMetadata.claimedTitle,
      seasonClaim:first.identityMetadata.seasonClaim,
      contentProfileHint:first.identityMetadata.contentProfileHint,
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
    if (conserveUnitBound(value, unassigned)) merged.push(value);
  }
  return merged;
}

function inspectStructure(input, rule, options = {}) {
  validateTriageRuleSnapshot(rule); validateStructureInput(input);
  const selection = input.selectedFieldMaterialSet; const contexts = contextMap(input); const probes = probeMap(input); const playable = playableMap(input);
  const units = []; const unassigned = []; const seriesGroups = new Map(); const processed = new Set();
  const profileHintSnapshot = input.materialFieldContext.profileHintSnapshot;
  const addGroupUnassigned = (group, reasonCode, evidenceDigest) => {
    for (const selected of group) unassigned.push({ materialKey:selected.materialKey, reasonCode,
      evidenceDigest:evidenceDigest || digest({ schema:'procurement.bdmv-structure-decision@1', materialKey:selected.materialKey, reasonCode }) });
  };
  for (const selected of selection.members) {
    if (processed.has(selected.materialKey)) continue;
    const context = contexts.get(selected.materialKey); const probe = probes.get(selected.materialKey); const play = playable.get(selected.materialKey);
    if (!context || !probe || !play || probe.bindingRevision !== selected.bindingRevision) fail('P7_TRIAGE_STRUCTURE_MAPPING', 'Structure input does not exactly cover Selection.');
    const bdmvRoot = bdmvRootForLocation(context.fieldRelativeLocation);
    if (bdmvRoot) {
      const group = selection.members.filter((candidate) => bdmvRootForLocation(contexts.get(candidate.materialKey)?.fieldRelativeLocation) === bdmvRoot);
      group.forEach((candidate) => processed.add(candidate.materialKey));
      const topologyResults = group.map((candidate) => probes.get(candidate.materialKey).mediaProbe.discTopology).filter(Boolean);
      const hint = profileHintSnapshot.contentProfileHint;
      if (hint === 'series' || hint === 'jav' || hint === 'western_adult' || hint === 'mixed' && group.some((candidate) => episodeToken(contexts.get(candidate.materialKey).baseName))) {
        addGroupUnassigned(group, 'disc_structure_incomplete');
        continue;
      }
      if (!topologyResults.length) { addGroupUnassigned(group, 'disc_structure_incomplete'); continue; }
      const topology = topologyResults[0];
      if (topologyResults.some((item) => item.topologyDigest !== topology.topologyDigest)) {
        addGroupUnassigned(group, 'structure_ambiguous'); continue;
      }
      if (topology.titleCount !== 1) { addGroupUnassigned(group, 'disc_multi_title_unsupported', topology.singleTitleEvidenceDigest); continue; }
      const relatives = new Set(group.map((candidate) => relativeToBdmvRoot(contexts.get(candidate.materialKey).fieldRelativeLocation, bdmvRoot).toUpperCase()));
      const hasIndex = relatives.has('INDEX.BDMV'); const hasMovieObject = relatives.has('MOVIEOBJECT.BDMV');
      const hasPlaylist = [...relatives].some((value) => /^PLAYLIST\/[^/]+\.MPLS$/.test(value));
      const hasStream = [...relatives].some((value) => /^STREAM\/[^/]+\.M2TS$/.test(value));
      if (!hasIndex || !hasMovieObject || !hasPlaylist || !hasStream) { addGroupUnassigned(group, 'disc_structure_incomplete'); continue; }
      const groupContexts = group.map((candidate) => contexts.get(candidate.materialKey));
      const groupProbes = new Map(group.map((candidate) => [candidate.materialKey, probes.get(candidate.materialKey)]));
      const built = bdmvUnitFor(group.map((candidate) => probes.get(candidate.materialKey)), topology, groupContexts, groupProbes,
        input.layoutEvidence, input.materialFieldContext, profileHintSnapshot);
      if (built.kind !== 'resolved') { addGroupUnassigned(group, 'disc_structure_incomplete'); continue; }
      const primaryFailures = built.unit.members.map((member) => {
        if (member.role !== 'primary_payload') return null;
        const result = playable.get(member.materialKey); return result.playable ? null : result.reasonCodes[0];
      }).filter(Boolean);
      if (primaryFailures.length) { addGroupUnassigned(group, primaryFailures[0]); continue; }
      for (const candidate of group) if (!built.selectedKeys.has(relativeToBdmvRoot(contexts.get(candidate.materialKey).fieldRelativeLocation, bdmvRoot).toUpperCase())) {
        unassigned.push({ materialKey:candidate.materialKey, reasonCode:'disc_structure_incomplete', evidenceDigest:topology.topologyDigest });
      }
      if (conserveUnitBound(built.unit, unassigned)) units.push(built.unit);
      continue;
    }
    processed.add(selected.materialKey);
    if (!play.playable) { unassigned.push({ materialKey:selected.materialKey, reasonCode:play.reasonCodes[0], evidenceDigest:play.resultDigest }); continue; }
    if (probe.mediaProbe.discTopology && probe.mediaProbe.discTopology.titleCount !== 1) {
      unassigned.push({ materialKey:selected.materialKey, reasonCode:'disc_multi_title_unsupported', evidenceDigest:probe.mediaProbe.payloadDigest }); continue;
    }
    const token = episodeToken(context.baseName);
    const hint = profileHintSnapshot.contentProfileHint;
    const profileName = hint === 'mixed' ? (token ? 'series' : javCode(context.baseName) ? 'jav' : 'movie') : hint;
    if (!CLAIM_KIND[profileName] || profileName === 'series' && !token) {
      unassigned.push({ materialKey:selected.materialKey, reasonCode:profileName === 'series' ? 'episode_claim_unresolved' : 'content_profile_unresolved',
        evidenceDigest:digest({ materialKey:selected.materialKey, contextDigest:input.materialFieldContext.contextDigest }) }); continue;
    }
    const directoryTitle = directoryTitleFor(context, input.layoutEvidence);
    const related = relatedFor({ ...context, contextDigest:input.materialFieldContext.contextDigest }, input.layoutEvidence, selected.materialKey);
    const unit = unitFor(probe, { ...context, directoryTitle, fieldId:input.materialFieldContext.fieldId }, profileName,
      profileName === 'series' ? 'group' : 'single', token && token.season, token ? token.episodes : [], related,
      profileHintSnapshot);
    if (profileName !== 'series') { if (conserveUnitBound(unit, unassigned)) units.push(unit); continue; }
    const groupKey = digest({ schema:'procurement.series-candidate-group@1', claimedTitle:unit.identityMetadata.claimedTitle,
      seasonClaimDigest:unit.identityMetadata.seasonClaim.claimDigest });
    if (!seriesGroups.has(groupKey)) seriesGroups.set(groupKey, []);
    seriesGroups.get(groupKey).push(unit);
  }
  units.push(...mergeSeriesUnits(seriesGroups, unassigned));
  units.sort((a,b) => compareUtf8(a.unitId,b.unitId)); unassigned.sort((a,b) => compareUtf8(a.materialKey,b.materialKey));
  const offset = input.pageRequest.cursorIn ? Number(input.pageRequest.cursorIn.split(':')[1]) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > units.length) fail('P7_TRIAGE_STRUCTURE_CURSOR', 'Structure cursor is invalid.');
  function buildPage(pageUnits, terminal) {
    const pageUnassigned = terminal ? unassigned : [];
    const next = offset + pageUnits.length;
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
    return value;
  }
  const pageUnits = []; let value = null;
  const maximum = Math.min(units.length, offset + input.pageRequest.maxUnits);
  for (let index = offset; index < maximum; index += 1) {
    const candidateUnits = [...pageUnits, units[index]];
    const candidate = buildPage(candidateUnits, offset + candidateUnits.length >= units.length);
    if (Buffer.byteLength(canonicalJson(candidate)) > 65536) break;
    pageUnits.push(units[index]); value = candidate;
  }
  if (!value) {
    value = buildPage([], offset >= units.length);
    if (offset < units.length || Buffer.byteLength(canonicalJson(value)) > 65536) {
      fail('P7_TRIAGE_STRUCTURE_PAGE_TOO_LARGE', 'One complete Structure Unit or terminal unassigned set cannot fit a 64 KiB page.');
    }
  }
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
