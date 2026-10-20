'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {createUsAdultInventorySource}=require('../../src/helix/integrations/us-adult-inventory-source');
const {computeBoundedMaterialFingerprintSync}=require('../../src/helix/integrations/bounded-material-fingerprint');
const {buildIntent}=require('../../src/helix/domains/arca/model/us-adult-actor-refresh');
const {assertReadHandle,LIFETIME_MS}=require('../../src/helix/contracts/us-adult-inventory-read-handle');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const {buildDomainInputSchemas}=require('../../scripts/helix-architecture/domain-input-schema-builder');
const {fixture:inventoryContext}=require('./fixtures/us-adult-inventory-context');
const schemas=buildDomainInputSchemas(),validator=createCapabilityContractValidator({schemas:[
  ...['UsAdultActorRefreshIntent','UsAdultPersonSnapshot','PersonReferenceProjection','PeopleReferenceLibraryPage','FaceModelRef'].map(name=>schemas[name]),
  ...['PhysicalMaterialReadHandle','PhysicalMaterialIdentity'].map(name=>require('../../src/helix/contracts/types/'+name+'/'+(name==='PhysicalMaterialIdentity'?'v2':'v1')+'/schema.json'))]});
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'us-read-authority-')),location=path.join(root,'Current Actor Scene.mkv');
  fs.writeFileSync(location,Buffer.alloc(500000,33));
  t.after(()=>{assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  const observed=computeBoundedMaterialFingerprintSync(location,{requireStableSnapshot:true}),tuple={mountScopeId:'mount',inode:String(observed.stat.ino),sizeBytes:Number(observed.stat.size),
    fingerprintAlgorithm:observed.fingerprintAlgorithm,fingerprintVersion:observed.fingerprintVersion,contentFingerprint:observed.contentFingerprint},
    identity={schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,materialKey:D({schema:'physical-material-identity@2',...tuple}),...tuple},
    context=inventoryContext();
  context.basis={digest:D('care')};context.knownBindings={digest:D('bindings')};
  context.raw.materials=[{role:'primary_payload',material_key:identity.materialKey,mount_scope_id:tuple.mountScopeId,inode:tuple.inode,size_bytes:tuple.sizeBytes,
    fingerprint_algorithm:tuple.fingerprintAlgorithm,fingerprint_version:tuple.fingerprintVersion,content_fingerprint:tuple.contentFingerprint,
    endpoint_id:'endpoint',location,binding_revision:3}];
  const page={schemaRef:'helix://contracts/domain-types/PeopleReferenceLibraryPage/v1',schemaVersion:1,libraryKind:'us_adult',libraryDigest:D('empty'),
    totalPersonCount:0,items:[],nextCursor:null},body={mode:'automatic',idempotencyKey:'refresh',expectedInventoryRevision:2,expectedRepresentationDigest:context.raw.inventory.representation_digest},
    intent=buildIntent({context,body,actorId:'admin',pages:[{...page,pageDigest:D(page)}],contractValidator:validator}),
    request={intent,aftercareCaseId:'case',identity,binding:{endpointId:'endpoint',bindingRevision:3,location},
      target:{endpointId:'endpoint',rootLocation:root,mountScopeId:'mount',mountScopeRevision:1},
      context:{ownerScope:{domain:'arca',processType:'arca_shelf_entry',processId:'entry'},assertExecutionActive(){}}};
  return {root,location,intent,request};
}
test('native source capture issues a complete nominal read handle bound to its exact Case and immutable Inventory binding',t=>{
  const f=fixture(t),port=createUsAdultInventorySource({now:()=>10000,assertAuthority:()=>true}),handle=port.issueReadHandle(f.request);
  validator.validate(handle.schemaRef,handle);assert.equal(assertReadHandle({intent:f.intent,aftercareCaseId:'case',handle,atMs:10000}),handle);
  assert.equal(handle.ownerDomain,'arca');assert.equal(handle.ownerScope.scopeType,'shelf_entry');assert.equal(handle.bindingRevision,3);
  assert.equal(handle.location,f.location);assert.ok(handle.expectedMtimeNs>0);assert.ok(handle.expectedCtimeNs>0);
  assert.throws(()=>assertReadHandle({intent:f.intent,aftercareCaseId:'other-case',handle,atMs:10000}),{code:'ARCA_US_ADULT_READ_HANDLE_INVALID'});
  assert.throws(()=>assertReadHandle({intent:f.intent,aftercareCaseId:'case',handle:{...handle,expectedSizeBytes:1},atMs:10000}),{code:'ARCA_US_ADULT_READ_HANDLE_INVALID'});
  assert.throws(()=>assertReadHandle({intent:f.intent,aftercareCaseId:'case',handle,atMs:10000+LIFETIME_MS}),{code:'ARCA_US_ADULT_READ_HANDLE_EXPIRED'});
});
test('a different Owner or lost authority is rejected before fingerprint I/O',t=>{
  const f=fixture(t);let reads=0;
  const port=createUsAdultInventorySource({assertAuthority:()=>false,computeFingerprint(){reads++;throw new Error('Forbidden read');}});
  assert.throws(()=>port.issueReadHandle(f.request),{code:'ARCA_US_ADULT_SOURCE_AUTHORITY_LOST'});assert.equal(reads,0);
  assert.throws(()=>port.issueReadHandle({...f.request,context:{ownerScope:{domain:'libra',processType:'libra_run',processId:'entry'},assertExecutionActive(){}}}),
    {code:'ARCA_US_ADULT_SOURCE_BINDING_INVALID'});assert.equal(reads,0);
});
test('source mutation, physical target escape and authority loss during capture never publish a usable handle',t=>{
  const f=fixture(t),port=createUsAdultInventorySource({assertAuthority:()=>true});
  assert.throws(()=>port.issueReadHandle({...f.request,target:{...f.request.target,rootLocation:path.join(f.root,'other')}}),{code:'ARCA_US_ADULT_SOURCE_ESCAPE'});
  let guards=0;const changed=createUsAdultInventorySource({assertAuthority:()=>++guards===1});
  assert.throws(()=>changed.issueReadHandle(f.request),{code:'ARCA_US_ADULT_SOURCE_AUTHORITY_LOST'});assert.equal(guards,2);
  fs.appendFileSync(f.location,'changed');
  assert.throws(()=>port.issueReadHandle(f.request),{code:'ARCA_US_ADULT_SOURCE_CHANGED'});
});
