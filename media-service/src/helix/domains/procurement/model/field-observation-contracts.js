'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const {
  createProfileHintSnapshot,
  sameProfileHintSnapshot,
} = require('./field-profile-hint-contracts');

const SHA256 = /^[a-f0-9]{64}$/;
const DECIMAL_INT64 = /^(0|[1-9][0-9]{0,18})$/;
const INT64_MAX = 9223372036854775807n;
const PAGE_SCHEMA = 'helix://contracts/types/ObservationPageCommitResult/v1';
const FACT_SCHEMA = 'helix://domains/procurement/facts/FieldObservationRevision/v2';
const RESULT_SCHEMA = 'helix://contracts/types/ObservationPageCommitResult/v1';

class FieldObservationContractError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'FieldObservationContractError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new FieldObservationContractError(code, message, details); }
function exact(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(value, key))) fail(code, 'Value does not match its closed contract.');
}
function safeInteger(value, field, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail('P7_FIELD_OBSERVATION_INTEGER_INVALID', field + ' is invalid.', { field });
}
function digest(value, field) { if (!SHA256.test(value || '')) fail('P7_FIELD_OBSERVATION_DIGEST_INVALID', field + ' is invalid.', { field }); }
function decimalInt64(value, field) {
  if (!DECIMAL_INT64.test(value || '') || BigInt(value) > INT64_MAX) fail('P7_FIELD_OBSERVATION_INT64_INVALID', field + ' is invalid.', { field });
}
function identityBasis(value) { return { schema: 'physical-material-identity@2', mountScopeId: value.mountScopeId,
  inode: value.inode, sizeBytes:value.sizeBytes, fingerprintAlgorithm:value.fingerprintAlgorithm,
  fingerprintVersion:value.fingerprintVersion, contentFingerprint:value.contentFingerprint }; }
