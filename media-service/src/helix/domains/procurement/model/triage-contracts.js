'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { validateTriageRuleSnapshot } = require('./procurement-run-contracts');
const {
  createProfileHintSnapshot,
} = require('./field-profile-hint-contracts');
const {
  normalized: normalizeScopeLocation,
  parentRelativeLocation,
  resolveBdmvContainerScope,
  relativeToBdmvRoot,
  relativeToBdmvContainer,
  isBdmvInternalRelative,
} = require('./bdmv-scope');

const PLAYABILITY_REASONS = Object.freeze(['probe_not_media', 'no_video_stream', 'non_positive_duration']);
const MAX_RUN_PHYSICAL_MEMBERS = 1024;
const STRUCTURE_REASONS = Object.freeze([...PLAYABILITY_REASONS, 'content_profile_unresolved', 'conflicting_season_claim',
  'episode_claim_unresolved', 'disc_structure_incomplete', 'disc_multi_title_unsupported', 'disc_non_primary_title',
  'triage_unit_contract_too_large', 'structure_ambiguous']);
const CLAIM_KIND = Object.freeze({ movie:'movie_title', series:'series_season', jav:'jav_code', western_adult:'western_temporary' });
const RELATED_RULE_REVISION = 1;
const MATERIAL_INPUT_FORMS = Object.freeze(['stream_file', 'bdmv', 'dvd', 'iso']);

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
    if (!Number.isSafeInteger(member.selectionOrdinal) || member.selectionOrdinal < 0 || index > 0 &&
        batch.members[index - 1].selectionOrdinal >= member.selectionOrdinal || member.memberDigest !== digest(without(member, 'memberDigest'))) {
      fail('P7_TRIAGE_BATCH_MEMBER_INVALID', 'Probe member mapping or digest is invalid.');
    }
    const bdmv = member.inputKind === 'bdmv_container';
    if (bdmv) {
      exact(member, ['inputKind','selectionOrdinal','materialKey','bindingRevision','admittedControlRevision','admittedControlProjectionDigest',
        'bdmvGroupKey','scopeDigest','memberSetDigest','memberCount','bdmvAssessment','memberDigest'], 'P7_TRIAGE_BATCH_MEMBER_SHAPE');
      if (member.bdmvAssessment.scopeDigest !== member.scopeDigest || member.bdmvAssessment.memberSetDigest !== member.memberSetDigest ||
          member.bdmvAssessment.bdmvGroupKey !== member.bdmvGroupKey) fail('P7_TRIAGE_BATCH_MEMBER_INVALID', 'BDMV Assessment mapping is invalid.');
      return;
    }
    const ordinaryShape = !Object.hasOwn(member, 'inputKind');
    const expectedKeys = ordinaryShape
      ? ['selectionOrdinal','materialKey','bindingRevision','admittedControlRevision','admittedControlProjectionDigest','readHandle','mediaProbe','memberDigest']
      : ['inputKind','selectionOrdinal','materialKey','bindingRevision','admittedControlRevision','admittedControlProjectionDigest','readHandle','mediaProbe','memberDigest'];
    exact(member, expectedKeys, 'P7_TRIAGE_BATCH_MEMBER_SHAPE');
    if (member.inputKind && member.inputKind !== 'material' || member.readHandle.identity.materialKey !== member.materialKey || member.readHandle.bindingRevision !== member.bindingRevision ||
        member.mediaProbe.sourceHandleDigest !== digest(member.readHandle)) fail('P7_TRIAGE_BATCH_MEMBER_INVALID', 'Probe member mapping or digest is invalid.');
  });
}

function isBdmvStructuralLocation(location) {
  const normalized = String(location || '').replace(/\\/g, '/').toUpperCase();
  // The BDMV BACKUP subtree carries the same structural metadata.  Keep it
  // out of the Playability failure path just like the root metadata tree.
  return /(?:^|\/)BDMV\/(?:.*\/)?(?:[^/]+\.MPLS|[^/]+\.CLPI|INDEX\.BDMV|MOVIEOBJECT\.BDMV)$/.test(normalized) ||
    /(?:^|\/)CERTIFICATE\/ID\.BDMV$/.test(normalized);
}

