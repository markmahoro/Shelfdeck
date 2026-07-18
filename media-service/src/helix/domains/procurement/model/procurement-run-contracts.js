'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { validateControlSnapshot } = require('./extraction-eligibility');

const TRIAGE_RULE_SCHEMA = 'procurement.triage-rule.beta@1';
const TRIAGE_REGISTRY_SCHEMA = 'procurement.triage-rule-registry@1';
const RUN_BASIS_SCHEMA = 'ProcurementRunExecutionBasis@1';
const SHA256 = /^[0-9a-f]{64}$/;
const TRIAGE_PAYLOAD = Object.freeze({
  contractRefs: Object.freeze([
    'helix.procurement.candidate-readiness@1', 'helix.procurement.profile-claim-baseline@1',
    'helix.procurement.primary-input-manifest@1', 'helix.procurement.related-material-reference@1'
  ]),
  recallPriority: true, maxPrimaryMaterials: 1024, probeBatchSize: 100,
  playabilityRule: Object.freeze({ minimumDurationMs:1, minimumVideoStreamCount:1,
    reasonPrecedence:Object.freeze(['probe_not_media','no_video_stream','non_positive_duration']) }),
  profileResolutionRule: Object.freeze({ mixedPrecedence:Object.freeze(['series_episode_token','jav_code','movie_fallback']),
    westernAdultRequiresExplicitHint:true }),
  structureRule: Object.freeze({ maxUnitCanonicalBytes:65536 }),
  identityRule: Object.freeze({ claimKinds:Object.freeze(['movie_title','series_season','jav_code','western_temporary']) }),
  manifestRule: Object.freeze({ minimumMembers:1, maximumMembers:1024, firstOrdinal:0 })
});

class ProcurementRunContractError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'ProcurementRunContractError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new ProcurementRunContractError(code, message, details); }
function exact(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(value, key))) fail(code, 'Value does not match its closed Procurement Run contract.');
}
function text(value, field) { if (typeof value !== 'string' || value.length === 0) fail('P7_RUN_TEXT_REQUIRED', field + ' is required.'); return value; }
function revision(value, field, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) fail('P7_RUN_REVISION_INVALID', field + ' is invalid.');
  return value;
}
function digest(value, field) { if (!SHA256.test(value || '')) fail('P7_RUN_DIGEST_INVALID', field + ' must be SHA-256.'); return value; }
function compareUtf8(left, right) { return Buffer.compare(Buffer.from(left), Buffer.from(right)); }
function without(value, field) { return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field)); }
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze); return Object.freeze(value);
}

