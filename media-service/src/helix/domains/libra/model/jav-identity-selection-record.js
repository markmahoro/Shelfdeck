'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { assertJavSourceSelectionSnapshot } = require('../../../contracts/jav-source-contracts');

const SCHEMA_REF='helix://implementation/libra/JavIdentitySelectionRecord/v1';
const FIELDS=['schema','libraRunId','subjectId','runExecutionBasisDigest','expectedRunStateRevision','expectedIdentityRevision',
  'expectedSelectionIntentRevision','sourceSnapshot','selectedSourceOrdinal','resourceKey','resourceLocatorDigest',
  'candidateSetDigest','qualificationObservation','previewId','actorRef','intentRevision','idempotencyKey'];
function fail() { throw Object.assign(new TypeError('JAV selection record does not conserve its frozen source and exact candidate.'),
  {code:'LIBRA_JAV_SELECTION_RECORD_INVALID'}); }
function text(value,max=256) { return typeof value==='string' && value.trim()===value && value.length>0 && value.length<=max; }
function hex(value) { return typeof value==='string' && /^[a-f0-9]{64}$/.test(value); }
function assertJavIdentitySelectionRecord(record) {
  if(!record || Object.getPrototypeOf(record)!==Object.prototype ||
      canonicalJson(Object.keys(record).sort())!==canonicalJson([...FIELDS].sort()) ||
      record.schema!=='libra.jav-identity-selection-record@1' || !text(record.libraRunId) || !text(record.subjectId) ||
      !text(record.previewId,64) || !text(record.actorRef) || !text(record.idempotencyKey) || !hex(record.runExecutionBasisDigest) ||
      !Number.isSafeInteger(record.expectedRunStateRevision) || record.expectedRunStateRevision<1 || record.expectedIdentityRevision!==0 ||
      !Number.isSafeInteger(record.expectedSelectionIntentRevision) || record.expectedSelectionIntentRevision<0 ||
      record.intentRevision!==record.expectedSelectionIntentRevision+1) fail();
  let snapshot;
  try { snapshot=assertJavSourceSelectionSnapshot(record.sourceSnapshot); } catch { fail(); }
  if(snapshot.queryAnchor.queryKind!=='jav_code' || !Number.isSafeInteger(record.selectedSourceOrdinal))fail();
  const source=snapshot.sources[record.selectedSourceOrdinal],observation=record.qualificationObservation;
  if(!source || !observation || observation.schema!=='integration.jav-source-observation@1' || observation.result!=='qualified' ||
      observation.siteRef!==source.siteRef || observation.endpointProfileDigest!==source.endpointProfileDigest ||
      observation.networkRouteDigest!==source.networkRouteDigest || observation.queryAnchorDigest!==snapshot.queryAnchor.anchorDigest ||
      observation.observationDigest!==canonicalDigest(Object.fromEntries(Object.entries(observation).filter(([key])=>key!=='observationDigest'))))fail();
  const identity=observation.resolvedProviderIdentity,title=observation.descriptiveEntries?.find(entry=>entry.key==='title')?.value;
  if(identity?.provider!=='jav' || identity.namespace!=='jav_code' || identity.providerKey!==snapshot.queryAnchor.javCode ||
      identity.seasonNumber!==null || identity.identityAnchorDigest!==canonicalDigest(Object.fromEntries(Object.entries(identity).filter(([key])=>key!=='identityAnchorDigest'))) ||
      !text(title,16384) || !hex(observation.cover?.byteDigest) || !Number.isSafeInteger(observation.cover?.byteCount) ||
      observation.cover.byteCount<1 || observation.cover.byteCount>16*1024*1024 ||
      !text(record.resourceKey,128) || record.resourceKey!==observation.resourceKey ||
      record.resourceLocatorDigest!==canonicalDigest({siteRef:source.siteRef,resourceKey:record.resourceKey}) ||
      record.candidateSetDigest!==canonicalDigest({queryAnchor:snapshot.queryAnchor,sourceSnapshotDigest:snapshot.snapshotDigest,
        source,resourceKey:record.resourceKey,title,coverDigest:observation.cover.byteDigest}) ||
      Buffer.byteLength(canonicalJson(record),'utf8')>64*1024)fail();
  return record;
}

module.exports=Object.freeze({SCHEMA_REF,assertJavIdentitySelectionRecord});
