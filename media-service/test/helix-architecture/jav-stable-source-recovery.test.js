'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {buildJavSourceQualification,resolveJavQualifiedHandle}=require('../../src/helix/contracts/jav-source-qualification');
const {buildProductIntegrationHandle}=require('../../src/helix/platform/model/product-integration-handle');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const bindingSchema=require('../../src/helix/contracts/domain-types/JavSourceQualification/v1/schema.json');

const D=value=>canonicalDigest({value});
const source={siteRef:'javdb',integrationId:'jav-javdb',configRevision:1,authMode:'anonymous',endpointProfileDigest:D('endpoint'),networkRouteDigest:D('route')};

for(const operation of ['libra.product_identity.evidence.observe@1','libra.product_metadata.fetch@1','libra.product_artifact.acquire@1']) {
  test(operation+' retains the frozen execution input across TTL expiry and resolver reconstruction',()=>{
    const artifactKind=operation.includes('artifact')?'poster':null;
    const before=buildJavSourceQualification(source,operation,artifactKind),snapshot=canonicalDigest(before);
    const freshResolver=at=>input=>buildProductIntegrationHandle({...source,integrationType:'jav_source',secretRef:null,
      allowedOperation:input.operationId,artifactKind:input.artifactKind||null,expiresAtMs:at+60000});
    const first=resolveJavQualifiedHandle(before,source,operation,freshResolver(1000),artifactKind);
    const restored=JSON.parse(JSON.stringify(before));
    const next=resolveJavQualifiedHandle(restored,source,operation,freshResolver(121000),artifactKind);
    assert.notEqual(first.fenceDigest,next.fenceDigest);assert.ok(next.expiresAtMs>first.expiresAtMs);
    assert.equal(canonicalDigest(buildJavSourceQualification(source,operation,artifactKind)),snapshot);
    assert.deepEqual(restored,before);
    for(const field of ['siteRef','integrationId','configRevision','authMode','endpointProfileDigest','networkRouteDigest']) {
      const resolver=input=>({...freshResolver(121000)(input),[field]:field==='configRevision'?2:'changed'});
      assert.throws(()=>resolveJavQualifiedHandle(restored,source,operation,resolver,artifactKind),{code:'LIBRA_JAV_SOURCE_CONFIG_STALE'});
    }
    assert.throws(()=>resolveJavQualifiedHandle({...restored,configRevision:2},source,operation,freshResolver(121000),artifactKind));
    const validator=createCapabilityContractValidator({schemas:[bindingSchema]});
    validator.validate(before.schemaRef,before);
  });
}

test('JAV metadata retains a valid start authorization when its query completes after the short Handle TTL',async()=>{
  const {buildJavQueryAnchor}=require('../../src/helix/contracts/jav-source-contracts');
  const {buildMetadataFetchIntent}=require('../../src/helix/domains/libra/model/product-fact-contracts');
  const {createProductMetadataCapabilityPorts}=require('../../src/helix/domains/libra/capabilities/product-metadata-capability-ports');
  const {validateProductIntegrationHandle}=require('../../src/helix/platform/model/product-integration-handle');
  const operation='libra.product_metadata.fetch@1',selected={schema:'libra.jav-selected-source@1',...source,
    queryAnchor:buildJavQueryAnchor('jav_code','IPX-177'),resourceKey:'film',title:'A title',coverDigest:D('cover'),qualificationDigest:D('proof')};
  selected.bindingDigest=canonicalDigest(selected);
  const identity={provider:'jav',namespace:'jav_code',providerKey:'IPX-177',seasonNumber:null};identity.identityAnchorDigest=canonicalDigest(identity);
  const intent=buildMetadataFetchIntent({libraRunId:'run',runExecutionBasisDigest:D('basis'),sourceKind:'provider',sourcePriority:0,contentProfile:'jav',
    resolvedIdentityDigest:D('identity'),requestedFields:['title'],providerKind:'jav',integrationId:source.integrationId,configRevision:1,
    resolvedProviderIdentity:identity,javSelectedSource:selected});
  let at=1000;
  const port=createProductMetadataCapabilityPorts({now:()=>at,resolveJavSourceHandle:input=>buildProductIntegrationHandle({...source,
    integrationType:'jav_source',secretRef:null,allowedOperation:input.operationId,artifactKind:null,expiresAtMs:at+60000}),
    productProductionPort:{readRelatedNfo(){throw new Error('Unexpected NFO read');},async fetchProvider(){
      at=121000;return {descriptiveEntries:[{key:'title',value:'A title'}],providerIdentities:[identity],peopleHints:[]};
    }}})[operation];
  const outcome=await port.execute({namedInputs:{metadataFetchIntent:intent,
    physicalMaterialReadHandleOrIntegrationHandle:buildJavSourceQualification(source,operation)}});
  assert.equal(outcome.kind,'succeeded');assert.equal(outcome.result.sourceAuthorizedAtMs,1000);assert.equal(outcome.result.observedAtMs,121000);
  const handle=outcome.result.sourceIntegrationHandle,expected={...source,integrationType:'jav_source',secretRef:null,allowedOperation:operation,artifactKind:null};
  assert.equal(validateProductIntegrationHandle(handle,expected,outcome.result.sourceAuthorizedAtMs),true);
  assert.equal(validateProductIntegrationHandle(handle,expected,outcome.result.observedAtMs),false);
});