function ruleDigestFor(rule) {
  return canonicalDigest({ schema:'procurement.triage-rule@1', ruleRef:rule.ruleRef, revision:rule.revision,
    ruleSchemaRef:rule.ruleSchemaRef, rulePayload:rule.rulePayload });
}
function authorityDigestFor(rule) {
  return canonicalDigest({ schema:'procurement.triage-rule-authority@1', ruleRef:rule.ruleRef, revision:rule.revision,
    ruleSchemaRef:rule.ruleSchemaRef, ruleDigest:rule.ruleDigest });
}
function validateTriageRuleSnapshot(rule) {
  exact(rule, ['ruleRef','revision','ruleSchemaRef','rulePayload','ruleDigest','authorityDigest'], 'P7_TRIAGE_RULE_SHAPE');
  text(rule.ruleRef, 'ruleRef'); revision(rule.revision, 'revision');
  if (rule.ruleSchemaRef !== TRIAGE_RULE_SCHEMA || canonicalJson(rule.rulePayload) !== canonicalJson(TRIAGE_PAYLOAD) ||
      rule.ruleDigest !== ruleDigestFor(rule) || rule.authorityDigest !== authorityDigestFor(rule) ||
      Buffer.byteLength(canonicalJson(rule)) > 16 * 1024) fail('P7_TRIAGE_RULE_INVALID', 'Triage Rule snapshot is not an exact signed Beta rule.');
  return rule;
}
function createDefaultTriageRuleRegistry() {
  const base = { ruleRef:'procurement.triage.default', revision:1, ruleSchemaRef:TRIAGE_RULE_SCHEMA, rulePayload:TRIAGE_PAYLOAD };
  const signed = { ...base, ruleDigest:ruleDigestFor(base) };
  const entry = deepFreeze({ ...signed, authorityDigest:authorityDigestFor(signed) });
  const registry = { registrySchemaRef:TRIAGE_REGISTRY_SCHEMA, registryVersion:1, activeRuleRef:entry.ruleRef,
    activeRuleRevision:entry.revision, entries:[entry] };
  return deepFreeze({ ...registry, registryDigest:canonicalDigest(registry) });
}
function validateTriageRuleRegistry(registry) {
  exact(registry, ['registrySchemaRef','registryVersion','activeRuleRef','activeRuleRevision','entries','registryDigest'], 'P7_TRIAGE_REGISTRY_SHAPE');
  if (registry.registrySchemaRef !== TRIAGE_REGISTRY_SCHEMA || !Number.isSafeInteger(registry.registryVersion) || registry.registryVersion < 1 ||
      !Array.isArray(registry.entries) || registry.entries.length < 1 || registry.registryDigest !== canonicalDigest(without(registry, 'registryDigest'))) {
    fail('P7_TRIAGE_REGISTRY_INVALID', 'Triage Rule Registry is invalid.');
  }
  let activeCount = 0; const keys = new Set();
  for (const [index, entry] of registry.entries.entries()) {
    validateTriageRuleSnapshot(entry); const key = entry.ruleRef + '\u0000' + entry.revision;
    if (keys.has(key) || index > 0 && (compareUtf8(registry.entries[index - 1].ruleRef, entry.ruleRef) > 0 ||
        registry.entries[index - 1].ruleRef === entry.ruleRef && registry.entries[index - 1].revision >= entry.revision)) {
      fail('P7_TRIAGE_REGISTRY_ORDER', 'Triage Rule Registry entries must be unique and sorted.');
    }
    keys.add(key); if (entry.ruleRef === registry.activeRuleRef && entry.revision === registry.activeRuleRevision) activeCount += 1;
  }
  if (activeCount !== 1) fail('P7_TRIAGE_REGISTRY_ACTIVE_MISSING', 'Triage Rule Registry active pointer must resolve exactly once.');
  return registry;
}
function activeTriageRule(registry) {
  validateTriageRuleRegistry(registry);
  return registry.entries.find((entry) => entry.ruleRef === registry.activeRuleRef && entry.revision === registry.activeRuleRevision);
}

