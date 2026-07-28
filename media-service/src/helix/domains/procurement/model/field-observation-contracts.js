'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const {
  createProfileHintSnapshot,
  sameProfileHintSnapshot,
} = require('./field-profile-hint-contracts');

const SHA256 = /^[a-f0-9]{64}$/;
const DECIMAL_INT64 = /^(0|[1-9][0-9]{0,18})$/;
const INT64_MAX = 9223372036854775807n;
const PAGE_SCHEMA = 'helix://contracts/types/FieldObservationPage/v1';

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
function identityBasis(value) { return { schema: 'physical-material-identity@1', mountScopeId: value.mountScopeId,
  inode: value.inode, contentHashAlgorithm: value.contentHashAlgorithm, contentHash: value.contentHash }; }
function validateIdentity(value) {
  exact(value, ['schemaRef','schemaVersion','materialKey','mountScopeId','inode','contentHashAlgorithm','contentHash'], 'P7_PHYSICAL_IDENTITY_SHAPE');
  if (value.schemaRef !== 'helix://contracts/types/PhysicalMaterialIdentity/v1' || value.schemaVersion !== 1 || value.contentHashAlgorithm !== 'sha256') {
    fail('P7_PHYSICAL_IDENTITY_NOMINAL_INVALID', 'Physical Material Identity nominal contract is invalid.');
  }
  decimalInt64(value.inode, 'inode'); digest(value.contentHash, 'contentHash'); digest(value.materialKey, 'materialKey');
  if (canonicalDigest(identityBasis(value)) !== value.materialKey) fail('P7_PHYSICAL_IDENTITY_KEY_MISMATCH', 'Physical Material Identity key is invalid.');
}
function requestBasis(value) { const { requestDigest, ...basis } = value; return basis; }
function validateRequest(value) {
  exact(value, ['schemaRef','schemaVersion','fieldObservationWorkId','observationId','pageOrdinal','expectedObservationRevision','cursorIn','pageBudget','profileHintSnapshot','requestDigest'], 'P7_FIELD_PAGE_REQUEST_SHAPE');
  if (value.schemaRef !== 'helix://contracts/types/FieldObservationPageRequest/v1' || value.schemaVersion !== 1) fail('P7_FIELD_PAGE_REQUEST_NOMINAL_INVALID', 'Page Request nominal contract is invalid.');
  safeInteger(value.pageOrdinal, 'pageOrdinal'); safeInteger(value.expectedObservationRevision, 'expectedObservationRevision');
  safeInteger(value.pageBudget, 'pageBudget', 1); if (value.pageBudget > 100) fail('P7_FIELD_PAGE_BUDGET_INVALID', 'Page budget exceeds 100.');
  createProfileHintSnapshot(value.profileHintSnapshot);
  if (value.cursorIn !== null && (typeof value.cursorIn !== 'string' || value.cursorIn.length === 0)) fail('P7_FIELD_PAGE_CURSOR_INVALID', 'Input cursor is invalid.');
  if (canonicalDigest(requestBasis(value)) !== value.requestDigest) fail('P7_FIELD_PAGE_REQUEST_DIGEST_MISMATCH', 'Page Request digest is invalid.');
}
function validateAccessHandle(value, nowMs) {
  exact(value, ['schemaRef','schemaVersion','handleId','fieldId','accessRevision','accessDigest','endpointId','rootLocation','mountScopeId','mountScopeRevision','allowedOperations','containmentDigest','expiresAtMs'], 'P7_FIELD_ACCESS_HANDLE_SHAPE');
  if (value.schemaRef !== 'helix://contracts/types/FieldAccessHandle/v1' || value.schemaVersion !== 1) fail('P7_FIELD_ACCESS_HANDLE_NOMINAL_INVALID', 'Field Access Handle nominal contract is invalid.');
  safeInteger(value.accessRevision, 'accessRevision', 1); safeInteger(value.mountScopeRevision, 'mountScopeRevision', 1);
  safeInteger(value.expiresAtMs, 'expiresAtMs'); digest(value.accessDigest, 'accessDigest'); digest(value.containmentDigest, 'containmentDigest');
  if (!Array.isArray(value.allowedOperations) || !['list','stat','hash'].every((operation) => value.allowedOperations.includes(operation)) ||
      value.allowedOperations.some((operation) => !['read','list','stat','hash'].includes(operation))) fail('P7_FIELD_ACCESS_OPERATIONS_INVALID', 'Observation requires list/stat/hash authority.');
  if (value.expiresAtMs < nowMs) fail('P7_FIELD_ACCESS_EXPIRED', 'Field Access Handle has expired.');
}
function validateContainment(root, location) {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedLocation = location.replace(/\\/g, '/');
  if (normalizedLocation !== normalizedRoot && !normalizedLocation.startsWith(normalizedRoot + '/')) fail('P7_FIELD_LOCATION_OUTSIDE_ROOT', 'Observed location escapes Field containment.');
}
function snapshotWithoutDigest(value) { const { snapshotDigest, ...basis } = value; return basis; }
function validateSnapshotIntegrity(value) {
  exact(value, ['materialObservationId','observationId','fieldId','accessRevision','accessDigest','fieldAccessHandleId','endpointId','mountScopeRevision','identity','location','sizeBytes','mtimeNs','ctimeNs','hashVerifiedAtMs','observedAtMs','containmentDigest','realityDigest','provenanceDigest','snapshotDigest'], 'P7_FIELD_SNAPSHOT_SHAPE');
  validateIdentity(value.identity); safeInteger(value.sizeBytes, 'sizeBytes'); safeInteger(value.hashVerifiedAtMs, 'hashVerifiedAtMs'); safeInteger(value.observedAtMs, 'observedAtMs');
  decimalInt64(value.mtimeNs, 'mtimeNs'); decimalInt64(value.ctimeNs, 'ctimeNs');
  for (const field of ['materialObservationId','accessDigest','containmentDigest','realityDigest','provenanceDigest','snapshotDigest']) digest(value[field], field);
  const expectedId = canonicalDigest({ schema:'procurement.field-material-observation-id@1', observationId:value.observationId, materialKey:value.identity.materialKey });
  const expectedReality = canonicalDigest({ schema:'procurement.field-material-reality@1', identity:value.identity, endpointId:value.endpointId,
    location:value.location, sizeBytes:value.sizeBytes, mtimeNs:value.mtimeNs, ctimeNs:value.ctimeNs });
  const expectedProvenance = canonicalDigest({ schema:'procurement.field-material-provenance@1', fieldId:value.fieldId,
    accessRevision:value.accessRevision, accessDigest:value.accessDigest, fieldAccessHandleId:value.fieldAccessHandleId,
    mountScopeRevision:value.mountScopeRevision, containmentDigest:value.containmentDigest,
    hashVerifiedAtMs:value.hashVerifiedAtMs, observedAtMs:value.observedAtMs });
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
function pageDigestBasis(value) { return { schema:'procurement.field-observation-page@1', producerRef:value.producerRef,
  basisDigest:value.basisDigest, observedAtMs:value.observedAtMs, fieldObservationWorkId:value.fieldObservationWorkId,
  observationId:value.observationId, fieldId:value.fieldId, accessRevision:value.accessRevision,
  profileHintSnapshot:value.profileHintSnapshot, pageOrdinal:value.pageOrdinal,
  expectedObservationRevision:value.expectedObservationRevision, cursorIn:value.cursorIn, cursorOut:value.cursorOut,
  materialObservations:value.materialObservations, hasMore:value.hasMore }; }
function validatePage(value, handle, request, nowMs = value && value.observedAtMs) {
  validateAccessHandle(handle, nowMs); validateRequest(request);
  exact(value, ['schemaRef','schemaVersion','evidenceId','evidenceKind','producerRef','basisDigest','payloadDigest','observedAtMs','fieldObservationWorkId','observationId','fieldId','accessRevision','profileHintSnapshot','pageOrdinal','expectedObservationRevision','cursorIn','cursorOut','materialObservations','pageDigest','hasMore'], 'P7_FIELD_PAGE_SHAPE');
  if (value.schemaRef !== PAGE_SCHEMA || value.schemaVersion !== 1 || value.evidenceKind !== 'field_observation_page' || value.evidenceId !== value.observationId) fail('P7_FIELD_PAGE_NOMINAL_INVALID', 'Field Observation Page nominal contract is invalid.');
  const basisDigest = canonicalDigest({ schema:'procurement.field-observation-basis@1', fieldAccessHandle:handle, pageRequest:request });
  if (value.basisDigest !== basisDigest || value.payloadDigest !== value.pageDigest || value.pageDigest !== canonicalDigest(pageDigestBasis(value))) fail('P7_FIELD_PAGE_DIGEST_MISMATCH', 'Field Observation Page digest chain is invalid.');
  if (value.fieldObservationWorkId !== request.fieldObservationWorkId || value.observationId !== request.observationId || value.fieldId !== handle.fieldId ||
      value.accessRevision !== handle.accessRevision || value.pageOrdinal !== request.pageOrdinal || value.expectedObservationRevision !== request.expectedObservationRevision || value.cursorIn !== request.cursorIn) fail('P7_FIELD_PAGE_BASIS_MISMATCH', 'Field Observation Page does not match its exact inputs.');
  if (value.profileHintSnapshot.fieldId !== value.fieldId ||
      !sameProfileHintSnapshot(value.profileHintSnapshot, request.profileHintSnapshot)) {
    fail('PBF22_FIELD_OBSERVATION_PROFILE_HINT_MISMATCH', 'Field Observation Page does not conserve its frozen Profile Hint.');
  }
  if (!Array.isArray(value.materialObservations) || value.materialObservations.length > request.pageBudget || value.materialObservations.length > 100) fail('P7_FIELD_PAGE_ITEM_COUNT_INVALID', 'Field Observation Page item count is invalid.');
  value.materialObservations.forEach((item) => validateSnapshot(item, { handle, request }));
  const keys = value.materialObservations.map((item) => item.identity.materialKey);
  for (let index=1; index<keys.length; index++) if (Buffer.compare(Buffer.from(keys[index-1]), Buffer.from(keys[index])) >= 0) fail('P7_FIELD_PAGE_ORDER_INVALID', 'Material keys must be unique UTF-8 ascending.');
  if (value.hasMore ? (typeof value.cursorOut !== 'string' || value.cursorOut.length === 0 || value.cursorOut === value.cursorIn || value.materialObservations.length === 0) : value.cursorOut !== null) fail('P7_FIELD_PAGE_CURSOR_INVALID', 'Field Observation Page cursor transition is invalid.');
  if (Buffer.byteLength(canonicalJson(value), 'utf8') > 65536) fail('P7_FIELD_PAGE_TOO_LARGE', 'Field Observation Page exceeds 64 KiB.');
  return value;
}

function validateCommittedPage(value) {
  exact(value, ['schemaRef','schemaVersion','evidenceId','evidenceKind','producerRef','basisDigest','payloadDigest','observedAtMs','fieldObservationWorkId','observationId','fieldId','accessRevision','profileHintSnapshot','pageOrdinal','expectedObservationRevision','cursorIn','cursorOut','materialObservations','pageDigest','hasMore'], 'P7_FIELD_PAGE_SHAPE');
  if (value.schemaRef !== PAGE_SCHEMA || value.schemaVersion !== 1 || value.evidenceId !== value.observationId || value.evidenceKind !== 'field_observation_page') fail('P7_FIELD_PAGE_NOMINAL_INVALID', 'Field Observation Page nominal contract is invalid.');
  digest(value.basisDigest, 'basisDigest'); safeInteger(value.observedAtMs, 'observedAtMs'); safeInteger(value.accessRevision, 'accessRevision', 1);
  const profileHintSnapshot = createProfileHintSnapshot(value.profileHintSnapshot);
  if (profileHintSnapshot.fieldId !== value.fieldId) fail('PBF22_FIELD_OBSERVATION_PROFILE_HINT_MISMATCH', 'Committed Page Profile Hint belongs to another Field.');
  safeInteger(value.pageOrdinal, 'pageOrdinal'); safeInteger(value.expectedObservationRevision, 'expectedObservationRevision');
  if (value.payloadDigest !== value.pageDigest || value.pageDigest !== canonicalDigest(pageDigestBasis(value))) fail('P7_FIELD_PAGE_DIGEST_MISMATCH', 'Field Observation Page digest chain is invalid.');
  if (!Array.isArray(value.materialObservations) || value.materialObservations.length > 100) fail('P7_FIELD_PAGE_ITEM_COUNT_INVALID', 'Field Observation Page item count is invalid.');
  value.materialObservations.forEach((item) => { validateSnapshotIntegrity(item);
    if (item.observationId !== value.observationId || item.fieldId !== value.fieldId || item.accessRevision !== value.accessRevision) fail('P7_FIELD_PAGE_SNAPSHOT_MISMATCH', 'Snapshot does not belong to this page.'); });
  const keys = value.materialObservations.map((item) => item.identity.materialKey);
  for (let index=1; index<keys.length; index++) if (Buffer.compare(Buffer.from(keys[index-1]), Buffer.from(keys[index])) >= 0) fail('P7_FIELD_PAGE_ORDER_INVALID', 'Material keys must be unique UTF-8 ascending.');
  if (value.hasMore ? (typeof value.cursorOut !== 'string' || value.cursorOut.length === 0 || value.cursorOut === value.cursorIn || value.materialObservations.length === 0) : value.cursorOut !== null) fail('P7_FIELD_PAGE_CURSOR_INVALID', 'Field Observation Page cursor transition is invalid.');
  if (Buffer.byteLength(canonicalJson(value), 'utf8') > 65536) fail('P7_FIELD_PAGE_TOO_LARGE', 'Field Observation Page exceeds 64 KiB.');
  return value;
}

module.exports = Object.freeze({ FieldObservationContractError, PAGE_SCHEMA, identityBasis, pageDigestBasis,
  requestBasis, snapshotWithoutDigest, validateAccessHandle, validateCommittedPage, validateIdentity, validatePage, validateRequest,
  validateSnapshot, validateSnapshotIntegrity });
