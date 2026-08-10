'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { PAGE_SCHEMA, identityBasis, validateAccessHandle, validateRequest, validatePage } = require('../model/field-observation-contracts');

class FieldPageObserverError extends Error {
  constructor(code, message) { super(message); this.name = 'FieldPageObserverError'; this.code = code; }
}
function fail(code, message) { throw new FieldPageObserverError(code, message); }

function createIdentity(raw, handle) {
  const identity = { schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion:2,
    materialKey:'', mountScopeId:handle.mountScopeId, inode:String(raw.inode), sizeBytes:raw.sizeBytes,
    fingerprintAlgorithm:'middle-256k-sha256', fingerprintVersion:1, contentFingerprint:raw.contentFingerprint };
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
    fingerprintVerifiedAtMs:raw.fingerprintVerifiedAtMs, observedAtMs, containmentDigest:handle.containmentDigest,
    realityDigest:canonicalDigest({ schema:'procurement.field-material-reality@1', identity, endpointId:handle.endpointId,
      location:raw.location, sizeBytes:raw.sizeBytes, mtimeNs:String(raw.mtimeNs), ctimeNs:String(raw.ctimeNs) }),
    provenanceDigest:canonicalDigest({ schema:'procurement.field-material-provenance@1', fieldId:handle.fieldId,
      accessRevision:handle.accessRevision, accessDigest:handle.accessDigest, fieldAccessHandleId:handle.handleId,
      mountScopeRevision:handle.mountScopeRevision, containmentDigest:handle.containmentDigest,
      fingerprintVerifiedAtMs:raw.fingerprintVerifiedAtMs, observedAtMs }), snapshotDigest:''
  };
  const { snapshotDigest, observedAtMs: _observedAtMs, fingerprintVerifiedAtMs: _fingerprintVerifiedAtMs, ...basis } = value;
  value.snapshotDigest = canonicalDigest(basis);
  return Object.freeze(value);
}

function compactPage(handle, request, producerRef, observedAtMs, entries, cursorOut, hasMore) {
  const entryDigests = entries.map((item) => item.snapshotDigest);
  const value = { schemaRef:PAGE_SCHEMA, schemaVersion:1, evidenceId:request.observationId, evidenceKind:'observation_page_commit',
    producerRef, basisDigest:canonicalDigest({ schema:'procurement.field-observation-basis@1', fieldAccessHandle:handle, pageRequest:request }),
    payloadDigest:'', observedAtMs, fieldObservationWorkId:request.fieldObservationWorkId, observationId:request.observationId,
    fieldId:handle.fieldId, accessRevision:handle.accessRevision, profileHintSnapshot:request.profileHintSnapshot,
    pageOrdinal:request.pageOrdinal, expectedObservationRevision:request.expectedObservationRevision, cursorIn:request.cursorIn,
    cursorOut, entryCount:entries.length, firstEntryDigest:entryDigests[0] || canonicalDigest({ schema:'procurement.empty-page@1' }),
    lastEntryDigest:entryDigests[entryDigests.length - 1] || canonicalDigest({ schema:'procurement.empty-page@1' }),
    entrySetDigest:canonicalDigest({ schema:'procurement.observation-entry-set@1', items:entryDigests }), pageDigest:'', hasMore };
  const without = { ...value }; delete without.pageDigest; delete without.payloadDigest;
  value.pageDigest = canonicalDigest({ schema:'procurement.field-observation-page-commit@1', producerRef:value.producerRef,
    basisDigest:value.basisDigest, observedAtMs:value.observedAtMs, fieldObservationWorkId:value.fieldObservationWorkId,
    observationId:value.observationId, fieldId:value.fieldId, accessRevision:value.accessRevision,
    profileHintSnapshot:value.profileHintSnapshot, pageOrdinal:value.pageOrdinal, expectedObservationRevision:value.expectedObservationRevision,
    cursorIn:value.cursorIn, cursorOut:value.cursorOut, entryCount:value.entryCount, firstEntryDigest:value.firstEntryDigest,
    lastEntryDigest:value.lastEntryDigest, entrySetDigest:value.entrySetDigest, hasMore:value.hasMore });
  value.payloadDigest = value.pageDigest;
  return Object.freeze({ page:Object.freeze(value), entries:Object.freeze(entries) });
}

function createFieldPageObserver(options) {
  if (!options || typeof options.enumeratePage !== 'function' || typeof options.now !== 'function') fail('P7_FIELD_OBSERVER_DEPENDENCIES', 'Bounded Field enumerator and clock are required.');
  const producerRef = options.producerRef || 'procurement.field.observation.page.commit@1';
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
      const accepted = candidates.slice(0, pageRequest.pageBudget);
      const hasMore = accepted.length < candidates.length || enumeration.hasMore;
      if (hasMore && accepted.length === 0) fail('P7_FIELD_PAGE_EMPTY_PROGRESS', 'A non-terminal page must make cursor progress.');
      const cursorOut = hasMore ? accepted[accepted.length - 1].cursor : null;
      const draft = compactPage(fieldAccessHandle, pageRequest, producerRef, observedAtMs, accepted.map((item) => item.snapshot), cursorOut, hasMore);
      validatePage({ ...draft.page, entries:draft.entries }, fieldAccessHandle, pageRequest, observedAtMs);
      return draft;
    }
  });
}

module.exports = Object.freeze({ FieldPageObserverError, createFieldPageObserver });