function validateSelectedMember(member, index, fieldId) {
  exact(member, ['ordinal','materialKey','selectionRole','bindingRevision','eligibilityRevision','eligibilityBasisDigest','lastSnapshotDigest',
    'lastObservationId','endpointId','location','realityDigest','provenanceDigest','controlSnapshot','admissionControlAction','basisMemberDigest'], 'P7_RUN_MEMBER_SHAPE');
  if (member.ordinal !== index || member.selectionRole !== 'triage_input') fail('P7_RUN_MEMBER_ORDINAL_ROLE', 'Run member ordinal or role is invalid.');
  digest(member.materialKey, 'materialKey'); revision(member.bindingRevision, 'bindingRevision'); revision(member.eligibilityRevision, 'eligibilityRevision');
  for (const field of ['eligibilityBasisDigest','lastSnapshotDigest','realityDigest','provenanceDigest']) digest(member[field], field);
  for (const field of ['lastObservationId','endpointId','location']) text(member[field], field);
  validateControlSnapshot(member.controlSnapshot, member.materialKey);
  const control = member.controlSnapshot;
  const acquire = member.admissionControlAction === 'acquire' && control.controlState === 'uncontrolled';
  const assertion = member.admissionControlAction === 'assert_same_field' && control.controlState === 'controlled' &&
    control.ownerDomain === 'procurement' && control.ownerScopeType === 'material_field' && control.ownerScopeId === fieldId;
  if ((!acquire && !assertion) || member.basisMemberDigest !== canonicalDigest(without(member, 'basisMemberDigest'))) {
    fail('P7_RUN_MEMBER_INVALID', 'Run member action, Control scope, or digest is invalid.', { materialKey:member.materialKey });
  }
}
function createSelectedFieldMaterialSet(value) {
  exact(value, ['procurementRunId','fieldId','members','selectionDigest'], 'P7_RUN_SELECTION_SHAPE');
  text(value.procurementRunId, 'procurementRunId'); text(value.fieldId, 'fieldId');
  if (!Array.isArray(value.members) || value.members.length < 1 || value.members.length > 1024) fail('P7_RUN_SELECTION_BOUNDS', 'Run Selection must contain 1..1024 members.');
  for (const [index, member] of value.members.entries()) {
    validateSelectedMember(member, index, value.fieldId);
    if (index > 0 && compareUtf8(value.members[index - 1].materialKey, member.materialKey) >= 0) fail('P7_RUN_SELECTION_ORDER', 'Run members must be unique and UTF-8 sorted.');
  }
  const expected = canonicalDigest({ schema:'procurement.selected-field-material-set@1', procurementRunId:value.procurementRunId,
    fieldId:value.fieldId, members:value.members });
  if (value.selectionDigest !== expected) fail('P7_RUN_SELECTION_DIGEST', 'Run Selection digest is invalid.');
  return deepFreeze(value);
}
function createProcurementRunExecutionBasis(value, registry) {
  const keys = ['procurementRunId','fieldId','fieldStatus','fieldAccess','terminalObservation','extractionPolicy','triageRule',
    ...(Object.hasOwn(value || {}, 'sourceRetryIntentId') ? ['sourceRetryIntentId'] : []), 'selectedFieldMaterialSet','basisDigest'];
  exact(value, keys, 'P7_RUN_BASIS_SHAPE');
  if (value.fieldStatus !== 'active') fail('P7_RUN_FIELD_INACTIVE', 'Run Admission requires an active Material Field.');
  text(value.procurementRunId, 'procurementRunId'); text(value.fieldId, 'fieldId');
  exact(value.fieldAccess, ['revision','digest'], 'P7_RUN_ACCESS_SHAPE'); revision(value.fieldAccess.revision, 'fieldAccess.revision'); digest(value.fieldAccess.digest, 'fieldAccess.digest');
  exact(value.terminalObservation, ['revision','fieldObservationWorkId'], 'P7_RUN_OBSERVATION_SHAPE'); revision(value.terminalObservation.revision, 'terminalObservation.revision'); text(value.terminalObservation.fieldObservationWorkId, 'terminalObservation.fieldObservationWorkId');
  exact(value.extractionPolicy, ['policyId','revision','digest'], 'P7_RUN_POLICY_SHAPE'); text(value.extractionPolicy.policyId, 'extractionPolicy.policyId'); revision(value.extractionPolicy.revision, 'extractionPolicy.revision'); digest(value.extractionPolicy.digest, 'extractionPolicy.digest');
  validateTriageRuleSnapshot(value.triageRule); const active = activeTriageRule(registry);
  if (canonicalJson(value.triageRule) !== canonicalJson(active)) fail('P7_RUN_TRIAGE_NOT_ACTIVE', 'Run Basis must freeze the Registry current active Triage Rule.');
  if (Object.hasOwn(value, 'sourceRetryIntentId')) text(value.sourceRetryIntentId, 'sourceRetryIntentId');
  createSelectedFieldMaterialSet(value.selectedFieldMaterialSet);
  if (value.selectedFieldMaterialSet.procurementRunId !== value.procurementRunId || value.selectedFieldMaterialSet.fieldId !== value.fieldId ||
      value.basisDigest !== canonicalDigest(without(value, 'basisDigest'))) fail('P7_RUN_BASIS_DIGEST', 'Run Basis nesting or digest is invalid.');
  return deepFreeze(value);
}

module.exports = Object.freeze({ ProcurementRunContractError, RUN_BASIS_SCHEMA, TRIAGE_PAYLOAD, TRIAGE_REGISTRY_SCHEMA,
  TRIAGE_RULE_SCHEMA, activeTriageRule, authorityDigestFor, createDefaultTriageRuleRegistry, createProcurementRunExecutionBasis,
  createSelectedFieldMaterialSet, ruleDigestFor, validateTriageRuleRegistry, validateTriageRuleSnapshot });