function validateIdentity(value) {
  exact(value, ['schemaRef','schemaVersion','materialKey','mountScopeId','inode','sizeBytes','fingerprintAlgorithm','fingerprintVersion','contentFingerprint'], 'P7_PHYSICAL_IDENTITY_SHAPE');
  if (value.schemaRef !== 'helix://contracts/types/PhysicalMaterialIdentity/v2' || value.schemaVersion !== 2 ||
      value.fingerprintAlgorithm !== 'middle-256k-sha256' || value.fingerprintVersion !== 1) {
    fail('P7_PHYSICAL_IDENTITY_NOMINAL_INVALID', 'Physical Material Identity nominal contract is invalid.');
  }
  decimalInt64(value.inode, 'inode'); safeInteger(value.sizeBytes, 'identity.sizeBytes');
  digest(value.contentFingerprint, 'contentFingerprint'); digest(value.materialKey, 'materialKey');
  if (canonicalDigest(identityBasis(value)) !== value.materialKey) fail('P7_PHYSICAL_IDENTITY_KEY_MISMATCH', 'Physical Material Identity key is invalid.');
}
function requestBasis(value) { const { requestDigest, ...basis } = value; return basis; }
function validateRequest(value) {
  exact(value, ['schemaRef','schemaVersion','fieldObservationWorkId','observationId','pageOrdinal','expectedObservationRevision','cursorIn','pageBudget','profileHintSnapshot','requestDigest'], 'P7_FIELD_PAGE_REQUEST_SHAPE');
  if (value.schemaRef !== 'helix://contracts/types/FieldObservationPageRequest/v1' || value.schemaVersion !== 1) fail('P7_FIELD_PAGE_REQUEST_NOMINAL_INVALID', 'Page Request nominal contract is invalid.');
  safeInteger(value.pageOrdinal, 'pageOrdinal'); safeInteger(value.expectedObservationRevision, 'expectedObservationRevision');
  safeInteger(value.pageBudget, 'pageBudget', 1); if (value.pageBudget > 256) fail('P7_FIELD_PAGE_BUDGET_INVALID', 'Page budget exceeds 256.');
  createProfileHintSnapshot(value.profileHintSnapshot);
  if (value.cursorIn !== null && (typeof value.cursorIn !== 'string' || value.cursorIn.length === 0)) fail('P7_FIELD_PAGE_CURSOR_INVALID', 'Input cursor is invalid.');
  if (canonicalDigest(requestBasis(value)) !== value.requestDigest) fail('P7_FIELD_PAGE_REQUEST_DIGEST_MISMATCH', 'Page Request digest is invalid.');
}
function validateAccessHandle(value, nowMs) {
  exact(value, ['schemaRef','schemaVersion','handleId','fieldId','accessRevision','accessDigest','endpointId','rootLocation','mountScopeId','mountScopeRevision','allowedOperations','containmentDigest','expiresAtMs'], 'P7_FIELD_ACCESS_HANDLE_SHAPE');
  if (value.schemaRef !== 'helix://contracts/types/FieldAccessHandle/v1' || value.schemaVersion !== 1) fail('P7_FIELD_ACCESS_HANDLE_NOMINAL_INVALID', 'Field Access Handle nominal contract is invalid.');
  safeInteger(value.accessRevision, 'accessRevision', 1); safeInteger(value.mountScopeRevision, 'mountScopeRevision', 1);
  safeInteger(value.expiresAtMs, 'expiresAtMs'); digest(value.accessDigest, 'accessDigest'); digest(value.containmentDigest, 'containmentDigest');
  if (!Array.isArray(value.allowedOperations) || !['list','stat','fingerprint'].every((operation) => value.allowedOperations.includes(operation)) ||
      value.allowedOperations.some((operation) => !['read','list','stat','fingerprint'].includes(operation))) fail('P7_FIELD_ACCESS_OPERATIONS_INVALID', 'Observation requires list/stat/fingerprint authority.');
  if (value.expiresAtMs < nowMs) fail('P7_FIELD_ACCESS_EXPIRED', 'Field Access Handle has expired.');
}
function validateContainment(root, location) {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedLocation = location.replace(/\\/g, '/');
  if (normalizedLocation !== normalizedRoot && !normalizedLocation.startsWith(normalizedRoot + '/')) fail('P7_FIELD_LOCATION_OUTSIDE_ROOT', 'Observed location escapes Field containment.');
}
function snapshotWithoutDigest(value) {
  // Observation time is provenance, not material reality.  Keeping the
  // timestamp out of the snapshot digest lets an unchanged file retain the
  // same material-local Eligibility basis across daily observations.
  const { snapshotDigest, observedAtMs, fingerprintVerifiedAtMs, ...basis } = value;
  return basis;
}
function validateSnapshotIntegrity(value) {
  exact(value, ['materialObservationId','observationId','fieldId','accessRevision','accessDigest','fieldAccessHandleId','endpointId','mountScopeRevision','identity','location','sizeBytes','mtimeNs','ctimeNs','fingerprintVerifiedAtMs','observedAtMs','containmentDigest','realityDigest','provenanceDigest','snapshotDigest'], 'P7_FIELD_SNAPSHOT_SHAPE');
  validateIdentity(value.identity); safeInteger(value.sizeBytes, 'sizeBytes');
  if (value.identity.sizeBytes !== value.sizeBytes) fail('P7_FIELD_SNAPSHOT_IDENTITY_SIZE_MISMATCH', 'Snapshot size must equal its Physical Material Identity size.');
  safeInteger(value.fingerprintVerifiedAtMs, 'fingerprintVerifiedAtMs'); safeInteger(value.observedAtMs, 'observedAtMs');
  decimalInt64(value.mtimeNs, 'mtimeNs'); decimalInt64(value.ctimeNs, 'ctimeNs');
  for (const field of ['materialObservationId','accessDigest','containmentDigest','realityDigest','provenanceDigest','snapshotDigest']) digest(value[field], field);
  const expectedId = canonicalDigest({ schema:'procurement.field-material-observation-id@1', observationId:value.observationId, materialKey:value.identity.materialKey });
  const expectedReality = canonicalDigest({ schema:'procurement.field-material-reality@1', identity:value.identity, endpointId:value.endpointId,
    location:value.location, sizeBytes:value.sizeBytes, mtimeNs:value.mtimeNs, ctimeNs:value.ctimeNs });
  const expectedProvenance = canonicalDigest({ schema:'procurement.field-material-provenance@1', fieldId:value.fieldId,
    accessRevision:value.accessRevision, accessDigest:value.accessDigest, fieldAccessHandleId:value.fieldAccessHandleId,
    mountScopeRevision:value.mountScopeRevision, containmentDigest:value.containmentDigest,
    fingerprintVerifiedAtMs:value.fingerprintVerifiedAtMs, observedAtMs:value.observedAtMs });
  if (value.materialObservationId !== expectedId || value.realityDigest !== expectedReality || value.provenanceDigest !== expectedProvenance ||
      value.snapshotDigest !== canonicalDigest(snapshotWithoutDigest(value))) fail('P7_FIELD_SNAPSHOT_DIGEST_MISMATCH', 'Snapshot digest chain is invalid.');
  if (Buffer.byteLength(canonicalJson(value), 'utf8') > 4096) fail('P7_FIELD_SNAPSHOT_TOO_LARGE', 'One Field snapshot exceeds 4 KiB.');
}
function validateSnapshot(value, context) {
  validateSnapshotIntegrity(value);
  if (value.observationId !== context.request.observationId || value.fieldId !== context.handle.fieldId || value.accessRevision !== context.handle.accessRevision ||
      value.accessDigest !== context.handle.accessDigest || value.fieldAccessHandleId !== context.handle.handleId || value.endpointId !== context.handle.endpointId ||
      value.mountScopeRevision !== context.handle.mountScopeRevision || value.identity.mountScopeId !== context.handle.mountScopeId ||
      value.containmentDigest !== context.handle.containmentDigest) fail('P7_FIELD_SNAPSHOT_ACCESS_MISMATCH', 'Snapshot does not bind the exact Field Access Handle.');
  validateContainment(context.handle.rootLocation, value.location);
}
function pageDigestBasis(value) { return { schema:'procurement.field-observation-page-commit@1', producerRef:value.producerRef,
  basisDigest:value.basisDigest, observedAtMs:value.observedAtMs, fieldObservationWorkId:value.fieldObservationWorkId,
  observationId:value.observationId, fieldId:value.fieldId, accessRevision:value.accessRevision,
  profileHintSnapshot:value.profileHintSnapshot, pageOrdinal:value.pageOrdinal,
  expectedObservationRevision:value.expectedObservationRevision, cursorIn:value.cursorIn, cursorOut:value.cursorOut,
  entryCount:value.entryCount, firstEntryDigest:value.firstEntryDigest, lastEntryDigest:value.lastEntryDigest,
  entrySetDigest:value.entrySetDigest, hasMore:value.hasMore }; }