function inspectPlayability(batch, rule, options = {}) {
  validateTriageRuleSnapshot(rule); validateBatch(batch);
  const materialResults = batch.members.map((member) => {
    if (member.inputKind === 'bdmv_container') {
      const assessment = member.bdmvAssessment; const reasons = [];
      if (assessment.resultKind !== 'resolved') reasons.push('bdmv_not_ready');
      else if (assessment.mediaSummary?.probeState !== 'probed' || Number(assessment.mediaSummary?.durationMs || 0) < rule.rulePayload.playabilityRule.minimumDurationMs ||
        !Array.isArray(assessment.mediaSummary?.videoClasses) || assessment.mediaSummary.videoClasses.length < rule.rulePayload.playabilityRule.minimumVideoStreamCount) reasons.push('probe_not_media');
      const result = { inputKind:'bdmv_container', selectionOrdinal:member.selectionOrdinal, materialKey:member.materialKey,
        bindingRevision:member.bindingRevision, bdmvGroupKey:member.bdmvGroupKey, scopeDigest:member.scopeDigest,
        probeEvidenceDigest:assessment.payloadDigest, playable:reasons.length === 0, reasonCodes:reasons };
      return freeze({ ...result, resultDigest:digest(result) });
    }
    const probe = member.mediaProbe; const reasons = [];
    // BDMV metadata files are structural dependencies, not playable payloads.
    // Their bounded topology evidence is still carried by MediaProbeEvidence,
    // but they must never fail the payload Playability gate.
    if (isBdmvStructuralLocation(member.readHandle.location)) {
      const result = { selectionOrdinal:member.selectionOrdinal, materialKey:member.materialKey, bindingRevision:member.bindingRevision,
        probeEvidenceDigest:probe.payloadDigest, playable:true, reasonCodes:[] };
      return freeze({ ...result, resultDigest:digest(result) });
    }
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
function titleFrom(context, temporaryLabel) {
  const fileStem = String(context.baseName || '').replace(/\.[^.]+$/, '').trim();
  return (context.directoryTitle || fileStem || temporaryLabel).trim() || temporaryLabel;
}
function seriesTitleFrom(context, temporaryLabel) {
  const stem = context.baseName.replace(/\.[^.]+$/, '');
  const match = stem.match(/(?:^|[ ._-])(?:S\d{1,2}E\d{1,3}(?:E|-)?\d{0,3}|\d{1,2}x\d{1,3}(?:-\d{1,3})?)(?=$|[ ._-])/i);
  const title = (match ? stem.slice(0, match.index) : stem)
    .replace(/[ ._-]+$/g, '')
    .trim();
  return title || titleFrom(context, temporaryLabel);
}
function contextMap(input) { return new Map(input.materialFieldContext.memberContexts.map((item) => [item.materialKey, item])); }
function probeMap(input) { return new Map(input.probeBatches.flatMap((batch) => batch.members).filter((item) => item.inputKind !== 'bdmv_container').map((item) => [item.materialKey, item])); }
function bdmvBatchMap(input) { return new Map(input.probeBatches.flatMap((batch) => batch.members).filter((item) => item.inputKind === 'bdmv_container').map((item) => [item.scopeDigest, item])); }
function bdmvAssessmentMap(input) { return new Map((input.bdmvAssessments || []).map((item) => [item.scope.scopeDigest, item])); }
function playableMap(input) { return new Map(input.playabilityPages.flatMap((page) => page.materialResults).map((item) => [item.materialKey, item])); }
function playableBdmvMap(input) { return new Map(input.playabilityPages.flatMap((page) => page.materialResults).filter((item) => item.inputKind === 'bdmv_container').map((item) => [item.scopeDigest, item])); }
function observationScopeLayoutEvidence(input) {
  const projection = input.observationScopeProjection;
  if (!projection) return input.layoutEvidence || [];
  const selectedByKey = new Map(input.selectedFieldMaterialSet.members.map((member) => [member.materialKey, member]));
  const entries = (projection.entries || []).map((entry, ordinal) => {
    const member = selectedByKey.get(entry.materialKey);
    const location = entry.currentLocation || entry.relativeLocation;
    return { entryOrdinal:ordinal, entryKind:'file', relativeLocation:entry.relativeLocation, baseName:entry.baseName,
      extension:entry.extension, identity:entry.identity || member?.physicalIdentity || null,
      endpointId:entry.endpointId || member?.endpointId || null, location, sizeBytes:Number(entry.sizeBytes ?? member?.sizeBytes ?? 0), entryDigest:entry.entryDigest };
  }).filter((entry) => entry.identity);

  // A BDMV topology must see the complete BDMV root as one scope, while its
  // external sidecars live in the immediate parent scope.  Ordinary materials
  // use their direct parent scope.  Keeping separate evidence objects prevents
  // a poster from one directory being considered for a different movie.
  const byScope = new Map();
  const knownLocations = entries.map((entry) => entry.relativeLocation || entry.location);
  for (const entry of entries) {
    // Directory matching is against the frozen Field-relative context; the
    // file entry itself still retains its absolute current location for the
    // eventual Related Material reference.
    const scopeSource = entry.relativeLocation || entry.location;
    const resolved = resolveBdmvContainerScope(scopeSource, knownLocations);
    const root = resolved?.bdmvRootRelativeLocation || null;
    const scopeLocation = root || parentRelativeLocation(scopeSource);
    const scopeKey = (root ? 'bdmv:' : 'directory:') + normalizedLocation(scopeLocation);
    if (!byScope.has(scopeKey)) byScope.set(scopeKey, { scopeLocation, entries:[] });
    byScope.get(scopeKey).entries.push(entry);
  }
  return [...byScope.values()].sort((left, right) => compareUtf8(normalizedLocation(left.scopeLocation), normalizedLocation(right.scopeLocation)))
    .map((scope, scopeOrdinal) => {
      const files = scope.entries.sort((left, right) => compareUtf8(normalizedLocation(left.location), normalizedLocation(right.location)) ||
        compareUtf8(left.identity.materialKey, right.identity.materialKey)).map((entry, ordinal) => ({ ...entry, entryOrdinal:ordinal + 1 }));
      const directory = { entryOrdinal:0, entryKind:'directory', relativeLocation:'.',
        baseName:String(scope.scopeLocation).replace(/\\/g, '/').split('/').at(-1) || '.', extension:'', identity:null,
        endpointId:null, location:scope.scopeLocation, sizeBytes:0, entryDigest:digest({ schema:'procurement.observation-scope-directory@1', location:scope.scopeLocation }) };
      const scopedEntries = [directory, ...files];
      const scopeDigest = digest({ schema:'procurement.observation-scope@2', projectionRevision:projection.projectionRevision,
        projectionScopeDigest:projection.scopeDigest, scopeLocation:normalizedLocation(scope.scopeLocation),
        entries:scopedEntries.map(({ entryOrdinal, entryKind, relativeLocation, baseName, extension, identity, endpointId, location, sizeBytes, entryDigest }) =>
          ({ entryOrdinal, entryKind, relativeLocation, baseName, extension, materialKey:identity?.materialKey || null, endpointId, location, sizeBytes, entryDigest })) });
      const entriesDigest = digest({ schema:'procurement.observation-scope-entries@2', items:scopedEntries });
      const payloadDigest = digest({ schema:'procurement.observation-scope-projection@2', projectionRevision:projection.projectionRevision,
        projectionScopeDigest:projection.scopeDigest, scopeDigest, entriesDigest });
      return { schemaRef:'helix://contracts/types/LayoutEvidence/v1', schemaVersion:1,
        evidenceId:'observation-scope-' + scopeOrdinal + '-' + scopeDigest.slice(0, 40), evidenceKind:'observation_scope_projection',
        producerRef:'procurement.observation.scope.projection@2', basisDigest:projection.scopeDigest, payloadDigest, observedAtMs:0,
        sourceHandleDigest:projection.scopeDigest, boundedScopeDigest:scopeDigest, entries:scopedEntries, entriesDigest, layoutDigest:scopeDigest };
    });
}
function bdmvRootForLocation(location, knownLocations = []) {
  return resolveBdmvContainerScope(location, knownLocations)?.bdmvRootRelativeLocation || null;
}
function bdmvContainerForLocation(location, contexts = []) {
  return resolveBdmvContainerScope(location, contexts)?.containerRelativeLocation || null;
}
function bdmvInternalEntry(entry) {
  return isBdmvInternalRelative(entry.relativeLocation || entry.baseName);
}
function relativeToBdmvScope(location, bdmvRoot) {
  const fromRoot = relativeToBdmvRoot(location, bdmvRoot);
  if (fromRoot !== null) return fromRoot;
  const container = String(bdmvRoot || '').replace(/\/BDMV$/i, '');
  return relativeToBdmvContainer(location, { containerRelativeLocation:container });
}
function validateStructureInput(input) {
  const allowed = ['selectedFieldMaterialSet','probeBatches','bdmvAssessments','playabilityPages','materialFieldContext','observationScopeProjection','layoutEvidence','pageRequest','inputDigest'];
  const required = ['selectedFieldMaterialSet','probeBatches','playabilityPages','materialFieldContext','pageRequest','inputDigest'];
  if (!input || typeof input !== 'object' || Object.keys(input).some((key) => !allowed.includes(key)) ||
      required.some((key) => !Object.hasOwn(input, key)) || (!Object.hasOwn(input, 'observationScopeProjection') && !Object.hasOwn(input, 'layoutEvidence'))) fail('P7_TRIAGE_STRUCTURE_INPUT_SHAPE', 'Structure input shape is invalid.');
  const selection = input.selectedFieldMaterialSet;
  if (!Array.isArray(selection.members) || selection.members.length < 1 || selection.members.length > MAX_RUN_PHYSICAL_MEMBERS ||
      !Array.isArray(input.probeBatches) || !Array.isArray(input.playabilityPages) ||
      input.observationScopeProjection && !Array.isArray(input.observationScopeProjection.entries)) {
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
  const logicalProbeCount = probeMembers.length; const logicalPlayCount = playResults.length;
  for (const member of probeMembers) {
    if (member.inputKind === 'bdmv_container') {
      if (!(input.bdmvAssessments || []).some((item) => item.scope.scopeDigest === member.scopeDigest) ||
          !playResults.some((result) => result.inputKind === 'bdmv_container' && result.scopeDigest === member.scopeDigest)) {
        fail('P7_TRIAGE_STRUCTURE_COVERAGE', 'BDMV Assessment and Playability must cover each logical container.');
      }
    } else if (!playResults.some((result) => result.materialKey === member.materialKey) || !contexts.some((context) => context.materialKey === member.materialKey)) {
      fail('P7_TRIAGE_STRUCTURE_COVERAGE', 'Probe, Playability, and Context must cover each ordinary Selection member.');
    }
  }
  if (logicalProbeCount !== logicalPlayCount || contexts.length !== selection.members.length ||
      input.probeBatches.some((batch) => batch.procurementRunId !== selection.procurementRunId || batch.selectionDigest !== selection.selectionDigest) ||
      input.playabilityPages.some((page) => page.procurementRunId !== selection.procurementRunId || page.selectionDigest !== selection.selectionDigest) ||
      input.materialFieldContext.contextDigest !== digest(without(input.materialFieldContext, 'contextDigest')) ||
      input.pageRequest.requestDigest !== digest(without(input.pageRequest, 'requestDigest'))) {
    fail('P7_TRIAGE_STRUCTURE_FENCE', 'Structure input fence or canonical digest is invalid.');
  }
  const basis = { schema:'procurement.triage-structure-input@1', selectionDigest:selection.selectionDigest,
    probeBatchDigests:input.probeBatches.map((item) => item.batchDigest) };
  if (Object.hasOwn(input, 'bdmvAssessments')) basis.bdmvAssessmentPayloadDigests = input.bdmvAssessments.map((item) => item.assessment.payloadDigest);
  basis.playabilityPayloadDigests = input.playabilityPages.map((item) => item.payloadDigest);
  basis.contextDigest = input.materialFieldContext.contextDigest;
  if (Object.hasOwn(input, 'observationScopeProjection')) basis.observationScopeProjectionDigest = input.observationScopeProjection.scopeDigest;
  if (Object.hasOwn(input, 'layoutEvidence')) basis.layoutPayloadDigests = input.layoutEvidence.map((item) => item.payloadDigest);
  basis.pageRequest = input.pageRequest;
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
  const knownLocations = layoutEvidence.flatMap((evidence) => (evidence.entries || []).map((entry) => entry.relativeLocation || entry.location));
  const bdmvRoot = bdmvRootForLocation(fieldLocation, knownLocations);
  const separator = fieldLocation.lastIndexOf('/');
  const expectedDirectories = new Set([normalizedLocation(bdmvRoot || (separator >= 0 ? fieldLocation.slice(0, separator) : '.'))]);
  if (bdmvRoot) {
    const rootSeparator = bdmvRoot.lastIndexOf('/');
    expectedDirectories.add(normalizedLocation(rootSeparator >= 0 ? bdmvRoot.slice(0, rootSeparator) : '.'));
  }
  return layoutEvidence.filter((evidence) => {
    if (refs.has(layoutEvidenceRefKey(evidence))) return true;
    const directory = (evidence.entries || []).find((entry) => entry.entryKind === 'directory' && entry.relativeLocation === '.');
    return directory && expectedDirectories.has(normalizedLocation(directory.location));
  });
}

function relatedFor(context, layoutEvidence, primaryMaterialKey) {
  const primaryStems = new Set([context.baseName.replace(/\.[^.]+$/, '').toLowerCase(),
    context.directoryTitle && String(context.directoryTitle).replace(/\.[^.]+$/, '').toLowerCase()].filter(Boolean)); const results = [];
  const knownLocations = layoutEvidence.flatMap((evidence) => (evidence.entries || []).map((entry) => entry.relativeLocation || entry.location));
  const resultByReferenceId = new Map();
  for (const evidence of layoutEvidenceForContext(context, layoutEvidence)) {
    for (const entry of evidence.entries || []) {
      if (entry.entryKind !== 'file' || !entry.identity || entry.identity.fingerprintAlgorithm !== 'middle-256k-sha256') continue;
      if (bdmvRootForLocation(context.fieldRelativeLocation, knownLocations) && bdmvInternalEntry(entry)) continue;
      if (entry.identity.materialKey === primaryMaterialKey) continue;
      const lower = entry.baseName.toLowerCase(); const stem = lower.replace(/\.[^.]+$/, ''); const extension = (entry.extension || '').toLowerCase();
      const image = /\.(jpg|jpeg|png|webp)$/.test(extension);
      const standard = /^(movie|tvshow)\.nfo$/.test(lower) ||
        /^(poster|fanart|background|backdrop|banner|clearlogo|landscape|logo|discart)\.(jpg|jpeg|png|webp)$/.test(lower) ||
        /^season0*\d+-(poster|fanart|background|backdrop|banner|landscape)\.(jpg|jpeg|png|webp)$/.test(lower);
      const stemMatches = [...primaryStems].some((primaryStem) => stem === primaryStem || stem.startsWith(primaryStem + '.') ||
        stem.startsWith(primaryStem + '-') || stem.startsWith(primaryStem + '_'));
      const sidecar = /\.(srt|ass|ssa|vtt|aac|ac3|dts|flac|mka|chapters|xml)$/.test(lower);
      // A same-stem video is another payload, not a Related Material.  It
      // must be represented by the Structure/primary selection rules (or
      // remain unassigned), never smuggled into the sidecar reference set.
      const mediaPayload = /\.(3gp|asf|avi|divx|flv|iso|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|mts|mxf|ogm|rm|rmvb|ts|vob|webm|wmv)$/.test(lower);
      if (mediaPayload) continue;
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

function relatedScopeFor(context, primaryMaterialKey, projectionRevision = 1, associationMode = 'multi_movie_directory') {
  const bdmv = context.selectionScopeKind === 'bdmv_container';
  const parentRelativeLocation = bdmv
    ? context.selectionScopeRootRelativeLocation
    : parentRelativeLocationOf(context.fieldRelativeLocation);
  const stemKey = bdmv
    ? String(context.directoryTitle || parentRelativeLocation.split('/').at(-1) || '').trim().toLocaleLowerCase('en-US')
    : String(context.baseName || '').replace(/\.[^.]+$/, '').trim().toLocaleLowerCase('en-US');
  const value = {
    scopeKind: bdmv ? 'bdmv_external_parent' : 'ordinary_parent',
    parentRelativeLocation: parentRelativeLocation || '.',
    stemKey: stemKey || primaryMaterialKey.slice(0, 16),
    associationMode,
    observationProjectionRevision: Number.isSafeInteger(Number(projectionRevision)) ? Number(projectionRevision) : 1,
    relatedRuleRevision: RELATED_RULE_REVISION,
  };
  return Object.freeze({ ...value, scopeDigest:digest({ schema:'procurement.related-scope@1', ...value }) });
}

function parentRelativeLocationOf(value) {
  const normalized = normalizeScopeLocation(value);
  const separator = normalized.lastIndexOf('/');
  return separator < 0 ? '.' : normalized.slice(0, separator) || '.';
}

function materialInputFormFromProbe(probe) {
  const topology = probe?.discTopology;
  if (!topology) return 'stream_file';
  const selectedPlaylist = typeof topology.selectedPlaylist === 'string'
    ? topology.selectedPlaylist
    : topology.selectedPlaylist?.relativeLocation || topology.titleSelectionEvidence?.selectedPlaylist;
  const validTopology = typeof topology.topologyDigest === 'string' && topology.topologyDigest.length > 0 &&
    Number.isSafeInteger(Number(topology.topologyVersion)) && Number(topology.topologyVersion) > 0 &&
    Number.isSafeInteger(Number(topology.titleCount)) && Number(topology.titleCount) > 0 &&
    typeof topology.singleTitleEvidenceDigest === 'string' && topology.singleTitleEvidenceDigest.length > 0 &&
    typeof topology.titleSelectionEvidence === 'object' && topology.titleSelectionEvidence !== null &&
    typeof selectedPlaylist === 'string' && selectedPlaylist.length > 0 &&
    Array.isArray(topology.members) && topology.members.length > 0;
  if (!MATERIAL_INPUT_FORMS.includes(topology.discKind) || !validTopology) {
    fail('P7_TRIAGE_INPUT_FORM_TOPOLOGY_INVALID', 'Typed disc topology evidence is incomplete for materialInputForm.');
  }
  return topology.discKind;
}

function directoryTitleFor(context, resolvedMovieCount, scopeDigest) {
  if (context.selectionScopeKind === 'standalone_file') return null;
  const root = String(context.selectionScopeRootRelativeLocation || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (context.selectionScopeKind === 'bdmv_container') {
    return root && root !== '.' ? root.split('/').at(-1) : 'BDMV-' + String(scopeDigest || '').slice(0, 8);
  }
  return resolvedMovieCount === 1 && root ? root.split('/').at(-1) : null;
}

function unitFor(
  member,
  context,
  profileName,
  mediaTypeName,
  season,
  episodes,
  relatedScope,
  materialInputForm,
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
    members:[unitMember], relatedScope, materialInputForm, unitDigest:'' };
  value.unitId = digest({ schema:'procurement.triage-unit-id@1', mediaType:value.mediaType, contentProfile:value.contentProfile,
    structureKind:value.structureKind, materialInputForm:value.materialInputForm, relatedScope:value.relatedScope,
    members:value.members.map(({ materialKey, role, episodeClaims }) => ({ materialKey, role, episodeClaims })) });
  value.unitDigest = digest(without(value, 'unitDigest'));
  return value;
}

function bdmvUnitFor(group, topology, contexts, layoutEvidence, fieldContext, profileHintSnapshot, root, scopeReference, assessment, projectionRevision = 1) {
  const topologyRoot = root || contexts.map((context) => bdmvRootForLocation(context.fieldRelativeLocation, contexts)).find(Boolean);
  if (!topologyRoot) return { kind:'incomplete' };
  const byRelative = new Map(group.map((item) => {
    const context = contexts.find((candidate) => candidate.materialKey === item.materialKey);
    const relative = relativeToBdmvScope(context?.fieldRelativeLocation, topologyRoot);
    return [relative ? relative.toUpperCase() : '', item];
  }).filter(([key]) => key));
  const topologyMembers = topology.members.map((member) => ({ ...member, key: String(member.relativeLocation).replace(/\\/g, '/').toUpperCase() }));
  const selectedMembers = [];
  for (const topologyMember of topologyMembers) {
    const selected = byRelative.get(topologyMember.key);
    if (!selected) return { kind:'incomplete' };
    selectedMembers.push({ selected, role:topologyMember.role });
  }
  const primary = selectedMembers.filter((item) => item.role === 'primary_payload');
  if (primary.length < 1) return { kind:'incomplete' };
  const primaryMember = primary[0].selected;
  // Run Selection carries the admitted Control snapshot as a nested typed
  // value.  Candidate/Unit contracts carry the two immutable admission
  // fields directly, so project them here rather than reading an undefined
  // property from the Selection member.
  const primaryUnitMember = {
    ...primaryMember,
    admittedControlRevision:primaryMember.admittedControlRevision ?? primaryMember.controlSnapshot?.controlRevision,
    admittedControlProjectionDigest:primaryMember.admittedControlProjectionDigest ?? primaryMember.controlSnapshot?.projectionDigest,
  };
  const primaryContext = contexts.find((context) => context.materialKey === primaryMember.materialKey);
  const directoryTitle = directoryTitleFor(primaryContext, 1, scopeReference.scopeDigest);
  const relatedScope = relatedScopeFor({ ...primaryContext, directoryTitle, contextDigest:fieldContext.contextDigest },
    primaryMember.materialKey, projectionRevision, 'bdmv_external');
  const seed = unitFor(primaryUnitMember, { ...primaryContext, directoryTitle, fieldId:fieldContext.fieldId }, 'movie', 'single', null, [], relatedScope, 'bdmv',
    profileHintSnapshot);
  const memberScope = { scopeKind:'bdmv_container', procurementRunId:scopeReference.procurementRunId, bdmvGroupKey:scopeReference.bdmvGroupKey,
    scopeDigest:scopeReference.scopeDigest, memberSetDigest:scopeReference.memberSetDigest, memberCount:group.length,
    topologyDigest:assessment.topologyDigest, selectedPayloadSetDigest:assessment.selectedPayloadSetDigest };
  const value = { ...seed, members:undefined, memberScope };
  delete value.members;
  value.unitId = digest({ schema:'procurement.triage-unit-id@2', mediaType:value.mediaType, contentProfile:value.contentProfile,
    structureKind:value.structureKind, scope:memberScope, materialInputForm:value.materialInputForm, relatedScope:value.relatedScope });
  value.unitDigest = digest(without(value, 'unitDigest'));
  return { kind:'resolved', unit:value, selectedKeys:new Set(topologyMembers.map((member) => member.key)), topologyRoot };
}

function relativeToSelectionScope(location, root) {
  const value = normalizeScopeLocation(location);
  const normalizedRoot = normalizeScopeLocation(root);
  if (!normalizedRoot || normalizedRoot === '.') return value;
  if (value === normalizedRoot) return '';
  return value.startsWith(normalizedRoot + '/') ? value.slice(normalizedRoot.length + 1) : null;
}

function dvdUnitFor(group, topology, contexts, selectionScope, fieldContext, profileHintSnapshot, projectionRevision = 1) {
  const root = selectionScope.scopeRootRelativeLocation;
  const byRelative = new Map(group.map((selected) => {
    const context = contexts.find((candidate) => candidate.materialKey === selected.materialKey);
    const relative = relativeToSelectionScope(context?.fieldRelativeLocation, root);
    return [relative ? relative.toUpperCase() : '', { selected, context }];
  }).filter(([key]) => key));
  const resolved = [];
  for (const topologyMember of topology.members) {
    const match = byRelative.get(normalizeScopeLocation(topologyMember.relativeLocation).toUpperCase());
    if (!match) return { kind:'incomplete' };
    const selected = match.selected;
    const member = {
      materialKey:selected.materialKey,
      bindingRevision:selected.bindingRevision,
      admittedControlRevision:selected.admittedControlRevision ?? selected.controlSnapshot?.controlRevision,
      admittedControlProjectionDigest:selected.admittedControlProjectionDigest ?? selected.controlSnapshot?.projectionDigest,
      role:topologyMember.role,
      episodeClaims:[],
    };
    member.memberClaimDigest = digest(member);
    resolved.push({ ...match, member });
  }
  const primary = resolved.filter((item) => item.member.role === 'primary_payload');
  if (!primary.length) return { kind:'incomplete' };
  const primarySelected = primary[0].selected;
  const primaryContext = primary[0].context;
  const directoryTitle = directoryTitleFor(primaryContext, 1, selectionScope.scopeDigest);
  const relatedAnchor = {
    ...primaryContext,
    directoryTitle,
    fieldId:fieldContext.fieldId,
    fieldRelativeLocation:(root && root !== '.' ? root + '/' : '') + (directoryTitle || 'dvd'),
    baseName:directoryTitle || primaryContext.baseName,
  };
  const relatedScope = relatedScopeFor(relatedAnchor, primarySelected.materialKey, projectionRevision, 'single_movie_directory');
  const seed = unitFor({
    ...primarySelected,
    admittedControlRevision:primarySelected.admittedControlRevision ?? primarySelected.controlSnapshot?.controlRevision,
    admittedControlProjectionDigest:primarySelected.admittedControlProjectionDigest ?? primarySelected.controlSnapshot?.projectionDigest,
  }, relatedAnchor, 'movie', 'single', null, [], relatedScope, 'dvd', profileHintSnapshot);
  const members = resolved.map((item) => item.member).sort((left, right) => compareUtf8(left.materialKey, right.materialKey));
  const value = { ...seed, members, unitDigest:'' };
  value.unitId = digest({ schema:'procurement.triage-unit-id@1', mediaType:value.mediaType,
    contentProfile:value.contentProfile, structureKind:value.structureKind, materialInputForm:value.materialInputForm,
    relatedScope:value.relatedScope, members:value.members.map(({ materialKey, role, episodeClaims }) => ({ materialKey, role, episodeClaims })) });
  value.unitDigest = digest(without(value, 'unitDigest'));
  return { kind:'resolved', unit:value, selectedKeys:new Set(resolved.map((item) => item.selected.materialKey)) };
}

function conserveUnitBound(unit, unassigned) {
  if (Buffer.byteLength(canonicalJson(unit), 'utf8') <= 65536) return true;
  if (!Array.isArray(unit.members)) return false;
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
    const first = [...group].sort((a,b) => compareUtf8(a.unitId,b.unitId))[0];
    const relatedScopes = group.map((unit) => unit.relatedScope).sort((a,b) => compareUtf8(a.scopeDigest,b.scopeDigest));
    const relatedScope = relatedScopes.length && relatedScopes.every((scope) =>
      scope.scopeKind === relatedScopes[0].scopeKind && scope.parentRelativeLocation === relatedScopes[0].parentRelativeLocation &&
      scope.stemKey === relatedScopes[0].stemKey && scope.associationMode === relatedScopes[0].associationMode &&
      scope.observationProjectionRevision === relatedScopes[0].observationProjectionRevision &&
      scope.relatedRuleRevision === relatedScopes[0].relatedRuleRevision)
      ? relatedScopes[0]
      : (() => {
        const value = { scopeKind:'ordinary_parent', parentRelativeLocation:'@candidate', stemKey:'@candidate',
          associationMode:'multi_movie_directory', observationProjectionRevision:relatedScopes[0]?.observationProjectionRevision || 1,
          relatedRuleRevision:RELATED_RULE_REVISION };
        return Object.freeze({ ...value, scopeDigest:digest({ schema:'procurement.related-scope@1', ...value }) });
      })();
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
      relatedScope,
      materialInputForm:first.materialInputForm,
      unitDigest:'',
    };
    value.unitId = digest({ schema:'procurement.triage-unit-id@1', mediaType:value.mediaType,
      contentProfile:value.contentProfile, structureKind:value.structureKind, materialInputForm:value.materialInputForm,
      relatedScope:value.relatedScope,
      members:value.members.map(({ materialKey, role, episodeClaims }) => ({ materialKey, role, episodeClaims })) });
    value.unitDigest = digest(without(value, 'unitDigest'));
    if (conserveUnitBound(value, unassigned)) merged.push(value);
  }
  return merged;
}

function inspectStructure(input, rule, options = {}) {
  validateTriageRuleSnapshot(rule); validateStructureInput(input);
  const layoutEvidence = observationScopeLayoutEvidence(input);
  const selection = input.selectedFieldMaterialSet;
  const projectedContexts = contextMap(input);
  const contexts = new Map(selection.members.map((member) => {
    const context = projectedContexts.get(member.materialKey);
    const scope = selection.selectionScopes[member.scopeOrdinal];
    if (!context || !scope) fail('P7_TRIAGE_STRUCTURE_SCOPE_MAPPING', 'Structure input does not preserve the admitted Selection Scope.');
    return [member.materialKey, Object.freeze({ ...context,
      fieldRelativeLocation:member.fieldRelativeLocation,
      selectionScopeKind:scope.scopeKind,
      selectionScopeKey:scope.scopeKey,
      selectionScopeRootRelativeLocation:scope.scopeRootRelativeLocation,
      scopeOrdinal:member.scopeOrdinal,
      scopeMemberOrdinal:member.scopeMemberOrdinal,
    })];
  }));
  const probes = probeMap(input); const bdmvBatches = bdmvBatchMap(input);
  const bdmvAssessments = bdmvAssessmentMap(input); const playable = playableMap(input); const playableBdmv = playableBdmvMap(input);
  const units = []; const unassigned = []; const seriesGroups = new Map(); const processed = new Set();
  const profileHintSnapshot = input.materialFieldContext.profileHintSnapshot;
  const addGroupUnassigned = (group, reasonCode, evidenceDigest) => {
    for (const selected of group) unassigned.push({ materialKey:selected.materialKey, reasonCode,
      evidenceDigest:evidenceDigest || digest({ schema:'procurement.bdmv-structure-decision@1', materialKey:selected.materialKey, reasonCode }) });
  };
  const allContexts = [...contexts.values()];
  const resolvedMovieCountByScope = new Map();
  for (const candidate of selection.members) {
    const candidateContext = contexts.get(candidate.materialKey);
    const candidateProbe = probes.get(candidate.materialKey);
    const candidatePlay = playable.get(candidate.materialKey);
    if (!candidateContext || candidateContext.selectionScopeKind === 'bdmv_container' || !candidateProbe || !candidatePlay?.playable) continue;
    const token = episodeToken(candidateContext.baseName);
    const hint = profileHintSnapshot.contentProfileHint;
    const profileName = hint === 'mixed' ? (token ? 'series' : javCode(candidateContext.baseName) ? 'jav' : 'movie') : hint;
    if (profileName === 'movie') resolvedMovieCountByScope.set(candidate.scopeOrdinal,
      (resolvedMovieCountByScope.get(candidate.scopeOrdinal) || 0) + 1);
  }
  for (const selected of selection.members) {
    if (processed.has(selected.materialKey)) continue;
    const context = contexts.get(selected.materialKey); const probe = probes.get(selected.materialKey); const play = playable.get(selected.materialKey);
    if (!context) fail('P7_TRIAGE_STRUCTURE_MAPPING', 'Structure input does not exactly cover Selection.');
    const selectionScope = selection.selectionScopes[selected.scopeOrdinal];
    if (!selectionScope || selectionScope.scopeOrdinal !== selected.scopeOrdinal) {
      fail('P7_TRIAGE_STRUCTURE_SCOPE_MAPPING', 'Structure input does not preserve the admitted Selection Scope.');
    }
    const bdmvContainer = selectionScope.scopeKind === 'bdmv_container'
      ? selectionScope.scopeRootRelativeLocation : null;
    const bdmvRoot = bdmvContainer ? (bdmvContainer === '.' ? 'BDMV' : bdmvContainer + '/BDMV') : null;
    if (bdmvContainer && bdmvRoot) {
      const group = selection.members.filter((candidate) => candidate.scopeOrdinal === selected.scopeOrdinal);
      group.forEach((candidate) => processed.add(candidate.materialKey));
      const expectedBdmvGroupKey = selectionScope.scopeKey;
      const bdmvGroup = [...bdmvBatches.values()].find((item) => item.bdmvGroupKey === expectedBdmvGroupKey &&
        item.scopeDigest && bdmvAssessments.has(item.scopeDigest));
      const assessmentEnvelope = bdmvGroup && bdmvAssessments.get(bdmvGroup.scopeDigest);
      const topologyResults = assessmentEnvelope?.assessment?.topologyDigest ? [{ topologyDigest:assessmentEnvelope.assessment.topologyDigest }] : [];
      const hint = profileHintSnapshot.contentProfileHint;
      if (hint === 'series' || hint === 'jav' || hint === 'western_adult' || hint === 'mixed' && group.some((candidate) => episodeToken(contexts.get(candidate.materialKey).baseName))) {
        addGroupUnassigned(group, 'disc_structure_incomplete');
        continue;
      }
      if (!bdmvGroup || !assessmentEnvelope || !topologyResults.length) { addGroupUnassigned(group, 'disc_structure_incomplete'); continue; }
      const assessment = assessmentEnvelope.assessment;
      if (assessment.resultKind !== 'resolved') { addGroupUnassigned(group, assessment.reasonCode === 'bdmv_series_unsupported' ? 'disc_structure_incomplete' : 'disc_structure_incomplete', assessment.payloadDigest); continue; }
      const topology = { topologyDigest:assessment.topologyDigest, selectedPlaylist:assessment.selectedPlaylist, titleCount:assessment.titleCount,
        members:assessment.selectedClipIds.map((clipId) => ({ relativeLocation:'STREAM/' + clipId + '.M2TS', role:'primary_payload', clipId })) };
      topology.members.push({ relativeLocation:assessment.selectedPlaylist.relativeLocation, role:'structural_dependency' },
        { relativeLocation:'index.bdmv', role:'structural_dependency' }, { relativeLocation:'MovieObject.bdmv', role:'structural_dependency' },
        ...assessment.selectedClipIds.map((clipId) => ({ relativeLocation:'CLIPINF/' + clipId + '.CLPI', role:'structural_dependency' })),
        ...group.map((candidate) => relativeToBdmvScope(contexts.get(candidate.materialKey).fieldRelativeLocation, bdmvRoot))
          .filter((relative) => relative && /^CERTIFICATE\//i.test(relative))
          .map((relativeLocation) => ({ relativeLocation, role:'structural_dependency' })));
      if (topologyResults.some((item) => item.topologyDigest !== topology.topologyDigest)) {
        addGroupUnassigned(group, 'structure_ambiguous'); continue;
      }
      // Multiple valid playlists are common on commercial discs (menus,
      // trailers, alternate cuts).  The topology reader already selected one
      // deterministic primary; only the non-primary material is closed with
      // evidence instead of blocking the whole Movie Candidate.
      const relatives = new Set(group.map((candidate) => relativeToBdmvRoot(contexts.get(candidate.materialKey).fieldRelativeLocation, bdmvRoot))
        .filter(Boolean).map((value) => value.toUpperCase()));
      const hasIndex = relatives.has('INDEX.BDMV'); const hasMovieObject = relatives.has('MOVIEOBJECT.BDMV');
      const hasPlaylist = [...relatives].some((value) => /^PLAYLIST\/[^/]+\.MPLS$/.test(value));
      const hasStream = [...relatives].some((value) => /^STREAM\/[^/]+\.M2TS$/.test(value));
      if (!hasIndex || !hasMovieObject || !hasPlaylist || !hasStream) { addGroupUnassigned(group, 'disc_structure_incomplete'); continue; }
      const groupContexts = group.map((candidate) => contexts.get(candidate.materialKey));
      const built = bdmvUnitFor(group, topology, groupContexts, layoutEvidence, input.materialFieldContext, profileHintSnapshot, bdmvRoot,
        assessmentEnvelope.scope, assessment, input.observationScopeProjection?.projectionRevision || 1);
      if (built.kind !== 'resolved') { addGroupUnassigned(group, 'disc_structure_incomplete'); continue; }
      const primaryFailures = playableBdmv.get(bdmvGroup.scopeDigest)?.playable ? [] : [playableBdmv.get(bdmvGroup.scopeDigest)?.reasonCodes?.[0] || 'probe_not_media'];
      if (primaryFailures.length) { addGroupUnassigned(group, primaryFailures[0]); continue; }
      for (const candidate of group) {
        const relative = relativeToBdmvScope(contexts.get(candidate.materialKey).fieldRelativeLocation, bdmvRoot);
        if (!relative || !built.selectedKeys.has(relative.toUpperCase())) {
          unassigned.push({ materialKey:candidate.materialKey, reasonCode:'disc_non_primary_title', evidenceDigest:topology.topologyDigest });
        }
      }
      if (conserveUnitBound(built.unit, unassigned)) units.push(built.unit);
      continue;
    }
    const ordinaryDiscTopology = probe?.mediaProbe?.discTopology;
    if (ordinaryDiscTopology?.discKind === 'dvd') {
      const group = selection.members.filter((candidate) => {
        if (candidate.scopeOrdinal !== selected.scopeOrdinal) return false;
        return probes.get(candidate.materialKey)?.mediaProbe?.discTopology?.topologyDigest === ordinaryDiscTopology.topologyDigest;
      }).map((candidate) => {
        const durableProbe = probes.get(candidate.materialKey);
        return Object.freeze({ ...candidate,
          admittedControlRevision:durableProbe.admittedControlRevision,
          admittedControlProjectionDigest:durableProbe.admittedControlProjectionDigest });
      });
      group.forEach((candidate) => processed.add(candidate.materialKey));
      const groupContexts = group.map((candidate) => contexts.get(candidate.materialKey));
      const built = dvdUnitFor(group, ordinaryDiscTopology, groupContexts, selectionScope,
        input.materialFieldContext, profileHintSnapshot, input.observationScopeProjection?.projectionRevision || 1);
      const primaryKeys = new Set((ordinaryDiscTopology.members || [])
        .filter((member) => member.role === 'primary_payload')
        .map((member) => normalizeScopeLocation(member.relativeLocation).toUpperCase()));
      const playablePrimary = group.filter((candidate) => {
        const candidateContext = contexts.get(candidate.materialKey);
        const relative = relativeToSelectionScope(candidateContext?.fieldRelativeLocation, selectionScope.scopeRootRelativeLocation);
        return relative && primaryKeys.has(relative.toUpperCase());
      }).every((candidate) => playable.get(candidate.materialKey)?.playable === true);
      if (built.kind !== 'resolved' || !playablePrimary) {
        addGroupUnassigned(group, built.kind !== 'resolved' ? 'disc_structure_incomplete' : 'probe_not_media', ordinaryDiscTopology.topologyDigest);
        continue;
      }
      for (const candidate of group) if (!built.selectedKeys.has(candidate.materialKey)) {
        unassigned.push({ materialKey:candidate.materialKey, reasonCode:'disc_non_primary_title', evidenceDigest:ordinaryDiscTopology.topologyDigest });
      }
      if (conserveUnitBound(built.unit, unassigned)) units.push(built.unit);
      continue;
    }
    processed.add(selected.materialKey);
    if (!probe || !play || probe.bindingRevision !== selected.bindingRevision) fail('P7_TRIAGE_STRUCTURE_MAPPING', 'Structure input does not exactly cover ordinary Selection.');
    if (!play.playable) { unassigned.push({ materialKey:selected.materialKey, reasonCode:play.reasonCodes[0], evidenceDigest:play.resultDigest }); continue; }
    // A disc topology on an ordinary material is still allowed to carry the
    // deterministic title choice; the BDMV container branch above owns the
    // member grouping and non-primary evidence.
    const token = episodeToken(context.baseName);
    const hint = profileHintSnapshot.contentProfileHint;
    const profileName = hint === 'mixed' ? (token ? 'series' : javCode(context.baseName) ? 'jav' : 'movie') : hint;
    if (!CLAIM_KIND[profileName] || profileName === 'series' && !token) {
      unassigned.push({ materialKey:selected.materialKey, reasonCode:profileName === 'series' ? 'episode_claim_unresolved' : 'content_profile_unresolved',
        evidenceDigest:digest({ materialKey:selected.materialKey, contextDigest:input.materialFieldContext.contextDigest }) }); continue;
    }
    const resolvedMovieCount = resolvedMovieCountByScope.get(selected.scopeOrdinal) || 0;
    const directoryTitle = directoryTitleFor(context, resolvedMovieCount, selectionScope.scopeDigest);
    const associationMode = selectionScope.scopeKind === 'standalone_file' ? 'standalone_same_stem'
      : resolvedMovieCount === 1 ? 'single_movie_directory' : 'multi_movie_directory';
    const relatedScope = relatedScopeFor({ ...context, directoryTitle, contextDigest:input.materialFieldContext.contextDigest },
      selected.materialKey, input.observationScopeProjection?.projectionRevision || 1, associationMode);
    const materialInputForm = materialInputFormFromProbe(probe.mediaProbe);
    const unit = unitFor(probe, { ...context, directoryTitle, fieldId:input.materialFieldContext.fieldId }, profileName,
      profileName === 'series' ? 'group' : 'single', token && token.season, token ? token.episodes : [], relatedScope, materialInputForm,
      profileHintSnapshot);
    if (profileName !== 'series') { if (conserveUnitBound(unit, unassigned)) units.push(unit); continue; }
    const groupKey = digest({ schema:'procurement.series-candidate-group@1', claimedTitle:unit.identityMetadata.claimedTitle,
      seasonClaimDigest:unit.identityMetadata.seasonClaim.claimDigest });
    if (!seriesGroups.has(groupKey)) seriesGroups.set(groupKey, []);
    seriesGroups.get(groupKey).push(unit);
  }
  units.push(...mergeSeriesUnits(seriesGroups, unassigned));
  units.sort((a,b) => compareUtf8(a.unitId,b.unitId)); unassigned.sort((a,b) => compareUtf8(a.materialKey,b.materialKey));
  const cursor = input.pageRequest.cursorIn;
  let cursorKind = 'units'; let offset = 0;
  // If a page has no candidate Units at all, expose the terminal business
  // failures immediately instead of emitting an empty page that only points
  // to a second cursor.  When Units exist, they retain precedence and the
  // following page carries unassigned members as before.
  if (!input.pageRequest.cursorIn && units.length === 0 && unassigned.length > 0) cursorKind = 'unassigned';
  if (cursor) {
    const match = /^(offset|units|unassigned):(\d+)$/.exec(cursor);
    if (!match) fail('P7_TRIAGE_STRUCTURE_CURSOR', 'Structure cursor is invalid.');
    cursorKind = match[1] === 'offset' ? 'units' : match[1]; offset = Number(match[2]);
  }
  if (!Number.isSafeInteger(offset) || offset < 0 ||
      cursorKind === 'units' && offset > units.length || cursorKind === 'unassigned' && offset > unassigned.length) {
    fail('P7_TRIAGE_STRUCTURE_CURSOR', 'Structure cursor is invalid.');
  }
  function buildPage(pageUnits, pageUnassigned, cursorOut) {
    const next = offset + pageUnits.length;
    const value = { ...envelope('TriageStructureEvidence', 'procurement.triage.structure.inspect@1',
      { inputDigest:input.inputDigest, ruleAuthorityDigest:rule.authorityDigest }, options.observedAtMs || 0),
      procurementRunId:selection.procurementRunId, runBasisDigest:input.probeBatches[0].runBasisDigest, selectionDigest:selection.selectionDigest,
      triageRuleAuthorityDigest:rule.authorityDigest, materialFieldContextDigest:input.materialFieldContext.contextDigest,
      pageRequestDigest:input.pageRequest.requestDigest, pageOrdinal:input.pageRequest.pageOrdinal, cursorIn:input.pageRequest.cursorIn,
      cursorOut, resultKind:pageUnits.length ? 'resolved' : 'not_ready', units:pageUnits,
      unassignedMaterials:pageUnassigned, unitSetDigest:digest({ schema:'procurement.triage-unit-set-page@1', items:pageUnits }),
      unassignedSetDigest:digest({ schema:'procurement.triage-unassigned-set-page@1', items:pageUnassigned }) };
    value.evidenceId = digest({ kind:'triage-structure', procurementRunId:value.procurementRunId, pageOrdinal:value.pageOrdinal, basisDigest:value.basisDigest });
    value.payloadDigest = digest(without(value, 'payloadDigest'));
    return value;
  }
  if (cursorKind === 'units') {
    const pageUnits = []; let value = null;
    const maximum = Math.min(units.length, offset + input.pageRequest.maxUnits);
    for (let index = offset; index < maximum; index += 1) {
      const candidateUnits = [...pageUnits, units[index]];
      const nextOffset = offset + candidateUnits.length;
      const nextCursor = nextOffset < units.length ? 'offset:' + nextOffset
        : unassigned.length ? 'unassigned:0' : null;
      const candidate = buildPage(candidateUnits, [], nextCursor);
      if (Buffer.byteLength(canonicalJson(candidate)) > 65536) break;
      pageUnits.push(units[index]); value = candidate;
    }
    if (!value) {
      value = buildPage([], [], offset < units.length ? 'offset:' + offset : unassigned.length ? 'unassigned:0' : null);
      if (offset < units.length || Buffer.byteLength(canonicalJson(value)) > 65536) {
        fail('P7_TRIAGE_STRUCTURE_PAGE_TOO_LARGE', 'One complete Structure Unit cannot fit a 64 KiB page.');
      }
    }
    return freeze(value);
  }
  const pageUnassigned = []; let value = null;
  for (let index = offset; index < unassigned.length; index += 1) {
    const candidateUnassigned = [...pageUnassigned, unassigned[index]];
    const nextOffset = offset + candidateUnassigned.length;
    const nextCursor = nextOffset < unassigned.length ? 'unassigned:' + nextOffset : null;
    const candidate = buildPage([], candidateUnassigned, nextCursor);
    if (Buffer.byteLength(canonicalJson(candidate)) > 65536) break;
    pageUnassigned.push(unassigned[index]); value = candidate;
  }
  if (!value) fail('P7_TRIAGE_STRUCTURE_PAGE_TOO_LARGE', 'One unassigned evidence item cannot fit a 64 KiB page.');
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
  validateTriageRuleSnapshot(rule); const sourceMembers = input.candidateMembers || input.unit.members;
  if (!Array.isArray(sourceMembers) || sourceMembers.length < 1) fail('P7_TRIAGE_MANIFEST_MEMBERS_MISSING', 'Primary Manifest requires hydrated Candidate members.');
  const members = [...sourceMembers].sort((a,b) => compareUtf8(a.materialKey,b.materialKey)).map((member, ordinal) => {
    if (!member.physicalIdentity || member.physicalIdentity.materialKey !== member.materialKey ||
        Number(member.physicalIdentity.sizeBytes) !== Number(member.sizeBytes)) {
      fail('P7_TRIAGE_MANIFEST_MEMBER_PROJECTION_INVALID', 'Primary Manifest requires an exact Candidate-scoped immutable Material projection.');
    }
    return { ordinal, materialKey:member.materialKey, role:member.role,
      physicalIdentity:member.physicalIdentity, sizeBytes:member.sizeBytes, bindingRevision:member.bindingRevision,
      admittedControlRevision:member.admittedControlRevision, admittedControlProjectionDigest:member.admittedControlProjectionDigest,
      episodeClaims:member.episodeClaims };
  });
  const membersDigest = digest({ schema:'procurement.primary-input-manifest-members@1', items:members });
  const payload = { preallocatedManifestId:input.preallocatedManifestId, procurementRunId:input.procurementRunId,
    runBasisDigest:input.runBasisDigest, structureEvidencePayloadDigest:input.structureEvidencePayloadDigest, unitId:input.unit.unitId,
    structureKind:input.unit.structureKind, memberCount:members.length, members:Object.freeze(members), membersDigest,
    memberSourceDigest:input.unit.unitDigest };
  const value = { schemaRef:'helix://contracts/types/PrimaryInputManifestDraft/v1', schemaVersion:1,
    draftId:digest({ kind:'primary-manifest-draft', manifestId:input.preallocatedManifestId }), draftKind:'procurement_primary_input_manifest',
    basisDigest:input.inputDigest, draftDigest:'', producedAtMs:options.producedAtMs || 0, ...payload, manifestDraftDigest:'' };
  value.manifestDraftDigest = digest(payload); value.draftDigest = value.manifestDraftDigest;
  return freeze(value);
}

module.exports = Object.freeze({ CLAIM_KIND, PLAYABILITY_REASONS, STRUCTURE_REASONS, MATERIAL_INPUT_FORMS, RELATED_RULE_REVISION,
  ProcurementTriageError, relatedScopeFor, materialInputFormFromProbe,
  buildPrimaryManifestDraft, inspectPlayability, inspectStructure, resolveIdentity });
