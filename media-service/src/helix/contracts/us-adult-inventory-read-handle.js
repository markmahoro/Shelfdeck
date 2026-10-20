'use strict';
const {canonicalDigest}=require('./canonical-json');
const LIFETIME_MS=24*60*60*1000;
const FIELDS=['schemaRef','schemaVersion','handleId','identity','ownerDomain','ownerScope','bindingRevision','endpointId','location','mountScopeRevision',
  'expectedSizeBytes','expectedMtimeNs','expectedCtimeNs','fingerprintVerifiedAtMs','readScope','expiresAtMs','fenceDigest'];
function fail(){throw Object.assign(new TypeError('Inventory read authority must bind its exact Actor Intent, Case, Entry and source.'),
  {code:'ARCA_US_ADULT_READ_HANDLE_INVALID'});}
function scope(intent,aftercareCaseId){
  const {intentDigest,...body}=intent||{};
  if(intent?.schemaRef!=='helix://contracts/domain-types/UsAdultActorRefreshIntent/v1'||intent.schemaVersion!==1||
      intentDigest!==canonicalDigest(body)||typeof aftercareCaseId!=='string'||!aftercareCaseId||aftercareCaseId.length>256||
      !/^[a-f0-9]{64}$/.test(intent.intentId||'')||!/^[a-f0-9]{64}$/.test(intent.sourceMaterialBinding?.bindingDigest||'')||
      typeof intent.shelfEntryId!=='string'||!intent.shelfEntryId)fail();
  return Object.freeze({shelfEntryId:intent.shelfEntryId,aftercareCaseId,intentId:intent.intentId,intentDigest,
    materialKey:intent.sourceMaterialBinding.materialKey,sourceMaterialBindingDigest:intent.sourceMaterialBinding.bindingDigest,bindingRevision:intent.sourceMaterialBinding.bindingRevision});
}
function readHandleId(intent,aftercareCaseId){return 'arca-us-read-'+canonicalDigest({schema:'arca.us-adult-read-handle-id@1',...scope(intent,aftercareCaseId)});}
function readHandleFence(intent,aftercareCaseId,body){return canonicalDigest({schema:'arca.us-adult-read-fence@1',scope:scope(intent,aftercareCaseId),handle:body});}
function assertReadHandle({intent,aftercareCaseId,handle,atMs}){
  scope(intent,aftercareCaseId);
  const {fenceDigest,...body}=handle||{},binding=intent.sourceMaterialBinding;
  if(!handle||Object.keys(handle).sort().join(',')!==[...FIELDS].sort().join(',')||
      handle.schemaRef!=='helix://contracts/types/PhysicalMaterialReadHandle/v1'||handle.schemaVersion!==1||
      handle.handleId!==readHandleId(intent,aftercareCaseId)||handle.ownerDomain!=='arca'||handle.ownerScope?.scopeType!=='shelf_entry'||
      handle.ownerScope.scopeId!==intent.shelfEntryId||handle.readScope!=='us_adult_actor_refresh_source'||
      handle.identity?.materialKey!==binding.materialKey||canonicalDigest(handle.identity)!==binding.identityDigest||
      handle.bindingRevision!==binding.bindingRevision||handle.endpointId!==binding.endpointId||
      handle.expectedSizeBytes!==handle.identity.sizeBytes||
      canonicalDigest({materialKey:binding.materialKey,endpointId:handle.endpointId,location:handle.location,bindingRevision:handle.bindingRevision})!==binding.bindingDigest||
      !Number.isSafeInteger(handle.fingerprintVerifiedAtMs)||handle.fingerprintVerifiedAtMs<0||
      handle.expiresAtMs!==handle.fingerprintVerifiedAtMs+LIFETIME_MS||fenceDigest!==readHandleFence(intent,aftercareCaseId,body))fail();
  if(!Number.isSafeInteger(atMs)||atMs<handle.fingerprintVerifiedAtMs||atMs>=handle.expiresAtMs)
    throw Object.assign(new Error('The prepared inventory source read authority has expired.'),{code:'ARCA_US_ADULT_READ_HANDLE_EXPIRED'});
  return handle;
}
module.exports=Object.freeze({LIFETIME_MS,scope,readHandleId,readHandleFence,assertReadHandle});
