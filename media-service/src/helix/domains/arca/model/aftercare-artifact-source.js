'use strict';
const {assertJavSelectedSource,buildJavSelectedSource}=require('../../../contracts/jav-selected-source');
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {assertJavCoverDerivation}=require('../../../contracts/jav-cover-derivation');
const {restoreMetadataRecord}=require('./jav-correction-stored-facts');
function aftercareJavSource(context) {
  const raw=context.raw;
  if(raw.identity.provider!=='jav')return null;
  const fail=()=>{throw Object.assign(new Error('Aftercare JAV source does not match the accepted canonical identity.'),
    {code:'ARCA_AFTERCARE_PROVIDER_INPUT_STALE'});};
  if(raw.entry.structure_kind!=='single'||raw.identity.identity_kind!=='jav_code')fail();
  const facts=raw.facts.filter(item=>item.fact_kind==='product_metadata');
  if(facts.length!==1)fail();
  const stored=facts[0].value,metadata=stored.schemaRef==='helix://contracts/application-types/ArcaJavCorrectionMetadataRecord/v1'
    ?restoreMetadataRecord(stored,raw.javMetadataVerifiedSource):stored;
  let source;
  try { source=metadata.javSelectedSource?assertJavSelectedSource(metadata.javSelectedSource):buildJavSelectedSource(metadata.sourceQualification); }
  catch { fail(); }
  if(source.queryAnchor.javCode!==String(raw.identity.provider_key))fail();
  if(metadata.schemaRef==='helix://contracts/application-types/ArcaJavCorrectionMetadataFact/v1'&&
    (metadata.javCode!==raw.identity.provider_key||metadata.canonicalIdentityDigest!==raw.identity.identity_digest))fail();
  return source;
}
function aftercareArtifactSourceIntent(context) {
  const source=aftercareJavSource(context);
  if(source)return Object.freeze({providerKind:'jav',integrationId:source.integrationId,configRevision:source.configRevision,javSelectedSource:source});
  const provenance=context.raw.facts.map(item=>item.value?.provenance||item.value?.sourceProvenance||{}).find(item=>item.integrationId&&item.configRevision);
  return Object.freeze({providerKind:context.raw.identity.provider,integrationId:provenance?.integrationId,configRevision:Number(provenance?.configRevision)});
}
function aftercareJavAcquisitionSource(origin,handle,observation) {
  const fail=()=>{throw Object.assign(new Error('Aftercare cover must prove the original site resource title and cover under its current Handle.'),
    {code:'ARCA_AFTERCARE_PROVIDER_RESPONSE_STALE'});};
  assertJavSelectedSource(origin);
  if(!observation||observation.result!=='qualified'||observation.siteRef!==origin.siteRef||
    observation.resourceKey!==origin.resourceKey||observation.queryAnchorDigest!==origin.queryAnchor.anchorDigest||
    observation.resolvedProviderIdentity?.provider!=='jav'||observation.resolvedProviderIdentity?.namespace!=='jav_code'||
    observation.resolvedProviderIdentity?.providerKey!==origin.queryAnchor.javCode||
    observation.descriptiveEntries?.find(item=>item.key==='title')?.value!==origin.title||observation.cover?.byteDigest!==origin.coverDigest||
    handle.integrationType!=='jav_source'||handle.siteRef!==origin.siteRef||handle.integrationId!==origin.integrationId||
    handle.authMode!==origin.authMode||handle.allowedOperation!=='arca.aftercare.binary_artifact.acquire@1'||
    observation.endpointProfileDigest!==handle.endpointProfileDigest||observation.networkRouteDigest!==handle.networkRouteDigest||
    observation.observationDigest!==canonicalDigest(Object.fromEntries(Object.entries(observation).filter(([key])=>key!=='observationDigest'))))fail();
  const body={...origin,configRevision:handle.configRevision,endpointProfileDigest:handle.endpointProfileDigest,
    networkRouteDigest:handle.networkRouteDigest,qualificationDigest:observation.observationDigest};
  delete body.bindingDigest;
  return Object.freeze(assertJavSelectedSource({...body,bindingDigest:canonicalDigest(body)}));
}
function aftercareJavCoverProvenance(context,handle,value) {
  const origin=aftercareJavSource(context),proof=assertJavCoverDerivation(value),source=proof.javSelectedSource;
  if(!['poster','fanart'].includes(proof.kind)||proof.sourceObservationDigest!==source.qualificationDigest||
    ['siteRef','integrationId','resourceKey','title','coverDigest','authMode'].some(key=>source[key]!==origin[key])||
    canonicalDigest(source.queryAnchor)!==canonicalDigest(origin.queryAnchor)||
    ['siteRef','integrationId','configRevision','endpointProfileDigest','networkRouteDigest','authMode'].some(key=>source[key]!==handle[key]))
    throw Object.assign(new TypeError('Aftercare JAV derivation does not conserve its accepted source and current Handle.'),
      {code:'ARCA_AFTERCARE_ARTIFACT_VERIFICATION_FAILED'});
  return canonicalDigest({schema:'arca.jav-aftercare-cover-provenance@1',careBasisDigest:context.basis.digest,
    acceptedSelectionDigest:origin.bindingDigest,integrationHandleId:handle.handleId,sourceByteDigest:proof.sourceByteDigest,
    artifactKind:proof.kind,rendererVersion:proof.rendererVersion,crop:proof.crop,outputDigest:proof.outputDigest});
}
module.exports=Object.freeze({aftercareJavSource,aftercareArtifactSourceIntent,aftercareJavAcquisitionSource,aftercareJavCoverProvenance});
