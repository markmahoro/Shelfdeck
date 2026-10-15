'use strict';

const { canonicalDigest,canonicalJson } = require('../../../contracts/canonical-json');
const { assertJavSourceSelectionSnapshot } = require('../../../contracts/jav-source-contracts');
function fail(code,message) {throw Object.assign(new TypeError(message),{code});}
function body(value,fields) {return Object.fromEntries(Object.entries(value).filter(([key])=>!fields.includes(key)));}
function buildJavIdentityIntent(value) {
  const sourceSnapshot=assertJavSourceSelectionSnapshot(value.sourceSnapshot),source=sourceSnapshot.sources[value.sourceOrdinal];
  if(!source || sourceSnapshot.queryAnchor.queryKind!=='jav_code')fail('LIBRA_JAV_IDENTITY_INTENT_INVALID','JAV identity requires one exact source ordinal.');
  const fields={libraRunId:value.libraRunId,subjectId:value.subjectId,runExecutionBasisDigest:value.runExecutionBasisDigest,
    contentProfile:'jav',sourceKind:value.resourceKey?'provider_exact':'provider_search',provider:'jav',namespace:'jav_code',
    sourceSnapshot,sourceOrdinal:value.sourceOrdinal,integrationId:source.integrationId,configRevision:source.configRevision,
    javSelectionFence:value.javSelectionFence,resourceKey:value.resourceKey||null,expectedTitle:value.expectedTitle||null,
    expectedCoverDigest:value.expectedCoverDigest||null};
  const intentDigest=canonicalDigest(fields),result={intentId:'libra-jav-identity-intent-'+intentDigest.slice(0,40),...fields,intentDigest};
  if(Buffer.byteLength(canonicalJson(result),'utf8')>16*1024)fail('LIBRA_JAV_IDENTITY_INTENT_BOUND','JAV identity intent exceeds its byte budget.');
  return Object.freeze(result);
}
function javIdentityObservation(intent,observation) {
  if(canonicalDigest(body(intent,['intentId','intentDigest']))!==intent.intentDigest)
    fail('LIBRA_JAV_IDENTITY_INTENT_INVALID','JAV identity intent digest is invalid.');
  const snapshot=assertJavSourceSelectionSnapshot(intent.sourceSnapshot),source=snapshot.sources[intent.sourceOrdinal];
  if(!source || observation?.schema!=='integration.jav-source-observation@1' || observation.siteRef!==source.siteRef ||
      observation.endpointProfileDigest!==source.endpointProfileDigest || observation.networkRouteDigest!==source.networkRouteDigest ||
      observation.queryAnchorDigest!==snapshot.queryAnchor.anchorDigest ||
      observation.observationDigest!==canonicalDigest(body(observation,['observationDigest'])))
    fail('LIBRA_JAV_IDENTITY_SOURCE_INVALID','JAV identity observation differs from its frozen source.');
  let result='not_found',reasonCode=observation.result,candidates=[],verifiedIdentity=null,qualificationObservation=null;
  if(observation.result==='ambiguous') {
    result='ambiguous';candidates=observation.candidates;
    if(!Array.isArray(candidates)||candidates.length<2||candidates.length>16)fail('LIBRA_JAV_IDENTITY_SOURCE_INVALID','JAV candidates exceed their exact bounded scope.');
  }else if(observation.result==='qualified') {
    const identity=observation.resolvedProviderIdentity,title=observation.descriptiveEntries.find(entry=>entry.key==='title')?.value;
    if(identity.provider!=='jav'||identity.namespace!=='jav_code'||identity.providerKey!==snapshot.queryAnchor.javCode ||
        identity.identityAnchorDigest!==canonicalDigest(body(identity,['identityAnchorDigest'])) || typeof title!=='string'||!title.trim())
      fail('LIBRA_JAV_IDENTITY_SOURCE_INVALID','JAV source returned an unrelated identity.');
    if((intent.resourceKey && intent.resourceKey!==observation.resourceKey) ||
        (intent.expectedTitle && intent.expectedTitle!==title) ||
        (intent.expectedCoverDigest && intent.expectedCoverDigest!==observation.cover.byteDigest)) {
      result='conflicting';reasonCode='jav_preview_changed';
    }else {
      result='resolved';reasonCode=null;qualificationObservation=observation;
      const date=observation.descriptiveEntries.find(entry=>entry.key==='release_date')?.value;
      const fields={provider:'jav',namespace:'jav_code',providerKey:identity.providerKey,displayTitle:title,originalTitle:null,
        releaseYear:typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)?Number(date.slice(0,4)):null};
      verifiedIdentity=Object.freeze({...fields,identityDigest:canonicalDigest(fields)});
    }
  }
  const fields={schemaRef:'helix://contracts/types/ProductIdentityEvidenceObservation/v1',schemaVersion:1,
    observationId:'libra-jav-identity-observation-'+canonicalDigest({intentId:intent.intentId,sourceDigest:observation.observationDigest}).slice(0,40),
    intentId:intent.intentId,libraRunId:intent.libraRunId,subjectId:intent.subjectId,sourceKind:intent.sourceKind,contentProfile:'jav',
    sourceSnapshot:snapshot,sourceOrdinal:intent.sourceOrdinal,javSelectionFence:intent.javSelectionFence,result,reasonCode,
    candidates,candidateMatchCount:verifiedIdentity?1:candidates.length,verifiedIdentity,qualificationObservation,
    sourceAssociationDigest:canonicalDigest(intent.javSelectionFence),evidenceDigest:canonicalDigest({intentDigest:intent.intentDigest,observationDigest:observation.observationDigest})};
  const value={...fields,observationDigest:canonicalDigest(fields)};
  if(Buffer.byteLength(canonicalJson(value),'utf8')>64*1024)fail('LIBRA_JAV_IDENTITY_OBSERVATION_BOUND','JAV identity Observation exceeds its byte budget.');
  return Object.freeze(value);
}
module.exports=Object.freeze({buildJavIdentityIntent,javIdentityObservation});
