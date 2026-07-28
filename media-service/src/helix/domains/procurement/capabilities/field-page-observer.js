'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { PAGE_SCHEMA, identityBasis, pageDigestBasis, snapshotWithoutDigest,
  validateAccessHandle, validatePage, validateRequest, validateSnapshot } = require('../model/field-observation-contracts');

class FieldPageObserverError extends Error {
  constructor(code, message) { super(message); this.name = 'FieldPageObserverError'; this.code = code; }
}
function fail(code, message) { throw new FieldPageObserverError(code, message); }

function createIdentity(raw, handle) {
  const identity = { schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v1', schemaVersion:1,
    materialKey:'', mountScopeId:handle.mountScopeId, inode:String(raw.inode), contentHashAlgorithm:'sha256', contentHash:raw.contentHash };
  identity.materialKey = canonicalDigest(identityBasis(identity));
  return Object.freeze(identity);
}
function createSnapshot(raw, handle, request, observedAtMs) {
  const identity = createIdentity(raw, handle);
  const value = {
    materialObservationId:canonicalDigest({ schema:'procurement.field-material-observation-id@1', observationId:request.observationId, materialKey:identity.materialKey }),
    observationId:request.observationId, fieldId:handle.fieldId, accessRevision:handle.accessRevision, accessDigest:handle.accessDigest,
    fieldAccessHandleId:handle.handleId, endpointId:handle.endpointId, mountScopeRevision:handle.mountScopeRevision,
    identity, location:raw.location, sizeBytes:raw.sizeBytes, mtimeNs:String(raw.mtimeNs), ctimeNs:String(raw.ctimeNs),
    hashVerifiedAtMs:raw.hashVerifiedAtMs, observedAtMs, containmentDigest:handle.containmentDigest,
    realityDigest:canonicalDigest({ schema:'procurement.field-material-reality@1', identity, endpointId:handle.endpointId,
      location:raw.location, sizeBytes:raw.sizeBytes, mtimeNs:String(raw.mtimeNs), ctimeNs:String(raw.ctimeNs) }),
    provenanceDigest:canonicalDigest({ schema:'procurement.field-material-provenance@1', fieldId:handle.fieldId,
      accessRevision:handle.accessRevision, accessDigest:handle.accessDigest, fieldAccessHandleId:handle.handleId,
      mountScopeRevision:handle.mountScopeRevision, containmentDigest:handle.containmentDigest,
      hashVerifiedAtMs:raw.hashVerifiedAtMs, observedAtMs }), snapshotDigest:''
  };
  value.snapshotDigest = canonicalDigest(snapshotWithoutDigest(value));
  validateSnapshot(value, { handle, request });
  return Object.freeze(value);
}
function buildPage(handle, request, producerRef, observedAtMs, materialObservations, cursorOut, hasMore) {
  const value = { schemaRef:PAGE_SCHEMA, schemaVersion:1, evidenceId:request.observationId, evidenceKind:'field_observation_page',
    producerRef, basisDigest:canonicalDigest({ schema:'procurement.field-observation-basis@1', fieldAccessHandle:handle, pageRequest:request }),
    payloadDigest:'', observedAtMs, fieldObservationWorkId:request.fieldObservationWorkId, observationId:request.observationId,
    fieldId:handle.fieldId, accessRevision:handle.accessRevision, profileHintSnapshot:request.profileHintSnapshot,
    pageOrdinal:request.pageOrdinal,
    expectedObservationRevision:request.expectedObservationRevision, cursorIn:request.cursorIn, cursorOut,
    materialObservations:Object.freeze([...materialObservations]), pageDigest:'', hasMore };
  value.pageDigest = canonicalDigest(pageDigestBasis(value)); value.payloadDigest = value.pageDigest;
  return value;
}

function createFieldPageObserver(options) {
  if (!options || typeof options.enumeratePage !== 'function' || typeof options.now !== 'function') {
    fail('P7_FIELD_OBSERVER_DEPENDENCIES', 'Bounded Field enumerator and clock are required.');
  }
  const producerRef = options.producerRef || 'procurement.field.page.observe@1';
  return Object.freeze({
    async observe({ fieldAccessHandle, pageRequest }) {
      const observedAtMs = options.now(); validateAccessHandle(fieldAccessHandle, observedAtMs); validateRequest(pageRequest);
      const enumeration = await options.enumeratePage(Object.freeze({ fieldAccessHandle, pageRequest }));
      if (!enumeration || !Array.isArray(enumeration.items) || typeof enumeration.hasMore !== 'boolean') fail('P7_FIELD_ENUMERATION_INVALID', 'Enumerator result is invalid.');
      const candidates = enumeration.items.map((entry) => {
        if (!entry || typeof entry.cursor !== 'string' || entry.cursor.length === 0 || !entry.material) fail('P7_FIELD_ENUMERATION_INVALID', 'Every enumerated material requires its post-item cursor.');
        return Object.freeze({ cursor:entry.cursor, snapshot:createSnapshot(entry.material, fieldAccessHandle, pageRequest, observedAtMs) });
      });
      for (let index=1; index<candidates.length; index++) if (Buffer.compare(Buffer.from(candidates[index-1].snapshot.identity.materialKey), Buffer.from(candidates[index].snapshot.identity.materialKey)) >= 0) fail('P7_FIELD_ENUMERATION_ORDER_INVALID', 'Enumerator must preserve material-key byte order.');
      const accepted = [];
      for (let index=0; index<candidates.length && accepted.length<pageRequest.pageBudget; index++) {
        const candidate = candidates[index];
        const moreAfter = index < candidates.length - 1 || enumeration.hasMore;
        const tentative = buildPage(fieldAccessHandle, pageRequest, producerRef, observedAtMs,
          [...accepted, candidate.snapshot], moreAfter ? candidate.cursor : null, moreAfter);
        if (Buffer.byteLength(canonicalJson(tentative), 'utf8') > 65536) {
          if (accepted.length === 0) fail('P7_FIELD_PAGE_SINGLE_ITEM_TOO_LARGE', 'The first pending material cannot fit without advancing its cursor.');
          break;
        }
        accepted.push(candidate.snapshot);
      }
      const consumed = accepted.length;
      const hasMore = consumed < candidates.length || enumeration.hasMore;
      if (hasMore && consumed === 0) fail('P7_FIELD_PAGE_EMPTY_PROGRESS', 'A non-terminal page must make cursor progress.');
      const cursorOut = hasMore ? candidates[consumed - 1].cursor : null;
      const page = buildPage(fieldAccessHandle, pageRequest, producerRef, observedAtMs, accepted, cursorOut, hasMore);
      validatePage(page, fieldAccessHandle, pageRequest, observedAtMs);
      return Object.freeze(page);
    }
  });
}

module.exports = Object.freeze({ FieldPageObserverError, createFieldPageObserver });
