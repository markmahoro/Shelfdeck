'use strict';
const fs=require('node:fs'),path=require('node:path');
const {canonicalDigest}=require('../contracts/canonical-json');
const {computeBoundedMaterialFingerprintSync}=require('./bounded-material-fingerprint');
const proof=require('../contracts/us-adult-inventory-read-handle');

function fail(code,message){throw Object.assign(new Error(message),{code});}
function createUsAdultInventorySource(options){
  if(typeof options?.assertAuthority!=='function')throw new TypeError('Inventory source reads require an explicit Owner authority guard.');
  const now=options.now||Date.now,fingerprint=options.computeFingerprint||computeBoundedMaterialFingerprintSync;
  function issueReadHandle({intent,aftercareCaseId,identity,binding,target,context}){
    const scope=proof.scope(intent,aftercareCaseId),expected=intent.sourceMaterialBinding;
    if(context?.ownerScope?.domain!=='arca'||context.ownerScope.processType!=='arca_shelf_entry'||context.ownerScope.processId!==scope.shelfEntryId||
        typeof context.assertExecutionActive!=='function'||identity?.schemaRef!=='helix://contracts/types/PhysicalMaterialIdentity/v2'||
        identity.schemaVersion!==2||identity.materialKey!==expected.materialKey||canonicalDigest(identity)!==expected.identityDigest||
        !binding||binding.endpointId!==expected.endpointId||binding.bindingRevision!==expected.bindingRevision||
        canonicalDigest({materialKey:identity.materialKey,endpointId:binding.endpointId,location:binding.location,bindingRevision:binding.bindingRevision})!==expected.bindingDigest||
        !target||typeof binding.location!=='string'||typeof target.rootLocation!=='string'||target.endpointId!==binding.endpointId||target.mountScopeId!==identity.mountScopeId||
        !Number.isSafeInteger(target.mountScopeRevision)||target.mountScopeRevision<1||!path.isAbsolute(target.rootLocation)||!path.isAbsolute(binding.location)){
      fail('ARCA_US_ADULT_SOURCE_BINDING_INVALID','Source read requires the exact Arca Entry binding and its original physical target.');
    }
    const guard=()=>{context.assertExecutionActive();if(options.assertAuthority(scope)!==true)
      fail('ARCA_US_ADULT_SOURCE_AUTHORITY_LOST','The actor refresh no longer has current source authority.');};
    guard();
    const root=path.resolve(target.rootLocation),location=path.resolve(binding.location),relative=path.relative(root,location);
    if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))
      fail('ARCA_US_ADULT_SOURCE_ESCAPE','Inventory source escaped its exact physical target.');
    let current=root;
    for(const part of [null,...relative.split(path.sep)]){
      if(part!==null)current=path.join(current,part);
      const stat=fs.lstatSync(current);
      if(stat.isSymbolicLink()||(current===location?!stat.isFile():!stat.isDirectory()))
        fail('ARCA_US_ADULT_SOURCE_ESCAPE','Inventory source traverses a linked or non-regular physical target.');
    }
    const observed=fingerprint(location,{requireStableSnapshot:true}),stat=observed.stat;
    if(String(stat.ino)!==identity.inode||Number(stat.size)!==identity.sizeBytes||observed.fingerprintAlgorithm!==identity.fingerprintAlgorithm||
        observed.fingerprintVersion!==identity.fingerprintVersion||observed.contentFingerprint!==identity.contentFingerprint)
      fail('ARCA_US_ADULT_SOURCE_CHANGED','Inventory source bytes no longer match their frozen physical identity.');
    guard();
    const at=now(),body={schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',schemaVersion:1,
      handleId:proof.readHandleId(intent,aftercareCaseId),identity:Object.freeze(structuredClone(identity)),ownerDomain:'arca',
      ownerScope:Object.freeze({scopeType:'shelf_entry',scopeId:scope.shelfEntryId}),bindingRevision:binding.bindingRevision,endpointId:binding.endpointId,
      location:binding.location,mountScopeRevision:target.mountScopeRevision,expectedSizeBytes:identity.sizeBytes,
      expectedMtimeNs:Number(stat.mtimeNs/1000000n),expectedCtimeNs:Number(stat.ctimeNs/1000000n),
      fingerprintVerifiedAtMs:at,readScope:'us_adult_actor_refresh_source',expiresAtMs:at+proof.LIFETIME_MS};
    return Object.freeze(proof.assertReadHandle({intent,aftercareCaseId,handle:{...body,fenceDigest:proof.readHandleFence(intent,aftercareCaseId,body)},atMs:at}));
  }
  return Object.freeze({issueReadHandle});
}
module.exports=Object.freeze({createUsAdultInventorySource});