function validateCompactPage(value, handle, request, nowMs = value && value.observedAtMs) {
  if (handle) validateAccessHandle(handle, nowMs);
  if (request) validateRequest(request);
  exact(value, ['schemaRef','schemaVersion','evidenceId','evidenceKind','producerRef','basisDigest','payloadDigest','observedAtMs','fieldObservationWorkId','observationId','fieldId','accessRevision','profileHintSnapshot','pageOrdinal','expectedObservationRevision','cursorIn','cursorOut','entryCount','firstEntryDigest','lastEntryDigest','entrySetDigest','pageDigest','hasMore'], 'P7_FIELD_PAGE_SHAPE');
  if (value.schemaRef !== PAGE_SCHEMA || value.schemaVersion !== 1 || value.evidenceKind !== 'observation_page_commit' || value.evidenceId !== value.observationId) fail('P7_FIELD_PAGE_NOMINAL_INVALID', 'Observation Page Commit nominal contract is invalid.');
  if (handle && request) {
    const basisDigest = canonicalDigest({ schema:'procurement.field-observation-basis@1', fieldAccessHandle:handle, pageRequest:request });
    if (value.basisDigest !== basisDigest || value.fieldObservationWorkId !== request.fieldObservationWorkId || value.observationId !== request.observationId || value.fieldId !== handle.fieldId || value.accessRevision !== handle.accessRevision || value.pageOrdinal !== request.pageOrdinal || value.expectedObservationRevision !== request.expectedObservationRevision || value.cursorIn !== request.cursorIn) fail('P7_FIELD_PAGE_BASIS_MISMATCH', 'Observation page does not match its exact inputs.');
    if (value.profileHintSnapshot.fieldId !== value.fieldId || !sameProfileHintSnapshot(value.profileHintSnapshot, request.profileHintSnapshot)) fail('PBF22_FIELD_OBSERVATION_PROFILE_HINT_MISMATCH', 'Observation page does not conserve its frozen Profile Hint.');
  }
  safeInteger(value.observedAtMs, 'observedAtMs'); safeInteger(value.accessRevision, 'accessRevision', 1); safeInteger(value.pageOrdinal, 'pageOrdinal'); safeInteger(value.expectedObservationRevision, 'expectedObservationRevision'); safeInteger(value.entryCount, 'entryCount');
  for (const field of ['basisDigest','payloadDigest','firstEntryDigest','lastEntryDigest','entrySetDigest','pageDigest']) digest(value[field], field);
  if (value.payloadDigest !== value.pageDigest || value.pageDigest !== canonicalDigest(pageDigestBasis(value))) fail('P7_FIELD_PAGE_DIGEST_MISMATCH', 'Observation page digest chain is invalid.');
  if (value.entryCount > 256 || (value.entryCount === 0 && value.hasMore)) fail('P7_FIELD_PAGE_ITEM_COUNT_INVALID', 'Observation page item count is invalid.');
  if (value.hasMore ? (typeof value.cursorOut !== 'string' || value.cursorOut.length === 0 || value.cursorOut === value.cursorIn || value.entryCount === 0) : value.cursorOut !== null) fail('P7_FIELD_PAGE_CURSOR_INVALID', 'Observation page cursor transition is invalid.');
  if (Buffer.byteLength(canonicalJson(value), 'utf8') > 16384) fail('P7_FIELD_PAGE_TOO_LARGE', 'Observation Page Commit Result exceeds 16 KiB.');
  return value;
}
function validatePage(value, handle, request, nowMs = value && value.observedAtMs) {
  const compact = { ...value };
  delete compact.entries;
  if (Array.isArray(value.entries)) {
    for (const item of value.entries) handle && request ? validateSnapshot(item, { handle, request }) : validateSnapshotIntegrity(item);
    const keys = value.entries.map((item) => item.identity.materialKey);
    for (let index=1; index<keys.length; index++) if (Buffer.compare(Buffer.from(keys[index-1]), Buffer.from(keys[index])) >= 0) fail('P7_FIELD_PAGE_ORDER_INVALID', 'Material keys must be unique UTF-8 ascending.');
  }
  return validateCompactPage(compact, handle, request, nowMs);
}
function validateCommittedPage(value) { return validatePage(value, null, null); }

module.exports = Object.freeze({ FieldObservationContractError, FACT_SCHEMA, PAGE_SCHEMA, RESULT_SCHEMA, identityBasis, pageDigestBasis,
  requestBasis, snapshotWithoutDigest, validateAccessHandle, validateCommittedPage, validateIdentity, validatePage, validateRequest,
  validateSnapshot, validateSnapshotIntegrity, validateCompactPage });
